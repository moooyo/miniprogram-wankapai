import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiEnvelope, ApiRequest, Card, CommandRequest, Commands } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { readReminderConfiguration } from '../cloudfunctions/reminders/configuration';
import { createReminderWorker, type ReminderGrant, type SubscriptionMessage } from '../cloudfunctions/reminders/worker';
import { api, requestReminder } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';

const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId, templateIds: { ...settings.templateIds } };
const originalWx = (globalThis as any).wx;
let sequence = 0;
let f: ReturnType<typeof fixture>;
let requests: ApiRequest[];
let permissionCalls: number;
let permissionResult: string | undefined;
let permissionFailure: boolean;
let loseResponses: number;
let toasts: string[];

function fixture() {
  const prefix = `consent-${++sequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const templateId = `${prefix}-template`;
  const now = () => new Date('2026-09-28T01:00:00Z');
  const activity = (id: string): Activity => ({
    id, revision: 1, status: 'published', title: 'Card benefit', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-09-01', endsOn: '2026-10-31',
    target: 3, unit: 'count', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three qualifying purchases', sourceUrl: '',
    sourceNote: 'Verified source', entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open benefits', imageIds: [] },
    publishedAt: now().toISOString(), publishedBy: 'moderator', updatedAt: now().toISOString(),
  });
  const card: Card = { id: `${prefix}-card`, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Card', createdAt: now().toISOString() };
  const first = activity(`${prefix}-first`);
  const store = new MemoryStore({
    cards: { [card.id]: card }, activities: { [first.id]: first },
    preferences: { [actor.userId]: { ownerId: actor.userId, newActivities: true, deadlines: false, rewards: false, repayments: false } },
  });
  const service = createService(store, { now, demo: true, templateIds: { new_activity: templateId } });
  const configuration = readReminderConfiguration({
    REMINDERS_ENABLED: 'true',
    REMINDER_TEMPLATES_JSON: JSON.stringify({ new_activity: { templateId, fields: { thing1: 'title', date2: 'dueOn' } } }),
  });
  const messages: SubscriptionMessage[] = [];
  const worker = createReminderWorker({ store, now, configuration, send: async message => { messages.push(message); return { errCode: 0 }; } });
  const payload: Commands['reminder.authorize'] = { kind: 'new_activity', entityId: 'matches', templateId, accepted: true };
  return { prefix, actor, templateId, activity, store, service, worker, messages, payload };
}

beforeEach(() => {
  f = fixture(); requests = []; permissionCalls = 0; permissionResult = 'accept'; permissionFailure = false; loseResponses = 0; toasts = [];
  settings.mode = 'cloud'; settings.cloudEnvId = 'mock-reminder-consent-environment'; settings.templateIds.new_activity = f.templateId;
  (globalThis as any).wx = {
    cloud: {
      init: () => {},
      callFunction: async ({ data }: { data: ApiRequest }): Promise<{ result: ApiEnvelope<unknown> }> => {
        const request = structuredClone(data);
        requests.push(request);
        let result: ApiEnvelope<unknown>;
        try { result = { ok: true, data: await f.service.execute(f.actor, request) }; }
        catch (error) {
          if (!(error instanceof DomainError)) throw error;
          result = { ok: false, error: { code: error.code, message: error.message, field: error.field } };
        }
        if (loseResponses > 0 && request.action === 'reminder.authorize' && result.ok) {
          loseResponses--;
          throw new Error('Authorization committed but response was lost');
        }
        return { result };
      },
    },
    requestSubscribeMessage: (options: any) => {
      permissionCalls++;
      if (permissionFailure) options.fail(new Error('Platform consent failed'));
      else options.success({ [f.templateId]: permissionResult });
    },
    showToast: (options: { title: string }) => { toasts.push(options.title); },
    showModal: () => {},
  };
});

after(() => {
  settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId;
  Object.assign(settings.templateIds, originalSettings.templateIds);
  (globalThis as any).wx = originalWx;
});

function authorizeAttempts() { return requests.filter((request): request is CommandRequest<'reminder.authorize'> => request.action === 'reminder.authorize'); }
async function remaining() { return (await f.store.find<ReminderGrant>('reminder_grants'))[0]?.remaining ?? 0; }
function networkError(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'NETWORK_ERROR'; }

test('a new platform acceptance replenishes a grant after a lost authorization response and worker consumption', async () => {
  loseResponses = 1;
  await assert.rejects(requestReminder('new_activity', 'matches'), networkError);
  assert.equal(await remaining(), 1);
  assert.equal(toasts.length, 0);
  assert.equal((await f.worker()).sent, 1);
  assert.equal(await remaining(), 0);
  const second = f.activity(`${f.prefix}-second`);
  await f.store.set('activities', second.id, second);
  assert.equal(await requestReminder('new_activity', 'matches'), true);
  assert.equal(await remaining(), 1);
  assert.equal(permissionCalls, 2);
  const attempts = authorizeAttempts();
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[1].requestId, attempts[0].requestId);
  assert.equal((await f.worker()).sent, 1);
  assert.equal(f.messages.length, 2);
  assert.equal(await remaining(), 0);
});

test('retries for one consent event keep the same request before and after its grant is consumed', async () => {
  const options = { intentKey: `${f.prefix}-same-consent-event` };
  loseResponses = 1;
  await assert.rejects(api.command('reminder.authorize', f.payload, options), networkError);
  assert.equal(await remaining(), 1);
  await api.command('reminder.authorize', { ...f.payload }, options);
  assert.equal(await remaining(), 1);
  assert.equal((await f.worker()).sent, 1);
  await api.command('reminder.authorize', { templateId: f.templateId, accepted: true, entityId: 'matches', kind: 'new_activity' }, options);
  assert.equal(await remaining(), 0);
  assert.equal(new Set(authorizeAttempts().map(request => request.requestId)).size, 1);
  assert.equal((await f.store.find('requests')).length, 1);
  assert.equal(permissionCalls, 0);
});

test('concurrent independent platform acceptances do not share an inflight grant command', async () => {
  const originalNow = Date.now;
  const originalRandom = Math.random;
  try {
    Date.now = () => 1_790_000_000_000;
    Math.random = () => 0.25;
    assert.deepEqual(await Promise.all([requestReminder('new_activity', 'matches'), requestReminder('new_activity', 'matches')]), [true, true]);
  } finally { Date.now = originalNow; Math.random = originalRandom; }
  assert.equal(permissionCalls, 2);
  assert.equal(authorizeAttempts().length, 2);
  assert.equal(new Set(authorizeAttempts().map(request => request.requestId)).size, 2);
  assert.equal(await remaining(), 2);
});

test('concurrent retries for the same consent event share one dispatch and remain idempotent after completion', async () => {
  const options = { intentKey: `${f.prefix}-concurrent-event` };
  const first = api.command('reminder.authorize', f.payload, options);
  const second = api.command('reminder.authorize', { ...f.payload }, options);
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.equal(authorizeAttempts().length, 1);
  assert.equal(await remaining(), 1);
  await api.command('reminder.authorize', f.payload, options);
  assert.equal(await remaining(), 1);
  assert.equal(new Set(authorizeAttempts().map(request => request.requestId)).size, 1);
});

test('a rejected consent and a later acceptance cannot replay an earlier accepted event', async () => {
  loseResponses = 1;
  await assert.rejects(requestReminder('new_activity', 'matches'), networkError);
  await f.worker();
  permissionResult = 'reject';
  assert.equal(await requestReminder('new_activity', 'matches'), false);
  assert.equal(await remaining(), 0);
  permissionResult = 'accept';
  assert.equal(await requestReminder('new_activity', 'matches'), true);
  assert.equal(await remaining(), 1);
  assert.equal(permissionCalls, 3);
  assert.equal(new Set(authorizeAttempts().map(request => request.requestId)).size, 3);
});

test('platform failure, demo mode, and missing configuration never create an authorization command', async () => {
  permissionFailure = true;
  await assert.rejects(requestReminder('new_activity', 'matches'), /Platform consent failed/);
  settings.templateIds.new_activity = '';
  assert.equal(await requestReminder('new_activity', 'matches'), false);
  settings.mode = 'demo'; settings.templateIds.new_activity = f.templateId;
  assert.equal(await requestReminder('new_activity', 'matches'), false);
  assert.equal(permissionCalls, 1);
  assert.equal(authorizeAttempts().length, 0);
  assert.equal(await remaining(), 0);
});

test('non-accept platform results neither add nor clear a previously granted subscription', async () => {
  assert.equal(await requestReminder('new_activity', 'matches'), true);
  for (const result of ['reject', 'ban', 'filter', undefined]) {
    permissionResult = result;
    assert.equal(await requestReminder('new_activity', 'matches'), false);
    assert.equal(await remaining(), 1);
  }
  assert.equal(authorizeAttempts().length, 5);
  assert.equal(new Set(authorizeAttempts().map(request => request.requestId)).size, 5);
});

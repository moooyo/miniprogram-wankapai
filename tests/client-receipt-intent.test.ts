import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiEnvelope, ApiRequest, CommandRequest, Commands, Participation, QueryRequest, Reward } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';

const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId };
const originalWx = (globalThis as any).wx;
let fixtureSequence = 0;
let f: ReturnType<typeof fixture>;
let requests: ApiRequest[];
let loss: 'none' | 'before' | 'after';

function fixture() {
  const prefix = `receipt-intent-${++fixtureSequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const activity: Activity = {
    id: `${prefix}-activity`, revision: 1, status: 'published', title: 'Monthly benefit',
    bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa credit card',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2027-12-31', target: 1, unit: 'count', currency: 'CNY',
    rewardMinor: 2000, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false,
    conditions: 'One qualifying purchase', sourceUrl: '', sourceNote: 'Verified source',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open benefits', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
  let instant = new Date('2026-09-30T04:00:00Z');
  const store = new MemoryStore({ activities: { [activity.id]: activity } });
  const service = createService(store, { now: () => instant, demo: true });
  const payload: Commands['reward.confirm'] = {
    activityId: activity.id, amountMinor: 2500, receivedOn: '2026-09-30', expectNew: true, expectedPeriodKey: '2026-09',
  };
  return { prefix, actor, activity, store, service, payload, setDate: (date: string) => { instant = new Date(`${date}T04:00:00Z`); } };
}

beforeEach(() => {
  f = fixture(); requests = []; loss = 'none';
  settings.mode = 'cloud'; settings.cloudEnvId = 'receipt-intent-mock-environment';
  (globalThis as any).wx = {
    cloud: {
      init: () => {},
      callFunction: async ({ data }: { data: ApiRequest }): Promise<{ result: ApiEnvelope<unknown> }> => {
        const request = structuredClone(data);
        requests.push(request);
        if (loss === 'before' && request.action === 'reward.confirm') { loss = 'none'; throw new Error('Request did not reach the service'); }
        let result: ApiEnvelope<unknown>;
        try { result = { ok: true, data: await f.service.execute(f.actor, request) }; }
        catch (error) {
          if (!(error instanceof DomainError)) throw error;
          result = { ok: false, error: { code: error.code, message: error.message, field: error.field } };
        }
        if (loss === 'after' && request.action === 'reward.confirm' && result.ok) { loss = 'none'; throw new Error('Committed receipt response was lost'); }
        return { result };
      },
    },
  };
});

after(() => {
  settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId;
  if (originalWx === undefined) delete (globalThis as any).wx;
  else (globalThis as any).wx = originalWx;
});

function hasCode(code: string, field?: string) {
  return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code
    && (field === undefined || ('field' in error && error.field === field));
}
function receiptRequests() { return requests.filter((request): request is CommandRequest<'reward.confirm'> => request.action === 'reward.confirm'); }

test('a committed first receipt retains its request and original period when recovered after rollover', async () => {
  const options = { intentKey: `${f.prefix}-creation` };
  loss = 'after';
  await assert.rejects(api.command('reward.confirm', f.payload, options), hasCode('NETWORK_ERROR'));
  const before = await f.store.find<Participation>('participations');
  assert.equal(before.length, 1);
  assert.equal(before[0].periodKey, '2026-09');
  f.setDate('2026-10-01');
  const recovered = await api.command('reward.confirm', { ...f.payload }, options);
  assert.equal(recovered.id, before[0].id);
  assert.equal(receiptRequests()[1].requestId, receiptRequests()[0].requestId);
  assert.deepEqual(await f.store.find<Participation>('participations'), before);
  const replay = await api.command('reward.confirm', f.payload, { ...options, replayOnly: true });
  assert.equal(replay.id, before[0].id);
  assert.equal((await f.store.find<Reward>('rewards')).length, 1);
  assert.equal((await f.store.find('requests')).length, 1);
  const query = requests.find((request): request is QueryRequest<'request.replay'> => request.action === 'request.replay');
  assert.ok(query);
  assert.equal(query.payload.requestId, receiptRequests()[0].requestId);
  assert.deepEqual(query.payload.payload, f.payload);
});

test('a first receipt that never committed cannot be moved into the next period by retrying its original intent', async () => {
  const options = { intentKey: `${f.prefix}-uncommitted` };
  loss = 'before';
  await assert.rejects(api.command('reward.confirm', f.payload, options), hasCode('NETWORK_ERROR'));
  f.setDate('2026-10-01');
  await assert.rejects(api.command('reward.confirm', f.payload, options), hasCode('VERSION_CONFLICT', 'expectedPeriodKey'));
  assert.equal(receiptRequests()[1].requestId, receiptRequests()[0].requestId);
  await assert.rejects(api.command('reward.confirm', f.payload, { ...options, replayOnly: true }), hasCode('REQUEST_UNRESOLVED'));
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal((await f.store.find('rewards')).length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
});

test('concurrent copies of one first-receipt intent share one dispatch and one receipt', async () => {
  const options = { intentKey: `${f.prefix}-concurrent` };
  const first = api.command('reward.confirm', f.payload, options);
  const second = api.command('reward.confirm', { ...f.payload }, options);
  assert.strictEqual(first, second);
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.id, right.id);
  assert.equal(receiptRequests().length, 1);
  assert.equal((await f.store.find('participations')).length, 1);
  assert.equal((await f.store.find('rewards')).length, 1);
});

test('a recovered first receipt reconstructs its ID after successful in-memory intent cleanup', async () => {
  const options = { intentKey: `${f.prefix}-persisted` };
  const first = await api.command('reward.confirm', f.payload, options);
  const reordered: Commands['reward.confirm'] = {
    expectedPeriodKey: '2026-09', expectNew: true, receivedOn: '2026-09-30', amountMinor: 2500,
    activityId: f.activity.id, participationId: undefined, expectedVersion: undefined,
  };
  const second = await api.command('reward.confirm', reordered, options);
  assert.equal(second.id, first.id);
  assert.equal(receiptRequests()[1].requestId, receiptRequests()[0].requestId);
  assert.equal((await f.store.find('requests')).length, 1);
});

test('a separate first-receipt intent reaches the creation guard instead of replaying another form success', async () => {
  const first = await api.command('reward.confirm', f.payload, { intentKey: `${f.prefix}-first` });
  await assert.rejects(api.command('reward.confirm', f.payload, { intentKey: `${f.prefix}-new-form` }), hasCode('VERSION_CONFLICT'));
  assert.notEqual(receiptRequests()[1].requestId, receiptRequests()[0].requestId);
  assert.equal((await api.command('reward.confirm', f.payload, { intentKey: `${f.prefix}-first`, replayOnly: true })).id, first.id);
  assert.equal((await f.store.find('rewards')).length, 1);
});

test('receipt intent namespaces cannot pin existing-record edits or bypass the first-creation boundary', async () => {
  const options = { intentKey: `${f.prefix}-restricted` };
  for (const payload of [
    { ...f.payload, expectNew: undefined }, { ...f.payload, expectNew: false },
    { ...f.payload, participationId: `${f.prefix}-record` }, { ...f.payload, expectedVersion: 1 },
  ]) {
    await assert.rejects(api.command('reward.confirm', payload, options), hasCode('INVALID_INPUT'));
  }
  assert.equal(requests.length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
});

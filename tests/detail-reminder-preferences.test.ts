import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiEnvelope, ApiRequest, Participation, ReminderPreference, Stage } from '../shared/contracts';
import type { ReminderGrant } from '../cloudfunctions/reminders/worker';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api, ensureSession } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';

type PageInstance = { data: Record<string, any>; [key: string]: any };
type ModalOptions = { title: string; content: string; confirmText?: string; cancelText?: string; showCancel?: boolean };
let definition: PageInstance;
let pages: object[] = [];
let modals: ModalOptions[] = [];
let modalConfirmed = true;
let modalHandler: (() => Promise<{ confirm: boolean }>) | undefined;
let navigation: string[] = [];
let consentCalls = 0;
let toasts: string[] = [];
let sequence = 0;
const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId, templateIds: { ...settings.templateIds } };
const originalWx = (globalThis as any).wx;
const originalPages = (globalThis as any).getCurrentPages;
const originalQuery = api.query;

before(async () => {
  const runtime = globalThis as any, originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/detail/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  pages = []; modals = []; modalConfirmed = true; modalHandler = undefined; navigation = []; consentCalls = 0; toasts = [];
  api.query = originalQuery;
  settings.mode = 'cloud'; settings.cloudEnvId = 'detail-reminder-preferences-test';
  (globalThis as any).getCurrentPages = () => pages;
  (globalThis as any).wx = {
    showModal: async (options: ModalOptions) => { modals.push(structuredClone(options)); return modalHandler ? modalHandler() : { confirm: modalConfirmed }; },
    showToast: ({ title }: { title: string }) => { toasts.push(title); },
    navigateTo: ({ url }: { url: string }) => { navigation.push(url); },
    enableAlertBeforeUnload: () => {}, disableAlertBeforeUnload: () => {},
    requestSubscribeMessage: ({ tmplIds, success }: { tmplIds: string[]; success: (value: Record<string, string>) => void }) => {
      consentCalls += 1;
      success(Object.fromEntries(tmplIds.map(id => [id, 'accept'])));
    },
  };
});

after(() => {
  api.query = originalQuery;
  settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId;
  Object.assign(settings.templateIds, originalSettings.templateIds);
  (globalThis as any).wx = originalWx;
  (globalThis as any).getCurrentPages = originalPages;
});

async function fixture(options: { stage?: Stage; rewardKind?: 'cashback' | 'discount'; expectedOn?: string | null;
  deadlines?: boolean; rewards?: boolean; omitParticipation?: boolean } = {}) {
  const prefix = `detail-preference-${++sequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const source: Activity = {
    id: `${prefix}-activity`, revision: 1, status: 'published', title: 'Monthly activity', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2027-12-31',
    target: 3, unit: 'transactions', currency: 'CNY', rewardMinor: 2000, rewardKind: options.rewardKind || 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three purchases', sourceUrl: '', sourceNote: '',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open bank benefits', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
  const record: Participation = {
    id: `${prefix}-record`, ownerId: actor.userId, activityId: source.id, activityRevision: 1, scopeKey: 'user', snapshot: source,
    periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30', stage: options.stage || 'in_progress', progress: 1,
    registeredAt: null, startedAt: '2026-09-01', completedAt: options.stage === 'completed' ? '2026-09-27' : null,
    expectedOn: options.expectedOn === undefined ? '2026-09-29' : options.expectedOn, receivedOn: null, receivedMinor: null,
    version: 3, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z',
  };
  const preference: ReminderPreference = { ownerId: actor.userId, newActivities: false,
    deadlines: options.deadlines ?? true, rewards: options.rewards ?? true, repayments: false };
  const store = new MemoryStore({ activities: { [source.id]: source },
    participations: options.omitParticipation ? {} : { [record.id]: record }, preferences: { [actor.userId]: preference } });
  const templates = { deadline: `${prefix}-deadline-template`, reward: `${prefix}-reward-template` };
  Object.assign(settings.templateIds, templates);
  const service = createService(store, { now: () => new Date('2026-09-28T04:00:00Z'), demo: false, templateIds: templates });
  const requests: ApiRequest[] = [];
  let onDispatch: ((request: ApiRequest) => void | Promise<void>) | undefined;
  let onResponse: ((request: ApiRequest) => void | Promise<void>) | undefined;
  (globalThis as any).wx.cloud = {
    init: () => {},
    callFunction: async ({ data }: { data: ApiRequest }): Promise<{ result: ApiEnvelope<unknown> }> => {
      const request = structuredClone(data);
      requests.push(request);
      await onDispatch?.(request);
      try {
        const result = await service.execute(actor, request);
        await onResponse?.(request);
        return { result: { ok: true, data: result } };
      } catch (error) {
        if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
        throw error;
      }
    },
  };
  await ensureSession(true);
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data) };
  instance.setData = (patch: Record<string, unknown>) => { Object.assign(instance.data, patch); };
  pages = [instance];
  instance.onLoad({ activityId: source.id, ...(options.omitParticipation ? {} : { participationId: record.id }) });
  await instance.load();
  assert.equal(instance.data.error, '');
  assert.equal(instance.data.loading, false);
  return { actor, source, record, preference, templates, store, requests, page: instance,
    onDispatch: (handler: (request: ApiRequest) => void | Promise<void>) => { onDispatch = handler; },
    onResponse: (handler: (request: ApiRequest) => void | Promise<void>) => { onResponse = handler; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function authorizationRequests(f: Awaited<ReturnType<typeof fixture>>) { return f.requests.filter(request => request.action === 'reminder.authorize'); }

for (const kind of ['deadline', 'reward'] as const) {
  test(`a disabled ${kind} preference explains the missing prerequisite and opens settings without native consent or a grant`, async () => {
    const f = await fixture({ stage: kind === 'reward' ? 'completed' : 'in_progress', deadlines: kind !== 'deadline', rewards: kind !== 'reward' });
    const requestStart = f.requests.length;
    const before = await f.store.exportSeed();
    await f.page.reminder();
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get']);
    assert.equal(modals.length, 1);
    assert.match(modals[0].title + modals[0].content, kind === 'deadline' ? /截止/ : /到账|收益/);
    assert.match(modals[0].content, /设置|偏好/);
    assert.match(modals[0].confirmText || '', /设置/);
    assert.deepEqual(navigation, ['/pages/preferences/index']);
    assert.equal(consentCalls, 0);
    assert.equal(authorizationRequests(f).length, 0);
    assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
    assert.deepEqual(await f.store.exportSeed(), before);
    assert.equal(f.page.data.busy, false);
  });

  test(`an enabled ${kind} preference retains the original native authorization and owned grant command`, async () => {
    const f = await fixture({ stage: kind === 'reward' ? 'completed' : 'in_progress', deadlines: kind === 'deadline', rewards: kind === 'reward' });
    const requestStart = f.requests.length;
    await f.page.reminder();
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get']);
    assert.equal(f.page.data.reminderReady, true);
    assert.equal(consentCalls, 0, 'Preference checks cannot consume the later native authorization gesture.');
    assert.equal(authorizationRequests(f).length, 0);
    assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
    await f.page.reminder();
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get', 'reminder.authorize']);
    assert.equal(consentCalls, 1);
    assert.equal(modals.length, 0);
    assert.equal(navigation.length, 0);
    assert.deepEqual(authorizationRequests(f)[0].payload, { kind, entityId: f.record.id, templateId: f.templates[kind], accepted: true });
    const grants = await f.store.find<ReminderGrant>('reminder_grants');
    assert.equal(grants.length, 1);
    assert.equal(grants[0].ownerId, f.actor.userId);
    assert.equal(grants[0].kind, kind);
    assert.equal(grants[0].entityId, f.record.id);
    assert.equal(grants[0].remaining, 1);
    assert.deepEqual(await f.store.get<Participation>('participations', f.record.id), f.record);
    assert.equal(f.page.data.busy, false);
  });
}

test('canceling the disabled-preference explanation preserves the record and a later attempt reads the updated preference', async () => {
  const f = await fixture({ deadlines: false });
  modalConfirmed = false;
  await f.page.reminder();
  assert.equal(modals.length, 1);
  assert.equal(navigation.length, 0);
  assert.equal(consentCalls, 0);
  await f.store.set('preferences', f.actor.userId, { ...f.preference, deadlines: true });
  const requestStart = f.requests.length;
  await f.page.reminder();
  assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get']);
  assert.equal(f.page.data.reminderReady, true);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  await f.page.reminder();
  assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get', 'reminder.authorize']);
  assert.equal(consentCalls, 1);
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants'))[0].remaining, 1);
  assert.deepEqual(await f.store.get<Participation>('participations', f.record.id), f.record);
});

test('a preference read failure blocks authorization, gives relevant feedback, and can be retried after recovery', async () => {
  const f = await fixture();
  f.onDispatch(request => { if (request.action === 'preferences.get') throw new Error('Preference service unavailable'); });
  await f.page.reminder();
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  assert.equal(modals.length, 0);
  assert.equal(navigation.length, 0);
  assert.equal(f.page.data.busy, false);
  assert.equal(toasts.length, 0);
  assert.equal(f.page.data.reminderError, '暂时无法读取提醒设置，尚未申请微信授权。请重试。');
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
  assert.deepEqual(await f.store.get<Participation>('participations', f.record.id), f.record);
  f.onDispatch(() => {});
  await f.page.reminder();
  assert.equal(f.page.data.reminderError, '');
  assert.equal(f.page.data.reminderReady, true);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  await f.page.reminder();
  assert.equal(consentCalls, 1);
  assert.equal(authorizationRequests(f).length, 1);
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants'))[0].remaining, 1);
});

test('an enabled preference without a configured template retains the unavailable-template feedback without consent or a grant', async () => {
  const f = await fixture({ deadlines: true });
  settings.templateIds.deadline = '';
  const requestStart = f.requests.length;
  const before = await f.store.exportSeed();
  await f.page.reminder();
  assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get']);
  assert.equal(f.page.data.reminderReady, true);
  assert.deepEqual(toasts, []);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  await f.page.reminder();
  assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get']);
  assert.deepEqual(toasts, ['此类微信提醒尚未开通，站内待办仍会保留。']);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
  assert.equal(modals.length, 0);
  assert.equal(navigation.length, 0);
  assert.equal(f.page.data.reminderError, '');
  assert.equal(f.page.data.busy, false);
  assert.deepEqual(await f.store.exportSeed(), before);
});

for (const lifecycle of ['hide', 'other-owner', 'unload'] as const) {
  test(`a delayed preference response cannot authorize or interrupt another context after ${lifecycle}`, async () => {
    const f = await fixture();
    const ready = deferred<void>(), release = deferred<void>();
    let held = false;
    f.onResponse(async request => {
      if (request.action === 'preferences.get' && !held) { held = true; ready.resolve(); await release.promise; }
    });
    const requesting = f.page.reminder();
    try {
      await ready.promise;
      assert.equal(f.page.data.busy, true);
      await f.page.reminder();
      assert.equal(f.requests.filter(request => request.action === 'preferences.get').length, 1);
      if (lifecycle === 'hide') f.page.onHide();
      if (lifecycle === 'unload') f.page.onUnload();
      pages = [f.page, {}];
      release.resolve();
      await requesting;
      assert.equal(consentCalls, 0);
      assert.equal(authorizationRequests(f).length, 0);
      assert.equal(modals.length, 0);
      assert.equal(navigation.length, 0);
      assert.equal(toasts.length, 0);
      assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
      if (lifecycle !== 'unload') {
        assert.equal(f.page.data.busy, false);
        pages = [f.page];
        await f.page.onShow();
        await f.page.reminder();
        assert.equal(f.page.data.reminderReady, true);
        assert.equal(consentCalls, 0);
        assert.equal(authorizationRequests(f).length, 0);
        await f.page.reminder();
        assert.equal(consentCalls, 1);
        assert.equal(authorizationRequests(f).length, 1);
      }
    } finally { release.resolve(); f.page.onUnload(); }
  });
}

test('a preference response for an older detail generation cannot authorize after the displayed record changes', async () => {
  const f = await fixture();
  const ready = deferred<void>(), release = deferred<void>();
  f.onResponse(async request => { if (request.action === 'preferences.get') { ready.resolve(); await release.promise; } });
  const requesting = f.page.reminder();
  try {
    await ready.promise;
    const replacement = { ...f.record, id: `${f.record.id}-replacement`, periodKey: '2026-08', startsOn: '2026-08-01', endsOn: '2026-08-31' };
    await f.store.set('participations', replacement.id, replacement);
    f.page.setData({ participationId: replacement.id });
    await f.page.load();
    assert.equal(f.page.data.detail.participation.id, replacement.id);
    release.resolve();
    await requesting;
    assert.equal(consentCalls, 0);
    assert.equal(authorizationRequests(f).length, 0);
    assert.equal(modals.length, 0);
    assert.equal(navigation.length, 0);
    assert.equal(toasts.length, 0);
    assert.equal(f.page.data.busy, false);
  } finally { release.resolve(); f.page.onUnload(); }
});

test('a disabled-preference confirmation returned after hiding cannot navigate or authorize the old page', async () => {
  const f = await fixture({ deadlines: false });
  const ready = deferred<void>(), release = deferred<{ confirm: boolean }>();
  modalHandler = () => { ready.resolve(); return release.promise; };
  const requesting = f.page.reminder();
  try {
    await ready.promise;
    assert.equal(modals.length, 1);
    f.page.onHide();
    pages = [f.page, {}];
    release.resolve({ confirm: true });
    await requesting;
    assert.equal(navigation.length, 0);
    assert.equal(consentCalls, 0);
    assert.equal(authorizationRequests(f).length, 0);
    assert.equal(f.page.data.busy, false);
    assert.equal(toasts.length, 0);
  } finally { release.resolve({ confirm: false }); f.page.onUnload(); }
});

test('demo mode preserves its no-send explanation without reading production reminder preferences', async () => {
  const f = await fixture({ deadlines: false });
  settings.mode = 'demo';
  const calls: string[] = [];
  api.query = (async (action: string) => {
    calls.push(action);
    if (action === 'session.get') return { userId: f.actor.userId, isModerator: false, today: '2026-09-28', month: '2026-09', demo: true };
    throw new Error(`Unexpected demo reminder query ${action}`);
  }) as typeof api.query;
  await f.page.reminder();
  assert.deepEqual(calls, ['session.get']);
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, '演示提醒');
  assert.match(modals[0].content, /不发送微信消息/);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
  assert.equal(navigation.length, 0);
  assert.equal(f.page.data.busy, false);
});

test('received, skipped, undated completed, and completed discount records retain their reminder eligibility gates', async () => {
  for (const options of [
    { stage: 'received' as const }, { stage: 'skipped' as const },
    { stage: 'completed' as const, expectedOn: null },
    { stage: 'completed' as const, rewardKind: 'discount' as const }, { omitParticipation: true },
  ]) {
    const f = await fixture(options);
    const requestStart = f.requests.length;
    await f.page.reminder();
    assert.equal(f.requests.length, requestStart);
    assert.equal(consentCalls, 0);
    assert.equal(authorizationRequests(f).length, 0);
    assert.equal(modals.length, 0);
    assert.equal(navigation.length, 0);
    assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
    f.page.onUnload();
  }
});

test('an active discount still authorizes a deadline reminder when its deadline preference is enabled', async () => {
  const f = await fixture({ stage: 'in_progress', rewardKind: 'discount', deadlines: true, rewards: false });
  await f.page.reminder();
  assert.equal(f.page.data.reminderReady, true);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  await f.page.reminder();
  assert.equal(consentCalls, 1);
  assert.deepEqual(authorizationRequests(f)[0].payload, { kind: 'deadline', entityId: f.record.id, templateId: f.templates.deadline, accepted: true });
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants'))[0].kind, 'deadline');
  assert.deepEqual(await f.store.get<Participation>('participations', f.record.id), f.record);
});

test('the prepared authorization tap invokes native consent synchronously before any further async request', async () => {
  const f = await fixture();
  await f.page.reminder();
  assert.equal(f.page.data.reminderReady, true);
  assert.equal(consentCalls, 0);
  assert.equal(authorizationRequests(f).length, 0);
  let completeConsent: (() => void) | undefined;
  (globalThis as any).wx.requestSubscribeMessage = ({ tmplIds, success }: { tmplIds: string[]; success: (value: Record<string, string>) => void }) => {
    consentCalls += 1;
    completeConsent = () => success(Object.fromEntries(tmplIds.map(id => [id, 'accept'])));
  };
  const requestStart = f.requests.length;
  const authorizing = f.page.reminder();
  assert.equal(consentCalls, 1, 'Native consent must be invoked in the click stack, before awaiting a promise.');
  assert.equal(f.requests.length, requestStart, 'The authorization tap must not perform another session or preference read before invoking the platform API.');
  assert.equal(f.page.data.busy, true);
  assert.equal(f.page.data.reminderReady, false, 'The prepared authorization is consumed by this one click.');
  await f.page.reminder();
  assert.equal(consentCalls, 1);
  assert.equal(authorizationRequests(f).length, 0);
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
  assert.ok(completeConsent);
  completeConsent();
  await authorizing;
  assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['reminder.authorize']);
  assert.equal(authorizationRequests(f).length, 1);
  assert.deepEqual(authorizationRequests(f)[0].payload, { kind: 'deadline', entityId: f.record.id, templateId: f.templates.deadline, accepted: true });
  assert.equal((await f.store.find<ReminderGrant>('reminder_grants'))[0].remaining, 1);
  assert.equal(f.page.data.busy, false);
  assert.equal(f.page.data.reminderReady, false);
  assert.deepEqual(await f.store.get<Participation>('participations', f.record.id), f.record);
});

for (const invalidation of ['hide', 'reload'] as const) {
  test(`a prepared native authorization is invalidated by ${invalidation} and requires a fresh preference check`, async () => {
    const f = await fixture({ deadlines: true });
    await f.page.reminder();
    assert.equal(f.page.data.reminderReady, true);
    assert.equal(consentCalls, 0);
    await f.store.set('preferences', f.actor.userId, { ...f.preference, deadlines: false });
    if (invalidation === 'hide') {
      f.page.onHide();
      assert.equal(f.page.data.reminderReady, false);
      await f.page.reminder();
      assert.equal(consentCalls, 0, 'An old authorization tap is unavailable while its page is hidden.');
      await f.page.onShow();
    } else await f.page.load();
    assert.equal(f.page.data.reminderReady, false);
    const requestStart = f.requests.length;
    const checking = f.page.reminder();
    assert.equal(consentCalls, 0, 'Invalidated preparation must not invoke native consent synchronously.');
    await checking;
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'preferences.get']);
    assert.equal(modals.length, 1);
    assert.match(modals[0].content, /设置|偏好/);
    assert.deepEqual(navigation, ['/pages/preferences/index']);
    assert.equal(f.page.data.reminderReady, false);
    assert.equal(consentCalls, 0);
    assert.equal(authorizationRequests(f).length, 0);
    assert.equal((await f.store.find<ReminderGrant>('reminder_grants')).length, 0);
    assert.deepEqual(await f.store.get<Participation>('participations', f.record.id), f.record);
  });
}

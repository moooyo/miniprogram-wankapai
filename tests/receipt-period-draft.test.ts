import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiEnvelope, ApiRequest, Card, Commands, MutationResult, Participation, Reward } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api, ensureSession } from '../miniprogram/services/api';
import { createCommandIntent, getDraftRevision, loadDraft, saveDraft } from '../miniprogram/services/form-draft';
import settings from '../miniprogram/runtime-config';

type PageInstance = { data: Record<string, any>; [key: string]: any };
type RecordedRequest = { action: ApiRequest['action']; payload: any; requestId?: string };
type ReceiptTarget = {
  activityId: string; scope: 'user' | 'card'; cardId: string; periodKey: string;
  startsOn: string; endsOn: string; participationId: string; activityRevision?: number;
};
type PendingCreation = { intentKey: string; payload: Commands['reward.confirm']; target?: ReceiptTarget; activity?: Activity };
type ReceiptDraft = {
  amountInput: string; receivedOn: string; intentKey?: string; draftTarget?: ReceiptTarget;
  rewardKind?: Activity['rewardKind']; currency?: Activity['currency'];
  pendingCreation?: PendingCreation;
};
type ReceiptFailure = 'before-commit' | 'after-commit' | null;

const owner: Actor = { userId: 'receipt-period-owner', isModerator: false };
const storage = new Map<string, unknown>();
const originalQuery = api.query;
const originalCommand = api.command;
const originalWx = (globalThis as any).wx;
const originalGetCurrentPages = (globalThis as any).getCurrentPages;
const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId };
let definition: PageInstance;
let navigations: string[] = [];
let modalCalls = 0;
let modalConfirmed = true;
let modalOptions: { title: string; content: string; confirmText: string; cancelText: string }[] = [];

before(async () => {
  const runtime = globalThis as any;
  const originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/receipt/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  storage.clear(); navigations = []; modalCalls = 0; modalConfirmed = true; modalOptions = [];
  settings.mode = 'cloud'; settings.cloudEnvId = 'receipt-period-draft-test';
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).getCurrentPages = () => [];
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showModal: async (options: { title: string; content: string; confirmText: string; cancelText: string }) => {
      modalCalls += 1; modalOptions.push(structuredClone(options));
      return { confirm: modalConfirmed, cancel: !modalConfirmed };
    },
    nextTick: (callback: () => void) => callback(),
    pageScrollTo: () => {}, showToast: () => {}, setNavigationBarTitle: () => {},
    enableAlertBeforeUnload: () => {}, disableAlertBeforeUnload: () => {},
    redirectTo: ({ url }: { url: string }) => { navigations.push(url); },
    navigateBack: () => { navigations.push('back'); },
    switchTab: ({ url }: { url: string }) => { navigations.push(url); },
  };
});

after(() => {
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).wx = originalWx;
  (globalThis as any).getCurrentPages = originalGetCurrentPages;
  settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId;
});

function activity(scope: Activity['scope'] = 'card'): Activity {
  return {
    id: 'receipt-period-activity', revision: 1, status: 'published', title: 'Original monthly benefit',
    bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa credit card',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2027-12-31', target: 3, unit: 'count',
    currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope,
    requiresRegistration: true, requiresInvitation: false, conditions: 'Three purchases', sourceUrl: '', sourceNote: '',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the bank app', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function card(id: string): Card {
  return {
    id, ownerId: owner.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit',
    nickname: id, createdAt: '2026-01-01T00:00:00Z',
  };
}

async function fixture(options: { date?: string; scope?: Activity['scope']; failure?: ReceiptFailure; activity?: Partial<Activity> } = {}) {
  const source = { ...activity(options.scope), ...options.activity };
  const cards = [card('card-a'), card('card-b')];
  const store = new MemoryStore({ activities: { [source.id]: source }, cards: Object.fromEntries(cards.map(row => [row.id, row])) });
  let currentDate = new Date(`${options.date || '2026-09-30'}T04:00:00.000Z`);
  const service = createService(store, { now: () => currentDate, demo: true });
  const requests: RecordedRequest[] = [];
  let receiptFailure: ReceiptFailure = options.failure || null;
  let replayFailure = false;
  let onDispatch: ((request: RecordedRequest) => void | Promise<void>) | undefined;
  let onResponse: ((request: RecordedRequest, result: unknown) => void | Promise<void>) | undefined;
  let sequence = 0;
  (globalThis as any).wx.cloud = {
    init: () => {},
    callFunction: async ({ data }: { data: ApiRequest }): Promise<{ result: ApiEnvelope<unknown> }> => {
      const request = structuredClone(data) as RecordedRequest;
      requests.push(request);
      await onDispatch?.(request);
      const failure = request.action === 'reward.confirm' ? receiptFailure : null;
      if (request.action === 'reward.confirm') receiptFailure = null;
      if (failure === 'before-commit') throw new Error('Receipt request lost before server commit');
      if (request.action === 'request.replay' && replayFailure) throw new Error('Receipt lookup unavailable');
      try {
        const result = await service.execute(owner, request as ApiRequest);
        await onResponse?.(request, result);
        if (failure === 'after-commit') throw new Error('Receipt response lost after server commit');
        return { result: { ok: true, data: result } };
      } catch (error) {
        if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
        throw error;
      }
    },
  };
  await ensureSession(true);
  return {
    source, store, requests,
    setDate: (date: string) => { currentDate = new Date(`${date}T04:00:00.000Z`); },
    setReceiptFailure: (failure: ReceiptFailure) => { receiptFailure = failure; },
    setReplayFailure: (value: boolean) => { replayFailure = value; },
    onDispatch: (handler: (request: RecordedRequest) => void | Promise<void>) => { onDispatch = handler; },
    onResponse: (handler: (request: RecordedRequest, result: unknown) => void | Promise<void>) => { onResponse = handler; },
    command: (payload: Commands['reward.confirm']) => service.execute(owner, {
      action: 'reward.confirm', payload, requestId: `seed-receipt-${++sequence}`,
    }) as Promise<MutationResult>,
  };
}

function page(f: Awaited<ReturnType<typeof fixture>>, options: { cardId?: string; id?: string } = {}) {
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data) };
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => { Object.assign(instance.data, patch); callback?.(); };
  instance.setData({ activityId: f.source.id, cardId: options.cardId ?? 'card-a', participationId: options.id || '' });
  return instance;
}

async function initialize(f: Awaited<ReturnType<typeof fixture>>, options: { cardId?: string; id?: string } = {}) {
  const instance = page(f, options);
  await instance.load();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.loadError, '');
  return instance;
}

function draft(instance: PageInstance, entityId = instance.data.draftEntityId) {
  return loadDraft<ReceiptDraft>('receipt', owner.userId, entityId);
}

function changeAmount(instance: PageInstance, value: string) { return instance.onAmountInput({ detail: { value } }); }
function changeDate(instance: PageInstance, value: string) { return instance.onDateChange({ detail: { value } }); }
function receiptRequests(f: Awaited<ReturnType<typeof fixture>>) { return f.requests.filter(row => row.action === 'reward.confirm'); }
function replayRequests(f: Awaited<ReturnType<typeof fixture>>) { return f.requests.filter(row => row.action === 'request.replay'); }
function revision(instance: PageInstance) { return getDraftRevision('receipt', owner.userId, instance.data.draftEntityId); }

function targetFor(source: Activity, overrides: Partial<ReceiptTarget> = {}): ReceiptTarget {
  return {
    activityId: source.id, scope: source.scope, cardId: 'card-a', periodKey: '2026-09',
    startsOn: '2026-09-01', endsOn: '2026-09-30', participationId: '', activityRevision: source.revision, ...overrides,
  };
}

for (const scenario of [
  { name: 'weekly', date: '2026-09-18', cycle: { t: 'week', weekday: 1 }, key: 'week:2026-09-14', startsOn: '2026-09-14', endsOn: '2026-09-20' },
  { name: 'offset-monthly', date: '2026-09-24', cycle: { t: 'month', day: 21 }, key: 'month:2026-09-21', startsOn: '2026-09-21', endsOn: '2026-10-20' },
  { name: 'custom', date: '2026-09-24', cycle: { t: 'custom', n: 1, unit: 'month', anchor: '2026-09-01' }, key: 'custom:2026-09-01', startsOn: '2026-09-01', endsOn: '2026-09-30' },
] as const) {
  test(`a recovered ${scenario.name} receipt draft retains its exact cycle target and ledger period`, async () => {
    const f = await fixture({ date: scenario.date, activity: { cycle: scenario.cycle } });
    const entityId = `new:${f.source.id}:card-a`;
    const target = targetFor(f.source, { periodKey: scenario.key, startsOn: scenario.startsOn, endsOn: scenario.endsOn });
    const value: ReceiptDraft = { amountInput: '31.75', receivedOn: scenario.date, intentKey: createCommandIntent(), draftTarget: target };
    saveDraft('receipt', owner.userId, entityId, null, value);
    const recovered = await initialize(f);
    try {
      assert.equal(modalCalls, 1);
      assert.equal(recovered.data.amountInput, '31.75');
      assert.equal(recovered.data.receivedOn, scenario.date);
      assert.deepEqual(recovered.data.receiptTarget, target);
      assert.equal(recovered.data.targetReviewRequired, false);
      assert.deepEqual(draft(recovered)?.value.draftTarget, target);
      assert.equal(receiptRequests(f).length, 0);
      await recovered.save();
      assert.equal(receiptRequests(f).length, 1);
      assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, scenario.key);
      const records = await f.store.find<Participation>('participations');
      assert.equal(records.length, 1);
      assert.equal(records[0].periodKey, scenario.key);
      assert.equal(records[0].startsOn, scenario.startsOn);
      assert.equal(records[0].endsOn, scenario.endsOn);
      assert.deepEqual(records[0].snapshot, f.source);
      const rewards = await f.store.find<Reward>('rewards');
      assert.equal(rewards.length, 1);
      assert.equal(rewards[0].activityPeriod, scenario.key);
      assert.equal(rewards[0].amountMinor, 3175);
      assert.equal(rewards[0].receivedOn, scenario.date);
      assert.equal(draft(recovered), null);
    } finally { recovered.onUnload(); }
  });
}

for (const prefix of ['week', 'month', 'custom']) {
  test(`a malformed ${prefix} draft period with February 30 remains private and cannot be recovered into a new target`, async () => {
    const f = await fixture();
    const entityId = `new:${f.source.id}:card-a`;
    saveDraft('receipt', owner.userId, entityId, null, {
      amountInput: '97.00', receivedOn: '2026-09-30', intentKey: createCommandIntent(),
      draftTarget: targetFor(f.source, { periodKey: `${prefix}:2026-02-30` }),
    });
    const original = structuredClone(loadDraft<ReceiptDraft>('receipt', owner.userId, entityId));
    const beforeRecovery = await f.store.exportSeed();
    const recovered = await initialize(f);
    try {
      assert.equal(modalCalls, 0);
      assert.equal(recovered.data.amountInput, '20.00');
      assert.equal(recovered.data.receiptTarget.periodKey, '2026-09');
      assert.deepEqual(draft(recovered, entityId), original);
      assert.equal(receiptRequests(f).length, 0);
      assert.deepEqual(await f.store.exportSeed(), beforeRecovery);
      assert.equal(navigations.length, 0);
    } finally { recovered.onUnload(); }
  });
}

function firstReceipt(source: Activity, receivedOn = '2026-09-30', cardId = 'card-a'): Commands['reward.confirm'] {
  return { activityId: source.id, cardId, amountMinor: 1825, receivedOn, expectNew: true, expectedPeriodKey: '2026-09' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function recordWrites(instance: PageInstance) {
  const writes: Record<string, unknown>[] = [];
  const setData = instance.setData.bind(instance);
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
    writes.push(structuredClone(patch));
    setData(patch, callback);
  };
  return writes;
}

for (const scenario of [
  { name: 'points', changes: { rewardKind: 'points' as const, rewardMinor: 200000 }, isPoints: true, currency: 'CNY' as const },
  { name: 'a foreign currency', changes: { currency: 'HKD' as const }, isPoints: false, currency: 'HKD' as const },
]) {
  test(`a same-period cashback draft changing to ${scenario.name} requires explicit unit review before a new receipt`, async () => {
    const f = await fixture();
    const original = await initialize(f);
    changeAmount(original, '18');
    const entityId = original.data.draftEntityId;
    const saved = structuredClone(draft(original));
    assert.equal(saved?.value.rewardKind, 'cashback');
    assert.equal(saved?.value.currency, 'CNY');
    original.onUnload();
    const revised: Activity = { ...f.source, revision: 2, ...scenario.changes };
    await f.store.set('activities', f.source.id, revised);
    const restored = await initialize(f);
    try {
      assert.equal(restored.data.amountInput, '18');
      assert.equal(restored.data.receivedOn, '2026-09-30');
      assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
      assert.equal(restored.data.unitReviewRequired, true);
      assert.equal(restored.data.targetReviewRequired, true);
      assert.equal(restored.data.inputRewardKind, 'cashback');
      assert.equal(restored.data.inputCurrency, 'CNY');
      assert.deepEqual(draft(restored, entityId)?.value, saved?.value);
      await restored.save();
      assert.equal(receiptRequests(f).length, 0);
      assert.equal((await f.store.find('participations')).length, 0);
      assert.equal((await f.store.find('rewards')).length, 0);
      assert.equal(navigations.length, 0);

      await restored.confirmDraftTarget();
      assert.equal(restored.data.unitReviewRequired, false);
      assert.equal(restored.data.targetReviewRequired, false);
      assert.equal(restored.data.amountInput, '18');
      assert.equal(restored.data.receivedOn, '2026-09-30');
      assert.equal(restored.data.isPoints, scenario.isPoints);
      assert.equal(restored.data.inputRewardKind, revised.rewardKind);
      assert.equal(restored.data.inputCurrency, scenario.currency);
      assert.equal(draft(restored)?.value.rewardKind, revised.rewardKind);
      assert.equal(draft(restored)?.value.currency, scenario.currency);
      await restored.save();
      assert.equal(receiptRequests(f).length, 1);
      assert.equal(receiptRequests(f)[0].payload.amountMinor, 1800);
      assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, '2026-09');
      const records = await f.store.find<Participation>('participations');
      assert.equal(records.length, 1);
      assert.deepEqual(records[0].snapshot, revised);
      assert.equal(records[0].receivedMinor, 1800);
      const rewards = await f.store.find<Reward>('rewards');
      assert.equal(rewards.length, 1);
      assert.equal(rewards[0].currency, scenario.currency);
      assert.equal(rewards[0].amountMinor, 1800);
      assert.equal(rewards[0].receivedOn, '2026-09-30');
      assert.equal(draft(restored, entityId), null);
    } finally { restored.onUnload(); }
  });
}

function controlledLocalClock(instant: string) {
  const originalNow = Date.now;
  let current = Date.parse(instant);
  Date.now = () => current;
  return {
    set: (value: string) => { current = Date.parse(value); },
    restore: () => { Date.now = originalNow; },
  };
}

test('a known receipt save freezes its original fields, back action, and duplicate submission throughout the date preflight', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const instance = await initialize(f, { id: original.id });
  instance.scheduleDateRefresh = () => {};
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let held = false;
  f.onResponse(async request => {
    if (request.action === 'session.get' && !held) { held = true; responseReady.resolve(); await release.promise; }
  });
  try {
    changeAmount(instance, '18.00');
    changeDate(instance, '2026-09-29');
    const submittedDraft = structuredClone(draft(instance));
    const requestStart = f.requests.length;
    const saving = instance.save();
    await responseReady.promise;
    assert.equal(instance.data.dateRefreshing, true);
    assert.equal(instance.data.busy, true, 'The save owns the form before awaiting the server date.');
    assert.equal(receiptRequests(f).length, 0);
    changeAmount(instance, '23.00');
    changeDate(instance, '2026-09-30');
    instance.back();
    await instance.save();
    assert.equal(instance.data.amountInput, '18.00');
    assert.equal(instance.data.receivedOn, '2026-09-29');
    assert.deepEqual(draft(instance), submittedDraft, 'Blocked input must not alter the submitted draft revision.');
    assert.equal(navigations.length, 0);
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get']);
    release.resolve();
    await saving;
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get', 'reward.confirm']);
    assert.deepEqual(receiptRequests(f)[0].payload, { participationId: original.id, amountMinor: 1800,
      receivedOn: '2026-09-29', expectedVersion: original.version });
    const updated = (await f.store.get<Participation>('participations', original.id))!;
    assert.equal(updated.receivedMinor, 1800);
    assert.equal(updated.receivedOn, '2026-09-29');
    assert.equal(updated.version, original.version + 1);
    assert.equal(updated.periodKey, original.periodKey);
    assert.deepEqual(updated.snapshot, original.snapshot);
    const ledger = await f.store.find<Reward>('rewards');
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].amountMinor, 1800);
    assert.equal(ledger[0].activityPeriod, original.periodKey);
    assert.equal(instance.data.busy, false);
    assert.equal(instance.data.dateRefreshing, false);
    assert.equal(draft(instance), null);
    assert.equal(navigations.length, 1);
  } finally { release.resolve(); instance.onUnload(); }
});

test('an ordinary foreground date refresh keeps amount editing available without submitting a receipt', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const instance = await initialize(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let held = false;
  f.onResponse(async request => {
    if (request.action === 'session.get' && !held) { held = true; responseReady.resolve(); await release.promise; }
  });
  try {
    changeAmount(instance, '18.00');
    const beforeRefresh = await f.store.exportSeed();
    instance.onHide();
    const requestStart = f.requests.length;
    const showing = instance.onShow();
    await responseReady.promise;
    assert.equal(instance.data.dateRefreshing, true);
    assert.equal(instance.data.busy, false, 'Background date synchronization is distinct from an explicit save.');
    changeAmount(instance, '23.00');
    assert.equal(instance.data.amountInput, '23.00');
    assert.equal(draft(instance)?.value.amountInput, '23.00');
    const editedDraft = structuredClone(draft(instance));
    assert.equal(receiptRequests(f).length, 0);
    release.resolve();
    await showing;
    assert.equal(instance.data.amountInput, '23.00');
    assert.deepEqual(draft(instance), editedDraft);
    assert.equal(instance.data.busy, false);
    assert.equal(instance.data.dateRefreshing, false);
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get']);
    assert.deepEqual(await f.store.exportSeed(), beforeRefresh);
    assert.equal(navigations.length, 0);
  } finally { release.resolve(); instance.onUnload(); }
});

test('a failed known-receipt save preflight releases the form without a write and permits an edited retry', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const instance = await initialize(f, { id: original.id });
  instance.scheduleDateRefresh = () => {};
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let fail = true;
  f.onResponse(async request => {
    if (request.action === 'session.get' && fail) {
      fail = false;
      responseReady.resolve();
      await release.promise;
      throw new Error('Date response unavailable before receipt submission');
    }
  });
  try {
    changeAmount(instance, '18.00');
    const beforeSave = await f.store.exportSeed();
    const originalDraft = structuredClone(draft(instance));
    const saving = instance.save();
    await responseReady.promise;
    assert.equal(instance.data.busy, true);
    changeAmount(instance, '23.00');
    assert.equal(instance.data.amountInput, '18.00');
    release.resolve();
    await saving;
    assert.equal(receiptRequests(f).length, 0);
    assert.equal(instance.data.busy, false);
    assert.equal(instance.data.dateRefreshing, false);
    assert.ok(instance.data.dateRefreshError);
    assert.deepEqual(draft(instance), originalDraft);
    assert.deepEqual(await f.store.exportSeed(), beforeSave);
    assert.equal(navigations.length, 0);
    changeAmount(instance, '23.00');
    assert.equal(instance.data.amountInput, '23.00');
    assert.equal(draft(instance)?.value.amountInput, '23.00');
    await instance.save();
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(receiptRequests(f)[0].payload.amountMinor, 2300);
    assert.equal(receiptRequests(f)[0].payload.expectedVersion, original.version);
    assert.equal(instance.data.dateRefreshError, '');
    assert.equal(instance.data.busy, false);
    assert.equal(draft(instance), null);
    assert.equal(navigations.length, 1);
  } finally { release.resolve(); instance.onUnload(); }
});

for (const lifecycle of ['onHide', 'onUnload']) {
  test(`a known receipt save interrupted by ${lifecycle} during its date preflight sends no mutation`, async () => {
    const f = await fixture();
    const created = await f.command(firstReceipt(f.source));
    const original = (await f.store.get<Participation>('participations', created.id))!;
    const instance = await initialize(f, { id: original.id });
    instance.scheduleDateRefresh = () => {};
    const responseReady = deferred<void>();
    const release = deferred<void>();
    let held = false;
    f.onResponse(async request => {
      if (request.action === 'session.get' && !held) { held = true; responseReady.resolve(); await release.promise; }
    });
    try {
      changeAmount(instance, '18.00');
      const originalDraft = structuredClone(draft(instance));
      const beforeSave = await f.store.exportSeed();
      const saving = instance.save();
      await responseReady.promise;
      assert.equal(instance.data.busy, true);
      instance[lifecycle]();
      const writes = recordWrites(instance);
      release.resolve();
      await saving;
      assert.equal(receiptRequests(f).length, 0);
      assert.equal(replayRequests(f).length, 0);
      assert.deepEqual(await f.store.exportSeed(), beforeSave);
      assert.deepEqual(draft(instance), originalDraft);
      assert.equal(navigations.length, 0);
      if (lifecycle === 'onUnload') assert.deepEqual(writes, [], 'A disposed page must not be written by its abandoned save continuation.');
      else {
        assert.equal(instance.data.busy, false);
        await instance.onShow();
        assert.equal(instance.data.busy, false);
        changeAmount(instance, '23.00');
        assert.equal(instance.data.amountInput, '23.00');
        await instance.save();
        assert.equal(receiptRequests(f).length, 1);
        assert.equal(receiptRequests(f)[0].payload.amountMinor, 2300);
        assert.equal(receiptRequests(f)[0].payload.expectedVersion, original.version);
        assert.equal(draft(instance), null);
      }
    } finally { release.resolve(); instance.onUnload(); }
  });
}

test('an old save preflight cannot resume through a newer foreground date generation', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const instance = await initialize(f, { id: original.id });
  instance.scheduleDateRefresh = () => {};
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let held = false;
  f.onResponse(async request => {
    if (request.action === 'session.get' && !held) { held = true; responseReady.resolve(); await release.promise; }
  });
  try {
    changeAmount(instance, '18.00');
    const beforeSave = await f.store.exportSeed();
    const saving = instance.save();
    await responseReady.promise;
    assert.equal(instance.data.busy, true);
    instance.onHide();
    f.setDate('2026-10-01');
    await instance.onShow();
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.busy, false, 'A canceled preflight must not leave a returned form locked behind the old network response.');
    changeAmount(instance, '23.00');
    changeDate(instance, '2026-10-01');
    const newerDraft = structuredClone(draft(instance));
    const writes = recordWrites(instance);
    release.resolve();
    await saving;
    assert.equal(receiptRequests(f).length, 0, 'The old save must not adopt the newly visible page or its current date range.');
    assert.equal(replayRequests(f).length, 0);
    assert.equal(instance.data.busy, false);
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.amountInput, '23.00');
    assert.equal(instance.data.receivedOn, '2026-10-01');
    assert.deepEqual(draft(instance), newerDraft);
    assert.deepEqual(await f.store.exportSeed(), beforeSave);
    assert.ok(writes.every(patch => patch.busy !== true), 'The abandoned continuation must not reacquire saving ownership.');
    assert.equal(navigations.length, 0);
    await instance.save();
    assert.equal(receiptRequests(f).length, 1);
    assert.deepEqual(receiptRequests(f)[0].payload, { participationId: original.id, amountMinor: 2300,
      receivedOn: '2026-10-01', expectedVersion: original.version });
    const updated = (await f.store.get<Participation>('participations', original.id))!;
    assert.equal(updated.periodKey, original.periodKey);
    assert.deepEqual(updated.snapshot, original.snapshot);
  } finally { release.resolve(); instance.onUnload(); }
});

for (const scenario of [
  { name: 'activity loading before draft recovery', delayedAction: 'activity.get', recover: true },
  { name: 'the original session response', delayedAction: 'session.get', recover: false },
] as const) {
  test(`a visible known receipt loading across midnight during ${scenario.name} performs one date-only follow-up`, async () => {
    const clock = controlledLocalClock('2026-09-30T15:59:59.000Z');
    const responseReady = deferred<void>();
    const release = deferred<void>();
    let instance: PageInstance | undefined;
    try {
      const f = await fixture({ date: '2026-09-30' });
      const created = await f.command(firstReceipt(f.source));
      const original = (await f.store.get<Participation>('participations', created.id))!;
      if (scenario.recover) saveDraft('receipt', owner.userId, original.id, original.version, { amountInput: '67.50', receivedOn: '2026-09-29' });
      instance = page(f, { id: created.id });
      instance.scheduleDateRefresh = () => {};
      let blocked = false;
      let sessionReads = 0;
      let draftBeforeFollowUp: ReturnType<typeof draft> | undefined;
      let recordBeforeFollowUp: unknown;
      f.onDispatch(request => {
        if (request.action === 'session.get' && ++sessionReads === 2) {
          draftBeforeFollowUp = structuredClone(draft(instance!));
          recordBeforeFollowUp = instance!.data.participation;
        }
      });
      f.onResponse(async request => {
        if (request.action === scenario.delayedAction && !blocked) { blocked = true; responseReady.resolve(); await release.promise; }
      });
      const requestStart = f.requests.length;
      const loading = instance.load();
      await responseReady.promise;
      await instance.onShow();
      assert.equal(instance.hasShown, true);
      clock.set('2026-09-30T16:00:01.000Z');
      f.setDate('2026-10-01');
      release.resolve();
      await loading;
      if (instance.dateRefreshTask) await instance.dateRefreshTask;
      const calls = f.requests.slice(requestStart);
      assert.equal(calls.filter(request => request.action === 'session.get').length, 2, 'Initial loading may finish with one fresh date read after crossing the local date boundary.');
      assert.equal(calls.filter(request => request.action === 'activity.get').length, 1, 'The follow-up must not reload the record or recompute its target.');
      assert.equal(instance.data.maxDate, '2026-10-01');
      assert.equal(instance.data.serverToday, '2026-10-01');
      assert.equal(instance.data.minDate, original.startsOn);
      assert.equal(instance.data.participation, recordBeforeFollowUp);
      assert.deepEqual(instance.data.participation, original);
      assert.deepEqual(instance.data.participation.snapshot, original.snapshot);
      assert.equal(instance.data.receiptTarget.participationId, original.id);
      assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
      assert.equal(instance.data.currentTarget.periodKey, '2026-09');
      assert.equal(instance.data.amountInput, scenario.recover ? '67.50' : '18.25');
      assert.equal(instance.data.receivedOn, scenario.recover ? '2026-09-29' : '2026-09-30');
      assert.deepEqual(draft(instance), draftBeforeFollowUp, 'Date freshness must preserve the draft revision produced by initial recovery.');
      assert.equal(modalCalls, scenario.recover ? 1 : 0);
      assert.equal(receiptRequests(f).length, 0);
      assert.equal(replayRequests(f).length, 0);
    } finally { release.resolve(); instance?.onUnload(); clock.restore(); }
  });
}

test('an activity response delayed within the same local date does not add another session read', async () => {
  const clock = controlledLocalClock('2026-09-30T04:00:00.000Z');
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let instance: PageInstance | undefined;
  try {
    const f = await fixture({ date: '2026-09-30' });
    const created = await f.command(firstReceipt(f.source));
    instance = page(f, { id: created.id });
    instance.scheduleDateRefresh = () => {};
    f.onResponse(async request => { if (request.action === 'activity.get') { responseReady.resolve(); await release.promise; } });
    const requestStart = f.requests.length;
    const loading = instance.load();
    await responseReady.promise;
    await instance.onShow();
    clock.set('2026-09-30T05:00:00.000Z');
    release.resolve();
    await loading;
    if (instance.dateRefreshTask) await instance.dateRefreshTask;
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 1);
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'activity.get').length, 1);
    assert.equal(instance.data.maxDate, '2026-09-30');
    assert.equal(instance.data.receivedOn, '2026-09-30');
    assert.equal(instance.data.amountInput, '18.25');
    assert.equal(draft(instance), null);
    assert.equal(receiptRequests(f).length, 0);
  } finally { release.resolve(); instance?.onUnload(); clock.restore(); }
});

test('a midnight-crossing load that finishes while hidden waits for resume before refreshing its date', async () => {
  const clock = controlledLocalClock('2026-09-30T15:59:59.000Z');
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let instance: PageInstance | undefined;
  try {
    const f = await fixture({ date: '2026-09-30' });
    const created = await f.command(firstReceipt(f.source));
    instance = page(f, { id: created.id });
    instance.scheduleDateRefresh = () => {};
    f.onResponse(async request => { if (request.action === 'activity.get') { responseReady.resolve(); await release.promise; } });
    const requestStart = f.requests.length;
    const loading = instance.load();
    await responseReady.promise;
    await instance.onShow();
    instance.onHide();
    clock.set('2026-09-30T16:00:01.000Z');
    f.setDate('2026-10-01');
    release.resolve();
    await loading;
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 1, 'A hidden page must not dispatch a date refresh after its load settles.');
    assert.equal(instance.data.maxDate, '2026-09-30');
    const recordReference = instance.data.participation;
    const targetReference = instance.data.receiptTarget;
    await instance.onShow();
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 2);
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'activity.get').length, 1);
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.participation, recordReference);
    assert.equal(instance.data.receiptTarget, targetReference);
    assert.equal(instance.data.receivedOn, '2026-09-30');
    assert.equal(draft(instance), null);
  } finally { release.resolve(); instance?.onUnload(); clock.restore(); }
});

test('a current October record returned after a September session becomes editable after the date-only follow-up', async () => {
  const clock = controlledLocalClock('2026-09-30T15:59:59.000Z');
  const activityStarted = deferred<void>();
  const releaseActivity = deferred<void>();
  let instance: PageInstance | undefined;
  try {
    const f = await fixture({ date: '2026-09-30' });
    instance = page(f);
    instance.scheduleDateRefresh = () => {};
    let sessions = 0;
    let allowedBeforeFollowUp: boolean | undefined;
    let recordBeforeFollowUp: unknown;
    let targetBeforeFollowUp: unknown;
    f.onDispatch(async request => {
      if (request.action === 'activity.get') { activityStarted.resolve(); await releaseActivity.promise; }
      if (request.action === 'session.get' && ++sessions === 2) {
        allowedBeforeFollowUp = instance!.data.allowed;
        recordBeforeFollowUp = instance!.data.participation;
        targetBeforeFollowUp = instance!.data.currentTarget;
      }
    });
    const requestStart = f.requests.length;
    const loading = instance.load();
    await activityStarted.promise;
    await instance.onShow();
    clock.set('2026-09-30T16:00:01.000Z');
    f.setDate('2026-10-01');
    const created = await f.command({ activityId: f.source.id, cardId: 'card-a', amountMinor: 1825,
      receivedOn: '2026-10-01', expectNew: true, expectedPeriodKey: '2026-10' });
    const october = (await f.store.get<Participation>('participations', created.id))!;
    releaseActivity.resolve();
    await loading;
    if (instance.dateRefreshTask) await instance.dateRefreshTask;
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 2);
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'activity.get').length, 1);
    assert.equal(allowedBeforeFollowUp, false, 'The detail response initially sees the earlier September session date.');
    assert.equal(instance.data.allowed, true, 'The date-only follow-up must release the stale future-period gate.');
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.minDate, '2026-10-01');
    assert.equal(instance.data.participation, recordBeforeFollowUp);
    assert.equal(instance.data.currentTarget, targetBeforeFollowUp);
    assert.deepEqual(instance.data.participation, october);
    assert.deepEqual(instance.data.participation.snapshot, october.snapshot);
    assert.equal(instance.data.receiptTarget.participationId, october.id);
    assert.equal(instance.data.receiptTarget.periodKey, '2026-10');
    assert.equal(instance.data.receivedOn, '2026-10-01');
    assert.equal(receiptRequests(f).length, 0);
    changeAmount(instance, '93.75');
    await instance.save();
    assert.equal(receiptRequests(f).length, 1);
    assert.deepEqual(receiptRequests(f)[0].payload, { participationId: october.id, expectedVersion: october.version,
      amountMinor: 9375, receivedOn: '2026-10-01' });
    const updated = (await f.store.get<Participation>('participations', october.id))!;
    assert.equal(updated.periodKey, '2026-10');
    assert.deepEqual(updated.snapshot, october.snapshot);
  } finally { releaseActivity.resolve(); instance?.onUnload(); clock.restore(); }
});

test('a midnight date follow-up for a new receipt leaves its September target for explicit October confirmation', async () => {
  const clock = controlledLocalClock('2026-09-30T15:59:59.000Z');
  const activityReady = deferred<void>();
  const releaseActivity = deferred<void>();
  let instance: PageInstance | undefined;
  try {
    const f = await fixture({ date: '2026-09-30' });
    instance = page(f);
    instance.scheduleDateRefresh = () => {};
    let blocked = false;
    f.onResponse(async request => {
      if (request.action === 'activity.get' && !blocked) { blocked = true; activityReady.resolve(); await releaseActivity.promise; }
    });
    const requestStart = f.requests.length;
    const loading = instance.load();
    await activityReady.promise;
    await instance.onShow();
    clock.set('2026-09-30T16:00:01.000Z');
    f.setDate('2026-10-01');
    releaseActivity.resolve();
    await loading;
    if (instance.dateRefreshTask) await instance.dateRefreshTask;
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 2);
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.minDate, '2026-09-01');
    assert.equal(instance.data.currentTarget.periodKey, '2026-09');
    assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
    assert.equal(instance.data.receivedOn, '2026-09-30');
    assert.equal(instance.data.amountInput, '20.00');
    assert.equal(instance.data.participation, null);
    assert.equal(receiptRequests(f).length, 0);
    assert.equal(draft(instance), null);
    await instance.save();
    assert.equal(instance.data.targetReviewRequired, true);
    assert.equal(instance.data.pendingCreation, null);
    assert.equal(instance.data.currentTarget.periodKey, '2026-10');
    assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
    assert.equal(instance.data.receivedOn, '2026-09-30');
    assert.equal(receiptRequests(f).length, 0);
    assert.equal(replayRequests(f).length, 0);
    instance.confirmDraftTarget();
    changeDate(instance, '2026-10-01');
    await instance.save();
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, '2026-10');
    assert.equal(receiptRequests(f)[0].payload.receivedOn, '2026-10-01');
    assert.equal((await f.store.find<Reward>('rewards'))[0].activityPeriod, '2026-10');
    assert.equal(draft(instance), null);
  } finally { releaseActivity.resolve(); instance?.onUnload(); clock.restore(); }
});

test('returning to a known September receipt refreshes only its date limit and preserves unsaved input and snapshot identity', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const instance = await initialize(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  try {
    await instance.onShow();
    changeAmount(instance, '31.75');
    changeDate(instance, '2026-09-29');
    const storedDraft = structuredClone(draft(instance));
    const recordReference = instance.data.participation;
    const targetReference = instance.data.receiptTarget;
    const snapshot = structuredClone(instance.data.participation.snapshot);
    instance.onHide();
    f.setDate('2026-10-01');
    await f.store.set('activities', f.source.id, { ...f.source, revision: 2, title: 'New October rules', rewardMinor: 9100 });
    const requestStart = f.requests.length;
    await instance.onShow();
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get'], 'Foreground refresh must not reload the activity or replace the form context.');
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.serverToday, '2026-10-01');
    assert.equal(instance.data.minDate, '2026-09-01');
    assert.equal(instance.data.amountInput, '31.75');
    assert.equal(instance.data.receivedOn, '2026-09-29');
    assert.equal(instance.data.participation, recordReference);
    assert.equal(instance.data.receiptTarget, targetReference);
    assert.deepEqual(instance.data.participation.snapshot, snapshot);
    assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
    assert.deepEqual(draft(instance), storedDraft);
    changeDate(instance, '2026-10-01');
    await instance.save();
    const sent = receiptRequests(f);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { participationId: original.id, expectedVersion: original.version, amountMinor: 3175, receivedOn: '2026-10-01' });
    const updated = (await f.store.get<Participation>('participations', original.id))!;
    assert.equal(updated.periodKey, '2026-09');
    assert.deepEqual(updated.snapshot, original.snapshot);
    assert.equal(updated.receivedOn, '2026-10-01');
    assert.equal((await f.store.find<Reward>('rewards'))[0].activityPeriod, '2026-09');
    assert.equal(draft(instance), null);
  } finally { instance.onUnload(); }
});

test('saving a known receipt continuously visible across midnight refreshes the server date before validating the selected date', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const instance = await initialize(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  try {
    await instance.onShow();
    changeAmount(instance, '54.25');
    f.setDate('2026-10-01');
    assert.equal(instance.data.maxDate, '2026-09-30');
    changeDate(instance, '2026-10-01');
    const requestStart = f.requests.length;
    await instance.save();
    const calls = f.requests.slice(requestStart);
    assert.equal(calls[0].action, 'session.get');
    assert.equal(calls.filter(request => request.action === 'reward.confirm').length, 1);
    assert.equal(calls.filter(request => request.action === 'activity.get').length, 0);
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.dateError, '');
    assert.deepEqual(receiptRequests(f)[0].payload, { participationId: original.id, expectedVersion: original.version, amountMinor: 5425, receivedOn: '2026-10-01' });
    const updated = (await f.store.get<Participation>('participations', original.id))!;
    assert.equal(updated.periodKey, original.periodKey);
    assert.deepEqual(updated.snapshot, original.snapshot);
    assert.equal(updated.receivedOn, '2026-10-01');
    assert.equal((await f.store.find<Reward>('rewards')).length, 1);
  } finally { instance.onUnload(); }
});

for (const lifecycle of ['onHide', 'onUnload']) {
  test(`an onShow date response arriving after ${lifecycle} cannot write page state or rewrite the draft`, async () => {
    const f = await fixture();
    const created = await f.command(firstReceipt(f.source));
    const instance = await initialize(f, { id: created.id });
    instance.scheduleDateRefresh = () => {};
    instance.onHide();
    const responseReady = deferred<void>();
    const release = deferred<void>();
    let delayed = false;
    f.onResponse(async request => {
      if (request.action === 'session.get' && !delayed) { delayed = true; responseReady.resolve(); await release.promise; }
    });
    try {
      changeAmount(instance, '37.25');
      const saved = structuredClone(draft(instance));
      const writes = recordWrites(instance);
      f.setDate('2026-10-01');
      const showing = instance.onShow();
      await responseReady.promise;
      instance[lifecycle]();
      const countAfterExit = writes.length;
      release.resolve();
      await showing;
      assert.equal(writes.length, countAfterExit, 'An obsolete session response and its finalizer must perform no page writes.');
      assert.equal(instance.data.maxDate, '2026-09-30');
      assert.equal(instance.data.receivedOn, '2026-09-30');
      assert.equal(instance.data.amountInput, '37.25');
      assert.deepEqual(draft(instance), saved);
      assert.equal(receiptRequests(f).length, 0);
    } finally { release.resolve(); instance.onUnload(); }
  });
}

test('a late previous onShow date cannot overwrite the date from a newer foreground generation', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const instance = await initialize(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  instance.onHide();
  const responseReady = deferred<void>();
  const release = deferred<void>();
  let responses = 0;
  f.onResponse(async request => {
    if (request.action === 'session.get' && ++responses === 1) { responseReady.resolve(); await release.promise; }
  });
  try {
    changeAmount(instance, '29.50');
    const saved = structuredClone(draft(instance));
    const writes = recordWrites(instance);
    f.setDate('2026-10-01');
    const firstShow = instance.onShow();
    await responseReady.promise;
    instance.onHide();
    f.setDate('2026-10-02');
    await instance.onShow();
    assert.equal(instance.data.maxDate, '2026-10-02');
    const freshWriteCount = writes.length;
    release.resolve();
    await firstShow;
    assert.equal(instance.data.maxDate, '2026-10-02');
    assert.equal(instance.data.serverToday, '2026-10-02');
    assert.equal(instance.data.dateRefreshing, false);
    assert.equal(writes.length, freshWriteCount);
    assert.deepEqual(draft(instance), saved);
    assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
    assert.equal(receiptRequests(f).length, 0);
  } finally { release.resolve(); instance.onUnload(); }
});

test('onShow during initial receipt loading does not duplicate session reads or overwrite the recovered draft', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  saveDraft('receipt', owner.userId, original.id, original.version, { amountInput: '45.50', receivedOn: '2026-09-29' });
  const instance = page(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  const requestStarted = deferred<void>();
  const release = deferred<void>();
  let delayed = false;
  f.onDispatch(async request => {
    if (request.action === 'session.get' && !delayed) { delayed = true; requestStarted.resolve(); await release.promise; }
  });
  const requestStart = f.requests.length;
  try {
    const loading = instance.load();
    await requestStarted.promise;
    const showing = instance.onShow();
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 1);
    release.resolve();
    await Promise.all([loading, showing]);
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'session.get').length, 1);
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'activity.get').length, 1);
    assert.equal(modalCalls, 1);
    assert.equal(instance.data.amountInput, '45.50');
    assert.equal(instance.data.receivedOn, '2026-09-29');
    assert.equal(instance.data.participation.id, original.id);
    assert.equal(instance.data.receiptTarget.participationId, original.id);
    assert.equal(draft(instance)?.value.amountInput, '45.50');
    assert.equal(draft(instance)?.value.receivedOn, '2026-09-29');
    assert.equal(receiptRequests(f).length, 0);
  } finally { release.resolve(); instance.onUnload(); }
});

test('the first onShow after a fast initial load reuses its date without an additional session read', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const instance = await initialize(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  try {
    changeAmount(instance, '22.75');
    const saved = structuredClone(draft(instance));
    const requestStart = f.requests.length;
    await instance.onShow();
    assert.equal(f.requests.length, requestStart);
    assert.equal(instance.data.maxDate, '2026-09-30');
    assert.equal(instance.data.amountInput, '22.75');
    assert.deepEqual(draft(instance), saved);
  } finally { instance.onUnload(); }
});

test('date-only refresh failures retain input and offer an in-place retry without reloading the record', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const instance = await initialize(f, { id: created.id });
  instance.scheduleDateRefresh = () => {};
  instance.onHide();
  try {
    changeAmount(instance, '62.75');
    const saved = structuredClone(draft(instance));
    const recordReference = instance.data.participation;
    f.setDate('2026-10-01');
    f.onDispatch(request => { if (request.action === 'session.get') throw new Error('Date service unavailable'); });
    const requestStart = f.requests.length;
    await instance.onShow();
    assert.equal(instance.data.dateRefreshing, false);
    assert.ok(instance.data.dateRefreshError);
    assert.equal(instance.data.maxDate, '2026-09-30');
    assert.equal(instance.data.amountInput, '62.75');
    assert.equal(instance.data.participation, recordReference);
    assert.deepEqual(draft(instance), saved);
    assert.equal(instance.data.loadError, '', 'Date synchronization failures must remain an inline recoverable state.');
    await instance.save();
    assert.equal(receiptRequests(f).length, 0, 'Saving must not use the stale date ceiling while its server refresh is failing.');
    assert.ok(instance.data.dateRefreshError);
    assert.deepEqual(draft(instance), saved);
    f.onDispatch(() => {});
    await instance.refreshDateRange();
    assert.equal(instance.data.dateRefreshError, '');
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.participation, recordReference);
    assert.equal(f.requests.slice(requestStart).filter(request => request.action === 'activity.get').length, 0);
    assert.deepEqual(draft(instance), saved);
  } finally { instance.onUnload(); }
});

test('the visible midnight timer refreshes only the date and its canceled callback cannot run after hiding', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const instance = await initialize(f, { id: created.id });
  changeAmount(instance, '47.50');
  const saved = structuredClone(draft(instance));
  const recordReference = instance.data.participation;
  const timers: { id: number; callback: () => void; delay: number }[] = [];
  const cleared: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    const timer = { id: timers.length + 1, callback, delay };
    timers.push(timer);
    return timer.id;
  };
  (globalThis as any).clearTimeout = (id: number) => { cleared.push(id); };
  try {
    instance.visible = true;
    instance.hidden = false;
    instance.scheduleDateRefresh();
    assert.equal(timers.length, 1);
    assert.ok(timers[0].delay >= 1000 && timers[0].delay <= 24 * 60 * 60 * 1000 + 1000);
    const requestStart = f.requests.length;
    f.setDate('2026-10-01');
    timers[0].callback();
    const refresh = instance.dateRefreshTask as Promise<boolean> | null;
    assert.ok(refresh);
    await refresh;
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get']);
    assert.equal(instance.data.maxDate, '2026-10-01');
    assert.equal(instance.data.minDate, '2026-09-01');
    assert.equal(instance.data.amountInput, '47.50');
    assert.equal(instance.data.receivedOn, '2026-09-30');
    assert.equal(instance.data.participation, recordReference);
    assert.deepEqual(draft(instance), saved);
    assert.equal(timers.length, 2, 'A successful visible refresh schedules only the next date boundary.');
    instance.onHide();
    assert.ok(cleared.includes(timers[1].id));
    assert.equal(instance.dateTimer, undefined);
    const queriesAfterHide = f.requests.length;
    const writes = recordWrites(instance);
    timers[1].callback();
    assert.equal(f.requests.length, queriesAfterHide);
    assert.deepEqual(writes, []);
    await instance.onShow();
    const resumedTimer = instance.dateTimer;
    assert.notEqual(resumedTimer, undefined);
    assert.notEqual(resumedTimer, timers[1].id);
    const queriesAfterResume = f.requests.length;
    const writesAfterResume = writes.length;
    timers[1].callback();
    assert.equal(f.requests.length, queriesAfterResume, 'A canceled callback must not revive after a later foreground generation.');
    assert.equal(writes.length, writesAfterResume);
    assert.equal(instance.dateTimer, resumedTimer, 'The canceled callback must not erase the currently scheduled timer.');
  } finally {
    instance.onUnload();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('onShow date synchronization cannot rewrite a recovered pending receipt target, payload, or draft revision', async () => {
  const f = await fixture({ failure: 'after-commit' });
  const original = await initialize(f);
  changeAmount(original, '71.25');
  await original.save();
  original.onUnload();
  const restored = await initialize(f);
  restored.scheduleDateRefresh = () => {};
  try {
    const pending = structuredClone(restored.data.pendingCreation);
    const saved = structuredClone(draft(restored));
    const targetReference = restored.data.receiptTarget;
    const recordReference = restored.data.participation;
    restored.onHide();
    f.setDate('2026-10-01');
    const requestStart = f.requests.length;
    await restored.onShow();
    assert.deepEqual(f.requests.slice(requestStart).map(request => request.action), ['session.get']);
    assert.equal(restored.data.maxDate, '2026-10-01');
    assert.equal(restored.data.pendingReplayOnly, true);
    assert.deepEqual(restored.data.pendingCreation, pending);
    assert.equal(restored.data.receiptTarget, targetReference);
    assert.equal(restored.data.participation, recordReference);
    assert.equal(restored.data.amountInput, '71.25');
    assert.equal(restored.data.receivedOn, '2026-09-30');
    assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
    assert.deepEqual(draft(restored), saved);
    const beforeLookup = await f.store.exportSeed();
    await restored.resolvePendingCreation();
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(replayRequests(f).length, 1);
    assert.deepEqual(replayRequests(f)[0].payload.payload, pending.payload);
    assert.deepEqual(await f.store.exportSeed(), beforeLookup);
  } finally { restored.onUnload(); }
});

for (const scope of ['card', 'user'] as const) {
  test(`an ordinary same-period ${scope}-scope creation draft is recoverable after joining and opening the explicit participation`, async () => {
    const f = await fixture({ scope });
    const original = await initialize(f, { cardId: 'card-a' });
    changeAmount(original, '43.75');
    changeDate(original, '2026-09-29');
    const creationEntityId = original.data.draftEntityId;
    const saved = structuredClone(draft(original));
    assert.equal(saved?.value.draftTarget?.participationId, '');
    assert.equal(saved?.value.draftTarget?.periodKey, '2026-09');
    assert.equal(saved?.value.pendingCreation, undefined);
    assert.equal(receiptRequests(f).length, 0);
    original.onUnload();
    const joinedCard = scope === 'user' ? 'card-b' : 'card-a';
    const joined = await api.command('activity.join', { activityId: f.source.id, cardId: joinedCard });
    const beforeRestore = await f.store.exportSeed();
    const participation = (await f.store.get<Participation>('participations', joined.id))!;
    assert.equal(participation.periodKey, '2026-09');

    const restored = await initialize(f, { cardId: scope === 'card' ? '' : joinedCard, id: joined.id });
    assert.equal(modalCalls, 1, 'A proven same-scope and same-period draft must remain discoverable after joining.');
    assert.equal(modalOptions[0].confirmText, '恢复草稿');
    assert.match(modalOptions[0].content, /2026.*9/);
    assert.equal(restored.data.amountInput, '43.75');
    assert.equal(restored.data.receivedOn, '2026-09-29');
    assert.equal(restored.data.participation.id, joined.id);
    assert.equal(restored.data.receiptTarget.participationId, joined.id);
    assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
    assert.equal(restored.data.targetReviewRequired, false);
    assert.equal(restored.data.reapplyRequired, true);
    assert.equal(restored.data.pendingCreation, null);
    assert.equal(receiptRequests(f).length, 0, 'Recovery still requires an explicit save against the newly read participation version.');
    assert.deepEqual(await f.store.exportSeed(), beforeRestore);
    assert.equal(draft(restored, creationEntityId), null);
    assert.equal(draft(restored, joined.id)?.value.amountInput, '43.75');
    await restored.save();
    const sent = receiptRequests(f);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { participationId: joined.id, amountMinor: 4375, receivedOn: '2026-09-29', expectedVersion: participation.version });
    const updated = (await f.store.get<Participation>('participations', joined.id))!;
    assert.equal(updated.periodKey, participation.periodKey);
    assert.deepEqual(updated.snapshot, participation.snapshot);
    assert.equal(updated.receivedMinor, 4375);
    assert.equal((await f.store.find<Reward>('rewards')).length, 1);
    assert.equal(draft(restored, joined.id), null);
  });

  test(`an explicit same-period ${scope}-scope participation can recover and only look up its committed pending creation`, async () => {
    const f = await fixture({ scope, failure: 'after-commit' });
    const original = await initialize(f, { cardId: 'card-a' });
    changeAmount(original, '58.25');
    changeDate(original, '2026-09-29');
    await original.save();
    const first = receiptRequests(f)[0];
    const creationEntityId = original.data.draftEntityId;
    const saved = structuredClone(draft(original));
    const participation = (await f.store.find<Participation>('participations'))[0];
    assert.equal(participation.periodKey, '2026-09');
    original.onUnload();

    const restored = await initialize(f, { cardId: scope === 'user' ? 'card-b' : '', id: participation.id });
    assert.equal(modalCalls, 1, 'The exact pending creation must remain recoverable when the user opens its committed record.');
    assert.equal(modalOptions[0].title, '发现待核对的保存结果');
    assert.equal(restored.data.participation.id, participation.id);
    assert.equal(restored.data.currentTarget.participationId, participation.id);
    assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
    assert.equal(restored.data.pendingReplayOnly, true, 'An explicit record route may resolve the original request but must not submit another first receipt.');
    assert.deepEqual(restored.data.pendingCreation, saved?.value.pendingCreation);
    assert.equal(restored.data.draftEntityId, creationEntityId);
    assert.equal(restored.data.amountInput, '58.25');
    assert.equal(restored.data.receivedOn, '2026-09-29');
    assert.deepEqual(draft(restored, creationEntityId), saved);
    assert.equal(draft(restored, participation.id), null);
    assert.equal(receiptRequests(f).length, 1);
    const beforeLookup = await f.store.exportSeed();
    await restored.resolvePendingCreation();
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(replayRequests(f).length, 1);
    assert.deepEqual(replayRequests(f)[0].payload, { action: 'reward.confirm', payload: first.payload, requestId: first.requestId });
    assert.deepEqual(await f.store.exportSeed(), beforeLookup);
    assert.equal((await f.store.find<Participation>('participations')).length, 1);
    assert.equal((await f.store.find<Reward>('rewards')).length, 1);
    assert.equal(draft(restored, creationEntityId), null);
    assert.ok(navigations.at(-1)?.includes(participation.id));
  });
}

test('saving untouched receipt defaults persists the original target and pending intent before dispatch', async () => {
  const f = await fixture({ failure: 'before-commit' });
  const instance = await initialize(f);
  assert.equal(instance.data.amountInput, '20.00');
  assert.equal(instance.data.receivedOn, '2026-09-30');
  assert.equal(instance.data.maxDate, '2026-09-30');
  assert.equal(draft(instance), null);
  let pendingAtDispatch: PendingCreation | undefined;
  f.onDispatch(request => {
    if (request.action === 'reward.confirm') pendingAtDispatch = draft(instance)?.value.pendingCreation;
  });
  await instance.save();
  const sent = receiptRequests(f);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.expectNew, true);
  assert.equal(sent[0].payload.expectedPeriodKey, '2026-09');
  assert.ok(pendingAtDispatch?.intentKey);
  assert.deepEqual(JSON.parse(JSON.stringify(pendingAtDispatch?.payload)), sent[0].payload);
  assert.deepEqual(pendingAtDispatch?.target, targetFor(f.source));
  assert.deepEqual(draft(instance)?.value.pendingCreation, pendingAtDispatch);
  assert.deepEqual(draft(instance)?.value.draftTarget, pendingAtDispatch?.target);
  assert.equal(draft(instance)?.value.intentKey, pendingAtDispatch?.intentKey);
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal(navigations.length, 0);
});

test('a never-submitted live September receipt becomes an ordinary target-review draft before its first October save', async () => {
  const f = await fixture({ date: '2026-09-30' });
  const instance = await initialize(f);
  changeAmount(instance, '73.25');
  changeDate(instance, '2026-09-29');
  assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(draft(instance)?.value.pendingCreation, undefined);
  assert.equal(receiptRequests(f).length, 0);
  f.setDate('2026-10-01');
  const beforeSave = await f.store.exportSeed();
  await instance.save();

  assert.equal(receiptRequests(f).length, 0, 'A first submission must recheck its period before any write request.');
  assert.equal(replayRequests(f).length, 0, 'A never-dispatched creation must not look up a request that cannot have a result.');
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(instance.data.targetReviewRequired, true);
  assert.equal(instance.data.currentTarget.periodKey, '2026-10');
  assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
  assert.equal(instance.data.amountInput, '73.25');
  assert.equal(instance.data.receivedOn, '2026-09-29');
  assert.equal(draft(instance)?.value.pendingCreation, undefined);
  assert.equal(draft(instance)?.value.draftTarget?.periodKey, '2026-09');
  assert.deepEqual(await f.store.exportSeed(), beforeSave);
  assert.equal(navigations.length, 0);

  instance.confirmDraftTarget();
  assert.equal(instance.data.targetReviewRequired, false);
  assert.equal(instance.data.receiptTarget.periodKey, '2026-10');
  assert.equal(instance.data.amountInput, '73.25');
  assert.equal(instance.data.receivedOn, '2026-09-29', 'Selecting a new target must not silently rewrite the actual receipt date.');
  await instance.save();
  assert.ok(instance.data.dateError);
  assert.equal(receiptRequests(f).length, 0);
  assert.equal(replayRequests(f).length, 0);
  changeDate(instance, '2026-10-01');
  await instance.save();
  const sent = receiptRequests(f);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.expectNew, true);
  assert.equal(sent[0].payload.expectedPeriodKey, '2026-10');
  assert.equal(sent[0].payload.receivedOn, '2026-10-01');
  assert.equal(sent[0].payload.amountMinor, 7325);
  assert.equal(replayRequests(f).length, 0);
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 1);
  assert.equal(records[0].periodKey, '2026-10');
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].activityPeriod, '2026-10');
  assert.equal(ledger[0].receivedOn, '2026-10-01');
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(draft(instance), null);
});

test('a fresh receipt dispatches after one period preflight and a server-side rollover returns to ordinary target review', async () => {
  const f = await fixture({ date: '2026-09-30' });
  const instance = await initialize(f);
  changeAmount(instance, '46.25');
  let sessionReads = 0;
  const sessionReadsAtDispatch: number[] = [];
  f.onDispatch(request => {
    if (request.action === 'session.get') {
      sessionReads += 1;
      if (sessionReads === 2) f.setDate('2026-10-01');
    }
    if (request.action === 'reward.confirm') {
      sessionReadsAtDispatch.push(sessionReads);
      f.setDate('2026-10-01');
    }
  });
  await instance.save();
  assert.deepEqual(sessionReadsAtDispatch, [1], 'The verified first submission must dispatch without a second session read that could turn it into an unresolved lookup.');
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, '2026-09');
  assert.equal(replayRequests(f).length, 0);
  assert.equal((await f.store.find('participations')).length, 0, 'The server period guard must reject the boundary-crossing first dispatch atomically.');
  assert.equal((await f.store.find('rewards')).length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(instance.data.targetReviewRequired, true);
  assert.equal(instance.data.currentTarget.periodKey, '2026-10');
  assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
  assert.equal(instance.data.amountInput, '46.25');
  assert.equal(instance.data.receivedOn, '2026-09-30');
  assert.equal(draft(instance)?.value.pendingCreation, undefined);
  assert.equal(draft(instance)?.value.draftTarget?.periodKey, '2026-09');
  f.onDispatch(() => {});
  instance.confirmDraftTarget();
  changeDate(instance, '2026-10-01');
  await instance.save();
  const sent = receiptRequests(f);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].payload.expectedPeriodKey, '2026-10');
  assert.equal(sent[1].payload.receivedOn, '2026-10-01');
  assert.equal(sent[1].payload.amountMinor, 4625);
  assert.equal(replayRequests(f).length, 0);
  assert.equal((await f.store.find<Participation>('participations'))[0].periodKey, '2026-10');
  assert.equal((await f.store.find<Reward>('rewards')).length, 1);
  assert.equal(draft(instance), null);
});

test('a fresh draft-storage failure stays unsubmitted and can recheck its target after storage recovers in October', async () => {
  const f = await fixture({ date: '2026-09-30' });
  const instance = await initialize(f);
  changeAmount(instance, '82.75');
  changeDate(instance, '2026-09-29');
  const originalDraft = structuredClone(draft(instance));
  const runtime = (globalThis as any).wx;
  const originalWrite = runtime.setStorageSync;
  runtime.setStorageSync = () => { throw new Error('Draft storage unavailable'); };
  try { await instance.save(); }
  finally { runtime.setStorageSync = originalWrite; }
  assert.equal(receiptRequests(f).length, 0);
  assert.equal(replayRequests(f).length, 0);
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(instance.data.amountInput, '82.75');
  assert.equal(instance.data.receivedOn, '2026-09-29');
  assert.match(instance.data.formError, /尚未发送/);
  assert.deepEqual(draft(instance), originalDraft, 'A failed write must not remove or replace the previously saved ordinary draft revision.');
  f.setDate('2026-10-01');
  await instance.save();
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(instance.data.targetReviewRequired, true);
  assert.equal(instance.data.currentTarget.periodKey, '2026-10');
  assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
  assert.equal(receiptRequests(f).length, 0);
  assert.equal(replayRequests(f).length, 0);
  instance.confirmDraftTarget();
  changeDate(instance, '2026-10-01');
  await instance.save();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, '2026-10');
  assert.equal(receiptRequests(f)[0].payload.amountMinor, 8275);
  assert.equal(replayRequests(f).length, 0);
  assert.equal((await f.store.find<Reward>('rewards'))[0].activityPeriod, '2026-10');
  assert.equal(draft(instance), null);
});

test('a first-dispatch period rejection retains a reload route when reading the new target fails', async () => {
  const f = await fixture({ date: '2026-09-30' });
  const instance = await initialize(f);
  changeAmount(instance, '39.75');
  let rejectedDispatch = false;
  f.onDispatch(request => {
    if (request.action === 'reward.confirm') { rejectedDispatch = true; f.setDate('2026-10-01'); }
    if (rejectedDispatch && request.action === 'activity.get') throw new Error('Current target lookup unavailable');
  });
  await instance.save();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(replayRequests(f).length, 0);
  assert.equal(instance.data.pendingCreation, null);
  assert.equal(instance.data.currentTarget, null);
  assert.equal(instance.data.conflict, true, 'The existing reload action must remain available when the replacement target cannot be read.');
  assert.equal(instance.data.targetReviewRequired, true);
  assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
  assert.equal(instance.data.amountInput, '39.75');
  assert.equal(instance.data.receivedOn, '2026-09-30');
  instance.confirmDraftTarget();
  assert.equal(instance.data.targetReviewRequired, true, 'A missing target must not let confirmation reselect the obsolete September target.');
  assert.equal((await f.store.find('participations')).length, 0);
  f.onDispatch(() => {});
  await instance.reloadLatest();
  assert.equal(instance.data.conflict, false);
  const refreshedTarget = instance.data.currentTarget as ReceiptTarget | null;
  assert.ok(refreshedTarget);
  assert.equal(refreshedTarget.periodKey, '2026-10');
  assert.equal(instance.data.receiptTarget.periodKey, '2026-09');
  assert.equal(instance.data.targetReviewRequired, true);
  assert.equal(instance.data.amountInput, '39.75');
  assert.equal(instance.data.receivedOn, '2026-09-30');
  instance.confirmDraftTarget();
  changeDate(instance, '2026-10-01');
  await instance.save();
  assert.equal(receiptRequests(f).length, 2);
  assert.equal(receiptRequests(f)[1].payload.expectedPeriodKey, '2026-10');
  assert.equal(receiptRequests(f)[1].payload.amountMinor, 3975);
  assert.equal(replayRequests(f).length, 0);
  assert.equal((await f.store.find<Reward>('rewards'))[0].activityPeriod, '2026-10');
  assert.equal(draft(instance), null);
});

test('a committed September receipt with a lost response resolves in October through one read-only replay', async () => {
  const f = await fixture({ failure: 'after-commit' });
  const original = await initialize(f);
  changeAmount(original, '42.75');
  await original.save();
  const first = receiptRequests(f)[0];
  const saved = draft(original)!;
  const entityId = original.data.draftEntityId;
  const originalIntent = saved.value.pendingCreation!.intentKey;
  assert.equal(first.payload.expectedPeriodKey, '2026-09');
  const committed = await f.store.find<Participation>('participations');
  assert.equal(committed.length, 1);
  assert.equal(committed[0].periodKey, '2026-09');
  original.onUnload();

  f.setDate('2026-10-01');
  const restored = await initialize(f);
  assert.equal(modalOptions[0].title, '发现待核对的保存结果');
  assert.equal(modalOptions[0].confirmText, '恢复核对');
  assert.equal(modalOptions[0].cancelText, '暂不核对');
  assert.match(modalOptions[0].content, /2026年9月/);
  assert.match(modalOptions[0].content, /2026-09-30/);
  assert.match(modalOptions[0].content, /服务端可能已经保存/);
  assert.equal(restored.data.maxDate, '2026-10-01');
  assert.equal(restored.data.intentKey, originalIntent);
  assert.equal(restored.data.pendingReplayOnly, true);
  assert.deepEqual(restored.data.pendingCreation, saved.value.pendingCreation);
  assert.equal(restored.data.amountInput, '42.75');
  assert.equal(restored.data.receivedOn, '2026-09-30');
  assert.equal(receiptRequests(f).length, 1, 'Restoring a pending receipt must not submit it automatically.');
  const beforeLookup = await f.store.exportSeed();
  await restored.resolvePendingCreation();

  const lookups = replayRequests(f);
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].payload.action, 'reward.confirm');
  assert.equal(lookups[0].payload.requestId, first.requestId);
  assert.deepEqual(lookups[0].payload.payload, first.payload);
  assert.equal(receiptRequests(f).length, 1);
  assert.deepEqual(await f.store.exportSeed(), beforeLookup);
  const rewards = await f.store.find<Reward>('rewards');
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].activityPeriod, '2026-09');
  assert.equal(rewards[0].amountMinor, 4275);
  assert.equal((await f.store.find('requests')).length, 1);
  assert.equal(draft(restored, entityId), null);
  assert.equal(navigations.length, 1);
  assert.ok(navigations[0].includes(committed[0].id));
});

test('an uncommitted September request remains pending after an October missing-result lookup without a fresh write', async () => {
  const f = await fixture({ failure: 'before-commit' });
  const original = await initialize(f);
  changeAmount(original, '35.00');
  await original.save();
  const first = receiptRequests(f)[0];
  original.onUnload();
  f.setDate('2026-10-01');
  const restored = await initialize(f);
  const pending = structuredClone(restored.data.pendingCreation);
  const savedRevision = revision(restored);
  const beforeLookup = await f.store.exportSeed();
  await restored.save();
  assert.equal(restored.data.pendingReplayOnly, true);
  assert.deepEqual(restored.data.pendingCreation, pending);
  assert.deepEqual(draft(restored)?.value.pendingCreation, pending);
  assert.equal(revision(restored), savedRevision);
  assert.ok(restored.data.formError);
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(replayRequests(f).length, 1);
  assert.equal(replayRequests(f)[0].payload.requestId, first.requestId);
  assert.deepEqual(replayRequests(f)[0].payload.payload, first.payload);
  assert.deepEqual(await f.store.exportSeed(), beforeLookup);
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal((await f.store.find('rewards')).length, 0);
  assert.equal(navigations.length, 0);
});

test('a same-period uncommitted pending receipt retries its original payload and request identity normally', async () => {
  const f = await fixture({ date: '2026-09-29', failure: 'before-commit' });
  const original = await initialize(f);
  changeAmount(original, '18.25');
  await original.save();
  const first = receiptRequests(f)[0];
  const pending = structuredClone(original.data.pendingCreation);
  original.onUnload();
  f.setDate('2026-09-30');
  const restored = await initialize(f);
  assert.equal(restored.data.pendingReplayOnly, false);
  assert.deepEqual(restored.data.pendingCreation, pending);
  await restored.save();
  const sent = receiptRequests(f);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].requestId, first.requestId);
  assert.deepEqual(sent[1].payload, first.payload);
  assert.equal(sent[1].payload.receivedOn, '2026-09-29');
  assert.equal(replayRequests(f).length, 0);
  assert.equal((await f.store.find('participations')).length, 1);
  assert.equal((await f.store.find('rewards')).length, 1);
  assert.equal((await f.store.find('requests')).length, 1);
  assert.equal(draft(restored), null);
  assert.equal(navigations.length, 1);
});

test('pending receipt fields stay locked while lookup failures preserve the exact draft revision', async () => {
  const f = await fixture({ failure: 'before-commit' });
  const original = await initialize(f);
  changeAmount(original, '26.75');
  await original.save();
  original.onUnload();
  f.setDate('2026-10-01');
  f.setReplayFailure(true);
  const restored = await initialize(f);
  const saved = structuredClone(draft(restored));
  const pending = structuredClone(restored.data.pendingCreation);
  await changeAmount(restored, '99.99');
  await changeDate(restored, '2026-10-01');
  assert.equal(restored.data.amountInput, '26.75');
  assert.equal(restored.data.receivedOn, '2026-09-30');
  await restored.resolvePendingCreation();
  assert.deepEqual(restored.data.pendingCreation, pending);
  assert.deepEqual(draft(restored), saved);
  assert.equal(receiptRequests(f).length, 1);
  assert.ok(replayRequests(f).length >= 1);
  for (const request of replayRequests(f)) assert.deepEqual(request.payload.payload, receiptRequests(f)[0].payload);
  assert.equal(navigations.length, 0);
  assert.equal((await f.store.find('rewards')).length, 0);
});

test('correcting a known September receipt in October uses its version and keeps the original period snapshot', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  await f.store.set('activities', f.source.id, { ...f.source, revision: 2, title: 'Revised monthly benefit', rewardMinor: 8800 });
  f.setDate('2026-10-01');
  const instance = await initialize(f, { id: created.id });
  assert.equal(instance.data.title, original.snapshot.title);
  assert.equal(instance.data.minDate, '2026-09-01');
  assert.equal(instance.data.maxDate, '2026-10-01');
  changeAmount(instance, '51.25');
  changeDate(instance, '2026-10-01');
  await instance.save();
  const sent = receiptRequests(f);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.participationId, original.id);
  assert.equal(sent[0].payload.expectedVersion, original.version);
  assert.equal(Object.hasOwn(sent[0].payload, 'expectedPeriodKey'), false);
  assert.equal(Object.hasOwn(sent[0].payload, 'expectNew'), false);
  const corrected = (await f.store.get<Participation>('participations', original.id))!;
  assert.equal(corrected.periodKey, original.periodKey);
  assert.equal(corrected.startsOn, original.startsOn);
  assert.equal(corrected.endsOn, original.endsOn);
  assert.deepEqual(corrected.snapshot, original.snapshot);
  assert.equal(corrected.receivedMinor, 5125);
  assert.equal(corrected.receivedOn, '2026-10-01');
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].activityPeriod, '2026-09');
  assert.equal(ledger[0].title, original.snapshot.title);
  assert.equal(ledger[0].receivedOn, '2026-10-01');
  assert.equal(draft(instance), null);
});

test('an unsubmitted September draft requires explicit rebinding and a valid October receipt date', async () => {
  const f = await fixture();
  const original = await initialize(f);
  changeAmount(original, '64.75');
  const entityId = original.data.draftEntityId;
  assert.equal(draft(original)?.value.draftTarget?.periodKey, '2026-09');
  assert.equal(draft(original)?.value.pendingCreation, undefined);
  original.onUnload();
  f.setDate('2026-10-01');
  const restored = await initialize(f);
  assert.equal(modalOptions[0].title, '恢复活动记录草稿？');
  assert.equal(modalOptions[0].confirmText, '恢复草稿');
  assert.equal(modalOptions[0].cancelText, '放弃草稿');
  assert.match(modalOptions[0].content, /2026年9月/);
  assert.match(modalOptions[0].content, /2026年10月/);
  assert.equal(restored.data.targetReviewRequired, true);
  assert.equal(restored.data.amountInput, '64.75');
  assert.equal(restored.data.receivedOn, '2026-09-30');
  assert.equal(draft(restored, entityId)?.value.draftTarget?.periodKey, '2026-09');
  await restored.save();
  assert.equal(receiptRequests(f).length, 0);
  assert.equal((await f.store.find('participations')).length, 0);

  await restored.confirmDraftTarget();
  assert.equal(restored.data.targetReviewRequired, false);
  assert.equal(restored.data.receiptTarget.periodKey, '2026-10');
  assert.equal(restored.data.receiptTarget.participationId, '');
  assert.equal(restored.data.amountInput, '64.75');
  assert.equal(restored.data.receivedOn, '2026-09-30');
  assert.equal(draft(restored)?.value.draftTarget?.periodKey, '2026-10');
  await restored.save();
  assert.ok(restored.data.dateError, 'Rebinding the target must not silently replace or approve the retained September date.');
  assert.equal(receiptRequests(f).length, 0);
  changeDate(restored, '2026-10-01');
  await restored.save();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, '2026-10');
  assert.equal(receiptRequests(f)[0].payload.amountMinor, 6475);
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 1);
  assert.equal(records[0].periodKey, '2026-10');
  assert.equal(draft(restored), null);
});

test('a legacy creation draft without a period cannot infer a target from its receipt date', async () => {
  const f = await fixture({ date: '2026-10-01' });
  const entityId = `new:${f.source.id}:card-a`;
  saveDraft('receipt', owner.userId, entityId, null, { amountInput: '73.25', receivedOn: '2026-09-29' });
  const restored = await initialize(f);
  assert.equal(restored.data.participation, null);
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal(restored.data.amountInput, '73.25');
  assert.equal(restored.data.receivedOn, '2026-09-29');
  assert.equal(restored.data.targetReviewRequired, true);
  assert.notEqual(restored.data.receiptTarget?.periodKey, '2026-09');
  assert.equal(draft(restored, entityId)?.value.draftTarget, undefined);
  assert.equal(draft(restored, entityId)?.value.pendingCreation, undefined);
  await restored.save();
  assert.equal(receiptRequests(f).length, 0);
  assert.equal(replayRequests(f).length, 0);
  await restored.confirmDraftTarget();
  assert.equal(restored.data.receiptTarget.periodKey, '2026-10');
  assert.equal(restored.data.amountInput, '73.25');
  assert.equal(restored.data.receivedOn, '2026-09-29');
  await restored.save();
  assert.ok(restored.data.dateError);
  assert.equal(receiptRequests(f).length, 0);
  changeDate(restored, '2026-10-01');
  await restored.save();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(receiptRequests(f)[0].payload.expectedPeriodKey, '2026-10');
  assert.equal(receiptRequests(f)[0].payload.amountMinor, 7325);
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 1);
  assert.equal(records[0].periodKey, '2026-10');
  assert.equal(records[0].receivedOn, '2026-10-01');
});

for (const failure of ['before-commit', 'after-commit'] as const) {
  test(`a same-month pending receipt without target metadata uses only lookup after ${failure}`, async () => {
    const f = await fixture({ date: '2026-09-29', failure });
    const original = await initialize(f);
    changeAmount(original, '48.25');
    await original.save();
    const first = receiptRequests(f)[0];
    const originalDraft = draft(original)!;
    const entityId = original.data.draftEntityId;
    const pending = structuredClone(originalDraft.value.pendingCreation!);
    delete pending.target;
    const legacyValue: ReceiptDraft = { ...originalDraft.value, pendingCreation: pending };
    delete legacyValue.draftTarget;
    saveDraft('receipt', owner.userId, entityId, originalDraft.baseVersion, legacyValue);
    const saved = loadDraft<ReceiptDraft>('receipt', owner.userId, entityId);
    original.onUnload();
    f.setDate('2026-09-30');
    const restored = await initialize(f);
    assert.equal(restored.data.pendingReplayOnly, true);
    assert.equal(restored.data.receiptTarget, null);
    assert.equal(restored.data.intentKey, pending.intentKey);
    assert.deepEqual(restored.data.pendingCreation, pending);
    assert.deepEqual(draft(restored, entityId), saved);
    const beforeLookup = await f.store.exportSeed();
    await restored.save();
    assert.equal(receiptRequests(f).length, 1, 'Missing target metadata cannot authorize a fresh mutation, even in the same month.');
    assert.equal(replayRequests(f).length, 1);
    assert.equal(replayRequests(f)[0].payload.requestId, first.requestId);
    assert.deepEqual(replayRequests(f)[0].payload.payload, first.payload);
    assert.deepEqual(await f.store.exportSeed(), beforeLookup);
    if (failure === 'before-commit') {
      assert.deepEqual(draft(restored, entityId), saved);
      assert.deepEqual(restored.data.pendingCreation, pending);
      assert.ok(restored.data.formError);
      assert.equal((await f.store.find('participations')).length, 0);
      assert.equal((await f.store.find('rewards')).length, 0);
      assert.equal(navigations.length, 0);
    } else {
      assert.equal(draft(restored, entityId), null);
      assert.equal(restored.data.pendingCreation, null);
      assert.equal((await f.store.find('participations')).length, 1);
      assert.equal((await f.store.find('rewards')).length, 1);
      assert.equal(navigations.length, 1);
    }
  });
}

for (const walletUnavailable of [false, true]) {
  test(`restoring a pending September user-scope receipt shows its original card instead of an October receipt card${walletUnavailable ? ' when wallet lookup fails' : ''}`, async () => {
    const f = await fixture({ scope: 'user', failure: 'after-commit' });
    const original = await initialize(f, { cardId: 'card-a' });
    changeAmount(original, '42.75');
    await original.save();
    const saved = structuredClone(draft(original));
    const september = (await f.store.find<Participation>('participations'))[0];
    original.onUnload();
    f.setDate('2026-10-01');
    const october = await f.command({ activityId: f.source.id, cardId: 'card-b', amountMinor: 9100, receivedOn: '2026-10-01', expectNew: true, expectedPeriodKey: '2026-10' });
    if (walletUnavailable) f.onDispatch(request => { if (request.action === 'wallet.get') throw new Error('Wallet unavailable during receipt recovery'); });
    const restored = await initialize(f, { cardId: 'card-b' });
    assert.equal(restored.data.participation.id, october.id);
    assert.equal(restored.data.participation.cardId, 'card-b');
    assert.equal(restored.data.currentTarget.periodKey, '2026-10');
    assert.equal(restored.data.pendingCreation.payload.cardId, 'card-a');
    assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
    assert.equal(restored.data.cardName, walletUnavailable ? '原关联卡片暂未读取' : 'card-a');
    assert.equal(restored.data.isEditing, false);
    assert.equal(restored.data.willComplete, false);
    assert.equal(restored.data.latestSummary, '');
    assert.equal(restored.data.pendingReplayOnly, true);
    assert.deepEqual(draft(restored), saved, 'Presentation recovery must not rewrite the pending request or its draft revision.');
    const beforeLookup = await f.store.exportSeed();
    await restored.resolvePendingCreation();
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(replayRequests(f).length, 1);
    assert.deepEqual(await f.store.exportSeed(), beforeLookup);
    assert.ok(navigations.at(-1)?.includes(september.id));
    assert.ok(!navigations.at(-1)?.includes(october.id));
  });
}

test('a user-scope pending receipt without an original card clears the current period card and mutation wording', async () => {
  const f = await fixture({ scope: 'user', failure: 'after-commit' });
  const original = await initialize(f, { cardId: '' });
  await original.save();
  const saved = structuredClone(draft(original));
  assert.equal(saved?.value.pendingCreation?.payload.cardId, undefined);
  const target = saved?.value.pendingCreation?.target;
  assert.ok(target, 'The pending receipt must retain its original activity target.');
  assert.equal(target.cardId, '');
  const september = (await f.store.find<Participation>('participations'))[0];
  original.onUnload();
  f.setDate('2026-10-01');
  const october = await f.command({ activityId: f.source.id, cardId: 'card-b', amountMinor: 6400, receivedOn: '2026-10-01', expectNew: true, expectedPeriodKey: '2026-10' });
  const restored = await initialize(f, { cardId: '' });
  assert.equal(restored.data.participation.id, october.id);
  assert.equal(restored.data.participation.cardId, 'card-b');
  assert.equal(restored.data.currentTarget.periodKey, '2026-10');
  assert.equal(restored.data.cardName, '');
  assert.equal(restored.data.isEditing, false);
  assert.equal(restored.data.willComplete, false);
  assert.equal(restored.data.latestSummary, '');
  assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
  assert.equal(restored.data.pendingReplayOnly, true);
  assert.deepEqual(draft(restored), saved);
  const beforeLookup = await f.store.exportSeed();
  await restored.resolvePendingCreation();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(replayRequests(f).length, 1);
  assert.deepEqual(await f.store.exportSeed(), beforeLookup);
  assert.ok(navigations.at(-1)?.includes(september.id));
});

for (const unavailable of ['withdrawn', 'expired'] as const) {
  test(`a pending receipt restores from its creation key and replays when the activity is ${unavailable}`, async () => {
    const f = await fixture({ failure: 'after-commit' });
    const original = await initialize(f);
    changeAmount(original, '52.75');
    await original.save();
    const first = receiptRequests(f)[0];
    const entityId = original.data.draftEntityId;
    const saved = structuredClone(draft(original));
    const committed = (await f.store.find<Participation>('participations'))[0];
    assert.deepEqual(saved?.value.pendingCreation?.activity, f.source);
    original.onUnload();
    f.setDate('2026-10-01');
    await f.store.set('activities', f.source.id, unavailable === 'withdrawn'
      ? { ...f.source, status: 'withdrawn', revision: 2 }
      : { ...f.source, endsOn: '2026-09-30', revision: 2 });
    await assert.rejects(api.query('activity.get', { activityId: f.source.id, cardId: 'card-a' }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'NOT_FOUND');
    const restored = await initialize(f);
    assert.equal(restored.data.draftEntityId, entityId);
    assert.equal(restored.data.currentTarget, null);
    assert.equal(restored.data.pendingReplayOnly, true);
    assert.deepEqual(restored.data.pendingCreation, saved?.value.pendingCreation);
    assert.equal(restored.data.title, f.source.title);
    assert.equal(restored.data.amountInput, '52.75');
    assert.equal(restored.data.receivedOn, '2026-09-30');
    assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
    assert.deepEqual(draft(restored, entityId), saved);
    assert.equal(receiptRequests(f).length, 1);
    const beforeLookup = await f.store.exportSeed();
    await restored.resolvePendingCreation();
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(replayRequests(f).length, 1);
    assert.equal(replayRequests(f)[0].payload.requestId, first.requestId);
    assert.deepEqual(replayRequests(f)[0].payload.payload, first.payload);
    assert.deepEqual(await f.store.exportSeed(), beforeLookup);
    assert.equal((await f.store.find('participations')).length, 1);
    const ledger = await f.store.find<Reward>('rewards');
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].participationId, committed.id);
    assert.equal(ledger[0].activityPeriod, '2026-09');
    assert.equal(ledger[0].amountMinor, 5275);
    assert.equal(draft(restored, entityId), null);
    assert.equal(navigations.length, 1);
    assert.ok(navigations[0].includes(committed.id));
  });
}

test('an explicit historical record ignores a legacy creation draft without target metadata and leaves it untouched', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const creationEntityId = `new:${f.source.id}:card-a`;
  saveDraft('receipt', owner.userId, creationEntityId, null, { amountInput: '89.50', receivedOn: '2026-09-30' });
  const legacyDraft = loadDraft<ReceiptDraft>('receipt', owner.userId, creationEntityId);
  const beforeRecovery = await f.store.exportSeed();
  f.setDate('2026-10-01');
  const restored = await initialize(f, { id: original.id });
  assert.equal(restored.data.participation.id, original.id);
  assert.equal(restored.data.amountInput, '18.25');
  assert.equal(restored.data.receivedOn, original.receivedOn);
  assert.equal(restored.data.targetReviewRequired, false);
  assert.equal(restored.data.draftEntityId, original.id);
  assert.deepEqual(restored.data.unassignedDraft, { amountInput: '89.50', receivedOn: '2026-09-30' });
  assert.equal(restored.data.unassignedDraftVisible, false);
  assert.equal(modalCalls, 0, 'An unrelated legacy creation draft must not be offered for recovery through an explicit historical record.');
  assert.deepEqual(draft(restored, creationEntityId), legacyDraft);
  assert.equal(draft(restored, original.id), null);
  assert.equal(receiptRequests(f).length, 0);
  await restored.showUnassignedDraft();
  assert.equal(restored.data.unassignedDraftVisible, true);
  assert.deepEqual(restored.data.unassignedDraft, { amountInput: '89.50', receivedOn: '2026-09-30' });
  assert.equal(restored.data.amountInput, '18.25');
  assert.equal(restored.data.receivedOn, original.receivedOn);
  assert.equal(restored.data.draftEntityId, original.id);
  assert.equal(restored.data.receiptTarget.participationId, original.id);
  assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
  assert.deepEqual(draft(restored, creationEntityId), legacyDraft);
  assert.equal(draft(restored, original.id), null);
  assert.deepEqual(await f.store.exportSeed(), beforeRecovery);
  await restored.confirmDraftTarget();
  assert.equal(restored.data.receiptTarget.participationId, original.id);
  assert.equal(restored.data.receiptTarget.periodKey, '2026-09');
  assert.equal(restored.data.targetReviewRequired, false);
  assert.equal(restored.data.amountInput, '18.25');
  assert.deepEqual(draft(restored, creationEntityId), legacyDraft);
  assert.equal(draft(restored, original.id), null);
  assert.deepEqual(await f.store.exportSeed(), beforeRecovery);
  assert.equal((await f.store.find<Reward>('rewards'))[0].amountMinor, original.receivedMinor);
  assert.equal(receiptRequests(f).length, 0);
});

test('manually entering values after viewing an unassigned draft saves only the known record and preserves the original creation draft', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  const creationEntityId = `new:${f.source.id}:card-a`;
  saveDraft('receipt', owner.userId, creationEntityId, null, { amountInput: '89.50', receivedOn: '2026-09-30' });
  const legacyDraft = loadDraft<ReceiptDraft>('receipt', owner.userId, creationEntityId);
  f.setDate('2026-10-01');
  const restored = await initialize(f, { id: original.id });
  await restored.showUnassignedDraft();
  assert.equal(restored.data.unassignedDraftVisible, true);
  assert.equal(restored.data.amountInput, '18.25');
  assert.equal(restored.data.receivedOn, original.receivedOn);
  assert.equal(receiptRequests(f).length, 0);

  changeAmount(restored, '89.50');
  changeDate(restored, '2026-10-01');
  assert.equal(restored.data.draftEntityId, original.id);
  assert.equal(draft(restored)?.value.amountInput, '89.50');
  assert.equal(draft(restored)?.value.receivedOn, '2026-10-01');
  assert.equal(draft(restored)?.value.draftTarget?.participationId, original.id);
  assert.deepEqual(draft(restored, creationEntityId), legacyDraft);
  await restored.save();
  const sent = receiptRequests(f);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, {
    participationId: original.id, amountMinor: 8950, receivedOn: '2026-10-01', expectedVersion: original.version,
  });
  assert.equal(replayRequests(f).length, 0);
  assert.deepEqual(draft(restored, creationEntityId), legacyDraft, 'A deliberate correction must not consume or relabel the unrelated original creation draft.');
  assert.equal(draft(restored, original.id), null);
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 1);
  assert.equal(records[0].id, original.id);
  assert.equal(records[0].periodKey, original.periodKey);
  assert.deepEqual(records[0].snapshot, original.snapshot);
  assert.equal(records[0].receivedMinor, 8950);
  assert.equal(records[0].receivedOn, '2026-10-01');
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].participationId, original.id);
  assert.equal(ledger[0].activityPeriod, '2026-09');
  assert.equal(ledger[0].amountMinor, 8950);
  assert.equal(ledger[0].receivedOn, '2026-10-01');
});

test('a legacy draft saved under a known record ID recovers as a versioned correction across months', async () => {
  const f = await fixture();
  const created = await f.command(firstReceipt(f.source));
  const original = (await f.store.get<Participation>('participations', created.id))!;
  saveDraft('receipt', owner.userId, original.id, original.version, { amountInput: '31.75', receivedOn: '2026-09-30' });
  f.setDate('2026-10-01');
  const restored = await initialize(f, { id: original.id });
  assert.equal(modalCalls, 1);
  assert.equal(restored.data.amountInput, '31.75');
  assert.equal(restored.data.receiptTarget.participationId, original.id);
  assert.equal(restored.data.targetReviewRequired, false);
  assert.equal(receiptRequests(f).length, 0);
  await restored.save();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(receiptRequests(f)[0].payload.participationId, original.id);
  assert.equal(receiptRequests(f)[0].payload.expectedVersion, original.version);
  assert.equal(Object.hasOwn(receiptRequests(f)[0].payload, 'expectedPeriodKey'), false);
  assert.equal((await f.store.find('participations')).length, 1);
  assert.equal((await f.store.find<Reward>('rewards'))[0].activityPeriod, '2026-09');
  assert.equal(draft(restored), null);
});

test('creation drafts for separate cards retain separate targets and do not adopt another card receipt', async () => {
  const f = await fixture();
  const first = await initialize(f, { cardId: 'card-a' });
  changeAmount(first, '28.25');
  const firstEntityId = first.data.draftEntityId;
  const firstDraft = structuredClone(draft(first));
  first.onUnload();
  const second = await initialize(f, { cardId: 'card-b' });
  assert.notEqual(second.data.draftEntityId, firstEntityId);
  assert.equal(second.data.amountInput, '20.00');
  assert.equal(second.data.receiptTarget.cardId, 'card-b');
  assert.equal(draft(second), null);
  changeAmount(second, '34.50');
  await second.save();
  assert.deepEqual(draft(second, firstEntityId), firstDraft);
  const restored = await initialize(f, { cardId: 'card-a' });
  assert.equal(restored.data.participation, null);
  assert.equal(restored.data.receiptTarget.cardId, 'card-a');
  assert.equal(restored.data.amountInput, '28.25');
  assert.equal(restored.data.targetReviewRequired, false);
  await restored.save();
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 2);
  assert.equal(records.find(row => row.cardId === 'card-a')?.receivedMinor, 2825);
  assert.equal(records.find(row => row.cardId === 'card-b')?.receivedMinor, 3450);
  assert.equal((await f.store.find('rewards')).length, 2);
});

for (const scenario of [
  { name: 'activity', target: { activityId: 'another-activity' } },
  { name: 'scope', target: { scope: 'user' as const } },
  { name: 'card', target: { cardId: 'card-b' } },
  { name: 'record', target: { participationId: 'another-record' } },
]) {
  test(`a saved ${scenario.name} target mismatch cannot become an unreviewed first receipt`, async () => {
    const f = await fixture();
    const entityId = `new:${f.source.id}:card-a`;
    saveDraft('receipt', owner.userId, entityId, null, {
      amountInput: '97.00', receivedOn: '2026-09-30', intentKey: createCommandIntent(),
      draftTarget: targetFor(f.source, scenario.target),
    });
    const saved = loadDraft<ReceiptDraft>('receipt', owner.userId, entityId);
    const restored = await initialize(f);
    if (restored.data.amountInput === '97.00') {
      assert.equal(restored.data.targetReviewRequired, true);
      await restored.save();
      assert.equal(receiptRequests(f).length, 0);
    } else {
      assert.equal(restored.data.amountInput, '20.00', 'An ignored unrelated draft must leave the normal fresh-form defaults.');
    }
    assert.equal((await f.store.find('participations')).length, 0);
    assert.equal((await f.store.find('rewards')).length, 0);
    assert.deepEqual(draft(restored, entityId), saved, 'Reading an incompatible target cannot relabel its original draft.');
  });
}

test('a late successful pending lookup cannot remove a newer local draft revision', { timeout: 5000 }, async () => {
  const f = await fixture({ failure: 'after-commit' });
  const original = await initialize(f);
  changeAmount(original, '24.50');
  await original.save();
  original.onUnload();
  f.setDate('2026-10-01');
  const restored = await initialize(f);
  let release!: () => void;
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  f.onDispatch(async request => {
    if (request.action === 'request.replay') { started(); await paused; }
  });
  const lookup = restored.resolvePendingCreation();
  await dispatched;
  const replacement: ReceiptDraft = {
    amountInput: '99.00', receivedOn: '2026-10-01', intentKey: createCommandIntent(),
    draftTarget: targetFor(f.source, { periodKey: '2026-10', startsOn: '2026-10-01', endsOn: '2026-10-31' }),
  };
  saveDraft('receipt', owner.userId, restored.data.draftEntityId, null, replacement);
  const newer = structuredClone(draft(restored));
  release();
  await lookup;
  assert.deepEqual(draft(restored), newer);
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(replayRequests(f).length, 1);
  assert.equal((await f.store.find('participations')).length, 1);
  assert.equal((await f.store.find<Reward>('rewards'))[0].amountMinor, 2450);
});

test('declining a pending receipt keeps its evidence and blocks edits and fresh submissions until recovery resumes', async () => {
  const f = await fixture({ failure: 'after-commit' });
  const original = await initialize(f);
  changeAmount(original, '59.25');
  await original.save();
  const entityId = original.data.draftEntityId;
  const saved = structuredClone(draft(original));
  const first = receiptRequests(f)[0];
  original.onUnload();
  f.setDate('2026-10-01');
  modalConfirmed = false;
  const restored = page(f);
  await restored.load();
  assert.equal(restored.data.loading, false);
  assert.equal(restored.data.unresolvedDraft, true);
  assert.ok(restored.data.loadError);
  assert.equal(restored.data.pendingCreation, null);
  assert.equal(modalCalls, 1);
  assert.equal(modalOptions[0].title, '发现待核对的保存结果');
  assert.equal(modalOptions[0].cancelText, '暂不核对');
  assert.deepEqual(draft(restored, entityId), saved);
  const defaultAmount = restored.data.amountInput;
  const defaultDate = restored.data.receivedOn;
  const beforeAttempts = await f.store.exportSeed();
  changeAmount(restored, '99.99');
  changeDate(restored, '2026-10-01');
  await restored.confirmDraftTarget();
  await restored.save();
  assert.equal(restored.persistDraft(), false);
  assert.equal(restored.data.amountInput, defaultAmount);
  assert.equal(restored.data.receivedOn, defaultDate);
  assert.deepEqual(draft(restored, entityId), saved, 'Declining recovery must preserve the original pending revision and request evidence.');
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(replayRequests(f).length, 0);
  assert.deepEqual(await f.store.exportSeed(), beforeAttempts);
  assert.equal(navigations.length, 0);

  modalConfirmed = true;
  await restored.load();
  assert.equal(modalCalls, 2);
  assert.deepEqual(modalOptions[1], modalOptions[0]);
  assert.equal(restored.data.unresolvedDraft, false);
  assert.equal(restored.data.loadError, '');
  assert.deepEqual(restored.data.pendingCreation, saved?.value.pendingCreation);
  assert.equal(restored.data.amountInput, '59.25');
  assert.equal(restored.data.pendingReplayOnly, true);
  assert.deepEqual(draft(restored, entityId), saved);
  await restored.save();
  assert.equal(receiptRequests(f).length, 1);
  assert.equal(replayRequests(f).length, 1);
  assert.equal(replayRequests(f)[0].payload.requestId, first.requestId);
  assert.deepEqual(replayRequests(f)[0].payload.payload, first.payload);
  assert.deepEqual(await f.store.exportSeed(), beforeAttempts);
  assert.equal(draft(restored, entityId), null);
  assert.equal((await f.store.find<Reward>('rewards'))[0].amountMinor, 5925);
  assert.equal(navigations.length, 1);
});

for (const failure of ['before-commit', 'after-commit'] as const) {
  test(`a live September pending receipt refreshes the server date and only replays in October after ${failure}`, async () => {
    const f = await fixture({ failure });
    const instance = await initialize(f);
    changeAmount(instance, '67.50');
    await instance.save();
    const first = receiptRequests(f)[0];
    const saved = structuredClone(draft(instance));
    assert.equal(instance.data.pendingReplayOnly, false);
    assert.equal(instance.data.serverToday, '2026-09-30');
    assert.equal(instance.data.currentTarget.periodKey, '2026-09');
    f.setDate('2026-10-01');
    const beforeLookup = await f.store.exportSeed();
    const requestCount = f.requests.length;
    await instance.save();
    const retryRequests = f.requests.slice(requestCount);
    assert.deepEqual(retryRequests.map(request => request.action), ['session.get', 'request.replay']);
    assert.equal(instance.data.serverToday, '2026-10-01');
    assert.equal(instance.data.currentTarget.periodKey, '2026-09', 'The live page must detect rollover without replacing the originally displayed target.');
    assert.equal(receiptRequests(f).length, 1);
    assert.equal(replayRequests(f).length, 1);
    assert.equal(replayRequests(f)[0].payload.requestId, first.requestId);
    assert.deepEqual(replayRequests(f)[0].payload.payload, first.payload);
    assert.deepEqual(await f.store.exportSeed(), beforeLookup);
    assert.equal(modalCalls, 0);
    if (failure === 'before-commit') {
      assert.equal(instance.data.pendingReplayOnly, true);
      assert.deepEqual(draft(instance), saved);
      assert.deepEqual(instance.data.pendingCreation, saved?.value.pendingCreation);
      assert.ok(instance.data.formError);
      assert.equal((await f.store.find('participations')).length, 0);
      assert.equal((await f.store.find('rewards')).length, 0);
      assert.equal(navigations.length, 0);
    } else {
      assert.equal(draft(instance), null);
      assert.equal(instance.data.pendingCreation, null);
      assert.equal((await f.store.find('participations')).length, 1);
      const ledger = await f.store.find<Reward>('rewards');
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].activityPeriod, '2026-09');
      assert.equal(ledger[0].amountMinor, 6750);
      assert.equal(navigations.length, 1);
    }
  });
}

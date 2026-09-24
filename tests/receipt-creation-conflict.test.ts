import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiRequest, Card, Commands, MutationResult, Participation, Queries, Reward } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { addDays, todayCN } from '../domain/calendar';
import { api, ensureSession } from '../miniprogram/services/api';
import { draftKey, loadDraft } from '../miniprogram/services/form-draft';

const owner: Actor = { userId: 'receipt-owner', isModerator: false };
const other: Actor = { userId: 'receipt-other', isModerator: false };

function activity(scope: Activity['scope']): Activity {
  return {
    id: 'receipt-activity', revision: 1, status: 'published', title: 'Monthly benefit',
    bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa credit card',
    frequency: 'monthly', startsOn: '2020-01-01', endsOn: '2099-12-31', target: 3, unit: 'count',
    currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope,
    requiresRegistration: true, requiresInvitation: false, conditions: 'Three purchases', sourceUrl: '', sourceNote: '',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the bank app', imageIds: [] },
    publishedAt: '2020-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2020-01-01T00:00:00Z',
  };
}

function card(id: string, actor = owner): Card {
  return { id, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: id, createdAt: '2020-01-01T00:00:00Z' };
}

function fixture(scope: Activity['scope'] = 'card', overrides: Partial<Activity> = {}) {
  const source = { ...activity(scope), ...overrides };
  const cards = [card('card-a'), card('card-b'), card('card-c'), card('card-other', other)];
  const store = new MemoryStore({ activities: { [source.id]: source }, cards: Object.fromEntries(cards.map(row => [row.id, row])) });
  let now = new Date('2026-09-20T04:00:00.000Z');
  let nextRequest = 0;
  const service = createService(store, { now: () => now, demo: true });
  return {
    store, service, source,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
    query: <K extends keyof Queries>(action: K, payload: Queries[K]['input'], actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<Queries[K]['output']>,
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `receipt-request-${++nextRequest}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
  };
}

function errorCode(expected: string) { return (error: unknown) => error instanceof DomainError && error.code === expected; }

const firstReceipt = (cardId = 'card-a'): Commands['reward.confirm'] => ({
  activityId: 'receipt-activity', cardId, amountMinor: 1825, receivedOn: '2026-09-18', expectNew: true,
});

for (const scope of ['user', 'card'] as const) {
  test(`two new ${scope}-scope receipt forms cannot overwrite the first committed receipt`, async () => {
    const f = fixture(scope);
    const first = firstReceipt();
    const second = { ...firstReceipt(scope === 'user' ? 'card-b' : 'card-a'), amountMinor: 2975, receivedOn: '2026-09-19' };
    assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: first.cardId })).participation, null);
    assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: second.cardId })).participation, null);

    const results = await Promise.allSettled([f.command('reward.confirm', first), f.command('reward.confirm', second)]);
    const winnerIndex = results.findIndex(result => result.status === 'fulfilled');
    const winner = results[winnerIndex] as PromiseFulfilledResult<MutationResult>;
    const loser = results[1 - winnerIndex] as PromiseRejectedResult;
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(errorCode('VERSION_CONFLICT')(loser.reason), true);
    const expected = [first, second][winnerIndex];
    const records = await f.store.find<Participation>('participations');
    const rewards = await f.store.find<Reward>('rewards');
    assert.equal(records.length, 1);
    assert.equal(rewards.length, 1);
    assert.equal(records[0].id, winner.value.id);
    assert.equal(records[0].receivedMinor, expected.amountMinor);
    assert.equal(records[0].receivedOn, expected.receivedOn);
    assert.equal(records[0].periodKey, '2026-09');
    assert.deepEqual(records[0].snapshot, f.source);
    assert.equal(rewards[0].amountMinor, expected.amountMinor);
    assert.equal(rewards[0].receivedOn, expected.receivedOn);
    assert.equal(rewards[0].activityPeriod, '2026-09');
    assert.equal((await f.store.find('requests')).length, 1);
    assert.equal((await f.store.find('audit_events')).length, 3);
  });
}

test('card-specific reads and first receipts remain independent for two cards and the current period', async () => {
  const f = fixture();
  const previous = await f.command('activity.join', { activityId: f.source.id, cardId: 'card-a' });
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' })).participation, null);
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' })).tracking, null);
  f.setDate('2026-10-02');
  const [a, b] = await Promise.all(['card-a', 'card-b'].map(cardId => f.command('reward.confirm', {
    ...firstReceipt(cardId), receivedOn: '2026-10-02',
  })));
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, previous.id);
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-a' })).participation?.id, a.id);
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' })).participation?.id, b.id);
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-c' })).participation, null);
  assert.equal((await f.query('activity.get', { participationId: previous.id, cardId: 'card-a' })).participation?.periodKey, '2026-09');
  await assert.rejects(f.query('activity.get', { participationId: a.id, cardId: 'card-b' }), errorCode('NOT_FOUND'));
});

test('first-receipt request replay stays idempotent before and after a later correction', async () => {
  const f = fixture();
  const payload = firstReceipt();
  const [created, concurrentReplay] = await Promise.all([
    f.command('reward.confirm', payload, owner, 'same-request'),
    f.command('reward.confirm', payload, owner, 'same-request'),
  ]);
  assert.deepEqual(concurrentReplay, created);
  const corrected = await f.command('reward.confirm', { participationId: created.id, expectedVersion: created.version, amountMinor: 3300, receivedOn: '2026-09-19' });
  const beforeReplay = await f.store.exportSeed();
  assert.deepEqual(await f.command('reward.confirm', payload, owner, 'same-request'), created);
  assert.deepEqual(await f.store.exportSeed(), beforeReplay);
  assert.equal((await f.store.get<Participation>('participations', created.id))?.version, corrected.version);
  await assert.rejects(f.command('reward.confirm', { ...payload, amountMinor: 9999 }, owner, 'same-request'), errorCode('REQUEST_CONFLICT'));
  assert.equal((await f.store.find<Reward>('rewards'))[0].amountMinor, 3300);
});

test('the absence guard and selected-card query cannot cross owners', async () => {
  const f = fixture('user');
  const [a, b] = await Promise.all([
    f.command('reward.confirm', firstReceipt('card-a'), owner, 'same-owner-local-id'),
    f.command('reward.confirm', firstReceipt('card-other'), other, 'same-owner-local-id'),
  ]);
  assert.notEqual(a.id, b.id);
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-a' })).participation?.id, a.id);
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-other' }, other)).participation?.id, b.id);
  await assert.rejects(f.query('activity.get', { activityId: f.source.id, cardId: 'card-other' }), errorCode('NOT_FOUND'));
  await assert.rejects(f.query('activity.get', { participationId: a.id }, other), errorCode('NOT_FOUND'));
  await assert.rejects(f.command('reward.confirm', { participationId: a.id, expectedVersion: a.version, amountMinor: 500, receivedOn: '2026-09-19' }, other), errorCode('NOT_FOUND'));
  await assert.rejects(f.command('reward.confirm', firstReceipt('card-a'), other), errorCode('NOT_FOUND'));
  assert.equal((await f.store.find('rewards')).length, 2);
});

test('a concurrently created participation requires reloading even before a receipt has been recorded', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: f.source.id, cardId: 'card-a' });
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('reward.confirm', firstReceipt()), errorCode('VERSION_CONFLICT'));
  assert.deepEqual(await f.store.exportSeed(), before);
  const latest = await f.query('activity.get', { activityId: f.source.id, cardId: 'card-a' });
  const saved = await f.command('reward.confirm', {
    participationId: latest.participation!.id, expectedVersion: latest.participation!.version, amountMinor: 2300, receivedOn: '2026-09-19',
  });
  assert.equal(saved.id, joined.id);
  assert.equal((await f.store.find('rewards')).length, 1);
});

test('invalid absence guards and invalid dates roll back all first-receipt side effects', async () => {
  const f = fixture();
  const invalidGuards = [
    { expectNew: 'true' }, { expectNew: true, expectedVersion: 0 }, { expectNew: true, participationId: '' },
  ];
  for (const invalid of invalidGuards) {
    await assert.rejects(f.command('reward.confirm', { ...firstReceipt(), ...invalid } as Commands['reward.confirm']), errorCode('INVALID_INPUT'));
  }
  await assert.rejects(f.command('reward.confirm', { ...firstReceipt(), receivedOn: '2026-08-31' }), errorCode('INVALID_INPUT'));
  await assert.rejects(f.command('reward.confirm', { ...firstReceipt(), receivedOn: '2026-09-21' }), errorCode('INVALID_INPUT'));
  await assert.rejects(f.command('reward.confirm', { ...firstReceipt(), amountMinor: -1 }), errorCode('INVALID_INPUT'));
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal((await f.store.find('rewards')).length, 0);
  assert.equal((await f.store.find('audit_events')).length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
});

test('conflict reload and explicit correction preserve the original snapshot and period while receipt dates remain validated', async () => {
  const f = fixture();
  await f.command('reward.confirm', firstReceipt('card-b'));
  const original = (await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' })).participation!;
  await f.store.set('activities', f.source.id, { ...f.source, revision: 2, title: 'Changed benefit', rewardMinor: 9900 });
  await assert.rejects(f.command('reward.confirm', { ...firstReceipt('card-b'), amountMinor: 4500 }), errorCode('VERSION_CONFLICT'));
  const latest = await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' });
  assert.equal(latest.participation?.id, original.id);
  assert.deepEqual(latest.activity, original.snapshot);
  f.setDate('2026-10-02');
  const corrected = await f.command('reward.confirm', {
    participationId: original.id, expectedVersion: latest.participation!.version, amountMinor: 4500, receivedOn: '2026-10-02',
  });
  const beforeInvalid = await f.store.exportSeed();
  for (const receivedOn of ['2026-08-31', '2026-10-03']) {
    await assert.rejects(f.command('reward.confirm', { participationId: original.id, expectedVersion: corrected.version, amountMinor: 1, receivedOn }), errorCode('INVALID_INPUT'));
  }
  assert.deepEqual(await f.store.exportSeed(), beforeInvalid);
  const result = (await f.query('activity.get', { participationId: original.id })).participation!;
  assert.equal(result.periodKey, original.periodKey);
  assert.equal(result.startsOn, original.startsOn);
  assert.equal(result.endsOn, original.endsOn);
  assert.deepEqual(result.snapshot, original.snapshot);
  assert.equal(result.receivedOn, '2026-10-02');
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].activityPeriod, '2026-09');
  assert.equal(ledger[0].title, original.snapshot.title);
  assert.equal(ledger[0].receivedOn, '2026-10-02');
});

test('user-scope reload accepts the existing record linked to another owned card and legacy callers remain supported', async () => {
  const f = fixture('user');
  const created = await f.command('reward.confirm', { ...firstReceipt(), expectNew: undefined });
  const latest = await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' });
  assert.equal(latest.participation?.id, created.id);
  assert.equal(latest.participation?.cardId, 'card-a');
  await f.command('card.remove', { id: 'card-a' });
  assert.equal((await f.query('activity.get', { activityId: f.source.id, cardId: 'card-a' })).participation?.id, created.id);
  await f.command('reward.confirm', { participationId: created.id, amountMinor: 5700, receivedOn: '2026-09-20' });
  assert.equal((await f.store.find<Reward>('rewards'))[0].amountMinor, 5700);
});

let receiptDefinition: any;
let controllerFixture: ReturnType<typeof fixture>;
let storage = new Map<string, unknown>();
let commandCalls: { action: string; payload: any; options?: { intentKey?: string; replayOnly?: boolean } }[] = [];
let queryCalls: { action: string; payload: any }[] = [];
let navigations = 0;

before(async () => {
  (globalThis as any).Page = (definition: any) => { receiptDefinition = definition; };
  await import('../miniprogram/pages/receipt/index');
});

beforeEach(async () => {
  storage = new Map(); commandCalls = []; queryCalls = []; navigations = 0;
  controllerFixture = fixture('card', { frequency: 'once' });
  controllerFixture.setDate(todayCN());
  (globalThis as any).getCurrentPages = () => [];
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    nextTick: (callback: () => void) => callback(), pageScrollTo: () => {}, showToast: () => {},
    setNavigationBarTitle: () => {}, enableAlertBeforeUnload: () => {}, disableAlertBeforeUnload: () => {},
    showModal: async () => ({ confirm: true }),
    redirectTo: () => { navigations += 1; }, navigateBack: () => { navigations += 1; },
  };
  api.query = (async (action: keyof Queries, payload: any) => {
    queryCalls.push({ action, payload });
    return controllerFixture.query(action, payload);
  }) as typeof api.query;
  api.command = (async (action: keyof Commands, payload: any, options?: { intentKey?: string; replayOnly?: boolean }) => {
    commandCalls.push({ action, payload, options });
    return controllerFixture.command(action, payload);
  }) as typeof api.command;
  await ensureSession(true);
});

async function receiptPage(cardId: string, participationId = '') {
  const instance: any = { ...receiptDefinition, data: structuredClone(receiptDefinition.data) };
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch);
  instance.setData({ activityId: controllerFixture.source.id, cardId, participationId });
  await instance.load();
  assert.equal(instance.data.loadError, '');
  return instance;
}

test('real-service receipt controllers keep stale first-form input until exact-card reload and explicit reapply', async () => {
  const f = controllerFixture;
  const currentDate = todayCN();
  await f.command('reward.confirm', { ...firstReceipt('card-a'), receivedOn: currentDate });
  const first = await receiptPage('card-b');
  const second = await receiptPage('card-b');
  assert.equal(first.data.participation, null);
  assert.equal(second.data.participation, null);
  first.onAmountInput({ detail: { value: '42.75' } });
  first.onDateChange({ detail: { value: currentDate } });
  second.onAmountInput({ detail: { value: '18.25' } });
  second.onDateChange({ detail: { value: addDays(currentDate, -1) } });
  await second.save();
  const latestBefore = (await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' })).participation!;
  const beforeStale = await f.store.exportSeed();
  await first.save();
  assert.equal(first.data.conflict, true);
  assert.equal(first.data.amountInput, '42.75');
  assert.equal(first.data.receivedOn, currentDate);
  assert.equal(commandCalls[0].payload.expectNew, true);
  assert.equal(commandCalls[1].payload.expectNew, true);
  assert.equal(commandCalls[0].payload.expectedPeriodKey, 'once');
  assert.equal(commandCalls[1].payload.expectedPeriodKey, 'once');
  assert.ok(commandCalls[0].options?.intentKey);
  assert.ok(commandCalls[1].options?.intentKey);
  assert.notEqual(commandCalls[0].options?.intentKey, commandCalls[1].options?.intentKey);
  assert.deepEqual(await f.store.exportSeed(), beforeStale);
  assert.equal(navigations, 1);
  const commandCount = commandCalls.length;
  await first.save();
  assert.equal(commandCalls.length, commandCount);
  await first.reloadLatest();
  assert.equal(queryCalls.filter(call => call.action === 'activity.get').at(-1)?.payload.cardId, 'card-b');
  assert.equal(first.data.participation.id, latestBefore.id);
  assert.equal(first.data.conflict, false);
  assert.equal(first.data.reapplyRequired, true);
  assert.equal(first.data.amountInput, '42.75');
  assert.equal(first.data.receivedOn, currentDate);
  assert.equal(commandCalls.length, commandCount);
  assert.equal(loadDraft<{ amountInput: string }>('receipt', owner.userId, first.data.draftEntityId)?.value.amountInput, '42.75');
  assert.equal(loadDraft('receipt', owner.userId, first.data.creationDraftEntityId), null);
  await first.save();
  const correction = commandCalls.at(-1)!.payload;
  assert.equal(correction.expectNew, undefined);
  assert.equal(correction.participationId, latestBefore.id);
  assert.equal(correction.expectedVersion, latestBefore.version);
  assert.equal(correction.expectedPeriodKey, undefined);
  assert.equal(commandCalls.at(-1)!.options, undefined);
  const latestAfter = (await f.query('activity.get', { activityId: f.source.id, cardId: 'card-b' })).participation!;
  assert.equal(latestAfter.receivedMinor, 4275);
  assert.equal(latestAfter.receivedOn, currentDate);
  assert.equal((await f.store.find('rewards')).length, 2);
  assert.deepEqual(latestAfter.snapshot, latestBefore.snapshot);
  assert.equal(latestAfter.periodKey, latestBefore.periodKey);
  assert.equal(storage.has(draftKey('receipt', owner.userId, first.data.draftEntityId)), false);
  assert.equal(navigations, 2);
});

test('a user-scope controller reloads the existing receipt even when another form used a different card', async () => {
  controllerFixture = fixture('user', { frequency: 'once' });
  controllerFixture.setDate(todayCN());
  const first = await receiptPage('card-b');
  first.onAmountInput({ detail: { value: '35.00' } });
  const winner = await controllerFixture.command('reward.confirm', { ...firstReceipt('card-a'), receivedOn: todayCN() });
  await first.save();
  assert.equal(first.data.conflict, true);
  await first.reloadLatest();
  assert.equal(first.data.participation.id, winner.id);
  assert.equal(first.data.participation.cardId, 'card-a');
  assert.equal(first.data.amountInput, '35.00');
  assert.equal(first.data.reapplyRequired, true);
  await first.save();
  assert.equal(commandCalls.at(-1)!.payload.participationId, winner.id);
  assert.equal((await controllerFixture.store.find<Reward>('rewards'))[0].amountMinor, 3500);
  assert.equal((await controllerFixture.store.find('rewards')).length, 1);
});

test('reopening a conflicted first receipt restores its creation draft against the committed record without saving', async () => {
  const first = await receiptPage('card-b');
  first.onAmountInput({ detail: { value: '51.25' } });
  const receivedOn = addDays(todayCN(), -1);
  first.onDateChange({ detail: { value: receivedOn } });
  const winner = await controllerFixture.command('reward.confirm', { ...firstReceipt('card-b'), receivedOn: todayCN() });
  await first.save();
  assert.equal(first.data.conflict, true);
  const creationDraftEntityId = first.data.draftEntityId;
  assert.ok(loadDraft('receipt', owner.userId, creationDraftEntityId));
  first.onUnload();
  const beforeReopen = await controllerFixture.store.exportSeed();
  const commandCount = commandCalls.length;
  const reopened = await receiptPage('card-b');
  assert.equal(reopened.data.participation.id, winner.id);
  assert.equal(reopened.data.amountInput, '51.25');
  assert.equal(reopened.data.receivedOn, receivedOn);
  assert.equal(reopened.data.reapplyRequired, true);
  assert.equal(commandCalls.length, commandCount);
  assert.deepEqual(await controllerFixture.store.exportSeed(), beforeReopen);
  assert.equal(loadDraft('receipt', owner.userId, creationDraftEntityId), null);
  assert.equal(loadDraft<{ amountInput: string }>('receipt', owner.userId, winner.id)?.value.amountInput, '51.25');
  await reopened.save();
  assert.equal((await controllerFixture.store.find<Reward>('rewards'))[0].amountMinor, 5125);
  assert.equal((await controllerFixture.store.find('rewards')).length, 1);
});

test('a user-scope creation draft can be recovered through the winning participation route without the original card', async () => {
  controllerFixture = fixture('user', { frequency: 'once' });
  controllerFixture.setDate(todayCN());
  const first = await receiptPage('card-b');
  first.onAmountInput({ detail: { value: '64.75' } });
  const winner = await controllerFixture.command('reward.confirm', { ...firstReceipt('card-a'), receivedOn: todayCN() });
  await first.save();
  assert.equal(first.data.conflict, true);
  assert.equal(first.data.creationDraftEntityId, `new:${controllerFixture.source.id}:user`);
  first.onUnload();
  const commandCount = commandCalls.length;
  const reopened = await receiptPage('', winner.id);
  assert.equal(reopened.data.participation.id, winner.id);
  assert.equal(reopened.data.participation.cardId, 'card-a');
  assert.equal(reopened.data.amountInput, '64.75');
  assert.equal(reopened.data.reapplyRequired, true);
  assert.equal(commandCalls.length, commandCount);
  assert.equal(loadDraft('receipt', owner.userId, first.data.creationDraftEntityId), null);
  await reopened.save();
  assert.equal((await controllerFixture.store.find<Reward>('rewards'))[0].amountMinor, 6475);
  assert.equal((await controllerFixture.store.find('rewards')).length, 1);
});

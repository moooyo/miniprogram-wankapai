import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiEnvelope, ApiRequest, Bill, BillingAccount, Card, Commands, Participation, Reward, Tracking } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';
import { createCommandIntent } from '../miniprogram/services/form-draft';

type RecordedRequest = { action: ApiRequest['action']; payload: any; requestId?: string };
type CloudResponse = { result: ApiEnvelope<unknown> };
type Transport = (request: RecordedRequest, commit: () => Promise<CloudResponse>) => Promise<CloudResponse>;

const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId };
let fixtureSequence = 0;
let requests: RecordedRequest[];
let transport: Transport;
let f: ReturnType<typeof fixture>;

function fixture() {
  const prefix = `retry-${++fixtureSequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: true };
  const source: Activity = {
    id: `${prefix}-activity`, revision: 1, status: 'published', title: 'Receipt benefit',
    bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa credit card',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31', target: 3, unit: 'count', currency: 'CNY',
    rewardMinor: 2000, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false,
    conditions: 'Three purchases', sourceUrl: '', sourceNote: 'Verified source',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open benefits', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: actor.userId, updatedAt: '2026-01-01T00:00:00Z',
  };
  const ids = { bill: `${prefix}-bill`, otherBill: `${prefix}-other-bill`, participation: `${prefix}-participation`, card: `${prefix}-card` };
  const record: Participation = {
    id: ids.participation, ownerId: actor.userId, activityId: source.id, activityRevision: 1, scopeKey: 'user', snapshot: source,
    periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30', stage: 'available', progress: 0,
    registeredAt: null, startedAt: null, completedAt: null, expectedOn: null, receivedOn: null, receivedMinor: null,
    version: 1, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  };
  const bill = (id: string): Bill => ({ id, ownerId: actor.userId, billingAccountId: `${id}-account`, periodKey: '2026-09', statementOn: '2026-09-01', dueOn: '2026-09-25', paidAt: null });
  const savedCard: Card = { id: ids.card, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Existing card', createdAt: '2026-09-01T00:00:00Z' };
  const store = new MemoryStore({
    activities: { [source.id]: source }, participations: { [record.id]: record },
    bills: { [ids.bill]: bill(ids.bill), [ids.otherBill]: bill(ids.otherBill) }, cards: { [savedCard.id]: savedCard },
  });
  let now = new Date('2026-09-20T04:00:00.000Z');
  const service = createService(store, { now: () => now, demo: true });
  return { prefix, actor, ids, source, store, service, setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); } };
}

beforeEach(async () => {
  f = fixture(); requests = [];
  settings.mode = 'cloud'; settings.cloudEnvId = 'retry-test-environment';
  transport = async (_request, commit) => commit();
  (globalThis as any).wx = {
    cloud: {
      init: () => {},
      callFunction: async ({ data }: { data: ApiRequest }) => {
        const request = structuredClone(data) as RecordedRequest;
        requests.push(request);
        return transport(request, async () => {
          try { return { result: { ok: true, data: await f.service.execute(f.actor, request as ApiRequest) } }; }
          catch (error) {
            if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
            throw error;
          }
        });
      },
    },
  };
  await api.query('session.get', {});
  await api.query('wallet.get', {});
  requests = [];
});

after(() => { settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId; });

function loseFirstResponse(action: RecordedRequest['action'], matches: (payload: any) => boolean = () => true) {
  let lost = false;
  transport = async (request, commit) => {
    const response = await commit();
    if (!lost && request.action === action && matches(request.payload) && response.result.ok) {
      lost = true;
      throw new Error('Response lost after commit');
    }
    return response;
  };
}

function attempts(action: RecordedRequest['action']) { return requests.filter(request => request.action === action); }
function hasCode(code: string) { return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('a confirmed bill reversal retires an earlier lost-response intent before the same paid payload is used again', async () => {
  const paid = { id: f.ids.bill, paid: true };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', paid), hasCode('NETWORK_ERROR'));
  assert.ok((await f.store.get<Bill>('bills', f.ids.bill))?.paidAt);
  await api.command('bill.update', { id: f.ids.bill, paid: false });
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.paidAt, null);
  await api.command('bill.update', paid);
  assert.ok((await f.store.get<Bill>('bills', f.ids.bill))?.paidAt);
  const sent = attempts('bill.update');
  assert.notEqual(sent[2].requestId, sent[0].requestId);
  assert.equal((await f.store.find('audit_events')).length, 3);
});

test('an immediate bill retry reuses the committed request and does not create another audit entry', async () => {
  const payload = { id: f.ids.bill, paid: true };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', payload), hasCode('NETWORK_ERROR'));
  const result = await api.command('bill.update', payload);
  assert.equal(result.id, f.ids.bill);
  assert.equal(attempts('bill.update')[1].requestId, attempts('bill.update')[0].requestId);
  assert.equal((await f.store.find('audit_events')).length, 1);
  assert.equal((await f.store.find('requests')).length, 1);
});

test('a successful update to another bill does not retire an unresolved bill request', async () => {
  const payload = { id: f.ids.bill, paid: true };
  loseFirstResponse('bill.update', value => value.id === f.ids.bill);
  await assert.rejects(api.command('bill.update', payload), hasCode('NETWORK_ERROR'));
  await api.command('bill.update', { id: f.ids.otherBill, paid: true });
  await api.command('bill.update', payload);
  const sent = attempts('bill.update').filter(request => request.payload.id === f.ids.bill);
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.equal((await f.store.find('audit_events')).length, 2);
});

test('a failed later bill change does not discard the earlier network retry identity', async () => {
  const payload = { id: f.ids.bill, paid: true };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', payload), hasCode('NETWORK_ERROR'));
  await assert.rejects(api.command('bill.update', { id: f.ids.bill, paid: false, dueOn: '2026-08-01' }), hasCode('INVALID_DATE'));
  await api.command('bill.update', payload);
  const sent = attempts('bill.update');
  assert.equal(sent[2].requestId, sent[0].requestId);
  assert.ok((await f.store.get<Bill>('bills', f.ids.bill))?.paidAt);
  assert.equal((await f.store.find('audit_events')).length, 1);
});

test('a versioned receipt retry returns the committed result even after an unrelated mutation succeeds', async () => {
  const payload = { participationId: f.ids.participation, expectedVersion: 1, amountMinor: 1850, receivedOn: '2026-09-19' };
  loseFirstResponse('reward.confirm');
  await assert.rejects(api.command('reward.confirm', payload), hasCode('NETWORK_ERROR'));
  await api.command('bill.update', { id: f.ids.bill, paid: true });
  const retry = await api.command('reward.confirm', payload);
  assert.equal(retry.version, 2);
  assert.equal(attempts('reward.confirm')[1].requestId, attempts('reward.confirm')[0].requestId);
  assert.equal((await f.store.get<Participation>('participations', f.ids.participation))?.version, 2);
  assert.equal((await f.store.find<Reward>('rewards'))[0].version, 1);
});

test('receipt revoke retires the previous receipt intent without changing the server idempotency protocol', async () => {
  const payload = { participationId: f.ids.participation, amountMinor: 1850, receivedOn: '2026-09-19' };
  loseFirstResponse('reward.confirm');
  await assert.rejects(api.command('reward.confirm', payload), hasCode('NETWORK_ERROR'));
  await api.command('reward.revoke', { participationId: f.ids.participation });
  assert.equal((await f.store.get<Participation>('participations', f.ids.participation))?.stage, 'completed');
  await api.command('reward.confirm', payload);
  assert.equal((await f.store.get<Participation>('participations', f.ids.participation))?.stage, 'received');
  const sent = attempts('reward.confirm');
  assert.notEqual(sent[1].requestId, sent[0].requestId);
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].reversedAt, null);
  assert.equal(ledger[0].version, 3);
});

test('a versioned progress retry remains the same intent until a newer progress edit is confirmed', async () => {
  const payload = { participationId: f.ids.participation, progress: 1, registered: true, expectedVersion: 1 };
  loseFirstResponse('participation.progress');
  await assert.rejects(api.command('participation.progress', payload), hasCode('NETWORK_ERROR'));
  const retry = await api.command('participation.progress', payload);
  assert.equal(retry.version, 2);
  assert.equal(attempts('participation.progress')[1].requestId, attempts('participation.progress')[0].requestId);
  assert.equal((await f.store.get<Participation>('participations', f.ids.participation))?.version, 2);
  assert.equal((await f.store.find('audit_events')).length, 1);
});

test('a superseded versioned progress payload reaches the version guard instead of replaying a stale success', async () => {
  const original = { participationId: f.ids.participation, progress: 1, registered: true, expectedVersion: 1 };
  loseFirstResponse('participation.progress');
  await assert.rejects(api.command('participation.progress', original), hasCode('NETWORK_ERROR'));
  await api.command('participation.progress', { participationId: f.ids.participation, progress: 2, registered: true, expectedVersion: 2 });
  await assert.rejects(api.command('participation.progress', original), hasCode('VERSION_CONFLICT'));
  const sent = attempts('participation.progress');
  assert.notEqual(sent[2].requestId, sent[0].requestId);
  assert.equal((await f.store.get<Participation>('participations', f.ids.participation))?.progress, 2);
  assert.equal((await f.store.get<Participation>('participations', f.ids.participation))?.version, 3);
});

test('an unresolved card creation without an ID keeps its retry identity across later known-record changes', async () => {
  const payload: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: `${f.prefix}-new-card` };
  loseFirstResponse('card.save', value => !value.id);
  await assert.rejects(api.command('card.save', payload), hasCode('NETWORK_ERROR'));
  const created = (await f.store.find<Card>('cards')).find(row => row.nickname === payload.nickname)!;
  assert.ok(created);
  await api.command('card.save', { ...payload, id: created.id, nickname: 'Renamed after refresh' });
  await api.command('bill.update', { id: f.ids.bill, paid: true });
  const retry = await api.command('card.save', payload);
  const sent = attempts('card.save').filter(request => !request.payload.id);
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.equal(retry.id, created.id);
  assert.equal((await f.store.find('cards')).length, 2);
  assert.equal((await f.store.get<Card>('cards', created.id))?.nickname, 'Renamed after refresh');
});

test('known card edits and singleton preferences retire only their own superseded payloads', async () => {
  const cardPayload: Commands['card.save'] = { id: f.ids.card, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'First name' };
  loseFirstResponse('card.save');
  await assert.rejects(api.command('card.save', cardPayload), hasCode('NETWORK_ERROR'));
  await api.command('card.save', { ...cardPayload, nickname: 'Second name' });
  await api.command('card.save', cardPayload);
  assert.equal((await f.store.get<Card>('cards', f.ids.card))?.nickname, 'First name');
  const cardSent = attempts('card.save');
  assert.notEqual(cardSent[2].requestId, cardSent[0].requestId);

  const preferences = { newActivities: true, deadlines: false, rewards: false, repayments: false };
  loseFirstResponse('preferences.save');
  await assert.rejects(api.command('preferences.save', preferences), hasCode('NETWORK_ERROR'));
  await api.command('preferences.save', { ...preferences, newActivities: false });
  await api.command('preferences.save', preferences);
  assert.equal((await api.query('preferences.get', {})).newActivities, true);
  const preferencesSent = attempts('preferences.save');
  assert.notEqual(preferencesSent[2].requestId, preferencesSent[0].requestId);
});

test('identical concurrent calls share the same promise and request identity', async () => {
  const gate = deferred<void>();
  transport = async (_request, commit) => { await gate.promise; return commit(); };
  const payload = { id: f.ids.bill, paid: true };
  const first = api.command('bill.update', payload);
  const duplicate = api.command('bill.update', payload);
  assert.equal(first, duplicate);
  assert.equal(attempts('bill.update').length, 1);
  gate.resolve();
  assert.deepEqual(await first, await duplicate);
  assert.equal((await f.store.find('audit_events')).length, 1);
});

for (const oldOutcome of ['success', 'network-error', 'server-error'] as const) {
  test(`an older ${oldOutcome} response cannot revive its retry token or clear a newer identical inflight command`, async () => {
    const originalCommitted = deferred<void>();
    const releaseOriginal = deferred<void>();
    const replacementCommitted = deferred<void>();
    const releaseReplacement = deferred<void>();
    let paidCalls = 0;
    transport = async (request, commit) => {
      const response = await commit();
      if (request.action === 'bill.update' && request.payload.paid === true) {
        paidCalls += 1;
        if (paidCalls === 1) {
          originalCommitted.resolve();
          await releaseOriginal.promise;
          if (oldOutcome === 'network-error') throw new Error('Delayed network failure');
          if (oldOutcome === 'server-error') return { result: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Delayed server failure' } } };
        } else if (paidCalls === 2) {
          replacementCommitted.resolve();
          await releaseReplacement.promise;
        }
      }
      return response;
    };
    const payload = { id: f.ids.bill, paid: true };
    const original = api.command('bill.update', payload);
    const originalResult = original.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    await originalCommitted.promise;
    await api.command('bill.update', { id: f.ids.bill, paid: false });
    const replacement = api.command('bill.update', payload);
    assert.notEqual(replacement, original);
    await replacementCommitted.promise;
    releaseOriginal.resolve();
    const outcome = await originalResult;
    if (oldOutcome === 'success') assert.equal(outcome.value?.id, f.ids.bill);
    else assert.equal(hasCode(oldOutcome === 'network-error' ? 'NETWORK_ERROR' : 'INTERNAL_ERROR')(outcome.error), true);
    const duplicate = api.command('bill.update', payload);
    assert.equal(duplicate, replacement);
    assert.equal(attempts('bill.update').length, 3);
    releaseReplacement.resolve();
    await replacement;
    assert.ok((await f.store.get<Bill>('bills', f.ids.bill))?.paidAt);
    const sent = attempts('bill.update');
    assert.notEqual(sent[2].requestId, sent[0].requestId);
    assert.equal((await f.store.find('audit_events')).length, 3);
  });
}

test('a delayed old network failure cannot replace the retry identity of a newer lost-response intent', async () => {
  const originalCommitted = deferred<void>();
  const releaseOriginal = deferred<void>();
  const replacementCommitted = deferred<void>();
  const releaseReplacement = deferred<void>();
  let paidCalls = 0;
  transport = async (request, commit) => {
    const response = await commit();
    if (request.action === 'bill.update' && request.payload.paid === true) {
      paidCalls += 1;
      if (paidCalls === 1) {
        originalCommitted.resolve();
        await releaseOriginal.promise;
        throw new Error('Original response lost');
      }
      if (paidCalls === 2) {
        replacementCommitted.resolve();
        await releaseReplacement.promise;
        throw new Error('Replacement response lost');
      }
    }
    return response;
  };
  const payload = { id: f.ids.bill, paid: true };
  const original = api.command('bill.update', payload).catch(error => error);
  await originalCommitted.promise;
  await api.command('bill.update', { id: f.ids.bill, paid: false });
  const replacement = api.command('bill.update', payload).catch(error => error);
  await replacementCommitted.promise;
  releaseOriginal.resolve();
  assert.equal(hasCode('NETWORK_ERROR')(await original), true);
  releaseReplacement.resolve();
  assert.equal(hasCode('NETWORK_ERROR')(await replacement), true);
  await api.command('bill.update', payload);
  const sent = attempts('bill.update');
  assert.notEqual(sent[2].requestId, sent[0].requestId);
  assert.equal(sent[3].requestId, sent[2].requestId);
  assert.equal((await f.store.find('audit_events')).length, 3);
});

for (const scope of ['user', 'card'] as const) {
  test(`observed ${scope}-scope tracking connects a lost join, successful untrack, and a new join intent`, async () => {
    await f.store.set('activities', f.source.id, { ...f.source, scope });
    await f.store.remove('participations', f.ids.participation);
    const payload = { activityId: f.source.id, cardId: f.ids.card };
    loseFirstResponse('activity.join');
    await assert.rejects(api.command('activity.join', payload), hasCode('NETWORK_ERROR'));
    const detail = await api.query('activity.get', payload);
    assert.ok(detail.participation);
    await api.command('activity.untrack', { participationId: detail.participation.id });
    assert.equal((await f.store.find<Tracking>('trackings'))[0].enabled, false);
    const joined = await api.command('activity.join', payload);
    assert.equal(joined.id, detail.participation.id);
    assert.equal((await f.store.find<Tracking>('trackings'))[0].enabled, true);
    const sent = attempts('activity.join');
    assert.notEqual(sent[1].requestId, sent[0].requestId);
  });
}

test('tracking observations preserve independent card retries and unify two cards only for user-scope activities', async () => {
  const secondCard = { ...(await f.store.get<Card>('cards', f.ids.card))!, id: `${f.prefix}-second-card` };
  await f.store.set('cards', secondCard.id, secondCard);
  await f.store.set('activities', f.source.id, { ...f.source, scope: 'card' });
  await f.store.remove('participations', f.ids.participation);
  await api.query('activity.get', { activityId: f.source.id, cardId: f.ids.card });
  const firstPayload = { activityId: f.source.id, cardId: f.ids.card };
  loseFirstResponse('activity.join', value => value.cardId === f.ids.card);
  await assert.rejects(api.command('activity.join', firstPayload), hasCode('NETWORK_ERROR'));
  const second = await api.command('activity.join', { activityId: f.source.id, cardId: secondCard.id });
  await api.query('history.list', { activityId: f.source.id });
  await api.command('activity.untrack', { participationId: second.id });
  await api.command('activity.join', firstPayload);
  const firstAttempts = attempts('activity.join').filter(request => request.payload.cardId === f.ids.card);
  assert.equal(firstAttempts[1].requestId, firstAttempts[0].requestId);

  const userActivity = { ...f.source, id: `${f.source.id}-user`, scope: 'user' as const };
  await f.store.set('activities', userActivity.id, userActivity);
  await api.query('activity.get', { activityId: userActivity.id });
  const userPayload = { activityId: userActivity.id, cardId: f.ids.card };
  loseFirstResponse('activity.join', value => value.activityId === userActivity.id);
  await assert.rejects(api.command('activity.join', userPayload), hasCode('NETWORK_ERROR'));
  const shared = await api.query('activity.get', { activityId: userActivity.id, cardId: secondCard.id });
  await api.command('activity.untrack', { participationId: shared.participation!.id });
  await api.command('activity.join', { activityId: userActivity.id, cardId: secondCard.id });
  await api.command('activity.join', userPayload);
  const userAttempts = attempts('activity.join').filter(request => request.payload.activityId === userActivity.id && request.payload.cardId === f.ids.card);
  assert.notEqual(userAttempts[1].requestId, userAttempts[0].requestId);
  assert.equal((await f.store.find<Tracking>('trackings')).find(row => row.activityId === userActivity.id)?.enabled, true);
});

async function observeBilling(shared = false) {
  const accountId = `${f.ids.bill}-account`;
  const account: BillingAccount = { id: accountId, ownerId: f.actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', label: 'Primary bill', statementDay: 1, dueDay: 25, dueMonthOffset: 0, remindDays: 3, enabled: true };
  await f.store.set('billing_accounts', accountId, account);
  const card = (await f.store.get<Card>('cards', f.ids.card))!;
  await f.store.set('cards', card.id, { ...card, billingAccountId: accountId });
  if (shared) await f.store.set('cards', `${f.prefix}-shared-card`, { ...card, id: `${f.prefix}-shared-card`, billingAccountId: accountId });
  await api.query('session.get', {});
  await api.query('wallet.get', {});
  const payload: Commands['card.save'] = {
    id: card.id, bankId: card.bankId, issuerId: card.issuerId, network: card.network, kind: 'credit', nickname: card.nickname,
    billing: { statementDay: 1, dueDay: 27, dueMonthOffset: 0, dueOn: '2026-09-27', remindDays: 3 },
  };
  return { accountId, payload };
}

test('an observed independent card billing edit retires the old intent for the actual current bill', async () => {
  const { payload } = await observeBilling();
  const dueDate = { id: f.ids.bill, dueOn: '2026-09-26' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', dueDate), hasCode('NETWORK_ERROR'));
  await api.command('card.save', payload);
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-27');
  await api.command('bill.update', dueDate);
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-26');
  const sent = attempts('bill.update');
  assert.notEqual(sent[1].requestId, sent[0].requestId);
});

test('the observed billing relation also retires an old card billing intent after a direct bill correction', async () => {
  const { payload } = await observeBilling();
  loseFirstResponse('card.save');
  await assert.rejects(api.command('card.save', payload), hasCode('NETWORK_ERROR'));
  await api.command('bill.update', { id: f.ids.bill, dueOn: '2026-09-28' });
  await api.command('card.save', payload);
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-27');
  const sent = attempts('card.save');
  assert.notEqual(sent[1].requestId, sent[0].requestId);
});

test('splitting one card from a shared account does not discard a retry for the original bill', async () => {
  const { accountId, payload } = await observeBilling(true);
  const originalDue = { id: f.ids.bill, dueOn: '2026-09-26' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', originalDue), hasCode('NETWORK_ERROR'));
  await api.command('card.save', payload);
  const card = (await f.store.get<Card>('cards', f.ids.card))!;
  assert.notEqual(card.billingAccountId, accountId);
  await api.command('bill.update', originalDue);
  const sent = attempts('bill.update');
  assert.equal(sent[1].requestId, sent[0].requestId);
  const bills = await f.store.find<Bill>('bills');
  assert.equal(bills.find(row => row.id === f.ids.bill)?.dueOn, '2026-09-26');
  assert.equal(bills.find(row => row.billingAccountId === card.billingAccountId)?.dueOn, '2026-09-27');
});

test('a fresh form namespace creates a new identical card while its recovered predecessor remains idempotent', async () => {
  const payload: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: `${f.prefix}-same-card` };
  const oldIntent = createCommandIntent();
  const freshIntent = createCommandIntent();
  assert.notEqual(oldIntent, freshIntent);
  loseFirstResponse('card.save', value => !value.id);
  await assert.rejects(api.command('card.save', payload, { intentKey: oldIntent }), hasCode('NETWORK_ERROR'));
  const original = (await f.store.find<Card>('cards')).find(row => row.nickname === payload.nickname)!;
  await api.command('card.save', { ...payload, id: original.id, nickname: 'Changed existing card' });
  const fresh = await api.command('card.save', payload, { intentKey: freshIntent });
  const recovered = await api.command('card.save', payload, { intentKey: oldIntent });
  assert.notEqual(fresh.id, original.id);
  assert.equal(recovered.id, original.id);
  assert.equal((await f.store.find('cards')).length, 3);
  const sent = attempts('card.save').filter(request => !request.payload.id);
  assert.notEqual(sent[1].requestId, sent[0].requestId);
  assert.equal(sent[2].requestId, sent[0].requestId);
  assert.equal((await f.store.get<Card>('cards', original.id))?.nickname, 'Changed existing card');
});

test('the same persisted namespace reconstructs its request ID after in-memory retry state has been cleared', async () => {
  const namespace = createCommandIntent();
  const payload: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: `${f.prefix}-recovered` };
  const created = await api.command('card.save', payload, { intentKey: namespace });
  const reordered: Commands['card.save'] = { nickname: payload.nickname, kind: 'credit', network: 'visa', issuerId: 'cmb-cn', bankId: 'cmb', billing: undefined };
  const recovered = await api.command('card.save', reordered, { intentKey: namespace });
  assert.deepEqual(recovered, created);
  assert.equal(attempts('card.save')[1].requestId, attempts('card.save')[0].requestId);
  assert.equal((await f.store.find('cards')).length, 2);
});

for (const action of ['submission.lead.save', 'submission.save'] as const) {
  test(`new and recovered ${action} form namespaces remain separate across the same payload`, async () => {
    const namespace = createCommandIntent();
    const payload = action === 'submission.lead.save'
      ? { lead: { title: 'Bank benefit', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app benefits page', imageIds: [] } }
      : { draft: f.source };
    loseFirstResponse(action);
    await assert.rejects(api.command(action, payload, { intentKey: namespace }), hasCode('NETWORK_ERROR'));
    const restored = await api.command(action, payload, { intentKey: namespace });
    const fresh = await api.command(action, payload, { intentKey: createCommandIntent() });
    assert.notEqual(fresh.id, restored.id);
    const replay = await api.command(action, structuredClone(payload), { intentKey: namespace });
    assert.equal(replay.id, restored.id);
    assert.equal((await f.store.find('submissions')).length, 2);
    const sent = attempts(action);
    assert.equal(sent[1].requestId, sent[0].requestId);
    assert.notEqual(sent[2].requestId, sent[0].requestId);
    assert.equal(sent[3].requestId, sent[0].requestId);
  });
}

test('namespaced payload canonicalization keeps nested object order equivalent and array order distinct', async () => {
  const intentKey = createCommandIntent();
  const draft = { ...f.source, networks: ['visa', 'mastercard'] as Activity['networks'] };
  const created = await api.command('submission.save', { draft }, { intentKey });
  const reordered = Object.fromEntries(Object.entries(draft).reverse()) as unknown as Activity;
  reordered.entrance = { imageIds: [], instructions: draft.entrance.instructions, label: draft.entrance.label, kind: 'guide' };
  assert.equal((await api.command('submission.save', { draft: reordered }, { intentKey })).id, created.id);
  const different = await api.command('submission.save', { draft: { ...draft, networks: ['mastercard', 'visa'] } }, { intentKey });
  assert.notEqual(different.id, created.id);
  const sent = attempts('submission.save');
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.notEqual(sent[2].requestId, sent[0].requestId);
  assert.equal((await f.store.find('submissions')).length, 2);
});

for (const outcome of ['confirmed', 'lost-response'] as const) {
test(`a ${outcome} shared-card removal refreshes the account before the remaining card corrects its bill`, async () => {
  const { payload } = await observeBilling(true);
  if (outcome === 'lost-response') {
    loseFirstResponse('card.remove');
    await assert.rejects(api.command('card.remove', { id: `${f.prefix}-shared-card` }), hasCode('NETWORK_ERROR'));
  } else await api.command('card.remove', { id: `${f.prefix}-shared-card` });
  const originalDue = { id: f.ids.bill, dueOn: '2026-09-26' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', originalDue), hasCode('NETWORK_ERROR'));
  await api.command('card.save', payload);
  await api.command('bill.update', originalDue);
  const sent = attempts('bill.update');
  assert.notEqual(sent[1].requestId, sent[0].requestId);
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-26');
});
}

test('a confirmed new card sharing an account prevents later independent-card edits from retiring the original bill retry', async () => {
  const { accountId, payload } = await observeBilling();
  await api.command('card.save', {
    bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'New shared card', billingAccountId: accountId,
  }, { intentKey: createCommandIntent() });
  const originalDue = { id: f.ids.bill, dueOn: '2026-09-26' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', originalDue), hasCode('NETWORK_ERROR'));
  await api.command('card.save', payload);
  await api.command('bill.update', originalDue);
  const sent = attempts('bill.update');
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.notEqual((await f.store.get<Card>('cards', f.ids.card))?.billingAccountId, accountId);
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-26');
});

test('an older month response cannot redirect a later card correction to a historical bill', async () => {
  const { payload } = await observeBilling();
  const oldSessionRead = deferred<void>();
  const releaseOldSession = deferred<void>();
  transport = async (request, commit) => {
    const response = await commit();
    if (request.action === 'session.get') { oldSessionRead.resolve(); await releaseOldSession.promise; }
    return response;
  };
  const oldSession = api.query('session.get', {});
  await oldSessionRead.promise;
  f.setDate('2026-10-02');
  await api.query('dashboard.get', {});
  const wallet = await api.query('wallet.get', {});
  const card = wallet.cards.find(row => row.id === f.ids.card)!;
  const currentBill = wallet.bills.find(row => row.billingAccountId === card.billingAccountId && row.periodKey === '2026-10')!;
  assert.ok(currentBill);
  releaseOldSession.resolve();
  await oldSession;
  const dueDate = { id: currentBill.id, dueOn: '2026-10-26' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', dueDate), hasCode('NETWORK_ERROR'));
  await api.command('card.save', { ...payload, billing: { ...payload.billing!, dueOn: '2026-10-27' } });
  await api.command('bill.update', dueDate);
  const sent = attempts('bill.update');
  assert.notEqual(sent[1].requestId, sent[0].requestId);
  assert.equal((await f.store.get<Bill>('bills', currentBill.id))?.dueOn, '2026-10-26');
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-25');
});

test('persistent creation namespaces cannot be used to pin mutable commands or known-record edits', async () => {
  const intentKey = createCommandIntent();
  await assert.rejects(api.command('bill.update', { id: f.ids.bill, paid: true }, { intentKey }), hasCode('INVALID_INPUT'));
  await assert.rejects(api.command('card.save', { id: f.ids.card, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Invalid namespace use' }, { intentKey }), hasCode('INVALID_INPUT'));
  assert.equal(requests.length, 0);
});

test('a command keeps its submitted payload while refreshing wallet relationships', async () => {
  const { payload } = await observeBilling();
  const walletRead = deferred<void>();
  const releaseWallet = deferred<void>();
  transport = async (request, commit) => {
    const response = await commit();
    if (request.action === 'wallet.get') { walletRead.resolve(); await releaseWallet.promise; }
    return response;
  };
  const pending = api.command('card.save', payload);
  await walletRead.promise;
  payload.billing!.dueOn = '2026-09-29';
  releaseWallet.resolve();
  await pending;
  assert.equal(attempts('card.save')[0].payload.billing.dueOn, '2026-09-27');
  assert.equal((await f.store.get<Bill>('bills', f.ids.bill))?.dueOn, '2026-09-27');
});

test('a failed relationship preflight cannot discard an unresolved legacy creation request ID', async () => {
  const payload: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: `${f.prefix}-legacy-retry` };
  loseFirstResponse('card.save');
  await assert.rejects(api.command('card.save', payload), hasCode('NETWORK_ERROR'));
  transport = async (request, commit) => request.action === 'session.get'
    ? { result: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Session temporarily unavailable' } } }
    : commit();
  await assert.rejects(api.command('card.save', payload), hasCode('INTERNAL_ERROR'));
  assert.equal(attempts('card.save').length, 1);
  transport = async (_request, commit) => commit();
  await api.command('card.save', payload);
  const sent = attempts('card.save');
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.equal((await f.store.find('cards')).length, 2);
});

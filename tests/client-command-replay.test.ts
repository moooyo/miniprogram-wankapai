import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, ApiEnvelope, ApiRequest, Bill, BillingAccount, Card, Commands, MutationResult } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';

type RecordedRequest = { action: string; payload: unknown; requestId?: string };
type CloudResponse = { result: ApiEnvelope<unknown> };
type Transport = (request: RecordedRequest, commit: () => Promise<CloudResponse>) => Promise<CloudResponse>;

const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId, templateIds: settings.templateIds };
const originalWx = (globalThis as any).wx;
let fixtureSequence = 0;
let f: ReturnType<typeof fixture>;
let requests: RecordedRequest[];
let transport: Transport;

function fixture() {
  const prefix = `replay-client-${++fixtureSequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const templateIds = {
    new_activity: `${prefix}-new-activity`, deadline: `${prefix}-deadline`,
    reward: `${prefix}-reward`, repayment: `${prefix}-repayment`,
  };
  const store = new MemoryStore();
  let now = new Date('2026-09-30T04:00:00.000Z');
  const service = createService(store, { now: () => now, demo: true, templateIds });
  const payload: Commands['card.save'] = {
    bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: `${prefix}-legacy`,
    billing: { statementDay: 5, dueDay: 10, dueMonthOffset: 1, dueOn: '2026-10-10', remindDays: 3 },
  };
  return {
    prefix, actor, templateIds, store, service, payload, intentKey: `${prefix}-intent`,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
  };
}

beforeEach(async () => {
  f = fixture();
  requests = [];
  settings.mode = 'cloud';
  settings.cloudEnvId = `${f.prefix}-environment`;
  settings.templateIds = f.templateIds;
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

after(() => {
  settings.mode = originalSettings.mode;
  settings.cloudEnvId = originalSettings.cloudEnvId;
  settings.templateIds = originalSettings.templateIds;
  if (originalWx === undefined) delete (globalThis as any).wx;
  else (globalThis as any).wx = originalWx;
});

function hasCode(code: string) {
  return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function observe(promise: Promise<MutationResult>) {
  return promise.then(result => ({ ok: true as const, result }), error => ({ ok: false as const, error }));
}

function calls(action: string): RecordedRequest[] {
  return requests.filter(request => request.action === action);
}

function replay(): Promise<MutationResult> {
  return api.command('card.save', structuredClone(f.payload), { intentKey: f.intentKey, replayOnly: true });
}

function loseFirstCreationResponse(): void {
  let lost = false;
  transport = async (request, commit) => {
    const response = await commit();
    if (!lost && request.action === 'card.save' && response.result.ok) {
      lost = true;
      throw new Error('Response lost after commit');
    }
    return response;
  };
}

function assertReplayEnvelope(query: RecordedRequest, original: RecordedRequest): void {
  assert.equal(query.action, 'request.replay');
  assert.equal(Object.hasOwn(query, 'requestId'), false, 'The lookup must be a separate query, not a mutation with a replay flag.');
  assert.ok(original.requestId);
  assert.deepEqual(query.payload, original, 'The lookup must preserve the complete original action, payload, and request ID.');
}

async function seedUnmaterializedAccount(): Promise<void> {
  const account: BillingAccount = {
    id: `${f.prefix}-existing-account`, ownerId: f.actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', label: 'Existing account',
    statementDay: 5, dueDay: 10, dueMonthOffset: 1, remindDays: 3, enabled: true,
  };
  const card: Card = {
    id: `${f.prefix}-existing-card`, ownerId: f.actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit',
    nickname: 'Existing card', billingAccountId: account.id, createdAt: '2026-09-01T04:00:00.000Z',
  };
  const bill: Bill = {
    id: `${f.prefix}-september-bill`, ownerId: f.actor.userId, billingAccountId: account.id, periodKey: '2026-09',
    statementOn: '2026-09-05', dueOn: '2026-10-10', paidAt: null,
  };
  await f.store.set('billing_accounts', account.id, account);
  await f.store.set('cards', card.id, card);
  await f.store.set('bills', bill.id, bill);
}

for (const outcome of ['confirmed', 'lost-response'] as const) {
  test(`a ${outcome} legacy card creation is recovered by its exact request without creating the next month's bill`, async () => {
    assert.equal(Object.hasOwn(f.payload.billing!, 'periodKey'), false);
    if (outcome === 'lost-response') loseFirstCreationResponse();
    const initial = api.command('card.save', f.payload, { intentKey: f.intentKey });
    if (outcome === 'lost-response') await assert.rejects(initial, hasCode('NETWORK_ERROR'));
    else await initial;
    const original = calls('card.save')[0];
    const created = (await f.store.find<Card>('cards'))[0];
    assert.ok(created);
    assert.equal((await f.store.find('requests')).length, 1);
    assert.deepEqual((await f.store.find<Bill>('bills')).map(bill => bill.periodKey), ['2026-09']);

    f.setDate('2026-10-02');
    const before = await f.store.exportSeed();
    requests = [];
    const recovered = await replay();

    assert.deepEqual(recovered, { id: created.id });
    assert.deepEqual(requests.map(request => request.action), ['request.replay']);
    assertReplayEnvelope(requests[0], original);
    assert.deepEqual(await f.store.exportSeed(), before, 'A lookup must not create a card, materialize a bill, or write another request.');
  });
}

test('a missing result sends only a replay query and leaves unrelated bill materialization pending', async () => {
  await seedUnmaterializedAccount();
  f.setDate('2026-10-02');
  const before = await f.store.exportSeed();

  await assert.rejects(replay(), hasCode('REQUEST_UNRESOLVED'));

  assert.deepEqual(requests.map(request => request.action), ['request.replay']);
  assert.equal(Object.hasOwn(requests[0], 'requestId'), false);
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.equal((await f.store.find('requests')).length, 0);
  assert.deepEqual((await f.store.find<Bill>('bills')).map(bill => bill.periodKey), ['2026-09']);
});

test('a normal creation may commit after a concurrent lookup reports unresolved and a later lookup finds it', { timeout: 10_000 }, async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let held = false;
  transport = async (request, commit) => {
    if (request.action === 'card.save' && !held) {
      held = true;
      writeStarted.resolve();
      await releaseWrite.promise;
    }
    return commit();
  };
  const normal = api.command('card.save', f.payload, { intentKey: f.intentKey });
  const normalOutcome = observe(normal);
  try {
    await writeStarted.promise;
    const before = await f.store.exportSeed();
    const lookup = replay();
    const lookupOutcome = observe(lookup);
    assert.notEqual(lookup, normal);
    const unresolved = await lookupOutcome;
    assert.equal(unresolved.ok, false);
    if (!unresolved.ok) assert.equal(hasCode('REQUEST_UNRESOLVED')(unresolved.error), true);
    assert.deepEqual(await f.store.exportSeed(), before);
    assert.equal((await f.store.find('requests')).length, 0);
    assert.equal(api.command('card.save', f.payload, { intentKey: f.intentKey }), normal, 'An unresolved lookup must leave the pending mutation attached.');

    releaseWrite.resolve();
    const created = await normal;
    const afterCommit = await f.store.exportSeed();
    assert.deepEqual(await replay(), created);
    assert.equal(calls('card.save').length, 1);
    assert.equal(calls('request.replay').length, 2);
    for (const query of calls('request.replay')) assertReplayEnvelope(query, calls('card.save')[0]);
    assert.equal((await f.store.find('cards')).length, 1);
    assert.equal((await f.store.find('requests')).length, 1);
    assert.deepEqual(await f.store.exportSeed(), afterCommit);
  } finally {
    releaseWrite.resolve();
    await normalOutcome;
  }
});

test('a lookup started first cannot absorb a later normal creation of the same intent', { timeout: 10_000 }, async () => {
  const queryStarted = deferred();
  const releaseQuery = deferred();
  transport = async (request, commit) => {
    if (request.action === 'request.replay') {
      queryStarted.resolve();
      await releaseQuery.promise;
    }
    return commit();
  };
  const lookup = replay();
  const lookupOutcome = observe(lookup);
  try {
    await queryStarted.promise;
    const normal = api.command('card.save', f.payload, { intentKey: f.intentKey });
    assert.notEqual(normal, lookup);
    const created = await normal;
    const beforeReplayResult = await f.store.exportSeed();
    releaseQuery.resolve();

    assert.deepEqual(await lookup, created);
    assert.equal(calls('card.save').length, 1);
    assert.equal(calls('request.replay').length, 1);
    assertReplayEnvelope(calls('request.replay')[0], calls('card.save')[0]);
    assert.deepEqual(await f.store.exportSeed(), beforeReplayResult);
  } finally {
    releaseQuery.resolve();
    await lookupOutcome;
  }
});

test('identical concurrent replay queries share one promise and release their cache after settlement', { timeout: 10_000 }, async () => {
  const created = await api.command('card.save', f.payload, { intentKey: f.intentKey });
  const original = calls('card.save')[0];
  const before = await f.store.exportSeed();
  requests = [];
  const releaseQuery = deferred();
  transport = async (request, commit) => {
    if (request.action === 'request.replay') await releaseQuery.promise;
    return commit();
  };
  const first = replay();
  const second = replay();
  const outcomes = [observe(first), observe(second)];
  try {
    assert.equal(second, first);
    assert.deepEqual(requests.map(request => request.action), ['request.replay']);
    releaseQuery.resolve();
    assert.deepEqual(await first, created);
    assert.deepEqual(await second, created);

    const later = replay();
    assert.notEqual(later, first);
    assert.deepEqual(await later, created);
    assert.equal(calls('request.replay').length, 2);
    for (const query of calls('request.replay')) assertReplayEnvelope(query, original);
    assert.deepEqual(await f.store.exportSeed(), before);
  } finally {
    releaseQuery.resolve();
    await Promise.all(outcomes);
  }
});

test('a successful lookup cannot retire an in-flight normal retry after its first response was lost', { timeout: 10_000 }, async () => {
  loseFirstCreationResponse();
  await assert.rejects(api.command('card.save', f.payload, { intentKey: f.intentKey }), hasCode('NETWORK_ERROR'));
  const original = calls('card.save')[0];
  await api.query('wallet.get', {});
  const before = await f.store.exportSeed();
  requests = [];
  const retryCommitted = deferred();
  const releaseRetry = deferred();
  transport = async (request, commit) => {
    const response = await commit();
    if (request.action === 'card.save') {
      retryCommitted.resolve();
      await releaseRetry.promise;
    }
    return response;
  };
  const retry = api.command('card.save', f.payload, { intentKey: f.intentKey });
  const retryOutcome = observe(retry);
  try {
    await retryCommitted.promise;
    const lookup = replay();
    assert.notEqual(lookup, retry);
    const found = await lookup;
    assert.equal(api.command('card.save', f.payload, { intentKey: f.intentKey }), retry, 'Lookup success must not complete or detach the normal command.');
    assert.deepEqual(requests.map(request => request.action), ['card.save', 'request.replay']);
    assert.equal(calls('card.save')[0].requestId, original.requestId);
    assertReplayEnvelope(calls('request.replay')[0], original);
    assert.deepEqual(await f.store.exportSeed(), before);

    releaseRetry.resolve();
    assert.deepEqual(await retry, found);
  } finally {
    releaseRetry.resolve();
    await retryOutcome;
  }
});

for (const failure of ['INVALID_INPUT', 'INVALID_ACTION', 'NETWORK_ERROR', 'INVALID_RESPONSE'] as const) {
  test(`a replay lookup with ${failure} cannot fall back to a write or disturb a lost-response retry`, async () => {
    loseFirstCreationResponse();
    await assert.rejects(api.command('card.save', f.payload, { intentKey: f.intentKey }), hasCode('NETWORK_ERROR'));
    const original = calls('card.save')[0];
    await api.query('wallet.get', {});
    const before = await f.store.exportSeed();
    requests = [];
    transport = async (request, commit) => {
      if (request.action !== 'request.replay') return commit();
      if (failure === 'NETWORK_ERROR') throw new Error('Replay transport unavailable');
      if (failure === 'INVALID_RESPONSE') return { result: { ok: true, data: null } };
      return { result: { ok: false, error: { code: failure, message: 'Replay is unavailable on this server' } } };
    };

    await assert.rejects(replay(), hasCode(failure));

    assert.deepEqual(requests.map(request => request.action), ['request.replay']);
    assertReplayEnvelope(requests[0], original);
    assert.deepEqual(await f.store.exportSeed(), before);
    const retried = await api.command('card.save', f.payload, { intentKey: f.intentKey });
    assert.deepEqual(requests.map(request => request.action), ['request.replay', 'card.save'], 'Lookup failures must not dirty wallet relationships or trigger mutation preflight.');
    assert.equal(calls('card.save')[0].requestId, original.requestId);
    assert.deepEqual(calls('card.save')[0].payload, original.payload);
    assert.deepEqual(await f.store.exportSeed(), before);

    transport = async (_request, commit) => commit();
    assert.deepEqual(await replay(), retried, 'A failed lookup must release its own cache so a later query can succeed.');
    assert.equal(calls('request.replay').length, 2);
    assert.equal(calls('card.save').length, 1);
    assert.deepEqual(await f.store.exportSeed(), before);
  });
}

test('a replay lookup without a persisted intent is rejected before any transport or write', async () => {
  const before = await f.store.exportSeed();

  await assert.rejects(api.command('card.save', f.payload, { replayOnly: true }), hasCode('INVALID_INPUT'));

  assert.deepEqual(requests, []);
  assert.deepEqual(await f.store.exportSeed(), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiRequest, Card, CommandRequest, Commands, MutationResult, Participation, Queries, Reward } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import type { Store } from '../domain/store';

const owner: Actor = { userId: 'period-owner', isModerator: false };
const other: Actor = { userId: 'period-other', isModerator: false };

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'period-activity', revision: 1, status: 'published', title: 'Period receipt',
    bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Eligible card',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2027-12-31', target: 3, unit: 'count', currency: 'CNY',
    rewardMinor: 2000, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false,
    conditions: 'Three purchases', sourceUrl: '', sourceNote: 'Bank app',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open benefits', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function fixture(overrides: Partial<Activity> = {}, backing?: MemoryStore) {
  const source = activity(overrides);
  const card = (id: string, actor = owner): Card => ({ id, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: id, createdAt: '2026-01-01T00:00:00Z' });
  const cards = [card('period-card-a'), card('period-card-b'), card('period-card-other', other)];
  const store = backing || new MemoryStore({ activities: { [source.id]: source }, cards: Object.fromEntries(cards.map(row => [row.id, row])) });
  let now = new Date('2026-09-30T04:00:00.000Z');
  let request = 0;
  const service = createService(store, { now: () => now, demo: true });
  return {
    source, store, service,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `period-request-${++request}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
    query: <K extends keyof Queries>(action: K, payload: Queries[K]['input'], actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<Queries[K]['output']>,
  };
}

const receipt = (expectedPeriodKey = '2026-09'): Commands['reward.confirm'] => ({
  activityId: 'period-activity', amountMinor: 1875, receivedOn: '2026-09-30', expectNew: true, expectedPeriodKey,
});
function code(expected: string, field?: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected && (field === undefined || error.field === field);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

for (const boundary of [
  { frequency: 'monthly' as const, before: '2026-09-30', after: '2026-10-01', period: '2026-09' },
  { frequency: 'quarterly' as const, before: '2026-09-30', after: '2026-10-01', period: '2026-Q3' },
  { frequency: 'yearly' as const, before: '2026-12-31', after: '2027-01-01', period: '2026' },
]) {
  test(`a ${boundary.frequency} first-receipt form cannot silently create the next activity period`, async () => {
    const f = fixture({ frequency: boundary.frequency });
    f.setDate(boundary.before);
    assert.equal((await f.query('activity.get', { activityId: f.source.id })).participation, null);
    const untouched = await f.store.exportSeed();
    f.setDate(boundary.after);
    await assert.rejects(f.command('reward.confirm', { ...receipt(boundary.period), receivedOn: boundary.after }), code('VERSION_CONFLICT', 'expectedPeriodKey'));
    assert.deepEqual(await f.store.exportSeed(), untouched);
  });
}

test('a once-only activity keeps the same guarded period across a calendar month boundary', async () => {
  const f = fixture({ frequency: 'once' });
  f.setDate('2026-10-01');
  const saved = await f.command('reward.confirm', receipt('once'));
  const record = (await f.store.get<Participation>('participations', saved.id))!;
  assert.equal(record.periodKey, 'once');
  assert.equal(record.receivedOn, '2026-09-30');
  assert.deepEqual(record.snapshot, f.source);
});

test('a committed first receipt replays across periods without changing its snapshot, ledger date, or request record', async () => {
  const f = fixture();
  const original: CommandRequest<'reward.confirm'> = { action: 'reward.confirm', payload: receipt(), requestId: 'committed-september-receipt' };
  const saved = await f.service.execute(owner, original) as MutationResult;
  f.setDate('2026-10-01');
  await f.store.set('activities', f.source.id, { ...f.source, revision: 2, title: 'Updated public activity', status: 'withdrawn' });
  const before = await f.store.exportSeed();
  assert.deepEqual(await f.service.execute(owner, original), saved);
  assert.deepEqual(await f.query('request.replay', original), saved);
  assert.deepEqual(await f.store.exportSeed(), before);
  const record = (await f.store.get<Participation>('participations', saved.id))!;
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(record.periodKey, '2026-09');
  assert.equal(record.receivedOn, '2026-09-30');
  assert.deepEqual(record.snapshot, f.source);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].activityPeriod, '2026-09');
  assert.equal(ledger[0].receivedOn, '2026-09-30');
});

test('guarded first receipts still enforce absence, eligible card ownership, and independent card scopes', async () => {
  const f = fixture({ scope: 'card' });
  const first = { ...receipt(), cardId: 'period-card-a' };
  const results = await Promise.allSettled([f.command('reward.confirm', first), f.command('reward.confirm', { ...first, amountMinor: 3500 })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(code('VERSION_CONFLICT')(rejected.reason), true);
  assert.notEqual(rejected.reason.field, 'expectedPeriodKey');
  await f.command('reward.confirm', { ...receipt(), cardId: 'period-card-b' });
  assert.equal((await f.store.find('participations')).length, 2);
  assert.equal((await f.store.find('rewards')).length, 2);
  f.setDate('2026-10-01');
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('reward.confirm', { ...first, receivedOn: '2026-10-01' }, other), code('NOT_FOUND'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('known participation corrections retain their original period while using the actual later receipt date', async () => {
  const f = fixture();
  const saved = await f.command('reward.confirm', receipt());
  const original = (await f.store.get<Participation>('participations', saved.id))!;
  f.setDate('2026-10-01');
  await f.command('reward.confirm', { participationId: saved.id, expectedVersion: saved.version, amountMinor: 2300, receivedOn: '2026-10-01' });
  const updated = (await f.store.get<Participation>('participations', saved.id))!;
  assert.equal(updated.periodKey, original.periodKey);
  assert.deepEqual(updated.snapshot, original.snapshot);
  assert.equal(updated.receivedOn, '2026-10-01');
  assert.equal((await f.query('rewards.get', { month: '2026-10', currency: 'CNY' })).totalMinor, 2300);
  assert.equal((await f.store.find('participations')).length, 1);
});

test('invalid period guards do not weaken receipt date or existing-version validation', async () => {
  const f = fixture();
  for (const expectedPeriodKey of ['', '2026-13', '2026-Q5', '0000', '2026-09-30']) {
    await assert.rejects(f.command('reward.confirm', { ...receipt(), expectedPeriodKey }), code('INVALID_INPUT', 'expectedPeriodKey'));
  }
  await assert.rejects(f.command('reward.confirm', { ...receipt(), expectNew: false }), code('INVALID_INPUT', 'expectedPeriodKey'));
  await assert.rejects(f.command('reward.confirm', { ...receipt(), receivedOn: '2026-08-31' }), code('INVALID_INPUT', 'receivedOn'));
  await assert.rejects(f.command('reward.confirm', { ...receipt(), receivedOn: '2026-10-01' }), code('INVALID_INPUT', 'receivedOn'));
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal((await f.store.find('rewards')).length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
  assert.equal((await f.store.find('audit_events')).length, 0);
  const saved = await f.command('reward.confirm', receipt());
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('reward.confirm', { participationId: saved.id, expectedVersion: 1, amountMinor: 99, receivedOn: '2026-09-30' }), code('VERSION_CONFLICT'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('replay-only lookup cannot execute an uncommitted legacy card creation after a period boundary', async () => {
  const f = fixture();
  f.setDate('2026-10-01');
  const original: CommandRequest<'card.save'> = {
    action: 'card.save', requestId: 'legacy-card-never-committed',
    payload: { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Legacy pending card',
      billing: { statementDay: 6, dueDay: 10, dueMonthOffset: 0, dueOn: '2026-10-10', remindDays: 3 } },
  };
  const before = await f.store.exportSeed();
  await assert.rejects(f.query('request.replay', original), code('REQUEST_UNRESOLVED'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('replay-only lookup returns an exact legacy card result but never changes later edits or request fingerprints', async () => {
  const f = fixture();
  const original: CommandRequest<'card.save'> = {
    action: 'card.save', requestId: 'legacy-card-committed',
    payload: { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Original name',
      billing: { statementDay: 6, dueDay: 10, dueMonthOffset: 1, dueOn: '2026-10-10', remindDays: 3 } },
  };
  const saved = await f.service.execute(owner, original) as MutationResult;
  await f.command('card.save', { id: saved.id, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Later edit' });
  f.setDate('2026-10-01');
  const before = await f.store.exportSeed();
  const reordered = Object.fromEntries(Object.entries(original.payload).reverse()) as Commands['card.save'];
  assert.deepEqual(await f.query('request.replay', { ...original, payload: reordered }), saved);
  await assert.rejects(f.query('request.replay', { ...original, payload: { ...original.payload, nickname: 'Changed fingerprint' } }), code('REQUEST_CONFLICT'));
  await assert.rejects(f.query('request.replay', original, other), code('REQUEST_UNRESOLVED'));
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.equal((await f.store.get<Card>('cards', saved.id))?.nickname, 'Later edit');
});

test('a replay lookup for untracking does not materialize periods or disable tracking', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: f.source.id });
  f.setDate('2026-11-01');
  const before = await f.store.exportSeed();
  await assert.rejects(f.query('request.replay', { action: 'activity.untrack', payload: { participationId: joined.id }, requestId: 'untrack-never-submitted' }), code('REQUEST_UNRESOLVED'));
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.equal((await f.store.find('participations')).length, 1);
});

test('malformed replay requests reject without dispatching nested queries or commands', async () => {
  const f = fixture();
  const before = await f.store.exportSeed();
  for (const payload of [
    { action: 'wallet.get', payload: {}, requestId: 'query-is-not-a-command' },
    { action: 'request.replay', payload: {}, requestId: 'recursive-query' },
    { action: 'card.save', payload: [], requestId: 'invalid-payload' },
    { action: 'card.save', payload: {}, requestId: '' },
  ]) {
    await assert.rejects(f.service.execute(owner, { action: 'request.replay', payload } as ApiRequest), code('INVALID_INPUT'));
  }
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('an unresolved lookup or later-period rejection does not imply an earlier in-flight operation can never commit', async () => {
  const ready = deferred<void>();
  const release = deferred<void>();
  class DelayedStore extends MemoryStore {
    delay = true;
    override async transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
      if (this.delay) { this.delay = false; ready.resolve(); await release.promise; }
      return super.transaction(callback);
    }
  }
  const source = activity();
  const backing = new DelayedStore({ activities: { [source.id]: source } });
  const f = fixture({}, backing);
  const original: CommandRequest<'reward.confirm'> = { action: 'reward.confirm', payload: receipt(), requestId: 'delayed-original' };
  const pending = f.service.execute(owner, original) as Promise<MutationResult>;
  await ready.promise;
  f.setDate('2026-10-01');
  const before = await f.store.exportSeed();
  await assert.rejects(f.query('request.replay', original), code('REQUEST_UNRESOLVED'));
  await assert.rejects(f.service.execute(owner, original), code('VERSION_CONFLICT', 'expectedPeriodKey'));
  assert.deepEqual(await f.store.exportSeed(), before);
  release.resolve();
  const saved = await pending;
  assert.deepEqual(await f.query('request.replay', original), saved);
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 1);
  assert.equal(records[0].periodKey, '2026-09');
  assert.equal(records[0].receivedOn, '2026-09-30');
  assert.equal((await f.store.find('rewards')).length, 1);
});

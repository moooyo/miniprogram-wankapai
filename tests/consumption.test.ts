import test from 'node:test';
import assert from 'node:assert/strict';
import { Activity, Actor, ApiRequest, AuditEvent, Commands, Consumption, Detail, MutationResult, Participation } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { Store } from '../domain/store';
import { createService, DomainError } from '../domain/service';

const owner: Actor = { userId: 'owner', isModerator: false };
const stranger: Actor = { userId: 'stranger', isModerator: false };
function activity(overrides: Partial<Activity> = {}): Activity {
  return { id: 'activity', title: 'Recorded consumption activity', bankId: 'cmb', issuerIds: [], networks: [], cardKind: 'any', cardDescription: 'Eligible cards',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31', target: 3, unit: '笔', currency: 'CNY', rewardMinor: 1800,
    rewardKind: 'cashback', scope: 'user', requiresRegistration: true, requiresInvitation: false, conditions: 'Three qualifying purchases, confirmed by the user',
    sourceUrl: 'https://www.cmbchina.com/', sourceNote: '', entrance: { kind: 'guide', label: 'Activity entrance', instructions: 'Bank app > activities', imageIds: [] },
    revision: 1, status: 'published', publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', ...overrides };
}
function fixture(overrides: Partial<Activity> = {}, store = new MemoryStore({ activities: { activity: activity(overrides) } })) {
  let date = '2026-09-30';
  let sequence = 0;
  const service = createService(store, { demo: true, now: () => new Date(`${date}T04:00:00Z`) });
  return { store, setDate: (value: string) => { date = value; },
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `request-${++sequence}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
    query: <T>(action: string, payload: unknown = {}, actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T> };
}
const code = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;

test('consumption logs append atomically, complete at the original target, and replay without duplicate progress', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity' });
  let version = joined.version!;
  for (let index = 0; index < 3; index += 1) {
    const payload = { participationId: joined.id, amountMinor: 10000, merchant: ' Recorded merchant ', consumedOn: '2026-09-29', expectedVersion: version };
    const result = await f.command('participation.consume', payload, owner, `consumption-${index}`);
    assert.deepEqual(await f.command('participation.consume', payload, owner, `consumption-${index}`), result);
    assert.equal((await f.store.get<Consumption>('consumptions', result.id))!.progressDelta, 1);
    version = result.version!;
  }
  const detail = await f.query<Detail>('activity.get', { participationId: joined.id });
  assert.equal(detail.consumptions?.length, 3);
  assert.equal(detail.consumptions?.[0].merchant, 'Recorded merchant');
  assert.equal(detail.participation?.progress, 3);
  assert.equal(detail.participation?.stage, 'completed');
  assert.equal(detail.participation?.completionSource, 'consumption');
  assert.equal(detail.participation?.registeredAt, null);
  assert.equal((await f.store.find('rewards')).length, 0);
  assert.equal((await f.store.find<AuditEvent>('audit_events')).filter(row => row.action === 'consumption.created').length, 3);
});

test('consumption ownership, version, amount, date and delta boundaries reject before any append', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const base = { participationId: joined.id, consumedOn: '2026-09-29', expectedVersion: joined.version! };
  await assert.rejects(f.command('participation.consume', base, stranger), code('NOT_FOUND'));
  for (const invalid of [
    { ...base, expectedVersion: 0 }, { ...base, expectedVersion: undefined },
    { ...base, amountMinor: -1 }, { ...base, amountMinor: 1.5 }, { ...base, amountMinor: Number.NaN },
    { ...base, progressDelta: 0 }, { ...base, progressDelta: 0.5 }, { ...base, progressDelta: Number.POSITIVE_INFINITY },
    { ...base, consumedOn: '2026-08-31' }, { ...base, consumedOn: '2026-10-01' }, { ...base, consumedOn: '2026-09-31' },
    { ...base, merchant: 'm'.repeat(121) },
  ]) await assert.rejects(f.command('participation.consume', invalid as Commands['participation.consume']));
  assert.equal((await f.store.find('consumptions')).length, 0);
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.progress, 0);
});

test('non-count targets require explicit qualifying delta and preserve exact decimal progress', async () => {
  const f = fixture({ target: 100.02, unit: '元' });
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const base = { participationId: joined.id, consumedOn: '2026-09-30', expectedVersion: joined.version!, amountMinor: 100000 };
  await assert.rejects(f.command('participation.consume', base), code('INVALID_INPUT'));
  await assert.rejects(f.command('participation.consume', { ...base, progressDelta: 1.001 }), code('INVALID_INPUT'));
  const first = await f.command('participation.consume', { ...base, progressDelta: 100.01 });
  const second = await f.command('participation.consume', { ...base, expectedVersion: first.version!, progressDelta: 0.01 });
  const after = (await f.store.get<Participation>('participations', joined.id))!;
  assert.equal(after.progress, 100.02);
  assert.equal(after.stage, 'completed');
  await f.command('consumption.revoke', { id: second.id, expectedVersion: second.version! });
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.progress, 100.01);
});

test('reversing consumption below the auto-completed target restores progress and clears expected rewards', async () => {
  const f = fixture({ target: 1 });
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const logged = await f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-30', expectedVersion: joined.version! });
  const expected = await f.command('participation.expected', { participationId: joined.id, expectedOn: '2026-10-01' });
  await assert.rejects(f.command('consumption.revoke', { id: logged.id, expectedVersion: logged.version! }), code('VERSION_CONFLICT'));
  await assert.rejects(f.command('consumption.revoke', { id: logged.id, expectedVersion: expected.version! }, stranger), code('NOT_FOUND'));
  const reversed = await f.command('consumption.revoke', { id: logged.id, expectedVersion: expected.version! }, owner, 'reverse-once');
  assert.deepEqual(await f.command('consumption.revoke', { id: logged.id, expectedVersion: expected.version! }, owner, 'reverse-once'), reversed);
  const record = (await f.store.get<Participation>('participations', joined.id))!;
  assert.equal(record.progress, 0);
  assert.equal(record.stage, 'available');
  assert.equal(record.expectedOn, null);
  assert.equal(record.completedAt, null);
  assert.equal(record.beforeCompletion, undefined);
  assert.equal(record.completionSource, undefined);
  assert.ok((await f.store.get<Consumption>('consumptions', logged.id))!.reversedAt);
  await assert.rejects(f.command('consumption.revoke', { id: logged.id, expectedVersion: reversed.version! }), code('CONSUMPTION_REVERSED'));
  assert.equal((await f.query<Detail>('activity.get', { participationId: joined.id })).consumptions?.length, 1);
});

test('manual completion and later completion undo preserve logged progress independently of bank verification', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const done = await f.command('participation.complete', { participationId: joined.id });
  const logged = await f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-29', expectedVersion: done.version! });
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.stage, 'completed');
  const undone = await f.command('participation.undoComplete', { participationId: joined.id });
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.progress, 1);
  await f.command('consumption.revoke', { id: logged.id, expectedVersion: undone.version! });
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.progress, 0);
});

test('withdrawn, skipped and received participations cannot append or reverse consumption', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const logged = await f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-29', expectedVersion: joined.version! });
  let latest = await f.command('activity.untrack', { participationId: joined.id });
  await assert.rejects(f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-29', expectedVersion: latest.version! }), code('PARTICIPATION_WITHDRAWN'));
  await assert.rejects(f.command('consumption.revoke', { id: logged.id, expectedVersion: latest.version! }), code('PARTICIPATION_WITHDRAWN'));
  latest = await f.command('activity.join', { activityId: 'activity' });
  latest = await f.command('participation.skip', { participationId: joined.id, skipped: true });
  await assert.rejects(f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-29', expectedVersion: latest.version! }), code('INVALID_STATE'));
  await f.command('participation.skip', { participationId: joined.id, skipped: false });
  latest = await f.command('reward.confirm', { participationId: joined.id, amountMinor: 1800, receivedOn: '2026-09-30' });
  await assert.rejects(f.command('consumption.revoke', { id: logged.id, expectedVersion: latest.version! }), code('INVALID_STATE'));
  await assert.rejects(f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-29', expectedVersion: latest.version! }), code('INVALID_STATE'));
  assert.equal((await f.store.find<Consumption>('consumptions')).length, 1);
});

test('historical consumption uses its original period and currency snapshot after publication changes', async () => {
  const f = fixture({ currency: 'HKD' });
  const joined = await f.command('activity.join', { activityId: 'activity' });
  await f.store.set('activities', 'activity', activity({ currency: 'CNY', target: 1, revision: 2 }));
  f.setDate('2026-10-03');
  const logged = await f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-29', amountMinor: 15000, expectedVersion: joined.version! });
  const record = (await f.store.get<Participation>('participations', joined.id))!;
  assert.equal(record.periodKey, '2026-09');
  assert.equal(record.snapshot.target, 3);
  assert.equal(record.snapshot.revision, 1);
  assert.equal(record.stage, 'in_progress');
  assert.equal((await f.store.get<Consumption>('consumptions', logged.id))!.currency, 'HKD');
  const current = await f.command('activity.join', { activityId: 'activity' });
  assert.equal((await f.query<Detail>('activity.get', { participationId: current.id })).consumptions?.length, 0);
  assert.equal((await f.query<Detail>('activity.get', { participationId: joined.id })).consumptions?.length, 1);
});

test('concurrent logs require an exact version and cannot double increment one observed participation', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const payload = { participationId: joined.id, consumedOn: '2026-09-30', expectedVersion: joined.version! };
  const results = await Promise.allSettled([f.command('participation.consume', payload), f.command('participation.consume', payload)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await f.store.find('consumptions')).length, 1);
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.progress, 1);
});

test('manual progress corrections cannot let a consumption reversal create negative progress', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const logged = await f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-30', expectedVersion: joined.version! });
  const corrected = await f.command('participation.progress', { participationId: joined.id, progress: 0, registered: true });
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('consumption.revoke', { id: logged.id, expectedVersion: corrected.version! }), code('CONFLICT'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('a failed consumption audit rolls back the appended log, progress and request ledger together', async () => {
  class FailingStore extends MemoryStore {
    override async transaction<T>(callback: (transaction: Store) => Promise<T>): Promise<T> {
      return super.transaction(transaction => callback({ ...transaction, get: transaction.get.bind(transaction), find: transaction.find.bind(transaction), remove: transaction.remove.bind(transaction), transaction: transaction.transaction.bind(transaction),
        set: async (collection, id, value) => {
          if (collection === 'audit_events' && (value as AuditEvent).action === 'consumption.created') throw new Error('Injected audit failure');
          await transaction.set(collection, id, value);
        } }));
    }
  }
  const store = new FailingStore({ activities: { activity: activity() } });
  const f = fixture({}, store);
  const joined = await f.command('activity.join', { activityId: 'activity' });
  const before = await store.exportSeed();
  await assert.rejects(f.command('participation.consume', { participationId: joined.id, consumedOn: '2026-09-30', expectedVersion: joined.version! }), /Injected audit failure/);
  assert.deepEqual(await store.exportSeed(), before);
});

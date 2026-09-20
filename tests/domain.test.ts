import test from 'node:test';
import assert from 'node:assert/strict';
import { Activity, ActivityDraft, Actor, ApiRequest, Asset, Commands, Dashboard, Detail, MutationResult, Participation, ReminderPreference, Reward, RewardsView, Submission, Wallet } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { Collection, Store } from '../domain/store';
import { createReminderWorker } from '../cloudfunctions/reminders/worker';

const user: Actor = { userId: 'user-a', isModerator: false };
const other: Actor = { userId: 'user-b', isModerator: false };
const moderator: Actor = { userId: 'operator', isModerator: true };

function draft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    title: '月度消费礼', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa 信用卡',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2027-12-31', target: 3, unit: '笔', currency: 'CNY', rewardMinor: 1800,
    rewardKind: 'cashback', scope: 'user', requiresRegistration: true, requiresInvitation: false, conditions: '每月完成三笔指定消费',
    sourceUrl: 'https://www.cmbchina.com/', sourceNote: '', entrance: { kind: 'web', label: '查看活动', url: 'https://www.cmbchina.com/', instructions: '以银行活动规则为准', imageIds: [] }, ...overrides,
  };
}

function activity(id = 'activity-a', overrides: Partial<ActivityDraft> = {}): Activity {
  return { ...draft(overrides), id, revision: 1, status: 'published', publishedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', publishedBy: 'operator' };
}

function fixture(activities: Activity[] = [activity()]) {
  const store = new MemoryStore({ activities: Object.fromEntries(activities.map(row => [row.id, row])) });
  let now = new Date('2026-09-20T04:00:00.000Z');
  const service = createService(store, { now: () => now, demo: true, templateIds: { deadline: 'deadline-template', new_activity: 'new-activity-template' } });
  let request = 0;
  return {
    store, service,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
    query: <T>(action: string, payload: unknown = {}, actor = user) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T>,
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = user, requestId = `request-${++request}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
  };
}

function code(expected: string) { return (error: unknown) => error instanceof DomainError && error.code === expected; }

class CappedStore extends MemoryStore {
  writeCounts: number[] = [];
  transactionCount = 0;
  failTransaction = -1;

  override async transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
    const transactionNumber = ++this.transactionCount;
    return super.transaction(async transaction => {
      let writes = 0;
      const beforeWrite = () => {
        writes += 1;
        if (writes > 98) throw new Error('TRANSACTION_LIMIT');
        if (transactionNumber === this.failTransaction && writes === 3) {
          this.failTransaction = -1;
          throw new Error('INTERRUPTED_BATCH');
        }
      };
      const bounded: Store = {
        get: transaction.get.bind(transaction), find: transaction.find.bind(transaction),
        set: async <Row>(collection: Collection, id: string, value: Row) => { beforeWrite(); await transaction.set(collection, id, value); },
        remove: async (collection, id) => { beforeWrite(); await transaction.remove(collection, id); },
        transaction: async () => { throw new Error('NESTED_TRANSACTION'); },
      };
      try { return await callback(bounded); }
      finally { this.writeCounts.push(writes); }
    });
  }
}

test('direct receipt creates one participation and one ledger entry without mandatory registration', async () => {
  const f = fixture();
  const result = await f.command('reward.confirm', { activityId: 'activity-a', amountMinor: 1875, receivedOn: '2026-09-20' }, user, 'receipt-1');
  const replay = await f.command('reward.confirm', { activityId: 'activity-a', amountMinor: 1875, receivedOn: '2026-09-20' }, user, 'receipt-1');
  assert.deepEqual(replay, result);
  const detail = await f.query<Detail>('activity.get', { participationId: result.id });
  assert.equal(detail.participation?.stage, 'received');
  assert.equal(detail.participation?.registeredAt, null);
  const ledger = await f.store.find<Reward>('rewards');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].amountMinor, 1875);
  await f.command('reward.confirm', { participationId: result.id, amountMinor: 2100, receivedOn: '2026-09-19' });
  assert.equal((await f.store.find<Reward>('rewards')).length, 1);
  assert.equal((await f.query<RewardsView>('rewards.get')).totalMinor, 2100);
});

test('request identifiers reject changed payloads and remain scoped to each user', async () => {
  const f = fixture();
  await f.command('activity.join', { activityId: 'activity-a' }, user, 'same-request');
  await assert.rejects(f.command('participation.complete', { activityId: 'activity-a' }, user, 'same-request'), code('REQUEST_CONFLICT'));
  await f.command('activity.join', { activityId: 'activity-a' }, other, 'same-request');
  assert.equal((await f.store.find<Participation>('participations')).length, 2);
});

test('concurrent joins and receipts cannot duplicate a period or its ledger', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 10 }, () => f.command('activity.join', { activityId: 'activity-a' })));
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  await Promise.all(Array.from({ length: 10 }, () => f.command('reward.confirm', { participationId: results[0].id, amountMinor: 1800, receivedOn: '2026-09-20' })));
  assert.equal((await f.store.find<Reward>('rewards')).length, 1);
  assert.equal((await f.query<RewardsView>('rewards.get')).totalMinor, 1800);
});

test('failed receipt rolls back the implicitly created participation and request record', async () => {
  const f = fixture();
  await assert.rejects(f.command('reward.confirm', { activityId: 'activity-a', amountMinor: 1800, receivedOn: '2026-09-21' }, user, 'retry-after-fix'), code('INVALID_INPUT'));
  assert.equal((await f.store.find('participations')).length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
  await f.command('reward.confirm', { activityId: 'activity-a', amountMinor: 1800, receivedOn: '2026-09-20' }, user, 'retry-after-fix');
  assert.equal((await f.store.find('participations')).length, 1);
});

test('period rollover preserves completed records and records receipts in their actual month', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  await f.command('participation.complete', { participationId: joined.id });
  f.setDate('2026-10-02');
  let dashboard = await f.query<Dashboard>('dashboard.get');
  assert.equal(dashboard.pendingRewards.length, 1);
  assert.equal(dashboard.tasks.length, 1);
  assert.equal(dashboard.tasks[0].periodKey, '2026-10');
  await f.command('reward.confirm', { participationId: joined.id, amountMinor: 1800, receivedOn: '2026-10-01' });
  assert.equal((await f.query<RewardsView>('rewards.get', { month: '2026-09' })).totalMinor, 0);
  assert.equal((await f.query<RewardsView>('rewards.get', { month: '2026-10' })).totalMinor, 1800);
  assert.equal((await f.query<Detail>('activity.get', { participationId: joined.id })).participation?.periodKey, '2026-09');
  dashboard = await f.query<Dashboard>('dashboard.get');
  assert.equal(dashboard.pendingRewards.length, 0);
});

test('missed visits backfill recurring periods and untracking never removes old pending rewards', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  await f.command('participation.complete', { participationId: joined.id });
  f.setDate('2026-12-02');
  await f.query('dashboard.get');
  assert.deepEqual((await f.store.find<Participation>('participations')).map(row => row.periodKey).sort(), ['2026-09', '2026-10', '2026-11', '2026-12']);
  await f.command('activity.untrack', { participationId: joined.id });
  f.setDate('2027-02-02');
  const dashboard = await f.query<Dashboard>('dashboard.get');
  assert.equal(dashboard.pendingRewards.length, 1);
  assert.equal((await f.store.find('participations')).length, 4);
  await f.command('activity.join', { activityId: 'activity-a' });
  await f.query('dashboard.get');
  assert.deepEqual((await f.store.find<Participation>('participations')).map(row => row.periodKey).sort(), ['2026-09', '2026-10', '2026-11', '2026-12', '2027-02']);
});

test('untracking directly catches up missed periods before stopping future generation', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  f.setDate('2026-12-02');
  await f.command('activity.untrack', { participationId: joined.id });
  assert.deepEqual((await f.store.find<Participation>('participations')).map(row => row.periodKey).sort(), ['2026-09', '2026-10', '2026-11', '2026-12']);
  f.setDate('2027-01-02');
  await f.query('dashboard.get');
  assert.equal((await f.store.find('participations')).length, 4);
});

test('receipt revoke returns to pending, completion undo restores prior progress, and amounts stay separated by currency', async () => {
  const f = fixture([activity(), activity('activity-hk', { currency: 'HKD' })]);
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  await f.command('participation.progress', { participationId: joined.id, progress: 2, registered: true });
  await f.command('reward.confirm', { participationId: joined.id, amountMinor: 1800, receivedOn: '2026-09-20' });
  await f.command('reward.confirm', { activityId: 'activity-hk', amountMinor: 5000, receivedOn: '2026-09-20' });
  assert.equal((await f.query<RewardsView>('rewards.get', { currency: 'CNY' })).totalMinor, 1800);
  assert.equal((await f.query<RewardsView>('rewards.get', { currency: 'HKD' })).totalMinor, 5000);
  await assert.rejects(f.command('participation.undoComplete', { participationId: joined.id }), code('INVALID_STATE'));
  await f.command('reward.revoke', { participationId: joined.id });
  assert.equal((await f.query<RewardsView>('rewards.get', { currency: 'CNY' })).pending.length, 1);
  await f.command('participation.undoComplete', { participationId: joined.id });
  const record = await f.store.get<Participation>('participations', joined.id);
  assert.equal(record?.stage, 'in_progress');
  assert.equal(record?.progress, 2);
  assert.equal((await f.query<RewardsView>('rewards.get', { currency: 'CNY' })).totalMinor, 0);
});

test('private records cannot be read or mutated by a different user', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  await assert.rejects(f.query('activity.get', { participationId: joined.id }, other), code('NOT_FOUND'));
  await assert.rejects(f.command('participation.complete', { participationId: joined.id }, other), code('NOT_FOUND'));
  await assert.rejects(f.command('reward.confirm', { participationId: joined.id, amountMinor: 100, receivedOn: '2026-09-20' }, other), code('NOT_FOUND'));
  assert.equal((await f.query<Dashboard>('dashboard.get', {}, other)).tasks.length, 0);
  assert.equal((await f.query<{ items: unknown[] }>('history.list', {}, other)).items.length, 0);
});

test('optimistic progress versions reject stale updates without losing data', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  await f.command('participation.progress', { participationId: joined.id, progress: 2, registered: true, expectedVersion: joined.version });
  await assert.rejects(f.command('participation.progress', { participationId: joined.id, progress: 1, registered: false, expectedVersion: joined.version }), code('VERSION_CONFLICT'));
  assert.equal((await f.store.get<Participation>('participations', joined.id))?.progress, 2);
});

test('per-card scopes require eligible cards and do not merge two cards of the same bank', async () => {
  const f = fixture([activity('activity-card', { scope: 'card' })]);
  const cardPayload: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '' };
  const first = await f.command('card.save', cardPayload);
  const second = await f.command('card.save', cardPayload);
  await assert.rejects(f.command('activity.join', { activityId: 'activity-card' }), code('CARD_REQUIRED'));
  const firstJoin = await f.command('activity.join', { activityId: 'activity-card', cardId: first.id });
  const secondJoin = await f.command('activity.join', { activityId: 'activity-card', cardId: second.id });
  assert.notEqual(firstJoin.id, secondJoin.id);
  assert.equal((await f.command('activity.join', { activityId: 'activity-card', cardId: first.id })).id, firstJoin.id);
  await assert.rejects(f.command('activity.join', { activityId: 'activity-card', cardId: first.id }, other), code('NOT_FOUND'));
});

test('a per-user recurring activity survives replacing the previously selected card', async () => {
  const f = fixture();
  const cardPayload: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '' };
  const first = await f.command('card.save', cardPayload);
  const second = await f.command('card.save', cardPayload);
  const joined = await f.command('activity.join', { activityId: 'activity-a', cardId: first.id });
  await f.command('card.remove', { id: first.id });
  assert.equal((await f.command('activity.join', { activityId: 'activity-a', cardId: second.id })).id, joined.id);
  f.setDate('2026-10-02');
  await f.query('dashboard.get');
  const records = await f.store.find<Participation>('participations');
  assert.equal(records.length, 2);
  assert.equal(records.find(row => row.periodKey === '2026-10')?.cardId, second.id);
});

test('moderation requires server-side role, verified sources and immutable publication snapshots', async () => {
  const f = fixture([]);
  const submitted = await f.command('submission.save', { draft: draft() });
  await assert.rejects(f.command('submission.review', { id: submitted.id, decision: 'publish', sourceVerified: true }), code('FORBIDDEN'));
  await assert.rejects(f.command('submission.review', { id: submitted.id, decision: 'publish', sourceVerified: false, expectedVersion: submitted.version }, moderator), code('SOURCE_UNVERIFIED'));
  await assert.rejects(f.query('submission.get', { id: submitted.id }, other), code('NOT_FOUND'));
  const published = await f.command('submission.review', { id: submitted.id, decision: 'publish', sourceVerified: true, expectedVersion: submitted.version }, moderator);
  const joined = await f.command('activity.join', { activityId: published.id });
  await assert.rejects(f.command('submission.save', { id: submitted.id, draft: draft({ title: 'Changed' }) }), code('IMMUTABLE'));
  await f.command('activity.withdraw', { activityId: published.id }, moderator);
  assert.equal((await f.query<{ items: unknown[] }>('catalog.list')).items.length, 0);
  const detail = await f.query<Detail>('activity.get', { participationId: joined.id });
  assert.equal(detail.activity.title, '月度消费礼');
  assert.equal(detail.participation?.snapshot.status, 'published');
  assert.equal((await f.store.find('activity_revisions')).length, 1);
  await f.command('participation.complete', { participationId: joined.id });
});

test('asset registration and publication enforce owner and approved visibility', async () => {
  const f = fixture([]);
  await assert.rejects(f.command('asset.register', { id: 'image-a', fileId: 'cloud://env/file', cloudPath: 'uploads/user-b/image-a.png', size: 100, mime: 'image/png' }), code('INVALID_ASSET'));
  await f.command('asset.register', { id: 'image-a', fileId: 'cloud://env/file', cloudPath: 'uploads/user-a/image-a.png', size: 100, mime: 'image/png' });
  const withImage = draft({ entrance: { kind: 'guide', label: '入口图片', instructions: '', imageIds: ['image-a'] } });
  await assert.rejects(f.command('submission.save', { draft: withImage }, other), code('INVALID_ASSET'));
  const submitted = await f.command('submission.save', { draft: withImage });
  const published = await f.command('submission.review', { id: submitted.id, decision: 'publish', sourceVerified: true, expectedVersion: submitted.version }, moderator);
  const detail = await f.query<Detail>('activity.get', { activityId: published.id }, other);
  assert.equal(detail.assets.length, 1);
  assert.equal(detail.assets[0].status, 'approved');
  assert.equal(detail.assets[0].ownerId, '');
  assert.equal(detail.assets[0].cloudPath, '');
  const joined = await f.command('activity.join', { activityId: published.id }, other);
  await f.command('activity.withdraw', { activityId: published.id }, moderator);
  const withdrawn = await f.query<Detail>('activity.get', { participationId: joined.id }, other);
  assert.equal(withdrawn.assets.length, 0);
  assert.equal(withdrawn.participation?.snapshot.title, withImage.title);
});

test('shared bills survive removing one card and split when that card receives independent settings', async () => {
  const f = fixture();
  const base: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '主卡' };
  const first = await f.command('card.save', { ...base, billing: { statementDay: 20, dueDay: 10, dueMonthOffset: 1, dueOn: '2026-10-10', remindDays: 3 } });
  let wallet = await f.query<Wallet>('wallet.get');
  const accountId = wallet.cards[0].billingAccountId!;
  const second = await f.command('card.save', { ...base, nickname: '副卡', billingAccountId: accountId });
  wallet = await f.query<Wallet>('wallet.get');
  assert.equal(wallet.bills.length, 1);
  await f.command('card.save', { ...base, id: second.id, billing: { statementDay: 25, dueDay: 15, dueMonthOffset: 1, dueOn: '2026-10-15', remindDays: 2 } });
  wallet = await f.query<Wallet>('wallet.get');
  assert.equal(wallet.accounts.filter(row => row.enabled).length, 2);
  assert.notEqual(wallet.cards.find(row => row.id === first.id)?.billingAccountId, wallet.cards.find(row => row.id === second.id)?.billingAccountId);
  await f.command('card.remove', { id: first.id });
  wallet = await f.query<Wallet>('wallet.get');
  assert.equal(wallet.bills.length, 2);
  const originalBill = wallet.bills.find(row => row.billingAccountId === accountId)!;
  await f.command('bill.update', { id: originalBill.id, paid: true });
  await assert.rejects(f.command('bill.update', { id: originalBill.id, paid: false }, other), code('NOT_FOUND'));
  assert.ok((await f.query<Wallet>('wallet.get')).bills.find(row => row.id === originalBill.id)?.paidAt);
});

test('submission versions reject stale author edits and stale moderator decisions', async () => {
  const f = fixture([]);
  const original = await f.command('submission.save', { draft: draft() });
  assert.equal(original.version, 1);
  const edited = await f.command('submission.save', { id: original.id, expectedVersion: original.version, draft: draft({ title: 'Updated title' }) });
  assert.equal(edited.version, 2);
  await assert.rejects(f.command('submission.save', { id: original.id, expectedVersion: original.version, draft: draft({ title: 'Stale title' }) }), code('VERSION_CONFLICT'));
  await assert.rejects(f.command('submission.save', { id: original.id, draft: draft() }), code('VERSION_CONFLICT'));
  await assert.rejects(f.command('submission.review', { id: original.id, decision: 'publish', expectedVersion: original.version, sourceVerified: true }, moderator), code('VERSION_CONFLICT'));
  assert.equal((await f.query<Submission>('submission.get', { id: original.id })).draft.title, 'Updated title');
  const returned = await f.command('submission.review', { id: original.id, decision: 'return', expectedVersion: edited.version, reviewNote: '请补充参与条件' }, moderator);
  assert.equal(returned.version, 3);
  const resubmitted = await f.command('submission.save', { id: original.id, expectedVersion: returned.version, draft: draft({ title: 'Resubmitted title' }) });
  assert.equal(resubmitted.version, 4);
  await f.command('submission.review', { id: original.id, decision: 'publish', expectedVersion: resubmitted.version, sourceVerified: true }, moderator);
  assert.equal((await f.query<Submission>('submission.get', { id: original.id })).version, 5);
});

test('asset resolution allows private owners and moderators but requires a live public reference for everyone else', async () => {
  const f = fixture([]);
  await f.command('asset.register', { id: 'image-a', fileId: 'cloud://env/file', cloudPath: 'uploads/user-a/image-a.png', size: 100, mime: 'image/png' });
  assert.equal((await f.query<Asset[]>('assets.get', { ids: ['image-a'] }))[0].ownerId, user.userId);
  assert.equal((await f.query<Asset[]>('assets.get', { ids: ['image-a'] }, moderator)).length, 1);
  await assert.rejects(f.query('assets.get', { ids: ['image-a'] }, other), code('NOT_FOUND'));
  const registered = (await f.store.get<Asset>('assets', 'image-a'))!;
  await f.store.set('assets', registered.id, { ...registered, status: 'approved' });
  await assert.rejects(f.query('assets.get', { ids: ['image-a'] }, other), code('NOT_FOUND'));
  const visible = activity('public', { entrance: { kind: 'guide', label: '查看', instructions: '', imageIds: ['image-a'] } });
  await f.store.set('activities', visible.id, visible);
  const publicAssets = await f.query<Asset[]>('assets.get', { ids: ['image-a', 'image-a'] }, other);
  assert.equal(publicAssets.length, 1);
  assert.equal(publicAssets[0].ownerId, '');
  assert.equal(publicAssets[0].cloudPath, '');
  await f.command('activity.withdraw', { activityId: visible.id }, moderator);
  await assert.rejects(f.query('assets.get', { ids: ['image-a'] }, other), code('NOT_FOUND'));
});

test('asset registration stores the sealed canonical file and never invokes sealing again for a replay or duplicate identifier', async () => {
  const store = new MemoryStore();
  let sealed = 0;
  const service = createService(store, { now: () => new Date('2026-09-20T04:00:00.000Z'), validateAsset: async () => {
    sealed += 1;
    return { fileId: 'cloud://env/sealed/image-a/hash.png', cloudPath: 'sealed/user-a/image-a/hash.png', size: 98, mime: 'image/png' };
  } });
  const request: ApiRequest = { action: 'asset.register', requestId: 'register-a', payload: { id: 'image-a', fileId: 'cloud://env/temporary', cloudPath: 'uploads/user-a/image-a.png', size: 100, mime: 'image/png' } };
  await service.execute(user, request);
  await service.execute(user, request);
  await assert.rejects(service.execute(user, { ...request, requestId: 'register-b' }), code('CONFLICT'));
  assert.equal(sealed, 1);
  const saved = (await store.get<Asset>('assets', 'image-a'))!;
  assert.equal(saved.fileId, 'cloud://env/sealed/image-a/hash.png');
  assert.equal(saved.cloudPath, 'sealed/user-a/image-a/hash.png');
  assert.equal(saved.size, 98);
});

test('reminder permission is finite, idempotent, and tied to an owned entity and configured template', async () => {
  const f = fixture();
  const joined = await f.command('activity.join', { activityId: 'activity-a' });
  const payload: Commands['reminder.authorize'] = { kind: 'deadline', entityId: joined.id, templateId: 'deadline-template', accepted: true };
  await f.command('reminder.authorize', payload, user, 'grant-a');
  await f.command('reminder.authorize', payload, user, 'grant-a');
  assert.equal((await f.store.find<{ remaining: number }>('reminder_grants'))[0].remaining, 1);
  await assert.rejects(f.command('reminder.authorize', payload, other), code('NOT_FOUND'));
  await assert.rejects(f.command('reminder.authorize', { ...payload, templateId: 'tampered' }), code('TEMPLATE_UNAVAILABLE'));
});

test('new activity authorization is limited to the current user card matches and configured template', async () => {
  const f = fixture();
  const payload: Commands['reminder.authorize'] = { kind: 'new_activity', entityId: 'matches', templateId: 'new-activity-template', accepted: true };
  assert.equal((await f.query<ReminderPreference>('preferences.get')).newActivities, false);
  await assert.rejects(f.command('reminder.authorize', payload), code('CARD_REQUIRED'));
  await f.command('card.save', { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '消费卡' });
  await assert.rejects(f.command('reminder.authorize', { ...payload, entityId: 'activity-a' }), code('INVALID_INPUT'));
  await assert.rejects(f.command('reminder.authorize', { ...payload, templateId: 'arbitrary-template' }), code('TEMPLATE_UNAVAILABLE'));
  await f.command('reminder.authorize', payload, user, 'new-activity-authorization');
  await f.command('reminder.authorize', payload, user, 'new-activity-authorization');
  const grants = await f.store.find<{ ownerId: string; kind: string; entityId: string; remaining: number }>('reminder_grants');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].ownerId, user.userId);
  assert.equal(grants[0].kind, 'new_activity');
  assert.equal(grants[0].entityId, 'matches');
  assert.equal(grants[0].remaining, 1);
  assert.equal((await f.query<ReminderPreference>('preferences.get')).newActivities, true);
  await assert.rejects(f.command('reminder.authorize', payload, other), code('CARD_REQUIRED'));
  await f.command('preferences.save', { newActivities: false, deadlines: true, rewards: false, repayments: false });
  await f.command('reminder.authorize', { ...payload, accepted: false });
  const declined = await f.query<ReminderPreference>('preferences.get');
  assert.equal(declined.newActivities, false);
  assert.equal(declined.deadlines, true);
  assert.equal((await f.query<ReminderPreference>('preferences.get', {}, other)).newActivities, false);
});

test('explicit new activity subscription enables a matching worker delivery without a separate preference edit', async () => {
  const f = fixture([{ ...activity(), publishedAt: '2026-09-20T02:00:00.000Z' }]);
  await f.command('card.save', { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '消费卡' });
  await f.command('reminder.authorize', { kind: 'new_activity', entityId: 'matches', templateId: 'new-activity-template', accepted: true });
  let deliveredTo = '';
  const worker = createReminderWorker({
    store: f.store,
    now: () => new Date('2026-09-20T04:00:00.000Z'),
    configuration: { enabled: true, issues: [], templateIds: { new_activity: 'new-activity-template' }, templates: { new_activity: { templateId: 'new-activity-template', fields: { thing1: 'title', date2: 'dueOn' } } } },
    send: async message => { deliveredTo = message.touser; return { errCode: 0 }; },
  });
  const result = await worker();
  assert.equal(result.sent, 1);
  assert.equal(deliveredTo, user.userId);
  assert.equal((await f.store.find<{ remaining: number }>('reminder_grants'))[0].remaining, 0);
});

test('sixty recurring activities and a shared bill materialize in bounded, restartable transactions', async () => {
  const activities = Array.from({ length: 60 }, (_, index) => activity(`activity-${index}`));
  const store = new CappedStore({ activities: Object.fromEntries(activities.map(row => [row.id, row])) });
  let now = new Date('2026-09-20T04:00:00.000Z');
  let request = 0;
  const service = createService(store, { now: () => now, demo: true });
  const command = <K extends keyof Commands>(action: K, payload: Commands[K]) => service.execute(user, { action, payload, requestId: `bounded-${++request}` } as ApiRequest) as Promise<MutationResult>;
  for (const row of activities) await command('activity.join', { activityId: row.id });
  const card: Commands['card.save'] = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '主卡' };
  await command('card.save', { ...card, billing: { statementDay: 20, dueDay: 10, dueMonthOffset: 1, dueOn: '2026-10-10', remindDays: 3 } });
  const firstWallet = await service.execute(user, { action: 'wallet.get', payload: {} }) as Wallet;
  await command('card.save', { ...card, nickname: '共享账单卡', billingAccountId: firstWallet.cards[0].billingAccountId });
  now = new Date('2026-10-21T04:00:00.000Z');
  const firstBatchIndex = store.writeCounts.length;
  store.failTransaction = store.transactionCount + 2;
  await assert.rejects(service.execute(user, { action: 'dashboard.get', payload: {} }), /INTERRUPTED_BATCH/);
  assert.equal((await store.find<Participation>('participations')).filter(row => row.periodKey === '2026-10').length, 20);
  const dashboard = await service.execute(user, { action: 'dashboard.get', payload: {} }) as Dashboard;
  assert.equal(dashboard.tasks.filter(row => row.periodKey === '2026-10').length, 60);
  assert.equal((await store.find('participations')).length, 120);
  const bills = await store.find<{ periodKey: string }>('bills');
  assert.equal(bills.filter(row => row.periodKey === '2026-10').length, 1);
  assert.equal(bills.length, 2);
  assert.ok(store.writeCounts.every(writes => writes <= 98));
  assert.ok(store.writeCounts.slice(firstBatchIndex).filter(writes => writes === 40).length >= 3);
  const auditCount = (await store.find('audit_events')).length;
  await service.execute(user, { action: 'dashboard.get', payload: {} });
  assert.equal((await store.find('participations')).length, 120);
  assert.equal((await store.find('bills')).length, 2);
  assert.equal((await store.find('audit_events')).length, auditCount);
});

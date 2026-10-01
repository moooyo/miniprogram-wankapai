import test from 'node:test';
import assert from 'node:assert/strict';
import { Activity, ActivityDraft, ActivityItem, Actor, ApiRequest, Asset, AssetRecognition, Commands, Dashboard, Detail, MutationResult, PageResult, Participation, RecognitionResult, ReminderJob, RewardsView, Submission, Tracking } from '../shared/contracts';
import { cycleWindow, activityCycle } from '../shared/activity-cycle';
import { periodFor } from '../domain/calendar';
import { validateCycle, validateDraft, validateLead } from '../domain/validation';
import { createService, DomainError } from '../domain/service';
import { MemoryStore } from '../domain/memory-store';
import { createApiHandler } from '../cloudfunctions/api/handler';
import { createAssetRecognizer } from '../cloudfunctions/shared/recognition';
import { CloudStorage } from '../cloudfunctions/shared/assets';
import { createReminderWorker } from '../cloudfunctions/reminders/worker';
import { readReminderConfiguration } from '../cloudfunctions/reminders/configuration';
import { Store } from '../domain/store';

const owner: Actor = { userId: 'owner', isModerator: false };
const stranger: Actor = { userId: 'stranger', isModerator: false };
const moderator: Actor = { userId: 'moderator', isModerator: true };
function draft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  return { title: 'Monthly activity', bankId: 'cmb', issuerIds: [], networks: [], cardKind: 'any', cardDescription: 'Eligible cards',
    frequency: 'monthly', startsOn: '2026-07-01', endsOn: '2026-12-31', target: 3, unit: '笔', currency: 'CNY', rewardMinor: 1800,
    rewardKind: 'cashback', scope: 'user', requiresRegistration: true, requiresInvitation: false, conditions: 'Three purchases',
    sourceUrl: 'https://www.cmbchina.com/', sourceNote: '', entrance: { kind: 'guide', label: 'Activity entrance', instructions: 'Bank app > activities', imageIds: [] }, ...overrides };
}
function activity(id = 'monthly', overrides: Partial<ActivityDraft> = {}): Activity {
  return { ...draft(overrides), id, revision: 1, status: 'published', publishedAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', publishedBy: 'moderator' };
}
function asset(id = 'shot', ownerId = owner.userId): Asset {
  return { id, ownerId, fileId: `cloud://env.bucket/sealed/${ownerId}/${id}.png`, cloudPath: `sealed/${ownerId}/${id}.png`, size: 100, mime: 'image/png', status: 'pending', createdAt: '2026-09-30T04:00:00Z' };
}
function fixture(activities = [activity()], demo = true, recognizeAssets?: (actor: Actor, assets: Asset[]) => Promise<AssetRecognition[]>) {
  const store = new MemoryStore({ activities: Object.fromEntries(activities.map(row => [row.id, row])), assets: { shot: asset(), foreign: asset('foreign', stranger.userId) } });
  let date = '2026-09-30';
  let sequence = 0;
  const service = createService(store, { demo, now: () => new Date(`${date}T04:00:00Z`), recognizeAssets, templateIds: { deadline: 'verified-template', reward: 'verified-template' } });
  return { store, service, setDate: (value: string) => { date = value; },
    query: <T>(action: string, payload: unknown = {}, actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T>,
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `request-${++sequence}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult> };
}
const code = (value: string) => (error: unknown) => error instanceof DomainError && error.code === value;

test('shared cycle windows reset at exact weekly and offset-monthly boundaries', () => {
  assert.deepEqual(cycleWindow({ t: 'month', day: 21 }, '2026-09-20'), { s: '2026-08-21', e: '2026-09-20', ns: '2026-09-21', ps: '2026-07-21' });
  assert.deepEqual(cycleWindow({ t: 'month', day: 21 }, '2026-09-21'), { s: '2026-09-21', e: '2026-10-20', ns: '2026-10-21', ps: '2026-08-21' });
  assert.deepEqual(cycleWindow({ t: 'week', weekday: 1 }, '2026-10-04'), { s: '2026-09-28', e: '2026-10-04', ns: '2026-10-05', ps: '2026-09-21' });
  assert.equal(cycleWindow({ t: 'week', weekday: 0 }, '2026-10-04').s, '2026-10-04');
  const input = draft({ cycle: { t: 'month', day: 21 }, startsOn: '2026-09-25', endsOn: '2026-10-05' });
  assert.deepEqual(periodFor(input, '2026-09-30'), { periodKey: 'month:2026-09-21', startsOn: '2026-09-25', endsOn: '2026-10-05' });
  assert.equal(periodFor(input, '2026-10-06'), null);
  assert.deepEqual(activityCycle(draft()), { t: 'month', day: 1 });
});

test('catalog totals count the complete filtered set before pagination', async () => {
  const f = fixture([activity('first'), activity('second'), activity('foreign-bank', { bankId: 'hsbc' })]);
  const first = await f.query<PageResult<ActivityItem>>('catalog.list', { bankId: 'cmb', limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.total, 2);
  assert.equal(first.nextCursor, '1');
  const second = await f.query<PageResult<ActivityItem>>('catalog.list', { bankId: 'cmb', limit: 1, cursor: '1' });
  assert.equal(second.total, 2);
  assert.equal(second.nextCursor, null);
  assert.notEqual(first.items[0].activity.id, second.items[0].activity.id);
  assert.equal((await f.query<PageResult<ActivityItem>>('catalog.list', { mineOnly: true })).total, 0);
});

test('custom cycles share anchors across year boundaries and clamp month-end without drift', () => {
  assert.deepEqual(cycleWindow({ t: 'custom', n: 10, unit: 'day', anchor: '2026-09-01' }, '2026-09-30'), { s: '2026-09-21', e: '2026-09-30', ns: '2026-10-01', ps: '2026-09-11' });
  assert.deepEqual(cycleWindow({ t: 'custom', n: 3, unit: 'month', anchor: '2026-07-01' }, '2026-10-01'), { s: '2026-10-01', e: '2026-12-31', ns: '2027-01-01', ps: '2026-07-01' });
  assert.equal(cycleWindow({ t: 'custom', n: 2, unit: 'week', anchor: '2026-09-02' }, '2026-09-30').s, '2026-09-30');
  assert.deepEqual(cycleWindow({ t: 'custom', n: 1, unit: 'month', anchor: '2026-01-31' }, '2026-02-28'), { s: '2026-02-28', e: '2026-03-30', ns: '2026-03-31', ps: '2026-01-31' });
  assert.deepEqual(cycleWindow({ t: 'once', start: '2026-09-01', end: '2026-10-07' }, '2026-09-30'), { s: '2026-09-01', e: '2026-10-07', ns: null, ps: null });
});

test('cycle and optional lead-rule validation retain only valid publication inputs', () => {
  for (const invalid of [{ t: 'month', day: 29 }, { t: 'week', weekday: 7 }, { t: 'week', weekday: 1, days: [1, 1] }, { t: 'custom', n: 91, unit: 'day', anchor: '2026-07-01' }, { t: 'custom', n: 13, unit: 'month', anchor: '2026-07-01' }, { t: 'once', start: '2026-09-20', end: '2026-09-19' }]) {
    assert.throws(() => validateCycle(invalid));
  }
  assert.throws(() => validateDraft(draft({ cycle: { t: 'custom', n: 3, unit: 'month', anchor: '2026-08-01' } })), code('INVALID_INPUT'));
  assert.throws(() => validateDraft(draft({ rewardKind: 'points', rewardMinor: 201 })), code('INVALID_INPUT'));
  const base = { title: 'Activity', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app > activities', imageIds: [] };
  const input = { rewardKind: 'voucher' as const, rewardMinor: 1800, cycle: { t: 'month' as const, day: 21 }, conditions: 'Three purchases' };
  assert.deepEqual(validateLead({ ...base, rules: input }).rules, input);
  assert.throws(() => validateLead({ ...base, rules: { ownerId: 'stranger' } }), code('INVALID_INPUT'));
  assert.throws(() => validateLead({ ...base, rules: { startsOn: '2026-10-01', endsOn: '2026-09-01' } }), code('INVALID_INPUT'));
  assert.equal(validateDraft(draft({ rewardKind: 'gift' })).rewardKind, 'gift');
});

test('weekly automatic periods and new receipt intents keep immutable period snapshots', async () => {
  const f = fixture([activity('weekly', { cycle: { t: 'week', weekday: 1 } })]);
  const joined = await f.command('activity.join', { activityId: 'weekly' });
  const first = (await f.store.get<Participation>('participations', joined.id))!;
  assert.equal(first.periodKey, 'week:2026-09-28');
  await f.store.set('activities', 'weekly', { ...activity('weekly', { cycle: { t: 'week', weekday: 1 }, rewardMinor: 2400 }), revision: 2 });
  f.setDate('2026-10-05');
  const dashboard = await f.query<Dashboard>('dashboard.get');
  const second = dashboard.tasks.find(row => row.periodKey === 'week:2026-10-05')!;
  assert.equal(second.snapshot.rewardMinor, 2400);
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.snapshot.rewardMinor, 1800);
  assert.equal((await f.store.get<Participation>('participations', joined.id))!.endsOn, first.endsOn);
  await assert.rejects(f.command('reward.confirm', { activityId: 'weekly', amountMinor: 2400, receivedOn: '2026-10-05', expectNew: true, expectedPeriodKey: 'week:2026-09-28' }), code('VERSION_CONFLICT'));
  const fresh = fixture([activity('weekly', { cycle: { t: 'week', weekday: 1 } })]);
  const receipt = await fresh.command('reward.confirm', { activityId: 'weekly', amountMinor: 1800, receivedOn: '2026-09-30', expectNew: true, expectedPeriodKey: 'week:2026-09-28' });
  assert.equal((await fresh.store.get<Participation>('participations', receipt.id))!.stage, 'received');
});

test('withdrawal hides every follow-up projection while retaining receipt history and restoring same-period progress', async () => {
  const f = fixture([activity('monthly', { cycle: { t: 'month', day: 21 } })]);
  const joined = await f.command('activity.join', { activityId: 'monthly' });
  await f.command('participation.progress', { participationId: joined.id, progress: 2, registered: true });
  await f.command('participation.complete', { participationId: joined.id });
  await f.command('participation.expected', { participationId: joined.id, expectedOn: '2026-09-30' });
  const before = (await f.store.get<Participation>('participations', joined.id))!;
  const exited = await f.command('activity.untrack', { participationId: joined.id }, owner, 'withdraw-once');
  assert.deepEqual(await f.command('activity.untrack', { participationId: joined.id }, owner, 'withdraw-once'), exited);
  const after = (await f.store.get<Participation>('participations', joined.id))!;
  assert.equal(after.progress, before.progress);
  assert.equal(after.registeredAt, before.registeredAt);
  assert.equal(after.completedAt, before.completedAt);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.ok(after.withdrawnAt);
  assert.equal((await f.query<Dashboard>('dashboard.get')).pendingRewards.length, 0);
  assert.equal((await f.query<Dashboard>('dashboard.get')).tasks.length, 0);
  assert.equal((await f.query<RewardsView>('rewards.get')).pending.length, 0);
  assert.equal((await f.query<PageResult<Participation>>('history.list')).items[0].stage, 'completed');
  assert.equal((await f.query<PageResult<Participation>>('history.list', { filter: 'pending' })).items.length, 0);
  const catalog = await f.query<PageResult<ActivityItem>>('catalog.list');
  assert.ok(catalog.items[0].participation?.withdrawnAt);
  assert.equal(catalog.items[0].tracking?.enabled, false);
  await assert.rejects(f.command('reminder.authorize', { kind: 'reward', entityId: joined.id, templateId: 'verified-template', accepted: true }), code('REMINDER_UNAVAILABLE'));
  const rejoined = await f.command('activity.join', { activityId: 'monthly' });
  assert.equal(rejoined.id, joined.id);
  const detail = await f.query<Detail>('activity.get', { participationId: joined.id });
  assert.equal(detail.participation?.withdrawnAt, null);
  assert.equal(detail.participation?.progress, 2);
  assert.equal(detail.participation?.stage, 'completed');
  assert.equal(detail.tracking?.enabled, true);
  assert.equal((await f.query<RewardsView>('rewards.get')).pending.length, 1);
  await f.command('reward.confirm', { participationId: joined.id, amountMinor: 1800, receivedOn: '2026-09-30' });
  await f.command('activity.untrack', { participationId: joined.id });
  assert.equal((await f.query<RewardsView>('rewards.get')).received.length, 1);
  assert.equal((await f.query<RewardsView>('rewards.get')).totalMinor, 1800);
});

test('withdrawal cancels already queued reminders without consuming authorization grants', async () => {
  const f = fixture([activity('once', { frequency: 'once', startsOn: '2026-09-01', endsOn: '2026-09-30' })]);
  const joined = await f.command('activity.join', { activityId: 'once' });
  await f.command('preferences.save', { newActivities: false, deadlines: true, rewards: false, repayments: false });
  await f.command('reminder.authorize', { kind: 'deadline', entityId: joined.id, templateId: 'verified-template', accepted: true });
  let sent = 0;
  await createReminderWorker({ store: f.store, configuration: readReminderConfiguration({}), now: () => new Date('2026-09-30T04:00:00Z'), send: async () => { sent += 1; return { errCode: 0 }; } })();
  assert.equal((await f.store.find<ReminderJob>('reminder_jobs')).length, 1);
  await f.command('activity.untrack', { participationId: joined.id });
  const configuration = readReminderConfiguration({ REMINDERS_ENABLED: 'true', REMINDER_TEMPLATES_JSON: JSON.stringify({ deadline: { templateId: 'verified-template', fields: { thing1: 'title', date2: 'dueOn' } } }) });
  const report = await createReminderWorker({ store: f.store, configuration, now: () => new Date('2026-09-30T04:00:00Z'), send: async () => { sent += 1; return { errCode: 0 }; } })();
  assert.equal(report.cancelled, 1);
  assert.equal(sent, 0);
  assert.equal((await f.store.find<{ remaining: number }>('reminder_grants'))[0].remaining, 1);
});

test('rejoining after a reset restores older pending records without generating exited periods', async () => {
  const f = fixture([activity('monthly', { cycle: { t: 'month', day: 21 } })]);
  const joined = await f.command('activity.join', { activityId: 'monthly' });
  await f.command('participation.progress', { participationId: joined.id, progress: 2, registered: true });
  await f.command('participation.complete', { participationId: joined.id });
  await f.command('activity.untrack', { participationId: joined.id });
  f.setDate('2026-11-22');
  assert.equal((await f.query<Dashboard>('dashboard.get')).pendingRewards.length, 0);
  assert.equal((await f.store.find<Participation>('participations')).length, 1);
  const current = await f.command('activity.join', { activityId: 'monthly' });
  assert.notEqual(current.id, joined.id);
  const dashboard = await f.query<Dashboard>('dashboard.get');
  assert.equal(dashboard.pendingRewards[0].id, joined.id);
  assert.equal(dashboard.pendingRewards[0].progress, 2);
  assert.equal((await f.query<Detail>('activity.get', { participationId: joined.id })).participation?.withdrawnAt, null);
  assert.deepEqual((await f.store.find<Participation>('participations')).map(record => record.periodKey).sort(), ['month:2026-09-21', 'month:2026-11-21']);
});

test('lead rules are private until verified publication and cannot reference another owners images', async () => {
  const f = fixture([]);
  const lead = { title: 'Optional rule lead', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app > activities', imageIds: ['shot'],
    rules: { rewardKind: 'voucher' as const, rewardMinor: 1800, cycle: { t: 'month' as const, day: 21 } } };
  const saved = await f.command('submission.lead.save', { lead });
  const submission = await f.query<Submission>('submission.get', { id: saved.id });
  assert.deepEqual(submission.lead?.rules, lead.rules);
  assert.equal((await f.query<PageResult<ActivityItem>>('catalog.list')).items.length, 0);
  await assert.rejects(f.command('submission.lead.save', { lead: { ...lead, rules: { entrance: { kind: 'guide', label: 'Entry', instructions: '', imageIds: ['foreign'] } } } }), code('INVALID_ASSET'));
  await assert.rejects(f.command('submission.review', { id: saved.id, expectedVersion: saved.version, decision: 'publish', draft: draft({ ...lead.rules, entrance: { ...draft().entrance, imageIds: ['shot'] } }) }, moderator), code('SOURCE_UNVERIFIED'));
  await f.command('submission.review', { id: saved.id, expectedVersion: saved.version, decision: 'publish', sourceVerified: true, draft: draft({ ...lead.rules, entrance: { ...draft().entrance, imageIds: ['shot'] } }) }, moderator);
  const published = (await f.store.find<Activity>('activities'))[0];
  assert.equal(published.rewardKind, 'voucher');
  assert.deepEqual(published.cycle, { t: 'month', day: 21 });
  assert.equal((await f.store.get<Asset>('assets', 'shot'))!.status, 'approved');
});

test('screenshot recognition authenticates owners and keeps demo fixtures explicit', async () => {
  const f = fixture();
  const result = await f.query<RecognitionResult>('assets.recognize', { ids: ['shot'] });
  assert.equal(result.demo, true);
  assert.equal(result.items[0].fields.rewardMinor, 1800);
  assert.deepEqual(result.items[0].fields.cycle, { t: 'month', day: 21 });
  assert.equal(result.items[0].regions.length, 4);
  await assert.rejects(f.query('assets.recognize', { ids: ['shot'] }, stranger), code('NOT_FOUND'));
  await assert.rejects(f.query('assets.recognize', { ids: ['shot', 'shot'] }), code('INVALID_INPUT'));
  await assert.rejects(f.query('assets.recognize', { ids: [] }), code('INVALID_INPUT'));
  await assert.rejects(f.query('assets.recognize', { ids: ['shot'] }, { userId: '', isModerator: false }), code('UNAUTHENTICATED'));
  const production = fixture([], false);
  await assert.rejects(production.query('assets.recognize', { ids: ['shot'] }), code('OCR_UNAVAILABLE'));
});

test('production recognition validates provider fields, assets, coordinates and trusted cloud session', async () => {
  const valid = (assets: Asset[]): AssetRecognition[] => assets.map(row => ({ assetId: row.id, fields: { title: 'Recognized activity' }, regions: [{ field: 'title', label: '名称', x: 0.1, y: 0.1, width: 0.8, height: 0.2 }], recognized: true }));
  let calls = 0;
  const f = fixture([], false, async (_actor, assets) => { calls += 1; return valid(assets); });
  await assert.rejects(f.query('assets.recognize', { ids: ['foreign'] }), code('NOT_FOUND'));
  assert.equal(calls, 0);
  assert.equal((await f.query<RecognitionResult>('assets.recognize', { ids: ['shot'] })).demo, false);
  assert.equal(calls, 1);
  for (const invalid of [
    (assets: Asset[]) => [{ ...valid(assets)[0], assetId: 'foreign' }],
    (assets: Asset[]) => [{ ...valid(assets)[0], fields: { rewardMinor: -1 } }],
    (assets: Asset[]) => [{ ...valid(assets)[0], regions: [{ ...valid(assets)[0].regions[0], x: 0.8 }] }],
  ]) await assert.rejects(fixture([], false, async (_actor, assets) => invalid(assets)).query('assets.recognize', { ids: ['shot'] }), code('OCR_INVALID_RESULT'));
  const storage: CloudStorage = { uploadFile: async () => ({ fileID: 'unused' }), getTempFileURL: async input => ({ fileList: input.fileList.map(item => ({ fileID: item.fileID, status: 0, tempFileURL: 'https://storage.tencentcloud.com/shot.png' })) }) };
  const handler = createApiHandler({ store: f.store, storage, context: () => ({ OPENID: owner.userId, SOURCE: 'other' }), moderatorOpenIds: [], options: { recognizeAssets: async (_actor, assets) => valid(assets) } });
  assert.deepEqual(await handler({ action: 'assets.recognize', payload: { ids: ['shot'] }, actor: { ...moderator } }), { ok: false, error: { code: 'UNAUTHENTICATED', message: '请通过微信小程序登录' } });
  let providerCalls = 0;
  const configured = createAssetRecognizer(storage, { OCR_ENDPOINT: 'https://ocr.tencentcloud.com/activities', OCR_TOKEN: 'configured-token' }, async (endpoint, token, payload) => {
    providerCalls += 1;
    assert.equal(endpoint, 'https://ocr.tencentcloud.com/activities');
    assert.equal(token, 'configured-token');
    assert.deepEqual(payload, { assets: [{ id: 'shot', url: 'https://storage.tencentcloud.com/shot.png', mime: 'image/png' }], locale: 'zh-CN' });
    return { items: valid([asset()]) };
  });
  assert.equal((await configured(owner, [asset()]))[0].fields.title, 'Recognized activity');
  assert.equal(providerCalls, 1);
  await assert.rejects(createAssetRecognizer(storage, {}, async () => { providerCalls += 1; return { items: [] }; })(owner, [asset()]), code('OCR_UNAVAILABLE'));
  assert.equal(providerCalls, 1);
});

test('point receipts remain integral and never enter monetary totals', async () => {
  const f = fixture([activity('points', { rewardKind: 'points', rewardMinor: 200000 })]);
  await assert.rejects(f.command('reward.confirm', { activityId: 'points', amountMinor: 200001, receivedOn: '2026-09-30' }), code('INVALID_INPUT'));
  const result = await f.command('reward.confirm', { activityId: 'points', amountMinor: 200000, receivedOn: '2026-09-30' });
  const view = await f.query<RewardsView>('rewards.get');
  assert.equal(view.rewardKinds?.[result.id], 'points');
  assert.equal(view.totalMinor, 0);
  assert.equal(view.cashbackMinor, 0);
  assert.equal(view.received[0].amountMinor, 200000);
  assert.equal((await f.store.find<Tracking>('trackings')).length, 0);
});

test('store transaction replanning never repeats an external recognition provider call', async () => {
  class ReplanningStore extends MemoryStore {
    override async transaction<T>(callback: (transaction: Store) => Promise<T>): Promise<T> {
      await super.transaction(callback);
      return super.transaction(callback);
    }
  }
  const store = new ReplanningStore({ assets: { shot: asset() } });
  let calls = 0;
  const service = createService(store, { recognizeAssets: async (_actor, assets) => {
    calls += 1;
    return assets.map(row => ({ assetId: row.id, fields: { title: 'Recognized activity' }, regions: [], recognized: true }));
  } });
  const result = await service.execute(owner, { action: 'assets.recognize', payload: { ids: ['shot'] } }) as RecognitionResult;
  assert.equal(result.items[0].fields.title, 'Recognized activity');
  assert.equal(calls, 1);
});

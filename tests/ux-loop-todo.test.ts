import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Activity, Dashboard, Participation } from '../shared/contracts';
import { api } from '../miniprogram/services/api';

type PageInstance = { data: Record<string, any>; patches: Record<string, unknown>[]; [key: string]: any };
type ApiCall = { action: string; payload: any };

let definition: PageInstance;
let queryHandler: (action: string, payload: any) => Promise<any>;
let commandHandler: (action: string, payload: any) => Promise<any>;
let queries: ApiCall[] = [];
let commands: ApiCall[] = [];
let navigation: string[] = [];
let toasts: string[] = [];
let pullRefreshStops = 0;
const originalQuery = api.query;
const originalCommand = api.command;
const originalWx = (globalThis as any).wx;

before(async () => {
  const runtime = globalThis as any;
  const originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/todo/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  queries = []; commands = []; navigation = []; toasts = []; pullRefreshStops = 0;
  (globalThis as any).wx = {
    showToast: ({ title }: { title: string }) => { toasts.push(title); },
    navigateTo: ({ url }: { url: string }) => { navigation.push(url); },
    stopPullDownRefresh: () => { pullRefreshStops += 1; },
  };
  queryHandler = async action => {
    if (action === 'session.get') return { userId: 'todo-user', demo: true, isModerator: false, today: '2026-09-22', month: '2026-09' };
    throw new Error(`Unexpected query ${action}`);
  };
  commandHandler = async () => ({ id: 'updated', version: 2 });
  api.query = (async (action: string, payload: any) => {
    queries.push({ action, payload: structuredClone(payload) });
    return queryHandler(action, payload);
  }) as typeof api.query;
  api.command = (async (action: string, payload: any) => {
    commands.push({ action, payload: structuredClone(payload) });
    return commandHandler(action, payload);
  }) as typeof api.command;
});

after(() => {
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).wx = originalWx;
});

function page(raw?: Dashboard, filter = 'unfinished'): PageInstance {
  const instance: PageInstance = {
    ...definition, data: structuredClone(definition.data), patches: [],
    setData(patch: Record<string, unknown>) {
      this.patches.push(patch);
      Object.assign(this.data, patch);
    },
  };
  if (raw) {
    instance.setData({ raw, loading: false, filter });
    instance.applyFilter();
    instance.patches = [];
  }
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function dashboardResponse(response: () => Promise<Dashboard>) {
  const fallback = queryHandler;
  queryHandler = async (action, payload) => action === 'dashboard.get' ? response() : fallback(action, payload);
}

function pendingDashboard() {
  const started = deferred<void>();
  const request = deferred<Dashboard>();
  dashboardResponse(async () => { started.resolve(); return request.promise; });
  return { started: started.promise, ...request };
}

function activity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id, revision: 1, status: 'published', title: id, bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31',
    target: 3, unit: 'transactions', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three eligible transactions', sourceUrl: '', sourceNote: '',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the bank app', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function participation(id: string, overrides: Partial<Participation> = {}, activityOverrides: Partial<Activity> = {}): Participation {
  return {
    id, ownerId: 'todo-user', activityId: `activity-${id}`, activityRevision: 1, scopeKey: 'user:todo-user',
    snapshot: activity(`activity-${id}`, activityOverrides), periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30',
    stage: 'in_progress', progress: 1, registeredAt: null, startedAt: '2026-09-01T00:00:00Z', completedAt: null,
    expectedOn: null, receivedOn: null, receivedMinor: null, version: 1,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...overrides,
  };
}

function dashboard(tasks = [
  participation('progress', { endsOn: '2026-09-21' }),
  participation('complete', { endsOn: '2026-09-25', progress: 0 }, { target: 1 }),
  participation('later', { endsOn: '2026-10-10' }),
  participation('completed', { stage: 'completed', progress: 3 }),
  participation('received', { stage: 'received', progress: 3 }),
  participation('skipped', { stage: 'skipped' }),
]): Dashboard {
  return { today: '2026-09-22', tasks, pendingRewards: tasks.filter(item => item.stage === 'completed'), bills: [], accounts: [], cards: [] };
}

function event(id = '') { return { currentTarget: { dataset: { id } } }; }

async function assertRowActionsBlocked(instance: PageInstance) {
  const raw = instance.data.raw;
  const rows = instance.data.tasks;
  const previousCommands = commands.length;
  const previousNavigation = navigation.length;
  const previousToasts = toasts.length;
  const previousHandler = commandHandler;
  commandHandler = async () => { throw new Error('A blocked row must not submit a command'); };
  try {
    assert.equal(instance.actionsBlocked(), true);
    instance.openTask(event('progress'));
    instance.editProgress(event('progress'));
    instance.receipt(event('completed'));
    instance.showMore(event('progress'));
    for (const id of ['progress', 'complete', 'completed', 'received', 'skipped']) await instance.runPrimaryAction(event(id));
    await instance.complete(event('complete'));
    await instance.toggleSkip(event('progress'));
    await instance.toggleSkip(event('skipped'));
    instance.setData({ actionId: 'progress' });
    instance.editProgress(event());
    instance.receipt(event());
    await instance.complete(event());
    await instance.toggleSkip();
    instance.setData({ actionId: 'completed' });
    await instance.undoComplete();
    assert.equal(commands.length, previousCommands, 'Neither direct nor sheet actions may mutate an obsolete record.');
    assert.equal(navigation.length, previousNavigation, 'Neither direct nor primary actions may navigate with obsolete row data.');
    assert.equal(toasts.length, previousToasts);
    assert.equal(instance.data.showActions, false);
    assert.equal(instance.data.busyId, '');
    assert.equal(instance.data.raw, raw);
    assert.equal(instance.data.tasks, rows);
  } finally { commandHandler = previousHandler; }
}

test('initial loading has no obsolete content and publishes complete task groups only after success', async () => {
  const instance = page();
  const request = pendingDashboard();
  const loading = instance.load();
  await request.started;
  assert.equal(instance.data.loading, true);
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.raw, null);
  assert.deepEqual(instance.data.tasks, []);
  assert.equal(instance.actionsBlocked(), true);
  const raw = dashboard();
  request.resolve(raw);
  await loading;
  assert.equal(instance.data.raw, raw);
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.failed, false);
  assert.equal(instance.actionsBlocked(), false);
  assert.deepEqual(instance.data.tasks.map((row: any) => [row.id, row.groupKey, row.showGroupTitle, row.groupCount]), [
    ['progress', 'overdue', true, 1], ['complete', 'soon', true, 1], ['later', 'later', true, 1],
  ]);
  assert.equal(instance.data.unfinishedCount, 3);
  assert.equal(instance.data.completedCount, 2);
  assert.equal(instance.data.allCount, 6);
  assert.equal(instance.data.pendingCount, 1);
});

test('initial load failure offers a full retry and stops the pull refresh indicator', async () => {
  const instance = page();
  dashboardResponse(async () => { throw new Error('Initial dashboard unavailable'); });
  await instance.onPullDownRefresh();
  assert.equal(instance.data.failed, true);
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.outdated, false);
  assert.equal(instance.data.refreshError, '');
  assert.equal(instance.data.raw, null);
  assert.equal(instance.actionsBlocked(), true);
  assert.deepEqual(toasts, ['Initial dashboard unavailable']);
  assert.equal(pullRefreshStops, 1);
  const raw = dashboard();
  dashboardResponse(async () => raw);
  await instance.load();
  assert.equal(instance.data.raw, raw);
  assert.equal(instance.data.failed, false);
  assert.equal(instance.actionsBlocked(), false);
});

test('refresh preserves existing row and group references without entering the full loading state', async () => {
  const raw = dashboard();
  const instance = page(raw);
  const rows = instance.data.tasks;
  const groups = rows.map((row: any) => [row.id, row.groupKey, row.showGroupTitle, row.groupCount]);
  instance.showMore(event('progress'));
  const request = pendingDashboard();
  const loading = instance.load();
  await request.started;
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.refreshing, true);
  assert.equal(instance.data.showActions, false);
  assert.equal(instance.data.raw, raw);
  assert.equal(instance.data.tasks, rows);
  assert.deepEqual(instance.data.tasks.map((row: any) => [row.id, row.groupKey, row.showGroupTitle, row.groupCount]), groups);
  assert.equal(instance.data.unfinishedCount, 3);
  assert.equal(instance.data.completedCount, 2);
  assert.equal(instance.data.allCount, 6);
  await assertRowActionsBlocked(instance);
  const current = dashboard([participation('current', { endsOn: '2026-09-27' })]);
  request.resolve(current);
  await loading;
  assert.equal(instance.data.raw, current);
  assert.deepEqual(instance.data.tasks.map((row: any) => [row.id, row.groupKey, row.groupCount]), [['current', 'soon', 1]]);
  assert.ok(instance.patches.every(patch => patch.loading !== true), 'Refreshing an existing dashboard must never unmount the task list.');
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.actionsBlocked(), false);
});

test('failed refresh retains rows and groups, locks all stale row actions, and unlocks after a successful retry', async () => {
  const raw = dashboard();
  const instance = page(raw);
  const rows = instance.data.tasks;
  dashboardResponse(async () => { throw new Error('Refresh unavailable'); });
  await instance.load();
  assert.equal(instance.data.raw, raw);
  assert.equal(instance.data.tasks, rows);
  assert.equal(instance.data.failed, false);
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.outdated, true);
  assert.match(instance.data.refreshError, /上次读取/);
  assert.match(instance.data.refreshError, /刷新成功后再操作/);
  assert.deepEqual(toasts, []);
  await assertRowActionsBlocked(instance);
  const request = pendingDashboard();
  const retry = instance.load();
  await request.started;
  assert.equal(instance.data.raw, raw);
  assert.equal(instance.data.tasks, rows);
  assert.equal(instance.data.outdated, true);
  assert.equal(instance.data.refreshing, true);
  assert.equal(instance.data.refreshError, '');
  await assertRowActionsBlocked(instance);
  const current = dashboard();
  request.resolve(current);
  await retry;
  assert.equal(instance.data.raw, current);
  assert.equal(instance.data.outdated, false);
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.refreshError, '');
  assert.equal(instance.actionsBlocked(), false);
  instance.showMore(event('progress'));
  assert.equal(instance.data.showActions, true);
  instance.editProgress(event());
  assert.deepEqual(navigation, ['/pages/progress/index?id=progress&activityId=activity-progress']);
});

const mutations = [
  { name: 'completion', id: 'complete', action: 'participation.complete', payload: { participationId: 'complete' },
    notice: '完成状态已保存。', stage: 'completed', invoke: (instance: PageInstance) => instance.complete(event('complete')) },
  { name: 'skip', id: 'progress', action: 'participation.skip', payload: { participationId: 'progress', skipped: true },
    notice: '本期跳过状态已保存。', stage: 'skipped', invoke: (instance: PageInstance) => instance.toggleSkip(event('progress')) },
  { name: 'resume', id: 'skipped', action: 'participation.skip', payload: { participationId: 'skipped', skipped: false },
    notice: '本期参与已恢复。', stage: 'in_progress', invoke: (instance: PageInstance) => instance.toggleSkip(event('skipped')) },
  { name: 'undo completion', id: 'completed', action: 'participation.undoComplete', payload: { participationId: 'completed' },
    notice: '撤销完成已保存。', stage: 'in_progress', invoke: (instance: PageInstance) => instance.undoComplete() },
] as const;

for (const mutation of mutations) {
  test(`saved ${mutation.name} remains acknowledged after refresh failure and retry never resubmits the mutation`, async () => {
    const raw = dashboard();
    const instance = page(raw, 'all');
    const rows = instance.data.tasks;
    instance.setData({ actionId: mutation.id, showActions: true });
    const request = pendingDashboard();
    const saving = mutation.invoke(instance);
    await request.started;
    assert.deepEqual(commands, [{ action: mutation.action, payload: mutation.payload }]);
    assert.equal(instance.data.mutationNotice, mutation.notice);
    assert.equal(instance.data.busyId, mutation.id);
    assert.equal(instance.data.refreshing, true);
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.showActions, false);
    assert.equal(instance.data.raw, raw);
    assert.equal(instance.data.tasks, rows);
    await mutation.invoke(instance);
    assert.equal(commands.length, 1, 'Repeated actions during the post-save refresh must not resubmit the saved change.');
    request.reject(new Error('Dashboard reload failed'));
    await saving;
    assert.equal(instance.data.busyId, '');
    assert.equal(instance.data.outdated, true);
    assert.equal(instance.data.refreshing, false);
    assert.equal(instance.data.failed, false);
    assert.equal(instance.data.raw, raw);
    assert.equal(instance.data.tasks, rows);
    assert.equal(instance.data.mutationNotice, mutation.notice);
    assert.ok(instance.data.refreshError.startsWith(mutation.notice));
    assert.match(instance.data.refreshError, /上次读取/);
    assert.equal(toasts.length, 1, 'A failed reload must not misreport an already successful mutation as a failed save.');
    assert.notEqual(toasts[0], 'Dashboard reload failed');
    await mutation.invoke(instance);
    assert.equal(commands.length, 1);
    dashboardResponse(async () => { throw new Error('Retry still unavailable'); });
    await instance.load();
    assert.equal(instance.data.mutationNotice, mutation.notice);
    assert.ok(instance.data.refreshError.startsWith(mutation.notice));
    assert.equal(instance.data.tasks, rows);
    assert.equal(commands.length, 1);
    const current = dashboard(raw.tasks.map(item => item.id === mutation.id ? { ...item, stage: mutation.stage, version: 2 } : item));
    dashboardResponse(async () => current);
    await instance.load();
    assert.equal(instance.data.raw, current);
    const updated = instance.data.raw.tasks.find((item: Participation) => item.id === mutation.id);
    assert.ok(updated, 'The refreshed dashboard must retain the selected record.');
    assert.equal(updated.stage, mutation.stage);
    assert.equal(instance.data.filter, 'all');
    assert.equal(instance.data.mutationNotice, '');
    assert.equal(instance.data.refreshError, '');
    assert.equal(instance.data.outdated, false);
    assert.equal(instance.actionsBlocked(), false);
    assert.equal(commands.length, 1, 'Only dashboard queries may be retried after the save has succeeded.');
    instance.openTask(event(mutation.id));
    assert.deepEqual(navigation, [`/pages/detail/index?id=activity-${mutation.id}&participationId=${mutation.id}`]);
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`an obsolete refresh ${outcome} cannot clear the newest request's loading state or replace its content`, async () => {
    const raw = dashboard();
    const instance = page(raw);
    const rows = instance.data.tasks;
    const oldRequest = pendingDashboard();
    const oldLoad = instance.load();
    await oldRequest.started;
    const newRequest = pendingDashboard();
    const newLoad = instance.load();
    await newRequest.started;
    if (outcome === 'success') oldRequest.resolve(dashboard([participation('obsolete')]));
    else oldRequest.reject(new Error('Obsolete failure'));
    await oldLoad;
    assert.equal(instance.data.raw, raw);
    assert.equal(instance.data.tasks, rows);
    assert.equal(instance.data.refreshing, true);
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.outdated, false);
    assert.equal(instance.data.failed, false);
    assert.equal(instance.data.refreshError, '');
    assert.deepEqual(toasts, []);
    const current = dashboard([participation('current')]);
    newRequest.resolve(current);
    await newLoad;
    assert.equal(instance.data.raw, current);
    assert.deepEqual(instance.data.tasks.map((row: any) => row.id), ['current']);
    assert.equal(instance.data.refreshing, false);
  });

  test(`an obsolete refresh ${outcome} arriving last cannot overwrite a newer successful dashboard`, async () => {
    const instance = page(dashboard());
    const oldRequest = pendingDashboard();
    const oldLoad = instance.load();
    await oldRequest.started;
    const current = dashboard([participation('current')]);
    dashboardResponse(async () => current);
    await instance.load();
    const currentRows = instance.data.tasks;
    const patchCount = instance.patches.length;
    if (outcome === 'success') oldRequest.resolve(dashboard([participation('obsolete')]));
    else oldRequest.reject(new Error('Obsolete failure'));
    await oldLoad;
    assert.equal(instance.data.raw, current);
    assert.equal(instance.data.tasks, currentRows);
    assert.equal(instance.patches.length, patchCount, 'An obsolete response must make no presentation changes, including error or finalizer changes.');
    assert.equal(instance.data.outdated, false);
    assert.equal(instance.data.refreshError, '');
    assert.equal(instance.data.failed, false);
    assert.equal(instance.data.refreshing, false);
    assert.deepEqual(toasts, []);
  });
}

test('an obsolete successful refresh cannot dismiss the newest failure or unlock stale rows', async () => {
  const raw = dashboard();
  const instance = page(raw);
  const rows = instance.data.tasks;
  const oldRequest = pendingDashboard();
  const oldLoad = instance.load();
  await oldRequest.started;
  dashboardResponse(async () => { throw new Error('Current refresh failed'); });
  await instance.load();
  const refreshError = instance.data.refreshError;
  assert.ok(refreshError);
  oldRequest.resolve(dashboard([participation('obsolete')]));
  await oldLoad;
  assert.equal(instance.data.raw, raw);
  assert.equal(instance.data.tasks, rows);
  assert.equal(instance.data.refreshError, refreshError);
  assert.equal(instance.data.outdated, true);
  await assertRowActionsBlocked(instance);
});

test('unloading invalidates an in-flight refresh and prevents subsequent page writes or error feedback', async () => {
  const instance = page(dashboard());
  const request = pendingDashboard();
  const loading = instance.load();
  await request.started;
  instance.onUnload();
  const patchCount = instance.patches.length;
  const queryCount = queries.length;
  request.reject(new Error('Failure after unload'));
  await loading;
  await instance.load();
  assert.equal(instance.patches.length, patchCount);
  assert.equal(queries.length, queryCount);
  assert.equal(instance.actionsBlocked(), true);
  assert.deepEqual(toasts, []);
});

test('the template retains its task list during refresh and disables every stale row and sheet action', () => {
  const source = readFileSync('miniprogram/pages/todo/index.wxml', 'utf8');
  const notice = source.match(/<view\b[^>]*class="refresh-notice"[^>]*>([\s\S]*?)<\/view>/)?.[0];
  assert.ok(notice, 'Existing records need an inline refresh notice rather than a full-page loading replacement.');
  assert.match(notice, /role="status"/);
  assert.match(notice, /refreshing/);
  assert.match(notice, /mutationNotice/);
  assert.match(notice, /refreshError/);
  assert.match(notice, /<button\b[^>]*bindtap="load"/);
  const list = source.match(/<view\b[^>]*class="task-list"[^>]*>/)?.[0];
  assert.ok(list);
  assert.match(list, /wx:elif="\{\{tasks\.length\}\}"/);
  assert.doesNotMatch(list, /refreshing|outdated/);
  const buttons = source.match(/<button\b[^>]*>/g) || [];
  for (const handler of ['openTask', 'runPrimaryAction', 'showMore', 'editProgress', 'complete', 'receipt', 'undoComplete', 'toggleSkip']) {
    const controls = buttons.filter(button => button.includes(`bindtap="${handler}"`));
    assert.ok(controls.length > 0, `${handler} must have a visible interaction.`);
    for (const control of controls) {
      const disabled = control.match(/\bdisabled="([^"]+)"/)?.[1];
      assert.ok(disabled, `${handler} must expose its unavailable state visually and semantically.`);
      for (const state of ['loading', 'refreshing', 'outdated', 'busyId']) assert.ok(disabled.includes(state), `${handler} must be disabled while ${state} is active.`);
    }
  }
});

function repeatedMonthlyDashboard(): Dashboard {
  const snapshot = activity('shared-activity', { title: 'Repeated monthly benefit', scope: 'card', startsOn: '2025-01-01', endsOn: '2027-12-31' });
  const records = [
    { id: 'current-month', period: '2026-09', deadline: '2026-09-30' },
    { id: 'recent-august', period: '2026-08', deadline: '2026-08-31' },
    { id: 'previous-august', period: '2025-08', deadline: '2025-08-31' },
  ].map(item => participation(item.id, {
    activityId: snapshot.id, snapshot, scopeKey: 'card:shared-card', cardId: 'shared-card',
    periodKey: item.period, startsOn: `${item.period}-01`, endsOn: item.deadline,
    startedAt: `${item.period}-01T00:00:00Z`, createdAt: `${item.period}-01T00:00:00Z`, updatedAt: `${item.period}-01T00:00:00Z`,
  }));
  return { ...dashboard(records), cards: [{ id: 'shared-card', ownerId: 'todo-user', bankId: 'cmb', issuerId: 'cmb-cn',
    network: 'visa', kind: 'credit', nickname: 'Shared card', createdAt: '2025-01-01T00:00:00Z' }] };
}

test('same-month tasks from different years keep distinct visible participation periods without changing their order or actions', () => {
  const raw = repeatedMonthlyDashboard();
  const original = structuredClone(raw);
  const instance = page(raw);
  const rows = instance.data.tasks;
  assert.deepEqual(rows.map((row: any) => row.id), ['previous-august', 'recent-august', 'current-month']);
  assert.deepEqual(rows.map((row: any) => [row.period, row.showPeriod]), [
    ['2025年8月', true], ['2026年8月', true], ['2026年9月', false],
  ]);
  assert.deepEqual(rows.slice(0, 2).map((row: any) => [row.title, row.cardName, row.dateDay, row.dateMonth]), [
    ['Repeated monthly benefit', 'Shared card', '31', '8月'], ['Repeated monthly benefit', 'Shared card', '31', '8月'],
  ]);
  assert.ok(rows.every((row: any) => row.primaryAction === 'progress'));
  assert.deepEqual(rows.map((row: any) => row.groupKey), ['overdue', 'overdue', 'later']);
  assert.deepEqual(raw, original, 'Period presentation must not rewrite saved dates, snapshots, progress, or record order.');
  assert.equal(instance.data.unfinishedCount, 3);
  assert.equal(instance.data.allCount, 3);
  assert.deepEqual(commands, []);
});

test('More identifies the selected participation period and full deadline and routes actions to that exact record', () => {
  const instance = page(repeatedMonthlyDashboard());
  instance.showMore(event('previous-august'));
  assert.equal(instance.data.actionId, 'previous-august');
  assert.equal(instance.data.actionPeriod, '2025年8月');
  assert.equal(instance.data.actionDeadline, '2025-08-31');
  assert.equal(instance.data.actionCardName, 'Shared card');
  const title = instance.data.actionTitle;
  instance.editProgress(event());
  assert.deepEqual(navigation, ['/pages/progress/index?id=previous-august&activityId=shared-activity']);
  instance.showMore(event('recent-august'));
  assert.equal(instance.data.actionTitle, title, 'The same title cannot be used as the selected-period identity.');
  assert.equal(instance.data.actionId, 'recent-august');
  assert.equal(instance.data.actionPeriod, '2026年8月');
  assert.equal(instance.data.actionDeadline, '2026-08-31');
  const selection = instance.patches.at(-1)!;
  assert.equal(selection.actionId, 'recent-august');
  assert.equal(selection.actionPeriod, '2026年8月');
  assert.equal(selection.actionDeadline, '2026-08-31');
  instance.receipt(event());
  assert.equal(navigation.at(-1), '/pages/receipt/index?activityId=shared-activity&id=recent-august');
  instance.showMore(event('current-month'));
  assert.equal(instance.data.actionPeriod, '2026年9月', 'More must show full context even when the current row needs no extra period label.');
  assert.equal(instance.data.actionDeadline, '2026-09-30');
  assert.deepEqual(commands, []);
});

test('period context follows the saved activity calendar for annual, quarterly, expired, and cross-year single activities', () => {
  const cases: { id: string; frequency: Activity['frequency']; periodKey: string; startsOn: string; endsOn: string;
    snapshotStarts: string; snapshotEnds: string; label: string; visible: boolean }[] = [
    { id: 'current-year', frequency: 'yearly', periodKey: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31',
      snapshotStarts: '2025-01-01', snapshotEnds: '2027-12-31', label: '2026年度', visible: false },
    { id: 'expired-year', frequency: 'yearly', periodKey: '2026', startsOn: '2026-01-01', endsOn: '2026-06-30',
      snapshotStarts: '2026-01-01', snapshotEnds: '2026-06-30', label: '2026年度', visible: true },
    { id: 'current-quarter', frequency: 'quarterly', periodKey: '2026-Q3', startsOn: '2026-07-01', endsOn: '2026-09-30',
      snapshotStarts: '2025-01-01', snapshotEnds: '2027-12-31', label: '2026年第3季度', visible: false },
    { id: 'expired-quarter', frequency: 'quarterly', periodKey: '2026-Q3', startsOn: '2026-07-01', endsOn: '2026-09-10',
      snapshotStarts: '2026-07-01', snapshotEnds: '2026-09-10', label: '2026年第3季度', visible: true },
    { id: 'prior-quarter', frequency: 'quarterly', periodKey: '2025-Q3', startsOn: '2025-07-01', endsOn: '2025-09-30',
      snapshotStarts: '2025-01-01', snapshotEnds: '2027-12-31', label: '2025年第3季度', visible: true },
    { id: 'current-once', frequency: 'once', periodKey: 'once', startsOn: '2026-09-01', endsOn: '2026-09-30',
      snapshotStarts: '2026-09-01', snapshotEnds: '2026-09-30', label: '单次活动 · 2026-09-01 至 2026-09-30', visible: false },
    { id: 'cross-year-once', frequency: 'once', periodKey: 'once', startsOn: '2025-12-20', endsOn: '2026-10-01',
      snapshotStarts: '2025-12-20', snapshotEnds: '2026-10-01', label: '单次活动 · 2025-12-20 至 2026-10-01', visible: true },
    { id: 'expired-once', frequency: 'once', periodKey: 'once', startsOn: '2025-09-01', endsOn: '2025-09-30',
      snapshotStarts: '2025-09-01', snapshotEnds: '2025-09-30', label: '单次活动 · 2025-09-01 至 2025-09-30', visible: true },
  ];
  const records = cases.map(item => participation(item.id, { periodKey: item.periodKey, startsOn: item.startsOn, endsOn: item.endsOn },
    { frequency: item.frequency, startsOn: item.snapshotStarts, endsOn: item.snapshotEnds }));
  const instance = page(dashboard(records));
  for (const item of cases) {
    const row = instance.data.tasks.find((value: any) => value.id === item.id);
    assert.equal(row.period, item.label, item.id);
    assert.equal(row.showPeriod, item.visible, item.id);
    instance.showMore(event(item.id));
    assert.equal(instance.data.actionPeriod, item.label, item.id);
    assert.equal(instance.data.actionDeadline, item.endsOn, item.id);
  }
  assert.equal(instance.data.raw.today, '2026-09-22', 'The dashboard date is the period reference, independent of the device clock.');
  assert.deepEqual(commands, []);
});

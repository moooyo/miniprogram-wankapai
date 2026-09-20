import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Activity, Dashboard, Participation } from '../shared/contracts';
import { api } from '../miniprogram/services/api';

type PageInstance = { data: Record<string, any>; [key: string]: any };

const template = () => readFileSync('miniprogram/pages/todo/index.wxml', 'utf8');
let definition: PageInstance;
let pageLoading: Promise<void> | undefined;

async function page(tasks: Participation[], today = '2026-09-25'): Promise<PageInstance> {
  if (!pageLoading) pageLoading = (async () => {
    const runtime = globalThis as any;
    const previous = runtime.Page;
    try {
      runtime.Page = (value: PageInstance) => { definition = value; };
      await import('../miniprogram/pages/todo/index');
    } finally { runtime.Page = previous; }
  })();
  await pageLoading;
  const instance: PageInstance = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
  instance.data.raw = { today, tasks, pendingRewards: [], bills: [], accounts: [], cards: [] } satisfies Dashboard;
  instance.applyFilter();
  return instance;
}

function activity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id, title: id, bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit',
    cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31',
    target: 3, unit: 'transactions', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three eligible transactions',
    sourceUrl: 'https://www.cmbchina.com/', sourceNote: 'Official source',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the bank app', imageIds: [] },
    revision: 1, status: 'published', publishedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', publishedBy: 'operator', ...overrides,
  };
}

function participation(id: string, overrides: Partial<Participation> = {}, activityOverrides: Partial<Activity> = {}): Participation {
  return {
    id, ownerId: 'todo-user', activityId: `activity-${id}`, activityRevision: 1,
    periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30', scopeKey: 'user:todo-user',
    snapshot: activity(`activity-${id}`, activityOverrides), stage: 'in_progress', progress: 1,
    registeredAt: null, startedAt: '2026-09-01T00:00:00Z', completedAt: null,
    expectedOn: null, receivedOn: null, receivedMinor: null, version: 1,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...overrides,
  };
}

function event(id: string) { return { currentTarget: { dataset: { id } } }; }

test('unfinished tasks group by participation deadline with inclusive seven-day boundaries and stable title ordering', async () => {
  const tasks = [
    participation('later-boundary', { endsOn: '2026-10-03' }),
    participation('soon-seventh', { endsOn: '2026-10-02', stage: 'registered' }),
    participation('overdue-beta', { endsOn: '2026-09-24' }, { title: 'Beta' }),
    participation('today', { endsOn: '2026-09-25', stage: 'available' }),
    participation('overdue-alpha-first', { endsOn: '2026-09-24' }, { title: 'Alpha' }),
    participation('overdue-alpha-second', { endsOn: '2026-09-24' }, { title: 'Alpha' }),
    participation('later-future', { endsOn: '2026-12-31' }),
    participation('completed', { stage: 'completed', endsOn: '2026-09-23' }),
    participation('received', { stage: 'received', endsOn: '2026-09-23' }),
    participation('skipped', { stage: 'skipped', endsOn: '2026-09-23' }),
  ];
  const originalOrder = tasks.map(item => item.id);
  const todo = await page(tasks);

  assert.equal(todo.data.filter, 'unfinished');
  assert.deepEqual(todo.data.tasks.map((row: any) => [row.id, row.groupKey, row.showGroupTitle]), [
    ['overdue-alpha-first', 'overdue', true],
    ['overdue-alpha-second', 'overdue', false],
    ['overdue-beta', 'overdue', false],
    ['today', 'soon', true],
    ['soon-seventh', 'soon', false],
    ['later-boundary', 'later', true],
    ['later-future', 'later', false],
  ]);
  for (const key of ['overdue', 'soon', 'later']) {
    const rows = todo.data.tasks.filter((row: any) => row.groupKey === key);
    assert.ok(rows[0].groupTitle.trim(), `${key} must have a readable heading.`);
    assert.ok(rows.every((row: any) => row.groupTitle === rows[0].groupTitle));
    assert.equal(rows.filter((row: any) => row.showGroupTitle).length, 1);
  }
  assert.equal(todo.data.tasks.find((row: any) => row.id === 'today').late, false);
  assert.equal(todo.data.tasks.find((row: any) => row.id === 'overdue-beta').late, true);
  assert.deepEqual(tasks.map(item => item.id), originalOrder, 'Presentation sorting must not mutate the dashboard records.');
});

test('month-end filtering affects only unfinished tasks and completed and all views omit priority groups', async () => {
  const todo = await page([
    participation('prior-month', { endsOn: '2026-08-31' }),
    participation('month-end', { endsOn: '2026-09-30' }),
    participation('next-month', { endsOn: '2026-10-02' }),
    participation('completed-next-month', { stage: 'completed', endsOn: '2026-10-02' }),
    participation('received-next-month', { stage: 'received', endsOn: '2026-10-03' }),
    participation('skipped-next-month', { stage: 'skipped', endsOn: '2026-10-04' }),
  ]);
  todo.toggleClosing({ detail: { value: true } });
  assert.equal(todo.data.closingOnly, true);
  assert.deepEqual(todo.data.tasks.map((row: any) => row.id), ['prior-month', 'month-end']);
  assert.deepEqual(todo.data.tasks.map((row: any) => [row.groupKey, row.showGroupTitle]), [['overdue', true], ['soon', true]]);

  for (const [filter, expectedIds] of [
    ['completed', ['completed-next-month', 'received-next-month']],
    ['all', ['prior-month', 'month-end', 'completed-next-month', 'next-month', 'received-next-month', 'skipped-next-month']],
  ] as const) {
    todo.selectFilter({ currentTarget: { dataset: { filter } } });
    assert.deepEqual(todo.data.tasks.map((row: any) => row.id), expectedIds);
    assert.ok(todo.data.tasks.every((row: any) => row.groupKey === '' && row.groupTitle === '' && row.showGroupTitle === false));
    todo.toggleClosing({ detail: { value: false } });
    assert.equal(todo.data.closingOnly, true, 'Inactive month filtering must preserve its unfinished-tab preference.');
  }

  todo.selectFilter({ currentTarget: { dataset: { filter: 'unfinished' } } });
  assert.deepEqual(todo.data.tasks.map((row: any) => row.id), ['prior-month', 'month-end']);
});

test('primary actions follow reward kind, progress and terminal state while preserving single-step completion', async () => {
  const cases: { id: string; record: Partial<Participation>; activity: Partial<Activity>; action: string; label: RegExp }[] = [
    { id: 'multi-not-started', record: { stage: 'available', progress: 0 }, activity: { target: 3 }, action: 'progress', label: /进度/ },
    { id: 'multi-in-progress', record: { progress: 2 }, activity: { target: 3 }, action: 'progress', label: /进度/ },
    { id: 'target-reached', record: { progress: 3 }, activity: { target: 3 }, action: 'complete', label: /完成/ },
    { id: 'single-step', record: { stage: 'registered', progress: 0 }, activity: { target: 1 }, action: 'complete', label: /完成/ },
    { id: 'discount-not-started', record: { stage: 'available', progress: 0 }, activity: { rewardKind: 'discount' }, action: 'receipt', label: /优惠|立减/ },
    { id: 'discount-in-progress', record: { progress: 2 }, activity: { rewardKind: 'discount' }, action: 'receipt', label: /优惠|立减/ },
    { id: 'discount-target-reached', record: { progress: 3 }, activity: { rewardKind: 'discount' }, action: 'receipt', label: /优惠|立减/ },
    { id: 'completed-cashback', record: { stage: 'completed', progress: 3 }, activity: {}, action: 'receipt', label: /到账/ },
    { id: 'completed-discount', record: { stage: 'completed', progress: 3 }, activity: { rewardKind: 'discount' }, action: 'receipt', label: /优惠|立减/ },
    { id: 'received-cashback', record: { stage: 'received', progress: 3 }, activity: {}, action: 'detail', label: /查看|记录|详情/ },
    { id: 'received-discount', record: { stage: 'received', progress: 3 }, activity: { rewardKind: 'discount' }, action: 'detail', label: /查看|记录|详情/ },
    { id: 'skipped-cashback', record: { stage: 'skipped', progress: 1 }, activity: {}, action: 'resume', label: /恢复/ },
    { id: 'skipped-discount', record: { stage: 'skipped', progress: 3 }, activity: { rewardKind: 'discount' }, action: 'resume', label: /恢复/ },
  ];
  const todo = await page(cases.map(item => participation(item.id, item.record, item.activity)));
  todo.selectFilter({ currentTarget: { dataset: { filter: 'all' } } });
  for (const item of cases) {
    const row = todo.data.tasks.find((value: any) => value.id === item.id);
    assert.equal(row.primaryAction, item.action, item.id);
    assert.match(row.primaryLabel, item.label, item.id);
  }
});

test('primary navigation opens progress, receipt and received details with the selected participation', async () => {
  const tasks = [
    participation('progress & record', { activityId: 'progress/activity' }),
    participation('receipt & record', { activityId: 'receipt/activity', stage: 'completed' }),
    participation('discount & record', { activityId: 'discount/activity' }, { rewardKind: 'discount' }),
    participation('received & record', { activityId: 'received/activity', stage: 'received' }),
  ];
  const todo = await page(tasks);
  todo.selectFilter({ currentTarget: { dataset: { filter: 'all' } } });
  const runtime = globalThis as any;
  const previous = runtime.wx;
  const destinations: string[] = [];
  runtime.wx = { navigateTo({ url }: { url: string }) { destinations.push(url); } };
  try {
    for (const task of tasks) await todo.runPrimaryAction(event(task.id));
    assert.deepEqual(destinations, [
      '/pages/progress/index?id=progress%20%26%20record&activityId=progress%2Factivity',
      '/pages/receipt/index?activityId=receipt%2Factivity&id=receipt%20%26%20record',
      '/pages/receipt/index?activityId=discount%2Factivity&id=discount%20%26%20record',
      '/pages/detail/index?id=received%2Factivity&participationId=received%20%26%20record',
    ]);
  } finally { runtime.wx = previous; }
});

test('primary completion and recovery mutate only the selected record and reload after success', async () => {
  const todo = await page([
    participation('manual-completion', { progress: 0 }, { target: 1 }),
    participation('restore-skipped', { stage: 'skipped' }),
  ]);
  todo.selectFilter({ currentTarget: { dataset: { filter: 'all' } } });
  const runtime = globalThis as any;
  const previousWx = runtime.wx;
  const previousCommand = api.command;
  const commands: { action: string; payload: unknown }[] = [];
  let reloads = 0;
  runtime.wx = { showToast() {} };
  api.command = (async (action: string, payload: unknown) => {
    commands.push({ action, payload: structuredClone(payload) });
    return { id: 'updated', version: 2 };
  }) as typeof api.command;
  todo.load = async () => { reloads += 1; };
  try {
    await todo.runPrimaryAction(event('manual-completion'));
    await todo.runPrimaryAction(event('restore-skipped'));
    assert.deepEqual(commands, [
      { action: 'participation.complete', payload: { participationId: 'manual-completion' } },
      { action: 'participation.skip', payload: { participationId: 'restore-skipped', skipped: false } },
    ]);
    assert.equal(reloads, 2);
    assert.equal(todo.data.busyId, '');
    assert.equal(todo.data.showActions, false);
  } finally { api.command = previousCommand; runtime.wx = previousWx; }
});

test('each task renders one primary button plus more and retains direct completion and receipt shortcuts', () => {
  const source = template();
  const actionRow = /<view class="task-actions">([\s\S]*?)<\/view>/.exec(source)?.[1];
  assert.ok(actionRow, 'Task actions must have a dedicated row.');
  const buttons = actionRow.match(/<button\b[^>]*>/g) || [];
  assert.equal(buttons.length, 2, 'Each task should present one primary action and one more button.');
  assert.equal(buttons.filter(button => /class="[^"]*\btask-primary\b[^"]*"/.test(button)).length, 1);
  assert.match(buttons[0], /bindtap="runPrimaryAction"/);
  assert.match(actionRow, /\{\{item\.primaryLabel\}\}/);
  assert.match(buttons[1], /bindtap="showMore"/);
  assert.match(source, /wx:if="\{\{item\.showGroupTitle\}\}"/);
  assert.match(source, /\{\{item\.groupTitle\}\}/);
  const sheet = source.slice(source.indexOf('<app-sheet'));
  const sheetButtons = sheet.match(/<button\b[^>]*>/g) || [];
  const completeShortcut = sheetButtons.find(button => /class="[^"]*\btask-more-complete\b[^"]*"/.test(button));
  const receiptShortcut = sheetButtons.find(button => /class="[^"]*\btask-more-receipt\b[^"]*"/.test(button));
  assert.ok(completeShortcut, 'More actions must retain direct completion.');
  assert.ok(receiptShortcut, 'More actions must retain a direct receipt shortcut.');
  assert.match(completeShortcut, /bindtap="complete"/);
  assert.match(receiptShortcut, /bindtap="receipt"/);
});

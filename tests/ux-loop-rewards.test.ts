import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as labels from '../miniprogram/services/card-labels';
import * as benefit from '../miniprogram/services/benefit-copy';

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<any>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(query: (action: string, payload: any) => Promise<any>, route = 'rewards') {
  let page: any;
  const imports: Record<string, unknown> = {
    '../../../shared/catalog': catalog,
    '../../services/card-labels': labels,
    '../../services/benefit-copy': benefit,
    '../../services/api': { api: { query, command: async (action: string, payload: unknown) => { page.commands.push({ action, payload }); return { id: 'saved' }; } }, ensureSession: async () => ({ today: '2026-09-22', month: '2026-09' }) },
    '../../services/format': { money: (value: number) => String(value), today: () => '2026-09-22', monthKey: () => '2026-09', periodLabel: (value: string) => value, stageLabel: () => '', showError() {} },
    '../../../domain/calendar': { addDays: () => '2026-09-29' },
  };
  const javascript = ts.transpileModule(readFileSync(`miniprogram/pages/${route}/index.ts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(javascript, {
    exports: {},
    require: (id: string) => { assert.ok(id in imports, `Unexpected import: ${id}`); return imports[id]; },
    Page: (definition: any) => {
      page = definition;
      page.commands = [];
      page.data = structuredClone(definition.data);
      page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch);
    },
  });
  return page;
}

test('wallet refresh failure preserves visible accounts and blocks stale bill changes until recovery', async () => {
  const response = deferred();
  const page = harness(async action => action === 'preferences.get' ? { repayments: true } : response.promise, 'wallet');
  const raw = { cards: [], accounts: [], bills: [{ id: 'bill-1', paidAt: null }] };
  page.data.raw = raw;
  page.data.loading = false;
  page.data.groups = [{ id: 'expanded-account', expanded: true }];
  const request = page.load();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.refreshing, true);
  assert.equal(page.data.groups[0].expanded, true);
  await new Promise(resolve => setImmediate(resolve));
  response.reject(new Error('Refresh failed'));
  await request;
  assert.equal(page.data.failed, false);
  assert.equal(page.data.raw, raw);
  assert.equal(page.data.groups[0].id, 'expanded-account');
  assert.ok(page.data.refreshError);
  assert.equal(page.data.outdated, true);
  await page.togglePaid({ currentTarget: { dataset: { id: 'bill-1' } } });
  await page.changeDueDate({ currentTarget: { dataset: { id: 'bill-1' } }, detail: { value: '2026-09-25' } });
  assert.equal(page.commands.length, 0);
  response.promise = Promise.resolve({ cards: [], accounts: [], bills: [] });
  await page.load();
  assert.equal(page.data.outdated, false);
  assert.equal(page.data.refreshError, '');
});

test('mine still shows an old returned submission behind more than fifty published submissions', async () => {
  const submissions = [
    ...Array.from({ length: 60 }, (_, index) => ({ id: `published-${index}`, status: 'published' })),
    { id: 'older-returned', status: 'returned' },
  ];
  const page = harness(async (_action, payload) => ({
    items: submissions.filter(item => !payload.status || item.status === payload.status).slice(0, payload.limit),
  }), 'mine');
  await page.load();
  assert.equal(page.data.returnedCount, 1);
  assert.equal(page.data.pendingCount, 0);
});

test('reward month labels keep the requested scope during a delayed read, failure, and retry', async () => {
  const pending = deferred();
  let requestedMonth = '';
  const page = harness(async (_action, payload) => { requestedMonth = payload.month; return pending.promise; });
  page.data.month = '2026-09';
  page.data.monthLabel = '2026 年 9 月';
  page.loadedScope = '2026-09:CNY';
  page.data.received = [{ id: 'september-record' }];
  page.changeMonth({ detail: { value: '2026-08' } });
  assert.equal(page.data.monthLabel, '2026 年 8 月');
  assert.equal(page.data.loading, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestedMonth, '2026-08');
  pending.reject(new Error('August unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.monthLabel, '2026 年 8 月');
  assert.equal(page.data.failed, true, 'Previous-month rows must stay hidden when the newly selected scope fails.');
  pending.promise = Promise.resolve(result(null));
  await page.load();
  assert.equal(requestedMonth, '2026-08');
  assert.equal(page.data.monthLabel, '2026 年 8 月');
  assert.equal(page.data.failed, false);
  assert.equal(page.data.received.length, 0);
});

test('returning to rewards refreshes the entire previously loaded window without collapsing it', async () => {
  const rows = Array.from({ length: 61 }, (_, index) => ({
    id: `reward-${index}`, participationId: `participation-${index}`, title: `Reward ${index}`, bankId: 'cmb',
    amountMinor: 100, currency: 'CNY', receivedOn: '2026-09-22', activityPeriod: '2026-09',
  }));
  let failLaterPage = false;
  const page = harness(async (_action, payload) => {
    const offset = Number(payload.cursor || 0);
    if (failLaterPage && offset === 30) throw new Error('Later refreshed page unavailable');
    return { ...result(offset + 30 < rows.length ? String(offset + 30) : null), received: rows.slice(offset, offset + 30) };
  });
  await page.load();
  await page.loadMore();
  await page.loadMore();
  assert.equal(page.data.received.length, 61);
  const previousRows = page.data.received;
  failLaterPage = true;
  const refresh = page.load();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.refreshing, true);
  assert.equal(page.data.received, previousRows);
  await refresh;
  assert.equal(page.data.received, previousRows, 'A partial refreshed window must not replace the complete visible window.');
  assert.equal(page.data.outdated, true);
  assert.ok(page.data.refreshError);
  assert.equal(page.data.failed, false);
  failLaterPage = false;
  rows[60].amountMinor = 250;
  await page.load();
  assert.equal(page.data.received.length, 61);
  assert.equal(page.data.received[60].amount, '250');
  assert.equal(page.data.outdated, false);
  assert.equal(page.data.nextCursor, null);
  page.data.currencyIndex = 1;
  const changed = page.load();
  assert.equal(page.data.loading, true, 'Changing currency must not display the old currency under the new filter.');
  await changed;
  assert.equal(page.data.received.length, 30, 'A new filter starts with its own first page.');
});

const result = (nextCursor: string | null) => ({ totalMinor: 0, pending: [], received: [], nextCursor, pendingCounts: { CNY: 0, HKD: 0, MOP: 0 } });

test('reward pagination failure keeps existing records and retries the same cursor', async () => {
  const cursors: string[] = [];
  const page = harness(async (_action, payload) => {
    cursors.push(payload.cursor);
    if (cursors.length === 1) throw new Error('Network unavailable');
    return result(null);
  });
  page.data.received = [{ id: 'already-read' }];
  page.data.loading = false;
  page.data.nextCursor = 'next-page';
  await page.loadMore();
  assert.deepEqual(page.data.received, [{ id: 'already-read' }]);
  assert.equal(page.data.nextCursor, 'next-page');
  assert.ok(page.data.loadMoreError);
  assert.equal(page.data.failed, false);
  await page.loadMore();
  assert.deepEqual(cursors, ['next-page', 'next-page']);
  assert.equal(page.data.loadMoreError, '');
  assert.equal(page.data.nextCursor, null);
});

for (const route of ['todo', 'wallet', 'mine']) {
  test(`${route} ignores an obsolete refresh failure after a successful refresh`, async () => {
    const older = deferred();
    const current = deferred();
    let calls = 0;
    const page = harness(async action => {
      if (action === 'preferences.get') return { repayments: true };
      return ++calls === 1 ? older.promise : current.promise;
    }, route);
    const first = page.load();
    await new Promise(resolve => setImmediate(resolve));
    const second = page.load();
    await new Promise(resolve => setImmediate(resolve));
    current.resolve(route === 'todo'
      ? { today: '2026-09-22', bills: [], tasks: [], cards: [], pendingRewards: [] }
      : route === 'wallet' ? { cards: [], accounts: [], bills: [] } : { items: [] });
    await second;
    assert.equal(page.data.loading, false);
    older.reject(new Error('Obsolete refresh failure'));
    await first;
    assert.equal(page.data.loading, false);
    assert.ok(!page.data.failed && !page.data.error);
  });
}

test('an obsolete reward pagination failure cannot overwrite the new currency loading state', async () => {
  const oldPage = deferred();
  const newPage = deferred();
  const page = harness(async (_action, payload) => payload.currency === 'CNY' ? oldPage.promise : newPage.promise);
  page.data.loading = false;
  page.data.nextCursor = 'cny-next';
  const first = page.loadMore();
  page.data.currencyIndex = 1;
  const changed = page.load();
  await new Promise(resolve => setImmediate(resolve));
  newPage.resolve(result('hkd-next'));
  await changed;
  const currentPage = deferred();
  newPage.promise = currentPage.promise;
  const second = page.loadMore();
  assert.equal(page.data.loadingMore, true);
  oldPage.reject(new Error('Old currency failed'));
  await first;
  assert.equal(page.data.loadingMore, true);
  assert.equal(page.data.loadMoreError, '');
  assert.equal(page.data.nextCursor, 'hkd-next');
  currentPage.resolve(result(null));
  await second;
  assert.equal(page.data.loadingMore, false);
});

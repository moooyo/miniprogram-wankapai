import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(options: { moderator?: boolean; demo?: boolean } = {}) {
  let moderator = !!options.moderator;
  let ensureSession = async () => ({ userId: 'mine-user', isModerator: moderator, demo: options.demo !== false });
  let query = async (_action: string, _payload: any): Promise<any> => ({ items: [] });
  const reads: { action: string; payload: any }[] = [];
  const roles: string[] = [];
  const navigations: string[] = [];
  let page: any;
  const javascript = ts.transpileModule(readFileSync('miniprogram/pages/mine/index.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, {
    exports: {}, Error,
    require: (id: string) => {
      assert.equal(id, '../../services/api');
      return { ensureSession: () => ensureSession(), setDemoRole: async (role: string) => { roles.push(role); moderator = role === 'moderator'; }, api: { query: async (action: string, payload: any) => { reads.push({ action, payload }); return query(action, payload); } } };
    },
    wx: { navigateTo: ({ url }: { url: string }) => navigations.push(url), showModal() {} },
    Page: (definition: any) => { page = definition; page.data = structuredClone(definition.data); page.setData = (patch: any) => Object.assign(page.data, patch); },
  });
  return { page, reads, roles, navigations, setSession: (value: typeof ensureSession) => { ensureSession = value; }, setQuery: (value: typeof query) => { query = value; } };
}

for (const startModerator of [false, true]) {
  test(`Mine applies ${startModerator ? 'ordinary' : 'moderator'} identity independently when a role-change count request fails`, async () => {
    const env = fixture({ moderator: startModerator });
    env.setQuery(async () => ({ items: [{ id: 'old-attention' }] }));
    await env.page.load();
    assert.equal(env.page.data.session.isModerator, startModerator);
    assert.equal(env.page.data.countsReady, true);
    env.setQuery(async (_action, payload) => {
      if (payload.status === (startModerator ? 'returned' : 'pending')) throw new Error('One secondary count failed');
      return { items: [] };
    });
    await env.page.changeDemoRole({ detail: { value: startModerator ? '0' : '1' } });
    assert.equal(env.page.data.session.isModerator, !startModerator);
    assert.equal(env.page.data.error, '');
    assert.match(env.page.data.countsError, /投稿状态暂时无法读取/);
    assert.equal(env.page.data.pendingCount, 0);
    assert.equal(env.page.data.returnedCount, 0);
    assert.equal(env.page.data.countsReady, false);
    assert.equal(env.page.data.changingRole, false);
    env.page.openReview();
    assert.equal(env.navigations.includes('/pages/review/index'), !startModerator);
    env.page.openHistory(); env.page.openSubmissions(); env.page.openPreferences();
    assert.ok(env.navigations.includes('/pages/history/index'));
    assert.ok(env.navigations.includes('/pages/submissions/index'));
    assert.ok(env.navigations.includes('/pages/preferences/index'));
    env.setQuery(async (_action, payload) => ({ items: payload.status === 'returned' ? [{ id: 'returned-current' }] : [] }));
    await env.page.load();
    assert.equal(env.page.data.session.isModerator, !startModerator);
    assert.equal(env.page.data.countsReady, true);
    assert.equal(env.page.data.returnedCount, 1);
    assert.equal(env.page.data.pendingCount, 0);
    assert.equal(env.page.data.countsError, '');
  });
}

test('Mine exposes a verified session while secondary counts are still pending', async () => {
  const env = fixture({ moderator: true });
  const counts = deferred<any>();
  env.setQuery(async () => counts.promise);
  const load = env.page.load();
  await tick();
  assert.equal(env.page.data.loading, false);
  assert.equal(env.page.data.countsLoading, true);
  assert.equal(env.page.data.session.isModerator, true);
  env.page.openReview();
  assert.deepEqual(env.navigations, ['/pages/review/index']);
  counts.resolve({ items: [] });
  await load;
  assert.equal(env.page.data.countsLoading, false);
  assert.equal(env.page.data.countsReady, true);
});

test('Mine clears unverified role and attention state if the session read fails, keeping common menus available', async () => {
  const env = fixture({ moderator: true });
  env.setQuery(async () => ({ items: [{ id: 'old-attention' }] }));
  await env.page.load();
  const countReads = env.reads.length;
  env.setSession(async () => { throw new Error('Session unavailable'); });
  await env.page.load();
  assert.equal(env.page.data.session, null);
  assert.equal(env.page.data.countsReady, false);
  assert.equal(env.page.data.pendingCount, 0);
  assert.equal(env.page.data.returnedCount, 0);
  assert.equal(env.reads.length, countReads);
  assert.match(env.page.data.error, /账号信息暂时无法确认/);
  env.page.openReview();
  assert.equal(env.navigations.length, 0);
  env.page.openSubmission();
  assert.deepEqual(env.navigations, ['/pages/submission-lead/index']);
});

test('an obsolete Mine session response cannot replace the latest role or trigger old secondary requests', async () => {
  const env = fixture();
  const oldSession = deferred<any>();
  env.setSession(async () => oldSession.promise);
  const oldLoad = env.page.load();
  env.setSession(async () => ({ userId: 'mine-user', isModerator: false, demo: true }));
  await env.page.load();
  assert.equal(env.reads.length, 2);
  oldSession.resolve({ userId: 'mine-user', isModerator: true, demo: true });
  await oldLoad;
  assert.equal(env.page.data.session.isModerator, false);
  assert.equal(env.reads.length, 2);
});

test('an obsolete Mine count failure cannot erase a later verified identity or its successful counts', async () => {
  const env = fixture({ moderator: true });
  const oldCounts = deferred<any>();
  env.setQuery(async () => oldCounts.promise);
  const oldLoad = env.page.load();
  await tick();
  env.setSession(async () => ({ userId: 'mine-user', isModerator: false, demo: true }));
  env.setQuery(async (_action, payload) => ({ items: payload.status === 'pending' ? [{ id: 'new-pending' }] : [] }));
  await env.page.load();
  oldCounts.reject(new Error('Obsolete secondary failure'));
  await oldLoad;
  assert.equal(env.page.data.session.isModerator, false);
  assert.equal(env.page.data.pendingCount, 1);
  assert.equal(env.page.data.returnedCount, 0);
  assert.equal(env.page.data.countsReady, true);
  assert.equal(env.page.data.error, '');
  assert.equal(env.page.data.countsError, '');
});

test('Mine does not offer demo-role authorization for a production session', async () => {
  const env = fixture({ moderator: false, demo: false });
  await env.page.load();
  await env.page.changeDemoRole({ detail: { value: '1' } });
  assert.deepEqual(env.roles, []);
  assert.equal(env.page.data.session.isModerator, false);
  env.page.openReview();
  assert.deepEqual(env.navigations, []);
});

test('Mine common menus are independent of secondary loading and attention copy requires current counts', () => {
  const source = readFileSync('miniprogram/pages/mine/index.wxml', 'utf8');
  assert.doesNotMatch(source, /<block\s+wx:else>/);
  assert.match(source, /wx:if="\{\{session\.isModerator\}\}"/);
  assert.match(source, /countsReady && returnedCount/);
  assert.match(source, /countsReady && pendingCount/);
  assert.match(source, /重试投稿状态/);
  assert.match(source, /重新读取账号/);
});

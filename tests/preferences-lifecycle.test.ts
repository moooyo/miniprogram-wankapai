import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

type PageInstance = { data: Record<string, any>; [key: string]: any };
const defaults = { newActivities: false, deadlines: false, rewards: false, repayments: false };
const change = (field = 'repayments', value = true) => ({ currentTarget: { dataset: { field } }, detail: { value } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(options: { query?: () => Promise<any>; command?: () => Promise<any> } = {}) {
  let definition!: PageInstance;
  let current: PageInstance | undefined;
  let alert = false;
  const effects: string[] = [];
  const source = readFileSync(path.join(process.cwd(), 'miniprogram/pages/preferences/index.ts'), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, {
    exports: {}, Error, Page: (page: PageInstance) => { definition = page; },
    getCurrentPages: () => current ? [current] : [],
    require: () => ({ ensureSession: async () => ({ userId: 'user-1' }), api: {
      query: options.query || (async () => ({ ...defaults })), command: options.command || (async () => ({ id: 'user-1' })),
    } }),
    wx: {
      enableAlertBeforeUnload: () => { alert = true; effects.push('enable'); },
      disableAlertBeforeUnload: () => { alert = false; effects.push('disable'); },
    },
  });
  return {
    create() {
      const page: PageInstance = { ...definition, data: structuredClone(definition.data) };
      page.setData = (patch: Record<string, unknown>) => { Object.assign(page.data, patch); };
      current = page;
      page.onShow?.();
      return page;
    },
    activate(page: PageInstance) { current = page; page.onShow?.(); },
    effects, alert: () => alert,
  };
}

test('a departed preferences save cannot clear the new page leave warning', async () => {
  const pending = deferred<unknown>();
  const env = harness({ command: () => pending.promise });
  const first = env.create();
  await first.load(); first.change(change());
  const saving = first.save();
  first.onUnload?.();
  const second = env.create();
  await second.load(); second.change(change('newActivities'));
  const before = structuredClone(first.data);
  const count = env.effects.length;
  pending.resolve({ id: 'user-1' }); await saving;
  assert.equal(env.alert(), true);
  assert.equal(env.effects.length, count);
  assert.deepEqual(first.data, before);
  assert.equal(second.data.dirty, true);
});

test('a departed preferences failure cannot write obsolete error feedback', async () => {
  const pending = deferred<unknown>();
  const env = harness({ command: () => pending.promise });
  const first = env.create();
  await first.load(); first.change(change());
  const saving = first.save(); first.onUnload?.();
  const second = env.create(); await second.load(); second.change(change());
  const before = structuredClone(first.data);
  pending.reject(new Error('Old request failed')); await saving;
  assert.deepEqual(first.data, before);
  assert.equal(second.data.error, '');
  assert.equal(env.alert(), true);
});

test('only the newest preferences read may change values or finish loading', async () => {
  const firstRead = deferred<unknown>();
  const secondRead = deferred<unknown>();
  let reads = 0;
  const env = harness({ query: () => ++reads === 1 ? firstRead.promise : secondRead.promise });
  const page = env.create();
  const first = page.load(); await tick();
  const second = page.load(); await tick();
  firstRead.resolve({ ...defaults, repayments: true }); await first;
  assert.equal(page.data.loading, true);
  assert.equal(page.data.ready, false);
  secondRead.resolve({ ...defaults, newActivities: true }); await second;
  assert.equal(page.data.loading, false);
  assert.equal(page.data.newActivities, true);
  assert.equal(page.data.repayments, false);
});

test('a stale preferences failure cannot replace the newer successful read', async () => {
  const firstRead = deferred<unknown>();
  let reads = 0;
  const env = harness({ query: () => ++reads === 1 ? firstRead.promise : Promise.resolve({ ...defaults, rewards: true }) });
  const page = env.create();
  const first = page.load(); await tick();
  await page.load();
  firstRead.reject(new Error('Obsolete read failed')); await first;
  assert.equal(page.data.ready, true);
  assert.equal(page.data.error, '');
  assert.equal(page.data.rewards, true);
});

test('a hidden preferences save only changes its own state and restores its guard on return', async () => {
  const pending = deferred<unknown>();
  const env = harness({ command: () => pending.promise });
  const first = env.create(); await first.load(); first.change(change());
  const saving = first.save(); first.onHide?.();
  const second = env.create(); await second.load(); second.change(change('newActivities'));
  const count = env.effects.length;
  pending.resolve({ id: 'user-1' }); await saving;
  assert.equal(first.data.saved, true);
  assert.equal(env.effects.length, count);
  assert.equal(env.alert(), true);
  env.activate(first);
  assert.equal(env.alert(), false);
});

test('an unloaded preferences read cannot change state or another page guard', async () => {
  const pending = deferred<unknown>();
  const env = harness({ query: () => pending.promise });
  const first = env.create(); const loading = first.load(); await tick(); first.onUnload?.();
  const before = structuredClone(first.data);
  const second = env.create(); second.setData({ ready: true }); second.change(change());
  const count = env.effects.length;
  pending.resolve({ ...defaults, repayments: true }); await loading;
  assert.deepEqual(first.data, before);
  assert.equal(env.effects.length, count);
  assert.equal(env.alert(), true);
});

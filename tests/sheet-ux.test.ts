import test from 'node:test';
import assert from 'node:assert/strict';

let definition: any;
let initialization: Promise<void> | undefined;
async function setup() {
  const runtime = globalThis as any;
  const calls: string[] = [];
  const windowHandlers = new Set<() => void>();
  const keyboardHandlers = new Set<() => void>();
  let route = 'pages/activities/index';
  let height = 700;
  let failRestore = false;
  runtime.getCurrentPages = () => [{ route }];
  runtime.wx = {
    nextTick: (callback: () => void) => callback(),
    hideTabBar: () => calls.push('hide'),
    showTabBar: (options: any) => { calls.push('show'); if (failRestore) options.fail?.(); else options.success?.(); },
    getWindowInfo: () => ({ windowHeight: height }),
    onWindowResize: (callback: () => void) => windowHandlers.add(callback),
    offWindowResize: (callback: () => void) => windowHandlers.delete(callback),
    onKeyboardHeightChange: (callback: () => void) => keyboardHandlers.add(callback),
    offKeyboardHeightChange: (callback: () => void) => keyboardHandlers.delete(callback),
  };
  if (!initialization) initialization = (async () => {
    const previous = runtime.Component;
    runtime.Component = (value: unknown) => { definition = value; };
    try { await import('../miniprogram/components/app-sheet/index'); }
    finally { runtime.Component = previous; }
  })();
  await initialization;
  function create() {
    const instance = {
      ...definition.methods, data: { show: false, bodyHeight: 200 }, closed: 0,
      setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
      triggerEvent(name: string) { if (name === 'close') this.closed += 1; },
      createSelectorQuery() {
        const query = {
          selectViewport() { return query; },
          select() { return query; },
          boundingClientRect() { return query; },
          exec(callback: (results: { height: number }[]) => void) { callback([{ height }, { height: 1000 }, { height: 60 }]); },
        };
        return query;
      },
    };
    definition.lifetimes.attached.call(instance);
    return instance;
  }
  function show(instance: any, value: boolean) {
    instance.data.show = value;
    definition.observers.show.call(instance, value);
  }
  return { calls, create, show, windowHandlers, keyboardHandlers,
    setRoute(value: string) { route = value; },
    setHeight(value: number) { height = value; },
    resize(value: number) { height = value; windowHandlers.forEach(callback => callback()); },
    hide(instance: any) { definition.pageLifetimes.hide.call(instance); },
    showPage(instance: any) { definition.pageLifetimes.show.call(instance); },
    failRestore(value: boolean) { failRestore = value; },
    detach(instance: any) { definition.lifetimes.detached.call(instance); },
  };
}

test('modal sheets hide native tab navigation until the last sheet is closed', async () => {
  const env = await setup();
  const first = env.create(), second = env.create();
  try {
    env.show(first, true);
    env.show(second, true);
    assert.deepEqual(env.calls, ['hide']);
    env.show(first, false);
    assert.deepEqual(env.calls, ['hide']);
    env.show(second, false);
    assert.deepEqual(env.calls, ['hide', 'show']);
  } finally { env.detach(first); env.detach(second); }
});

test('hiding a sheet page releases navigation without requesting discard and keeps the sheet for return', async () => {
  const env = await setup();
  const sheet = env.create();
  env.show(sheet, true);
  const before = sheet.data.bodyHeight;
  env.resize(420);
  assert.ok(sheet.data.bodyHeight < before);
  env.hide(sheet);
  assert.equal(sheet.closed, 0);
  assert.equal(sheet.data.show, true);
  assert.deepEqual(env.calls, ['hide', 'show']);
  env.showPage(sheet);
  assert.equal(sheet.closed, 0);
  assert.equal(sheet.data.show, true);
  assert.deepEqual(env.calls, ['hide', 'show', 'hide']);
  env.detach(sheet);
  assert.deepEqual(env.calls, ['hide', 'show', 'hide', 'show']);
  assert.equal(env.windowHandlers.size, 0);
  assert.equal(env.keyboardHandlers.size, 0);
});

test('a dirty sheet owner receives no close request while hidden and is measured when it returns', async () => {
  const env = await setup();
  const sheet = env.create();
  let discardPrompts = 0;
  sheet.triggerEvent = (name: string) => { if (name === 'close') discardPrompts += 1; };
  env.show(sheet, true);
  const priorHeight = sheet.data.bodyHeight;
  env.hide(sheet);
  env.setHeight(420);
  assert.equal(sheet.data.bodyHeight, priorHeight);
  env.showPage(sheet);
  assert.equal(discardPrompts, 0);
  assert.equal(sheet.data.show, true);
  assert.ok(sheet.data.bodyHeight < priorHeight);
  assert.deepEqual(env.calls, ['hide', 'show', 'hide']);
  env.detach(sheet);
  assert.equal(discardPrompts, 0);
  assert.equal(env.windowHandlers.size, 0);
  assert.equal(env.keyboardHandlers.size, 0);
});

test('non-tab pages do not attempt to change native tab navigation', async () => {
  const env = await setup();
  env.setRoute('pages/detail/index');
  const sheet = env.create();
  try {
    env.show(sheet, true);
    env.show(sheet, false);
    assert.deepEqual(env.calls, []);
  } finally { env.detach(sheet); }
});

test('a failed tab-bar restoration is retried when the page becomes visible', async () => {
  const env = await setup();
  const sheet = env.create();
  env.show(sheet, true);
  env.failRestore(true);
  env.show(sheet, false);
  assert.deepEqual(env.calls, ['hide', 'show']);
  env.failRestore(false);
  env.showPage(sheet);
  assert.deepEqual(env.calls, ['hide', 'show', 'show']);
  env.detach(sheet);
});

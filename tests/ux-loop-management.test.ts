import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as validation from '../domain/validation';
import * as entrance from '../miniprogram/services/entrance';
import * as activityCycle from '../shared/activity-cycle';
import * as recognitionForm from '../miniprogram/services/recognition-form';
import * as activityDesign from '../miniprogram/services/activity-design';
import * as reviewForm from '../miniprogram/services/review-form';
import type { ActivityDraft, ApiRequest, Submission } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';

type Controller = { data: Record<string, any>; setData(values: Record<string, unknown>, callback?: () => void): void; [key: string]: any };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const fieldEvent = (field: string, value = '') => ({ currentTarget: { dataset: { field } }, detail: { value } });
function draft(): ActivityDraft {
  return { title: 'Weekend offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: [], cardKind: 'credit', cardDescription: 'Eligible credit cards', frequency: 'once', startsOn: '2026-09-01', endsOn: '2026-12-31', target: 1, unit: '次', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false, conditions: 'One eligible purchase', sourceUrl: 'https://bank.example/terms', sourceNote: 'Bank app > offers', entrance: { kind: 'guide', label: 'Offer entry', instructions: 'Open the bank app', imageIds: [] } };
}
function submission(id = 'submission-1', version = 1): Submission {
  return { id, ownerId: 'user-1', draft: draft(), status: 'pending', reviewNote: '', createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', version };
}
function harness(route: string, options: { query?: (action: string, payload: any) => Promise<any>; command?: (action: string, payload: any, options?: { intentKey?: string }) => Promise<any>; commandTransport?: (request: ApiRequest) => Promise<any>; session?: (force: boolean) => Promise<any>; upload?: () => Promise<any>; actualPreview?: boolean; navigationFailure?: (kind: string) => boolean; confirmRecovery?: boolean; storage?: Map<string, unknown>; settings?: Record<string, unknown> } = {}) {
  const storage = options.storage || new Map<string, unknown>();
  const scrolls: { selector: string; section: string }[] = [];
  const effects: string[] = [];
  const clipboard: string[] = [];
  const navigations: string[] = [];
  const sessionRequests: boolean[] = [];
  const previews: { ids: string[]; index: number }[] = [];
  const nativePreviews: { urls: string[]; current: string }[] = [];
  const navigationCalls: { kind: string; url?: string; delta?: number }[] = [];
  const commands: { action: string; payload: any; options?: { intentKey?: string } }[] = [];
  let stack: any[] | undefined;
  let currentPage = true;
  let page!: Controller;
  let query = options.query || (async (action: string) => action === 'submission.get' ? submission() : action.startsWith('assets.') ? [] : { items: [], nextCursor: null });
  function navigate(kind: string, value: { url?: string; delta?: number; success?: () => void; fail?: () => void } = {}) {
    navigationCalls.push({ kind, ...(value.url ? { url: value.url } : {}), ...(value.delta ? { delta: value.delta } : {}) });
    if (options.navigationFailure?.(kind)) { value.fail?.(); return; }
    const pages = stack || [page];
    if (kind === 'back') {
      const delta = value.delta || 1;
      if (delta >= pages.length) { value.fail?.(); return; }
      stack = pages.slice(0, -delta);
    } else {
      const destination = { route: (value.url || '').replace(/^\//, '').split('?')[0] };
      if (kind === 'switchTab' || kind === 'reLaunch') stack = [destination];
      else if (kind === 'redirectTo') stack = [...pages.slice(0, -1), destination];
      else { navigations.push(value.url || ''); stack = [...pages, destination]; }
    }
    value.success?.();
  }
  const wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    showModal: async () => ({ confirm: options.confirmRecovery !== false }),
    enableAlertBeforeUnload: () => effects.push('enableAlert'), disableAlertBeforeUnload: () => effects.push('disableAlert'),
    setNavigationBarTitle() {}, showToast() {},
    navigateBack: (value: any) => navigate('back', value), redirectTo: (value: any) => navigate('redirectTo', value),
    navigateTo: (value: any) => navigate('navigateTo', value), switchTab: (value: any) => navigate('switchTab', value), reLaunch: (value: any) => navigate('reLaunch', value),
    setClipboardData: ({ data }: { data: string }) => clipboard.push(data),
    previewImage: ({ urls, current, success }: { urls: string[]; current: string; success: () => void }) => { nativePreviews.push({ urls: Array.from(urls), current }); success(); },
    pageScrollTo: ({ selector }: { selector: string }) => scrolls.push({ selector, section: page.data.openSection }),
    showNavigationBarLoading: () => effects.push('showLoading'), hideNavigationBarLoading: () => effects.push('hideLoading'),
    cloud: { init() {}, callFunction: async ({ data }: { data: ApiRequest }) => ({ result: { ok: true, data: await options.commandTransport?.(data) } }) },
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const javascript = ts.transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(javascript, { exports, wx, Error, getCurrentPages: () => currentPage ? stack || [page] : [...(stack || [page]), {}], require: (id: string) => { assert.ok(id in imports, `Unexpected import: ${id}`); return imports[id]; },
      Page: (definition: Controller) => {
        page = definition;
        page.route = `pages/${route}/index`;
        page.data = JSON.parse(JSON.stringify(definition.data));
        page.setData = (patch, callback) => {
          for (const [key, value] of Object.entries(patch)) {
            const segments = key.split('.');
            let target = page.data;
            for (const segment of segments.slice(0, -1)) target = target[segment] ||= {};
            target[segments.at(-1)!] = value;
          }
          callback?.();
        };
      },
    }, { filename: file });
    return exports;
  }
  const drafts = evaluate('miniprogram/services/form-draft.ts');
  let previewAssets = async (assets: { id: string }[], index: number, shouldOpen = () => true) => { if (shouldOpen()) previews.push({ ids: Array.from(assets, asset => asset.id), index }); };
  let actualCommand: ((action: string, payload: any, options?: { intentKey?: string }) => Promise<any>) | undefined;
  if (options.actualPreview || options.commandTransport) {
    const sourceApi = evaluate('miniprogram/services/api.ts', {
      '../runtime-config': { default: options.commandTransport ? { mode: 'cloud', cloudEnvId: 'test-cloud', apiFunctionName: 'api' } : { mode: 'demo' } },
      './demo': { demoActor: { userId: 'user-1', isModerator: false }, demoService() {}, persistDemo() {} },
      './entrance': { entranceBehavior: () => 'guide' },
    });
    (sourceApi.api as { query: (action: string, payload: any) => Promise<any> }).query = async (action, payload) => query(action, payload);
    previewAssets = sourceApi.previewAssets as typeof previewAssets;
    actualCommand = (sourceApi.api as { command: typeof actualCommand }).command;
  }
  evaluate(`miniprogram/pages/${route}/index.ts`, {
    '../../services/api': { api: { query: (action: string, payload: any) => query(action, payload), command: async (action: string, payload: any, commandOptions?: { intentKey?: string }) => { commands.push({ action, payload, ...(commandOptions ? { options: commandOptions } : {}) }); return options.command ? options.command(action, payload, commandOptions) : actualCommand ? actualCommand(action, payload, commandOptions) : { id: 'submission-1' }; } }, uploadImage: options.upload, previewAssets, ensureSession: async (force = false) => { sessionRequests.push(force); return options.session ? options.session(force) : { userId: 'user-1', isModerator: true, today: '2026-09-22' }; } },
    '../../services/form-draft': drafts,
    '../../services/navigation': { navigateBackOr: (url: string) => effects.push(`back:${url}`) },
    '../../runtime-config': { default: options.settings || { webViewEnabled: false, allowedWebViewHosts: [] } },
    '../../../shared/catalog': catalog,
    '../../../domain/validation': validation,
    '../../../shared/activity-cycle': activityCycle,
    '../../services/recognition-form': recognitionForm,
    '../../services/activity-design': activityDesign,
    '../../services/review-form': reviewForm,
    '../../services/format': { showError: () => effects.push('showError') },
    '../../services/card-labels': {},
    '../../services/benefit-copy': {},
    '../../services/entrance': entrance,
  });
  return { page, storage, scrolls, effects, clipboard, navigations, navigationCalls, commands, sessionRequests, previews, nativePreviews, previewAssets,
    formDrafts: drafts as { saveDraft: (...args: any[]) => boolean; loadDraft: (...args: any[]) => any },
    setStack: (value: any[]) => { stack = value; }, stackRoutes: () => (stack || [page]).map(value => value.route),
    setCurrentPage: (value: boolean) => { currentPage = value; }, setQuery: (value: typeof query) => { query = value; } };
}

test('submission pagination retains the current cursor on failure and deduplicates a retry', async () => {
  let fail = true;
  const env = harness('submissions', { query: async (_action, payload) => {
    if (!payload.cursor) return { items: [submission('first')], nextCursor: 'next-page' };
    if (fail) throw new Error('Network unavailable');
    return { items: [submission('first'), submission('second')], nextCursor: null };
  } });
  await env.page.load();
  await env.page.loadMore();
  assert.equal(env.page.data.nextCursor, 'next-page');
  assert.equal(env.page.data.items.length, 1);
  assert.equal(env.page.data.error, '');
  assert.equal(env.page.data.loadMoreError, 'Network unavailable');
  fail = false;
  await env.page.loadMore();
  assert.deepEqual(Array.from(env.page.data.items, (row: Submission) => row.id), ['first', 'second']);
  assert.equal(env.page.data.loadMoreError, '');
});

test('a replaced submissions request cannot append stale pagination or change the current loading state', async () => {
  const oldPage = deferred<any>();
  let rootLoads = 0;
  const env = harness('submissions', { query: async (_action, payload) => payload.cursor ? oldPage.promise : { items: [submission(`load-${++rootLoads}`)], nextCursor: 'next-page' } });
  await env.page.load();
  const pagination = env.page.loadMore();
  await env.page.load();
  oldPage.resolve({ items: [submission('obsolete')], nextCursor: null });
  await pagination;
  assert.deepEqual(Array.from(env.page.data.items, (row: Submission) => row.id), ['load-2']);
  assert.equal(env.page.data.nextCursor, 'next-page');
  assert.equal(env.page.data.loadingMore, false);
});

test('review pagination failures leave the active result set available for an inline retry', async () => {
  const env = harness('review', { query: async (_action, payload) => {
    if (payload.cursor) throw new Error('Page unavailable');
    return { items: [submission()], nextCursor: 'next-page' };
  } });
  await env.page.load();
  await env.page.loadMore();
  assert.equal(env.page.data.items.length, 1);
  assert.equal(env.page.data.error, '');
  assert.equal(env.page.data.loadMoreError, 'Page unavailable');
  assert.equal(env.page.data.nextCursor, 'next-page');
});

test('failed conflict reload retains the current form, base version, and local recovery draft', async () => {
  const env = harness('submission-edit');
  env.page.setData({ submissionId: 'submission-1' });
  await env.page.load();
  env.page.input(fieldEvent('title', 'Unsaved user changes'));
  env.page.setData({ conflict: true });
  const stored = JSON.stringify(Array.from(env.storage.entries()));
  env.setQuery(async () => { throw new Error('Network unavailable'); });
  await env.page.reloadLatest();
  assert.equal(env.page.data.ready, true);
  assert.equal(env.page.data.draft.title, 'Unsaved user changes');
  assert.equal(env.page.draftBaseVersion, 1);
  assert.equal(env.page.data.dirty, true);
  assert.equal(env.page.data.conflict, true);
  assert.equal(env.page.data.reloading, false);
  assert.equal(JSON.stringify(Array.from(env.storage.entries())), stored);
  assert.equal(env.effects.includes('disableAlert'), false);
});

test('successful conflict reload only clears its draft after the latest response arrives', async () => {
  const env = harness('submission-edit');
  env.page.setData({ submissionId: 'submission-1' });
  await env.page.load();
  env.page.input(fieldEvent('title', 'Unsaved user changes'));
  const latest = deferred<any>();
  env.setQuery(async action => action === 'submission.get' ? latest.promise : []);
  const request = env.page.reloadLatest();
  await tick();
  assert.ok(env.storage.size > 0);
  assert.equal(env.page.data.draft.title, 'Unsaved user changes');
  env.page.input(fieldEvent('title', 'Ignored during reload'));
  assert.equal(env.page.data.draft.title, 'Unsaved user changes');
  latest.resolve(submission('submission-1', 2));
  await request;
  assert.equal(env.storage.size, 0);
  assert.equal(env.page.draftBaseVersion, 2);
  assert.equal(env.page.data.dirty, false);
  assert.equal(env.page.data.conflict, false);
});

test('validation summary links open the correct section and editing removes only its own error', async () => {
  const env = harness('submission-edit');
  await env.page.load();
  env.page.setData({ draft: { ...draft(), conditions: '' }, targetText: '1', rewardText: '', openSection: 'source' });
  assert.equal(env.page.validate(), false);
  assert.equal(env.scrolls.at(-1)?.selector, '#validation-summary');
  assert.equal(env.page.data.errorSummary.length, 2);
  env.page.goToError(fieldEvent('rewardText'));
  assert.deepEqual(env.scrolls.at(-1), { selector: '#field-rewardText', section: 'rules' });
  env.page.input(fieldEvent('rewardText', '20.00'));
  assert.deepEqual(Array.from(env.page.data.errorSummary, (issue: { field: string }) => issue.field), ['conditions']);
  assert.ok(env.page.data.errors.conditions);
});

test('copying a full submission source retains both the link and source note', async () => {
  const env = harness('submission-edit');
  env.page.setData({ submissionId: 'submission-1' });
  await env.page.load();
  env.page.copySource();
  assert.equal(env.clipboard[0], 'https://bank.example/terms\nBank app > offers');
});

test('restricted web entries retain a copyable public address without bypassing the host configuration', () => {
  const env = harness('web-entry');
  env.page.onLoad({ url: encodeURIComponent('https://www.cmbchina.com/offer') });
  assert.equal(env.page.data.url, '');
  assert.equal(env.page.data.canRetry, false);
  env.page.copyUrl();
  assert.equal(env.clipboard[0], 'https://www.cmbchina.com/offer');
  env.page.retry();
  assert.equal(env.page.data.url, '');
});

test('a failed allowed web entry offers a real retry and clears the navigation loading indicator', () => {
  const env = harness('web-entry', { settings: { webViewEnabled: true, allowedWebViewHosts: ['www.cmbchina.com'] } });
  env.page.onLoad({ url: encodeURIComponent('https://www.cmbchina.com/offer') });
  assert.equal(env.page.data.loading, true);
  env.page.failed();
  assert.equal(env.page.data.url, '');
  assert.equal(env.page.data.loading, false);
  assert.ok(env.page.data.error);
  env.page.retry();
  assert.equal(env.page.data.url, 'https://www.cmbchina.com/offer');
  assert.equal(env.page.data.error, '');
  env.page.loaded();
  assert.equal(env.effects.at(-1), 'hideLoading');
});

test('sheet dismissal leaves navigation hidden until the owner actually closes the sheet', () => {
  let definition: any;
  const calls: string[] = [];
  const source = readFileSync('miniprogram/components/app-sheet/index.ts', 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, { exports: {}, require: () => ({ default: { tabBar: { list: [{ pagePath: 'pages/activities/index' }] } } }), Component: (value: unknown) => { definition = value; }, getCurrentPages: () => [{ route: 'pages/activities/index' }], wx: { nextTick() {}, hideTabBar: () => calls.push('hide'), showTabBar: ({ success }: { success: () => void }) => { calls.push('show'); success(); } } });
  const instance = { ...definition.methods, data: { show: true, dismissible: false }, triggerEvent: () => calls.push('close') };
  definition.observers.show.call(instance, true);
  instance.close();
  assert.deepEqual(calls, ['hide']);
  instance.data.dismissible = true;
  instance.close();
  assert.deepEqual(calls, ['hide', 'close']);
  instance.data.show = false;
  definition.observers.show.call(instance, false);
  assert.deepEqual(calls, ['hide', 'close', 'show']);
});

test('sheet content changes grow and shrink its viewport after an asynchronous result without changing navigation ownership', () => {
  let definition: any;
  let contentHeight = 72;
  const calls: string[] = [];
  const source = readFileSync('miniprogram/components/app-sheet/index.ts', 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, { exports: {}, require: () => ({ default: { tabBar: { list: [{ pagePath: 'pages/activities/index' }] } } }), Component: (value: unknown) => { definition = value; }, getCurrentPages: () => [{ route: 'pages/activities/index' }], wx: {
    nextTick: (callback: () => void) => callback(), hideTabBar: () => calls.push('hide'), showTabBar: () => calls.push('show'),
    getWindowInfo: () => ({ windowHeight: 700, screenHeight: 800, safeArea: { bottom: 766 } }),
  } });
  const instance = { ...definition.methods, data: { show: true, bodyHeight: 200, contentState: [true, []] as unknown[] },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    createSelectorQuery() {
      const query = { selectViewport() { return query; }, select() { return query; }, boundingClientRect() { return query; }, exec(callback: (results: { height: number }[]) => void) { callback([{ height: 700 }, { height: contentHeight }, { height: 64 }]); } };
      return query;
    },
  };
  definition.observers.show.call(instance, true);
  assert.equal(instance.data.bodyHeight, 72);
  contentHeight = 1600;
  instance.data.contentState = [false, Array.from({ length: 30 }, (_, id) => ({ id }))];
  definition.observers['contentState.**, title, fullScreen'].call(instance);
  assert.equal(instance.data.bodyHeight, 518);
  contentHeight = 110;
  instance.data.contentState = [false, []];
  definition.observers['contentState.**, title, fullScreen'].call(instance);
  assert.equal(instance.data.bodyHeight, 110);
  assert.deepEqual(calls, ['hide']);
});

test('submission validation asks for a bank before presenting issuer errors and links only visible fields', async () => {
  const env = harness('submission-edit');
  await env.page.load();
  assert.equal(env.page.validate(), false);
  assert.ok(env.page.data.errors.bankId);
  assert.equal(env.page.data.errors.issuerIds, undefined);
  assert.equal(env.page.data.errorSummary.some((issue: { field: string }) => issue.field === 'issuerIds'), false);
  env.page.goToError(fieldEvent('issuerIds'));
  assert.equal(env.scrolls.at(-1)?.selector, '#field-bankId');
  const bank = catalog.banks.find(item => catalog.issuers.filter(issuer => issuer.bankId === item.id).length > 1)!;
  const bankIndex = env.page.data.bankOptions.findIndex((item: { id: string }) => item.id === bank.id);
  env.page.select(fieldEvent('bankId', String(bankIndex)));
  assert.ok(env.page.data.issuerOptions.length > 1);
  assert.equal(env.page.validate(), false);
  assert.ok(env.page.data.errors.issuerIds);
  env.page.goToError(fieldEvent('issuerIds'));
  assert.equal(env.scrolls.at(-1)?.selector, '#field-issuerIds');
});

test('changing entrance type removes obsolete errors and stale links fall back to its visible selector', async () => {
  const env = harness('submission-edit');
  env.page.setData({ submissionId: 'submission-1' });
  await env.page.load();
  env.page.select(fieldEvent('entrance.kind', '1'));
  assert.equal(env.page.validate(), false);
  assert.ok(env.page.data.errors.entrance.url);
  env.page.select(fieldEvent('entrance.kind', '2'));
  assert.equal(env.page.data.errors.entrance.url, '');
  assert.equal(env.page.data.errorSummary.some((issue: { field: string }) => issue.field === 'entrance.url'), false);
  env.page.goToError(fieldEvent('entrance.url'));
  assert.equal(env.scrolls.at(-1)?.selector, '#field-entrance-kind');
  assert.equal(env.page.validate(), false);
  assert.ok(env.page.data.errors.entrance.appId);
  env.page.select(fieldEvent('entrance.kind', '0'));
  assert.equal(env.page.data.errors.entrance.appId, '');
  assert.equal(env.page.data.errorSummary.length, 0);
  assert.ok(env.page.validate());
});

function submissionPage(items: Submission[], payload: { cursor?: string; limit: number }) {
  const offset = Number(payload.cursor || 0);
  return { items: items.slice(offset, offset + payload.limit), nextCursor: offset + payload.limit < items.length ? String(offset + payload.limit) : null };
}

for (const route of ['submissions', 'review']) {
  test(`${route} preserves the loaded window while returning from a second-page submission`, async () => {
    let items = Array.from({ length: 65 }, (_, index) => submission(`row-${index}`));
    const env = harness(route, { query: async (_action, payload) => submissionPage(items, payload) });
    await env.page.load();
    await env.page.loadMore();
    env.page.open({ currentTarget: { dataset: { id: 'row-25' } } });
    assert.ok(env.navigations.at(-1)?.includes('row-25'));
    const response = deferred<any>();
    let refreshPayload: any;
    env.setQuery(async (_action, payload) => { refreshPayload = payload; return response.promise; });
    env.page.onShow();
    await tick();
    assert.equal(env.page.data.loading, true);
    assert.equal(env.page.data.items.length, 40);
    assert.equal(env.page.data.items[25].id, 'row-25');
    assert.equal(refreshPayload.limit, 40);
    items = items.map(item => item.id === 'row-25' ? { ...item, version: 2, reviewNote: 'Updated review' } : item);
    response.resolve(submissionPage(items, refreshPayload));
    await tick();
    assert.equal(env.page.data.loading, false);
    assert.equal(env.page.data.items.length, 40);
    assert.equal(env.page.data.items[25].version, 2);
    assert.equal(env.page.data.nextCursor, '40');
    assert.equal(env.sessionRequests.at(-1), true);
  });

  test(`${route} keeps the previous window and cursor after a return refresh fails`, async () => {
    const items = Array.from({ length: 65 }, (_, index) => submission(`row-${index}`));
    const env = harness(route, { query: async (_action, payload) => submissionPage(items, payload) });
    await env.page.load();
    await env.page.loadMore();
    const oldIds = Array.from(env.page.data.items, (item: Submission) => item.id);
    env.setQuery(async () => { throw new Error('Refresh unavailable'); });
    env.page.onShow();
    await tick();
    assert.deepEqual(Array.from(env.page.data.items, (item: Submission) => item.id), oldIds);
    assert.equal(env.page.data.nextCursor, '40');
    assert.equal(env.page.data.error, 'Refresh unavailable');
    assert.equal(env.page.data.sessionVerified, true);
    assert.equal(env.page.data.loading, false);
    env.setQuery(async (_action, payload) => submissionPage(items, payload));
    await env.page.load();
    assert.equal(env.page.data.items.length, 40);
    assert.equal(env.page.data.error, '');
  });

  test(`${route} discards the previous account window before reading another identity`, async () => {
    let ownerId = 'user-1';
    const items = Array.from({ length: 65 }, (_, index) => submission(`row-${index}`));
    const env = harness(route, { session: async () => ({ userId: ownerId, isModerator: true }), query: async (_action, payload) => submissionPage(items, payload) });
    await env.page.load();
    await env.page.loadMore();
    ownerId = 'user-2';
    let requestedLimit = 0;
    env.setQuery(async (_action, payload) => { requestedLimit = payload.limit; throw new Error('New account data unavailable'); });
    await env.page.load();
    assert.equal(requestedLimit, 20);
    assert.equal(env.page.data.items.length, 0);
    assert.equal(env.page.data.nextCursor, null);
  });
}

for (const [label, rejection] of [
  ['native object', { errMsg: 'chooseMedia:fail cancel' }],
  ['error instance', new Error('chooseMedia:fail cancel')],
  ['string', 'chooseMedia:fail cancel'],
  ['localized string', '用户取消选择图片'],
  ['native object with generic message', { message: 'Operation failed', errMsg: 'chooseMedia:fail cancel' }],
] as const) {
  test(`full submission image selection cancellation as ${label} preserves images, draft, and existing feedback`, async () => {
    const env = harness('submission-edit', { upload: async () => { throw rejection; } });
    env.page.setData({ submissionId: 'submission-1' });
    await env.page.load();
    env.page.setData({ 'draft.entrance.imageIds': ['existing-image'], assets: [{ id: 'existing-image' }], assetUrls: [{ id: 'existing-image', url: 'saved-image-url' }] });
    env.page.markDirty();
    env.page.setData({ error: 'Existing form feedback', errors: { conditions: 'Existing field feedback', imageIds: 'Existing image feedback' } });
    env.page.syncErrorSummary();
    const before = JSON.stringify(env.page.data);
    const savedDraft = JSON.stringify(Array.from(env.storage.entries()));
    await env.page.addImage();
    assert.equal(JSON.stringify(env.page.data), before);
    assert.equal(JSON.stringify(Array.from(env.storage.entries())), savedDraft);
    assert.equal(env.page.data.uploading, false);
  });
}

function delayedImageRefresh(env: ReturnType<typeof harness>) {
  const oldAssets = deferred<any>();
  const oldUrls = deferred<any>();
  const counts = { 'assets.get': 0, 'assets.urls': 0 };
  env.setQuery(async (action, payload) => {
    if (action !== 'assets.get' && action !== 'assets.urls') throw new Error(`Unexpected image action: ${action}`);
    if (++counts[action] === 1) return action === 'assets.get' ? oldAssets.promise : oldUrls.promise;
    return payload.ids.map((id: string) => action === 'assets.get' ? { id, fileId: `current-${id}` } : { id, url: `current-${id}` });
  });
  return {
    resolveOld(ids: string[]) {
      oldAssets.resolve(ids.map(id => ({ id, fileId: `obsolete-${id}` })));
      oldUrls.resolve(ids.map(id => ({ id, url: `obsolete-${id}` })));
    },
  };
}

test('removing an entrance image invalidates a pending refresh and preview galleries contain only current scoped images', async () => {
  const env = harness('submission-edit');
  await env.page.load();
  env.page.setData({ 'draft.entrance.imageIds': ['removed', 'kept'], sourceImageIds: ['original-source'] });
  env.page.syncOptions();
  const delayed = delayedImageRefresh(env);
  const oldRequest = env.page.loadImages();
  assert.equal(env.page.data.loadingImages, true);
  env.page.removeImage({ currentTarget: { dataset: { id: 'removed' } } });
  await tick();
  delayed.resolveOld(['removed', 'kept', 'original-source']);
  await oldRequest;
  assert.deepEqual(Array.from(env.page.data.assets, (asset: { id: string }) => asset.id), ['kept', 'original-source']);
  assert.deepEqual(Array.from(env.page.data.assetUrls, (asset: { id: string }) => asset.id), ['kept', 'original-source']);
  assert.deepEqual(Array.from(env.page.data.sourceImageIds), ['original-source']);
  env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'kept', scope: 'entrance' } } });
  env.page.toggleSection({ currentTarget: { dataset: { section: 'source' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'original-source', scope: 'source' } } });
  env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'removed', scope: 'entrance' } } });
  assert.deepEqual(env.previews, [{ ids: ['kept'], index: 0 }, { ids: ['original-source'], index: 0 }]);
});

test('removing a reused source image from the entrance preserves its lawful source copy and source-only preview', async () => {
  const env = harness('submission-edit');
  await env.page.load();
  env.page.setData({ 'draft.entrance.imageIds': ['shared-source', 'kept'], sourceImageIds: ['shared-source'], assets: [{ id: 'shared-source' }, { id: 'kept' }], assetUrls: [{ id: 'shared-source', url: 'source-url' }, { id: 'kept', url: 'kept-url' }] });
  env.page.removeImage({ currentTarget: { dataset: { id: 'shared-source' } } });
  assert.deepEqual(Array.from(env.page.data.draft.entrance.imageIds), ['kept']);
  assert.deepEqual(Array.from(env.page.data.sourceImageIds), ['shared-source']);
  assert.ok(env.page.data.assets.some((asset: { id: string }) => asset.id === 'shared-source'));
  assert.equal(env.page.data.sourceImageRows[0].used, false);
  assert.equal(env.page.data.sourceImageRows[0].url, 'source-url');
  env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'shared-source', scope: 'entrance' } } });
  assert.equal(env.previews.length, 0);
  env.page.toggleSection({ currentTarget: { dataset: { section: 'source' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'shared-source', scope: 'source' } } });
  assert.deepEqual(env.previews, [{ ids: ['shared-source'], index: 0 }]);
});

test('reusing a source image invalidates an older refresh without changing immutable source membership', async () => {
  const env = harness('submission-edit');
  await env.page.load();
  env.page.setData({ 'draft.entrance.imageIds': ['kept'], sourceImageIds: ['original-source'] });
  const delayed = delayedImageRefresh(env);
  const oldRequest = env.page.loadImages();
  env.page.useSourceImage({ currentTarget: { dataset: { id: 'original-source' } } });
  await tick();
  delayed.resolveOld(['kept', 'original-source']);
  await oldRequest;
  assert.deepEqual(Array.from(env.page.data.draft.entrance.imageIds), ['kept', 'original-source']);
  assert.deepEqual(Array.from(env.page.data.sourceImageIds), ['original-source']);
  assert.ok(env.page.data.assets.every((asset: { fileId: string }) => asset.fileId.startsWith('current-')));
  env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'original-source', scope: 'entrance' } } });
  assert.deepEqual(env.previews, [{ ids: ['kept', 'original-source'], index: 1 }]);
});

test('a completed upload survives an older image refresh and does not admit unrequested response assets', async () => {
  const env = harness('submission-edit', { upload: async () => ({ id: 'uploaded', fileId: 'uploaded-file' }) });
  await env.page.load();
  env.page.setData({ 'draft.entrance.imageIds': ['kept'] });
  const delayed = delayedImageRefresh(env);
  const oldRequest = env.page.loadImages();
  await env.page.addImage();
  delayed.resolveOld(['kept']);
  await oldRequest;
  assert.deepEqual(Array.from(env.page.data.draft.entrance.imageIds), ['kept', 'uploaded']);
  assert.deepEqual(Array.from(env.page.data.assets, (asset: { id: string }) => asset.id), ['kept', 'uploaded']);
  env.setQuery(async action => action === 'assets.get' ? [{ id: 'kept' }, { id: 'uploaded' }, { id: 'unrequested' }] : [{ id: 'kept', url: 'kept-url' }, { id: 'uploaded', url: 'uploaded-url' }, { id: 'unrequested', url: 'unrequested-url' }]);
  await env.page.loadImages();
  assert.deepEqual(Array.from(env.page.data.assets, (asset: { id: string }) => asset.id), ['kept', 'uploaded']);
  assert.deepEqual(Array.from(env.page.data.assetUrls, (asset: { id: string }) => asset.id), ['kept', 'uploaded']);
  env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'uploaded', scope: 'entrance' } } });
  assert.deepEqual(env.previews, [{ ids: ['kept', 'uploaded'], index: 1 }]);
});

async function imagePreviewPage(route: string) {
  const env = harness(route, { actualPreview: true });
  if (route === 'detail') { env.page.setData({ detail: { assets: [{ id: 'current-image', fileId: 'cached-url' }] } }); env.page.openGuide(); }
  else {
    await env.page.load();
    env.page.setData({ [route === 'submission-edit' ? 'draft.entrance.imageIds' : 'lead.imageIds']: ['current-image'], assets: [{ id: 'current-image', fileId: 'cached-url' }] });
    env.page.syncOptions();
    if (route === 'submission-edit') env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  }
  return env;
}

for (const route of ['submission-edit', 'submission-lead', 'detail']) {
  for (const change of ['unload', 'inactive-stack-owner', 'hide-then-return', 'replace-generation']) {
    test(`${route} ignores final preview URLs after ${change}`, async () => {
      const env = await imagePreviewPage(route);
      const urls = deferred<any>();
      let requests = 0;
      env.setQuery(async action => { assert.equal(action, 'assets.urls'); requests++; return urls.promise; });
      const preview = env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'entrance', index: 0 } } });
      await tick();
      assert.equal(requests, 1);
      if (change === 'unload') env.page.onUnload();
      else if (change === 'inactive-stack-owner') env.setCurrentPage(false);
      else if (change === 'hide-then-return') { env.page.onHide(); env.setCurrentPage(false); env.setCurrentPage(true); }
      else if (route === 'detail') env.page.loadSequence += 1;
      else env.page.loadGeneration += 1;
      urls.resolve([{ id: 'current-image', url: 'resolved-url' }]);
      await preview;
      assert.equal(env.nativePreviews.length, 0);
      assert.equal(env.effects.includes('showError'), false);
    });
  }
}

for (const route of ['submission-edit', 'submission-lead']) {
  test(`${route} does not open a removed image after final URL resolution`, async () => {
    const env = await imagePreviewPage(route);
    const urls = deferred<any>();
    env.setQuery(async action => { assert.equal(action, 'assets.urls'); return urls.promise; });
    const preview = env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'entrance' } } });
    await tick();
    env.page.removeImage({ currentTarget: { dataset: { id: 'current-image' } } });
    urls.resolve([{ id: 'current-image', url: 'removed-image-url' }]);
    await preview;
    assert.equal(env.nativePreviews.length, 0);
  });
}

test('a valid original source preview remains available when that image is removed only from the public entrance', async () => {
  const env = await imagePreviewPage('submission-edit');
  env.page.setData({ sourceImageIds: ['current-image'] });
  env.page.toggleSection({ currentTarget: { dataset: { section: 'source' } } });
  const urls = deferred<any>();
  env.setQuery(async action => { assert.equal(action, 'assets.urls'); return urls.promise; });
  const preview = env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'source' } } });
  await tick();
  env.page.removeImage({ currentTarget: { dataset: { id: 'current-image' } } });
  urls.resolve([{ id: 'current-image', url: 'valid-original-source-url' }]);
  await preview;
  assert.deepEqual(env.nativePreviews, [{ urls: ['valid-original-source-url'], current: 'valid-original-source-url' }]);
  assert.deepEqual(Array.from(env.page.data.sourceImageIds), ['current-image']);
});

test('previewAssets keeps its original behavior when no validity callback is supplied', async () => {
  const env = harness('submission-edit', { actualPreview: true, query: async () => [{ id: 'image-a', url: 'image-a-url' }] });
  await env.previewAssets([{ id: 'image-a' }], 0);
  assert.deepEqual(env.nativePreviews, [{ urls: ['image-a-url'], current: 'image-a-url' }]);
});

test('previewAssets selects the requested asset by ID when earlier URLs are unavailable or responses reorder', async () => {
  const env = harness('submission-edit', { actualPreview: true, query: async () => [
    { id: 'image-c', url: 'image-c-url' }, { id: 'image-b', url: 'image-b-url' }, { id: 'unrequested', url: 'unrequested-url' },
  ] });
  await env.previewAssets([{ id: 'image-a' }, { id: 'image-b' }, { id: 'image-c' }], 1);
  assert.deepEqual(env.nativePreviews, [{ urls: ['image-b-url', 'image-c-url'], current: 'image-b-url' }]);
});

test('previewAssets reports the selected unavailable image instead of opening another authorized image', async () => {
  const env = harness('submission-edit', { actualPreview: true, query: async () => [{ id: 'image-b', url: 'image-b-url' }, { id: 'image-c', url: 'image-c-url' }] });
  await assert.rejects(env.previewAssets([{ id: 'image-a' }, { id: 'image-b' }, { id: 'image-c' }], 0), /这张图片暂时无法加载，请重新读取后重试/);
  assert.equal(env.nativePreviews.length, 0);
});

async function importedLeadEditor(options: { navigationFailure?: (kind: string) => boolean } = {}) {
  const env = harness('submission-edit', options);
  const lead = { title: 'Found bank offer', bankId: 'cmb', sourceUrl: '', sourceNote: '银行 App 活动页', imageIds: ['private-source-image'] };
  assert.equal(env.formDrafts.saveDraft('submission-lead', 'user-1', 'new', null, { lead }), true);
  const savedLead = JSON.stringify(env.formDrafts.loadDraft('submission-lead', 'user-1', 'new'));
  env.page.setData({ fromLead: true });
  await env.page.load();
  assert.equal(env.page.data.importedLead, true);
  env.page.setData({ draft: draft(), targetText: '1', rewardText: '20.00' });
  env.page.markDirty();
  return { ...env, savedLead };
}

for (const origin of ['existing-submissions', 'mine', 'deep-link']) {
  test(`successful imported lead submission from ${origin} exits both editors and preserves the original local source`, async () => {
    const env = await importedLeadEditor();
    const leadPage = { route: 'pages/submission-lead/index', data: { dirty: true } };
    env.setStack(origin === 'existing-submissions'
      ? [{ route: 'pages/mine/index' }, { route: 'pages/submissions/index' }, leadPage, env.page]
      : origin === 'mine' ? [{ route: 'pages/mine/index' }, leadPage, env.page] : [env.page]);
    await env.page.save();
    assert.equal(env.commands.length, 1);
    assert.equal(env.commands[0].action, 'submission.save');
    assert.equal(env.commands[0].payload.draft.entrance.imageIds.length, 0);
    assert.equal(env.stackRoutes().at(-1), 'pages/submissions/index');
    assert.equal(env.stackRoutes().includes('pages/submission-lead/index'), false);
    assert.equal(env.stackRoutes().includes('pages/submission-edit/index'), false);
    assert.equal(JSON.stringify(env.formDrafts.loadDraft('submission-lead', 'user-1', 'new')), env.savedLead);
    assert.equal(env.formDrafts.loadDraft('submission', 'user-1', 'new'), null);
    assert.equal(env.page.data.submitted, true);
    assert.equal(env.page.data.readOnly, true);
    if (origin === 'existing-submissions') assert.deepEqual(env.navigationCalls, [{ kind: 'back', delta: 2 }]);
    else assert.deepEqual(env.navigationCalls, [{ kind: 'switchTab', url: '/pages/mine/index' }, { kind: 'navigateTo', url: '/pages/submissions/index' }]);
    await env.page.save();
    assert.equal(env.commands.length, 1);
  });
}

test('an imported lead success has a safe deep-link fallback if switching to the account tab fails', async () => {
  const env = await importedLeadEditor({ navigationFailure: kind => kind === 'switchTab' });
  await env.page.save();
  assert.deepEqual(env.navigationCalls, [{ kind: 'switchTab', url: '/pages/mine/index' }, { kind: 'reLaunch', url: '/pages/submissions/index' }]);
  assert.deepEqual(env.stackRoutes(), ['pages/submissions/index']);
  assert.equal(JSON.stringify(env.formDrafts.loadDraft('submission-lead', 'user-1', 'new')), env.savedLead);
});

test('failed success navigation can be retried without resubmitting the imported lead', async () => {
  let failNavigation = true;
  const env = await importedLeadEditor({ navigationFailure: () => failNavigation });
  await env.page.save();
  assert.equal(env.page.data.submitted, true);
  assert.equal(env.page.data.readOnly, true);
  assert.equal(env.page.data.openingSubmissions, false);
  assert.equal(env.commands.length, 1);
  failNavigation = false;
  env.page.viewSubmissions();
  assert.equal(env.stackRoutes().at(-1), 'pages/submissions/index');
  assert.equal(env.commands.length, 1);
  assert.equal(JSON.stringify(env.formDrafts.loadDraft('submission-lead', 'user-1', 'new')), env.savedLead);
});

for (const reviewMode of [false, true]) {
  test(`${reviewMode ? 'moderation' : 'ordinary full submission'} success keeps its original single-page return scope`, async () => {
    const env = harness('submission-edit');
    env.page.setData({ submissionId: 'submission-1', reviewMode });
    await env.page.load();
    env.page.setData({ sourceVerified: true });
    const origin = reviewMode ? 'pages/review/index' : 'pages/submissions/index';
    env.setStack([{ route: origin }, env.page]);
    await env.page.save();
    assert.equal(env.commands.length, 1);
    assert.equal(env.commands[0].action, reviewMode ? 'submission.review' : 'submission.save');
    assert.deepEqual(env.navigationCalls, [{ kind: 'back', delta: 1 }]);
    assert.deepEqual(env.stackRoutes(), [origin]);
  });
}

for (const route of ['submission-edit', 'submission-lead', 'detail']) {
  test(`${route} opens only the latest valid image selection when final URL requests resolve in reverse order`, async () => {
    const env = await imagePreviewPage(route);
    const assets = [{ id: 'image-a', fileId: 'cached-a' }, { id: 'image-b', fileId: 'cached-b' }];
    if (route === 'detail') env.page.setData({ detail: { assets } });
    else env.page.setData({ assets, [route === 'submission-edit' ? 'draft.entrance.imageIds' : 'lead.imageIds']: ['image-a', 'image-b'] });
    const firstUrls = deferred<any>();
    const lastUrls = deferred<any>();
    let requests = 0;
    env.setQuery(async action => { assert.equal(action, 'assets.urls'); return ++requests === 1 ? firstUrls.promise : lastUrls.promise; });
    const first = env.page.previewImage({ currentTarget: { dataset: { id: 'image-a', scope: 'entrance', index: 0 } } });
    const last = env.page.previewImage({ currentTarget: { dataset: { id: 'image-b', scope: 'entrance', index: 1 } } });
    await env.page.previewImage({ currentTarget: { dataset: { id: 'invalid-image', scope: 'entrance', index: 99 } } });
    assert.equal(requests, 2);
    lastUrls.resolve([{ id: 'image-a', url: 'latest-a-url' }, { id: 'image-b', url: 'latest-b-url' }]);
    await last;
    firstUrls.resolve([{ id: 'image-a', url: 'obsolete-a-url' }, { id: 'image-b', url: 'obsolete-b-url' }]);
    await first;
    assert.deepEqual(env.nativePreviews, [{ urls: ['latest-a-url', 'latest-b-url'], current: 'latest-b-url' }]);
  });
}

for (const transition of ['switch-section', 'switch-and-return', 'error-summary-navigation']) {
  test(`full submission invalidates delayed preview context after ${transition}`, async () => {
    const env = await imagePreviewPage('submission-edit');
    const urls = deferred<any>();
    env.setQuery(async action => { assert.equal(action, 'assets.urls'); return urls.promise; });
    const preview = env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'entrance' } } });
    await tick();
    if (transition === 'error-summary-navigation') env.page.goToError(fieldEvent('conditions'));
    else env.page.toggleSection({ currentTarget: { dataset: { section: 'rules' } } });
    if (transition === 'switch-and-return') env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
    urls.resolve([{ id: 'current-image', url: 'delayed-url' }]);
    await preview;
    assert.equal(env.nativePreviews.length, 0);
  });
}

test('full submission allows an unchanged open image section to complete its pending preview', async () => {
  const env = await imagePreviewPage('submission-edit');
  const urls = deferred<any>();
  env.setQuery(async action => { assert.equal(action, 'assets.urls'); return urls.promise; });
  const preview = env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'entrance' } } });
  await tick();
  env.page.toggleSection({ currentTarget: { dataset: { section: 'entrance' } } });
  urls.resolve([{ id: 'current-image', url: 'valid-open-section-url' }]);
  await preview;
  assert.deepEqual(env.nativePreviews, [{ urls: ['valid-open-section-url'], current: 'valid-open-section-url' }]);
});

test('switching from entrance to source invalidates the old gallery even when both reference the same image', async () => {
  const env = await imagePreviewPage('submission-edit');
  env.page.setData({ sourceImageIds: ['current-image'] });
  const oldUrls = deferred<any>();
  let requests = 0;
  env.setQuery(async action => { assert.equal(action, 'assets.urls'); return ++requests === 1 ? oldUrls.promise : [{ id: 'current-image', url: 'current-source-url' }]; });
  const oldPreview = env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'entrance' } } });
  await tick();
  env.page.toggleSection({ currentTarget: { dataset: { section: 'source' } } });
  await env.page.previewImage({ currentTarget: { dataset: { id: 'current-image', scope: 'source' } } });
  oldUrls.resolve([{ id: 'current-image', url: 'obsolete-entrance-url' }]);
  await oldPreview;
  assert.deepEqual(env.nativePreviews, [{ urls: ['current-source-url'], current: 'current-source-url' }]);
});

function fillNewSubmission(env: ReturnType<typeof harness>, route: string) {
  if (route === 'submission-lead') env.page.setData({ lead: { title: 'Identical new bank offer', bankId: 'cmb', sourceUrl: '', sourceNote: '银行 App 活动规则', imageIds: [] } });
  else env.page.setData({ draft: draft(), targetText: '1', rewardText: '20.00' });
  env.page.markDirty();
}

for (const route of ['submission-lead', 'submission-edit']) {
  const draftScope = route === 'submission-lead' ? 'submission-lead' : 'submission';
  test(`${route} sends one persistent creation intent for retries and a different intent for a fresh identical form`, async () => {
    let attempts = 0;
    const env = harness(route, { command: async () => { if (++attempts === 1) throw new Error('网络暂时不可用，请重试。'); return { id: 'created-submission' }; } });
    await env.page.load();
    fillNewSubmission(env, route);
    const savedIntent = env.formDrafts.loadDraft(draftScope, 'user-1', 'new').value.intentKey;
    assert.ok(typeof savedIntent === 'string' && savedIntent.length > 0 && savedIntent.length <= 128);
    await env.page.save();
    assert.equal(env.page.data.submitted, false);
    await env.page.save();
    assert.equal(env.commands.length, 2);
    assert.equal(env.commands[0].options?.intentKey, savedIntent);
    assert.equal(env.commands[1].options?.intentKey, savedIntent);
    assert.equal(env.commands[0].payload.id, undefined);
    assert.equal(env.formDrafts.loadDraft(draftScope, 'user-1', 'new'), null);
    const fresh = harness(route, { storage: env.storage });
    await fresh.page.load();
    fillNewSubmission(fresh, route);
    await fresh.page.save();
    assert.notEqual(fresh.commands[0].options?.intentKey, savedIntent);
    assert.equal(JSON.stringify(fresh.commands[0].payload), JSON.stringify(env.commands[0].payload));
  });

  for (const recover of [true, false]) {
    test(`${route} ${recover ? 'reuses' : 'replaces'} a saved creation intent only after ${recover ? 'confirming' : 'rejecting'} recovery`, async () => {
      const original = harness(route);
      await original.page.load();
      fillNewSubmission(original, route);
      const originalIntent = original.formDrafts.loadDraft(draftScope, 'user-1', 'new').value.intentKey;
      const reopened = harness(route, { storage: original.storage, confirmRecovery: recover });
      await reopened.page.load();
      if (recover) assert.equal(reopened.page.creationIntentKey, originalIntent);
      else assert.notEqual(reopened.page.creationIntentKey, originalIntent);
      fillNewSubmission(reopened, route);
      await reopened.page.save();
      assert.equal(reopened.commands[0].options?.intentKey, reopened.page.creationIntentKey);
      assert.equal(reopened.commands[0].options?.intentKey === originalIntent, recover);
    });
  }

  test(`${route} assigns a fresh intent to a recovered legacy draft without an intent key`, async () => {
    const env = harness(route);
    const value = route === 'submission-lead'
      ? { lead: { title: 'Legacy offer', bankId: 'cmb', sourceUrl: '', sourceNote: '银行 App 活动规则', imageIds: [] } }
      : { draft: draft(), targetText: '1', rewardText: '20.00', reviewNote: '', openSection: 'basic', draftEdited: true };
    env.formDrafts.saveDraft(draftScope, 'user-1', 'new', null, value);
    await env.page.load();
    const key = env.page.creationIntentKey;
    assert.ok(typeof key === 'string' && key.length > 0 && key.length <= 128);
    await env.page.save();
    assert.equal(env.commands[0].options?.intentKey, key);
  });
}

test('importing a lead into a full submission creates an independent intent and preserves the source draft intent', async () => {
  const lead = harness('submission-lead');
  await lead.page.load();
  fillNewSubmission(lead, 'submission-lead');
  const originalSource = JSON.stringify(lead.formDrafts.loadDraft('submission-lead', 'user-1', 'new'));
  const leadIntent = lead.page.creationIntentKey;
  const full = harness('submission-edit', { storage: lead.storage });
  full.page.setData({ fromLead: true });
  await full.page.load();
  assert.equal(full.page.data.importedLead, true);
  assert.notEqual(full.page.creationIntentKey, leadIntent);
  fillNewSubmission(full, 'submission-edit');
  assert.equal(full.formDrafts.loadDraft('submission', 'user-1', 'new').value.intentKey, full.page.creationIntentKey);
  await full.page.save();
  assert.equal(full.commands[0].options?.intentKey, full.page.creationIntentKey);
  assert.notEqual(full.commands[0].options?.intentKey, leadIntent);
  assert.equal(JSON.stringify(full.formDrafts.loadDraft('submission-lead', 'user-1', 'new')), originalSource);
});

test('existing lead edits retain resource command semantics without a creation intent option', async () => {
  const lead = { title: 'Existing lead', bankId: 'cmb', sourceUrl: '', sourceNote: '银行 App 活动规则', imageIds: [] };
  const env = harness('submission-lead', { query: async action => action === 'submission.get' ? { ...submission(), draft: undefined, lead } : [] });
  env.page.setData({ submissionId: 'submission-1' });
  await env.page.load();
  env.page.input(fieldEvent('title', 'Updated existing lead'));
  await env.page.save();
  assert.equal(env.commands[0].payload.id, 'submission-1');
  assert.equal(env.commands[0].options, undefined);
});

for (const reviewMode of [false, true]) {
  test(`${reviewMode ? 'moderation' : 'existing full edits'} retain default resource idempotency semantics`, async () => {
    const env = harness('submission-edit');
    env.page.setData({ submissionId: 'submission-1', reviewMode });
    await env.page.load();
    env.page.setData({ sourceVerified: true });
    await env.page.save();
    assert.equal(env.commands[0].payload.id, 'submission-1');
    assert.equal(env.commands[0].options, undefined);
  });
}

function expiringSubmissionDraft(): ActivityDraft {
  return { ...draft(), endsOn: '2026-09-22', sourceUrl: 'https://www.cmbchina.com/terms' };
}

for (const committed of [true, false]) {
  test(`an exact restored submission retry after expiry ${committed ? 'replays the committed result' : 'cannot create an expired record that never committed'}`, async () => {
    let today = '2026-09-22';
    let firstAttempt = true;
    const store = new MemoryStore();
    const service = createService(store, { now: () => new Date(`${today}T04:00:00.000Z`) });
    const actor = { userId: 'user-1', isModerator: false };
    const requests: ApiRequest[] = [];
    const transport = async (request: ApiRequest) => {
      requests.push(structuredClone(request));
      if (firstAttempt) {
        firstAttempt = false;
        if (committed) await service.execute(actor, request);
        throw Object.assign(new Error('模拟提交结果丢失'), { code: 'NETWORK_ERROR' });
      }
      return service.execute(actor, request);
    };
    const session = async () => ({ userId: 'user-1', isModerator: false, today, month: today.slice(0, 7) });
    const first = harness('submission-edit', { commandTransport: transport, session });
    await first.page.load();
    first.page.setData({ draft: expiringSubmissionDraft(), targetText: '1', rewardText: '20.00' });
    first.page.markDirty();
    await first.page.save();
    const saved = first.formDrafts.loadDraft('submission', 'user-1', 'new');
    assert.equal(saved.value.pendingCreation.pending, true);
    assert.equal(saved.value.pendingCreation.intentKey, first.page.creationIntentKey);
    assert.equal(saved.value.pendingCreation.draft.endsOn, '2026-09-22');
    assert.equal((await store.find('submissions')).length, committed ? 1 : 0);
    first.page.onUnload();
    today = '2026-09-23';
    const restored = harness('submission-edit', { storage: first.storage, commandTransport: transport, session });
    await restored.page.load();
    assert.equal(restored.page.data.pendingCreationUnconfirmed, true);
    await restored.page.save();
    assert.equal(requests.length, 2);
    assert.equal((requests[0] as { requestId: string }).requestId, (requests[1] as { requestId: string }).requestId);
    assert.equal(JSON.stringify(requests[0].payload), JSON.stringify(requests[1].payload));
    assert.equal((await store.find('submissions')).length, committed ? 1 : 0);
    if (committed) {
      assert.equal(restored.page.data.submitted, true);
      assert.equal(restored.storage.size, 0);
    } else {
      assert.equal(restored.page.data.submitted, false);
      assert.match(restored.page.data.errors.endsOn, /活动已经结束/);
      assert.equal(restored.page.pendingCreation, null);
      assert.equal(restored.formDrafts.loadDraft('submission', 'user-1', 'new').value.pendingCreation, undefined);
      await restored.page.save();
      assert.equal(requests.length, 2, 'A definitive rejection must not retain the client date exception.');
    }
  });
}

for (const change of ['payload', 'intent']) {
  test(`an expired pending creation retries its original command after changing the editor ${change}`, async () => {
    let today = '2026-09-22';
    let firstAttempt = true;
    const store = new MemoryStore();
    const service = createService(store, { now: () => new Date(`${today}T04:00:00.000Z`) });
    const actor = { userId: 'user-1', isModerator: false };
    const requests: ApiRequest[] = [];
    const transport = async (request: ApiRequest) => {
      requests.push(structuredClone(request));
      if (firstAttempt) {
        firstAttempt = false;
        throw Object.assign(new Error('Original command result unavailable'), { code: 'NETWORK_ERROR' });
      }
      return service.execute(actor, request);
    };
    const session = async () => ({ userId: 'user-1', isModerator: false, today, month: today.slice(0, 7) });
    const first = harness('submission-edit', { commandTransport: transport, session });
    await first.page.load();
    first.page.setData({ draft: expiringSubmissionDraft(), targetText: '1', rewardText: '20' });
    first.page.markDirty();
    await first.page.save();
    today = '2026-09-23';
    const restored = harness('submission-edit', { storage: first.storage, commandTransport: transport, session, confirmRecovery: false });
    await restored.page.load();
    assert.equal(restored.page.data.pendingCreationUnconfirmed, true);
    if (change === 'payload') restored.page.setData({ 'draft.title': 'A different creation payload' });
    else restored.page.creationIntentKey = 'different-creation-intent';
    await restored.page.save();
    assert.equal(restored.commands.length, 1);
    assert.equal(requests.length, 2);
    assert.equal((requests[0] as { requestId: string }).requestId, (requests[1] as { requestId: string }).requestId);
    assert.equal(JSON.stringify(requests[0].payload), JSON.stringify(requests[1].payload));
    assert.equal((await store.find('submissions')).length, 0, 'An uncommitted expired command must still be rejected by the server.');
    assert.equal(restored.page.data.submitted, false);
    assert.match(restored.page.data.errors.endsOn, /活动已经结束/);
    assert.equal(restored.page.pendingCreation, null);
    assert.equal(restored.page.data.pendingCreationUnconfirmed, false);
    assert.equal(restored.formDrafts.loadDraft('submission', 'user-1', 'new').value.pendingCreation, undefined);
    await restored.page.save();
    assert.equal(requests.length, 2, 'A definitive rejection must not retain the client date exception.');
    restored.page.selectDate(fieldEvent('endsOn', '2026-12-31'));
    await restored.page.save();
    assert.equal(restored.commands.length, 2);
    assert.equal(requests.length, 3);
    assert.notEqual((requests[2] as { requestId: string }).requestId, (requests[0] as { requestId: string }).requestId);
    assert.equal((await store.find('submissions')).length, 1);
    assert.equal(restored.page.data.submitted, true);
  });
}

for (const code of ['UNAUTHENTICATED', 'CONFIGURATION_REQUIRED']) {
  test(`a cross-day retry preserves committed creation proof through a temporary ${code} failure`, async () => {
    let today = '2026-09-22';
    let attempts = 0;
    const store = new MemoryStore();
    const service = createService(store, { now: () => new Date(`${today}T04:00:00.000Z`) });
    const actor = { userId: 'user-1', isModerator: false };
    const requestIds: string[] = [];
    const transport = async (request: ApiRequest) => {
      requestIds.push((request as { requestId: string }).requestId);
      attempts++;
      if (attempts === 2) throw Object.assign(new Error('临时前置校验失败'), { code });
      const result = await service.execute(actor, request);
      if (attempts === 1) throw Object.assign(new Error('已提交但响应丢失'), { code: 'NETWORK_ERROR' });
      return result;
    };
    const session = async () => ({ userId: 'user-1', isModerator: false, today, month: today.slice(0, 7) });
    const first = harness('submission-edit', { commandTransport: transport, session });
    await first.page.load();
    first.page.setData({ draft: expiringSubmissionDraft(), targetText: '1', rewardText: '20' });
    first.page.markDirty();
    await first.page.save();
    today = '2026-09-23';
    const restored = harness('submission-edit', { storage: first.storage, commandTransport: transport, session });
    await restored.page.load();
    await restored.page.save();
    assert.equal(restored.page.data.pendingCreationUnconfirmed, true);
    assert.equal(restored.formDrafts.loadDraft('submission', 'user-1', 'new').value.pendingCreation.pending, true);
    await restored.page.save();
    assert.equal(restored.page.data.submitted, true);
    assert.equal(attempts, 3);
    assert.equal(new Set(requestIds).size, 1);
    assert.equal((await store.find('submissions')).length, 1);
  });
}

test('a saved creation intent without a validated pending attempt does not bypass expiry validation', async () => {
  const first = harness('submission-edit');
  await first.page.load();
  first.page.setData({ draft: expiringSubmissionDraft(), targetText: '1', rewardText: '20' });
  first.page.markDirty();
  assert.ok(first.formDrafts.loadDraft('submission', 'user-1', 'new').value.intentKey);
  assert.equal(first.formDrafts.loadDraft('submission', 'user-1', 'new').value.pendingCreation, undefined);
  const restored = harness('submission-edit', { storage: first.storage, session: async () => ({ userId: 'user-1', isModerator: false, today: '2026-09-23' }) });
  await restored.page.load();
  await restored.page.save();
  assert.equal(restored.commands.length, 0);
  assert.match(restored.page.data.errors.endsOn, /已结束/);
});

test('new submission dispatch waits until its validated pending payload is stored durably', async () => {
  let unavailable = false;
  class DraftStorage extends Map<string, unknown> { override set(key: string, value: unknown) { if (unavailable) throw new Error('Storage unavailable'); return super.set(key, value); } }
  const env = harness('submission-edit', { storage: new DraftStorage() });
  await env.page.load();
  fillNewSubmission(env, 'submission-edit');
  unavailable = true;
  await env.page.save();
  assert.equal(env.commands.length, 0);
  assert.equal(env.page.pendingCreation, null);
  assert.equal(env.page.data.pendingCreationUnconfirmed, false);
  assert.match(env.page.data.error, /恢复信息未能保存在本机/);
});

test('a definitive late creation rejection cannot overwrite a newer editor draft while clearing pending proof', async () => {
  const response = deferred<any>();
  const first = harness('submission-edit', { command: async () => response.promise });
  await first.page.load();
  fillNewSubmission(first, 'submission-edit');
  const saving = first.page.save();
  assert.equal(first.commands.length, 1);
  first.page.onUnload();
  const newer = harness('submission-edit', { storage: first.storage });
  await newer.page.load();
  newer.page.input(fieldEvent('title', 'Newer local draft must survive'));
  assert.equal(newer.page.data.pendingCreationUnconfirmed, true);
  assert.equal(newer.page.data.draft.title, draft().title, 'Pending creation content must remain locked.');
  const saved = newer.formDrafts.loadDraft('submission', 'user-1', 'new');
  assert.equal(newer.formDrafts.saveDraft('submission', 'user-1', 'new', saved.baseVersion, {
    ...saved.value, draft: { ...saved.value.draft, title: 'Newer local draft must survive' },
  }), true);
  assert.notEqual(newer.formDrafts.loadDraft('submission', 'user-1', 'new').revision, saved.revision);
  const latest = JSON.stringify(Array.from(newer.storage.entries()));
  response.reject(Object.assign(new Error('Invalid source'), { code: 'INVALID_INPUT', field: 'sourceUrl' }));
  await saving;
  assert.equal(JSON.stringify(Array.from(newer.storage.entries())), latest);
  assert.equal(newer.page.data.draft.title, draft().title);
  assert.equal(newer.formDrafts.loadDraft('submission', 'user-1', 'new').value.draft.title, 'Newer local draft must survive');
});

test('a definitive rejection can clear only its captured pending proof after the editor is unloaded', async () => {
  const response = deferred<any>();
  const env = harness('submission-edit', { command: async () => response.promise });
  await env.page.load();
  fillNewSubmission(env, 'submission-edit');
  const saving = env.page.save();
  const original = env.formDrafts.loadDraft('submission', 'user-1', 'new');
  env.page.onUnload();
  response.reject(Object.assign(new Error('Invalid source'), { code: 'INVALID_INPUT', field: 'sourceUrl' }));
  await saving;
  const saved = env.formDrafts.loadDraft('submission', 'user-1', 'new');
  assert.equal(saved.value.pendingCreation, undefined);
  assert.equal(saved.value.intentKey, original.value.intentKey);
  assert.equal(JSON.stringify(saved.value.draft), JSON.stringify(original.value.draft));
  assert.equal(env.navigationCalls.length, 0);
});

test('server expiry protection applies only to new submissions while existing edits and request replays retain their semantics', async () => {
  let today = '2026-09-22';
  const store = new MemoryStore();
  const service = createService(store, { now: () => new Date(`${today}T04:00:00.000Z`) });
  const actor = { userId: 'user-1', isModerator: false };
  const request = { action: 'submission.save' as const, requestId: 'original-submission', payload: { draft: expiringSubmissionDraft() } };
  const original = await service.execute(actor, request) as { id: string; version: number };
  today = '2026-09-23';
  assert.deepEqual(await service.execute(actor, request), original);
  const edited = await service.execute(actor, { action: 'submission.save', requestId: 'edit-existing-submission', payload: { id: original.id, expectedVersion: original.version, draft: { ...expiringSubmissionDraft(), title: 'Edited existing submission' } } }) as { id: string; version: number };
  assert.equal(edited.id, original.id);
  assert.equal(edited.version, original.version + 1);
  await assert.rejects(service.execute(actor, { ...request, requestId: 'new-expired-submission' }), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'INVALID_INPUT');
  assert.equal((await store.find('submissions')).length, 1);
});

for (const [label, rejection, expected] of [
  ['native privacy decline', { errMsg: 'chooseMedia:fail privacy permission is not authorized' }, '尚未同意隐私指引，本次未添加图片。可继续填写，或再次添加图片时阅读并选择是否同意。'],
  ['native failure', { errMsg: 'chooseMedia:fail permission denied' }, '无法访问照片，请在微信设置中允许相册权限后重试。'],
  ['native authorization failure', { errMsg: 'chooseMedia:fail auth deny' }, '无法访问照片，请在微信设置中允许相册权限后重试。'],
  ['error failure', new Error('Image upload unavailable'), '图片未能添加，请检查照片权限和网络后重试。'],
  ['network failure', { errMsg: 'uploadFile:fail network timeout' }, '图片上传失败，请检查网络后重试。'],
  ['unstructured failure', { errno: 101 }, '图片未能添加，请检查照片权限和网络后重试。'],
  ['domain validation failure', new Error('请选择 JPG、PNG 或 WebP 图片。'), '请选择 JPG、PNG 或 WebP 图片。'],
] as const) {
  test(`full submission ${label} remains visible and preserves existing images`, async () => {
    const env = harness('submission-edit', { upload: async () => { throw rejection; } });
    await env.page.load();
    env.page.setData({ 'draft.entrance.imageIds': ['existing-image'], assets: [{ id: 'existing-image' }] });
    env.page.markDirty();
    const savedDraft = JSON.stringify(Array.from(env.storage.entries()));
    await env.page.addImage();
    assert.equal(env.page.data.errors.imageIds, expected);
    assert.equal(env.page.data.errorSummary.find((issue: { field: string }) => issue.field === 'imageIds')?.message, expected);
    assert.deepEqual(Array.from(env.page.data.draft.entrance.imageIds), ['existing-image']);
    assert.equal(JSON.stringify(Array.from(env.storage.entries())), savedDraft);
    assert.equal(env.page.data.uploading, false);
  });
  test(`activity lead ${label} uses actionable Chinese feedback without changing its images or draft`, async () => {
    const env = harness('submission-lead', { upload: async () => { throw rejection; } });
    await env.page.load();
    env.page.setData({ 'lead.imageIds': ['existing-image'], assets: [{ id: 'existing-image' }] });
    env.page.markDirty();
    const savedDraft = JSON.stringify(Array.from(env.storage.entries()));
    await env.page.addImage();
    assert.equal(env.page.data.imageError, expected);
    assert.deepEqual(Array.from(env.page.data.lead.imageIds), ['existing-image']);
    assert.equal(JSON.stringify(Array.from(env.storage.entries())), savedDraft);
    assert.equal(env.page.data.uploading, false);
  });
}

for (const route of ['submission-edit', 'submission-lead']) {
  test(`${route} keeps editing available after privacy refusal without directing the user to album settings`, async () => {
    const env = harness(route, { upload: async () => { throw { errMsg: 'chooseMedia:fail privacy permission is not authorized' }; } });
    await env.page.load();
    fillNewSubmission(env, route);
    const imagePath = route === 'submission-edit' ? 'draft.entrance.imageIds' : 'lead.imageIds';
    env.page.setData({ [imagePath]: ['existing-image'], assets: [{ id: 'existing-image' }] });
    env.page.markDirty();
    const before = JSON.stringify(Array.from(env.storage.entries()));
    await env.page.addImage();
    const feedback = route === 'submission-edit' ? env.page.data.errors.imageIds : env.page.data.imageError;
    assert.match(feedback, /隐私指引/);
    assert.match(feedback, /可继续填写/);
    assert.match(feedback, /选择是否同意/);
    assert.doesNotMatch(feedback, /微信设置|相册权限|必须同意/);
    assert.equal(JSON.stringify(Array.from(env.storage.entries())), before);
    assert.equal(env.page.data.uploading, false);
    env.page.input(fieldEvent('title', '拒绝隐私授权后继续填写'));
    const content = route === 'submission-edit' ? env.page.data.draft : env.page.data.lead;
    assert.equal(content.title, '拒绝隐私授权后继续填写');
    assert.deepEqual(Array.from(route === 'submission-edit' ? content.entrance.imageIds : content.imageIds), ['existing-image']);
  });
}

for (const [label, rejection] of [
  ['native object', { errMsg: 'chooseMedia:fail cancel' }],
  ['error instance', new Error('chooseMedia:fail cancel')],
  ['string', 'chooseMedia:fail cancel'],
  ['native object with generic message', { message: 'Operation failed', errMsg: 'chooseMedia:fail cancel' }],
] as const) {
  test(`activity lead cancellation as ${label} keeps prior image feedback and its saved draft`, async () => {
    const env = harness('submission-lead', { upload: async () => { throw rejection; } });
    await env.page.load();
    env.page.setData({ 'lead.imageIds': ['existing-image'], assets: [{ id: 'existing-image' }], assetUrls: [{ id: 'existing-image', url: 'saved-image-url' }] });
    env.page.markDirty();
    env.page.setData({ error: '已有表单提示', imageError: '已有图片提示', errors: { title: '已有标题提示' } });
    const before = JSON.stringify(env.page.data);
    const savedDraft = JSON.stringify(Array.from(env.storage.entries()));
    await env.page.addImage();
    assert.equal(JSON.stringify(env.page.data), before);
    assert.equal(JSON.stringify(Array.from(env.storage.entries())), savedDraft);
  });
}

test('review ignores the second refresh page after the status filter changes', async () => {
  const pendingItems = Array.from({ length: 80 }, (_, index) => submission(`pending-${index}`));
  const publishedItems = Array.from({ length: 25 }, (_, index) => ({ ...submission(`published-${index}`), status: 'published' as const }));
  const env = harness('review', { query: async (_action, payload) => submissionPage(pendingItems, payload) });
  await env.page.load();
  await env.page.loadMore();
  await env.page.loadMore();
  const delayedPage = deferred<any>();
  env.setQuery(async (_action, payload) => payload.status === 'published' ? submissionPage(publishedItems, payload) : payload.cursor === '50' ? delayedPage.promise : submissionPage(pendingItems, payload));
  const refresh = env.page.load();
  await tick();
  assert.equal(env.page.data.items.length, 60);
  env.page.changeStatus({ currentTarget: { dataset: { status: 'published' } } });
  await tick();
  assert.equal(env.page.data.items.length, 20);
  assert.equal(env.page.data.items[0].id, 'published-0');
  delayedPage.resolve(submissionPage(pendingItems, { cursor: '50', limit: 10 }));
  await refresh;
  assert.equal(env.page.data.items.length, 20);
  assert.equal(env.page.data.items[0].id, 'published-0');
  assert.equal(env.page.data.nextCursor, '20');
  assert.equal(env.page.data.status, 'published');
});

test('returning to review rechecks moderator authority before retaining any actionable result', async () => {
  let moderator = true;
  let listCalls = 0;
  const env = harness('review', { session: async () => ({ userId: 'user-1', isModerator: moderator }), query: async () => { listCalls++; return { items: [submission()], nextCursor: null }; } });
  await env.page.load();
  moderator = false;
  env.page.onShow();
  await tick();
  assert.equal(env.sessionRequests.at(-1), true);
  assert.equal(listCalls, 1);
  assert.equal(env.page.data.denied, true);
  assert.equal(env.page.data.items.length, 0);
  env.page.open({ currentTarget: { dataset: { id: 'submission-1' } } });
  assert.equal(env.navigations.length, 0);
});

test('a failed authority check does not allow cached review records to be opened', async () => {
  let failSession = false;
  const env = harness('review', { session: async () => { if (failSession) throw new Error('Session unavailable'); return { userId: 'user-1', isModerator: true }; }, query: async () => ({ items: [submission()], nextCursor: null }) });
  await env.page.load();
  failSession = true;
  await env.page.load();
  assert.equal(env.page.data.items.length, 1);
  assert.equal(env.page.data.sessionVerified, false);
  env.page.open({ currentTarget: { dataset: { id: 'submission-1' } } });
  assert.equal(env.navigations.length, 0);
});

for (const route of ['submissions', 'review']) {
  test(`${route} masks retained private rows throughout a pending or failed session check and restores them only after confirmation`, async () => {
    const items = Array.from({ length: 45 }, (_, index) => submission(`private-${index}`));
    let nextSession: Promise<any> | undefined;
    const session = { userId: 'user-1', isModerator: true };
    const env = harness(route, { session: async () => nextSession || session, query: async (_action, payload) => submissionPage(items, payload) });
    await env.page.load();
    await env.page.loadMore();
    const before = Array.from(env.page.data.items, (item: Submission) => item.id);
    const pending = deferred<any>();
    nextSession = pending.promise;
    const refresh = env.page.load();
    assert.equal(env.page.data.sessionVerified, false);
    assert.deepEqual(Array.from(env.page.data.items, (item: Submission) => item.id), before);
    assert.equal(env.page.data.nextCursor, '40');
    env.page.open({ currentTarget: { dataset: { id: 'private-25' } } });
    assert.equal(env.navigations.length, 0);
    pending.reject(new Error('Session unavailable'));
    await refresh;
    assert.equal(env.page.data.sessionVerified, false);
    assert.deepEqual(Array.from(env.page.data.items, (item: Submission) => item.id), before);
    nextSession = undefined;
    await env.page.load();
    assert.equal(env.page.data.sessionVerified, true);
    assert.deepEqual(Array.from(env.page.data.items, (item: Submission) => item.id), before);
    env.page.open({ currentTarget: { dataset: { id: 'private-25' } } });
    assert.ok(env.navigations.at(-1)?.includes('private-25'));
  });

  test(`${route} privacy masking hides the preserved list visually and from accessibility without removing its layout`, () => {
    const markup = readFileSync(`miniprogram/pages/${route}/index.wxml`, 'utf8');
    const styles = readFileSync(`miniprogram/pages/${route}/index.wxss`, 'utf8');
    const listClass = route === 'review' ? 'review-list' : 'submission-list';
    assert.ok(markup.includes(`class="${listClass} {{!sessionVerified ? 'is-session-pending' : ''}}" aria-hidden="{{!sessionVerified}}"`));
    assert.match(styles, new RegExp(`\\.${listClass}\\.is-session-pending\\s*\\{\\s*visibility\\s*:\\s*hidden\\s*;?\\s*\\}`));
    assert.ok(markup.includes('重新核实'));
    assert.ok(markup.includes('核实通过后显示投稿'));
  });
}

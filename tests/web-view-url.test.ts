import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type { Activity, Detail, Entrance } from '../shared/contracts';

type Controller = { data: Record<string, any>; [key: string]: any };
type ModuleExports = Record<string, any>;
const compiled = new Map<string, string>();

function compiledSource(file: string): string {
  const existing = compiled.get(file);
  if (existing !== undefined) return existing;
  const source = ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  compiled.set(file, source);
  return source;
}

function webEntrance(url: string): Entrance {
  return { kind: 'web', url, label: 'Bank offer', instructions: 'Read the bank offer', imageIds: [] };
}

function harness(options: { enabled?: boolean; hosts?: string[] } = {}) {
  const configuration = Object.freeze({
    mode: 'cloud', cloudEnvId: 'isolated-url-test', webViewEnabled: options.enabled ?? true,
    allowedWebViewHosts: Object.freeze([...(options.hosts ?? ['cc.cmbchina.com'])]),
    templateIds: Object.freeze({ new_activity: '', deadline: '', reward: '', repayment: '' }),
  });
  const navigations: string[] = [];
  const clipboard: string[] = [];
  const loadingEvents: string[] = [];
  const returns: { route: string; tab: boolean }[] = [];
  const wx = {
    navigateTo: async ({ url }: { url: string }) => { navigations.push(url); },
    setClipboardData: ({ data, success }: { data: string; success?: () => void }) => { clipboard.push(data); success?.(); },
    showModal: async () => ({ confirm: true }),
    showToast() {}, setNavigationBarTitle() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    nextTick: (callback: () => void) => callback(), pageScrollTo() {},
    showNavigationBarLoading: () => { loadingEvents.push('show'); },
    hideNavigationBarLoading: () => { loadingEvents.push('hide'); },
    cloud: { init() {}, callFunction() { assert.fail('URL tests must not invoke cloud functions.'); } },
    navigateToMiniProgram() { assert.fail('Web entries must not navigate to another Mini Program.'); },
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}) {
    const exports: ModuleExports = {};
    let page: Controller | undefined;
    const context = vm.createContext({
      exports, wx,
      getCurrentPages: () => page ? [page] : [],
      require(name: string) {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name} in ${file}`);
        return imports[name];
      },
      Page(definition: Controller) {
        const instance: Controller = { ...definition, data: structuredClone(definition.data) };
        instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
          for (const [key, value] of Object.entries(patch)) {
            const segments = key.split('.');
            let target = instance.data;
            for (const segment of segments.slice(0, -1)) target = target[segment] ||= {};
            target[segments[segments.length - 1]] = value;
          }
          callback?.();
        };
        page = instance;
      },
    });
    assert.equal(vm.runInContext('typeof URL', context), 'undefined');
    assert.equal(vm.runInContext('typeof URLSearchParams', context), 'undefined');
    vm.runInContext(compiledSource(file), context, { filename: file });
    return { exports, page };
  }

  const errors = evaluate('domain/errors.ts').exports;
  const calendar = evaluate('domain/calendar.ts', { './errors': errors }).exports;
  const catalog = evaluate('shared/catalog.ts').exports;
  const validation = evaluate('domain/validation.ts', {
    './calendar': calendar, './errors': errors, '../shared/catalog': catalog,
  }).exports;
  const entrance = evaluate('miniprogram/services/entrance.ts', {
    '../../domain/validation': validation, '../runtime-config': { default: configuration },
  }).exports;
  const client = evaluate('miniprogram/services/api.ts', {
    '../runtime-config': { default: configuration }, './entrance': entrance,
    './demo': { demoService() { assert.fail('URL tests must not start the demo service.'); } },
  }).exports;
  const navigation = {
    navigateBackOr(route: string, tab: boolean) { returns.push({ route, tab }); },
  };

  function openPageOptions(options: Record<string, string | undefined>): Controller {
    const { page } = evaluate('miniprogram/pages/web-entry/index.ts', {
      '../../runtime-config': { default: configuration }, '../../services/navigation': navigation,
      '../../services/entrance': entrance, '../../../domain/validation': validation,
    });
    assert.ok(page);
    page.onLoad(options);
    return page;
  }

  function openPage(url: string): Controller {
    return openPageOptions({ url: encodeURIComponent(url) });
  }

  function followNavigation(index: number): Controller {
    const prefix = '/pages/web-entry/index?url=';
    const route = navigations[index];
    assert.ok(route?.startsWith(prefix), 'The API must dispatch to the internal web-entry page.');
    return openPageOptions({ url: route.slice(prefix.length) });
  }

  async function loadDetail(url: string): Promise<Controller> {
    const activity: Activity = {
      id: 'web-url-offer', revision: 1, status: 'published', title: 'Bank offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
      cardKind: 'credit', cardDescription: 'Eligible card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31',
      target: 1, unit: 'count', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
      requiresRegistration: false, requiresInvitation: false, conditions: 'Complete one purchase', sourceUrl: url, sourceNote: 'Bank source',
      entrance: webEntrance(url), publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
    };
    const detail: Detail = { activity, participation: null, tracking: null, eligible: true, assets: [], audit: [], history: [] };
    const benefit = evaluate('miniprogram/services/benefit-copy.ts').exports;
    const format = evaluate('miniprogram/services/format.ts', { '../../domain/calendar': calendar, './benefit-copy': benefit }).exports;
    const cardLabels = evaluate('miniprogram/services/card-labels.ts', { '../../shared/catalog': catalog }).exports;
    const { page } = evaluate('miniprogram/pages/detail/index.ts', {
      '../../../shared/catalog': catalog,
      '../../services/api': {
        ...client, ensureSession: async () => ({ userId: 'url-owner', today: '2026-09-23', month: '2026-09' }),
        api: { query: async (action: string) => { assert.equal(action, 'activity.get'); return structuredClone(detail); } },
      },
      '../../services/format': format, '../../services/card-labels': cardLabels,
      '../../services/benefit-copy': benefit, '../../services/navigation': navigation, '../../services/entrance': entrance,
    });
    assert.ok(page);
    page.onLoad({ id: activity.id });
    await page.load();
    assert.equal(page.data.loading, false);
    assert.equal(page.data.error, '');
    assert.ok(page.data.view);
    return page;
  }

  return { configuration, validation, entrance, client, navigations, clipboard, loadingEvents, returns, openPage, openPageOptions, followNavigation, loadDetail };
}

for (const port of ['', ':443', ':0443', ':00443']) {
  test(`the real detail labels, API dispatch, and web page agree for HTTPS ${port || 'without an explicit port'}`, async () => {
    const input = `https://cc.cmbchina.com${port}/promotion`;
    const expected = 'https://cc.cmbchina.com/promotion';
    const env = harness();
    assert.equal(env.validation.validatePublicHttps(input), input);
    assert.equal(env.entrance.resolveWebViewUrl(input), expected);
    assert.equal(env.entrance.entranceBehavior(webEntrance(input)), 'webview');
    const detail = await env.loadDetail(input);
    assert.equal(detail.data.view.entryAction, '打开网页');
    assert.equal(detail.data.view.sourceAction, '打开银行规则');

    await detail.entrance();
    await detail.source();

    const route = `/pages/web-entry/index?url=${encodeURIComponent(input)}`;
    assert.deepEqual(env.navigations, [route, route]);
    assert.deepEqual(env.clipboard, []);
    for (const index of [0, 1]) {
      const page = env.followNavigation(index);
      assert.equal(page.data.sourceUrl, expected);
      assert.equal(page.data.url, expected);
      assert.equal(page.data.canRetry, true);
      assert.equal(page.data.loading, true);
      assert.equal(page.data.error, '');
      const shows = env.loadingEvents.filter(event => event === 'show').length;
      page.retry();
      assert.equal(env.loadingEvents.filter(event => event === 'show').length, shows, 'A loading page must not start a second retry.');
      page.loaded();
      assert.equal(page.data.loading, false);
      page.failed();
      assert.equal(page.data.url, '');
      assert.equal(page.data.sourceUrl, expected);
      assert.equal(page.data.canRetry, true);
      assert.ok(page.data.error);
      page.copyUrl();
      assert.equal(env.clipboard[env.clipboard.length - 1], expected);
      page.retry();
      assert.equal(page.data.url, expected);
      assert.equal(page.data.sourceUrl, expected);
      assert.equal(page.data.loading, true);
      assert.equal(page.data.error, '');
      page.loaded();
      page.onUnload();
      assert.equal(env.loadingEvents[env.loadingEvents.length - 1], 'hide');
    }
  });
}

for (const suffix of [
  '', '/', '?offer=1&channel=cards#terms', '#terms',
  '/Promotion/%2Fkeep?next=https%3A%2F%2Fother.com%2Foffer%3Fa%3D1%26b%3D2#Section%23One',
  '/encoded/%25/%252F?value=%2526%253D&plus=a+b#fragment%2523',
  '//other.com/path?next=%2F%2Fother.com%2F#@other.com',
]) {
  test(`normalization preserves every path, query, and fragment byte in ${suffix || 'a host-only URL'}`, async () => {
    const input = `HTTPS://CC.CMBCHINA.COM:00443${suffix}`;
    const expected = `https://cc.cmbchina.com${suffix}`;
    const env = harness({ hosts: ['CC.CMBCHINA.COM'] });
    assert.equal(env.entrance.resolveWebViewUrl(input), expected);
    await env.client.openEntrance(webEntrance(input));
    const page = env.followNavigation(0);
    assert.equal(page.data.sourceUrl, expected);
    assert.equal(page.data.url, expected);
    page.failed();
    page.retry();
    assert.equal(page.data.url, expected);
    assert.deepEqual([...env.configuration.allowedWebViewHosts], ['CC.CMBCHINA.COM']);
  });
}

test('the resolver uses the validated trimmed URL without normalizing its suffix a second time', async () => {
  const input = ' \tHTTPS://CC.CMBCHINA.COM:443/Offer?value=%252F#Part \n';
  const expected = 'https://cc.cmbchina.com/Offer?value=%252F#Part';
  const env = harness();
  assert.equal(env.entrance.resolveWebViewUrl(input), expected);
  await env.client.openEntrance(webEntrance(input));
  const page = env.followNavigation(0);
  assert.equal(page.data.url, expected);
  assert.equal(page.data.sourceUrl, expected);
});

const publicFallbacks = [
  { name: 'disabled web views', url: 'https://cc.cmbchina.com:443/promotion', enabled: false },
  { name: 'a non-default port', url: 'https://cc.cmbchina.com:8443/promotion' },
  { name: 'port 80 on an HTTPS URL', url: 'https://cc.cmbchina.com:80/promotion' },
  { name: 'the highest valid port', url: 'https://cc.cmbchina.com:65535/promotion' },
  { name: 'a zero-padded non-default port', url: 'https://cc.cmbchina.com:00444/promotion' },
  { name: 'an untrusted host', url: 'https://www.boc.cn/promotion' },
  { name: 'a host suffix spoof', url: 'https://cc.cmbchina.com.other.com/promotion' },
  { name: 'an unapproved subdomain', url: 'https://sub.cc.cmbchina.com/promotion' },
  { name: 'an unapproved hostname prefix', url: 'https://othercc.cmbchina.com/promotion' },
  { name: 'a trusted name only in the path and query', url: 'https://other.com/cc.cmbchina.com?next=https://cc.cmbchina.com/#cc.cmbchina.com' },
];

for (const item of publicFallbacks) {
  test(`${item.name} keeps a valid public address available for copying without opening a web view`, async () => {
    const env = harness({ enabled: item.enabled });
    assert.equal(env.validation.validatePublicHttps(item.url), item.url);
    assert.equal(env.entrance.resolveWebViewUrl(item.url), null);
    assert.equal(env.entrance.entranceBehavior(webEntrance(item.url)), 'clipboard');
    const detail = await env.loadDetail(item.url);
    assert.equal(detail.data.view.entryAction, '复制链接');
    assert.equal(detail.data.view.sourceAction, '复制银行规则链接');
    await detail.entrance();
    await detail.source();
    assert.deepEqual(env.navigations, []);
    assert.deepEqual(env.clipboard, [item.url, item.url]);

    const page = env.openPage(item.url);
    assert.equal(page.data.sourceUrl, item.url);
    assert.equal(page.data.url, '');
    assert.equal(page.data.canRetry, false);
    assert.equal(page.data.loading, false);
    assert.ok(page.data.error);
    page.retry();
    assert.equal(page.data.url, '');
    assert.deepEqual(env.loadingEvents, []);
    page.copyUrl();
    assert.deepEqual(env.clipboard, [item.url, item.url, item.url]);
    page.goBack();
    assert.deepEqual(env.returns, [{ route: '/pages/activities/index', tab: true }]);
  });
}

const invalidAddresses = [
  { name: 'HTTP', url: 'http://cc.cmbchina.com/promotion' },
  { name: 'FTP', url: 'ftp://cc.cmbchina.com/promotion' },
  { name: 'a script URL', url: 'javascript:alert(1)' },
  { name: 'a protocol-relative URL', url: '//cc.cmbchina.com/promotion' },
  { name: 'userinfo on the allowed host', url: 'https://user:password@cc.cmbchina.com/promotion' },
  { name: 'a trusted name used as userinfo', url: 'https://cc.cmbchina.com@other.com/promotion' },
  { name: 'a backslash in authority', url: 'https://cc.cmbchina.com\\@other.com/promotion' },
  { name: 'a backslash in the path', url: 'https://cc.cmbchina.com/offer\\promotion' },
  { name: 'a percent-encoded hostname', url: 'https://%63%63.cmbchina.com/promotion' },
  { name: 'a percent-encoded hostname separator', url: 'https://cc%2Ecmbchina.com/promotion' },
  { name: 'a percent-encoded authority delimiter', url: 'https://cc.cmbchina.com%2F.other.com/promotion' },
  { name: 'percent-encoded userinfo', url: 'https://cc.cmbchina.com%40other.com/promotion' },
  { name: 'a percent-encoded port delimiter', url: 'https://cc.cmbchina.com%3A443/promotion' },
  { name: 'a private IPv4 address', url: 'https://10.0.0.1/promotion', hosts: ['10.0.0.1'] },
  { name: 'a public IPv4 address', url: 'https://8.8.8.8/promotion', hosts: ['8.8.8.8'] },
  { name: 'an IPv6 address', url: 'https://[::1]/promotion', hosts: ['[::1]'] },
  { name: 'localhost', url: 'https://localhost/promotion', hosts: ['localhost'] },
  { name: 'a local network domain', url: 'https://printer.local/promotion', hosts: ['printer.local'] },
  { name: 'a localhost label within a public domain', url: 'https://localhost.cmbchina.com/promotion', hosts: ['localhost.cmbchina.com'] },
  { name: 'a trailing hostname dot', url: 'https://cc.cmbchina.com./promotion', hosts: ['cc.cmbchina.com.'] },
  { name: 'an empty port', url: 'https://cc.cmbchina.com:/promotion' },
  { name: 'port zero', url: 'https://cc.cmbchina.com:0/promotion' },
  { name: 'an out-of-range port', url: 'https://cc.cmbchina.com:65536/promotion' },
  { name: 'a six-digit port', url: 'https://cc.cmbchina.com:000443/promotion' },
  { name: 'a signed port', url: 'https://cc.cmbchina.com:+443/promotion' },
  { name: 'a non-numeric port', url: 'https://cc.cmbchina.com:443x/promotion' },
  { name: 'internal whitespace', url: 'https://cc.cmbchina.com/promo tion' },
  { name: 'an embedded line break', url: 'https://cc.cmbchina.com/promo\ntion' },
];

for (const item of invalidAddresses) {
  test(`${item.name} cannot become a web view or a copyable source on the web-entry page`, () => {
    const env = harness({ hosts: item.hosts });
    assert.throws(() => env.validation.validatePublicHttps(item.url));
    assert.equal(env.entrance.resolveWebViewUrl(item.url), null);
    assert.notEqual(env.entrance.entranceBehavior(webEntrance(item.url)), 'webview');
    const page = env.openPage(item.url);
    assert.equal(page.data.url, '');
    assert.equal(page.data.sourceUrl, '');
    assert.equal(page.data.canRetry, false);
    assert.equal(page.data.loading, false);
    assert.ok(page.data.error);
    page.retry();
    page.copyUrl();
    assert.deepEqual(env.navigations, []);
    assert.deepEqual(env.clipboard, []);
    assert.deepEqual(env.loadingEvents, []);
  });
}

test('missing and malformed route encoding leaves no address available to copy', () => {
  const env = harness();
  const doubleEncoded = encodeURIComponent(encodeURIComponent('https://cc.cmbchina.com:443/promotion'));
  for (const options of [{}, { url: '' }, { url: '%E0%A4%A' }, { url: doubleEncoded }]) {
    const page = env.openPageOptions(options);
    assert.equal(page.data.url, '');
    assert.equal(page.data.sourceUrl, '');
    assert.equal(page.data.canRetry, false);
    assert.ok(page.data.error);
    page.copyUrl();
    page.retry();
  }
  assert.deepEqual(env.clipboard, []);
  assert.deepEqual(env.navigations, []);
});

test('non-string input cannot bypass public URL validation', () => {
  const env = harness();
  for (const value of [undefined, null, false, 443, {}, ['https://cc.cmbchina.com/promotion']]) {
    assert.equal(env.entrance.resolveWebViewUrl(value), null);
  }
});

test('allowlist entries are exact hostnames rather than wildcard, URL, or port patterns', () => {
  const input = 'https://cc.cmbchina.com/promotion';
  const empty = harness({ hosts: [] });
  assert.equal(empty.entrance.resolveWebViewUrl(input), null);
  const unsupported = empty.openPage(input);
  assert.equal(unsupported.data.url, '');
  assert.equal(unsupported.data.sourceUrl, input);
  unsupported.copyUrl();
  assert.deepEqual(empty.clipboard, [input]);
  for (const host of ['*.cmbchina.com', 'cmbchina.com', 'https://cc.cmbchina.com', 'cc.cmbchina.com:443']) {
    const env = harness({ hosts: [host] });
    assert.equal(env.entrance.resolveWebViewUrl(input), null);
    const page = env.openPage(input);
    assert.equal(page.data.url, '');
    assert.equal(page.data.sourceUrl, input);
    assert.equal(page.data.canRetry, false);
  }
});

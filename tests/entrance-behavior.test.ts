import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { banks, issuers } from '../shared/catalog';
import { benefitCopy } from '../miniprogram/services/benefit-copy';
import * as format from '../miniprogram/services/format';
import * as cardLabels from '../miniprogram/services/card-labels';
import * as validation from '../domain/validation';
import type { Activity, Detail } from '../shared/contracts';
import * as activityDesign from '../miniprogram/services/activity-design';
import * as formDraft from '../miniprogram/services/form-draft';

function harness(enabled: boolean, allowedHosts: string[], url: string) {
  const configuration = Object.freeze({ webViewEnabled: enabled, allowedWebViewHosts: Object.freeze([...allowedHosts]) });
  const actions: { type: string; value: string }[] = [];
  let page: any;
  const wx = {
    navigateTo: async ({ url: target }: { url: string }) => { actions.push({ type: 'webview', value: target }); },
    setClipboardData: ({ data, success }: { data: string; success: () => void }) => { actions.push({ type: 'clipboard', value: data }); success(); },
    showModal() {},
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
  };
  function evaluate(file: string, imports: Record<string, unknown>): Record<string, any> {
    const exports: Record<string, any> = {};
    const javascript = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(javascript, {
      exports, wx, getCurrentPages: () => page ? [page] : [],
      require(name: string) { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; },
      Page(definition: any) {
        page = { ...definition, data: structuredClone(definition.data) };
        page.setData = (patch: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(patch)) {
            const parts = key.split('.');
            let current = page.data;
            for (const part of parts.slice(0, -1)) current = current[part] ||= {};
            current[parts[parts.length - 1]] = value;
          }
        };
      },
    }, { filename: file });
    return exports;
  }
  const entrance = evaluate('miniprogram/services/entrance.ts', {
    '../runtime-config': { default: configuration }, '../../domain/validation': validation,
  });
  const client = evaluate('miniprogram/services/api.ts', {
    '../runtime-config': { default: configuration }, './demo': {}, './entrance': entrance,
  });
  const activity: Activity = {
    id: 'web-offer', revision: 1, status: 'published', title: 'Bank offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Eligible card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31',
    target: 1, unit: 'count', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Complete one purchase', sourceUrl: url, sourceNote: 'Bank source',
    entrance: { kind: 'web', url, label: 'Bank offer', instructions: 'Read the offer', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
  const detail: Detail = { activity, participation: null, tracking: null, eligible: true, assets: [], audit: [], history: [] };
  evaluate('miniprogram/pages/detail/index.ts', {
    '../../../shared/catalog': { banks, issuers },
    '../../services/api': { ...client, ensureSession: async () => ({ userId: 'entrance-owner', today: '2026-09-22', month: '2026-09' }), api: { query: async () => detail } },
    '../../services/format': { ...format, today: () => '2026-09-22', showError(error: unknown) { throw error; } },
    '../../services/card-labels': cardLabels,
    '../../services/benefit-copy': { benefitCopy },
    '../../services/navigation': { navigateBackOr() {} },
    '../../services/entrance': entrance,
    '../../services/activity-design': activityDesign,
    '../../services/form-draft': formDraft,
  });
  page.setData({ activityId: activity.id });
  return { page, actions, configuration };
}

const cases = [
  { label: 'disabled web views keep copy actions', enabled: false, hosts: ['www.cmbchina.com'], url: 'https://www.cmbchina.com/offers?id=1', behavior: 'clipboard' },
  { label: 'enabled allowlisted web views use open actions', enabled: true, hosts: ['www.cmbchina.com'], url: 'https://www.cmbchina.com/offers?id=1', behavior: 'webview' },
  { label: 'default HTTPS ports use the same open actions', enabled: true, hosts: ['www.cmbchina.com'], url: 'https://www.cmbchina.com:443/offers?id=1', behavior: 'webview' },
  { label: 'non-default HTTPS ports use copy actions', enabled: true, hosts: ['www.cmbchina.com'], url: 'https://www.cmbchina.com:8443/offers?id=1', behavior: 'clipboard' },
  { label: 'enabled web views still reject hosts outside the allowlist', enabled: true, hosts: ['www.cmbchina.com'], url: 'https://other.example/offers', behavior: 'clipboard' },
  { label: 'enabled web views still require HTTPS', enabled: true, hosts: ['www.cmbchina.com'], url: 'http://www.cmbchina.com/offers', behavior: 'clipboard' },
];

for (const item of cases) {
  test(`activity and source labels match real entrance behavior: ${item.label}`, async () => {
    const env = harness(item.enabled, item.hosts, item.url);
    await env.page.load();
    assert.equal(env.page.data.view.entryAction, item.behavior === 'webview' ? '打开网页' : '复制链接');
    assert.equal(env.page.data.view.sourceAction, item.behavior === 'webview' ? '打开银行规则' : '复制银行规则链接');
    await env.page.entrance();
    await env.page.source();
    const value = item.behavior === 'webview' ? `/pages/web-entry/index?url=${encodeURIComponent(item.url)}` : item.url;
    assert.deepEqual(env.actions, [{ type: item.behavior, value }, { type: item.behavior, value }]);
    assert.equal(env.configuration.webViewEnabled, item.enabled);
    assert.deepEqual([...env.configuration.allowedWebViewHosts], item.hosts);
  });
}

test('detail buttons render the shared activity and source action labels', () => {
  const markup = readFileSync('miniprogram/pages/detail/index.wxml', 'utf8');
  assert.match(markup, /bindtap="entrance">\{\{view\.entryAction\}\}/);
  assert.match(markup, /bindtap="source">\{\{view\.sourceAction\}\}/);
});

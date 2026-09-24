import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as validation from '../domain/validation';
import type { ActivityDraft, ApiRequest, Submission } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';

type Route = 'submission-lead' | 'submission-edit';
type Controller = { data: Record<string, any>; setData(values: Record<string, unknown>, callback?: () => void): void; [key: string]: any };
const field = (name: string, value: unknown) => ({ currentTarget: { dataset: { field: name } }, detail: { value } });
const image = (id: string) => ({ currentTarget: { dataset: { id } } });
function draft(): ActivityDraft {
  return { title: 'Original offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Eligible cards', frequency: 'once', startsOn: '2026-09-01', endsOn: '2026-12-31', target: 1, unit: '次', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false, conditions: 'One eligible purchase', sourceUrl: '', sourceNote: 'Bank app', entrance: { kind: 'guide', label: 'Open app', instructions: 'Benefits page', imageIds: [] } };
}
function fixture() {
  const store = new MemoryStore();
  const service = createService(store, { now: () => new Date('2026-09-24T04:00:00Z') });
  const actor = { userId: 'pending-owner', isModerator: false };
  const requests: ApiRequest[] = [];
  let loseNext = true;
  const transport = async (request: ApiRequest) => {
    requests.push(structuredClone(request));
    const result = await service.execute(actor, request);
    if (loseNext) { loseNext = false; throw Object.assign(new Error('Response lost after commit'), { code: 'NETWORK_ERROR' }); }
    return { result: { ok: true, data: result } };
  };
  const query = async (action: string, payload: any) => action.startsWith('assets.') ? [] : service.execute(actor, { action, payload } as ApiRequest);
  return { store, requests, transport, query };
}
function harness(route: Route, options: { storage?: Map<string, unknown>; transport?: (request: ApiRequest) => Promise<unknown>; command?: (action: string, payload: any) => Promise<unknown>; query?: (action: string, payload: any) => Promise<any>; ownerId?: string; session?: () => Promise<any> } = {}) {
  const storage = options.storage || new Map<string, unknown>();
  const commands: { action: string; payload: any; options?: { intentKey?: string } }[] = [];
  const navigations: string[] = [];
  const modals: unknown[] = [];
  const previews: string[][] = [];
  let uploads = 0;
  let page!: Controller;
  const wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    showModal: async (value: unknown) => { modals.push(value); return { confirm: false }; },
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, setNavigationBarTitle() {}, showToast() {}, pageScrollTo() {}, setClipboardData() {},
    navigateBack: () => navigations.push('back'), redirectTo: ({ url }: { url: string }) => navigations.push(url), navigateTo: ({ url }: { url: string }) => navigations.push(url),
    cloud: { init() {}, callFunction: ({ data }: { data: ApiRequest }) => options.transport!(data) },
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}): Record<string, any> {
    const exports: Record<string, any> = {};
    const javascript = ts.transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(javascript, { exports, wx, Error, getCurrentPages: () => [page], require: (id: string) => { assert.ok(id in imports, `Unexpected import ${id}`); return imports[id]; },
      Page: (definition: Controller) => {
        page = definition;
        page.data = JSON.parse(JSON.stringify(page.data));
        page.setData = (values, callback) => {
          for (const [key, value] of Object.entries(values)) {
            const keys = key.split('.');
            let target = page.data;
            for (const part of keys.slice(0, -1)) target = target[part] ||= {};
            target[keys.at(-1)!] = value;
          }
          callback?.();
        };
      },
    });
    return exports;
  }
  const formDrafts = evaluate('miniprogram/services/form-draft.ts');
  const sourceApi = options.transport ? evaluate('miniprogram/services/api.ts', {
    '../runtime-config': { default: { mode: 'cloud', cloudEnvId: 'test-cloud', apiFunctionName: 'api' } },
    './demo': { demoActor: { userId: 'pending-owner', isModerator: false }, demoService() {}, persistDemo() {} },
    './entrance': { entranceBehavior: () => 'guide' },
  }).api : null;
  const api = {
    query: options.query || (async () => []),
    command: async (action: string, payload: any, commandOptions?: { intentKey?: string }) => {
      commands.push({ action, payload: structuredClone(payload), options: commandOptions });
      return options.command ? options.command(action, payload) : sourceApi.command(action, payload, commandOptions);
    },
  };
  evaluate(`miniprogram/pages/${route}/index.ts`, {
    '../../services/api': { api, ensureSession: options.session || (async () => ({ userId: options.ownerId || 'pending-owner', isModerator: false, today: '2026-09-24' })), uploadImage: async () => { uploads++; return { id: 'new-image' }; }, previewAssets: async (assets: { id: string }[]) => previews.push(assets.map(item => item.id)) },
    '../../services/form-draft': formDrafts, '../../services/navigation': { navigateBackOr: () => navigations.push('back') },
    '../../../shared/catalog': catalog, '../../../domain/validation': validation,
  });
  return { page, commands, storage, navigations, modals, formDrafts, previews, uploads: () => uploads };
}
function fill(env: ReturnType<typeof harness>, route: Route) {
  if (route === 'submission-lead') env.page.setData({ lead: { title: 'Original offer', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app', imageIds: [] } });
  else env.page.setData({ draft: draft(), targetText: '1', rewardText: '20' });
  env.page.markDirty();
}
function saved(env: ReturnType<typeof harness>, route: Route, id = 'new') {
  return env.formDrafts.loadDraft(route === 'submission-lead' ? route : 'submission', 'pending-owner', id);
}

for (const route of ['submission-lead', 'submission-edit'] as const) {
  test(`${route} freezes every mutation after a lost response and recovers the exact request without duplicate submissions`, async () => {
    const f = fixture();
    const first = harness(route, f);
    await first.page.load();
    fill(first, route);
    await first.page.save();
    assert.equal(first.page.data.pendingCreationUnconfirmed, true);
    const originalInput = JSON.stringify(route === 'submission-lead' ? first.page.data.lead : first.page.data.draft);
    const pending = structuredClone(saved(first, route).value.pendingCreation);
    first.page.input(field('title', 'Duplicate candidate'));
    first.page.input(field('sourceNote', 'Changed source'));
    if (route === 'submission-lead') {
      first.page.selectBank(field('', '2'));
      first.page.fillFullRules();
    } else {
      first.page.input(field('targetText', '2'));
      first.page.input(field('rewardText', '99'));
      first.page.select(field('bankId', '2'));
      first.page.select(field('entrance.kind', '1'));
      first.page.selectDate(field('endsOn', '2027-01-01'));
      first.page.selectIssuers(field('', []));
      first.page.selectNetworks(field('', []));
      first.page.toggle(field('requiresInvitation', true));
      first.page.toggle(field('sourceVerified', true));
      first.page.useSourceImage(image('source-image'));
      first.page.toggleSection({ currentTarget: { dataset: { section: 'source' } } });
      assert.equal(first.page.data.openSection, 'source', 'Read-only section navigation remains available.');
      assert.equal(first.page.data.targetText, '1');
      assert.equal(first.page.data.rewardText, '20');
      assert.equal(first.page.data.sourceVerified, false);
    }
    await first.page.addImage();
    first.page.removeImage(image('original-image'));
    first.page.saveLocalDraft();
    assert.equal(first.uploads(), 0);
    assert.equal(JSON.stringify(route === 'submission-lead' ? first.page.data.lead : first.page.data.draft), originalInput);
    assert.deepEqual(saved(first, route).value.pendingCreation, pending);
    assert.equal(first.navigations.length, 0);
    first.page.viewSubmissions();
    assert.equal(first.navigations.at(-1), '/pages/submissions/index');
    first.page.onHide();
    first.page.onUnload();
    const restored = harness(route, { ...f, storage: first.storage });
    await restored.page.load();
    assert.equal(restored.modals.length, 0, 'Pending requests cannot be discarded through ordinary draft recovery.');
    assert.equal(restored.page.data.pendingCreationUnconfirmed, true);
    restored.page.creationIntentKey = 'unrelated-new-intent';
    await restored.page.save();
    assert.equal(restored.page.data.submitted, true);
    assert.deepEqual(f.requests[1], f.requests[0]);
    assert.equal((await f.store.find('submissions')).length, 1);
    assert.equal((await f.store.find('requests')).length, 1);
    assert.equal((await f.store.find('audit_events')).length, 1);
    assert.equal(restored.storage.size, 0);
    const record = (await f.store.find<Submission>('submissions'))[0];
    const editor = harness(route, f);
    editor.page.setData({ submissionId: record.id });
    await editor.page.load();
    editor.page.input(field('title', 'Confirmed record edit'));
    await editor.page.save();
    assert.equal(editor.commands[0].payload.id, record.id);
    assert.equal(editor.commands[0].payload.expectedVersion, record.version);
    assert.equal(editor.commands[0].options, undefined);
    assert.equal((await f.store.find('submissions')).length, 1);
  });

  for (const code of ['NETWORK_ERROR', 'INVALID_RESPONSE', 'INTERNAL_ERROR', 'UNAUTHENTICATED', 'CONFIGURATION_REQUIRED']) {
    test(`${route} retains its pending proof after ${code}`, async () => {
      const env = harness(route, { command: async () => { throw Object.assign(new Error('Unknown result'), { code }); } });
      await env.page.load();
      fill(env, route);
      await env.page.save();
      const pending = structuredClone(saved(env, route).value.pendingCreation);
      await env.page.save();
      assert.equal(env.page.data.pendingCreationUnconfirmed, true);
      assert.deepEqual(saved(env, route).value.pendingCreation, pending);
      assert.deepEqual(env.commands[1], env.commands[0]);
    });
  }

  test(`${route} unlocks a definitive rejection and never dispatches when pending storage fails`, async () => {
    let failWrites = false;
    class Storage extends Map<string, unknown> { override set(key: string, value: unknown) { if (failWrites) throw new Error('Storage unavailable'); return super.set(key, value); } }
    const env = harness(route, { storage: new Storage(), command: async () => { throw Object.assign(new Error('Invalid title'), { code: 'INVALID_INPUT', field: route === 'submission-lead' ? 'lead.title' : 'draft.title' }); } });
    await env.page.load();
    fill(env, route);
    failWrites = true;
    await env.page.save();
    assert.equal(env.commands.length, 0);
    assert.equal(env.page.pendingCreation, null);
    failWrites = false;
    await env.page.save();
    assert.equal(env.commands.length, 1);
    assert.equal(env.page.data.pendingCreationUnconfirmed, false);
    assert.equal(saved(env, route).value.pendingCreation, undefined);
    env.page.input(field('title', 'Corrected title'));
    assert.equal((route === 'submission-lead' ? env.page.data.lead : env.page.data.draft).title, 'Corrected title');
  });

  test(`${route} preserves pending proof for an incomplete success response and keeps image preview available`, async () => {
    const env = harness(route, { command: async () => ({}) });
    await env.page.load();
    fill(env, route);
    env.page.setData(route === 'submission-lead' ? { 'lead.imageIds': ['original-image'] } : { 'draft.entrance.imageIds': ['original-image'], sourceImageIds: ['source-image'], openSection: 'entrance' });
    env.page.setData({ assets: [{ id: 'original-image' }], loadingImages: false });
    await env.page.save();
    assert.equal(env.page.data.pendingCreationUnconfirmed, true);
    env.page.removeImage(image('original-image'));
    if (route === 'submission-edit') env.page.useSourceImage(image('source-image'));
    await env.page.previewImage(image('original-image'));
    assert.deepEqual(env.previews.map(ids => Array.from(ids)), [['original-image']]);
    assert.deepEqual(Array.from(route === 'submission-lead' ? env.page.data.lead.imageIds : env.page.data.draft.entrance.imageIds), ['original-image']);
    const other = harness(route, { storage: env.storage, ownerId: 'another-owner', command: async () => ({ id: 'unused' }) });
    await other.page.load();
    assert.equal(other.page.data.pendingCreationUnconfirmed, false);
    assert.equal((route === 'submission-lead' ? other.page.data.lead : other.page.data.draft).title, '');
    assert.ok(saved(env, route).value.pendingCreation);
    assert.equal(other.commands.length, 0);
  });
}

async function legacyChangedDraft(f = fixture()) {
  const original = harness('submission-edit', f);
  await original.page.load();
  fill(original, 'submission-edit');
  await original.page.save();
  const old = saved(original, 'submission-edit');
  original.formDrafts.saveDraft('submission', 'pending-owner', 'new', old.baseVersion, {
    ...old.value, draft: { ...old.value.draft, title: 'Preserved later title', conditions: 'Later private notes' }, targetText: '3', rewardText: '40.00',
  });
  original.page.onUnload();
  return { f, original };
}

test('a legacy edited pending draft retries its original creation and retains later input as an edit of the confirmed ID', async () => {
  const { f, original } = await legacyChangedDraft();
  const restored = harness('submission-edit', { ...f, storage: original.storage });
  await restored.page.load();
  assert.equal(restored.page.data.draft.title, 'Preserved later title');
  assert.equal(restored.page.data.pendingCreationUnconfirmed, true);
  await restored.page.save();
  const record = (await f.store.find<Submission>('submissions'))[0];
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(record.draft!.title, 'Original offer');
  assert.equal(restored.page.data.submissionId, record.id);
  assert.equal(restored.page.data.submission.version, record.version);
  assert.equal(restored.page.data.pendingCreationUnconfirmed, false);
  assert.equal(restored.page.data.draft.title, 'Preserved later title');
  assert.equal(restored.page.data.targetText, '3');
  assert.equal(restored.page.data.rewardText, '40.00');
  assert.equal(saved(restored, 'submission-edit'), null);
  const retained = saved(restored, 'submission-edit', record.id);
  assert.equal(retained.baseVersion, record.version);
  assert.equal(retained.value.draft.conditions, 'Later private notes');
  assert.equal(retained.value.pendingCreation, undefined);
  restored.page.input(field('title', 'Final title'));
  await restored.page.save();
  assert.equal(restored.commands[1].payload.id, record.id);
  assert.equal(restored.commands[1].payload.expectedVersion, record.version);
  assert.equal((await f.store.find('submissions')).length, 1);
  assert.equal((await f.store.get<Submission>('submissions', record.id))?.draft?.title, 'Final title');
});

test('a legacy pending draft retains later hidden entrance input even when its normalized command has not changed', async () => {
  const f = fixture();
  const original = harness('submission-edit', f);
  await original.page.load();
  fill(original, 'submission-edit');
  await original.page.save();
  const old = saved(original, 'submission-edit');
  delete old.value.pendingCreation.inputSnapshot;
  old.value.draft.entrance.url = 'https://bank.example/another-source';
  original.formDrafts.saveDraft('submission', 'pending-owner', 'new', old.baseVersion, old.value);
  original.page.onUnload();
  const restored = harness('submission-edit', { ...f, storage: original.storage });
  await restored.page.load();
  await restored.page.save();
  const record = (await f.store.find<Submission>('submissions'))[0];
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(record.draft!.entrance.url, undefined);
  assert.equal(restored.page.data.submissionId, record.id);
  assert.equal(restored.page.data.draft.entrance.url, 'https://bank.example/another-source');
  assert.equal(saved(restored, 'submission-edit', record.id).value.draft.entrance.url, 'https://bank.example/another-source');
  assert.equal(restored.page.data.pendingCreationUnconfirmed, false);
  assert.equal((await f.store.find('submissions')).length, 1);
});

test('a current pending snapshot distinguishes original raw inputs from later unsent changes', async () => {
  const f = fixture();
  const original = harness('submission-edit', f);
  await original.page.load();
  fill(original, 'submission-edit');
  original.page.input(field('title', '  Original offer  '));
  original.page.setData({ 'draft.entrance.url': 'https://bank.example/unused-input' });
  await original.page.save();
  assert.equal(saved(original, 'submission-edit').value.pendingCreation.inputSnapshot.draft.title, '  Original offer  ');
  original.page.onUnload();
  const restored = harness('submission-edit', { ...f, storage: original.storage });
  await restored.page.load();
  await restored.page.save();
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(restored.page.data.submitted, true);
  assert.equal(restored.storage.size, 0, 'Unchanged original form inputs do not become a spurious later edit.');
  assert.equal((await f.store.find('submissions')).length, 1);
});

for (const problem of ['owner', 'version', 'storage', 'newer-draft', 'unloaded']) {
  test(`legacy pending migration preserves private input when confirmation encounters ${problem}`, async () => {
    const { f, original } = await legacyChangedDraft();
    const record = (await f.store.find<Submission>('submissions'))[0];
    const before = structuredClone(saved(original, 'submission-edit').value);
    let restored!: ReturnType<typeof harness>;
    const query = async (action: string, payload: any) => {
      const value = await f.query(action, payload);
      if (action !== 'submission.get') return value;
      if (problem === 'owner') return { ...(value as Submission), ownerId: 'someone-else' };
      if (problem === 'version') return { ...(value as Submission), version: record.version + 1 };
      if (problem === 'unloaded') restored.page.onUnload();
      return value;
    };
    let failTarget = false;
    class Storage extends Map<string, unknown> { override set(key: string, value: unknown) { if (failTarget && key.endsWith(':' + record.id)) throw new Error('Storage unavailable'); return super.set(key, value); } }
    const storage = new Storage(original.storage);
    restored = harness('submission-edit', { ...f, query, storage });
    await restored.page.load();
    if (problem === 'storage') failTarget = true;
    if (problem === 'newer-draft') restored.formDrafts.saveDraft('submission', 'pending-owner', record.id, record.version, { ...before, pendingCreation: undefined, draft: { ...before.draft, title: 'Independent existing edit' } });
    const unrelated = saved(restored, 'submission-edit', record.id);
    await restored.page.save();
    assert.equal((await f.store.find('submissions')).length, 1);
    assert.deepEqual(f.requests[1], f.requests[0]);
    if (problem === 'version') {
      assert.equal(restored.page.data.conflict, true);
      assert.equal(saved(restored, 'submission-edit', record.id).baseVersion, record.version);
      await restored.page.save();
      assert.equal(restored.commands.length, 1, 'A server revision change must block the retained local edit.');
    } else {
      assert.deepEqual(saved(restored, 'submission-edit').value.draft, before.draft);
      assert.deepEqual(saved(restored, 'submission-edit').value.pendingCreation, before.pendingCreation);
      assert.deepEqual(saved(restored, 'submission-edit', record.id), unrelated);
      assert.equal(restored.navigations.length, 0);
    }
  });
}

test('a pending lead cannot enter the full creation form through a direct continuation link', async () => {
  const first = harness('submission-lead', { command: async () => { throw Object.assign(new Error('Unknown result'), { code: 'NETWORK_ERROR' }); } });
  await first.page.load();
  fill(first, 'submission-lead');
  await first.page.save();
  const full = harness('submission-edit', { storage: first.storage, command: async () => ({ id: 'unexpected' }) });
  full.page.setData({ fromLead: true });
  await full.page.load();
  assert.equal(full.page.data.ready, false);
  await full.page.save();
  assert.equal(full.commands.length, 0);
  assert.ok(saved(first, 'submission-lead').value.pendingCreation);
});

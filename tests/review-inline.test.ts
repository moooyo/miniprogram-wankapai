import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as recognitionForm from '../miniprogram/services/recognition-form';
import * as reviewForm from '../miniprogram/services/review-form';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';
import { periodFor } from '../domain/calendar';
import type { Activity, ActivityDraft, Actor, ApiRequest, Submission } from '../shared/contracts';

type Controller = { data: Record<string, any>; setData(values: Record<string, unknown>, callback?: () => void): void; [key: string]: any };
const rowEvent = (id = 'inline-lead', value?: string, detail?: string | boolean) => ({ currentTarget: { dataset: { id, value } }, detail: { value: detail } });
function completeDraft(): ActivityDraft {
  return { title: 'Verified bank offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Eligible Visa credit cards',
    frequency: 'monthly', cycle: { t: 'month', day: 10 }, startsOn: '2026-09-10', endsOn: '2026-12-31', target: 3, unit: '笔', currency: 'CNY', rewardMinor: 1800,
    rewardKind: 'cashback', scope: 'user', requiresRegistration: true, requiresInvitation: false, conditions: 'Three eligible purchases after registration',
    sourceUrl: 'https://www.cmbchina.com/', sourceNote: 'Bank app > offers > terms', entrance: { kind: 'guide', label: 'Bank registration', instructions: 'Bank app > offers > register', imageIds: [] } };
}
function pendingLead(): Submission {
  const { title, bankId, sourceUrl, sourceNote, ...rules } = completeDraft();
  return { id: 'inline-lead', ownerId: 'contributor', draft: null, lead: { title, bankId, sourceUrl, sourceNote, imageIds: [], rules }, status: 'pending', reviewNote: '', version: 7, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(item: Submission = pendingLead()) {
  const store = new MemoryStore({ submissions: { [item.id]: item } });
  const service = createService(store, { now: () => new Date('2026-10-02T04:00:00Z'), demo: false });
  let actor: Actor = { userId: 'inline-reviewer', isModerator: true };
  let sequence = 0;
  let detailResponse: Promise<Submission> | null = null;
  let commandDelay: Promise<void> | null = null;
  let shotResponse: Promise<{ id: string; url: string }[]> | null = null;
  let modalChoice = true;
  const storage = new Map<string, unknown>();
  const commands: { action: string; payload: any }[] = [];
  const navigations: string[] = [];
  const sessions: boolean[] = [];
  const modals: { title: string; content: string }[] = [];
  let page!: Controller;
  const wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    showToast() {}, showModal: async (value: { title: string; content: string }) => { modals.push(value); return { confirm: modalChoice }; },
    navigateTo: ({ url }: { url: string }) => navigations.push(url),
    setClipboardData() {},
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}) {
    const exports: Record<string, unknown> = {};
    const javascript = ts.transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(javascript, { exports, wx,
      require: (id: string) => { assert.ok(id in imports, `Unexpected import: ${id}`); return imports[id]; },
      Page: (config: Controller) => {
        page = config; page.data = JSON.parse(JSON.stringify(config.data));
        page.setData = (values, callback) => {
          for (const [key, value] of Object.entries(values)) {
            const segments = key.split('.'); let target = page.data;
            for (const segment of segments.slice(0, -1)) target = target[segment] ||= {};
            target[segments.at(-1)!] = value;
          }
          callback?.();
        };
      },
    }, { filename: file });
    return exports;
  }
  const drafts = evaluate('miniprogram/services/form-draft.ts') as { loadDraft: (...args: any[]) => any; saveDraft: (...args: any[]) => boolean };
  evaluate('miniprogram/pages/review/index.ts', {
    '../../services/api': {
      ensureSession: async (force = false) => { sessions.push(force); return { ...actor, today: '2026-10-02', demo: false }; },
      api: {
        query: async (action: string, payload: unknown) => action === 'assets.urls' && shotResponse ? shotResponse : action === 'submission.get' && detailResponse ? detailResponse : service.execute(actor, { action, payload } as ApiRequest),
        command: async (action: string, payload: unknown) => { commands.push({ action, payload: structuredClone(payload) }); const requestActor = actor; if (commandDelay) await commandDelay; return service.execute(requestActor, { action, payload, requestId: `inline-request-${++sequence}` } as ApiRequest); },
      },
    },
    '../../../shared/catalog': catalog,
    '../../services/navigation': { navigateBackOr() {} },
    '../../services/recognition-form': recognitionForm,
    '../../services/review-form': reviewForm,
    '../../services/form-draft': drafts,
  });
  return { page, store, commands, navigations, sessions, drafts, storage, modals, setActor: (next: Actor) => { actor = next; }, setDetailResponse: (value: Promise<Submission>) => { detailResponse = value; }, setCommandDelay: (value: Promise<void>) => { commandDelay = value; }, setShotResponse: (value: Promise<{ id: string; url: string }[]>) => { shotResponse = value; }, setModalChoice: (value: boolean) => { modalChoice = value; } };
}

test('an inline publication cannot reach the server until the operator explicitly verifies the source', async () => {
  const f = harness(); await f.page.load();
  assert.equal(f.page.data.items[0].form.publishReady, true);
  assert.equal(f.page.data.items[0].form.complete, true);
  await f.page.publish(rowEvent());
  assert.equal(f.commands.length, 0);
  assert.match(f.page.data.items[0].form.error, /核实来源/);
  assert.equal((await f.store.get<Submission>('submissions', 'inline-lead'))!.status, 'pending');
  assert.equal((await f.store.find('activities')).length, 0);
  assert.equal((await f.store.find('requests')).length, 0);
});

test('inline reward and cycle edits publish a real activity atomically with the pending version and an audit ledger', async () => {
  const f = harness(); await f.page.load();
  f.page.selectReward(rowEvent('inline-lead', 'points'));
  f.page.inputReward(rowEvent('inline-lead', undefined, '000234.99a'));
  assert.equal(f.page.data.items[0].form.draft.rewardMinor, 23400);
  f.page.selectCycle(rowEvent('inline-lead', 'custom'));
  f.page.selectInterval(rowEvent('inline-lead', 'day'));
  f.page.stepCycle({ currentTarget: { dataset: { id: 'inline-lead', delta: 1 } } });
  f.page.stepCycle({ currentTarget: { dataset: { id: 'inline-lead', delta: 1 } } });
  assert.equal(f.page.data.items[0].form.draft.cycle.n, 3);
  assert.equal(f.page.data.items[0].form.sourceVerified, false);
  f.page.verifySource(rowEvent('inline-lead', undefined, true));
  await f.page.publish(rowEvent());
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].payload.expectedVersion, 7);
  assert.equal(f.commands[0].payload.sourceVerified, true);
  const submission = (await f.store.get<Submission>('submissions', 'inline-lead'))!;
  assert.equal(submission.status, 'published'); assert.equal(submission.version, 8);
  const activity = (await f.store.get<Activity>('activities', submission.activityId!))!;
  assert.equal(activity.rewardKind, 'points'); assert.equal(activity.rewardMinor, 23400);
  assert.deepEqual(activity.cycle, { t: 'custom', n: 3, unit: 'day', anchor: '2026-09-10' });
  assert.ok(activity.entrance.verifiedAt);
  assert.equal((await f.store.find('requests')).length, 1);
  assert.equal((await f.store.find('audit_events')).length, 2);
  assert.equal(f.page.data.items.length, 0);
  assert.ok(f.sessions.length >= 2 && f.sessions.every(Boolean));
});

test('unknown lead rules remain incomplete and move to the full editor without publishing invented defaults', async () => {
  const item = pendingLead(); item.lead!.rules = { rewardKind: 'cashback', rewardMinor: 1800, cycle: { t: 'month', day: 10 } };
  const f = harness(item); await f.page.load();
  const form = f.page.data.items[0].form;
  assert.equal(form.draft.target, 0); assert.deepEqual(Array.from(form.draft.issuerIds), []); assert.equal(form.draft.conditions, '');
  assert.equal(form.complete, false);
  f.page.verifySource(rowEvent('inline-lead', undefined, true)); await f.page.publish(rowEvent());
  assert.equal(f.commands.length, 0); assert.equal((await f.store.find('activities')).length, 0);
  f.page.inputReward(rowEvent('inline-lead', undefined, '22'));
  f.page.open(rowEvent());
  assert.deepEqual(f.navigations, ['/pages/submission-edit/index?id=inline-lead&review=1']);
  assert.equal(f.drafts.loadDraft('submission-review', 'inline-reviewer', 'inline-lead').value.rewardText, '22');
});

test('a stale pending version keeps the inline changes and recovery draft after the server rejects publication', async () => {
  const f = harness(); await f.page.load();
  f.page.inputReward(rowEvent('inline-lead', undefined, '21'));
  f.page.verifySource(rowEvent('inline-lead', undefined, true));
  await f.store.set('submissions', 'inline-lead', { ...pendingLead(), version: 8 });
  await f.page.publish(rowEvent());
  const form = f.page.data.items[0].form;
  assert.equal(form.conflict, true); assert.equal(form.busy, false); assert.equal(form.rewardText, '21');
  assert.equal(f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead').value.rewardText, '21');
  assert.equal((await f.store.get<Submission>('submissions', 'inline-lead'))!.version, 8);
  assert.equal((await f.store.find('activities')).length, 0);
});

test('publication refreshes real account authority and cannot use the previous moderator identity after a role change', async () => {
  const f = harness(); await f.page.load();
  f.page.inputReward(rowEvent('inline-lead', undefined, '21'));
  f.page.verifySource(rowEvent('inline-lead', undefined, true));
  f.setActor({ userId: 'ordinary-owner', isModerator: false });
  await f.page.publish(rowEvent());
  assert.equal(f.commands.length, 0); assert.equal(f.page.data.sessionVerified, false); assert.equal(f.page.data.items.length, 0);
  assert.equal((await f.store.find('activities')).length, 0);
  assert.equal(f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead').value.rewardText, '21');
});

test('inline return sends only the reason and the expected pending version, retaining the original submission rules', async () => {
  const f = harness(); await f.page.load();
  f.page.inputReward(rowEvent('inline-lead', undefined, '99'));
  f.page.openReturn(rowEvent());
  f.page.selectReturnReason({ currentTarget: { dataset: { value: '来源无法核实' } } });
  f.page.inputReturnNote({ detail: { value: 'Please provide the official terms' } });
  await f.page.confirmReturn();
  assert.equal(f.commands[0].payload.decision, 'return'); assert.equal(f.commands[0].payload.expectedVersion, 7);
  assert.equal('draft' in f.commands[0].payload, false);
  const updated = (await f.store.get<Submission>('submissions', 'inline-lead'))!;
  assert.equal(updated.status, 'returned'); assert.equal(updated.version, 8); assert.equal(updated.lead!.rules!.rewardMinor, 1800);
  assert.equal((await f.store.find('activities')).length, 0);
});

test('a conflict reload cannot erase another editor revision written while the latest submission is loading', async () => {
  const f = harness(); await f.page.load();
  f.page.inputReward(rowEvent('inline-lead', undefined, '21'));
  const latest = deferred<Submission>(); f.setDetailResponse(latest.promise);
  const reload = f.page.reloadRow(rowEvent());
  await new Promise(resolve => setImmediate(resolve));
  const saved = f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead');
  f.drafts.saveDraft('submission-review-inline', 'inline-reviewer', 'inline-lead', 7, { ...saved.value, rewardText: '42' });
  latest.resolve(pendingLead()); await reload;
  assert.equal(f.page.data.items[0].form.rewardText, '21');
  assert.equal(f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead').value.rewardText, '42');
  assert.match(f.page.data.items[0].form.error, /填写.*保留/);
});

test('review serializes actions across rows until the active command finishes without leaving another row locked', async () => {
  const f = harness(); const second = { ...pendingLead(), id: 'second-lead' }; await f.store.set('submissions', second.id, second); await f.page.load();
  f.page.verifySource(rowEvent('inline-lead', undefined, true)); f.page.verifySource(rowEvent('second-lead', undefined, true));
  const delay = deferred<void>(); f.setCommandDelay(delay.promise);
  const first = f.page.publish(rowEvent()); await new Promise(resolve => setImmediate(resolve));
  await f.page.publish(rowEvent('second-lead')); f.page.changeStatus({ currentTarget: { dataset: { status: 'published' } } });
  assert.equal(f.commands.length, 1); assert.equal(f.page.data.anyBusy, true); assert.equal(f.page.data.status, 'pending');
  delay.resolve(); await first;
  assert.equal(f.page.data.anyBusy, false); assert.equal(f.page.data.items[0].form.busy, false);
  await f.page.publish(rowEvent('second-lead')); assert.equal((await f.store.find('activities')).length, 2);
});

for (const decision of ['publish', 'return'] as const) test(`${decision} clears only the displayed draft revision when another editor has already saved a newer copy`, async () => {
  const f = harness(); await f.page.load(); f.page.inputReward(rowEvent('inline-lead', undefined, '21'));
  const displayed = f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead');
  f.drafts.saveDraft('submission-review-inline', 'inline-reviewer', 'inline-lead', 7, { ...displayed.value, rewardText: '42' });
  if (decision === 'publish') { f.page.verifySource(rowEvent('inline-lead', undefined, true)); await f.page.publish(rowEvent()); }
  else { f.page.openReturn(rowEvent()); f.page.selectReturnReason({ currentTarget: { dataset: { value: '来源无法核实' } } }); await f.page.confirmReturn(); }
  assert.equal(f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead').value.rewardText, '42');
  assert.equal((await f.store.get<Submission>('submissions', 'inline-lead'))!.status, decision === 'publish' ? 'published' : 'returned');
});

test('untouched legacy quarterly rules retain their calendar preview and publication semantics', async () => {
  const draft = completeDraft(); delete draft.cycle; draft.frequency = 'quarterly';
  const f = harness({ ...pendingLead(), draft, lead: undefined }); await f.page.load();
  assert.equal(f.page.data.items[0].form.legacyCycle, true);
  assert.equal(f.page.data.items[0].form.cyclePreview, '当前周期：10月1日 – 12月31日，1月1日 00:00 重置');
  f.page.verifySource(rowEvent('inline-lead', undefined, true)); await f.page.publish(rowEvent());
  const published = (await f.store.find<Activity>('activities'))[0];
  assert.equal(published.cycle, undefined); assert.equal(published.frequency, 'quarterly');
  assert.equal(periodFor(published, '2026-10-02')!.startsOn, '2026-10-01');
  assert.equal(periodFor(published, '2026-10-02')!.endsOn, '2026-12-31');
});

test('opening the full editor again updates an unchanged handoff copy to the latest inline values', async () => {
  const f = harness(); await f.page.load(); f.page.inputReward(rowEvent('inline-lead', undefined, '22')); await f.page.open(rowEvent());
  f.page.inputReward(rowEvent('inline-lead', undefined, '33')); await f.page.open(rowEvent());
  assert.equal(f.drafts.loadDraft('submission-review', 'inline-reviewer', 'inline-lead').value.rewardText, '33');
  assert.equal(f.modals.length, 0);
});

test('an independently edited full draft is preserved and a different inline copy requires an explicit handoff choice', async () => {
  const f = harness(); await f.page.load(); f.page.inputReward(rowEvent('inline-lead', undefined, '22')); await f.page.open(rowEvent());
  const full = f.drafts.loadDraft('submission-review', 'inline-reviewer', 'inline-lead');
  f.drafts.saveDraft('submission-review', 'inline-reviewer', 'inline-lead', 7, { ...full.value, draft: { ...full.value.draft, conditions: 'Independently verified conditions' } });
  f.page.inputReward(rowEvent('inline-lead', undefined, '33')); f.setModalChoice(false); await f.page.open(rowEvent());
  assert.match(f.modals.at(-1)!.content, /不同/); assert.equal(f.navigations.length, 1);
  assert.equal(f.drafts.loadDraft('submission-review', 'inline-reviewer', 'inline-lead').value.draft.conditions, 'Independently verified conditions');
  assert.equal(f.drafts.loadDraft('submission-review-inline', 'inline-reviewer', 'inline-lead').value.rewardText, '33');
});

test('hiding the review page cancels an image preview while its authorized URLs are still loading', async () => {
  const item = pendingLead(); item.lead!.imageIds = ['source-shot'];
  const f = harness(item); const urls = deferred<{ id: string; url: string }[]>(); f.setShotResponse(urls.promise);
  await f.page.load(); const preview = f.page.openShot({ currentTarget: { dataset: { id: item.id, shot: 'source-shot' } } });
  f.page.onHide(); urls.resolve([{ id: 'source-shot', url: 'https://assets.example/source-shot.png' }]); await preview;
  assert.equal(f.page.data.viewerShow, false);
});

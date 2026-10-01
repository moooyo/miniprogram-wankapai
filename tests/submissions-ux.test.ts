import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as validation from '../domain/validation';
import * as activityCycle from '../shared/activity-cycle';
import * as recognitionForm from '../miniprogram/services/recognition-form';
import * as reviewForm from '../miniprogram/services/review-form';
import type { ActivityDraft, Submission, SubmissionStatus } from '../shared/contracts';

type Controller = { data: Record<string, any>; setData(values: Record<string, unknown>, callback?: () => void): void; [key: string]: any };
type Pending<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
function deferred<T>(): Pending<T> {
  let resolve!: Pending<T>['resolve'];
  let reject!: Pending<T>['reject'];
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const input = (field: string, value: string) => ({ currentTarget: { dataset: { field } }, detail: { value } });
function validDraft(): ActivityDraft {
  return { title: 'Weekend offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Eligible Visa credit cards', frequency: 'once', startsOn: '2026-09-01', endsOn: '2026-12-31', target: 1, unit: '次', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false, conditions: 'One eligible purchase', sourceUrl: 'https://bank.example/terms', sourceNote: '', entrance: { kind: 'guide', label: 'Offer entry', instructions: 'Bank app > offers', imageIds: [] } };
}
function submission(id: string, status: SubmissionStatus = 'pending', version = 1): Submission {
  return { id, ownerId: 'user-1', draft: validDraft(), status, reviewNote: '', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z', version };
}

function harness(route: 'review' | 'submission-edit' | 'submission-lead' | 'submissions', options: { storage?: Map<string, unknown>; query?: (action: string, payload: any) => Promise<unknown>; command?: (action: string, payload: any) => Promise<unknown>; ownerId?: string } = {}) {
  const storage = options.storage || new Map<string, unknown>();
  const commands: { action: string; payload: any }[] = [];
  const modals: any[] = [];
  const effects: string[] = [];
  const navigations: string[] = [];
  const scrolls: { selector: string; section: string; afterRender: boolean }[] = [];
  let modalAnswer: Promise<{ confirm: boolean }> = Promise.resolve({ confirm: true });
  let page!: Controller;
  let rendered = false;
  const wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    showModal: (value: unknown) => { modals.push(value); return modalAnswer; },
    pageScrollTo: (value: { selector: string }) => { scrolls.push({ selector: value.selector, section: page.data.openSection, afterRender: rendered }); },
    enableAlertBeforeUnload() { effects.push('enableAlert'); }, disableAlertBeforeUnload() { effects.push('disableAlert'); },
    setNavigationBarTitle() { effects.push('setTitle'); }, showToast() { effects.push('showToast'); },
    navigateBack() { effects.push('navigateBack'); }, redirectTo() { effects.push('redirectTo'); },
    navigateTo: ({ url }: { url: string }) => { navigations.push(url); },
  };
  const api = {
    query: options.query || (async (action: string) => action === 'submission.get' ? submission('s-1') : { items: [], nextCursor: null }),
    command: async (action: string, payload: unknown) => { commands.push({ action, payload }); return options.command ? options.command(action, payload) : { id: 's-1' }; },
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const javascript = ts.transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(javascript, {
      exports, wx, require: (id: string) => { assert.ok(id in imports, `Unexpected import: ${id}`); return imports[id]; },
      Page: (config: Controller) => {
        page = config;
        page.data = JSON.parse(JSON.stringify(config.data));
        page.setData = (values, callback) => {
          rendered = false;
          for (const [key, value] of Object.entries(values)) {
            const segments = key.split('.');
            let target = page.data;
            for (const segment of segments.slice(0, -1)) target = target[segment] ||= {};
            target[segments.at(-1)!] = value;
          }
          if (callback) { rendered = true; callback(); }
        };
      },
    }, { filename: file });
    return exports;
  }
  const drafts = evaluate('miniprogram/services/form-draft.ts');
  evaluate(`miniprogram/pages/${route}/index.ts`, {
    '../../services/api': { api, ensureSession: async () => ({ userId: options.ownerId || 'user-1', today: '2026-09-21', isModerator: true, demo: true }) },
    '../../../shared/catalog': catalog,
    '../../../domain/validation': validation,
    '../../../shared/activity-cycle': activityCycle,
    '../../services/recognition-form': recognitionForm,
    '../../services/review-form': reviewForm,
    '../../services/form-draft': drafts,
    '../../services/navigation': { navigateBackOr: () => { effects.push('navigateBack'); } },
  });
  return { page, commands, modals, scrolls, storage, effects, navigations,
    formDrafts: drafts as { saveDraft: (...args: any[]) => boolean; loadDraft: (...args: any[]) => any },
    setModalAnswer: (answer: Promise<{ confirm: boolean }>) => { modalAnswer = answer; } };
}

test('review ignores pagination from a status that has been replaced', async () => {
  const previousPage = deferred<unknown>();
  const { page } = harness('review', {
    query: async (_action, payload) => payload.cursor ? previousPage.promise : { items: [submission(payload.status, payload.status)], nextCursor: payload.status === 'pending' ? 'pending-page-2' : null },
  });
  await page.load();
  const pagination = page.loadMore();
  page.changeStatus({ currentTarget: { dataset: { status: 'published' } } });
  await tick();
  assert.equal(page.data.status, 'published');
  assert.equal(page.data.loadingMore, false);
  previousPage.resolve({ items: [submission('late-pending')], nextCursor: 'pending-page-3' });
  await pagination;
  assert.deepEqual(Array.from(page.data.items, (item: Submission) => item.id), ['published']);
  assert.equal(page.data.nextCursor, null);
  assert.equal(page.data.error, '');
});

test('an obsolete review request cannot clear a newer loading state or show its error', async () => {
  const pending = deferred<unknown>();
  const published = deferred<unknown>();
  const { page } = harness('review', { query: async (_action, payload) => payload.status === 'pending' ? pending.promise : published.promise });
  const firstLoad = page.load();
  await tick();
  page.changeStatus({ currentTarget: { dataset: { status: 'published' } } });
  await tick();
  pending.reject(new Error('Obsolete request failed'));
  await firstLoad;
  assert.equal(page.data.loading, true);
  assert.equal(page.data.error, '');
  published.resolve({ items: [submission('latest', 'published')], nextCursor: null });
  await tick();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.items[0].id, 'latest');
});

test('submission validation links its error summary to fields and retains independent errors', async () => {
  const { page, scrolls } = harness('submission-edit');
  await page.load();
  page.setData({ draft: { ...validDraft(), conditions: '', sourceUrl: '' }, targetText: '1', rewardText: '', openSection: 'source' });
  assert.equal(page.validate(), false);
  assert.equal(scrolls.at(-1)?.selector, '#validation-summary');
  page.goToError({ currentTarget: { dataset: { field: 'conditions' } } });
  assert.deepEqual(scrolls.at(-1), { selector: '#field-conditions', section: 'basic', afterRender: true });
  assert.ok(page.data.errors.conditions);
  assert.ok(page.data.errors.rewardText);
  assert.ok(page.data.errors.sourceNote);
  page.input(input('conditions', 'One eligible purchase'));
  assert.equal(page.data.errors.conditions, '');
  assert.ok(page.data.errors.rewardText);
  assert.ok(page.data.errors.sourceNote);
  page.setData({ 'draft.entrance.kind': 'web' });
  page.showFailure({ field: 'draft.entrance.url', message: 'Invalid entry' }, 'Invalid entry');
  assert.equal(scrolls.at(-1)?.selector, '#field-entrance-url');
  assert.equal(scrolls.at(-1)?.section, 'entrance');
  assert.ok(page.data.errors.rewardText);
});

test('returning edited review content requires confirmation and keeps the version assertion', async () => {
  const { page, modals, commands, setModalAnswer } = harness('submission-edit');
  page.setData({ reviewMode: true, submissionId: 's-1' });
  await page.load();
  page.input(input('title', 'Revised offer'));
  page.input(input('reviewNote', 'Please clarify the source'));
  const confirmation = deferred<{ confirm: boolean }>();
  setModalAnswer(confirmation.promise);
  const canceled = page.returnSubmission();
  assert.equal(page.data.saving, true);
  page.input(input('title', 'Must not edit during confirmation'));
  assert.equal(page.data.draft.title, 'Revised offer');
  assert.match(modals.at(-1).content, /不会保存/);
  confirmation.resolve({ confirm: false });
  await canceled;
  assert.equal(commands.length, 0);
  assert.equal(page.data.dirty, true);
  assert.equal(page.data.draftEdited, true);
  assert.equal(page.data.saving, false);
  setModalAnswer(Promise.resolve({ confirm: true }));
  await page.returnSubmission();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.decision, 'return');
  assert.equal(commands[0].payload.expectedVersion, 1);
  assert.equal('draft' in commands[0].payload, false);
  assert.equal(page.data.dirty, false);
});

test('a note-only review does not claim that activity content has been edited', async () => {
  const { page, commands, modals } = harness('submission-edit');
  page.setData({ reviewMode: true, submissionId: 's-1', sourceVerified: true });
  await page.load();
  page.setData({ sourceVerified: true });
  page.input(input('reviewNote', 'Please clarify the source'));
  assert.equal(page.data.draftEdited, false);
  assert.equal(page.data.sourceVerified, true);
  await page.returnSubmission();
  assert.equal(commands.length, 1);
  assert.equal(modals.length, 0);
  await page.returnSubmission();
  assert.equal(commands.length, 1, 'A successful review remains locked while navigation is pending.');
});

test('incomplete submissions survive reopening as private local drafts without submitting', async () => {
  const first = harness('submission-edit');
  await first.page.load();
  first.page.input(input('title', 'A lead to complete later'));
  first.page.input(input('conditions', 'Long notes that should survive leaving'));
  first.page.saveLocalDraft();
  assert.equal(first.commands.length, 0);
  assert.equal(first.storage.size, 1);
  const reopened = harness('submission-edit', { storage: first.storage });
  await reopened.page.load();
  assert.equal(reopened.page.data.draft.title, 'A lead to complete later');
  assert.equal(reopened.page.data.draft.conditions, 'Long notes that should survive leaving');
  assert.equal(reopened.page.data.dirty, true);
  assert.equal(reopened.commands.length, 0);
  await reopened.page.save();
  assert.equal(reopened.commands.length, 0);
  assert.ok(reopened.page.data.errors.sourceNote);
  const differentUser = harness('submission-edit', { storage: first.storage, ownerId: 'user-2' });
  await differentUser.page.load();
  assert.equal(differentUser.page.data.draft.title, '');
  assert.equal(differentUser.modals.length, 0);
});

test('restoring an old-version submission draft cannot overwrite a newer server version', async () => {
  const first = harness('submission-edit');
  first.page.setData({ submissionId: 's-1' });
  await first.page.load();
  first.page.input(input('title', 'Locally revised offer'));
  const reopened = harness('submission-edit', { storage: first.storage, query: async () => submission('s-1', 'pending', 2) });
  reopened.page.setData({ submissionId: 's-1' });
  await reopened.page.load();
  assert.equal(reopened.page.data.draft.title, 'Locally revised offer');
  assert.equal(reopened.page.data.conflict, true);
  await reopened.page.save();
  assert.equal(reopened.commands.length, 0);
  await reopened.page.reloadLatest();
  assert.equal(reopened.page.data.conflict, false);
  assert.equal(reopened.page.data.submission.version, 2);
  assert.equal(reopened.page.data.draft.title, 'Weekend offer');
  assert.equal(reopened.storage.size, 0);
});

for (const operation of ['save', 'returnSubmission'] as const) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`an unloaded submission ${operation} ${outcome} cannot delete or navigate a newer editor`, async () => {
      const pending = deferred<unknown>();
      const first = harness('submission-edit', { command: async () => pending.promise });
      if (operation === 'returnSubmission') first.page.setData({ reviewMode: true, submissionId: 's-1' });
      await first.page.load();
      if (operation === 'save') {
        first.page.setData({ draft: validDraft(), targetText: '1', rewardText: '20' });
        first.page.input(input('title', 'First editor draft'));
      } else first.page.input(input('reviewNote', 'First editor review note'));
      const saving = first.page[operation]();
      assert.equal(first.commands.length, 1);
      assert.equal(first.page.data.saving, true);
      // Capture after the creation intent is persisted and the command has begun.
      const savedAtRequest = structuredClone([...first.storage.values()][0]);
      if (operation === 'save') assert.equal((savedAtRequest as { value: { intentKey?: string } }).value.intentKey, first.page.creationIntentKey);
      first.page.onHide();
      assert.deepEqual([...first.storage.values()][0], savedAtRequest, 'Hiding an in-flight editor must not advance its draft revision.');
      first.page.onUnload();
      const originalEffects = first.effects.slice();
      const reopened = harness('submission-edit', { storage: first.storage });
      if (operation === 'returnSubmission') reopened.page.setData({ reviewMode: true, submissionId: 's-1' });
      else reopened.setModalAnswer(Promise.resolve({ confirm: false }));
      await reopened.page.load();
      reopened.page.input(input('title', 'New editor draft that must survive'));
      if (operation === 'save') {
        assert.equal(reopened.modals.length, 0, 'A pending creation must recover automatically without an abandonment prompt.');
        assert.equal(reopened.page.data.pendingCreationUnconfirmed, true);
        assert.equal(reopened.page.data.draft.title, 'First editor draft', 'Pending creation content must remain locked.');
        const saved = reopened.formDrafts.loadDraft('submission', 'user-1', 'new');
        assert.equal(reopened.formDrafts.saveDraft('submission', 'user-1', 'new', saved.baseVersion, {
          ...saved.value, draft: { ...saved.value.draft, title: 'New editor draft that must survive' },
        }), true);
        assert.notEqual(reopened.formDrafts.loadDraft('submission', 'user-1', 'new').revision, saved.revision);
      }
      const newerDraft = structuredClone([...first.storage.values()][0]);
      const reopenedError = reopened.page.data.error;
      if (outcome === 'success') pending.resolve({ id: 's-1' });
      else pending.reject({ code: 'VERSION_CONFLICT', message: 'Server content changed' });
      await saving;
      first.page.onHide();
      first.page.onUnload();
      assert.deepEqual([...first.storage.values()][0], newerDraft);
      assert.deepEqual(first.effects, originalEffects);
      assert.equal(reopened.page.data.draft.title, operation === 'save' ? 'First editor draft' : 'New editor draft that must survive');
      if (operation === 'save') assert.equal(reopened.formDrafts.loadDraft('submission', 'user-1', 'new').value.draft.title, 'New editor draft that must survive');
      assert.equal(reopened.page.data.conflict, false);
      assert.equal(reopened.page.data.error, reopenedError, 'An obsolete response must not replace the active editor feedback.');
      assert.equal(first.page.data.conflict, false);
    });
  }
}

test('a late submission with no original draft cannot remove a newly created draft', async () => {
  const pending = deferred<unknown>();
  const first = harness('submission-edit', { command: async () => pending.promise });
  await first.page.load();
  first.page.setData({ draft: validDraft(), targetText: '1', rewardText: '20' });
  assert.equal(first.storage.size, 0);
  const saving = first.page.save();
  first.page.onUnload();
  const reopened = harness('submission-edit', { storage: first.storage });
  await reopened.page.load();
  reopened.page.input(input('title', 'Newly created local lead'));
  assert.equal(reopened.page.data.pendingCreationUnconfirmed, true);
  assert.equal(reopened.page.data.draft.title, 'Weekend offer');
  const saved = reopened.formDrafts.loadDraft('submission', 'user-1', 'new');
  assert.equal(reopened.formDrafts.saveDraft('submission', 'user-1', 'new', saved.baseVersion, {
    ...saved.value, draft: { ...saved.value.draft, title: 'Newly created local lead' },
  }), true);
  assert.notEqual(reopened.formDrafts.loadDraft('submission', 'user-1', 'new').revision, saved.revision);
  const newerDraft = structuredClone([...first.storage.values()][0]);
  pending.resolve({ id: 's-1' });
  await saving;
  assert.deepEqual([...first.storage.values()][0], newerDraft);
  assert.equal(reopened.formDrafts.loadDraft('submission', 'user-1', 'new').value.draft.title, 'Newly created local lead');
  assert.equal(first.effects.includes('navigateBack'), false);
});

test('a lead form submits bank, title, and a source without requiring financial rules', async () => {
  const { page, commands, storage } = harness('submission-lead');
  await page.load();
  page.input(input('title', 'A bank offer lead'));
  page.selectBank({ detail: { value: '1' }, currentTarget: { dataset: {} } });
  page.input(input('sourceNote', 'Bank app > card offers > weekend offer'));
  await page.save();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'submission.lead.save');
  assert.deepEqual(Object.keys(commands[0].payload.lead).sort(), ['bankId', 'imageIds', 'sourceNote', 'sourceUrl', 'title']);
  assert.equal(commands[0].payload.lead.bankId, 'cmb');
  assert.equal('draft' in commands[0].payload, false);
  assert.equal(storage.size, 0);
  await page.save();
  assert.equal(commands.length, 1, 'A successful lead remains locked while navigation is pending.');
});

test('lead validation preserves unrelated errors and locates the field after rendering', async () => {
  const { page, commands, scrolls } = harness('submission-lead');
  await page.load();
  await page.save();
  assert.equal(commands.length, 0);
  assert.ok(page.data.errors.title);
  assert.ok(page.data.errors.bankId);
  assert.ok(page.data.errors.sourceNote);
  assert.equal(scrolls.at(-1)?.selector, '#field-title');
  assert.equal(scrolls.at(-1)?.afterRender, true);
  page.input(input('title', 'A bank offer lead'));
  assert.equal(page.data.errors.title, '');
  assert.ok(page.data.errors.bankId);
  assert.ok(page.data.errors.sourceNote);
});

test('reviewing a lead leaves unknown rules empty and keeps source screenshots separate from public entry images', async () => {
  const item: Submission = { ...submission('lead-1'), draft: null, lead: { title: 'Original bank lead', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app > offers', imageIds: ['source-image'] } };
  const { page, commands } = harness('submission-edit', { query: async action => action === 'submission.get' ? item : action === 'assets.get' ? [{ id: 'source-image', ownerId: 'user-1', fileId: 'cloud://source-image' }] : [{ id: 'source-image', url: 'https://asset.example/source-image' }] });
  page.setData({ reviewMode: true, submissionId: item.id });
  await page.load();
  await tick();
  assert.equal(page.data.leadReview, true);
  assert.equal(page.data.draft.title, 'Original bank lead');
  assert.equal(page.data.draft.startsOn, '');
  assert.equal(page.data.draft.endsOn, '');
  assert.equal(page.data.targetText, '');
  assert.equal(page.data.rewardText, '');
  assert.equal(page.data.draft.entrance.imageIds.length, 0);
  assert.equal(page.data.sourceImageRows.length, 1);
  await page.save();
  assert.equal(commands.length, 0);
  assert.ok(page.data.errors.startsOn);
  assert.ok(page.data.errors.endsOn);
  assert.ok(page.data.errors.targetText);
  assert.ok(page.data.errors.rewardText);
  page.useSourceImage({ currentTarget: { dataset: { id: 'source-image' } } });
  assert.deepEqual(Array.from(page.data.draft.entrance.imageIds), ['source-image']);
  assert.equal(page.data.sourceVerified, false);
});

test('submission lists distinguish incomplete leads from full drafts and open their matching editor', async () => {
  const leadItem: Submission = { ...submission('lead-1'), draft: null, lead: { title: 'Original bank lead', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app > offers', imageIds: [] } };
  const { page, navigations } = harness('submissions', { query: async () => ({ items: [leadItem, submission('full-1')], nextCursor: null }) });
  await page.load();
  assert.equal(page.data.items[0].titleText, 'Original bank lead');
  assert.equal(page.data.items[0].summaryText, 'Bank app > offers');
  assert.equal(page.data.items[0].isLead, true);
  assert.equal(page.data.items[1].isLead, false);
  page.open({ currentTarget: { dataset: { id: 'lead-1' } } });
  page.open({ currentTarget: { dataset: { id: 'full-1' } } });
  assert.deepEqual(navigations, ['/pages/submission-lead/index?id=lead-1', '/pages/submission-edit/index?id=full-1']);
});

test('a lead published by a moderator while its author is editing can recover into a read-only result', async () => {
  const item: Submission = { ...submission('lead-1'), draft: null, lead: { title: 'Original bank lead', bankId: 'cmb', sourceUrl: '', sourceNote: 'Bank app > offers', imageIds: [] } };
  let latest = item;
  const { page } = harness('submission-lead', { query: async () => latest, command: async () => { throw { code: 'IMMUTABLE', message: 'The submission was published' }; } });
  page.setData({ submissionId: item.id });
  await page.load();
  page.input(input('title', 'An author edit in progress'));
  await page.save();
  assert.equal(page.data.conflict, true);
  assert.equal(page.data.lead.title, 'An author edit in progress');
  latest = { ...item, status: 'published', draft: validDraft(), version: 2, activityId: 'published-1' };
  await page.reloadLatest();
  assert.equal(page.data.conflict, false);
  assert.equal(page.data.readOnly, true);
  assert.equal(page.data.submission.activityId, 'published-1');
});

test('continuing a new lead in the full form carries its context without submitting or inventing financial rules', async () => {
  const leadForm = harness('submission-lead');
  await leadForm.page.load();
  leadForm.page.input(input('title', 'A lead to complete'));
  leadForm.page.selectBank({ detail: { value: '3' }, currentTarget: { dataset: {} } });
  leadForm.page.input(input('sourceUrl', 'https://www.boc.cn/'));
  leadForm.page.input(input('sourceNote', 'Bank app > card offers'));
  leadForm.page.fillFullRules();
  assert.equal(leadForm.navigations.at(-1), '/pages/submission-edit/index?fromLead=1');
  const originalLead = structuredClone([...leadForm.storage.values()][0]);
  const fullForm = harness('submission-edit', { storage: leadForm.storage });
  fullForm.page.setData({ fromLead: true });
  await fullForm.page.load();
  assert.equal(fullForm.page.data.draft.title, 'A lead to complete');
  assert.equal(fullForm.page.data.draft.bankId, 'boc');
  assert.equal(fullForm.page.data.draft.sourceUrl, 'https://www.boc.cn/');
  assert.equal(fullForm.page.data.draft.sourceNote, 'Bank app > card offers');
  assert.equal(fullForm.page.data.draft.startsOn, '');
  assert.equal(fullForm.page.data.draft.endsOn, '');
  assert.equal(fullForm.page.data.targetText, '');
  assert.equal(fullForm.page.data.rewardText, '');
  assert.equal(fullForm.page.data.sourceVerified, false);
  assert.equal(fullForm.page.data.importedLead, true);
  assert.equal(fullForm.commands.length + leadForm.commands.length, 0);
  assert.deepEqual([...leadForm.storage.values()][0], originalLead);
});

test('restoring an existing full draft takes priority over newly supplied lead context', async () => {
  const previousFull = harness('submission-edit');
  await previousFull.page.load();
  previousFull.page.setData({ draft: validDraft(), targetText: '3', rewardText: '18.75' });
  previousFull.page.input(input('title', 'Full draft already in progress'));
  const leadForm = harness('submission-lead', { storage: previousFull.storage });
  await leadForm.page.load();
  leadForm.page.input(input('title', 'A different new lead'));
  leadForm.page.selectBank({ detail: { value: '3' }, currentTarget: { dataset: {} } });
  leadForm.page.input(input('sourceNote', 'A different bank path'));
  leadForm.page.fillFullRules();
  const resumed = harness('submission-edit', { storage: previousFull.storage });
  resumed.page.setData({ fromLead: true });
  await resumed.page.load();
  assert.equal(resumed.modals.length, 1);
  assert.equal(resumed.page.data.draft.title, 'Full draft already in progress');
  assert.equal(resumed.page.data.draft.bankId, 'cmb');
  assert.equal(resumed.page.data.targetText, '3');
  assert.equal(resumed.page.data.rewardText, '18.75');
  assert.equal(resumed.page.data.importedLead, false);
  assert.equal(resumed.commands.length, 0);
  assert.equal(previousFull.storage.size, 2);
});

test('lead screenshots remain source references across full-draft recovery and never become entry images automatically', async () => {
  const leadForm = harness('submission-lead');
  await leadForm.page.load();
  leadForm.page.setData({ 'lead.imageIds': ['source-image'] });
  leadForm.page.input(input('title', 'A screenshot lead'));
  leadForm.page.selectBank({ detail: { value: '1' }, currentTarget: { dataset: {} } });
  leadForm.page.fillFullRules();
  const query = async (action: string) => action === 'assets.get' ? [{ id: 'source-image', ownerId: 'user-1', fileId: 'cloud://source-image' }] : [{ id: 'source-image', url: 'https://asset.example/source-image' }];
  const fullForm = harness('submission-edit', { storage: leadForm.storage, query });
  fullForm.page.setData({ fromLead: true });
  await fullForm.page.load();
  await tick();
  assert.deepEqual(Array.from(fullForm.page.data.sourceImageIds), ['source-image']);
  assert.equal(fullForm.page.data.sourceImageRows.length, 1);
  assert.equal(fullForm.page.data.draft.entrance.imageIds.length, 0);
  const reopened = harness('submission-edit', { storage: leadForm.storage, query });
  await reopened.page.load();
  await tick();
  assert.deepEqual(Array.from(reopened.page.data.sourceImageIds), ['source-image']);
  assert.equal(reopened.page.data.sourceImageRows.length, 1);
  assert.equal(reopened.page.data.draft.entrance.imageIds.length, 0);
  assert.equal(reopened.page.data.importedLead, true);
  assert.equal(leadForm.storage.size, 2);
  assert.equal(leadForm.commands.length + fullForm.commands.length + reopened.commands.length, 0);
});

for (const outcome of ['success', 'failure'] as const) {
  test(`an unloaded lead ${outcome} cannot discard a newer lead draft or navigate the new editor`, async () => {
    const pending = deferred<unknown>();
    const first = harness('submission-lead', { command: async () => pending.promise });
    await first.page.load();
    first.page.input(input('title', 'Original lead'));
    first.page.selectBank({ detail: { value: '1' }, currentTarget: { dataset: {} } });
    first.page.input(input('sourceNote', 'Bank app > offers'));
    const saving = first.page.save();
    assert.equal(first.commands.length, 1);
    first.page.onUnload();
    const effects = first.effects.slice();
    const reopened = harness('submission-lead', { storage: first.storage });
    reopened.setModalAnswer(Promise.resolve({ confirm: false }));
    await reopened.page.load();
    reopened.page.input(input('title', 'New editor lead'));
    assert.equal(reopened.modals.length, 0, 'A pending creation must recover automatically without an abandonment prompt.');
    assert.equal(reopened.page.data.pendingCreationUnconfirmed, true);
    assert.equal(reopened.page.data.lead.title, 'Original lead', 'Pending creation content must remain locked.');
    const original = reopened.formDrafts.loadDraft('submission-lead', 'user-1', 'new');
    assert.equal(reopened.formDrafts.saveDraft('submission-lead', 'user-1', 'new', original.baseVersion, {
      ...original.value, lead: { ...original.value.lead, title: 'New editor lead' },
    }), true);
    assert.notEqual(reopened.formDrafts.loadDraft('submission-lead', 'user-1', 'new').revision, original.revision);
    const saved = structuredClone([...first.storage.values()][0]);
    if (outcome === 'success') pending.resolve({ id: 'lead-1' });
    else pending.reject({ code: 'VERSION_CONFLICT', message: 'The lead was updated' });
    await saving;
    assert.deepEqual([...first.storage.values()][0], saved);
    assert.deepEqual(first.effects, effects);
    assert.equal(reopened.page.data.lead.title, 'Original lead');
    assert.equal(reopened.formDrafts.loadDraft('submission-lead', 'user-1', 'new').value.lead.title, 'New editor lead');
    assert.equal(reopened.page.data.conflict, false);
  });
}

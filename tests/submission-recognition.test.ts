import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as validation from '../domain/validation';
import * as recognitionForm from '../miniprogram/services/recognition-form';
import { cycleWindow } from '../shared/activity-cycle';
import type { ActivityDraft, RecognitionResult } from '../shared/contracts';

type Controller = { data: Record<string, any>; setData(values: Record<string, unknown>, callback?: () => void): void; [key: string]: any };
const input = (field: string, value: string) => ({ currentTarget: { dataset: { field } }, detail: { value } });
const entrance = (instructions: string): ActivityDraft['entrance'] => ({ kind: 'guide', label: 'Activity entrance', instructions, imageIds: [] });
const response = (...items: { assetId: string; fields: Partial<ActivityDraft> }[]): RecognitionResult => ({ demo: true, items: items.map(item => ({ ...item, regions: [], recognized: true })) });

function harness(results: RecognitionResult[]) {
  const storage = new Map<string, unknown>();
  const requestedIds: string[][] = [];
  let page!: Controller;
  const wx = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, showToast() {}, pageScrollTo() {},
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}) {
    const exports: Record<string, unknown> = {};
    const javascript = ts.transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(javascript, { exports, wx,
      require: (id: string) => { assert.ok(id in imports, `Unexpected import: ${id}`); return imports[id]; },
      Page: (config: Controller) => {
        page = config;
        page.data = JSON.parse(JSON.stringify(config.data));
        page.setData = (values, callback) => {
          for (const [key, value] of Object.entries(values)) {
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
  evaluate('miniprogram/pages/submission-lead/index.ts', {
    '../../services/api': { api: { query: async (action: string, payload: { ids: string[] }) => {
      assert.equal(action, 'assets.recognize'); requestedIds.push(payload.ids.slice());
      const next = results.shift(); assert.ok(next, 'No recognition fixture remains'); return next;
    } } },
    '../../../shared/catalog': catalog,
    '../../../domain/validation': validation,
    '../../services/recognition-form': recognitionForm,
    '../../services/form-draft': drafts,
  });
  page.setData({ loading: false, ready: true, ownerId: 'recognition-owner', today: '2026-10-02' });
  return { page, requestedIds };
}

test('two screenshots in one batch preserve the manual start when only the end was recognized', async () => {
  const { page } = harness([response(
    { assetId: 'first', fields: { endsOn: '2026-12-01' } },
    { assetId: 'second', fields: { startsOn: '2026-08-01', endsOn: '2026-12-31' } },
  )]);
  page.setData({ 'lead.rules': { startsOn: '2026-10-01' }, 'lead.imageIds': ['first', 'second'] });
  await page.recognizeImages();
  assert.equal(page.data.lead.rules.startsOn, '2026-10-01');
  assert.equal(page.data.lead.rules.endsOn, '2026-12-31');
  assert.equal(Boolean(page.data.recognizedDates.startsOn), false);
  assert.equal(page.data.recognizedDates.endsOn, true);
  assert.equal(page.data.recognitionCount, 1);
  assert.equal(page.data.recognitionChips[0].id, 'time');
  assert.ok(page.data.recognitionChips.every((chip: { label: string }) => typeof chip.label === 'string'));
});

test('manual date edits clear only their provenance and clear the end provenance when the end is reset', async () => {
  const { page, requestedIds } = harness([
    response({ assetId: 'first', fields: { startsOn: '2026-10-01', endsOn: '2026-12-01' } }),
    response({ assetId: 'second', fields: { startsOn: '2026-08-01', endsOn: '2026-12-31' } }),
    response({ assetId: 'third', fields: { startsOn: '2026-01-01', endsOn: '2027-05-31' } }),
  ]);
  page.setData({ 'lead.imageIds': ['first'] }); await page.recognizeImages();
  page.selectRuleDate(input('startsOn', '2026-11-10'));
  assert.equal(Boolean(page.data.recognizedDates.startsOn), false);
  assert.equal(page.data.recognizedDates.endsOn, true);
  page.setData({ 'lead.imageIds': ['first', 'second'] }); await page.recognizeImages();
  assert.equal(page.data.lead.rules.startsOn, '2026-11-10');
  assert.equal(page.data.lead.rules.endsOn, '2026-12-31');
  page.selectRuleDate(input('startsOn', '2027-01-01'));
  assert.equal(page.data.lead.rules.endsOn, '');
  assert.equal(Boolean(page.data.recognizedDates.endsOn), false);
  page.setData({ 'lead.imageIds': ['first', 'second', 'third'] }); await page.recognizeImages();
  assert.equal(page.data.lead.rules.startsOn, '2027-01-01');
  assert.equal(page.data.lead.rules.endsOn, '2027-05-31');
  assert.deepEqual(requestedIds, [['first'], ['second'], ['third']]);
});

test('incremental recognition keeps the visible entry note synchronized while it remains recognized', async () => {
  const { page } = harness([
    response({ assetId: 'first', fields: { entrance: entrance('Recognized entry A') } }),
    response({ assetId: 'second', fields: { entrance: entrance('Recognized entry B') } }),
    response({ assetId: 'third', fields: { entrance: entrance('Recognized entry C') } }),
  ]);
  page.setData({ 'lead.imageIds': ['first'] }); await page.recognizeImages();
  assert.equal(page.data.lead.sourceNote, 'Recognized entry A');
  page.setData({ 'lead.imageIds': ['first', 'second'] }); await page.recognizeImages();
  assert.equal(page.data.lead.sourceNote, 'Recognized entry B');
  assert.equal(page.data.lead.rules.entrance.instructions, 'Recognized entry B');
  page.input(input('sourceNote', 'Manually verified entry'));
  page.setData({ 'lead.imageIds': ['first', 'second', 'third'] }); await page.recognizeImages();
  assert.equal(page.data.lead.sourceNote, 'Manually verified entry');
  assert.equal(page.data.lead.rules.entrance.instructions, 'Manually verified entry');
  assert.equal(page.data.recognizedFields.entrance, false);
  page.undoRecognition();
  assert.equal(page.data.lead.sourceNote, '');
  assert.deepEqual(Array.from(page.data.lead.imageIds), ['first', 'second', 'third']);
});

test('a future custom-cycle form previews the first anchored period without changing domain windows', () => {
  const cycle = { t: 'custom' as const, n: 3, unit: 'day' as const, anchor: '2026-10-10' };
  assert.equal(recognitionForm.cyclePreview(cycle, '2026-10-02'), '首期：10月10日 – 10月12日，尚未开始');
  assert.equal(recognitionForm.cyclePreview(cycle, '2026-10-10'), '当前周期：10月10日 – 10月12日，10月13日 00:00 重置');
  assert.deepEqual(cycleWindow(cycle, '2026-10-02'), { s: '2026-10-01', e: '2026-10-03', ns: '2026-10-04', ps: '2026-09-28' });
  assert.equal(recognitionForm.cyclePreview({ t: 'custom', n: 1, unit: 'month', anchor: '' }, '2026-10-02'), '选择活动开始日期后，将显示当前周期');
});

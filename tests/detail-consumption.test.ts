import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Consumption, Detail, Participation, Session, Stage, Wallet } from '../shared/contracts';
import { api } from '../miniprogram/services/api';
import { loadDraft, saveDraft } from '../miniprogram/services/form-draft';

type PageInstance = { data: Record<string, any>; patches: Record<string, unknown>[]; [key: string]: any };
type CommandCall = { action: string; payload: any; options?: { intentKey?: string; replayOnly?: boolean } };
type ConsumptionDraft = { amount: string; merchant: string; on: string; delta: string; pending: { intentKey: string; payload: any } | null;
  revokePending: { intentKey: string; payload: any } | null };
const ownerId = 'consumption-user';
const today = '2026-09-23';
let definition: PageInstance;
let currentDetail: Detail;
let pageStack: PageInstance[] = [];
let queryHandler: (action: string, payload: any) => Promise<any>;
let commandHandler: (action: string, payload: any, options?: CommandCall['options']) => Promise<any>;
let commands: CommandCall[] = [];
let toasts: string[] = [];
let modalConfirm = true;
let modalHandler: (() => Promise<{ confirm: boolean }>) | undefined;
let modalCalls = 0;
let warningWrites: { enabled: boolean; page: PageInstance | undefined }[] = [];
let storageWriteFailed = false;
const storage = new Map<string, unknown>();
const originalQuery = api.query;
const originalCommand = api.command;
const originalWx = (globalThis as any).wx;
const originalPages = (globalThis as any).getCurrentPages;

before(async () => {
  const runtime = globalThis as any;
  const originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/detail/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  commands = []; toasts = []; pageStack = []; modalConfirm = true; modalHandler = undefined; modalCalls = 0; warningWrites = []; storageWriteFailed = false; storage.clear();
  (globalThis as any).getCurrentPages = () => pageStack;
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => {
      if (storageWriteFailed) throw new Error('Storage unavailable');
      storage.set(key, structuredClone(value));
    },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showToast: ({ title }: { title: string }) => { toasts.push(title); },
    showModal: async () => { modalCalls += 1; return modalHandler ? modalHandler() : { confirm: modalConfirm }; },
    enableAlertBeforeUnload: () => { warningWrites.push({ enabled: true, page: pageStack.at(-1) }); },
    disableAlertBeforeUnload: () => { warningWrites.push({ enabled: false, page: pageStack.at(-1) }); },
  };
  queryHandler = async (action) => {
    if (action === 'session.get') return { userId: ownerId, demo: true, isModerator: false, today, month: '2026-09' };
    if (action === 'activity.get') return currentDetail;
    if (action === 'wallet.get') return wallet();
    throw new Error(`Unexpected query ${action}`);
  };
  commandHandler = async () => ({ id: 'consumption-new', version: 8 });
  api.query = (async (action: string, payload: any) => queryHandler(action, payload)) as typeof api.query;
  api.command = (async (action: string, payload: any, options?: CommandCall['options']) => {
    commands.push({ action, payload: structuredClone(payload), ...(options ? { options: structuredClone(options) } : {}) });
    return commandHandler(action, payload, options);
  }) as typeof api.command;
});

after(() => {
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).wx = originalWx;
  (globalThis as any).getCurrentPages = originalPages;
});

function activity(unit = '笔'): Activity {
  return {
    id: 'activity-a', revision: 1, status: 'published', title: 'Card benefit', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31',
    target: 3, unit, currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'card',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three purchases', sourceUrl: 'https://www.cmbchina.com/rules', sourceNote: 'Bank rules',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open bank benefits', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function consumption(id = 'consumption-a', patch: Partial<Consumption> = {}): Consumption {
  return { id, ownerId, participationId: 'record-a', amountMinor: 1234, currency: 'CNY', merchant: 'Cafe', consumedOn: '2026-09-21',
    progressDelta: 1, reversedAt: null, createdAt: '2026-09-21T00:00:00Z', ...patch };
}

function detail(unit = '笔', stage: Stage = 'in_progress'): Detail {
  const snapshot = activity(unit);
  const participation: Participation = {
    id: 'record-a', ownerId, activityId: snapshot.id, activityRevision: 1, scopeKey: 'card:eligible', cardId: 'eligible', snapshot,
    periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30', stage, progress: 1,
    registeredAt: null, startedAt: '2026-09-01', completedAt: stage === 'completed' || stage === 'received' ? '2026-09-22' : null,
    expectedOn: '2026-09-25', receivedOn: stage === 'received' ? '2026-09-23' : null, receivedMinor: stage === 'received' ? 2000 : null,
    version: 7, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z',
  };
  return { activity: snapshot, participation, tracking: null, eligible: true, assets: [], audit: [], history: [], consumptions: [consumption()] };
}

function wallet(): Wallet {
  return { cards: [{ id: 'eligible', ownerId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Travel card', createdAt: '2026-09-01' }], accounts: [], bills: [] };
}

async function initialize(value = detail()): Promise<PageInstance> {
  currentDetail = value;
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data), patches: [] };
  instance.setData = (patch: Record<string, unknown>) => { Object.assign(instance.data, patch); instance.patches.push(structuredClone(patch)); };
  pageStack = [instance];
  instance.onLoad({ activityId: value.activity.id, participationId: value.participation?.id || '' });
  await instance.load();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.error, '');
  return instance;
}

function input(value: string) { return { detail: { value } }; }
function selected(id: string) { return { currentTarget: { dataset: { id } } }; }
function session(): Session { return { userId: ownerId, demo: true, isModerator: false, today, month: '2026-09' }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function openForm(instance: PageInstance, amount = '12.34') {
  await instance.openConsumption();
  assert.equal(instance.data.showConsumption, true);
  instance.changeConsumptionAmount(input(amount));
  instance.changeConsumptionMerchant(input('Cafe'));
  instance.changeConsumptionDate(input('2026-09-21'));
}

for (const unit of ['笔', '次']) {
  test(`${unit} consumption uses the saved participation version and adds one unit with an optional amount`, async () => {
    const value = detail(unit);
    value.activity = { ...value.activity, revision: 2, unit: '元', target: 1000 };
    const instance = await initialize(value);
    await openForm(instance, '');
    await instance.saveConsumption();
    assert.equal(commands.length, 1);
    assert.equal(commands[0].action, 'participation.consume');
    assert.deepEqual(commands[0].payload, { participationId: 'record-a', merchant: 'Cafe', consumedOn: '2026-09-21', expectedVersion: 7 });
    assert.ok(commands[0].options?.intentKey, 'Every new consumption must carry a stable command intent.');
  });
}

test('currency progress requires money and derives the increment from exact minor units', async () => {
  const instance = await initialize(detail('元'));
  await openForm(instance, '');
  await instance.saveConsumption();
  assert.equal(commands.length, 0);
  assert.ok(instance.data.consumptionError);
  instance.changeConsumptionAmount(input('98.76'));
  await instance.saveConsumption();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].payload, { participationId: 'record-a', amountMinor: 9876, merchant: 'Cafe', consumedOn: '2026-09-21', progressDelta: 98.76, expectedVersion: 7 });
});

for (const { unit, currency, symbol } of [
  { unit: '港元', currency: 'HKD', symbol: 'HK$' },
  { unit: '澳门元', currency: 'MOP', symbol: 'MOP$' },
] as const) {
  test(`${currency} monetary targets automatically use the currency consumption amount as their progress increment`, async () => {
    const value = detail(unit);
    value.activity.currency = currency;
    value.participation!.snapshot.currency = currency;
    value.consumptions = [consumption('consumption-a', { currency })];
    const instance = await initialize(value);
    await openForm(instance, '150.25');
    assert.equal(instance.data.consumptionMode, 'amount');
    assert.equal(instance.data.consumptionCurrencySymbol, symbol);
    await instance.saveConsumption();
    assert.equal(commands.length, 1);
    assert.deepEqual(commands[0].payload, { participationId: 'record-a', amountMinor: 15025, merchant: 'Cafe', consumedOn: '2026-09-21', progressDelta: 150.25, expectedVersion: 7 });
  });
}

test('an over-target monetary consumption previews and writes its full actual amount without capping the progress', async () => {
  const value = detail('元');
  value.activity.target = 100;
  value.participation!.snapshot.target = 100;
  value.participation!.progress = 0;
  const instance = await initialize(value);
  await openForm(instance, '150');
  assert.equal(instance.data.consumptionNextProgress, 150);
  assert.match(instance.data.consumptionPreview, /150\/100/);
  await instance.saveConsumption();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.amountMinor, 15000);
  assert.equal(commands[0].payload.progressDelta, 150);
});

test('a points reward still records consumption as currency money with exact decimal minor units', async () => {
  const value = detail();
  value.activity.rewardKind = 'points';
  value.participation!.snapshot.rewardKind = 'points';
  const instance = await initialize(value);
  assert.equal(instance.data.view.consumptions[0].amount, '¥12.34');
  await openForm(instance, '150.25');
  assert.equal(instance.data.consumptionCurrencySymbol, '¥');
  await instance.saveConsumption();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.amountMinor, 15025);
});

test('an optional consumption amount still rejects negative or imprecise money', async () => {
  const instance = await initialize();
  await openForm(instance);
  for (const value of ['-1', '12.345', 'invalid']) {
    instance.setData({ consumptionAmount: value });
    await instance.saveConsumption();
    assert.equal(commands.length, 0);
    assert.ok(instance.data.consumptionError);
  }
  instance.changeConsumptionAmount(input('12.30'));
  await instance.saveConsumption();
  assert.equal(commands[0].payload.amountMinor, 1230);
});

test('other units require an explicit positive increment without inventing a one-unit purchase', async () => {
  const instance = await initialize(detail('公里'));
  await openForm(instance);
  for (const value of ['', '0', '-1', 'invalid']) {
    instance.setData({ consumptionDelta: value });
    await instance.saveConsumption();
    assert.equal(commands.length, 0);
    assert.ok(instance.data.consumptionError);
  }
  instance.changeConsumptionDelta(input('2.5'));
  await instance.saveConsumption();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].payload, { participationId: 'record-a', amountMinor: 1234, merchant: 'Cafe', consumedOn: '2026-09-21', progressDelta: 2.5, expectedVersion: 7 });
});

test('consumption dates stay inside the saved participation period and reject invalid calendar dates', async () => {
  const value = detail();
  value.participation = { ...value.participation!, periodKey: '2026-08', startsOn: '2026-08-01', endsOn: '2026-08-31' };
  const instance = await initialize(value);
  await openForm(instance);
  for (const date of ['2026-07-31', '2026-09-01', '2026-08-32', '2026-02-31', '2026-09-24']) {
    instance.changeConsumptionDate(input(date));
    await instance.saveConsumption();
    assert.equal(commands.length, 0, `Date ${date} must not produce a command.`);
    assert.ok(instance.data.consumptionError);
  }
  instance.changeConsumptionDate(input('2026-08-31'));
  await instance.saveConsumption();
  assert.equal(commands[0].payload.consumedOn, '2026-08-31');
});

test('a future consumption date inside the current period cannot be recorded before the server day', async () => {
  const instance = await initialize();
  await openForm(instance);
  instance.changeConsumptionDate(input('2026-09-24'));
  await instance.saveConsumption();
  assert.equal(commands.length, 0);
  assert.ok(instance.data.consumptionError);
  instance.changeConsumptionDate(input(today));
  await instance.saveConsumption();
  assert.equal(commands[0].payload.consumedOn, today);
});

for (const gate of ['received', 'skipped', 'withdrawn', 'missing'] as const) {
  test(`${gate} participation cannot open or submit a consumption`, async () => {
    const value = detail();
    if (gate === 'received') value.participation!.stage = 'received';
    if (gate === 'skipped') value.participation!.stage = 'skipped';
    if (gate === 'withdrawn') value.participation!.withdrawnAt = '2026-09-22T00:00:00Z';
    if (gate === 'missing') { value.participation = null; value.consumptions = []; }
    const instance = await initialize(value);
    await instance.openConsumption();
    assert.equal(instance.data.showConsumption, false);
    instance.setData({ showConsumption: true, consumptionAmount: '12.34', consumptionMerchant: 'Cafe', consumptionOn: '2026-09-21' });
    await instance.saveConsumption();
    assert.equal(commands.length, 0, 'A stale event must repeat the authorization gate before writing.');
  });
}

test('consumption details open only actual rows and never synthesize a record from an unknown id', async () => {
  const value = detail();
  value.consumptions = [consumption('first'), consumption('second', { merchant: 'Station', amountMinor: null, progressDelta: 2 })];
  const instance = await initialize(value);
  await instance.openConsumptionRecord(selected('unknown'));
  assert.equal(instance.data.showConsumptionRecord, false);
  await instance.openConsumptionRecord(selected('second'));
  assert.equal(instance.data.showConsumptionRecord, true);
  assert.equal(instance.data.selectedConsumptionId, 'second');
  assert.deepEqual(instance.data.selectedConsumption, value.consumptions![1]);
  assert.deepEqual(instance.data.view.consumptions.map((row: any) => row.id).sort(), ['first', 'second']);
  assert.equal(commands.length, 0);
});

test('an ambiguous failure freezes the exact payload and intent until retry resolves the same purchase', async () => {
  const instance = await initialize();
  await openForm(instance);
  commandHandler = async () => { throw Object.assign(new Error('Connection lost'), { code: 'NETWORK_ERROR' }); };
  await instance.saveConsumption();
  assert.equal(commands.length, 1);
  const first = structuredClone(commands[0]);
  assert.ok(first.options?.intentKey);
  assert.equal(instance.data.showConsumption, true);
  assert.ok(instance.data.consumptionPending);
  instance.changeConsumptionAmount(input('99.99'));
  instance.changeConsumptionMerchant(input('Different merchant'));
  instance.changeConsumptionDate(input('2026-09-22'));
  instance.changeConsumptionDelta(input('9'));
  instance.chooseConsumptionPreset({ currentTarget: { dataset: { value: 999 } } });
  assert.equal(instance.data.consumptionAmount, '12.34');
  assert.equal(instance.data.consumptionMerchant, 'Cafe');
  assert.equal(instance.data.consumptionOn, '2026-09-21');
  await instance.closeConsumption();
  assert.equal(instance.data.showConsumption, false);
  assert.deepEqual(instance.data.consumptionPending.payload, first.payload, 'Closing the sheet must preserve the possibly committed request.');
  await instance.openConsumption();
  assert.equal(instance.data.showConsumption, true);
  assert.equal(instance.data.consumptionAmount, '12.34');
  commandHandler = async () => ({ id: 'consumption-new', version: 8 });
  await instance.retryConsumption();
  assert.equal(commands.length, 2);
  assert.equal(commands[1].action, first.action);
  assert.deepEqual(commands[1].payload, first.payload);
  assert.equal(commands[1].options?.intentKey, first.options?.intentKey);
  assert.equal(instance.data.consumptionPending, null);
});

test('a changed session identity cannot dispatch the saved owner consumption', async () => {
  const instance = await initialize();
  await openForm(instance);
  const fallback = queryHandler;
  queryHandler = async (action, payload) => action === 'session.get'
    ? { userId: 'different-user', demo: true, isModerator: false, today, month: '2026-09' }
    : fallback(action, payload);
  await instance.saveConsumption();
  assert.equal(commands.length, 0);
  assert.equal(instance.data.busy, false);
  assert.ok(instance.data.consumptionPending);
  assert.equal(instance.data.consumptionPending.payload.participationId, 'record-a');
});

test('a consumption cannot dispatch when its prepared pending intent fails to reach local storage', async () => {
  const instance = await initialize();
  await openForm(instance, '150.25');
  storageWriteFailed = true;
  await instance.saveConsumption();
  assert.equal(commands.length, 0);
  assert.equal(instance.data.busy, false);
  assert.equal(instance.data.showConsumption, true);
  assert.equal(instance.data.consumptionPending, null, 'A request that was never dispatched must not remain marked as ambiguous.');
  assert.equal(instance.data.consumptionAmount, '150.25');
  assert.equal(instance.data.consumptionMerchant, 'Cafe');
  assert.equal(instance.data.consumptionOn, '2026-09-21');
  assert.match(`${instance.data.consumptionError} ${instance.data.consumptionNotice}`, /未发送/);
  assert.equal(loadDraft<ConsumptionDraft>('detail-consumption', ownerId, 'record-a')?.value.pending, null);
  assert.equal(instance.data.detail.participation.version, 7);
  assert.equal(instance.data.detail.participation.progress, 1);
});

test('an ambiguous consumption request is durable before dispatch and restores its exact identity after unload', async () => {
  const original = await initialize();
  await openForm(original);
  let savedAtDispatch: ConsumptionDraft | undefined;
  commandHandler = async () => {
    savedAtDispatch = loadDraft<ConsumptionDraft>('detail-consumption', ownerId, 'record-a')?.value;
    throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' });
  };
  await original.saveConsumption();
  const first = structuredClone(commands[0]);
  assert.equal(savedAtDispatch?.pending?.intentKey, first.options?.intentKey);
  assert.deepEqual(savedAtDispatch?.pending?.payload, first.payload);
  original.onUnload();
  const restored = await initialize(currentDetail);
  await restored.openConsumption();
  assert.equal(restored.data.consumptionAmount, '12.34');
  assert.equal(restored.data.consumptionMerchant, 'Cafe');
  assert.equal(restored.data.consumptionOn, '2026-09-21');
  assert.equal(restored.data.consumptionPending.intentKey, first.options?.intentKey);
  assert.deepEqual(restored.data.consumptionPending.payload, first.payload);
  commandHandler = async () => ({ id: 'consumption-new', version: 8 });
  await restored.retryConsumption();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].payload, first.payload);
  assert.equal(commands[1].options?.intentKey, first.options?.intentKey);
});

test('a restored pending purchase from a closed period only queries its original committed result', async () => {
  const value = detail();
  value.participation = { ...value.participation!, periodKey: '2026-08', startsOn: '2026-08-01', endsOn: '2026-08-31' };
  value.consumptions = [consumption('consumption-a', { consumedOn: '2026-08-21' })];
  const original = await initialize(value);
  await openForm(original);
  original.changeConsumptionDate(input('2026-08-21'));
  commandHandler = async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); };
  await original.saveConsumption();
  const first = structuredClone(commands[0]);
  assert.equal(first.payload.consumedOn, '2026-08-21', 'A new historical purchase still uses its actual saved-period date.');
  assert.equal(first.payload.participationId, 'record-a');
  assert.equal(first.payload.expectedVersion, 7);
  assert.notEqual(first.options?.replayOnly, true, 'A fresh saved-period purchase must issue a write before later recovery can look up that write.');
  original.onUnload();
  const restored = await initialize(value);
  await restored.openConsumption();
  commandHandler = async () => ({ id: 'consumption-new', version: 8 });
  await restored.retryConsumption();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].payload, first.payload);
  assert.equal(commands[1].options?.intentKey, first.options?.intentKey);
  assert.equal(commands[1].options?.replayOnly, true, 'Recovery must not issue a fresh write into a closed period.');
});

test('a version conflict retains the form and requires review before a new increment uses the latest version', async () => {
  const instance = await initialize();
  await openForm(instance);
  commandHandler = async () => { throw Object.assign(new Error('Record changed'), { code: 'VERSION_CONFLICT', field: 'expectedVersion' }); };
  await instance.saveConsumption();
  const first = structuredClone(commands[0]);
  assert.ok(instance.data.consumptionConflict);
  assert.equal(instance.data.showConsumption, true);
  assert.equal(instance.data.consumptionAmount, '12.34');
  assert.equal(instance.data.consumptionPending, null, 'An explicit conflict is a known rejection rather than an ambiguous commit.');
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 9, progress: 2 } };
  await instance.reloadConsumption();
  assert.equal(instance.data.consumptionReapplyRequired, true);
  await instance.saveConsumption();
  assert.equal(commands.length, 1, 'Reading the new version must not authorize another increment by itself.');
  instance.changeConsumptionAmount(input('50'));
  assert.equal(instance.data.consumptionAmount, '12.34');
  await instance.reviewConsumption();
  assert.equal(instance.data.consumptionReapplyRequired, false);
  commandHandler = async () => ({ id: 'consumption-new', version: 10 });
  await instance.saveConsumption();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].payload, { ...first.payload, expectedVersion: 9 });
  assert.notEqual(commands[1].options?.intentKey, first.options?.intentKey);
});

test('an edited unsubmitted consumption must review a refreshed participation before using its latest version', async () => {
  const instance = await initialize();
  await openForm(instance, '150.25');
  assert.equal(instance.data.consumptionPending, null);
  assert.equal(instance.data.consumptionBaseVersion, 7);
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8, progress: 2 } };
  await instance.load();
  assert.equal(instance.data.consumptionAmount, '150.25');
  assert.equal(instance.data.consumptionMerchant, 'Cafe');
  assert.equal(instance.data.consumptionOn, '2026-09-21');
  assert.equal(instance.data.consumptionConflict, true);
  assert.equal(instance.data.consumptionReapplyRequired, true);
  await instance.saveConsumption();
  assert.equal(commands.length, 0, 'A refresh must not silently replace the version originally reviewed by the form.');
  await instance.reloadConsumption();
  await instance.saveConsumption();
  assert.equal(commands.length, 0, 'Reading the latest record still requires an explicit review action.');
  await instance.reviewConsumption();
  assert.equal(instance.data.consumptionBaseVersion, 8);
  commandHandler = async () => ({ id: 'consumption-new', version: 9 });
  await instance.saveConsumption();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].payload, { participationId: 'record-a', amountMinor: 15025, merchant: 'Cafe', consumedOn: '2026-09-21', expectedVersion: 8 });
});

test('a saved draft recovery decision cannot silently adopt a version refreshed while its dialog was open', async () => {
  const value = detail();
  saveDraft('detail-consumption', ownerId, 'record-a', 7, { amount: '12.34', merchant: 'Cafe', on: '2026-09-21', delta: '',
    pending: null, revokePending: null, selectedId: '' });
  const instance = await initialize(value);
  const decision = deferred<{ confirm: boolean }>();
  modalHandler = () => decision.promise;
  const opening = instance.openConsumption();
  assert.equal(modalCalls, 1);
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8, progress: 2 } };
  await instance.load();
  decision.resolve({ confirm: true });
  await opening;
  assert.equal(instance.data.showConsumption, true);
  assert.equal(instance.data.consumptionAmount, '12.34');
  assert.equal(instance.data.consumptionReapplyRequired, true);
  await instance.saveConsumption();
  assert.equal(commands.length, 0, 'Recovery may restore the input but cannot authorize another increment on an unreviewed version.');
});

test('a held successful save clears its acknowledged input after a refresh and cannot append the same purchase again', async () => {
  const instance = await initialize();
  await openForm(instance);
  const pending = deferred<{ id: string; version: number }>();
  const started = deferred<void>();
  commandHandler = () => { started.resolve(); return pending.promise; };
  const saving = instance.saveConsumption();
  await started.promise;
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8, progress: 2 },
    consumptions: [...currentDetail.consumptions!, consumption('consumption-new')] };
  await instance.load();
  pending.resolve({ id: 'consumption-new', version: 8 });
  await saving;
  assert.equal(instance.data.consumptionPending, null);
  assert.equal(instance.data.consumptionDirty, false);
  await instance.saveConsumption();
  assert.equal(commands.length, 1, 'An acknowledgement from the old view must not leave resubmittable purchase data.');
});

for (const action of ['save', 'revoke'] as const) {
  for (const transition of ['hide', 'refresh'] as const) {
    test(`a pending session read cannot dispatch consumption ${action} after ${transition}`, async () => {
      const instance = await initialize();
      if (action === 'save') await openForm(instance);
      else await instance.openConsumptionRecord(selected('consumption-a'));
      const request = deferred<Session>();
      const started = deferred<void>();
      const fallback = queryHandler;
      queryHandler = async (name, payload) => {
        if (name !== 'session.get') return fallback(name, payload);
        started.resolve();
        return request.promise;
      };
      const mutation = action === 'save' ? instance.saveConsumption() : instance.revokeConsumption();
      await started.promise;
      if (transition === 'hide') {
        instance.onHide();
        const next: PageInstance = { data: { busy: true }, patches: [] };
        pageStack = [instance, next];
      } else {
        currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8 },
          ...(action === 'revoke' ? { consumptions: [consumption('consumption-a', { reversedAt: today })] } : {}) };
        await instance.load();
      }
      request.resolve(session());
      await mutation;
      assert.equal(commands.length, 0, 'The page context must still own the user action at the first actual dispatch.');
      assert.equal(instance.data.busy, false);
      assert.ok(action === 'save' ? instance.data.consumptionPending : instance.data.consumptionRevokePending);
    });
  }
}

for (const lifecycle of ['onHide', 'onUnload'] as const) {
  test(`${lifecycle} prevents a delayed consumption save from closing another page or displaying success`, async () => {
    const instance = await initialize();
    await openForm(instance);
    const pending = deferred<{ id: string; version: number }>();
    const started = deferred<void>();
    commandHandler = () => { started.resolve(); return pending.promise; };
    const saving = instance.saveConsumption();
    await started.promise;
    assert.equal(commands.length, 1);
    instance[lifecycle]();
    const next: PageInstance = { data: { busy: true, showConsumption: true }, patches: [] };
    pageStack = [instance, next];
    const nextState = structuredClone(next.data);
    const patchCount = instance.patches.length;
    const warnings = warningWrites.length;
    const toastCount = toasts.length;
    pending.resolve({ id: 'consumption-new', version: 8 });
    await saving;
    assert.deepEqual(next.data, nextState);
    assert.equal(toasts.length, toastCount);
    assert.equal(warningWrites.length, warnings);
    if (lifecycle === 'onUnload') assert.equal(instance.patches.length, patchCount, 'An unloaded page must not receive late UI patches.');
  });
}

test('an unloaded save cannot erase the newer purchase draft or release its busy state', async () => {
  const original = await initialize();
  await openForm(original);
  const oldRequest = deferred<{ id: string; version: number }>();
  const oldStarted = deferred<void>();
  commandHandler = () => { oldStarted.resolve(); return oldRequest.promise; };
  const oldSaving = original.saveConsumption();
  await oldStarted.promise;
  const oldIntent = commands[0].options?.intentKey;
  original.onUnload();
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8, progress: 2 },
    consumptions: [...currentDetail.consumptions!, consumption('consumption-new')] };
  const replacement = await initialize(currentDetail);
  await replacement.openConsumption();
  commandHandler = async () => ({ id: 'consumption-new', version: 8 });
  await replacement.retryConsumption();
  assert.equal(commands[1].options?.intentKey, oldIntent);
  await openForm(replacement, '45.67');
  const newRequest = deferred<{ id: string; version: number }>();
  const newStarted = deferred<void>();
  commandHandler = () => { newStarted.resolve(); return newRequest.promise; };
  const newSaving = replacement.saveConsumption();
  await newStarted.promise;
  const newerDraft = loadDraft<ConsumptionDraft>('detail-consumption', ownerId, 'record-a');
  assert.ok(newerDraft?.value.pending);
  assert.notEqual(newerDraft.value.pending.intentKey, oldIntent);
  const patchCount = replacement.patches.length;
  const toastCount = toasts.length;
  oldRequest.resolve({ id: 'consumption-new', version: 8 });
  await oldSaving;
  assert.equal(replacement.data.busy, true);
  assert.equal(replacement.patches.length, patchCount);
  assert.equal(toasts.length, toastCount);
  assert.deepEqual(loadDraft<ConsumptionDraft>('detail-consumption', ownerId, 'record-a'), newerDraft,
    'The old acknowledgement must only remove the draft revision that its own request dispatched.');
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 9, progress: 3, stage: 'completed' } };
  newRequest.resolve({ id: 'consumption-newer', version: 9 });
  await newSaving;
  assert.equal(replacement.data.busy, false);
});

test('revoking an actual consumption targets its id and the current participation version', async () => {
  const instance = await initialize();
  await instance.openConsumptionRecord(selected('consumption-a'));
  await instance.revokeConsumption();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'consumption.revoke');
  assert.deepEqual(commands[0].payload, { id: 'consumption-a', expectedVersion: 7 });
});

test('a revoke cannot dispatch when its prepared pending intent fails to reach local storage', async () => {
  const instance = await initialize();
  await openForm(instance, '150.25');
  await instance.closeConsumption();
  await instance.openConsumptionRecord(selected('consumption-a'));
  const originalRecord = structuredClone(instance.data.selectedConsumption);
  storageWriteFailed = true;
  await instance.revokeConsumption();
  assert.equal(commands.length, 0);
  assert.equal(instance.data.busy, false);
  assert.equal(instance.data.showConsumptionRecord, true);
  assert.equal(instance.data.consumptionRevokePending, null, 'A revoke that was never dispatched must not remain marked as ambiguous.');
  assert.equal(instance.data.selectedConsumptionId, 'consumption-a');
  assert.deepEqual(instance.data.selectedConsumption, originalRecord);
  assert.equal(instance.data.consumptionAmount, '150.25');
  assert.equal(instance.data.consumptionMerchant, 'Cafe');
  assert.equal(instance.data.consumptionOn, '2026-09-21');
  assert.match(`${instance.data.consumptionError} ${instance.data.consumptionNotice}`, /未发送/);
  assert.equal(loadDraft<ConsumptionDraft>('detail-consumption', ownerId, 'record-a')?.value.revokePending, null);
  assert.equal(instance.data.detail.participation.version, 7);
  assert.equal(instance.data.detail.participation.progress, 1);
});

test('an ambiguous revoke restores its original intent by lookup after refresh shows the record reversed', async () => {
  const instance = await initialize();
  await instance.openConsumptionRecord(selected('consumption-a'));
  commandHandler = async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); };
  await instance.revokeConsumption();
  const first = structuredClone(commands[0]);
  assert.ok(instance.data.consumptionRevokePending);
  assert.ok(first.options?.intentKey);
  instance.onUnload();
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8, progress: 0 },
    consumptions: [consumption('consumption-a', { reversedAt: today })] };
  const restored = await initialize(currentDetail);
  await restored.openConsumptionRecord(selected('consumption-a'));
  assert.deepEqual(restored.data.consumptionRevokePending, instance.data.consumptionRevokePending);
  commandHandler = async () => ({ id: 'consumption-a', version: 8 });
  await restored.retryConsumptionRevoke();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].payload, first.payload);
  assert.equal(commands[1].options?.intentKey, first.options?.intentKey);
  assert.equal(commands[1].options?.replayOnly, true);
  assert.equal(restored.data.consumptionRevokePending, null);
});

test('a missing pending revoke record cannot be replaced by another real consumption row', async () => {
  const instance = await initialize();
  await instance.openConsumptionRecord(selected('consumption-a'));
  commandHandler = async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); };
  await instance.revokeConsumption();
  const first = structuredClone(commands[0]);
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8 }, consumptions: [consumption('another-row')] };
  await instance.load();
  await instance.openConsumptionRecord(selected('another-row'));
  await instance.retryConsumptionRevoke();
  assert.equal(commands.length, 1);
  assert.deepEqual(instance.data.consumptionRevokePending.payload, first.payload);
  assert.equal(instance.data.consumptionRevokePending.intentKey, first.options?.intentKey);
  assert.ok(instance.data.consumptionError);
});

test('a selected consumption that becomes reversed during refresh cannot revoke its stale cached row', async () => {
  const instance = await initialize();
  await instance.openConsumptionRecord(selected('consumption-a'));
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, version: 8 }, consumptions: [consumption('consumption-a', { reversedAt: today })] };
  await instance.load();
  assert.equal(instance.data.selectedConsumption.reversedAt, today);
  await instance.revokeConsumption();
  assert.equal(commands.length, 0);
});

for (const gate of ['received', 'skipped', 'withdrawn', 'reversed'] as const) {
  test(`${gate} consumption detail cannot submit a revoke through a stale event`, async () => {
    const value = detail();
    if (gate === 'received') value.participation!.stage = 'received';
    if (gate === 'skipped') value.participation!.stage = 'skipped';
    if (gate === 'withdrawn') value.participation!.withdrawnAt = today;
    if (gate === 'reversed') value.consumptions = [consumption('consumption-a', { reversedAt: today })];
    const instance = await initialize(value);
    await instance.openConsumptionRecord(selected('consumption-a'));
    await instance.revokeConsumption();
    assert.equal(commands.length, 0);
  });
}

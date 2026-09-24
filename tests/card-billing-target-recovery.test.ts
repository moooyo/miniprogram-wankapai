import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, ApiEnvelope, ApiRequest, Bill, BillingAccount, Card, Commands } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import { loadDraft } from '../miniprogram/services/form-draft';
import settings from '../miniprogram/runtime-config';

type PageInstance = { data: Record<string, any>; [key: string]: any };
type RecordedRequest = { action: ApiRequest['action']; payload: any; requestId?: string };
type CloudResponse = { result: ApiEnvelope<unknown> };
type Transport = (request: RecordedRequest, execute: () => Promise<CloudResponse>) => Promise<CloudResponse>;

const originalWx = (globalThis as any).wx;
const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId, templateIds: settings.templateIds };
const storage = new Map<string, unknown>();
let definition: PageInstance;
let fixtureSequence = 0;
let f: ReturnType<typeof fixture>;
let requests: RecordedRequest[];
let transport: Transport;
let navigationCount: number;

function fixture() {
  const prefix = `billing-recovery-${++fixtureSequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const account = (suffix: string, dueDay: number): BillingAccount => ({
    id: `${prefix}-account-${suffix}`, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn',
    label: `Account ${suffix}`, statementDay: 5, dueDay, dueMonthOffset: 0, remindDays: 3, enabled: true,
  });
  const x = account('x', 26), y = account('y', 27);
  const card = (suffix: string, billingAccountId: string): Card => ({
    id: `${prefix}-card-${suffix}`, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit',
    nickname: `Card ${suffix}`, billingAccountId, createdAt: '2026-09-01T04:00:00.000Z',
  });
  const primary = card('primary', x.id), sibling = card('sibling', y.id);
  const bill = (value: BillingAccount): Bill => ({
    id: `${value.id}-september`, ownerId: actor.userId, billingAccountId: value.id, periodKey: '2026-09',
    statementOn: '2026-09-05', dueOn: `2026-09-${value.dueDay}`, paidAt: null,
  });
  const xBill = bill(x), yBill = bill(y);
  const templateIds = {
    new_activity: `${prefix}-new-activity`, deadline: `${prefix}-deadline`,
    reward: `${prefix}-reward`, repayment: `${prefix}-repayment`,
  };
  const store = new MemoryStore({
    cards: { [primary.id]: primary, [sibling.id]: sibling },
    billing_accounts: { [x.id]: x, [y.id]: y }, bills: { [xBill.id]: xBill, [yBill.id]: yBill },
  });
  let now = new Date('2026-09-23T04:00:00.000Z');
  const service = createService(store, { now: () => now, demo: true, templateIds });
  return { prefix, actor, x, y, primary, sibling, xBill, yBill, templateIds, store, service,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); } };
}

before(async () => {
  const runtime = globalThis as any;
  const originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/card-edit/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  f = fixture();
  storage.clear();
  requests = [];
  navigationCount = 0;
  settings.mode = 'cloud';
  settings.cloudEnvId = `${f.prefix}-environment`;
  settings.templateIds = f.templateIds;
  transport = async (_request, execute) => execute();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showModal: async () => ({ confirm: true }),
    nextTick: (callback: () => void) => callback(),
    pageScrollTo() {}, showToast() {}, setNavigationBarTitle() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    navigateBack: () => { navigationCount += 1; }, switchTab: () => { navigationCount += 1; },
    cloud: {
      init() {},
      callFunction: async ({ data }: { data: ApiRequest }) => {
        const request = structuredClone(data) as RecordedRequest;
        requests.push(request);
        return transport(request, async () => {
          try { return { result: { ok: true, data: await f.service.execute(f.actor, request as ApiRequest) } }; }
          catch (error) {
            if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
            throw error;
          }
        });
      },
    },
  };
});

after(() => {
  settings.mode = originalSettings.mode;
  settings.cloudEnvId = originalSettings.cloudEnvId;
  settings.templateIds = originalSettings.templateIds;
  if (originalWx === undefined) delete (globalThis as any).wx;
  else (globalThis as any).wx = originalWx;
});

async function initialize(): Promise<PageInstance> {
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data) };
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => { Object.assign(instance.data, patch); callback?.(); };
  instance.setData({ id: f.primary.id, initialBankId: 'cmb', editing: true });
  await instance.load();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.failed, false);
  return instance;
}

function draft(instance: PageInstance) {
  return loadDraft<Record<string, any>>('card', instance.data.userId, instance.data.draftEntityId);
}

function fields(instance: PageInstance): Record<string, unknown> {
  return structuredClone(Object.fromEntries([
    'bankIndex', 'issuerIndex', 'networkIndex', 'kind', 'nickname', 'reminderEnabled', 'billingIndex',
    'statementDay', 'dueDay', 'dueMonthOffset', 'dueOn', 'remindIndex',
  ].map(key => [key, instance.data[key]])));
}

function mutations(): RecordedRequest[] {
  return requests.filter(request => request.requestId !== undefined);
}

function cardPayload(): Commands['card.save'] {
  return { id: f.primary.id, bankId: f.primary.bankId, issuerId: f.primary.issuerId, network: f.primary.network,
    kind: f.primary.kind, nickname: f.primary.nickname };
}

async function saveOrdinaryTargetDraft() {
  const original = await initialize();
  assert.equal(original.data.billingTarget.accountId, f.x.id);
  assert.equal(original.data.billingTarget.billId, f.xBill.id);
  original.changeNickname({ detail: { value: 'Retained card name' } });
  original.changeStatement({ detail: { value: '6' } });
  original.changeRemind({ detail: { value: '3' } });
  original.changeDueDate({ detail: { value: '2026-09-28' } });
  const input = fields(original);
  const target = structuredClone(original.data.billingTarget);
  const saved = draft(original)!;
  assert.ok(saved);
  assert.equal(saved.value.pendingCreation, undefined);
  assert.equal(mutations().length, 0);
  original.onUnload();
  return { input, target, saved };
}

async function moveThroughSharedAccount() {
  await api.command('card.save', { ...cardPayload(), billingAccountId: f.y.id });
  assert.equal((await f.store.get<Card>('cards', f.primary.id))?.billingAccountId, f.y.id);
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', f.x.id))?.enabled, false);
  await api.command('card.save', { ...cardPayload(), billing: {
    statementDay: 5, dueDay: 26, dueMonthOffset: 0, remindDays: 3, dueOn: '2026-09-26', periodKey: '2026-09',
  } });
  const currentCard = (await f.store.get<Card>('cards', f.primary.id))!;
  assert.ok(currentCard.billingAccountId);
  assert.notEqual(currentCard.billingAccountId, f.x.id);
  assert.notEqual(currentCard.billingAccountId, f.y.id);
  assert.equal((await f.store.get<Card>('cards', f.sibling.id))?.billingAccountId, f.y.id);
  const account = (await f.store.get<BillingAccount>('billing_accounts', currentCard.billingAccountId))!;
  const bill = (await f.store.find<Bill>('bills')).find(row => row.billingAccountId === account.id && row.periodKey === '2026-09')!;
  assert.ok(bill);
  assert.equal(bill.dueOn, '2026-09-26');
  assert.deepEqual(await f.store.get<Bill>('bills', f.xBill.id), f.xBill);
  assert.deepEqual(await f.store.get<Bill>('bills', f.yBill.id), f.yBill);
  return { currentCard, account, bill };
}

async function staleTarget() {
  const original = await saveOrdinaryTargetDraft();
  const replacement = await moveThroughSharedAccount();
  const restored = await initialize();
  assert.deepEqual(fields(restored), original.input);
  assert.deepEqual(restored.data.billingTarget, original.target, 'Draft recovery must not silently retarget the retained due date.');
  assert.equal(restored.data.currentMonth, original.target.periodKey);
  assert.equal(restored.data.card.billingAccountId, replacement.account.id);
  requests = [];
  return { original, replacement, restored };
}

function assertRecoveryAvailable(instance: PageInstance): void {
  assert.equal(instance.data.billingTargetUnavailable, true);
  assert.equal(instance.data.periodRebaseNeeded, true, 'An invalid target needs an actionable recovery path even in the same period.');
  assert.equal(instance.isBusy(), false);
  assert.ok(instance.validationErrors().dueOn);
}

function assertReadOnlyRefresh(): void {
  assert.deepEqual(requests.map(request => request.action).sort(), ['session.get', 'wallet.get']);
  assert.equal(mutations().length, 0);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('a same-period draft can explicitly recover from X through shared Y to current Z while retaining its input', async () => {
  const { original, replacement, restored } = await staleTarget();
  assertRecoveryAvailable(restored);
  const before = await f.store.exportSeed();
  const oldAccounts = [await f.store.get<BillingAccount>('billing_accounts', f.x.id), await f.store.get<BillingAccount>('billing_accounts', f.y.id)];
  const savedBefore = draft(restored);
  await restored.save();
  await restored.save();
  assert.equal(mutations().length, 0);
  assert.deepEqual(restored.data.billingTarget, original.target);
  assert.deepEqual(draft(restored), savedBefore);
  assertRecoveryAvailable(restored);

  await restored.rebaseBillingPeriod();

  assertReadOnlyRefresh();
  assert.deepEqual(await f.store.exportSeed(), before, 'Rereading an already materialized period must not mutate cards, accounts, bills, or audit entries.');
  assert.deepEqual(fields(restored), original.input);
  assert.equal(restored.data.billingTarget.accountId, replacement.account.id);
  assert.equal(restored.data.billingTarget.billId, replacement.bill.id);
  assert.equal(restored.data.billingTarget.periodKey, '2026-09');
  assert.equal(restored.data.billingTargetUnavailable, false);
  assert.equal(restored.data.periodRebaseNeeded, false);
  assert.equal(restored.data.dateNeedsReview, true);
  assert.equal(draft(restored)?.value.dueOn, '2026-09-28');
  assert.equal(draft(restored)?.value.nickname, original.input.nickname);
  assert.equal(draft(restored)?.value.billingTarget.billId, replacement.bill.id);
  assert.equal(draft(restored)?.value.dateNeedsReview, true);
  await restored.save();
  assert.equal(mutations().length, 0, 'Rereading a target must not also confirm the retained date.');
  restored.confirmDueDate();
  assert.equal(restored.data.dateNeedsReview, false);
  assert.equal(restored.validationErrors().dueOn, undefined);
  await restored.save();

  const sent = mutations();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'card.save');
  assert.equal(sent[0].payload.billing.billId, replacement.bill.id);
  assert.equal(sent[0].payload.billing.periodKey, '2026-09');
  assert.equal(sent[0].payload.billing.dueOn, '2026-09-28');
  assert.deepEqual(await f.store.get<Bill>('bills', replacement.bill.id), { ...replacement.bill, dueOn: '2026-09-28' });
  assert.deepEqual(await f.store.get<Bill>('bills', f.xBill.id), f.xBill);
  assert.deepEqual(await f.store.get<Bill>('bills', f.yBill.id), f.yBill);
  assert.deepEqual([await f.store.get<BillingAccount>('billing_accounts', f.x.id), await f.store.get<BillingAccount>('billing_accounts', f.y.id)], oldAccounts);
  assert.equal((await f.store.get<Card>('cards', f.primary.id))?.billingAccountId, replacement.account.id);
  assert.equal((await f.store.get<Card>('cards', f.primary.id))?.nickname, original.input.nickname);
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', replacement.account.id))?.statementDay, 7);
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', replacement.account.id))?.remindDays, 5);
  assert.equal(draft(restored), null);
  assert.equal(navigationCount, 1);
});

for (const failedRead of ['session.get', 'wallet.get'] as const) {
  test(`a failed ${failedRead} preserves the unavailable target and draft until a successful reread`, async () => {
    const { original, replacement, restored } = await staleTarget();
    assertRecoveryAvailable(restored);
    const before = await f.store.exportSeed();
    const saved = draft(restored);
    transport = async (request, execute) => {
      if (request.action === failedRead) throw new Error('Billing target refresh unavailable');
      return execute();
    };

    await restored.rebaseBillingPeriod();

    assert.equal(restored.data.rebasing, false);
    assert.deepEqual(restored.data.billingTarget, original.target);
    assert.deepEqual(fields(restored), original.input);
    assert.deepEqual(draft(restored), saved);
    assert.deepEqual(await f.store.exportSeed(), before);
    assertRecoveryAvailable(restored);
    await restored.save();
    assert.equal(mutations().length, 0);
    assert.equal(navigationCount, 0);

    transport = async (_request, execute) => execute();
    requests = [];
    await restored.rebaseBillingPeriod();
    assertReadOnlyRefresh();
    assert.equal(restored.data.billingTarget.billId, replacement.bill.id);
    assert.equal(restored.data.dateNeedsReview, true);
    assert.deepEqual(fields(restored), original.input);
    assert.deepEqual(await f.store.exportSeed(), before);
  });
}

test('an asynchronous reread blocks another reread, saving, and input changes until the new target is ready', { timeout: 10_000 }, async () => {
  const { original, replacement, restored } = await staleTarget();
  const before = await f.store.exportSeed();
  const saved = draft(restored);
  const started = deferred(), release = deferred();
  transport = async (request, execute) => {
    if (request.action === 'wallet.get') { started.resolve(); await release.promise; }
    return execute();
  };
  const refreshing = restored.rebaseBillingPeriod() as Promise<void>;
  const settled = refreshing.then(() => undefined, () => undefined);
  try {
    await started.promise;
    assert.equal(restored.data.rebasing, true);
    assert.equal(restored.isBusy(), true);
    await restored.rebaseBillingPeriod();
    await restored.save();
    restored.changeNickname({ detail: { value: 'Blocked edit' } });
    restored.changeDueDate({ detail: { value: '2026-09-29' } });
    restored.changeStatement({ detail: { value: '10' } });
    restored.confirmDueDate();
    assert.deepEqual(fields(restored), original.input);
    assert.deepEqual(restored.data.billingTarget, original.target);
    assert.deepEqual(draft(restored), saved);
    assertReadOnlyRefresh();
    assert.deepEqual(await f.store.exportSeed(), before);
    release.resolve();
    await refreshing;
    assert.equal(restored.data.rebasing, false);
    assert.equal(restored.data.billingTarget.billId, replacement.bill.id);
    assert.equal(restored.data.dateNeedsReview, true);
    assert.deepEqual(fields(restored), original.input);
    assertReadOnlyRefresh();
    assert.equal(navigationCount, 0);
  } finally { release.resolve(); await settled; }
});

test('a valid historical bill target remains editable after a month change without requiring retargeting', async () => {
  const original = await saveOrdinaryTargetDraft();
  f.setDate('2026-10-02');
  const restored = await initialize();
  const october = (await f.store.find<Bill>('bills')).find(bill => bill.billingAccountId === f.x.id && bill.periodKey === '2026-10')!;
  assert.ok(october);
  assert.equal(restored.data.currentMonth, '2026-10');
  assert.deepEqual(restored.data.billingTarget, original.target);
  assert.deepEqual(fields(restored), original.input);
  assert.equal(restored.data.billingTargetUnavailable, false);
  assert.equal(restored.data.periodRebaseNeeded, false);
  assert.equal(restored.validationErrors().dueOn, undefined);
  const otherBills = (await f.store.find<Bill>('bills')).filter(bill => bill.id !== f.xBill.id);
  requests = [];

  await restored.save();

  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].payload.billing.billId, f.xBill.id);
  assert.equal(mutations()[0].payload.billing.periodKey, '2026-09');
  assert.deepEqual(await f.store.get<Bill>('bills', f.xBill.id), { ...f.xBill, dueOn: '2026-09-28' });
  for (const bill of otherBills) assert.deepEqual(await f.store.get<Bill>('bills', bill.id), bill);
  assert.deepEqual(await f.store.get<Bill>('bills', october.id), october);
  assert.equal(draft(restored), null);
});

test('a rule-only draft does not require retargeting an unused old bill after account and month changes', async () => {
  const original = await initialize();
  original.changeRemind({ detail: { value: '3' } });
  assert.equal(original.data.dueOn, original.data.billingTarget.originalDueOn);
  const target = structuredClone(original.data.billingTarget);
  original.onUnload();
  const replacement = await moveThroughSharedAccount();
  f.setDate('2026-10-02');
  const restored = await initialize();
  assert.deepEqual(restored.data.billingTarget, target);
  assert.equal(restored.data.currentMonth, '2026-10');
  assert.equal(restored.data.billingTargetUnavailable, false);
  assert.equal(restored.data.periodRebaseNeeded, false);
  assert.equal(restored.validationErrors().dueOn, undefined);
  const beforeBills = await f.store.find<Bill>('bills');
  const beforeOldAccount = await f.store.get<BillingAccount>('billing_accounts', f.x.id);
  requests = [];

  await restored.save();

  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].payload.billing.remindDays, 5);
  assert.equal(Object.hasOwn(mutations()[0].payload.billing, 'dueOn'), false);
  assert.equal(Object.hasOwn(mutations()[0].payload.billing, 'billId'), false);
  assert.equal(Object.hasOwn(mutations()[0].payload.billing, 'periodKey'), false);
  assert.deepEqual(await f.store.find<Bill>('bills'), beforeBills);
  assert.deepEqual(await f.store.get<BillingAccount>('billing_accounts', f.x.id), beforeOldAccount);
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', replacement.account.id))?.remindDays, 5);
});

test('an intentional same-period split from a shared account does not require an existing bill target', async () => {
  await api.command('card.save', { ...cardPayload(), billingAccountId: f.y.id });
  const page = await initialize();
  assert.ok(page.data.billingIndex > 0);
  const yBill = (await f.store.get<Bill>('bills', f.yBill.id))!;
  page.changeBilling({ detail: { value: '0' } });
  page.changeDueDate({ detail: { value: '2026-09-28' } });
  assert.equal(page.data.billingTarget.accountId, '');
  assert.equal(page.data.billingTarget.billId, '');
  assert.equal(page.data.billingTargetUnavailable, false);
  assert.equal(page.data.periodRebaseNeeded, false);
  assert.equal(page.validationErrors().dueOn, undefined);
  requests = [];

  await page.save();

  assert.equal(mutations().length, 1);
  assert.equal(Object.hasOwn(mutations()[0].payload.billing, 'billId'), false);
  const current = (await f.store.get<Card>('cards', f.primary.id))!;
  assert.notEqual(current.billingAccountId, f.y.id);
  assert.equal((await f.store.get<Card>('cards', f.sibling.id))?.billingAccountId, f.y.id);
  assert.deepEqual(await f.store.get<Bill>('bills', f.yBill.id), yBill);
  assert.deepEqual(await f.store.get<Bill>('bills', f.xBill.id), f.xBill);
  const independent = (await f.store.find<Bill>('bills')).find(bill => bill.billingAccountId === current.billingAccountId)!;
  assert.equal(independent.periodKey, '2026-09');
  assert.equal(independent.dueOn, '2026-09-28');
});

test('a replaced bill ID is unavailable even when the account and billing period still match', async () => {
  const original = await saveOrdinaryTargetDraft();
  await f.store.remove('bills', f.xBill.id);
  const restored = await initialize();
  const currentBill = (await f.store.find<Bill>('bills')).find(bill => bill.billingAccountId === f.x.id && bill.periodKey === '2026-09')!;
  assert.ok(currentBill);
  assert.notEqual(currentBill.id, f.xBill.id, 'The missing period must have materialized under its current bill identifier.');
  assert.equal(restored.data.card.billingAccountId, f.x.id);
  assert.deepEqual(restored.data.billingTarget, original.target);
  assertRecoveryAvailable(restored);
  const before = await f.store.exportSeed();
  requests = [];
  await restored.save();
  assert.equal(mutations().length, 0);

  await restored.rebaseBillingPeriod();

  assertReadOnlyRefresh();
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.equal(restored.data.billingTarget.billId, currentBill.id);
  assert.equal(restored.data.billingTarget.accountId, f.x.id);
  assert.equal(restored.data.billingTargetUnavailable, false);
  assert.equal(restored.data.dateNeedsReview, true);
  assert.deepEqual(fields(restored), original.input);
  restored.confirmDueDate();
  await restored.save();
  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].payload.billing.billId, currentBill.id);
  assert.deepEqual(await f.store.get<Bill>('bills', currentBill.id), { ...currentBill, dueOn: '2026-09-28' });
  assert.equal(await f.store.get('bills', f.xBill.id), null);
  assert.deepEqual(await f.store.get<Bill>('bills', f.yBill.id), f.yBill);
});

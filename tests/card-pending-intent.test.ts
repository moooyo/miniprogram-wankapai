import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as catalog from '../shared/catalog';
import * as cardLabels from '../miniprogram/services/card-labels';
import type { ApiRequest, Bill, Card, Commands, Session, Wallet } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';

type Controller = { data: Record<string, any>; setData(values: Record<string, unknown>, callback?: () => void): void; [key: string]: any };
type CommandOptions = { intentKey?: string; replayOnly?: boolean };
type CommandCall = { action: string; payload: any; options?: CommandOptions };
type HarnessOptions = {
  storage?: Map<string, unknown>;
  transport?: (request: ApiRequest) => Promise<unknown>;
  command?: (action: string, payload: any, options?: CommandOptions) => Promise<unknown>;
  query?: (action: string, payload: any) => Promise<any>;
  session?: () => Promise<Session>;
  ownerId?: string;
  bankId?: string;
  id?: string;
};
const ownerId = 'pending-card-owner';
const picker = (value: string | number | boolean) => ({ detail: { value } });
const copy = <T>(value: T): T => structuredClone(value);
function unknownResult(code = 'NETWORK_ERROR') { return Object.assign(new Error('Creation result is unknown'), { code }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(date = '2026-09-24', loseFirstCreationResponse = true) {
  const store = new MemoryStore();
  let today = date;
  const actor = { userId: ownerId, isModerator: false };
  const service = createService(store, { now: () => new Date(`${today}T04:00:00Z`), demo: true });
  const requests: ApiRequest[] = [];
  let loseNext = loseFirstCreationResponse;
  const transport = async (request: ApiRequest) => {
    requests.push(copy(request));
    try {
      const result = await service.execute(actor, request);
      if (loseNext && request.action === 'card.save' && !(request.payload as Commands['card.save']).id) {
        loseNext = false;
        throw unknownResult();
      }
      return { result: { ok: true, data: result } };
    } catch (error) {
      if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
      throw error;
    }
  };
  const query = (action: string, payload: any) => service.execute(actor, { action, payload } as ApiRequest);
  const session = async () => await query('session.get', {}) as Session;
  return { store, requests, transport, query, session, setDate: (value: string) => { today = value; } };
}

function harness(options: HarnessOptions = {}) {
  const storage = options.storage || new Map<string, unknown>();
  const commands: CommandCall[] = [];
  const navigations: string[] = [];
  const modals: unknown[] = [];
  const errors: unknown[] = [];
  let alertEnabled = false;
  let page!: Controller;
  const wx = {
    getStorageSync: (key: string) => storage.has(key) ? copy(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => { storage.set(key, copy(value)); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showModal: async (value: unknown) => { modals.push(value); return { confirm: true }; },
    enableAlertBeforeUnload: () => { alertEnabled = true; },
    disableAlertBeforeUnload: () => { alertEnabled = false; },
    nextTick: (callback: () => void) => callback(),
    setNavigationBarTitle() {}, showToast() {}, pageScrollTo() {},
    navigateBack: () => navigations.push('back'),
    redirectTo: ({ url }: { url: string }) => navigations.push(url),
    switchTab: ({ url }: { url: string }) => navigations.push(url),
    cloud: { init() {}, callFunction: ({ data }: { data: ApiRequest }) => options.transport!(data) },
  };
  function evaluate(file: string, imports: Record<string, unknown> = {}): Record<string, any> {
    const exports: Record<string, any> = {};
    const javascript = ts.transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(javascript, {
      exports, wx, Error, getCurrentPages: () => [page],
      require: (id: string) => { assert.ok(id in imports, `Unexpected import ${id}`); return imports[id]; },
      Page: (definition: Controller) => {
        page = definition;
        page.data = copy(page.data);
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
    '../runtime-config': { default: { mode: 'cloud', cloudEnvId: 'pending-card-test', apiFunctionName: 'api' } },
    './demo': { demoActor: { userId: ownerId, isModerator: false }, demoService() {}, persistDemo() {} },
    './entrance': { entranceBehavior: () => 'guide' },
  }).api : null;
  const api = {
    query: options.query || (async () => ({ cards: [], accounts: [], bills: [] } as Wallet)),
    command: async (action: string, payload: any, commandOptions?: CommandOptions) => {
      commands.push({ action, payload: copy(payload), options: copy(commandOptions) });
      if (options.command) return options.command(action, payload, commandOptions);
      if (sourceApi) return sourceApi.command(action, payload, commandOptions);
      return { id: payload.id || 'confirmed-card' };
    },
  };
  evaluate('miniprogram/pages/card-edit/index.ts', {
    '../../../shared/catalog': catalog,
    '../../services/api': { api, ensureSession: options.session || (async () => ({ userId: options.ownerId || ownerId, isModerator: false, today: '2026-09-24', month: '2026-09', demo: true })) },
    '../../services/form-draft': formDrafts,
    '../../services/card-labels': cardLabels,
    '../../services/format': { showError: (error: unknown) => errors.push(error), monthKey: () => '2026-09', periodLabel: (period: string) => period },
    '../../services/navigation': { navigateBackOr: () => navigations.push('back') },
  });
  page.setData({ id: options.id || '', editing: !!options.id, initialBankId: options.bankId ?? 'cmb' });
  return { page, commands, storage, navigations, modals, errors, formDrafts, alertEnabled: () => alertEnabled };
}

type Environment = ReturnType<typeof harness>;
async function initialize(options: HarnessOptions = {}) {
  const env = harness(options);
  await env.page.load();
  assert.equal(env.page.data.loading, false);
  assert.equal(env.page.data.failed, false);
  return env;
}
function saved(env: Environment, id = env.page.data.draftEntityId, owner = ownerId) {
  return env.formDrafts.loadDraft('card', owner, id);
}
function nickname(env: Environment, value: string) { env.page.changeNickname(picker(value)); }
function configureBilling(env: Environment, dueOn = '2026-09-30') {
  env.page.toggleReminder(picker(true));
  env.page.changeStatement(picker('4'));
  env.page.changeDueDate(picker(dueOn));
}
function assertPending(env: Environment) {
  assert.equal(env.page.data.pendingCreationUnconfirmed, true);
  assert.ok(saved(env)?.value.pendingCreation?.payloadSignature);
  assert.equal(env.navigations.length, 0);
}
function freezeCheck(env: Environment) {
  const before = copy(env.page.formDraft());
  nickname(env, 'Unsent changed card');
  env.page.changeBank(picker('2'));
  env.page.changeIssuer(picker('1'));
  env.page.changeNetwork(picker('1'));
  env.page.changeKind({ currentTarget: { dataset: { kind: 'debit' } } });
  env.page.toggleReminder(picker(!env.page.data.reminderEnabled));
  env.page.changeBilling(picker('1'));
  env.page.changeStatement(picker('11'));
  env.page.changeDueDay(picker('19'));
  env.page.changeOffset(picker('0'));
  env.page.changeRemind(picker('0'));
  env.page.changeDueDate(picker('2027-02-20'));
  env.page.confirmDueDate();
  assert.deepEqual(copy(env.page.formDraft()), before, 'Every business field remains frozen while the creation result is unknown.');
}

test('creation persists its original payload and intent before dispatch and stops when that storage write fails', async () => {
  let failWrites = false;
  class Storage extends Map<string, unknown> {
    override set(key: string, value: unknown) {
      if (failWrites) throw new Error('Storage unavailable');
      return super.set(key, value);
    }
  }
  let env!: Environment;
  env = await initialize({ storage: new Storage(), command: async (_action, payload, options) => {
    const pending = saved(env)?.value.pendingCreation;
    assert.equal(pending?.intentKey, options?.intentKey);
    assert.deepEqual(JSON.parse(pending.payloadSignature), copy(payload));
    throw unknownResult();
  } });
  assert.equal(saved(env), null);
  failWrites = true;
  await env.page.save();
  assert.equal(env.commands.length, 0, 'An unsaved pending intent cannot be sent even when the default form is valid.');
  assert.equal(env.page.data.pendingCreationUnconfirmed, false);
  failWrites = false;
  await env.page.save();
  assert.equal(env.commands.length, 1);
  assertPending(env);
  assert.equal(env.alertEnabled(), true);
  const original = copy(env.commands[0]);
  await env.page.save();
  assert.deepEqual(env.commands[1], original);
});

for (const code of ['NETWORK_ERROR', 'INVALID_RESPONSE', 'INTERNAL_ERROR', 'UNAUTHENTICATED', 'CONFIGURATION_REQUIRED']) {
  test(`an ambiguous ${code} freezes changes and retries the identical creation`, async () => {
    const env = await initialize({ command: async () => { throw unknownResult(code); } });
    nickname(env, 'Original card');
    configureBilling(env);
    await env.page.save();
    assertPending(env);
    const pending = copy(saved(env).value.pendingCreation);
    freezeCheck(env);
    await env.page.rebaseBillingPeriod();
    assert.deepEqual(saved(env).value.pendingCreation, pending);
    await env.page.save();
    assert.deepEqual(env.commands[1], env.commands[0]);
    assertPending(env);
  });
}

for (const result of [undefined, null, {}, { id: '' }, { id: '   ' }, { id: 17 }, { version: 1 }]) {
  test(`an incomplete success ${JSON.stringify(result)} cannot confirm or discard pending creation`, async () => {
    const env = await initialize({ command: async () => result });
    nickname(env, 'Unconfirmed card');
    await env.page.save();
    assertPending(env);
    const pending = copy(saved(env).value.pendingCreation);
    freezeCheck(env);
    await env.page.save();
    assert.deepEqual(env.commands[1], env.commands[0]);
    assert.deepEqual(saved(env).value.pendingCreation, pending);
    assertPending(env);
  });
}

for (const code of ['INVALID_INPUT', 'INVALID_DATE', 'NOT_FOUND', 'CONFLICT', 'IMMUTABLE', 'VERSION_CONFLICT', 'INVALID_STATE']) {
  test(`a definitive ${code} rejection removes pending evidence and allows correction`, async () => {
    const env = await initialize({ command: async () => { throw Object.assign(unknownResult(code), { field: 'nickname' }); } });
    nickname(env, 'Rejected card');
    await env.page.save();
    assert.equal(env.page.data.pendingCreationUnconfirmed, false);
    assert.equal(saved(env)?.value.pendingCreation, undefined);
    nickname(env, 'Corrected card');
    assert.equal(env.page.data.nickname, 'Corrected card');
    assert.equal(env.navigations.length, 0);
  });
}

test('a lost committed response survives reopening and reuses the exact request without another card or audit event', async () => {
  const f = fixture();
  const first = await initialize(f);
  nickname(first, 'Original card');
  await first.page.save();
  assertPending(first);
  freezeCheck(first);
  const original = f.requests.find(request => request.action === 'card.save')!;
  const committed = await f.store.exportSeed();
  first.page.onUnload();
  const restored = await initialize({ ...f, storage: first.storage });
  assertPending(restored);
  await restored.page.save();
  const writes = f.requests.filter(request => request.action === 'card.save');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], original);
  assert.deepEqual(await f.store.exportSeed(), committed);
  assert.equal((await f.store.find('cards')).length, 1);
  assert.equal((await f.store.find('requests')).length, 1);
  assert.equal((await f.store.find('audit_events')).length, 1);
  assert.equal(saved(restored), null);
  assert.equal(restored.page.data.pendingCreationUnconfirmed, false);
  assert.equal(restored.navigations.length, 1);
});

async function legacyChangedDraft(fields: Record<string, unknown> = { nickname: 'Later private name', network: 'visa' }, options: { f?: ReturnType<typeof fixture>; bankId?: string; billing?: boolean } = {}) {
  const f = options.f || fixture();
  const original = await initialize({ ...f, bankId: options.bankId });
  nickname(original, 'Original card');
  if (options.billing) configureBilling(original, '2026-10-10');
  await original.page.save();
  const draft = saved(original);
  const value = { ...draft.value, ...fields };
  delete value.pendingCreationInput;
  original.formDrafts.saveDraft('card', ownerId, original.page.data.draftEntityId, draft.baseVersion, value);
  original.page.onUnload();
  return { f, original, value };
}

test('a legacy changed pending draft confirms its original creation then retains later fields as an edit of that ID', async () => {
  const { f, original } = await legacyChangedDraft();
  const restored = await initialize({ ...f, storage: original.storage });
  assert.equal(restored.page.data.nickname, 'Later private name');
  assertPending(restored);
  await restored.page.save();
  const record = (await f.store.find<Card>('cards'))[0];
  const writes = f.requests.filter(request => request.action === 'card.save');
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(record.nickname, 'Original card');
  assert.equal(record.network, 'unionpay');
  assert.equal(restored.page.data.id, record.id);
  assert.equal(restored.page.data.editing, true);
  assert.equal(restored.page.data.pendingCreationUnconfirmed, false);
  assert.equal(restored.page.data.nickname, 'Later private name');
  assert.equal(restored.page.formDraft().network, 'visa');
  assert.equal(saved(restored, original.page.data.draftEntityId), null);
  const retained = saved(restored, record.id);
  assert.equal(retained.value.nickname, 'Later private name');
  assert.equal(retained.value.pendingCreation, undefined);
  assert.equal(retained.value.intentKey, undefined);
  assert.equal(restored.navigations.length, 0, 'Retained input requires explicit review before saving the existing card.');
  nickname(restored, 'Reviewed final name');
  await restored.page.save();
  assert.equal(restored.commands[1].payload.id, record.id);
  assert.equal(restored.commands[1].options, undefined);
  assert.equal((await f.store.find<Card>('cards')).length, 1);
  assert.equal((await f.store.get<Card>('cards', record.id))?.nickname, 'Reviewed final name');
});

for (const fields of [
  { nickname: '  Original card  ' },
  { statementDay: 8, dueDay: 27, dueMonthOffset: 1, dueOn: '2026-10-27', remindDays: 7 },
]) {
  test(`legacy later raw input survives confirmation when normalized creation is unchanged: ${Object.keys(fields).join(', ')}`, async () => {
    const { f, original } = await legacyChangedDraft(fields);
    const restored = await initialize({ ...f, storage: original.storage });
    await restored.page.save();
    const record = (await f.store.find<Card>('cards'))[0];
    const writes = f.requests.filter(request => request.action === 'card.save');
    assert.deepEqual(writes[1], writes[0]);
    assert.equal(restored.page.data.id, record.id);
    assert.equal(restored.page.data.pendingCreationUnconfirmed, false);
    const retained = saved(restored, record.id);
    assert.ok(retained, 'Later private input cannot disappear because it is omitted or normalized in a command.');
    for (const [key, value] of Object.entries(fields)) assert.equal(retained.value[key], value);
    assert.equal(restored.navigations.length, 0);
  });
}

for (const fields of [{ remindDays: 7 }, { dueMonthOffset: 0 }]) {
  test(`a legacy hidden-only ${Object.keys(fields)[0]} change survives confirmation without retargeting its period`, async () => {
    const f = fixture('2026-09-30');
    const { original, value } = await legacyChangedDraft(fields, { f });
    const request = f.requests.find(item => item.action === 'card.save')!;
    const committed = await f.store.exportSeed();
    f.setDate('2026-10-01');
    const restored = await initialize({ ...f, storage: original.storage });
    assert.deepEqual(copy(restored.page.commandPayload()), request.payload);
    assert.equal(restored.page.data.statementDay, 0);
    assert.equal(restored.page.data.dueDay, 0);
    assert.equal(restored.page.data.dueOn, '');
    assert.equal(restored.page.data.reminderEnabled, false);
    await restored.page.save();

    const card = (await f.store.find<Card>('cards'))[0];
    const writes = f.requests.filter(item => item.action === 'card.save');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], request);
    assert.deepEqual(await f.store.exportSeed(), committed, 'Confirmation cannot create another card, request, account, bill, or audit event.');
    assert.equal((await f.store.find('cards')).length, 1);
    assert.equal((await f.store.find('requests')).length, 1);
    assert.equal((await f.store.find('audit_events')).length, 1);
    assert.equal((await f.store.find('billing_accounts')).length, 0);
    assert.equal((await f.store.find('bills')).length, 0);
    assert.equal(restored.page.data.id, card.id);
    assert.equal(restored.page.data.editing, true);
    assert.equal(saved(restored, original.page.data.draftEntityId), null);
    const retained = saved(restored, card.id);
    assert.ok(retained, 'Hidden-only edits must remain available on the confirmed card.');
    for (const [field, expected] of Object.entries(fields)) assert.equal(retained.value[field], expected);
    assert.deepEqual(retained.value.billingTarget, value.billingTarget);
    assert.equal(retained.value.periodKey, '2026-09');
    assert.equal(retained.value.dateNeedsReview, false);
    assert.equal(restored.navigations.length, 0);

    restored.page.toggleReminder(picker(true));
    restored.page.changeStatement(picker('4'));
    restored.page.changeDueDate(picker('2026-10-10'));
    const commandCount = restored.commands.length;
    await restored.page.save();
    assert.equal(restored.commands.length, commandCount, 'Enabling the retained plan cannot silently use a stale period.');
    assert.ok(restored.page.data.errors.dueOn);
    await restored.page.rebaseBillingPeriod();
    assert.equal(restored.page.data.billingTarget.periodKey, '2026-10');
    assert.equal(restored.page.data.dateNeedsReview, true);
    await restored.page.save();
    assert.equal(restored.commands.length, commandCount, 'An explicit rebase still requires review of the retained date.');
    assert.equal((await f.store.find('bills')).length, 0);
  });
}

test('a recorded original input snapshot prevents unchanged raw fields from becoming a spurious editing draft', async () => {
  const f = fixture();
  const original = await initialize(f);
  nickname(original, '  Original card  ');
  original.page.changeStatement(picker('7'));
  await original.page.save();
  assert.equal(saved(original).value.pendingCreationInput.nickname, '  Original card  ');
  original.page.onUnload();
  const restored = await initialize({ ...f, storage: original.storage });
  await restored.page.save();
  assert.deepEqual(f.requests.filter(request => request.action === 'card.save')[1], f.requests.filter(request => request.action === 'card.save')[0]);
  assert.equal(saved(restored), null);
  assert.equal(restored.navigations.length, 1);
  assert.equal((await f.store.find('cards')).length, 1);
});

for (const fields of [{ bankId: 'hsbc', issuerId: 'hsbc-hk' }, { bankId: 'boc', issuerId: 'boc-hk' }]) {
  test(`later immutable identity ${fields.bankId}/${fields.issuerId} remains private without rewriting the created card`, async () => {
    const { f, original, value } = await legacyChangedDraft({ ...fields, nickname: 'Later identity note' }, { bankId: 'boc' });
    const restored = await initialize({ ...f, storage: original.storage, bankId: 'boc' });
    await restored.page.save();
    const record = (await f.store.find<Card>('cards'))[0];
    assert.equal(record.bankId, 'boc');
    assert.equal(record.issuerId, 'boc-cn');
    assert.equal(record.nickname, 'Original card');
    const writes = f.requests.filter(request => request.action === 'card.save');
    assert.deepEqual(writes[1], writes[0]);
    const retained = saved(restored, original.page.data.draftEntityId);
    assert.equal(retained.value.bankId, value.bankId);
    assert.equal(retained.value.issuerId, value.issuerId);
    assert.equal(retained.value.nickname, value.nickname);
    assert.deepEqual(retained.value.pendingCreation, value.pendingCreation);
    assert.equal(saved(restored, record.id), null);
    assertPending(restored);
    assert.equal(restored.page.data.editing, false);
    freezeCheck(restored);
  });
}

for (const legacy of [false, true]) {
  test(`an unresolved ${legacy ? 'legacy' : 'cross-period'} billing intent with later fields stays read-only on every retry`, async () => {
    const f = fixture('2026-09-30', false);
    const original = await initialize(f);
    nickname(original, 'Original bill card');
    configureBilling(original, '2026-10-10');
    const payload = copy(original.page.commandPayload()) as Commands['card.save'];
    if (legacy) { delete payload.billing!.periodKey; delete payload.billing!.billId; }
    const pending = { pending: true, intentKey: original.page.data.intentKey, payloadSignature: JSON.stringify(payload) };
    original.formDrafts.saveDraft('card', ownerId, original.page.data.draftEntityId, original.page.data.draftBaseVersion, {
      ...original.page.formDraft(), nickname: 'Later billing note', dueOn: '2026-11-12',
      pendingCreationPeriod: '2026-09', pendingCreation: pending,
    });
    original.page.onUnload();
    f.setDate('2026-10-01');
    const restored = await initialize({ ...f, storage: original.storage });
    assert.equal(restored.page.data.pendingLookupOnly, true);
    const before = await f.store.exportSeed();
    for (let attempt = 0; attempt < 2; attempt++) {
      freezeCheck(restored);
      await restored.page.rebaseBillingPeriod();
      await restored.page.save();
      assertPending(restored);
      assert.equal(restored.commands[attempt].options?.replayOnly, true);
      assert.equal(restored.commands[attempt].options?.intentKey, pending.intentKey);
      assert.deepEqual(restored.commands[attempt].payload, payload);
      assert.deepEqual(saved(restored).value.pendingCreation, pending);
      assert.equal(saved(restored).value.nickname, 'Later billing note');
    }
    assert.equal(f.requests.filter(request => request.action === 'card.save').length, 0);
    const lookups = f.requests.filter(request => request.action === 'request.replay');
    assert.equal(lookups.length, 2);
    assert.deepEqual(lookups[1], lookups[0]);
    assert.deepEqual(await f.store.exportSeed(), before);
  });
}

test('a recovered billing creation retains the original bill target and requires review of a later date', async () => {
  const f = fixture('2026-09-30');
  const { original } = await legacyChangedDraft({ nickname: 'Later bill name', dueOn: '2026-10-12' }, { f, billing: true });
  const originalBill = (await f.store.find<Bill>('bills'))[0];
  f.setDate('2026-10-01');
  const restored = await initialize({ ...f, storage: original.storage });
  await restored.page.save();
  const record = (await f.store.find<Card>('cards'))[0];
  assert.equal(restored.commands[0].options?.replayOnly, true);
  assert.equal(restored.page.data.id, record.id);
  assert.equal(restored.page.data.dueOn, '2026-10-12');
  assert.equal(restored.page.data.billingTarget.billId, originalBill.id);
  assert.equal(restored.page.data.billingTarget.accountId, record.billingAccountId);
  assert.equal(restored.page.data.billingTarget.periodKey, '2026-09');
  assert.equal(restored.page.data.dateNeedsReview, true);
  assert.equal((await f.store.get<Bill>('bills', originalBill.id))?.dueOn, '2026-10-10');
  const retained = saved(restored, record.id);
  assert.equal(retained.value.billingTarget.billId, originalBill.id);
  assert.equal(retained.value.dateNeedsReview, true);
  const count = restored.commands.length;
  await restored.page.save();
  assert.equal(restored.commands.length, count, 'A retained date must not silently mutate any bill before explicit review.');
  assert.ok(restored.page.data.errors.dueOn);
});

for (const interruption of ['disposed', 'owner', 'newer-source'] as const) {
  test(`a late creation result cannot clear or navigate a ${interruption} form`, async () => {
    const result = deferred<unknown>();
    const started = deferred<void>();
    const env = await initialize({ command: async () => { started.resolve(); return result.promise; } });
    nickname(env, 'Original inflight card');
    const sourceId = env.page.data.draftEntityId;
    const saving = env.page.save();
    await started.promise;
    const pending = copy(saved(env, sourceId));
    if (interruption === 'disposed') env.page.onUnload();
    if (interruption === 'owner') {
      env.formDrafts.saveDraft('card', 'another-owner', sourceId, '', { nickname: 'Other owner draft' });
      env.page.setData({ userId: 'another-owner' });
    }
    if (interruption === 'newer-source') env.formDrafts.saveDraft('card', ownerId, sourceId, pending.baseVersion, {
      ...pending.value, nickname: 'Newer independent local input',
    });
    const sourceBefore = copy(saved(env, sourceId));
    const otherBefore = copy(saved(env, sourceId, 'another-owner'));
    result.resolve({ id: 'confirmed-card' });
    await saving;
    assert.deepEqual(saved(env, sourceId), sourceBefore);
    assert.deepEqual(saved(env, sourceId, 'another-owner'), otherBefore);
    assert.equal(env.navigations.length, 0);
  });
}

for (const problem of ['foreign-record', 'missing-record', 'target-draft', 'target-storage'] as const) {
  test(`legacy pending migration preserves private fields when confirmation encounters ${problem}`, async () => {
    const { f, original, value } = await legacyChangedDraft();
    const record = (await f.store.find<Card>('cards'))[0];
    let rejectTargetStorage = false;
    class Storage extends Map<string, unknown> {
      override set(key: string, item: unknown) {
        if (rejectTargetStorage && key.endsWith(':' + record.id)) throw new Error('Target storage unavailable');
        return super.set(key, item);
      }
    }
    const storage = new Storage(original.storage);
    let confirmationRead = false;
    const query = async (action: string, payload: any) => {
      const result = await f.query(action, payload);
      if (action !== 'wallet.get' || !confirmationRead) return result;
      const wallet = result as Wallet;
      if (problem === 'missing-record') return { ...wallet, cards: [] };
      if (problem === 'foreign-record') return { ...wallet, cards: wallet.cards.map(card => ({ ...card, ownerId: 'another-owner' })) };
      return wallet;
    };
    const restored = await initialize({ ...f, query, storage });
    confirmationRead = true;
    if (problem === 'target-storage') rejectTargetStorage = true;
    if (problem === 'target-draft') restored.formDrafts.saveDraft('card', ownerId, record.id, 'existing-base', {
      ...value, nickname: 'Independent existing-card edit', pendingCreation: undefined,
    });
    const targetBefore = copy(saved(restored, record.id));
    await restored.page.save();
    assert.deepEqual(f.requests.filter(request => request.action === 'card.save')[1], f.requests.filter(request => request.action === 'card.save')[0]);
    assert.equal((await f.store.find<Card>('cards')).length, 1);
    const retained = saved(restored, original.page.data.draftEntityId);
    assert.equal(retained.value.nickname, value.nickname);
    assert.deepEqual(retained.value.pendingCreation, value.pendingCreation);
    assert.deepEqual(saved(restored, record.id), targetBefore);
    assertPending(restored);
  });
}

for (const interruption of ['disposed', 'owner', 'newer-source', 'newer-target'] as const) {
  test(`a late wallet read during pending migration respects ${interruption} ownership and revision guards`, async () => {
    const { f, original, value } = await legacyChangedDraft();
    const record = (await f.store.find<Card>('cards'))[0];
    const result = deferred<Wallet>();
    const started = deferred<void>();
    let confirmationRead = false;
    let confirmedWallet!: Wallet;
    const query = async (action: string, payload: any) => {
      const response = await f.query(action, payload);
      if (action !== 'wallet.get' || !confirmationRead) return response;
      confirmedWallet = response as Wallet;
      started.resolve();
      return result.promise;
    };
    const restored = await initialize({ ...f, query, storage: original.storage });
    const sourceId = original.page.data.draftEntityId;
    confirmationRead = true;
    const saving = restored.page.save();
    await started.promise;
    if (interruption === 'disposed') restored.page.onUnload();
    if (interruption === 'owner') {
      restored.formDrafts.saveDraft('card', 'another-owner', sourceId, 'other-base', { ...value, nickname: 'Other owner private input' });
      restored.page.setData({ userId: 'another-owner' });
    }
    if (interruption === 'newer-source') restored.formDrafts.saveDraft('card', ownerId, sourceId, 'newer-source-base', {
      ...value, nickname: 'Newer source private input',
    });
    if (interruption === 'newer-target') restored.formDrafts.saveDraft('card', ownerId, record.id, 'newer-target-base', {
      ...value, nickname: 'Newer existing-card input', pendingCreation: undefined,
    });
    const sourceBefore = copy(saved(restored, sourceId));
    const targetBefore = copy(saved(restored, record.id));
    const otherBefore = copy(saved(restored, sourceId, 'another-owner'));
    result.resolve(confirmedWallet);
    await saving;
    assert.deepEqual(saved(restored, sourceId), sourceBefore);
    assert.deepEqual(saved(restored, record.id), targetBefore);
    assert.deepEqual(saved(restored, sourceId, 'another-owner'), otherBefore);
    assert.equal(restored.navigations.length, 0);
    assert.equal((await f.store.find<Card>('cards')).length, 1);
  });
}

test('a changed session owner cannot retry or consume another owners pending creation', async () => {
  let sessionOwner = ownerId;
  const session = async (): Promise<Session> => ({ userId: sessionOwner, isModerator: false, today: '2026-09-24', month: '2026-09', demo: true });
  const env = await initialize({ session, command: async () => { throw unknownResult(); } });
  nickname(env, 'Private owner card');
  await env.page.save();
  const before = copy(saved(env));
  sessionOwner = 'another-owner';
  await env.page.save();
  assert.equal(env.commands.length, 1);
  assert.deepEqual(saved(env), before);
  assertPending(env);
  const other = await initialize({ storage: env.storage, ownerId: sessionOwner });
  assert.equal(other.page.data.pendingCreationUnconfirmed, false);
  assert.equal(other.page.data.nickname, '');
  assert.equal(other.commands.length, 0);
  assert.deepEqual(saved(env), before);
});

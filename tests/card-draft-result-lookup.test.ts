import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, ApiEnvelope, ApiRequest, Card, Commands } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import { createCommandIntent, getDraftRevision, loadDraft, saveDraft } from '../miniprogram/services/form-draft';
import settings from '../miniprogram/runtime-config';

type PageInstance = { data: Record<string, any>; [key: string]: any };
type DraftValue = Record<string, any>;
type RecordedRequest = { action: ApiRequest['action']; payload: any; requestId?: string };
type CloudResponse = { result: ApiEnvelope<unknown> };
type Transport = (request: RecordedRequest, execute: () => Promise<CloudResponse>) => Promise<CloudResponse>;

const originalWx = (globalThis as any).wx;
const originalCommand = api.command;
const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId, templateIds: settings.templateIds };
const storage = new Map<string, unknown>();
let definition: PageInstance;
let fixtureSequence = 0;
let f: ReturnType<typeof fixture>;
let activeActor: Actor;
let requests: RecordedRequest[];
let transport: Transport;
let acceptRecovery: boolean;
let modalCalls: any[];
let navigations: { kind: string; url?: string }[];
let rejectPendingWrites: boolean;
let rejectedPendingWrites: number;
let leaveMessage: string;

function fixture() {
  const prefix = `draft-result-${++fixtureSequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const templateIds = {
    new_activity: `${prefix}-new-activity`, deadline: `${prefix}-deadline`,
    reward: `${prefix}-reward`, repayment: `${prefix}-repayment`,
  };
  const store = new MemoryStore();
  const service = createService(store, { now: () => new Date('2026-09-23T04:00:00.000Z'), demo: true, templateIds });
  return { prefix, actor, templateIds, store, service };
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
  activeActor = f.actor;
  storage.clear();
  requests = [];
  modalCalls = [];
  navigations = [];
  acceptRecovery = true;
  rejectPendingWrites = false;
  rejectedPendingWrites = 0;
  leaveMessage = '';
  settings.mode = 'cloud';
  settings.cloudEnvId = `${f.prefix}-environment`;
  settings.templateIds = f.templateIds;
  transport = async (_request, execute) => execute();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: any) => {
      if (rejectPendingWrites && value?.value?.pendingCreation !== undefined) {
        rejectedPendingWrites += 1;
        throw new Error('Pending creation metadata could not be stored');
      }
      storage.set(key, structuredClone(value));
    },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showModal: async (options: any) => {
      modalCalls.push(options);
      return { confirm: acceptRecovery, cancel: !acceptRecovery };
    },
    nextTick: (callback: () => void) => callback(),
    pageScrollTo: () => {}, showToast: () => {}, setNavigationBarTitle: () => {},
    enableAlertBeforeUnload: ({ message }: { message: string }) => { leaveMessage = message; },
    disableAlertBeforeUnload: () => { leaveMessage = ''; },
    navigateBack: () => { navigations.push({ kind: 'back' }); },
    switchTab: ({ url }: { url: string }) => { navigations.push({ kind: 'tab', url }); },
    redirectTo: ({ url }: { url: string }) => { navigations.push({ kind: 'redirect', url }); },
    cloud: {
      init: () => {},
      callFunction: async ({ data }: { data: ApiRequest }) => {
        const request = structuredClone(data) as RecordedRequest;
        const actor = { ...activeActor };
        requests.push(request);
        return transport(request, async () => {
          try { return { result: { ok: true, data: await f.service.execute(actor, request as ApiRequest) } }; }
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

async function initialize(bankId = 'cmb'): Promise<PageInstance> {
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data) };
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
    Object.assign(instance.data, patch);
    callback?.();
  };
  instance.setData({ id: '', initialBankId: bankId, editing: false });
  await instance.load();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.failed, false);
  return instance;
}

function draft(instance: PageInstance) {
  return loadDraft<DraftValue>('card', instance.data.userId, instance.data.draftEntityId);
}

function revision(instance: PageInstance) {
  return getDraftRevision('card', instance.data.userId, instance.data.draftEntityId);
}

function changeNickname(instance: PageInstance, value: string): void {
  instance.changeNickname({ detail: { value } });
}

function fields(instance: PageInstance): Record<string, unknown> {
  return structuredClone(Object.fromEntries([
    'bankIndex', 'issuerIndex', 'networkIndex', 'kind', 'nickname', 'reminderEnabled', 'billingIndex',
    'statementDay', 'dueDay', 'dueMonthOffset', 'dueOn', 'remindIndex', 'intentKey', 'billingTarget',
  ].map(key => [key, instance.data[key]])));
}

function calls(action: ApiRequest['action']): RecordedRequest[] {
  return requests.filter(request => request.action === action);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function prepareOrdinaryDraft(committed: boolean, billing = false, bankId = 'cmb') {
  const original = await initialize(bankId);
  changeNickname(original, 'Travel card');
  if (billing) {
    original.toggleReminder({ detail: { value: true } });
    original.changeStatement({ detail: { value: '4' } });
    original.changeDueDate({ detail: { value: '2026-09-25' } });
  }
  const ordinary = draft(original)!;
  const intentKey = original.data.intentKey as string;
  const payload = structuredClone(original.commandPayload()) as Commands['card.save'];
  assert.ok(ordinary);
  assert.equal(ordinary.value.intentKey, intentKey);
  assert.equal(Object.hasOwn(ordinary.value, 'pendingCreation'), false);
  let originalRequest: RecordedRequest | undefined;
  if (committed) {
    let lost = false;
    transport = async (request, execute) => {
      const response = await execute();
      if (!lost && request.action === 'card.save' && response.result.ok) {
        lost = true;
        throw new Error('Creation response lost after commit');
      }
      return response;
    };
    const beforeBlockedSave = await f.store.exportSeed();
    rejectPendingWrites = true;
    try { await original.save(); }
    finally { rejectPendingWrites = false; }
    assert.ok(rejectedPendingWrites > 0, 'The pending marker write must actually fail while the earlier ordinary draft remains durable.');
    assert.equal(original.data.draftSaved, false);
    assert.equal(original.data.dirty, true);
    assert.match(leaveMessage, /离开后修改将丢失/, 'The existing failed-storage leave warning must remain explicit.');
    assert.deepEqual(draft(original), ordinary);
    assert.equal(calls('card.save').length, 0, 'The current client must not dispatch a creation whose pending marker was not stored.');
    assert.deepEqual(await f.store.exportSeed(), beforeBlockedSave, 'A failed pending-marker write cannot change the server store.');
    assert.equal((await f.store.find('requests')).length, 0);
    // Simulate a historical client that sent this durable ordinary draft before pending markers were required.
    await assert.rejects(originalCommand('card.save', payload, { intentKey }), { code: 'NETWORK_ERROR' });
    assert.deepEqual(draft(original), ordinary, 'The historical submission must leave the ordinary draft without pending metadata.');
    assert.equal(calls('card.save').length, 1);
    originalRequest = calls('card.save')[0];
    assert.deepEqual(originalRequest.payload, payload);
    assert.ok(originalRequest.requestId);
    assert.equal((await f.store.find('requests')).length, 1);
    assert.equal(navigations.length, 0);
  } else {
    const duplicate: Card = {
      id: `${f.prefix}-other-card`, ownerId: f.actor.userId,
      bankId: payload.bankId, issuerId: payload.issuerId, network: payload.network, kind: payload.kind,
      nickname: payload.nickname, createdAt: '2026-09-22T04:00:00.000Z',
    };
    await f.store.set('cards', duplicate.id, duplicate);
    assert.equal(calls('card.save').length, 0);
    assert.equal((await f.store.find('requests')).length, 0);
  }
  assert.equal((await f.store.find('cards')).length, 1);
  original.onUnload();
  return { original, ordinary, intentKey, payload, originalRequest, bankId };
}

function assertLookupAvailable(instance: PageInstance): void {
  assert.equal(instance.data.pendingCreationSignature, '');
  assert.equal(instance.data.recoveredDraftLookupAvailable, true);
  assert.equal(instance.isBusy(), false, 'A read-only lookup offer must not lock ordinary form editing.');
  assert.ok(instance.validationErrors().nickname, 'An ordinary restored draft must retain the nickname collision guard.');
}

async function assertSaveBlocked(instance: PageInstance): Promise<void> {
  const creations = calls('card.save').length;
  const lookups = calls('request.replay').length;
  await instance.save();
  assert.equal(calls('card.save').length, creations);
  assert.equal(calls('request.replay').length, lookups, 'Only the explicit result-lookup action may query this ordinary draft.');
  assert.ok(instance.data.errors.nickname);
  assert.equal(instance.data.pendingCreationSignature, '');
  assert.equal(draft(instance)?.value.pendingCreation, undefined);
}

test('an ordinary draft from a historical client resolves its committed result without another creation', async () => {
  const prepared = await prepareOrdinaryDraft(true);
  const restored = await initialize();
  assert.equal(modalCalls.length, 1);
  assert.equal(restored.data.intentKey, prepared.intentKey);
  assert.deepEqual(restored.commandPayload(), prepared.payload);
  assertLookupAvailable(restored);
  await assertSaveBlocked(restored);
  changeNickname(restored, '  Travel card  ');
  assertLookupAvailable(restored);
  assert.deepEqual(restored.commandPayload(), prepared.payload);
  const before = await f.store.exportSeed();
  const inspectedRevision = revision(restored);
  assert.ok(inspectedRevision);
  requests = [];

  await restored.resolveRecoveredDraftCreation();

  assert.deepEqual(requests.map(request => request.action), ['session.get', 'request.replay']);
  assert.deepEqual(calls('request.replay')[0].payload, prepared.originalRequest);
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.equal((await f.store.find('cards')).length, 1);
  assert.equal((await f.store.find('requests')).length, 1);
  assert.equal(draft(restored), null);
  assert.equal(restored.data.dirty, false);
  assert.equal(restored.data.recoveredDraftLookupAvailable, false);
  assert.deepEqual(navigations, [{ kind: 'tab', url: '/pages/wallet/index' }]);
});

test('a never-submitted ordinary draft reports an unresolved result and retains the collision guard and inputs', async () => {
  const prepared = await prepareOrdinaryDraft(false);
  const restored = await initialize();
  assertLookupAvailable(restored);
  await assertSaveBlocked(restored);
  const before = await f.store.exportSeed();
  const saved = draft(restored);
  const input = fields(restored);
  requests = [];

  await restored.resolveRecoveredDraftCreation();

  assert.deepEqual(requests.map(request => request.action), ['session.get', 'request.replay']);
  assert.deepEqual(calls('request.replay')[0].payload.payload, prepared.payload);
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.equal((await f.store.find('requests')).length, 0);
  assert.deepEqual(draft(restored), saved);
  assert.deepEqual(fields(restored), input);
  assert.ok(restored.data.recoveredDraftLookupNotice.length > 0);
  assertLookupAvailable(restored);
  await assertSaveBlocked(restored);
  assert.equal(calls('card.save').length, 0);
  assert.equal(navigations.length, 0);
});

test('changing any captured card payload field disables lookup until the exact normalized body is restored', async () => {
  const prepared = await prepareOrdinaryDraft(true, true, 'hsbc');
  const restored = await initialize(prepared.bankId);
  assertLookupAvailable(restored);
  assert.equal(restored.data.issuerOptions[1]?.bankId, 'hsbc');
  assert.notEqual(restored.data.issuerOptions[1]?.id, restored.data.issuerOptions[0]?.id);
  const sharedChoice = restored.data.billingChoices[1];
  assert.ok(sharedChoice?.id, 'The account change must select a real sharing option.');
  assert.ok(restored.data.raw.accounts.some((account: { id: string; enabled: boolean }) => account.id === sharedChoice.id && account.enabled));
  const originalFields = fields(restored);
  const edits: { name: string; change: () => void; restore: () => void }[] = [
    { name: 'nickname', change: () => changeNickname(restored, 'Changed card'), restore: () => changeNickname(restored, 'Travel card') },
    { name: 'bank', change: () => restored.changeBank({ detail: { value: '0' } }), restore: () => restored.changeBank({ detail: { value: String(originalFields.bankIndex) } }) },
    { name: 'issuer', change: () => restored.changeIssuer({ detail: { value: '1' } }), restore: () => restored.changeIssuer({ detail: { value: String(originalFields.issuerIndex) } }) },
    { name: 'network', change: () => restored.changeNetwork({ detail: { value: '1' } }), restore: () => restored.changeNetwork({ detail: { value: String(originalFields.networkIndex) } }) },
    { name: 'kind', change: () => restored.changeKind({ currentTarget: { dataset: { kind: 'debit' } } }), restore: () => {
      restored.changeKind({ currentTarget: { dataset: { kind: 'credit' } } });
      restored.toggleReminder({ detail: { value: true } });
    } },
    { name: 'billing enabled', change: () => restored.toggleReminder({ detail: { value: false } }), restore: () => restored.toggleReminder({ detail: { value: true } }) },
    { name: 'billing account', change: () => restored.changeBilling({ detail: { value: '1' } }), restore: () => restored.changeBilling({ detail: { value: '0' } }) },
    { name: 'statement day', change: () => restored.changeStatement({ detail: { value: '5' } }), restore: () => restored.changeStatement({ detail: { value: '4' } }) },
    { name: 'due day', change: () => restored.changeDueDay({ detail: { value: '25' } }), restore: () => restored.changeDueDay({ detail: { value: '24' } }) },
    { name: 'month offset', change: () => restored.changeOffset({ detail: { value: '1' } }), restore: () => restored.changeOffset({ detail: { value: '0' } }) },
    { name: 'due date', change: () => restored.changeDueDate({ detail: { value: '2026-09-26' } }), restore: () => restored.changeDueDate({ detail: { value: '2026-09-25' } }) },
    { name: 'reminder days', change: () => restored.changeRemind({ detail: { value: '3' } }), restore: () => restored.changeRemind({ detail: { value: '2' } }) },
  ];
  for (const edit of edits) {
    edit.change();
    assert.notDeepEqual(restored.commandPayload(), prepared.payload, `${edit.name} must change the submitted body.`);
    assert.equal(restored.data.recoveredDraftLookupAvailable, false, `${edit.name} must invalidate the captured lookup candidate.`);
    requests = [];
    await restored.resolveRecoveredDraftCreation();
    assert.deepEqual(requests, [], 'An unavailable lookup must reject direct handler invocation too.');
    edit.restore();
    assert.deepEqual(restored.commandPayload(), prepared.payload, `${edit.name} must restore the original body.`);
    assertLookupAvailable(restored);
  }
  await assertSaveBlocked(restored);
  assert.equal(calls('card.save').length, 0);
});

for (const invalid of [
  { name: 'missing', value: undefined }, { name: 'empty', value: '' },
  { name: 'non-string', value: 42 }, { name: 'oversized', value: 'x'.repeat(129) },
]) {
  test(`a restored draft with a ${invalid.name} original intent cannot obtain a result lookup from its replacement intent`, async () => {
    const prepared = await prepareOrdinaryDraft(false);
    const value = structuredClone(prepared.ordinary.value);
    if (invalid.value === undefined) delete value.intentKey;
    else value.intentKey = invalid.value;
    assert.equal(saveDraft('card', prepared.original.data.userId, prepared.original.data.draftEntityId, prepared.ordinary.baseVersion, value), true);
    const restored = await initialize();
    assert.equal(restored.data.nickname, 'Travel card');
    assert.notEqual(restored.data.intentKey, prepared.intentKey);
    assert.equal(restored.data.recoveredDraftLookupAvailable, false);
    const before = await f.store.exportSeed();
    requests = [];

    await restored.resolveRecoveredDraftCreation();
    await assertSaveBlocked(restored);

    assert.deepEqual(requests, []);
    assert.deepEqual(await f.store.exportSeed(), before);
    assert.equal(navigations.length, 0);
  });
}

test('declining recovery does not offer lookup when the same visible fields are entered under a fresh intent', async () => {
  const prepared = await prepareOrdinaryDraft(false);
  acceptRecovery = false;
  const restored = await initialize();
  assert.equal(modalCalls.length, 1);
  assert.equal(restored.data.nickname, '');
  assert.notEqual(restored.data.intentKey, prepared.intentKey);
  changeNickname(restored, 'Travel card');
  assert.deepEqual(restored.commandPayload(), prepared.payload);
  assert.equal(restored.data.recoveredDraftLookupAvailable, false);
  requests = [];

  await restored.resolveRecoveredDraftCreation();
  await assertSaveBlocked(restored);

  assert.deepEqual(requests, []);
  assert.equal((await f.store.find('requests')).length, 0);
  assert.equal(navigations.length, 0);
});

for (const failure of ['INVALID_INPUT', 'INVALID_ACTION', 'NETWORK_ERROR'] as const) {
  test(`an ordinary-draft result lookup with ${failure} preserves the draft and never retries a creation`, async () => {
    const prepared = await prepareOrdinaryDraft(true);
    const restored = await initialize();
    assertLookupAvailable(restored);
    const before = await f.store.exportSeed();
    const saved = draft(restored);
    const input = fields(restored);
    requests = [];
    transport = async (request, execute) => {
      if (request.action !== 'request.replay') return execute();
      if (failure === 'NETWORK_ERROR') throw new Error('Lookup response unavailable');
      return { result: { ok: false, error: { code: failure, message: 'Lookup not supported' } } };
    };

    await restored.resolveRecoveredDraftCreation();

    assert.deepEqual(requests.map(request => request.action), ['session.get', 'request.replay']);
    assert.deepEqual(calls('request.replay')[0].payload, prepared.originalRequest);
    assert.deepEqual(await f.store.exportSeed(), before);
    assert.deepEqual(draft(restored), saved);
    assert.deepEqual(fields(restored), input);
    assert.ok(restored.data.recoveredDraftLookupNotice.length > 0);
    assertLookupAvailable(restored);
    await assertSaveBlocked(restored);
    assert.equal(calls('card.save').length, 0);
    assert.equal(navigations.length, 0);
  });
}

test('a pending ordinary-draft lookup blocks duplicate activation, saving, and input changes', { timeout: 10_000 }, async () => {
  await prepareOrdinaryDraft(true);
  const restored = await initialize();
  const input = fields(restored);
  const before = await f.store.exportSeed();
  const started = deferred();
  const release = deferred();
  requests = [];
  transport = async (request, execute) => {
    if (request.action === 'request.replay') { started.resolve(); await release.promise; }
    return execute();
  };
  const first = restored.resolveRecoveredDraftCreation() as Promise<void>;
  const settled = first.then(() => undefined, () => undefined);
  try {
    await started.promise;
    assert.equal(restored.isBusy(), true);
    await restored.resolveRecoveredDraftCreation();
    await restored.save();
    changeNickname(restored, 'Must not replace the pending input');
    assert.deepEqual(fields(restored), input);
    assert.deepEqual(requests.map(request => request.action), ['session.get', 'request.replay']);
    assert.deepEqual(await f.store.exportSeed(), before);

    release.resolve();
    await first;
    assert.equal(calls('request.replay').length, 1);
    assert.equal(calls('card.save').length, 0);
    assert.deepEqual(await f.store.exportSeed(), before);
    assert.equal(draft(restored), null);
    assert.deepEqual(navigations, [{ kind: 'tab', url: '/pages/wallet/index' }]);
  } finally { release.resolve(); await settled; }
});

test('a late lookup cannot remove a newer draft revision or navigate after its page closes', { timeout: 10_000 }, async () => {
  await prepareOrdinaryDraft(true);
  const restored = await initialize();
  const inspectedRevision = revision(restored);
  const before = await f.store.exportSeed();
  const started = deferred();
  const release = deferred();
  transport = async (request, execute) => {
    if (request.action === 'request.replay') { started.resolve(); await release.promise; }
    return execute();
  };
  const resolving = restored.resolveRecoveredDraftCreation() as Promise<void>;
  const settled = resolving.then(() => undefined, () => undefined);
  try {
    await started.promise;
    const newerValue = { ...draft(restored)!.value, nickname: 'Newer unsent card', intentKey: createCommandIntent() };
    assert.equal(saveDraft('card', restored.data.userId, restored.data.draftEntityId, restored.data.draftBaseVersion, newerValue), true);
    const newer = draft(restored);
    const newerRevision = revision(restored);
    assert.notEqual(newerRevision, inspectedRevision);
    restored.onUnload();
    release.resolve();
    await resolving;

    assert.deepEqual(draft(restored), newer);
    assert.equal(revision(restored), newerRevision);
    assert.equal(draft(restored)?.value.nickname, 'Newer unsent card');
    assert.deepEqual(await f.store.exportSeed(), before);
    assert.equal(navigations.length, 0);
  } finally { release.resolve(); await settled; }
});

test('a fresh identity check prevents a recovered draft from being looked up under another account', async () => {
  await prepareOrdinaryDraft(true);
  const restored = await initialize();
  assertLookupAvailable(restored);
  const saved = draft(restored);
  const input = fields(restored);
  const before = await f.store.exportSeed();
  activeActor = { userId: `${f.prefix}-other-owner`, isModerator: false };
  requests = [];

  await restored.resolveRecoveredDraftCreation();

  assert.deepEqual(requests.map(request => request.action), ['session.get']);
  assert.deepEqual(draft(restored), saved);
  assert.deepEqual(fields(restored), input);
  assert.deepEqual(await f.store.exportSeed(), before);
  assert.ok(restored.data.recoveredDraftLookupNotice.length > 0);
  assert.equal(restored.data.saving, false);
  assert.equal(navigations.length, 0);
});

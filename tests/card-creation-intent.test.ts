import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, ApiEnvelope, ApiRequest, Bill, BillingAccount, Card, Wallet } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api, ensureSession } from '../miniprogram/services/api';
import { createCommandIntent, getDraftRevision, loadDraft, saveDraft } from '../miniprogram/services/form-draft';
import settings from '../miniprogram/runtime-config';

type PageInstance = { data: Record<string, any>; [key: string]: any };
type CommandOptions = { intentKey?: string; replayOnly?: boolean };
type CommandCall = { action: string; payload: any; options: CommandOptions | undefined; argumentCount: number };
type DraftValue = { [key: string]: any; intentKey?: unknown };
type RecordedRequest = { action: ApiRequest['action']; payload: any; requestId?: string };
type CloudResponse = { result: ApiEnvelope<unknown> };

let definition: PageInstance;
let wallet: Wallet;
let commandHandler: (action: string, payload: any, options?: CommandOptions) => Promise<any>;
let commands: CommandCall[] = [];
let modalCalls: any[] = [];
let modalResult = true;
let modalHandler: ((options: any) => Promise<{ confirm: boolean }>) | undefined;
let navigationCalls = 0;
let alertEnabled = false;
const storage = new Map<string, unknown>();
const originalQuery = api.query;
const originalCommand = api.command;
const originalWx = (globalThis as any).wx;
const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId };

before(async () => {
  const runtime = globalThis as any;
  const originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/card-edit/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  storage.clear(); commands = []; modalCalls = []; modalResult = true; modalHandler = undefined;
  navigationCalls = 0; alertEnabled = false;
  settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId;
  wallet = { cards: [], accounts: [], bills: [] };
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    showModal: async (options: any) => {
      modalCalls.push(options);
      return modalHandler ? modalHandler(options) : { confirm: modalResult, cancel: !modalResult };
    },
    nextTick: (callback: () => void) => callback(),
    pageScrollTo: () => {}, showToast: () => {}, setNavigationBarTitle: () => {},
    navigateBack: () => { navigationCalls += 1; },
    switchTab: () => { navigationCalls += 1; },
    redirectTo: () => { navigationCalls += 1; },
    enableAlertBeforeUnload: () => { alertEnabled = true; },
    disableAlertBeforeUnload: () => { alertEnabled = false; },
  };
  api.query = (async (action: string) => {
    if (action === 'session.get') return { userId: 'intent-user', demo: true, isModerator: false, today: '2026-09-23', month: '2026-09' };
    if (action === 'wallet.get') return structuredClone(wallet);
    throw new Error(`Unexpected query ${action}`);
  }) as typeof api.query;
  commandHandler = async (_action, payload) => ({ id: payload.id || 'created-card', version: 1 });
  api.command = (async (...args: [string, any, CommandOptions?]) => {
    const [action, payload, options] = args;
    commands.push({ action, payload: structuredClone(payload), options: structuredClone(options), argumentCount: args.length });
    return commandHandler(action, payload, options);
  }) as typeof api.command;
});

after(() => {
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).wx = originalWx;
  settings.mode = originalSettings.mode; settings.cloudEnvId = originalSettings.cloudEnvId;
});

function page(options: { id?: string; bankId?: string } = {}): PageInstance {
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data) };
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
    Object.assign(instance.data, patch);
    callback?.();
  };
  instance.setData({ id: options.id || '', initialBankId: options.bankId ?? 'cmb', editing: !!options.id });
  return instance;
}

async function initialize(options: { id?: string; bankId?: string } = {}): Promise<PageInstance> {
  const instance = page(options);
  await instance.load();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.failed, false);
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function draft(instance: PageInstance) {
  return loadDraft<DraftValue>('card', instance.data.userId, instance.data.draftEntityId);
}

function changeNickname(instance: PageInstance, value: string) {
  instance.changeNickname({ detail: { value } });
}

function assertIntent(value: unknown): asserts value is string {
  assert.ok(typeof value === 'string' && value.trim().length > 0 && value.length <= 128, 'A creation intent must be a nonempty bounded string.');
}

function networkFailure() { return Object.assign(new Error('Creation response unavailable'), { code: 'NETWORK_ERROR' }); }

function card(id: string, nickname: string): Card {
  return {
    id, ownerId: 'intent-user', bankId: 'cmb', issuerId: 'cmb-cn', network: 'unionpay', kind: 'credit',
    nickname, createdAt: '2026-09-23T00:00:00Z',
  };
}

async function realClientWithLostCreationResponse(initialDate = '2026-09-23', loseFirstCreationResponse = true) {
  const store = new MemoryStore();
  const actor: Actor = { userId: 'intent-user', isModerator: false };
  let currentDate = new Date(`${initialDate}T04:00:00.000Z`);
  const service = createService(store, { now: () => currentDate, demo: true });
  const requests: RecordedRequest[] = [];
  let responseLost = false;
  settings.mode = 'cloud'; settings.cloudEnvId = 'card-creation-intent-test';
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).wx.cloud = {
    init: () => {},
    callFunction: async ({ data }: { data: ApiRequest }): Promise<CloudResponse> => {
      const request = structuredClone(data) as RecordedRequest;
      requests.push(request);
      try {
        const result = await service.execute(actor, request as ApiRequest);
        if (loseFirstCreationResponse && !responseLost && request.action === 'card.save' && !request.payload.id) {
          responseLost = true;
          throw new Error('Creation response lost after server commit');
        }
        return { result: { ok: true, data: result } };
      } catch (error) {
        if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
        throw error;
      }
    },
  };
  await ensureSession(true);
  return { store, requests, setDate: (date: string) => { currentDate = new Date(`${date}T04:00:00.000Z`); } };
}

function configureIndependentBilling(instance: PageInstance, dueOn: string) {
  instance.toggleReminder({ detail: { value: true } });
  instance.changeStatement({ detail: { value: '4' } });
  instance.changeDueDate({ detail: { value: dueOn } });
}

async function seedBillingAccount(store: MemoryStore, shared = false) {
  const account: BillingAccount = { id: 'account-a', ownerId: 'intent-user', bankId: 'cmb', issuerId: 'cmb-cn', label: 'Original account',
    statementDay: 5, dueDay: 30, dueMonthOffset: 0, remindDays: 3, enabled: true };
  const savedCard: Card = { ...card('saved-card', 'Original card'), billingAccountId: account.id };
  const september: Bill = { id: 'bill-account-september', ownerId: 'intent-user', billingAccountId: account.id, periodKey: '2026-09',
    statementOn: '2026-09-05', dueOn: '2026-09-20', paidAt: null };
  await store.set('billing_accounts', account.id, account);
  await store.set('cards', savedCard.id, savedCard);
  await store.set('bills', september.id, september);
  if (shared) await store.set('cards', 'sibling-card', { ...card('sibling-card', 'Sibling card'), billingAccountId: account.id });
  return { account, savedCard, september };
}

test('fresh creation pages receive distinct intents without treating intent metadata as an unsaved field', async () => {
  const first = await initialize();
  const firstIntent = first.data.intentKey;
  assertIntent(firstIntent);
  assert.equal(first.data.dirty, false);
  assert.equal(draft(first), null);
  changeNickname(first, 'Temporary card');
  assert.equal(draft(first)?.value.intentKey, firstIntent);
  assert.equal(first.data.dirty, true);
  changeNickname(first, '');
  assert.equal(first.data.intentKey, firstIntent);
  assert.equal(first.data.dirty, false, 'Returning every visible field to its baseline must clear ordinary unsaved edits.');
  assert.equal(draft(first), null, 'The generated intent alone must not leave an unsaved draft before any submission.');
  assert.equal(alertEnabled, false);
  first.onUnload();
  const second = await initialize();
  assertIntent(second.data.intentKey);
  assert.notEqual(second.data.intentKey, firstIntent);
  assert.equal(second.data.dirty, false);
  assert.equal(draft(second), null);
  assert.equal(modalCalls.length, 0);
  assert.equal(commands.length, 0);
});

test('a valid saved creation intent is reused only after the user confirms draft recovery', async () => {
  const original = await initialize();
  const savedIntent = createCommandIntent();
  assertIntent(savedIntent);
  saveDraft('card', original.data.userId, original.data.draftEntityId, original.data.draftBaseVersion, {
    ...original.formDraft(), nickname: 'Recovered card', intentKey: savedIntent,
  });
  original.onUnload();
  const decision = deferred<{ confirm: boolean }>();
  const promptOpened = deferred<void>();
  modalHandler = async () => { promptOpened.resolve(); return decision.promise; };
  const restored = page();
  const loading = restored.load();
  await promptOpened.promise;
  assertIntent(restored.data.intentKey);
  assert.notEqual(restored.data.intentKey, savedIntent, 'Reading storage must not adopt a saved intent before confirmation.');
  assert.equal(restored.data.nickname, '');
  assert.equal(commands.length, 0);
  decision.resolve({ confirm: true });
  await loading;
  assert.equal(restored.data.intentKey, savedIntent);
  assert.equal(restored.data.nickname, 'Recovered card');
  assert.equal(draft(restored)?.value.intentKey, savedIntent);
  assert.equal(commands.length, 0, 'Restoring an intent must not automatically submit its creation.');
  await restored.save();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].argumentCount, 3);
  assert.deepEqual(commands[0].options, { intentKey: savedIntent });
  assert.equal(commands[0].payload.nickname, 'Recovered card');
  assert.equal(Object.hasOwn(commands[0].payload, 'intentKey'), false, 'Intent metadata must not enter the business command payload.');
  assert.equal(Object.hasOwn(commands[0].payload, 'id'), false);
  assert.equal(draft(restored), null);
});

test('declining a saved creation draft starts a new intent even when the user enters the same payload again', async () => {
  const original = await initialize();
  changeNickname(original, 'Travel card');
  const originalIntent = original.data.intentKey;
  commandHandler = async () => { throw networkFailure(); };
  await original.save();
  assert.equal(commands.length, 1);
  assert.equal(draft(original)?.value.intentKey, originalIntent);
  original.onUnload();
  modalResult = false;
  const restarted = await initialize();
  assert.equal(modalCalls.length, 1);
  assertIntent(restarted.data.intentKey);
  assert.notEqual(restarted.data.intentKey, originalIntent);
  assert.equal(restarted.data.nickname, '');
  assert.equal(draft(restarted), null);
  assert.equal(commands.length, 1);
  changeNickname(restarted, 'Travel card');
  commandHandler = async () => ({ id: 'new-card', version: 1 });
  await restarted.save();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].payload, commands[0].payload);
  assert.deepEqual(commands[1].options, { intentKey: restarted.data.intentKey });
  assert.notEqual(commands[1].options?.intentKey, commands[0].options?.intentKey);
});

const draftIntentCases: { name: string; value?: unknown; legacy?: boolean }[] = [
  { name: 'legacy draft without intent metadata', legacy: true },
  { name: 'empty intent', value: '' },
  { name: 'whitespace intent', value: '   ' },
  { name: 'non-string intent', value: 42 },
  { name: 'oversized intent', value: 'x'.repeat(129) },
];

for (const scenario of draftIntentCases) {
  test(`recovering a ${scenario.name} retains its fields and uses the freshly generated creation intent`, async () => {
    const original = await initialize();
    const originalIntent = original.data.intentKey;
    const saved: DraftValue = { ...original.formDraft(), nickname: 'Compatible draft' };
    if (scenario.legacy) delete saved.intentKey;
    else saved.intentKey = scenario.value;
    saveDraft('card', original.data.userId, original.data.draftEntityId, original.data.draftBaseVersion, saved);
    original.onUnload();
    const restored = page();
    let freshIntent: unknown;
    modalHandler = async () => { freshIntent = restored.data.intentKey; return { confirm: true }; };
    await restored.load();
    assert.equal(restored.data.failed, false);
    assert.equal(modalCalls.length, 1, 'Invalid intent metadata must not prevent otherwise valid form fields from being recovered.');
    assertIntent(freshIntent);
    assert.notEqual(freshIntent, originalIntent);
    assert.equal(restored.data.intentKey, freshIntent);
    assert.equal(restored.data.nickname, 'Compatible draft');
    assert.equal(draft(restored)?.value.intentKey, freshIntent, 'Recovered drafts must persist the usable replacement intent.');
    assert.equal(commands.length, 0);
    await restored.save();
    assert.equal(commands.length, 1);
    assert.deepEqual(commands[0].options, { intentKey: freshIntent });
    assert.equal(commands[0].payload.nickname, 'Compatible draft');
  });
}

test('retrying an unchanged failed creation preserves its payload and intent until success clears the draft', async () => {
  const instance = await initialize();
  changeNickname(instance, 'Retry card');
  const intent = instance.data.intentKey;
  commandHandler = async () => { throw networkFailure(); };
  await instance.save();
  assert.equal(commands.length, 1);
  assert.equal(instance.data.saving, false);
  assert.equal(instance.data.dirty, true);
  assert.equal(draft(instance)?.value.intentKey, intent);
  assert.equal(navigationCalls, 0);
  commandHandler = async () => ({ id: 'created-card', version: 1 });
  await instance.save();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], commands[0], 'An unchanged retry is the same creation intent and business payload.');
  assert.deepEqual(commands[1].options, { intentKey: intent });
  assert.equal(instance.data.dirty, false);
  assert.equal(draft(instance), null);
  assert.equal(alertEnabled, false);
  assert.equal(navigationCalls, 1);
  instance.onUnload();
  const next = await initialize();
  assertIntent(next.data.intentKey);
  assert.notEqual(next.data.intentKey, intent);
  assert.equal(modalCalls.length, 0, 'A completed creation must not leave a recoverable creation draft behind.');
});

test('a failed default-field creation persists a recoverable intent before sending and retries with that intent after reopening', async () => {
  const original = await initialize();
  const intent = original.data.intentKey;
  assert.equal(original.data.nickname, '');
  assert.equal(original.data.dirty, false);
  assert.equal(draft(original), null);
  let savedBeforeCommand: DraftValue | undefined;
  commandHandler = async () => {
    savedBeforeCommand = draft(original)?.value;
    throw networkFailure();
  };
  await original.save();
  assert.equal(commands.length, 1, 'The default card fields must remain a valid creation payload.');
  assert.equal(savedBeforeCommand?.intentKey, intent, 'The intent must reach durable draft storage before the request starts.');
  assert.equal(savedBeforeCommand?.nickname, '');
  assert.equal(original.data.dirty, true);
  assert.equal(original.data.draftSaved, true);
  assert.equal(alertEnabled, true);
  original.markChanged();
  assert.equal(draft(original)?.value.intentKey, intent, 'Rechecking unchanged defaults after a failed submission must not erase the retry identity.');
  original.onUnload();
  const restored = await initialize();
  assert.equal(modalCalls.length, 1, 'A submitted draft requires a recovery decision even when all visible fields equal their defaults.');
  assert.equal(restored.data.intentKey, intent);
  assert.equal(restored.data.nickname, '');
  assert.equal(restored.data.dirty, true);
  assert.equal(draft(restored)?.value.intentKey, intent);
  commandHandler = async () => ({ id: 'created-card', version: 1 });
  await restored.save();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], commands[0]);
  assert.equal(draft(restored), null);
});

test('editing an existing card uses the original two-argument command contract', async () => {
  wallet.cards = [card('existing-card', 'Original card')];
  const instance = await initialize({ id: 'existing-card' });
  changeNickname(instance, 'Updated card');
  assert.equal(Object.hasOwn(instance.formDraft(), 'intentKey'), false);
  await instance.save();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'card.save');
  assert.equal(commands[0].payload.id, 'existing-card');
  assert.equal(commands[0].payload.nickname, 'Updated card');
  assert.equal(commands[0].argumentCount, 2);
  assert.equal(commands[0].options, undefined);
  assert.equal(Object.hasOwn(commands[0].payload, 'intentKey'), false);
  assert.equal(draft(instance), null);
});

test('rejecting a lost-response creation draft after editing its saved card starts a distinct creation intent for the original payload', async () => {
  let firstCreationAccepted = false;
  commandHandler = async (_action, payload) => {
    if (!payload.id && !firstCreationAccepted) {
      firstCreationAccepted = true;
      wallet.cards.push(card('accepted-card', payload.nickname));
      throw networkFailure();
    }
    if (payload.id) {
      wallet.cards = wallet.cards.map(item => item.id === payload.id ? { ...item, nickname: payload.nickname } : item);
      return { id: payload.id, version: 2 };
    }
    wallet.cards.push(card('second-card', payload.nickname));
    return { id: 'second-card', version: 1 };
  };
  const first = await initialize();
  changeNickname(first, 'Card A');
  await first.save();
  const firstIntent = first.data.intentKey;
  assert.equal(wallet.cards.length, 1, 'The first command was accepted even though its response was lost.');
  assert.equal(wallet.cards[0].nickname, 'Card A');
  assert.equal(draft(first)?.value.intentKey, firstIntent);
  first.onUnload();

  const edit = await initialize({ id: 'accepted-card' });
  changeNickname(edit, 'Card B');
  await edit.save();
  assert.equal(wallet.cards[0].nickname, 'Card B');
  assert.equal(commands[1].argumentCount, 2);
  assert.equal(commands[1].options, undefined);
  assert.equal(loadDraft<DraftValue>('card', 'intent-user', 'new:cmb')?.value.intentKey, firstIntent, 'Editing the saved card must not consume a separate creation draft.');
  edit.onUnload();

  modalResult = false;
  const second = await initialize();
  assert.equal(modalCalls.length, 1);
  assert.notEqual(second.data.intentKey, firstIntent);
  assert.equal(second.data.nickname, '');
  assert.equal(commands.length, 2, 'Rejecting recovery must not resubmit the lost-response request.');
  changeNickname(second, 'Card A');
  await second.save();
  assert.equal(commands.length, 3);
  assert.deepEqual(commands[2].payload, commands[0].payload, 'The explicit new card uses the same business payload as the earlier creation.');
  assert.deepEqual(commands[2].options, { intentKey: second.data.intentKey });
  assert.notEqual(commands[2].options?.intentKey, commands[0].options?.intentKey);
  assert.deepEqual(wallet.cards.map(item => [item.id, item.nickname]), [['accepted-card', 'Card B'], ['second-card', 'Card A']]);
  assert.equal(draft(second), null);
});

test('a late creation success cannot clear a new draft created after explicitly declining its pending intent', async () => {
  const original = await initialize();
  changeNickname(original, 'First card');
  const originalIntent = original.data.intentKey;
  const pending = deferred<{ id: string; version: number }>();
  const started = deferred<void>();
  commandHandler = () => { started.resolve(); return pending.promise; };
  const saving = original.save();
  await started.promise;
  assert.equal(commands.length, 1);
  assert.equal(draft(original)?.value.intentKey, originalIntent);
  original.onUnload();
  modalResult = false;
  const replacement = await initialize();
  changeNickname(replacement, 'Replacement card');
  const replacementIntent = replacement.data.intentKey;
  assert.notEqual(replacementIntent, originalIntent);
  const revision = getDraftRevision('card', 'intent-user', 'new:cmb');
  pending.resolve({ id: 'first-card', version: 1 });
  await saving;
  assert.equal(draft(replacement)?.value.nickname, 'Replacement card');
  assert.equal(draft(replacement)?.value.intentKey, replacementIntent);
  assert.equal(getDraftRevision('card', 'intent-user', 'new:cmb'), revision);
  assert.equal(replacement.data.dirty, true);
  assert.equal(alertEnabled, true);
  assert.equal(navigationCalls, 0, 'A closed creation page must not navigate a replacement form.');
});

test('an accepted creation with a lost response replays the same request after confirmed recovery without creating a duplicate card', async () => {
  const fixture = await realClientWithLostCreationResponse();
  const original = await initialize();
  changeNickname(original, 'Travel card');
  const intent = original.data.intentKey;
  await original.save();
  const firstAttempt = fixture.requests.find(request => request.action === 'card.save')!;
  assert.ok(firstAttempt.requestId);
  const accepted = await fixture.store.find<Card>('cards');
  assert.equal(accepted.length, 1, 'The real service must have committed the card before the transport loses its response.');
  assert.equal(accepted[0].nickname, 'Travel card');
  assert.equal(navigationCalls, 0);
  assert.equal(original.data.dirty, true);
  assert.deepEqual(draft(original)?.value.pendingCreation, {
    pending: true, intentKey: intent, payloadSignature: JSON.stringify(firstAttempt.payload),
  });
  assert.equal(Object.hasOwn(firstAttempt.payload, 'pendingCreation'), false);
  original.onUnload();

  const restored = await initialize();
  assert.equal(modalCalls.length, 1);
  assert.equal(restored.data.intentKey, intent);
  assert.equal(restored.data.raw.cards.length, 1, 'The restored controller must read the accepted card through the real wallet query.');
  assert.equal(restored.data.raw.cards[0].id, accepted[0].id);
  assert.equal(restored.data.raw.cards[0].nickname, restored.data.nickname);
  assert.equal(restored.data.pendingCreationSignature, JSON.stringify(firstAttempt.payload));
  assert.equal(restored.validationErrors().nickname, undefined, 'The unchanged pending request must not collide with its own already-created card.');
  changeNickname(restored, '  Travel card  ');
  assert.deepEqual(restored.commandPayload(), firstAttempt.payload, 'Surrounding whitespace is normalized before the retry payload is compared.');
  await restored.save();

  const attempts = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(attempts.length, 2, 'Recovery must reach the actual client and server again instead of stopping at nickname validation.');
  assert.equal(attempts[1].requestId, attempts[0].requestId);
  assert.deepEqual(attempts[1].payload, attempts[0].payload);
  assert.deepEqual(await fixture.store.find<Card>('cards'), accepted);
  assert.equal((await fixture.store.find('requests')).length, 1);
  assert.equal((await fixture.store.find('audit_events')).length, 1);
  assert.equal(restored.data.pendingCreationSignature, '');
  assert.equal(restored.data.dirty, false);
  assert.equal(draft(restored), null);
  assert.equal(navigationCalls, 1);
});

for (const submitted of [false, true]) {
  test(`a ${submitted ? 'legacy intent-only' : 'never-submitted'} creation draft cannot bypass a duplicate nickname`, async () => {
    const original = await initialize();
    changeNickname(original, 'Duplicate card');
    if (submitted) {
      commandHandler = async () => { throw networkFailure(); };
      await original.save();
    }
    const saved = draft(original)!;
    const intent = original.data.intentKey;
    delete saved.value.pendingCreation;
    saveDraft('card', original.data.userId, original.data.draftEntityId, saved.baseVersion, saved.value);
    original.onUnload();
    wallet.cards = [card('other-card', 'Duplicate card')];
    const restored = await initialize();
    assert.equal(restored.data.intentKey, intent, 'A usable intent may be restored without granting pending-request validation exceptions.');
    assert.equal(restored.data.pendingCreationSignature, '');
    assert.equal(draft(restored)?.value.pendingCreation, undefined);
    assert.ok(restored.validationErrors().nickname);
    const previousCommands = commands.length;
    await restored.save();
    assert.equal(commands.length, previousCommands);
    assert.ok(restored.data.errors.nickname);
    assert.equal(draft(restored)?.value.nickname, 'Duplicate card');
    assert.equal(draft(restored)?.value.pendingCreation, undefined);
  });
}

const invalidPendingCases: { name: string; mutate: (pending: Record<string, unknown>) => void }[] = [
  { name: 'a different intent', mutate: pending => { pending.intentKey = createCommandIntent(); } },
  { name: 'an inactive pending flag', mutate: pending => { pending.pending = false; } },
  { name: 'a non-string signature', mutate: pending => { pending.payloadSignature = {}; } },
  { name: 'an empty signature', mutate: pending => { pending.payloadSignature = ''; } },
  { name: 'an oversized signature', mutate: pending => { pending.payloadSignature = 'x'.repeat(2049); } },
];

for (const scenario of invalidPendingCases) {
  test(`restoring pending creation metadata with ${scenario.name} cannot bypass duplicate nickname validation`, async () => {
    const original = await initialize();
    changeNickname(original, 'Duplicate card');
    const pending: Record<string, unknown> = {
      pending: true, intentKey: original.data.intentKey, payloadSignature: JSON.stringify(original.commandPayload()),
    };
    scenario.mutate(pending);
    saveDraft('card', original.data.userId, original.data.draftEntityId, original.data.draftBaseVersion, {
      ...original.formDraft(), pendingCreation: pending,
    });
    original.onUnload();
    wallet.cards = [card('other-card', 'Duplicate card')];
    const restored = await initialize();
    assert.equal(restored.data.nickname, 'Duplicate card');
    assert.equal(restored.data.pendingCreationSignature, '');
    assert.equal(draft(restored)?.value.pendingCreation, undefined);
    await restored.save();
    assert.ok(restored.data.errors.nickname);
    assert.equal(commands.length, 0);
  });
}

test('pending recovery freezes edits and retains nickname validation for legacy changed input without replacing its original request', async () => {
  const original = await initialize();
  changeNickname(original, 'Travel card');
  commandHandler = async () => {
    wallet.cards = [card('accepted-card', 'Travel card')];
    throw networkFailure();
  };
  await original.save();
  const originalCommand = structuredClone(commands[0]);
  original.onUnload();
  const restored = await initialize();
  assert.equal(restored.validationErrors().nickname, undefined);
  restored.toggleReminder({ detail: { value: true } });
  restored.changeStatement({ detail: { value: '4' } });
  restored.changeDueDate({ detail: { value: '2026-10-20' } });
  assert.deepEqual(restored.commandPayload(), originalCommand.payload, 'Pending creation controls must remain locked.');
  // Emulate later input persisted by an older client before pending controls were locked.
  restored.setData({ reminderEnabled: true, statementDay: 5, dueDay: 20, dueOn: '2026-10-20' });
  restored.markChanged();
  assert.notDeepEqual(restored.commandPayload(), originalCommand.payload);
  assert.deepEqual(Object.keys(restored.validationErrors()), ['nickname'], 'Changing billing cannot use a pending creation to create a same-name card.');
  await restored.save();
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], originalCommand, 'Only the immutable original creation may be retried.');
  assert.ok(restored.validationErrors().nickname);
  assert.equal(draft(restored)?.value.pendingCreation.payloadSignature, JSON.stringify(originalCommand.payload));
  restored.setData({ reminderEnabled: false, statementDay: 0, dueDay: 0, dueOn: '' });
  restored.markChanged();
  assert.deepEqual(restored.commandPayload(), originalCommand.payload);
  assert.equal(restored.validationErrors().nickname, undefined);
  commandHandler = async () => ({ id: 'accepted-card', version: 1 });
  await restored.save();
  assert.equal(commands.length, 3);
  assert.deepEqual(commands[2], originalCommand);
  assert.equal(draft(restored), null);
});

test('a matching pending payload exempts only duplicate naming and preserves independent billing validation', async () => {
  const original = await initialize();
  changeNickname(original, 'Duplicate card');
  original.toggleReminder({ detail: { value: true } });
  const pending = { pending: true, intentKey: original.data.intentKey, payloadSignature: JSON.stringify(original.commandPayload()) };
  saveDraft('card', original.data.userId, original.data.draftEntityId, original.data.draftBaseVersion, {
    ...original.formDraft(), pendingCreation: pending,
  });
  original.onUnload();
  wallet.cards = [card('other-card', 'Duplicate card')];
  const restored = await initialize();
  assert.equal(restored.data.pendingCreationSignature, JSON.stringify(restored.commandPayload()));
  const errors = restored.validationErrors();
  assert.equal(errors.nickname, undefined);
  assert.ok(errors.statementDay);
  assert.ok(errors.dueOn);
  assert.ok(errors.dueDay);
  await restored.save();
  assert.equal(commands.length, 0);
  assert.ok(restored.data.errors.statementDay);
  assert.ok(restored.data.errors.dueOn);
  assert.ok(restored.data.errors.dueDay);
  assert.equal(draft(restored)?.value.nickname, 'Duplicate card');
});

test('a definite server rejection removes pending creation evidence and cannot authorize a later duplicate retry', async () => {
  const original = await initialize();
  changeNickname(original, 'Rejected card');
  let pendingAtSubmission: unknown;
  commandHandler = async () => {
    pendingAtSubmission = draft(original)?.value.pendingCreation;
    throw Object.assign(new Error('Nickname rejected'), { code: 'INVALID_INPUT', field: 'nickname' });
  };
  await original.save();
  assert.ok(pendingAtSubmission, 'Pending evidence is recorded before dispatch even when the eventual response rejects the request.');
  assert.equal(commands.length, 1);
  assert.equal(original.data.pendingCreationSignature, '');
  assert.equal(draft(original)?.value.pendingCreation, undefined);
  assert.equal(draft(original)?.value.nickname, 'Rejected card');
  original.onUnload();
  wallet.cards = [card('other-card', 'Rejected card')];
  const restored = await initialize();
  assert.equal(restored.data.pendingCreationSignature, '');
  await restored.save();
  assert.equal(commands.length, 1);
  assert.ok(restored.data.errors.nickname);
  assert.equal(draft(restored)?.value.pendingCreation, undefined);
});

test('a late definite rejection cannot rewrite a newer creation draft while clearing its own pending evidence', async () => {
  const original = await initialize();
  changeNickname(original, 'Original request');
  let reject!: (error: Error) => void;
  const started = deferred<void>();
  commandHandler = () => new Promise((_resolve, fail) => { reject = fail; started.resolve(); });
  const saving = original.save();
  await started.promise;
  const newerIntent = createCommandIntent();
  saveDraft('card', original.data.userId, original.data.draftEntityId, original.data.draftBaseVersion, {
    ...original.formDraft(), intentKey: newerIntent, pendingCreation: undefined, nickname: 'Newer draft',
  });
  const newerRevision = getDraftRevision('card', original.data.userId, original.data.draftEntityId);
  reject(Object.assign(new Error('Original request rejected'), { code: 'INVALID_INPUT', field: 'nickname' }));
  await saving;
  assert.equal(original.data.pendingCreationSignature, '');
  assert.equal(draft(original)?.value.intentKey, newerIntent);
  assert.equal(draft(original)?.value.nickname, 'Newer draft');
  assert.equal(getDraftRevision('card', original.data.userId, original.data.draftEntityId), newerRevision);
});

for (const code of ['INVALID_RESPONSE', 'TRANSPORT_TIMEOUT', 'UNAUTHENTICATED', 'CONFIGURATION_REQUIRED', 'FORBIDDEN', 'INVALID_ACTION', 'REQUEST_CONFLICT']) {
  test(`an ambiguous ${code} result preserves pending creation evidence for an unchanged recovered retry`, async () => {
    const original = await initialize();
    changeNickname(original, 'Unconfirmed card');
    commandHandler = async () => {
      wallet.cards = [card('accepted-card', 'Unconfirmed card')];
      throw Object.assign(new Error('Creation result cannot be confirmed'), { code });
    };
    await original.save();
    const first = structuredClone(commands[0]);
    const pending = { pending: true, intentKey: original.data.intentKey, payloadSignature: JSON.stringify(first.payload) };
    assert.deepEqual(draft(original)?.value.pendingCreation, pending);
    assert.equal(original.data.pendingCreationSignature, pending.payloadSignature);
    original.onUnload();
    const restored = await initialize();
    assert.equal(restored.data.intentKey, first.options?.intentKey);
    assert.equal(restored.data.pendingCreationSignature, pending.payloadSignature);
    assert.equal(restored.validationErrors().nickname, undefined);
    commandHandler = async () => ({ id: 'accepted-card', version: 1 });
    await restored.save();
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[1], first);
    assert.equal(restored.data.pendingCreationSignature, '');
    assert.equal(draft(restored), null);
  });
}

test('a September creation result lookup in October retains its original identity and does not overwrite the October bill', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30');
  const original = await initialize();
  changeNickname(original, 'Monthly card');
  configureIndependentBilling(original, '2026-09-30');
  const intent = original.data.intentKey;
  await original.save();
  const first = fixture.requests.find(request => request.action === 'card.save')!;
  assert.equal(first.payload.billing.statementDay, 5);
  assert.equal(first.payload.billing.dueMonthOffset, 0);
  assert.equal(first.payload.billing.periodKey, '2026-09');
  assert.equal(first.payload.billing.dueOn, '2026-09-30');
  assert.equal(draft(original)?.value.pendingCreationPeriod, '2026-09');
  const acceptedCards = await fixture.store.find<Card>('cards');
  assert.equal(acceptedCards.length, 1);
  const september = (await fixture.store.find<Bill>('bills')).find(bill => bill.periodKey === '2026-09')!;
  assert.equal(september.dueOn, '2026-09-30');
  original.onUnload();

  fixture.setDate('2026-10-01');
  const restored = await initialize();
  assert.equal(restored.data.currentMonth, '2026-10');
  assert.equal(restored.data.billingTarget.periodKey, '2026-09');
  assert.equal(restored.data.intentKey, intent);
  assert.equal(restored.data.retryingPending, true);
  assert.equal(restored.data.pendingLookupOnly, true);
  assert.match(modalCalls.at(-1).content, /2026年9月/);
  assert.match(modalCalls.at(-1).content, /也可能已经成功/);
  assert.equal(restored.data.periodRebaseNeeded, false);
  assert.equal(restored.data.dueOn, '2026-09-30');
  assert.deepEqual(restored.commandPayload(), first.payload);
  const october = (await fixture.store.find<Bill>('bills')).find(bill => bill.periodKey === '2026-10')!;
  assert.ok(october, 'The October wallet read must materialize the next bill before the old creation is replayed.');
  assert.equal(october.dueOn, '2026-10-30');
  await restored.save();

  const attempts = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(attempts.length, 1);
  const lookup = fixture.requests.filter(request => request.action === 'request.replay');
  assert.equal(lookup.length, 1);
  assert.equal(lookup[0].payload.requestId, attempts[0].requestId);
  assert.deepEqual(lookup[0].payload.payload, attempts[0].payload);
  assert.deepEqual(await fixture.store.find<Card>('cards'), acceptedCards);
  assert.deepEqual(await fixture.store.get<Bill>('bills', september.id), september);
  assert.deepEqual(await fixture.store.get<Bill>('bills', october.id), october);
  assert.equal((await fixture.store.find('requests')).length, 1);
  assert.equal(draft(restored), null);
});

test('a nickname-only card edit opened in September and saved in October sends no billing changes', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const seeded = await seedBillingAccount(fixture.store);
  const instance = await initialize({ id: seeded.savedCard.id });
  assert.equal(instance.data.billingTarget.billId, seeded.september.id);
  changeNickname(instance, 'Renamed card');
  fixture.setDate('2026-10-01');
  const before = await api.query('wallet.get', {});
  assert.equal(before.bills.length, 2);
  await instance.save();
  const sent = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.id, seeded.savedCard.id);
  assert.equal(sent[0].payload.nickname, 'Renamed card');
  assert.equal(Object.hasOwn(sent[0].payload, 'billing'), false);
  assert.equal(Object.hasOwn(sent[0].payload, 'billingAccountId'), false);
  for (const bill of before.bills) assert.deepEqual(await fixture.store.get<Bill>('bills', bill.id), bill);
  assert.deepEqual(await fixture.store.get<BillingAccount>('billing_accounts', seeded.account.id), seeded.account);
  assert.equal((await fixture.store.get<Card>('cards', seeded.savedCard.id))?.nickname, 'Renamed card');
  assert.equal(draft(instance), null);
});

test('a rule-only card edit across the month boundary omits date targets and preserves generated bill snapshots', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const seeded = await seedBillingAccount(fixture.store);
  const instance = await initialize({ id: seeded.savedCard.id });
  fixture.setDate('2026-10-01');
  const before = await api.query('wallet.get', {});
  instance.changeStatement({ detail: { value: '28' } });
  await instance.save();
  const sent = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.billing.statementDay, 29);
  assert.equal(Object.hasOwn(sent[0].payload.billing, 'dueOn'), false);
  assert.equal(Object.hasOwn(sent[0].payload.billing, 'billId'), false);
  assert.equal(Object.hasOwn(sent[0].payload.billing, 'periodKey'), false);
  for (const bill of before.bills) assert.deepEqual(await fixture.store.get<Bill>('bills', bill.id), bill);
  assert.equal((await fixture.store.get<BillingAccount>('billing_accounts', seeded.account.id))?.statementDay, 29);
  assert.equal((await fixture.store.get<Bill>('bills', seeded.september.id))?.statementOn, '2026-09-05');
  assert.equal(draft(instance), null);
});

test('correcting the September actual due date in October targets its bill ID and uses its original statement date', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const seeded = await seedBillingAccount(fixture.store);
  const instance = await initialize({ id: seeded.savedCard.id });
  fixture.setDate('2026-10-01');
  const before = await api.query('wallet.get', {});
  const october = before.bills.find(bill => bill.periodKey === '2026-10')!;
  instance.changeStatement({ detail: { value: '28' } });
  instance.changeDueDate({ detail: { value: '2026-09-21' } });
  assert.equal(instance.validationErrors().dueOn, undefined, 'A September correction is checked against the saved September 5 statement, not the new future rule.');
  await instance.save();
  const sent = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.billing.billId, seeded.september.id);
  assert.equal(sent[0].payload.billing.periodKey, '2026-09');
  assert.equal(sent[0].payload.billing.dueOn, '2026-09-21');
  assert.equal(sent[0].payload.billing.statementDay, 29);
  assert.deepEqual(await fixture.store.get<Bill>('bills', seeded.september.id), { ...seeded.september, dueOn: '2026-09-21' });
  assert.deepEqual(await fixture.store.get<Bill>('bills', october.id), october);
  assert.equal((await fixture.store.get<BillingAccount>('billing_accounts', seeded.account.id))?.statementDay, 29);
  assert.equal(draft(instance), null);
});

test('an unsubmitted September billing draft requires an October rebase and explicit date confirmation before its first save', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const original = await initialize();
  changeNickname(original, 'Recovered monthly card');
  configureIndependentBilling(original, '2026-10-30');
  const savedFields = { nickname: original.data.nickname, statementDay: original.data.statementDay, dueDay: original.data.dueDay,
    dueMonthOffset: original.data.dueMonthOffset, dueOn: original.data.dueOn };
  assert.equal(draft(original)?.value.pendingCreation, undefined);
  original.onUnload();
  fixture.setDate('2026-10-01');
  const restored = await initialize();
  assert.equal(restored.data.currentMonth, '2026-10');
  assert.equal(restored.data.billingTarget.periodKey, '2026-09');
  assert.equal(restored.data.periodRebaseNeeded, true);
  await restored.save();
  assert.ok(restored.data.errors.dueOn);
  assert.equal(fixture.requests.filter(request => request.action === 'card.save').length, 0);

  await restored.rebaseBillingPeriod();
  for (const [field, value] of Object.entries(savedFields)) assert.equal(restored.data[field], value, `Rebasing must retain ${field} for review.`);
  assert.equal(restored.data.billingTarget.periodKey, '2026-10');
  assert.equal(restored.data.billingTarget.billId, '');
  assert.equal(restored.data.dateNeedsReview, true);
  assert.equal(restored.data.periodRebaseNeeded, false);
  await restored.save();
  assert.ok(restored.data.errors.dueOn);
  assert.equal(fixture.requests.filter(request => request.action === 'card.save').length, 0, 'Changing the billing period alone must not confirm the retained date.');
  restored.confirmDueDate();
  assert.equal(restored.data.dateNeedsReview, false);
  assert.equal(restored.validationErrors().dueOn, undefined);
  await restored.save();
  const attempts = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].payload.billing.periodKey, '2026-10');
  assert.equal(attempts[0].payload.billing.dueOn, savedFields.dueOn);
  const bills = await fixture.store.find<Bill>('bills');
  assert.equal(bills.length, 1);
  assert.equal(bills[0].periodKey, '2026-10');
  assert.equal(bills[0].dueOn, '2026-10-30');
  assert.equal((await fixture.store.find<Card>('cards')).length, 1);
  assert.equal(draft(restored), null);
});

test('splitting a shared account across the month boundary requires a fresh period and never carries the shared bill target', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const seeded = await seedBillingAccount(fixture.store, true);
  const instance = await initialize({ id: seeded.savedCard.id });
  assert.ok(instance.data.billingIndex > 0);
  instance.changeBilling({ detail: { value: '0' } });
  assert.equal(instance.data.billingTarget.billId, '');
  assert.equal(instance.data.billingTarget.accountId, '');
  assert.equal(Object.hasOwn(instance.commandPayload().billing, 'billId'), false);
  fixture.setDate('2026-10-01');
  await instance.save();
  assert.equal(instance.data.periodRebaseNeeded, true);
  assert.ok(instance.data.errors.dueOn);
  assert.equal((await fixture.store.get<Card>('cards', seeded.savedCard.id))?.billingAccountId, seeded.account.id);
  assert.equal((await fixture.store.find<BillingAccount>('billing_accounts')).length, 1, 'A stale split must roll back without creating another account.');
  await instance.rebaseBillingPeriod();
  assert.equal(instance.data.billingTarget.periodKey, '2026-10');
  assert.equal(instance.data.billingTarget.billId, '');
  assert.equal(instance.data.dateNeedsReview, true);
  instance.changeDueDate({ detail: { value: '2026-10-22' } });
  const sharedOctober = (await fixture.store.find<Bill>('bills')).find(bill => bill.billingAccountId === seeded.account.id && bill.periodKey === '2026-10')!;
  await instance.save();
  const attempts = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].payload.billing.periodKey, '2026-09');
  assert.equal(attempts[1].payload.billing.periodKey, '2026-10');
  for (const request of attempts) assert.equal(Object.hasOwn(request.payload.billing, 'billId'), false);
  const updatedCard = (await fixture.store.get<Card>('cards', seeded.savedCard.id))!;
  assert.notEqual(updatedCard.billingAccountId, seeded.account.id);
  assert.equal((await fixture.store.get<Card>('cards', 'sibling-card'))?.billingAccountId, seeded.account.id);
  assert.deepEqual(await fixture.store.get<Bill>('bills', seeded.september.id), seeded.september);
  assert.deepEqual(await fixture.store.get<Bill>('bills', sharedOctober.id), sharedOctober);
  const independentBill = (await fixture.store.find<Bill>('bills')).find(bill => bill.billingAccountId === updatedCard.billingAccountId)!;
  assert.equal(independentBill.periodKey, '2026-10');
  assert.equal(independentBill.dueOn, '2026-10-22');
  assert.equal(draft(instance), null);
});

test('a live form receiving a due-date version conflict can rebase once and save without repeating the stale period', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const instance = await initialize();
  changeNickname(instance, 'Live rollover card');
  configureIndependentBilling(instance, '2026-09-30');
  fixture.setDate('2026-10-01');
  await instance.save();
  assert.equal(instance.data.currentMonth, '2026-09', 'The open form retains the period it originally loaded until the user rebases it.');
  assert.equal(instance.data.periodRebaseNeeded, true);
  assert.ok(instance.data.errors.dueOn);
  assert.equal(instance.data.pendingCreationSignature, '');
  assert.equal((await fixture.store.find<Card>('cards')).length, 0);
  assert.equal((await fixture.store.find<Bill>('bills')).length, 0);
  await instance.rebaseBillingPeriod();
  assert.equal(instance.data.nickname, 'Live rollover card');
  assert.equal(instance.data.statementDay, 5);
  assert.equal(instance.data.dueOn, '2026-09-30');
  assert.equal(instance.data.currentMonth, '2026-10');
  assert.equal(instance.data.billingTarget.periodKey, '2026-10');
  assert.equal(instance.data.dateNeedsReview, true);
  assert.equal(instance.data.periodRebaseNeeded, false);
  instance.changeDueDate({ detail: { value: '2026-10-30' } });
  assert.equal(instance.data.dateNeedsReview, false);
  await instance.save();
  const attempts = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].payload.billing.periodKey, '2026-09');
  assert.equal(attempts[1].payload.billing.periodKey, '2026-10');
  assert.notEqual(attempts[0].requestId, attempts[1].requestId, 'An explicitly rebased payload must not replay the rejected September request.');
  assert.equal((await fixture.store.find<Card>('cards')).length, 1);
  const bills = await fixture.store.find<Bill>('bills');
  assert.equal(bills.length, 1);
  assert.equal(bills[0].periodKey, '2026-10');
  assert.equal(bills[0].dueOn, '2026-10-30');
  assert.equal(instance.data.periodRebaseNeeded, false);
  assert.equal(instance.data.errors.dueOn, undefined);
  assert.equal(draft(instance), null);
});

async function legacyBillingCreationDraft() {
  const instance = await initialize();
  changeNickname(instance, 'Legacy pending card');
  configureIndependentBilling(instance, '2026-10-10');
  const payload = structuredClone(instance.commandPayload());
  delete payload.billing.periodKey;
  delete payload.billing.billId;
  const intentKey = instance.data.intentKey;
  saveDraft('card', instance.data.userId, instance.data.draftEntityId, instance.data.draftBaseVersion, {
    ...instance.formDraft(), pendingCreationPeriod: '2026-09',
    pendingCreation: { pending: true, intentKey, payloadSignature: JSON.stringify(payload) },
  });
  return { instance, payload, intentKey };
}

test('an uncommitted legacy billing draft only looks up its original result in October and never creates an October bill', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const legacy = await legacyBillingCreationDraft();
  const dispatch = (globalThis as any).wx.cloud.callFunction;
  let originalRequest!: ApiRequest;
  (globalThis as any).wx.cloud.callFunction = async ({ data }: { data: ApiRequest }) => {
    if (data.action === 'card.save') { originalRequest = structuredClone(data); throw networkFailure(); }
    return dispatch({ data });
  };
  await assert.rejects(originalCommand('card.save', legacy.payload, { intentKey: legacy.intentKey }), { code: 'NETWORK_ERROR' });
  legacy.instance.onUnload();
  fixture.setDate('2026-10-01');
  const restored = await initialize();
  assert.equal(restored.data.pendingLookupOnly, true);
  assert.equal(restored.data.periodRebaseNeeded, false);
  const originalFields = { nickname: restored.data.nickname, dueOn: restored.data.dueOn, periodKey: restored.data.billingTarget.periodKey };
  restored.changeNickname({ detail: { value: 'Different card' } });
  restored.changeDueDate({ detail: { value: '2026-11-10' } });
  await restored.rebaseBillingPeriod();
  assert.deepEqual({ nickname: restored.data.nickname, dueOn: restored.data.dueOn, periodKey: restored.data.billingTarget.periodKey }, originalFields);
  const before = await fixture.store.exportSeed();
  await restored.save();
  assert.deepEqual(await fixture.store.exportSeed(), before);
  assert.equal((await fixture.store.find<Card>('cards')).length, 0);
  assert.equal((await fixture.store.find<Bill>('bills')).length, 0);
  assert.equal(fixture.requests.filter(request => request.action === 'card.save').length, 0);
  const lookups = fixture.requests.filter(request => request.action === 'request.replay');
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].payload.requestId, (originalRequest as RecordedRequest).requestId);
  assert.deepEqual(lookups[0].payload.payload, legacy.payload);
  assert.match(restored.data.pendingLookupNotice, /仍可能稍后完成/);
  assert.equal(draft(restored)?.value.pendingCreation?.payloadSignature, JSON.stringify(legacy.payload));
  assert.equal(navigationCalls, 0);

  const lateOriginal = createService(fixture.store, { now: () => new Date('2026-09-30T04:00:00Z'), demo: true });
  await lateOriginal.execute({ userId: 'intent-user', isModerator: false }, originalRequest);
  const committed = await fixture.store.exportSeed();
  await restored.save();
  assert.deepEqual(await fixture.store.exportSeed(), committed, 'A later observed original result must be read without another creation.');
  assert.equal((await fixture.store.find<Card>('cards')).length, 1);
  const bills = await fixture.store.find<Bill>('bills');
  assert.equal(bills.length, 1);
  assert.equal(bills[0].periodKey, '2026-09');
  assert.equal(bills[0].dueOn, '2026-10-10');
  assert.equal(draft(restored), null);
  assert.equal(navigationCalls, 1);
});

test('a committed legacy billing creation is recovered by a read-only lookup with the exact original request identity', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30');
  const legacy = await legacyBillingCreationDraft();
  await assert.rejects(originalCommand('card.save', legacy.payload, { intentKey: legacy.intentKey }), { code: 'NETWORK_ERROR' });
  const original = fixture.requests.find(request => request.action === 'card.save')!;
  legacy.instance.onUnload();
  fixture.setDate('2026-10-01');
  const restored = await initialize();
  assert.equal(restored.data.pendingLookupOnly, true);
  const before = await fixture.store.exportSeed();
  await restored.save();
  assert.deepEqual(await fixture.store.exportSeed(), before);
  assert.equal(fixture.requests.filter(request => request.action === 'card.save').length, 1);
  const lookup = fixture.requests.find(request => request.action === 'request.replay')!;
  assert.equal(lookup.payload.requestId, original.requestId);
  assert.deepEqual(lookup.payload.payload, original.payload);
  const bills = await fixture.store.find<Bill>('bills');
  assert.equal(bills.find(bill => bill.periodKey === '2026-09')?.dueOn, '2026-10-10');
  assert.equal(bills.find(bill => bill.periodKey === '2026-10')?.dueOn, '2026-11-10');
  assert.equal(draft(restored), null);
});

for (const code of ['INVALID_INPUT', 'INVALID_ACTION', 'NETWORK_ERROR']) {
  test(`legacy result lookup ${code} keeps pending evidence and cannot fall back to a write`, async () => {
    const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
    const legacy = await legacyBillingCreationDraft();
    legacy.instance.onUnload();
    fixture.setDate('2026-10-01');
    const restored = await initialize();
    const before = await fixture.store.exportSeed();
    const dispatch = (globalThis as any).wx.cloud.callFunction;
    const attempts: string[] = [];
    (globalThis as any).wx.cloud.callFunction = async ({ data }: { data: ApiRequest }) => {
      attempts.push(data.action);
      if (data.action === 'request.replay') {
        if (code === 'NETWORK_ERROR') throw networkFailure();
        return { result: { ok: false, error: { code, message: 'Lookup not available' } } };
      }
      return dispatch({ data });
    };
    await restored.save();
    assert.deepEqual(attempts, ['session.get', 'request.replay'], 'Only the fresh period read and original-result lookup may be dispatched.');
    assert.deepEqual(await fixture.store.exportSeed(), before);
    assert.equal(restored.data.pendingLookupOnly, true);
    assert.equal(restored.data.pendingCreationSignature, JSON.stringify(legacy.payload));
    assert.equal(draft(restored)?.value.pendingCreation?.intentKey, legacy.intentKey);
    assert.match(restored.data.pendingLookupNotice, /草稿仍然保留/);
    assert.equal(navigationCalls, 0);
  });
}

test('a late successful legacy lookup cannot clear or navigate a newer creation draft', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30');
  const legacy = await legacyBillingCreationDraft();
  await assert.rejects(originalCommand('card.save', legacy.payload, { intentKey: legacy.intentKey }), { code: 'NETWORK_ERROR' });
  legacy.instance.onUnload();
  fixture.setDate('2026-10-01');
  const restored = await initialize();
  const dispatch = (globalThis as any).wx.cloud.callFunction;
  const pending = deferred<CloudResponse>();
  const started = deferred<void>();
  let lookup!: ApiRequest;
  (globalThis as any).wx.cloud.callFunction = async ({ data }: { data: ApiRequest }) => {
    if (data.action === 'request.replay') { lookup = data; started.resolve(); return pending.promise; }
    return dispatch({ data });
  };
  const verifying = restored.save();
  await started.promise;
  restored.onUnload();
  modalResult = false;
  const newer = await initialize();
  changeNickname(newer, 'New current card');
  const revision = getDraftRevision('card', newer.data.userId, newer.data.draftEntityId);
  pending.resolve(await dispatch({ data: lookup }));
  await verifying;
  assert.equal(draft(newer)?.value.nickname, 'New current card');
  assert.equal(draft(newer)?.value.intentKey, newer.data.intentKey);
  assert.equal(getDraftRevision('card', newer.data.userId, newer.data.draftEntityId), revision);
  assert.equal(navigationCalls, 0);
});

test('an uncommitted period-bound creation still retries normally within the original billing period', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const original = await initialize();
  changeNickname(original, 'Current pending card');
  configureIndependentBilling(original, '2026-09-30');
  const dispatch = (globalThis as any).wx.cloud.callFunction;
  let first!: RecordedRequest;
  let failOnce = true;
  (globalThis as any).wx.cloud.callFunction = async ({ data }: { data: ApiRequest }) => {
    if (failOnce && data.action === 'card.save') { failOnce = false; first = structuredClone(data); throw networkFailure(); }
    return dispatch({ data });
  };
  await original.save();
  assert.equal((await fixture.store.find<Card>('cards')).length, 0);
  original.onUnload();
  const restored = await initialize();
  assert.equal(restored.data.pendingLookupOnly, false);
  assert.equal(restored.data.retryingPending, true);
  await restored.save();
  const writes = fixture.requests.filter(request => request.action === 'card.save');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].requestId, first.requestId);
  assert.deepEqual(writes[0].payload, first.payload);
  assert.equal(fixture.requests.filter(request => request.action === 'request.replay').length, 0);
  assert.equal((await fixture.store.find<Card>('cards')).length, 1);
  assert.equal((await fixture.store.find<Bill>('bills'))[0].periodKey, '2026-09');
  assert.equal(draft(restored), null);
});

test('an open pending card form rechecks the server period and switches to lookup-only after rollover', async () => {
  const fixture = await realClientWithLostCreationResponse('2026-09-30', false);
  const instance = await initialize();
  changeNickname(instance, 'Open pending card');
  configureIndependentBilling(instance, '2026-09-30');
  const dispatch = (globalThis as any).wx.cloud.callFunction;
  let writeAttempts = 0;
  (globalThis as any).wx.cloud.callFunction = async ({ data }: { data: ApiRequest }) => {
    if (data.action === 'card.save') { writeAttempts += 1; throw networkFailure(); }
    return dispatch({ data });
  };
  await instance.save();
  assert.equal(instance.data.currentMonth, '2026-09');
  const pending = structuredClone(draft(instance)?.value.pendingCreation);
  fixture.setDate('2026-10-01');
  await instance.save();
  assert.equal(instance.data.currentMonth, '2026-10');
  assert.equal(instance.data.pendingLookupOnly, true);
  assert.equal(writeAttempts, 1, 'A retry after the server month changes must not resend a creation command.');
  assert.equal(fixture.requests.filter(request => request.action === 'request.replay').length, 1);
  assert.deepEqual(draft(instance)?.value.pendingCreation, pending);
  assert.match(instance.data.pendingLookupNotice, /仍可能稍后完成/);
  assert.equal((await fixture.store.find<Card>('cards')).length, 0);
  assert.equal((await fixture.store.find<Bill>('bills')).length, 0);
});

import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Detail, Participation, Wallet } from '../shared/contracts';
import { api } from '../miniprogram/services/api';
import { confirmDraftRecovery, draftKey, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../miniprogram/services/form-draft';

type PageInstance = { data: Record<string, any>; [key: string]: any };
const definitions: PageInstance[] = [];
(globalThis as any).Page = (definition: PageInstance) => definitions.push(definition);

const storage = new Map<string, unknown>();
let modalResult = true;
let modalHandler: ((options: any) => Promise<any>) | null = null;
let modalCalls: any[] = [];
let scrollCalls: string[] = [];
let commands: { action: string; payload: any }[] = [];
let navigationCalls = 0;
let disabledAlertCalls = 0;
let alertEnabled = false;
let storageReadFailed = false;
let queryHandler: (action: string) => Promise<any>;
let commandHandler: (action: string, payload: any) => Promise<any>;

(globalThis as any).wx = {
  getStorageSync: (key: string) => {
    if (storageReadFailed) throw new Error('Storage unavailable');
    return storage.has(key) ? structuredClone(storage.get(key)) : undefined;
  },
  setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
  removeStorageSync: (key: string) => storage.delete(key),
  showModal: async (options: any) => {
    modalCalls.push(options);
    return modalHandler ? modalHandler(options) : { confirm: modalResult, cancel: !modalResult };
  },
  nextTick: (callback: () => void) => callback(),
  pageScrollTo: (options: { selector: string }) => scrollCalls.push(options.selector),
  showToast: () => {}, setNavigationBarTitle: () => {}, navigateBack: () => { navigationCalls += 1; },
  redirectTo: () => { navigationCalls += 1; }, switchTab: () => { navigationCalls += 1; },
  enableAlertBeforeUnload: () => { alertEnabled = true; },
  disableAlertBeforeUnload: () => { disabledAlertCalls += 1; alertEnabled = false; },
};

before(async () => {
  await import('../miniprogram/pages/card-edit/index');
  await import('../miniprogram/pages/progress/index');
  await import('../miniprogram/pages/receipt/index');
});

function page(index: number): PageInstance {
  const instance: PageInstance = { ...definitions[index], data: structuredClone(definitions[index].data) };
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split('.');
      let target = instance.data;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts[parts.length - 1]] = value;
    }
    callback?.();
  };
  return instance;
}

const activity: Activity = {
  id: 'activity-a', revision: 1, status: 'published', title: 'Example activity',
  bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit',
  cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2020-01-01',
  endsOn: '2099-12-31', target: 3, unit: 'count', currency: 'CNY',
  rewardMinor: 2000, rewardKind: 'cashback', scope: 'card',
  requiresRegistration: true, requiresInvitation: false, conditions: 'Three purchases',
  sourceUrl: '', sourceNote: 'Bank app',
  entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the app', imageIds: [] },
  publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
};

function participation(version = 1): Participation {
  return {
    id: 'participation-a', ownerId: 'forms-user', activityId: activity.id, activityRevision: 1,
    cardId: 'card-a', periodKey: '2026-09', startsOn: '2020-01-01', endsOn: '2099-12-31',
    scopeKey: 'card-a', snapshot: activity, stage: 'in_progress', progress: 2,
    registeredAt: '2026-09-01', startedAt: '2026-09-01', completedAt: null,
    expectedOn: null, receivedOn: null, receivedMinor: null, version,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  };
}
let record: Participation;
const wallet: Wallet = {
  cards: [{
    id: 'card-a', ownerId: 'forms-user', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa',
    kind: 'credit', nickname: 'Travel card', createdAt: '2026-09-01T00:00:00Z',
  }],
  accounts: [], bills: [],
};

beforeEach(() => {
  storage.clear(); modalCalls = []; scrollCalls = []; commands = []; modalResult = true; modalHandler = null;
  navigationCalls = 0; disabledAlertCalls = 0; alertEnabled = false;
  storageReadFailed = false;
  record = participation();
  queryHandler = async action => {
    if (action === 'session.get') return { userId: 'forms-user', demo: true, isModerator: false, today: '2026-09-21', month: '2026-09' };
    if (action === 'wallet.get') return structuredClone(wallet);
    if (action === 'activity.get') return {
      activity, participation: structuredClone(record), assets: [], history: [], tracking: null, eligible: true,
    } as unknown as Detail;
    throw new Error('Unexpected query: ' + action);
  };
  commandHandler = async () => ({ id: record.id, version: record.version + 1 });
  api.query = (async (action: string) => queryHandler(action)) as typeof api.query;
  api.command = (async (action: string, payload: unknown) => {
    commands.push({ action, payload: structuredClone(payload) });
    return commandHandler(action, payload);
  }) as typeof api.command;
});

async function initialize(index: number): Promise<PageInstance> {
  const instance = page(index);
  if (index !== 0) instance.setData({ activityId: activity.id, participationId: record.id });
  await instance.load();
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('form drafts isolate owners and require confirmation before restoring stale inputs', async () => {
  saveDraft('progress', 'user-a', 'shared-id', 1, { progressInput: '3', registered: true });
  assert.equal(loadDraft('progress', 'user-b', 'shared-id'), null);
  const saved = loadDraft<{ progressInput: string }>('progress', 'user-a', 'shared-id')!;
  modalResult = false;
  assert.equal(await confirmDraftRecovery(saved, 2), false);
  assert.equal(modalCalls.length, 1);
  assert.match(modalCalls[0].content, /记录已有更新/);
  removeDraft('progress', 'user-b', 'shared-id');
  assert.equal(loadDraft<{ progressInput: string }>('progress', 'user-a', 'shared-id')?.value.progressInput, '3');
});

test('card creation preserves the activity bank and locks edits until a pending save resolves', async () => {
  const instance = page(0);
  instance.onLoad({ bankId: 'hsbc' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.banks[instance.data.bankIndex].id, 'hsbc');
  assert(instance.data.issuerOptions.every((issuer: { bankId: string }) => issuer.bankId === 'hsbc'));
  instance.changeNickname({ detail: { value: 'Original name' } });
  const pending = deferred<{ id: string; version: number }>();
  commandHandler = () => pending.promise;
  const saving = instance.save();
  assert.equal(instance.data.saving, true);
  instance.changeNickname({ detail: { value: 'Late input' } });
  instance.changeNetwork({ detail: { value: '2' } });
  instance.changeBank({ detail: { value: '0' } });
  assert.equal(instance.data.nickname, 'Original name');
  assert.equal(instance.data.networkIndex, 0);
  assert.equal(instance.data.banks[instance.data.bankIndex].id, 'hsbc');
  pending.resolve({ id: 'created-card', version: 1 });
  await saving;
  assert.equal(commands[0].payload.nickname, 'Original name');
  assert.equal(commands[0].payload.bankId, 'hsbc');
  assert.equal(loadDraft('card', 'forms-user', 'new:hsbc'), null);
});

test('card removal locks fields while the confirmation is open and releases them after cancellation', async () => {
  const instance = page(0);
  instance.setData({ id: 'card-a', editing: true });
  await instance.load();
  const pending = deferred<{ confirm: boolean }>();
  modalHandler = () => pending.promise;
  const removing = instance.remove();
  assert.equal(instance.data.removing, true);
  instance.changeNickname({ detail: { value: 'Lost edit' } });
  assert.equal(instance.data.nickname, 'Travel card');
  await instance.remove();
  assert.equal(modalCalls.length, 1);
  pending.resolve({ confirm: false });
  await removing;
  assert.equal(instance.data.removing, false);
  assert.equal(commands.length, 0);
});

test('a card error summary links to the first error and correcting it preserves independent due-date errors', async () => {
  const instance = await initialize(0);
  instance.toggleReminder({ detail: { value: true } });
  assert.equal(instance.validate(), false);
  assert(instance.data.errors.statementDay);
  assert(instance.data.errors.dueOn);
  assert.equal(scrollCalls.at(-1), '#card-error-summary');
  assert.equal(instance.data.errorSummary[0].field, 'statementDay');
  instance.focusErrorField({ currentTarget: { dataset: { field: instance.data.errorSummary[0].field } } });
  assert.equal(scrollCalls.at(-1), '#field-statementDay');
  instance.changeStatement({ detail: { value: '5' } });
  assert.equal(instance.data.errors.statementDay, undefined);
  assert(instance.data.errors.dueOn);
  assert(instance.data.errors.dueDay);
  assert.deepEqual(instance.data.errorSummary.map((item: { field: string }) => item.field), ['dueOn', 'dueDay']);
});

test('progress conflict retains inputs and requires a separate save with the refreshed version', async () => {
  const instance = await initialize(1);
  assert.match(instance.data.cardName, /Travel card/);
  instance.onProgressInput({ detail: { value: '3' } });
  commandHandler = async () => { throw Object.assign(new Error('Updated'), { code: 'VERSION_CONFLICT' }); };
  await instance.save();
  assert.equal(instance.data.conflict, true);
  assert.equal(instance.data.progressInput, '3');
  assert.equal(commands[0].payload.expectedVersion, 1);
  await instance.save();
  assert.equal(commands.length, 1);
  const healthyQuery = queryHandler;
  queryHandler = async action => {
    if (action === 'activity.get') throw new Error('Connection unavailable');
    return healthyQuery(action);
  };
  await instance.reloadLatest();
  assert.equal(instance.data.conflict, true);
  assert.equal(instance.data.progressInput, '3');
  assert.equal(instance.data.participation.version, 1);
  queryHandler = healthyQuery;
  record = { ...participation(2), progress: 1 };
  await instance.reloadLatest();
  assert.equal(instance.data.progressInput, '3');
  assert.equal(instance.data.participation.version, 2);
  assert.equal(instance.data.reapplyRequired, true);
  assert.equal(commands.length, 1);
  commandHandler = async () => ({ id: record.id, version: 3 });
  await instance.save();
  assert.equal(commands[1].payload.expectedVersion, 2);
  assert.equal(commands[1].payload.progress, 3);
  assert.equal(loadDraft('progress', 'forms-user', record.id), null);
});

for (const originallyRegistered of [true, false]) {
  test(`a registration-only progress conflict from ${originallyRegistered ? 'registered to unregistered' : 'unregistered to registered'} remains visible and saves an explicit choice with the latest version`, async () => {
    record = {
      ...participation(), registeredAt: originallyRegistered ? '2026-09-01' : null,
      snapshot: { ...activity, requiresRegistration: false },
    };
    const instance = await initialize(1);
    assert.equal(instance.data.registered, originallyRegistered);
    assert.equal(instance.data.showRegistration, originallyRegistered);
    instance.onProgressInput({ detail: { value: '3' } });
    commandHandler = async () => { throw Object.assign(new Error('Registration updated'), { code: 'VERSION_CONFLICT' }); };
    await instance.save();
    assert.equal(instance.data.conflict, true);
    assert.deepEqual(commands[0], {
      action: 'participation.progress',
      payload: { participationId: record.id, progress: 3, registered: originallyRegistered, expectedVersion: 1 },
    });
    await instance.save();
    assert.equal(commands.length, 1);

    const latestRegistered = !originallyRegistered;
    record = { ...record, registeredAt: latestRegistered ? '2026-09-22' : null, version: 2 };
    await instance.reloadLatest();
    assert.equal(instance.data.participation.progress, 2, 'The other session changed registration without changing progress.');
    assert.equal(instance.data.participation.stage, 'in_progress', 'A registration-only change must be apparent even when the stage is unchanged.');
    assert.equal(instance.data.participation.snapshot.requiresRegistration, false);
    assert.equal(instance.data.participation.registeredAt, record.registeredAt);
    assert.equal(instance.data.participation.version, 2);
    assert.ok(instance.data.latestSummary.endsWith(latestRegistered ? '已报名' : '未报名'));
    assert.equal(instance.data.progressInput, '3');
    assert.equal(instance.data.registered, originallyRegistered, 'Refreshing must retain the local choice for the user to reconcile.');
    assert.equal(instance.data.showRegistration, true, 'An optional registration difference must remain visible and editable.');
    assert.equal(instance.data.editable, true);
    assert.equal(instance.data.conflict, false);
    assert.equal(instance.data.reapplyRequired, true);
    assert.equal(commands.length, 1, 'Reading the latest record must not apply or submit either registration choice.');
    assert.deepEqual(loadDraft<{ progressInput: string; registered: boolean }>('progress', 'forms-user', record.id)?.value, {
      progressInput: '3', registered: originallyRegistered,
    });

    instance.onRegistrationChange({ detail: { value: latestRegistered ? ['registered'] : [] } });
    assert.equal(instance.data.registered, latestRegistered);
    assert.equal(instance.data.showRegistration, true, 'Clearing an optional registration choice must not remove its control.');
    assert.equal(commands.length, 1, 'Editing the retained choice still requires a separate save.');
    commandHandler = async () => ({ id: record.id, version: 3 });
    await instance.save();
    assert.deepEqual(commands[1], {
      action: 'participation.progress',
      payload: { participationId: record.id, progress: 3, registered: latestRegistered, expectedVersion: 2 },
    });
    assert.equal(loadDraft('progress', 'forms-user', record.id), null);
  });
}

for (const draftRegistered of [true, false]) {
  test(`recovering an optional registration draft keeps its ${draftRegistered ? 'checked' : 'unchecked'} choice visible beside the latest server state`, async () => {
    const latestRegistered = !draftRegistered;
    saveDraft('progress', 'forms-user', record.id, 1, { progressInput: '3', registered: draftRegistered });
    record = {
      ...participation(5), registeredAt: latestRegistered ? '2026-09-22' : null,
      snapshot: { ...activity, requiresRegistration: false },
    };
    const instance = await initialize(1);
    assert.equal(modalCalls.length, 1);
    assert.match(modalCalls[0].content, /记录已有更新/);
    assert.equal(instance.data.progressInput, '3');
    assert.equal(instance.data.registered, draftRegistered);
    assert.equal(instance.data.showRegistration, true);
    assert.equal(instance.data.editable, true);
    assert.equal(instance.data.reapplyRequired, true);
    assert.ok(instance.data.latestSummary.endsWith(latestRegistered ? '已报名' : '未报名'));
    assert.equal(instance.data.participation.registeredAt, record.registeredAt);
    assert.equal(commands.length, 0, 'Draft recovery must never silently replace the server registration.');
    instance.onRegistrationChange({ detail: { value: latestRegistered ? ['registered'] : [] } });
    assert.equal(instance.data.registered, latestRegistered);
    assert.equal(instance.data.showRegistration, true);
    await instance.save();
    assert.deepEqual(commands, [{
      action: 'participation.progress',
      payload: { participationId: record.id, progress: 3, registered: latestRegistered, expectedVersion: 5 },
    }]);
    assert.equal(loadDraft('progress', 'forms-user', record.id), null);
  });
}

test('receipt conflict preserves amount and date while comparing the latest saved receipt', async () => {
  const instance = await initialize(2);
  assert.match(instance.data.cardName, /Travel card/);
  instance.onAmountInput({ detail: { value: '18.75' } });
  instance.onDateChange({ detail: { value: '2026-09-20' } });
  commandHandler = async () => { throw Object.assign(new Error('Updated'), { code: 'VERSION_CONFLICT' }); };
  await instance.save();
  assert.equal(instance.data.conflict, true);
  record = { ...participation(4), stage: 'received', receivedMinor: 2100, receivedOn: '2026-09-19' };
  await instance.reloadLatest();
  assert.equal(instance.data.amountInput, '18.75');
  assert.equal(instance.data.receivedOn, '2026-09-20');
  assert.equal(instance.data.reapplyRequired, true);
  assert.match(instance.data.latestSummary, /21/);
  assert.equal(commands.length, 1);
  commandHandler = async () => ({ id: record.id, version: 5 });
  await instance.save();
  assert.equal(commands[1].payload.expectedVersion, 4);
  assert.equal(commands[1].payload.amountMinor, 1875);
  assert.equal(commands[1].payload.receivedOn, '2026-09-20');
  assert.equal(loadDraft('receipt', 'forms-user', record.id), null);
});

test('declining a stale progress draft keeps the latest saved record and performs no mutation', async () => {
  saveDraft('progress', 'forms-user', record.id, 1, { progressInput: '99', registered: false });
  record = { ...participation(8), progress: 1 };
  modalResult = false;
  const instance = await initialize(1);
  assert.equal(instance.data.progressInput, '1');
  assert.equal(instance.data.participation.version, 8);
  assert.equal(commands.length, 0);
  assert.equal(loadDraft('progress', 'forms-user', record.id), null);
});

test('invalid receipt fields remain independent and move focus to the first invalid control', async () => {
  const instance = await initialize(2);
  instance.onAmountInput({ detail: { value: '0' } });
  instance.onDateChange({ detail: { value: '2099-01-01' } });
  await instance.save();
  assert(instance.data.amountError);
  assert(instance.data.dateError);
  assert.equal(scrollCalls.at(-1), '#amount-field');
  instance.onAmountInput({ detail: { value: '18.75' } });
  assert.equal(instance.data.amountError, '');
  assert(instance.data.dateError);
  await instance.save();
  assert.equal(scrollCalls.at(-1), '#receipt-date-field');
  assert.equal(commands.length, 0);
});

test('point receipts display and save integer points without interpreting them as currency', async () => {
  record = { ...participation(), snapshot: { ...activity, rewardKind: 'points', rewardMinor: 200000 } };
  const instance = await initialize(2);
  assert.equal(instance.data.amountInput, '2000');
  instance.onAmountInput({ detail: { value: '2000' } });
  instance.onDateChange({ detail: { value: '2026-09-20' } });
  await instance.save();
  assert.deepEqual(commands, [{ action: 'reward.confirm', payload: {
    participationId: record.id, amountMinor: 200000, receivedOn: '2026-09-20', expectedVersion: record.version,
  } }]);
  assert.equal(loadDraft('receipt', 'forms-user', record.id), null);
});

for (const value of ['2000.5', '0']) {
  test(`point receipt input ${value} keeps the form and reports an inline error without submitting`, async () => {
    record = { ...participation(), snapshot: { ...activity, rewardKind: 'points', rewardMinor: 200000 } };
    const instance = await initialize(2);
    instance.onAmountInput({ detail: { value } });
    instance.onDateChange({ detail: { value: '2026-09-20' } });
    await instance.save();
    assert.ok(instance.data.amountError);
    assert.equal(instance.data.dateError, '');
    assert.equal(instance.data.amountInput, value);
    assert.equal(scrollCalls.at(-1), '#amount-field');
    assert.equal(commands.length, 0);
    assert.equal(navigationCalls, 0);
    assert.equal(loadDraft<{ amountInput: string }>('receipt', 'forms-user', record.id)?.value.amountInput, value);
  });
}

test('conditional draft removal protects new revisions and supports legacy fingerprints', () => {
  const key = draftKey('progress', 'forms-user', 'record');
  assert.equal(getDraftRevision('progress', 'forms-user', 'record'), null);
  saveDraft('progress', 'forms-user', 'record', 1, { input: 'new' });
  removeDraft('progress', 'forms-user', 'record', null);
  assert.equal(loadDraft<{ input: string }>('progress', 'forms-user', 'record')?.value.input, 'new');
  const firstRevision = getDraftRevision('progress', 'forms-user', 'record');
  saveDraft('progress', 'forms-user', 'record', 1, { input: 'new' });
  assert.notEqual(getDraftRevision('progress', 'forms-user', 'record'), firstRevision);
  removeDraft('progress', 'forms-user', 'record', firstRevision);
  assert(loadDraft('progress', 'forms-user', 'record'));

  storage.set(key, { version: 1, ownerId: 'forms-user', entityId: 'record', baseVersion: 1, value: { a: 1, b: 2 }, updatedAt: 'legacy' });
  const legacyRevision = getDraftRevision('progress', 'forms-user', 'record');
  storage.set(key, { updatedAt: 'legacy', value: { b: 2, a: 1 }, baseVersion: 1, entityId: 'record', ownerId: 'forms-user', version: 1 });
  assert.equal(getDraftRevision('progress', 'forms-user', 'record'), legacyRevision);
  removeDraft('progress', 'forms-user', 'record', legacyRevision);
  assert.equal(loadDraft('progress', 'forms-user', 'record'), null);
});

test('conditional cleanup leaves a draft untouched when its revision cannot be read', () => {
  saveDraft('progress', 'forms-user', 'record', 1, { input: 'new' });
  storageReadFailed = true;
  removeDraft('progress', 'forms-user', 'record', null);
  storageReadFailed = false;
  assert.equal(loadDraft<{ input: string }>('progress', 'forms-user', 'record')?.value.input, 'new');
});

for (const scenario of [
  { index: 0, scope: 'card', field: 'nickname', oldValue: 'First draft', newValue: 'New draft' },
  { index: 1, scope: 'progress', field: 'progressInput', oldValue: '3', newValue: '4' },
  { index: 2, scope: 'receipt', field: 'amountInput', oldValue: '18.75', newValue: '19.25' },
]) {
  test(scenario.scope + ' pending save cannot clear a reopened form draft or navigate its page', async () => {
    const oldPage = await initialize(scenario.index);
    const edit = (instance: PageInstance, value: string) => {
      if (scenario.index === 0) instance.changeNickname({ detail: { value } });
      if (scenario.index === 1) instance.onProgressInput({ detail: { value } });
      if (scenario.index === 2) instance.onAmountInput({ detail: { value } });
    };
    edit(oldPage, scenario.oldValue);
    const entityId = scenario.index === 1 ? oldPage.data.participationId : oldPage.data.draftEntityId;
    const pending = deferred<{ id: string; version: number }>();
    const dispatched = deferred<void>();
    commandHandler = () => { dispatched.resolve(); return pending.promise; };
    const saving = oldPage.save();
    await dispatched.promise;
    const submittedRevision = getDraftRevision(scenario.scope, 'forms-user', entityId);
    const submittedCard = scenario.index === 0 ? loadDraft<Record<string, unknown>>(scenario.scope, 'forms-user', entityId)?.value : null;
    oldPage.onUnload();
    const newPage = await initialize(scenario.index);
    const restoredRevision = getDraftRevision(scenario.scope, 'forms-user', entityId);
    if (scenario.index === 0) {
      assert.notEqual(restoredRevision, submittedRevision, 'Recovery must renew a pending card draft even when its inputs remain unchanged.');
      assert.deepEqual(loadDraft(scenario.scope, 'forms-user', entityId)?.value, submittedCard);
      assert.equal(newPage.data.pendingCreationUnconfirmed, true);
    }
    edit(newPage, scenario.newValue);
    if (scenario.index === 0) {
      assert.equal(newPage.data.nickname, scenario.oldValue, 'A recovered unknown creation keeps its original fields locked.');
      assert.equal(getDraftRevision(scenario.scope, 'forms-user', entityId), restoredRevision, 'The new revision must come from recovery, not an attempted edit.');
    }
    const newRevision = getDraftRevision(scenario.scope, 'forms-user', entityId);
    const priorNavigation = navigationCalls, priorDisabled = disabledAlertCalls;
    pending.resolve({ id: record.id, version: 2 });
    await saving;
    const saved = loadDraft<Record<string, string>>(scenario.scope, 'forms-user', entityId);
    assert.equal(saved?.value[scenario.field], scenario.index === 0 ? scenario.oldValue : scenario.newValue);
    if (scenario.index === 0) {
      assert.deepEqual(saved?.value, submittedCard, 'A late result must preserve the reopened original payload and its pending metadata.');
      assert.equal(newPage.data.pendingCreationUnconfirmed, true);
      assert.equal(commands.length, 1);
    }
    assert.equal(getDraftRevision(scenario.scope, 'forms-user', entityId), newRevision);
    assert.equal(navigationCalls, priorNavigation);
    assert.equal(disabledAlertCalls, priorDisabled);
    assert.equal(alertEnabled, true);
  });
}

test('pending card removal preserves the reopened form draft and its navigation guard', async () => {
  const oldPage = page(0);
  oldPage.setData({ id: 'card-a', editing: true });
  await oldPage.load();
  oldPage.changeNickname({ detail: { value: 'First draft' } });
  const pending = deferred<{ id: string; version: number }>();
  commandHandler = () => pending.promise;
  const removing = oldPage.remove();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.at(-1)?.action, 'card.remove');
  oldPage.onUnload();
  const newPage = page(0);
  newPage.setData({ id: 'card-a', editing: true });
  await newPage.load();
  newPage.changeNickname({ detail: { value: 'New draft' } });
  const priorNavigation = navigationCalls, priorDisabled = disabledAlertCalls;
  pending.resolve({ id: 'card-a', version: 2 });
  await removing;
  assert.equal(loadDraft<{ nickname: string }>('card', 'forms-user', 'card-a')?.value.nickname, 'New draft');
  assert.equal(navigationCalls, priorNavigation);
  assert.equal(disabledAlertCalls, priorDisabled);
  assert.equal(alertEnabled, true);
});

test('a save started without a draft does not remove one created after the page closes', async () => {
  const oldPage = await initialize(1);
  assert.equal(getDraftRevision('progress', 'forms-user', record.id), null);
  const pending = deferred<{ id: string; version: number }>();
  commandHandler = () => pending.promise;
  const saving = oldPage.save();
  oldPage.onUnload();
  const newPage = await initialize(1);
  newPage.onProgressInput({ detail: { value: '5' } });
  pending.resolve({ id: record.id, version: 2 });
  await saving;
  assert.equal(loadDraft<{ progressInput: string }>('progress', 'forms-user', record.id)?.value.progressInput, '5');
  assert.equal(navigationCalls, 0);
  assert.equal(disabledAlertCalls, 0);
});

test('a late conflict from a closed form cannot overwrite the newer draft', async () => {
  const oldPage = await initialize(1);
  oldPage.onProgressInput({ detail: { value: '3' } });
  let reject!: (error: Error) => void;
  commandHandler = () => new Promise((_resolve, fail) => { reject = fail; });
  const saving = oldPage.save();
  oldPage.onUnload();
  const newPage = await initialize(1);
  newPage.onProgressInput({ detail: { value: '7' } });
  const newRevision = getDraftRevision('progress', 'forms-user', record.id);
  reject(Object.assign(new Error('Updated'), { code: 'VERSION_CONFLICT' }));
  await saving;
  assert.equal(loadDraft<{ progressInput: string }>('progress', 'forms-user', record.id)?.value.progressInput, '7');
  assert.equal(getDraftRevision('progress', 'forms-user', record.id), newRevision);
  assert.equal(navigationCalls, 0);
  assert.equal(disabledAlertCalls, 0);
});

test('indistinguishable card names retain input and drafts until the user supplies a distinct nickname', async () => {
  const instance = await initialize(0);
  instance.changeNetwork({ detail: { value: '1' } });
  instance.changeNickname({ detail: { value: 'Travel card' } });
  await instance.save();
  assert.match(instance.data.errors.nickname, /另一张卡难以区分/);
  assert.equal(instance.data.nickname, 'Travel card');
  assert.equal(commands.length, 0);
  assert.equal(scrollCalls.at(-1), '#field-nickname');
  assert.equal(loadDraft<{ nickname: string }>('card', 'forms-user', 'new:')?.value.nickname, 'Travel card');
  instance.changeNickname({ detail: { value: 'Daily card' } });
  assert.equal(instance.data.errors.nickname, undefined);
  await instance.save();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.nickname, 'Daily card');
  assert.equal(loadDraft('card', 'forms-user', 'new:'), null);
});

test('changing the card description resolves a nickname conflict without erasing unrelated errors', async () => {
  const instance = await initialize(0);
  instance.changeNetwork({ detail: { value: '1' } });
  instance.changeNickname({ detail: { value: 'Travel card' } });
  instance.toggleReminder({ detail: { value: true } });
  instance.validate();
  assert(instance.data.errors.nickname);
  assert(instance.data.errors.dueOn);
  instance.changeNetwork({ detail: { value: '2' } });
  assert.equal(instance.data.errors.nickname, undefined);
  assert(instance.data.errors.dueOn);
});

test('system references are confined to a collapsed advanced section in the card editor', async () => {
  const instance = page(0);
  instance.setData({ id: 'card-a', editing: true });
  await instance.load();
  assert.equal(instance.data.showAdvanced, false);
  assert(instance.data.systemReference);
  instance.toggleAdvanced();
  assert.equal(instance.data.showAdvanced, true);
  instance.setData({ saving: true });
  instance.toggleAdvanced();
  assert.equal(instance.data.showAdvanced, true);
});

import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Actor, ApiRequest, Asset, Card, Detail, Participation, Stage, Wallet } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';
import { api } from '../miniprogram/services/api';

type PageInstance = { data: Record<string, any>; sheetStates: string[][]; [key: string]: any };
const sheetFields = ['showManage', 'showRules', 'showCards', 'showExpected', 'showGuide'];
let definition: PageInstance;
let preferencesDefinition: PageInstance;
let currentDetail: Detail;
let currentPage: PageInstance;
let pageStack: PageInstance[] = [];
let queryHandler: (action: string, payload: any) => Promise<any>;
let commandHandler: (action: string, payload: any) => Promise<any>;
let commands: { action: string; payload: any }[] = [];
let navigation: { kind: string; url: string }[] = [];
let toasts: string[] = [];
let previews: { current: string; urls: string[] }[] = [];
let modalConfirm = false;
let modalCalls = 0;
let modalHandler: (() => Promise<{ confirm: boolean }>) | undefined;
let alerts = false;
let alertMessage = '';
let warningWrites: { enabled: boolean; message: string; page: PageInstance | undefined }[] = [];
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
    runtime.Page = (value: PageInstance) => { preferencesDefinition = value; };
    await import('../miniprogram/pages/preferences/index');
  } finally { runtime.Page = originalPage; }
});

beforeEach(() => {
  commands = []; navigation = []; toasts = []; previews = []; modalConfirm = false; modalCalls = 0; modalHandler = undefined; alerts = false;
  alertMessage = ''; warningWrites = []; pageStack = [];
  (globalThis as any).getCurrentPages = () => pageStack;
  (globalThis as any).wx = {
    showToast: ({ title }: { title: string }) => { toasts.push(title); },
    showModal: async () => { modalCalls += 1; return modalHandler ? modalHandler() : { confirm: modalConfirm }; },
    enableAlertBeforeUnload: ({ message }: { message: string }) => {
      alerts = true; alertMessage = message; warningWrites.push({ enabled: true, message, page: pageStack.at(-1) });
    },
    disableAlertBeforeUnload: () => {
      alerts = false; alertMessage = ''; warningWrites.push({ enabled: false, message: '', page: pageStack.at(-1) });
    },
    navigateTo: ({ url }: { url: string }) => { navigation.push({ kind: 'forward', url }); },
    navigateBack: () => { navigation.push({ kind: 'back', url: '' }); },
    switchTab: ({ url }: { url: string }) => { navigation.push({ kind: 'tab', url }); },
    setClipboardData: ({ data, success }: { data: string; success: () => void }) => { navigation.push({ kind: 'clipboard', url: data }); success(); },
    previewImage: ({ current, urls, success }: { current: string; urls: string[]; success: () => void }) => { previews.push({ current, urls: Array.from(urls) }); success(); },
  };
  queryHandler = async (action, payload) => {
    if (action === 'session.get') return { userId: 'sheet-user', demo: true, isModerator: false, today: '2026-09-23', month: '2026-09' };
    if (action === 'activity.get') return currentDetail;
    if (action === 'wallet.get') return wallet();
    if (action === 'preferences.get') return { ownerId: 'sheet-user', newActivities: false, deadlines: true, rewards: true, repayments: true };
    if (action === 'assets.urls') return payload.ids.map((id: string) => ({ id, url: `https://assets.example/${id}.png` }));
    throw new Error(`Unexpected query ${action}`);
  };
  commandHandler = async () => ({ id: 'record-a', version: 2 });
  api.query = (async (action: string, payload: any) => queryHandler(action, payload)) as typeof api.query;
  api.command = (async (action: string, payload: any) => {
    commands.push({ action, payload: structuredClone(payload) });
    return commandHandler(action, payload);
  }) as typeof api.command;
});

after(() => {
  api.query = originalQuery;
  api.command = originalCommand;
  (globalThis as any).wx = originalWx;
  (globalThis as any).getCurrentPages = originalPages;
});

function activity(scope: 'user' | 'card' = 'card'): Activity {
  return {
    id: 'activity-a', revision: 1, status: 'published', title: 'Card benefit', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2099-12-31',
    target: 3, unit: 'transactions', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope,
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three transactions', sourceUrl: 'https://www.cmbchina.com/rules', sourceNote: 'Bank rules',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open bank benefits', imageIds: ['guide-image'] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function detail(stage?: Stage, scope: 'user' | 'card' = 'card'): Detail {
  const offer = activity(scope);
  const participation: Participation | null = stage ? {
    id: 'record-a', ownerId: 'sheet-user', activityId: offer.id, activityRevision: 1, scopeKey: scope === 'card' ? 'card:eligible' : 'user',
    ...(scope === 'card' ? { cardId: 'eligible' } : {}), snapshot: offer, periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2099-12-31',
    stage, progress: stage === 'completed' ? 3 : 1, registeredAt: null, startedAt: '2026-09-01', completedAt: stage === 'completed' ? '2026-09-22' : null,
    expectedOn: '2026-09-25', receivedOn: null, receivedMinor: null, version: 1, createdAt: '2026-09-01', updatedAt: '2026-09-22',
  } : null;
  const asset: Asset = { id: 'guide-image', ownerId: 'sheet-user', fileId: 'cloud://guide-image', cloudPath: 'assets/guide-image.png',
    mime: 'image/png', size: 1024, status: 'approved', createdAt: '2026-09-01T00:00:00Z' };
  return { activity: offer, participation, tracking: null, eligible: true, assets: [asset], audit: [], history: [] };
}

function wallet(id = 'eligible'): Wallet {
  const card: Card = { id, ownerId: 'sheet-user', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: id, createdAt: '2026-09-01' };
  return { cards: [card], accounts: [], bills: [] };
}

function page(options: Record<string, string>): PageInstance {
  const instance: PageInstance = { ...definition, data: structuredClone(definition.data), sheetStates: [] };
  instance.setData = (patch: Record<string, unknown>) => {
    Object.assign(instance.data, patch);
    instance.sheetStates.push(sheetFields.filter(field => instance.data[field]));
  };
  currentPage = instance;
  pageStack = [instance];
  instance.onLoad(options);
  return instance;
}

async function initialize(value = detail()): Promise<PageInstance> {
  currentDetail = value;
  const instance = page({ activityId: value.activity.id, participationId: value.participation?.id || '' });
  await instance.load();
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.error, '');
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function delayedWallet() {
  const request = deferred<Wallet>();
  const started = deferred<void>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action !== 'wallet.get') return fallback(action, payload);
    started.resolve();
    return request.promise;
  };
  return { ...request, started: started.promise };
}

function assertSheet(instance: PageInstance, sheet = '') {
  assert.deepEqual(sheetFields.filter(field => instance.data[field]), sheet ? [sheet] : []);
  assert.ok(instance.sheetStates.every(visible => visible.length <= 1), 'Every rendered state must contain at most one sheet.');
}

function cardEvent(id = 'eligible') { return { currentTarget: { dataset: { id } } }; }

async function openDirtyPreferences(previous: PageInstance, hidePrevious = true): Promise<PageInstance> {
  if (hidePrevious) previous.onHide();
  const instance: PageInstance = { ...preferencesDefinition, data: structuredClone(preferencesDefinition.data), sheetStates: [] };
  instance.setData = (patch: Record<string, unknown>) => { Object.assign(instance.data, patch); };
  currentPage = instance;
  pageStack = [previous, instance];
  await instance.load();
  instance.onShow();
  instance.change({ currentTarget: { dataset: { field: 'newActivities' } }, detail: { value: true } });
  assert.equal(instance.data.ready, true);
  assert.equal(instance.data.dirty, true);
  assert.equal(alerts, true);
  assert.match(alertMessage, /提醒设置尚未保存/);
  return instance;
}

function showDetail(instance: PageInstance): Promise<void> {
  const originalLoad = instance.load;
  let loading: Promise<void> | undefined;
  instance.load = () => { loading = originalLoad.call(instance); return loading; };
  try { instance.onShow(); }
  finally { instance.load = originalLoad; }
  assert.ok(loading, 'Returning to an idle detail page must retain its normal refresh behavior.');
  return loading;
}

function delayedDetail() {
  const request = deferred<Detail>();
  const started = deferred<void>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action !== 'activity.get') return fallback(action, payload);
    started.resolve();
    return request.promise;
  };
  return { ...request, started: started.promise };
}

for (const hidden of [true, false]) {
  test(`a held clean expected-date refresh cannot clear dirty preferences when detail is ${hidden ? 'hidden' : 'not the stack owner'}`, async () => {
    const instance = await initialize(detail('completed', 'user'));
    instance.openExpected();
    assert.equal(instance.data.expectedDirty, false);
    const history: PageInstance = { data: {}, sheetStates: [] };
    instance.onHide();
    currentPage = history;
    pageStack = [instance, history];
    const pending = delayedDetail();
    currentPage = instance;
    pageStack = [instance];
    const loading = showDetail(instance);
    await pending.started;
    const preferences = await openDirtyPreferences(instance, hidden);
    const preferenceState = structuredClone(preferences.data);
    const preferenceMessage = alertMessage;
    const warningCount = warningWrites.length;
    const updated = { ...currentDetail, participation: { ...currentDetail.participation!, expectedOn: '2026-09-26', version: 2 } };
    pending.resolve(updated);
    await loading;
    assert.equal(instance.data.detail, updated, 'The ownership fix must allow the old page to finish reading its own data.');
    assert.equal(instance.data.expectedOn, '2026-09-26');
    assert.equal(warningWrites.length, warningCount, 'A non-owner continuation must never write the global leave warning.');
    assert.equal(alerts, true);
    assert.equal(alertMessage, preferenceMessage);
    assert.equal(pageStack.at(-1), preferences);
    assert.deepEqual(preferences.data, preferenceState);
    assert.equal(toasts.length, 0);
  });
}

test('returning to a dirty expected-date sheet restores its own leave warning before the held refresh completes', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  assert.match(alertMessage, /预计到账日尚未保存/);
  const preferences = await openDirtyPreferences(instance);
  const pending = delayedDetail();
  preferences.onHide();
  currentPage = instance;
  pageStack = [instance];
  const loading = showDetail(instance);
  assert.equal(alerts, true);
  assert.match(alertMessage, /预计到账日尚未保存/, 'The visible dirty sheet must restore its own warning immediately on show.');
  assert.equal(warningWrites.at(-1)?.page, instance);
  await pending.started;
  pending.resolve(currentDetail);
  await loading;
  assert.equal(instance.data.expectedOn, '2026-09-29');
  assert.equal(instance.data.expectedDirty, true);
  assert.equal(alerts, true);
  assert.match(alertMessage, /预计到账日尚未保存/);
  assert.equal(preferences.data.dirty, true);
  assert.equal(commands.length, 0);
});

test('a clean detail returning to the foreground can clear its own global warning and still navigate normally', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  const preferences = await openDirtyPreferences(instance);
  const pending = delayedDetail();
  preferences.onHide();
  currentPage = instance;
  pageStack = [instance];
  const loading = showDetail(instance);
  assert.equal(instance.data.expectedDirty, false);
  assert.equal(alerts, false, 'A clean foreground owner must be able to clear the warning left by the previous page.');
  assert.equal(warningWrites.at(-1)?.enabled, false);
  assert.equal(warningWrites.at(-1)?.page, instance);
  await pending.started;
  pending.resolve(currentDetail);
  await loading;
  assert.equal(alerts, false);
  instance.openHistory();
  assert.deepEqual(navigation.at(-1), { kind: 'forward', url: '/pages/history/index?activityId=activity-a' });
  assert.equal(instance.data.showExpected, false);
});

test('a late expected-date save cannot clear another page warning or emit a foreground success toast', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  const pending = deferred<{ id: string; version: number }>();
  commandHandler = () => pending.promise;
  const saving = instance.saveExpected();
  assert.equal(commands.length, 1);
  const preferences = await openDirtyPreferences(instance);
  const warningCount = warningWrites.length;
  const preferenceMessage = alertMessage;
  const toastCount = toasts.length;
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, expectedOn: '2026-09-29', version: 2 } };
  pending.resolve({ id: 'record-a', version: 2 });
  await saving;
  assert.equal(warningWrites.length, warningCount);
  assert.equal(alerts, true);
  assert.equal(alertMessage, preferenceMessage);
  assert.equal(preferences.data.dirty, true);
  assert.equal(pageStack.at(-1), preferences);
  assert.equal(toasts.length, toastCount);
  assert.deepEqual(commands, [{ action: 'participation.expected', payload: { participationId: 'record-a', expectedOn: '2026-09-29' } }]);
});

test('a discarded-date confirmation arriving after hide preserves the active preferences warning', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  const pending = deferred<{ confirm: boolean }>();
  modalHandler = () => pending.promise;
  const closing = instance.closeExpected();
  assert.equal(modalCalls, 1);
  const preferences = await openDirtyPreferences(instance);
  const warningCount = warningWrites.length;
  const preferenceMessage = alertMessage;
  pending.resolve({ confirm: true });
  await closing;
  assert.equal(instance.data.showExpected, true);
  assert.equal(instance.data.expectedDirty, true);
  assert.equal(instance.data.expectedOn, '2026-09-29');
  assert.equal(warningWrites.length, warningCount);
  assert.equal(alerts, true);
  assert.equal(alertMessage, preferenceMessage);
  assert.equal(preferences.data.dirty, true);
  assert.equal(navigation.length, 0);
});

test('a hidden initial detail failure updates only its own inline error while dirty preferences retains the warning', async () => {
  currentDetail = detail('completed', 'user');
  const instance = page({ activityId: currentDetail.activity.id });
  const pending = delayedDetail();
  const loading = instance.load();
  await pending.started;
  const preferences = await openDirtyPreferences(instance);
  const warningCount = warningWrites.length;
  const preferenceMessage = alertMessage;
  const toastCount = toasts.length;
  pending.reject(new Error('Detail initial lookup unavailable'));
  await loading;
  assert.ok(instance.data.error);
  assert.equal(instance.data.detail, null);
  assert.equal(instance.data.loading, false);
  assert.equal(warningWrites.length, warningCount);
  assert.equal(alerts, true);
  assert.equal(alertMessage, preferenceMessage);
  assert.equal(preferences.data.dirty, true);
  assert.equal(toasts.length, toastCount, 'An obsolete page must not display its failure over another page.');
});

test('foreground detail failures retain their initial toast and inline refresh recovery behavior', async () => {
  currentDetail = detail('completed', 'user');
  const instance = page({ activityId: currentDetail.activity.id });
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'activity.get') throw new Error('Visible detail lookup unavailable');
    return fallback(action, payload);
  };
  await instance.load();
  assert.ok(instance.data.error);
  assert.equal(instance.data.detail, null);
  assert.deepEqual(toasts, ['Visible detail lookup unavailable']);
  queryHandler = fallback;
  await instance.load();
  const previous = instance.data.detail;
  queryHandler = async (action, payload) => {
    if (action === 'activity.get') throw new Error('Visible detail refresh unavailable');
    return fallback(action, payload);
  };
  await instance.load();
  assert.equal(instance.data.detail, previous);
  assert.equal(instance.data.error, '');
  assert.ok(instance.data.refreshError);
  assert.equal(instance.data.outdated, true);
  assert.deepEqual(toasts, ['Visible detail lookup unavailable'], 'A refresh failure must retain its in-page recovery rather than adding another global toast.');
});

function reminderDetailService(stage: 'in_progress' | 'completed' = 'completed') {
  const actor: Actor = { userId: 'sheet-user', isModerator: false };
  const periodKey = stage === 'completed' ? '2026-08' : '2026-09';
  const snapshot: Activity = { ...activity('user'), title: 'Saved period rules', target: 3, rewardMinor: 2000 };
  const record: Participation = { ...detail(stage, 'user').participation!, id: 'reminder-record', snapshot, periodKey,
    startsOn: `${periodKey}-01`, endsOn: `${periodKey}-25`, completedAt: stage === 'completed' ? `${periodKey}-20` : null };
  const published: Activity = { ...snapshot, revision: 2, title: 'Latest published rules', target: 9, rewardMinor: 9900 };
  const foreign = { ...record, id: 'foreign-record', ownerId: 'another-user' };
  const store = new MemoryStore({ activities: { [published.id]: published }, participations: { [record.id]: record, [foreign.id]: foreign } });
  const service = createService(store, { now: () => new Date('2026-09-23T04:00:00Z'), demo: true });
  const queries: Record<string, unknown>[] = [];
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action !== 'activity.get') return fallback(action, payload);
    queries.push(structuredClone(payload));
    return service.execute(actor, { action, payload } as ApiRequest);
  };
  return { record, foreign, published, store, queries };
}

for (const stage of ['in_progress', 'completed'] as const) {
  test(`a participation-only ${stage === 'completed' ? 'reward' : 'deadline'} reminder loads its owned snapshot and resolves later navigation`, async () => {
    const fixture = reminderDetailService(stage);
    const instance = page({ participationId: fixture.record.id });
    await instance.load();
    assert.deepEqual(fixture.queries, [{ participationId: fixture.record.id }], 'The first request must omit an unavailable activity ID entirely.');
    assert.equal(instance.data.error, '');
    assert.equal(instance.data.loading, false);
    assert.equal(instance.data.activityId, fixture.record.activityId);
    assert.equal(instance.data.participationId, fixture.record.id);
    assert.deepEqual(instance.data.detail.participation, fixture.record);
    assert.equal(instance.data.detail.participation.periodKey, fixture.record.periodKey);
    assert.deepEqual(instance.data.view.activity, fixture.record.snapshot);
    assert.equal(instance.data.view.activity.target, 3);
    assert.notEqual(instance.data.view.activity.title, fixture.published.title);
    await instance.load();
    assert.deepEqual(fixture.queries.at(-1), { activityId: fixture.record.activityId, participationId: fixture.record.id });
    if (stage === 'in_progress') {
      instance.editProgress();
      assert.equal(navigation.at(-1)?.url, '/pages/progress/index?id=reminder-record&activityId=activity-a');
    }
    instance.openHistory();
    assert.equal(navigation.at(-1)?.url, '/pages/history/index?activityId=activity-a');
    await instance.prepareAction('receipt');
    assert.equal(navigation.at(-1)?.url, '/pages/receipt/index?activityId=activity-a&id=reminder-record');
    assert.equal(commands.length, 0);
    assert.deepEqual(await fixture.store.get<Participation>('participations', fixture.record.id), fixture.record);
    assert.deepEqual(await fixture.store.get<Activity>('activities', fixture.published.id), fixture.published);
  });
}

test('an activity-only deep link still reads current published rules without inventing a participation identifier', async () => {
  const fixture = reminderDetailService();
  const instance = page({ id: fixture.published.id });
  await instance.load();
  assert.deepEqual(fixture.queries, [{ activityId: fixture.published.id }]);
  assert.equal(instance.data.error, '');
  assert.equal(instance.data.activityId, fixture.published.id);
  assert.equal(instance.data.participationId, '');
  assert.equal(instance.data.detail.participation, null);
  assert.equal(instance.data.view.activity.title, fixture.published.title);
  assert.equal(instance.data.view.activity.target, 9);
  assert.equal(commands.length, 0);
});

for (const invalidLink of ['foreign-owner', 'mismatched-activity'] as const) {
  test(`a ${invalidLink} reminder link remains subject to service ownership and record matching checks`, async () => {
    const fixture = reminderDetailService();
    const options: Record<string, string> = invalidLink === 'foreign-owner'
      ? { participationId: fixture.foreign.id }
      : { participationId: fixture.record.id, activityId: 'unrelated-activity' };
    const instance = page(options);
    await instance.load();
    assert.deepEqual(fixture.queries, [options]);
    assert.ok(instance.data.error);
    assert.equal(instance.data.detail, null);
    assert.equal(instance.data.view, null);
    assert.equal(instance.data.loading, false);
    assert.equal(toasts.length, 1);
    assert.equal(commands.length, 0);
    assert.equal(fixture.queries.length, 1, 'A denied participation lookup must not fall back to a public activity.');
    instance.back();
    assert.equal(navigation.at(-1)?.url, '/pages/activities/index');
  });
}

test('a deep link with neither identifier fails locally with a working exit and makes no API request', async () => {
  const queries: string[] = [];
  queryHandler = async action => { queries.push(action); throw new Error('No identifier should reach the API'); };
  const instance = page({});
  await instance.load();
  assert.ok(instance.data.error);
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.detail, null);
  assert.equal(instance.data.view, null);
  assert.deepEqual(queries, []);
  assert.equal(commands.length, 0);
  instance.back();
  assert.equal(navigation.at(-1)?.url, '/pages/activities/index');
});

for (const sheet of ['Guide', 'Rules']) {
  for (const outcome of ['success', 'failure']) {
    test(`opening ${sheet.toLowerCase()} cancels pending wallet selection and ignores its late ${outcome}`, async () => {
      const instance = await initialize();
      const pending = delayedWallet();
      const preparing = instance.prepareAction('join');
      await pending.started;
      assert.equal(instance.data.busy, true);
      assert.equal(instance.data.preparingCards, true);
      await instance[`open${sheet}`]();
      assertSheet(instance, `show${sheet}`);
      assert.equal(instance.data.busy, false);
      assert.equal(instance.data.preparingCards, false);
      assert.match(toasts.at(-1) || '', /取消.*选卡/);
      const toastCount = toasts.length;
      if (outcome === 'success') pending.resolve(wallet('obsolete-card'));
      else pending.reject(new Error('Obsolete wallet failure'));
      await preparing;
      assertSheet(instance, `show${sheet}`);
      assert.equal(toasts.length, toastCount, 'Canceled selection must not emit late errors.');
      assert.deepEqual(instance.data.cards, []);
      assert.equal(commands.length, 0);
      assert.equal(navigation.length, 0);
      if (sheet === 'Guide') {
        await instance.previewImage(cardEvent('guide-image'));
        assert.equal(previews.length, 1, 'The guide must remain the usable foreground context after the old wallet response.');
      }
    });
  }
}

test('an old wallet finalizer cannot release the busy state of a replacement wallet request', async () => {
  const instance = await initialize();
  const first = delayedWallet();
  const firstLoad = instance.prepareAction('join');
  await first.started;
  instance.openGuide();
  instance.closeGuide();
  const second = delayedWallet();
  const secondLoad = instance.prepareAction('receipt');
  await second.started;
  first.resolve(wallet('obsolete'));
  await firstLoad;
  assert.equal(instance.data.busy, true);
  assert.equal(instance.data.preparingCards, true);
  assertSheet(instance);
  second.resolve(wallet('current'));
  await secondLoad;
  assertSheet(instance, 'showCards');
  assert.equal(instance.data.busy, false);
  assert.equal(instance.data.preparingCards, false);
  assert.deepEqual(instance.data.cards.map((row: any) => row.id), ['current']);
  assert.equal(instance.data.pendingAction, 'receipt');
});

test('the explicit selection cancel action releases its loading state and prevents the late picker from opening', async () => {
  const instance = await initialize();
  const pending = delayedWallet();
  const preparing = instance.prepareAction('join');
  await pending.started;
  instance.cancelCardSelection();
  assert.equal(instance.data.preparingCards, false);
  assert.equal(instance.data.busy, false);
  assertSheet(instance);
  assert.match(toasts.at(-1) || '', /取消.*选卡/);
  pending.resolve(wallet());
  await preparing;
  assertSheet(instance);
  assert.equal(commands.length, 0);
});

test('canceling a wallet read cannot cancel or unlock a subsequently submitted mutation', async () => {
  const instance = await initialize(detail('in_progress'));
  const oldWallet = delayedWallet();
  const preparing = instance.prepareAction('join', true);
  await oldWallet.started;
  instance.openGuide();
  instance.closeGuide();
  const mutation = deferred<{ id: string; version: number }>();
  commandHandler = () => mutation.promise;
  const saving = instance.executeAction('complete');
  assert.equal(commands.length, 1);
  assert.equal(instance.data.busy, true);
  assert.equal(instance.data.preparingCards, false);
  instance.cancelCardSelection();
  instance.openGuide();
  instance.openHistory();
  assertSheet(instance);
  assert.equal(instance.data.busy, true);
  assert.equal(navigation.length, 0);
  assert.match(toasts.at(-1) || '', /尚未完成/);
  oldWallet.resolve(wallet('obsolete'));
  await preparing;
  assertSheet(instance);
  assert.equal(instance.data.busy, true, 'The obsolete wallet finally block must not clear mutation ownership.');
  assert.equal(commands.length, 1);
  mutation.resolve({ id: 'record-a', version: 2 });
  await saving;
  assert.equal(instance.data.busy, false);
  assertSheet(instance);
});

test('a submitted management action keeps its sheet until completion and cannot be canceled by switching contexts', async () => {
  const instance = await initialize(detail('in_progress'));
  instance.openManage();
  const pending = deferred<{ id: string; version: number }>();
  commandHandler = () => pending.promise;
  const saving = instance.skip();
  assert.equal(instance.data.busy, true);
  assertSheet(instance, 'showManage');
  instance.closeManage();
  instance.openGuide();
  instance.openRules();
  instance.cancelCardSelection();
  assertSheet(instance, 'showManage');
  assert.equal(instance.data.busy, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'participation.skip');
  pending.resolve({ id: 'record-a', version: 2 });
  await saving;
  assertSheet(instance);
  assert.equal(instance.data.busy, false);
});

for (const action of ['join', 'complete', 'receipt']) {
  test(`the ordinary card picker preserves the ${action} path while replacing the previous sheet`, async () => {
    const instance = await initialize();
    instance.openRules();
    await instance.prepareAction(action);
    assertSheet(instance, 'showCards');
    assert.equal(instance.data.busy, false);
    instance.chooseCard(cardEvent());
    assert.equal(instance.data.selectedCardId, 'eligible');
    await instance.confirmCard();
    assertSheet(instance);
    if (action === 'receipt') {
      assert.equal(commands.length, 0);
      assert.deepEqual(navigation, [{ kind: 'forward', url: '/pages/receipt/index?activityId=activity-a&cardId=eligible' }]);
    } else {
      assert.equal(commands.length, 1);
      assert.equal(commands[0].action, action === 'join' ? 'activity.join' : 'participation.complete');
      assert.equal(commands[0].payload.cardId, 'eligible');
    }
  });
}

test('the next action follows the participation snapshot and opens its progress before offering completion', async () => {
  const value = detail('in_progress');
  value.participation!.snapshot = { ...value.activity, target: 3, rewardKind: 'cashback' };
  value.activity = { ...value.activity, target: 1, rewardKind: 'discount', revision: 2 };
  const instance = await initialize(value);
  assert.equal(instance.data.view.primaryAction, 'progress');
  assert.equal(instance.data.view.primaryLabel, '更新进度');
  assert.equal(instance.data.view.canComplete, true, 'Direct completion remains available as an alternate action.');
  assert.equal(instance.data.view.canReceipt, true, 'A real receipt does not require a preliminary completion write.');
  await instance.editProgress();
  assert.deepEqual(navigation, [{ kind: 'forward', url: '/pages/progress/index?id=record-a&activityId=activity-a' }]);
  assert.equal(commands.length, 0);
  assert.equal(value.participation!.progress, 1);
  value.participation!.progress = 3;
  await instance.load();
  assert.equal(instance.data.view.primaryAction, 'complete');
  assert.equal(instance.data.view.primaryLabel, '标记完成');
  assert.equal(instance.data.view.activity.rewardKind, 'cashback');
});

for (const stage of ['completed', 'received', 'skipped'] as const) {
  test(`${stage} records retain their next valid action and cannot offer another direct completion`, async () => {
    const instance = await initialize(detail(stage));
    assert.equal(instance.data.view.primaryAction, stage === 'skipped' ? 'resume' : 'receipt');
    assert.equal(instance.data.view.canComplete, false);
    assert.equal(instance.data.view.canReceipt, stage !== 'skipped');
    if (stage === 'received') assert.equal(instance.data.view.primaryLabel, instance.data.view.benefit.editAction);
    else if (stage === 'completed') assert.equal(instance.data.view.primaryLabel, instance.data.view.benefit.recordAction);
    assert.equal(commands.length, 0);
  });
}

test('an unfinished discount prioritizes actual discount recording while retaining direct completion', async () => {
  const value = detail('in_progress', 'user');
  value.participation!.snapshot = { ...value.activity, rewardKind: 'discount' };
  const instance = await initialize(value);
  assert.equal(instance.data.view.primaryAction, 'receipt');
  assert.equal(instance.data.view.primaryLabel, '记录已享优惠');
  assert.equal(instance.data.view.canComplete, true);
  await instance.prepareAction('receipt');
  assert.deepEqual(navigation, [{ kind: 'forward', url: '/pages/receipt/index?activityId=activity-a&id=record-a' }]);
  assert.equal(commands.length, 0, 'Opening the discount form must not write a completion or change its actual date.');
});

for (const scope of ['user', 'card'] as const) {
  for (const action of ['complete', 'receipt'] as const) {
    test(`the more menu permits direct ${action} for an unjoined ${scope} activity without a join write`, async () => {
      const instance = await initialize(detail(undefined, scope));
      assert.equal(instance.data.view.primaryAction, 'join');
      assert.equal(instance.data.view.canComplete, true);
      assert.equal(instance.data.view.canReceipt, true);
      instance.openManage();
      assertSheet(instance, 'showManage');
      await instance.prepareAction(action);
      if (scope === 'card') {
        assertSheet(instance, 'showCards');
        assert.equal(commands.length, 0);
        assert.equal(navigation.length, 0);
        instance.chooseCard(cardEvent('unlisted-card'));
        await instance.confirmCard();
        assertSheet(instance, 'showCards');
        assert.equal(commands.length, 0, 'The alternate entry must keep card eligibility checks.');
        assert.equal(navigation.length, 0);
        instance.chooseCard(cardEvent());
        await instance.confirmCard();
      }
      assertSheet(instance);
      assert.equal(commands.some(command => command.action === 'activity.join'), false);
      if (action === 'complete') {
        assert.deepEqual(commands, [{ action: 'participation.complete', payload: {
          activityId: 'activity-a', participationId: undefined, cardId: scope === 'card' ? 'eligible' : undefined,
        } }]);
        assert.equal(navigation.length, 0);
      } else {
        assert.equal(commands.length, 0);
        assert.deepEqual(navigation, [{ kind: 'forward', url: `/pages/receipt/index?activityId=activity-a${scope === 'card' ? '&cardId=eligible' : ''}` }]);
      }
    });
  }
}

test('switching sheets replaces the previous sheet and stale picker events cannot submit, navigate, or close it', async () => {
  const instance = await initialize(detail('completed'));
  for (const sheet of ['Guide', 'Rules', 'Manage', 'Expected', 'Guide']) {
    await instance[`open${sheet}`]();
    assertSheet(instance, `show${sheet}`);
  }
  await instance.prepareAction('join', true);
  instance.chooseCard(cardEvent());
  assertSheet(instance, 'showCards');
  instance.openGuide();
  assertSheet(instance, 'showGuide');
  instance.chooseCard(cardEvent());
  await instance.confirmCard();
  instance.addCard();
  instance.closeCards();
  instance.closeRules();
  instance.closeManage();
  assertSheet(instance, 'showGuide');
  assert.equal(instance.data.selectedCardId, '');
  assert.equal(commands.length, 0);
  assert.equal(navigation.length, 0);
});

const destinations = [
  { name: 'guide', sheet: 'showGuide', invoke: (instance: PageInstance) => instance.openGuide() },
  { name: 'rules', sheet: 'showRules', invoke: (instance: PageInstance) => instance.openRules() },
  { name: 'management', sheet: 'showManage', invoke: (instance: PageInstance) => instance.openManage() },
  { name: 'history', sheet: '', invoke: (instance: PageInstance) => instance.openHistory() },
  { name: 'receipt entry', sheet: '', invoke: (instance: PageInstance) => instance.prepareAction('receipt') },
  { name: 'back navigation', sheet: '', invoke: (instance: PageInstance) => instance.back() },
  { name: 'external entrance', sheet: '', invoke: (instance: PageInstance) => instance.entrance() },
  { name: 'external source', sheet: '', invoke: (instance: PageInstance) => instance.source() },
];

for (const destination of destinations) {
  test(`switching from an edited expected date to ${destination.name} requires an explicit discard decision`, async () => {
    const value = detail('completed', 'user');
    if (destination.name === 'external entrance') value.activity.entrance = { kind: 'web', label: 'Bank offer', url: 'https://www.cmbchina.com/offer', instructions: '', imageIds: [] };
    const instance = await initialize(value);
    instance.openExpected();
    instance.changeExpected({ detail: { value: '2026-09-29' } });
    instance.openExpected();
    assert.equal(instance.data.expectedOn, '2026-09-29', 'Reopening the current sheet must not reset its unsaved input.');
    await destination.invoke(instance);
    assertSheet(instance, 'showExpected');
    assert.equal(instance.data.expectedOn, '2026-09-29');
    assert.equal(instance.data.expectedDirty, true);
    assert.equal(alerts, true);
    assert.equal(modalCalls, 1);
    assert.equal(navigation.length, 0);
    assert.equal(commands.length, 0);
    modalConfirm = true;
    await destination.invoke(instance);
    assertSheet(instance, destination.sheet);
    assert.equal(instance.data.expectedDirty, false);
    assert.equal(instance.data.expectedOn, '2026-09-25');
    assert.equal(alerts, false);
    assert.equal(commands.length, 0);
    assert.equal(navigation.length, destination.sheet ? 0 : 1);
  });
}

test('a pending discard dialog owns the transition and cannot be replaced by a second sheet or navigation', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  const decision = deferred<{ confirm: boolean }>();
  modalHandler = () => decision.promise;
  const changing = instance.openGuide();
  assert.equal(instance.data.expectedClosing, true);
  instance.openRules();
  instance.openManage();
  instance.openHistory();
  instance.back();
  assert.equal(modalCalls, 1);
  assertSheet(instance, 'showExpected');
  assert.equal(navigation.length, 0);
  decision.resolve({ confirm: false });
  await changing;
  assertSheet(instance, 'showExpected');
  assert.equal(instance.data.expectedClosing, false);
  assert.equal(instance.data.expectedDirty, true);
  assert.equal(instance.data.expectedOn, '2026-09-29');
});

test('a discard confirmation returned after the page hides cannot discard input or open its requested sheet', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  const decision = deferred<{ confirm: boolean }>();
  modalHandler = () => decision.promise;
  const changing = instance.openGuide();
  instance.onHide();
  decision.resolve({ confirm: true });
  await changing;
  assertSheet(instance, 'showExpected');
  assert.equal(instance.data.expectedClosing, false);
  assert.equal(instance.data.expectedDirty, true);
  assert.equal(instance.data.expectedOn, '2026-09-29');
  assert.equal(alerts, true);
  assert.equal(navigation.length, 0);
});

test('a refreshed skipped record cannot resume through a hidden action while the expected date has unsaved input', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  await instance.resume();
  assert.equal(commands.length, 0, 'Resume is unavailable for a completed record.');
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, stage: 'skipped', version: 2 } };
  await instance.load();
  await instance.resume();
  assertSheet(instance, 'showExpected');
  assert.equal(instance.data.expectedDirty, true);
  assert.equal(instance.data.expectedOn, '2026-09-29');
  assert.equal(alerts, true);
  assert.equal(commands.length, 0, 'A hidden resume action must not discard the visible date form.');
  modalConfirm = true;
  await instance.closeExpected();
  await instance.resume();
  assert.deepEqual(commands, [{ action: 'participation.skip', payload: { participationId: 'record-a', skipped: false } }]);
  assertSheet(instance);
  assert.equal(alerts, false);
});

test('a saving expected date retains its sheet and busy ownership until the mutation finishes', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-29' } });
  const pending = deferred<{ id: string; version: number }>();
  commandHandler = () => pending.promise;
  const saving = instance.saveExpected();
  instance.openGuide();
  instance.openRules();
  instance.openHistory();
  instance.back();
  instance.cancelCardSelection();
  await instance.closeExpected();
  assertSheet(instance, 'showExpected');
  assert.equal(instance.data.busy, true);
  assert.equal(instance.data.expectedOn, '2026-09-29');
  assert.equal(commands.length, 1);
  assert.equal(navigation.length, 0);
  assert.equal(modalCalls, 0);
  currentDetail = { ...currentDetail, participation: { ...currentDetail.participation!, expectedOn: '2026-09-29', version: 2 } };
  pending.resolve({ id: 'record-a', version: 2 });
  await saving;
  assertSheet(instance);
  assert.equal(instance.data.busy, false);
  assert.equal(instance.data.expectedDirty, false);
  assert.equal(alerts, false);
});

for (const lifecycle of ['onHide', 'onUnload']) {
  test(`${lifecycle} invalidates a pending card picker without allowing a late sheet or error`, async () => {
    const instance = await initialize();
    const pending = delayedWallet();
    const preparing = instance.prepareAction('join');
    await pending.started;
    instance[lifecycle]();
    const patches = instance.sheetStates.length;
    pending.resolve(wallet('obsolete'));
    await preparing;
    assertSheet(instance);
    assert.equal(instance.sheetStates.length, patches);
    assert.equal(instance.data.preparingCards, false);
    assert.equal(instance.data.busy, false);
    assert.equal(toasts.length, 0);
  });
}

test('switching directly from the guide to another sheet invalidates delayed native preview URLs', async () => {
  const instance = await initialize(detail('completed', 'user'));
  instance.openGuide();
  const pending = deferred<{ id: string; url: string }[]>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => action === 'assets.urls' ? pending.promise : fallback(action, payload);
  const preview = instance.previewImage(cardEvent('guide-image'));
  instance.openRules();
  assertSheet(instance, 'showRules');
  pending.resolve([{ id: 'guide-image', url: 'https://assets.example/late.png' }]);
  await preview;
  assert.deepEqual(previews, []);
  assertSheet(instance, 'showRules');
  assert.equal(toasts.length, 0);
});

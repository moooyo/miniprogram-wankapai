import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Asset, AuditEvent, Card, Detail, Participation } from '../shared/contracts';
import { readFileSync } from 'node:fs';
import { api } from '../miniprogram/services/api';
import { backToActivity, navigateBackOr } from '../miniprogram/services/navigation';

const definitions: Record<string, any> = {};
let queryHandler: (action: string, payload: any) => Promise<any>;
let commandHandler: (action: string, payload: any) => Promise<any>;
let modalConfirm = false;
let modalCount = 0;
let alerts = false;
let stackSize = 1;
let currentPage: Record<string, any> | null = null;
let navigation: { kind: string; url?: string }[] = [];
let scrolls: string[] = [];
let toasts = 0;

before(async () => {
  for (const route of ['activities', 'history', 'detail', 'card-edit']) {
    (globalThis as any).Page = (definition: any) => { definitions[route] = definition; };
    await import(`../miniprogram/pages/${route}/index`);
  }
});

beforeEach(() => {
  modalConfirm = false; modalCount = 0; alerts = false; stackSize = 1; currentPage = null; navigation = []; scrolls = []; toasts = 0;
  (globalThis as any).getCurrentPages = () => Array.from({ length: stackSize }, (_, index) => index === stackSize - 1 && currentPage ? currentPage : {});
  (globalThis as any).wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {}, removeStorageSync: () => {},
    showToast: () => { toasts += 1; },
    showModal: async () => { modalCount += 1; return { confirm: modalConfirm }; },
    enableAlertBeforeUnload: () => { alerts = true; }, disableAlertBeforeUnload: () => { alerts = false; },
    nextTick: (callback: () => void) => callback(),
    pageScrollTo: ({ selector }: { selector: string }) => { scrolls.push(selector); },
    navigateBack: () => { navigation.push({ kind: 'back' }); },
    navigateTo: ({ url }: { url: string }) => { navigation.push({ kind: 'forward', url }); },
    redirectTo: ({ url }: { url: string }) => { navigation.push({ kind: 'redirect', url }); },
    switchTab: ({ url }: { url: string }) => { navigation.push({ kind: 'tab', url }); },
  };
  queryHandler = async action => {
    if (action === 'session.get') return { userId: 'ux-user', demo: true, isModerator: false, today: '2026-09-22', month: '2026-09' };
    if (action === 'wallet.get') return { cards: [], accounts: [], bills: [] };
    throw new Error(`Unexpected query ${action}`);
  };
  commandHandler = async () => ({ id: 'record-a', version: 2 });
  api.query = (async (action: string, payload: any) => queryHandler(action, payload)) as typeof api.query;
  api.command = (async (action: string, payload: any) => commandHandler(action, payload)) as typeof api.command;
});

function page(route: string) {
  const instance: any = { ...definitions[route], data: structuredClone(definitions[route].data) };
  instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split('.');
      let target = instance.data;
      for (const key of parts.slice(0, -1)) target = target[key] ||= {};
      target[parts[parts.length - 1]] = value;
    }
    callback?.();
  };
  currentPage = instance;
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function activity(id: string, rewardKind: 'cashback' | 'discount' = 'cashback'): Activity {
  return {
    id, revision: 1, status: 'published', title: id, bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Eligible card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31',
    target: 3, unit: 'count', currency: 'CNY', rewardMinor: 2000, rewardKind, scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three purchases', sourceUrl: '', sourceNote: '',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the bank app', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function record(id: string): Participation {
  return {
    id, ownerId: 'ux-user', activityId: id, activityRevision: 1, scopeKey: 'user', snapshot: activity(id),
    periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30', stage: 'completed', progress: 3,
    registeredAt: null, startedAt: '2026-09-01', completedAt: '2026-09-20', expectedOn: '2026-09-25',
    receivedOn: null, receivedMinor: null, version: 1, createdAt: '2026-09-01', updatedAt: '2026-09-20',
  };
}

function detailData(participation = record('record-a')): Detail {
  return { activity: participation.snapshot, participation, tracking: null, eligible: true, assets: [], audit: [], history: [] };
}

async function renderedProgressAudit(before: unknown, after: unknown, action = 'participation.progress', includeRecord = true) {
  const instance = page('history');
  const participation = { ...record('record-a'), stage: 'in_progress' as const };
  participation.snapshot = { ...participation.snapshot, unit: '次' };
  const event: AuditEvent = Object.freeze({ id: 'audit-a', ownerId: 'ux-user', entityId: participation.id, action,
    at: '2026-09-23T01:00:00Z', before, after });
  const original = structuredClone(event);
  queryHandler = async () => ({ ...detailData(participation), participation: includeRecord ? participation : null, audit: [event] });
  await instance.openAudit({ currentTarget: { dataset: { id: participation.id, activity: participation.activityId, title: 'Current period' } } });
  assert.deepEqual(event, original, 'Audit presentation must not mutate the stored event.');
  assert.equal(instance.data.audit.length, 1);
  return instance.data.audit[0] as { label: string; description: string };
}

for (const progressChanged of [false, true]) {
  for (const beforeRegistered of [false, true]) {
    for (const afterRegistered of [false, true]) {
      test(`history audit distinguishes progress ${progressChanged ? 'changes' : 'unchanged'} and registration ${beforeRegistered} to ${afterRegistered}`, async () => {
        const before = Object.freeze({ progress: 2, registeredAt: beforeRegistered ? '2026-09-21' : null, stage: 'in_progress' });
        const after = Object.freeze({ progress: progressChanged ? 3 : 2, registeredAt: afterRegistered ? '2026-09-22' : null, stage: 'in_progress' });
        const row = await renderedProgressAudit(before, after);
        const changed = beforeRegistered !== afterRegistered;
        assert.equal(row.label, changed ? progressChanged ? '修改进度与报名标记' : afterRegistered ? '记录已报名' : '取消报名标记' : '修改参与进度');
        const expectedProgress = progressChanged ? '进度：2 → 3 次' : '进度仍为 2 次';
        const expectedRegistration = changed
          ? `报名标记：${beforeRegistered ? '已报名' : '未报名'} → ${afterRegistered ? '已报名' : '未报名'}`
          : `报名标记保持${afterRegistered ? '已报名' : '未报名'}`;
        assert.equal(row.description, `${expectedProgress} · ${expectedRegistration}`);
        assert.equal(before.stage, after.stage, 'Registration changes must remain understandable when participation stage does not change.');
      });
    }
  }
}

test('legacy progress audit events preserve known values without inventing missing registration or zero baselines', async () => {
  const numeric = await renderedProgressAudit({ progress: 0 }, { progress: 2 }, 'progress');
  assert.equal(numeric.label, '修改参与进度');
  assert.equal(numeric.description, '进度：0 → 2 次');
  const afterOnly = await renderedProgressAudit(undefined, { progress: 2, registeredAt: null });
  assert.equal(afterOnly.label, '修改参与进度');
  assert.equal(afterOnly.description, '更新后进度：2 次 · 更新后报名标记：未报名');
  assert.doesNotMatch(afterOnly.description, /0 →|已报名 →/);
  const beforeOnly = await renderedProgressAudit({ progress: 2, registeredAt: '2026-09-21' }, undefined);
  assert.equal(beforeOnly.description, '原进度：2 次 · 原报名标记：已报名');
  const missing = await renderedProgressAudit(undefined, undefined, 'progress');
  assert.equal(missing.label, '修改参与进度');
  assert.equal(missing.description, '');
  const registrationOnly = await renderedProgressAudit({ registeredAt: '2026-09-21' }, { registeredAt: null }, 'progress', false);
  assert.equal(registrationOnly.label, '取消报名标记');
  assert.equal(registrationOnly.description, '报名标记：已报名 → 未报名');
  const emptyLegacyDate = await renderedProgressAudit({ registeredAt: '' }, { registeredAt: '2026-09-22' }, 'progress');
  assert.equal(emptyLegacyDate.label, '记录已报名');
  assert.equal(emptyLegacyDate.description, '报名标记：未报名 → 已报名');
});

async function loadedDetail(value = detailData()) {
  const instance = page('detail');
  const fallback = queryHandler;
  queryHandler = async (action, payload) => action === 'activity.get' ? value : fallback(action, payload);
  instance.setData({ activityId: value.activity.id, participationId: value.participation?.id || '' });
  await instance.load();
  return instance;
}

function selectionCard(id: string, overrides: Partial<Card> = {}): Card {
  return { id, ownerId: 'ux-user', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: id,
    createdAt: '2026-09-01T00:00:00Z', ...overrides };
}

async function unjoinedDetail(cards: Card[], scope: 'card' | 'user' = 'card') {
  const offer = { ...activity('card-offer'), scope };
  const fallback = queryHandler;
  queryHandler = async (action, payload) => action === 'wallet.get' ? { cards, accounts: [], bills: [] } : fallback(action, payload);
  return loadedDetail({ ...detailData(), activity: offer, participation: null, eligible: false });
}

for (const action of ['join', 'complete', 'receipt']) {
  test(`card-scoped ${action} cannot proceed with cards that fail issuer, network, or kind requirements`, async () => {
    const instance = await unjoinedDetail([
      selectionCard('eligible'), selectionCard('wrong-issuer', { issuerId: 'cmb-other' }),
      selectionCard('wrong-network', { network: 'unionpay' }), selectionCard('wrong-kind', { kind: 'debit' }),
      selectionCard('other-bank', { bankId: 'hsbc' }), selectionCard('archived', { archivedAt: '2026-09-20' }),
    ]);
    const sent: string[] = [];
    commandHandler = async command => { sent.push(command); return { id: 'created', version: 1 }; };
    await instance.prepareAction(action);
    assert.equal(instance.data.showCards, true);
    assert.equal(instance.data.matchingCardCount, 1);
    assert.deepEqual(instance.data.cards.map((card: any) => card.id), ['eligible', 'wrong-issuer', 'wrong-network', 'wrong-kind']);
    const matching = instance.data.cards.find((card: any) => card.id === 'eligible');
    assert.ok(matching);
    assert.equal(matching.matches, true);
    assert.match(matching.qualification, /以银行为准/);
    for (const [id, reason] of [['wrong-issuer', '发卡机构不匹配'], ['wrong-network', '卡组织不匹配'], ['wrong-kind', '卡片类型不匹配']]) {
      const incompatible = instance.data.cards.find((card: any) => card.id === id);
      assert.ok(incompatible);
      assert.equal(incompatible.matches, false);
      assert.ok(incompatible.qualification.includes(reason));
      assert.doesNotMatch(incompatible.qualification, /仍可手动/);
      instance.chooseCard({ currentTarget: { dataset: { id } } });
      assert.equal(instance.data.selectedCardId, '');
      instance.setData({ selectedCardId: id });
      instance.confirmCard();
      await instance.executeAction(action, id);
      assert.equal(instance.data.showCards, true);
      assert.ok(instance.data.cardSelectionError);
    }
    assert.deepEqual(sent, []);
    assert.equal(navigation.length, 0);
    instance.chooseCard({ currentTarget: { dataset: { id: 'eligible' } } });
    assert.equal(instance.data.selectedCardId, 'eligible');
    assert.equal(instance.data.cardSelectionError, '');
    if (action === 'receipt') {
      instance.confirmCard();
      assert.match(navigation.at(-1)?.url || '', /activityId=card-offer&cardId=eligible/);
    } else {
      await instance.executeAction(action, 'eligible');
      assert.deepEqual(sent, [action === 'join' ? 'activity.join' : 'participation.complete']);
    }
  });
}

test('a wallet with no matching card offers a bank-prefilled add-card path without an invalid continue action', async () => {
  const instance = await unjoinedDetail([selectionCard('wrong-network', { network: 'unionpay' })]);
  await instance.prepareAction('join');
  assert.equal(instance.data.cards.length, 1);
  assert.equal(instance.data.matchingCardCount, 0);
  assert.equal(instance.data.showCards, true);
  instance.addCard();
  assert.equal(instance.data.showCards, false);
  assert.equal(navigation.at(-1)?.url, '/pages/card-edit/index?bankId=cmb');
  const markup = readFileSync('miniprogram/pages/detail/index.wxml', 'utf8');
  assert.match(markup, /这个活动按卡计算。请选择实际使用、且符合当前条件的卡片/);
  assert.match(markup, /现有卡片均不符合条件。请添加符合条件的卡片后继续/);
  assert.match(markup, /wx:if="\{\{matchingCardCount\}\}"[^>]*bindtap="confirmCard"/);
  assert.match(markup, /bindtap="chooseCard" disabled="\{\{!item\.matches/);
});

test('user-scoped manual receipt remains available without choosing or inventing a card', async () => {
  const instance = await unjoinedDetail([], 'user');
  await instance.prepareAction('receipt');
  assert.equal(instance.data.showCards, false);
  assert.equal(navigation.at(-1)?.url, '/pages/receipt/index?activityId=card-offer');
});

for (const stage of ['received', 'in_progress'] as const) {
  test(`existing ${stage} card participation remains editable without current eligible choices`, async () => {
    const historical: Participation = { ...record('historical'), stage, cardId: 'archived-card',
      receivedMinor: stage === 'received' ? 2000 : null, receivedOn: stage === 'received' ? '2026-09-21' : null,
      snapshot: { ...activity('historical'), scope: 'card' } };
    const archivedCard = selectionCard('archived-card', { archivedAt: '2026-09-22', network: 'unionpay', kind: 'debit' });
    const fallback = queryHandler;
    queryHandler = async (action, payload) => action === 'wallet.get' ? { cards: [archivedCard], accounts: [], bills: [] } : fallback(action, payload);
    const instance = await loadedDetail({ ...detailData(historical), eligible: false });
    assert.equal(instance.data.view.activity, historical.snapshot);
    assert.deepEqual(instance.data.cards, []);
    assert.equal(instance.data.matchingCardCount, 0);
    if (stage === 'received') {
      await instance.prepareAction('receipt');
      assert.equal(instance.data.showCards, false);
      assert.equal(navigation.at(-1)?.url, '/pages/receipt/index?activityId=historical&id=historical');
    } else {
      const sent: { action: string; payload: any }[] = [];
      commandHandler = async (action, payload) => { sent.push({ action, payload }); return { id: historical.id, version: 2 }; };
      await instance.prepareAction('complete');
      assert.equal(instance.data.showCards, false);
      assert.deepEqual(sent, [{ action: 'participation.complete', payload: { activityId: 'historical', participationId: 'historical', cardId: undefined } }]);
    }
  });
}

test('selecting another card follows current published requirements without rewriting the existing period snapshot', async () => {
  const historical: Participation = { ...record('historical'), cardId: 'original-card', snapshot: { ...activity('historical'), scope: 'card' } };
  const latest: Activity = { ...historical.snapshot, revision: 2, networks: ['unionpay'], cardDescription: 'Current UnionPay requirement' };
  const cards = [selectionCard('original-card'), selectionCard('old-rules-only'), selectionCard('current-match', { network: 'unionpay' })];
  const fallback = queryHandler;
  queryHandler = async (action, payload) => action === 'wallet.get' ? { cards, accounts: [], bills: [] } : fallback(action, payload);
  const instance = await loadedDetail({ ...detailData(historical), activity: latest });
  await instance.prepareAction('join', true);
  assert.equal(instance.data.view.activity, historical.snapshot);
  assert.equal(instance.data.cardRequirement, latest.cardDescription);
  assert.equal(instance.data.cards.find((card: any) => card.id === 'old-rules-only')?.matches, false);
  assert.equal(instance.data.cards.find((card: any) => card.id === 'current-match')?.matches, true);
  instance.chooseCard({ currentTarget: { dataset: { id: 'current-match' } } });
  assert.equal(instance.data.selectedCardId, 'current-match');
});

test('detail guide keeps unresolved asset slots and opens the clicked stable asset through partial URL responses', async () => {
  const assets: Asset[] = ['image-a', 'image-b', 'image-c'].map(id => ({ id, ownerId: 'ux-user', fileId: `cloud://${id}`, cloudPath: `assets/${id}.png`,
    mime: 'image/png', size: 1024, status: 'approved', createdAt: '2026-09-01T00:00:00Z' }));
  const value = { ...detailData(), assets };
  const fallback = queryHandler;
  let resolvedIds = ['image-b', 'image-c'];
  let urlQueries = 0;
  queryHandler = async (action, payload) => {
    if (action === 'assets.urls') {
      urlQueries += 1;
      assert.deepEqual(payload.ids, ['image-a', 'image-b', 'image-c']);
      return resolvedIds.map(id => ({ id, url: `https://assets.example/${id}.png` }));
    }
    return fallback(action, payload);
  };
  const instance = await loadedDetail(value);
  instance.openGuide();
  assert.deepEqual(instance.data.view.entryImages.map((item: any) => [item.id, item.url]), [
    ['image-a', ''], ['image-b', 'https://assets.example/image-b.png'], ['image-c', 'https://assets.example/image-c.png'],
  ]);
  (globalThis as any).getCurrentPages = () => [instance];
  const previews: { current: string; urls: string[] }[] = [];
  (globalThis as any).wx.previewImage = ({ current, urls, success }: { current: string; urls: string[]; success: () => void }) => {
    previews.push({ current, urls: Array.from(urls) }); success();
  };
  await instance.previewImage({ currentTarget: { dataset: { id: 'image-b' } } });
  assert.deepEqual(previews.at(-1), { current: 'https://assets.example/image-b.png', urls: ['https://assets.example/image-b.png', 'https://assets.example/image-c.png'] });
  resolvedIds = ['image-c', 'image-b'];
  await instance.previewImage({ currentTarget: { dataset: { id: 'image-c' } } });
  assert.equal(previews.at(-1)?.current, 'https://assets.example/image-c.png');
  assert.deepEqual(previews.at(-1)?.urls, ['https://assets.example/image-b.png', 'https://assets.example/image-c.png']);
  const beforeMissing = previews.length;
  await instance.previewImage({ currentTarget: { dataset: { id: 'image-a' } } });
  assert.equal(previews.length, beforeMissing, 'An unresolved selected asset must not silently open another screenshot.');
  assert.equal(toasts, 1);
  resolvedIds = ['image-c', 'image-a', 'image-b'];
  await instance.previewImage({ currentTarget: { dataset: { id: 'image-a' } } });
  assert.equal(previews.at(-1)?.current, 'https://assets.example/image-a.png');
  const beforeInvalid = urlQueries;
  await instance.previewImage({ currentTarget: { dataset: { id: 'missing' } } });
  assert.equal(urlQueries, beforeInvalid);
  const markup = readFileSync('miniprogram/pages/detail/index.wxml', 'utf8');
  assert.match(markup, /bindtap="previewImage" data-id="\{\{item\.id\}\}"/);
  assert.match(markup, /截图暂未加载，点击重试/);
});

for (const nextContext of ['expected-date', 'reopened-guide']) {
  test(`a closed detail guide cannot open a delayed native preview over ${nextContext}`, async () => {
    const asset: Asset = { id: 'guide-image', ownerId: 'ux-user', fileId: 'cloud://guide-image', cloudPath: 'assets/guide-image.png',
      mime: 'image/png', size: 1024, status: 'approved', createdAt: '2026-09-01T00:00:00Z' };
    const fallback = queryHandler;
    queryHandler = async (action, payload) => action === 'assets.urls' ? [{ id: asset.id, url: 'https://assets.example/cached.png' }] : fallback(action, payload);
    const instance = await loadedDetail({ ...detailData(), assets: [asset] });
    (globalThis as any).getCurrentPages = () => [instance];
    const previews: string[] = [];
    (globalThis as any).wx.previewImage = ({ current, success }: { current: string; success: () => void }) => { previews.push(current); success(); };
    instance.openGuide();
    const pending = deferred<{ id: string; url: string }[]>();
    const started = deferred<void>();
    const currentQuery = queryHandler;
    queryHandler = async (action, payload) => {
      if (action === 'assets.urls') { started.resolve(); return pending.promise; }
      return currentQuery(action, payload);
    };
    const preview = instance.previewImage({ currentTarget: { dataset: { id: asset.id } } });
    await started.promise;
    instance.closeGuide();
    if (nextContext === 'expected-date') {
      instance.openExpected();
      assert.equal(instance.data.showExpected, true);
    } else instance.openGuide();
    pending.resolve([{ id: asset.id, url: 'https://assets.example/obsolete.png' }]);
    await preview;
    assert.deepEqual(previews, [], 'Closing the guide permanently invalidates its pending gallery request.');
    assert.equal(toasts, 0);
    if (nextContext === 'expected-date') {
      assert.equal(instance.data.showExpected, true);
      assert.equal(instance.data.expectedOn, '2026-09-25');
      await instance.closeExpected();
      instance.openGuide();
    }
    queryHandler = async (action, payload) => action === 'assets.urls' ? [{ id: asset.id, url: 'https://assets.example/current.png' }] : currentQuery(action, payload);
    await instance.previewImage({ currentTarget: { dataset: { id: asset.id } } });
    assert.deepEqual(previews, ['https://assets.example/current.png'], 'A new request from the visible guide remains available.');
    instance.closeGuide();
    await instance.previewImage({ currentTarget: { dataset: { id: asset.id } } });
    assert.equal(previews.length, 1, 'A hidden guide cannot start another native preview.');
  });
}

async function assertDetailActionsBlocked(instance: any) {
  let commands = 0;
  commandHandler = async () => { commands += 1; return { id: 'record-a' }; };
  const originalNavigation = navigation.length;
  const originalModals = modalCount;
  instance.setData({ selectedCardId: 'retained-card', expectedOn: '2026-09-28', showExpected: false, showManage: false });
  assert.equal(instance.actionsBlocked(), true);
  for (const action of ['join', 'complete', 'receipt']) {
    await instance.prepareAction(action);
    await instance.executeAction(action);
  }
  instance.chooseCard({ currentTarget: { dataset: { id: 'different-card' } } });
  instance.confirmCard();
  instance.anotherCard();
  instance.addCard();
  instance.editProgress();
  instance.openManage();
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-10-01' } });
  instance.clearExpected();
  await instance.saveExpected();
  await instance.reminder();
  await instance.skip();
  await instance.resume();
  await instance.undoComplete();
  await instance.untrack();
  await instance.revokeReceipt();
  assert.equal(commands, 0);
  assert.equal(navigation.length, originalNavigation);
  assert.equal(modalCount, originalModals);
  assert.equal(instance.data.selectedCardId, 'retained-card');
  assert.equal(instance.data.expectedOn, '2026-09-28');
  assert.equal(instance.data.showExpected, false);
  assert.equal(instance.data.showManage, false);
}

test('detail refresh retains the visible receipt until fresh amount data arrives and locks old-state actions', async () => {
  const old = detailData({ ...record('record-a'), stage: 'received', receivedMinor: 1000, receivedOn: '2026-09-21' });
  const instance = await loadedDetail(old);
  const previousView = instance.data.view;
  const pending = deferred<Detail>();
  const started = deferred<void>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action !== 'activity.get') return fallback(action, payload);
    started.resolve(); return pending.promise;
  };
  let refreshing!: Promise<void>;
  const load = instance.load.bind(instance);
  instance.load = () => { refreshing = load(); return refreshing; };
  instance.onShow();
  await started.promise;
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.refreshing, true);
  assert.equal(instance.data.detail, old);
  assert.equal(instance.data.view, previousView);
  await assertDetailActionsBlocked(instance);
  const current = detailData({ ...old.participation!, receivedMinor: 2500, version: 2 });
  pending.resolve(current);
  await refreshing;
  assert.equal(instance.data.detail, current);
  assert.equal(instance.data.view.reward, '¥25');
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.outdated, false);
  assert.equal(instance.actionsBlocked(), false);
  await instance.prepareAction('receipt');
  assert.match(navigation.at(-1)?.url || '', /\/pages\/receipt\/index\?activityId=record-a&id=record-a/);
});

test('detail refresh failure keeps context and blocks mutations until a successful retry', async () => {
  const old = detailData();
  const instance = await loadedDetail(old);
  const previousView = instance.data.view;
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'activity.get') throw new Error('Refresh failed');
    return fallback(action, payload);
  };
  await instance.load();
  assert.equal(instance.data.detail, old);
  assert.equal(instance.data.view, previousView);
  assert.equal(instance.data.error, '');
  assert.match(instance.data.refreshError, /上次读取/);
  assert.equal(instance.data.outdated, true);
  assert.equal(toasts, 0);
  await assertDetailActionsBlocked(instance);
  const current = detailData({ ...record('record-a'), version: 2 });
  queryHandler = async (action, payload) => action === 'activity.get' ? current : fallback(action, payload);
  await instance.load();
  assert.equal(instance.data.outdated, false);
  assert.equal(instance.data.refreshError, '');
  instance.openExpected();
  assert.equal(instance.data.showExpected, true);
});

for (const outcome of ['success', 'failure']) {
  test(`late detail refresh ${outcome} cannot overwrite or lock a newer successful receipt`, async () => {
    const instance = await loadedDetail();
    const pending = deferred<Detail>();
    const started = deferred<void>();
    const fallback = queryHandler;
    let calls = 0;
    const current = detailData({ ...record('record-a'), stage: 'received', receivedMinor: 2700, receivedOn: '2026-09-22', version: 3 });
    queryHandler = async (action, payload) => {
      if (action !== 'activity.get') return fallback(action, payload);
      if (++calls === 1) { started.resolve(); return pending.promise; }
      return current;
    };
    const oldLoad = instance.load();
    await started.promise;
    await instance.load();
    const currentView = instance.data.view;
    if (outcome === 'success') pending.resolve(detailData());
    else pending.reject(new Error('Late refresh failure'));
    await oldLoad;
    assert.equal(instance.data.detail, current);
    assert.equal(instance.data.view, currentView);
    assert.equal(instance.data.refreshError, '');
    assert.equal(instance.data.outdated, false);
    assert.equal(instance.data.refreshing, false);
    assert.equal(instance.actionsBlocked(), false);
    assert.equal(toasts, 0);
  });
}

test('a saved receipt reversal is acknowledged when its follow-up refresh fails and is never repeated', async () => {
  const old = detailData({ ...record('record-a'), stage: 'received', receivedMinor: 2000, receivedOn: '2026-09-21' });
  const instance = await loadedDetail(old);
  const sent: string[] = [];
  commandHandler = async action => { sent.push(action); return { id: 'record-a', version: 2 }; };
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'activity.get') throw new Error('Reload failed after saved reversal');
    return fallback(action, payload);
  };
  modalConfirm = true;
  instance.openManage();
  await instance.revokeReceipt();
  assert.deepEqual(sent, ['reward.revoke']);
  assert.equal(instance.data.detail, old);
  assert.match(instance.data.refreshError, /^已撤销到账。/);
  assert.equal(instance.data.outdated, true);
  assert.equal(instance.data.busy, false);
  assert.equal(toasts, 1);
  await instance.revokeReceipt();
  assert.deepEqual(sent, ['reward.revoke']);
  assert.equal(modalCount, 1);
  const current = detailData();
  queryHandler = async (action, payload) => action === 'activity.get' ? current : fallback(action, payload);
  await instance.load();
  assert.equal(instance.data.mutationNotice, '');
  assert.equal(instance.data.outdated, false);
  const refreshedRecord = instance.data.detail?.participation;
  assert.ok(refreshedRecord, 'The refreshed detail must retain the saved participation.');
  assert.equal(refreshedRecord.stage, 'completed');
});

test('a dirty expected-date sheet keeps its input and explains the newly refreshed stored date', async () => {
  const instance = await loadedDetail();
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-28' } });
  const fallback = queryHandler;
  const current = detailData({ ...record('record-a'), expectedOn: '2026-10-01', version: 2 });
  queryHandler = async (action, payload) => action === 'activity.get' ? current : fallback(action, payload);
  await instance.load();
  assert.equal(instance.data.expectedOn, '2026-09-28');
  assert.equal(instance.data.expectedBase, '2026-10-01');
  assert.equal(instance.data.expectedDirty, true);
  assert.match(instance.data.expectedLatestNote, /2026-10-01/);
  assert.match(instance.data.expectedLatestNote, /选择仍然保留/);
  const received = detailData({ ...current.participation!, stage: 'received', receivedMinor: 2000, receivedOn: '2026-09-22', version: 3 });
  queryHandler = async (action, payload) => action === 'activity.get' ? received : fallback(action, payload);
  await instance.load();
  let saved = false;
  commandHandler = async () => { saved = true; return {}; };
  await instance.saveExpected();
  assert.equal(saved, false);
  assert.equal(instance.data.expectedOn, '2026-09-28');
  assert.match(instance.data.expectedLatestNote, /状态已更新/);
});

test('detail initial failure remains distinct and stale mutation controls expose their disabled state', async () => {
  const instance = page('detail');
  instance.setData({ activityId: 'record-a' });
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'activity.get') throw new Error('Initial failure');
    return fallback(action, payload);
  };
  await instance.load();
  assert.equal(instance.data.detail, null);
  assert.ok(instance.data.error);
  assert.equal(instance.data.refreshError, '');
  assert.equal(instance.data.refreshing, false);
  const markup = readFileSync('miniprogram/pages/detail/index.wxml', 'utf8');
  assert.match(markup, /wx:elif="\{\{error && !detail\}\}"/);
  const buttons = markup.match(/<button\b[^>]*>/g) || [];
  for (const handler of ['join', 'complete', 'receipt', 'resume', 'openManage', 'editProgress', 'openExpected', 'reminder', 'chooseCard', 'confirmCard', 'anotherCard', 'addCard', 'skip', 'undoComplete', 'revokeReceipt', 'untrack', 'saveExpected', 'clearExpected']) {
    const matching = buttons.filter(button => button.includes(`bindtap="${handler}"`));
    assert.ok(matching.length, `${handler} must remain available in its valid state.`);
    for (const control of matching) {
      const disabled = /disabled="([^"]+)"/.exec(control)?.[1] || '';
      for (const state of ['loading', 'refreshing', 'outdated', 'busy', 'expectedClosing']) assert.ok(disabled.includes(state), `${handler} must expose ${state} locking.`);
    }
  }
});

for (const route of ['activities', 'history']) {
  test(`${route} pagination preserves visible records after failure and deduplicates its retry`, async () => {
    const instance = page(route);
    instance.setData({ loading: false, cursor: 'page-2', items: [{ id: 'first', title: 'Existing result' }] });
    const fallback = queryHandler;
    let fail = true;
    queryHandler = async (action, payload) => {
      if (action === 'catalog.list' || action === 'history.list') {
        assert.equal(payload.cursor, 'page-2');
        if (fail) throw new Error('Temporary outage');
        return { items: route === 'activities'
          ? ['first', 'second'].map(id => ({ activity: activity(id), eligible: true, participation: null }))
          : ['first', 'second'].map(record), nextCursor: null };
      }
      return fallback(action, payload);
    };
    await instance.load(false);
    assert.equal(instance.data.error, '');
    assert.ok(instance.data.loadMoreError);
    assert.equal(instance.data.cursor, 'page-2');
    assert.deepEqual(instance.data.items.map((item: any) => item.id), ['first']);
    fail = false;
    await instance.load(false);
    assert.deepEqual(instance.data.items.map((item: any) => item.id), ['first', 'second']);
    assert.equal(instance.data.loadMoreError, '');
    assert.equal(instance.data.cursor, null);
  });

  test(`${route} return refresh retains the second page until the whole loaded window is refreshed`, async () => {
    const instance = page(route);
    const pageSize = route === 'activities' ? 20 : 30;
    const ids = Array.from({ length: pageSize * 3 }, (_, index) => `item-${index}`);
    const fallback = queryHandler;
    const waiting = deferred<any>();
    const secondStarted = deferred<void>();
    let revision = 0;
    const response = (offset: number) => ({ items: ids.slice(offset, offset + pageSize).map(id => {
      const source = { ...activity(id), title: `${id}-revision-${revision}` };
      return route === 'activities' ? { activity: source, eligible: true, participation: null } : { ...record(id), snapshot: source };
    }), nextCursor: offset + pageSize < ids.length ? String(offset + pageSize) : null });
    queryHandler = async (action, payload) => {
      if (action !== 'catalog.list' && action !== 'history.list') return fallback(action, payload);
      const offset = Number(payload.cursor || 0);
      if (revision && offset === pageSize) { secondStarted.resolve(); return waiting.promise; }
      return response(offset);
    };
    await instance.load(true);
    await instance.load(false);
    const original = instance.data.items;
    assert.equal(original.length, pageSize * 2);
    if (route === 'activities') instance.openActivity({ currentTarget: { dataset: { id: ids[pageSize] } } });
    else instance.openRecord({ currentTarget: { dataset: { id: ids[pageSize], activity: ids[pageSize] } } });
    assert.equal(navigation.at(-1)?.kind, 'forward');
    revision = 1;
    let refreshing!: Promise<void>;
    const load = instance.load.bind(instance);
    instance.load = (reset = true) => { refreshing = load(reset); return refreshing; };
    instance.onShow();
    await secondStarted.promise;
    assert.equal(instance.data.items, original);
    assert.equal(instance.data.items.length, pageSize * 2);
    assert.equal(instance.data.cursor, String(pageSize * 2));
    waiting.resolve(response(pageSize));
    await refreshing;
    assert.equal(instance.data.items.length, pageSize * 2);
    assert.equal(instance.data.items[pageSize].title, `${ids[pageSize]}-revision-1`);
    assert.equal(instance.data.cursor, String(pageSize * 2));
  });

  test(`${route} a failed window refresh keeps the previous second page and cursor`, async () => {
    const instance = page(route);
    const pageSize = route === 'activities' ? 20 : 30;
    const original = Array.from({ length: pageSize * 2 }, (_, index) => ({ id: `old-${index}`, title: `Previous ${index}` }));
    instance.setData({ loading: false, items: original, cursor: 'previous-tail' });
    const fallback = queryHandler;
    queryHandler = async (action, payload) => {
      if (action !== 'catalog.list' && action !== 'history.list') return fallback(action, payload);
      if (payload.cursor) throw new Error('Second page failed');
      return { items: Array.from({ length: pageSize }, (_, index) => route === 'activities'
        ? { activity: activity(`fresh-${index}`), eligible: true, participation: null }
        : record(`fresh-${index}`)), nextCursor: 'refresh-next' };
    };
    await instance.load(true);
    assert.equal(instance.data.items, original);
    assert.equal(instance.data.cursor, 'previous-tail');
    assert.ok(instance.data.error);
    assert.equal(instance.data.loading, false);
  });

  test(`${route} changing a filter invalidates a window refresh already on its second page`, async () => {
    const instance = page(route);
    const pageSize = route === 'activities' ? 20 : 30;
    instance.setData({ loading: false, items: Array.from({ length: pageSize * 2 }, (_, index) => ({ id: `old-${index}` })) });
    const pending = deferred<any>();
    const secondStarted = deferred<void>();
    const currentStarted = deferred<void>();
    const fallback = queryHandler;
    queryHandler = async (action, payload) => {
      if (action !== 'catalog.list' && action !== 'history.list') return fallback(action, payload);
      const changed = route === 'activities' ? payload.bankId === 'cmb' : payload.filter === 'pending';
      if (changed) {
        currentStarted.resolve();
        return { items: route === 'activities' ? [{ activity: activity('current'), eligible: true, participation: null }] : [record('current')], nextCursor: null };
      }
      if (payload.cursor) { secondStarted.resolve(); return pending.promise; }
      return { items: route === 'activities' ? [{ activity: activity('obsolete'), eligible: true, participation: null }] : [record('obsolete')], nextCursor: 'old-next' };
    };
    const oldRefresh = instance.load(true);
    await secondStarted.promise;
    let currentRefresh!: Promise<void>;
    const load = instance.load.bind(instance);
    instance.load = (reset = true) => { currentRefresh = load(reset); return currentRefresh; };
    if (route === 'activities') instance.chooseBank({ currentTarget: { dataset: { id: 'cmb' } } });
    else instance.chooseFilter({ currentTarget: { dataset: { filter: 'pending' } } });
    assert.deepEqual(instance.data.items, []);
    await currentStarted.promise;
    await currentRefresh;
    pending.reject(new Error('Obsolete page failed'));
    await oldRefresh;
    assert.deepEqual(instance.data.items.map((item: any) => item.id), ['current']);
    assert.equal(instance.data.error, '');
    assert.equal(toasts, 0);
  });
}

test('changing an activity filter ignores the obsolete request and its error feedback', async () => {
  const instance = page('activities');
  const oldRequest = deferred<any>();
  const started = deferred<void>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action !== 'catalog.list') return fallback(action, payload);
    if (!payload.bankId) { started.resolve(); return oldRequest.promise; }
    return { items: [{ activity: activity('current'), eligible: true, participation: null }], nextCursor: null };
  };
  const obsolete = instance.load(true);
  await started.promise;
  instance.setData({ bankId: 'cmb' });
  await instance.load(true);
  oldRequest.reject(new Error('Stale failure'));
  await obsolete;
  assert.deepEqual(instance.data.items.map((item: any) => item.id), ['current']);
  assert.equal(instance.data.error, '');
  assert.equal(toasts, 0);
});

test('closed audit responses cannot overwrite another record and failures retry in place', async () => {
  const instance = page('history');
  const first = deferred<any>();
  let failSecond = true;
  queryHandler = async (_action, payload) => {
    if (payload.participationId === 'first') return first.promise;
    if (failSecond) throw new Error('Temporary outage');
    return { participation: record('second'), audit: [{ id: 'second-event', action: 'join', at: '2026-09-22T00:00:00Z' }] };
  };
  const stale = instance.openAudit({ currentTarget: { dataset: { id: 'first', activity: 'first', title: 'First' } } });
  instance.closeAudit();
  await instance.openAudit({ currentTarget: { dataset: { id: 'second', activity: 'second', title: 'Second' } } });
  assert.ok(instance.data.auditError);
  failSecond = false;
  await instance.loadAudit();
  first.resolve({ participation: record('first'), audit: [{ id: 'first-event', action: 'join', at: '2026-09-22T00:00:00Z' }] });
  await stale;
  assert.equal(instance.data.auditTitle, 'Second');
  assert.deepEqual(instance.data.audit.map((item: any) => item.id), ['second-event']);
  assert.equal(instance.data.auditLoading, false);
  assert.equal(instance.data.auditError, '');
});

test('expected date dismissal retains edits until discard is confirmed and freezes while saving', async () => {
  const instance = page('detail');
  instance.setData({ loading: false, detail: { participation: record('record-a') }, view: { benefit: { isDiscount: false } } });
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-28' } });
  assert.equal(alerts, true);
  await instance.closeExpected();
  assert.equal(instance.data.showExpected, true);
  assert.equal(instance.data.expectedOn, '2026-09-28');
  instance.setData({ busy: true });
  instance.clearExpected();
  instance.changeExpected({ detail: { value: '2026-10-01' } });
  await instance.closeExpected();
  assert.equal(instance.data.expectedOn, '2026-09-28');
  assert.equal(modalCount, 1);
  instance.setData({ busy: false });
  modalConfirm = true;
  await instance.closeExpected();
  assert.equal(instance.data.showExpected, false);
  assert.equal(instance.data.expectedOn, '2026-09-25');
  assert.equal(alerts, false);
});

test('saving an expected date submits one immutable value and retains failed edits', async () => {
  const instance = page('detail');
  instance.setData({ loading: false, detail: { participation: record('record-a') }, view: { benefit: { isDiscount: false } } });
  instance.openExpected();
  instance.changeExpected({ detail: { value: '2026-09-28' } });
  const pending = deferred<any>();
  let sent = '';
  commandHandler = async (_action, payload) => { sent = payload.expectedOn; return pending.promise; };
  const save = instance.saveExpected();
  instance.clearExpected();
  assert.equal(sent, '2026-09-28');
  assert.equal(instance.data.expectedOn, sent);
  pending.reject(new Error('Temporary outage'));
  await save;
  assert.equal(instance.data.showExpected, true);
  assert.equal(instance.data.expectedDirty, true);
  assert.ok(instance.data.expectedError);
  assert.equal(instance.data.busy, false);
});

test('a multi-error card form exposes a navigable summary and focuses nickname edits', () => {
  const instance = page('card-edit');
  instance.setData({ loading: false });
  instance.showValidationErrors({ nickname: 'Choose a distinct nickname', dueDay: 'Choose a repayment day' });
  assert.deepEqual(instance.data.errorSummary.map((item: any) => item.field), ['nickname', 'dueDay']);
  assert.equal(scrolls[0], '#card-error-summary');
  instance.focusErrorField({ currentTarget: { dataset: { field: 'nickname' } } });
  assert.equal(instance.data.focusField, 'nickname');
  instance.focusErrorField({ currentTarget: { dataset: { field: 'dueDay' } } });
  assert.equal(instance.data.showCycle, true);
  assert.equal(scrolls.at(-1), '#field-dueDay');
});

test('deep links return to a concrete destination without replacing canceled normal back navigation', () => {
  backToActivity('activity/a', 'record/b');
  assert.deepEqual(navigation, [{ kind: 'redirect', url: '/pages/detail/index?id=activity%2Fa&participationId=record%2Fb' }]);
  navigation = [];
  backToActivity();
  assert.deepEqual(navigation, [{ kind: 'tab', url: '/pages/todo/index' }]);
  navigation = [];
  stackSize = 2;
  navigateBackOr('/pages/wallet/index', true);
  assert.deepEqual(navigation, [{ kind: 'back' }]);
});

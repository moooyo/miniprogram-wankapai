import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Activity, Actor, ApiRequest, Card, Commands, Dashboard, Detail, MutationResult, PageResult, Participation, RewardsView, Wallet } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';
import { cardLabel, cardLabels, cardReference } from '../miniprogram/services/card-labels';

const actor: Actor = { userId: 'records-user', isModerator: false };
const otherActor: Actor = { userId: 'another-user', isModerator: false };

function card(id: string, overrides: Partial<Card> = {}): Card {
  return { id, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Daily card', createdAt: '2026-01-01T00:00:00Z', ...overrides };
}

function activity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id, title: 'Card reward', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa credit card',
    frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2026-12-31', target: 3, unit: 'transactions', currency: 'CNY', rewardMinor: 2000,
    rewardKind: 'cashback', scope: 'card', requiresRegistration: false, requiresInvitation: false, conditions: 'Three eligible transactions',
    sourceUrl: 'https://www.cmbchina.com/', sourceNote: 'Official source', entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open the bank app', imageIds: [] },
    revision: 1, status: 'published', publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', publishedBy: 'operator', ...overrides,
  };
}

function fixture(activities = [activity('card-reward')]) {
  const cards = [card('card-alpha'), card('card-beta'), card('card-other', { ownerId: otherActor.userId })];
  const store = new MemoryStore({ cards: Object.fromEntries(cards.map(item => [item.id, item])), activities: Object.fromEntries(activities.map(item => [item.id, item])) });
  let now = new Date('2026-09-20T04:00:00Z');
  const service = createService(store, { now: () => now, demo: true });
  let sequence = 0;
  return {
    cards, store,
    setDate(value: string) { now = new Date(`${value}T04:00:00Z`); },
    query: <T>(action: string, payload: unknown = {}) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T>,
    command: <K extends keyof Commands>(action: K, payload: Commands[K], user = actor) => service.execute(user, { action, payload, requestId: `records-${++sequence}` } as ApiRequest) as Promise<MutationResult>,
  };
}

const definitions: Record<string, any> = {};
let pageLoading: Promise<void> | undefined;
async function page(name: 'todo' | 'rewards' | 'mine' | 'history'): Promise<any> {
  if (!pageLoading) pageLoading = (async () => {
    const runtime = globalThis as any;
    const previous = runtime.Page;
    try {
      for (const route of ['todo', 'rewards', 'mine', 'history']) {
        runtime.Page = (definition: any) => { definitions[route] = definition; };
        await import(`../miniprogram/pages/${route}/index`);
      }
    } finally { runtime.Page = previous; }
  })();
  await pageLoading;
  const instance = { ...definitions[name], data: structuredClone(definitions[name].data), setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } };
  return instance;
}

test('card labels distinguish repeated and missing nicknames without exposing internal card identifiers', () => {
  const cards = [card('private-alpha'), card('private-beta'), card('private-gamma', { nickname: '' }), card('private-delta', { nickname: '' })];
  const labels = cardLabels(cards);
  assert.equal(new Set(Object.values(labels)).size, cards.length);
  assert.equal(cardLabel(cards[0].id, [...cards].reverse()), labels[cards[0].id]);
  assert.ok(Object.values(labels).every(label => !label.includes('private-')));
  assert.ok(Object.values(labels).every(label => label.includes('同名卡') && !label.includes('标识')));
  assert.match(cardLabel('removed-alpha', []), /已移除的卡片（资料缺失）/);
  assert.notEqual(cardLabel('removed-alpha', [], 'detailed'), cardLabel('removed-beta', [], 'detailed'));
  assert.notEqual(cardReference('removed-alpha'), cardReference('removed-beta'));
  assert.equal(cardLabel(undefined, cards), '');
});

test('unambiguous card labels use meaningful names and metadata before adding an identifier', () => {
  const unique = [card('first', { nickname: 'Daily card' }), card('second', { nickname: 'Travel card' })];
  assert.equal(cardLabel('first', unique), 'Daily card');
  assert.equal(cardLabel('second', unique), 'Travel card');
  const differentNetworks = [card('first'), card('second', { network: 'mastercard' })];
  const labels = cardLabels(differentNetworks);
  assert.notEqual(labels.first, labels.second);
  assert.match(labels.first, /Visa/);
  assert.match(labels.second, /Mastercard/);
  assert.ok(Object.values(labels).every(label => !label.includes('标识 ')));
  assert.deepEqual(cardLabels([...differentNetworks].reverse()), labels);
  const unnamed = [card('first', { nickname: '' }), card('second', { nickname: '', kind: 'debit' })];
  assert.notEqual(cardLabel('first', unnamed), cardLabel('second', unnamed));
  assert.ok(Object.values(cardLabels(unnamed)).every(label => !label.includes('标识 ')));
});

test('reward projections retain legacy ledger card identity and global currency counts without crossing ownership', async () => {
  const f = fixture([activity('card-reward'), activity('pending-cny', { scope: 'user' }), activity('pending-hkd', { currency: 'HKD', scope: 'user' })]);
  const first = await f.command('reward.confirm', { activityId: 'card-reward', cardId: 'card-alpha', amountMinor: 1875, receivedOn: '2026-09-20' });
  const second = await f.command('reward.confirm', { activityId: 'card-reward', cardId: 'card-beta', amountMinor: 1250, receivedOn: '2026-09-20' });
  await f.command('participation.complete', { activityId: 'pending-cny' });
  await f.command('participation.complete', { activityId: 'pending-hkd' });
  await f.command('participation.complete', { activityId: 'pending-cny' }, otherActor);
  const result = await f.query<RewardsView>('rewards.get', { month: '2026-09', currency: 'CNY' });
  assert.equal(result.totalMinor, 3125);
  assert.deepEqual(result.pendingCounts, { CNY: 1, HKD: 1, MOP: 0 });
  assert.deepEqual(result.cardIds, { [first.id]: 'card-alpha', [second.id]: 'card-beta' });
  assert.ok(result.cards?.every(item => item.ownerId === actor.userId));
  assert.equal(result.cards?.length, 2);
  const partial = await f.query<RewardsView>('rewards.get', { month: '2026-09', currency: 'CNY', limit: 1 });
  assert.deepEqual(Object.keys(partial.cardIds || {}), [partial.received[0].participationId]);
  const rewards = await page('rewards');
  const rows = rewards.mapReceived(result.received, result.cards, result.cardIds);
  assert.equal(new Set(rows.map((item: any) => item.cardName)).size, 2);
  const ledger = await f.store.find<Record<string, unknown>>('rewards');
  assert.ok(ledger.every(item => item.cardId === undefined), 'Card identity must be derived for old and new ledger rows, without a write migration.');
});

test('todo uses the actual receipt amount, retains the estimate and keeps the month filter scoped to unfinished records', async () => {
  const f = fixture();
  await f.command('reward.confirm', { activityId: 'card-reward', cardId: 'card-alpha', amountMinor: 1875, receivedOn: '2026-09-20' });
  const todo = await page('todo');
  todo.data.raw = await f.query<Dashboard>('dashboard.get');
  todo.data.filter = 'completed';
  todo.data.closingOnly = true;
  todo.applyFilter();
  assert.equal(todo.data.tasks.length, 1, 'An unfinished-only date filter must not empty the completed tab.');
  assert.equal(todo.data.tasks[0].reward, '¥18.75');
  assert.equal(todo.data.tasks[0].rewardLabel, '实际到账');
  assert.equal(todo.data.tasks[0].estimate, '¥20');
  assert.equal(todo.data.tasks[0].cardName, cardLabel('card-alpha', f.cards.filter(item => item.ownerId === actor.userId)));
  todo.selectFilter({ currentTarget: { dataset: { filter: 'all' } } });
  assert.equal(todo.data.filter, 'all');
  assert.equal(todo.data.tasks.length, 1);
  todo.toggleClosing({ detail: { value: false } });
  assert.equal(todo.data.filter, 'all');
});

test('archived cards keep the same owned identity in pending rewards, received rewards, todo and wallet-backed history', async () => {
  const f = fixture();
  const received = await f.command('reward.confirm', { activityId: 'card-reward', cardId: 'card-alpha', amountMinor: 1875, receivedOn: '2026-09-20' });
  const pending = await f.command('participation.complete', { activityId: 'card-reward', cardId: 'card-beta' });
  await f.command('card.remove', { id: 'card-alpha' });
  await f.command('card.remove', { id: 'card-beta' });
  await f.command('card.remove', { id: 'card-other' }, otherActor);
  const result = await f.query<RewardsView>('rewards.get', { month: '2026-09', currency: 'CNY' });
  const dashboard = await f.query<Dashboard>('dashboard.get');
  const wallet = await f.query<Wallet>('wallet.get');
  const rewards = await page('rewards');
  const todo = await page('todo');
  todo.data.raw = dashboard;
  todo.data.filter = 'completed';
  todo.applyFilter();
  const receivedRow = rewards.mapReceived(result.received, result.cards, result.cardIds).find((item: any) => item.participationId === received.id);
  const pendingRow = rewards.mapPending(result.pending, result.cards).find((item: any) => item.id === pending.id);
  assert.equal(result.cards?.length, 2);
  assert.ok(result.cards?.every(item => item.archivedAt && item.ownerId === actor.userId));
  for (const [id, cardId, row] of [[received.id, 'card-alpha', receivedRow], [pending.id, 'card-beta', pendingRow]] as const) {
    const name = cardLabel(cardId, wallet.cards);
    assert.match(name, /Daily card.*已移除/);
    assert.equal(row.cardName, name);
    assert.equal(todo.data.tasks.find((item: any) => item.id === id).cardName, name);
  }
  assert.ok(wallet.cards.every(item => item.ownerId === actor.userId));
  assert.ok(dashboard.cards?.every(item => item.ownerId === actor.userId));
});

test('expired skipped and received one-off records remain reachable through both global history entries', async () => {
  const f = fixture([activity('once-skipped', { frequency: 'once', endsOn: '2026-09-20', scope: 'user' }), activity('once-received', { frequency: 'once', endsOn: '2026-09-20', scope: 'user' })]);
  const skipped = await f.command('activity.join', { activityId: 'once-skipped' });
  await f.command('participation.skip', { participationId: skipped.id, skipped: true });
  const received = await f.command('reward.confirm', { activityId: 'once-received', amountMinor: 1875, receivedOn: '2026-09-20' });
  f.setDate('2026-09-21');
  assert.equal((await f.query<Dashboard>('dashboard.get')).tasks.length, 0);
  const records = await f.query<PageResult<Participation>>('history.list');
  assert.deepEqual(new Set(records.items.map(item => item.id)), new Set([skipped.id, received.id]));
  for (const record of records.items) {
    const detail = await f.query<Detail>('activity.get', { participationId: record.id });
    assert.equal(detail.participation?.id, record.id);
  }
  const destinations: string[] = [];
  const previous = (globalThis as any).wx;
  (globalThis as any).wx = { navigateTo({ url }: { url: string }) { destinations.push(url); } };
  try {
    (await page('todo')).openHistory();
    (await page('mine')).openHistory();
    assert.deepEqual(destinations, ['/pages/history/index', '/pages/history/index']);
  } finally { (globalThis as any).wx = previous; }
});

test('skipped todo records expose recovery instead of navigating into a disabled receipt form', async () => {
  const f = fixture([activity('skipped', { scope: 'user' })]);
  const record = await f.command('activity.join', { activityId: 'skipped' });
  await f.command('participation.skip', { participationId: record.id, skipped: true });
  const todo = await page('todo');
  todo.data.raw = await f.query<Dashboard>('dashboard.get');
  todo.showMore({ currentTarget: { dataset: { id: record.id } } });
  assert.equal(todo.data.actionStage, 'skipped');
  const previous = (globalThis as any).wx;
  let navigated = false;
  (globalThis as any).wx = { navigateTo() { navigated = true; } };
  try {
    todo.receipt({ currentTarget: { dataset: { id: record.id } } });
    assert.equal(navigated, false);
  } finally { (globalThis as any).wx = previous; }
  const template = readFileSync('miniprogram/pages/todo/index.wxml', 'utf8');
  assert.match(template, /actionStage !== 'received' && actionStage !== 'skipped'/);
  assert.match(template, /恢复本期参与/);
});

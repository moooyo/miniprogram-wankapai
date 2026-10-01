import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Entitlement, Wallet } from '../shared/contracts';
import type { MemorySeed } from '../domain/memory-store';
import { demoActor, demoService, installDesignDemoFixtures, resetDemoCache } from '../miniprogram/services/demo';
import { api } from '../miniprogram/services/api';

const storageKey = 'card-benefits.native.demo.v1';
const originalWx = (globalThis as any).wx;
type StoredDemo = { version: 1; seed: MemorySeed };

function installStorage() {
  const storage = new Map<string, StoredDemo>();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: StoredDemo) => storage.set(key, structuredClone(value)),
  };
  demoActor.isModerator = false;
  resetDemoCache();
  return storage;
}

afterEach(() => { resetDemoCache(); (globalThis as any).wx = originalWx; });

test('design fixtures are explicit and preserve every ordinary demo record', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-02T04:00:00Z') });
  const storage = installStorage();
  await demoService();
  const original = structuredClone(storage.get(storageKey)!);
  assert.equal((await api.query('catalog.list', { limit: 50 })).items.length, 13);
  assert.equal((await api.query('catalog.list', { mineOnly: true, limit: 50 })).items.length, 4);
  assert.equal((await api.query('wallet.get', {})).cards.length, 3);
  assert.equal((await api.query('entitlements.list', {})).items.length, 3);
  const result = await installDesignDemoFixtures();
  assert.equal(result.activityIds.length, 5);
  assert.equal(result.cardIds.length, 4);
  assert.equal(result.ocrAssetId, 'demo-shot-ocr-rule');
  assert.ok(result.ocrSubmissionId);
  const installed = storage.get(storageKey)!;
  for (const collection of Object.keys(original.seed) as Array<keyof MemorySeed>) {
    for (const [id, row] of Object.entries(original.seed[collection]!)) {
      assert.deepEqual(installed.seed[collection]![id], row, `${collection}/${id} must survive fixture installation`);
    }
  }
  assert.deepEqual(await installDesignDemoFixtures(), result);
  assert.deepEqual(storage.get(storageKey), installed);
  resetDemoCache();
  assert.deepEqual(await installDesignDemoFixtures(), result);
  assert.deepEqual(storage.get(storageKey), installed);
  context.mock.timers.setTime(Date.parse('2027-01-02T04:00:00Z'));
  assert.deepEqual(await installDesignDemoFixtures(), result);
  assert.deepEqual(storage.get(storageKey), installed);
});

test('design fixtures provide linked benefits, immutable cycle scenarios and a separate known bill amount', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-02T04:00:00Z') });
  installStorage();
  const fixtures = await installDesignDemoFixtures();
  const benefits = await api.query('entitlements.list', {});
  assert.equal(benefits.items.length, 9);
  const cardForKind = { lounge: 'demo-card-hsbc', delay_insurance: 'demo-card-hsbc', airport_transfer: 'demo-card-boc',
    health_check: 'demo-card-cmb', car_wash: 'demo-card-cmb', points: 'demo-card-cmb' };
  assert.deepEqual(Object.keys(fixtures.entitlementIds).sort(), Object.keys(cardForKind).sort());
  for (const [kind, id] of Object.entries(fixtures.entitlementIds)) {
    const item = benefits.items.find(row => row.id === id)!;
    assert.equal(item.kind, kind);
    assert.equal(item.ownerId, demoActor.userId);
    assert.equal(item.cardId, cardForKind[kind as keyof typeof cardForKind]);
    assert.match(item.notes, /虚构演示/);
    if (kind === 'delay_insurance' || kind === 'points') assert.equal(item.totalUses, 0);
  }
  const lounge = benefits.items.find(row => row.id === fixtures.entitlementIds.lounge)!;
  assert.equal(lounge.loungeProgram, 'pp');
  assert.ok(lounge.lounges.every(row => row.sourceNote.includes('虚构')));
  assert.equal(benefits.items.find(row => row.id === fixtures.entitlementIds.points)?.pointsBalance, 12480);
  const weekly = await api.query('activity.get', { activityId: 'design-weekly' });
  assert.equal(weekly.participation?.periodKey, 'week:2026-09-28');
  assert.deepEqual(weekly.activity.cycle, { t: 'week', weekday: 1, days: [6, 0] });
  assert.equal(weekly.assets.length, 2);
  const monthly = await api.query('activity.get', { activityId: 'design-month-day21' });
  assert.equal(monthly.participation, null);
  assert.equal(monthly.eligible, true);
  assert.deepEqual(monthly.activity.cycle, { t: 'month', day: 21 });
  const custom = await api.query('activity.get', { activityId: 'design-custom-quarterly' });
  assert.equal(custom.participation?.periodKey, 'custom:2026-10-01');
  assert.equal(custom.participation?.stage, 'completed');
  assert.equal(custom.participation?.expectedOn, '2026-10-14');
  const points = await api.query('activity.get', { activityId: 'design-points' });
  assert.equal(points.participation?.progress, 4);
  assert.equal(points.activity.rewardKind, 'points');
  assert.equal(points.activity.rewardMinor, 200000);
  const wallet: Wallet = await api.query('wallet.get', {});
  const billCard = wallet.cards.find(row => row.id === fixtures.billingAmountFixture.cardId)!;
  assert.equal(billCard.bankId, 'cmb');
  assert.equal(billCard.billingAccountId, fixtures.billingAmountFixture.accountId);
  const bill = wallet.bills.find(row => row.id === fixtures.billingAmountFixture.billId)!;
  assert.equal(bill.amountMinor, 128050);
  assert.equal(bill.currency, 'CNY');
  assert.equal(wallet.cards.length, 8);
  assert.equal(wallet.accounts.length, 4);
  assert.equal(wallet.bills.length, 4);
  const urls = await api.query('assets.urls', { ids: ['demo-shot-cmb-rule', 'demo-shot-cmb-entry'] });
  assert.deepEqual(urls.map(row => row.url), ['/assets/demo/cmb-rule.png', '/assets/demo/cmb-entry.png']);
});

test('fixture reinstallation preserves real consumption and edited personal benefits and bills', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-02T04:00:00Z') });
  const storage = installStorage();
  const fixtures = await installDesignDemoFixtures();
  const initial = await api.query('activity.get', { activityId: fixtures.consumptionActivityId });
  assert.equal(initial.activity.target, 2);
  assert.equal(initial.participation?.cardId, 'demo-card-cmb');
  assert.equal(initial.participation?.progress, 0);
  assert.deepEqual(initial.consumptions, []);
  const first = await api.command('participation.consume', { participationId: initial.participation!.id,
    consumedOn: '2026-10-02', amountMinor: 18800, merchant: 'Demo merchant', expectedVersion: initial.participation!.version });
  const active = await api.query('activity.get', { activityId: fixtures.consumptionActivityId });
  assert.equal(active.participation?.progress, 1);
  const second = await api.command('participation.consume', { participationId: active.participation!.id,
    consumedOn: '2026-10-02', amountMinor: 12600, merchant: 'Second demo merchant', expectedVersion: active.participation!.version });
  const completed = await api.query('activity.get', { activityId: fixtures.consumptionActivityId });
  assert.equal(completed.participation?.stage, 'completed');
  assert.equal(completed.consumptions?.length, 2);
  await api.command('consumption.revoke', { id: second.id, expectedVersion: completed.participation!.version });
  const restored = await api.query('activity.get', { activityId: fixtures.consumptionActivityId });
  assert.equal(restored.participation?.progress, 1);
  assert.equal(restored.participation?.stage, 'in_progress');
  assert.equal(restored.consumptions?.find(row => row.id === first.id)?.reversedAt, null);
  assert.ok(restored.consumptions?.find(row => row.id === second.id)?.reversedAt);
  await api.command('bill.update', { id: fixtures.billingAmountFixture.billId, paid: true, amountMinor: 99000 });
  const benefit = (await api.query('entitlement.get', { id: fixtures.entitlementIds.points })).entitlement;
  const { id, ownerId, usedUses, version, createdAt, updatedAt, archivedAt, ...draft } = benefit;
  await api.command('entitlement.save', { id, draft: { ...draft, pointsBalance: 15000, description: 'Edited demo balance' }, expectedVersion: version });
  const edited = structuredClone(storage.get(storageKey)!);
  assert.deepEqual(await installDesignDemoFixtures(), fixtures);
  assert.deepEqual(storage.get(storageKey), edited);
  resetDemoCache();
  assert.deepEqual(await installDesignDemoFixtures(), fixtures);
  assert.deepEqual(storage.get(storageKey), edited);
  assert.equal((storage.get(storageKey)!.seed.entitlements![id] as Entitlement).pointsBalance, 15000);
});

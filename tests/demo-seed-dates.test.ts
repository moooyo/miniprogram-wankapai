import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Bill, Wallet } from '../shared/contracts';
import type { MemorySeed } from '../domain/memory-store';
import { addDays, billDates, lastDay } from '../domain/calendar';
import { demoActor, demoService, resetDemoCache } from '../miniprogram/services/demo';
import { api, ensureSession } from '../miniprogram/services/api';

const storageKey = 'card-benefits.native.demo.v1';
const cardIds = ['demo-card-cmb', 'demo-card-hsbc', 'demo-card-boc'];
type StoredDemo = { version: 1; seed: MemorySeed };

function installStorage() {
  const storage = new Map<string, unknown>();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
  };
  demoActor.isModerator = false;
  resetDemoCache();
  return storage;
}

function assertSeedWallet(wallet: Wallet, date: string): void {
  const month = date.slice(0, 7);
  assert.equal(wallet.cards.length, 3, `${date}: card count`);
  assert.equal(wallet.accounts.length, 3, `${date}: account count`);
  assert.equal(wallet.bills.length, 3, `${date}: bill count`);
  for (const [index, id] of cardIds.entries()) {
    const card = wallet.cards.find(row => row.id === id)!;
    assert.ok(card, `${date}: ${id}`);
    const account = wallet.accounts.find(row => row.id === card.billingAccountId)!;
    const bill = wallet.bills.find(row => row.billingAccountId === account.id && row.periodKey === month)!;
    const dueOn = addDays(date, index + 3);
    assert.ok(account.enabled, `${date}: account enabled`);
    assert.equal(bill.dueOn, dueOn, `${date}: ${id} remains due in ${index + 3} days`);
    assert.ok(bill.statementOn <= date, `${date}: the sample bill has already been issued`);
    assert.ok(bill.statementOn < bill.dueOn, `${date}: the actual due date follows the statement`);
    assert.equal(bill.paidAt, null);
    assert.deepEqual(billDates(account, month), { statementOn: bill.statementOn, dueOn }, `${date}: stored rules match the seeded bill`);
  }
}

afterEach(() => { resetDemoCache(); });

for (const year of [2026, 2028]) {
  test(`fresh demo initializes on every calendar day of ${year} with three valid upcoming bills`, async context => {
    const storage = installStorage();
    context.mock.timers.enable({ apis: ['Date'], now: new Date(`${year}-01-01T04:00:00.000Z`) });
    let checked = 0;
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= lastDay(year, month); day += 1) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        context.mock.timers.setTime(Date.parse(`${date}T04:00:00.000Z`));
        storage.clear();
        resetDemoCache();
        const service = await demoService();
        const wallet = await service.execute(demoActor, { action: 'wallet.get', payload: {} }) as Wallet;
        assertSeedWallet(wallet, date);
        const saved = storage.get(storageKey) as StoredDemo;
        assert.equal(saved.version, 1);
        assert.equal(Object.keys(saved.seed.cards || {}).length, 3);
        assert.equal(Object.keys(saved.seed.bills || {}).length, 3);
        checked += 1;
      }
    }
    assert.equal(checked, year === 2028 ? 366 : 365);
  });
}

test('native demo queries and cache reinitialization preserve edited cards and paid bill history on the first day', async context => {
  const storage = installStorage();
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T04:00:00.000Z') });
  const session = await ensureSession(true);
  assert.equal(session.demo, true);
  assert.equal(session.today, '2026-01-01');
  const wallet = await api.query('wallet.get', {});
  assertSeedWallet(wallet, session.today);
  const service = await demoService();
  assert.equal(await demoService(), service);
  const card = wallet.cards.find(row => row.id === cardIds[0])!;
  const bill = wallet.bills.find(row => row.billingAccountId === card.billingAccountId)!;
  await api.command('card.save', { id: card.id, bankId: card.bankId, issuerId: card.issuerId, network: card.network, kind: card.kind, nickname: 'Persisted demo edit' });
  await api.command('bill.update', { id: bill.id, dueOn: '2026-01-07', paid: true });
  const saved = structuredClone(storage.get(storageKey));
  resetDemoCache();
  assert.notEqual(await demoService(), service);
  const restored = await api.query('wallet.get', {});
  assert.equal(restored.cards.find(row => row.id === card.id)?.nickname, 'Persisted demo edit');
  assert.equal(restored.bills.find(row => row.id === bill.id)?.dueOn, '2026-01-07');
  assert.ok(restored.bills.find(row => row.id === bill.id)?.paidAt);
  assert.equal(restored.cards.length, 3);
  assert.equal(restored.bills.length, 3);
  assert.deepEqual(storage.get(storageKey), saved);
});

for (const [previous, current] of [['2026-01-31', '2026-02-01'], ['2026-12-31', '2027-01-01']]) {
  test(`persisted demo rollover from ${previous} to ${current} materializes one new period without reseeding`, async context => {
    installStorage();
    context.mock.timers.enable({ apis: ['Date'], now: new Date(`${previous}T04:00:00.000Z`) });
    await ensureSession(true);
    const original = await api.query('wallet.get', {});
    assertSeedWallet(original, previous);
    const paidId = original.bills[0].id;
    await api.command('bill.update', { id: paidId, paid: true });
    const history = (await api.query('wallet.get', {})).bills;
    context.mock.timers.setTime(Date.parse(`${current}T04:00:00.000Z`));
    resetDemoCache();
    await ensureSession(true);
    const rolled = await api.query('wallet.get', {});
    assert.deepEqual(rolled.cards, original.cards);
    assert.deepEqual(rolled.accounts, original.accounts);
    assert.equal(rolled.bills.length, 6);
    for (const bill of history) assert.deepEqual(rolled.bills.find(row => row.id === bill.id), bill);
    for (const account of rolled.accounts) {
      const bill = rolled.bills.find(row => row.billingAccountId === account.id && row.periodKey === current.slice(0, 7))!;
      assert.ok(bill);
      assert.deepEqual({ statementOn: bill.statementOn, dueOn: bill.dueOn }, billDates(account, current.slice(0, 7)));
    }
    resetDemoCache();
    assert.deepEqual((await api.query('wallet.get', {})).bills, rolled.bills);
  });
}

test('a failed first persistence can be retried without retaining a partial or duplicate demo seed', async context => {
  const storage = installStorage();
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2028-02-01T04:00:00.000Z') });
  let fail = true;
  (globalThis as any).wx.setStorageSync = (key: string, value: unknown) => {
    if (fail) { fail = false; throw new Error('Storage temporarily unavailable'); }
    storage.set(key, structuredClone(value));
  };
  await assert.rejects(demoService(), /Storage temporarily unavailable/);
  assert.equal(storage.size, 0);
  const service = await demoService();
  assertSeedWallet(await service.execute(demoActor, { action: 'wallet.get', payload: {} }) as Wallet, '2028-02-01');
  const saved = storage.get(storageKey) as StoredDemo;
  assert.equal(Object.keys(saved.seed.cards || {}).length, 3);
  assert.equal(Object.values(saved.seed.bills || {}).filter(value => (value as Bill).periodKey === '2028-02').length, 3);
});

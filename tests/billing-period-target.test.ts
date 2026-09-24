import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, ApiRequest, Bill, BillingAccount, Card, Commands, MutationResult, Queries } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';

const owner: Actor = { userId: 'billing-owner', isModerator: false };
const other: Actor = { userId: 'billing-other', isModerator: false };
const cardFields = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa' as const, kind: 'credit' as const, nickname: 'Primary card' };
const rules = { statementDay: 20, dueDay: 10, dueMonthOffset: 1 as const, remindDays: 3 };

function fixture() {
  const store = new MemoryStore();
  let now = new Date('2026-09-30T04:00:00.000Z');
  let request = 0;
  const service = createService(store, { now: () => now, demo: true });
  return {
    store,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `billing-${++request}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
    query: <K extends keyof Queries>(action: K, payload: Queries[K]['input'], actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<Queries[K]['output']>,
  };
}

function code(expected: string) { return (error: unknown) => error instanceof DomainError && error.code === expected; }

async function createSeptemberCard(f: ReturnType<typeof fixture>, actor = owner) {
  const saved = await f.command('card.save', { ...cardFields, billing: { ...rules, dueOn: '2026-10-10', periodKey: '2026-09' } }, actor);
  const wallet = await f.query('wallet.get', {}, actor);
  const card = wallet.cards.find(row => row.id === saved.id)!;
  const bill = wallet.bills.find(row => row.billingAccountId === card.billingAccountId && row.periodKey === '2026-09')!;
  return { card, bill };
}

test('a September form saving only metadata or future rules in October preserves every existing bill snapshot', async () => {
  const f = fixture();
  const { card, bill } = await createSeptemberCard(f);
  await f.command('bill.update', { id: bill.id, paid: true });
  f.setDate('2026-10-01');
  const before = (await f.query('wallet.get', {})).bills;
  assert.equal(before.find(row => row.periodKey === '2026-10')?.dueOn, '2026-11-10');
  await f.command('card.save', { ...cardFields, id: card.id, nickname: 'Renamed card', billing: { ...rules, periodKey: '2026-09' } });
  assert.deepEqual((await f.query('wallet.get', {})).bills, before);
  assert.equal((await f.store.get<Card>('cards', card.id))?.nickname, 'Renamed card');
  await f.command('card.save', { ...cardFields, id: card.id, billing: { ...rules, statementDay: 22, dueDay: 12, remindDays: 5 } });
  assert.deepEqual((await f.query('wallet.get', {})).bills, before);
  f.setDate('2026-11-01');
  const future = (await f.query('wallet.get', {})).bills.find(row => row.periodKey === '2026-11')!;
  assert.equal(future.statementOn, '2026-11-22');
  assert.equal(future.dueOn, '2026-12-12');
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', card.billingAccountId!))?.remindDays, 5);
});

test('an explicitly selected historical bill keeps its original period, statement date, and paid state across a correction', async () => {
  const f = fixture();
  const { card, bill } = await createSeptemberCard(f);
  await f.command('bill.update', { id: bill.id, paid: true });
  f.setDate('2026-10-01');
  const before = (await f.query('wallet.get', {})).bills;
  const original = before.find(row => row.id === bill.id)!;
  const october = before.find(row => row.periodKey === '2026-10')!;
  await f.command('card.save', {
    ...cardFields, id: card.id, billing: { ...rules, statementDay: 29, dueOn: '2026-09-25', billId: bill.id, periodKey: '2026-09' },
  });
  assert.deepEqual(await f.store.get<Bill>('bills', bill.id), { ...original, dueOn: '2026-09-25' });
  assert.deepEqual(await f.store.get<Bill>('bills', october.id), october);
  const account = (await f.store.get<BillingAccount>('billing_accounts', card.billingAccountId!))!;
  assert.equal(account.statementDay, 29);
  const beforeInvalid = await f.store.exportSeed();
  await assert.rejects(f.command('card.save', {
    ...cardFields, id: card.id, billing: { ...rules, dueOn: '2026-09-19', billId: bill.id, periodKey: '2026-09' },
  }), code('INVALID_DATE'));
  assert.deepEqual(await f.store.exportSeed(), beforeInvalid);
});

test('a stale period without an explicit bill cannot be silently redirected to the new month', async () => {
  const f = fixture();
  const { card } = await createSeptemberCard(f);
  f.setDate('2026-10-01');
  await f.query('wallet.get', {});
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('card.save', {
    ...cardFields, id: card.id, nickname: 'Should roll back', billing: { ...rules, dueOn: '2026-10-10', periodKey: '2026-09' },
  }), code('VERSION_CONFLICT'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('new independent accounts reject stale initial dates atomically while rule-only creation uses current-period rules', async () => {
  const f = fixture();
  f.setDate('2026-10-01');
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('card.save', {
    ...cardFields, billing: { ...rules, dueOn: '2026-10-10', periodKey: '2026-09' },
  }), code('VERSION_CONFLICT'));
  assert.deepEqual(await f.store.exportSeed(), before);
  const created = await f.command('card.save', { ...cardFields, billing: rules });
  const wallet = await f.query('wallet.get', {});
  const card = wallet.cards.find(row => row.id === created.id)!;
  const bill = wallet.bills.find(row => row.billingAccountId === card.billingAccountId)!;
  assert.equal(bill.periodKey, '2026-10');
  assert.equal(bill.statementOn, '2026-10-20');
  assert.equal(bill.dueOn, '2026-11-10');
});

test('shared-to-independent conversion rejects a stale period or a target belonging to the original shared account', async () => {
  const f = fixture();
  const { card, bill } = await createSeptemberCard(f);
  const second = await f.command('card.save', { ...cardFields, nickname: 'Shared card', billingAccountId: card.billingAccountId });
  f.setDate('2026-10-01');
  await f.query('wallet.get', {});
  const before = await f.store.exportSeed();
  for (const target of [{ periodKey: '2026-09' }, { billId: bill.id, periodKey: '2026-09' }]) {
    await assert.rejects(f.command('card.save', {
      ...cardFields, id: second.id, billing: { ...rules, statementDay: 25, dueDay: 15, dueOn: '2026-10-15', ...target },
    }), code('VERSION_CONFLICT'));
    assert.deepEqual(await f.store.exportSeed(), before);
  }
  await f.command('card.save', {
    ...cardFields, id: second.id, billing: { ...rules, statementDay: 25, dueDay: 15, dueOn: '2026-11-15', periodKey: '2026-10' },
  });
  const wallet = await f.query('wallet.get', {});
  const independent = wallet.cards.find(row => row.id === second.id)!;
  assert.notEqual(independent.billingAccountId, card.billingAccountId);
  assert.equal(wallet.cards.find(row => row.id === card.id)?.billingAccountId, card.billingAccountId);
  const originalBills = Object.values(before.bills || {}) as Bill[];
  for (const original of originalBills) assert.deepEqual(await f.store.get<Bill>('bills', original.id), original);
  const newBill = wallet.bills.find(row => row.billingAccountId === independent.billingAccountId)!;
  assert.equal(newBill.periodKey, '2026-10');
  assert.equal(newBill.statementOn, '2026-10-25');
  assert.equal(newBill.dueOn, '2026-11-15');
});

test('explicit targets cannot cross card accounts or owners and reject period mismatches without partial updates', async () => {
  const f = fixture();
  const first = await createSeptemberCard(f);
  const sameOwner = await createSeptemberCard(f);
  const foreign = await createSeptemberCard(f, other);
  const before = await f.store.exportSeed();
  const cases = [
    { billId: sameOwner.bill.id, periodKey: '2026-09', expected: 'VERSION_CONFLICT' },
    { billId: foreign.bill.id, periodKey: '2026-09', expected: 'NOT_FOUND' },
    { billId: first.bill.id, periodKey: '2026-10', expected: 'VERSION_CONFLICT' },
    { billId: first.bill.id, periodKey: '2026-13', expected: 'INVALID_DATE' },
  ];
  for (const item of cases) {
    await assert.rejects(f.command('card.save', {
      ...cardFields, id: first.card.id, nickname: 'Should not persist',
      billing: { ...rules, remindDays: 8, dueOn: '2026-10-12', billId: item.billId, periodKey: item.periodKey },
    }), code(item.expected));
    assert.deepEqual(await f.store.exportSeed(), before);
  }
});

test('an explicit bill ID requires both a date and its period instead of silently becoming a rules-only edit', async () => {
  const f = fixture();
  const { card, bill } = await createSeptemberCard(f);
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('card.save', { ...cardFields, id: card.id, billing: { ...rules, billId: bill.id, periodKey: '2026-09' } }), code('INVALID_INPUT'));
  await assert.rejects(f.command('card.save', { ...cardFields, id: card.id, billing: { ...rules, billId: bill.id, dueOn: '2026-10-12' } }), code('INVALID_INPUT'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('a successful September creation retry still replays its original result after October starts', async () => {
  const f = fixture();
  const payload: Commands['card.save'] = { ...cardFields, billing: { ...rules, dueOn: '2026-10-10', periodKey: '2026-09' } };
  const created = await f.command('card.save', payload, owner, 'lost-september-response');
  f.setDate('2026-10-01');
  await f.query('wallet.get', {});
  const before = await f.store.exportSeed();
  const replay = await f.command('card.save', payload, owner, 'lost-september-response');
  assert.deepEqual(replay, created);
  assert.deepEqual(await f.store.exportSeed(), before);
  await assert.rejects(f.command('card.save', payload, owner, 'new-october-attempt'), code('VERSION_CONFLICT'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('legacy current-period corrections remain compatible and preserve existing bill metadata', async () => {
  const f = fixture();
  const { card, bill } = await createSeptemberCard(f);
  await f.command('card.save', { ...cardFields, id: card.id, billing: { ...rules, dueOn: '2026-10-12' } });
  assert.deepEqual(await f.store.get<Bill>('bills', bill.id), { ...bill, dueOn: '2026-10-12' });
});

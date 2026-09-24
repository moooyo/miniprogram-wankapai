import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { readReminderConfiguration } from '../cloudfunctions/reminders/configuration';
import { createReminderWorker, type ReminderGrant, type SubscriptionMessage } from '../cloudfunctions/reminders/worker';
import type { Actor, ApiRequest, Bill, BillingAccount, Commands, MutationResult, Wallet } from '../shared/contracts';

const actor: Actor = { userId: 'repayment-owner', isModerator: false };
const other: Actor = { userId: 'other-owner', isModerator: false };
const templateId = 'repayment-eligibility-template';
const now = () => new Date('2026-09-28T01:00:00Z');
const cardDetails = { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa' as const, kind: 'credit' as const };
const billing = { statementDay: 6, dueDay: 30, dueMonthOffset: 0 as const, remindDays: 3 };
const configuration = readReminderConfiguration({
  REMINDERS_ENABLED: 'true',
  REMINDER_TEMPLATES_JSON: JSON.stringify({ repayment: { templateId, fields: { thing1: 'title', date2: 'dueOn' } } }),
});

async function fixture() {
  const store = new MemoryStore();
  const service = createService(store, { now, templateIds: { repayment: templateId } });
  let sequence = 0;
  const command = <K extends keyof Commands>(action: K, payload: Commands[K], requestId = `command-${++sequence}`, owner = actor) =>
    service.execute(owner, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>;
  const wallet = (owner = actor) => service.execute(owner, { action: 'wallet.get', payload: {} }) as Promise<Wallet>;
  await command('preferences.save', { newActivities: false, deadlines: false, rewards: false, repayments: true });
  const saved = await command('card.save', { ...cardDetails, nickname: 'Primary card', billing });
  const initial = await wallet();
  const card = initial.cards.find(row => row.id === saved.id);
  assert.ok(card?.billingAccountId);
  const account = initial.accounts.find(row => row.id === card.billingAccountId);
  assert.ok(account?.enabled);
  const bill = initial.bills.find(row => row.billingAccountId === account.id && row.periodKey === '2026-09');
  assert.ok(bill);
  assert.equal(bill.dueOn, '2026-09-30');
  const payload: Commands['reminder.authorize'] = { kind: 'repayment', entityId: bill.id, templateId, accepted: true };
  const messages: SubscriptionMessage[] = [];
  const worker = createReminderWorker({
    store, configuration, now,
    send: async message => { messages.push(message); return { errCode: 0 }; },
  });
  return { store, command, wallet, card, account, bill, payload, worker, messages };
}

async function authorizationState(store: MemoryStore) {
  return { grants: await store.find<ReminderGrant>('reminder_grants'), requests: await store.find('requests') };
}

function code(expected: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected;
}

test('an active unpaid bill accepts one grant and the worker sends only once', async () => {
  const f = await fixture();
  const result = await f.command('reminder.authorize', f.payload, 'active-consent');
  const granted = await f.store.get<ReminderGrant>('reminder_grants', result.id);
  assert.ok(granted);
  assert.equal(granted.ownerId, actor.userId);
  assert.equal(granted.entityId, f.bill.id);
  assert.equal(granted.kind, 'repayment');
  assert.equal(granted.templateId, templateId);
  assert.equal(granted.remaining, 1);
  assert.equal((await f.worker()).sent, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].touser, actor.userId);
  assert.equal(f.messages[0].templateId, templateId);
  assert.equal(f.messages[0].page, 'pages/wallet/index');
  assert.equal(f.messages[0].data.date2.value, f.bill.dueOn);
  assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 0);
  const consumed = await authorizationState(f.store);
  assert.deepEqual(await f.command('reminder.authorize', f.payload, 'active-consent'), result);
  assert.deepEqual(await authorizationState(f.store), consumed);
  assert.equal((await f.worker()).sent, 0);
  assert.equal(f.messages.length, 1);
});

test('removing the last card blocks new consent while historical bills remain editable', async () => {
  const f = await fixture();
  await f.command('card.remove', { id: f.card.id });
  const archived = await f.wallet();
  assert.equal(archived.accounts.find(row => row.id === f.account.id)?.enabled, false);
  assert.ok(archived.cards.find(row => row.id === f.card.id)?.archivedAt);
  assert.deepEqual(archived.bills.find(row => row.id === f.bill.id), f.bill);
  const before = await authorizationState(f.store);
  for (const accepted of [true, false]) {
    await assert.rejects(f.command('reminder.authorize', { ...f.payload, accepted }, `archived-consent-${accepted}`), code('REMINDER_UNAVAILABLE'));
    assert.deepEqual(await authorizationState(f.store), before);
  }
  await f.command('bill.update', { id: f.bill.id, paid: true });
  assert.ok((await f.wallet()).bills.find(row => row.id === f.bill.id)?.paidAt);
  await f.command('bill.update', { id: f.bill.id, paid: false });
  assert.equal((await f.wallet()).bills.find(row => row.id === f.bill.id)?.paidAt, null);
  await f.command('bill.update', { id: f.bill.id, dueOn: '2026-09-29' });
  const updated = (await f.wallet()).bills.find(row => row.id === f.bill.id);
  assert.ok(updated);
  assert.equal(updated.dueOn, '2026-09-29');
  assert.equal(updated.billingAccountId, f.account.id);
  assert.equal(updated.periodKey, f.bill.periodKey);
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', f.account.id))?.enabled, false);
  assert.equal((await f.worker()).sent, 0);
  assert.equal(f.messages.length, 0);
});

test('a paid bill rejects new consent without writing a grant or request receipt', async () => {
  const f = await fixture();
  await f.command('bill.update', { id: f.bill.id, paid: true });
  assert.equal((await f.store.get<BillingAccount>('billing_accounts', f.account.id))?.enabled, true);
  const before = await authorizationState(f.store);
  await assert.rejects(f.command('reminder.authorize', f.payload, 'paid-consent'), code('REMINDER_UNAVAILABLE'));
  assert.deepEqual(await authorizationState(f.store), before);
  assert.equal((await f.worker()).sent, 0);
  assert.equal(f.messages.length, 0);
});

test('a bill whose account is missing cannot receive a reminder grant', async () => {
  const f = await fixture();
  // Simulate a dangling historical reference after creating a valid account and bill.
  await f.store.remove('billing_accounts', f.account.id);
  const before = await authorizationState(f.store);
  await assert.rejects(f.command('reminder.authorize', f.payload, 'missing-account-consent'), code('NOT_FOUND'));
  assert.deepEqual(await authorizationState(f.store), before);
});

test('bill and account ownership are both required for repayment consent', async () => {
  const f = await fixture();
  const foreignCard = await f.command('card.save', { ...cardDetails, nickname: 'Other owner card', billing }, 'other-card', other);
  const foreignWallet = await f.wallet(other);
  const foreignAccountId = foreignWallet.cards.find(row => row.id === foreignCard.id)?.billingAccountId;
  assert.ok(foreignAccountId);
  const foreignBill = foreignWallet.bills.find(row => row.billingAccountId === foreignAccountId);
  assert.ok(foreignBill);
  const before = await authorizationState(f.store);
  await assert.rejects(f.command('reminder.authorize', { ...f.payload, entityId: foreignBill.id }, 'foreign-bill-consent'), code('NOT_FOUND'));
  assert.deepEqual(await authorizationState(f.store), before);
  // An owned bill must not make a foreign account accessible through its reference.
  await f.store.set<Bill>('bills', f.bill.id, { ...f.bill, billingAccountId: foreignAccountId });
  await assert.rejects(f.command('reminder.authorize', f.payload, 'foreign-account-consent'), code('NOT_FOUND'));
  assert.deepEqual(await authorizationState(f.store), before);
});

test('a committed consent replays after account removal without replenishing its grant', async () => {
  const f = await fixture();
  const result = await f.command('reminder.authorize', f.payload, 'committed-consent');
  await f.command('card.remove', { id: f.card.id });
  const before = await authorizationState(f.store);
  assert.deepEqual(await f.command('reminder.authorize', f.payload, 'committed-consent'), result);
  assert.deepEqual(await authorizationState(f.store), before);
  await assert.rejects(f.command('reminder.authorize', f.payload, 'new-archived-consent'), code('REMINDER_UNAVAILABLE'));
  assert.deepEqual(await authorizationState(f.store), before);
  assert.equal((await f.worker()).sent, 0);
  assert.equal(f.messages.length, 0);
  assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
});

test('a committed consent replays after payment while a new consent is rejected', async () => {
  const f = await fixture();
  const result = await f.command('reminder.authorize', f.payload, 'before-payment-consent');
  await f.command('bill.update', { id: f.bill.id, paid: true });
  const before = await authorizationState(f.store);
  assert.deepEqual(await f.command('reminder.authorize', f.payload, 'before-payment-consent'), result);
  assert.deepEqual(await authorizationState(f.store), before);
  await assert.rejects(f.command('reminder.authorize', f.payload, 'after-payment-consent'), code('REMINDER_UNAVAILABLE'));
  assert.deepEqual(await authorizationState(f.store), before);
  assert.equal((await f.worker()).sent, 0);
  assert.equal(f.messages.length, 0);
  assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
});

test('removing one shared card keeps the remaining card account eligible for reminders', async () => {
  const f = await fixture();
  const second = await f.command('card.save', { ...cardDetails, nickname: 'Shared card', billingAccountId: f.account.id });
  await f.command('card.remove', { id: f.card.id });
  const wallet = await f.wallet();
  assert.equal(wallet.accounts.find(row => row.id === f.account.id)?.enabled, true);
  assert.equal(wallet.cards.find(row => row.id === second.id)?.billingAccountId, f.account.id);
  assert.equal(wallet.cards.find(row => row.id === second.id)?.archivedAt, undefined);
  assert.equal(wallet.bills.length, 1);
  assert.equal(wallet.bills[0].id, f.bill.id);
  const result = await f.command('reminder.authorize', f.payload, 'shared-account-consent');
  assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
  assert.equal((await f.worker()).sent, 1);
  assert.equal(f.messages.length, 1);
});

test('linking a new card to an archived account allows a new consent for its unpaid bill', async () => {
  const f = await fixture();
  await f.command('card.remove', { id: f.card.id });
  await assert.rejects(f.command('reminder.authorize', f.payload, 'disabled-account-consent'), code('REMINDER_UNAVAILABLE'));
  const replacement = await f.command('card.save', { ...cardDetails, nickname: 'Replacement card', billingAccountId: f.account.id });
  const wallet = await f.wallet();
  assert.equal(wallet.accounts.find(row => row.id === f.account.id)?.enabled, true);
  assert.equal(wallet.cards.find(row => row.id === replacement.id)?.billingAccountId, f.account.id);
  assert.equal(wallet.bills.length, 1);
  assert.equal(wallet.bills[0].id, f.bill.id);
  const result = await f.command('reminder.authorize', f.payload, 'reenabled-account-consent');
  assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
  assert.equal((await f.worker()).sent, 1);
  assert.equal(f.messages.length, 1);
});

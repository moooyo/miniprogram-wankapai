import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';
import { banks, issuers } from '../shared/catalog';
import { cardLabel, cardNeedsNickname } from '../miniprogram/services/card-labels';
import type { ApiRequest, Bill, BillingAccount, Card, Commands, MutationResult, Wallet } from '../shared/contracts';

const bill = (id: string, paidAt: string | null = null): Bill => ({
  id, ownerId: 'owner', billingAccountId: 'account', periodKey: '2026-09',
  statementOn: '2026-09-06', dueOn: '2026-09-23', paidAt,
});

function harness(options: { demo?: boolean; preference?: boolean | null; request?: () => Promise<boolean>; wallet?: Wallet } = {}) {
  const raw: Wallet = options.wallet || {
    cards: [{ id: 'card', ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Daily card', billingAccountId: 'account', createdAt: '2026-09-01' }],
    accounts: [{ id: 'account', ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', label: 'Active account', statementDay: 6, dueDay: 23, dueMonthOffset: 0, remindDays: 3, enabled: true }],
    bills: [bill('unpaid'), bill('paid', '2026-09-20')],
  };
  const reminders: Array<{ kind: string; id: string }> = [];
  const commands: Array<{ action: string; payload: unknown }> = [];
  const modals: Array<{ title: string; content: string }> = [];
  const errors: unknown[] = [];
  const toasts: string[] = [];
  const navigations: string[] = [];
  let page: any;
  const source = ts.transpileModule(readFileSync(path.join(process.cwd(), 'miniprogram/pages/wallet/index.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports: {},
    Page(controller: any) {
      page = { ...controller, data: structuredClone(controller.data), setData(update: Record<string, unknown>) { Object.assign(this.data, update); } };
    },
    require(name: string) {
      if (name.endsWith('/catalog')) return { banks, issuers };
      if (name.endsWith('/card-labels')) return { cardLabel, cardNeedsNickname };
      if (name.endsWith('/format')) return { today: () => '2026-09-20', periodLabel: (value: string) => value, showError: (error: unknown) => errors.push(error) };
      if (name.endsWith('/api')) return {
        ensureSession: async () => ({ userId: 'owner', isModerator: false, demo: options.demo ?? false, today: '2026-09-20', month: '2026-09' }),
        api: {
          query: async (action: string) => {
            if (action === 'wallet.get') return structuredClone(raw);
            if (action === 'preferences.get') {
              if (options.preference === null) throw new Error('Preferences unavailable');
              return { repayments: options.preference ?? true };
            }
            throw new Error(`Unexpected query: ${action}`);
          },
          command: async (action: string, payload: unknown) => { commands.push({ action, payload }); return { id: 'mutation' }; },
        },
        requestReminder: async (kind: string, id: string) => { reminders.push({ kind, id }); return options.request ? options.request() : true; },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    wx: {
      showToast: ({ title }: { title: string }) => toasts.push(title),
      showModal: async (value: { title: string; content: string }) => { modals.push(value); return { confirm: true }; },
      navigateTo: ({ url }: { url: string }) => navigations.push(url),
    },
  });
  return { page, raw, reminders, commands, modals, errors, navigations, toasts };
}

const tap = (id: string) => ({ currentTarget: { dataset: { id } } });

test('wallet requests repayment authorization for the exact unpaid bill and waits for acceptance', async () => {
  let finish!: (accepted: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const h = harness({ request: () => pending });
  await h.page.load();
  const request = h.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(h.reminders, [{ kind: 'repayment', id: 'unpaid' }]);
  assert.equal(h.page.data.reminderNotice, '');
  assert.equal(h.page.data.reminderBusyId, 'unpaid');
  finish(true);
  await request;
  assert.equal(h.page.data.reminderNoticeId, 'unpaid');
  assert.ok(h.page.data.reminderNotice.length > 0);
  assert.equal(h.page.data.reminderBusyId, '');
  assert.deepEqual(h.commands, []);
});

test('wallet blocks duplicate authorization and bill mutations while authorization is pending', async () => {
  let finish!: (accepted: boolean) => void;
  const h = harness({ request: () => new Promise(resolve => { finish = resolve; }) });
  await h.page.load();
  const request = h.page.requestBillReminder(tap('unpaid'));
  await h.page.requestBillReminder(tap('unpaid'));
  await h.page.togglePaid(tap('unpaid'));
  await h.page.changeDueDate({ ...tap('unpaid'), detail: { value: '2026-09-25' } });
  assert.equal(h.reminders.length, 1);
  assert.equal(h.commands.length, 0);
  finish(false);
  await request;
  assert.equal(h.page.data.reminderNotice, '');
  assert.equal(h.page.data.reminderBusyId, '');
});

test('wallet never requests a reminder for paid, missing, or concurrently updated bills', async () => {
  const h = harness();
  await h.page.load();
  await h.page.requestBillReminder(tap('paid'));
  await h.page.requestBillReminder(tap('missing'));
  h.page.data.busyId = 'unpaid';
  await h.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(h.reminders, []);
});

test('disabled or unavailable repayment preferences do not create authorization success', async () => {
  const disabled = harness({ preference: false });
  await disabled.page.load();
  await disabled.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(disabled.reminders, []);
  assert.equal(disabled.modals.length, 1);
  assert.deepEqual(disabled.navigations, ['/pages/preferences/index']);
  assert.equal(disabled.page.data.reminderNotice, '');
  const unavailable = harness({ preference: null });
  await unavailable.page.load();
  assert.equal(unavailable.page.data.failed, false);
  await unavailable.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(unavailable.reminders, []);
  assert.equal(unavailable.page.data.reminderBusyId, '');
});

test('rejected and failed requests never display an accepted reminder notice', async () => {
  const rejected = harness({ request: async () => false });
  await rejected.page.load();
  await rejected.page.requestBillReminder(tap('unpaid'));
  assert.equal(rejected.page.data.reminderNoticeId, '');
  assert.equal(rejected.page.data.reminderNotice, '');
  const failure = new Error('Subscription failed');
  const failed = harness({ request: async () => { throw failure; } });
  await failed.page.load();
  await failed.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(failed.errors, [failure]);
  assert.equal(failed.page.data.reminderBusyId, '');
  assert.equal(failed.page.data.reminderNotice, '');
});

test('demo repayment reminder uses only the explanatory path and never native subscription authorization', async () => {
  const runtime = globalThis as unknown as { wx?: unknown };
  const previous = runtime.wx;
  let explanations = 0;
  runtime.wx = {
    showModal() { explanations += 1; },
    requestSubscribeMessage() { assert.fail('Demo must not request WeChat authorization'); },
    cloud: { callFunction() { assert.fail('Demo must not call cloud functions'); } },
  };
  try {
    const { requestReminder } = await import('../miniprogram/services/api');
    const h = harness({ demo: true, preference: false, request: () => requestReminder('repayment', 'unpaid') });
    await h.page.load();
    await h.page.requestBillReminder(tap('unpaid'));
    assert.equal(explanations, 1);
    assert.deepEqual(h.reminders, [{ kind: 'repayment', id: 'unpaid' }]);
    assert.equal(h.page.data.reminderNotice, '');
    assert.deepEqual(h.commands, []);
  } finally { runtime.wx = previous; }
});

test('collapsed archived accounts retain unpaid bills and expand historical settings without losing records', async () => {
  const account = { id: 'account', ownerId: 'owner', bankId: banks[0].id, issuerId: issuers[0].id, label: 'Archived account', statementDay: 6, dueDay: 23, dueMonthOffset: 0 as const, remindDays: 3, enabled: false };
  const raw: Wallet = { cards: [], accounts: [account], bills: [bill('unpaid'), bill('paid', '2026-09-20')] };
  const h = harness({ wallet: raw });
  await h.page.load();
  const group = h.page.data.groups[0];
  assert.equal(group.archived, true);
  assert.equal(group.reminderAvailable, false);
  assert.equal(group.settledArchive, false);
  assert.equal(group.expanded, false);
  assert.equal(group.primaryBill.id, 'unpaid');
  assert.equal(group.otherBills[0].id, 'paid');
  h.page.toggleGroup(tap('account'));
  await h.page.load();
  assert.equal(h.page.data.groups[0].expanded, true);
  assert.equal(h.page.data.raw.bills.length, 2);
  await h.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(h.reminders, []);
  assert.equal(h.page.data.reminderNotice, '');
  assert.ok(h.toasts.some(message => message.includes('账户已停用')));
  await h.page.togglePaid(tap('unpaid'));
  await h.page.changeDueDate({ ...tap('unpaid'), detail: { value: '2026-09-25' } });
  assert.deepEqual(h.commands.map(command => command.action), ['bill.update', 'bill.update']);
  assert.equal((h.commands[0].payload as { paid: boolean }).paid, true);
  assert.equal((h.commands[1].payload as { dueOn: string }).dueOn, '2026-09-25');
});

test('independent accounts keep their names and exact bill action targets after both cards are removed', async () => {
  const service = createService(new MemoryStore(), { now: () => new Date('2026-09-20T00:00:00Z') });
  const actor = { userId: 'owner', isModerator: false };
  let sequence = 0;
  const command = <K extends keyof Commands>(action: K, payload: Commands[K]) =>
    service.execute(actor, { action, payload, requestId: `archive-identity-${++sequence}` } as ApiRequest) as Promise<MutationResult>;
  const first = await command('card.save', { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Review Card A', billing: { statementDay: 6, dueDay: 23, dueMonthOffset: 0, remindDays: 3 } });
  const second = await command('card.save', { bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Review Card B', billing: { statementDay: 6, dueDay: 23, dueMonthOffset: 0, remindDays: 3 } });
  await command('card.remove', { id: first.id });
  await command('card.remove', { id: second.id });
  const raw = await service.execute(actor, { action: 'wallet.get', payload: {} }) as Wallet;
  const h = harness({ wallet: raw });
  await h.page.load();
  assert.equal(h.page.data.cardCount, 0);
  assert.equal(h.page.data.groups.length, 2);
  const expected: Array<{ action: string; payload: unknown }> = [];
  for (const [cardId, name] of [[first.id, 'Review Card A'], [second.id, 'Review Card B']]) {
    const card = raw.cards.find(item => item.id === cardId)!;
    const group = h.page.data.groups.find((item: { id: string }) => item.id === card.billingAccountId);
    const originalBill = raw.bills.find(item => item.billingAccountId === card.billingAccountId)!;
    assert.ok(card.archivedAt);
    assert.equal(group.identity, name);
    assert.equal(group.archived, true);
    assert.equal(group.expanded, false);
    assert.equal(group.reminderAvailable, false);
    assert.equal(group.primaryBill.id, originalBill.id);
    h.page.toggleGroup(tap(group.id));
    await h.page.togglePaid(tap(group.primaryBill.id));
    await h.page.changeDueDate({ ...tap(group.primaryBill.id), detail: { value: '2026-09-25' } });
    await h.page.requestBillReminder(tap(group.primaryBill.id));
    expected.push({ action: 'bill.update', payload: { id: originalBill.id, paid: true } }, { action: 'bill.update', payload: { id: originalBill.id, dueOn: '2026-09-25' } });
  }
  assert.deepEqual(structuredClone(h.commands), expected);
  assert.deepEqual(h.reminders, []);
  const template = readFileSync('miniprogram/pages/wallet/index.wxml', 'utf8');
  const header = template.slice(template.indexOf('class="account-head"'), template.indexOf('class="schedule bill-main"'));
  assert.ok(header.includes('{{group.identity}}'));
  assert.ok(!header.includes('wx:if="{{group.expanded}}"'));
});

test('archived account names use owned card identities to disambiguate duplicate labels without splitting shared bills', async () => {
  const account = (id: string): BillingAccount => ({ id, ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', label: 'Daily bill', statementDay: 6, dueDay: 23, dueMonthOffset: 0, remindDays: 3, enabled: false });
  const card = (id: string, accountId: string, createdAt: string): Card => ({ id, ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Daily card', billingAccountId: accountId, createdAt, archivedAt: '2026-09-19' });
  const raw: Wallet = {
    cards: [card('removed-card-a', 'account-a', '2026-01-01'), card('removed-card-b', 'account-b', '2026-02-01'), { ...card('removed-card-shared', 'account-a', '2026-03-01'), nickname: 'Shared card' }, { ...card('foreign-card', 'account-a', '2025-01-01'), ownerId: 'other-owner', nickname: 'Private foreign name' }],
    accounts: [account('account-a'), account('account-b')],
    bills: [{ ...bill('bill-a'), billingAccountId: 'account-a' }, { ...bill('bill-b', '2026-09-19'), billingAccountId: 'account-b' }],
  };
  const h = harness({ wallet: raw });
  await h.page.load();
  const identities = () => Object.fromEntries(h.page.data.groups.map((group: { id: string; identity: string }) => [group.id, group.identity]));
  const before = identities();
  assert.equal(h.page.data.groups.length, 2);
  assert.notEqual(before['account-a'], before['account-b']);
  assert.ok(before['account-a'].includes('Shared card'));
  assert.ok(before['account-a'].includes('同名卡1'));
  assert.ok(before['account-b'].includes('同名卡2'));
  assert.ok(Object.values(before).every(value => !String(value).includes('Private foreign name') && !String(value).includes('系统标识')));
  h.raw.cards.reverse(); h.raw.accounts.reverse(); h.raw.bills.reverse();
  h.raw.bills.find(item => item.id === 'bill-a')!.paidAt = '2026-09-20';
  h.raw.bills.find(item => item.id === 'bill-b')!.dueOn = '2026-09-25';
  await h.page.load();
  assert.deepEqual(identities(), before);
  assert.ok(h.page.data.groups.every((group: { settledArchive: boolean }) => group.settledArchive));
});

test('archived accounts without card metadata keep stable friendly names across list and bill state changes', async () => {
  const first: BillingAccount = { id: 'account_internal_9f53ebc761164df58a3990551249dbbe', ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', label: 'Legacy bill', statementDay: 6, dueDay: 23, dueMonthOffset: 0, remindDays: 3, enabled: false };
  const second = { ...first, id: 'account_internal_b6bf072b415b4f979951a2d9621c8b9d' };
  const raw: Wallet = { cards: [], accounts: [first, second], bills: [{ ...bill('legacy-a'), billingAccountId: first.id }, { ...bill('legacy-b'), billingAccountId: second.id }] };
  const h = harness({ wallet: raw });
  await h.page.load();
  const identities = () => Object.fromEntries(h.page.data.groups.map((group: { id: string; identity: string }) => [group.id, group.identity]));
  const before = identities();
  assert.notEqual(before[first.id], before[second.id]);
  for (const identity of Object.values(before)) {
    assert.match(String(identity), /Legacy bill · 同名账单[12]$/);
    assert.ok(!String(identity).includes('account_internal_'));
  }
  h.raw.accounts.reverse(); h.raw.bills.reverse();
  h.raw.bills[0].paidAt = '2026-09-20';
  h.raw.bills[1].dueOn = '2026-09-28';
  await h.page.load();
  assert.deepEqual(identities(), before);
});

for (const change of ['disabled', 'missing-account', 'paid', 'missing-bill'] as const) {
  test(`wallet clears an accepted reminder notice after refresh makes its bill ${change}`, async () => {
    const h = harness();
    await h.page.load();
    await h.page.requestBillReminder(tap('unpaid'));
    assert.equal(h.page.data.reminderNoticeId, 'unpaid');
    if (change === 'disabled') h.raw.accounts[0].enabled = false;
    if (change === 'missing-account') h.raw.accounts = [];
    if (change === 'paid') h.raw.bills[0].paidAt = '2026-09-20';
    if (change === 'missing-bill') h.raw.bills = h.raw.bills.filter(item => item.id !== 'unpaid');
    await h.page.load();
    assert.equal(h.page.data.reminderNoticeId, '');
    assert.equal(h.page.data.reminderNotice, '');
    await h.page.requestBillReminder(tap('unpaid'));
    assert.equal(h.reminders.length, 1);
  });
}

for (const change of ['disabled', 'paid', 'missing-bill', 'different-account'] as const) {
  test(`a delayed authorization cannot restore a success notice after refresh changes the bill to ${change}`, async () => {
    let finish!: (accepted: boolean) => void;
    const h = harness({ request: () => new Promise(resolve => { finish = resolve; }) });
    await h.page.load();
    const pending = h.page.requestBillReminder(tap('unpaid'));
    if (change === 'disabled') h.raw.accounts[0].enabled = false;
    if (change === 'paid') h.raw.bills[0].paidAt = '2026-09-20';
    if (change === 'missing-bill') h.raw.bills = h.raw.bills.filter(item => item.id !== 'unpaid');
    if (change === 'different-account') {
      h.raw.accounts.push({ ...h.raw.accounts[0], id: 'another-account' });
      h.raw.bills[0].billingAccountId = 'another-account';
    }
    await h.page.load();
    finish(true);
    await pending;
    assert.equal(h.page.data.reminderNoticeId, '');
    assert.equal(h.page.data.reminderNotice, '');
    assert.equal(h.page.data.reminderBusyId, '');
  });
}

test('refreshing a changed bill account clears the earlier account reminder notice', async () => {
  const h = harness();
  await h.page.load();
  await h.page.requestBillReminder(tap('unpaid'));
  assert.equal(h.page.data.reminderNoticeId, 'unpaid');
  h.raw.accounts.push({ ...h.raw.accounts[0], id: 'another-account' });
  h.raw.bills[0].billingAccountId = 'another-account';
  await h.page.load();
  assert.equal(h.page.data.reminderNoticeId, '');
  assert.equal(h.page.data.reminderNotice, '');
});

test('a server eligibility rejection refreshes stale account information without showing reminder success', async () => {
  const failure = Object.assign(new Error('Account disabled'), { code: 'REMINDER_UNAVAILABLE' });
  const h = harness({ request: async () => { h.raw.accounts[0].enabled = false; throw failure; } });
  await h.page.load();
  await h.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(h.errors, [failure]);
  assert.equal(h.page.data.groups[0].reminderAvailable, false);
  assert.equal(h.page.data.reminderNotice, '');
  assert.equal(h.page.data.reminderBusyId, '');
});

test('wallet card labels keep duplicate nicknames distinguishable and consistent with activity records', async () => {
  const base: Card = { id: 'first', ownerId: 'owner', bankId: banks[0].id, issuerId: issuers[0].id, network: 'visa', kind: 'credit', nickname: 'Daily card', createdAt: '2026-09-01' };
  const cards = [base, { ...base, id: 'second' }];
  const h = harness({ wallet: { cards, accounts: [], bills: [] } });
  await h.page.load();
  const titles = h.page.data.looseCards.map((card: { title: string }) => card.title);
  assert.notEqual(titles[0], titles[1]);
  assert.equal(titles[0], cardLabel('first', cards));
  assert.equal(titles[1], cardLabel('second', cards));
  assert.ok(titles.every((title: string) => !title.includes('标识')));
  assert.deepEqual(Array.from(h.page.data.namingCards, (card: { id: string }) => card.id), ['first', 'second']);
});

test('legacy duplicate cards have direct naming routes while their shared account stays collapsed', async () => {
  const base: Card = { id: 'card-one', ownerId: 'owner', bankId: banks[0].id, issuerId: issuers[0].id, network: 'visa', kind: 'credit', nickname: '', billingAccountId: 'account', createdAt: '2026-09-01' };
  const cards = [base, { ...base, id: 'card-two' }, { ...base, id: 'card-archived', archivedAt: '2026-09-10' }];
  const account = { id: 'account', ownerId: 'owner', bankId: banks[0].id, issuerId: issuers[0].id, label: 'Shared account', statementDay: 6, dueDay: 23, dueMonthOffset: 0 as const, remindDays: 3, enabled: true };
  const h = harness({ wallet: { cards, accounts: [account], bills: [bill('unpaid')] } });
  await h.page.load();
  assert.equal(h.page.data.groups[0].expanded, false);
  assert.equal(h.page.data.looseCards.length, 0);
  assert.deepEqual(Array.from(h.page.data.namingCards, (card: { id: string }) => card.id), ['card-one', 'card-two']);
  assert.ok(h.page.data.namingCards.every((card: { needsNickname: boolean; title: string }) => card.needsNickname && !card.title.includes('标识')));
  for (const card of h.page.data.namingCards) h.page.editCard(tap(card.id));
  assert.deepEqual(h.navigations, ['/pages/card-edit/index?id=card-one', '/pages/card-edit/index?id=card-two']);
  assert.equal(h.page.data.groups[0].expanded, false);
  assert.equal(h.commands.length, 0);
  h.raw.cards[0].nickname = 'Travel card';
  h.raw.cards[1].nickname = 'Daily card';
  await h.page.load();
  assert.equal(h.page.data.namingCards.length, 0);
  assert.equal(h.page.data.groups[0].primaryBill.id, 'unpaid');
  const template = readFileSync(path.join(process.cwd(), 'miniprogram/pages/wallet/index.wxml'), 'utf8');
  const noticeStart = template.indexOf('class="naming-notice"');
  const accountStart = template.indexOf('class="account-group"');
  assert.ok(noticeStart >= 0 && noticeStart < accountStart);
  assert.match(template.slice(noticeStart, accountStart), /wx:for="\{\{namingCards\}\}"/);
  assert.match(template.slice(noticeStart, accountStart), /data-id="\{\{card\.id\}\}" bindtap="editCard"[^>]*>设置昵称<\/button>/);
});

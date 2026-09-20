import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { banks, issuers } from '../shared/catalog';
import { cardLabel, cardNeedsNickname } from '../miniprogram/services/card-labels';
import type { Bill, Card, Wallet } from '../shared/contracts';

const bill = (id: string, paidAt: string | null = null): Bill => ({
  id, ownerId: 'owner', billingAccountId: 'account', periodKey: '2026-09',
  statementOn: '2026-09-06', dueOn: '2026-09-23', paidAt,
});

function harness(options: { demo?: boolean; preference?: boolean | null; request?: () => Promise<boolean>; wallet?: Wallet } = {}) {
  const raw: Wallet = options.wallet || { cards: [], accounts: [], bills: [bill('unpaid'), bill('paid', '2026-09-20')] };
  const reminders: Array<{ kind: string; id: string }> = [];
  const commands: Array<{ action: string; payload: unknown }> = [];
  const modals: Array<{ title: string; content: string }> = [];
  const errors: unknown[] = [];
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
        ensureSession: async () => ({ demo: options.demo ?? false }),
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
      showToast() {},
      showModal: async (value: { title: string; content: string }) => { modals.push(value); return { confirm: true }; },
      navigateTo: ({ url }: { url: string }) => navigations.push(url),
    },
  });
  return { page, raw, reminders, commands, modals, errors, navigations };
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
  assert.equal(group.settledArchive, false);
  assert.equal(group.expanded, false);
  assert.equal(group.primaryBill.id, 'unpaid');
  assert.equal(group.otherBills[0].id, 'paid');
  h.page.toggleGroup(tap('account'));
  await h.page.load();
  assert.equal(h.page.data.groups[0].expanded, true);
  assert.equal(h.page.data.raw.bills.length, 2);
  await h.page.requestBillReminder(tap('unpaid'));
  assert.deepEqual(h.reminders, [{ kind: 'repayment', id: 'unpaid' }]);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Activity, Detail, Session, Wallet } from '../shared/contracts';
import * as catalog from '../shared/catalog';
import * as labels from '../miniprogram/services/card-labels';
import * as benefits from '../miniprogram/services/benefit-copy';
import * as format from '../miniprogram/services/format';
import * as entrance from '../miniprogram/services/entrance';

function detail(endsOn = '2026-09-24', completed = false): Detail {
  const snapshot: Activity = {
    id: 'activity', revision: 1, status: 'published', title: 'Saved activity', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'yearly', startsOn: '2026-01-01', endsOn: '2026-12-31',
    target: 3, unit: 'transactions', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three purchases', sourceUrl: '', sourceNote: '',
    entrance: { kind: 'guide', label: 'Bank app', instructions: 'Open bank benefits', imageIds: [] },
    publishedAt: '2026-01-01', publishedBy: 'moderator', updatedAt: '2026-01-01',
  };
  return { activity: { ...snapshot, revision: 2, endsOn: '2027-12-31' }, assets: [], history: [], audit: [], tracking: null, eligible: true,
    participation: { id: 'participation', ownerId: 'owner', activityId: snapshot.id, activityRevision: 1, scopeKey: 'user', snapshot,
      periodKey: '2026', startsOn: '2026-01-01', endsOn, stage: completed ? 'completed' : 'in_progress', progress: completed ? 3 : 1,
      registeredAt: null, startedAt: '2026-01-01', completedAt: completed ? '2026-09-20' : null,
      expectedOn: completed ? '2026-09-21' : null, receivedOn: null, receivedMinor: null, version: 3,
      createdAt: '2026-01-01', updatedAt: '2026-09-20' } };
}

function wallet(): Wallet {
  return {
    cards: [{ id: 'card', ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Daily card', billingAccountId: 'account', createdAt: '2026-01-01' }],
    accounts: [{ id: 'account', ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', label: 'Billing account', statementDay: 6, dueDay: 24, dueMonthOffset: 0, remindDays: 3, enabled: true }],
    bills: [
      { id: 'expired-bill', ownerId: 'owner', billingAccountId: 'account', periodKey: '2026-08', statementOn: '2026-08-06', dueOn: '2026-09-23', paidAt: null },
      { id: 'today-bill', ownerId: 'owner', billingAccountId: 'account', periodKey: '2026-09', statementOn: '2026-09-06', dueOn: '2026-09-24', paidAt: null },
      { id: 'future-bill', ownerId: 'owner', billingAccountId: 'account', periodKey: '2026-10', statementOn: '2026-10-06', dueOn: '2026-10-24', paidAt: null },
    ],
  };
}

async function harness(route: 'detail' | 'wallet', options: { endsOn?: string; completed?: boolean; serverToday?: string } = {}) {
  const state = {
    session: { userId: 'owner', isModerator: false, demo: false, today: options.serverToday || '2026-09-24', month: '2026-09' } as Session,
    detail: detail(options.endsOn, options.completed), wallet: wallet(), failRead: '',
    preferences: { deadlines: true, rewards: true, repayments: true },
    request: async (_kind: string, _id: string): Promise<boolean> => true,
  };
  let page: any;
  const requests: { kind: string; id: string }[] = [];
  const commands: { action: string; payload: any }[] = [];
  const sessions: boolean[] = [];
  const errors: unknown[] = [];
  const events: string[] = [];
  const source = ts.transpileModule(readFileSync(`miniprogram/pages/${route}/index.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(source, {
    exports: {}, getCurrentPages: () => [page],
    Page(definition: any) { page = { ...definition, data: structuredClone(definition.data), setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } }; },
    require(name: string) {
      if (name.endsWith('/catalog')) return catalog;
      if (name.endsWith('/card-labels')) return labels;
      if (name.endsWith('/benefit-copy')) return benefits;
      if (name.endsWith('/entrance')) return entrance;
      if (name.endsWith('/navigation')) return { navigateBackOr() {} };
      if (name.endsWith('/format')) return { ...format, today: () => '2099-01-01', showError: (error: unknown) => errors.push(error) };
      if (name.endsWith('/api')) return {
        ensureSession: async (force = false) => { sessions.push(force); events.push('session'); return structuredClone(state.session); },
        requestReminder: async (kind: string, id: string) => { events.push('native-consent'); requests.push({ kind, id }); return state.request(kind, id); },
        api: {
          query: async (action: string) => {
            events.push(action);
            if (action === state.failRead) throw new Error('Read unavailable');
            if (action === 'activity.get') return structuredClone(state.detail);
            if (action === 'wallet.get') return structuredClone(state.wallet);
            if (action === 'preferences.get') return structuredClone(state.preferences);
            throw new Error(`Unexpected query: ${action}`);
          },
          command: async (action: string, payload: any) => { commands.push({ action, payload: structuredClone(payload) }); return { id: payload.id || 'participation', version: 4 }; },
        },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    wx: { showToast() {}, showModal: async () => ({ confirm: true }), navigateTo() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} },
  });
  if (route === 'detail') page.onLoad({ activityId: 'activity', participationId: 'participation' });
  await page.load();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.outdated, false);
  return { page, state, requests, commands, sessions, errors, events };
}

const tap = (id: string) => ({ currentTarget: { dataset: { id } } });
const unavailable = () => Object.assign(new Error('This reminder is no longer available'), { code: 'REMINDER_UNAVAILABLE' });

test('an expired saved participation cannot request deadline consent while its annual snapshot and unfinished record remain intact', async () => {
  const h = await harness('detail', { endsOn: '2026-09-23' });
  const record = structuredClone(h.page.data.detail.participation);
  assert.equal(h.page.data.serverToday, '2026-09-24');
  assert.equal(h.page.data.view.deadlineReminderExpired, true);
  assert.equal(h.page.data.view.periodLabel, '2026年度');
  assert.equal(h.page.data.view.activity.revision, 1);
  await h.page.reminder();
  await h.page.authorizeReminder();
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.page.data.detail.participation, record);
  assert.equal(h.page.data.view.canComplete, true);
  assert.equal(h.page.data.view.canReceipt, true);
  assert.equal(h.page.data.busy, false);
});

for (const endsOn of ['2026-09-24', '2026-12-31']) {
  test(`deadline consent remains available on ${endsOn} without using the device clock or narrowing to the worker window`, async () => {
    const h = await harness('detail', { endsOn });
    assert.equal(h.page.data.view.deadlineReminderExpired, false);
    assert.equal(h.page.data.view.isPast, false, 'The deliberately wrong device date must not classify a valid server date as expired.');
    await h.page.reminder();
    assert.equal(h.page.data.reminderReady, true);
    assert.equal(h.requests.length, 0);
    assert.equal(h.sessions.at(-1), true);
    const eventCount = h.events.length;
    const authorizing = h.page.reminder();
    assert.equal(h.events[eventCount], 'native-consent', 'The second tap must preserve the immediate native consent call stack.');
    await authorizing;
    assert.deepEqual(h.requests, [{ kind: 'deadline', id: 'participation' }]);
    assert.deepEqual(h.commands, []);
    assert.equal(h.page.data.busy, false);
  });
}

test('a refreshed server date blocks a deadline that expired after the detail was loaded', async () => {
  const h = await harness('detail', { endsOn: '2026-09-24' });
  h.state.session.today = '2026-09-25';
  await h.page.reminder();
  assert.equal(h.page.data.serverToday, '2026-09-25');
  assert.equal(h.page.data.view.deadlineReminderExpired, true);
  assert.equal(h.page.data.reminderReady, false);
  assert.equal(h.page.data.busy, false);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.commands, []);
});

test('a deadline prepared before an updated known server date cannot use the ready handler after expiry', async () => {
  const h = await harness('detail');
  await h.page.reminder();
  assert.equal(h.page.data.reminderReady, true);
  h.page.setData({ serverToday: '2026-09-25' });
  await h.page.authorizeReminder();
  assert.equal(h.page.data.reminderReady, false);
  assert.deepEqual(h.requests, []);
});

test('a completed cashback record keeps reward consent after both its deadline and expected receipt date', async () => {
  const h = await harness('detail', { endsOn: '2026-09-20', completed: true });
  assert.equal(h.page.data.view.deadlineReminderExpired, true);
  assert.equal(h.page.data.detail.participation.expectedOn, '2026-09-21');
  await h.page.reminder();
  assert.equal(h.page.data.reminderReady, true);
  await h.page.reminder();
  assert.deepEqual(h.requests, [{ kind: 'reward', id: 'participation' }]);
  assert.deepEqual(h.commands, []);
});

test('an unavailable deadline response refreshes the server date and removes the now-expired authorization path', async () => {
  const h = await harness('detail');
  await h.page.reminder();
  h.state.request = async () => { h.state.session.today = '2026-09-25'; throw unavailable(); };
  await h.page.reminder();
  assert.equal(h.sessions.at(-1), true);
  assert.equal(h.page.data.serverToday, '2026-09-25');
  assert.equal(h.page.data.view.deadlineReminderExpired, true);
  assert.equal(h.page.data.reminderReady, false);
  assert.equal(h.page.data.busy, false);
  await h.page.reminder();
  assert.equal(h.requests.length, 1, 'An expired retry must not ask for another native acceptance.');
});

test('an unavailable reminder followed by a failed detail refresh preserves the expected-date draft and old record', async () => {
  const h = await harness('detail', { completed: true });
  await h.page.reminder();
  h.page.openExpected();
  h.page.changeExpected({ detail: { value: '2026-10-02' } });
  const record = h.page.data.detail;
  h.state.request = async () => { h.state.failRead = 'activity.get'; throw unavailable(); };
  await h.page.authorizeReminder();
  assert.equal(h.sessions.at(-1), true);
  assert.equal(h.page.data.detail, record);
  assert.equal(h.page.data.outdated, true);
  assert.equal(h.page.data.showExpected, true);
  assert.equal(h.page.data.expectedDirty, true);
  assert.equal(h.page.data.expectedOn, '2026-10-02');
  assert.equal(h.page.data.busy, false);
  assert.deepEqual(h.commands, []);
});

test('expired bill rows reject native consent while bill payment and date corrections remain available', async () => {
  const h = await harness('wallet');
  const group = h.page.data.groups[0];
  assert.equal(group.primaryBill.id, 'expired-bill');
  assert.equal(group.primaryBill.reminderExpired, true);
  assert.equal(group.otherBills.find((bill: any) => bill.id === 'today-bill').reminderExpired, false);
  assert.equal(group.otherBills.find((bill: any) => bill.id === 'future-bill').reminderExpired, false);
  await h.page.requestBillReminder(tap('expired-bill'));
  assert.deepEqual(h.requests, []);
  await h.page.togglePaid(tap('expired-bill'));
  await h.page.changeDueDate({ ...tap('expired-bill'), detail: { value: '2026-09-26' } });
  assert.deepEqual(h.commands, [
    { action: 'bill.update', payload: { id: 'expired-bill', paid: true } },
    { action: 'bill.update', payload: { id: 'expired-bill', dueOn: '2026-09-26' } },
  ]);
  assert.equal(h.page.data.raw.bills.find((bill: any) => bill.id === 'expired-bill').periodKey, '2026-08');
});

for (const id of ['today-bill', 'future-bill']) {
  test(`${id} keeps immediate exact-bill consent even outside the repayment worker window`, async () => {
    const h = await harness('wallet');
    const eventCount = h.events.length;
    const request = h.page.requestBillReminder(tap(id));
    assert.equal(h.events[eventCount], 'native-consent');
    await request;
    assert.deepEqual(h.requests, [{ kind: 'repayment', id }]);
    assert.equal(h.page.data.reminderNoticeId, id);
    assert.deepEqual(h.commands, []);
  });
}

test('an unavailable bill reminder refresh failure retains old dates and expansion while locking stale actions', async () => {
  const h = await harness('wallet');
  h.page.toggleGroup(tap('account'));
  const raw = h.page.data.raw;
  const groups = h.page.data.groups;
  h.state.request = async () => { h.state.session.today = '2026-09-25'; h.state.failRead = 'wallet.get'; throw unavailable(); };
  await h.page.requestBillReminder(tap('today-bill'));
  assert.equal(h.sessions.at(-1), true);
  assert.equal(h.page.data.raw, raw);
  assert.equal(h.page.data.groups, groups);
  assert.equal(groups[0].expanded, true);
  assert.equal(groups[0].otherBills.find((bill: any) => bill.id === 'today-bill').dueOn, '2026-09-24');
  assert.equal(h.page.data.outdated, true);
  assert.equal(h.page.data.reminderBusyId, '');
  await h.page.requestBillReminder(tap('today-bill'));
  assert.equal(h.requests.length, 1);
  h.state.failRead = '';
  await h.page.load(true);
  assert.equal(h.page.data.groups[0].otherBills.find((bill: any) => bill.id === 'today-bill').reminderExpired, true);
  assert.equal(h.page.data.groups[0].expanded, true);
  assert.equal(h.page.data.outdated, false);
});

test('a bill acceptance cannot describe a different saved due date and expires after the next server-date refresh', async () => {
  const h = await harness('wallet');
  let accept!: (value: boolean) => void;
  h.state.request = () => new Promise(resolve => { accept = resolve; });
  const pending = h.page.requestBillReminder(tap('today-bill'));
  h.page.data.raw.bills.find((bill: any) => bill.id === 'today-bill').dueOn = '2026-09-26';
  accept(true);
  await pending;
  assert.equal(h.page.data.reminderNoticeId, '');
  h.state.request = async () => true;
  await h.page.load();
  await h.page.requestBillReminder(tap('today-bill'));
  assert.equal(h.page.data.reminderNoticeId, 'today-bill');
  h.state.session.today = '2026-09-25';
  await h.page.load(true);
  assert.equal(h.page.data.reminderNoticeId, '');
  assert.equal(h.page.data.reminderNotice, '');
});

test('a disabled repayment preference clears an accepted notice on refresh and suppresses a late acceptance notice', async () => {
  const h = await harness('wallet');
  await h.page.requestBillReminder(tap('today-bill'));
  assert.equal(h.page.data.reminderNoticeId, 'today-bill');
  h.state.preferences.repayments = false;
  await h.page.load();
  assert.equal(h.page.data.reminderNoticeId, '');
  assert.equal(h.page.data.reminderNotice, '');
  h.state.preferences.repayments = true;
  await h.page.load();
  let accept!: (value: boolean) => void;
  h.state.request = () => new Promise(resolve => { accept = resolve; });
  const pending = h.page.requestBillReminder(tap('today-bill'));
  h.page.setData({ repaymentEnabled: false });
  accept(true);
  await pending;
  assert.equal(h.page.data.reminderNoticeId, '');
  assert.equal(h.page.data.reminderNotice, '');
});

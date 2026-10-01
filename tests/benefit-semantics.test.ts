import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Activity, ApiRequest, Commands, Detail, MutationResult, Participation, Reward, RewardsView } from '../shared/contracts';
import { banks, issuers } from '../shared/catalog';
import { MemoryStore } from '../domain/memory-store';
import { createService } from '../domain/service';
import { periodFor } from '../domain/calendar';
import { benefitCopy, BenefitKind } from '../miniprogram/services/benefit-copy';
import * as format from '../miniprogram/services/format';
import * as cardLabels from '../miniprogram/services/card-labels';
import * as entrance from '../miniprogram/services/entrance';
import * as activityDesign from '../miniprogram/services/activity-design';

function activity(id: string, kind: BenefitKind, currency: 'CNY' | 'HKD' = 'CNY'): Activity {
  return {
    id, title: id, revision: 1, status: 'published', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Visa credit card', frequency: 'monthly', startsOn: '2026-01-01', endsOn: '2027-12-31',
    target: 1, unit: '次', currency, rewardMinor: 3000, rewardKind: kind, scope: 'user', requiresRegistration: false,
    requiresInvitation: false, conditions: 'Complete one purchase', sourceUrl: 'https://www.cmbchina.com/', sourceNote: '',
    entrance: { kind: 'web', label: 'Bank offer', url: 'https://www.cmbchina.com/', instructions: 'Open the bank offer', imageIds: [] },
    publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', publishedBy: 'moderator',
  };
}

function fixture() {
  const activities = [activity('cashback', 'cashback'), activity('discount', 'discount'), activity('foreign', 'discount', 'HKD')];
  const store = new MemoryStore({ activities: Object.fromEntries(activities.map(item => [item.id, item])) });
  let now = new Date('2026-09-21T04:00:00Z');
  let request = 0;
  const service = createService(store, { now: () => now, demo: true });
  const actor = { userId: 'benefit-owner', isModerator: false };
  return {
    store,
    setDate(date: string) { now = new Date(`${date}T04:00:00Z`); },
    query<T>(action: string, payload: unknown = {}, userId = actor.userId) { return service.execute({ ...actor, userId }, { action, payload } as ApiRequest) as Promise<T>; },
    command<K extends keyof Commands>(action: K, payload: Commands[K], requestId = `benefit-${++request}`, userId = actor.userId) {
      return service.execute({ ...actor, userId }, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>;
    },
  };
}

function record(kind: BenefitKind, stage: Participation['stage'] = 'completed'): Participation {
  const snapshot = activity(kind, kind);
  return {
    id: `record-${kind}`, ownerId: 'benefit-owner', activityId: snapshot.id, activityRevision: 1, scopeKey: 'user',
    periodKey: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30', snapshot, stage, progress: 1,
    registeredAt: null, startedAt: '2026-09-01', completedAt: '2026-09-20', expectedOn: '2026-09-19',
    receivedOn: stage === 'received' ? '2026-09-20' : null, receivedMinor: stage === 'received' ? 2750 : null,
    version: 3, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
  };
}

function controller(name: string, participation = record('discount')) {
  const detail: Detail = { activity: participation.snapshot, participation, assets: [], history: [], audit: [], tracking: null, eligible: true };
  const requests: Array<{ kind: string; id: string }> = [];
  const commands: Array<{ action: string; payload: any }> = [];
  const toasts: string[] = [];
  const titles: string[] = [];
  const returns: Array<{ activityId: string; participationId: string }> = [];
  let instance: any;
  const source = ts.transpileModule(readFileSync(path.join(process.cwd(), `miniprogram/pages/${name}/index.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(source, {
    exports: {},
    getCurrentPages: () => instance ? [instance] : [],
    Page(definition: any) {
      instance = { ...definition, data: structuredClone(definition.data), setData(patch: Record<string, unknown>, callback?: () => void) {
        for (const [key, value] of Object.entries(patch)) {
          const parts = key.split('.');
          let current = this.data;
          for (const part of parts.slice(0, -1)) current = current[part] ||= {};
          current[parts[parts.length - 1]] = value;
        }
        callback?.();
      } };
    },
    require(module: string) {
      if (module.endsWith('/benefit-copy')) return { benefitCopy };
      if (module.endsWith('/catalog')) return { banks, issuers };
      if (module.endsWith('/calendar')) return { periodFor };
      if (module.endsWith('/card-labels')) return cardLabels;
      if (module.endsWith('/entrance')) return entrance;
      if (module.endsWith('/activity-design')) return activityDesign;
      if (module.endsWith('/navigation')) return {
        navigateBackOr() {},
        backToActivity(activityId: string, participationId: string) { returns.push({ activityId, participationId }); },
      };
      if (module.endsWith('/format')) return { ...format, today: () => '2026-09-21', showError(error: unknown) { throw error; } };
      if (module.endsWith('/form-draft')) return { loadDraft: () => null, getDraftRevision: () => null, removeDraft() {}, saveDraft: () => true, createCommandIntent: () => 'benefit-form-intent', confirmDraftRecovery: async () => false };
      if (module.endsWith('/api')) return {
        ensureSession: async () => ({ userId: 'benefit-owner', today: '2026-09-21', month: '2026-09', demo: true }),
        requestReminder: async (kind: string, id: string) => { requests.push({ kind, id }); return false; },
        api: {
          query: async (action: string) => {
            if (action === 'activity.get') return structuredClone(detail);
            if (action === 'wallet.get') return { cards: [], accounts: [], bills: [] };
            if (action === 'history.list') return { items: [structuredClone(participation)], nextCursor: null };
            throw new Error(`Unexpected query: ${action}`);
          },
          command: async (action: string, payload: unknown) => { commands.push({ action, payload }); return { id: participation.id, version: 4 }; },
        },
      };
      throw new Error(`Unexpected module: ${module}`);
    },
    wx: {
      setNavigationBarTitle: ({ title }: { title: string }) => titles.push(title),
      showToast: ({ title }: { title: string }) => toasts.push(title),
      showModal: async () => ({ confirm: true }),
      navigateBack() {}, redirectTo() {}, disableAlertBeforeUnload() {}, enableAlertBeforeUnload() {},
      nextTick: (callback: () => void) => callback(), pageScrollTo() {},
    },
  });
  return { page: instance, commands, requests, toasts, titles, returns };
}

test('benefit copy and stage labels preserve cashback and distinguish actual discounts', () => {
  assert.equal(benefitCopy('cashback').recordAction, '确认到账');
  assert.equal(benefitCopy('cashback').dateLabel, '到账日期');
  assert.equal(benefitCopy('discount').recordAction, '记录已享优惠');
  assert.equal(benefitCopy('discount').dateLabel, '享受优惠日期');
  assert.equal(format.stageLabel(record('discount')), '已完成 · 待确认优惠');
  assert.equal(format.stageLabel('received', 'discount'), '已享优惠');
  assert.equal(format.stageLabel(record('cashback', 'received')), '已到账');
});

test('reward summaries derive historical kinds from snapshots and keep currency, owner, and pagination boundaries', async () => {
  const f = fixture();
  const cash = await f.command('reward.confirm', { activityId: 'cashback', amountMinor: 1875, receivedOn: '2026-09-20' });
  const discountPayload = { activityId: 'discount', amountMinor: 2750, receivedOn: '2026-09-21' };
  const discount = await f.command('reward.confirm', discountPayload, 'discount-replay');
  assert.deepEqual(await f.command('reward.confirm', discountPayload, 'discount-replay'), discount);
  await f.command('reward.confirm', { activityId: 'foreign', amountMinor: 5000, receivedOn: '2026-09-21' });
  await f.command('reward.confirm', { activityId: 'cashback', amountMinor: 9999, receivedOn: '2026-09-21' }, 'other-user', 'other-owner');
  const current = await f.store.get<Activity>('activities', 'discount');
  await f.store.set('activities', 'discount', { ...current!, rewardKind: 'cashback', revision: 2 });
  const first = await f.query<RewardsView>('rewards.get', { month: '2026-09', currency: 'CNY', limit: 1 });
  assert.equal(first.totalMinor, 4625);
  assert.equal(first.cashbackMinor, 1875);
  assert.equal(first.discountMinor, 2750);
  assert.equal(first.rewardKinds?.[discount.id], 'discount');
  assert.equal(first.received.length, 1);
  assert.ok(first.nextCursor);
  const second = await f.query<RewardsView>('rewards.get', { month: '2026-09', currency: 'CNY', limit: 1, cursor: first.nextCursor });
  assert.equal(second.rewardKinds?.[cash.id], 'cashback');
  assert.equal(second.discountMinor, 2750);
  assert.equal(second.cashbackMinor, 1875);
  const foreign = await f.query<RewardsView>('rewards.get', { month: '2026-09', currency: 'HKD' });
  assert.equal(foreign.totalMinor, 5000);
  assert.equal(foreign.cashbackMinor, 0);
  assert.equal(foreign.discountMinor, 5000);
  assert.equal((await f.store.find<Reward>('rewards')).length, 4);
});

test('discount correction and reversal keep one ledger, actual date month, period snapshot, and version protection', async () => {
  const f = fixture();
  const result = await f.command('reward.confirm', { activityId: 'discount', amountMinor: 2750, receivedOn: '2026-09-20' });
  const detail = await f.query<Detail>('activity.get', { participationId: result.id });
  f.setDate('2026-10-20');
  await f.command('reward.confirm', { participationId: result.id, amountMinor: 2500, receivedOn: '2026-10-02', expectedVersion: detail.participation!.version });
  await assert.rejects(f.command('reward.confirm', { participationId: result.id, amountMinor: 2600, receivedOn: '2026-10-03', expectedVersion: detail.participation!.version }), { code: 'VERSION_CONFLICT' });
  assert.equal((await f.store.find<Reward>('rewards')).length, 1);
  assert.equal((await f.query<RewardsView>('rewards.get', { month: '2026-09' })).discountMinor, 0);
  assert.equal((await f.query<RewardsView>('rewards.get', { month: '2026-10' })).discountMinor, 2500);
  assert.equal((await f.query<Detail>('activity.get', { participationId: result.id })).participation!.periodKey, '2026-09');
  await f.command('reward.revoke', { participationId: result.id });
  const rewards = await f.query<RewardsView>('rewards.get', { month: '2026-10' });
  assert.equal(rewards.totalMinor, 0);
  assert.equal(rewards.discountMinor, 0);
  assert.equal(rewards.pending[0].snapshot.rewardKind, 'discount');
});

test('discount receipt form records actual discounts without changing persisted date or version fields', async () => {
  const item = record('discount');
  const h = controller('receipt', item);
  h.page.setData({ activityId: item.activityId, participationId: item.id });
  await h.page.load();
  assert.equal(h.titles.at(-1), '记录已享优惠');
  assert.equal(h.page.data.benefit.amountLabel, '实际优惠金额');
  assert.equal(h.page.data.benefit.dateLabel, '享受优惠日期');
  h.page.setData({ amountInput: '27.50', receivedOn: '2026-09-20' });
  await h.page.save();
  assert.equal(h.commands[0].action, 'reward.confirm');
  assert.equal(h.commands[0].payload.receivedOn, '2026-09-20');
  assert.equal(h.commands[0].payload.expectedVersion, 3);
  assert.equal(h.commands[0].payload.amountMinor, 2750);
  assert.equal(h.toasts.at(-1), '已记录优惠');
  assert.deepEqual(h.returns, [{ activityId: item.activityId, participationId: item.id }]);
});

test('discount details block expected-reward reminders while retaining active deadline reminders', async () => {
  const completed = controller('detail', record('discount'));
  completed.page.setData({ activityId: 'discount' });
  await completed.page.load();
  assert.equal(completed.page.data.view.progressLabel, '已完成 · 待确认优惠');
  completed.page.openExpected();
  await completed.page.saveExpected();
  await completed.page.reminder();
  assert.equal(completed.page.data.showExpected, false);
  assert.deepEqual(completed.commands, []);
  assert.deepEqual(completed.requests, []);
  const active = controller('detail', record('discount', 'in_progress'));
  active.page.setData({ activityId: 'discount' });
  await active.page.load();
  await active.page.reminder();
  assert.deepEqual(active.requests, [{ kind: 'deadline', id: 'record-discount' }]);
});

test('reward rows and historical records use benefit-specific labels without per-row lookups', async () => {
  const h = controller('rewards');
  const pending = h.page.mapPending([record('discount'), record('cashback')]);
  const discount = pending.find((item: any) => item.id === 'record-discount');
  assert.equal(discount.recordAction, '记录已享优惠');
  assert.equal(discount.late, false);
  assert.match(discount.expected, /无需等待银行到账/);
  const row = { id: 'reward-discount', participationId: 'record-discount', title: 'Offer', bankId: 'cmb', amountMinor: 2750, currency: 'CNY', receivedOn: '2026-09-20', activityPeriod: '2026-09' };
  const received = h.page.mapReceived([row], [], {}, { 'record-discount': 'discount' });
  assert.equal(received[0].kindLabel, '已享优惠');
  assert.equal(received[0].amountPrefix, '');
  const history = controller('history', record('discount', 'received'));
  await history.page.load();
  assert.equal(history.page.data.items[0].stageLabel, '已享优惠');
  assert.equal(history.page.data.items[0].amountLabel, '实际优惠');
  assert.equal(history.page.data.items[0].dateLabel, '享受优惠日期');
});

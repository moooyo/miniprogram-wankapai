import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { readReminderConfiguration } from '../cloudfunctions/reminders/configuration';
import { createReminderWorker, type ReminderGrant, type SubscriptionMessage } from '../cloudfunctions/reminders/worker';
import type { Activity, Actor, ApiRequest, Commands, MutationResult, Participation, Wallet } from '../shared/contracts';

type TargetKind = 'deadline' | 'repayment' | 'reward';
const actor: Actor = { userId: 'reminder-target-owner', isModerator: false };
const other: Actor = { userId: 'another-reminder-owner', isModerator: false };
const templateId = 'reminder-target-template';
const configuration = readReminderConfiguration({
  REMINDERS_ENABLED: 'true',
  REMINDER_TEMPLATES_JSON: JSON.stringify(Object.fromEntries(['deadline', 'repayment', 'reward'].map(kind => [kind, {
    templateId, fields: { thing1: 'title', date2: 'dueOn' },
  }]))),
});

async function fixture(kind: TargetKind, dueOn = '2026-09-24') {
  let instant = new Date('2026-09-22T04:00:00.000Z');
  const activity: Activity = {
    id: 'reminder-target-activity', title: 'Reminder target fixture', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Fixture card', frequency: 'once', startsOn: '2026-09-01',
    endsOn: kind === 'deadline' ? dueOn : '2026-09-23', target: 1, unit: 'transaction', currency: 'CNY', rewardMinor: 100,
    rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false,
    conditions: 'Fixture conditions', sourceUrl: '', sourceNote: 'Test fixture',
    entrance: { kind: 'guide', label: 'Fixture guide', instructions: 'Fixture instructions', imageIds: [] },
    revision: 1, status: 'published', publishedAt: '2026-09-01T04:00:00.000Z', updatedAt: '2026-09-01T04:00:00.000Z', publishedBy: 'fixture-operator',
  };
  const store = new MemoryStore({ activities: { [activity.id]: activity } });
  const service = createService(store, { now: () => instant, templateIds: configuration.templateIds });
  let sequence = 0;
  const command = <K extends keyof Commands>(action: K, payload: Commands[K], requestId = `target-request-${++sequence}`, owner = actor) =>
    service.execute(owner, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>;
  await command('preferences.save', { newActivities: false, deadlines: kind === 'deadline', rewards: kind === 'reward', repayments: kind === 'repayment' });
  let entityId: string;
  if (kind === 'repayment') {
    const saved = await command('card.save', {
      bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Reminder fixture card',
      billing: { statementDay: 6, dueDay: Number(dueOn.slice(8)), dueMonthOffset: 0, remindDays: 3, dueOn },
    });
    const wallet = await service.execute(actor, { action: 'wallet.get', payload: {} }) as Wallet;
    const accountId = wallet.cards.find(card => card.id === saved.id)!.billingAccountId;
    entityId = wallet.bills.find(bill => bill.billingAccountId === accountId && bill.periodKey === '2026-09')!.id;
  } else {
    entityId = (await command('activity.join', { activityId: activity.id })).id;
    if (kind === 'reward') {
      await command('participation.complete', { participationId: entityId });
      await command('participation.expected', { participationId: entityId, expectedOn: dueOn });
    }
  }
  instant = new Date('2026-09-24T04:00:00.000Z');
  const payload: Commands['reminder.authorize'] = { kind, entityId, templateId, accepted: true };
  const messages: SubscriptionMessage[] = [];
  const worker = createReminderWorker({
    store, configuration, now: () => instant,
    send: async message => { messages.push(message); return { errCode: 0 }; },
  });
  return { store, service, command, payload, entityId, worker, messages,
    setDate: (day: string) => { instant = new Date(`${day}T04:00:00.000Z`); } };
}

function code(expected: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected;
}

async function rejectsWithoutWrites(f: Awaited<ReturnType<typeof fixture>>, payload = f.payload, owner = actor, expectedCode = 'REMINDER_UNAVAILABLE') {
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('reminder.authorize', payload, undefined, owner), code(expectedCode));
  assert.deepEqual(await f.store.exportSeed(), before);
}

for (const kind of ['deadline', 'repayment'] as const) {
  test(`expired ${kind} authorization writes no grant, audit or request receipt and never reaches the sender`, async () => {
    const f = await fixture(kind, '2026-09-23');
    for (const accepted of [true, false]) await rejectsWithoutWrites(f, { ...f.payload, accepted });
    for (const day of ['2026-09-24', '2026-09-25', '2026-10-01']) {
      f.setDate(day);
      const report = await f.worker();
      assert.equal(report.created, 0);
      assert.equal(report.sent, 0);
    }
    assert.equal((await f.store.find('reminder_grants')).length, 0);
    assert.equal((await f.store.find('reminder_jobs')).length, 0);
    assert.equal(f.messages.length, 0);
  });

  test(`same-day ${kind} consent sends once and its consumed request still replays after expiry`, async () => {
    const f = await fixture(kind);
    const result = await f.command('reminder.authorize', f.payload, 'same-day-consent');
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
    assert.equal((await f.worker()).sent, 1);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].touser, actor.userId);
    assert.equal(f.messages[0].data.date2.value, '2026-09-24');
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 0);
    f.setDate('2026-09-25');
    const beforeReplay = await f.store.exportSeed();
    assert.deepEqual(await f.command('reminder.authorize', f.payload, 'same-day-consent'), result);
    assert.deepEqual(await f.service.execute(actor, { action: 'request.replay', payload: { action: 'reminder.authorize', payload: f.payload, requestId: 'same-day-consent' } }), result);
    assert.deepEqual(await f.store.exportSeed(), beforeReplay);
    await rejectsWithoutWrites(f);
    assert.equal((await f.worker()).sent, 0);
    assert.equal(f.messages.length, 1);
  });

  test(`future ${kind} consent is allowed before the sending window and becomes deliverable later`, async () => {
    const f = await fixture(kind, '2026-09-30');
    const result = await f.command('reminder.authorize', f.payload, 'early-consent');
    assert.equal((await f.worker()).created, 0);
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
    assert.equal(f.messages.length, 0);
    f.setDate('2026-09-27');
    assert.equal((await f.worker()).sent, 1);
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 0);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].data.date2.value, '2026-09-30');
    assert.equal((await f.worker()).sent, 0);
  });

  test(`a committed ${kind} grant can be replayed after expiry without replenishing or rewriting it`, async () => {
    const f = await fixture(kind, '2026-09-23');
    f.setDate('2026-09-23');
    const result = await f.command('reminder.authorize', f.payload, 'before-expiry-consent');
    f.setDate('2026-09-24');
    const beforeReplay = await f.store.exportSeed();
    assert.deepEqual(await f.command('reminder.authorize', f.payload, 'before-expiry-consent'), result);
    assert.deepEqual(await f.store.exportSeed(), beforeReplay);
    await rejectsWithoutWrites(f);
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 1);
    assert.equal((await f.worker()).created, 0);
    assert.equal(f.messages.length, 0);
  });
}

for (const stage of ['completed', 'received', 'skipped'] as const) {
  test(`deadline consent rejects the ${stage} stage without writing authorization state`, async () => {
    const f = await fixture('deadline', '2026-09-30');
    if (stage === 'skipped') await f.command('participation.skip', { participationId: f.entityId, skipped: true });
    else if (stage === 'received') await f.command('reward.confirm', { participationId: f.entityId, amountMinor: 100, receivedOn: '2026-09-24' });
    else await f.command('participation.complete', { participationId: f.entityId });
    for (const accepted of [true, false]) await rejectsWithoutWrites(f, { ...f.payload, accepted });
    assert.equal((await f.worker()).created, 0);
    assert.equal(f.messages.length, 0);
  });
}

test('available, registered and in-progress targets remain eligible for future deadline consent', async () => {
  const f = await fixture('deadline', '2026-09-30');
  for (const stage of ['available', 'registered', 'in_progress'] as const) {
    if (stage !== 'available') await f.command('participation.progress', { participationId: f.entityId, progress: stage === 'in_progress' ? 1 : 0, registered: true });
    assert.equal((await f.store.get<Participation>('participations', f.entityId))?.stage, stage);
    const result = await f.command('reminder.authorize', f.payload, `eligible-${stage}`);
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, ['available', 'registered', 'in_progress'].indexOf(stage) + 1);
  }
});

for (const expectedOn of ['2026-09-23', '2026-09-24', '2026-09-30']) {
  test(`completed reward consent accepts expected date ${expectedOn} and sends when due`, async () => {
    const f = await fixture('reward', expectedOn);
    const result = await f.command('reminder.authorize', f.payload, 'reward-consent');
    if (expectedOn > '2026-09-24') {
      assert.equal((await f.worker()).created, 0);
      assert.equal(f.messages.length, 0);
      f.setDate(expectedOn);
    }
    assert.equal((await f.worker()).sent, 1);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].data.date2.value, expectedOn);
    assert.equal((await f.store.get<ReminderGrant>('reminder_grants', result.id))?.remaining, 0);
    const sent = await f.store.exportSeed();
    assert.deepEqual(await f.command('reminder.authorize', f.payload, 'reward-consent'), result);
    assert.deepEqual(await f.store.exportSeed(), sent);
    assert.equal((await f.worker()).sent, 0);
  });
}

test('reward consent requires both a completed target and an expected date', async () => {
  const f = await fixture('reward');
  await f.command('participation.expected', { participationId: f.entityId, expectedOn: null });
  await rejectsWithoutWrites(f);
  await f.command('participation.undoComplete', { participationId: f.entityId });
  for (const stage of ['available', 'registered', 'in_progress', 'skipped'] as const) {
    if (stage === 'skipped') await f.command('participation.skip', { participationId: f.entityId, skipped: true });
    else if (stage !== 'available') await f.command('participation.progress', { participationId: f.entityId, progress: stage === 'in_progress' ? 1 : 0, registered: true });
    assert.equal((await f.store.get<Participation>('participations', f.entityId))?.stage, stage);
    await rejectsWithoutWrites(f);
  }
  await f.command('participation.skip', { participationId: f.entityId, skipped: false });
  await f.command('participation.complete', { participationId: f.entityId });
  await f.command('participation.expected', { participationId: f.entityId, expectedOn: '2026-09-23' });
  const granted = await f.command('reminder.authorize', f.payload, 'before-receipt-consent');
  await f.command('reward.confirm', { participationId: f.entityId, amountMinor: 100, receivedOn: '2026-09-24' });
  assert.equal((await f.store.get<Participation>('participations', f.entityId))?.expectedOn, '2026-09-23');
  await rejectsWithoutWrites(f);
  const beforeReplay = await f.store.exportSeed();
  assert.deepEqual(await f.command('reminder.authorize', f.payload, 'before-receipt-consent'), granted);
  assert.deepEqual(await f.store.exportSeed(), beforeReplay);
  assert.equal((await f.worker()).created, 0);
  assert.equal(f.messages.length, 0);
});

for (const kind of ['deadline', 'reward', 'repayment'] as const) {
  test(`foreign ${kind} targets cannot receive consent or disclose target eligibility`, async () => {
    const f = await fixture(kind);
    await rejectsWithoutWrites(f, f.payload, other, 'NOT_FOUND');
    assert.equal((await f.store.find('reminder_grants')).length, 0);
  });
}

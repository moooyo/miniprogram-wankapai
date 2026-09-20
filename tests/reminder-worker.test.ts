import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../domain/memory-store';
import { Activity, Card, Participation, ReminderJob } from '../shared/contracts';
import { readReminderConfiguration } from '../cloudfunctions/reminders/configuration';
import { createReminderWorker, ReminderGrant, SubscriptionMessage } from '../cloudfunctions/reminders/worker';

const now = () => new Date('2026-09-28T01:00:00Z');
const templateId = 'verified-template-123';
const configuration = readReminderConfiguration({ REMINDERS_ENABLED: 'true', REMINDER_TEMPLATES_JSON: JSON.stringify({ deadline: { templateId, fields: { thing1: 'title', date2: 'dueOn' } }, reward: { templateId, fields: { thing1: 'title', date2: 'dueOn' } }, repayment: { templateId, fields: { thing1: 'title', date2: 'dueOn' } } }) });
const matchConfiguration = readReminderConfiguration({ REMINDERS_ENABLED: 'true', REMINDER_TEMPLATES_JSON: JSON.stringify({ new_activity: { templateId, fields: { thing1: 'title', date2: 'dueOn', thing3: 'kindLabel' } } }) });
function participation(id: string, stage: Participation['stage'] = 'available'): Participation {
  return { id, ownerId: 'owner', activityId: 'activity', stage, startsOn: '2026-09-01', endsOn: '2026-09-30', expectedOn: '2026-09-27', snapshot: { title: 'Monthly benefit' } } as Participation;
}
function grant(entityId: string, kind: ReminderJob['kind'] = 'deadline', remaining = 1): ReminderGrant {
  return { id: `grant-${entityId}-${kind}`, ownerId: 'owner', kind, entityId, templateId, remaining, acceptedAt: now().toISOString(), updatedAt: now().toISOString() };
}
function fixture(options: { stage?: Participation['stage']; grant?: boolean } = {}) {
  const record = participation('participation', options.stage);
  const authorization = grant(record.id);
  return new MemoryStore({ preferences: { owner: { ownerId: 'owner', newActivities: false, deadlines: true, rewards: true, repayments: true } }, participations: { [record.id]: record }, ...(options.grant === false ? {} : { reminder_grants: { [authorization.id]: authorization } }) });
}

test('worker requires explicit templates and scoped grants without pretending to send', async () => {
  const store = fixture({ grant: false });
  let calls = 0;
  const worker = createReminderWorker({ store, configuration, now, send: async () => { calls += 1; return { errCode: 0 }; } });
  assert.equal((await worker()).needsAuthorization, 1);
  assert.equal(calls, 0);
  const wrongEntity = grant('another-participation');
  await store.set('reminder_grants', wrongEntity.id, wrongEntity);
  assert.equal((await worker()).needsAuthorization, 1);
  assert.equal(calls, 0);
  const correct = grant('participation');
  await store.set('reminder_grants', correct.id, correct);
  const disabled = createReminderWorker({ store, configuration: readReminderConfiguration({}), now, send: async () => { calls += 1; return { errCode: 0 }; } });
  assert.equal((await disabled()).needsAuthorization, 1);
  assert.equal((await store.get<ReminderGrant>('reminder_grants', correct.id))?.remaining, 1);
});

test('competing timer deliveries consume one grant and send once', async () => {
  const store = fixture();
  const messages: SubscriptionMessage[] = [];
  const worker = createReminderWorker({ store, configuration, now, send: async message => { messages.push(message); return { errCode: 0 }; } });
  await Promise.all([worker(), worker(), worker()]);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].data, { thing1: { value: 'Monthly benefit' }, date2: { value: '2026-09-30' } });
  assert.equal(messages[0].touser, 'owner');
  assert.equal((await store.find<ReminderGrant>('reminder_grants'))[0].remaining, 0);
  assert.equal((await store.find<ReminderJob>('reminder_jobs'))[0].status, 'sent');
  assert.equal((await worker()).sent, 0);
});

test('timeouts have unknown outcome and are never retried automatically', async () => {
  const store = fixture();
  let calls = 0;
  const worker = createReminderWorker({ store, configuration, now, send: async () => { calls += 1; throw new Error('Network timeout'); } });
  assert.equal((await worker()).sentUnknown, 1);
  assert.equal((await store.find<ReminderJob>('reminder_jobs'))[0].status, 'sent_unknown');
  await store.set('reminder_grants', grant('participation').id, grant('participation', 'deadline', 2));
  await worker();
  assert.equal(calls, 1);
});

test('an expired sending lease is quarantined without consuming another grant', async () => {
  const store = fixture();
  await createReminderWorker({ store, configuration: readReminderConfiguration({}), now, send: async () => ({ errCode: 0 }) })();
  const job = (await store.find<ReminderJob>('reminder_jobs'))[0];
  await store.set('reminder_jobs', job.id, { ...job, status: 'sending', attempts: 1, leaseToken: 'old', leaseUntil: '2026-09-27T00:00:00Z' });
  let calls = 0;
  const result = await createReminderWorker({ store, configuration, now, send: async () => { calls += 1; return { errCode: 0 }; } })();
  assert.equal(result.sentUnknown, 1);
  assert.equal(calls, 0);
  assert.equal((await store.find<ReminderGrant>('reminder_grants'))[0].remaining, 1);
});

test('completed tasks, received rewards, and paid bills cancel queued messages', async () => {
  const store = fixture({ grant: false });
  const disabled = createReminderWorker({ store, configuration: readReminderConfiguration({}), now, send: async () => ({ errCode: 0 }) });
  await disabled();
  await store.set('participations', 'participation', participation('participation', 'received'));
  assert.equal((await disabled()).cancelled, 1);
  assert.equal((await store.find<ReminderJob>('reminder_jobs'))[0].status, 'cancelled');
});

test('reward reminders keep their original period and repayment jobs use account lead time', async () => {
  const reward = { ...participation('old-period', 'completed'), startsOn: '2026-08-01', endsOn: '2026-08-31', expectedOn: '2026-09-28' };
  const rewardGrant = grant(reward.id, 'reward');
  const billGrant = grant('bill', 'repayment');
  const store = new MemoryStore({
    preferences: { owner: { ownerId: 'owner', newActivities: false, deadlines: true, rewards: true, repayments: true } },
    participations: { [reward.id]: reward },
    billing_accounts: { account: { id: 'account', ownerId: 'owner', enabled: true, remindDays: 2, label: 'Card bill' } },
    bills: { bill: { id: 'bill', ownerId: 'owner', billingAccountId: 'account', dueOn: '2026-09-30', paidAt: null } },
    reminder_grants: { [rewardGrant.id]: rewardGrant, [billGrant.id]: billGrant },
  });
  const messages: SubscriptionMessage[] = [];
  assert.equal((await createReminderWorker({ store, configuration, now, send: async message => { messages.push(message); return { errCode: 0 }; } })()).sent, 2);
  assert.equal(messages.some(message => message.page.includes('old-period')), true);
  assert.equal((await store.get<Participation>('participations', reward.id))?.startsOn, '2026-08-01');
});

test('malformed template mappings fail closed', () => {
  assert.deepEqual(readReminderConfiguration({ REMINDER_TEMPLATES_JSON: '{' }).templates, {});
  assert.deepEqual(readReminderConfiguration({ REMINDER_TEMPLATES_JSON: JSON.stringify({ deadline: { templateId, fields: { date1: 'title' } } }) }).templates, {});
  assert.equal(readReminderConfiguration({ REMINDERS_ENABLED: 'false' }).enabled, false);
});

test('a cancelled reminder can be rearmed before the deadline without reopening sent jobs', async () => {
  const store = fixture({ grant: false });
  let calls = 0;
  const worker = createReminderWorker({ store, configuration, now, send: async () => { calls += 1; return { errCode: 0 }; } });
  await worker();
  await store.set('preferences', 'owner', { ownerId: 'owner', newActivities: false, deadlines: false, rewards: false, repayments: false });
  assert.equal((await worker()).cancelled, 1);
  await store.set('preferences', 'owner', { ownerId: 'owner', newActivities: false, deadlines: true, rewards: false, repayments: false });
  await store.set('reminder_grants', grant('participation').id, grant('participation'));
  assert.equal((await worker()).sent, 1);
  const job = (await store.find<ReminderJob>('reminder_jobs'))[0];
  assert.equal(job.error, undefined);
  await worker();
  assert.equal(calls, 1);
});

test('late explicit success settles an expired lease using the same token', async () => {
  const store = fixture();
  let instant = now();
  let complete: ((value: { errCode: number }) => void) | undefined;
  const started = createReminderWorker({ store, configuration, now: () => instant, send: () => new Promise(resolve => { complete = resolve; }) })();
  while (!complete) await new Promise(resolve => setImmediate(resolve));
  instant = new Date(instant.getTime() + 180_000);
  const second = await createReminderWorker({ store, configuration, now: () => instant, send: async () => { throw new Error('A second delivery must not occur'); } })();
  assert.equal(second.sentUnknown, 1);
  complete({ errCode: 0 });
  assert.equal((await started).sent, 1);
  assert.equal((await store.find<ReminderJob>('reminder_jobs'))[0].status, 'sent');
});

test('one materialization failure is reported without suppressing already due jobs', async () => {
  const store = fixture();
  const result = await createReminderWorker({
    store, configuration, now,
    materialize: async () => { throw new Error('Temporary catch-up failure'); },
    send: async () => ({ errCode: 0 }),
  })();
  assert.equal(result.materializationFailed, 1);
  assert.equal(result.sent, 1);
});

function recentActivity(id: string, changes: Partial<Activity> = {}): Activity {
  return {
    id, revision: 1, status: 'published', title: 'New card benefit', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit',
    startsOn: '2026-09-01', endsOn: '2026-10-31', publishedAt: '2026-09-28T00:00:00Z', requiresInvitation: false, ...changes,
  } as Activity;
}
function matchingCard(changes: Partial<Card> = {}): Card {
  return { id: 'card', ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '', createdAt: '2026-09-01', ...changes };
}
const matchPreference = { ownerId: 'owner', newActivities: true, deadlines: false, rewards: false, repayments: false };

test('new activity jobs match issuer, network and card kind and consume only the matches scope', async () => {
  const activities = [
    recentActivity('matching', { requiresInvitation: true }),
    recentActivity('wrong-bank', { bankId: 'boc' }), recentActivity('wrong-issuer', { issuerIds: ['cmb-hk'] }),
    recentActivity('wrong-network', { networks: ['mastercard'] }), recentActivity('wrong-kind', { cardKind: 'debit' }),
    recentActivity('too-old', { publishedAt: '2026-09-21T00:00:00Z' }),
    recentActivity('expired', { endsOn: '2026-09-27' }),
  ];
  const wrongGrant = grant('matching', 'new_activity');
  const store = new MemoryStore({
    preferences: { owner: matchPreference }, cards: { card: matchingCard() },
    activities: Object.fromEntries(activities.map(item => [item.id, item])), reminder_grants: { [wrongGrant.id]: wrongGrant },
  });
  const messages: SubscriptionMessage[] = [];
  const worker = createReminderWorker({ store, configuration: matchConfiguration, now, send: async message => { messages.push(message); return { errCode: 0 }; } });
  assert.equal((await worker()).needsAuthorization, 1);
  assert.equal(messages.length, 0);
  const job = (await store.find<ReminderJob>('reminder_jobs'))[0];
  assert.equal(job.entityId, 'matching');
  assert.equal(job.grantEntityId, 'matches');
  assert.equal(job.activityRevision, 1);
  assert.equal(job.dueOn, '2026-09-28');
  const matchGrant = grant('matches', 'new_activity', 2);
  await store.set('reminder_grants', matchGrant.id, matchGrant);
  assert.equal((await worker()).sent, 1);
  assert.match(messages[0].data.thing1.value, /^受邀活动：/);
  assert.equal(messages[0].data.thing3.value, '持卡匹配线索，请核实资格');
  assert.match(messages[0].page, /activityId=matching$/);
  await worker();
  assert.equal(messages.length, 1);
  await store.set('activities', 'matching', recentActivity('matching', { revision: 2 }));
  assert.equal((await worker()).sent, 1);
  assert.equal((await store.find('reminder_jobs')).length, 2);
});

test('withdrawal, removed cards and expired publication windows cancel unsent activity notifications', async () => {
  for (const change of ['withdrawn', 'archived', 'aged'] as const) {
    const activity = recentActivity('matching');
    const store = new MemoryStore({ preferences: { owner: matchPreference }, cards: { card: matchingCard() }, activities: { matching: activity } });
    let instant = now();
    const worker = createReminderWorker({ store, configuration: matchConfiguration, now: () => instant, send: async () => { throw new Error('Unauthorized notification must not send'); } });
    assert.equal((await worker()).needsAuthorization, 1);
    if (change === 'withdrawn') await store.set('activities', activity.id, { ...activity, status: 'withdrawn' });
    if (change === 'archived') await store.set('cards', 'card', matchingCard({ archivedAt: now().toISOString() }));
    if (change === 'aged') instant = new Date('2026-10-05T01:00:00Z');
    assert.equal((await worker()).cancelled, 1);
    assert.equal((await store.find<ReminderJob>('reminder_jobs'))[0].status, 'cancelled');
  }
});

test('missing activity template keeps matched jobs explicitly unsent', async () => {
  const authorization = grant('matches', 'new_activity');
  const store = new MemoryStore({ preferences: { owner: matchPreference }, cards: { card: matchingCard() }, activities: { matching: recentActivity('matching') }, reminder_grants: { [authorization.id]: authorization } });
  const report = await createReminderWorker({ store, configuration, now, send: async () => { throw new Error('Missing template must not send'); } })();
  assert.equal(report.needsAuthorization, 1);
  assert.equal((await store.find<ReminderJob>('reminder_jobs'))[0].error, 'TEMPLATE_UNAVAILABLE');
  assert.equal((await store.get<ReminderGrant>('reminder_grants', authorization.id))?.remaining, 1);
});

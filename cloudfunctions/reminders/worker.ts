import { createHash, randomUUID } from 'node:crypto';
import { Activity, Bill, BillingAccount, Card, Participation, ReminderJob, ReminderPreference, Tracking } from '../../shared/contracts';
import { addDays, todayCN } from '../../domain/calendar';
import { Store } from '../../domain/store';
import { ReminderConfiguration, ReminderTemplate } from './configuration';

export interface ReminderGrant {
  id: string; ownerId: string; kind: ReminderJob['kind']; entityId: string; templateId: string;
  remaining: number; acceptedAt: string | null; updatedAt: string;
}
export interface SubscriptionMessage {
  touser: string; templateId: string; page: string;
  data: Record<string, { value: string }>;
  miniprogramState: 'formal'; lang: 'zh_CN';
}
export interface WorkerDependencies {
  store: Store;
  configuration: ReminderConfiguration;
  send: (message: SubscriptionMessage) => Promise<{ errCode?: number; errcode?: number }>;
  now?: () => Date;
  materialize?: (ownerId: string) => Promise<void>;
}
export interface WorkerReport { created: number; sent: number; needsAuthorization: number; failed: number; sentUnknown: number; cancelled: number; skipped: number; materializationFailed: number; }

interface Candidate { ownerId: string; kind: ReminderJob['kind']; entityId: string; dueOn: string; title: string; page: string; grantEntityId?: string; activityRevision?: number; }
const preferenceKey = { new_activity: 'newActivities', deadline: 'deadlines', reward: 'rewards', repayment: 'repayments' } as const;
const unfinished = (record: Participation) => !['completed', 'received', 'skipped'].includes(record.stage);

function idFor(candidate: Candidate): string {
  const key = candidate.kind === 'new_activity'
    ? [candidate.ownerId, candidate.kind, candidate.entityId, String(candidate.activityRevision)]
    : [candidate.ownerId, candidate.kind, candidate.entityId, candidate.dueOn];
  return `j_${createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 40)}`;
}
function within(today: string, dueOn: string, lead: number): boolean { return today >= addDays(dueOn, -lead) && today <= dueOn; }
function cardMatches(activity: Activity, card: Card): boolean {
  return !card.archivedAt && activity.bankId === card.bankId && (!activity.issuerIds.length || activity.issuerIds.includes(card.issuerId)) &&
    (!activity.networks.length || activity.networks.includes(card.network)) && (activity.cardKind === 'any' || activity.cardKind === card.kind);
}
function publicationDate(activity: Activity): string | null {
  const instant = new Date(activity.publishedAt);
  return Number.isFinite(instant.getTime()) ? todayCN(instant) : null;
}
function isRecentActive(activity: Activity, today: string): boolean {
  const publishedOn = publicationDate(activity);
  return activity.status === 'published' && Boolean(publishedOn && publishedOn <= today && publishedOn >= addDays(today, -6)) && activity.startsOn <= today && activity.endsOn >= today;
}

async function candidateIsCurrent(store: Store, job: Candidate, today: string): Promise<boolean> {
  const preference = await store.get<ReminderPreference>('preferences', job.ownerId);
  if (!preference?.[preferenceKey[job.kind]]) return false;
  if (job.kind === 'new_activity') {
    const activity = await store.get<Activity>('activities', job.entityId);
    if (!activity || !isRecentActive(activity, today) || activity.revision !== job.activityRevision || publicationDate(activity) !== job.dueOn || job.grantEntityId !== 'matches') return false;
    const cards = await store.find<Card>('cards', { where: [{ field: 'ownerId', op: 'eq', value: job.ownerId }] });
    return cards.some(card => cardMatches(activity, card));
  }
  if (job.kind === 'repayment') {
    const bill = await store.get<Bill>('bills', job.entityId);
    if (!bill || bill.ownerId !== job.ownerId || bill.paidAt || bill.dueOn !== job.dueOn) return false;
    const account = await store.get<BillingAccount>('billing_accounts', bill.billingAccountId);
    return Boolean(account?.enabled && account.ownerId === job.ownerId && within(today, bill.dueOn, account.remindDays));
  }
  const record = await store.get<Participation>('participations', job.entityId);
  if (!record || record.ownerId !== job.ownerId) return false;
  const trackings = await store.find<Tracking>('trackings', { where: [
    { field: 'ownerId', op: 'eq', value: job.ownerId }, { field: 'activityId', op: 'eq', value: record.activityId }, { field: 'scopeKey', op: 'eq', value: record.scopeKey },
  ] });
  if (trackings.some(tracking => !tracking.enabled) || (!trackings.length && record.withdrawnAt)) return false;
  return job.kind === 'deadline'
    ? unfinished(record) && record.endsOn === job.dueOn && within(today, record.endsOn, 3)
    : record.stage === 'completed' && record.expectedOn === job.dueOn && job.dueOn <= today;
}

async function dueCandidates(store: Store, today: string): Promise<Candidate[]> {
  const output: Candidate[] = [];
  const [preferences, records, bills, accounts, cards, activities, trackings] = await Promise.all([
    store.find<ReminderPreference>('preferences'), store.find<Participation>('participations'),
    store.find<Bill>('bills'), store.find<BillingAccount>('billing_accounts'),
    store.find<Card>('cards'), store.find<Activity>('activities', { where: [{ field: 'status', op: 'eq', value: 'published' }] }),
    store.find<Tracking>('trackings'),
  ]);
  const prefs = new Map(preferences.map(preference => [preference.ownerId, preference]));
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const cardsByOwner = new Map<string, Card[]>();
  for (const card of cards.filter(item => !item.archivedAt)) cardsByOwner.set(card.ownerId, [...(cardsByOwner.get(card.ownerId) || []), card]);
  for (const preference of preferences.filter(item => item.newActivities)) {
    for (const activity of activities.filter(item => isRecentActive(item, today))) {
      if (!(cardsByOwner.get(preference.ownerId) || []).some(card => cardMatches(activity, card))) continue;
      output.push({
        ownerId: preference.ownerId, kind: 'new_activity', entityId: activity.id, grantEntityId: 'matches', activityRevision: activity.revision,
        dueOn: publicationDate(activity)!, title: `${activity.requiresInvitation ? '受邀活动：' : ''}${activity.title}`,
        page: `pages/detail/index?activityId=${encodeURIComponent(activity.id)}`,
      });
    }
  }
  for (const record of records) {
    const tracking = trackings.find(row => row.ownerId === record.ownerId && row.activityId === record.activityId && row.scopeKey === record.scopeKey);
    if (tracking ? !tracking.enabled : record.withdrawnAt) continue;
    const preference = prefs.get(record.ownerId);
    const base = { ownerId: record.ownerId, entityId: record.id, title: record.snapshot.title, page: `pages/detail/index?participationId=${encodeURIComponent(record.id)}` };
    if (preference?.deadlines && unfinished(record) && within(today, record.endsOn, 3)) output.push({ ...base, kind: 'deadline', dueOn: record.endsOn });
    if (preference?.rewards && record.stage === 'completed' && record.expectedOn && record.expectedOn <= today) output.push({ ...base, kind: 'reward', dueOn: record.expectedOn });
  }
  for (const bill of bills) {
    const account = accountById.get(bill.billingAccountId);
    if (prefs.get(bill.ownerId)?.repayments && !bill.paidAt && account?.enabled && account.ownerId === bill.ownerId && within(today, bill.dueOn, account.remindDays)) {
      output.push({ ownerId: bill.ownerId, kind: 'repayment', entityId: bill.id, dueOn: bill.dueOn, title: account.label, page: 'pages/wallet/index' });
    }
  }
  return output;
}

function messageFor(job: ReminderJob, template: ReminderTemplate): SubscriptionMessage {
  const values = { title: job.title, dueOn: job.dueOn, kindLabel: { new_activity: '持卡匹配线索，请核实资格', deadline: '活动即将截止', reward: '查看收益是否到账', repayment: '信用卡还款提醒' }[job.kind] };
  return {
    touser: job.ownerId, templateId: template.templateId, page: job.page, miniprogramState: 'formal', lang: 'zh_CN',
    data: Object.fromEntries(Object.entries(template.fields).map(([field, source]) => [field, { value: field.startsWith('thing') ? Array.from(values[source]).slice(0, 20).join('') : values[source] }])),
  };
}

export function createReminderWorker(dependencies: WorkerDependencies) {
  const { store, configuration } = dependencies;
  const now = dependencies.now || (() => new Date());
  return async (): Promise<WorkerReport> => {
    const instant = now();
    const today = todayCN(instant);
    const report: WorkerReport = { created: 0, sent: 0, needsAuthorization: 0, failed: 0, sentUnknown: 0, cancelled: 0, skipped: 0, materializationFailed: 0 };
    if (dependencies.materialize) {
      const preferences = await store.find<ReminderPreference>('preferences');
      for (const preference of preferences.filter(item => item.deadlines || item.rewards || item.repayments)) {
        try { await dependencies.materialize(preference.ownerId); }
        catch { report.materializationFailed += 1; }
      }
    }
    for (const candidate of await dueCandidates(store, today)) {
      const id = idFor(candidate);
      const created = await store.transaction(async transaction => {
        const previous = await transaction.get<ReminderJob>('reminder_jobs', id);
        if (previous) {
          if (previous.status === 'cancelled' && await candidateIsCurrent(transaction, candidate, today)) {
            await transaction.set('reminder_jobs', id, { ...previous, ...candidate, status: 'pending', error: undefined, updatedAt: instant.toISOString() });
          }
          return false;
        }
        const job: ReminderJob = { ...candidate, id, status: 'pending', attempts: 0, updatedAt: instant.toISOString() };
        await transaction.set('reminder_jobs', id, job);
        return true;
      });
      if (created) report.created += 1;
    }
    const jobs = await store.find<ReminderJob>('reminder_jobs', { where: [{ field: 'status', op: 'in', value: ['pending', 'needs_authorization', 'sending'] }], orderBy: [{ field: 'dueOn', direction: 'desc' }, { field: 'id', direction: 'asc' }] });
    for (const candidate of jobs) {
      const claim = await store.transaction(async transaction => {
        const job = await transaction.get<ReminderJob>('reminder_jobs', candidate.id);
        if (!job || !['pending', 'needs_authorization', 'sending'].includes(job.status)) return { status: 'skipped' as const };
        const timestamp = now().toISOString();
        if (job.status === 'sending') {
          if (job.leaseUntil && job.leaseUntil > timestamp) return { status: 'skipped' as const };
          await transaction.set('reminder_jobs', job.id, { ...job, status: 'sent_unknown', error: 'DELIVERY_OUTCOME_UNKNOWN', updatedAt: timestamp });
          return { status: 'sentUnknown' as const };
        }
        if (!await candidateIsCurrent(transaction, job, todayCN(now()))) {
          await transaction.set('reminder_jobs', job.id, { ...job, status: 'cancelled', updatedAt: timestamp, error: 'NO_LONGER_DUE' });
          return { status: 'cancelled' as const };
        }
        const template = configuration.templates[job.kind];
        if (!configuration.enabled || !template) {
          await transaction.set('reminder_jobs', job.id, { ...job, status: 'needs_authorization', updatedAt: timestamp, error: configuration.enabled ? 'TEMPLATE_UNAVAILABLE' : 'SENDING_DISABLED' });
          return { status: 'needsAuthorization' as const };
        }
        const grants = await transaction.find<ReminderGrant>('reminder_grants', { where: [
          { field: 'ownerId', op: 'eq', value: job.ownerId }, { field: 'kind', op: 'eq', value: job.kind },
          { field: 'entityId', op: 'eq', value: job.kind === 'new_activity' ? 'matches' : job.entityId }, { field: 'templateId', op: 'eq', value: template.templateId },
          { field: 'remaining', op: 'gt', value: 0 },
        ], limit: 1 });
        if (!grants[0]) {
          await transaction.set('reminder_jobs', job.id, { ...job, status: 'needs_authorization', updatedAt: timestamp, error: 'SUBSCRIPTION_REQUIRED' });
          return { status: 'needsAuthorization' as const };
        }
        const grant = grants[0];
        await transaction.set('reminder_grants', grant.id, { ...grant, remaining: grant.remaining - 1, updatedAt: timestamp });
        const sending: ReminderJob = { ...job, status: 'sending', error: undefined, attempts: job.attempts + 1, leaseUntil: new Date(now().getTime() + 120_000).toISOString(), leaseToken: randomUUID(), authorizedAt: timestamp, updatedAt: timestamp };
        await transaction.set('reminder_jobs', job.id, sending);
        return { status: 'sending' as const, job: sending, template };
      });
      if (claim.status !== 'sending') { report[claim.status] += 1; continue; }
      let status: ReminderJob['status'] = 'sent';
      let error: string | undefined;
      try {
        const result = await dependencies.send(messageFor(claim.job, claim.template));
        const code = result.errCode ?? result.errcode;
        if (code !== 0) {
          status = typeof code === 'number' ? (code === 43101 ? 'needs_authorization' : 'failed') : 'sent_unknown';
          error = typeof code === 'number' ? `WECHAT_${code}` : 'DELIVERY_OUTCOME_UNKNOWN';
        }
      } catch (failure) {
        const code = (failure as { errCode?: unknown; errcode?: unknown })?.errCode ?? (failure as { errcode?: unknown })?.errcode;
        status = typeof code === 'number' && code > 0 ? (code === 43101 ? 'needs_authorization' : 'failed') : 'sent_unknown';
        error = typeof code === 'number' && code > 0 ? `WECHAT_${code}` : 'DELIVERY_OUTCOME_UNKNOWN';
      }
      const settled = await store.transaction(async transaction => {
        const current = await transaction.get<ReminderJob>('reminder_jobs', claim.job.id);
        if (!current || current.leaseToken !== claim.job.leaseToken || !['sending', 'sent_unknown'].includes(current.status)) return false;
        const timestamp = now().toISOString();
        const next = { ...current, status, error, updatedAt: timestamp, ...(status === 'sent' ? { sentAt: timestamp } : {}) };
        await transaction.set('reminder_jobs', current.id, next);
        return true;
      });
      if (!settled) { report.skipped += 1; continue; }
      if (status === 'sent') report.sent += 1;
      else if (status === 'needs_authorization') report.needsAuthorization += 1;
      else if (status === 'sent_unknown') report.sentUnknown += 1;
      else report.failed += 1;
    }
    return report;
  };
}

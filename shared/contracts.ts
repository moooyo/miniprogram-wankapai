export type Currency = 'CNY' | 'HKD' | 'MOP';
export type Frequency = 'once' | 'monthly' | 'quarterly' | 'yearly';
export type Network = 'visa' | 'mastercard' | 'unionpay' | 'amex' | 'other';
export type Stage = 'available' | 'registered' | 'in_progress' | 'completed' | 'received' | 'skipped';
export type SubmissionStatus = 'pending' | 'returned' | 'published';

export interface Bank { id: string; name: string; shortName: string; logo: string; }
export interface Issuer { id: string; bankId: string; name: string; }
export interface Entrance {
  kind: 'guide' | 'web' | 'miniprogram';
  label: string;
  url?: string;
  appId?: string;
  path?: string;
  shortLink?: string;
  instructions: string;
  imageIds: string[];
  verifiedAt?: string;
}
export interface ActivityDraft {
  title: string;
  bankId: string;
  issuerIds: string[];
  networks: Network[];
  cardKind: 'credit' | 'debit' | 'any';
  cardDescription: string;
  frequency: Frequency;
  startsOn: string;
  endsOn: string;
  target: number;
  unit: string;
  currency: Currency;
  rewardMinor: number;
  rewardKind: 'cashback' | 'discount';
  scope: 'user' | 'card';
  requiresRegistration: boolean;
  requiresInvitation: boolean;
  conditions: string;
  sourceUrl: string;
  sourceNote: string;
  entrance: Entrance;
}
export interface Activity extends ActivityDraft {
  id: string; revision: number; status: 'published' | 'withdrawn';
  publishedAt: string; updatedAt: string; publishedBy: string;
}
export interface ActivityLead {
  title: string;
  bankId: string;
  sourceUrl: string;
  sourceNote: string;
  imageIds: string[];
}
export interface Submission {
  id: string; ownerId: string; draft: ActivityDraft | null; lead?: ActivityLead; status: SubmissionStatus;
  reviewNote: string; createdAt: string; updatedAt: string; activityId?: string; version: number;
}
export interface Card {
  id: string; ownerId: string; bankId: string; issuerId: string; network: Network;
  kind: 'credit' | 'debit'; nickname: string; billingAccountId?: string;
  createdAt: string; archivedAt?: string;
}
export type EntitlementKind = 'lounge' | 'health_check' | 'other';
// Grey transferability records unofficial reports that still require verification.
export type Transferability = 'allowed' | 'grey' | 'not_allowed';
export interface LoungeAccess {
  id: string; airportName: string; airportCode: string; city: string; loungeName: string; terminal: string;
  supportedBanks?: string[];
  zone: 'domestic' | 'international' | 'both' | 'unknown';
  reservation: 'required' | 'not_required' | 'unknown'; advanceHours: number; reservationNote: string;
  customerScope: 'all' | 'local_bank' | 'specified' | 'unknown'; customerNote: string; guestNote: string;
  openingHours: string; location: string; unitsPerVisit: number; sourceNote: string; verifiedOn: string;
}
export interface EntitlementDraft {
  title: string; kind: EntitlementKind; cardId: string; provider: string; totalUses: number; initialUsed: number;
  startsOn: string; endsOn: string; transferability: Transferability; transferNote: string; notes: string; lounges: LoungeAccess[];
}
export interface Entitlement extends EntitlementDraft {
  id: string; ownerId: string; usedUses: number; version: number; createdAt: string; updatedAt: string; archivedAt: string | null;
}
export interface EntitlementUsage {
  id: string; ownerId: string; entitlementId: string; quantity: number; usedOn: string; note: string;
  loungeId: string; loungeName: string; reversedAt: string | null; createdAt: string;
}
export interface EntitlementList { today: string; items: Entitlement[]; cards: Card[]; }
export interface EntitlementDetail { today: string; entitlement: Entitlement; usages: EntitlementUsage[]; cards: Card[]; }
export interface BillingAccount {
  id: string; ownerId: string; bankId: string; issuerId: string; label: string;
  statementDay: number; dueDay: number; dueMonthOffset: 0 | 1;
  remindDays: number; enabled: boolean;
}
export interface Bill {
  id: string; ownerId: string; billingAccountId: string; periodKey: string;
  statementOn: string; dueOn: string; paidAt: string | null;
}
export interface Tracking {
  id: string; ownerId: string; activityId: string; cardId?: string;
  scopeKey: string; enabled: boolean; createdAt: string;
}
export interface Participation {
  id: string; ownerId: string; activityId: string; activityRevision: number;
  periodKey: string; startsOn: string; endsOn: string; scopeKey: string; cardId?: string;
  snapshot: Activity; stage: Stage; progress: number;
  registeredAt: string | null; startedAt: string | null; completedAt: string | null;
  expectedOn: string | null; receivedOn: string | null; receivedMinor: number | null;
  beforeCompletion?: { stage: Stage; progress: number };
  beforeSkip?: { stage: Stage; progress: number };
  version: number; createdAt: string; updatedAt: string;
}
export interface Reward {
  id: string; ownerId: string; participationId: string; title: string; bankId: string;
  activityPeriod: string; currency: Currency; amountMinor: number; receivedOn: string;
  reversedAt: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface Asset {
  id: string; ownerId: string; fileId: string; cloudPath: string; size: number;
  mime: string; status: 'pending' | 'approved'; createdAt: string;
}
export interface AuditEvent { id: string; ownerId: string; entityId: string; action: string; at: string; before?: unknown; after?: unknown; }
export interface ReminderPreference { ownerId: string; newActivities: boolean; deadlines: boolean; rewards: boolean; repayments: boolean; }
export interface ReminderJob {
  id: string; ownerId: string; kind: 'new_activity' | 'deadline' | 'reward' | 'repayment';
  entityId: string; dueOn: string; title: string; page: string; activityRevision?: number;
  status: 'pending' | 'sending' | 'sent' | 'sent_unknown' | 'needs_authorization' | 'failed' | 'cancelled';
  attempts: number; updatedAt: string; leaseUntil?: string; leaseToken?: string; sentAt?: string; authorizedAt?: string; error?: string; grantEntityId?: string;
}
export interface Session { userId: string; isModerator: boolean; today: string; month: string; demo: boolean; }
export interface PageResult<T> { items: T[]; nextCursor: string | null; }
export interface ActivityItem { activity: Activity; participation?: Participation; eligible: boolean; }
export interface Detail {
  activity: Activity; participation: Participation | null; tracking: Tracking | null;
  history: Participation[]; audit: AuditEvent[]; assets: Asset[]; eligible: boolean;
}
export interface Dashboard { today: string; tasks: Participation[]; pendingRewards: Participation[]; bills: Bill[]; accounts: BillingAccount[]; cards?: Card[]; }
export interface Wallet { cards: Card[]; accounts: BillingAccount[]; bills: Bill[]; }
export interface RewardsView {
  month: string; currency: Currency; totalMinor: number; pending: Participation[]; received: Reward[]; nextCursor: string | null;
  cards?: Card[]; cardIds?: Record<string, string>; pendingCounts?: Record<Currency, number>;
  rewardKinds?: Record<string, ActivityDraft['rewardKind']>;
  cashbackMinor?: number; discountMinor?: number;
}

export interface Queries {
  'session.get': { input: Record<string, never>; output: Session };
  'request.replay': { input: CommandRequest; output: MutationResult };
  'catalog.list': { input: { bankId?: string; mineOnly?: boolean; cursor?: string; limit?: number }; output: PageResult<ActivityItem> };
  'activity.get': { input: { activityId?: string; participationId?: string; cardId?: string }; output: Detail };
  'dashboard.get': { input: Record<string, never>; output: Dashboard };
  'wallet.get': { input: Record<string, never>; output: Wallet };
  'entitlements.list': { input: Record<string, never>; output: EntitlementList };
  'entitlement.get': { input: { id: string }; output: EntitlementDetail };
  'rewards.get': { input: { month?: string; currency?: Currency; cursor?: string; limit?: number }; output: RewardsView };
  'history.list': { input: { activityId?: string; filter?: 'all' | 'pending' | 'unfinished'; cursor?: string; limit?: number }; output: PageResult<Participation> };
  'submissions.list': { input: { moderation?: boolean; status?: SubmissionStatus; cursor?: string; limit?: number }; output: PageResult<Submission> };
  'submission.get': { input: { id: string }; output: Submission };
  'preferences.get': { input: Record<string, never>; output: ReminderPreference };
  'assets.get': { input: { ids: string[] }; output: Asset[] };
  'assets.urls': { input: { ids: string[] }; output: { id: string; url: string }[] };
}
export interface Commands {
  'activity.join': { activityId: string; cardId?: string };
  'activity.untrack': { participationId: string };
  'participation.progress': { participationId: string; progress: number; registered: boolean; expectedVersion?: number };
  'participation.complete': { activityId?: string; participationId?: string; cardId?: string };
  'participation.undoComplete': { participationId: string };
  'participation.skip': { participationId: string; skipped: boolean };
  'participation.expected': { participationId: string; expectedOn: string | null };
  'reward.confirm': { activityId?: string; participationId?: string; cardId?: string; amountMinor: number; receivedOn: string; expectedVersion?: number; expectNew?: boolean; expectedPeriodKey?: string };
  'reward.revoke': { participationId: string };
  'card.save': { id?: string; bankId: string; issuerId: string; network: Network; kind: 'credit' | 'debit'; nickname: string; billingAccountId?: string | null; billing?: { statementDay: number; dueDay: number; dueMonthOffset: 0 | 1; dueOn?: string; billId?: string; periodKey?: string; remindDays: number } | null };
  'card.remove': { id: string };
  'entitlement.save': { id?: string; draft: EntitlementDraft; expectedVersion?: number };
  'entitlement.use': { id: string; quantity: number; usedOn: string; note?: string; loungeId?: string; expectedVersion: number };
  'entitlement.undo': { id: string; expectedVersion: number };
  'entitlement.archive': { id: string; archived: boolean; expectedVersion: number };
  'bill.update': { id: string; dueOn?: string; paid?: boolean };
  'submission.save': { id?: string; draft: ActivityDraft; expectedVersion?: number };
  'submission.lead.save': { id?: string; lead: ActivityLead; expectedVersion?: number };
  'submission.review': { id: string; decision: 'publish' | 'return'; draft?: ActivityDraft; reviewNote?: string; sourceVerified?: boolean; expectedVersion?: number };
  'activity.withdraw': { activityId: string };
  'preferences.save': { newActivities: boolean; deadlines: boolean; rewards: boolean; repayments: boolean };
  'reminder.authorize': { kind: ReminderJob['kind']; entityId: string; templateId: string; accepted: boolean };
  'asset.register': { id: string; fileId: string; cloudPath: string; size: number; mime: string };
}
export type QueryName = keyof Queries;
export type CommandName = keyof Commands;
export type QueryRequest<K extends QueryName = QueryName> = { action: K; payload: Queries[K]['input'] };
export type CommandRequest<K extends CommandName = CommandName> = { action: K; payload: Commands[K]; requestId: string };
export type ApiRequest = QueryRequest | CommandRequest;
export interface MutationResult { id: string; version?: number; }
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; field?: string } };
export interface Actor { userId: string; isModerator: boolean; demo?: boolean; }

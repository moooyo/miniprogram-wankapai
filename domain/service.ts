import {
  Actor, Activity, ActivityDraft, ActivityItem, ApiRequest, Asset, AuditEvent, Bill, BillingAccount, Card, Commands,
  Consumption, Detail, MutationResult, Participation, ReminderJob, ReminderPreference, Reward, Submission, Tracking,
} from '../shared/contracts';
import { Collection, ServiceOptions, Store } from './store';
import { Context, createContext } from './context';
import { DomainError, requireValue } from './errors';
import { addDays, assertDate, monthOf, periodFor, todayCN } from './calendar';
import { validateDraft, validateLead } from './validation';
import { demoRecognition, normalizeRecognition } from './recognition';
import { ensureBills, getWallet, removeCard, saveCard, updateBill } from './wallet';
import { archiveEntitlement, getEntitlement, listEntitlements, saveEntitlement, undoEntitlementUsage, useEntitlement } from './entitlements';

export { DomainError } from './errors';

const queryNames = new Set(['session.get', 'request.replay', 'catalog.list', 'activity.get', 'dashboard.get', 'wallet.get', 'rewards.get', 'history.list', 'submissions.list', 'submission.get', 'preferences.get', 'assets.get', 'assets.urls', 'assets.recognize', 'entitlements.list', 'entitlement.get']);
const currencies = new Set(['CNY', 'HKD', 'MOP']);
const ownerWhere = (ownerId: string) => [{ field: 'ownerId', op: 'eq' as const, value: ownerId }];
const isUnfinished = (record: Participation) => !['completed', 'received', 'skipped'].includes(record.stage);
let sequence = 0;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function stableId(...parts: string[]): string {
  const text = parts.map(part => `${part.length}:${part}`).join('|');
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < text.length; i += 1) {
    for (let lane = 0; lane < words.length; lane += 1) {
      words[lane] = Math.imul(words[lane] ^ (text.charCodeAt(i) + lane * 17), 0x01000193) >>> 0;
    }
  }
  return words.map(word => word.toString(16).padStart(8, '0')).join('');
}

function publicAsset(asset: Asset): Asset {
  const number = String(parseInt(stableId('uploader', asset.ownerId).slice(0, 8), 16) % 10000).padStart(4, '0');
  return { ...asset, ownerId: '', cloudPath: '', uploader: asset.uploader || `用户 ${number}` };
}

function boundedText(value: unknown, field: string, max = 128): string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_INPUT', '请填写有效内容', field);
  return value.trim();
}

function paging(payload: Record<string, unknown>): { offset: number; limit: number } {
  const cursor = payload.cursor ?? '0';
  requireValue(typeof cursor === 'string' && /^(0|[1-9]\d{0,7})$/.test(cursor), 'INVALID_CURSOR', '分页参数无效');
  const limit = payload.limit ?? 20;
  requireValue(Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 50, 'INVALID_INPUT', '每页数量应为 1 至 50');
  return { offset: Number(cursor), limit: Number(limit) };
}

function page<T>(items: T[], offset: number, limit: number) {
  return { items: items.slice(offset, offset + limit), nextCursor: items.length > offset + limit ? String(offset + limit) : null };
}

function assertModerator(ctx: Context): void {
  requireValue(ctx.actor.isModerator, 'FORBIDDEN', '仅审核人员可执行此操作');
}

async function cardsFor(ctx: Context): Promise<Card[]> {
  return (await ctx.store.find<Card>('cards', { where: ownerWhere(ctx.actor.userId) })).filter(card => !card.archivedAt);
}

function withdrawalFor(record: Participation, trackings: Tracking[]): string | null {
  const tracking = trackings.find(row => row.activityId === record.activityId && row.scopeKey === record.scopeKey);
  if (tracking) return tracking.enabled ? null : tracking.withdrawnAt || record.withdrawnAt || tracking.createdAt;
  return record.withdrawnAt || null;
}

function projectWithdrawal(record: Participation, trackings: Tracking[]): Participation {
  const withdrawnAt = withdrawalFor(record, trackings);
  return withdrawnAt ? { ...record, withdrawnAt } : record.withdrawnAt ? { ...record, withdrawnAt: null } : record;
}

function matches(activity: Activity, card: Card): boolean {
  return activity.bankId === card.bankId && (!activity.issuerIds.length || activity.issuerIds.includes(card.issuerId)) &&
    (!activity.networks.length || activity.networks.includes(card.network)) && (activity.cardKind === 'any' || activity.cardKind === card.kind);
}

async function currentActivity(ctx: Context, id: string): Promise<Activity> {
  const activity = await ctx.store.get<Activity>('activities', boundedText(id, 'activityId'));
  requireValue(activity && activity.status === 'published', 'NOT_FOUND', '该活动暂不可用');
  requireValue(periodFor(activity, ctx.today), 'ACTIVITY_INACTIVE', '该活动不在当前可参与日期内');
  return activity;
}

async function scopeFor(ctx: Context, activity: Activity, cardId?: string): Promise<{ scopeKey: string; cardId?: string }> {
  if (cardId) {
    const card = await ctx.owned<Card>('cards', cardId);
    requireValue(!card.archivedAt && matches(activity, card), 'CARD_NOT_ELIGIBLE', '这张卡不符合活动条件', 'cardId');
  }
  if (activity.scope === 'card') {
    requireValue(cardId, 'CARD_REQUIRED', '请选择本次参与使用的卡片', 'cardId');
    return { scopeKey: `card:${cardId}`, cardId };
  }
  return { scopeKey: 'user', ...(cardId ? { cardId } : {}) };
}

async function ensureParticipation(ctx: Context, activity: Activity, cardId?: string, on = ctx.today, expectNew = false, expectedPeriodKey?: string): Promise<Participation> {
  const period = periodFor(activity, on);
  requireValue(period, 'ACTIVITY_INACTIVE', '该活动不在当前可参与日期内');
  const scope = await scopeFor(ctx, activity, cardId);
  requireValue(expectedPeriodKey === undefined || expectedPeriodKey === period.periodKey,
    'VERSION_CONFLICT', '活动所属期已变化，请先核对原期记录', 'expectedPeriodKey');
  const existing = await ctx.store.find<Participation>('participations', { where: [
    ...ownerWhere(ctx.actor.userId), { field: 'activityId', op: 'eq', value: activity.id },
    { field: 'periodKey', op: 'eq', value: period.periodKey }, { field: 'scopeKey', op: 'eq', value: scope.scopeKey },
  ], limit: 1 });
  if (existing[0]) {
    requireValue(!expectNew, 'VERSION_CONFLICT', '记录已更新，请刷新后重试');
    return existing[0];
  }
  const id = `p_${stableId(ctx.actor.userId, activity.id, period.periodKey, scope.scopeKey)}`;
  const collision = await ctx.store.get('participations', id);
  requireValue(!collision, 'CONFLICT', '记录标识发生冲突，请稍后重试');
  const record: Participation = {
    id, ownerId: ctx.actor.userId, activityId: activity.id, activityRevision: activity.revision,
    ...period, ...scope, snapshot: activity, stage: 'available', progress: 0, registeredAt: null,
    startedAt: null, completedAt: null, expectedOn: null, receivedOn: null, receivedMinor: null,
    version: 1, createdAt: ctx.now, updatedAt: ctx.now,
  };
  await ctx.store.set('participations', id, record);
  await ctx.audit(id, 'participation.created', undefined, record);
  return record;
}

async function resolveParticipation(ctx: Context, payload: { participationId?: string; activityId?: string; cardId?: string }, expectNew = false, expectedPeriodKey?: string): Promise<Participation> {
  if (payload.participationId) return ctx.owned<Participation>('participations', payload.participationId);
  requireValue(payload.activityId, 'INVALID_INPUT', '请选择活动');
  return ensureParticipation(ctx, await currentActivity(ctx, payload.activityId), payload.cardId, ctx.today, expectNew, expectedPeriodKey);
}

async function saveParticipation(ctx: Context, before: Participation, record: Participation, action: string): Promise<MutationResult> {
  const saved = { ...record, version: before.version + 1, updatedAt: ctx.now };
  if (saved.beforeCompletion === undefined) delete saved.beforeCompletion;
  if (saved.beforeSkip === undefined) delete saved.beforeSkip;
  if (saved.completionSource === undefined) delete saved.completionSource;
  await ctx.store.set('participations', saved.id, saved);
  await ctx.audit(saved.id, action, before, saved);
  return { id: saved.id, version: saved.version };
}

function checkVersion(record: Participation, expectedVersion: unknown): void {
  if (expectedVersion !== undefined) requireValue(Number.isInteger(expectedVersion) && expectedVersion === record.version, 'VERSION_CONFLICT', '记录已更新，请刷新后重试');
}

function completed(record: Participation, now: string): Participation {
  if (record.stage === 'completed' || record.stage === 'received') return { ...record };
  return { ...record, beforeCompletion: { stage: record.stage, progress: record.progress }, stage: 'completed', completedAt: now };
}

async function assertConsumptionEnabled(ctx: Context, record: Participation): Promise<void> {
  const trackings = await ctx.store.find<Tracking>('trackings', { where: ownerWhere(ctx.actor.userId) });
  requireValue(!withdrawalFor(record, trackings), 'PARTICIPATION_WITHDRAWN', '活动已退出，请重新参加后再记录消费');
  requireValue(record.stage !== 'received', 'INVALID_STATE', '已到账记录不能修改消费，请先撤销到账');
  requireValue(record.stage !== 'skipped', 'INVALID_STATE', '本期已跳过，请恢复参与后再记录消费');
}

function consumptionDelta(record: Participation, supplied: unknown): number {
  const unit = record.snapshot.unit;
  const counted = ['笔', '次', 'visits', 'transactions', 'count', 'times'].includes(unit);
  requireValue(supplied !== undefined || counted, 'INVALID_INPUT', '请明确填写本次计入的进度，消费金额不会自动核验活动规则', 'progressDelta');
  const delta = supplied === undefined ? 1 : supplied;
  requireValue(typeof delta === 'number' && Number.isFinite(delta) && delta > 0 && delta <= 1e9, 'INVALID_INPUT', '请填写有效的进度增量', 'progressDelta');
  requireValue(['元', '港元', '澳门元'].includes(unit) ? /^\d+(?:\.\d{1,2})?$/.test(String(delta)) : Number.isSafeInteger(delta),
    'INVALID_INPUT', '金额进度最多两位小数，次数进度必须为整数', 'progressDelta');
  return delta;
}

function consumptionProgress(record: Participation, delta: number): Participation {
  const progress = Math.round((record.progress + delta) * 100) / 100;
  requireValue(progress >= 0 && progress <= 1e9 && Number.isFinite(progress), 'CONFLICT', '消费记录与当前进度不一致，请刷新后核对');
  const stage = progress > 0 ? 'in_progress' : record.registeredAt ? 'registered' : 'available';
  let next: Participation = { ...record, progress, stage: record.stage === 'completed' ? 'completed' : stage,
    startedAt: progress > 0 ? record.startedAt : null };
  if (record.beforeCompletion) next.beforeCompletion = { stage, progress: Math.round((record.beforeCompletion.progress + delta) * 100) / 100 };
  if (record.stage === 'completed' && record.completionSource === 'consumption' && progress < record.snapshot.target) {
    next = { ...next, stage, completedAt: null, expectedOn: null, beforeCompletion: undefined, completionSource: undefined };
  }
  return next;
}

async function ensurePeriods(ctx: Context, limit: number): Promise<number> {
  let created = 0;
  const trackings = await ctx.store.find<Tracking>('trackings', { where: [...ownerWhere(ctx.actor.userId), { field: 'enabled', op: 'eq', value: true }] });
  const existing = await ctx.store.find<Participation>('participations', { where: ownerWhere(ctx.actor.userId) });
  const known = new Set(existing.map(record => `${record.activityId}|${record.periodKey}|${record.scopeKey}`));
  for (const tracking of trackings) {
    const activity = await ctx.store.get<Activity>('activities', tracking.activityId);
    if (!activity || activity.status !== 'published') continue;
    let cardId = tracking.cardId;
    if (tracking.cardId) {
      const card = await ctx.store.get<Card>('cards', tracking.cardId);
      if (!card || card.ownerId !== ctx.actor.userId || card.archivedAt || !matches(activity, card)) {
        if (activity.scope === 'card') continue;
        cardId = undefined;
      }
    }
    let on = todayCN(new Date(tracking.createdAt));
    if (on < activity.startsOn) on = activity.startsOn;
    while (on <= ctx.today && on <= activity.endsOn) {
      const period = periodFor(activity, on);
      if (!period) break;
      const key = `${activity.id}|${period.periodKey}|${tracking.scopeKey}`;
      if (!known.has(key)) {
        await ensureParticipation(ctx, activity, cardId, on);
        known.add(key);
        created += 1;
        if (created >= limit) return created;
      }
      if (period.endsOn >= ctx.today || period.endsOn >= activity.endsOn) break;
      on = addDays(period.endsOn, 1);
    }
  }
  return created;
}

async function materialize(store: Store, actor: Actor, today: string, now: string, newId: Context['newId'], includePeriods: boolean): Promise<void> {
  const batchSize = 20;
  for (;;) {
    const created = await store.transaction(async transaction => {
      const ctx = createContext(transaction, actor, today, now, newId);
      const periods = includePeriods ? await ensurePeriods(ctx, batchSize) : 0;
      const bills = periods < batchSize ? await ensureBills(ctx, batchSize - periods) : 0;
      return periods + bills;
    });
    if (created < batchSize) return;
  }
}

async function validateAssets(ctx: Context, imageIds: string[], ownerId: string, approve: boolean, field = 'entrance.imageIds'): Promise<void> {
  for (const id of imageIds) {
    const asset = await ctx.store.get<Asset>('assets', id);
    requireValue(asset && (asset.ownerId === ownerId || (approve && ctx.actor.isModerator && asset.ownerId === ctx.actor.userId)), 'INVALID_ASSET', '图片无效，请重新上传', field);
    if (approve && asset.status !== 'approved') await ctx.store.set('assets', id, { ...asset, status: 'approved' });
  }
}

async function preferences(ctx: Context): Promise<ReminderPreference> {
  const previous = await ctx.store.get<ReminderPreference>('preferences', ctx.actor.userId);
  return { ownerId: ctx.actor.userId, newActivities: false, deadlines: false, rewards: false, repayments: false, ...previous };
}

async function recognitionAssets(ctx: Context, payload: Record<string, unknown>): Promise<Asset[]> {
  requireValue(Array.isArray(payload.ids) && payload.ids.length > 0 && payload.ids.length <= 6, 'INVALID_INPUT', '请选择 1 至 6 张截图', 'ids');
  const ids = payload.ids.map(value => boundedText(value, 'ids', 80));
  requireValue(new Set(ids).size === ids.length, 'INVALID_INPUT', '请移除重复截图', 'ids');
  const assets: Asset[] = [];
  for (const id of ids) {
    const asset = await ctx.store.get<Asset>('assets', id);
    requireValue(asset && (asset.ownerId === ctx.actor.userId || ctx.actor.isModerator), 'NOT_FOUND', '图片不存在或无权识别');
    assets.push(asset);
  }
  return assets;
}

async function query(ctx: Context, action: string, payload: Record<string, unknown>, options: ServiceOptions): Promise<unknown> {
  if (action === 'session.get') return { userId: ctx.actor.userId, isModerator: ctx.actor.isModerator, today: ctx.today, month: monthOf(ctx.today), demo: Boolean(options.demo || ctx.actor.demo) };
  if (action === 'request.replay') {
    const originalAction = boundedText(payload.action, 'action', 80);
    requireValue(!queryNames.has(originalAction) && payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload),
      'INVALID_INPUT', '只能核对已提交操作的完整请求');
    const requestId = boundedText(payload.requestId, 'requestId', 128);
    const fingerprint = canonical({ action: originalAction, payload: payload.payload });
    const id = `q_${stableId(ctx.actor.userId, requestId)}`;
    const prior = await ctx.store.get<{ ownerId: string; requestId: string; fingerprint: string; result: unknown }>('requests', id);
    requireValue(prior, 'REQUEST_UNRESOLVED', '暂未查询到原操作的完成结果，请稍后继续核对');
    requireValue(prior.ownerId === ctx.actor.userId && prior.requestId === requestId && prior.fingerprint === fingerprint,
      'REQUEST_CONFLICT', '此请求标识已用于不同操作，请核对原请求');
    return prior.result;
  }
  if (action === 'preferences.get') return preferences(ctx);
  if (action === 'assets.urls') throw new DomainError('ASSET_URLS_UNAVAILABLE', '图片访问地址服务暂不可用');
  if (action === 'assets.get') {
    requireValue(Array.isArray(payload.ids) && payload.ids.length <= 20, 'INVALID_INPUT', '一次最多读取 20 张图片', 'ids');
    const ids = Array.from(new Set(payload.ids.map(value => boundedText(value, 'ids', 80))));
    const assets: Asset[] = [];
    let published: Activity[] | null = null;
    for (const id of ids) {
      const asset = await ctx.store.get<Asset>('assets', id);
      requireValue(asset, 'NOT_FOUND', '图片不存在或无权访问');
      if (asset.ownerId === ctx.actor.userId || ctx.actor.isModerator) {
        assets.push(asset);
        continue;
      }
      requireValue(asset.status === 'approved', 'NOT_FOUND', '图片不存在或无权访问');
      if (!published) published = await ctx.store.find<Activity>('activities', { where: [{ field: 'status', op: 'eq', value: 'published' }] });
      requireValue(published.some(activity => activity.entrance.imageIds.includes(asset.id)), 'NOT_FOUND', '图片不存在或无权访问');
      assets.push(publicAsset(asset));
    }
    return assets;
  }
  if (action === 'wallet.get') return getWallet(ctx);
  if (action === 'entitlements.list') return listEntitlements(ctx);
  if (action === 'entitlement.get') return getEntitlement(ctx, payload.id);
  if (action === 'catalog.list') {
    const { offset, limit } = paging(payload);
    const cards = await cardsFor(ctx);
    let activities = await ctx.store.find<Activity>('activities', { where: [
      { field: 'status', op: 'eq', value: 'published' }, { field: 'startsOn', op: 'lte', value: ctx.today },
      { field: 'endsOn', op: 'gte', value: ctx.today }, ...(payload.bankId ? [{ field: 'bankId', op: 'eq' as const, value: boundedText(payload.bankId, 'bankId') }] : []),
    ], orderBy: [{ field: 'endsOn', direction: 'asc' }, { field: 'id', direction: 'asc' }] });
    if (payload.mineOnly) activities = activities.filter(activity => cards.some(card => matches(activity, card)));
    const records = await ctx.store.find<Participation>('participations', { where: ownerWhere(ctx.actor.userId) });
    const trackings = await ctx.store.find<Tracking>('trackings', { where: ownerWhere(ctx.actor.userId) });
    const items: ActivityItem[] = activities.map(activity => {
      const participation = records.find(record => record.activityId === activity.id && record.startsOn <= ctx.today && record.endsOn >= ctx.today);
      return { activity, eligible: cards.some(card => matches(activity, card)),
        ...(participation ? { participation: projectWithdrawal(participation, trackings) } : {}),
        tracking: trackings.find(row => row.activityId === activity.id && (!participation || row.scopeKey === participation.scopeKey)) || null };
    });
    return { ...page(items, offset, limit), total: activities.length };
  }
  if (action === 'activity.get') {
    let participation: Participation | null = null;
    const cardId = payload.cardId === undefined ? undefined : boundedText(payload.cardId, 'cardId');
    if (cardId) await ctx.owned<Card>('cards', cardId);
    if (payload.participationId) {
      participation = await ctx.owned<Participation>('participations', boundedText(payload.participationId, 'participationId'));
      requireValue(!payload.activityId || participation.activityId === payload.activityId, 'NOT_FOUND', '未找到这条活动记录');
      requireValue(!cardId || participation.snapshot.scope === 'user' || participation.cardId === cardId, 'NOT_FOUND', '未找到这张卡的活动记录');
    }
    const activityId = participation?.activityId || boundedText(payload.activityId, 'activityId');
    const allRecords = await ctx.store.find<Participation>('participations', { where: [...ownerWhere(ctx.actor.userId), { field: 'activityId', op: 'eq', value: activityId }], orderBy: [{ field: 'startsOn', direction: 'desc' }] });
    if (!participation) participation = allRecords.find(record => record.startsOn <= ctx.today && record.endsOn >= ctx.today
      && (!cardId || record.snapshot.scope === 'user' || record.cardId === cardId)) || null;
    let activity = participation?.snapshot || await ctx.store.get<Activity>('activities', activityId);
    requireValue(activity && (participation || (activity.status === 'published' && periodFor(activity, ctx.today))), 'NOT_FOUND', '该活动暂不可用');
    const scopeKey = participation?.scopeKey || (cardId ? activity.scope === 'card' ? `card:${cardId}` : 'user' : undefined);
    const trackings = await ctx.store.find<Tracking>('trackings', { where: [...ownerWhere(ctx.actor.userId), { field: 'activityId', op: 'eq', value: activityId }] });
    const tracking = trackings.find(row => !scopeKey || row.scopeKey === scopeKey) || null;
    if (participation) participation = projectWithdrawal(participation, trackings);
    const audit = participation ? await ctx.store.find<AuditEvent>('audit_events', { where: [...ownerWhere(ctx.actor.userId), { field: 'entityId', op: 'eq', value: participation.id }], orderBy: [{ field: 'at', direction: 'desc' }], limit: 30 }) : [];
    const assets: Asset[] = [];
    const current = await ctx.store.get<Activity>('activities', activity.id);
    for (const id of current?.status === 'published' ? activity.entrance.imageIds : []) {
      const asset = await ctx.store.get<Asset>('assets', id);
      if (asset?.status === 'approved') assets.push(publicAsset(asset));
    }
    const consumptions = participation ? await ctx.store.find<Consumption>('consumptions', { where: [...ownerWhere(ctx.actor.userId), { field: 'participationId', op: 'eq', value: participation.id }], orderBy: [{ field: 'consumedOn', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }] }) : [];
    const detail: Detail = { activity, participation, tracking, history: allRecords.slice(0, 24).map(record => projectWithdrawal(record, trackings)), audit, assets, consumptions, eligible: (await cardsFor(ctx)).some(card => matches(activity!, card)) };
    return detail;
  }
  if (action === 'dashboard.get') {
    const all = await ctx.store.find<Participation>('participations', { where: ownerWhere(ctx.actor.userId), orderBy: [{ field: 'endsOn', direction: 'asc' }] });
    const trackings = await ctx.store.find<Tracking>('trackings', { where: ownerWhere(ctx.actor.userId) });
    const active = all.filter(record => !withdrawalFor(record, trackings));
    const wallet = await getWallet(ctx);
    return { today: ctx.today, tasks: active.filter(record => (record.startsOn <= ctx.today && record.endsOn >= ctx.today) || isUnfinished(record)), pendingRewards: active.filter(record => record.stage === 'completed'), bills: wallet.bills.filter(bill => !bill.paidAt), accounts: wallet.accounts, cards: wallet.cards };
  }
  if (action === 'history.list') {
    const { offset, limit } = paging(payload);
    const rows = await ctx.store.find<Participation>('participations', { where: [...ownerWhere(ctx.actor.userId), ...(payload.activityId ? [{ field: 'activityId', op: 'eq' as const, value: boundedText(payload.activityId, 'activityId') }] : [])], orderBy: [{ field: 'startsOn', direction: 'desc' }, { field: 'id', direction: 'asc' }] });
    requireValue(!payload.filter || ['all', 'pending', 'unfinished'].includes(String(payload.filter)), 'INVALID_INPUT', '记录筛选条件无效');
    const trackings = await ctx.store.find<Tracking>('trackings', { where: ownerWhere(ctx.actor.userId) });
    return page(rows.map(record => projectWithdrawal(record, trackings)).filter(record => payload.filter === 'pending' ? !record.withdrawnAt && record.stage === 'completed' : payload.filter === 'unfinished' ? !record.withdrawnAt && isUnfinished(record) : true), offset, limit);
  }
  if (action === 'rewards.get') {
    const month = payload.month || monthOf(ctx.today);
    requireValue(typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'INVALID_INPUT', '请选择有效月份', 'month');
    const currency = payload.currency || 'CNY';
    requireValue(currencies.has(String(currency)), 'INVALID_INPUT', '请选择有效币种', 'currency');
    const { offset, limit } = paging(payload);
    const rewards = (await ctx.store.find<Reward>('rewards', { where: [...ownerWhere(ctx.actor.userId), { field: 'currency', op: 'eq', value: currency }], orderBy: [{ field: 'receivedOn', direction: 'desc' }, { field: 'id', direction: 'asc' }] })).filter(reward => !reward.reversedAt && reward.receivedOn.startsWith(`${month}-`));
    const records = await ctx.store.find<Participation>('participations', { where: ownerWhere(ctx.actor.userId) });
    const trackings = await ctx.store.find<Tracking>('trackings', { where: ownerWhere(ctx.actor.userId) });
    const allPending = records.filter(record => !withdrawalFor(record, trackings) && record.stage === 'completed');
    const pending = allPending.filter(record => record.snapshot.currency === currency);
    const pendingCounts = { CNY: 0, HKD: 0, MOP: 0 };
    allPending.forEach(record => { pendingCounts[record.snapshot.currency] += 1; });
    const received = rewards.slice(offset, offset + limit);
    const receivedIds = new Set(received.map(reward => reward.participationId));
    const cardIds = Object.fromEntries(records.filter(record => record.cardId && receivedIds.has(record.id)).map(record => [record.id, record.cardId!]));
    const recordKinds = new Map(records.map(record => [record.id, record.snapshot.rewardKind]));
    const rewardKinds = Object.fromEntries(received.map(reward => [reward.participationId, recordKinds.get(reward.participationId) || 'cashback']));
    const cashbackMinor = rewards.filter(reward => !recordKinds.has(reward.participationId) || recordKinds.get(reward.participationId) === 'cashback').reduce((sum, reward) => sum + reward.amountMinor, 0);
    const discountMinor = rewards.filter(reward => recordKinds.get(reward.participationId) === 'discount').reduce((sum, reward) => sum + reward.amountMinor, 0);
    const cards = await ctx.store.find<Card>('cards', { where: ownerWhere(ctx.actor.userId) });
    return { month, currency, totalMinor: rewards.filter(reward => recordKinds.get(reward.participationId) !== 'points').reduce((sum, reward) => sum + reward.amountMinor, 0), cashbackMinor, discountMinor, rewardKinds, pending, received, nextCursor: rewards.length > offset + limit ? String(offset + limit) : null, cards, cardIds, pendingCounts };
  }
  if (action === 'submissions.list') {
    if (payload.moderation) assertModerator(ctx);
    requireValue(!payload.status || ['pending', 'returned', 'published'].includes(String(payload.status)), 'INVALID_INPUT', '投稿筛选条件无效');
    const { offset, limit } = paging(payload);
    const rows = await ctx.store.find<Submission>('submissions', { where: [...(payload.moderation ? [] : ownerWhere(ctx.actor.userId)), ...(payload.status ? [{ field: 'status', op: 'eq' as const, value: payload.status }] : [])], orderBy: [{ field: 'updatedAt', direction: 'desc' }, { field: 'id', direction: 'asc' }], offset, limit: limit + 1 });
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(offset + limit) : null };
  }
  if (action === 'submission.get') {
    const submission = await ctx.store.get<Submission>('submissions', boundedText(payload.id, 'id'));
    requireValue(submission && (submission.ownerId === ctx.actor.userId || ctx.actor.isModerator), 'NOT_FOUND', '未找到这条投稿');
    return submission;
  }
  throw new DomainError('INVALID_ACTION', '不支持此操作');
}

async function command(ctx: Context, action: string, payload: any, options: ServiceOptions): Promise<unknown> {
  if (action === 'entitlement.save') return saveEntitlement(ctx, payload);
  if (action === 'entitlement.use') return useEntitlement(ctx, payload);
  if (action === 'entitlement.undo') return undoEntitlementUsage(ctx, payload);
  if (action === 'entitlement.archive') return archiveEntitlement(ctx, payload);
  if (action === 'activity.join') {
    const activity = await currentActivity(ctx, payload.activityId);
    const record = await ensureParticipation(ctx, activity, payload.cardId);
    const previous = (await ctx.store.find<Tracking>('trackings', { where: [...ownerWhere(ctx.actor.userId), { field: 'activityId', op: 'eq', value: activity.id }, { field: 'scopeKey', op: 'eq', value: record.scopeKey }], limit: 1 }))[0] || null;
    const id = previous?.id || `t_${stableId(ctx.actor.userId, activity.id, record.scopeKey)}`;
    if (previous) requireValue(previous.ownerId === ctx.actor.userId && previous.activityId === activity.id && previous.scopeKey === record.scopeKey, 'CONFLICT', '记录标识发生冲突');
    const selectedCard = activity.scope === 'card' ? record.cardId : payload.cardId;
    const tracking: Tracking = { id, ownerId: ctx.actor.userId, activityId: activity.id, scopeKey: record.scopeKey, ...(selectedCard ? { cardId: selectedCard } : {}), enabled: true, createdAt: previous?.enabled ? previous.createdAt : ctx.now };
    await ctx.store.set('trackings', id, tracking);
    await ctx.audit(record.id, 'tracking.enabled', previous, tracking);
    if (record.withdrawnAt) return saveParticipation(ctx, record, { ...record, withdrawnAt: null }, 'participation.rejoined');
    return { id: record.id, version: record.version };
  }
  if (action === 'activity.untrack') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    const trackings = await ctx.store.find<Tracking>('trackings', { where: [...ownerWhere(ctx.actor.userId), { field: 'activityId', op: 'eq', value: record.activityId }, { field: 'scopeKey', op: 'eq', value: record.scopeKey }] });
    for (const tracking of trackings) await ctx.store.set('trackings', tracking.id, { ...tracking, enabled: false, withdrawnAt: tracking.withdrawnAt || ctx.now });
    await ctx.audit(record.id, 'tracking.disabled');
    if (record.withdrawnAt) return { id: record.id, version: record.version };
    return saveParticipation(ctx, record, { ...record, withdrawnAt: ctx.now }, 'participation.withdrawn');
  }
  if (action === 'participation.progress') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    checkVersion(record, payload.expectedVersion);
    requireValue(isUnfinished(record), 'INVALID_STATE', '请先撤销完成或恢复本期参与');
    requireValue(typeof payload.registered === 'boolean', 'INVALID_INPUT', '请选择报名状态', 'registered');
    requireValue(Number.isFinite(payload.progress) && payload.progress >= 0 && payload.progress <= 1e9, 'INVALID_INPUT', '请填写有效进度', 'progress');
    const next: Participation = { ...record, progress: payload.progress, registeredAt: payload.registered ? record.registeredAt || ctx.now : null, startedAt: payload.progress > 0 ? record.startedAt || ctx.now : null, stage: payload.progress > 0 ? 'in_progress' : payload.registered ? 'registered' : 'available' };
    return saveParticipation(ctx, record, next, 'participation.progress');
  }
  if (action === 'participation.consume') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    requireValue(Number.isSafeInteger(payload.expectedVersion), 'VERSION_CONFLICT', '记录已更新，请刷新后重试', 'expectedVersion');
    checkVersion(record, payload.expectedVersion);
    await assertConsumptionEnabled(ctx, record);
    const consumedOn = assertDate(payload.consumedOn, 'consumedOn');
    requireValue(consumedOn <= ctx.today && consumedOn >= record.startsOn && consumedOn <= record.endsOn, 'INVALID_DATE', '消费日期应在原活动期内，且不能晚于今天', 'consumedOn');
    const amountMinor = payload.amountMinor === undefined ? null : payload.amountMinor;
    requireValue(amountMinor === null || (Number.isSafeInteger(amountMinor) && amountMinor >= 0 && amountMinor <= 1e11), 'INVALID_INPUT', '请填写有效的消费金额', 'amountMinor');
    const merchant = payload.merchant === undefined ? '' : payload.merchant;
    requireValue(typeof merchant === 'string' && merchant.trim().length <= 120 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(merchant), 'INVALID_INPUT', '商户名称最多填写 120 字', 'merchant');
    const progressDelta = consumptionDelta(record, payload.progressDelta);
    const consumption: Consumption = { id: ctx.newId('c'), ownerId: ctx.actor.userId, participationId: record.id, amountMinor,
      currency: record.snapshot.currency, merchant: merchant.trim(), consumedOn, progressDelta, reversedAt: null, createdAt: ctx.now };
    let next = consumptionProgress(record, progressDelta);
    next.startedAt ||= ctx.now;
    if (next.stage !== 'completed' && next.progress >= record.snapshot.target) next = { ...completed(next, ctx.now), completionSource: 'consumption' };
    await ctx.store.set('consumptions', consumption.id, consumption);
    const result = await saveParticipation(ctx, record, next, 'participation.consumed');
    await ctx.audit(consumption.id, 'consumption.created', undefined, consumption);
    return { id: consumption.id, version: result.version };
  }
  if (action === 'consumption.revoke') {
    const consumption = await ctx.owned<Consumption>('consumptions', payload.id);
    const record = await ctx.owned<Participation>('participations', consumption.participationId);
    requireValue(Number.isSafeInteger(payload.expectedVersion), 'VERSION_CONFLICT', '记录已更新，请刷新后重试', 'expectedVersion');
    checkVersion(record, payload.expectedVersion);
    await assertConsumptionEnabled(ctx, record);
    requireValue(!consumption.reversedAt, 'CONSUMPTION_REVERSED', '这条消费记录已撤销');
    requireValue(record.progress >= consumption.progressDelta, 'CONFLICT', '消费记录与当前进度不一致，请刷新后核对');
    const reversed: Consumption = { ...consumption, reversedAt: ctx.now };
    await ctx.store.set('consumptions', consumption.id, reversed);
    const result = await saveParticipation(ctx, record, consumptionProgress(record, -consumption.progressDelta), 'participation.consumption_reverted');
    await ctx.audit(consumption.id, 'consumption.reversed', consumption, reversed);
    return result;
  }
  if (action === 'participation.complete') {
    const record = await resolveParticipation(ctx, payload);
    if (record.stage === 'completed' || record.stage === 'received') return { id: record.id, version: record.version };
    return saveParticipation(ctx, record, completed(record, ctx.now), 'participation.completed');
  }
  if (action === 'participation.undoComplete') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    requireValue(record.stage === 'completed', 'INVALID_STATE', record.stage === 'received' ? '请先撤销到账，再撤销完成' : '当前记录尚未完成');
    const restored = record.beforeCompletion || { stage: record.progress > 0 ? 'in_progress' as const : record.registeredAt ? 'registered' as const : 'available' as const, progress: record.progress };
    return saveParticipation(ctx, record, { ...record, ...restored, completedAt: null, expectedOn: null, beforeCompletion: undefined, completionSource: undefined }, 'participation.completion_reverted');
  }
  if (action === 'participation.skip') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    requireValue(typeof payload.skipped === 'boolean', 'INVALID_INPUT', '操作参数无效');
    if (payload.skipped) {
      requireValue(isUnfinished(record) || record.stage === 'skipped', 'INVALID_STATE', '已完成或已到账记录不可跳过');
      if (record.stage === 'skipped') return { id: record.id, version: record.version };
      return saveParticipation(ctx, record, { ...record, beforeSkip: { stage: record.stage, progress: record.progress }, stage: 'skipped' }, 'participation.skipped');
    }
    requireValue(record.stage === 'skipped', 'INVALID_STATE', '该记录没有跳过');
    return saveParticipation(ctx, record, { ...record, ...(record.beforeSkip || { stage: 'available' as const, progress: 0 }), beforeSkip: undefined }, 'participation.resumed');
  }
  if (action === 'participation.expected') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    requireValue(record.stage === 'completed', 'INVALID_STATE', '请先标记完成，再设置到账提醒');
    const expectedOn = payload.expectedOn === null ? null : assertDate(payload.expectedOn, 'expectedOn');
    requireValue(!expectedOn || expectedOn >= record.startsOn, 'INVALID_INPUT', '预计到账日期不能早于本期开始', 'expectedOn');
    return saveParticipation(ctx, record, { ...record, expectedOn }, 'participation.expected_date');
  }
  if (action === 'reward.confirm') {
    requireValue(payload.expectNew === undefined || typeof payload.expectNew === 'boolean', 'INVALID_INPUT', '记录创建条件无效', 'expectNew');
    requireValue(!payload.expectNew || (payload.participationId === undefined && payload.expectedVersion === undefined), 'INVALID_INPUT', '新建记录不能同时指定已有记录或版本', 'expectNew');
    requireValue(payload.expectedPeriodKey === undefined || (payload.expectNew === true && typeof payload.expectedPeriodKey === 'string'
      && /^(?:once|\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?|(?:week|month|custom):\d{4}-\d{2}-\d{2})$/.test(payload.expectedPeriodKey) && !payload.expectedPeriodKey.startsWith('0000')),
      'INVALID_INPUT', '新建记录的所属期无效', 'expectedPeriodKey');
    const record = await resolveParticipation(ctx, payload, payload.expectNew === true, payload.expectedPeriodKey);
    checkVersion(record, payload.expectedVersion);
    requireValue(Number.isSafeInteger(payload.amountMinor) && payload.amountMinor >= 0 && payload.amountMinor <= 1e11, 'INVALID_INPUT', record.snapshot.rewardKind === 'discount' ? '请填写有效优惠金额' : '请填写有效到账金额', 'amountMinor');
    requireValue(record.snapshot.rewardKind !== 'points' || payload.amountMinor % 100 === 0, 'INVALID_INPUT', '积分必须为整数', 'amountMinor');
    const receivedOn = assertDate(payload.receivedOn, 'receivedOn');
    requireValue(receivedOn >= record.startsOn && receivedOn <= ctx.today, 'INVALID_INPUT', record.snapshot.rewardKind === 'discount' ? '享受优惠日期应在本期开始至今天之间' : '到账日期应在本期开始至今天之间', 'receivedOn');
    const rewardId = `r_${stableId(ctx.actor.userId, record.id)}`;
    const previous = await ctx.store.get<Reward>('rewards', rewardId);
    if (previous) requireValue(previous.ownerId === ctx.actor.userId && previous.participationId === record.id, 'CONFLICT', record.snapshot.rewardKind === 'discount' ? '优惠记录标识冲突' : '到账记录标识冲突');
    const reward: Reward = { id: rewardId, ownerId: ctx.actor.userId, participationId: record.id, title: record.snapshot.title, bankId: record.snapshot.bankId, activityPeriod: record.periodKey, currency: record.snapshot.currency, amountMinor: payload.amountMinor, receivedOn, reversedAt: null, version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || ctx.now, updatedAt: ctx.now };
    await ctx.store.set('rewards', rewardId, reward);
    const result = await saveParticipation(ctx, record, { ...completed(record, ctx.now), stage: 'received', receivedOn, receivedMinor: payload.amountMinor }, previous && !previous.reversedAt ? 'reward.corrected' : 'reward.confirmed');
    await ctx.audit(rewardId, previous && !previous.reversedAt ? 'reward.corrected' : 'reward.confirmed', previous, reward);
    return result;
  }
  if (action === 'reward.revoke') {
    const record = await ctx.owned<Participation>('participations', payload.participationId);
    requireValue(record.stage === 'received', 'INVALID_STATE', record.snapshot.rewardKind === 'discount' ? '当前记录尚未登记已享优惠' : '当前记录尚未确认到账');
    const rewards = await ctx.store.find<Reward>('rewards', { where: [...ownerWhere(ctx.actor.userId), { field: 'participationId', op: 'eq', value: record.id }] });
    for (const reward of rewards.filter(row => !row.reversedAt)) {
      const revoked = { ...reward, reversedAt: ctx.now, version: reward.version + 1, updatedAt: ctx.now };
      await ctx.store.set('rewards', reward.id, revoked);
      await ctx.audit(reward.id, 'reward.revoked', reward, revoked);
    }
    return saveParticipation(ctx, record, { ...record, stage: 'completed', receivedOn: null, receivedMinor: null }, 'reward.revoked');
  }
  if (action === 'card.save') return saveCard(ctx, payload);
  if (action === 'card.remove') return removeCard(ctx, payload);
  if (action === 'bill.update') return updateBill(ctx, payload);
  if (action === 'submission.save') {
    const previous = payload.id ? await ctx.owned<Submission>('submissions', payload.id) : null;
    requireValue(previous?.status !== 'published', 'IMMUTABLE', '已发布投稿不可修改，请重新提交新的活动线索');
    if (previous) requireValue(Number.isInteger(payload.expectedVersion) && payload.expectedVersion === previous.version, 'VERSION_CONFLICT', '投稿已更新，请刷新后重新编辑');
    const draft = validateDraft(payload.draft, false);
    if (!previous) requireValue(draft.endsOn >= ctx.today, 'INVALID_INPUT', '活动已经结束，请核实日期后再创建投稿。', 'endsOn');
    await validateAssets(ctx, draft.entrance.imageIds, ctx.actor.userId, false);
    const id = previous?.id || ctx.newId('submission');
    const submission: Submission = { id, ownerId: ctx.actor.userId, draft, ...(previous?.lead ? { lead: previous.lead } : {}), status: 'pending', reviewNote: '', createdAt: previous?.createdAt || ctx.now, updatedAt: ctx.now, version: (previous?.version || 0) + 1 };
    await ctx.store.set('submissions', id, submission);
    await ctx.audit(id, 'submission.saved', previous, submission);
    return { id, version: submission.version };
  }
  if (action === 'submission.lead.save') {
    const previous = payload.id ? await ctx.owned<Submission>('submissions', payload.id) : null;
    requireValue(previous?.status !== 'published', 'IMMUTABLE', '已发布投稿不可修改，请重新提交新的活动线索');
    requireValue(!previous || !previous.draft, 'INVALID_STATE', '这条投稿已有完整规则，请从完整投稿页面修改');
    if (previous) requireValue(Number.isInteger(payload.expectedVersion) && payload.expectedVersion === previous.version, 'VERSION_CONFLICT', '投稿已更新，请刷新后重新编辑');
    const lead = validateLead(payload.lead);
    await validateAssets(ctx, lead.imageIds, ctx.actor.userId, false, 'imageIds');
    if (lead.rules?.entrance) await validateAssets(ctx, lead.rules.entrance.imageIds, ctx.actor.userId, false, 'rules.entrance.imageIds');
    const id = previous?.id || ctx.newId('submission');
    const submission: Submission = { id, ownerId: ctx.actor.userId, lead, draft: null, status: 'pending', reviewNote: '', createdAt: previous?.createdAt || ctx.now, updatedAt: ctx.now, version: (previous?.version || 0) + 1 };
    await ctx.store.set('submissions', id, submission);
    await ctx.audit(id, 'submission.lead_saved', previous, submission);
    return { id, version: submission.version };
  }
  if (action === 'submission.review') {
    assertModerator(ctx);
    const submission = await ctx.store.get<Submission>('submissions', boundedText(payload.id, 'id'));
    requireValue(submission, 'NOT_FOUND', '未找到这条投稿');
    requireValue(submission.status === 'pending', 'INVALID_STATE', '这条投稿已经处理过');
    requireValue(Number.isInteger(payload.expectedVersion) && payload.expectedVersion === submission.version, 'VERSION_CONFLICT', '投稿已更新，请刷新后重新审核');
    requireValue(payload.decision === 'publish' || payload.decision === 'return', 'INVALID_INPUT', '请选择审核结果');
    if (payload.decision === 'return') {
      const reviewNote = boundedText(payload.reviewNote, 'reviewNote', 1000);
      const updated = { ...submission, status: 'returned' as const, reviewNote, updatedAt: ctx.now, version: submission.version + 1 };
      await ctx.store.set('submissions', submission.id, updated);
      await ctx.audit(submission.id, 'submission.returned', submission, updated, submission.ownerId);
      return { id: submission.id, version: updated.version };
    }
    requireValue(payload.sourceVerified === true, 'SOURCE_UNVERIFIED', '请核实银行官方来源及参与入口', 'sourceVerified');
    const draft = validateDraft(payload.draft || submission.draft, true);
    await validateAssets(ctx, draft.entrance.imageIds, submission.ownerId, true);
    const id = ctx.newId('activity');
    const activity: Activity = { ...draft, id, revision: 1, status: 'published', publishedAt: ctx.now, updatedAt: ctx.now, publishedBy: ctx.actor.userId, entrance: { ...draft.entrance, verifiedAt: ctx.now } };
    await ctx.store.set('activities', id, activity);
    await ctx.store.set('activity_revisions', `${id}_1`, activity);
    const updated = { ...submission, draft, status: 'published' as const, activityId: id, reviewNote: '', updatedAt: ctx.now, version: submission.version + 1 };
    await ctx.store.set('submissions', submission.id, updated);
    await ctx.audit(submission.id, 'submission.published', submission, updated, submission.ownerId);
    await ctx.audit(id, 'activity.published', undefined, activity);
    return { id, version: 1 };
  }
  if (action === 'activity.withdraw') {
    assertModerator(ctx);
    const activity = await ctx.store.get<Activity>('activities', boundedText(payload.activityId, 'activityId'));
    requireValue(activity, 'NOT_FOUND', '未找到这条活动');
    if (activity.status === 'withdrawn') return { id: activity.id, version: activity.revision };
    const updated = { ...activity, status: 'withdrawn' as const, updatedAt: ctx.now };
    await ctx.store.set('activities', activity.id, updated);
    await ctx.audit(activity.id, 'activity.withdrawn', activity, updated);
    return { id: activity.id, version: activity.revision };
  }
  if (action === 'preferences.save') {
    requireValue(['newActivities', 'deadlines', 'rewards', 'repayments'].every(key => typeof payload[key] === 'boolean'), 'INVALID_INPUT', '提醒设置无效');
    const next: ReminderPreference = { ownerId: ctx.actor.userId, newActivities: payload.newActivities, deadlines: payload.deadlines, rewards: payload.rewards, repayments: payload.repayments };
    await ctx.store.set('preferences', ctx.actor.userId, next);
    return { id: ctx.actor.userId };
  }
  if (action === 'reminder.authorize') {
    requireValue(['new_activity', 'deadline', 'reward', 'repayment'].includes(payload.kind) && typeof payload.accepted === 'boolean', 'INVALID_INPUT', '提醒授权参数无效');
    const templateId = options.templateIds?.[payload.kind as ReminderJob['kind']];
    requireValue(templateId && payload.templateId === templateId, 'TEMPLATE_UNAVAILABLE', '当前提醒模板尚未配置');
    if (payload.kind === 'new_activity') {
      requireValue(payload.entityId === 'matches', 'INVALID_INPUT', '新活动提醒仅适用于我的持卡匹配', 'entityId');
      requireValue((await cardsFor(ctx)).length > 0, 'CARD_REQUIRED', '请先添加至少一张卡片，再订阅匹配活动');
    } else if (payload.kind === 'repayment') {
      const bill = await ctx.owned<Bill>('bills', payload.entityId);
      const account = await ctx.owned<BillingAccount>('billing_accounts', bill.billingAccountId);
      requireValue(account.enabled, 'REMINDER_UNAVAILABLE', '账户已停用，历史账单不再提供微信提醒。');
      requireValue(!bill.paidAt, 'REMINDER_UNAVAILABLE', '账单已标记还款，无需申请微信提醒。');
      requireValue(bill.dueOn >= ctx.today, 'REMINDER_UNAVAILABLE', '还款日已过，不再提供这期账单的微信提醒。');
    } else {
      const record = await ctx.owned<Participation>('participations', payload.entityId);
      const trackings = await ctx.store.find<Tracking>('trackings', { where: ownerWhere(ctx.actor.userId) });
      requireValue(!withdrawalFor(record, trackings), 'REMINDER_UNAVAILABLE', '活动已退出，请重新参加后再申请提醒');
      if (payload.kind === 'deadline') {
        requireValue(isUnfinished(record) && record.endsOn >= ctx.today, 'REMINDER_UNAVAILABLE', '活动已结束或无需继续参与，不再提供截止提醒。');
      } else {
        requireValue(record.stage === 'completed' && record.expectedOn, 'REMINDER_UNAVAILABLE', '仅已完成且设置预计到账日期的记录可申请到账提醒。');
      }
    }
    const id = `g_${stableId(ctx.actor.userId, payload.kind, payload.entityId, templateId)}`;
    const previous = await ctx.store.get<{ remaining: number }>('reminder_grants', id);
    await ctx.store.set('reminder_grants', id, { id, ownerId: ctx.actor.userId, kind: payload.kind, entityId: payload.entityId, templateId, remaining: payload.accepted ? (previous?.remaining || 0) + 1 : previous?.remaining || 0, acceptedAt: payload.accepted ? ctx.now : null, updatedAt: ctx.now });
    if (payload.kind === 'new_activity' && payload.accepted) {
      const current = await preferences(ctx);
      if (!current.newActivities) await ctx.store.set('preferences', ctx.actor.userId, { ...current, newActivities: true });
    }
    return { id };
  }
  if (action === 'asset.register') {
    const id = boundedText(payload.id, 'id', 80);
    requireValue(/^[a-zA-Z0-9_-]+$/.test(id), 'INVALID_INPUT', '图片标识无效');
    const fileId = boundedText(payload.fileId, 'fileId', 1024);
    const cloudPath = boundedText(payload.cloudPath, 'cloudPath', 512);
    const extensions: Record<string, string[]> = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
    requireValue((extensions[payload.mime] || []).some(extension => cloudPath === `uploads/${ctx.actor.userId}/${id}.${extension}`), 'INVALID_ASSET', '图片上传位置无效');
    requireValue(fileId.startsWith('cloud://') || Boolean(options.demo || ctx.actor.demo), 'INVALID_ASSET', '图片文件地址无效');
    requireValue(Number.isSafeInteger(payload.size) && payload.size > 0 && payload.size <= 5 * 1024 * 1024, 'INVALID_ASSET', '图片应小于 5 MB', 'image');
    requireValue(['image/jpeg', 'image/png', 'image/webp'].includes(payload.mime), 'INVALID_ASSET', '请选择 JPG、PNG 或 WebP 图片', 'image');
    const existing = await ctx.store.get<Asset>('assets', id);
    requireValue(!existing, 'CONFLICT', '图片标识已存在，请重新上传');
    requireValue(options.validateAsset || options.demo || ctx.actor.demo, 'ASSET_VERIFICATION_UNAVAILABLE', '图片验证服务尚未配置');
    const canonicalAsset = options.validateAsset ? await options.validateAsset(ctx.actor, { id, fileId, cloudPath, size: payload.size, mime: payload.mime }) : undefined;
    const verifiedAsset = canonicalAsset || { fileId, cloudPath, size: payload.size, mime: payload.mime };
    const asset: Asset = { id, ownerId: ctx.actor.userId, fileId: verifiedAsset.fileId, cloudPath: verifiedAsset.cloudPath, size: verifiedAsset.size, mime: verifiedAsset.mime, status: 'pending', createdAt: ctx.now };
    await ctx.store.set('assets', id, asset);
    return { id };
  }
  throw new DomainError('INVALID_ACTION', '不支持此操作');
}

export function createService(store: Store, options: ServiceOptions = {}) {
  return {
    async execute(actor: Actor, request: ApiRequest): Promise<unknown> {
      requireValue(actor && typeof actor.userId === 'string' && actor.userId.length > 0, 'UNAUTHENTICATED', '请先登录');
      requireValue(request && typeof request.action === 'string' && request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload), 'INVALID_INPUT', '请求参数无效');
      const instant = (options.now || (() => new Date()))();
      const now = instant.toISOString();
      const today = todayCN(instant);
      const newId = (prefix: string) => `${prefix}_${stableId(actor.userId, now, String(++sequence), String(Math.random()))}`;
      let mutation: { requestId: string; fingerprint: string; id: string } | null = null;
      if (!queryNames.has(request.action)) {
        const requestId = boundedText((request as { requestId?: string }).requestId, 'requestId', 128);
        mutation = { requestId, fingerprint: canonical({ action: request.action, payload: request.payload }), id: `q_${stableId(actor.userId, requestId)}` };
        const prior = await store.get<{ ownerId: string; requestId: string; fingerprint: string; result: unknown }>('requests', mutation.id);
        if (prior) {
          requireValue(prior.ownerId === actor.userId && prior.requestId === requestId && prior.fingerprint === mutation.fingerprint, 'REQUEST_CONFLICT', '此请求标识已用于不同操作，请重新提交');
          return prior.result;
        }
      }
      if (request.action === 'activity.untrack') {
        await createContext(store, actor, today, now, newId).owned<Participation>('participations', (request.payload as Commands['activity.untrack']).participationId);
      }
      if (request.action === 'assets.recognize') {
        const assets = await store.transaction(transaction => recognitionAssets(createContext(transaction, actor, today, now, newId), request.payload as Record<string, unknown>));
        const demo = Boolean(options.demo || actor.demo);
        requireValue(demo || options.recognizeAssets, 'OCR_UNAVAILABLE', '截图识别服务尚未配置，请手动填写活动信息');
        // External provider requests must not repeat when a store transaction replans.
        const items = demo ? demoRecognition(assets) : await options.recognizeAssets!(actor, assets);
        return { items: normalizeRecognition(items, assets), demo };
      }
      if (['dashboard.get', 'catalog.list', 'activity.untrack'].includes(request.action)) await materialize(store, actor, today, now, newId, true);
      else if (request.action === 'wallet.get') await materialize(store, actor, today, now, newId, false);
      return store.transaction(async transaction => {
        const ctx = createContext(transaction, actor, today, now, newId);
        if (queryNames.has(request.action)) return query(ctx, request.action, request.payload as Record<string, unknown>, options);
        const { requestId, fingerprint, id } = mutation!;
        const prior = await transaction.get<{ ownerId: string; requestId: string; fingerprint: string; result: unknown }>('requests', id);
        if (prior) {
          requireValue(prior.ownerId === actor.userId && prior.requestId === requestId && prior.fingerprint === fingerprint, 'REQUEST_CONFLICT', '此请求标识已用于不同操作，请重新提交');
          return prior.result;
        }
        const result = await command(ctx, request.action, request.payload, options);
        await transaction.set('requests', id, { id, ownerId: actor.userId, requestId, fingerprint, result, createdAt: now });
        return result;
      });
    },
  };
}

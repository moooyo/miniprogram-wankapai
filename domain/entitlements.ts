import {
  Card, Commands, Entitlement, EntitlementDetail, EntitlementDraft, EntitlementList, EntitlementUsage,
  LoungeAccess, MutationResult,
} from '../shared/contracts';
import { assertDate } from './calendar';
import { Context } from './context';
import { requireValue } from './errors';

type InputObject = Record<string, unknown>;
const ownerWhere = (ownerId: string) => [{ field: 'ownerId', op: 'eq' as const, value: ownerId }];

function object(value: unknown, field: string): InputObject {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', '请填写完整权益资料', field);
  return value as InputObject;
}

function text(value: unknown, field: string, max: number, required = false): string {
  requireValue(typeof value === 'string', 'INVALID_INPUT', '请填写有效文字', field);
  const output = value.trim();
  requireValue(!required || output.length > 0, 'INVALID_INPUT', '此项不能为空', field);
  requireValue(output.length <= max, 'INVALID_INPUT', `此项不能超过 ${max} 个字符`, field);
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(output), 'INVALID_INPUT', '文字中包含无效字符', field);
  return output;
}

function id(value: unknown, field: string): string {
  const output = text(value, field, 128, true);
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(output), 'INVALID_INPUT', '记录标识无效', field);
  return output;
}

function integer(value: unknown, min: number, max: number, field: string): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max,
    'INVALID_INPUT', `请填写 ${min} 至 ${max} 之间的整数`, field);
  return value;
}

function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  requireValue(typeof value === 'string' && choices.includes(value as T), 'INVALID_INPUT', '请选择有效选项', field);
  return value as T;
}

function checkVersion(record: Entitlement, expectedVersion: unknown): void {
  requireValue(Number.isSafeInteger(expectedVersion) && expectedVersion === record.version,
    'VERSION_CONFLICT', '权益记录已更新，请刷新后重新核对', 'expectedVersion');
}

function supportedBanks(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  requireValue(Array.isArray(value) && value.length <= 30, 'INVALID_INPUT', '支持银行最多可填写 30 家', field);
  return Array.from(new Set(Array.from(value, name => text(name, field, 120, true))));
}

function lounge(input: unknown, index: number, today: string): LoungeAccess {
  const field = `lounges.${index}`;
  const source = object(input, field);
  const airportCode = text(source.airportCode, `${field}.airportCode`, 3).toUpperCase();
  requireValue(!airportCode || /^[A-Z]{3}$/.test(airportCode), 'INVALID_INPUT', '机场代码应为三个英文字母', `${field}.airportCode`);
  const customerScope = choice(source.customerScope, ['all', 'local_bank', 'specified', 'unknown'] as const, `${field}.customerScope`);
  const customerNote = text(source.customerNote, `${field}.customerNote`, 1000, customerScope === 'local_bank' || customerScope === 'specified');
  const verifiedOn = text(source.verifiedOn, `${field}.verifiedOn`, 10);
  if (verifiedOn) {
    assertDate(verifiedOn, `${field}.verifiedOn`);
    requireValue(verifiedOn <= today, 'INVALID_DATE', '核实日期不能晚于今天', `${field}.verifiedOn`);
  }
  return {
    id: id(source.id, `${field}.id`),
    airportName: text(source.airportName, `${field}.airportName`, 120, true), airportCode,
    city: text(source.city, `${field}.city`, 80), loungeName: text(source.loungeName, `${field}.loungeName`, 120, true),
    terminal: text(source.terminal, `${field}.terminal`, 40), supportedBanks: supportedBanks(source.supportedBanks, `${field}.supportedBanks`),
    zone: choice(source.zone, ['domestic', 'international', 'both', 'unknown'] as const, `${field}.zone`),
    reservation: choice(source.reservation, ['required', 'not_required', 'unknown'] as const, `${field}.reservation`),
    advanceHours: integer(source.advanceHours, 0, 720, `${field}.advanceHours`),
    reservationNote: text(source.reservationNote, `${field}.reservationNote`, 1000), customerScope, customerNote,
    guestNote: text(source.guestNote, `${field}.guestNote`, 1000), openingHours: text(source.openingHours, `${field}.openingHours`, 200),
    location: text(source.location, `${field}.location`, 300), unitsPerVisit: integer(source.unitsPerVisit, 1, 9999, `${field}.unitsPerVisit`),
    sourceNote: text(source.sourceNote, `${field}.sourceNote`, 1000), verifiedOn,
  };
}

function draft(input: unknown, today: string): EntitlementDraft {
  const source = object(input, 'draft');
  const kind = choice(source.kind, ['lounge', 'health_check', 'other'] as const, 'kind');
  const startsOn = assertDate(source.startsOn, 'startsOn');
  const endsOn = assertDate(source.endsOn, 'endsOn');
  requireValue(endsOn >= startsOn, 'INVALID_DATE', '结束日期不能早于开始日期', 'endsOn');
  const totalUses = integer(source.totalUses, 0, 9999, 'totalUses');
  const initialUsed = integer(source.initialUsed, 0, 9999, 'initialUsed');
  requireValue(initialUsed <= totalUses, 'INVALID_INPUT', '初始已用次数不能超过总次数', 'initialUsed');
  const cardId = text(source.cardId, 'cardId', 128);
  if (cardId) id(cardId, 'cardId');
  requireValue(Array.isArray(source.lounges) && source.lounges.length <= 30, 'INVALID_INPUT', '每项权益最多可记录 30 间休息室', 'lounges');
  requireValue(kind === 'lounge' || source.lounges.length === 0, 'INVALID_INPUT', '仅机场贵宾厅权益可关联休息室', 'lounges');
  const lounges = source.lounges.map((value, index) => lounge(value, index, today));
  const identifiers = new Set<string>();
  lounges.forEach((item, index) => {
    requireValue(!identifiers.has(item.id), 'INVALID_INPUT', '休息室标识不能重复', `lounges.${index}.id`);
    identifiers.add(item.id);
  });
  return {
    title: text(source.title, 'title', 80, true), kind, cardId, provider: text(source.provider, 'provider', 120),
    totalUses, initialUsed, startsOn, endsOn,
    transferability: choice(source.transferability, ['allowed', 'grey', 'not_allowed'] as const, 'transferability'),
    transferNote: text(source.transferNote, 'transferNote', 1000), notes: text(source.notes, 'notes', 2000), lounges,
  };
}

async function ownedCards(ctx: Context): Promise<Card[]> {
  return ctx.store.find<Card>('cards', { where: ownerWhere(ctx.actor.userId), orderBy: [{ field: 'createdAt', direction: 'desc' }] });
}

async function usageHistory(ctx: Context, entitlementId: string): Promise<EntitlementUsage[]> {
  return ctx.store.find<EntitlementUsage>('entitlement_usages', {
    where: [...ownerWhere(ctx.actor.userId), { field: 'entitlementId', op: 'eq', value: entitlementId }],
    orderBy: [{ field: 'usedOn', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'asc' }],
  });
}

export async function listEntitlements(ctx: Context): Promise<EntitlementList> {
  const items = await ctx.store.find<Entitlement>('entitlements', {
    where: ownerWhere(ctx.actor.userId), orderBy: [{ field: 'endsOn', direction: 'asc' }, { field: 'id', direction: 'asc' }],
  });
  return { today: ctx.today, items, cards: await ownedCards(ctx) };
}

export async function getEntitlement(ctx: Context, entitlementId: unknown): Promise<EntitlementDetail> {
  const entitlement = await ctx.owned<Entitlement>('entitlements', id(entitlementId, 'id'));
  return { today: ctx.today, entitlement, usages: await usageHistory(ctx, entitlement.id), cards: await ownedCards(ctx) };
}

async function persist(ctx: Context, before: Entitlement, next: Entitlement, action: string): Promise<MutationResult> {
  const saved: Entitlement = { ...next, version: before.version + 1, updatedAt: ctx.now };
  await ctx.store.set('entitlements', saved.id, saved);
  await ctx.audit(saved.id, action, before, saved);
  return { id: saved.id, version: saved.version };
}

export async function saveEntitlement(ctx: Context, payload: Commands['entitlement.save']): Promise<MutationResult> {
  const before = payload.id === undefined ? null : await ctx.owned<Entitlement>('entitlements', id(payload.id, 'id'));
  if (before) checkVersion(before, payload.expectedVersion);
  const next = draft(payload.draft, ctx.today);
  if (next.cardId) {
    const card = await ctx.owned<Card>('cards', next.cardId);
    requireValue(!card.archivedAt || next.cardId === before?.cardId, 'CARD_ARCHIVED', '已归档卡片不能新增关联权益，请选择其他卡片', 'cardId');
  }
  const usages = before ? await usageHistory(ctx, before.id) : [];
  for (const usage of usages) {
    requireValue(usage.usedOn >= next.startsOn, 'INVALID_DATE', '开始日期不能晚于已有使用记录日期', 'startsOn');
    requireValue(usage.usedOn <= next.endsOn, 'INVALID_DATE', '结束日期不能早于已有使用记录日期', 'endsOn');
  }
  const recordedUses = usages.filter(usage => !usage.reversedAt).reduce((sum, usage) => sum + usage.quantity, 0);
  const usedUses = next.initialUsed + recordedUses;
  requireValue(Number.isSafeInteger(usedUses) && usedUses >= 0 && usedUses <= next.totalUses,
    'INSUFFICIENT_USES', '总次数不能少于初始已用与有效使用记录的合计次数', 'totalUses');
  if (before) return persist(ctx, before, { ...before, ...next, usedUses }, 'entitlement.updated');
  const record: Entitlement = {
    ...next, id: ctx.newId('ent'), ownerId: ctx.actor.userId, usedUses, version: 1,
    createdAt: ctx.now, updatedAt: ctx.now, archivedAt: null,
  };
  await ctx.store.set('entitlements', record.id, record);
  await ctx.audit(record.id, 'entitlement.created', undefined, record);
  return { id: record.id, version: record.version };
}

export async function useEntitlement(ctx: Context, payload: Commands['entitlement.use']): Promise<MutationResult> {
  const before = await ctx.owned<Entitlement>('entitlements', id(payload.id, 'id'));
  checkVersion(before, payload.expectedVersion);
  requireValue(!before.archivedAt, 'ENTITLEMENT_ARCHIVED', '已归档权益不能记录使用，请先恢复权益');
  const quantity = integer(payload.quantity, 1, 9999, 'quantity');
  const usedOn = assertDate(payload.usedOn, 'usedOn');
  requireValue(usedOn <= ctx.today, 'INVALID_DATE', '使用日期不能晚于今天', 'usedOn');
  requireValue(usedOn >= before.startsOn && usedOn <= before.endsOn, 'INVALID_DATE', '使用日期必须在权益有效期内', 'usedOn');
  const note = text(payload.note === undefined ? '' : payload.note, 'note', 500);
  const loungeId = payload.loungeId === undefined || payload.loungeId === '' ? '' : id(payload.loungeId, 'loungeId');
  let loungeName = '';
  if (loungeId) {
    requireValue(before.kind === 'lounge', 'INVALID_INPUT', '仅机场贵宾厅权益可选择休息室', 'loungeId');
    const selected = before.lounges.find(item => item.id === loungeId);
    requireValue(selected, 'INVALID_INPUT', '所选休息室不属于这项权益，请重新选择', 'loungeId');
    // Guest pricing may differ, so the base visit cost is a minimum rather than a required multiple.
    requireValue(quantity >= selected.unitsPerVisit, 'INVALID_INPUT', `这间休息室每次至少扣除 ${selected.unitsPerVisit} 次`, 'quantity');
    loungeName = selected.loungeName;
  }
  const usedUses = before.usedUses + quantity;
  requireValue(Number.isSafeInteger(usedUses) && before.usedUses >= before.initialUsed && usedUses <= before.totalUses,
    'INSUFFICIENT_USES', '剩余次数不足，请核对本次扣除次数', 'quantity');
  const usage: EntitlementUsage = {
    id: ctx.newId('eu'), ownerId: ctx.actor.userId, entitlementId: before.id, quantity, usedOn, note,
    loungeId, loungeName, reversedAt: null, createdAt: ctx.now,
  };
  await ctx.store.set('entitlement_usages', usage.id, usage);
  const saved = await persist(ctx, before, { ...before, usedUses }, 'entitlement.used');
  await ctx.audit(usage.id, 'entitlement_usage.created', undefined, usage);
  return { id: usage.id, version: saved.version };
}

export async function undoEntitlementUsage(ctx: Context, payload: Commands['entitlement.undo']): Promise<MutationResult> {
  const usage = await ctx.owned<EntitlementUsage>('entitlement_usages', id(payload.id, 'id'));
  const before = await ctx.owned<Entitlement>('entitlements', id(usage.entitlementId, 'entitlementId'));
  checkVersion(before, payload.expectedVersion);
  requireValue(!usage.reversedAt, 'USAGE_REVERSED', '这条使用记录已撤销，无需重复操作');
  const usedUses = before.usedUses - usage.quantity;
  requireValue(Number.isSafeInteger(usedUses) && usedUses >= before.initialUsed && usedUses <= before.totalUses,
    'CONFLICT', '权益次数与使用记录不一致，请刷新后核对');
  const reversed: EntitlementUsage = { ...usage, reversedAt: ctx.now };
  await ctx.store.set('entitlement_usages', usage.id, reversed);
  const saved = await persist(ctx, before, { ...before, usedUses }, 'entitlement.usage_undone');
  await ctx.audit(usage.id, 'entitlement_usage.reversed', usage, reversed);
  return saved;
}

export async function archiveEntitlement(ctx: Context, payload: Commands['entitlement.archive']): Promise<MutationResult> {
  const before = await ctx.owned<Entitlement>('entitlements', id(payload.id, 'id'));
  checkVersion(before, payload.expectedVersion);
  requireValue(typeof payload.archived === 'boolean', 'INVALID_INPUT', '请选择有效归档状态', 'archived');
  if (Boolean(before.archivedAt) === payload.archived) return { id: before.id, version: before.version };
  return persist(ctx, before, { ...before, archivedAt: payload.archived ? ctx.now : null }, payload.archived ? 'entitlement.archived' : 'entitlement.restored');
}

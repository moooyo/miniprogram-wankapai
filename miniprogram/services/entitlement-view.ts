import type { Card, Entitlement, EntitlementKind, LoungeAccess, Transferability } from '../../shared/contracts';
import { isDate } from '../../domain/calendar';
import { cardLabel } from './card-labels';

export type EntitlementScope = 'valid' | 'all' | 'archived';
export type LoungeZoneFilter = 'all' | 'domestic' | 'international';
export const entitlementKindLabels: Record<EntitlementKind, string> = { lounge: '机场贵宾厅', health_check: '体检', other: '其他权益' };
export const transferabilityLabels: Record<Transferability, string> = { allowed: '明确可转让', grey: '可转让（灰）', not_allowed: '不可转让' };
export const greyTransferQualification = '灰色转让为本人登记的非官方可行性，使用前仍需核实，不代表银行或服务商认可。';

export interface EntitlementRow {
  id: string; title: string; kind: EntitlementKind; kindLabel: string; cardName: string; provider: string;
  remaining: number; usedUses: number; totalUses: number; period: string; status: string; usable: boolean;
  archived: boolean; transferLabel: string; greyTransfer: boolean; transferNote: string; notes: string; loungeCount: number;
}

export function remainingUses(item: Entitlement): number { return item.totalUses - item.usedUses; }

export function currentEntitlement(item: Entitlement, today: string): boolean {
  return !item.archivedAt && item.startsOn <= today && item.endsOn >= today && remainingUses(item) > 0;
}

export function entitlementStatus(item: Entitlement, today: string): string {
  if (item.archivedAt) return '已归档';
  if (item.startsOn > today) return '尚未生效';
  if (item.endsOn < today) return '已过期';
  if (remainingUses(item) <= 0) return '次数已用完';
  return '当前可用';
}

export function entitlementRow(item: Entitlement, cards: readonly Card[], today: string): EntitlementRow {
  return {
    id: item.id, title: item.title, kind: item.kind, kindLabel: entitlementKindLabels[item.kind],
    cardName: cardLabel(item.cardId, cards), provider: item.provider, remaining: remainingUses(item),
    usedUses: item.usedUses, totalUses: item.totalUses, period: `${item.startsOn} 至 ${item.endsOn}`,
    status: entitlementStatus(item, today), usable: currentEntitlement(item, today), archived: !!item.archivedAt,
    transferLabel: transferabilityLabels[item.transferability], greyTransfer: item.transferability === 'grey',
    transferNote: item.transferNote, notes: item.notes, loungeCount: item.lounges.length,
  };
}

export function filterEntitlements(items: readonly Entitlement[], today: string, scope: EntitlementScope, kind: string, search: string): Entitlement[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter(item => {
    const inScope = scope === 'archived' ? !!item.archivedAt : scope === 'valid' ? currentEntitlement(item, today) : !item.archivedAt;
    return inScope && (kind === 'all' || item.kind === kind) && (!query || item.title.toLocaleLowerCase().includes(query));
  }).sort((a, b) => Number(!currentEntitlement(a, today)) - Number(!currentEntitlement(b, today)) || a.endsOn.localeCompare(b.endsOn) || a.title.localeCompare(b.title));
}

export function reservationLabel(lounge: LoungeAccess): string {
  if (lounge.reservation === 'unknown') return '预约要求待核实';
  if (lounge.reservation === 'not_required') return '无需预约（已登记）';
  return lounge.advanceHours > 0 ? `需提前 ${lounge.advanceHours} 小时预约` : '需要预约，提前时长待核实';
}

export function customerScopeLabel(lounge: LoungeAccess): string {
  return { all: '已登记无额外客户范围限制', local_bank: '仅限当地银行客户', specified: '仅限指定客户', unknown: '客户资格待核实' }[lounge.customerScope];
}

export function loungeZoneLabel(zone: LoungeAccess['zone']): string {
  return { domestic: '国内区', international: '国际区', both: '国内 / 国际区', unknown: '区域待核实' }[zone];
}

export interface LoungeMatch {
  key: string; entitlementId: string; loungeId: string; title: string; airport: string; airportCode: string; city: string;
  terminal: string; zoneLabel: string; reservation: string; reservationNote: string; customerScope: string; customerNote: string;
  guestNote: string; openingHours: string; location: string; sourceNote: string; verifiedOn: string; supportedBanks: string[];
}

export function searchLounges(items: readonly Entitlement[], search: string, entitlementId = '', terminal = '', zone: LoungeZoneFilter = 'all'): LoungeMatch[] {
  const query = search.trim().toLocaleLowerCase(), terminalQuery = terminal.trim().toLocaleLowerCase();
  const matches: LoungeMatch[] = [];
  for (const item of items) {
    if (item.kind !== 'lounge' || item.archivedAt || (entitlementId && item.id !== entitlementId)) continue;
    for (const lounge of item.lounges) {
      if (query && ![lounge.airportName, lounge.airportCode, lounge.city].some(value => value.toLocaleLowerCase().includes(query))) continue;
      if (terminalQuery && !lounge.terminal.toLocaleLowerCase().includes(terminalQuery)) continue;
      if (zone !== 'all' && lounge.zone !== zone && lounge.zone !== 'both') continue;
      matches.push({
        key: `${item.id}:${lounge.id}`, entitlementId: item.id, loungeId: lounge.id, title: lounge.loungeName,
        airport: lounge.airportName, airportCode: lounge.airportCode, city: lounge.city,
        terminal: lounge.terminal || '航站楼待核实', zoneLabel: loungeZoneLabel(lounge.zone),
        reservation: reservationLabel(lounge), reservationNote: lounge.reservationNote,
        customerScope: customerScopeLabel(lounge), customerNote: lounge.customerNote,
        guestNote: lounge.guestNote, openingHours: lounge.openingHours, location: lounge.location,
        sourceNote: lounge.sourceNote, verifiedOn: lounge.verifiedOn, supportedBanks: lounge.supportedBanks || [],
      });
    }
  }
  return matches.sort((a, b) => a.airport.localeCompare(b.airport) || a.title.localeCompare(b.title));
}

export function validateUsage(item: Entitlement, today: string, quantityInput: string, usedOn: string): { quantity: number; quantityError: string; dateError: string } {
  const quantity = Number(quantityInput.trim());
  const quantityError = !/^\d+$/.test(quantityInput.trim()) || !Number.isSafeInteger(quantity) || quantity < 1
    ? '请输入大于 0 的整数次数。' : quantity > remainingUses(item) ? `最多可记录 ${remainingUses(item)} 次。` : '';
  const dateError = !isDate(usedOn) ? '请选择有效的使用日期。'
    : usedOn < item.startsOn || usedOn > item.endsOn ? '使用日期必须在这项权益的有效期内。'
    : usedOn > today ? '使用日期不能晚于今天。' : '';
  return { quantity, quantityError, dateError };
}

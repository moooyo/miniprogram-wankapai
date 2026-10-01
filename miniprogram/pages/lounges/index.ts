import type { EntitlementList } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { LoungeMatch, LoungeZoneFilter, currentEntitlement, loungeProgramLabels, searchLounges } from '../../services/entitlement-view';
import { banks } from '../../../shared/catalog';
import { cardLabel } from '../../services/card-labels';

type ValueEvent = { detail: { value: string } };
type FilterEvent = { currentTarget: { dataset: { value?: string } } };
type MatchView = LoungeMatch & { cardName: string; bankLogo: string; remaining: number; usable: boolean; benefitTitle: string };
interface AirportRow { key: string; name: string; code: string; city: string; count: number; }
interface ProgramSummary { value: string; label: string; cards: string; remaining: number; }

Page({
  data: {
    loading: true, refreshing: false, failed: false, outdated: false, error: '', demo: false,
    raw: null as EntitlementList | null, matches: [] as MatchView[], search: '', terminal: '', zone: 'all' as LoungeZoneFilter,
    entitlementId: '', scopeTitle: '', registeredCount: 0, filtered: false,
    airports: [] as AirportRow[], showAirports: true, expandedMatchKey: '', resultAirportName: '', resultAirportCode: '', resultCity: '', ownerId: '', recentAirports: [] as AirportRow[], programSummaries: [] as ProgramSummary[],
    zones: [{ value: 'all', label: '所有区域' }, { value: 'domestic', label: '国内区' }, { value: 'international', label: '国际区' }],
  },
  loadVersion: 0,
  disposed: false,
  onLoad(options: { entitlementId?: string }) { this.setData({ entitlementId: options.entitlementId || '' }); },
  onShow() { void this.load(); },
  onUnload() { this.disposed = true; this.loadVersion += 1; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const version = ++this.loadVersion;
    this.setData({ loading: !this.data.raw, refreshing: !!this.data.raw, failed: false, error: '' });
    try {
      const session = await ensureSession();
      if (this.disposed || version !== this.loadVersion) return;
      if (this.data.ownerId && this.data.ownerId !== session.userId) this.setData({ raw: null, matches: [], airports: [], registeredCount: 0,
        search: '', terminal: '', zone: 'all', entitlementId: '', scopeTitle: '', recentAirports: [], programSummaries: [], expandedMatchKey: '', filtered: false, showAirports: true, loading: true, refreshing: false });
      this.setData({ ownerId: session.userId, recentAirports: this.readRecent(session.userId) });
      const raw = await api.query('entitlements.list', {});
      if (this.disposed || version !== this.loadVersion) return;
      if (raw.items.some(item => item.ownerId !== session.userId) || raw.cards.some(card => card.ownerId !== session.userId)) throw new Error('账号已变化，请重新读取已登记资料。');
      this.setData({ raw, demo: session.demo, outdated: false,
        scopeTitle: raw.items.find(item => item.id === this.data.entitlementId)?.title || '',
        registeredCount: raw.items.filter(item => item.kind === 'lounge' && !item.archivedAt).reduce((count, item) => count + item.lounges.length, 0) });
      this.applyFilters();
    } catch (error) {
      if (!this.disposed && version === this.loadVersion) this.setData({ failed: !this.data.raw, outdated: !!this.data.raw,
        error: this.data.raw ? '资料尚未更新，以下为上次读取的结果。请刷新后再核实支持银行与准入条件。' : error instanceof Error ? error.message : '暂时无法读取已登记资料。' });
    } finally { if (!this.disposed && version === this.loadVersion) this.setData({ loading: false, refreshing: false }); }
  },
  applyFilters() {
    if (!this.data.raw) return;
    const raw = this.data.raw;
    const scopedMatches = searchLounges(raw.items, '', this.data.entitlementId);
    const airports: AirportRow[] = [];
    for (const match of scopedMatches) {
      const key = match.airportCode.toUpperCase() || match.airport;
      const existing = airports.find(airport => airport.key === key);
      if (existing) existing.count += 1;
      else airports.push({ key, name: match.airport, code: match.airportCode.toUpperCase() || '—', city: match.city, count: 1 });
    }
    const matches = searchLounges(raw.items, this.data.search, this.data.entitlementId, this.data.terminal, this.data.zone).map(match => {
      const item = raw.items.find(entitlement => entitlement.id === match.entitlementId)!;
      const card = raw.cards.find(value => value.id === item.cardId), bank = banks.find(value => value.id === card?.bankId);
      return { ...match, cardName: cardLabel(item.cardId, raw.cards), bankLogo: bank?.logo || '', remaining: item.totalUses - item.usedUses,
        usable: currentEntitlement(item, raw.today), benefitTitle: item.title };
    });
    const resultAirports = new Set(matches.map(match => match.airportCode.toUpperCase() || match.airport));
    const programs = new Map<string, { label: string; names: Set<string>; remaining: number }>();
    for (const item of raw.items.filter(entitlement => entitlement.kind === 'lounge' && !entitlement.archivedAt && (!this.data.entitlementId || entitlement.id === this.data.entitlementId))) {
      const value = item.loungeProgram || 'unknown';
      const summary = programs.get(value) || { label: item.loungeProgram ? loungeProgramLabels[item.loungeProgram] : '通道待填写', names: new Set<string>(), remaining: 0 };
      summary.names.add(cardLabel(item.cardId, raw.cards) || item.title);
      if (currentEntitlement(item, raw.today)) summary.remaining += item.totalUses - item.usedUses;
      programs.set(value, summary);
    }
    this.setData({ matches, airports, showAirports: !this.data.search.trim() && !this.data.terminal.trim() && this.data.zone === 'all',
      resultAirportName: resultAirports.size === 1 ? matches[0].airport : '相关机场', resultAirportCode: resultAirports.size === 1 ? matches[0].airportCode : '', resultCity: resultAirports.size === 1 ? matches[0].city : '',
      filtered: !!this.data.search.trim() || !!this.data.terminal.trim() || this.data.zone !== 'all',
      programSummaries: Array.from(programs.entries()).map(([value, summary]) => ({ value, label: summary.label, cards: Array.from(summary.names).join('、'), remaining: summary.remaining })) });
  },
  readRecent(ownerId: string): AirportRow[] {
    try {
      const stored = wx.getStorageSync(`lounges.recent.${encodeURIComponent(ownerId)}`) as { version?: number; ownerId?: string; items?: AirportRow[] };
      if (!stored || stored.version !== 1 || stored.ownerId !== ownerId || !Array.isArray(stored.items)) return [];
      const seen = new Set<string>();
      return stored.items.filter(item => {
        if (!item || ![item.key, item.name, item.code, item.city].every(value => typeof value === 'string') || !item.key.trim() || !item.name.trim() || item.name.length > 120 || item.key.length > 120 || (item.code !== '—' && !/^[a-z]{3}$/i.test(item.code)) || !Number.isSafeInteger(item.count) || item.count < 1) return false;
        const key = item.code !== '—' ? item.code.toUpperCase() : item.name;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(0, 6).map(item => ({ ...item, key: item.code !== '—' ? item.code.toUpperCase() : item.name, code: item.code.toUpperCase() }));
    } catch { return []; }
  },
  rememberAirport() {
    if (!this.data.ownerId || this.data.loading || this.data.refreshing || this.data.outdated || !this.data.matches.length) return;
    const keys = new Set(this.data.matches.map(item => item.airportCode.toUpperCase() || item.airport));
    if (keys.size !== 1) return;
    const airport = this.data.airports.find(item => item.key === Array.from(keys)[0]);
    if (!airport) return;
    const recentAirports = [airport, ...this.data.recentAirports.filter(item => item.key !== airport.key)].slice(0, 6);
    this.setData({ recentAirports });
    try { wx.setStorageSync(`lounges.recent.${encodeURIComponent(this.data.ownerId)}`, { version: 1, ownerId: this.data.ownerId, items: recentAirports }); } catch { /* Recent queries remain available during this session. */ }
  },
  confirmSearch() { this.applyFilters(); this.rememberAirport(); },
  changeSearch(event: ValueEvent) { this.setData({ search: event.detail.value }); this.applyFilters(); },
  changeTerminal(event: ValueEvent) { this.setData({ terminal: event.detail.value }); this.applyFilters(); },
  changeZone(event: FilterEvent) {
    const zone = event.currentTarget.dataset.value as LoungeZoneFilter;
    if (!['all', 'domestic', 'international'].includes(zone)) return;
    this.setData({ zone }); this.applyFilters();
  },
  clearFilters() { this.setData({ search: '', terminal: '', zone: 'all' }); this.applyFilters(); },
  clearScope() { this.setData({ entitlementId: '', scopeTitle: '' }); this.applyFilters(); },
  selectAirport(event: FilterEvent) { this.setData({ search: event.currentTarget.dataset.value || '', terminal: '', zone: 'all' }); this.applyFilters(); this.rememberAirport(); },
  toggleMatch(event: FilterEvent) { const key = event.currentTarget.dataset.value || ''; this.setData({ expandedMatchKey: this.data.expandedMatchKey === key ? '' : key }); },
  recordUse(event: FilterEvent) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || !this.data.raw) return;
    const match = this.data.matches.find(item => item.key === event.currentTarget.dataset.value);
    if (!match?.usable) return;
    wx.navigateTo({ url: `/pages/entitlements/index?id=${encodeURIComponent(match.entitlementId)}&loungeId=${encodeURIComponent(match.loungeId)}&record=1` });
  },
  addLoungeBenefit() { wx.navigateTo({ url: '/pages/entitlement-edit/index?kind=lounge' }); },
});

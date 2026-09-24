import type { EntitlementList } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { LoungeMatch, LoungeZoneFilter, searchLounges } from '../../services/entitlement-view';

type ValueEvent = { detail: { value: string } };
type FilterEvent = { currentTarget: { dataset: { value?: string } } };

Page({
  data: {
    loading: true, refreshing: false, failed: false, outdated: false, error: '', demo: false,
    raw: null as EntitlementList | null, matches: [] as LoungeMatch[], search: '', terminal: '', zone: 'all' as LoungeZoneFilter,
    entitlementId: '', scopeTitle: '', registeredCount: 0, filtered: false,
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
      const raw = await api.query('entitlements.list', {});
      if (this.disposed || version !== this.loadVersion) return;
      if (raw.items.some(item => item.ownerId !== session.userId)) throw new Error('账号已变化，请重新读取已登记资料。');
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
    const matches = searchLounges(raw.items, this.data.search, this.data.entitlementId, this.data.terminal, this.data.zone);
    this.setData({ matches,
      filtered: !!this.data.search.trim() || !!this.data.terminal.trim() || this.data.zone !== 'all' });
  },
  changeSearch(event: ValueEvent) { this.setData({ search: event.detail.value }); this.applyFilters(); },
  changeTerminal(event: ValueEvent) { this.setData({ terminal: event.detail.value }); this.applyFilters(); },
  changeZone(event: FilterEvent) {
    const zone = event.currentTarget.dataset.value as LoungeZoneFilter;
    if (!['all', 'domestic', 'international'].includes(zone)) return;
    this.setData({ zone }); this.applyFilters();
  },
  clearFilters() { this.setData({ search: '', terminal: '', zone: 'all' }); this.applyFilters(); },
  clearScope() { this.setData({ entitlementId: '', scopeTitle: '' }); this.applyFilters(); },
  addLoungeBenefit() { wx.navigateTo({ url: '/pages/entitlement-edit/index?kind=lounge' }); },
});

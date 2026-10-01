import { Card, Currency, Participation, Reward } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, showError, today, monthKey } from '../../services/format';
import { cardLabel } from '../../services/card-labels';
import { benefitCopy, BenefitKind } from '../../services/benefit-copy';

interface PendingRow { id: string; activityId: string; title: string; bank: string; logo: string; cardName: string; period: string; reward: string; expected: string; late: boolean; recordAction: string; expectedLabel: string; }
interface ReceivedRow { id: string; participationId: string; title: string; bank: string; logo: string; cardName: string; amount: string; amountPrefix: string; date: string; period: string; kindLabel: string; }
const currencies: { value: Currency; label: string; name: string }[] = [{ value: 'CNY', label: '人民币 CNY', name: '人民币' }, { value: 'HKD', label: '港币 HKD', name: '港币' }, { value: 'MOP', label: '澳门元 MOP', name: '澳门元' }];

Page({
  data: {
    loading: true, refreshing: false, refreshError: '', outdated: false, loadingMore: false, loadMoreError: '', failed: false, tab: 'received', month: '', monthLabel: '', monthShortLabel: '', maxDate: '',
    currencyIndex: 0, currencies, total: '', cashbackTotal: '', discountTotal: '', pendingTotal: '', pendingPoints: '', pendingCount: 0,
    pendingCurrencies: currencies.map((currency, index) => ({ ...currency, index, count: 0 })),
    pending: [] as PendingRow[], received: [] as ReceivedRow[], nextCursor: null as string | null,
  },
  loadVersion: 0,
  loadedScope: '',
  onShow() {
    const initialTab = wx.getStorageSync('rewards.initialTab');
    if (initialTab === 'pending') { this.setData({ tab: 'pending' }); wx.removeStorageSync('rewards.initialTab'); }
    const initialCurrency = wx.getStorageSync('rewards.initialCurrency');
    const currencyIndex = currencies.findIndex(item => item.value === initialCurrency);
    if (currencyIndex >= 0) { this.setData({ currencyIndex }); wx.removeStorageSync('rewards.initialCurrency'); }
    void this.load();
  },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const version = ++this.loadVersion;
    const requestedMonth = this.data.month;
    const currency = currencies[this.data.currencyIndex].value;
    const keepContent = this.loadedScope === `${requestedMonth}:${currency}`;
    const windowCount = keepContent ? Math.max(30, this.data.received.length) : 30;
    this.setData({ loading: !keepContent, refreshing: keepContent, refreshError: '', loadingMore: false, loadMoreError: '', failed: false });
    try {
      const session = await ensureSession();
      if (version !== this.loadVersion) return;
      const month = requestedMonth || session.month || monthKey();
      const result = await api.query('rewards.get', { month, currency, limit: 30 });
      if (version !== this.loadVersion) return;
      const received = new Map(this.mapReceived(result.received, result.cards || [], result.cardIds || {}, result.rewardKinds || {}).map(row => [row.id, row]));
      let nextCursor = result.nextCursor;
      const visited = new Set<string>();
      while (keepContent && nextCursor && received.size < windowCount) {
        if (visited.has(nextCursor)) throw new Error('Repeated reward page cursor');
        visited.add(nextCursor);
        const page = await api.query('rewards.get', { month, currency, cursor: nextCursor, limit: 30 });
        if (version !== this.loadVersion) return;
        this.mapReceived(page.received, page.cards || [], page.cardIds || {}, page.rewardKinds || {}).forEach(row => received.set(row.id, row));
        nextCursor = page.nextCursor;
      }
      const pendingCounts = result.pendingCounts || { CNY: 0, HKD: 0, MOP: 0 };
      if (!result.pendingCounts) pendingCounts[currency] = result.pending.length;
      this.loadedScope = `${month}:${currency}`;
      this.setData({ month, outdated: false, monthLabel: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`, monthShortLabel: `${Number(month.slice(5))}月`, maxDate: session.today || today(),
        total: money(result.totalMinor, currency), pendingTotal: money(result.pending.filter(p => p.snapshot.rewardKind !== 'points').reduce((sum, p) => sum + p.snapshot.rewardMinor, 0), currency),
        pendingPoints: result.pending.some(p => p.snapshot.rewardKind === 'points') ? money(result.pending.filter(p => p.snapshot.rewardKind === 'points').reduce((sum, p) => sum + p.snapshot.rewardMinor, 0), currency, 'points') : '',
        cashbackTotal: money(result.cashbackMinor ?? result.totalMinor, currency), discountTotal: money(result.discountMinor ?? 0, currency),
        pendingCount: Object.values(pendingCounts).reduce((sum, count) => sum + count, 0),
        pendingCurrencies: currencies.map((item, index) => ({ ...item, index, count: pendingCounts[item.value] })),
        pending: this.mapPending(result.pending, result.cards || []), received: [...received.values()], nextCursor });
    } catch (error) {
      if (version === this.loadVersion) {
        if (keepContent) this.setData({ outdated: true, refreshError: '收益尚未更新，以下为上次读取的记录。请刷新成功后再确认或更正。' });
        else { this.setData({ failed: true }); showError(error); }
      }
    }
    finally { if (version === this.loadVersion) this.setData({ loading: false, refreshing: false }); }
  },
  mapPending(items: Participation[], cards: Card[] = []): PendingRow[] {
    const expectedDate = (item: Participation) => item.snapshot.rewardKind === 'discount' ? '9999' : item.expectedOn || '9999';
    return items.slice().sort((a, b) => expectedDate(a).localeCompare(expectedDate(b)) || a.endsOn.localeCompare(b.endsOn)).map(item => {
      const bank = banks.find(b => b.id === item.snapshot.bankId);
      const benefit = benefitCopy(item.snapshot.rewardKind);
      return { id: item.id, activityId: item.activityId, title: item.snapshot.title, bank: bank?.shortName || '', logo: bank?.logo || '',
        cardName: cardLabel(item.cardId, cards), period: periodLabel(item.periodKey), reward: money(item.snapshot.rewardMinor, item.snapshot.currency, item.snapshot.rewardKind),
        expected: benefit.isDiscount ? benefit.pendingDescription : item.expectedOn ? `预计 ${item.expectedOn} ${benefit.dateEvent}` : `${benefit.dateEvent}时间未登记`,
        late: !benefit.isDiscount && !!item.expectedOn && item.expectedOn < today(), recordAction: benefit.recordAction, expectedLabel: benefit.expectedLabel };
    });
  },
  mapReceived(items: Reward[], cards: Card[] = [], cardIds: Record<string, string> = {}, rewardKinds: Record<string, BenefitKind> = {}): ReceivedRow[] {
    return items.map(item => {
      const bank = banks.find(b => b.id === item.bankId);
      const benefit = benefitCopy(rewardKinds[item.participationId]);
      return { id: item.id, participationId: item.participationId, title: item.title, bank: bank?.shortName || '', logo: bank?.logo || '',
        cardName: cardLabel(cardIds[item.participationId], cards), amount: money(item.amountMinor, item.currency, rewardKinds[item.participationId]), date: `${Number(item.receivedOn.slice(5, 7))}/${Number(item.receivedOn.slice(8))}`,
        period: periodLabel(item.activityPeriod), kindLabel: benefit.kind === 'cashback' ? '返现到账' : benefit.recordedStatus, amountPrefix: benefit.kind === 'cashback' || benefit.kind === 'points' ? '+' : '' };
    });
  },
  selectTab(event: WechatMiniprogram.TouchEvent) {
    const tab = event.currentTarget.dataset.tab;
    this.setData({ tab });
    wx.pageScrollTo({ selector: tab === 'pending' ? '.pending-section' : '.received-section', duration: 220 });
  },
  changeCurrency(event: WechatMiniprogram.PickerChange) { this.setData({ currencyIndex: Number(event.detail.value) }); void this.load(); },
  choosePendingCurrency(event: WechatMiniprogram.TouchEvent) {
    const currencyIndex = Number(event.currentTarget.dataset.index);
    if (!currencies[currencyIndex] || currencyIndex === this.data.currencyIndex) return;
    this.setData({ currencyIndex });
    void this.load();
  },
  changeMonth(event: WechatMiniprogram.PickerChange) {
    const month = String(event.detail.value).slice(0, 7);
    this.setData({ month, monthLabel: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`, monthShortLabel: `${Number(month.slice(5))}月` });
    void this.load();
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.loading || this.data.refreshing || this.data.outdated) return;
    const version = this.loadVersion;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const result = await api.query('rewards.get', { month: this.data.month, currency: currencies[this.data.currencyIndex].value, cursor: this.data.nextCursor, limit: 30 });
      if (version !== this.loadVersion) return;
      const existing = new Set(this.data.received.map(item => item.id));
      this.setData({ received: this.data.received.concat(this.mapReceived(result.received, result.cards || [], result.cardIds || {}, result.rewardKinds || {}).filter(item => !existing.has(item.id))), nextCursor: result.nextCursor });
    } catch (error) {
      if (version === this.loadVersion) this.setData({ loadMoreError: '更多收益记录暂时无法加载，已显示的记录仍然保留。' });
    }
    finally { if (version === this.loadVersion) this.setData({ loadingMore: false }); }
  },
  confirmPending(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.failed) return;
    const row = this.data.pending.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/receipt/index?activityId=${encodeURIComponent(row.activityId)}&id=${encodeURIComponent(row.id)}` });
  },
  openPending(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.failed) return;
    const row = this.data.pending.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(row.activityId)}&participationId=${encodeURIComponent(row.id)}` });
  },
  editReceived(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.failed) return;
    const row = this.data.received.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/receipt/index?id=${encodeURIComponent(row.participationId)}` });
  },
  openActivities() { wx.switchTab({ url: '/pages/activities/index' }); },
});

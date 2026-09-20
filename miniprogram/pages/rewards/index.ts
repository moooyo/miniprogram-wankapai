import { Currency, Participation, Reward } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, showError, today, monthKey } from '../../services/format';

interface PendingRow { id: string; activityId: string; title: string; bank: string; logo: string; period: string; reward: string; expected: string; late: boolean; }
interface ReceivedRow { id: string; participationId: string; title: string; bank: string; logo: string; amount: string; date: string; period: string; }
const currencies: { value: Currency; label: string }[] = [{ value: 'CNY', label: '人民币 CNY' }, { value: 'HKD', label: '港币 HKD' }, { value: 'MOP', label: '澳门元 MOP' }];

Page({
  data: {
    loading: true, loadingMore: false, failed: false, tab: 'received', month: '', monthLabel: '', maxDate: '',
    currencyIndex: 0, currencies, total: '', pendingTotal: '',
    pending: [] as PendingRow[], received: [] as ReceivedRow[], nextCursor: null as string | null,
  },
  loadVersion: 0,
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
    this.setData({ loading: true, failed: false });
    try {
      const session = await ensureSession();
      const month = this.data.month || session.month || monthKey();
      const currency = currencies[this.data.currencyIndex].value;
      const result = await api.query('rewards.get', { month, currency, limit: 30 });
      if (version !== this.loadVersion) return;
      this.setData({ month, monthLabel: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`, maxDate: session.today || today(),
        total: money(result.totalMinor, currency), pendingTotal: money(result.pending.reduce((sum, p) => sum + p.snapshot.rewardMinor, 0), currency),
        pending: this.mapPending(result.pending), received: this.mapReceived(result.received), nextCursor: result.nextCursor });
    } catch (error) { if (version === this.loadVersion) { this.setData({ failed: true }); showError(error); } }
    finally { if (version === this.loadVersion) this.setData({ loading: false }); }
  },
  mapPending(items: Participation[]): PendingRow[] {
    return items.slice().sort((a, b) => (a.expectedOn || '9999').localeCompare(b.expectedOn || '9999') || a.endsOn.localeCompare(b.endsOn)).map(item => {
      const bank = banks.find(b => b.id === item.snapshot.bankId);
      return { id: item.id, activityId: item.activityId, title: item.snapshot.title, bank: bank?.shortName || '', logo: bank?.logo || '',
        period: periodLabel(item.periodKey), reward: money(item.snapshot.rewardMinor, item.snapshot.currency),
        expected: item.expectedOn ? `预计 ${Number(item.expectedOn.slice(5, 7))}/${Number(item.expectedOn.slice(8))} 到账` : '到账时间未登记',
        late: !!item.expectedOn && item.expectedOn < today() };
    });
  },
  mapReceived(items: Reward[]): ReceivedRow[] {
    return items.map(item => {
      const bank = banks.find(b => b.id === item.bankId);
      return { id: item.id, participationId: item.participationId, title: item.title, bank: bank?.shortName || '', logo: bank?.logo || '',
        amount: money(item.amountMinor, item.currency), date: `${Number(item.receivedOn.slice(5, 7))}/${Number(item.receivedOn.slice(8))}`,
        period: periodLabel(item.activityPeriod) };
    });
  },
  selectTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: event.currentTarget.dataset.tab }); },
  changeCurrency(event: WechatMiniprogram.PickerChange) { this.setData({ currencyIndex: Number(event.detail.value) }); void this.load(); },
  changeMonth(event: WechatMiniprogram.PickerChange) { this.setData({ month: String(event.detail.value).slice(0, 7) }); void this.load(); },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.loading) return;
    const version = this.loadVersion;
    this.setData({ loadingMore: true });
    try {
      const result = await api.query('rewards.get', { month: this.data.month, currency: currencies[this.data.currencyIndex].value, cursor: this.data.nextCursor, limit: 30 });
      if (version !== this.loadVersion) return;
      const existing = new Set(this.data.received.map(item => item.id));
      this.setData({ received: this.data.received.concat(this.mapReceived(result.received).filter(item => !existing.has(item.id))), nextCursor: result.nextCursor });
    } catch (error) { showError(error); }
    finally { this.setData({ loadingMore: false }); }
  },
  confirmPending(event: WechatMiniprogram.TouchEvent) {
    const row = this.data.pending.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/receipt/index?activityId=${encodeURIComponent(row.activityId)}&id=${encodeURIComponent(row.id)}` });
  },
  openPending(event: WechatMiniprogram.TouchEvent) {
    const row = this.data.pending.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(row.activityId)}&participationId=${encodeURIComponent(row.id)}` });
  },
  editReceived(event: WechatMiniprogram.TouchEvent) {
    const row = this.data.received.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/receipt/index?id=${encodeURIComponent(row.participationId)}` });
  },
  openActivities() { wx.switchTab({ url: '/pages/activities/index' }); },
});

import { Dashboard, Participation } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { money, stageLabel, showError, today } from '../../services/format';

type Filter = 'unfinished' | 'completed' | 'all';
interface TaskRow {
  id: string; activityId: string; title: string; bank: string; logo: string;
  dateDay: string; dateMonth: string; deadline: string; status: string; progress: string;
  reward: string; closed: boolean; skipped: boolean; late: boolean; pending: boolean;
}

Page({
  data: {
    loading: true, failed: false, busyId: '', filter: 'unfinished' as Filter,
    closingOnly: false, monthLabel: '', dateLabel: '', tasks: [] as TaskRow[],
    raw: null as Dashboard | null, unfinishedCount: 0, completedCount: 0,
    allCount: 0, pendingCount: 0, nearestBill: '', billCount: 0,
    showActions: false, actionId: '', actionTitle: '', actionStage: '',
  },
  onShow() { void this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      await ensureSession();
      const raw = await api.query('dashboard.get', {});
      const date = raw.today || today();
      const openBills = raw.bills.filter(bill => !bill.paidAt).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
      this.setData({ raw, dateLabel: `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`,
        monthLabel: `${Number(date.slice(5, 7))} 月底前截止`, pendingCount: raw.pendingRewards.length,
        nearestBill: openBills[0] ? `${Number(openBills[0].dueOn.slice(5, 7))}/${Number(openBills[0].dueOn.slice(8))}` : '',
        billCount: openBills.length });
      this.applyFilter();
    } catch (error) { this.setData({ failed: true }); showError(error); }
    finally { this.setData({ loading: false }); }
  },
  applyFilter() {
    const raw = this.data.raw;
    if (!raw) return;
    const closed = (p: Participation) => p.stage === 'completed' || p.stage === 'received';
    const unfinished = (p: Participation) => !closed(p) && p.stage !== 'skipped';
    let visible = raw.tasks.filter(p => this.data.filter === 'all' || (this.data.filter === 'completed' ? closed(p) : unfinished(p)));
    if (this.data.closingOnly) visible = visible.filter(p => unfinished(p) && p.endsOn.slice(0, 7) <= (raw.today || today()).slice(0, 7));
    visible.sort((a, b) => a.endsOn.localeCompare(b.endsOn) || a.snapshot.title.localeCompare(b.snapshot.title));
    this.setData({
      unfinishedCount: raw.tasks.filter(unfinished).length,
      completedCount: raw.tasks.filter(closed).length,
      allCount: raw.tasks.length,
      tasks: visible.map(p => {
        const bank = banks.find(b => b.id === p.snapshot.bankId);
        const remaining = Math.max(0, p.snapshot.target - p.progress);
        return { id: p.id, activityId: p.activityId, title: p.snapshot.title,
          bank: bank?.shortName || '', logo: bank?.logo || '', dateDay: String(Number(p.endsOn.slice(8))),
          dateMonth: `${Number(p.endsOn.slice(5, 7))}月`, deadline: p.endsOn,
          status: stageLabel(p), progress: remaining > 0 ? `还差 ${remaining} ${p.snapshot.unit}` : '目标已达成',
          reward: money(p.snapshot.rewardMinor, p.snapshot.currency), closed: closed(p), skipped: p.stage === 'skipped',
          late: unfinished(p) && p.endsOn < (raw.today || today()), pending: p.stage === 'completed' };
      }),
    });
  },
  selectFilter(event: WechatMiniprogram.TouchEvent) {
    this.setData({ filter: event.currentTarget.dataset.filter as Filter, closingOnly: false });
    this.applyFilter();
  },
  toggleClosing(event: WechatMiniprogram.SwitchChange) {
    this.setData({ closingOnly: event.detail.value, filter: event.detail.value ? 'unfinished' : this.data.filter });
    this.applyFilter();
  },
  openTask(event: WechatMiniprogram.TouchEvent) {
    const row = this.data.raw?.tasks.find(item => item.id === event.currentTarget.dataset.id);
    this.setData({ showActions: false });
    if (row) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(row.activityId)}&participationId=${encodeURIComponent(row.id)}` });
  },
  receipt(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id || this.data.actionId;
    const row = this.data.raw?.tasks.find(item => item.id === id);
    this.setData({ showActions: false });
    if (row) wx.navigateTo({ url: `/pages/receipt/index?activityId=${encodeURIComponent(row.activityId)}&id=${encodeURIComponent(row.id)}` });
  },
  async complete(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id || this.data.actionId;
    if (!id || this.data.busyId) return;
    this.setData({ busyId: id, showActions: false });
    try {
      await api.command('participation.complete', { participationId: id });
      wx.showToast({ title: '已完成，等待到账', icon: 'none' });
      await this.load();
    } catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  showMore(event: WechatMiniprogram.TouchEvent) {
    const row = this.data.raw?.tasks.find(item => item.id === event.currentTarget.dataset.id);
    if (row) this.setData({ showActions: true, actionId: row.id, actionTitle: row.snapshot.title, actionStage: row.stage });
  },
  closeActions() { this.setData({ showActions: false }); },
  async toggleSkip() {
    if (this.data.busyId) return;
    const id = this.data.actionId;
    this.setData({ busyId: id, showActions: false });
    try {
      await api.command('participation.skip', { participationId: id, skipped: this.data.actionStage !== 'skipped' });
      await this.load();
    } catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  async undoComplete() {
    if (this.data.busyId) return;
    const id = this.data.actionId;
    this.setData({ busyId: id, showActions: false });
    try { await api.command('participation.undoComplete', { participationId: id }); await this.load(); }
    catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  browse() { wx.switchTab({ url: '/pages/activities/index' }); },
  openRewards() {
    wx.setStorageSync('rewards.initialTab', 'pending');
    const currency = this.data.raw?.pendingRewards[0]?.snapshot.currency;
    if (currency) wx.setStorageSync('rewards.initialCurrency', currency);
    wx.switchTab({ url: '/pages/rewards/index' });
  },
  openWallet() { wx.switchTab({ url: '/pages/wallet/index' }); },
});

import { ActivityItem, Bank } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession, requestReminder } from '../../services/api';
import { money, showError } from '../../services/format';

const frequencyNames = { once: '一次性', monthly: '每月', quarterly: '每季度', yearly: '每年' };

function activityView(item: ActivityItem) {
  const activity = item.activity;
  const bank = banks.find((value: Bank) => value.id === activity.bankId);
  const stage = item.participation?.stage;
  return {
    id: activity.id,
    participationId: item.participation?.id || '',
    bankName: bank?.name || '银行活动',
    logo: bank?.logo || '',
    title: activity.title,
    frequencyLabel: frequencyNames[activity.frequency],
    conditions: activity.conditions,
    cardDescription: activity.cardDescription,
    endsOn: activity.endsOn.replace(/-/g, '/'),
    reward: money(activity.rewardMinor, activity.currency),
    rewardLabel: activity.rewardKind === 'discount' ? '立减' : '预计返现',
    invited: activity.requiresInvitation,
    eligible: item.eligible,
    actionLabel: stage === 'received' ? '已到账' : stage === 'completed' ? '待到账' : stage === 'skipped' ? '本期已跳过' : stage ? '查看进度' : '查看活动',
    joined: !!item.participation,
  };
}

Page({
  data: {
    banks,
    bankId: '',
    bankName: '发现活动',
    bankSearch: '',
    filteredBanks: banks,
    mineOnly: false,
    showBanks: false,
    items: [] as ReturnType<typeof activityView>[],
    cursor: null as string | null,
    loading: false,
    loadingMore: false,
    error: '',
    requestSequence: 0,
  },
  onShow() {
    if (wx.getStorageSync('activities.mineOnly') === true) {
      this.setData({ mineOnly: true, bankId: '', bankName: '发现活动' });
      wx.removeStorageSync('activities.mineOnly');
    }
    void this.load(true);
  },
  async onPullDownRefresh() {
    try { await this.load(true); } finally { wx.stopPullDownRefresh(); }
  },
  onReachBottom() {
    if (this.data.cursor && !this.data.loading && !this.data.loadingMore) void this.load(false);
  },
  async load(reset = true) {
    const sequence = this.data.requestSequence + 1;
    this.setData({ requestSequence: sequence, loading: reset, loadingMore: !reset, error: '' });
    try {
      await ensureSession();
      const result = await api.query('catalog.list', {
        bankId: this.data.bankId || undefined,
        mineOnly: this.data.mineOnly,
        cursor: reset ? undefined : this.data.cursor || undefined,
        limit: 20,
      });
      if (sequence !== this.data.requestSequence) return;
      const nextItems = result.items.map(activityView);
      this.setData({ items: reset ? nextItems : this.data.items.concat(nextItems), cursor: result.nextCursor });
    } catch (error) {
      if (sequence === this.data.requestSequence) this.setData({ error: '活动暂时没有加载成功，请重试。' });
      showError(error);
    } finally {
      if (sequence === this.data.requestSequence) this.setData({ loading: false, loadingMore: false });
    }
  },
  chooseBank(event: any) {
    const bankId = event.currentTarget.dataset.id as string;
    const bank = banks.find((value: Bank) => value.id === bankId);
    this.setData({ bankId, bankName: bank?.name || '发现活动', showBanks: false });
    void this.load(true);
  },
  changeMine(event: any) {
    this.setData({ mineOnly: !!event.detail.value });
    void this.load(true);
  },
  openBanks() { this.setData({ showBanks: true, bankSearch: '', filteredBanks: banks }); },
  closeBanks() { this.setData({ showBanks: false }); },
  searchBanks(event: any) {
    const value = String(event.detail.value || '').trim();
    this.setData({ bankSearch: value, filteredBanks: banks.filter((bank: Bank) => (bank.name + bank.shortName).includes(value)) });
  },
  openActivity(event: any) {
    const { id, participation } = event.currentTarget.dataset;
    const suffix = participation ? `&participationId=${encodeURIComponent(participation)}` : '';
    wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(id)}${suffix}` });
  },
  clearFilters() {
    this.setData({ bankId: '', bankName: '发现活动', mineOnly: false });
    void this.load(true);
  },
  addCard() { wx.switchTab({ url: '/pages/wallet/index' }); },
  submitActivity() { wx.navigateTo({ url: '/pages/submission-edit/index' }); },
  async onSubscribe() {
    try { await requestReminder('new_activity', 'matches'); } catch (error) { showError(error); }
  },
  retry() { void this.load(true); },
  loadMore() { if (this.data.cursor) void this.load(false); },
});

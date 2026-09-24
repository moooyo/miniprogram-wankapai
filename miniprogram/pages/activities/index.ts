import { ActivityItem, Bank } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession, requestReminder } from '../../services/api';
import { money, showError } from '../../services/format';
import { benefitCopy } from '../../services/benefit-copy';

const frequencyNames = { once: '一次性', monthly: '每月', quarterly: '每季度', yearly: '每年' };

function activityView(item: ActivityItem) {
  const activity = item.activity;
  const bank = banks.find((value: Bank) => value.id === activity.bankId);
  const stage = item.participation?.stage;
  const benefit = benefitCopy(activity.rewardKind);
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
    actionLabel: stage === 'received' ? benefit.recordedStatus : stage === 'completed' ? benefit.pendingStatus : stage === 'skipped' ? '本期已跳过' : stage ? '查看进度' : '查看活动',
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
    loadMoreError: '',
    subscribeBusy: false,
    requestSequence: 0,
  },
  disposed: false,
  onUnload() { this.disposed = true; this.data.requestSequence += 1; },
  onShow() {
    if (wx.getStorageSync('activities.mineOnly') === true) {
      const changed = !this.data.mineOnly || this.data.bankId !== '';
      this.setData({ mineOnly: true, bankId: '', bankName: '发现活动', ...(changed ? { items: [], cursor: null } : {}) });
      wx.removeStorageSync('activities.mineOnly');
    }
    void this.load(true);
  },
  async onPullDownRefresh() {
    try { await this.load(true); } finally { wx.stopPullDownRefresh(); }
  },
  onReachBottom() {
    if (this.data.cursor && !this.data.loading && !this.data.loadingMore && !this.data.loadMoreError) void this.load(false);
  },
  async load(reset = true) {
    if (this.disposed || (!reset && (this.data.loading || this.data.loadingMore || !this.data.cursor))) return;
    const sequence = this.data.requestSequence + 1;
    const targetCount = reset ? this.data.items.length : 0;
    const query = { bankId: this.data.bankId || undefined, mineOnly: this.data.mineOnly,
      cursor: reset ? undefined : this.data.cursor || undefined, limit: 20 };
    this.setData({ requestSequence: sequence, loading: reset, loadingMore: !reset, error: '', loadMoreError: '' });
    try {
      await ensureSession();
      if (this.disposed || sequence !== this.data.requestSequence) return;
      const items = new Map((reset ? [] : this.data.items).map(item => [item.id, item]));
      const visited = new Set<string>();
      let cursor = query.cursor;
      let nextCursor: string | null = null;
      while (true) {
        if (cursor) {
          if (visited.has(cursor)) throw new Error('活动分页未能继续，请重试。');
          visited.add(cursor);
        }
        const result = await api.query('catalog.list', { ...query, cursor });
        if (this.disposed || sequence !== this.data.requestSequence) return;
        result.items.map(activityView).forEach(item => items.set(item.id, item));
        nextCursor = result.nextCursor;
        if (!reset || items.size >= targetCount || !nextCursor) break;
        cursor = nextCursor;
      }
      this.setData({ items: [...items.values()], cursor: nextCursor });
    } catch (error) {
      if (!this.disposed && sequence === this.data.requestSequence) {
        this.setData(reset ? { error: '活动暂时没有加载成功，请重试。' } : { loadMoreError: '更多活动未加载成功，已显示的活动仍可查看。' });
        showError(error);
      }
    } finally {
      if (!this.disposed && sequence === this.data.requestSequence) this.setData({ loading: false, loadingMore: false });
    }
  },
  chooseBank(event: any) {
    const bankId = event.currentTarget.dataset.id as string;
    if (bankId === this.data.bankId) { this.closeBanks(); return; }
    const bank = banks.find((value: Bank) => value.id === bankId);
    this.setData({ bankId, bankName: bank?.name || '发现活动', showBanks: false, items: [], cursor: null });
    void this.load(true);
  },
  changeMine(event: any) {
    const mineOnly = !!event.detail.value;
    if (mineOnly === this.data.mineOnly) return;
    this.setData({ mineOnly, items: [], cursor: null });
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
    const changed = !!this.data.bankId || this.data.mineOnly;
    this.setData({ bankId: '', bankName: '发现活动', mineOnly: false, ...(changed ? { items: [], cursor: null } : {}) });
    void this.load(true);
  },
  addCard() { wx.switchTab({ url: '/pages/wallet/index' }); },
  submitActivity() { wx.navigateTo({ url: '/pages/submission-lead/index' }); },
  async onSubscribe() {
    if (this.data.subscribeBusy) return;
    this.setData({ subscribeBusy: true });
    try { await requestReminder('new_activity', 'matches'); } catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ subscribeBusy: false }); }
  },
  retry() { void this.load(true); },
  loadMore() { if (this.data.cursor) void this.load(false); },
});

import { ActivityItem, Bank, Card } from '../../../shared/contracts';
import { banks, networks } from '../../../shared/catalog';
import { api, ensureSession, requestReminder } from '../../services/api';
import { money, showError } from '../../services/format';
import { benefitCopy } from '../../services/benefit-copy';
import { activityCycle, cycleLabel, cycleView, matchingCards, rewardKindLabel, screenshotItems, shortDate, usableCardLabel } from '../../services/activity-design';
import { cardLabel } from '../../services/card-labels';

function activityView(item: ActivityItem, cards: Card[] = [], today = '') {
  const activity = item.activity;
  const bank = banks.find((value: Bank) => value.id === activity.bankId);
  const stage = item.participation?.stage;
  const benefit = benefitCopy(activity.rewardKind);
  const withdrawn = !!item.participation?.withdrawnAt;
  const joined = !!item.participation && !withdrawn;
  const matches = matchingCards(activity, cards);
  const window = today ? cycleView(activity, today, item.participation) : null;
  const status = withdrawn ? '已退出 · 进度已保留' : joined ? stage === 'received' ? '本期奖励已获得'
    : stage === 'completed' ? benefit.completedStatus : stage === 'skipped' ? '本期已跳过'
    : `参加中 · ${item.participation!.progress}/${activity.target} ${activity.unit}`
    : item.eligible ? usableCardLabel(activity, cards) : '暂无可参加的卡片';
  return {
    id: activity.id,
    participationId: item.participation?.id || '',
    bankName: bank?.name || '银行活动',
    logo: bank?.logo || '',
    title: activity.title,
    activity,
    cardId: item.participation?.cardId || '',
    frequencyLabel: cycleLabel(activity),
    repeating: activityCycle(activity).t !== 'once',
    conditions: activity.conditions,
    cardDescription: activity.cardDescription,
    endsOn: window?.endsOn || activity.endsOn,
    facts: `${activity.cardDescription} · ${activityCycle(activity).t === 'once' ? `${shortDate(activity.endsOn)}截止` : `本期截至 ${shortDate(window?.endsOn || activity.endsOn)}`}`,
    reward: money(activity.rewardMinor, activity.currency, activity.rewardKind),
    rewardLabel: rewardKindLabel(activity),
    invited: activity.requiresInvitation,
    eligible: item.eligible,
    actionLabel: withdrawn ? '重新参加' : joined ? '查看进度' : item.eligible ? '参加' : '不适用',
    status, statusTone: withdrawn ? 'muted' : joined ? 'primary' : item.eligible ? 'success' : 'muted',
    actionTone: withdrawn || (!joined && item.eligible) ? 'primary' : joined ? 'soft' : 'muted',
    joined, withdrawn,
    isNew: !!today && activity.publishedAt.slice(0, 10) >= today,
    cards: matches.map(card => ({ id: card.id, name: cardLabel(card.id, cards), logo: bank?.logo || '',
      description: `${card.kind === 'credit' ? '信用卡' : '借记卡'} · ${networks.find(value => value.id === card.network)?.name || card.network}` })),
    shots: [] as ReturnType<typeof screenshotItems>,
    shotCount: activity.entrance.imageIds.length,
  };
}

Page({
  data: {
    banks,
    bankId: '',
    bankName: '全部银行',
    bankSearch: '',
    filteredBanks: banks,
    mineOnly: true,
    cardCount: 0,
    totalCount: 0,
    walletCards: [] as Card[],
    serverToday: '',
    showBanks: false,
    items: [] as ReturnType<typeof activityView>[],
    cursor: null as string | null,
    loading: false,
    loadingMore: false,
    error: '',
    loadMoreError: '',
    subscribeBusy: false,
    subscribed: false,
    joinBusy: false,
    showJoin: false,
    joinItem: null as ReturnType<typeof activityView> | null,
    selectedCardId: '',
    viewerOpen: false,
    viewerItems: [] as ReturnType<typeof screenshotItems>,
    viewerIndex: 0,
    requestSequence: 0,
  },
  disposed: false,
  visible: true,
  viewerSequence: 0,
  onHide() { this.visible = false; this.viewerSequence += 1; this.setData({ viewerOpen: false }); },
  onUnload() { this.disposed = true; this.data.requestSequence += 1; this.viewerSequence += 1; },
  onShow() {
    this.visible = true;
    if (wx.getStorageSync('activities.mineOnly') === true) {
      const changed = !this.data.mineOnly || this.data.bankId !== '';
      this.setData({ mineOnly: true, bankId: '', bankName: '全部银行', ...(changed ? { items: [], cursor: null, totalCount: 0 } : {}) });
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
      const session = await ensureSession();
      if (this.disposed || sequence !== this.data.requestSequence) return;
      const cards = reset ? await api.query('wallet.get', {}).then(wallet => wallet.cards.filter(card => !card.archivedAt)).catch(() => this.data.walletCards) : this.data.walletCards;
      if (this.disposed || sequence !== this.data.requestSequence) return;
      const items = new Map((reset ? [] : this.data.items).map(item => [item.id, item]));
      const visited = new Set<string>();
      let cursor = query.cursor;
      let nextCursor: string | null = null;
      let totalCount = reset ? 0 : this.data.totalCount;
      while (true) {
        if (cursor) {
          if (visited.has(cursor)) throw new Error('活动分页未能继续，请重试。');
          visited.add(cursor);
        }
        const result = await api.query('catalog.list', { ...query, cursor });
        if (this.disposed || sequence !== this.data.requestSequence) return;
        const assetIds = [...new Set(result.items.flatMap(item => item.activity.entrance.imageIds))];
        const [assets, urls] = assetIds.length ? await Promise.all([
          api.query('assets.get', { ids: assetIds }).catch(() => []),
          api.query('assets.urls', { ids: assetIds }).catch(() => []),
        ]) : [[], []];
        if (this.disposed || sequence !== this.data.requestSequence) return;
        result.items.forEach(item => {
          const view = activityView(item, cards, session.today);
          view.shots = screenshotItems(assets.filter(asset => item.activity.entrance.imageIds.includes(asset.id)), urls);
          if (!view.shots.length) view.shots = item.activity.entrance.imageIds.map((id, index) => ({ id, url: urls.find(value => value.id === id)?.url || '', label: index === 0 ? '活动规则' : '报名入口', uploader: '用户上传', uploadedOn: '' }));
          items.set(item.activity.id, view);
        });
        totalCount = typeof result.total === 'number' ? result.total : items.size;
        nextCursor = result.nextCursor;
        if (!reset || items.size >= targetCount || !nextCursor) break;
        cursor = nextCursor;
      }
      this.setData({ items: [...items.values()], cursor: nextCursor, totalCount, walletCards: cards, cardCount: cards.length, serverToday: session.today });
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
    if (this.data.joinBusy) return;
    this.setData({ bankId, bankName: bank?.name || '全部银行', showBanks: false, items: [], cursor: null, totalCount: 0 });
    void this.load(true);
  },
  changeMine(event: any) {
    if (this.data.joinBusy) return;
    const mineOnly = !!event.detail.value;
    if (mineOnly === this.data.mineOnly) return;
    this.setData({ mineOnly, items: [], cursor: null, totalCount: 0 });
    void this.load(true);
  },
  toggleMine() { this.changeMine({ detail: { value: !this.data.mineOnly } }); },
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
    if (this.data.joinBusy) return;
    const changed = !!this.data.bankId || this.data.mineOnly;
    this.setData({ bankId: '', bankName: '全部银行', mineOnly: false, ...(changed ? { items: [], cursor: null, totalCount: 0 } : {}) });
    void this.load(true);
  },
  addCard() { wx.switchTab({ url: '/pages/wallet/index' }); },
  submitActivity() { wx.navigateTo({ url: '/pages/submission-lead/index' }); },
  async actOnActivity(event: any) {
    if (this.disposed || this.data.loading || this.data.joinBusy) return;
    const item = this.data.items.find(value => value.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.joined) { this.openActivity(event); return; }
    if (item.withdrawn) { await this.joinActivity(item, item.cardId || undefined); return; }
    if (!item.eligible) { wx.showToast({ title: '暂无可参加该活动的卡片', icon: 'none' }); return; }
    this.setData({ joinItem: item, showJoin: true, selectedCardId: '' });
  },
  chooseJoinCard(event: any) {
    if (this.data.joinBusy || !this.data.showJoin || !this.data.joinItem?.cards.some(card => card.id === event.currentTarget.dataset.id)) return;
    this.setData({ selectedCardId: event.currentTarget.dataset.id });
  },
  closeJoin() { if (!this.data.joinBusy) this.setData({ showJoin: false, joinItem: null, selectedCardId: '' }); },
  async confirmJoin() {
    const item = this.data.joinItem;
    if (!item || this.data.joinBusy || (item.activity.scope === 'card' && !item.cards.some(card => card.id === this.data.selectedCardId))) return;
    await this.joinActivity(item, this.data.selectedCardId || undefined);
  },
  async joinActivity(item: ReturnType<typeof activityView>, cardId?: string) {
    if (this.disposed || this.data.joinBusy) return;
    this.setData({ joinBusy: true });
    try {
      await api.command('activity.join', { activityId: item.id, cardId });
      if (this.disposed) return;
      this.setData({ showJoin: false, joinItem: null, selectedCardId: '' });
      if (this.visible) {
        wx.showToast({ title: item.withdrawn ? '已重新参加，原有进度已恢复' : item.activity.requiresRegistration ? '已加入进度，请先在银行 App 完成报名' : '已加入进度', icon: 'none' });
        await this.load(true);
      }
    } catch (error) { if (!this.disposed && this.visible) showError(error); }
    finally { if (!this.disposed) this.setData({ joinBusy: false }); }
  },
  async openShot(event: any) {
    const item = this.data.items.find(value => value.id === event.currentTarget.dataset.id);
    if (!item?.shots.length || this.disposed) return;
    const sequence = ++this.viewerSequence, load = this.data.requestSequence;
    try {
      const urls = await api.query('assets.urls', { ids: item.shots.map(shot => shot.id) });
      if (this.disposed || !this.visible || load !== this.data.requestSequence || sequence !== this.viewerSequence) return;
      this.setData({ viewerOpen: true, viewerItems: item.shots.map(shot => ({ ...shot, url: urls.find(value => value.id === shot.id)?.url || shot.url })), viewerIndex: 0 });
    } catch (error) { if (!this.disposed && sequence === this.viewerSequence) showError(error); }
  },
  closeViewer() { this.viewerSequence += 1; this.setData({ viewerOpen: false }); },
  async onSubscribe() {
    if (this.data.subscribeBusy) return;
    this.setData({ subscribeBusy: true });
    try { await requestReminder('new_activity', 'matches'); if (!this.disposed) this.setData({ subscribed: true }); } catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ subscribeBusy: false }); }
  },
  retry() { void this.load(true); },
  loadMore() { if (this.data.cursor) void this.load(false); },
});

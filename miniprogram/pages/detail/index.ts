import { Activity, Bank, Card, Detail, Issuer } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession, openEntrance, previewAssets, requestReminder } from '../../services/api';
import { money, periodLabel, showError, today } from '../../services/format';

type DirectAction = 'join' | 'complete' | 'receipt';
type CardChoice = { id: string; name: string; issuer: string; qualification: string; matches: boolean };
const frequencyNames = { once: '一次性', monthly: '每月', quarterly: '每季度', yearly: '每年' };
const networkNames = { visa: 'Visa', mastercard: 'Mastercard', unionpay: '银联', amex: 'American Express', other: '其他卡组织' };

function cardMatches(activity: Activity, card: Card) {
  return activity.bankId === card.bankId &&
    (!activity.issuerIds.length || activity.issuerIds.includes(card.issuerId)) &&
    (!activity.networks.length || activity.networks.includes(card.network)) &&
    (activity.cardKind === 'any' || activity.cardKind === card.kind);
}

function detailView(detail: Detail) {
  const activity = detail.participation?.snapshot || detail.activity;
  const participation = detail.participation;
  const bank = banks.find((value: Bank) => value.id === activity.bankId);
  const finished = participation?.stage === 'completed' || participation?.stage === 'received';
  const remaining = Math.max(0, activity.target - (participation?.progress || 0));
  const progressLabel = participation?.stage === 'received' ? '收益已到账' : participation?.stage === 'completed' ? '已完成，等待收益到账' : participation?.stage === 'skipped' ? '本期不参加' : participation?.progress ? `${participation.progress} / ${activity.target} ${activity.unit}` : participation?.registeredAt ? '已报名' : '尚未开始';
  return {
    activity,
    bankName: bank?.name || '银行活动',
    logo: bank?.logo || '',
    frequencyLabel: frequencyNames[activity.frequency],
    reward: money(participation?.receivedMinor ?? activity.rewardMinor, activity.currency),
    rewardLabel: participation?.stage === 'received' ? '实际到账' : activity.rewardKind === 'discount' ? '立减' : '预计返现',
    endsOn: participation?.endsOn || activity.endsOn,
    periodLabel: participation ? periodLabel(participation.periodKey) : '',
    finished,
    progressLabel,
    progressPercent: Math.min(100, Math.max(0, (participation?.progress || 0) / activity.target * 100)),
    showProgress: !!participation && activity.target > 1 && participation.progress > 0 && !finished && participation.stage !== 'skipped',
    progressHelp: participation?.progress ? remaining > 0 ? `还差 ${remaining} ${activity.unit}` : '已达到记录目标，可直接标记完成或到账' : activity.rewardKind === 'discount' ? '优惠当场抵扣后，可直接记到账' : participation?.registeredAt ? `待完成 ${activity.target} ${activity.unit}` : activity.requiresRegistration ? '参与前请先在银行完成报名' : '完成后可直接标记结果',
    receivedMonth: participation?.receivedOn ? `${Number(participation.receivedOn.slice(5, 7))} 月` : '',
    entryAction: activity.entrance.kind === 'miniprogram' ? '打开小程序' : activity.entrance.kind === 'web' ? '复制链接' : '查看指引',
    entryImages: detail.assets.map(asset => ({ id: asset.id, url: asset.fileId.startsWith('cloud://') ? '' : asset.fileId })),
    issuerNames: activity.issuerIds.map(id => issuers.find((issuer: Issuer) => issuer.id === id)?.name).filter(Boolean).join('、') || '以银行规则为准',
    isPast: !!participation && participation.endsOn < today(),
  };
}

Page({
  data: {
    activityId: '', participationId: '',
    detail: null as Detail | null,
    view: null as ReturnType<typeof detailView> | null,
    loading: true, busy: false, error: '',
    showManage: false, showRules: false, showCards: false, showExpected: false, showGuide: false,
    expectedOn: '', expectedError: '',
    selectedCardName: '',
    cards: [] as CardChoice[], selectedCardId: '', pendingAction: 'join' as DirectAction,
    cardSelectionError: '',
  },
  onLoad(options: Record<string, string>) {
    this.setData({ activityId: options.id || options.activityId || '', participationId: options.participationId || '' });
  },
  onShow() { void this.load(); },
  async load() {
    if (!this.data.activityId) { this.setData({ loading: false, error: '没有找到这项活动，请返回活动列表重新打开。' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      await ensureSession();
      const detail = await api.query('activity.get', { activityId: this.data.activityId, participationId: this.data.participationId || undefined });
      this.setData({ detail, view: detailView(detail), participationId: detail.participation?.id || this.data.participationId, selectedCardName: '' });
      if (detail.assets.length) {
        try {
          const urls = await api.query('assets.urls', { ids: detail.assets.map(asset => asset.id) });
          this.setData({ 'view.entryImages': urls });
        } catch (_) { /* Image previews can retry temporary URL resolution independently. */ }
      }
      if (detail.participation?.cardId) {
        try {
          const wallet = await api.query('wallet.get', {});
          const card = wallet.cards.find(item => item.id === detail.participation?.cardId);
          this.setData({ selectedCardName: card ? card.nickname || `${networkNames[card.network]} ${card.kind === 'credit' ? '信用卡' : '储蓄卡'}` : '已移除的卡片' });
        } catch (_) { this.setData({ selectedCardName: '本次关联卡片暂未加载' }); }
      }
    } catch (error) { this.setData({ error: '活动加载失败，请重试。' }); showError(error); }
    finally { this.setData({ loading: false }); }
  },
  retry() { void this.load(); },
  join() { void this.prepareAction('join'); },
  complete() { void this.prepareAction('complete'); },
  receipt() { void this.prepareAction('receipt'); },
  async prepareAction(action: DirectAction, chooseAnother = false) {
    if (this.data.busy || !this.data.detail || !this.data.view) return;
    const participation = this.data.detail.participation;
    if (!chooseAnother && (participation || this.data.view.activity.scope === 'user')) { await this.executeAction(action); return; }
    this.setData({ busy: true });
    try {
      const wallet = await api.query('wallet.get', {});
      const activity = this.data.view.activity;
      const cards = wallet.cards.filter(card => !card.archivedAt && card.bankId === activity.bankId).map(card => {
        const matches = cardMatches(activity, card);
        return {
          id: card.id,
          name: card.nickname || `${networkNames[card.network]} ${card.kind === 'credit' ? '信用卡' : '储蓄卡'}`,
          issuer: issuers.find((issuer: Issuer) => issuer.id === card.issuerId)?.name || '发卡机构待确认',
          qualification: matches ? '卡片条件匹配，活动资格仍以银行为准' : '卡片条件可能不符，仍可手动记录',
          matches,
        };
      });
      this.setData({ cards, showCards: true, selectedCardId: '', pendingAction: action, cardSelectionError: '' });
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  chooseCard(event: any) { this.setData({ selectedCardId: event.currentTarget.dataset.id, cardSelectionError: '' }); },
  confirmCard() {
    if (!this.data.selectedCardId) { this.setData({ cardSelectionError: '请选择本次参加活动的卡片。' }); return; }
    const action = this.data.pendingAction;
    const cardId = this.data.selectedCardId;
    this.setData({ showCards: false });
    void this.executeAction(action, cardId);
  },
  closeCards() { this.setData({ showCards: false, selectedCardId: '', cardSelectionError: '' }); },
  anotherCard() { this.closeManage(); void this.prepareAction('join', true); },
  addCard() { this.closeCards(); wx.navigateTo({ url: `/pages/card-edit/index?bankId=${encodeURIComponent(this.data.view?.activity.bankId || '')}` }); },
  async executeAction(action: DirectAction, cardId?: string) {
    if (this.data.busy || !this.data.detail) return;
    const existing = this.data.detail.participation;
    const participationId = existing && (!cardId || existing.cardId === cardId) ? existing.id : undefined;
    if (action === 'receipt') {
      const params = `activityId=${encodeURIComponent(this.data.activityId)}${participationId ? `&id=${encodeURIComponent(participationId)}` : ''}${cardId ? `&cardId=${encodeURIComponent(cardId)}` : ''}`;
      wx.navigateTo({ url: `/pages/receipt/index?${params}` });
      return;
    }
    this.setData({ busy: true });
    try {
      const result = action === 'join'
        ? await api.command('activity.join', { activityId: this.data.activityId, cardId: cardId || this.data.detail.participation?.cardId })
        : await api.command('participation.complete', { activityId: this.data.activityId, participationId, cardId });
      this.setData({ participationId: result.id });
      this.closeManage();
      await this.load();
      wx.showToast({ title: action === 'join' ? '已加入待办' : '已标记完成', icon: 'success' });
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  editProgress() {
    const record = this.data.detail?.participation;
    if (!record) return;
    wx.navigateTo({ url: `/pages/progress/index?id=${encodeURIComponent(record.id)}&activityId=${encodeURIComponent(this.data.activityId)}` });
  },
  openHistory() { this.closeManage(); wx.navigateTo({ url: `/pages/history/index?activityId=${encodeURIComponent(this.data.activityId)}` }); },
  openRules() { this.setData({ showRules: true }); },
  closeRules() { this.setData({ showRules: false }); },
  openManage() { this.setData({ showManage: true }); },
  closeManage() { this.setData({ showManage: false }); },
  openGuide() { this.setData({ showGuide: true }); },
  closeGuide() { this.setData({ showGuide: false }); },
  async entrance() {
    const entrance = this.data.view?.activity.entrance;
    if (!entrance) return;
    if (entrance.kind === 'guide') { this.openGuide(); return; }
    try { await openEntrance(entrance); } catch (error) { showError(error); }
  },
  async previewImage(event: any) {
    if (!this.data.detail?.assets.length) return;
    try { await previewAssets(this.data.detail.assets, Number(event.currentTarget.dataset.index || 0)); } catch (error) { showError(error); }
  },
  async source() {
    const activity = this.data.view?.activity;
    if (!activity?.sourceUrl) return;
    try { await openEntrance({ kind: 'web', label: '银行规则来源', url: activity.sourceUrl, instructions: activity.sourceNote, imageIds: [] }); } catch (error) { showError(error); }
  },
  openExpected() {
    this.setData({ showExpected: true, expectedOn: this.data.detail?.participation?.expectedOn || '', expectedError: '' });
  },
  closeExpected() { this.setData({ showExpected: false }); },
  changeExpected(event: any) { this.setData({ expectedOn: event.detail.value, expectedError: '' }); },
  clearExpected() { this.setData({ expectedOn: '', expectedError: '' }); },
  async saveExpected() {
    const record = this.data.detail?.participation;
    if (!record || this.data.busy) return;
    if (this.data.expectedOn && this.data.expectedOn < record.startsOn) { this.setData({ expectedError: '预计到账日不能早于本期开始日。' }); return; }
    this.setData({ busy: true });
    try {
      await api.command('participation.expected', { participationId: record.id, expectedOn: this.data.expectedOn || null });
      this.setData({ showExpected: false });
      await this.load();
      wx.showToast({ title: '已更新预计到账日', icon: 'success' });
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async reminder() {
    const record = this.data.detail?.participation;
    if (!record) return;
    try { await requestReminder(record.stage === 'completed' ? 'reward' : 'deadline', record.id); } catch (error) { showError(error); }
  },
  async skip() { await this.changeParticipation('skip'); },
  async resume() { await this.changeParticipation('resume'); },
  async undoComplete() { await this.changeParticipation('undo'); },
  async untrack() { await this.changeParticipation('untrack'); },
  async revokeReceipt() {
    const record = this.data.detail?.participation;
    if (!record || this.data.busy) return;
    const result = await wx.showModal({ title: '撤销这笔到账？', content: '收益将从统计中移除，活动会恢复为已完成、待到账。历史操作记录会保留。', confirmText: '撤销到账', confirmColor: '#b33c3c' });
    if (!result.confirm) return;
    this.setData({ busy: true });
    try { await api.command('reward.revoke', { participationId: record.id }); this.closeManage(); await this.load(); wx.showToast({ title: '已撤销到账', icon: 'success' }); }
    catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async changeParticipation(action: 'skip' | 'resume' | 'undo' | 'untrack') {
    const record = this.data.detail?.participation;
    if (!record || this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (action === 'untrack') await api.command('activity.untrack', { participationId: record.id });
      else if (action === 'undo') await api.command('participation.undoComplete', { participationId: record.id });
      else await api.command('participation.skip', { participationId: record.id, skipped: action === 'skip' });
      this.closeManage();
      await this.load();
      wx.showToast({ title: action === 'untrack' ? '已停止后续追踪' : action === 'undo' ? '已撤销完成' : action === 'skip' ? '本期已跳过' : '已恢复参加', icon: 'success' });
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
});

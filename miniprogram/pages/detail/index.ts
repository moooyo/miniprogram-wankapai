import { Activity, Bank, Card, Detail, Issuer } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession, openEntrance, previewAssets, requestReminder } from '../../services/api';
import { money, periodLabel, showError } from '../../services/format';
import { cardLabel } from '../../services/card-labels';
import { benefitCopy } from '../../services/benefit-copy';
import { navigateBackOr } from '../../services/navigation';
import { entranceActionLabel } from '../../services/entrance';

type DirectAction = 'join' | 'complete' | 'receipt';
type DetailSheet = '' | 'manage' | 'rules' | 'cards' | 'expected' | 'guide';
type CardChoice = { id: string; name: string; issuer: string; qualification: string; matches: boolean };
type ReminderReadyContext = { kind: 'deadline' | 'reward'; recordId: string; version: number; stage: string;
  expectedOn: string | null; endsOn: string; load: number; visibility: number; sequence: number };
const frequencyNames = { once: '一次性', monthly: '每月', quarterly: '每季度', yearly: '每年' };

function cardMismatchReasons(activity: Activity, card: Card): string[] {
  const reasons: string[] = [];
  if (activity.bankId !== card.bankId) reasons.push('银行不匹配');
  if (activity.issuerIds.length && !activity.issuerIds.includes(card.issuerId)) reasons.push('发卡机构不匹配');
  if (activity.networks.length && !activity.networks.includes(card.network)) reasons.push('卡组织不匹配');
  if (activity.cardKind !== 'any' && activity.cardKind !== card.kind) reasons.push('卡片类型不匹配');
  return reasons;
}

function detailView(detail: Detail, serverToday: string) {
  const activity = detail.participation?.snapshot || detail.activity;
  const participation = detail.participation;
  const benefit = benefitCopy(activity.rewardKind);
  const bank = banks.find((value: Bank) => value.id === activity.bankId);
  const finished = participation?.stage === 'completed' || participation?.stage === 'received';
  const remaining = Math.max(0, activity.target - (participation?.progress || 0));
  const primaryAction = !participation ? 'join' : participation.stage === 'skipped' ? 'resume'
    : finished || benefit.isDiscount ? 'receipt' : activity.target > 1 && remaining > 0 ? 'progress' : 'complete';
  const primaryLabel = primaryAction === 'join' ? '加入待办' : primaryAction === 'resume' ? '恢复参加'
    : primaryAction === 'progress' ? '更新进度' : primaryAction === 'complete' ? '标记完成'
    : participation?.stage === 'received' ? benefit.editAction : benefit.recordAction;
  const progressLabel = participation?.stage === 'received' ? benefit.recordedStatus : participation?.stage === 'completed' ? benefit.completedStatus : participation?.stage === 'skipped' ? '本期不参加' : participation?.progress ? `${participation.progress} / ${activity.target} ${activity.unit}` : participation?.registeredAt ? '已报名' : '尚未开始';
  return {
    activity,
    benefit,
    bankName: bank?.name || '银行活动',
    logo: bank?.logo || '',
    frequencyLabel: frequencyNames[activity.frequency],
    reward: money(participation?.receivedMinor ?? activity.rewardMinor, activity.currency),
    rewardLabel: participation?.stage === 'received' ? benefit.actualLabel : benefit.expectedLabel,
    endsOn: participation?.endsOn || activity.endsOn,
    periodLabel: participation ? periodLabel(participation.periodKey) : '',
    finished,
    primaryAction,
    primaryLabel,
    canComplete: !participation || (!finished && participation.stage !== 'skipped'),
    canReceipt: !participation || participation.stage !== 'skipped',
    progressLabel,
    progressPercent: Math.min(100, Math.max(0, (participation?.progress || 0) / activity.target * 100)),
    showProgress: !!participation && activity.target > 1 && participation.progress > 0 && !finished && participation.stage !== 'skipped',
    progressHelp: participation?.progress ? remaining > 0 ? `还差 ${remaining} ${activity.unit}` : `已达到记录目标，可标记完成或${benefit.recordAction}` : benefit.isDiscount ? '优惠当场抵扣后，可记录实际享受的优惠' : participation?.registeredAt ? `待完成 ${activity.target} ${activity.unit}` : activity.requiresRegistration ? '参与前请先在银行完成报名' : '完成后可直接标记结果',
    receivedMonth: participation?.receivedOn ? `${Number(participation.receivedOn.slice(5, 7))} 月` : '',
    entryAction: entranceActionLabel(activity.entrance),
    sourceAction: entranceActionLabel({ kind: 'web', url: activity.sourceUrl, label: '银行规则来源', instructions: activity.sourceNote, imageIds: [] }, 'source'),
    entryImages: detail.assets.map(asset => ({ id: asset.id, url: asset.fileId.startsWith('cloud://') ? '' : asset.fileId })),
    issuerNames: activity.issuerIds.map(id => issuers.find((issuer: Issuer) => issuer.id === id)?.name).filter(Boolean).join('、') || '以银行规则为准',
    isPast: !!participation && participation.endsOn < serverToday,
    deadlineReminderExpired: !!participation && participation.endsOn < serverToday,
  };
}

Page({
  data: {
    activityId: '', participationId: '', serverToday: '',
    detail: null as Detail | null,
    view: null as ReturnType<typeof detailView> | null,
    loading: true, refreshing: false, refreshError: '', outdated: false, mutationNotice: '', busy: false, preparingCards: false, error: '',
    reminderChecking: false, reminderReady: false, reminderError: '',
    showManage: false, showRules: false, showCards: false, showExpected: false, showGuide: false,
    expectedOn: '', expectedError: '', expectedBase: '', expectedDirty: false, expectedClosing: false, expectedLatestNote: '',
    selectedCardName: '',
    cards: [] as CardChoice[], matchingCardCount: 0, cardRequirement: '', cardBankId: '', selectedCardId: '', pendingAction: 'join' as DirectAction,
    cardSelectionError: '',
  },
  disposed: false,
  visible: true,
  loadSequence: 0,
  previewSequence: 0,
  cardPreparationSequence: 0,
  reminderSequence: 0,
  preparingReminder: false,
  reminderReadyContext: null as ReminderReadyContext | null,
  visibilitySequence: 0,
  onHide() { this.visible = false; this.visibilitySequence += 1; this.previewSequence += 1; this.cancelCardPreparation(); this.cancelReminderPreparation(); this.clearReminderReadiness(); },
  onUnload() { this.visible = false; this.cancelCardPreparation(); this.disposed = true; this.cancelReminderPreparation(); this.clearReminderReadiness(); this.loadSequence += 1; this.previewSequence += 1; this.visibilitySequence += 1; },
  onLoad(options: Record<string, string>) {
    this.setData({ activityId: options.id || options.activityId || '', participationId: options.participationId || '' });
  },
  onShow() { this.visible = true; this.syncLeaveAlert(); if (!this.data.busy) return this.load(); },
  isForeground(): boolean {
    if (this.disposed || !this.visible) return false;
    const pages = getCurrentPages();
    return pages[pages.length - 1] === this;
  },
  syncLeaveAlert() {
    if (!this.isForeground()) return;
    if (this.data.showExpected && this.data.expectedDirty) wx.enableAlertBeforeUnload({ message: '预计到账日尚未保存，离开后修改将丢失。' });
    else wx.disableAlertBeforeUnload();
  },
  showPageError(error: unknown) { if (this.isForeground()) showError(error); },
  showPageToast(title: string, icon: 'success' | 'none' = 'none') {
    if (this.isForeground()) wx.showToast({ title, icon });
  },
  async load(refreshSession = false) {
    if (this.disposed) return;
    if (!this.data.activityId && !this.data.participationId) { this.setData({ loading: false, error: '没有找到这项活动，请返回活动列表重新打开。' }); return; }
    this.cancelCardPreparation();
    this.cancelReminderPreparation();
    this.clearReminderReadiness();
    if (this.data.showManage || this.data.showCards) this.commitSheet('');
    const sequence = ++this.loadSequence;
    const query = { ...(this.data.activityId ? { activityId: this.data.activityId } : {}),
      ...(this.data.participationId ? { participationId: this.data.participationId } : {}) };
    this.setData({ loading: !this.data.detail, refreshing: !!this.data.detail, error: '', refreshError: '' });
    try {
      const session = await ensureSession(refreshSession === true);
      if (this.disposed || sequence !== this.loadSequence) return;
      const detail = await api.query('activity.get', query);
      if (this.disposed || sequence !== this.loadSequence) return;
      const view = detailView(detail, session.today);
      const linkedCardId = detail.participation?.cardId;
      const [urls, selectedCardName] = await Promise.all([
        detail.assets.length ? api.query('assets.urls', { ids: detail.assets.map(asset => asset.id) }).catch(() => null) : Promise.resolve(null),
        linkedCardId ? api.query('wallet.get', {}).then(wallet => cardLabel(linkedCardId, wallet.cards)).catch(() => '本次关联卡片暂未加载') : Promise.resolve(''),
      ]);
      if (this.disposed || sequence !== this.loadSequence) return;
      if (urls) {
        const resolvedUrls = new Map(urls.map(item => [item.id, item.url]));
        view.entryImages = view.entryImages.map(item => ({ ...item, url: resolvedUrls.get(item.id) || item.url }));
      }
      const expectedState: Record<string, unknown> = {};
      if (this.data.showExpected) {
        const expectedBase = detail.participation?.expectedOn || '';
        const expectedOn = this.data.expectedDirty ? this.data.expectedOn : expectedBase;
        const expectedDirty = expectedOn !== expectedBase;
        expectedState.expectedBase = expectedBase;
        expectedState.expectedOn = expectedOn;
        expectedState.expectedDirty = expectedDirty;
        expectedState.expectedLatestNote = detail.participation?.stage !== 'completed'
          ? '这期记录的状态已更新，当前选择仍保留，请关闭面板核对最新记录。'
          : expectedDirty && expectedBase !== this.data.expectedBase ? `最新已保存日期：${expectedBase || '未设置'}。你的日期选择仍然保留，请核对后保存。` : '';
      }
      this.setData({ detail, view, serverToday: session.today, activityId: detail.activity.id, participationId: detail.participation?.id || this.data.participationId, selectedCardName,
        outdated: false, mutationNotice: '', reminderError: '', ...expectedState });
      this.syncLeaveAlert();
    } catch (error) {
      if (!this.disposed && sequence === this.loadSequence) {
        if (this.data.detail) this.setData({ outdated: true, refreshError: `${this.data.mutationNotice}活动记录尚未更新，当前显示上次读取的内容。请刷新成功后再修改或开启提醒。` });
        else { this.setData({ error: '活动加载失败，请重试。' }); this.showPageError(error); }
      }
    }
    finally { if (!this.disposed && sequence === this.loadSequence) this.setData({ loading: false, refreshing: false }); }
  },
  actionsBlocked(): boolean { return this.disposed || !this.data.detail || !this.data.view || this.data.loading || this.data.refreshing || this.data.outdated || this.data.busy || this.data.expectedClosing; },
  cancelCardPreparation(notify = false) {
    this.cardPreparationSequence += 1;
    if (!this.data.preparingCards) return;
    this.setData({ preparingCards: false, busy: false });
    if (notify) this.showPageToast('已取消本次选卡，可稍后重新选择。');
  },
  cancelCardSelection() { if (!this.disposed) this.cancelCardPreparation(true); },
  commitSheet(sheet: DetailSheet, patch: Record<string, unknown> = {}) {
    this.cancelCardPreparation();
    this.previewSequence += 1;
    this.setData({ showManage: sheet === 'manage', showRules: sheet === 'rules', showCards: sheet === 'cards',
      showExpected: sheet === 'expected', showGuide: sheet === 'guide', selectedCardId: '', cardSelectionError: '', ...patch });
    this.syncLeaveAlert();
  },
  switchContext(change: () => void | Promise<void>): void | Promise<void> {
    if (this.disposed || this.data.expectedClosing) return;
    if (this.data.busy && !this.data.preparingCards) {
      this.showPageToast('当前操作尚未完成，请稍候。'); return;
    }
    const proceed = () => {
      if (this.disposed || this.data.expectedClosing || (this.data.busy && !this.data.preparingCards)) return;
      this.cancelCardPreparation(true);
      return change();
    };
    if (this.data.showExpected && this.data.expectedDirty) return this.closeExpected().then(() => {
      if (!this.data.showExpected) return proceed();
    });
    return proceed();
  },
  closeSheet(sheet: Exclude<DetailSheet, '' | 'expected'>) {
    const visible = { manage: this.data.showManage, rules: this.data.showRules, cards: this.data.showCards, guide: this.data.showGuide };
    if (visible[sheet]) return this.switchContext(() => this.commitSheet(''));
  },
  retry() { if (!this.data.busy && !this.data.expectedClosing) void this.load(); },
  back() { return this.switchContext(() => { this.commitSheet(''); navigateBackOr('/pages/activities/index', true); }); },
  join() { void this.prepareAction('join'); },
  complete() { void this.prepareAction('complete'); },
  receipt() { void this.prepareAction('receipt'); },
  async prepareAction(action: DirectAction, chooseAnother = false) {
    if (this.actionsBlocked() || !this.data.detail || !this.data.view) return;
    await this.switchContext(async () => {
      if (this.actionsBlocked() || !this.data.detail || !this.data.view) return;
      const participation = this.data.detail.participation;
      if (!chooseAnother && (participation || this.data.view.activity.scope === 'user')) { await this.executeAction(action); return; }
      this.commitSheet('');
      const preparation = ++this.cardPreparationSequence;
      this.setData({ busy: true, preparingCards: true });
      const sequence = this.loadSequence;
      const activity = this.data.detail.activity;
      const current = () => !this.disposed && preparation === this.cardPreparationSequence && sequence === this.loadSequence
        && this.data.preparingCards && !this.data.refreshing && !this.data.outdated;
      try {
        const wallet = await api.query('wallet.get', {});
        if (!current()) return;
        const cards = wallet.cards.filter(card => !card.archivedAt && card.bankId === activity.bankId).map(card => {
          const reasons = cardMismatchReasons(activity, card);
          const matches = reasons.length === 0;
          return {
            id: card.id,
            name: cardLabel(card.id, wallet.cards),
            issuer: issuers.find((issuer: Issuer) => issuer.id === card.issuerId)?.name || '发卡机构待确认',
            qualification: matches ? '卡片条件匹配，活动资格仍以银行为准' : `${reasons.join('、')}，不能用于这项活动。`,
            matches,
          };
        });
        this.commitSheet('cards', { cards, matchingCardCount: cards.filter(card => card.matches).length,
          cardRequirement: activity.cardDescription, cardBankId: activity.bankId, pendingAction: action });
      } catch (error) { if (current()) this.showPageError(error); }
      finally {
        if (!this.disposed && preparation === this.cardPreparationSequence && this.data.preparingCards) this.setData({ busy: false, preparingCards: false });
      }
    });
  },
  chooseCard(event: any) {
    if (this.actionsBlocked() || !this.data.showCards) return;
    const card = this.data.cards.find(item => item.id === event.currentTarget.dataset.id);
    if (!card?.matches) { this.setData({ selectedCardId: '', cardSelectionError: '请选择符合活动条件的卡片，或先添加一张符合条件的卡片。' }); return; }
    this.setData({ selectedCardId: card.id, cardSelectionError: '' });
  },
  confirmCard() {
    if (this.actionsBlocked() || !this.data.showCards) return;
    if (!this.data.selectedCardId) { this.setData({ cardSelectionError: '请选择本次参加活动的卡片。' }); return; }
    if (!this.data.cards.some(card => card.id === this.data.selectedCardId && card.matches)) {
      this.setData({ selectedCardId: '', cardSelectionError: '这张卡不符合活动条件，请改选或添加符合条件的卡片。' }); return;
    }
    const action = this.data.pendingAction;
    const cardId = this.data.selectedCardId;
    this.commitSheet('');
    return this.executeAction(action, cardId);
  },
  closeCards() { return this.closeSheet('cards'); },
  anotherCard() { if (!this.actionsBlocked() && this.data.showManage) return this.prepareAction('join', true); },
  addCard() {
    if (this.actionsBlocked() || !this.data.showCards) return;
    return this.switchContext(() => { this.commitSheet(''); wx.navigateTo({ url: `/pages/card-edit/index?bankId=${encodeURIComponent(this.data.cardBankId || this.data.detail?.activity.bankId || '')}` }); });
  },
  async executeAction(action: DirectAction, cardId?: string) {
    if (this.actionsBlocked() || !this.data.detail) return;
    await this.switchContext(async () => {
      if (this.actionsBlocked() || !this.data.detail) return;
      const existing = this.data.detail.participation;
      if (this.data.view?.activity.scope === 'card' && (!existing || (cardId && cardId !== existing.cardId)) &&
        (!cardId || !this.data.cards.some(card => card.id === cardId && card.matches))) {
        this.setData({ cardSelectionError: '请先选择符合活动条件的卡片。' }); return;
      }
      const participationId = existing && (!cardId || existing.cardId === cardId) ? existing.id : undefined;
      this.commitSheet('');
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
        if (this.disposed) return;
        const message = action === 'join' ? '已加入待办' : benefitCopy(this.data.view!.activity.rewardKind).completedToast;
        this.setData({ participationId: result.id, mutationNotice: action === 'join' ? '加入待办已保存。' : '完成状态已保存。' });
        this.showPageToast(message);
        await this.load();
      } catch (error) { this.showPageError(error); }
      finally { if (!this.disposed) this.setData({ busy: false }); }
    });
  },
  editProgress() {
    if (this.actionsBlocked()) return;
    const record = this.data.detail?.participation;
    if (!record || ['completed', 'received', 'skipped'].includes(record.stage)) return;
    return this.switchContext(() => { this.commitSheet(''); wx.navigateTo({ url: `/pages/progress/index?id=${encodeURIComponent(record.id)}&activityId=${encodeURIComponent(this.data.activityId)}` }); });
  },
  openHistory() { return this.switchContext(() => { this.commitSheet(''); wx.navigateTo({ url: `/pages/history/index?activityId=${encodeURIComponent(this.data.activityId)}` }); }); },
  openRules() { return this.switchContext(() => this.commitSheet('rules')); },
  closeRules() { return this.closeSheet('rules'); },
  openManage() { if (!this.actionsBlocked()) return this.switchContext(() => this.commitSheet('manage')); },
  closeManage() { return this.closeSheet('manage'); },
  openGuide() { return this.switchContext(() => this.commitSheet('guide')); },
  closeGuide() { return this.closeSheet('guide'); },
  guideContextVisible(): boolean { return this.data.showGuide && !this.data.showExpected && !this.data.showManage && !this.data.showCards && !this.data.showRules; },
  async entrance() {
    const entrance = this.data.view?.activity.entrance;
    if (!entrance) return;
    if (entrance.kind === 'guide') { await this.openGuide(); return; }
    await this.switchContext(async () => {
      this.commitSheet('');
      try { await openEntrance(entrance); } catch (error) { this.showPageError(error); }
    });
  },
  async previewImage(event: any) {
    if (this.disposed || !this.guideContextVisible() || !this.data.detail?.assets.length) return;
    const sequence = this.loadSequence;
    const assets = this.data.detail.assets.slice();
    const selectedId = String(event.currentTarget.dataset.id || '');
    const index = assets.findIndex(asset => asset.id === selectedId);
    if (index < 0) return;
    const previewSequence = ++this.previewSequence;
    const galleryIds = assets.map(asset => asset.id);
    const shouldOpen = () => {
      const pages = getCurrentPages();
      const currentIds = this.data.detail?.assets.map(asset => asset.id) || [];
      return !this.disposed && this.guideContextVisible() && sequence === this.loadSequence && previewSequence === this.previewSequence && pages[pages.length - 1] === this
        && galleryIds.length === currentIds.length && galleryIds.every((id, position) => id === currentIds[position]);
    };
    try { await previewAssets(assets, index, shouldOpen); } catch (error) { if (shouldOpen()) this.showPageError(error); }
  },
  async source() {
    const activity = this.data.view?.activity;
    if (!activity?.sourceUrl) return;
    await this.switchContext(async () => {
      this.commitSheet('');
      try { await openEntrance({ kind: 'web', label: '银行规则来源', url: activity.sourceUrl, instructions: activity.sourceNote, imageIds: [] }); } catch (error) { this.showPageError(error); }
    });
  },
  openExpected() {
    if (this.actionsBlocked() || this.data.showExpected || this.data.detail?.participation?.stage !== 'completed' || this.data.view?.benefit.isDiscount) return;
    const expectedOn = this.data.detail?.participation?.expectedOn || '';
    return this.switchContext(() => this.commitSheet('expected', { expectedOn, expectedBase: expectedOn, expectedDirty: false, expectedError: '', expectedLatestNote: '' }));
  },
  async closeExpected() {
    if (this.disposed || this.data.busy || this.data.expectedClosing || !this.data.showExpected) return;
    if (!this.data.expectedDirty) { this.commitSheet(''); return; }
    const visibility = this.visibilitySequence;
    this.setData({ expectedClosing: true });
    try {
      const result = await wx.showModal({ title: '放弃日期修改？', content: '预计到账日尚未保存。继续编辑可以保留当前选择。', confirmText: '放弃修改', cancelText: '继续编辑' });
      if (!this.disposed && visibility === this.visibilitySequence && result.confirm) {
        this.commitSheet('', { expectedOn: this.data.expectedBase, expectedDirty: false, expectedError: '' });
      }
    } catch (error) { this.showPageError(error); }
    finally { if (!this.disposed) this.setData({ expectedClosing: false }); }
  },
  setExpected(value: string) {
    if (this.actionsBlocked() || !this.data.showExpected || this.data.detail?.participation?.stage !== 'completed') return;
    const expectedDirty = value !== this.data.expectedBase;
    this.setData({ expectedOn: value, expectedDirty, expectedError: '' });
    this.syncLeaveAlert();
  },
  changeExpected(event: any) { this.setExpected(event.detail.value); },
  clearExpected() { this.setExpected(''); },
  async saveExpected() {
    const record = this.data.detail?.participation;
    if (this.actionsBlocked() || !this.data.showExpected || !record || record.stage !== 'completed' || record.snapshot.rewardKind === 'discount') return;
    if (this.data.expectedOn && this.data.expectedOn < record.startsOn) { this.setData({ expectedError: '预计到账日不能早于本期开始日。' }); return; }
    this.setData({ busy: true });
    try {
      await api.command('participation.expected', { participationId: record.id, expectedOn: this.data.expectedOn || null });
      if (this.disposed) return;
      this.commitSheet('', { expectedDirty: false, expectedBase: this.data.expectedOn, mutationNotice: '预计到账日已保存。' });
      this.showPageToast('已更新预计到账日', 'success');
      await this.load();
    } catch (error) { if (!this.disposed) { this.setData({ expectedError: '日期未保存，请检查网络后重试。' }); this.showPageError(error); } }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  async reminder() {
    if (this.actionsBlocked() || !this.isForeground()) return;
    const record = this.data.detail?.participation;
    if (!record || ['received', 'skipped'].includes(record.stage) || (record.stage === 'completed' && !record.expectedOn)) return;
    if (record.snapshot.rewardKind === 'discount' && record.stage === 'completed') return;
    if (record.stage !== 'completed' && this.deadlineReminderExpired()) { this.clearReminderReadiness(); return; }
    if (this.reminderReadinessIsCurrent()) { await this.authorizeReminder(); return; }
    this.clearReminderReadiness();
    const kind = record.stage === 'completed' ? 'reward' : 'deadline';
    const sequence = ++this.reminderSequence, visibility = this.visibilitySequence, load = this.loadSequence;
    const current = () => this.isForeground() && sequence === this.reminderSequence && visibility === this.visibilitySequence
      && load === this.loadSequence && !this.data.refreshing && !this.data.outdated
      && this.data.detail?.participation?.id === record.id && this.data.detail.participation.version === record.version
      && this.data.detail.participation.stage === record.stage && this.data.detail.participation.expectedOn === record.expectedOn;
    let authorizing = false;
    this.preparingReminder = true;
    this.setData({ busy: true, reminderChecking: true, reminderError: '' });
    try {
      const session = await ensureSession(true);
      if (!current()) return;
      if (session.userId !== record.ownerId) throw new Error('身份已变化，请返回后使用原账号重新读取活动。');
      const deadlineReminderExpired = record.endsOn < session.today;
      this.setData({ serverToday: session.today, view: { ...this.data.view!, isPast: deadlineReminderExpired, deadlineReminderExpired } });
      if (kind === 'deadline' && deadlineReminderExpired) return;
      if (!session.demo) {
        const preferences = await api.query('preferences.get', {});
        if (!current()) return;
        const enabled = kind === 'reward' ? preferences.rewards : preferences.deadlines;
        if (enabled !== true) {
          if (enabled !== false) throw new Error('提醒设置返回异常，请重试。');
          const label = kind === 'reward' ? '返现待到账' : '活动即将截止';
          this.setData({ reminderChecking: false });
          const result = await wx.showModal({ title: kind === 'reward' ? '先开启到账提醒偏好' : '先开启截止提醒偏好',
            content: `“${label}”总开关目前关闭，不会发送这类微信提醒。请前往提醒设置开启并保存，再回到本期重新申请微信授权。站内待办会继续保留。`,
            confirmText: '前往设置', cancelText: '暂不开启' });
          if (current() && result.confirm) {
            try { await wx.navigateTo({ url: '/pages/preferences/index' }); }
            catch (error) { if (current()) this.showPageError(error); }
          }
          return;
        }
        this.reminderReadyContext = { kind, recordId: record.id, version: record.version, stage: record.stage,
          expectedOn: record.expectedOn, endsOn: record.endsOn, load, visibility, sequence };
        this.setData({ reminderReady: true, reminderChecking: false });
        return;
      }
      if (!current()) return;
      authorizing = true;
      this.preparingReminder = false;
      this.setData({ reminderChecking: false });
      await requestReminder(kind, record.id);
    } catch (error) {
      if (current()) {
        if (authorizing) {
          this.showPageError(error);
          if ((error as { code?: string })?.code === 'REMINDER_UNAVAILABLE') await this.load(true);
        }
        else this.setData({ reminderError: '暂时无法读取提醒设置，尚未申请微信授权。请重试。' });
      }
    } finally {
      if (!this.disposed && sequence === this.reminderSequence) {
        this.preparingReminder = false;
        this.setData({ busy: false, reminderChecking: false });
      }
    }
  },
  cancelReminderPreparation() {
    if (!this.preparingReminder) return;
    this.preparingReminder = false;
    this.reminderSequence += 1;
    if (!this.disposed) this.setData({ busy: false, reminderChecking: false });
  },
  clearReminderReadiness() {
    this.reminderReadyContext = null;
    if (!this.disposed && this.data.reminderReady) this.setData({ reminderReady: false });
  },
  deadlineReminderExpired(): boolean {
    const record = this.data.detail?.participation;
    return !!record && !!this.data.serverToday && record.endsOn < this.data.serverToday;
  },
  reminderReadinessIsCurrent(): boolean {
    const ready = this.reminderReadyContext, record = this.data.detail?.participation;
    return !!ready && !!record && this.data.reminderReady && this.isForeground() && ready.load === this.loadSequence
      && ready.visibility === this.visibilitySequence && ready.sequence === this.reminderSequence
      && record.id === ready.recordId && record.version === ready.version && record.stage === ready.stage
      && record.expectedOn === ready.expectedOn && record.endsOn === ready.endsOn
      && (ready.kind === 'reward' || !this.deadlineReminderExpired());
  },
  async authorizeReminder() {
    if (this.reminderReadyContext?.kind === 'deadline' && this.deadlineReminderExpired()) { this.clearReminderReadiness(); return; }
    if (this.actionsBlocked() || !this.reminderReadinessIsCurrent()) return;
    const ready = this.reminderReadyContext!;
    const sequence = ++this.reminderSequence;
    this.clearReminderReadiness();
    this.setData({ busy: true, reminderError: '' });
    try {
      // Native subscription consent must start in this user-tap call stack, before any awaited read.
      await requestReminder(ready.kind, ready.recordId);
    } catch (error) {
      if (this.isForeground() && ready.visibility === this.visibilitySequence && ready.load === this.loadSequence) {
        this.showPageError(error);
        if ((error as { code?: string })?.code === 'REMINDER_UNAVAILABLE') await this.load(true);
      }
    } finally {
      if (!this.disposed && sequence === this.reminderSequence) this.setData({ busy: false });
    }
  },
  async skip() { await this.changeParticipation('skip'); },
  async resume() { await this.changeParticipation('resume'); },
  async undoComplete() { await this.changeParticipation('undo'); },
  async untrack() { await this.changeParticipation('untrack'); },
  async revokeReceipt() {
    const record = this.data.detail?.participation;
    if (this.actionsBlocked() || !this.data.showManage || !record || record.stage !== 'received') return;
    const benefit = benefitCopy(record.snapshot.rewardKind);
    const sequence = this.loadSequence;
    this.setData({ busy: true });
    try {
      const result = await wx.showModal({ title: benefit.isDiscount ? '撤销这笔优惠记录？' : '撤销这笔到账？', content: `${benefit.actualLabel}金额将从统计中移除，活动会恢复为${benefit.completedStatus}。历史操作记录会保留。`, confirmText: benefit.isDiscount ? '撤销记录' : benefit.revokeAction, confirmColor: '#b33c3c' });
      if (!result.confirm || this.disposed || sequence !== this.loadSequence || this.data.refreshing || this.data.outdated) return;
      await api.command('reward.revoke', { participationId: record.id });
      if (this.disposed) return;
      this.setData({ mutationNotice: `${benefit.revokeSuccess}。` });
      this.commitSheet('');
      this.showPageToast(benefit.revokeSuccess, 'success');
      await this.load();
    }
    catch (error) { this.showPageError(error); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  async changeParticipation(action: 'skip' | 'resume' | 'undo' | 'untrack') {
    const record = this.data.detail?.participation;
    if (this.actionsBlocked() || !record || (action !== 'resume' && !this.data.showManage)) return;
    if (action === 'resume' && (record.stage !== 'skipped' || this.data.showManage || this.data.showRules || this.data.showCards || this.data.showExpected || this.data.showGuide)) return;
    this.setData({ busy: true });
    try {
      if (action === 'untrack') await api.command('activity.untrack', { participationId: record.id });
      else if (action === 'undo') await api.command('participation.undoComplete', { participationId: record.id });
      else await api.command('participation.skip', { participationId: record.id, skipped: action === 'skip' });
      if (this.disposed) return;
      const message = action === 'untrack' ? '已停止后续追踪' : action === 'undo' ? '已撤销完成' : action === 'skip' ? '本期已跳过' : '已恢复参加';
      this.setData({ mutationNotice: `${message}，操作已保存。` });
      this.commitSheet('');
      this.showPageToast(message, 'success');
      await this.load();
    } catch (error) { this.showPageError(error); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
});

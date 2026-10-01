import { Activity, Bank, Card, Commands, Consumption, Detail, Issuer, Participation } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession, openEntrance, previewAssets, requestReminder } from '../../services/api';
import { money, periodLabel, showError } from '../../services/format';
import { cardLabel } from '../../services/card-labels';
import { benefitCopy } from '../../services/benefit-copy';
import { navigateBackOr } from '../../services/navigation';
import { entranceActionLabel } from '../../services/entrance';
import { cycleLabel, cycleView, rewardKindLabel, screenshotItems, shortDate, usableCardLabel } from '../../services/activity-design';
import { confirmDraftRecovery, createCommandIntent, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';

type DirectAction = 'join' | 'complete' | 'receipt';
type DetailSheet = '' | 'manage' | 'rules' | 'cards' | 'expected' | 'guide' | 'quit' | 'consumption' | 'consumptionRecord';
type PendingConsumption = { intentKey: string; payload: Commands['participation.consume'] };
type PendingConsumptionRevoke = { intentKey: string; payload: Commands['consumption.revoke'] };
type ConsumptionDraft = { amount: string; merchant: string; on: string; delta: string;
  pending: PendingConsumption | null; revokePending: PendingConsumptionRevoke | null; selectedId: string };
type CardChoice = { id: string; name: string; issuer: string; qualification: string; matches: boolean };
type ReminderReadyContext = { kind: 'deadline' | 'reward'; recordId: string; version: number; stage: string;
  expectedOn: string | null; endsOn: string; load: number; visibility: number; sequence: number };

function consumptionMode(record: Participation): 'count' | 'amount' | 'custom' {
  return ['笔', '次'].includes(record.snapshot.unit) ? 'count' : ['元', '港元', '澳门元'].includes(record.snapshot.unit) ? 'amount' : 'custom';
}
function consumptionNumber(raw: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1000000000 ? value : null;
}
function sanitizeConsumptionAmount(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  const integer = (parts[0] || (parts.length > 1 ? '0' : '')).replace(/^0+(?=\d)/, '').slice(0, 9);
  return parts.length > 1 ? `${integer}.${parts.slice(1).join('').slice(0, 2)}` : integer;
}
function consumptionPreview(record: Participation, amount: string, delta: string) {
  const mode = consumptionMode(record);
  const increase = mode === 'count' ? 1 : consumptionNumber(mode === 'amount' ? amount : delta) || 0;
  const next = Math.round((record.progress + increase) * 100) / 100;
  const completed = next >= record.snapshot.target;
  return { consumptionPreview: `保存后 ${next}/${record.snapshot.target} ${record.snapshot.unit}${completed ? '，已达标' : ''}`,
    consumptionSaveLabel: completed ? '保存并达标' : '保存', consumptionNextProgress: next };
}
function errorCode(error: unknown): string { return (error as { code?: string })?.code || ''; }
function validConsumptionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function cardMismatchReasons(activity: Activity, card: Card): string[] {
  const reasons: string[] = [];
  if (activity.bankId !== card.bankId) reasons.push('银行不匹配');
  if (activity.issuerIds.length && !activity.issuerIds.includes(card.issuerId)) reasons.push('发卡机构不匹配');
  if (activity.networks.length && !activity.networks.includes(card.network)) reasons.push('卡组织不匹配');
  if (activity.cardKind !== 'any' && activity.cardKind !== card.kind) reasons.push('卡片类型不匹配');
  return reasons;
}

function detailView(detail: Detail, serverToday: string, cards: Card[] = []) {
  const activity = detail.participation?.snapshot || detail.activity;
  const participation = detail.participation;
  const benefit = benefitCopy(activity.rewardKind);
  const bank = banks.find((value: Bank) => value.id === activity.bankId);
  const finished = participation?.stage === 'completed' || participation?.stage === 'received';
  const withdrawn = !!participation?.withdrawnAt;
  const joined = !!participation && !withdrawn;
  const remaining = Math.max(0, activity.target - (participation?.progress || 0));
  const primaryAction = !participation ? 'join' : participation.stage === 'skipped' ? 'resume'
    : finished || benefit.isDiscount ? 'receipt' : activity.target > 1 && remaining > 0 ? 'progress' : 'complete';
  const primaryLabel = primaryAction === 'join' ? '加入待办' : primaryAction === 'resume' ? '恢复参加'
    : primaryAction === 'progress' ? '更新进度' : primaryAction === 'complete' ? '标记完成'
    : participation?.stage === 'received' ? benefit.editAction : benefit.recordAction;
  const progressLabel = participation?.stage === 'received' ? benefit.recordedStatus : participation?.stage === 'completed' ? benefit.completedStatus : participation?.stage === 'skipped' ? '本期不参加' : participation?.progress ? `${participation.progress} / ${activity.target} ${activity.unit}` : participation?.registeredAt ? '已报名' : '尚未开始';
  const cycle = cycleView(activity, serverToday, participation);
  const labels = benefit.isDiscount ? [activity.requiresRegistration ? '报名' : '参与', '达标', '立减'] : [activity.requiresRegistration ? '报名' : '参与', '达标', '待到账', '到账'];
  const currentStep = participation?.stage === 'received' ? labels.length : participation?.stage === 'completed' ? 2 : activity.requiresRegistration && !participation?.registeredAt ? 0 : 1;
  const requiresRegistration = joined && !finished && activity.requiresRegistration && !participation?.registeredAt;
  const canJoin = withdrawn || detail.eligible;
  const primaryUiAction = withdrawn ? 'rejoin' : !participation ? canJoin ? 'join' : 'disabled' : participation.stage === 'received' ? 'done'
    : participation.stage === 'skipped' ? 'resume' : requiresRegistration ? 'register' : finished ? 'receipt' : 'consumption';
  const primaryUiLabel = primaryUiAction === 'rejoin' ? '重新参加' : primaryUiAction === 'join' ? '参加活动' : primaryUiAction === 'disabled' ? '暂不可参加'
    : primaryUiAction === 'register' ? '已完成报名' : primaryUiAction === 'consumption' ? '记录消费'
    : primaryUiAction === 'done' ? `${benefit.recordedStatus} ${money(participation?.receivedMinor || 0, activity.currency, activity.rewardKind)}` : primaryLabel;
  const quitRows = ['从「进度」中移除，不再提醒截止与到账', finished ? '已达标的奖励将不再提醒到账确认'
    : participation?.progress ? `本期已记录 ${participation.progress}/${activity.target} ${activity.unit}，记录将保留在「全部参与记录」` : '记录将保留在「全部参与记录」',
    cycle.repeating && cycle.nextStartsOn ? `${shortDate(cycle.nextStartsOn)} 重置后，不再自动跟进下一期` : '如需恢复，可在活动详情页点击「重新参加」，原有进度将保留'];
  if (activity.requiresRegistration && participation?.registeredAt) quitRows.push('仅停止玩卡派内的跟进，不影响银行 App 中的报名状态');
  return {
    activity,
    benefit,
    bankName: bank?.name || '银行活动',
    logo: bank?.logo || '',
    frequencyLabel: cycleLabel(activity),
    cycle, joined, withdrawn, canJoin, primaryUiAction, primaryUiLabel, requiresRegistration,
    reward: money(participation?.receivedMinor ?? activity.rewardMinor, activity.currency, activity.rewardKind),
    rewardKindLabel: rewardKindLabel(activity),
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
    progressHint: participation?.stage === 'received' ? benefit.recordedStatus : participation?.stage === 'completed' ? benefit.pendingStatus : participation?.stage === 'skipped' ? '本期不参加' : requiresRegistration ? '请先在银行 App 报名' : remaining > 0 ? `还需 ${remaining} ${activity.unit}` : '已达标',
    progressText: `${participation?.progress || 0}/${activity.target}`,
    segmented: activity.target > 1 && activity.target <= 12 && !['元', '港元', '澳门元'].includes(activity.unit),
    segments: Array.from({ length: Math.min(12, activity.target) }, (_, index) => ({ id: index, filled: index < (participation?.progress || 0) })),
    dueLine: participation?.stage === 'received' ? '本期已完成' : participation?.stage === 'completed' ? participation.expectedOn ? `预计 ${shortDate(participation.expectedOn)} 到账` : '达标后请确认实际奖励' : `${shortDate(participation?.endsOn || cycle.endsOn)} 截止`,
    steps: labels.map((label, index) => ({ id: index, number: index + 1, label, done: index < currentStep, current: index === currentStep,
      lineFilled: index <= currentStep, sub: label === '待到账' && participation?.expectedOn ? shortDate(participation.expectedOn) : '' })),
    eligibilityTitle: usableCardLabel(activity, cards),
    eligibilitySubtitle: withdrawn ? '你曾退出该活动，重新参加后将恢复原有进度' : canJoin ? '参加后将加入「进度」，按周期提醒截止与到账，可随时退出。' : '卡包中暂无符合条件的卡片',
    bankShortName: bank?.shortName || '银行',
    periodDescription: `${activity.startsOn.replace(/-/g, '/')} – ${activity.endsOn.replace(/-/g, '/')}，${cycle.repeating ? cycleLabel(activity) : '单次活动'}`,
    quitRows,
    lastChecked: shortDate((activity.entrance.verifiedAt || activity.updatedAt).slice(0, 10)),
    shots: screenshotItems(detail.assets),
    consumptions: (detail.consumptions || []).map(record => ({ id: record.id, date: record.consumedOn.slice(5).replace('-', '/'),
      merchant: record.merchant || '手动记录', amount: record.amountMinor === null ? '—' : money(record.amountMinor, record.currency),
      reversed: !!record.reversedAt, progressLabel: `+${record.progressDelta} ${activity.unit}` })),
    consumptionCount: (detail.consumptions || []).filter(record => !record.reversedAt).length,
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
    showQuit: false, viewerOpen: false, viewerItems: [] as ReturnType<typeof screenshotItems>, viewerIndex: 0,
    showConsumption: false, showConsumptionRecord: false, showCelebration: false,
    consumptionAmount: '', consumptionMerchant: '', consumptionOn: '', consumptionDelta: '', consumptionMode: 'count' as 'count' | 'amount' | 'custom',
    consumptionCurrencySymbol: '¥', consumptionPresets: [] as { value: string; label: string }[], consumptionDirty: false,
    consumptionPreview: '', consumptionDateLabel: '', consumptionSaveLabel: '保存', consumptionNextProgress: 0, consumptionError: '', consumptionNotice: '',
    consumptionConflict: false, consumptionReapplyRequired: false, consumptionReloading: false, consumptionBaseVersion: 0,
    consumptionPending: null as PendingConsumption | null, consumptionRevokePending: null as PendingConsumptionRevoke | null,
    selectedConsumptionId: '', selectedConsumption: null as Consumption | null, selectedConsumptionAmount: '',
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
  consumptionSequence: 0,
  consumptionDraftRecord: '',
  consumptionDraftFingerprint: '',
  onHide() { this.persistConsumption(); this.visible = false; this.visibilitySequence += 1; this.previewSequence += 1; this.setData({ viewerOpen: false, showCelebration: false }); this.cancelCardPreparation(); this.cancelReminderPreparation(); this.clearReminderReadiness(); },
  onUnload() { this.persistConsumption(); this.visible = false; this.cancelCardPreparation(); this.disposed = true; this.cancelReminderPreparation(); this.clearReminderReadiness(); this.loadSequence += 1; this.previewSequence += 1; this.visibilitySequence += 1; this.consumptionSequence += 1; },
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
    if (this.data.consumptionPending || this.data.consumptionRevokePending) wx.enableAlertBeforeUnload({ message: '消费保存结果尚未确认，原请求已暂存，返回后请继续核对。' });
    else if (this.data.showConsumption && this.data.consumptionDirty) wx.enableAlertBeforeUnload({ message: '消费记录尚未保存，填写内容已暂存本机。' });
    else if (this.data.showExpected && this.data.expectedDirty) wx.enableAlertBeforeUnload({ message: '预计到账日尚未保存，离开后修改将丢失。' });
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
    if (this.data.showManage || this.data.showCards || this.data.showQuit) this.commitSheet('');
    const sequence = ++this.loadSequence;
    const query = { ...(this.data.activityId ? { activityId: this.data.activityId } : {}),
      ...(this.data.participationId ? { participationId: this.data.participationId } : {}) };
    this.setData({ loading: !this.data.detail, refreshing: !!this.data.detail, error: '', refreshError: '' });
    try {
      const session = await ensureSession(refreshSession === true);
      if (this.disposed || sequence !== this.loadSequence) return;
      const detail = await api.query('activity.get', query);
      if (this.disposed || sequence !== this.loadSequence) return;
      const linkedCardId = detail.participation?.cardId;
      const [urls, wallet] = await Promise.all([
        detail.assets.length ? api.query('assets.urls', { ids: detail.assets.map(asset => asset.id) }).catch(() => null) : Promise.resolve(null),
        api.query('wallet.get', {}).catch(() => null),
      ]);
      if (this.disposed || sequence !== this.loadSequence) return;
      const view = detailView(detail, session.today, wallet?.cards || []);
      const selectedCardName = linkedCardId ? wallet ? cardLabel(linkedCardId, wallet.cards) : '本次关联卡片暂未加载' : '';
      if (urls) {
        const resolvedUrls = new Map(urls.map(item => [item.id, item.url]));
        view.entryImages = view.entryImages.map(item => ({ ...item, url: resolvedUrls.get(item.id) || item.url }));
        view.shots = screenshotItems(detail.assets, urls);
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
      if (this.data.showConsumption && this.data.consumptionDirty && !this.data.consumptionPending && detail.participation
        && this.data.consumptionBaseVersion !== detail.participation.version) {
        this.setData({ consumptionConflict: true, consumptionReapplyRequired: true,
          consumptionNotice: '活动记录已有更新，当前填写仍保留。请核对最新进度后确认应用。' });
      }
      if (this.data.selectedConsumptionId) {
        const selected = detail.consumptions?.find(row => row.id === this.data.selectedConsumptionId) || null;
        this.setData({ selectedConsumption: selected, selectedConsumptionAmount: selected ? selected.amountMinor === null ? '—' : money(selected.amountMinor, selected.currency) : '' });
        if (!selected && this.data.showConsumptionRecord && !this.data.consumptionRevokePending) this.commitSheet('');
      }
      this.restorePendingConsumption(detail.participation);
      this.syncLeaveAlert();
    } catch (error) {
      if (!this.disposed && sequence === this.loadSequence) {
        if (this.data.detail) this.setData({ outdated: true, refreshError: `${this.data.mutationNotice}活动记录尚未更新，当前显示上次读取的内容。请刷新成功后再修改或开启提醒。` });
        else { this.setData({ error: '活动加载失败，请重试。' }); this.showPageError(error); }
      }
    }
    finally { if (!this.disposed && sequence === this.loadSequence) this.setData({ loading: false, refreshing: false }); }
  },
  actionsBlocked(): boolean { return this.disposed || !this.data.detail || !this.data.view || this.data.loading || this.data.refreshing || this.data.outdated || this.data.busy || this.data.expectedClosing || this.data.consumptionReloading || !!this.data.consumptionPending || !!this.data.consumptionRevokePending; },
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
      showExpected: sheet === 'expected', showGuide: sheet === 'guide', showQuit: sheet === 'quit', viewerOpen: false,
      showConsumption: sheet === 'consumption', showConsumptionRecord: sheet === 'consumptionRecord', showCelebration: false,
      selectedCardId: '', cardSelectionError: '', ...patch });
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
    if (this.data.showConsumption && this.data.consumptionDirty && !this.data.consumptionPending) return this.closeConsumption().then(() => {
      if (!this.data.showConsumption) return proceed();
    });
    return proceed();
  },
  closeSheet(sheet: Exclude<DetailSheet, '' | 'expected'>) {
    const visible = { manage: this.data.showManage, rules: this.data.showRules, cards: this.data.showCards, guide: this.data.showGuide, quit: this.data.showQuit,
      consumption: this.data.showConsumption, consumptionRecord: this.data.showConsumptionRecord };
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
        const message = action === 'join' ? existing?.withdrawnAt ? '已重新参加，原有进度已恢复'
          : this.data.view!.activity.requiresRegistration ? '已加入进度，请先在银行 App 完成报名' : '已加入进度' : benefitCopy(this.data.view!.activity.rewardKind).completedToast;
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
    if (!record || record.withdrawnAt || ['completed', 'received', 'skipped'].includes(record.stage)) return;
    return this.switchContext(() => { this.commitSheet(''); wx.navigateTo({ url: `/pages/progress/index?id=${encodeURIComponent(record.id)}&activityId=${encodeURIComponent(this.data.activityId)}` }); });
  },
  persistConsumption(): boolean {
    const record = this.data.detail?.participation;
    if (!record) return false;
    if (!this.data.consumptionDirty && !this.data.consumptionPending && !this.data.consumptionRevokePending) return true;
    const value: ConsumptionDraft = { amount: this.data.consumptionAmount, merchant: this.data.consumptionMerchant,
      on: this.data.consumptionOn, delta: this.data.consumptionDelta, pending: this.data.consumptionPending,
      revokePending: this.data.consumptionRevokePending, selectedId: this.data.selectedConsumptionId };
    const fingerprint = JSON.stringify(value);
    if (fingerprint === this.consumptionDraftFingerprint) {
      const stored = loadDraft<ConsumptionDraft>('detail-consumption', record.ownerId, record.id);
      if (stored && JSON.stringify(stored.value) === fingerprint) return true;
    }
    const saved = saveDraft('detail-consumption', record.ownerId, record.id, this.data.consumptionBaseVersion || record.version, value);
    if (saved) this.consumptionDraftFingerprint = fingerprint;
    else this.setData({ consumptionNotice: '本机暂存失败，当前填写仍保留。' });
    return saved;
  },
  restorePendingConsumption(record: Participation | null) {
    if (!record || this.consumptionDraftRecord === record.id || this.data.consumptionDirty) return;
    const saved = loadDraft<ConsumptionDraft>('detail-consumption', record.ownerId, record.id);
    const value = saved?.value;
    if (!value) return;
    const pending = value.pending;
    const revoke = value.revokePending;
    const validIntent = (intent: string) => typeof intent === 'string' && intent.length > 0 && intent.length <= 128;
    const validPending = pending && validIntent(pending.intentKey) && pending.payload?.participationId === record.id
      && Number.isSafeInteger(pending.payload.expectedVersion) && validConsumptionDate(pending.payload.consumedOn);
    const validRevoke = revoke && validIntent(revoke.intentKey) && typeof revoke.payload?.id === 'string'
      && Number.isSafeInteger(revoke.payload.expectedVersion);
    if (!validPending && !validRevoke) return;
    this.consumptionDraftRecord = record.id;
    this.consumptionDraftFingerprint = JSON.stringify(value);
    this.setData({ consumptionAmount: typeof value.amount === 'string' ? value.amount : '', consumptionMerchant: typeof value.merchant === 'string' ? value.merchant : '',
      consumptionOn: typeof value.on === 'string' ? value.on : record.startsOn, consumptionDelta: typeof value.delta === 'string' ? value.delta : '',
      consumptionPending: validPending ? pending : null, consumptionRevokePending: validRevoke ? revoke : null,
      selectedConsumptionId: typeof value.selectedId === 'string' ? value.selectedId : '', consumptionDirty: !!validPending,
      consumptionBaseVersion: validPending ? pending!.payload.expectedVersion : revoke!.payload.expectedVersion,
      consumptionNotice: '上次保存结果尚未确认，请继续核对原请求。' });
  },
  consumptionBlocked(): boolean {
    return this.disposed || !this.isForeground() || !this.data.detail?.participation || this.data.loading || this.data.refreshing
      || this.data.outdated || this.data.busy || this.data.expectedClosing || this.data.consumptionReloading;
  },
  async openConsumption() {
    const record = this.data.detail?.participation;
    if (this.consumptionBlocked() || !record || this.data.consumptionRevokePending) return;
    if (!this.data.consumptionPending && (record.withdrawnAt || ['completed', 'received', 'skipped'].includes(record.stage))) return;
    await this.switchContext(async () => {
      if (this.consumptionBlocked()) return;
      const mode = consumptionMode(record), remaining = Math.max(0, record.snapshot.target - record.progress);
      const values = mode === 'amount' ? [200, 500, remaining].filter(value => value > 0) : [50, 100, 250];
      const defaultOn = this.data.serverToday < record.startsOn ? record.startsOn : this.data.serverToday > record.endsOn ? record.endsOn : this.data.serverToday;
      const existing = this.consumptionDraftRecord === record.id && (this.data.consumptionDirty || this.data.consumptionPending);
      const patch: Record<string, unknown> = { consumptionMode: mode, consumptionCurrencySymbol: { CNY: '¥', HKD: 'HK$', MOP: 'MOP$' }[record.snapshot.currency],
        consumptionPresets: [...new Set(values)].map(value => ({ value: String(value), label: mode === 'amount' && value === remaining ? `补齐 ${money(Math.round(value * 100), record.snapshot.currency)}` : money(Math.round(value * 100), record.snapshot.currency) })) };
      if (existing && !this.data.consumptionPending && this.data.consumptionBaseVersion !== record.version) Object.assign(patch,
        { consumptionConflict: true, consumptionReapplyRequired: true, consumptionNotice: '当前进度已有更新，请读取最新记录并核对原填写。' });
      if (!existing) {
        Object.assign(patch, { consumptionAmount: '', consumptionMerchant: '', consumptionOn: defaultOn, consumptionDelta: '', consumptionDirty: false,
          consumptionBaseVersion: record.version, consumptionError: '', consumptionNotice: '', consumptionConflict: false, consumptionReapplyRequired: false });
        const saved = loadDraft<ConsumptionDraft>('detail-consumption', record.ownerId, record.id);
        if (saved && !saved.value.pending && !saved.value.revokePending
          && ['amount', 'merchant', 'on', 'delta'].every(key => typeof saved.value[key as keyof ConsumptionDraft] === 'string')) {
          const visibility = this.visibilitySequence;
          const recover = await confirmDraftRecovery(saved, record.version);
          if (!this.isForeground() || visibility !== this.visibilitySequence) return;
          const latest = this.data.detail?.participation;
          if (!latest || latest.id !== record.id || latest.ownerId !== record.ownerId) return;
          if (recover) Object.assign(patch, { consumptionAmount: saved.value.amount, consumptionMerchant: saved.value.merchant,
            consumptionOn: saved.value.on, consumptionDelta: saved.value.delta, consumptionDirty: true,
            consumptionConflict: saved.baseVersion !== latest.version, consumptionReapplyRequired: saved.baseVersion !== latest.version,
            consumptionNotice: '已恢复未保存内容，请核对活动期与当前进度。' });
          else removeDraft('detail-consumption', record.ownerId, record.id);
        }
      }
      this.consumptionDraftRecord = record.id;
      this.commitSheet('consumption', patch);
      this.updateConsumptionPreview();
    });
  },
  async closeConsumption() {
    if (this.disposed || this.data.busy || this.data.expectedClosing || !this.data.showConsumption) return;
    this.persistConsumption();
    this.commitSheet('');
  },
  updateConsumptionPreview() {
    const record = this.data.detail?.participation;
    if (record) this.setData({ ...consumptionPreview(record, this.data.consumptionAmount, this.data.consumptionDelta), consumptionDateLabel: this.data.consumptionOn.replace(/-/g, '/') });
  },
  changeConsumption(field: 'consumptionAmount' | 'consumptionMerchant' | 'consumptionOn' | 'consumptionDelta', value: string) {
    if (this.consumptionBlocked() || !this.data.showConsumption || this.data.consumptionPending || this.data.consumptionRevokePending || this.data.consumptionConflict || this.data.consumptionReapplyRequired) return;
    this.setData({ [field]: value, consumptionDirty: true, consumptionError: '' });
    this.updateConsumptionPreview(); this.persistConsumption(); this.syncLeaveAlert();
  },
  changeConsumptionAmount(event: any) { this.changeConsumption('consumptionAmount', sanitizeConsumptionAmount(String(event.detail.value || ''))); },
  changeConsumptionMerchant(event: any) { this.changeConsumption('consumptionMerchant', String(event.detail.value || '').slice(0, 80)); },
  changeConsumptionDate(event: any) { this.changeConsumption('consumptionOn', String(event.detail.value || '')); },
  changeConsumptionDelta(event: any) { this.changeConsumption('consumptionDelta', sanitizeConsumptionAmount(String(event.detail.value || ''))); },
  chooseConsumptionPreset(event: any) { this.changeConsumption('consumptionAmount', String(event.currentTarget.dataset.value || '')); },
  async saveConsumption() {
    const record = this.data.detail?.participation;
    if (this.consumptionBlocked() || !record || !this.data.showConsumption || this.data.consumptionPending || this.data.consumptionRevokePending
      || this.data.consumptionConflict || this.data.consumptionReapplyRequired || record.withdrawnAt || ['completed', 'received', 'skipped'].includes(record.stage)) return;
    const amount = this.data.consumptionAmount.trim(), parsedAmount = amount ? consumptionNumber(amount) : null;
    const mode = consumptionMode(record), delta = mode === 'count' ? 1 : mode === 'amount' ? parsedAmount : consumptionNumber(this.data.consumptionDelta);
    if (amount && parsedAmount === null) { this.setData({ consumptionError: '请输入有效金额，最多两位小数。' }); return; }
    if (delta === null || delta <= 0) { this.setData({ consumptionError: mode === 'amount' ? '请输入大于 0 的消费金额。' : '请输入本次增加的有效进度。' }); return; }
    const consumedOn = this.data.consumptionOn;
    if (!validConsumptionDate(consumedOn) || consumedOn < record.startsOn || consumedOn > record.endsOn || consumedOn > this.data.serverToday) {
      this.setData({ consumptionError: '消费日期须在本期内，且不能晚于今天。' }); return;
    }
    const payload: Commands['participation.consume'] = { participationId: record.id, consumedOn, expectedVersion: record.version,
      ...(parsedAmount !== null ? { amountMinor: Math.round(parsedAmount * 100) } : {}),
      ...(this.data.consumptionMerchant.trim() ? { merchant: this.data.consumptionMerchant.trim() } : {}),
      ...(mode !== 'count' ? { progressDelta: delta } : {}) };
    this.setData({ consumptionPending: { intentKey: createCommandIntent(), payload }, consumptionBaseVersion: record.version, consumptionError: '' });
    if (!this.persistConsumption()) {
      this.setData({ consumptionPending: null, consumptionError: '本机暂存失败，消费尚未发送。请释放存储空间后重试，当前填写仍保留。' });
      this.syncLeaveAlert(); return;
    }
    this.syncLeaveAlert();
    await this.executeConsumption(false, true);
  },
  async retryConsumption() { await this.executeConsumption(false); },
  async executeConsumption(lookupOnly: boolean, fresh = false) {
    const pending = this.data.consumptionPending, record = this.data.detail?.participation;
    if (this.consumptionBlocked() || !pending || !record || pending.payload.participationId !== record.id) return;
    if (!this.persistConsumption()) {
      this.setData({ ...(fresh ? { consumptionPending: null } : {}), consumptionError: '本机暂存失败，本次操作尚未发送。原填写仍保留，请稍后重试。' });
      this.syncLeaveAlert(); return;
    }
    const sequence = ++this.consumptionSequence, visibility = this.visibilitySequence, load = this.loadSequence;
    const ownerId = record.ownerId;
    let revision = getDraftRevision('detail-consumption', ownerId, record.id);
    const current = () => !this.disposed && sequence === this.consumptionSequence;
    const foreground = () => current() && this.isForeground() && visibility === this.visibilitySequence && load === this.loadSequence;
    this.setData({ busy: true, consumptionError: '' });
    try {
      const session = await ensureSession(true);
      if (!current()) return;
      if (!foreground()) return;
      if (session.userId !== ownerId) throw new Error('身份已变化，请使用原账号核对消费保存结果。');
      if (!this.persistConsumption()) {
        this.setData({ ...(fresh ? { consumptionPending: null } : {}), consumptionError: '本机暂存失败，本次操作尚未发送。当前填写仍保留。' });
        this.syncLeaveAlert(); return;
      }
      revision = getDraftRevision('detail-consumption', ownerId, record.id);
      const replayOnly = lookupOnly || !!record.withdrawnAt || ['received', 'skipped'].includes(record.stage)
        || record.version !== pending.payload.expectedVersion || (!fresh && session.today > record.endsOn);
      const result = await api.command('participation.consume', pending.payload, { intentKey: pending.intentKey, ...(replayOnly ? { replayOnly: true } : {}) });
      removeDraft('detail-consumption', ownerId, record.id, revision);
      if (!current()) return;
      this.consumptionDraftFingerprint = '';
      this.setData({ consumptionPending: null, consumptionDirty: false, consumptionConflict: false, consumptionReapplyRequired: false,
        consumptionNotice: '', consumptionAmount: '', consumptionMerchant: '', consumptionOn: '', consumptionDateLabel: '', consumptionDelta: '', mutationNotice: '消费记录已保存。' });
      if (!foreground()) return;
      this.commitSheet('');
      this.showPageToast('消费记录已保存', 'success');
      await this.load();
      if (current() && this.isForeground() && visibility === this.visibilitySequence && this.data.detail?.participation?.stage === 'completed'
        && record.progress < record.snapshot.target && result.version === this.data.detail.participation.version) this.setData({ showCelebration: true });
      this.syncLeaveAlert();
    } catch (error) {
      if (!current()) return;
      const code = errorCode(error);
      if (code === 'VERSION_CONFLICT') {
        this.setData({ consumptionPending: null, consumptionConflict: true, consumptionError: '记录已被更新，填写内容已保留。请读取最新记录并核对后再保存。' });
      } else if (['INVALID_INPUT', 'INVALID_DATE', 'FORBIDDEN', 'ACTIVITY_INACTIVE', 'NOT_FOUND'].includes(code)) {
        this.setData({ consumptionPending: null, consumptionError: (error as Error).message || '这笔消费尚未保存，请核对记录后重试。' });
      } else this.setData({ consumptionError: '保存结果尚未确认。原金额、日期及操作标识已保留，请继续核对原请求。' });
      this.persistConsumption(); this.syncLeaveAlert();
    } finally { if (current()) this.setData({ busy: false }); }
  },
  async reloadConsumption() {
    if (this.consumptionBlocked()) return;
    if (this.data.consumptionPending) { await this.executeConsumption(true); return; }
    this.setData({ consumptionReloading: true, consumptionError: '' });
    try {
      await this.load();
      if (this.disposed || !this.isForeground()) return;
      if (this.data.outdated) return;
      this.setData({ consumptionConflict: false, consumptionReapplyRequired: true, consumptionNotice: '已读取最新进度。请核对消费日期和新增进度，再确认应用当前填写。' });
      this.updateConsumptionPreview();
    } finally { if (!this.disposed) this.setData({ consumptionReloading: false }); }
  },
  reviewConsumption() {
    const record = this.data.detail?.participation;
    if (this.consumptionBlocked() || !record || !this.data.showConsumption || this.data.consumptionPending || record.withdrawnAt || ['completed', 'received', 'skipped'].includes(record.stage)) return;
    this.setData({ consumptionConflict: false, consumptionReapplyRequired: false, consumptionBaseVersion: record.version, consumptionError: '', consumptionNotice: '已确认采用最新记录，请核对后保存。' });
    this.updateConsumptionPreview(); this.persistConsumption();
  },
  openConsumptionRecord(event: any) {
    if (this.consumptionBlocked() || this.data.consumptionPending) return;
    const selected = this.data.detail?.consumptions?.find(record => record.id === event.currentTarget.dataset.id);
    if (!selected) return;
    if (this.data.consumptionRevokePending && this.data.consumptionRevokePending.payload.id !== selected.id) return;
    return this.switchContext(() => this.commitSheet('consumptionRecord', { selectedConsumptionId: selected.id, selectedConsumption: selected,
      selectedConsumptionAmount: selected.amountMinor === null ? '—' : money(selected.amountMinor, selected.currency), consumptionError: '' }));
  },
  closeConsumptionRecord() { return this.closeSheet('consumptionRecord'); },
  async retryConsumptionRevoke() {
    const pending = this.data.consumptionRevokePending;
    if (!pending || this.consumptionBlocked()) return;
    const selected = this.data.detail?.consumptions?.find(record => record.id === pending.payload.id);
    if (!selected) { this.setData({ consumptionError: '暂未找到原记录，请刷新后继续核对。' }); return; }
    this.commitSheet('consumptionRecord', { selectedConsumptionId: selected.id, selectedConsumption: selected,
      selectedConsumptionAmount: selected.amountMinor === null ? '—' : money(selected.amountMinor, selected.currency) });
    await this.revokeConsumption();
  },
  async revokeConsumption() {
    const record = this.data.detail?.participation, selected = this.data.detail?.consumptions?.find(row => row.id === this.data.selectedConsumptionId);
    if (this.consumptionBlocked() || !this.data.showConsumptionRecord || !record || !selected || this.data.consumptionPending) return;
    if (!this.data.consumptionRevokePending && (selected.reversedAt || record.withdrawnAt || ['received', 'skipped'].includes(record.stage))) return;
    const fresh = !this.data.consumptionRevokePending;
    const pending = this.data.consumptionRevokePending || { intentKey: createCommandIntent(), payload: { id: selected.id, expectedVersion: record.version } };
    if (pending.payload.id !== selected.id) return;
    this.setData({ consumptionRevokePending: pending, consumptionBaseVersion: pending.payload.expectedVersion, consumptionError: '' });
    if (!this.persistConsumption()) {
      this.setData({ ...(fresh ? { consumptionRevokePending: null } : {}), consumptionError: '本机暂存失败，撤销尚未发送。原消费记录保留，请释放存储空间后重试。' });
      this.syncLeaveAlert(); return;
    }
    this.syncLeaveAlert();
    let revision = getDraftRevision('detail-consumption', record.ownerId, record.id);
    const sequence = ++this.consumptionSequence,
      visibility = this.visibilitySequence, load = this.loadSequence;
    const current = () => !this.disposed && sequence === this.consumptionSequence;
    this.setData({ busy: true });
    try {
      const session = await ensureSession(true);
      if (!current()) return;
      if (!this.isForeground() || visibility !== this.visibilitySequence || load !== this.loadSequence) return;
      if (session.userId !== record.ownerId) throw new Error('身份已变化，请使用原账号核对原操作。');
      if (!this.persistConsumption()) {
        this.setData({ ...(fresh ? { consumptionRevokePending: null } : {}), consumptionError: '本机暂存失败，本次撤销尚未发送。原消费记录保留。' });
        this.syncLeaveAlert(); return;
      }
      revision = getDraftRevision('detail-consumption', record.ownerId, record.id);
      await api.command('consumption.revoke', pending.payload, { intentKey: pending.intentKey,
        ...(record.version !== pending.payload.expectedVersion || selected.reversedAt || record.withdrawnAt || ['received', 'skipped'].includes(record.stage) ? { replayOnly: true } : {}) });
      removeDraft('detail-consumption', record.ownerId, record.id, revision);
      if (!current()) return;
      this.consumptionDraftFingerprint = '';
      this.setData({ consumptionRevokePending: null, consumptionError: '', consumptionNotice: '', mutationNotice: '消费撤销已保存。' });
      this.persistConsumption();
      if (this.isForeground() && visibility === this.visibilitySequence && load === this.loadSequence) {
        this.commitSheet(''); this.showPageToast('消费已撤销，历史记录保留', 'success'); await this.load(); this.syncLeaveAlert();
      }
    } catch (error) {
      if (!current()) return;
      if (['VERSION_CONFLICT', 'INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND'].includes(errorCode(error))) {
        this.setData({ consumptionRevokePending: null, consumptionError: '记录已变化，撤销未保存。请读取最新记录后核对。' });
      } else this.setData({ consumptionError: '撤销结果尚未确认，原操作已保留，请继续核对。' });
      this.persistConsumption(); this.syncLeaveAlert();
    } finally { if (current()) this.setData({ busy: false }); }
  },
  closeCelebration() { this.setData({ showCelebration: false }); },
  async register() {
    const record = this.data.detail?.participation;
    if (this.actionsBlocked() || !record || !this.data.view?.requiresRegistration || record.withdrawnAt) return;
    this.setData({ busy: true });
    try {
      await api.command('participation.progress', { participationId: record.id, progress: record.progress, registered: true, expectedVersion: record.version });
      if (this.disposed) return;
      this.setData({ mutationNotice: '报名状态已保存。' });
      this.showPageToast('已标记报名', 'success');
      await this.load();
    } catch (error) { this.showPageError(error); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  copyEntry() {
    const entrance = this.data.view?.activity.entrance;
    const value = entrance?.instructions || entrance?.url || entrance?.shortLink || entrance?.path || '';
    if (!value) { this.showPageToast('活动暂未提供入口路径'); return; }
    return this.switchContext(() => { wx.setClipboardData({ data: value, success: () => this.showPageToast('入口已复制', 'success') }); });
  },
  uploadShot() {
    return this.switchContext(() => { this.commitSheet(''); wx.navigateTo({ url: `/pages/submission-lead/index?bankId=${encodeURIComponent(this.data.view?.activity.bankId || '')}&title=${encodeURIComponent(this.data.view?.activity.title || '')}` }); });
  },
  async openShot(event: any) {
    if (!this.isForeground() || !this.data.detail?.assets.length) return;
    await this.switchContext(async () => {
      this.commitSheet('');
      const load = this.loadSequence, visibility = this.visibilitySequence, sequence = ++this.previewSequence;
      const shots = this.data.view?.shots.slice() || [], id = String(event.currentTarget.dataset.id || '');
      const index = shots.findIndex(item => item.id === id);
      if (index < 0) return;
      const current = () => this.isForeground() && load === this.loadSequence && visibility === this.visibilitySequence && sequence === this.previewSequence;
      try {
        const urls = await api.query('assets.urls', { ids: shots.map(item => item.id) });
        if (!current()) return;
        this.setData({ viewerOpen: true, viewerItems: shots.map(item => ({ ...item, url: urls.find(value => value.id === item.id)?.url || item.url })), viewerIndex: index });
      } catch (error) { if (current()) this.showPageError(error); }
    });
  },
  closeViewer() { this.previewSequence += 1; this.setData({ viewerOpen: false }); },
  openQuit() {
    if (this.actionsBlocked() || !this.data.view?.joined) return;
    return this.switchContext(() => this.commitSheet('quit'));
  },
  closeQuit() { return this.closeSheet('quit'); },
  async confirmQuit() {
    const record = this.data.detail?.participation;
    if (this.actionsBlocked() || !this.data.showQuit || !this.data.view?.joined || !record) return;
    this.setData({ busy: true });
    try {
      await api.command('activity.untrack', { participationId: record.id });
      if (this.disposed) return;
      const message = this.data.view!.cycle.repeating ? '已退出活动，后续周期不再跟进' : '已退出活动，记录已保留';
      this.commitSheet('', { mutationNotice: '退出活动已保存。' });
      this.showPageToast(message, 'success');
      await this.load();
    } catch (error) { this.showPageError(error); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
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
    if (this.actionsBlocked() || this.data.showExpected || this.data.detail?.participation?.withdrawnAt || this.data.detail?.participation?.stage !== 'completed' || this.data.view?.benefit.isDiscount) return;
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
    if (!record || record.withdrawnAt || ['received', 'skipped'].includes(record.stage) || (record.stage === 'completed' && !record.expectedOn)) return;
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

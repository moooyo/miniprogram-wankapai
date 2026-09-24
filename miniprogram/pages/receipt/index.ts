import { Activity, Commands, Currency, Detail, Participation } from '../../../shared/contracts';
import { periodFor } from '../../../domain/calendar';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, showError, stageLabel, today } from '../../services/format';
import { benefitCopy } from '../../services/benefit-copy';
import { backToActivity } from '../../services/navigation';

type InputEvent = { detail: { value: string } };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '暂时无法保存，请稍后重试。';
}

function errorField(error: unknown): string {
  return typeof error === 'object' && error !== null && 'field' in error ? String((error as { field?: string }).field || '') : '';
}

function minorToInput(amount: number): string {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

function parseMinor(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minor = Number(`${match[1]}${(match[2] || '').padEnd(2, '0')}`);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function receiptMonth(value: string): string {
  return `${value.slice(0, 4)} 年 ${Number(value.slice(5, 7))} 月`;
}

function localDateStamp(): number {
  return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

import { cardLabel } from '../../services/card-labels';
import { createCommandIntent, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';

interface ReceiptTarget {
  activityId: string; scope: 'user' | 'card'; cardId: string; participationId: string;
  periodKey: string; startsOn: string; endsOn: string; activityRevision?: number;
}
interface PendingReceiptCreation { intentKey: string; payload: Commands['reward.confirm']; target?: ReceiptTarget; activity?: Activity; }
interface ReceiptDraft {
  amountInput: string; receivedOn: string; draftTarget?: ReceiptTarget; intentKey?: string; pendingCreation?: PendingReceiptCreation;
  creationConflict?: boolean;
}
function validIntent(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 128; }
function validTarget(value: unknown): value is ReceiptTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as ReceiptTarget;
  return typeof target.activityId === 'string' && !!target.activityId && ['user', 'card'].includes(target.scope)
    && typeof target.cardId === 'string' && (target.scope !== 'card' || !!target.cardId)
    && typeof target.participationId === 'string' && typeof target.periodKey === 'string'
    && /^(once|\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?)$/.test(target.periodKey)
    && isCalendarDate(target.startsOn) && isCalendarDate(target.endsOn) && target.startsOn <= target.endsOn;
}
function sameScope(left: ReceiptTarget, right: ReceiptTarget): boolean {
  return left.activityId === right.activityId && left.scope === right.scope && (left.scope === 'user' || left.cardId === right.cardId);
}
function readPending(value: unknown): PendingReceiptCreation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pending = value as PendingReceiptCreation, payload = pending.payload;
  if (!validIntent(pending.intentKey) || !payload || typeof payload !== 'object' || Array.isArray(payload)
    || !payload.activityId || payload.participationId !== undefined || payload.expectedVersion !== undefined || payload.expectNew !== true
    || !Number.isSafeInteger(payload.amountMinor) || payload.amountMinor <= 0 || payload.amountMinor > 1e11 || !isCalendarDate(payload.receivedOn)) return null;
  if (pending.target !== undefined && (!validTarget(pending.target) || pending.target.participationId
    || pending.target.activityId !== payload.activityId || (pending.target.scope === 'card' && pending.target.cardId !== payload.cardId))) return null;
  return pending;
}
function validDisplayActivity(value: unknown, activityId: string): value is Activity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const activity = value as Activity;
  return activity.id === activityId && typeof activity.title === 'string'
    && ['CNY', 'HKD', 'MOP'].includes(activity.currency) && ['cashback', 'discount'].includes(activity.rewardKind)
    && Number.isSafeInteger(activity.rewardMinor) && activity.rewardMinor >= 0;
}
function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

Page({
  data: {
    loading: true, loadError: '', formError: '', amountError: '', dateError: '',
    title: '', periodText: '', cardName: '', expectedText: '',
    benefit: benefitCopy(),
    currency: 'CNY' as Currency, amountInput: '', receivedOn: '', minDate: '', maxDate: '', monthText: '',
    isEditing: false, willComplete: false, busy: false, allowed: true, reloading: false,
    conflict: false, reapplyRequired: false, latestSummary: '', focusField: '',
    serverToday: '', dateRefreshing: false, dateRefreshError: '', currentTarget: null as ReceiptTarget | null, receiptTarget: null as ReceiptTarget | null,
    sourceActivity: null as Activity | null, currentPeriodText: '', targetReviewRequired: false,
    intentKey: '', pendingCreation: null as PendingReceiptCreation | null, pendingReplayOnly: false, pendingPersisted: false, creationConflict: false, unresolvedDraft: false,
    unassignedDraft: null as { amountInput: string; receivedOn: string } | null, unassignedDraftVisible: false,
    ownerId: '', draftEntityId: '', creationDraftEntityId: '', dirty: false, draftNotice: '',
    activityId: '', participationId: '', cardId: '', participation: null as Participation | null,
  },
  draftChecked: false,
  disposed: false,
  visible: false,
  hidden: false,
  hasShown: false,
  visibilitySequence: 0,
  existingSaveSequence: 0,
  preparingExistingSave: false,
  dateRefreshOnLoad: false,
  dateSequence: 0,
  dateObservedDay: null as number | null,
  dateTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  dateRefreshTask: null as Promise<boolean> | null,
  onLoad(options: { id?: string; activityId?: string; cardId?: string }) {
    this.setData({ activityId: options.activityId || '', participationId: options.id || '', cardId: options.cardId || '' });
    void this.load();
  },
  onShow() {
    const initialShow = !this.hasShown && !this.hidden;
    this.hasShown = true;
    this.visible = true;
    this.hidden = false;
    if (initialShow) { this.scheduleDateRefresh(); return; }
    if (this.data.reloading) { this.dateRefreshOnLoad = true; return; }
    if (this.disposed || this.data.loading || this.data.loadError || !this.data.ownerId) return;
    this.dateRefreshOnLoad = false;
    return this.refreshDateRange();
  },
  onHide() {
    this.visibilitySequence += 1;
    if (this.data.loading || this.data.reloading) this.dateRefreshOnLoad = true;
    this.visible = false;
    this.hidden = true;
    this.cancelSavePreparation();
    this.invalidateDateRefresh();
  },
  onUnload() {
    this.visibilitySequence += 1;
    this.disposed = true;
    this.visible = false;
    this.hidden = true;
    this.cancelSavePreparation();
    this.invalidateDateRefresh();
  },
  cancelSavePreparation() {
    if (!this.preparingExistingSave) return;
    this.preparingExistingSave = false;
    this.existingSaveSequence += 1;
    if (!this.disposed) this.setData({ busy: false });
  },
  invalidateDateRefresh() {
    this.dateSequence += 1;
    this.dateRefreshTask = null;
    if (this.dateTimer !== undefined) clearTimeout(this.dateTimer);
    this.dateTimer = undefined;
    if (!this.disposed && this.data.dateRefreshing) this.setData({ dateRefreshing: false });
  },
  dateMayBeStale(): boolean {
    return this.dateObservedDay !== null && this.dateObservedDay !== localDateStamp();
  },
  scheduleDateRefresh() {
    if (this.dateTimer !== undefined) clearTimeout(this.dateTimer);
    this.dateTimer = undefined;
    if (this.disposed || !this.visible || this.hidden || this.data.loading || this.data.loadError || !this.data.ownerId) return;
    if (this.dateMayBeStale()) { void this.refreshDateRange(); return; }
    const now = Date.now(), day = 24 * 60 * 60 * 1000, offset = 8 * 60 * 60 * 1000;
    const nextMidnight = (Math.floor((now + offset) / day) + 1) * day - offset;
    const sequence = this.dateSequence;
    const timer = setTimeout(() => {
      if (this.dateTimer !== timer || sequence !== this.dateSequence) return;
      this.dateTimer = undefined;
      if (!this.disposed && this.visible && !this.hidden) void this.refreshDateRange();
    }, Math.max(1000, nextMidnight - now + 1000));
    this.dateTimer = timer;
  },
  refreshDateRange(): Promise<boolean> {
    if (this.disposed || this.hidden || this.data.loading || !this.data.ownerId) return Promise.resolve(false);
    if (this.data.reloading) { this.dateRefreshOnLoad = true; return Promise.resolve(false); }
    if (this.dateRefreshTask) return this.dateRefreshTask;
    const sequence = ++this.dateSequence, ownerId = this.data.ownerId;
    this.setData({ dateRefreshing: true, dateRefreshError: '' });
    const task = (async () => {
      let updated = false;
      try {
        const observedDay = localDateStamp();
        const session = await ensureSession(true);
        if (this.disposed || this.hidden || sequence !== this.dateSequence) return false;
        if (session.userId !== ownerId) throw new Error('身份已变化，请返回后使用原账号继续填写。');
        this.dateObservedDay = observedDay;
        const currentDate = session.today || today();
        const validDate = isCalendarDate(this.data.receivedOn) && this.data.receivedOn >= this.data.minDate && this.data.receivedOn <= currentDate;
        const allowed = !!this.data.currentTarget && this.data.minDate <= currentDate && this.data.participation?.stage !== 'skipped';
        this.setData({ serverToday: currentDate, maxDate: currentDate, allowed, ...(validDate ? { dateError: '' } : {}) });
        if (this.data.pendingCreation) this.setData({ pendingReplayOnly: this.data.pendingReplayOnly || this.pendingMustReplayOnly(this.data.pendingCreation) });
        updated = true;
        return true;
      } catch (error) {
        if (!this.disposed && !this.hidden && sequence === this.dateSequence) {
          this.setData({ dateRefreshError: `暂时无法更新可选日期，填写内容已保留。${errorMessage(error)}` });
        }
        return false;
      } finally {
        if (!this.disposed && !this.hidden && sequence === this.dateSequence) {
          this.dateRefreshTask = null;
          this.setData({ dateRefreshing: false });
          if (updated) this.scheduleDateRefresh();
        }
      }
    })();
    this.dateRefreshTask = task;
    return task;
  },
  async readRecord(): Promise<Detail> {
    if (!this.data.activityId && !this.data.participationId) throw new Error('缺少活动信息，请返回活动详情重新打开。');
    const observedDay = localDateStamp();
    const session = await ensureSession(true);
    if (this.disposed) throw new Error('Page closed');
    this.dateObservedDay = observedDay;
    this.setData({ ownerId: session.userId, serverToday: session.today || today(), dateRefreshError: '' });
    return api.query('activity.get', {
      activityId: this.data.activityId || undefined, participationId: this.data.participationId || undefined,
      cardId: this.data.participationId ? undefined : this.data.cardId || undefined,
    });
  },
  async applyRecord(detail: Detail, preserveInput: boolean) {
    const found = detail.participation;
    const participation = found && (!this.data.cardId || found.snapshot.scope === 'user' || found.cardId === this.data.cardId) ? found : null;
    if (this.data.participationId && !participation) throw new Error('未找到这期记录，请返回活动详情重新打开。');
    const activity = participation ? participation.snapshot : detail.activity;
    const benefit = benefitCopy(activity.rewardKind);
    const currentDate = this.data.serverToday || today();
    const period = participation || periodFor(activity, currentDate);
    const minDate = period?.startsOn || activity.startsOn;
    const receivedOn = participation?.receivedOn || currentDate;
    const amount = participation?.receivedMinor ?? activity.rewardMinor;
    const isEditing = participation?.stage === 'received';
    const linkedCardId = participation?.cardId || this.data.cardId;
    const target: ReceiptTarget | null = period ? { activityId: activity.id, scope: activity.scope,
      cardId: activity.scope === 'card' ? linkedCardId : '', participationId: participation?.id || '',
      periodKey: period.periodKey, startsOn: period.startsOn, endsOn: period.endsOn, activityRevision: activity.revision } : null;
    const creationDraftEntityId = `new:${activity.id}:${activity.scope === 'user' ? 'user' : this.data.cardId || linkedCardId || 'user'}`;
    let cardName = '';
    if (linkedCardId) {
      try { cardName = cardLabel(linkedCardId, (await api.query('wallet.get', {})).cards); }
      catch { cardName = '关联卡片暂时无法读取'; }
    }
    if (this.disposed) return;
    this.setData({
      participation, activityId: activity.id, title: activity.title, cardName, benefit,
      sourceActivity: activity, currentTarget: target, receiptTarget: target, targetReviewRequired: false,
      currentPeriodText: target ? periodLabel(target.periodKey) : '当前活动', periodText: target ? periodLabel(target.periodKey) : '本期活动',
      intentKey: participation ? '' : this.data.intentKey || createCommandIntent(),
      expectedText: money(activity.rewardMinor, activity.currency), currency: activity.currency,
      minDate, maxDate: currentDate, isEditing,
      willComplete: !participation || !['completed', 'received'].includes(participation.stage),
      allowed: !!target && minDate <= currentDate && participation?.stage !== 'skipped',
      draftEntityId: participation?.id || creationDraftEntityId, creationDraftEntityId,
      latestSummary: participation?.stage === 'received'
        ? `最新${benefit.actualLabel}：${money(participation.receivedMinor || 0, activity.currency)} · ${participation.receivedOn}`
        : `最新记录：${participation ? stageLabel(participation) : `尚未登记${benefit.recordNoun}`}`,
      ...(preserveInput ? {} : {
        amountInput: amount > 0 ? minorToInput(amount) : '', receivedOn, monthText: receiptMonth(receivedOn),
      }),
    });
    wx.setNavigationBarTitle({ title: isEditing ? benefit.editTitle : benefit.recordTitle });
  },
  async load() {
    if (this.disposed || this.data.pendingCreation) return;
    this.invalidateDateRefresh();
    this.setData({ loading: true, loadError: '', unassignedDraft: null, unassignedDraftVisible: false });
    try {
      await this.applyRecord(await this.readRecord(), false);
      if (this.disposed) return;
      if (!this.draftChecked) await this.recoverDraft();
    } catch (error) {
      if (!this.disposed) {
        const recovered = !this.draftChecked && this.data.ownerId ? await this.recoverDraft(true) : false;
        if (!this.disposed && !recovered) this.setData({ loadError: errorMessage(error) });
      }
    }
    finally {
      if (!this.disposed) {
        this.setData({ loading: false });
        if ((this.dateRefreshOnLoad || this.dateMayBeStale()) && this.visible && !this.hidden && !this.data.loadError) {
          this.dateRefreshOnLoad = false;
          void this.refreshDateRange();
        } else this.scheduleDateRefresh();
      }
    }
  },
  pendingMustReplayOnly(pending: PendingReceiptCreation): boolean {
    const target = pending.target, current = this.data.currentTarget;
    let currentPeriod: string | undefined;
    try { currentPeriod = this.data.sourceActivity ? periodFor(this.data.sourceActivity, this.data.serverToday)?.periodKey : undefined; }
    catch { return true; }
    return !!this.data.participationId || !target || !current || !sameScope(target, current) || target.periodKey !== current.periodKey
      || target.periodKey !== currentPeriod
      || pending.payload.expectedPeriodKey !== target.periodKey
      || (target.activityRevision !== undefined && target.activityRevision !== current.activityRevision)
      || pending.payload.receivedOn > this.data.serverToday;
  },
  async recoverDraft(pendingOnly = false): Promise<boolean> {
    this.draftChecked = true;
    const routeActivity = this.data.activityId;
    const keys = [...new Set([this.data.draftEntityId, this.data.creationDraftEntityId,
      routeActivity ? `new:${routeActivity}:${this.data.cardId || 'user'}` : '', routeActivity ? `new:${routeActivity}:user` : ''].filter(Boolean))];
    const candidates = keys.map(entityId => ({ entityId,
      saved: loadDraft<ReceiptDraft>('receipt', this.data.ownerId, entityId),
      revision: getDraftRevision('receipt', this.data.ownerId, entityId),
    })).filter(candidate => {
      const value = candidate.saved?.value;
      if (!value || typeof value.amountInput !== 'string' || !isCalendarDate(value.receivedOn)) return false;
      const pending = readPending(value.pendingCreation);
      if (value.pendingCreation !== undefined && !pending) return false;
      if (pending) {
        if (pending.payload.activityId !== routeActivity) return false;
        if (this.data.participationId && (!pending.target || !this.data.currentTarget
          || this.data.currentTarget.participationId !== this.data.participationId
          || !sameScope(pending.target, this.data.currentTarget) || pending.target.periodKey !== this.data.currentTarget.periodKey)) return false;
        if (pending.target?.scope === 'user') return candidate.entityId === `new:${routeActivity}:user`;
        if (pending.target?.scope === 'card') return pending.target.cardId === (this.data.participationId ? this.data.currentTarget?.cardId : this.data.cardId)
          && candidate.entityId === `new:${routeActivity}:${pending.target.cardId}`;
        const routeCard = this.data.cardId || '';
        return (pending.payload.cardId || '') === routeCard && (candidate.entityId === `new:${routeActivity}:${routeCard || 'user'}`
          || (this.data.currentTarget?.scope === 'user' && candidate.entityId === `new:${routeActivity}:user`));
      }
      if (pendingOnly) return false;
      if (value.draftTarget !== undefined) {
        if (!validTarget(value.draftTarget) || !this.data.currentTarget || !sameScope(value.draftTarget, this.data.currentTarget)) return false;
        if (value.draftTarget.participationId && value.draftTarget.participationId !== this.data.currentTarget.participationId) return false;
        if (this.data.participationId && value.draftTarget.participationId !== this.data.participationId
          && !(!value.draftTarget.participationId && value.draftTarget.periodKey === this.data.currentTarget.periodKey)) return false;
      }
      if (!value.draftTarget && this.data.participationId && candidate.entityId !== this.data.participationId) {
        this.setData({ unassignedDraft: { amountInput: value.amountInput, receivedOn: value.receivedOn } });
        return false;
      }
      return candidate.entityId === this.data.draftEntityId || candidate.entityId === this.data.creationDraftEntityId;
    });
    candidates.sort((left, right) => Number(!!right.saved!.value.pendingCreation) - Number(!!left.saved!.value.pendingCreation)
      || right.saved!.updatedAt.localeCompare(left.saved!.updatedAt));
    const chosen = candidates[0];
    if (!chosen) {
      if (this.data.unresolvedDraft) this.setData({ loadError: '暂时无法读取待核对的草稿，请稍后重新加载。原保存结果仍待核对。' });
      return false;
    }
    const value = chosen.saved!.value, pending = readPending(value.pendingCreation);
    const savedTarget = pending?.target || value.draftTarget;
    const originalPeriod = validTarget(savedTarget) ? periodLabel(savedTarget.periodKey) : '归属期待确认';
    const decision = await wx.showModal(pending ? {
      title: '发现待核对的保存结果',
      content: `原活动归属：${originalPeriod}；实际日期：${pending.payload.receivedOn}。服务端可能已经保存。恢复后将核对原请求结果，不会自动改到当前活动期。`,
      confirmText: '恢复核对', cancelText: '暂不核对',
    } : {
      title: '恢复活动记录草稿？',
      content: `草稿归属：${originalPeriod}；当前显示：${this.data.currentPeriodText}。${chosen.saved!.baseVersion !== (this.data.participation?.version ?? null) ? '记录已有更新。' : ''}恢复只取回金额和日期，归属期不明确或已变化时，需要另行确认目标再保存。`,
      confirmText: '恢复草稿', cancelText: '放弃草稿',
    });
    const recover = !!decision.confirm;
    if (this.disposed) return false;
    if (!recover) {
      if (pending) {
        this.draftChecked = false;
        this.setData({ unresolvedDraft: true, loadError: '上次保存结果仍待核对，原草稿已保留。重新加载可继续核对，或返回活动查看记录。' });
        return true;
      }
      for (const candidate of candidates) removeDraft('receipt', this.data.ownerId, candidate.entityId, candidate.revision);
      return false;
    }
    if (pending) {
      const original = validDisplayActivity(pending.activity, pending.payload.activityId || '') ? pending.activity : null;
      const originalCardId = pending.payload.cardId || pending.target?.cardId || '';
      let originalCardName = '';
      if (originalCardId) {
        try { originalCardName = cardLabel(originalCardId, (await api.query('wallet.get', {})).cards); }
        catch { originalCardName = '原关联卡片暂未读取'; }
      }
      if (this.disposed) return false;
      this.setData({ pendingCreation: pending, pendingPersisted: true, pendingReplayOnly: pendingOnly || this.pendingMustReplayOnly(pending),
        intentKey: pending.intentKey, receiptTarget: pending.target || null, draftEntityId: chosen.entityId,
        isEditing: false, willComplete: false, latestSummary: '', cardName: originalCardName,
        amountInput: minorToInput(pending.payload.amountMinor), receivedOn: pending.payload.receivedOn, monthText: receiptMonth(pending.payload.receivedOn),
        periodText: pending.target ? periodLabel(pending.target.periodKey) : '原活动归属期待核对',
        ...(original ? { title: original.title, currency: original.currency, benefit: benefitCopy(original.rewardKind), expectedText: money(original.rewardMinor, original.currency) } : {}),
        loadError: '', unresolvedDraft: false, dirty: true, reapplyRequired: false, targetReviewRequired: false,
        draftNotice: '上次保存结果尚未确认，原金额、日期和活动归属期已保留。' });
      wx.enableAlertBeforeUnload({ message: '上次保存结果尚未确认，离开后可继续核对。' });
      return true;
    }
    const target = validTarget(value.draftTarget) ? value.draftTarget : null;
    const knownRecordDraft = !!this.data.currentTarget?.participationId && chosen.entityId === this.data.currentTarget.participationId;
    const review = target ? target.periodKey !== this.data.currentTarget?.periodKey : !knownRecordDraft;
    const destination = review ? chosen.entityId : this.data.draftEntityId;
    this.setData({ amountInput: value.amountInput, receivedOn: value.receivedOn, monthText: receiptMonth(value.receivedOn),
      receiptTarget: review ? target : this.data.currentTarget, targetReviewRequired: review, draftEntityId: destination,
      intentKey: validIntent(value.intentKey) ? value.intentKey : this.data.intentKey,
      periodText: target ? periodLabel(target.periodKey) : review ? '活动归属期待确认' : this.data.periodText,
      dirty: true, reapplyRequired: true, draftNotice: '已恢复本机草稿，请核对活动归属期、金额和日期。' });
    if (this.persistDraft() && !review) {
      for (const candidate of candidates) if (candidate.entityId !== destination) removeDraft('receipt', this.data.ownerId, candidate.entityId, candidate.revision);
    }
    return true;
  },
  confirmDraftTarget() {
    if (this.disposed || this.data.busy || this.data.reloading || this.data.dateRefreshing || this.data.pendingCreation || this.data.unresolvedDraft || !this.data.targetReviewRequired || !this.data.currentTarget) return;
    const previousKey = this.data.draftEntityId;
    const revision = getDraftRevision('receipt', this.data.ownerId, previousKey);
    const target = this.data.currentTarget;
    this.setData({ receiptTarget: target, targetReviewRequired: false, periodText: periodLabel(target.periodKey),
      draftEntityId: target.participationId || this.data.creationDraftEntityId, intentKey: target.participationId ? '' : createCommandIntent(),
      reapplyRequired: true, formError: '', dateError: '' });
    if (this.persistDraft() && previousKey !== this.data.draftEntityId) removeDraft('receipt', this.data.ownerId, previousKey, revision);
  },
  showUnassignedDraft() {
    if (!this.disposed && !this.data.loading && !this.data.busy && !this.data.reloading && this.data.unassignedDraft) this.setData({ unassignedDraftVisible: true });
  },
  persistDraft() {
    if (this.disposed || this.data.unresolvedDraft) return false;
    const saved = saveDraft('receipt', this.data.ownerId, this.data.draftEntityId, this.data.participation?.version ?? null, {
      amountInput: this.data.amountInput, receivedOn: this.data.receivedOn,
      ...(this.data.receiptTarget ? { draftTarget: this.data.receiptTarget } : {}),
      ...(this.data.intentKey ? { intentKey: this.data.intentKey } : {}),
      ...(this.data.pendingCreation ? { pendingCreation: this.data.pendingCreation } : {}),
      ...(this.data.creationConflict ? { creationConflict: true } : {}),
    });
    this.setData({ dirty: true, draftNotice: saved ? '未保存内容已暂存本机，下次可选择恢复。' : '草稿暂存失败，请保存后再离开。' });
    wx.enableAlertBeforeUnload({ message: saved ? `${this.data.benefit.recordNoun}尚未保存，返回后可从本机草稿恢复。` : `${this.data.benefit.recordNoun}尚未保存，草稿暂存失败，离开后修改将丢失。` });
    return saved;
  },
  onAmountInput(event: InputEvent) {
    if (this.data.loading || this.data.busy || this.data.reloading || this.data.pendingCreation || this.data.unresolvedDraft || this.data.targetReviewRequired || !this.data.allowed) return;
    this.setData({ amountInput: event.detail.value, amountError: '', formError: '' });
    this.persistDraft();
  },
  onDateChange(event: InputEvent) {
    if (this.data.loading || this.data.busy || this.data.reloading || this.data.dateRefreshing || this.data.dateRefreshError || this.data.pendingCreation || this.data.unresolvedDraft || this.data.targetReviewRequired || !this.data.allowed) return;
    this.setData({ receivedOn: event.detail.value, monthText: receiptMonth(event.detail.value), dateError: '', formError: '' });
    this.persistDraft();
  },
  focusError(field: 'amount' | 'date') {
    this.setData({ focusField: '' });
    wx.nextTick(() => {
      if (this.disposed) return;
      wx.pageScrollTo({ selector: field === 'amount' ? '#amount-field' : '#receipt-date-field', duration: 180 });
      if (field === 'amount') this.setData({ focusField: 'amount' });
    });
  },
  async reloadLatest() {
    if (this.data.busy || this.data.reloading || this.data.dateRefreshing || this.data.pendingCreation) return;
    const draftEntityId = this.data.draftEntityId;
    const draftRevision = getDraftRevision('receipt', this.data.ownerId, draftEntityId);
    const originalTarget = this.data.receiptTarget;
    this.setData({ reloading: true, formError: '' });
    try {
      await this.applyRecord(await this.readRecord(), true);
      if (this.disposed) return;
      const review = !!originalTarget && !!this.data.currentTarget && (!sameScope(originalTarget, this.data.currentTarget)
        || originalTarget.periodKey !== this.data.currentTarget.periodKey);
      this.setData({ conflict: false, reapplyRequired: true, creationConflict: false, targetReviewRequired: review,
        ...(review ? { receiptTarget: originalTarget, draftEntityId, periodText: periodLabel(originalTarget!.periodKey) } : {}) });
      if (this.persistDraft() && draftEntityId !== this.data.draftEntityId) {
        removeDraft('receipt', this.data.ownerId, draftEntityId, draftRevision);
      }
    } catch (error) { if (!this.disposed) this.setData({ formError: errorMessage(error) }); }
    finally {
      if (!this.disposed) {
        this.setData({ reloading: false });
        if ((this.dateRefreshOnLoad || this.dateMayBeStale()) && this.visible && !this.hidden) {
          this.dateRefreshOnLoad = false;
          void this.refreshDateRange();
        } else this.scheduleDateRefresh();
      }
    }
  },
  async reviewCreationTarget(currentDate: string) {
    const originalTarget = this.data.receiptTarget, originalEntity = this.data.draftEntityId, originalIntent = this.data.intentKey;
    this.setData({ serverToday: currentDate, maxDate: currentDate, dateRefreshError: '' });
    let message = '活动归属期已变化。原金额和实际日期已保留，请确认目标后再保存。';
    try {
      await this.applyRecord(await api.query('activity.get', { activityId: this.data.activityId,
        ...(this.data.cardId ? { cardId: this.data.cardId } : {}) }), true);
    } catch (error) {
      if (this.disposed) return;
      this.setData({ currentTarget: null, currentPeriodText: '当前暂无可登记的活动期', allowed: false });
      message = `暂时无法读取当前活动期。原金额和日期已保留，请返回活动核对。${errorMessage(error)}`;
    }
    if (this.disposed) return;
    this.setData({ receiptTarget: originalTarget, draftEntityId: originalEntity, intentKey: originalIntent,
      periodText: originalTarget ? periodLabel(originalTarget.periodKey) : '活动归属期待确认',
      targetReviewRequired: true, reapplyRequired: true, conflict: !this.data.currentTarget, formError: message });
  },
  async preflightCreation(): Promise<boolean> {
    this.setData({ busy: true, formError: '' });
    try {
      const observedDay = localDateStamp();
      const session = await ensureSession(true);
      if (this.disposed) return false;
      if (session.userId !== this.data.ownerId) throw new Error('身份已变化，请返回后使用原账号核对草稿。');
      this.dateObservedDay = observedDay;
      const currentDate = session.today || today();
      this.setData({ serverToday: currentDate, maxDate: currentDate, dateRefreshError: '' });
      const period = this.data.sourceActivity ? periodFor(this.data.sourceActivity, currentDate) : null;
      if (period && period.periodKey === this.data.receiptTarget?.periodKey) return true;
      await this.reviewCreationTarget(currentDate);
      if (!this.disposed) this.persistDraft();
      return false;
    } catch (error) {
      if (!this.disposed) this.setData({ formError: `暂时无法核对活动归属期，尚未发送保存请求。${errorMessage(error)}` });
      return false;
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  validateReceiptInput(): { amountMinor: number; receivedOn: string } | null {
    const amountMinor = parseMinor(this.data.amountInput);
    const receivedOn = this.data.receivedOn;
    const amountError = amountMinor === null || amountMinor > 1e11 ? '请输入大于 0 且不超过 10 亿元的实际金额，最多两位小数。' : '';
    const dateError = !isCalendarDate(receivedOn) || receivedOn < this.data.minDate || receivedOn > this.data.maxDate
      ? `请选择 ${this.data.minDate} 至 ${this.data.maxDate} 之间的${this.data.benefit.dateLabel}。` : '';
    this.setData({ amountError, dateError, formError: '' });
    if (amountMinor === null || amountError || dateError) { this.focusError(amountError ? 'amount' : 'date'); return null; }
    return { amountMinor, receivedOn };
  },
  async save() {
    if (this.disposed || this.hidden || this.data.loading || this.data.busy || this.data.reloading || this.data.dateRefreshing || this.data.unresolvedDraft) return;
    if (this.data.pendingCreation) { await this.resolvePendingCreation(); return; }
    if (this.data.targetReviewRequired) { this.setData({ formError: '请先确认这份草稿对应的活动归属期，再保存金额和日期。' }); return; }
    if (this.data.conflict || !this.data.allowed || !this.data.receiptTarget) return;
    if (this.data.participation) { await this.saveExistingReceipt(); return; }
    if (!await this.preflightCreation()) return;
    if (this.disposed || this.hidden) return;
    const input = this.validateReceiptInput();
    if (!input) return;
    const payload: Commands['reward.confirm'] = { activityId: this.data.activityId,
      ...(this.data.cardId ? { cardId: this.data.cardId } : {}), ...input,
      expectNew: true, expectedPeriodKey: this.data.receiptTarget.periodKey };
    const intentKey = validIntent(this.data.intentKey) ? this.data.intentKey : createCommandIntent();
    this.setData({ intentKey, creationConflict: false, pendingReplayOnly: false, pendingPersisted: false,
      pendingCreation: { intentKey, payload, target: this.data.receiptTarget, ...(this.data.sourceActivity ? { activity: this.data.sourceActivity } : {}) } });
    const persisted = this.persistDraft();
    this.setData({ pendingPersisted: persisted });
    if (!persisted) {
      this.setData({ pendingCreation: null, pendingReplayOnly: false,
        formError: '暂时无法保存本机草稿，请重试。金额和日期仍保留，尚未发送新建请求。' });
      return;
    }
    await this.resolvePendingCreation(true);
  },
  async saveExistingReceipt() {
    const participation = this.data.participation;
    if (!participation || this.disposed || this.hidden || this.data.busy) return;
    const visibility = this.visibilitySequence;
    const saveSequence = ++this.existingSaveSequence;
    this.preparingExistingSave = true;
    const draftOwnerId = this.data.ownerId, draftEntityId = this.data.draftEntityId;
    const draftRevision = getDraftRevision('receipt', draftOwnerId, draftEntityId);
    this.setData({ busy: true });
    try {
      if (!await this.refreshDateRange() || this.disposed || this.hidden || visibility !== this.visibilitySequence) return;
      const input = this.validateReceiptInput();
      if (!input) return;
      this.preparingExistingSave = false;
      const result = await api.command('reward.confirm', {
        participationId: participation.id, ...input, expectedVersion: participation.version,
      });
      removeDraft('receipt', draftOwnerId, draftEntityId, draftRevision);
      if (this.disposed) return;
      this.setData({ dirty: false, draftNotice: '' });
      wx.disableAlertBeforeUnload();
      wx.showToast({ title: this.data.isEditing ? this.data.benefit.editSuccess : this.data.benefit.recordSuccess, icon: 'success' });
      backToActivity(this.data.activityId, result.id);
    } catch (error) {
      if (this.disposed) return;
      if (errorCode(error) === 'VERSION_CONFLICT') {
        this.setData({ conflict: true, formError: '记录已被更新。你的金额和日期已保留，请读取最新记录，再决定是否重新应用。' });
        this.persistDraft();
        wx.nextTick(() => { if (!this.disposed) wx.pageScrollTo({ selector: '#record-conflict', duration: 180 }); });
      } else {
        const message = errorMessage(error), field = errorField(error);
        if (field === 'amountMinor') { this.setData({ amountError: message }); this.focusError('amount'); }
        else if (field === 'receivedOn') { this.setData({ dateError: message }); this.focusError('date'); }
        else this.setData({ formError: message });
        showError(error);
      }
    } finally {
      if (saveSequence === this.existingSaveSequence) {
        this.preparingExistingSave = false;
        if (!this.disposed) this.setData({ busy: false });
      }
    }
  },
  async resolvePendingCreation(fresh = false) {
    const pending = this.data.pendingCreation;
    if (this.disposed || this.data.busy || this.data.reloading || !pending) return;
    if (!this.data.pendingPersisted) {
      const persisted = this.persistDraft();
      this.setData({ pendingPersisted: persisted });
      if (!persisted) {
        this.setData({ ...(fresh ? { pendingCreation: null, pendingReplayOnly: false } : {}),
          formError: '暂时无法保存本机草稿，请重试。金额和日期仍保留，尚未发送新建请求。' }); return;
      }
    }
    let replayOnly = !fresh && (this.data.pendingReplayOnly || this.pendingMustReplayOnly(pending));
    const ownerId = this.data.ownerId, entityId = this.data.draftEntityId;
    const revision = getDraftRevision('receipt', ownerId, entityId);
    this.setData({ busy: true, formError: '', pendingReplayOnly: replayOnly });
    try {
      if (!fresh) {
        const observedDay = localDateStamp();
        const session = await ensureSession(true);
        if (this.disposed) return;
        if (session.userId !== ownerId) throw new Error('身份已变化，请返回后使用原账号核对上次保存结果。');
        this.dateObservedDay = observedDay;
        this.setData({ serverToday: session.today || today(), maxDate: session.today || today(), dateRefreshError: '' });
        replayOnly = replayOnly || this.pendingMustReplayOnly(pending);
        this.setData({ pendingReplayOnly: replayOnly });
      }
      const result = await api.command('reward.confirm', pending.payload, { intentKey: pending.intentKey, ...(replayOnly ? { replayOnly: true } : {}) });
      removeDraft('receipt', ownerId, entityId, revision);
      if (this.disposed) return;
      this.setData({ pendingCreation: null, pendingReplayOnly: false, dirty: false, draftNotice: '' });
      wx.disableAlertBeforeUnload();
      wx.showToast({ title: this.data.benefit.recordSuccess, icon: 'success' });
      backToActivity(pending.payload.activityId, result.id);
    } catch (error) {
      if (this.disposed) return;
      const code = errorCode(error), field = errorField(error);
      if (fresh && code === 'VERSION_CONFLICT' && field === 'expectedPeriodKey') {
        this.setData({ pendingCreation: null, pendingPersisted: false, pendingReplayOnly: false, targetReviewRequired: true });
        try {
          const observedDay = localDateStamp();
          const session = await ensureSession(true);
          if (this.disposed) return;
          if (session.userId !== ownerId) throw new Error('身份已变化，请返回后使用原账号核对草稿。');
          this.dateObservedDay = observedDay;
          await this.reviewCreationTarget(session.today || today());
        } catch (refreshError) {
          if (!this.disposed) this.setData({ currentTarget: null, currentPeriodText: '当前活动期尚未读取', allowed: false,
            conflict: true, reapplyRequired: true, formError: `活动归属期已变化，原输入仍保留。请读取最新记录后再确认目标。${errorMessage(refreshError)}` });
        }
        if (!this.disposed && getDraftRevision('receipt', ownerId, entityId) === revision) this.persistDraft();
      } else if (!replayOnly && code === 'VERSION_CONFLICT' && field !== 'expectedPeriodKey') {
        this.setData({ pendingCreation: null, pendingReplayOnly: false, creationConflict: true, conflict: true,
          formError: '记录已被更新。你的金额和日期已保留，请读取最新记录，再决定是否重新应用。' });
        if (getDraftRevision('receipt', ownerId, entityId) === revision) this.persistDraft();
        wx.nextTick(() => { if (!this.disposed) wx.pageScrollTo({ selector: '#record-conflict', duration: 180 }); });
      } else {
        const lookupOnly = replayOnly || field === 'expectedPeriodKey' || ['NOT_FOUND', 'ACTIVITY_INACTIVE'].includes(code);
        this.setData({ pendingReplayOnly: lookupOnly, formError: code === 'REQUEST_UNRESOLVED'
          ? '暂未查到上次保存结果，请稍后再次核对。原请求仍可能在处理中，金额、日期和活动归属期已保留。'
          : field === 'expectedPeriodKey' ? '活动已进入新一期。原请求仍需核对，原金额、日期和活动归属期已保留；请核对上次保存结果。' : errorMessage(error) });
        showError(error);
      }
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  back() { if (!this.data.busy && !this.data.reloading) backToActivity(this.data.activityId, this.data.participationId); },
});

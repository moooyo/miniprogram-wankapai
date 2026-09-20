import { Activity, Currency, Detail, Participation } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, showError, stageLabel, today } from '../../services/format';
import { benefitCopy } from '../../services/benefit-copy';

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

function periodStart(activity: Activity, currentDate: string): string {
  let start = activity.startsOn;
  if (activity.frequency === 'monthly') start = `${currentDate.slice(0, 7)}-01`;
  if (activity.frequency === 'quarterly') {
    const month = Math.floor((Number(currentDate.slice(5, 7)) - 1) / 3) * 3 + 1;
    start = `${currentDate.slice(0, 4)}-${String(month).padStart(2, '0')}-01`;
  }
  if (activity.frequency === 'yearly') start = `${currentDate.slice(0, 4)}-01-01`;
  return start < activity.startsOn ? activity.startsOn : start;
}

function receiptMonth(value: string): string {
  return `${value.slice(0, 4)} 年 ${Number(value.slice(5, 7))} 月`;
}

import { cardLabel } from '../../services/card-labels';
import { confirmDraftRecovery, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';

interface ReceiptDraft { amountInput: string; receivedOn: string; }
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
    ownerId: '', draftEntityId: '', dirty: false, draftNotice: '',
    activityId: '', participationId: '', cardId: '', participation: null as Participation | null,
  },
  draftChecked: false,
  disposed: false,
  onLoad(options: { id?: string; activityId?: string; cardId?: string }) {
    this.setData({ activityId: options.activityId || '', participationId: options.id || '', cardId: options.cardId || '' });
    void this.load();
  },
  onUnload() { this.disposed = true; },
  async readRecord(): Promise<Detail> {
    if (!this.data.activityId && !this.data.participationId) throw new Error('缺少活动信息，请返回活动详情重新打开。');
    const session = await ensureSession();
    if (this.disposed) throw new Error('Page closed');
    this.setData({ ownerId: session.userId });
    return api.query('activity.get', {
      activityId: this.data.activityId || undefined, participationId: this.data.participationId || undefined,
    });
  },
  async applyRecord(detail: Detail, preserveInput: boolean) {
    const found = detail.participation;
    const participation = found && (!this.data.cardId || found.cardId === this.data.cardId) ? found : null;
    if (this.data.participationId && !participation) throw new Error('未找到这期记录，请返回活动详情重新打开。');
    const activity = participation ? participation.snapshot : detail.activity;
    const benefit = benefitCopy(activity.rewardKind);
    const currentDate = today();
    const minDate = participation ? participation.startsOn : periodStart(activity, currentDate);
    const receivedOn = participation?.receivedOn || currentDate;
    const amount = participation?.receivedMinor ?? activity.rewardMinor;
    const isEditing = participation?.stage === 'received';
    const linkedCardId = participation?.cardId || this.data.cardId;
    let cardName = '';
    if (linkedCardId) {
      try { cardName = cardLabel(linkedCardId, (await api.query('wallet.get', {})).cards); }
      catch { cardName = '关联卡片暂时无法读取'; }
    }
    if (this.disposed) return;
    this.setData({
      participation, activityId: activity.id, title: activity.title, cardName, benefit,
      periodText: participation ? periodLabel(participation.periodKey) : '本期活动',
      expectedText: money(activity.rewardMinor, activity.currency), currency: activity.currency,
      minDate, maxDate: currentDate, isEditing,
      willComplete: !participation || !['completed', 'received'].includes(participation.stage),
      allowed: minDate <= currentDate && participation?.stage !== 'skipped',
      draftEntityId: participation?.id || `new:${activity.id}:${linkedCardId || 'user'}`,
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
    this.setData({ loading: true, loadError: '' });
    try {
      await this.applyRecord(await this.readRecord(), false);
      if (this.disposed) return;
      if (!this.draftChecked) {
        this.draftChecked = true;
        const saved = loadDraft<ReceiptDraft>('receipt', this.data.ownerId, this.data.draftEntityId);
        if (saved && typeof saved.value.amountInput === 'string' && isCalendarDate(saved.value.receivedOn)) {
          const recover = await confirmDraftRecovery(saved, this.data.participation?.version ?? null);
          if (this.disposed) return;
          if (recover) {
            this.setData({
              amountInput: saved.value.amountInput, receivedOn: saved.value.receivedOn, monthText: receiptMonth(saved.value.receivedOn),
              dirty: true, reapplyRequired: true, draftNotice: '已恢复本机草稿，请核对最新记录后保存。',
            });
            this.persistDraft();
          } else removeDraft('receipt', this.data.ownerId, this.data.draftEntityId);
        }
      }
    } catch (error) { if (!this.disposed) this.setData({ loadError: errorMessage(error) }); }
    finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  persistDraft() {
    if (this.disposed) return;
    const saved = saveDraft('receipt', this.data.ownerId, this.data.draftEntityId, this.data.participation?.version ?? null, {
      amountInput: this.data.amountInput, receivedOn: this.data.receivedOn,
    });
    this.setData({ dirty: true, draftNotice: saved ? '未保存内容已暂存本机，下次可选择恢复。' : '草稿暂存失败，请保存后再离开。' });
    wx.enableAlertBeforeUnload({ message: saved ? `${this.data.benefit.recordNoun}尚未保存，返回后可从本机草稿恢复。` : `${this.data.benefit.recordNoun}尚未保存，草稿暂存失败，离开后修改将丢失。` });
  },
  onAmountInput(event: InputEvent) {
    if (this.data.busy || this.data.reloading || !this.data.allowed) return;
    this.setData({ amountInput: event.detail.value, amountError: '', formError: '' });
    this.persistDraft();
  },
  onDateChange(event: InputEvent) {
    if (this.data.busy || this.data.reloading || !this.data.allowed) return;
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
    if (this.data.busy || this.data.reloading) return;
    this.setData({ reloading: true, formError: '' });
    try {
      await this.applyRecord(await this.readRecord(), true);
      if (this.disposed) return;
      this.setData({ conflict: false, reapplyRequired: true });
      this.persistDraft();
    } catch (error) { if (!this.disposed) this.setData({ formError: errorMessage(error) }); }
    finally { if (!this.disposed) this.setData({ reloading: false }); }
  },
  async save() {
    if (this.disposed || this.data.busy || this.data.reloading || this.data.conflict || !this.data.allowed) return;
    const amountMinor = parseMinor(this.data.amountInput);
    const receivedOn = this.data.receivedOn;
    const amountError = amountMinor === null ? '请输入大于 0 的实际金额，最多两位小数。' : '';
    const dateError = !isCalendarDate(receivedOn) || receivedOn < this.data.minDate || receivedOn > this.data.maxDate
      ? `请选择 ${this.data.minDate} 至 ${this.data.maxDate} 之间的${this.data.benefit.dateLabel}。` : '';
    this.setData({ amountError, dateError, formError: '' });
    if (amountMinor === null || dateError) { this.focusError(amountError ? 'amount' : 'date'); return; }
    const draftOwnerId = this.data.ownerId, draftEntityId = this.data.draftEntityId;
    const draftRevision = getDraftRevision('receipt', draftOwnerId, draftEntityId);
    this.setData({ busy: true });
    try {
      const participation = this.data.participation;
      const result = await api.command('reward.confirm', {
        participationId: participation?.id,
        activityId: participation ? undefined : this.data.activityId,
        cardId: participation ? undefined : this.data.cardId || undefined,
        amountMinor, receivedOn, expectedVersion: participation?.version,
      });
      removeDraft('receipt', draftOwnerId, draftEntityId, draftRevision);
      if (this.disposed) return;
      this.setData({ dirty: false, draftNotice: '' });
      wx.disableAlertBeforeUnload();
      wx.showToast({ title: this.data.isEditing ? this.data.benefit.editSuccess : this.data.benefit.recordSuccess, icon: 'success' });
      wx.navigateBack({
        fail: () => wx.redirectTo({
          url: `/pages/detail/index?id=${encodeURIComponent(this.data.activityId)}&participationId=${encodeURIComponent(result.id)}`,
        }),
      });
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
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  back() { if (!this.data.busy && !this.data.reloading) wx.navigateBack(); },
});

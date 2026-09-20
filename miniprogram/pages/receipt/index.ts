import { Activity, Currency, Detail, Participation } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, showError, today } from '../../services/format';

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

Page({
  data: {
    loading: true,
    loadError: '',
    formError: '',
    amountError: '',
    dateError: '',
    title: '',
    periodText: '',
    expectedText: '',
    currency: 'CNY' as Currency,
    amountInput: '',
    receivedOn: '',
    minDate: '',
    maxDate: '',
    monthText: '',
    isEditing: false,
    willComplete: false,
    busy: false,
    allowed: true,
    activityId: '',
    participationId: '',
    cardId: '',
    participation: null as Participation | null,
  },

  onLoad(options: { id?: string; activityId?: string; cardId?: string }) {
    this.setData({
      activityId: options.activityId || '',
      participationId: options.id || '',
      cardId: options.cardId || '',
    });
    void this.load();
  },

  async load() {
    this.setData({ loading: true, loadError: '' });
    try {
      if (!this.data.activityId && !this.data.participationId) throw new Error('缺少活动信息，请返回活动详情重新打开。');
      await ensureSession();
      const detail: Detail = await api.query('activity.get', {
        activityId: this.data.activityId || undefined,
        participationId: this.data.participationId || undefined,
      });
      const found = detail.participation;
      const participation = found && (!this.data.cardId || found.cardId === this.data.cardId) ? found : null;
      if (this.data.participationId && !participation) throw new Error('未找到这期记录，请返回活动详情重新打开。');
      const activity = participation ? participation.snapshot : detail.activity;
      const currentDate = today();
      const minDate = participation ? participation.startsOn : periodStart(activity, currentDate);
      const receivedOn = participation?.receivedOn || currentDate;
      const amount = participation?.receivedMinor ?? activity.rewardMinor;
      const isEditing = participation?.stage === 'received';
      this.setData({
        participation,
        activityId: activity.id,
        title: activity.title,
        periodText: participation ? periodLabel(participation.periodKey) : '本期活动',
        expectedText: money(activity.rewardMinor, activity.currency),
        currency: activity.currency,
        amountInput: amount > 0 ? minorToInput(amount) : '',
        receivedOn,
        minDate,
        maxDate: currentDate,
        monthText: receiptMonth(receivedOn),
        isEditing,
        willComplete: !participation || !['completed', 'received'].includes(participation.stage),
        allowed: minDate <= currentDate && participation?.stage !== 'skipped',
      });
      if (isEditing) wx.setNavigationBarTitle({ title: '更正到账记录' });
    } catch (error) {
      this.setData({ loadError: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },

  onAmountInput(event: InputEvent) {
    this.setData({ amountInput: event.detail.value, amountError: '', formError: '' });
  },

  onDateChange(event: InputEvent) {
    this.setData({ receivedOn: event.detail.value, monthText: receiptMonth(event.detail.value), dateError: '', formError: '' });
  },

  async save() {
    if (this.data.busy || !this.data.allowed) return;
    const amountMinor = parseMinor(this.data.amountInput);
    const receivedOn = this.data.receivedOn;
    const amountError = amountMinor === null ? '请输入大于 0 的实际金额，最多两位小数。' : '';
    const dateError = !isCalendarDate(receivedOn) || receivedOn < this.data.minDate || receivedOn > this.data.maxDate
      ? `请选择 ${this.data.minDate} 至 ${this.data.maxDate} 之间的实际到账日期。` : '';
    this.setData({ amountError, dateError, formError: '' });
    if (amountMinor === null || dateError) return;
    this.setData({ busy: true });
    try {
      const participation = this.data.participation;
      const result = await api.command('reward.confirm', {
        participationId: participation?.id,
        activityId: participation ? undefined : this.data.activityId,
        cardId: participation ? undefined : this.data.cardId || undefined,
        amountMinor,
        receivedOn,
        expectedVersion: participation?.version,
      });
      wx.showToast({ title: this.data.isEditing ? '到账记录已更正' : '已记录到账', icon: 'success' });
      wx.navigateBack({
        fail: () => wx.redirectTo({
          url: `/pages/detail/index?id=${encodeURIComponent(this.data.activityId)}&participationId=${encodeURIComponent(result.id)}`,
        }),
      });
    } catch (error) {
      const message = errorMessage(error);
      const field = errorField(error);
      if (field === 'amountMinor') this.setData({ amountError: message });
      else if (field === 'receivedOn') this.setData({ dateError: message });
      else this.setData({ formError: message });
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },

  back() {
    if (!this.data.busy) wx.navigateBack();
  },
});

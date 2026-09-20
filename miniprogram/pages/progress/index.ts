import { Detail, Participation } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { periodLabel, showError } from '../../services/format';

type InputEvent = { detail: { value: string } };
type CheckEvent = { detail: { value: string[] } };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '暂时无法保存，请稍后重试。';
}

function errorField(error: unknown): string {
  return typeof error === 'object' && error !== null && 'field' in error ? String((error as { field?: string }).field || '') : '';
}

Page({
  data: {
    loading: true,
    loadError: '',
    formError: '',
    progressError: '',
    title: '',
    periodText: '',
    target: 0,
    unit: '',
    progressInput: '',
    registered: false,
    showRegistration: false,
    editable: true,
    busy: false,
    participation: null as Participation | null,
    activityId: '',
    participationId: '',
  },

  onLoad(options: { id?: string; activityId?: string }) {
    this.setData({ activityId: options.activityId || '', participationId: options.id || '' });
    void this.load();
  },

  async load() {
    this.setData({ loading: true, loadError: '' });
    try {
      if (!this.data.activityId || !this.data.participationId) {
        throw new Error('缺少活动记录，请返回活动详情重新打开。');
      }
      await ensureSession();
      const detail: Detail = await api.query('activity.get', {
        activityId: this.data.activityId,
        participationId: this.data.participationId,
      });
      const participation = detail.participation;
      if (!participation) throw new Error('未找到这期记录，请返回活动详情重新打开。');
      const activity = participation.snapshot;
      this.setData({
        participation,
        title: activity.title,
        periodText: periodLabel(participation.periodKey),
        target: activity.target,
        unit: activity.unit,
        progressInput: String(participation.progress),
        registered: Boolean(participation.registeredAt),
        showRegistration: activity.requiresRegistration || Boolean(participation.registeredAt),
        editable: !['completed', 'received', 'skipped'].includes(participation.stage),
      });
    } catch (error) {
      this.setData({ loadError: errorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },

  onProgressInput(event: InputEvent) {
    this.setData({ progressInput: event.detail.value, progressError: '', formError: '' });
  },

  onRegistrationChange(event: CheckEvent) {
    this.setData({ registered: event.detail.value.includes('registered'), formError: '' });
  },

  async save() {
    if (this.data.busy || !this.data.editable || !this.data.participation) return;
    const raw = this.data.progressInput.trim();
    const progress = Number(raw);
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(progress) || progress > 1000000000) {
      this.setData({ progressError: '请输入 0 到 10 亿之间的数字，最多两位小数。' });
      return;
    }
    this.setData({ busy: true, formError: '', progressError: '' });
    try {
      await api.command('participation.progress', {
        participationId: this.data.participation.id,
        progress,
        registered: this.data.registered,
        expectedVersion: this.data.participation.version,
      });
      wx.showToast({ title: '进度已保存', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      const message = errorMessage(error);
      this.setData(errorField(error) === 'progress' ? { progressError: message } : { formError: message });
      showError(error);
    } finally {
      this.setData({ busy: false });
    }
  },

  back() {
    if (!this.data.busy) wx.navigateBack();
  },
});

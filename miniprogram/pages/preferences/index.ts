import { api, ensureSession } from '../../services/api';

Page({
  data: { loading: true, ready: false, saving: false, dirty: false, error: '', saved: false, newActivities: false, deadlines: true, rewards: true, repayments: true },
  onLoad() { void this.load(); },
  async load() {
    this.setData({ loading: true, ready: false, error: '' });
    try {
      await ensureSession();
      const preference = await api.query('preferences.get', {});
      this.setData({ ready: true, newActivities: preference.newActivities, deadlines: preference.deadlines, rewards: preference.rewards, repayments: preference.repayments, dirty: false });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '提醒设置暂时无法读取，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  change(event: { currentTarget: { dataset: { field: string } }; detail: { value: boolean } }) {
    const field = event.currentTarget.dataset.field;
    if (!this.data.ready || !['newActivities', 'deadlines', 'rewards', 'repayments'].includes(field) || this.data.saving) return;
    this.setData({ [field]: event.detail.value, dirty: true, saved: false, error: '' });
    wx.enableAlertBeforeUnload({ message: '提醒设置尚未保存，离开后将丢失。' });
  },
  async save() {
    if (!this.data.ready || this.data.saving || this.data.loading || !this.data.dirty) return;
    this.setData({ saving: true, error: '', saved: false });
    try {
      await api.command('preferences.save', { newActivities: this.data.newActivities, deadlines: this.data.deadlines, rewards: this.data.rewards, repayments: this.data.repayments });
      this.setData({ dirty: false, saved: true });
      wx.disableAlertBeforeUnload();
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '设置未保存，请重试。' }); }
    finally { this.setData({ saving: false }); }
  },
});

import { api, ensureSession } from '../../services/api';

Page({
  data: { loading: true, ready: false, saving: false, dirty: false, error: '', saved: false, helpExpanded: false, newActivities: false, deadlines: true, rewards: true, repayments: true },
  disposed: false,
  visible: true,
  loadSequence: 0,
  onLoad() { void this.load(); },
  onShow() { this.visible = true; this.syncLeaveAlert(); },
  onHide() { this.visible = false; },
  onUnload() { this.disposed = true; this.visible = false; this.loadSequence += 1; },
  syncLeaveAlert() {
    if (this.disposed || !this.visible) return;
    const pages = getCurrentPages();
    if (pages[pages.length - 1] !== this) return;
    if (this.data.dirty) wx.enableAlertBeforeUnload({ message: '提醒设置尚未保存，离开后将丢失。' });
    else wx.disableAlertBeforeUnload();
  },
  async load() {
    if (this.disposed || this.data.saving) return;
    const sequence = ++this.loadSequence;
    const current = () => !this.disposed && sequence === this.loadSequence;
    this.setData({ loading: true, ready: false, error: '', saved: false });
    try {
      await ensureSession();
      if (!current()) return;
      const preference = await api.query('preferences.get', {});
      if (!current()) return;
      this.setData({ ready: true, newActivities: preference.newActivities, deadlines: preference.deadlines, rewards: preference.rewards, repayments: preference.repayments, dirty: false });
      this.syncLeaveAlert();
    } catch (error) { if (current()) this.setData({ error: error instanceof Error ? error.message : '提醒设置暂时无法读取，请重试。' }); }
    finally { if (current()) this.setData({ loading: false }); }
  },
  change(event: { currentTarget: { dataset: { field: string } }; detail: { value: boolean } }) {
    const field = event.currentTarget.dataset.field;
    if (this.disposed || !this.data.ready || !['newActivities', 'deadlines', 'rewards', 'repayments'].includes(field) || this.data.saving) return;
    this.setData({ [field]: event.detail.value, dirty: true, saved: false, error: '' });
    this.syncLeaveAlert();
  },
  toggle(event: { currentTarget: { dataset: { field: string } } }) {
    const field = event.currentTarget.dataset.field as 'newActivities' | 'deadlines' | 'rewards' | 'repayments';
    if (!['newActivities', 'deadlines', 'rewards', 'repayments'].includes(field)) return;
    this.change({ currentTarget: event.currentTarget, detail: { value: !this.data[field] } });
  },
  toggleHelp() {
    if (this.disposed) return;
    this.setData({ helpExpanded: !this.data.helpExpanded });
  },
  async save() {
    if (this.disposed || !this.data.ready || this.data.saving || this.data.loading || !this.data.dirty) return;
    this.setData({ saving: true, error: '', saved: false });
    try {
      await api.command('preferences.save', { newActivities: this.data.newActivities, deadlines: this.data.deadlines, rewards: this.data.rewards, repayments: this.data.repayments });
      if (this.disposed) return;
      this.setData({ dirty: false, saved: true });
      this.syncLeaveAlert();
    } catch (error) { if (!this.disposed) this.setData({ error: error instanceof Error ? error.message : '设置未保存，请重试。' }); }
    finally { if (!this.disposed) this.setData({ saving: false }); }
  },
});

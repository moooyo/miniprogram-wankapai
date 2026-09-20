import { Detail, Participation } from '../../../shared/contracts';
import { api, ensureSession } from '../../services/api';
import { cardLabel } from '../../services/card-labels';
import { confirmDraftRecovery, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';
import { periodLabel, showError, stageLabel } from '../../services/format';
import { benefitCopy } from '../../services/benefit-copy';

type InputEvent = { detail: { value: string } };
type CheckEvent = { detail: { value: string[] } };
interface ProgressDraft { progressInput: string; registered: boolean; }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '暂时无法保存，请稍后重试。';
}
function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

Page({
  data: {
    loading: true, loadError: '', formError: '', progressError: '',
    title: '', periodText: '', cardName: '', target: 0, unit: '',
    progressInput: '', registered: false, showRegistration: false,
    editable: true, busy: false, reloading: false, conflict: false,
    reapplyRequired: false, latestSummary: '', focusField: '',
    ownerId: '', dirty: false, draftNotice: '',
    benefit: benefitCopy(), recordStatus: '',
    participation: null as Participation | null,
    activityId: '', participationId: '',
  },
  draftChecked: false,
  disposed: false,

  onLoad(options: { id?: string; activityId?: string }) {
    this.setData({ activityId: options.activityId || '', participationId: options.id || '' });
    void this.load();
  },
  onUnload() { this.disposed = true; },

  async readRecord(): Promise<Detail> {
    if (!this.data.activityId || !this.data.participationId) {
      throw new Error('缺少活动记录，请返回活动详情重新打开。');
    }
    const session = await ensureSession();
    if (this.disposed) throw new Error('Page closed');
    this.setData({ ownerId: session.userId });
    return api.query('activity.get', {
      activityId: this.data.activityId, participationId: this.data.participationId,
    });
  },
  async applyRecord(detail: Detail, preserveInput: boolean) {
    const participation = detail.participation;
    if (!participation) throw new Error('未找到这期记录，请返回活动详情重新打开。');
    const activity = participation.snapshot;
    let cardName = '';
    if (participation.cardId) {
      try { cardName = cardLabel(participation.cardId, (await api.query('wallet.get', {})).cards); }
      catch { cardName = '关联卡片暂时无法读取'; }
    }
    if (this.disposed) return;
    this.setData({
      participation, title: activity.title, periodText: periodLabel(participation.periodKey),
      benefit: benefitCopy(activity.rewardKind), recordStatus: stageLabel(participation),
      cardName, target: activity.target, unit: activity.unit,
      showRegistration: activity.requiresRegistration || Boolean(participation.registeredAt),
      editable: !['completed', 'received', 'skipped'].includes(participation.stage),
      latestSummary: `最新记录：${participation.progress} ${activity.unit} · ${stageLabel(participation)}`,
      ...(preserveInput ? {} : {
        progressInput: String(participation.progress), registered: Boolean(participation.registeredAt),
      }),
    });
  },
  async load() {
    this.setData({ loading: true, loadError: '' });
    try {
      await this.applyRecord(await this.readRecord(), false);
      if (this.disposed) return;
      if (!this.draftChecked) {
        this.draftChecked = true;
        const saved = loadDraft<ProgressDraft>('progress', this.data.ownerId, this.data.participationId);
        if (saved && typeof saved.value.progressInput === 'string' && typeof saved.value.registered === 'boolean') {
          const recover = await confirmDraftRecovery(saved, this.data.participation!.version);
          if (this.disposed) return;
          if (recover) {
            this.setData({ progressInput: saved.value.progressInput, registered: saved.value.registered,
              dirty: true, reapplyRequired: true, draftNotice: '已恢复本机草稿，请核对最新记录后保存。' });
            this.persistDraft();
          } else removeDraft('progress', this.data.ownerId, this.data.participationId);
        }
      }
    } catch (error) { if (!this.disposed) this.setData({ loadError: messageOf(error) }); }
    finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  persistDraft() {
    if (this.disposed || !this.data.participation) return;
    const saved = saveDraft('progress', this.data.ownerId, this.data.participationId, this.data.participation.version, {
      progressInput: this.data.progressInput, registered: this.data.registered,
    });
    this.setData({ dirty: true, draftNotice: saved ? '未保存内容已暂存本机，下次可选择恢复。' : '草稿暂存失败，请保存后再离开。' });
    wx.enableAlertBeforeUnload({ message: saved ? '进度尚未保存，返回后可从本机草稿恢复。' : '进度尚未保存，草稿暂存失败，离开后修改将丢失。' });
  },
  onProgressInput(event: InputEvent) {
    if (this.data.busy || this.data.reloading || !this.data.editable) return;
    this.setData({ progressInput: event.detail.value, progressError: '', formError: '' });
    this.persistDraft();
  },
  onRegistrationChange(event: CheckEvent) {
    if (this.data.busy || this.data.reloading || !this.data.editable) return;
    this.setData({ registered: event.detail.value.includes('registered'), formError: '' });
    this.persistDraft();
  },
  focusError() {
    this.setData({ focusField: '' });
    wx.nextTick(() => {
      if (this.disposed) return;
      wx.pageScrollTo({ selector: '#progress-field', duration: 180 });
      this.setData({ focusField: 'progress' });
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
    } catch (error) { if (!this.disposed) this.setData({ formError: messageOf(error) }); }
    finally { if (!this.disposed) this.setData({ reloading: false }); }
  },
  async save() {
    if (this.disposed || this.data.busy || this.data.reloading || this.data.conflict || !this.data.editable || !this.data.participation) return;
    const raw = this.data.progressInput.trim();
    const progress = Number(raw);
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(progress) || progress > 1000000000) {
      this.setData({ progressError: '请输入 0 到 10 亿之间的数字，最多两位小数。' });
      this.focusError(); return;
    }
    const draftOwnerId = this.data.ownerId, draftEntityId = this.data.participationId;
    const draftRevision = getDraftRevision('progress', draftOwnerId, draftEntityId);
    this.setData({ busy: true, formError: '', progressError: '' });
    try {
      await api.command('participation.progress', {
        participationId: this.data.participation.id, progress,
        registered: this.data.registered, expectedVersion: this.data.participation.version,
      });
      removeDraft('progress', draftOwnerId, draftEntityId, draftRevision);
      if (this.disposed) return;
      this.setData({ dirty: false, draftNotice: '' });
      wx.disableAlertBeforeUnload();
      wx.showToast({ title: '进度已保存', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      if (this.disposed) return;
      if (codeOf(error) === 'VERSION_CONFLICT') {
        this.setData({ conflict: true, formError: '记录已被更新。你的输入已保留，请读取最新记录，再决定是否重新应用。' });
        this.persistDraft();
        wx.nextTick(() => { if (!this.disposed) wx.pageScrollTo({ selector: '#record-conflict', duration: 180 }); });
      } else {
        const field = typeof error === 'object' && error !== null && 'field' in error ? error.field : '';
        this.setData(field === 'progress' ? { progressError: messageOf(error) } : { formError: messageOf(error) });
        if (field === 'progress') this.focusError();
        showError(error);
      }
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  back() { if (!this.data.busy && !this.data.reloading) wx.navigateBack(); },
});

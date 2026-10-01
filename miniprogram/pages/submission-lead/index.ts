import { api, ensureSession, uploadImage, previewAssets } from '../../services/api';
import type { ActivityDraft, ActivityLead, Asset, Submission } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { validatePublicHttps } from '../../../domain/validation';
import { loadDraft, saveDraft, removeDraft, getDraftRevision, confirmDraftRecovery, createCommandIntent } from '../../services/form-draft';
import { cleanRewardInput, cycleOptions, cyclePreview, defaultCycle, intervalOptions, mergeRecognition, recognitionLabels, rewardOptions, rewardUnit, rewardValue, weekdayOptions } from '../../services/recognition-form';
import type { DateRecognitionMarks, RecognitionMarks, RecognizedImage } from '../../services/recognition-form';

type LeadField = keyof ActivityLead;
type InputEvent = { currentTarget: { dataset: { field?: string; id?: string } }; detail: { value: string } };
type PendingLeadCreation = { pending: true; intentKey: string; lead: ActivityLead };
type SavedLeadInput = { lead: ActivityLead; intentKey?: string; pendingCreation?: PendingLeadCreation };
type DraftContext = { ownerId: string; entityId: string; revision: string | null; generation: number };
const draftScope = 'submission-lead';
const leadFields: LeadField[] = ['title', 'bankId', 'sourceUrl', 'sourceNote', 'imageIds', 'rules'];
const rejectedCreationCodes = new Set(['INVALID_INPUT', 'INVALID_DATE', 'INVALID_ASSET', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'IMMUTABLE', 'REQUEST_CONFLICT', 'VERSION_CONFLICT', 'INVALID_STATE', 'INVALID_ACTION']);

function freshLead(bankId = ''): ActivityLead {
  return { title: '', bankId, sourceUrl: '', sourceNote: '', imageIds: [] };
}
function isSavedInput(value: SavedLeadInput): boolean {
  const lead = value?.lead;
  return !!lead && ['title', 'bankId', 'sourceUrl', 'sourceNote'].every(field => typeof lead[field as keyof ActivityLead] === 'string')
    && Array.isArray(lead.imageIds) && lead.imageIds.every(id => typeof id === 'string');
}
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message;
    if ('errMsg' in error && typeof error.errMsg === 'string') return error.errMsg;
  }
  return fallback;
}
function uploadFailureText(message: string): string {
  if (/privacy permission is not authorized/i.test(message)) return '尚未同意隐私指引，本次未添加图片。可继续填写，或再次添加图片时阅读并选择是否同意。';
  if (/(?:chooseMedia|chooseImage|album|photo).*?(?:auth|permission|deny|denied|拒绝|权限)/i.test(message)) return '无法访问照片，请在微信设置中允许相册权限后重试。';
  if (!/(?:chooseMedia|chooseImage|getImageInfo|uploadFile|saveFile):/i.test(message) && /[\u3400-\u9fff]/.test(message)) return message;
  if (/network|timeout|timed out|connection|uploadFile/i.test(message)) return '图片上传失败，请检查网络后重试。';
  return '图片未能添加，请检查照片权限和网络后重试。';
}

Page({
  disposed: false,
  loadGeneration: 0,
  imageGeneration: 0,
  previewSequence: 0,
  creationIntentKey: '',
  initialTitle: '',
  pendingCreation: null as PendingLeadCreation | null,
  draftBaseVersion: null as number | null,
  recognitionGeneration: 0,
  recognitionSnapshot: null as ActivityLead | null,
  data: {
    loading: true, ready: false, saving: false, submitted: false, pendingCreationUnconfirmed: false, reloading: false, uploading: false, loadingImages: false,
    denied: false, readOnly: false, fullSubmission: false, conflict: false, dirty: false, error: '', imageError: '', localDraftStatus: '',
    submissionId: '', submission: null as Submission | null, ownerId: '',
    lead: freshLead(), errors: {} as Partial<Record<LeadField, string>>,
    bankOptions: [{ id: '', name: '请选择银行' }, ...banks], bankIndex: 0,
    assets: [] as Asset[], assetUrls: [] as { id: string; url: string }[],
    imageRows: [] as { id: string; label: string; url: string; recognized: boolean; scanning: boolean }[],
    today: '', bankGridOpen: false, selectedBank: null as typeof banks[number] | null, bankGrid: banks,
    rulesExpanded: false, rules: {} as Partial<ActivityDraft>, rewardText: '', rewardOptions, cycleOptions, weekdayOptions, intervalOptions,
    cycleType: '', cycleDay: 1, cycleWeekday: 1, cycleN: 1, cycleUnit: 'month', intervalLabel: '个月', cyclePreview: '', rewardUnit: '元', ruleError: '',
    recognizing: false, recognitionDemo: false, recognizedImages: [] as RecognizedImage[], recognizedFields: {} as RecognitionMarks, recognizedDates: {} as DateRecognitionMarks,
    recognitionChips: [] as { id: string; label: string }[], recognitionCount: 0, pendingRecognitionCount: 0, suggestedTitle: '',
    viewerShow: false, viewerIndex: 0, viewerItems: [] as Record<string, unknown>[],
  },
  onLoad(options: { id?: string; bankId?: string; title?: string }) {
    this.creationIntentKey = createCommandIntent();
    const lead = freshLead(banks.some(bank => bank.id === options.bankId) ? options.bankId : '');
    this.initialTitle = !options.id && options.title ? options.title.slice(0, 60) : '';
    lead.title = this.initialTitle;
    this.setData({ submissionId: options.id || '', lead });
    void this.load();
  },
  onHide() { this.previewSequence++; if (!this.disposed && !this.data.saving && !this.data.reloading) this.persistDraft(); },
  onUnload() { this.disposed = true; this.loadGeneration++; this.imageGeneration++; this.recognitionGeneration++; },
  async load() {
    if (this.disposed || this.data.saving || this.data.submitted || this.data.reloading || this.data.uploading) return;
    if (!this.creationIntentKey) this.creationIntentKey = createCommandIntent();
    const generation = ++this.loadGeneration;
    this.imageGeneration++;
    this.setData({ loading: true, ready: false, denied: false, fullSubmission: false, error: '', loadingImages: false });
    try {
      const session = await ensureSession();
      if (this.disposed || generation !== this.loadGeneration) return;
      this.setData({ today: session.today });
      const submission = this.data.submissionId ? await api.query('submission.get', { id: this.data.submissionId }) : null;
      if (this.disposed || generation !== this.loadGeneration) return;
      if (submission && submission.ownerId !== session.userId) { this.setData({ denied: true }); return; }
      if (submission && (!submission.lead || (submission.draft && submission.status !== 'published'))) {
        this.setData({ submission, fullSubmission: true, error: '这份线索已补齐为完整活动稿件，请前往完整投稿页查看。' }); return;
      }
      this.applyLead(submission, session.userId);
      if (!this.data.readOnly) {
        const entityId = this.draftEntityId();
        const saved = loadDraft<SavedLeadInput>(draftScope, session.userId, entityId);
        const revision = getDraftRevision(draftScope, session.userId, entityId);
        if (saved?.value.pendingCreation !== undefined && !isSavedInput(saved.value)) {
          this.setData({ pendingCreationUnconfirmed: true, error: '上次提交的恢复信息不完整，已保留本机副本。请先到“我的投稿”核对，暂不能再次新建。' });
          return;
        }
        const recover = saved && isSavedInput(saved.value) && (saved.value.pendingCreation !== undefined || await confirmDraftRecovery(saved, this.draftBaseVersion));
        if (this.disposed || generation !== this.loadGeneration) return;
        if (saved && recover) {
          if (!this.data.submissionId) this.creationIntentKey = typeof saved.value.intentKey === 'string' && saved.value.intentKey.length >= 1 && saved.value.intentKey.length <= 128 ? saved.value.intentKey : createCommandIntent();
          const pending = saved.value.pendingCreation;
          if (!this.data.submissionId && pending !== undefined) {
            if (pending?.pending === true && typeof pending.intentKey === 'string' && pending.intentKey.length >= 1 && pending.intentKey.length <= 128 && isSavedInput({ lead: pending.lead })) {
              this.pendingCreation = JSON.parse(JSON.stringify(pending)) as PendingLeadCreation;
              this.creationIntentKey = pending.intentKey;
            }
            this.setData({ pendingCreationUnconfirmed: true });
          }
          const stale = saved.baseVersion !== this.draftBaseVersion;
          this.draftBaseVersion = typeof saved.baseVersion === 'number' ? saved.baseVersion : null;
          this.setData({ lead: saved.value.lead, rewardText: saved.value.lead.rules?.rewardMinor ? String(saved.value.lead.rules.rewardMinor / 100) : '', rulesExpanded: !!saved.value.lead.rules, dirty: true, conflict: stale, localDraftStatus: '已恢复本机草稿，尚未提交', error: stale ? '草稿基于旧版本，暂不能提交。请先复制需要保留的内容，再读取最新线索核对。' : '' });
          if (this.pendingCreation) this.persistDraft();
          wx.enableAlertBeforeUnload({ message: '草稿已保存在本机，尚未提交。' });
        } else if (saved) {
          if (!this.data.submissionId) this.creationIntentKey = createCommandIntent();
          removeDraft(draftScope, session.userId, entityId, revision);
        }
      }
      this.syncOptions();
      void this.loadImages();
    } catch (error) {
      if (!this.disposed && generation === this.loadGeneration) this.setData({ error: messageOf(error, '线索暂时无法读取，请重试。') });
    } finally {
      if (!this.disposed && generation === this.loadGeneration) this.setData({ loading: false });
    }
  },
  applyLead(submission: Submission | null, ownerId: string) {
    this.pendingCreation = null;
    this.setData({ pendingCreationUnconfirmed: false });
    const lead = submission?.lead ? JSON.parse(JSON.stringify(submission.lead)) as ActivityLead : { ...freshLead(this.data.lead.bankId), title: this.initialTitle };
    const readOnly = submission?.status === 'published';
    this.draftBaseVersion = submission?.version ?? null;
    this.recognitionSnapshot = null;
    this.recognitionGeneration++;
    this.setData({ ready: true, ownerId, submission, lead, readOnly, fullSubmission: false, conflict: false, dirty: false, errors: {}, error: '', imageError: '', localDraftStatus: '', assets: [], assetUrls: [], recognizedImages: [], recognizedFields: {}, recognizedDates: {}, recognizing: false, suggestedTitle: '', rulesExpanded: !!lead.rules, rewardText: lead.rules?.rewardMinor ? String(lead.rules.rewardMinor / 100) : '', ruleError: '', viewerShow: false });
    this.syncOptions();
    wx.setNavigationBarTitle({ title: readOnly ? '线索详情' : submission ? '修改活动线索' : '分享活动线索' });
  },
  syncOptions() {
    const rules = this.data.lead.rules || {};
    const cycle = rules.cycle;
    const recognizedFields = this.data.recognizedFields;
    const chips = Object.keys(recognitionLabels).filter(key => recognizedFields[key as keyof RecognitionMarks]).map(id => ({ id, label: recognitionLabels[id as keyof RecognitionMarks] }));
    this.setData({
      bankIndex: Math.max(0, this.data.bankOptions.findIndex(bank => bank.id === this.data.lead.bankId)),
      selectedBank: banks.find(bank => bank.id === this.data.lead.bankId) || null,
      rules, cycleType: cycle?.t || '', cycleDay: cycle?.t === 'month' ? cycle.day : 1, cycleWeekday: cycle?.t === 'week' ? cycle.weekday : 1,
      cycleN: cycle?.t === 'custom' ? cycle.n : 1, cycleUnit: cycle?.t === 'custom' ? cycle.unit : 'month', intervalLabel: cycle?.t === 'custom' ? intervalOptions.find(unit => unit.id === cycle.unit)?.name || '个月' : '个月',
      cyclePreview: cyclePreview(cycle, this.data.today), rewardUnit: rewardUnit(rules), recognitionChips: chips, recognitionCount: chips.length,
      pendingRecognitionCount: this.data.lead.imageIds.filter(id => !this.data.recognizedImages.some(item => item.assetId === id)).length,
      imageRows: this.data.lead.imageIds.map((id, index) => ({ id, label: `活动截图 ${index + 1}`, url: this.data.assetUrls.find(asset => asset.id === id)?.url || '', recognized: this.data.recognizedImages.some(item => item.assetId === id && item.recognized), scanning: this.data.recognizing && !this.data.recognizedImages.some(item => item.assetId === id) })),
    });
  },
  draftEntityId(): string { return this.data.submissionId || 'new'; },
  canEdit(): boolean { return !this.disposed && this.data.ready && !this.data.loading && !this.data.readOnly && !this.data.denied && !this.data.saving && !this.data.submitted && !this.data.reloading && !this.data.pendingCreationUnconfirmed; },
  draftContext(): DraftContext {
    return { ownerId: this.data.ownerId, entityId: this.draftEntityId(), revision: getDraftRevision(draftScope, this.data.ownerId, this.draftEntityId()), generation: this.loadGeneration };
  },
  persistDraft(): boolean {
    if (this.disposed || !this.data.ready || this.data.readOnly || this.data.denied || this.data.saving || this.data.submitted || this.data.reloading || !this.data.dirty || (this.data.pendingCreationUnconfirmed && !this.pendingCreation)) return false;
    const saved = saveDraft<SavedLeadInput>(draftScope, this.data.ownerId, this.draftEntityId(), this.draftBaseVersion, { lead: this.data.lead, ...(!this.data.submissionId ? { intentKey: this.creationIntentKey, ...(this.pendingCreation ? { pendingCreation: this.pendingCreation } : {}) } : {}) });
    this.setData({ localDraftStatus: saved ? this.data.pendingCreationUnconfirmed ? '原提交内容已保存在本机，等待确认结果' : '本机草稿已保存，尚未提交' : '草稿未能保存在本机，请勿关闭页面' });
    return saved;
  },
  saveLocalDraft() {
    if (!this.canEdit() || this.data.uploading) return;
    this.setData({ dirty: true });
    const saved = this.persistDraft();
    wx.enableAlertBeforeUnload({ message: saved ? '草稿已保存在本机，尚未提交。' : '草稿未能保存在本机，离开可能丢失。' });
    wx.showToast({ title: saved ? '草稿已保存在本机' : '草稿保存失败，请重试', icon: 'none' });
  },
  markDirty() {
    if (!this.canEdit()) return;
    this.setData({ dirty: true });
    this.syncOptions();
    const saved = this.persistDraft();
    wx.enableAlertBeforeUnload({ message: saved ? '草稿已保存在本机，尚未提交。' : '草稿未能保存在本机，离开可能丢失。' });
  },
  input(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    if (!field || !['title', 'sourceUrl', 'sourceNote'].includes(field)) return;
    this.setData({ [`lead.${field}`]: String(event.detail.value), [`errors.${field}`]: '', ...(this.data.conflict ? {} : { error: '' }) });
    if (field === 'title') this.setData({ 'recognizedFields.title': false, suggestedTitle: '' });
    if (field === 'sourceNote') this.setData({ 'recognizedFields.entrance': false, ...(this.data.lead.rules?.entrance ? { 'lead.rules.entrance.instructions': String(event.detail.value) } : {}) });
    if (field === 'sourceUrl' || field === 'sourceNote') this.setData({ 'errors.sourceNote': '' });
    this.markDirty();
  },
  selectBank(event: InputEvent) {
    if (!this.canEdit()) return;
    const bank = event.currentTarget.dataset.id ? banks.find(item => item.id === event.currentTarget.dataset.id) : this.data.bankOptions[Number(event.detail.value)];
    if (!bank) return;
    this.setData({ 'lead.bankId': bank.id, ...(this.data.lead.rules ? { 'lead.rules.currency': bank.id === 'hsbc' ? 'HKD' : 'CNY' } : {}), 'errors.bankId': '', ...(this.data.conflict ? {} : { error: '' }) });
    this.setData({ 'recognizedFields.bankId': false, bankGridOpen: false });
    this.markDirty();
  },
  openBanks() { if (this.canEdit()) this.setData({ bankGridOpen: true }); },
  toggleRules() { this.setData({ rulesExpanded: !this.data.rulesExpanded }); },
  inputRule(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    if (field === 'rewardText') {
      const value = cleanRewardInput(String(event.detail.value), this.data.rules.rewardKind === 'points');
      this.setData({ rewardText: value, 'lead.rules.rewardMinor': rewardValue(value, this.data.rules.rewardKind === 'points') || 0, 'recognizedFields.reward': false });
    } else if (field === 'conditions') this.setData({ 'lead.rules.conditions': String(event.detail.value), 'recognizedFields.conditions': false });
    else return;
    this.setData({ ruleError: '', 'errors.rules': '', ...(this.data.conflict ? {} : { error: '' }) });
    this.markDirty();
  },
  selectReward(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit()) return;
    const kind = event.currentTarget.dataset.id;
    if (!rewardOptions.some(item => item.id === kind)) return;
    const value = cleanRewardInput(this.data.rewardText, kind === 'points');
    this.setData({ 'lead.rules.rewardKind': kind, 'lead.rules.rewardMinor': rewardValue(value, kind === 'points') || 0, 'lead.rules.currency': this.data.rules.currency || (this.data.lead.bankId === 'hsbc' ? 'HKD' : 'CNY'), rewardText: value, 'recognizedFields.reward': false, ruleError: '', 'errors.rules': '', ...(this.data.conflict ? {} : { error: '' }) });
    this.markDirty();
  },
  selectCycle(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit()) return;
    const type = event.currentTarget.dataset.id;
    if (!cycleOptions.some(item => item.id === type)) return;
    this.setData({ 'lead.rules.cycle': defaultCycle(type, this.data.rules.startsOn || '', this.data.rules.endsOn || ''), 'recognizedFields.cycle': false, ruleError: '', 'errors.rules': '', ...(this.data.conflict ? {} : { error: '' }) });
    this.markDirty();
  },
  selectWeekday(event: { currentTarget: { dataset: { id: number } } }) {
    if (!this.canEdit() || this.data.rules.cycle?.t !== 'week') return;
    const weekday = Number(event.currentTarget.dataset.id);
    if (!weekdayOptions.some(item => item.id === weekday)) return;
    this.setData({ 'lead.rules.cycle.weekday': weekday, 'recognizedFields.cycle': false, 'errors.rules': '' });
    this.markDirty();
  },
  stepCycle(event: { currentTarget: { dataset: { delta: number } } }) {
    if (!this.canEdit()) return;
    const cycle = this.data.rules.cycle;
    const delta = Number(event.currentTarget.dataset.delta);
    if (cycle?.t === 'month') this.setData({ 'lead.rules.cycle.day': Math.max(1, Math.min(28, cycle.day + delta)) });
    else if (cycle?.t === 'custom') this.setData({ 'lead.rules.cycle.n': Math.max(1, Math.min(cycle.unit === 'day' ? 90 : 12, cycle.n + delta)) });
    else return;
    this.setData({ 'recognizedFields.cycle': false, 'errors.rules': '' }); this.markDirty();
  },
  selectInterval(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit() || this.data.rules.cycle?.t !== 'custom') return;
    const unit = event.currentTarget.dataset.id;
    if (!intervalOptions.some(item => item.id === unit)) return;
    this.setData({ 'lead.rules.cycle.unit': unit, 'lead.rules.cycle.n': Math.min(unit === 'day' ? 90 : 12, this.data.rules.cycle.n), 'recognizedFields.cycle': false, 'errors.rules': '' });
    this.markDirty();
  },
  selectRuleDate(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    const value = String(event.detail.value);
    if (!['startsOn', 'endsOn'].includes(field || '')) return;
    if (field === 'endsOn' && this.data.rules.startsOn && value < this.data.rules.startsOn) { wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' }); return; }
    this.setData({ [`lead.rules.${field}`]: value, [`recognizedDates.${field}`]: false, 'recognizedFields.time': false, ruleError: '', 'errors.rules': '', ...(this.data.conflict ? {} : { error: '' }) });
    if (field === 'startsOn' && this.data.rules.endsOn && value > this.data.rules.endsOn) this.setData({ 'lead.rules.endsOn': '', 'recognizedDates.endsOn': false });
    const cycle = this.data.lead.rules?.cycle;
    if (cycle?.t === 'once') this.setData({ 'lead.rules.cycle.start': this.data.lead.rules?.startsOn || '', 'lead.rules.cycle.end': this.data.lead.rules?.endsOn || '' });
    if (cycle?.t === 'custom') this.setData({ 'lead.rules.cycle.anchor': this.data.lead.rules?.startsOn || '' });
    this.markDirty();
  },
  async recognizeImages() {
    if (!this.canEdit() || this.data.recognizing || this.data.uploading) return;
    const ids = this.data.lead.imageIds.filter(id => !this.data.recognizedImages.some(item => item.assetId === id));
    if (!ids.length) return;
    const generation = ++this.recognitionGeneration;
    const loadGeneration = this.loadGeneration;
    if (!this.recognitionSnapshot) this.recognitionSnapshot = JSON.parse(JSON.stringify(this.data.lead)) as ActivityLead;
    this.setData({ recognizing: true, imageError: '' }); this.syncOptions();
    try {
      const response = await api.query('assets.recognize', { ids });
      if (this.disposed || generation !== this.recognitionGeneration || loadGeneration !== this.loadGeneration || !this.canEdit()) return;
      let current: Partial<ActivityDraft> = { ...this.data.lead.rules, title: this.data.lead.title, bankId: this.data.lead.bankId, entrance: this.data.lead.rules?.entrance || { kind: 'guide', label: '参与入口', instructions: this.data.lead.sourceNote, imageIds: [] } };
      let marks = this.data.recognizedFields;
      let dateMarks = this.data.recognizedDates;
      const syncEntryNote = !this.data.lead.sourceNote || !!this.data.recognizedFields.entrance;
      let suggestion = this.data.suggestedTitle;
      const images: RecognizedImage[] = [];
      for (const item of response.items) {
        if (!ids.includes(item.assetId)) continue;
        const fields = { ...item.fields };
        if (this.data.rewardText.trim() && !this.data.recognizedFields.reward) { delete fields.rewardKind; delete fields.rewardMinor; }
        const merged = mergeRecognition(current, fields, marks, dateMarks);
        current = merged.value; marks = merged.marks; dateMarks = merged.dateMarks;
        if (merged.suggestion) suggestion = merged.suggestion;
        images.push({ assetId: item.assetId, recognized: item.recognized, regions: item.regions });
      }
      const { title, bankId, ...rules } = current;
      this.setData({ 'lead.title': title || '', 'lead.bankId': bankId || '', 'lead.rules': rules, ...(syncEntryNote && rules.entrance?.instructions ? { 'lead.sourceNote': rules.entrance.instructions } : {}), rewardText: rules.rewardMinor ? String(rules.rewardMinor / 100) : this.data.rewardText, recognizedFields: marks, recognizedDates: dateMarks, recognizedImages: [...this.data.recognizedImages, ...images], suggestedTitle: suggestion, recognitionDemo: response.demo, bankGridOpen: false, rulesExpanded: this.data.rulesExpanded || !!(marks.reward || marks.cycle || marks.time || marks.conditions) });
      this.markDirty();
      if (!images.some(item => item.recognized)) wx.showToast({ title: '未识别到新的活动信息，请上传清晰的活动规则截图', icon: 'none' });
    } catch (error) {
      if (!this.disposed && generation === this.recognitionGeneration) this.setData({ imageError: messageOf(error, '截图识别暂时不可用，请稍后重试或手动填写。') });
    } finally { if (!this.disposed && generation === this.recognitionGeneration) { this.setData({ recognizing: false }); this.syncOptions(); } }
  },
  undoRecognition() {
    if (!this.canEdit() || this.data.recognizing || !this.recognitionSnapshot) return;
    const lead = { ...this.recognitionSnapshot, imageIds: this.data.lead.imageIds.slice() };
    this.recognitionSnapshot = null; this.recognitionGeneration++;
    this.setData({ lead, recognizedFields: {}, recognizedDates: {}, recognizedImages: [], suggestedTitle: '', rewardText: lead.rules?.rewardMinor ? String(lead.rules.rewardMinor / 100) : '', rulesExpanded: !!lead.rules, recognitionDemo: false });
    this.markDirty();
  },
  adoptSuggestedTitle() {
    if (!this.canEdit() || !this.data.suggestedTitle) return;
    this.setData({ 'lead.title': this.data.suggestedTitle, suggestedTitle: '', 'recognizedFields.title': true, 'errors.title': '' }); this.markDirty();
  },
  async openShot(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.disposed || this.data.loadingImages) return;
    const id = event.currentTarget.dataset.id;
    const generation = this.loadGeneration;
    const sequence = ++this.previewSequence;
    if (!this.data.lead.imageIds.includes(id)) return;
    if (!this.data.assetUrls.some(asset => asset.id === id)) await this.loadImages();
    if (this.disposed || generation !== this.loadGeneration || sequence !== this.previewSequence || !this.data.lead.imageIds.includes(id)) return;
    const items = this.data.imageRows.map(row => {
      const recognized = this.data.recognizedImages.find(item => item.assetId === row.id);
      return { id: row.id, url: row.url, label: row.label, uploader: '本人', uploadedOn: this.data.today, recognized: recognized?.recognized, attempted: !!recognized, regions: recognized?.regions || [] };
    });
    if (!items.find(item => item.id === id)?.url) { this.setData({ imageError: '这张图片暂时无法查看，请重试读取。' }); return; }
    this.setData({ viewerShow: true, viewerIndex: items.findIndex(item => item.id === id), viewerItems: items });
  },
  closeViewer() { this.setData({ viewerShow: false }); },
  deleteViewerShot(event: { detail: { id: string } }) { this.removeImage({ currentTarget: { dataset: { id: event.detail.id } } }); },
  async addImage() {
    if (!this.canEdit() || this.data.uploading || this.data.recognizing) return;
    if (this.data.lead.imageIds.length >= 6) { wx.showToast({ title: '最多添加 6 张图片', icon: 'none' }); return; }
    const generation = this.loadGeneration;
    this.setData({ uploading: true });
    try {
      const asset = await uploadImage();
      if (this.disposed || generation !== this.loadGeneration) return;
      if (!this.data.lead.imageIds.includes(asset.id)) this.setData({ assets: [...this.data.assets, asset], 'lead.imageIds': [...this.data.lead.imageIds, asset.id], 'errors.imageIds': '', 'errors.sourceNote': '' });
      this.markDirty();
      await this.loadImages();
    } catch (error) {
      const message = typeof error === 'string' ? error
        : error && typeof error === 'object' && 'errMsg' in error && typeof error.errMsg === 'string' && error.errMsg.trim() ? error.errMsg
        : messageOf(error, '图片未能添加，请检查照片权限和网络后重试。');
      if (!this.disposed && generation === this.loadGeneration && !/cancel|取消/i.test(message)) this.setData({ imageError: uploadFailureText(message) });
    } finally {
      if (!this.disposed && generation === this.loadGeneration) this.setData({ uploading: false });
    }
  },
  removeImage(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit() || this.data.uploading) return;
    const id = event.currentTarget.dataset.id;
    this.imageGeneration++;
    this.recognitionGeneration++;
    this.setData({ 'lead.imageIds': this.data.lead.imageIds.filter(imageId => imageId !== id), assets: this.data.assets.filter(asset => asset.id !== id), assetUrls: this.data.assetUrls.filter(asset => asset.id !== id), recognizedImages: this.data.recognizedImages.filter(item => item.assetId !== id), recognizing: false, loadingImages: false, imageError: '', 'errors.imageIds': '', viewerShow: false });
    this.markDirty();
  },
  async loadImages() {
    if (this.disposed) return;
    const generation = ++this.imageGeneration;
    const ids = this.data.lead.imageIds.slice();
    if (!ids.length) { this.setData({ assets: [], assetUrls: [], loadingImages: false, imageError: '' }); this.syncOptions(); return; }
    this.setData({ loadingImages: true, imageError: '' });
    try {
      const [assets, assetUrls] = await Promise.all([api.query('assets.get', { ids }), api.query('assets.urls', { ids })]);
      if (this.disposed || generation !== this.imageGeneration) return;
      this.setData({ assets, assetUrls });
      this.syncOptions();
    } catch (error) {
      if (!this.disposed && generation === this.imageGeneration) this.setData({ imageError: messageOf(error, '图片暂时无法读取，请重试。') });
    } finally {
      if (!this.disposed && generation === this.imageGeneration) this.setData({ loadingImages: false });
    }
  },
  async previewImage(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.disposed || this.data.loadingImages) return;
    const generation = this.loadGeneration;
    const id = event.currentTarget.dataset.id;
    if (!this.data.lead.imageIds.includes(id)) return;
    const previewSequence = ++this.previewSequence;
    if (!this.data.assets.some(asset => asset.id === id)) await this.loadImages();
    if (this.disposed || generation !== this.loadGeneration || !this.data.lead.imageIds.includes(id)) return;
    const assets = this.data.lead.imageIds.map(imageId => this.data.assets.find(asset => asset.id === imageId)).filter((asset): asset is Asset => !!asset);
    const index = assets.findIndex(asset => asset.id === id);
    if (index < 0) { this.setData({ imageError: '这张图片暂时无法查看，请重试读取。' }); return; }
    const galleryIds = this.data.lead.imageIds.slice();
    const shouldOpen = () => {
      const pages = getCurrentPages();
      return !this.disposed && generation === this.loadGeneration && previewSequence === this.previewSequence && pages[pages.length - 1] === this
        && galleryIds.length === this.data.lead.imageIds.length && galleryIds.every((imageId, position) => imageId === this.data.lead.imageIds[position]);
    };
    try { await previewAssets(assets, index, shouldOpen); }
    catch (error) { if (shouldOpen()) this.setData({ imageError: messageOf(error, '图片暂时无法打开，请重试。') }); }
  },
  copySource() {
    if (this.disposed) return;
    const value = [this.data.lead.sourceUrl, this.data.lead.sourceNote].filter(Boolean).join('\n');
    if (value) wx.setClipboardData({ data: value });
  },
  reject(field: LeadField, message: string): false {
    this.setData({ [`errors.${field}`]: message, ...(field === 'rules' ? { rulesExpanded: true } : {}), error: '请检查标出的内容，填写后重新提交。' }, () => {
      const capsule = wx.getMenuButtonBoundingClientRect?.();
      const info = wx.getWindowInfo?.();
      const top = capsule?.top ? capsule.top - Math.max(0, (44 - capsule.height) / 2) : info?.statusBarHeight || 54;
      if (!this.disposed) wx.pageScrollTo({ selector: `#field-${field}`, offsetTop: -(top + 56), duration: 180 });
    });
    return false;
  },
  validate(): ActivityLead | false {
    const lead: ActivityLead = { ...this.data.lead, title: this.data.lead.title.trim(), sourceUrl: this.data.lead.sourceUrl.trim(), sourceNote: this.data.lead.sourceNote.trim(), imageIds: this.data.lead.imageIds.slice() };
    const errors: Partial<Record<LeadField, string>> = {};
    if (!lead.title) errors.title = '请填写活动名称';
    else if (lead.title.length > 60) errors.title = '请填写 60 字以内的活动名称。';
    if (!banks.some(bank => bank.id === lead.bankId)) errors.bankId = '请选择所属银行';
    if (lead.sourceUrl) {
      try { validatePublicHttps(lead.sourceUrl); }
      catch (error) { errors.sourceUrl = messageOf(error, '请填写完整的 HTTPS 公开网页地址。'); }
    }
    if (lead.sourceNote.length > 500) errors.sourceNote = '出处说明最多填写 500 字。';
    if (!lead.sourceUrl && !lead.sourceNote && !lead.imageIds.length) errors.sourceNote = '请至少提供一种来源：链接、入口路径或截图';
    if (lead.imageIds.length > 6 || new Set(lead.imageIds).size !== lead.imageIds.length) errors.imageIds = '最多添加 6 张不重复的规则截图。';
    if (lead.rules) {
      const rules = JSON.parse(JSON.stringify(lead.rules)) as Partial<ActivityDraft>;
      if (rules.rewardKind || this.data.rewardText) {
        const amount = rewardValue(this.data.rewardText, rules.rewardKind === 'points');
        if (!rules.rewardKind) errors.rules = '请选择奖励类型';
        else if (amount === null || amount <= 0) errors.rules = rules.rewardKind === 'points' ? '积分需要填写大于 0 的整数。' : '请填写大于 0 的奖励数值，最多两位小数。';
        else rules.rewardMinor = amount;
      }
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      if ((rules.startsOn && !validDate(rules.startsOn)) || (rules.endsOn && !validDate(rules.endsOn))) errors.rules = '请选择有效的活动日期。';
      else if (rules.startsOn && rules.endsOn && rules.endsOn < rules.startsOn) errors.rules = '结束日期不能早于开始日期。';
      else if (rules.cycle?.t === 'once' && (!rules.startsOn || !rules.endsOn)) errors.rules = '单次活动需要填写开始和结束日期。';
      else if (rules.cycle?.t === 'custom' && !rules.startsOn) errors.rules = '自定义周期需要填写活动开始日期。';
      if (rules.cycle?.t === 'once') rules.cycle = { t: 'once', start: rules.startsOn || '', end: rules.endsOn || '' };
      if (rules.cycle?.t === 'custom') rules.cycle.anchor = rules.startsOn || '';
      if (!rules.startsOn) delete rules.startsOn;
      if (!rules.endsOn) delete rules.endsOn;
      lead.rules = rules;
    }
    this.setData({ errors });
    const first = leadFields.find(field => errors[field]);
    if (first) return this.reject(first, errors[first]!);
    return lead;
  },
  async save() {
    if (this.disposed || !this.data.ready || this.data.loading || this.data.readOnly || this.data.denied || this.data.saving || this.data.submitted || this.data.reloading || this.data.uploading || this.data.recognizing || this.data.conflict || this.data.fullSubmission) return;
    if (this.data.pendingCreationUnconfirmed && !this.pendingCreation) { this.setData({ error: '上次提交的恢复信息不完整，已保留本机副本。请先到“我的投稿”核对，暂不能再次新建。' }); return; }
    this.setData({ error: '' });
    const lead = this.pendingCreation ? JSON.parse(JSON.stringify(this.pendingCreation.lead)) as ActivityLead : this.validate();
    if (!lead) return;
    const creating = !this.data.submissionId;
    if (creating) {
      const previousPending = this.pendingCreation;
      this.pendingCreation = previousPending || { pending: true, intentKey: this.creationIntentKey, lead };
      this.creationIntentKey = this.pendingCreation.intentKey;
      this.setData({ dirty: true, pendingCreationUnconfirmed: true });
      if (!this.persistDraft()) {
        this.pendingCreation = previousPending;
        this.setData({ pendingCreationUnconfirmed: !!previousPending, error: '提交恢复信息未能保存在本机，请重试保存草稿后再提交。' });
        return;
      }
    }
    const context = this.draftContext();
    const intentKey = this.pendingCreation?.intentKey || this.creationIntentKey;
    const submissionId = this.data.submissionId;
    const expectedVersion = this.data.submission?.version;
    this.setData({ saving: true });
    try {
      const payload = { ...(submissionId ? { id: submissionId, expectedVersion } : {}), lead };
      if (submissionId) await api.command('submission.lead.save', payload);
      else {
        const result = await api.command('submission.lead.save', payload, { intentKey });
        if (!result || typeof result.id !== 'string' || !result.id) throw Object.assign(new Error('提交结果暂时无法确认，请重试确认原提交。'), { code: 'INVALID_RESPONSE' });
      }
      this.finish(context);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      if (creating && rejectedCreationCodes.has(code)) this.clearRejectedCreation(context, intentKey);
      if (!this.disposed && context.generation === this.loadGeneration) this.showFailure(error);
    } finally {
      if (!this.disposed && context.generation === this.loadGeneration) this.setData({ saving: false });
    }
  },
  clearRejectedCreation(context: DraftContext, intentKey: string) {
    if (getDraftRevision(draftScope, context.ownerId, context.entityId) === context.revision) {
      const saved = loadDraft<SavedLeadInput>(draftScope, context.ownerId, context.entityId);
      if (saved?.value.pendingCreation?.intentKey === intentKey) {
        const { pendingCreation, ...value } = saved.value;
        saveDraft(draftScope, context.ownerId, context.entityId, saved.baseVersion, value);
      }
    }
    if (!this.disposed && context.generation === this.loadGeneration && this.pendingCreation?.intentKey === intentKey) {
      this.pendingCreation = null;
      this.setData({ pendingCreationUnconfirmed: false });
    }
  },
  showFailure(error: unknown) {
    if (this.disposed) return;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (this.data.submissionId && (code === 'VERSION_CONFLICT' || code === 'IMMUTABLE' || code === 'INVALID_STATE')) {
      this.setData({ conflict: true, error: '线索内容或审核状态已更新。本次填写仍保留在页面中，请复制需要保留的内容，再读取最新线索核对。' }); return;
    }
    const rawField = error && typeof error === 'object' && 'field' in error && typeof error.field === 'string' ? error.field.replace(/^lead\./, '') : undefined;
    const field = rawField && (rawField.startsWith('rules') || /^(?:rewardKind|rewardMinor|currency|cycle|startsOn|endsOn|conditions|entrance)(?:\.|$)/.test(rawField)) ? 'rules' : rawField as LeadField | undefined;
    const message = messageOf(error, '提交未成功，你的填写内容已保留，请重试。');
    if (field && leadFields.includes(field)) this.reject(field, message);
    else this.setData({ error: message });
  },
  async reloadLatest() {
    if (!this.canEdit() || this.data.uploading || this.data.recognizing || !this.data.submissionId) return;
    const context = this.draftContext();
    this.setData({ reloading: true });
    try {
      const result = await wx.showModal({ title: '读取最新线索？', content: '当前未提交的修改会被最新线索替换。你可以先取消，复制需要保留的内容。', confirmText: '读取最新', cancelText: '继续编辑' });
      if (this.disposed || context.generation !== this.loadGeneration || !result.confirm) return;
      const submission = await api.query('submission.get', { id: context.entityId });
      if (this.disposed || context.generation !== this.loadGeneration) return;
      if (submission.ownerId !== context.ownerId) { this.setData({ error: '无法读取这份线索，当前填写内容已保留。请返回投稿列表查看。' }); return; }
      if (!submission.lead || (submission.draft && submission.status !== 'published')) {
        this.setData({ fullSubmission: true, conflict: true, error: '这份线索已补齐为完整活动稿件。当前填写内容已保留，请前往完整投稿页核对。' }); return;
      }
      removeDraft(draftScope, context.ownerId, context.entityId, context.revision);
      wx.disableAlertBeforeUnload();
      this.imageGeneration++;
      this.applyLead(submission, context.ownerId);
      void this.loadImages();
    } catch (error) {
      if (!this.disposed && context.generation === this.loadGeneration) this.setData({ error: `${messageOf(error, '最新线索暂时无法读取。')} 当前填写内容已保留，请重试。` });
    } finally {
      if (!this.disposed && context.generation === this.loadGeneration) this.setData({ reloading: false });
    }
  },
  finish(context: DraftContext) {
    removeDraft(draftScope, context.ownerId, context.entityId, context.revision);
    if (this.disposed || context.generation !== this.loadGeneration) return;
    this.pendingCreation = null;
    this.setData({ dirty: false, submitted: true, pendingCreationUnconfirmed: false });
    wx.disableAlertBeforeUnload();
    wx.showToast({ title: '线索已提交审核', icon: 'success' });
    wx.navigateBack({ delta: 1, fail: () => { if (!this.disposed && context.generation === this.loadGeneration) wx.redirectTo({ url: '/pages/submissions/index' }); } });
  },
  viewFullSubmission() {
    if (this.disposed || !this.data.submissionId) return;
    this.persistDraft();
    wx.redirectTo({ url: `/pages/submission-edit/index?id=${encodeURIComponent(this.data.submissionId)}` });
  },
  fillFullRules() {
    if (!this.canEdit() || this.data.uploading || this.data.submissionId) return;
    this.setData({ dirty: true });
    if (!this.persistDraft()) { this.setData({ error: '本机草稿暂时无法保存，当前填写内容已保留。请重试后再填写完整规则。' }); return; }
    wx.navigateTo({ url: '/pages/submission-edit/index?fromLead=1' });
  },
  viewActivity() {
    if (!this.disposed && this.data.submission?.activityId) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(this.data.submission.activityId)}` });
  },
  viewSubmissions() { if (!this.disposed) wx.redirectTo({ url: '/pages/submissions/index' }); },
  goBack() { if (!this.disposed) wx.navigateBack({ delta: 1, fail: () => { if (!this.disposed) wx.redirectTo({ url: '/pages/submissions/index' }); } }); },
});

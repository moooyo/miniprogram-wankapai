import { api, ensureSession, uploadImage, previewAssets } from '../../services/api';
import type { ActivityDraft, ActivityLead, Asset, MutationResult, Submission } from '../../../shared/contracts';
import { banks, issuers, networks } from '../../../shared/catalog';
import { loadDraft, saveDraft, removeDraft, getDraftRevision, confirmDraftRecovery, createCommandIntent } from '../../services/form-draft';
import { navigateBackOr } from '../../services/navigation';
import { activityCycle } from '../../../shared/activity-cycle';
import { cleanRewardInput, cycleOptions, cyclePreview, defaultCycle, intervalOptions, rewardOptions, rewardUnit, weekdayOptions } from '../../services/recognition-form';

type FormSection = 'basic' | 'rules' | 'entrance' | 'source';
type InputEvent = { currentTarget: { dataset: { field: string; section?: FormSection; id?: string } }; detail: { value: string | boolean | string[] } };
type Option = { id: string; name: string };
type FormErrors = Record<string, string | Record<string, string>>;
type CreationInputSnapshot = { draft: ActivityDraft; targetText: string; rewardText: string; sourceImageIds: string[] };
type PendingSubmissionCreation = { pending: true; intentKey: string; draft: ActivityDraft; inputSnapshot?: CreationInputSnapshot };
type SavedSubmissionInput = { draft: ActivityDraft; targetText: string; rewardText: string; reviewNote: string; openSection: FormSection; draftEdited: boolean; sourceImageIds?: string[]; importedLead?: boolean; intentKey?: string; pendingCreation?: PendingSubmissionCreation };
type SavedLeadInput = { lead: ActivityLead; pendingCreation?: unknown };
type FieldIssue = { field: string; message: string; section: FormSection };
const fieldLabels: Record<string, string> = {
  title: '活动标题', bankId: '银行', issuerIds: '适用发卡机构', cardKind: '卡片类型', networks: '卡组织', cardDescription: '适用卡片说明', conditions: '参与条件',
  frequency: '活动周期', startsOn: '开始日期', endsOn: '最终结束日期', targetText: '每期累计门槛', unit: '单位', rewardKind: '奖励类型', rewardText: '预计奖励金额', currency: '奖励币种', scope: '参与名额',
  'entrance.kind': '入口形式', 'entrance.label': '入口名称', 'entrance.url': '活动入口链接', 'entrance.appId': '小程序 AppID', 'entrance.path': '页面路径', 'entrance.shortLink': '小程序短链接', 'entrance.instructions': '操作说明或路径', imageIds: '入口图片',
  sourceUrl: '官方来源链接', sourceNote: '出处说明', sourceVerified: '来源与入口核验', reviewNote: '退回原因',
};
const formSections: FormSection[] = ['basic', 'rules', 'entrance', 'source'];
const fieldSections: Record<string, FormSection> = {
  title: 'basic', bankId: 'basic', issuerIds: 'basic', cardKind: 'basic', networks: 'basic', cardDescription: 'basic', conditions: 'basic',
  frequency: 'rules', startsOn: 'rules', endsOn: 'rules', targetText: 'rules', unit: 'rules', rewardKind: 'rules', rewardText: 'rules', currency: 'rules', scope: 'rules',
  'entrance.kind': 'entrance', 'entrance.label': 'entrance', 'entrance.url': 'entrance', 'entrance.appId': 'entrance', 'entrance.path': 'entrance', 'entrance.shortLink': 'entrance', 'entrance.instructions': 'entrance', imageIds: 'entrance',
  sourceUrl: 'source', sourceNote: 'source', sourceVerified: 'source', reviewNote: 'source',
};
const frequencies: Option[] = [{ id: 'once', name: '一次性' }, { id: 'monthly', name: '每月' }, { id: 'quarterly', name: '每季度' }, { id: 'yearly', name: '每年' }];
const currencies: Option[] = [{ id: 'CNY', name: '人民币 CNY' }, { id: 'HKD', name: '港币 HKD' }, { id: 'MOP', name: '澳门元 MOP' }];
const cardKinds: Option[] = [{ id: 'credit', name: '信用卡' }, { id: 'debit', name: '储蓄卡' }, { id: 'any', name: '信用卡与储蓄卡' }];
const rewardKinds: Option[] = rewardOptions;
const scopes: Option[] = [{ id: 'user', name: '每人一份' }, { id: 'card', name: '每张符合条件的卡一份' }];
const entranceKinds: Option[] = [{ id: 'guide', name: '图片或操作路径' }, { id: 'web', name: '网页链接' }, { id: 'miniprogram', name: '微信小程序' }];
const unitOptions = ['次', '笔', '元', '港元', '澳门元'];
const rejectedCreationCodes = new Set(['INVALID_INPUT', 'INVALID_DATE', 'INVALID_ASSET', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'IMMUTABLE', 'REQUEST_CONFLICT', 'VERSION_CONFLICT', 'INVALID_STATE', 'INVALID_ACTION']);

function canonicalPayload(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalPayload).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonicalPayload(object[key])).join(',') + '}';
}

function freshDraft(today: string): ActivityDraft {
  return { title: '', bankId: '', issuerIds: [], networks: [], cardKind: 'credit', cardDescription: '', frequency: 'once', startsOn: today, endsOn: '', target: 1, unit: '次', currency: 'CNY', rewardMinor: 0, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false, conditions: '', sourceUrl: '', sourceNote: '', entrance: { kind: 'guide', label: '参与入口', instructions: '', imageIds: [] } };
}
function draftFromLead(lead: ActivityLead): ActivityDraft {
  const draft = { ...freshDraft(''), ...lead.rules, title: lead.title, bankId: lead.bankId, sourceUrl: lead.sourceUrl, sourceNote: lead.sourceNote };
  draft.entrance = { kind: 'guide', label: '参与入口', instructions: '', imageIds: [], ...lead.rules?.entrance };
  return draft;
}
function isSavedLead(value: SavedLeadInput): boolean {
  const lead = value?.lead;
  return !!lead && ['title', 'bankId', 'sourceUrl', 'sourceNote'].every(field => typeof lead[field as keyof ActivityLead] === 'string')
    && Array.isArray(lead.imageIds) && lead.imageIds.length <= 6 && lead.imageIds.every(id => typeof id === 'string');
}
function isHttps(value: string): boolean {
  return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?#][^\s\u0000-\u001f]*)?$/i.test(value) && value.length <= 2048;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function amountMinor(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ''] = value.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
function isSavedInput(value: SavedSubmissionInput): boolean {
  const draft = value?.draft;
  return !!draft && ['title', 'bankId', 'cardDescription', 'startsOn', 'endsOn', 'conditions', 'sourceUrl', 'sourceNote'].every(field => typeof draft[field as keyof ActivityDraft] === 'string')
    && Array.isArray(draft.issuerIds) && Array.isArray(draft.networks) && !!draft.entrance && Array.isArray(draft.entrance.imageIds)
    && typeof draft.entrance.label === 'string' && typeof draft.entrance.instructions === 'string'
    && typeof value.targetText === 'string' && typeof value.rewardText === 'string' && typeof value.reviewNote === 'string'
    && (value.sourceImageIds === undefined || (Array.isArray(value.sourceImageIds) && value.sourceImageIds.every(id => typeof id === 'string')))
    && formSections.includes(value.openSection);
}
function imageErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    if ('errMsg' in error && typeof error.errMsg === 'string' && error.errMsg.trim()) return error.errMsg;
    if ('message' in error && typeof error.message === 'string' && error.message.trim()) return error.message;
  }
  return '图片未能添加，请检查照片权限和网络后重试。';
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
  pendingCreation: null as PendingSubmissionCreation | null,
  draftBaseVersion: null as number | null,
  data: {
    loading: true, ready: false, saving: false, submitted: false, openingSubmissions: false, pendingCreationUnconfirmed: false, uploading: false, reloading: false, loadingImages: false, conflict: false, error: '', denied: false, readOnly: false,
    reviewMode: false, submissionId: '', submission: null as Submission | null, today: '', leadReview: false, fromLead: false, importedLead: false,
    draft: freshDraft(''), targetText: '1', rewardText: '', reviewNote: '', sourceVerified: false,
    openSection: 'basic' as FormSection, errors: {} as FormErrors, dirty: false, draftEdited: false,
    errorSummary: [] as (FieldIssue & { label: string })[],
    ownerId: '', localDraftStatus: '', filledSections: 0,
    bankOptions: [{ id: '', name: '请选择银行' }, ...banks], bankIndex: 0,
    issuerOptions: [] as { id: string; name: string; checked: boolean }[],
    networkOptions: networks.map(item => ({ ...item, checked: false })),
    frequencies, frequencyIndex: 0, currencies, currencyIndex: 0, cardKinds, cardKindIndex: 0,
    rewardKinds, rewardKindIndex: 0, scopes, scopeIndex: 0, entranceKinds, entranceKindIndex: 0,
    unitOptions, unitIndex: 0, assets: [] as Asset[], assetUrls: [] as { id: string; url: string }[], imageRows: [] as { id: string; label: string; available: boolean; url: string }[],
    sourceImageIds: [] as string[], sourceImageRows: [] as { id: string; label: string; url: string; used: boolean }[],
    bankSummary: '选择银行与适用卡', ruleSummary: '填写周期、门槛和奖励', entranceSummary: '添加参与入口', sourceSummary: '添加可核实出处',
    rewardOptions, cycleOptions, weekdayOptions, intervalOptions, bankGrid: banks, selectedBank: null as typeof banks[number] | null,
    cycleType: '', cycleDay: 1, cycleWeekday: 1, cycleN: 1, cycleUnit: 'month', intervalLabel: '个月', cyclePreview: '', rewardUnit: '元', publishReady: false,
    viewerShow: false, viewerIndex: 0, viewerItems: [] as Record<string, unknown>[], originalBankName: '', originalBankLogo: '',
  },
  onLoad(options: { id?: string; review?: string; fromLead?: string }) {
    this.creationIntentKey = createCommandIntent();
    this.setData({ submissionId: options.id || '', reviewMode: options.review === '1', fromLead: options.fromLead === '1' });
    void this.load();
  },
  onHide() { this.previewSequence++; if (!this.disposed && !this.data.saving && !this.data.reloading) this.persistDraft(); },
  onUnload() { this.disposed = true; this.loadGeneration++; this.imageGeneration++; },
  async load() {
    if (this.disposed || this.data.submitted || this.data.saving || this.data.uploading || this.data.reloading) return;
    if (!this.creationIntentKey) this.creationIntentKey = createCommandIntent();
    const generation = ++this.loadGeneration;
    this.imageGeneration++;
    this.setData({ loading: true, ready: false, conflict: false, error: '', denied: false });
    try {
      const session = await ensureSession();
      if (this.disposed || generation !== this.loadGeneration) return;
      if (this.data.reviewMode && (!session.isModerator || !this.data.submissionId)) {
        this.setData({ denied: true }); return;
      }
      let submission: Submission | null = null;
      if (this.data.submissionId) {
        submission = await api.query('submission.get', { id: this.data.submissionId });
        if (this.disposed || generation !== this.loadGeneration) return;
        if (!submission.draft && submission.lead && !this.data.reviewMode) {
          wx.redirectTo({ url: `/pages/submission-lead/index?id=${encodeURIComponent(submission.id)}` }); return;
        }
      }
      this.applySubmission(submission, session.userId, session.today);
      const readOnly = this.data.readOnly;
      let recoveredFullDraft = false;
      if (!readOnly) {
        const saved = loadDraft<SavedSubmissionInput>(this.draftScope(), session.userId, this.draftEntityId());
        const savedRevision = getDraftRevision(this.draftScope(), session.userId, this.draftEntityId());
        if (saved?.value.pendingCreation !== undefined && !isSavedInput(saved.value)) {
          this.setData({ pendingCreationUnconfirmed: true, error: '上次提交的恢复信息不完整，已保留本机副本。请先到“我的投稿”核对，暂不能再次新建。' });
          return;
        }
        const recover = saved && isSavedInput(saved.value) && (saved.value.pendingCreation !== undefined || await confirmDraftRecovery(saved, this.draftBaseVersion));
        if (this.disposed || generation !== this.loadGeneration) return;
        if (saved && recover) {
          if (!this.data.submissionId && !this.data.reviewMode) this.creationIntentKey = typeof saved.value.intentKey === 'string' && saved.value.intentKey.length >= 1 && saved.value.intentKey.length <= 128 ? saved.value.intentKey : createCommandIntent();
          const pending = saved.value.pendingCreation;
          if (!this.data.submissionId && !this.data.reviewMode && pending !== undefined) {
            if (pending?.pending === true && typeof pending.intentKey === 'string' && pending.intentKey.length >= 1 && pending.intentKey.length <= 128 && isSavedInput({ ...saved.value, draft: pending.draft })) {
              this.pendingCreation = JSON.parse(JSON.stringify(pending)) as PendingSubmissionCreation;
              this.creationIntentKey = pending.intentKey;
            }
            this.setData({ pendingCreationUnconfirmed: true });
          }
          recoveredFullDraft = true;
          const stale = saved.baseVersion !== this.draftBaseVersion;
          this.draftBaseVersion = typeof saved.baseVersion === 'number' ? saved.baseVersion : null;
          this.setData({ draft: saved.value.draft, targetText: saved.value.targetText, rewardText: saved.value.rewardText, reviewNote: saved.value.reviewNote, openSection: saved.value.openSection, sourceImageIds: saved.value.sourceImageIds || this.data.sourceImageIds, importedLead: !!saved.value.importedLead, dirty: true, draftEdited: !!saved.value.draftEdited, conflict: stale, sourceVerified: false, localDraftStatus: '已恢复本机草稿，尚未提交', error: stale ? '草稿基于旧版本，暂不能提交。请先复制需要保留的内容，再读取最新稿件核对。' : '' });
          if (this.pendingCreation) this.persistDraft();
          wx.enableAlertBeforeUnload({ message: '草稿已保存在本机，尚未提交。' });
        } else if (saved) {
          if (!this.data.submissionId && !this.data.reviewMode) this.creationIntentKey = createCommandIntent();
          removeDraft(this.draftScope(), session.userId, this.draftEntityId(), savedRevision);
        }
      }
      if (!recoveredFullDraft && !readOnly && !this.data.submissionId && !this.data.reviewMode && this.data.fromLead) {
        const savedLead = loadDraft<SavedLeadInput>('submission-lead', session.userId, 'new');
        if (savedLead?.value.pendingCreation !== undefined) {
          this.setData({ ready: false, error: '这条线索的提交结果尚未确认，请返回线索页重试确认，或到“我的投稿”核对。' });
          return;
        }
        if (savedLead && isSavedLead(savedLead.value)) {
          const lead = savedLead.value.lead;
          this.setData({ draft: draftFromLead(lead), targetText: lead.rules?.target ? String(lead.rules.target) : '', rewardText: lead.rules?.rewardMinor ? String(lead.rules.rewardMinor / 100) : '', sourceImageIds: lead.imageIds.slice(), importedLead: true });
          this.markDirty();
        }
      }
      this.syncOptions();
      void this.loadImages();
    } catch (error) { if (!this.disposed && generation === this.loadGeneration) this.setData({ error: error instanceof Error ? error.message : '稿件暂时无法读取，请重试。' }); }
    finally { if (!this.disposed && generation === this.loadGeneration) this.setData({ loading: false }); }
  },
  applySubmission(submission: Submission | null, ownerId: string, today: string) {
    this.pendingCreation = null;
    this.setData({ pendingCreationUnconfirmed: false });
    const draft = submission?.draft ? JSON.parse(JSON.stringify(submission.draft)) as ActivityDraft : submission?.lead ? draftFromLead(submission.lead) : freshDraft(today);
    const readOnly = !!submission && (submission.status === 'published' || (this.data.reviewMode && submission.status !== 'pending'));
    const leadReview = !!submission?.lead && !submission.draft;
    this.draftBaseVersion = submission?.version ?? null;
    this.setData({ ready: true, ownerId, today, draft, submission, readOnly, leadReview, importedLead: false, sourceImageIds: submission?.lead?.imageIds || [], targetText: leadReview && !submission?.lead?.rules?.target ? '' : String(draft.target), rewardText: draft.rewardMinor ? String(draft.rewardMinor / 100) : '', reviewNote: submission?.reviewNote || '', dirty: false, draftEdited: false, sourceVerified: false, conflict: false, errors: {}, errorSummary: [], error: '', localDraftStatus: '', openSection: 'basic', assets: [], assetUrls: [], viewerShow: false });
    this.syncOptions();
    wx.setNavigationBarTitle({ title: this.data.reviewMode ? (readOnly ? '处理结果' : '核实活动') : (readOnly ? '投稿详情' : this.data.submissionId ? '修改投稿' : '分享活动') });
  },
  syncOptions() {
    const draft = this.data.draft;
    const selectedBank = banks.find(bank => bank.id === draft.bankId);
    const cycle = draft.cycle || (!this.data.leadReview ? activityCycle(draft) : undefined);
    this.setData({
      originalBankName: banks.find(bank => bank.id === (this.data.submission?.lead?.bankId || this.data.submission?.draft?.bankId))?.name || '',
      originalBankLogo: banks.find(bank => bank.id === (this.data.submission?.lead?.bankId || this.data.submission?.draft?.bankId))?.logo || '',
      selectedBank: selectedBank || null, cycleType: cycle?.t || '', cycleDay: cycle?.t === 'month' ? cycle.day : 1, cycleWeekday: cycle?.t === 'week' ? cycle.weekday : 1,
      cycleN: cycle?.t === 'custom' ? cycle.n : 1, cycleUnit: cycle?.t === 'custom' ? cycle.unit : 'month', intervalLabel: cycle?.t === 'custom' ? intervalOptions.find(unit => unit.id === cycle.unit)?.name || '个月' : '个月',
      cyclePreview: cyclePreview(cycle, this.data.today), rewardUnit: rewardUnit(draft), publishReady: Number(this.data.rewardText) > 0 && !!cycle,
      bankIndex: this.data.bankOptions.findIndex(item => item.id === draft.bankId),
      issuerOptions: issuers.filter(item => item.bankId === draft.bankId).map(item => ({ id: item.id, name: item.name, checked: draft.issuerIds.includes(item.id) })),
      networkOptions: networks.map(item => ({ ...item, checked: draft.networks.includes(item.id) })),
      frequencyIndex: frequencies.findIndex(item => item.id === draft.frequency),
      currencyIndex: currencies.findIndex(item => item.id === draft.currency),
      cardKindIndex: cardKinds.findIndex(item => item.id === draft.cardKind),
      rewardKindIndex: rewardKinds.findIndex(item => item.id === draft.rewardKind),
      scopeIndex: scopes.findIndex(item => item.id === draft.scope),
      entranceKindIndex: entranceKinds.findIndex(item => item.id === draft.entrance.kind),
      unitIndex: Math.max(0, unitOptions.indexOf(draft.unit)),
      imageRows: draft.entrance.imageIds.map((id, index) => ({ id, label: `入口图片 ${index + 1}`, available: this.data.assets.some(asset => asset.id === id), url: this.data.assetUrls.find(asset => asset.id === id)?.url || '' })),
      sourceImageRows: this.data.sourceImageIds.map((id, index) => ({ id, label: `原始来源图片 ${index + 1}`, url: this.data.assetUrls.find(asset => asset.id === id)?.url || '', used: draft.entrance.imageIds.includes(id) })),
      bankSummary: selectedBank ? `${selectedBank.name} · ${cardKinds.find(item => item.id === draft.cardKind)?.name || ''}` : '选择银行与适用卡',
      ruleSummary: draft.endsOn ? `${frequencies.find(item => item.id === draft.frequency)?.name || ''} · ${draft.endsOn} 结束` : '填写周期、门槛和奖励',
      entranceSummary: draft.entrance.imageIds.length ? `${entranceKinds.find(item => item.id === draft.entrance.kind)?.name || ''} · ${draft.entrance.imageIds.length} 张图片` : entranceKinds.find(item => item.id === draft.entrance.kind)?.name || '添加参与入口',
      sourceSummary: draft.sourceUrl || draft.sourceNote ? '已填写出处，发布前需核实' : '添加可核实出处',
      filledSections: [
        !!(draft.title.trim() && draft.bankId && draft.issuerIds.length && draft.cardDescription.trim() && draft.conditions.trim()),
        !!(draft.startsOn && draft.endsOn && Number(this.data.targetText) > 0 && Number(this.data.rewardText) > 0),
        !!(draft.entrance.kind === 'web' ? draft.entrance.url : draft.entrance.kind === 'miniprogram' ? draft.entrance.appId || draft.entrance.shortLink : draft.entrance.instructions.trim() || draft.entrance.imageIds.length),
        !!(draft.sourceUrl.trim() || draft.sourceNote.trim()),
      ].filter(Boolean).length,
    });
  },
  draftScope() { return this.data.reviewMode ? 'submission-review' : 'submission'; },
  draftEntityId() { return this.data.submissionId || 'new'; },
  canEdit(): boolean {
    return !this.disposed && this.data.ready && !this.data.readOnly && !this.data.saving && !this.data.submitted && !this.data.reloading && !this.data.denied && !this.data.pendingCreationUnconfirmed;
  },
  savedInput(): SavedSubmissionInput {
    return {
      draft: this.data.draft, targetText: this.data.targetText, rewardText: this.data.rewardText, reviewNote: this.data.reviewNote, openSection: this.data.openSection, draftEdited: this.data.draftEdited, sourceImageIds: this.data.sourceImageIds, importedLead: this.data.importedLead,
      ...(!this.data.submissionId && !this.data.reviewMode ? { intentKey: this.creationIntentKey } : {}),
      ...(this.pendingCreation && !this.data.submissionId && !this.data.reviewMode ? { pendingCreation: this.pendingCreation } : {}),
    };
  },
  persistDraft(): boolean {
    if (this.disposed || this.data.saving || this.data.reloading || !this.data.ready || !this.data.dirty || this.data.readOnly || this.data.denied || (this.data.pendingCreationUnconfirmed && !this.pendingCreation)) return false;
    const saved = saveDraft<SavedSubmissionInput>(this.draftScope(), this.data.ownerId, this.draftEntityId(), this.draftBaseVersion, this.savedInput());
    this.setData({ localDraftStatus: saved ? this.data.pendingCreationUnconfirmed ? '原提交与本机填写已保存，等待确认结果' : '本机草稿已保存，尚未提交' : '草稿未能保存在本机，请勿关闭页面' });
    return saved;
  },
  saveLocalDraft() {
    if (!this.canEdit() || this.data.uploading) return;
    this.setData({ dirty: true });
    const saved = this.persistDraft();
    wx.showToast({ title: saved ? '草稿已保存在本机' : '草稿保存失败，请重试', icon: 'none' });
  },
  markDirty(draftChanged = true) {
    if (!this.canEdit()) return;
    this.setData({ dirty: true, draftEdited: this.data.draftEdited || draftChanged, ...(draftChanged ? { sourceVerified: false } : {}) });
    this.syncOptions();
    const saved = this.persistDraft();
    wx.enableAlertBeforeUnload({ message: saved ? '草稿已保存在本机，尚未提交。' : '草稿未能保存在本机，离开可能丢失。' });
  },
  navigationScrollOffset(): number {
    const capsule = wx.getMenuButtonBoundingClientRect?.();
    const info = wx.getWindowInfo?.();
    const top = capsule?.top ? capsule.top - Math.max(0, (44 - capsule.height) / 2) : info?.statusBarHeight || 54;
    return -(top + 56);
  },
  toggleSection(event: { currentTarget: { dataset: { section: FormSection } } }) {
    const section = event.currentTarget.dataset.section;
    if (!formSections.includes(section)) return;
    if (section !== this.data.openSection) this.previewSequence++;
    this.setData({ openSection: section }, () => { wx.pageScrollTo({ selector: `#section-${section}`, offsetTop: this.navigationScrollOffset(), duration: 180 }); });
  },
  input(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    const value = field === 'rewardText' ? cleanRewardInput(String(event.detail.value), this.data.draft.rewardKind === 'points') : String(event.detail.value);
    const allowed = ['title', 'cardDescription', 'conditions', 'sourceUrl', 'sourceNote', 'entrance.label', 'entrance.url', 'entrance.appId', 'entrance.path', 'entrance.shortLink', 'entrance.instructions'];
    if (['targetText', 'rewardText', 'reviewNote'].includes(field)) this.setData({ [field]: value });
    else if (allowed.includes(field)) this.setData({ [`draft.${field}`]: value });
    else return;
    this.setData({ [`errors.${field}`]: '', error: '' });
    this.syncErrorSummary();
    this.markDirty(field !== 'reviewNote');
  },
  select(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    const index = Number(event.detail.value);
    const lists: Record<string, Option[]> = { bankId: this.data.bankOptions, frequency: frequencies, currency: currencies, cardKind: cardKinds, rewardKind: rewardKinds, scope: scopes, 'entrance.kind': entranceKinds };
    if (field === 'unit') {
      if (!unitOptions[index]) return;
      this.setData({ 'draft.unit': unitOptions[index] });
    } else {
      const option = lists[field]?.[index];
      if (!option) return;
      this.setData({ [`draft.${field}`]: option.id });
      if (field === 'bankId') {
        const bankIssuers = issuers.filter(item => item.bankId === option.id);
        this.setData({ 'draft.issuerIds': bankIssuers.length === 1 ? [bankIssuers[0].id] : [], 'errors.issuerIds': '' });
      }
      if (field === 'entrance.kind') {
        this.setData({
          ...(option.id !== 'web' ? { 'errors.entrance.url': '' } : {}),
          ...(option.id !== 'miniprogram' ? { 'errors.entrance.appId': '', 'errors.entrance.path': '', 'errors.entrance.shortLink': '' } : {}),
          ...(option.id !== 'guide' ? { 'errors.entrance.instructions': '' } : {}),
        });
      }
    }
    this.setData({ [`errors.${field}`]: '', error: '' });
    this.syncErrorSummary();
    this.markDirty();
  },
  selectDate(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    if (!['startsOn', 'endsOn'].includes(field)) return;
    const value = String(event.detail.value);
    if (field === 'endsOn' && this.data.draft.startsOn && value < this.data.draft.startsOn) { wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' }); return; }
    this.setData({ [`draft.${field}`]: value, [`errors.${field}`]: '' });
    if (field === 'startsOn' && this.data.draft.endsOn && value > this.data.draft.endsOn) this.setData({ 'draft.endsOn': '' });
    if (this.data.draft.cycle?.t === 'once') this.setData({ 'draft.cycle.start': this.data.draft.startsOn, 'draft.cycle.end': this.data.draft.endsOn });
    if (this.data.draft.cycle?.t === 'custom') this.setData({ 'draft.cycle.anchor': this.data.draft.startsOn });
    this.syncErrorSummary();
    this.markDirty();
  },
  selectBankGrid(event: { currentTarget: { dataset: { id: string } } }) {
    const index = this.data.bankOptions.findIndex(bank => bank.id === event.currentTarget.dataset.id);
    if (index > 0) this.select({ currentTarget: { dataset: { field: 'bankId' } }, detail: { value: String(index) } });
  },
  selectReward(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit()) return;
    const kind = event.currentTarget.dataset.id;
    if (!rewardOptions.some(item => item.id === kind)) return;
    this.setData({ 'draft.rewardKind': kind, rewardText: cleanRewardInput(this.data.rewardText, kind === 'points'), 'errors.rewardKind': '', 'errors.rewardText': '' });
    this.syncErrorSummary(); this.markDirty();
  },
  selectCycle(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit()) return;
    const type = event.currentTarget.dataset.id;
    if (!cycleOptions.some(item => item.id === type)) return;
    this.setData({ 'draft.cycle': defaultCycle(type, this.data.draft.startsOn, this.data.draft.endsOn), 'draft.frequency': type === 'once' ? 'once' : 'monthly', 'errors.frequency': '' });
    this.syncErrorSummary(); this.markDirty();
  },
  selectWeekday(event: { currentTarget: { dataset: { id: number } } }) {
    if (!this.canEdit() || this.data.draft.cycle?.t !== 'week') return;
    const weekday = Number(event.currentTarget.dataset.id);
    if (!weekdayOptions.some(item => item.id === weekday)) return;
    this.setData({ 'draft.cycle.weekday': weekday }); this.markDirty();
  },
  stepCycle(event: { currentTarget: { dataset: { delta: number } } }) {
    if (!this.canEdit()) return;
    const cycle = this.data.draft.cycle;
    const delta = Number(event.currentTarget.dataset.delta);
    if (cycle?.t === 'month') this.setData({ 'draft.cycle.day': Math.max(1, Math.min(28, cycle.day + delta)) });
    else if (cycle?.t === 'custom') this.setData({ 'draft.cycle.n': Math.max(1, Math.min(cycle.unit === 'day' ? 90 : 12, cycle.n + delta)) });
    else return;
    this.markDirty();
  },
  selectInterval(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit() || this.data.draft.cycle?.t !== 'custom') return;
    const unit = event.currentTarget.dataset.id;
    if (!intervalOptions.some(item => item.id === unit)) return;
    this.setData({ 'draft.cycle.unit': unit, 'draft.cycle.n': Math.min(unit === 'day' ? 90 : 12, this.data.draft.cycle.n) }); this.markDirty();
  },
  selectIssuers(event: InputEvent) {
    if (!this.canEdit()) return;
    this.setData({ 'draft.issuerIds': event.detail.value, 'errors.issuerIds': '' });
    this.syncErrorSummary();
    this.markDirty();
  },
  selectNetworks(event: InputEvent) {
    if (!this.canEdit()) return;
    this.setData({ 'draft.networks': event.detail.value, 'errors.networks': '' });
    this.syncErrorSummary();
    this.markDirty();
  },
  toggle(event: InputEvent) {
    if (!this.canEdit()) return;
    const field = event.currentTarget.dataset.field;
    if (field === 'sourceVerified') {
      this.setData({ sourceVerified: Boolean(event.detail.value), 'errors.sourceVerified': '' }); this.syncErrorSummary(); return;
    }
    if (!['requiresRegistration', 'requiresInvitation'].includes(field)) return;
    this.setData({ [`draft.${field}`]: Boolean(event.detail.value) });
    this.markDirty();
  },
  async addImage() {
    if (!this.canEdit() || this.data.uploading) return;
    if (this.data.draft.entrance.imageIds.length >= 6) { wx.showToast({ title: '最多添加 6 张图片', icon: 'none' }); return; }
    this.setData({ uploading: true });
    try {
      const asset = await uploadImage();
      if (this.disposed) return;
      this.setData({ assets: [...this.data.assets, asset], 'draft.entrance.imageIds': [...this.data.draft.entrance.imageIds, asset.id] });
      this.invalidateImageMembership();
      this.markDirty();
      await this.loadImages();
    } catch (error) {
      const message = imageErrorMessage(error);
      if (!this.disposed && !/cancel|取消/i.test(message)) { this.setData({ 'errors.imageIds': uploadFailureText(message) }); this.syncErrorSummary(); }
    } finally { if (!this.disposed) this.setData({ uploading: false }); }
  },
  removeImage(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit() || this.data.uploading) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.draft.entrance.imageIds.includes(id)) return;
    const wasLoading = this.data.loadingImages;
    this.setData({ 'draft.entrance.imageIds': this.data.draft.entrance.imageIds.filter(imageId => imageId !== id) });
    this.invalidateImageMembership();
    this.markDirty();
    if (wasLoading) void this.loadImages();
  },
  useSourceImage(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.canEdit() || this.data.uploading) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.sourceImageIds.includes(id) || this.data.draft.entrance.imageIds.includes(id)) return;
    if (this.data.draft.entrance.imageIds.length >= 6) { wx.showToast({ title: '参与入口最多添加 6 张图片', icon: 'none' }); return; }
    const wasLoading = this.data.loadingImages;
    this.setData({ 'draft.entrance.imageIds': [...this.data.draft.entrance.imageIds, id] });
    this.invalidateImageMembership();
    this.markDirty();
    if (wasLoading) void this.loadImages();
  },
  currentImageIds(): string[] {
    return Array.from(new Set([...this.data.draft.entrance.imageIds, ...this.data.sourceImageIds]));
  },
  invalidateImageMembership() {
    this.imageGeneration++;
    const ids = new Set(this.currentImageIds());
    this.setData({ assets: this.data.assets.filter(asset => ids.has(asset.id)), assetUrls: this.data.assetUrls.filter(asset => ids.has(asset.id)), loadingImages: false, viewerShow: false });
  },
  async loadImages() {
    if (this.disposed) return;
    const generation = ++this.imageGeneration;
    const ids = this.currentImageIds();
    if (!ids.length) { this.setData({ assets: [], assetUrls: [], loadingImages: false }); this.syncOptions(); return; }
    this.setData({ loadingImages: true });
    try {
      const [assets, assetUrls] = await Promise.all([api.query('assets.get', { ids }), api.query('assets.urls', { ids })]);
      if (this.disposed || generation !== this.imageGeneration) return;
      const currentIds = new Set(this.currentImageIds());
      const requestedIds = new Set(ids);
      this.setData({ assets: assets.filter(asset => currentIds.has(asset.id) && requestedIds.has(asset.id)), assetUrls: assetUrls.filter(asset => currentIds.has(asset.id) && requestedIds.has(asset.id)), 'errors.imageIds': '' });
      this.syncErrorSummary();
      this.syncOptions();
    } catch (error) { if (!this.disposed && generation === this.imageGeneration) { this.setData({ 'errors.imageIds': error instanceof Error ? error.message : '图片暂时无法读取，点击图片可重试。' }); this.syncErrorSummary(); } }
    finally { if (!this.disposed && generation === this.imageGeneration) this.setData({ loadingImages: false }); }
  },
  async previewImage(event: { currentTarget: { dataset: { id: string; scope?: string } } }) {
    if (this.disposed || this.data.loadingImages) return;
    const generation = this.loadGeneration;
    const id = event.currentTarget.dataset.id;
    const source = event.currentTarget.dataset.scope === 'source';
    const section: FormSection = source ? 'source' : 'entrance';
    if (this.data.openSection !== section) return;
    if (!(source ? this.data.sourceImageIds : this.data.draft.entrance.imageIds).includes(id)) return;
    const previewSequence = ++this.previewSequence;
    if (!this.data.assets.some(asset => asset.id === id)) await this.loadImages();
    if (this.disposed || generation !== this.loadGeneration) return;
    const ids = source ? this.data.sourceImageIds : this.data.draft.entrance.imageIds;
    if (!ids.includes(id)) return;
    const assets = ids.map(imageId => this.data.assets.find(asset => asset.id === imageId)).filter((asset): asset is Asset => !!asset);
    const index = assets.findIndex(asset => asset.id === id);
    if (index < 0) { this.setData({ 'errors.imageIds': '这张图片暂时无法查看，请重新读取后重试。' }); this.syncErrorSummary(); return; }
    const galleryIds = ids.slice();
    const shouldOpen = () => {
      const pages = getCurrentPages();
      const currentIds = source ? this.data.sourceImageIds : this.data.draft.entrance.imageIds;
      return !this.disposed && generation === this.loadGeneration && previewSequence === this.previewSequence && pages[pages.length - 1] === this && this.data.openSection === section
        && galleryIds.length === currentIds.length && galleryIds.every((imageId, position) => imageId === currentIds[position]);
    };
    try { await previewAssets(assets, index, shouldOpen); }
    catch (error) { if (shouldOpen()) { this.setData({ 'errors.imageIds': error instanceof Error ? error.message : '图片暂时无法打开，请重试。' }); this.syncErrorSummary(); } }
  },
  async openShot(event: { currentTarget: { dataset: { id: string; scope?: string } } }) {
    if (this.disposed || this.data.loadingImages) return;
    const id = event.currentTarget.dataset.id;
    const source = event.currentTarget.dataset.scope === 'source';
    const ids = (source ? this.data.sourceImageIds : this.data.draft.entrance.imageIds).slice();
    if (!ids.includes(id)) return;
    const generation = this.loadGeneration;
    const sequence = ++this.previewSequence;
    if (!this.data.assetUrls.some(asset => asset.id === id)) await this.loadImages();
    const currentIds = source ? this.data.sourceImageIds : this.data.draft.entrance.imageIds;
    if (this.disposed || generation !== this.loadGeneration || sequence !== this.previewSequence || ids.length !== currentIds.length || !ids.every((imageId, index) => imageId === currentIds[index])) return;
    const items = ids.map((imageId, index) => ({ id: imageId, url: this.data.assetUrls.find(asset => asset.id === imageId)?.url || '', label: source ? `活动规则 ${index + 1}` : `报名入口 ${index + 1}`, uploader: source ? '投稿人' : '本人', uploadedOn: this.data.submission?.createdAt.slice(0, 10) || this.data.today }));
    if (!items.find(item => item.id === id)?.url) { this.setData({ 'errors.imageIds': '这张图片暂时无法查看，请重新读取后重试。' }); this.syncErrorSummary(); return; }
    this.setData({ viewerShow: true, viewerIndex: items.findIndex(item => item.id === id), viewerItems: items });
  },
  closeViewer() { this.setData({ viewerShow: false }); },
  copyViewerSource(event: { detail: { id?: string; url?: string } }) {
    const item = this.data.viewerItems.find(image => image.id === event.detail.id) || this.data.viewerItems[this.data.viewerIndex];
    if (item && typeof item.url === 'string' && item.url) wx.setClipboardData({ data: item.url });
  },
  copySource(event?: { currentTarget: { dataset: { scope?: string } } }) {
    const source = event?.currentTarget.dataset.scope === 'original' ? this.data.submission?.lead || this.data.submission?.draft || this.data.draft : this.data.draft;
    const value = [source.sourceUrl, source.sourceNote].filter(Boolean).join('\n');
    if (value) wx.setClipboardData({ data: value });
  },
  syncErrorSummary() {
    const issues = Object.entries(fieldSections).flatMap(([field, section]) => {
      if (this.visibleErrorField(field) !== field) return [];
      const [group, name] = field.split('.');
      const value = name ? (this.data.errors[group] as Record<string, string> | undefined)?.[name] : this.data.errors[group];
      return typeof value === 'string' && value ? [{ field, section, label: fieldLabels[field] || field, message: value }] : [];
    });
    this.setData({ errorSummary: issues });
  },
  visibleErrorField(field: string): string {
    if (field === 'issuerIds' && !this.data.issuerOptions.length) return 'bankId';
    if (field === 'entrance.url' && this.data.draft.entrance.kind !== 'web') return 'entrance.kind';
    if (['entrance.appId', 'entrance.path', 'entrance.shortLink'].includes(field) && this.data.draft.entrance.kind !== 'miniprogram') return 'entrance.kind';
    if (['sourceVerified', 'reviewNote'].includes(field) && (!this.data.reviewMode || this.data.readOnly)) return 'sourceNote';
    return field;
  },
  goToError(event: { currentTarget: { dataset: { field: string } } }) {
    const field = this.visibleErrorField(event.currentTarget.dataset.field);
    const section = fieldSections[field];
    if (!section) return;
    if (section !== this.data.openSection) this.previewSequence++;
    this.setData({ openSection: section }, () => {
      if (!this.disposed) wx.pageScrollTo({ selector: `#field-${field.replace(/\./g, '-')}`, offsetTop: this.navigationScrollOffset(), duration: 180 });
    });
  },
  reject(field: string, message: string, section: FormSection): false {
    const requestedField = field;
    field = this.visibleErrorField(field);
    if (requestedField === 'issuerIds' && field === 'bankId') message = '请先选择活动所属银行，再选择适用发卡机构。';
    if (requestedField !== field && field === 'entrance.kind') message = '请先确认入口形式，再填写对应的参与地址。';
    section = fieldSections[field] || section;
    if (section !== this.data.openSection) this.previewSequence++;
    this.setData({ [`errors.${field}`]: message, openSection: section, error: '请检查标出的内容，填写后重新提交。' }, () => {
      wx.pageScrollTo({ selector: fieldSections[field] ? `#field-${field.replace(/\./g, '-')}` : `#section-${section}`, offsetTop: this.navigationScrollOffset(), duration: 180 });
    });
    this.syncErrorSummary();
    return false;
  },
  commandDraft(): ActivityDraft {
    const draft = JSON.parse(JSON.stringify(this.data.draft)) as ActivityDraft;
    for (const field of ['title', 'cardDescription', 'conditions', 'sourceUrl', 'sourceNote'] as const) draft[field] = draft[field].trim();
    draft.entrance.label = draft.entrance.label.trim() || '参与入口';
    draft.entrance.instructions = draft.entrance.instructions.trim();
    draft.entrance.url = (draft.entrance.url || '').trim();
    draft.entrance.appId = (draft.entrance.appId || '').trim();
    draft.entrance.path = (draft.entrance.path || '').trim();
    draft.entrance.shortLink = (draft.entrance.shortLink || '').trim();
    draft.target = Number(this.data.targetText.trim());
    draft.rewardMinor = amountMinor(this.data.rewardText.trim()) ?? 0;
    if (draft.entrance.kind !== 'web') delete draft.entrance.url;
    if (draft.entrance.kind !== 'miniprogram') { delete draft.entrance.appId; delete draft.entrance.path; delete draft.entrance.shortLink; }
    if (draft.entrance.shortLink) { delete draft.entrance.appId; delete draft.entrance.path; }
    return draft;
  },
  validate(): ActivityDraft | false {
    const draft = this.commandDraft();
    const issues: FieldIssue[] = [];
    const issue = (field: string, message: string, section: FormSection) => { issues.push({ field, message, section }); };
    if (!draft.title || draft.title.length > 60) issue('title', '请填写 60 字以内的活动标题。', 'basic');
    const validBank = banks.some(item => item.id === draft.bankId);
    if (!validBank) issue('bankId', '请选择活动所属银行。', 'basic');
    const availableIssuers = issuers.filter(item => item.bankId === draft.bankId).map(item => item.id);
    if (validBank && (!draft.issuerIds.length || draft.issuerIds.some(id => !availableIssuers.includes(id)))) issue('issuerIds', '请选择活动适用的发卡机构。', 'basic');
    if (!draft.cardDescription) issue('cardDescription', '请写明适用卡片，例如指定 Visa 信用卡。', 'basic');
    if (!draft.conditions || draft.conditions.length > 2000) issue('conditions', '请填写参与条件，最多 2000 字。', 'basic');
    if (!validDate(draft.startsOn)) issue('startsOn', '请选择有效的开始日期。', 'rules');
    if (!validDate(draft.endsOn) || draft.endsOn < draft.startsOn) issue('endsOn', '结束日期不能早于开始日期。', 'rules');
    const target = this.data.targetText.trim();
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(target) || Number(target) <= 0) issue('targetText', '请填写大于 0 的累计门槛，最多两位小数。', 'rules');
    else if (['次', '笔'].includes(draft.unit) && !Number.isInteger(Number(target))) issue('targetText', '次数和笔数需要填写正整数。', 'rules');
    draft.target = Number(target);
    const reward = amountMinor(this.data.rewardText.trim());
    if (reward === null || reward <= 0 || this.data.rewardText.trim().length > 9) issue('rewardText', '请填写大于 0 的奖励数值，最多两位小数、9 位字符。', 'rules');
    else if (draft.rewardKind === 'points' && reward % 100 !== 0) issue('rewardText', '积分需要填写大于 0 的整数。', 'rules');
    else draft.rewardMinor = reward;
    if (draft.cycle?.t === 'once') draft.cycle = { t: 'once', start: draft.startsOn, end: draft.endsOn };
    if (draft.cycle?.t === 'custom') draft.cycle.anchor = draft.startsOn;
    if (draft.entrance.kind === 'web' && !isHttps(draft.entrance.url || '')) issue('entrance.url', '请填写完整的 HTTPS 活动入口链接。', 'entrance');
    if (draft.entrance.kind === 'miniprogram') {
      if (!draft.entrance.shortLink && !/^wx[a-f0-9]{16}$/i.test(draft.entrance.appId || '')) issue('entrance.appId', '请填写有效的小程序 AppID，或填写小程序短链接。', 'entrance');
      if (draft.entrance.shortLink && !/^#小程序:\/\/[^/\r\n\t]{1,100}\/[A-Za-z0-9_-]{1,256}$/.test(draft.entrance.shortLink)) issue('entrance.shortLink', '请粘贴微信生成的完整小程序短链接。', 'entrance');
    }
    if (draft.entrance.kind === 'guide' && !draft.entrance.instructions && !draft.entrance.imageIds.length) issue('entrance.instructions', '请补充操作路径或入口图片，让用户知道如何参加。', 'entrance');
    if (draft.sourceUrl && !isHttps(draft.sourceUrl)) issue('sourceUrl', '来源链接需要是完整的 HTTPS 地址。', 'source');
    if (!draft.sourceUrl && !draft.sourceNote) issue('sourceNote', '请提供官方来源链接，或可核实的银行 App 路径。', 'source');
    if (this.data.reviewMode && !this.data.sourceVerified) issue('sourceVerified', '发布前请先核对规则来源和参与入口。', 'source');
    if (draft.entrance.kind !== 'web') delete draft.entrance.url;
    if (draft.entrance.kind !== 'miniprogram') { delete draft.entrance.appId; delete draft.entrance.path; delete draft.entrance.shortLink; }
    if (draft.entrance.shortLink) { delete draft.entrance.appId; delete draft.entrance.path; }
    if (validDate(draft.endsOn) && draft.endsOn >= draft.startsOn && draft.endsOn < this.data.today && !this.retryingCreation(draft)) issue('endsOn', '已结束的活动无法提交，请核实活动日期。', 'rules');
    if (issues.length) {
      const errors: FormErrors = {};
      for (const item of issues) {
        const [group, name] = item.field.split('.');
        if (name) {
          const groupErrors = typeof errors[group] === 'object' ? errors[group] as Record<string, string> : {};
          groupErrors[name] = item.message;
          errors[group] = groupErrors;
        } else errors[group] = item.message;
      }
      this.setData({ errors });
      if (issues.length > 1) {
        this.syncErrorSummary();
        this.setData({ error: '请检查以下内容，点击提示可前往对应位置。' }, () => {
          if (!this.disposed) wx.pageScrollTo({ selector: '#validation-summary', offsetTop: this.navigationScrollOffset(), duration: 180 });
        });
        return false;
      }
      return this.reject(issues[0].field, issues[0].message, issues[0].section);
    }
    this.setData({ errors: {}, errorSummary: [] });
    return draft;
  },
  retryingCreation(draft: ActivityDraft): boolean {
    return !this.data.submissionId && !this.data.reviewMode && this.pendingCreation?.pending === true
      && this.pendingCreation.intentKey === this.creationIntentKey && canonicalPayload(this.pendingCreation.draft) === canonicalPayload(draft);
  },
  creationInputSnapshot(): CreationInputSnapshot {
    return JSON.parse(JSON.stringify({ draft: this.data.draft, targetText: this.data.targetText, rewardText: this.data.rewardText, sourceImageIds: this.data.sourceImageIds })) as CreationInputSnapshot;
  },
  hasRetainedCreationInput(): boolean {
    const pending = this.pendingCreation;
    if (!pending) return false;
    if (pending.inputSnapshot) return canonicalPayload(this.creationInputSnapshot()) !== canonicalPayload(pending.inputSnapshot);
    // Older drafts have no original form snapshot, so preserve any raw difference conservatively.
    return canonicalPayload(this.data.draft) !== canonicalPayload(pending.draft)
      || Number(this.data.targetText) !== pending.draft.target || amountMinor(this.data.rewardText.trim()) !== pending.draft.rewardMinor;
  },
  clearRejectedCreation(context: { ownerId: string; intentKey: string; revision: string | null; draft: ActivityDraft }) {
    const matches = (pending: PendingSubmissionCreation | undefined | null) => pending?.pending === true && pending.intentKey === context.intentKey && canonicalPayload(pending.draft) === canonicalPayload(context.draft);
    if (getDraftRevision('submission', context.ownerId, 'new') === context.revision) {
      const saved = loadDraft<SavedSubmissionInput>('submission', context.ownerId, 'new');
      if (saved && matches(saved.value.pendingCreation)) {
        const { pendingCreation, ...value } = saved.value;
        saveDraft('submission', context.ownerId, 'new', saved.baseVersion, value);
      }
    }
    if (!this.disposed && matches(this.pendingCreation)) {
      this.pendingCreation = null;
      this.setData({ pendingCreationUnconfirmed: false });
    }
  },
  async save() {
    if (this.disposed || !this.data.ready || this.data.readOnly || this.data.saving || this.data.submitted || this.data.reloading || this.data.uploading || this.data.denied || this.data.conflict) return;
    if (this.data.pendingCreationUnconfirmed && !this.pendingCreation) { this.setData({ error: '上次提交的恢复信息不完整，已保留本机副本。请先到“我的投稿”核对，暂不能再次新建。' }); return; }
    this.setData({ error: '' });
    const draft = this.pendingCreation ? JSON.parse(JSON.stringify(this.pendingCreation.draft)) as ActivityDraft : this.validate();
    if (!draft) return;
    const creating = !this.data.submissionId && !this.data.reviewMode;
    if (creating) {
      const previousPending = this.pendingCreation;
      this.pendingCreation = previousPending || { pending: true, intentKey: this.creationIntentKey, draft: JSON.parse(JSON.stringify(draft)) as ActivityDraft, inputSnapshot: this.creationInputSnapshot() };
      this.creationIntentKey = this.pendingCreation.intentKey;
      this.setData({ dirty: true, pendingCreationUnconfirmed: true });
      if (!this.persistDraft()) {
        this.pendingCreation = previousPending;
        this.setData({ pendingCreationUnconfirmed: !!previousPending, error: '提交恢复信息未能保存在本机，请重试保存草稿后再提交。' });
        return;
      }
    }
    const draftRevision = getDraftRevision(this.draftScope(), this.data.ownerId, this.draftEntityId());
    const creationContext = { ownerId: this.data.ownerId, intentKey: this.creationIntentKey, revision: draftRevision, draft };
    const generation = this.loadGeneration;
    const retainedInput = creating && this.hasRetainedCreationInput() ? JSON.parse(JSON.stringify(this.savedInput())) as SavedSubmissionInput : null;
    let creationConfirmed = false;
    this.setData({ saving: true });
    try {
      if (this.data.reviewMode) {
        await api.command('submission.review', { id: this.data.submissionId, decision: 'publish', draft, sourceVerified: true, expectedVersion: this.data.submission?.version });
      } else {
        const payload = { ...(this.data.submissionId ? { id: this.data.submissionId, expectedVersion: this.data.submission?.version } : {}), draft };
        if (this.data.submissionId) await api.command('submission.save', payload);
        else {
          const result = await api.command('submission.save', payload, { intentKey: creationContext.intentKey });
          if (!result || typeof result.id !== 'string' || !result.id) throw Object.assign(new Error('提交结果暂时无法确认，请重试确认原提交。'), { code: 'INVALID_RESPONSE' });
          creationConfirmed = true;
          if (retainedInput) {
            await this.retainCreatedDraft(result, retainedInput, creationContext, generation);
            return;
          }
        }
      }
      this.finish(this.data.reviewMode ? '活动已发布' : '已提交审核', draftRevision);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      if (creating && !creationConfirmed && rejectedCreationCodes.has(code)) this.clearRejectedCreation(creationContext);
      this.showFailure(error, '提交未成功，你的填写内容已保留。');
    }
    finally { if (!this.disposed && !this.data.submitted) this.setData({ saving: false }); }
  },
  async retainCreatedDraft(result: MutationResult, input: SavedSubmissionInput, context: { ownerId: string; revision: string | null; draft: ActivityDraft }, generation: number) {
    if (this.disposed || generation !== this.loadGeneration || this.data.ownerId !== context.ownerId) return;
    const session = await ensureSession(true);
    if (this.disposed || generation !== this.loadGeneration || this.data.ownerId !== context.ownerId) return;
    if (session.userId !== context.ownerId) throw new Error('当前账号已变化，本机修改仍保留。请使用原账号到“我的投稿”核对。');
    const submission = await api.query('submission.get', { id: result.id });
    if (this.disposed || generation !== this.loadGeneration || this.data.ownerId !== context.ownerId) return;
    if (submission.id !== result.id || submission.ownerId !== context.ownerId || !Number.isInteger(submission.version) || submission.version < 1) throw new Error('无法核对已创建稿件，本机修改仍保留，请到“我的投稿”核对后重试。');
    if (getDraftRevision('submission', context.ownerId, 'new') !== context.revision) throw new Error('另一处本机草稿已有更新，已保留两个页面的内容，请到“我的投稿”核对。');
    const { pendingCreation, intentKey, ...value } = input;
    const current = loadDraft<SavedSubmissionInput>('submission', context.ownerId, result.id);
    if (current && canonicalPayload(current.value) !== canonicalPayload(value)) throw new Error('这份投稿另有本机修改，两份副本均已保留，请到“我的投稿”核对。');
    const originalVersion = Number.isInteger(result.version) && result.version! > 0 ? result.version! : canonicalPayload(submission.draft) === canonicalPayload(context.draft) ? submission.version : null;
    if (!saveDraft('submission', context.ownerId, result.id, originalVersion, value)) throw new Error('投稿已确认，但本机修改暂时无法保存到该稿件。原副本仍保留，请重试确认。');
    removeDraft('submission', context.ownerId, 'new', context.revision);
    this.pendingCreation = null;
    this.draftBaseVersion = originalVersion;
    const conflict = originalVersion !== submission.version;
    this.setData({ submissionId: result.id, submission, pendingCreationUnconfirmed: false, importedLead: false, conflict, readOnly: submission.status === 'published', dirty: true, error: conflict ? '投稿已确认，但服务器内容已有更新。你的本机修改仍保留，请复制需要的内容后读取最新稿件核对。' : '', localDraftStatus: '上次投稿已确认；后来填写的修改仍是本机草稿，请核对后更新这份投稿。' });
    wx.setNavigationBarTitle({ title: '修改投稿' });
    wx.enableAlertBeforeUnload({ message: '后续修改已保存在这份投稿的本机草稿中，尚未提交。' });
  },
  async returnSubmission() {
    if (this.disposed || !this.data.ready || !this.data.reviewMode || this.data.readOnly || this.data.saving || this.data.reloading || this.data.uploading || this.data.denied || this.data.conflict) return;
    const reviewNote = this.data.reviewNote.trim();
    if (!reviewNote || reviewNote.length > 600) { this.reject('reviewNote', '请写明需要投稿人补充的内容，最多 600 字。', 'source'); return; }
    this.setData({ saving: true, error: '' });
    try {
      if (this.data.draftEdited) {
        const result = await wx.showModal({ title: '只退回补充意见？', content: '退回只发送退回原因。你对活动标题、规则或入口的修改不会保存；取消后可继续编辑并审核发布。', confirmText: '仅退回意见', cancelText: '继续编辑' });
        if (this.disposed || !result.confirm) return;
      }
      const draftRevision = getDraftRevision(this.draftScope(), this.data.ownerId, this.draftEntityId());
      await api.command('submission.review', { id: this.data.submissionId, decision: 'return', reviewNote, expectedVersion: this.data.submission?.version });
      this.finish('已退回补充', draftRevision);
    } catch (error) { this.showFailure(error, '退回未成功，请重试。'); }
    finally { if (!this.disposed && !this.data.submitted) this.setData({ saving: false }); }
  },
  showFailure(error: unknown, fallback: string) {
    if (this.disposed) return;
    const message = error instanceof Error ? error.message : fallback;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (this.data.submissionId && (code === 'VERSION_CONFLICT' || code === 'IMMUTABLE' || code === 'INVALID_STATE')) { this.setData({ conflict: true, error: '稿件已被更新或处理。本次填写仍保留在页面中，请读取最新版本后再处理。' }); return; }
    const field = error && typeof error === 'object' && 'field' in error && typeof error.field === 'string' ? error.field.replace(/^draft\./, '') : '';
    if (!field) { this.setData({ error: message }); return; }
    const name = field === 'target' ? 'targetText' : field === 'rewardMinor' ? 'rewardText' : field === 'entrance.imageIds' ? 'imageIds' : field.startsWith('cycle') ? 'frequency' : field;
    const section: FormSection = field.startsWith('entrance') ? 'entrance' : ['sourceUrl', 'sourceNote', 'sourceVerified', 'reviewNote'].includes(field) ? 'source' : field.startsWith('cycle') || ['target', 'rewardMinor', 'startsOn', 'endsOn', 'frequency', 'unit', 'currency', 'scope', 'rewardKind'].includes(field) ? 'rules' : 'basic';
    this.reject(name, message, section);
  },
  async reloadLatest() {
    if (this.disposed || this.data.saving || this.data.uploading || this.data.reloading || !this.data.submissionId) return;
    const generation = this.loadGeneration;
    const context = { scope: this.draftScope(), ownerId: this.data.ownerId, entityId: this.draftEntityId(), revision: getDraftRevision(this.draftScope(), this.data.ownerId, this.draftEntityId()) };
    this.setData({ reloading: true });
    try {
      const result = await wx.showModal({ title: '读取最新稿件？', content: '成功读取后，当前未提交的修改会被最新稿件替换。你可以先取消，复制需要保留的内容。读取失败时会保留当前填写与本机草稿。', confirmText: '读取最新', cancelText: '继续查看' });
      if (this.disposed || generation !== this.loadGeneration || !result.confirm) return;
      const session = await ensureSession();
      if (this.disposed || generation !== this.loadGeneration) return;
      if (session.userId !== context.ownerId || (this.data.reviewMode && !session.isModerator)) throw new Error('当前账号无法继续处理这份稿件，请返回列表重新进入。');
      const submission = await api.query('submission.get', { id: context.entityId });
      if (this.disposed || generation !== this.loadGeneration) return;
      if (submission.id !== context.entityId || (!this.data.reviewMode && submission.ownerId !== context.ownerId)) throw new Error('无法读取这份稿件，请返回投稿列表查看。');
      if (!submission.draft && submission.lead && !this.data.reviewMode) throw new Error('这份稿件目前是活动线索，请返回投稿列表查看。');
      this.imageGeneration++;
      this.applySubmission(submission, session.userId, session.today);
      removeDraft(context.scope, context.ownerId, context.entityId, context.revision);
      wx.disableAlertBeforeUnload();
      void this.loadImages();
    } catch (error) {
      if (!this.disposed && generation === this.loadGeneration) this.setData({ error: `${error instanceof Error ? error.message : '最新稿件暂时无法读取。'} 当前填写与本机草稿已保留，请重试。` });
    } finally { if (!this.disposed && generation === this.loadGeneration) this.setData({ reloading: false }); }
  },
  finish(title: string, expectedRevision: string | null) {
    removeDraft(this.draftScope(), this.data.ownerId, this.draftEntityId(), expectedRevision);
    if (this.disposed) return;
    this.pendingCreation = null;
    const finishLeadFlow = this.data.importedLead && !this.data.submissionId && !this.data.reviewMode;
    this.setData({ dirty: false, submitted: true, pendingCreationUnconfirmed: false, saving: !finishLeadFlow, ...(finishLeadFlow ? { readOnly: true } : {}) });
    wx.disableAlertBeforeUnload();
    wx.showToast({ title: finishLeadFlow ? '完整投稿已提交审核' : title, icon: 'success' });
    if (finishLeadFlow) { this.viewSubmissions(); return; }
    wx.navigateBack({ delta: 1, fail: () => { if (!this.disposed) wx.redirectTo({ url: this.data.reviewMode ? '/pages/review/index' : '/pages/submissions/index' }); } });
  },
  viewSubmissions() {
    if (!this.disposed && this.data.pendingCreationUnconfirmed && !this.data.saving) { wx.navigateTo({ url: '/pages/submissions/index' }); return; }
    if (this.disposed || !this.data.submitted || !this.data.importedLead || this.data.openingSubmissions) return;
    this.setData({ openingSubmissions: true });
    const url = '/pages/submissions/index';
    const failed = () => {
      if (!this.disposed) this.setData({ openingSubmissions: false });
      wx.showToast({ title: '投稿已提交，可从“我的投稿”查看', icon: 'none' });
    };
    const openFromMine = () => wx.switchTab({
      url: '/pages/mine/index',
      success: () => wx.navigateTo({ url, fail: failed }),
      fail: () => wx.reLaunch({ url, fail: failed }),
    });
    const pages = getCurrentPages();
    for (let index = pages.length - 2; index >= 0; index--) {
      if (pages[index].route === 'pages/submissions/index') {
        wx.navigateBack({ delta: pages.length - 1 - index, fail: openFromMine });
        return;
      }
    }
    openFromMine();
  },
  viewActivity() {
    if (this.data.submission?.activityId) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(this.data.submission.activityId)}` });
  },
  goBack() { navigateBackOr(this.data.reviewMode ? '/pages/mine/index' : '/pages/submissions/index', this.data.reviewMode); },
});

import { api, ensureSession, uploadImage, previewAssets } from '../../services/api';
import type { ActivityDraft, Asset, Submission } from '../../../shared/contracts';
import { banks, issuers, networks } from '../../../shared/catalog';

type FormSection = 'basic' | 'rules' | 'entrance' | 'source';
type InputEvent = { currentTarget: { dataset: { field: string; section?: FormSection; id?: string } }; detail: { value: string | boolean | string[] } };
type Option = { id: string; name: string };
const frequencies: Option[] = [{ id: 'once', name: '一次性' }, { id: 'monthly', name: '每月' }, { id: 'quarterly', name: '每季度' }, { id: 'yearly', name: '每年' }];
const currencies: Option[] = [{ id: 'CNY', name: '人民币 CNY' }, { id: 'HKD', name: '港币 HKD' }, { id: 'MOP', name: '澳门元 MOP' }];
const cardKinds: Option[] = [{ id: 'credit', name: '信用卡' }, { id: 'debit', name: '储蓄卡' }, { id: 'any', name: '信用卡与储蓄卡' }];
const rewardKinds: Option[] = [{ id: 'cashback', name: '返现／奖励' }, { id: 'discount', name: '即时立减' }];
const scopes: Option[] = [{ id: 'user', name: '每人一份' }, { id: 'card', name: '每张符合条件的卡一份' }];
const entranceKinds: Option[] = [{ id: 'guide', name: '图片或操作路径' }, { id: 'web', name: '网页链接' }, { id: 'miniprogram', name: '微信小程序' }];
const unitOptions = ['次', '笔', '元', '港元', '澳门元'];

function freshDraft(today: string): ActivityDraft {
  return { title: '', bankId: '', issuerIds: [], networks: [], cardKind: 'credit', cardDescription: '', frequency: 'once', startsOn: today, endsOn: '', target: 1, unit: '次', currency: 'CNY', rewardMinor: 0, rewardKind: 'cashback', scope: 'user', requiresRegistration: false, requiresInvitation: false, conditions: '', sourceUrl: '', sourceNote: '', entrance: { kind: 'guide', label: '参与入口', instructions: '', imageIds: [] } };
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
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ''] = value.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}

Page({
  data: {
    loading: true, ready: false, saving: false, uploading: false, loadingImages: false, conflict: false, error: '', denied: false, readOnly: false,
    reviewMode: false, submissionId: '', submission: null as Submission | null, today: '',
    draft: freshDraft(''), targetText: '1', rewardText: '', reviewNote: '', sourceVerified: false,
    openSection: 'basic' as FormSection, errors: {} as Record<string, string>, dirty: false,
    bankOptions: [{ id: '', name: '请选择银行' }, ...banks], bankIndex: 0,
    issuerOptions: [] as { id: string; name: string; checked: boolean }[],
    networkOptions: networks.map(item => ({ ...item, checked: false })),
    frequencies, frequencyIndex: 0, currencies, currencyIndex: 0, cardKinds, cardKindIndex: 0,
    rewardKinds, rewardKindIndex: 0, scopes, scopeIndex: 0, entranceKinds, entranceKindIndex: 0,
    unitOptions, unitIndex: 0, assets: [] as Asset[], assetUrls: [] as { id: string; url: string }[], imageRows: [] as { id: string; label: string; available: boolean; url: string }[],
    bankSummary: '选择银行与适用卡', ruleSummary: '填写周期、门槛和奖励', entranceSummary: '添加参与入口', sourceSummary: '添加可核实出处',
  },
  onLoad(options: { id?: string; review?: string }) {
    this.setData({ submissionId: options.id || '', reviewMode: options.review === '1' });
    void this.load();
  },
  async load() {
    this.setData({ loading: true, ready: false, conflict: false, error: '', denied: false });
    try {
      const session = await ensureSession();
      if (this.data.reviewMode && (!session.isModerator || !this.data.submissionId)) {
        this.setData({ denied: true }); return;
      }
      let submission: Submission | null = null;
      let draft = freshDraft(session.today);
      if (this.data.submissionId) {
        submission = await api.query('submission.get', { id: this.data.submissionId });
        draft = JSON.parse(JSON.stringify(submission.draft)) as ActivityDraft;
      }
      const readOnly = !!submission && (submission.status === 'published' || (this.data.reviewMode && submission.status !== 'pending'));
      this.setData({ ready: true, today: session.today, draft, submission, readOnly, targetText: String(draft.target), rewardText: draft.rewardMinor ? (draft.rewardMinor / 100).toFixed(2) : '', reviewNote: submission?.reviewNote || '', dirty: false, sourceVerified: false, errors: {} });
      this.syncOptions();
      void this.loadImages();
      wx.setNavigationBarTitle({ title: this.data.reviewMode ? (readOnly ? '处理结果' : '核实活动') : (readOnly ? '投稿详情' : this.data.submissionId ? '修改投稿' : '分享活动') });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '稿件暂时无法读取，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  syncOptions() {
    const draft = this.data.draft;
    const selectedBank = banks.find(bank => bank.id === draft.bankId);
    this.setData({
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
      bankSummary: selectedBank ? `${selectedBank.name} · ${cardKinds.find(item => item.id === draft.cardKind)?.name || ''}` : '选择银行与适用卡',
      ruleSummary: draft.endsOn ? `${frequencies.find(item => item.id === draft.frequency)?.name || ''} · ${draft.endsOn} 结束` : '填写周期、门槛和奖励',
      entranceSummary: draft.entrance.imageIds.length ? `${entranceKinds.find(item => item.id === draft.entrance.kind)?.name || ''} · ${draft.entrance.imageIds.length} 张图片` : entranceKinds.find(item => item.id === draft.entrance.kind)?.name || '添加参与入口',
      sourceSummary: draft.sourceUrl || draft.sourceNote ? '已填写出处，发布前需核实' : '添加可核实出处',
    });
  },
  markDirty() {
    if (this.data.readOnly) return;
    this.setData({ dirty: true, sourceVerified: false });
    wx.enableAlertBeforeUnload({ message: '还有未提交的修改，离开后将丢失。' });
  },
  toggleSection(event: { currentTarget: { dataset: { section: FormSection } } }) {
    this.setData({ openSection: event.currentTarget.dataset.section });
  },
  input(event: InputEvent) {
    if (this.data.readOnly || this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    const value = String(event.detail.value);
    const allowed = ['title', 'cardDescription', 'conditions', 'sourceUrl', 'sourceNote', 'entrance.label', 'entrance.url', 'entrance.appId', 'entrance.path', 'entrance.shortLink', 'entrance.instructions'];
    if (['targetText', 'rewardText', 'reviewNote'].includes(field)) this.setData({ [field]: value });
    else if (allowed.includes(field)) this.setData({ [`draft.${field}`]: value });
    else return;
    this.setData({ [`errors.${field}`]: '', error: '' });
    this.markDirty();
    if (field === 'sourceUrl' || field === 'sourceNote') this.syncOptions();
  },
  select(event: InputEvent) {
    if (this.data.readOnly || this.data.saving) return;
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
        this.setData({ 'draft.issuerIds': bankIssuers.length === 1 ? [bankIssuers[0].id] : [] });
      }
    }
    this.setData({ [`errors.${field}`]: '', error: '' });
    this.markDirty(); this.syncOptions();
  },
  selectDate(event: InputEvent) {
    if (this.data.readOnly || this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    if (!['startsOn', 'endsOn'].includes(field)) return;
    this.setData({ [`draft.${field}`]: String(event.detail.value), [`errors.${field}`]: '' });
    this.markDirty(); this.syncOptions();
  },
  selectIssuers(event: InputEvent) {
    if (this.data.readOnly || this.data.saving) return;
    this.setData({ 'draft.issuerIds': event.detail.value, 'errors.issuerIds': '' });
    this.markDirty(); this.syncOptions();
  },
  selectNetworks(event: InputEvent) {
    if (this.data.readOnly || this.data.saving) return;
    this.setData({ 'draft.networks': event.detail.value });
    this.markDirty(); this.syncOptions();
  },
  toggle(event: InputEvent) {
    if (this.data.readOnly || this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    if (field === 'sourceVerified') {
      this.setData({ sourceVerified: Boolean(event.detail.value), 'errors.sourceVerified': '' }); return;
    }
    if (!['requiresRegistration', 'requiresInvitation'].includes(field)) return;
    this.setData({ [`draft.${field}`]: Boolean(event.detail.value) });
    this.markDirty();
  },
  async addImage() {
    if (this.data.readOnly || this.data.saving || this.data.uploading) return;
    if (this.data.draft.entrance.imageIds.length >= 6) { wx.showToast({ title: '最多添加 6 张图片', icon: 'none' }); return; }
    this.setData({ uploading: true, error: '' });
    try {
      const asset = await uploadImage();
      this.setData({ assets: [...this.data.assets, asset], 'draft.entrance.imageIds': [...this.data.draft.entrance.imageIds, asset.id] });
      this.markDirty(); this.syncOptions();
      await this.loadImages();
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片上传失败，请重试。';
      if (!/cancel|取消/i.test(message)) this.setData({ 'errors.imageIds': message });
    } finally { this.setData({ uploading: false }); }
  },
  removeImage(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.readOnly || this.data.saving) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ 'draft.entrance.imageIds': this.data.draft.entrance.imageIds.filter(imageId => imageId !== id), assets: this.data.assets.filter(asset => asset.id !== id) });
    this.markDirty(); this.syncOptions();
  },
  async loadImages() {
    if (!this.data.draft.entrance.imageIds.length) { this.setData({ assets: [], assetUrls: [] }); return; }
    this.setData({ loadingImages: true });
    try {
      const ids = this.data.draft.entrance.imageIds.slice();
      const [assets, assetUrls] = await Promise.all([api.query('assets.get', { ids }), api.query('assets.urls', { ids })]);
      this.setData({ assets, assetUrls, 'errors.imageIds': '' });
      this.syncOptions();
    } catch (error) { this.setData({ 'errors.imageIds': error instanceof Error ? error.message : '图片暂时无法读取，点击图片可重试。' }); }
    finally { this.setData({ loadingImages: false }); }
  },
  async previewImage(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.loadingImages) return;
    if (!this.data.assets.some(asset => asset.id === event.currentTarget.dataset.id)) await this.loadImages();
    const index = this.data.assets.findIndex(asset => asset.id === event.currentTarget.dataset.id);
    if (index < 0) return;
    try { await previewAssets(this.data.assets, index); }
    catch (error) { this.setData({ 'errors.imageIds': error instanceof Error ? error.message : '图片暂时无法打开，请重试。' }); }
  },
  copySource() {
    const value = this.data.draft.sourceUrl || this.data.draft.sourceNote;
    if (value) wx.setClipboardData({ data: value });
  },
  reject(field: string, message: string, section: FormSection): false {
    this.setData({ [`errors.${field}`]: message, openSection: section, error: '请检查标出的内容，填写后重新提交。' });
    wx.pageScrollTo({ selector: `#section-${section}`, duration: 180 });
    return false;
  },
  validate(): ActivityDraft | false {
    const draft = JSON.parse(JSON.stringify(this.data.draft)) as ActivityDraft;
    for (const field of ['title', 'cardDescription', 'conditions', 'sourceUrl', 'sourceNote'] as const) draft[field] = draft[field].trim();
    draft.entrance.label = draft.entrance.label.trim() || '参与入口';
    draft.entrance.instructions = draft.entrance.instructions.trim();
    draft.entrance.url = (draft.entrance.url || '').trim();
    draft.entrance.appId = (draft.entrance.appId || '').trim();
    draft.entrance.path = (draft.entrance.path || '').trim();
    draft.entrance.shortLink = (draft.entrance.shortLink || '').trim();
    if (!draft.title || draft.title.length > 60) return this.reject('title', '请填写 60 字以内的活动标题。', 'basic');
    if (!banks.some(item => item.id === draft.bankId)) return this.reject('bankId', '请选择活动所属银行。', 'basic');
    const availableIssuers = issuers.filter(item => item.bankId === draft.bankId).map(item => item.id);
    if (!draft.issuerIds.length || draft.issuerIds.some(id => !availableIssuers.includes(id))) return this.reject('issuerIds', '请选择活动适用的发卡机构。', 'basic');
    if (!draft.cardDescription) return this.reject('cardDescription', '请写明适用卡片，例如指定 Visa 信用卡。', 'basic');
    if (!draft.conditions || draft.conditions.length > 2000) return this.reject('conditions', '请填写参与条件，最多 2000 字。', 'basic');
    if (!validDate(draft.startsOn)) return this.reject('startsOn', '请选择有效的开始日期。', 'rules');
    if (!validDate(draft.endsOn) || draft.endsOn < draft.startsOn) return this.reject('endsOn', '结束日期不能早于开始日期。', 'rules');
    if (draft.endsOn < this.data.today) return this.reject('endsOn', '已结束的活动无法提交，请核实活动日期。', 'rules');
    const target = this.data.targetText.trim();
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(target) || Number(target) <= 0) return this.reject('targetText', '请填写大于 0 的累计门槛，最多两位小数。', 'rules');
    if (['次', '笔'].includes(draft.unit) && !Number.isInteger(Number(target))) return this.reject('targetText', '次数和笔数需要填写正整数。', 'rules');
    draft.target = Number(target);
    const reward = amountMinor(this.data.rewardText.trim());
    if (reward === null || reward <= 0) return this.reject('rewardText', '请填写大于 0 的奖励金额，最多两位小数。', 'rules');
    draft.rewardMinor = reward;
    if (draft.entrance.kind === 'web' && !isHttps(draft.entrance.url)) return this.reject('entrance.url', '请填写完整的 HTTPS 活动入口链接。', 'entrance');
    if (draft.entrance.kind === 'miniprogram') {
      if (!draft.entrance.shortLink && !/^wx[a-f0-9]{16}$/i.test(draft.entrance.appId)) return this.reject('entrance.appId', '请填写有效的小程序 AppID，或填写小程序短链接。', 'entrance');
      if (draft.entrance.shortLink && !/^#小程序:\/\/[^/\r\n\t]{1,100}\/[A-Za-z0-9_-]{1,256}$/.test(draft.entrance.shortLink)) return this.reject('entrance.shortLink', '请粘贴微信生成的完整小程序短链接。', 'entrance');
    }
    if (draft.entrance.kind === 'guide' && !draft.entrance.instructions && !draft.entrance.imageIds.length) return this.reject('entrance.instructions', '请补充操作路径或入口图片，让用户知道如何参加。', 'entrance');
    if (draft.sourceUrl && !isHttps(draft.sourceUrl)) return this.reject('sourceUrl', '来源链接需要是完整的 HTTPS 地址。', 'source');
    if (!draft.sourceUrl && !draft.sourceNote) return this.reject('sourceNote', '请提供官方来源链接，或可核实的银行 App 路径。', 'source');
    if (this.data.reviewMode && !this.data.sourceVerified) return this.reject('sourceVerified', '发布前请先核对规则来源和参与入口。', 'source');
    if (draft.entrance.kind !== 'web') delete draft.entrance.url;
    if (draft.entrance.kind !== 'miniprogram') { delete draft.entrance.appId; delete draft.entrance.path; delete draft.entrance.shortLink; }
    if (draft.entrance.shortLink) { delete draft.entrance.appId; delete draft.entrance.path; }
    return draft;
  },
  async save() {
    if (!this.data.ready || this.data.readOnly || this.data.saving || this.data.uploading || this.data.denied || this.data.conflict) return;
    this.setData({ error: '', errors: {} });
    const draft = this.validate();
    if (!draft) return;
    this.setData({ saving: true });
    try {
      if (this.data.reviewMode) {
        await api.command('submission.review', { id: this.data.submissionId, decision: 'publish', draft, sourceVerified: true, expectedVersion: this.data.submission?.version });
      } else {
        await api.command('submission.save', { ...(this.data.submissionId ? { id: this.data.submissionId, expectedVersion: this.data.submission?.version } : {}), draft });
      }
      this.finish(this.data.reviewMode ? '活动已发布' : '已提交审核');
    } catch (error) { this.showFailure(error, '提交未成功，你的填写内容已保留。'); }
    finally { this.setData({ saving: false }); }
  },
  async returnSubmission() {
    if (!this.data.ready || !this.data.reviewMode || this.data.readOnly || this.data.saving || this.data.denied || this.data.conflict) return;
    const reviewNote = this.data.reviewNote.trim();
    if (!reviewNote || reviewNote.length > 600) { this.reject('reviewNote', '请写明需要投稿人补充的内容，最多 600 字。', 'source'); return; }
    this.setData({ saving: true, error: '' });
    try {
      await api.command('submission.review', { id: this.data.submissionId, decision: 'return', reviewNote, expectedVersion: this.data.submission?.version });
      this.finish('已退回补充');
    } catch (error) { this.showFailure(error, '退回未成功，请重试。'); }
    finally { this.setData({ saving: false }); }
  },
  showFailure(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'VERSION_CONFLICT') { this.setData({ conflict: true, error: '稿件已被更新。本次填写仍保留在页面中，请读取最新版本后再处理。' }); return; }
    const field = error && typeof error === 'object' && 'field' in error && typeof error.field === 'string' ? error.field.replace(/^draft\./, '') : '';
    if (!field) { this.setData({ error: message }); return; }
    const name = field === 'target' ? 'targetText' : field === 'rewardMinor' ? 'rewardText' : field === 'entrance.imageIds' ? 'imageIds' : field;
    const section: FormSection = field.startsWith('entrance') ? 'entrance' : ['sourceUrl', 'sourceNote', 'sourceVerified', 'reviewNote'].includes(field) ? 'source' : ['target', 'rewardMinor', 'startsOn', 'endsOn', 'frequency', 'unit', 'currency', 'scope', 'rewardKind'].includes(field) ? 'rules' : 'basic';
    this.reject(name, message, section);
  },
  async reloadLatest() {
    const result = await wx.showModal({ title: '读取最新稿件？', content: '当前未提交的修改会被最新稿件替换。你可以先取消，复制需要保留的内容。', confirmText: '读取最新', cancelText: '继续查看' });
    if (!result.confirm) return;
    wx.disableAlertBeforeUnload();
    await this.load();
  },
  finish(title: string) {
    this.setData({ dirty: false });
    wx.disableAlertBeforeUnload();
    wx.showToast({ title, icon: 'success' });
    wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: this.data.reviewMode ? '/pages/review/index' : '/pages/submissions/index' }) });
  },
  viewActivity() {
    if (this.data.submission?.activityId) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(this.data.submission.activityId)}` });
  },
  goBack() { wx.navigateBack({ delta: 1 }); },
});

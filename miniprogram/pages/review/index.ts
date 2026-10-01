import { api, ensureSession } from '../../services/api';
import type { PageResult, Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { navigateBackOr } from '../../services/navigation';
import { cleanRewardInput, cycleOptions, defaultCycle, intervalOptions, rewardOptions, rewardValue, weekdayOptions } from '../../services/recognition-form';
import { createReviewForm, effectiveReviewCycle, normalizedReviewDraft, updateReviewForm } from '../../services/review-form';
import type { InlineReviewForm } from '../../services/review-form';
import { getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';

type ReviewRow = Submission & { bankName: string; bankLogo: string; dateLabel: string; titleText: string; summaryText: string; isLead: boolean; sourceUrl: string; sourceNote: string; sourceSummary: string; shots: { id: string; url: string }[]; form: InlineReviewForm };
type RowEvent = { currentTarget: { dataset: { id: string; value?: string; field?: string; delta?: number; shot?: string } }; detail?: { value: string | boolean } };
type SavedReviewInput = { draft: InlineReviewForm['draft']; rewardText: string; rewardTypeSelected: boolean; legacyCycle?: boolean };
const inlineScope = 'submission-review-inline';
function savedReview(value: SavedReviewInput): boolean {
  return !!value?.draft && ['title', 'bankId', 'cardDescription', 'startsOn', 'endsOn', 'conditions', 'sourceUrl', 'sourceNote'].every(field => typeof value.draft[field as keyof typeof value.draft] === 'string')
    && Array.isArray(value.draft.issuerIds) && Array.isArray(value.draft.networks) && !!value.draft.entrance && Array.isArray(value.draft.entrance.imageIds)
    && typeof value.draft.entrance.label === 'string' && typeof value.draft.entrance.instructions === 'string' && typeof value.rewardText === 'string' && typeof value.rewardTypeSelected === 'boolean';
}
Page({
  disposed: false,
  requestGeneration: 0,
  previewSequence: 0,
  listOwnerId: '',
  reviewForms: null as Map<string, InlineReviewForm> | null,
  shotUrls: null as Map<string, string> | null,
  handoffRevisions: null as Map<string, string | null> | null,
  data: { loading: true, loadingMore: false, denied: false, sessionVerified: false, error: '', loadMoreError: '', status: 'pending' as SubmissionStatus, items: [] as ReviewRow[], nextCursor: null as string | null,
    today: '', anyBusy: false, rewardOptions, cycleOptions, weekdayOptions, intervalOptions, viewerShow: false, viewerItems: [] as Record<string, unknown>[], viewerIndex: 0,
    returnShow: false, returnId: '', returnTitle: '', returnReason: '', returnNote: '', returnBusy: false, returnError: '', returnReasons: ['活动信息不完整', '来源无法核实', '活动已结束', '与已有活动重复', '其他原因'],
  },
  onShow() { void this.load(); },
  onHide() { this.previewSequence++; this.setData({ viewerShow: false }); },
  onUnload() { this.disposed = true; this.requestGeneration += 1; this.previewSequence++; },
  async load() {
    if (this.disposed || this.data.anyBusy) return;
    const generation = ++this.requestGeneration;
    const status = this.data.status;
    let targetCount = this.data.items.length;
    this.setData({ loading: true, loadingMore: false, sessionVerified: false, error: '', loadMoreError: '' });
    try {
      const session = await ensureSession(true);
      if (generation !== this.requestGeneration || status !== this.data.status) return;
      if (!session.isModerator) { this.reviewForms = null; this.shotUrls = null; this.handoffRevisions = null; this.setData({ denied: true, items: [], nextCursor: null, viewerShow: false, returnShow: false }); return; }
      if (this.listOwnerId && this.listOwnerId !== session.userId) {
        targetCount = 0;
        this.reviewForms = null; this.shotUrls = null; this.handoffRevisions = null;
        this.setData({ items: [], nextCursor: null });
      }
      this.listOwnerId = session.userId;
      this.setData({ denied: false, sessionVerified: true, today: session.today });
      const items: Submission[] = [];
      const ids = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const result: PageResult<Submission> = await api.query('submissions.list', { moderation: true, status, limit: targetCount ? Math.min(50, Math.max(1, targetCount - items.length)) : 20, ...(cursor ? { cursor } : {}) });
        if (generation !== this.requestGeneration || status !== this.data.status) return;
        for (const item of result.items) if (!ids.has(item.id)) { ids.add(item.id); items.push(item); }
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('审核列表暂时未能完整更新，请重试。');
        if (cursor) cursors.add(cursor);
      } while (cursor && items.length < targetCount);
      this.setData({ items: this.rows(items), nextCursor: cursor });
      void this.loadShots(generation);
    } catch (error) {
      if (generation === this.requestGeneration) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN') this.setData({ denied: true, sessionVerified: false, items: [], nextCursor: null });
        else this.setData({ error: error instanceof Error ? error.message : '暂时无法读取审核列表，请重试。' });
      }
    } finally { if (generation === this.requestGeneration) this.setData({ loading: false }); }
  },
  rows(items: Submission[]): ReviewRow[] {
    this.reviewForms ||= new Map();
    this.shotUrls ||= new Map();
    return items.map(item => {
      const sourceUrl = item.draft?.sourceUrl || item.lead?.sourceUrl || '';
      const sourceNote = item.draft?.sourceNote || item.lead?.sourceNote || '';
      const ids = [...new Set([...(item.lead?.imageIds || []), ...(item.draft?.entrance.imageIds || [])])];
      let form = this.reviewForms!.get(item.id);
      if (!form || (!form.dirty && form.baseVersion !== item.version)) {
        form = createReviewForm(item, this.data.today);
        if (item.status === 'pending') {
          const saved = loadDraft<SavedReviewInput>(inlineScope, this.listOwnerId, item.id);
          if (saved && savedReview(saved.value)) form = updateReviewForm({ ...form, ...saved.value, legacyCycle: saved.value.legacyCycle ?? (!!item.draft && !saved.value.draft.cycle), draftRevision: getDraftRevision(inlineScope, this.listOwnerId, item.id), dirty: true, sourceVerified: false, baseVersion: typeof saved.baseVersion === 'number' ? saved.baseVersion : item.version, conflict: saved.baseVersion !== item.version }, this.data.today);
        }
      } else if (form.baseVersion !== item.version || item.status !== 'pending') form = { ...form, conflict: true, sourceVerified: false, error: '投稿内容或审核状态已更新，本机填写仍保留。请核对后读取最新投稿。' };
      this.reviewForms!.set(item.id, form);
      return { ...item, sourceUrl, sourceNote, form, shots: ids.map(id => ({ id, url: this.shotUrls!.get(id) || '' })), sourceSummary: [sourceUrl ? '链接' : '', sourceNote ? 'App 路径' : '', ids.length ? `${ids.length} 张截图` : ''].filter(Boolean).join(' · ') || '暂无来源',
        bankName: banks.find(bank => bank.id === (item.draft?.bankId || item.lead?.bankId))?.name || '银行待确认', bankLogo: banks.find(bank => bank.id === (item.draft?.bankId || item.lead?.bankId))?.logo || '', dateLabel: item.updatedAt.slice(0, 10), titleText: item.draft?.title || item.lead?.title || '活动线索', summaryText: item.draft?.conditions || item.lead?.sourceNote || item.lead?.sourceUrl || `已提供 ${item.lead?.imageIds.length || 0} 张来源图片`, isLead: !item.draft && !!item.lead };
    });
  },
  changeStatus(event: { currentTarget: { dataset: { status: SubmissionStatus } } }) {
    const status = event.currentTarget.dataset.status;
    if (this.data.anyBusy || !['pending', 'returned', 'published'].includes(status) || status === this.data.status) return;
    this.setData({ status, items: [], nextCursor: null });
    void this.load();
  },
  async loadMore() {
    if (this.data.anyBusy || !this.data.nextCursor || this.data.loading || this.data.loadingMore || this.data.denied || !this.data.sessionVerified) return;
    const generation = this.requestGeneration;
    const status = this.data.status;
    const cursor = this.data.nextCursor;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const result = await api.query('submissions.list', { moderation: true, status, limit: 20, cursor });
      if (generation !== this.requestGeneration || status !== this.data.status || cursor !== this.data.nextCursor) return;
      const existingIds = new Set(this.data.items.map(item => item.id));
      const nextItems = result.items.filter(item => { if (existingIds.has(item.id)) return false; existingIds.add(item.id); return true; });
      this.setData({ items: [...this.data.items, ...this.rows(nextItems)], nextCursor: result.nextCursor });
      void this.loadShots(generation);
    } catch (error) {
      if (generation === this.requestGeneration) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN') this.setData({ denied: true, sessionVerified: false, items: [], nextCursor: null });
        else this.setData({ loadMoreError: error instanceof Error ? error.message : '未能读取更多投稿，请重试。' });
      }
    } finally { if (generation === this.requestGeneration) this.setData({ loadingMore: false }); }
  },
  row(id: string): ReviewRow | undefined { return this.data.items.find(item => item.id === id); },
  canEditRow(id: string): boolean {
    const row = this.row(id);
    return !this.disposed && !this.data.anyBusy && !!row && row.status === 'pending' && this.data.status === 'pending' && this.data.sessionVerified && !this.data.denied && !this.data.loading && !row.form.busy && !row.form.conflict;
  },
  showForm(id: string, form: InlineReviewForm) {
    this.reviewForms ||= new Map(); this.reviewForms.set(id, form);
    this.setData({ items: this.data.items.map(item => item.id === id ? { ...item, form } : item), anyBusy: this.data.items.some(item => item.id === id ? form.busy : item.form.busy) });
  },
  editForm(id: string, change: Partial<InlineReviewForm>, draftPatch: Partial<InlineReviewForm['draft']> = {}) {
    if (!this.canEditRow(id)) return;
    const current = this.row(id)!.form;
    if (getDraftRevision(inlineScope, this.listOwnerId, id) !== current.draftRevision) { this.showForm(id, { ...current, conflict: true, sourceVerified: false, error: '另一处本机填写已有更新，当前内容仍保留，请先核对。' }); return; }
    const draft = { ...JSON.parse(JSON.stringify(current.draft)), ...draftPatch } as InlineReviewForm['draft'];
    draft.rewardMinor = rewardValue((change.rewardText ?? current.rewardText).trim(), draft.rewardKind === 'points') || 0;
    const form = updateReviewForm({ ...current, ...change, draft, legacyCycle: draftPatch.cycle ? false : current.legacyCycle, sourceVerified: false, dirty: true, error: '' }, this.data.today);
    const saved = saveDraft<SavedReviewInput>(inlineScope, this.listOwnerId, id, form.baseVersion, { draft, rewardText: form.rewardText, rewardTypeSelected: form.rewardTypeSelected, legacyCycle: form.legacyCycle });
    if (saved) form.draftRevision = getDraftRevision(inlineScope, this.listOwnerId, id);
    if (!saved) form.error = '本机填写暂时无法保存，请勿关闭页面。';
    this.showForm(id, form);
  },
  inputReward(event: RowEvent) {
    const form = this.row(event.currentTarget.dataset.id)?.form;
    if (!form) return;
    this.editForm(event.currentTarget.dataset.id, { rewardText: cleanRewardInput(String(event.detail?.value || ''), form.draft.rewardKind === 'points') });
  },
  selectReward(event: RowEvent) {
    const { id, value } = event.currentTarget.dataset;
    const form = this.row(id)?.form;
    if (!form || !rewardOptions.some(option => option.id === value)) return;
    this.editForm(id, { rewardTypeSelected: true, rewardText: cleanRewardInput(form.rewardText, value === 'points') }, { rewardKind: value as InlineReviewForm['draft']['rewardKind'] });
  },
  selectCycle(event: RowEvent) {
    const { id, value } = event.currentTarget.dataset;
    const form = this.row(id)?.form;
    if (!form || !cycleOptions.some(option => option.id === value)) return;
    this.editForm(id, {}, { cycle: defaultCycle(value!, form.draft.startsOn, form.draft.endsOn), frequency: value === 'once' ? 'once' : 'monthly' });
  },
  selectWeekday(event: RowEvent) {
    const { id, value } = event.currentTarget.dataset;
    const form = this.row(id)?.form;
    const weekday = Number(value);
    const cycle = form && effectiveReviewCycle(form);
    if (!form || cycle?.t !== 'week' || !weekdayOptions.some(option => option.id === weekday)) return;
    this.editForm(id, {}, { cycle: { ...cycle, weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6 } });
  },
  stepCycle(event: RowEvent) {
    const { id } = event.currentTarget.dataset;
    const delta = Number(event.currentTarget.dataset.delta);
    const form = this.row(id)?.form;
    const cycle = form && effectiveReviewCycle(form);
    if (delta !== -1 && delta !== 1) return;
    if (cycle?.t === 'month') this.editForm(id, {}, { cycle: { ...cycle, day: Math.max(1, Math.min(28, cycle.day + delta)) } });
    else if (cycle?.t === 'custom') this.editForm(id, {}, { cycle: { ...cycle, n: Math.max(1, Math.min(cycle.unit === 'day' ? 90 : 12, cycle.n + delta)) } });
  },
  selectInterval(event: RowEvent) {
    const { id, value } = event.currentTarget.dataset;
    const form = this.row(id)?.form;
    const cycle = form && effectiveReviewCycle(form);
    if (cycle?.t !== 'custom' || !intervalOptions.some(option => option.id === value)) return;
    const unit = value as 'day' | 'week' | 'month';
    this.editForm(id, {}, { cycle: { ...cycle, unit, n: Math.min(unit === 'day' ? 90 : 12, cycle.n) } });
  },
  selectDate(event: RowEvent) {
    const { id, field } = event.currentTarget.dataset;
    const form = this.row(id)?.form;
    if (!form || !['startsOn', 'endsOn'].includes(field || '')) return;
    const value = String(event.detail?.value || '');
    if (field === 'endsOn' && value < form.draft.startsOn) { wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' }); return; }
    const patch: Partial<InlineReviewForm['draft']> = { [field!]: value };
    if (field === 'startsOn' && form.draft.endsOn && value > form.draft.endsOn) patch.endsOn = '';
    const startsOn = patch.startsOn ?? form.draft.startsOn;
    const endsOn = patch.endsOn ?? form.draft.endsOn;
    if (form.draft.cycle?.t === 'once') patch.cycle = { t: 'once', start: startsOn, end: endsOn };
    if (form.draft.cycle?.t === 'custom') patch.cycle = { ...form.draft.cycle, anchor: startsOn };
    this.editForm(id, {}, patch);
  },
  verifySource(event: RowEvent) {
    const id = event.currentTarget.dataset.id;
    if (!this.canEditRow(id)) return;
    this.showForm(id, { ...this.row(id)!.form, sourceVerified: Boolean(event.detail?.value), error: '' });
  },
  async verifyActor(ownerId: string, generation: number): Promise<boolean> {
    const session = await ensureSession(true);
    if (this.disposed || generation !== this.requestGeneration) return false;
    if (session.userId !== ownerId || !session.isModerator) {
      this.requestGeneration++;
      this.listOwnerId = session.userId;
      this.reviewForms = null; this.shotUrls = null; this.handoffRevisions = null;
      this.setData({ sessionVerified: false, denied: !session.isModerator, items: [], nextCursor: null, viewerShow: false, returnShow: false, returnBusy: false, anyBusy: false, error: '审核账号或权限已变化，请重新核实后继续。' });
      return false;
    }
    return true;
  },
  async publish(event: RowEvent) {
    const id = event.currentTarget.dataset.id;
    if (!this.canEditRow(id)) return;
    const row = this.row(id)!;
    const form = updateReviewForm(row.form, this.data.today);
    if (!form.sourceVerified) { this.showForm(id, { ...form, error: '发布前请先核实来源与参与入口。' }); return; }
    if (!form.publishReady || !form.complete) { this.showForm(id, { ...form, error: '活动规则尚未完整，请先完善标出的内容。' }); return; }
    const ownerId = this.listOwnerId;
    const generation = this.requestGeneration;
    const revision = form.draftRevision;
    this.showForm(id, { ...form, busy: true, error: '' });
    try {
      if (!await this.verifyActor(ownerId, generation)) return;
      await api.command('submission.review', { id, decision: 'publish', draft: normalizedReviewDraft(form), sourceVerified: true, expectedVersion: form.baseVersion });
      removeDraft(inlineScope, ownerId, id, revision);
      if (this.disposed || generation !== this.requestGeneration || ownerId !== this.listOwnerId) return;
      this.reviewForms?.delete(id);
      this.setData({ items: this.data.items.filter(item => item.id !== id), anyBusy: false });
      wx.showToast({ title: '已发布，活动页可见', icon: 'success' });
    } catch (error) {
      if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId) this.actionFailure(id, error);
    } finally {
      if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId && this.row(id)) this.showForm(id, { ...this.row(id)!.form, busy: false });
    }
  },
  actionFailure(id: string, error: unknown) {
    const form = this.row(id)?.form;
    if (!form) return;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    const conflict = ['VERSION_CONFLICT', 'IMMUTABLE', 'INVALID_STATE'].includes(String(code));
    if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') this.setData({ sessionVerified: false, error: '审核权限暂时无法确认，请重新核实后继续。', viewerShow: false });
    this.showForm(id, { ...form, busy: false, conflict: form.conflict || conflict, sourceVerified: false, error: conflict ? '投稿内容或状态已更新。本机填写仍保留，请核对后读取最新投稿。' : error instanceof Error ? error.message : '操作未成功，填写内容已保留，请重试。' });
  },
  async reloadRow(event: RowEvent) {
    const id = event.currentTarget.dataset.id;
    const row = this.row(id);
    if (!row || this.data.anyBusy || row.form.busy || !this.data.sessionVerified || this.data.denied) return;
    const ownerId = this.listOwnerId;
    const generation = this.requestGeneration;
    this.previewSequence++;
    const revision = getDraftRevision(inlineScope, ownerId, id);
    this.showForm(id, { ...row.form, busy: true });
    try {
      const confirmation = await wx.showModal({ title: '读取最新投稿？', content: '成功读取后将替换这条投稿的本机填写。需要保留的内容可先复制；读取失败时会保留当前填写。', confirmText: '读取最新', cancelText: '继续核对' });
      if (!confirmation.confirm || !await this.verifyActor(ownerId, generation)) return;
      const latest = await api.query('submission.get', { id });
      if (this.disposed || generation !== this.requestGeneration || ownerId !== this.listOwnerId) return;
      if (latest.id !== id) throw new Error('无法核对最新投稿，当前填写仍保留。');
      if (getDraftRevision(inlineScope, ownerId, id) !== revision) throw new Error('另一处本机填写已有更新，两个页面的内容均保留，请先核对。');
      removeDraft(inlineScope, ownerId, id, revision);
      this.reviewForms?.delete(id);
      this.setData({ items: latest.status === this.data.status ? this.data.items.map(item => item.id === id ? this.rows([latest])[0] : item) : this.data.items.filter(item => item.id !== id), anyBusy: false });
      void this.loadShots(generation);
    } catch (error) { if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId) this.actionFailure(id, error); }
    finally { if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId && this.row(id)) this.showForm(id, { ...this.row(id)!.form, busy: false }); }
  },
  async loadShots(generation?: number) {
    generation ??= this.requestGeneration;
    const ids = [...new Set(this.data.items.flatMap(item => item.shots.map(shot => shot.id)))];
    if (!ids.length || !this.data.sessionVerified) return;
    const ownerId = this.listOwnerId;
    try {
      const urls = await api.query('assets.urls', { ids });
      if (this.disposed || generation !== this.requestGeneration || ownerId !== this.listOwnerId || !this.data.sessionVerified || !Array.isArray(urls)) return;
      this.shotUrls ||= new Map();
      for (const shot of urls) if (ids.includes(shot.id)) this.shotUrls.set(shot.id, shot.url);
      this.setData({ items: this.data.items.map(item => ({ ...item, shots: item.shots.map(shot => ({ ...shot, url: this.shotUrls!.get(shot.id) || '' })) })) });
    } catch {}
  },
  async openShot(event: RowEvent) {
    const row = this.row(event.currentTarget.dataset.id);
    const shotId = event.currentTarget.dataset.shot;
    if (!row || !shotId || !row.shots.some(shot => shot.id === shotId) || !this.data.sessionVerified || this.data.denied) return;
    const generation = this.requestGeneration;
    const sequence = ++this.previewSequence;
    const ownerId = this.listOwnerId;
    if (!row.shots.find(shot => shot.id === shotId)?.url) await this.loadShots(generation);
    const current = this.row(row.id);
    if (this.disposed || sequence !== this.previewSequence || generation !== this.requestGeneration || ownerId !== this.listOwnerId || !this.data.sessionVerified || !current?.shots.find(shot => shot.id === shotId)?.url) return;
    this.setData({ viewerShow: true, viewerIndex: current.shots.findIndex(shot => shot.id === shotId), viewerItems: current.shots.map(shot => ({ ...shot, label: '投稿截图', uploader: `用户 ${current.ownerId.slice(-4)}`, uploadedOn: current.createdAt.slice(0, 10) })) });
  },
  closeViewer() { this.previewSequence++; this.setData({ viewerShow: false }); },
  copyLink(event: RowEvent) {
    if (!this.data.sessionVerified || this.data.denied) return;
    const row = this.row(event.currentTarget.dataset.id);
    if (row?.sourceUrl) wx.setClipboardData({ data: row.sourceUrl });
  },
  openReturn(event: RowEvent) {
    const row = this.row(event.currentTarget.dataset.id);
    if (!row || !this.canEditRow(row.id)) return;
    this.setData({ returnShow: true, returnId: row.id, returnTitle: row.titleText, returnReason: '', returnNote: '', returnError: '' });
  },
  closeReturn() { if (!this.data.returnBusy) this.setData({ returnShow: false }); },
  selectReturnReason(event: { currentTarget: { dataset: { value: string } } }) {
    if (!this.data.returnBusy && this.data.returnReasons.includes(event.currentTarget.dataset.value)) this.setData({ returnReason: event.currentTarget.dataset.value, returnError: '' });
  },
  inputReturnNote(event: { detail: { value: string } }) { if (!this.data.returnBusy) this.setData({ returnNote: String(event.detail.value), returnError: '' }); },
  async confirmReturn() {
    const id = this.data.returnId;
    if (!this.data.returnShow || this.data.returnBusy || !this.canEditRow(id)) return;
    const note = [this.data.returnReason, this.data.returnNote.trim()].filter(Boolean).join('，');
    if (!this.data.returnReason || note.length > 600) { this.setData({ returnError: '请选择退回原因，补充说明最多 500 字。' }); return; }
    const ownerId = this.listOwnerId;
    const generation = this.requestGeneration;
    const form = this.row(id)!.form;
    const revision = form.draftRevision;
    this.setData({ returnBusy: true, returnError: '' }); this.showForm(id, { ...form, busy: true });
    try {
      if (!await this.verifyActor(ownerId, generation)) return;
      await api.command('submission.review', { id, decision: 'return', reviewNote: note, expectedVersion: form.baseVersion });
      removeDraft(inlineScope, ownerId, id, revision);
      if (this.disposed || generation !== this.requestGeneration || ownerId !== this.listOwnerId) return;
      this.reviewForms?.delete(id);
      this.setData({ items: this.data.items.filter(item => item.id !== id), returnShow: false, anyBusy: false });
      wx.showToast({ title: '已退回补充', icon: 'success' });
    } catch (error) {
      if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId) { this.actionFailure(id, error); this.setData({ returnError: error instanceof Error ? error.message : '退回未成功，请重试。' }); }
    } finally {
      if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId) { this.setData({ returnBusy: false }); if (this.row(id)) this.showForm(id, { ...this.row(id)!.form, busy: false }); }
    }
  },
  async open(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.anyBusy || this.data.denied || !this.data.sessionVerified) return;
    const id = event.currentTarget.dataset.id;
    const row = this.row(id);
    if (row?.form.busy) return;
    if (row?.status === 'pending' && row.form.dirty) {
      const existing = loadDraft<{ draft: InlineReviewForm['draft']; rewardText: string }>('submission-review', this.listOwnerId, id);
      const existingRevision = getDraftRevision('submission-review', this.listOwnerId, id);
      const ownedCopy = !!this.handoffRevisions?.has(id) && this.handoffRevisions.get(id) === existingRevision;
      if (!existing || ownedCopy) {
        const saved = saveDraft('submission-review', this.listOwnerId, id, row.form.baseVersion, { draft: row.form.draft, targetText: row.form.draft.target ? String(row.form.draft.target) : '', rewardText: row.form.rewardText, reviewNote: '', openSection: 'basic', draftEdited: true, sourceImageIds: row.lead?.imageIds || [], importedLead: false });
        if (!saved) { this.showForm(id, { ...row.form, error: '填写内容暂时无法保存到完整规则页，请重试后再继续。' }); return; }
        this.handoffRevisions ||= new Map(); this.handoffRevisions.set(id, getDraftRevision('submission-review', this.listOwnerId, id));
      } else if (existing.baseVersion !== row.form.baseVersion || existing.value.rewardText !== row.form.rewardText || existing.value.draft.rewardKind !== row.form.draft.rewardKind || JSON.stringify(existing.value.draft.cycle) !== JSON.stringify(row.form.draft.cycle) || existing.value.draft.startsOn !== row.form.draft.startsOn || existing.value.draft.endsOn !== row.form.draft.endsOn) {
        const generation = this.requestGeneration;
        const ownerId = this.listOwnerId;
        this.showForm(id, { ...row.form, busy: true });
        try {
          const choice = await wx.showModal({ title: '发现两份审核草稿', content: '完整规则页已有另一份草稿，奖励、周期或活动时间与本页不同。可查看已有草稿；本页填写仍另行保存在本机，不会被清除。', confirmText: '查看草稿', cancelText: '继续本页' });
          if (!choice.confirm || this.disposed || generation !== this.requestGeneration || ownerId !== this.listOwnerId) return;
        } finally { if (!this.disposed && generation === this.requestGeneration && ownerId === this.listOwnerId && this.row(id)) this.showForm(id, { ...this.row(id)!.form, busy: false }); }
      }
    }
    wx.navigateTo({ url: `/pages/submission-edit/index?id=${encodeURIComponent(id)}&review=1` });
  },
  goBack() { navigateBackOr('/pages/mine/index', true); },
});

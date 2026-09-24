import { api, ensureSession } from '../../services/api';
import type { PageResult, Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { navigateBackOr } from '../../services/navigation';

type ReviewRow = Submission & { bankName: string; dateLabel: string; titleText: string; summaryText: string; isLead: boolean };
Page({
  requestGeneration: 0,
  listOwnerId: '',
  data: { loading: true, loadingMore: false, denied: false, sessionVerified: false, error: '', loadMoreError: '', status: 'pending' as SubmissionStatus, items: [] as ReviewRow[], nextCursor: null as string | null },
  onShow() { void this.load(); },
  onUnload() { this.requestGeneration += 1; },
  async load() {
    const generation = ++this.requestGeneration;
    const status = this.data.status;
    let targetCount = this.data.items.length;
    this.setData({ loading: true, loadingMore: false, sessionVerified: false, error: '', loadMoreError: '' });
    try {
      const session = await ensureSession(true);
      if (generation !== this.requestGeneration || status !== this.data.status) return;
      if (!session.isModerator) { this.setData({ denied: true, items: [], nextCursor: null }); return; }
      if (this.listOwnerId && this.listOwnerId !== session.userId) {
        targetCount = 0;
        this.setData({ items: [], nextCursor: null });
      }
      this.listOwnerId = session.userId;
      this.setData({ denied: false, sessionVerified: true });
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
    } catch (error) {
      if (generation === this.requestGeneration) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN') this.setData({ denied: true, sessionVerified: false, items: [], nextCursor: null });
        else this.setData({ error: error instanceof Error ? error.message : '暂时无法读取审核列表，请重试。' });
      }
    } finally { if (generation === this.requestGeneration) this.setData({ loading: false }); }
  },
  rows(items: Submission[]): ReviewRow[] {
    return items.map(item => ({ ...item, bankName: banks.find(bank => bank.id === (item.draft?.bankId || item.lead?.bankId))?.name || '银行待确认', dateLabel: item.updatedAt.slice(0, 10), titleText: item.draft?.title || item.lead?.title || '活动线索', summaryText: item.draft?.conditions || item.lead?.sourceNote || item.lead?.sourceUrl || `已提供 ${item.lead?.imageIds.length || 0} 张来源图片`, isLead: !item.draft && !!item.lead }));
  },
  changeStatus(event: { currentTarget: { dataset: { status: SubmissionStatus } } }) {
    const status = event.currentTarget.dataset.status;
    if (!['pending', 'returned', 'published'].includes(status) || status === this.data.status) return;
    this.setData({ status, items: [], nextCursor: null });
    void this.load();
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loading || this.data.loadingMore || this.data.denied || !this.data.sessionVerified) return;
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
    } catch (error) {
      if (generation === this.requestGeneration) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN') this.setData({ denied: true, sessionVerified: false, items: [], nextCursor: null });
        else this.setData({ loadMoreError: error instanceof Error ? error.message : '未能读取更多投稿，请重试。' });
      }
    } finally { if (generation === this.requestGeneration) this.setData({ loadingMore: false }); }
  },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.denied || !this.data.sessionVerified) return;
    wx.navigateTo({ url: `/pages/submission-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}&review=1` });
  },
  goBack() { navigateBackOr('/pages/mine/index', true); },
});

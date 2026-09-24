import { api, ensureSession } from '../../services/api';
import type { PageResult, Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';

const statusLabels: Record<SubmissionStatus, string> = { pending: '待审核', returned: '需补充', published: '已发布' };
type SubmissionRow = Submission & { statusLabel: string; bankName: string; dateLabel: string; titleText: string; summaryText: string; isLead: boolean };

Page({
  requestGeneration: 0,
  listOwnerId: '',
  data: { loading: true, loadingMore: false, sessionVerified: false, error: '', loadMoreError: '', items: [] as SubmissionRow[], nextCursor: null as string | null },
  onShow() { void this.load(); },
  onUnload() { this.requestGeneration += 1; },
  async load() {
    const generation = ++this.requestGeneration;
    let targetCount = this.data.items.length;
    this.setData({ loading: true, loadingMore: false, sessionVerified: false, error: '', loadMoreError: '' });
    try {
      const session = await ensureSession(true);
      if (generation !== this.requestGeneration) return;
      if (this.listOwnerId && this.listOwnerId !== session.userId) {
        targetCount = 0;
        this.setData({ items: [], nextCursor: null });
      }
      this.listOwnerId = session.userId;
      this.setData({ sessionVerified: true });
      const items: Submission[] = [];
      const ids = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const result: PageResult<Submission> = await api.query('submissions.list', { limit: targetCount ? Math.min(50, Math.max(1, targetCount - items.length)) : 20, ...(cursor ? { cursor } : {}) });
        if (generation !== this.requestGeneration) return;
        for (const item of result.items) if (!ids.has(item.id)) { ids.add(item.id); items.push(item); }
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('投稿列表暂时未能完整更新，请重试。');
        if (cursor) cursors.add(cursor);
      } while (cursor && items.length < targetCount);
      this.setData({ items: this.rows(items), nextCursor: cursor });
    } catch (error) {
      if (generation === this.requestGeneration) this.setData({ error: error instanceof Error ? error.message : '暂时无法读取投稿，请重试。' });
    } finally { if (generation === this.requestGeneration) this.setData({ loading: false }); }
  },
  rows(items: Submission[]): SubmissionRow[] {
    return items.map(item => ({ ...item, statusLabel: statusLabels[item.status], bankName: banks.find(bank => bank.id === (item.draft?.bankId || item.lead?.bankId))?.name || '银行待确认', dateLabel: item.updatedAt.slice(0, 10), titleText: item.draft?.title || item.lead?.title || '活动线索', summaryText: item.draft?.conditions || item.lead?.sourceNote || item.lead?.sourceUrl || `已提供 ${item.lead?.imageIds.length || 0} 张来源图片`, isLead: !item.draft && !!item.lead }));
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loading || this.data.loadingMore || !this.data.sessionVerified) return;
    const generation = this.requestGeneration;
    const cursor = this.data.nextCursor;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const result = await api.query('submissions.list', { limit: 20, cursor });
      if (generation !== this.requestGeneration || cursor !== this.data.nextCursor) return;
      const existingIds = new Set(this.data.items.map(item => item.id));
      const nextItems = result.items.filter(item => { if (existingIds.has(item.id)) return false; existingIds.add(item.id); return true; });
      this.setData({ items: [...this.data.items, ...this.rows(nextItems)], nextCursor: result.nextCursor });
    } catch (error) {
      if (generation === this.requestGeneration) this.setData({ loadMoreError: error instanceof Error ? error.message : '未能读取更多投稿，请重试。' });
    } finally { if (generation === this.requestGeneration) this.setData({ loadingMore: false }); }
  },
  create() { wx.navigateTo({ url: '/pages/submission-lead/index' }); },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    if (!this.data.sessionVerified) return;
    const item = this.data.items.find(row => row.id === event.currentTarget.dataset.id);
    if (!item) return;
    wx.navigateTo({ url: `/pages/${item.isLead ? 'submission-lead' : 'submission-edit'}/index?id=${encodeURIComponent(item.id)}` });
  },
});

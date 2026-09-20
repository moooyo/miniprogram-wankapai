import { api, ensureSession } from '../../services/api';
import type { Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';

type ReviewRow = Submission & { bankName: string; dateLabel: string; titleText: string; summaryText: string; isLead: boolean };
Page({
  requestGeneration: 0,
  data: { loading: true, loadingMore: false, denied: false, error: '', status: 'pending' as SubmissionStatus, items: [] as ReviewRow[], nextCursor: null as string | null },
  onShow() { void this.load(); },
  onUnload() { this.requestGeneration += 1; },
  async load() {
    const generation = ++this.requestGeneration;
    const status = this.data.status;
    this.setData({ loading: true, loadingMore: false, error: '' });
    try {
      const session = await ensureSession();
      if (generation !== this.requestGeneration || status !== this.data.status) return;
      if (!session.isModerator) { this.setData({ denied: true, items: [], nextCursor: null }); return; }
      const result = await api.query('submissions.list', { moderation: true, status, limit: 20 });
      if (generation !== this.requestGeneration || status !== this.data.status) return;
      this.setData({ denied: false, items: this.rows(result.items), nextCursor: result.nextCursor });
    } catch (error) {
      if (generation === this.requestGeneration) this.setData({ error: error instanceof Error ? error.message : '暂时无法读取审核列表，请重试。' });
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
    if (!this.data.nextCursor || this.data.loading || this.data.loadingMore || this.data.denied) return;
    const generation = this.requestGeneration;
    const status = this.data.status;
    const cursor = this.data.nextCursor;
    this.setData({ loadingMore: true, error: '' });
    try {
      const result = await api.query('submissions.list', { moderation: true, status, limit: 20, cursor });
      if (generation !== this.requestGeneration || status !== this.data.status || cursor !== this.data.nextCursor) return;
      const existingIds = new Set(this.data.items.map(item => item.id));
      this.setData({ items: [...this.data.items, ...this.rows(result.items.filter(item => !existingIds.has(item.id)))], nextCursor: result.nextCursor });
    } catch (error) {
      if (generation === this.requestGeneration) this.setData({ error: error instanceof Error ? error.message : '未能读取更多投稿，请重试。' });
    } finally { if (generation === this.requestGeneration) this.setData({ loadingMore: false }); }
  },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.denied) return;
    wx.navigateTo({ url: `/pages/submission-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}&review=1` });
  },
  goBack() { wx.navigateBack({ delta: 1 }); },
});

import { api, ensureSession } from '../../services/api';
import type { Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';

type ReviewRow = Submission & { bankName: string; dateLabel: string };
Page({
  data: { loading: true, loadingMore: false, denied: false, error: '', status: 'pending' as SubmissionStatus, items: [] as ReviewRow[], nextCursor: null as string | null },
  onShow() { void this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await ensureSession();
      if (!session.isModerator) { this.setData({ denied: true, items: [], nextCursor: null }); return; }
      const result = await api.query('submissions.list', { moderation: true, status: this.data.status, limit: 20 });
      this.setData({ denied: false, items: this.rows(result.items), nextCursor: result.nextCursor });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '暂时无法读取审核列表，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  rows(items: Submission[]): ReviewRow[] {
    return items.map(item => ({ ...item, bankName: banks.find(bank => bank.id === item.draft.bankId)?.name || '银行待确认', dateLabel: item.updatedAt.slice(0, 10) }));
  },
  changeStatus(event: { currentTarget: { dataset: { status: SubmissionStatus } } }) {
    if (this.data.loading || event.currentTarget.dataset.status === this.data.status) return;
    this.setData({ status: event.currentTarget.dataset.status, items: [], nextCursor: null });
    void this.load();
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.denied) return;
    this.setData({ loadingMore: true, error: '' });
    try {
      const result = await api.query('submissions.list', { moderation: true, status: this.data.status, limit: 20, cursor: this.data.nextCursor });
      this.setData({ items: [...this.data.items, ...this.rows(result.items)], nextCursor: result.nextCursor });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '未能读取更多投稿，请重试。' }); }
    finally { this.setData({ loadingMore: false }); }
  },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.denied) return;
    wx.navigateTo({ url: `/pages/submission-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}&review=1` });
  },
  goBack() { wx.navigateBack({ delta: 1 }); },
});

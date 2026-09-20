import { api, ensureSession } from '../../services/api';
import type { Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';

const statusLabels: Record<SubmissionStatus, string> = { pending: '待审核', returned: '需补充', published: '已发布' };
type SubmissionRow = Submission & { statusLabel: string; bankName: string; dateLabel: string };

Page({
  data: { loading: true, loadingMore: false, error: '', items: [] as SubmissionRow[], nextCursor: null as string | null },
  onShow() { void this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await ensureSession();
      const result = await api.query('submissions.list', { limit: 20 });
      this.setData({ items: this.rows(result.items), nextCursor: result.nextCursor });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '暂时无法读取投稿，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  rows(items: Submission[]): SubmissionRow[] {
    return items.map(item => ({ ...item, statusLabel: statusLabels[item.status], bankName: banks.find(bank => bank.id === item.draft.bankId)?.name || '银行待确认', dateLabel: item.updatedAt.slice(0, 10) }));
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true, error: '' });
    try {
      const result = await api.query('submissions.list', { limit: 20, cursor: this.data.nextCursor });
      this.setData({ items: [...this.data.items, ...this.rows(result.items)], nextCursor: result.nextCursor });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '未能读取更多投稿，请重试。' }); }
    finally { this.setData({ loadingMore: false }); }
  },
  create() { wx.navigateTo({ url: '/pages/submission-edit/index' }); },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/submission-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
});

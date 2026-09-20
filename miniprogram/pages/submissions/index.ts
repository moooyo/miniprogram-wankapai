import { api, ensureSession } from '../../services/api';
import type { Submission, SubmissionStatus } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';

const statusLabels: Record<SubmissionStatus, string> = { pending: '待审核', returned: '需补充', published: '已发布' };
type SubmissionRow = Submission & { statusLabel: string; bankName: string; dateLabel: string; titleText: string; summaryText: string; isLead: boolean };

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
    return items.map(item => ({ ...item, statusLabel: statusLabels[item.status], bankName: banks.find(bank => bank.id === (item.draft?.bankId || item.lead?.bankId))?.name || '银行待确认', dateLabel: item.updatedAt.slice(0, 10), titleText: item.draft?.title || item.lead?.title || '活动线索', summaryText: item.draft?.conditions || item.lead?.sourceNote || item.lead?.sourceUrl || `已提供 ${item.lead?.imageIds.length || 0} 张来源图片`, isLead: !item.draft && !!item.lead }));
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
  create() { wx.navigateTo({ url: '/pages/submission-lead/index' }); },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    const item = this.data.items.find(row => row.id === event.currentTarget.dataset.id);
    if (!item) return;
    wx.navigateTo({ url: `/pages/${item.isLead ? 'submission-lead' : 'submission-edit'}/index?id=${encodeURIComponent(item.id)}` });
  },
});

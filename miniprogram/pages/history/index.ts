import { AuditEvent, Bank, Participation } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, stageLabel, showError } from '../../services/format';

const auditNames: Record<string, string> = {
  'activity.join': '加入活动', 'activity.untrack': '停止后续追踪',
  'participation.progress': '修改参与进度', 'participation.complete': '标记完成',
  'participation.undoComplete': '撤销完成', 'participation.skip': '调整本期参与',
  'participation.expected': '修改预计到账日', 'reward.confirm': '确认或更正到账',
  'reward.revoke': '撤销到账', 'join': '加入活动', 'progress': '修改参与进度',
  'complete': '标记完成', 'undoComplete': '撤销完成', 'skip': '跳过本期',
  'resume': '恢复参加', 'expected': '修改预计到账日', 'received': '确认到账',
  'revoke': '撤销到账', 'untrack': '停止后续追踪',
  'participation.created': '建立本期记录', 'tracking.enabled': '加入待办与追踪',
  'tracking.disabled': '停止后续追踪', 'participation.completed': '标记完成',
  'participation.completion_reverted': '撤销完成', 'participation.skipped': '本期不参加',
  'participation.resumed': '恢复参加', 'participation.expected_date': '修改预计到账日',
  'reward.confirmed': '确认到账', 'reward.corrected': '更正到账', 'reward.revoked': '撤销到账',
};

function auditTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16) : value;
}

function auditDescription(event: AuditEvent, record: Participation | null): string {
  const before = event.before as Partial<Participation> | undefined;
  const after = event.after as Partial<Participation> | undefined;
  if (event.action === 'participation.progress' && after && record) {
    return `${before?.progress || 0} → ${after.progress || 0} ${record.snapshot.unit}${after.registeredAt ? ' · 已报名' : ''}`;
  }
  if (['reward.confirmed', 'reward.corrected'].includes(event.action) && after?.receivedMinor !== undefined && after.receivedMinor !== null && record) {
    return `${money(after.receivedMinor, record.snapshot.currency)} · ${after.receivedOn || ''}`;
  }
  if (event.action === 'participation.expected_date') return after?.expectedOn ? `预计 ${after.expectedOn} 到账` : '已清除预计到账日';
  return '';
}

function recordView(record: Participation, cardNames: Record<string, string>) {
  const bank = banks.find((item: Bank) => item.id === record.snapshot.bankId);
  return {
    id: record.id, activityId: record.activityId, title: record.snapshot.title,
    period: periodLabel(record.periodKey), stage: record.stage, stageLabel: stageLabel(record.stage),
    logo: bank?.logo || '', bankName: bank?.shortName || '银行',
    amount: money(record.receivedMinor ?? record.snapshot.rewardMinor, record.snapshot.currency),
    amountLabel: record.stage === 'received' ? '实际到账' : '预计收益',
    receivedOn: record.receivedOn || '', expectedOn: record.expectedOn || '', endsOn: record.endsOn,
    progress: `${record.progress} / ${record.snapshot.target} ${record.snapshot.unit}`,
    cardName: record.cardId ? cardNames[record.cardId] || '已移除的卡片' : '',
  };
}

Page({
  data: {
    activityId: '', filter: 'all' as 'all' | 'pending' | 'unfinished',
    items: [] as ReturnType<typeof recordView>[], cardNames: {} as Record<string, string>,
    cursor: null as string | null, loading: true, loadingMore: false, error: '', requestSequence: 0,
    showAudit: false, auditLoading: false, auditTitle: '', auditError: '',
    audit: [] as { id: string; label: string; at: string; description: string }[],
  },
  onLoad(options: Record<string, string>) { this.setData({ activityId: options.activityId || '' }); },
  onShow() { void this.load(true); },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.cursor && !this.data.loading && !this.data.loadingMore) void this.load(false); },
  async load(reset = true) {
    const sequence = this.data.requestSequence + 1;
    this.setData({ loading: reset, loadingMore: !reset, error: '', requestSequence: sequence });
    try {
      await ensureSession();
      const [records, wallet] = await Promise.all([
        api.query('history.list', { activityId: this.data.activityId || undefined, filter: this.data.filter, cursor: reset ? undefined : this.data.cursor || undefined, limit: 30 }),
        api.query('wallet.get', {}),
      ]);
      if (sequence !== this.data.requestSequence) return;
      const cardNames: Record<string, string> = {};
      wallet.cards.forEach(card => { cardNames[card.id] = card.nickname || `${banks.find((bank: Bank) => bank.id === card.bankId)?.shortName || ''}${card.kind === 'credit' ? '信用卡' : '储蓄卡'}`; });
      const items = records.items.map(record => recordView(record, cardNames));
      this.setData({ cardNames, items: reset ? items : this.data.items.concat(items), cursor: records.nextCursor });
    } catch (error) { if (sequence === this.data.requestSequence) this.setData({ error: '参与记录暂时没有加载成功，请重试。' }); showError(error); }
    finally { if (sequence === this.data.requestSequence) this.setData({ loading: false, loadingMore: false }); }
  },
  chooseFilter(event: any) {
    const filter = event.currentTarget.dataset.filter as 'all' | 'pending' | 'unfinished';
    this.setData({ filter });
    void this.load(true);
  },
  openRecord(event: any) {
    const { id, activity } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(activity)}&participationId=${encodeURIComponent(id)}` });
  },
  async openAudit(event: any) {
    const { id, activity, title } = event.currentTarget.dataset;
    this.setData({ showAudit: true, auditLoading: true, auditTitle: title, auditError: '', audit: [] });
    try {
      const detail = await api.query('activity.get', { activityId: activity, participationId: id });
      this.setData({ audit: detail.audit.map((item: AuditEvent) => ({ id: item.id, label: auditNames[item.action] || '更新参与记录', at: auditTime(item.at), description: auditDescription(item, detail.participation) })) });
    } catch (error) { this.setData({ auditError: '操作记录未加载成功，请关闭后重试。' }); showError(error); }
    finally { this.setData({ auditLoading: false }); }
  },
  closeAudit() { this.setData({ showAudit: false }); },
  retry() { void this.load(true); },
  loadMore() { if (this.data.cursor) void this.load(false); },
});

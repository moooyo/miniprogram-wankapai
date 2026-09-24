import { AuditEvent, Bank, Participation } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, stageLabel, showError } from '../../services/format';
import { cardLabel, cardLabels } from '../../services/card-labels';
import { benefitCopy } from '../../services/benefit-copy';

const auditNames: Record<string, string> = {
  'activity.join': '加入活动', 'activity.untrack': '停止后续追踪',
  'participation.progress': '修改参与进度', 'participation.complete': '标记完成',
  'participation.undoComplete': '撤销完成', 'participation.skip': '调整本期参与',
  'join': '加入活动', 'progress': '修改参与进度',
  'complete': '标记完成', 'undoComplete': '撤销完成', 'skip': '跳过本期',
  'resume': '恢复参加', 'untrack': '停止后续追踪',
  'participation.created': '建立本期记录', 'tracking.enabled': '加入待办与追踪',
  'tracking.disabled': '停止后续追踪', 'participation.completed': '标记完成',
  'participation.completion_reverted': '撤销完成', 'participation.skipped': '本期不参加',
  'participation.resumed': '恢复参加',
};

function progressAudit(event: AuditEvent, record: Participation | null): { label: string; description: string } | null {
  if (!['participation.progress', 'progress'].includes(event.action)) return null;
  const before = event.before as Partial<Participation> | undefined;
  const after = event.after as Partial<Participation> | undefined;
  const progressOf = (value: Partial<Participation> | undefined) => typeof value?.progress === 'number' && Number.isFinite(value.progress) ? value.progress : null;
  const registrationOf = (value: Partial<Participation> | undefined): boolean | null => {
    if (value?.registeredAt === null || value?.registeredAt === '') return false;
    return typeof value?.registeredAt === 'string' && value.registeredAt.length > 0 ? true : null;
  };
  const previousProgress = progressOf(before), nextProgress = progressOf(after);
  const previousRegistration = registrationOf(before), nextRegistration = registrationOf(after);
  const progressChanged = previousProgress !== null && nextProgress !== null && previousProgress !== nextProgress;
  const registrationChanged = previousRegistration !== null && nextRegistration !== null && previousRegistration !== nextRegistration;
  const registrationLabel = (registered: boolean) => registered ? '已报名' : '未报名';
  const unit = record?.snapshot.unit || after?.snapshot?.unit || before?.snapshot?.unit || '';
  const suffix = unit ? ` ${unit}` : '';
  const parts: string[] = [];
  if (previousProgress !== null && nextProgress !== null) {
    parts.push(progressChanged ? `进度：${previousProgress} → ${nextProgress}${suffix}` : `进度仍为 ${nextProgress}${suffix}`);
  } else if (nextProgress !== null) parts.push(`更新后进度：${nextProgress}${suffix}`);
  else if (previousProgress !== null) parts.push(`原进度：${previousProgress}${suffix}`);
  if (previousRegistration !== null && nextRegistration !== null) {
    parts.push(registrationChanged
      ? `报名标记：${registrationLabel(previousRegistration)} → ${registrationLabel(nextRegistration)}`
      : `报名标记保持${registrationLabel(nextRegistration)}`);
  } else if (nextRegistration !== null) parts.push(`更新后报名标记：${registrationLabel(nextRegistration)}`);
  else if (previousRegistration !== null) parts.push(`原报名标记：${registrationLabel(previousRegistration)}`);
  return {
    label: registrationChanged ? progressChanged ? '修改进度与报名标记' : nextRegistration ? '记录已报名' : '取消报名标记' : '修改参与进度',
    description: parts.join(' · '),
  };
}

function auditLabel(event: AuditEvent, record: Participation | null): string {
  const progress = progressAudit(event, record);
  if (progress) return progress.label;
  const copy = benefitCopy(record?.snapshot.rewardKind);
  if (['participation.expected', 'participation.expected_date', 'expected'].includes(event.action)) return `修改预计${copy.dateLabel}`;
  if (event.action === 'reward.confirm') return copy.isDiscount ? '记录或更正优惠' : '确认或更正到账';
  if (['reward.confirmed', 'received'].includes(event.action)) return copy.recordAction;
  if (event.action === 'reward.corrected') return copy.editAction;
  if (['reward.revoke', 'reward.revoked', 'revoke'].includes(event.action)) return copy.revokeAction;
  return auditNames[event.action] || '更新参与记录';
}

function auditTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16) : value;
}

function auditDescription(event: AuditEvent, record: Participation | null): string {
  const progress = progressAudit(event, record);
  if (progress) return progress.description;
  const copy = benefitCopy(record?.snapshot.rewardKind);
  const after = event.after as Partial<Participation> | undefined;
  if (['reward.confirm', 'reward.confirmed', 'reward.corrected', 'received'].includes(event.action) && after?.receivedMinor !== undefined && after.receivedMinor !== null && record) {
    return `${copy.actualLabel} ${money(after.receivedMinor, record.snapshot.currency)}${after.receivedOn ? ` · ${copy.dateLabel} ${after.receivedOn}` : ''}`;
  }
  if (['participation.expected', 'participation.expected_date', 'expected'].includes(event.action)) return after?.expectedOn ? `预计 ${after.expectedOn} ${copy.dateEvent}` : `已清除预计${copy.dateLabel}`;
  return '';
}

function recordView(record: Participation, cardNames: Record<string, string>) {
  const bank = banks.find((item: Bank) => item.id === record.snapshot.bankId);
  const copy = benefitCopy(record.snapshot.rewardKind);
  return {
    id: record.id, activityId: record.activityId, title: record.snapshot.title,
    period: periodLabel(record.periodKey), stage: record.stage, stageLabel: stageLabel(record),
    logo: bank?.logo || '', bankName: bank?.shortName || '银行',
    amount: money(record.receivedMinor ?? record.snapshot.rewardMinor, record.snapshot.currency),
    amountLabel: record.stage === 'received' ? copy.actualLabel : copy.expectedLabel,
    dateLabel: copy.dateLabel, dateEvent: copy.dateEvent,
    receivedOn: record.receivedOn || '', expectedOn: record.expectedOn || '', endsOn: record.endsOn,
    progress: `${record.progress} / ${record.snapshot.target} ${record.snapshot.unit}`,
    cardName: record.cardId ? cardNames[record.cardId] || cardLabel(record.cardId, []) : '',
  };
}

Page({
  data: {
    activityId: '', filter: 'all' as 'all' | 'pending' | 'unfinished', showRecordHelp: false,
    items: [] as ReturnType<typeof recordView>[], cardNames: {} as Record<string, string>,
    cursor: null as string | null, loading: true, loadingMore: false, error: '', loadMoreError: '', requestSequence: 0,
    showAudit: false, auditLoading: false, auditTitle: '', auditError: '',
    auditRecordId: '', auditActivityId: '', auditSequence: 0,
    audit: [] as { id: string; label: string; at: string; description: string }[],
  },
  disposed: false,
  onUnload() { this.disposed = true; this.data.requestSequence += 1; this.data.auditSequence += 1; },
  onLoad(options: Record<string, string>) {
    this.setData({ activityId: options.activityId || '' });
    if (!options.activityId) wx.setNavigationBarTitle({ title: '全部参与记录' });
  },
  onShow() { void this.load(true); },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.cursor && !this.data.loading && !this.data.loadingMore && !this.data.loadMoreError) void this.load(false); },
  async load(reset = true) {
    if (this.disposed || (!reset && (this.data.loading || this.data.loadingMore || !this.data.cursor))) return;
    const sequence = this.data.requestSequence + 1;
    const targetCount = reset ? this.data.items.length : 0;
    const query = { activityId: this.data.activityId || undefined, filter: this.data.filter,
      cursor: reset ? undefined : this.data.cursor || undefined, limit: 30 };
    this.setData({ loading: reset, loadingMore: !reset, error: '', loadMoreError: '', requestSequence: sequence });
    try {
      await ensureSession();
      if (this.disposed || sequence !== this.data.requestSequence) return;
      const [firstPage, wallet] = await Promise.all([
        api.query('history.list', query),
        api.query('wallet.get', {}),
      ]);
      if (this.disposed || sequence !== this.data.requestSequence) return;
      const cardNames = cardLabels(wallet.cards);
      const merged = new Map((reset ? [] : this.data.items).map(item => [item.id, item]));
      const visited = new Set<string>(query.cursor ? [query.cursor] : []);
      let records = firstPage;
      while (true) {
        records.items.map(record => recordView(record, cardNames)).forEach(item => merged.set(item.id, item));
        if (!reset || merged.size >= targetCount || !records.nextCursor) break;
        const cursor = records.nextCursor;
        if (visited.has(cursor)) throw new Error('参与记录分页未能继续，请重试。');
        visited.add(cursor);
        records = await api.query('history.list', { ...query, cursor });
        if (this.disposed || sequence !== this.data.requestSequence) return;
      }
      this.setData({ cardNames, items: [...merged.values()], cursor: records.nextCursor });
    } catch (error) {
      if (!this.disposed && sequence === this.data.requestSequence) {
        this.setData(reset ? { error: '参与记录暂时没有加载成功，请重试。' } : { loadMoreError: '更多记录未加载成功，已显示的记录仍可查看。' });
        showError(error);
      }
    }
    finally { if (!this.disposed && sequence === this.data.requestSequence) this.setData({ loading: false, loadingMore: false }); }
  },
  toggleRecordHelp() { this.setData({ showRecordHelp: !this.data.showRecordHelp }); },
  chooseFilter(event: any) {
    const filter = event.currentTarget.dataset.filter as 'all' | 'pending' | 'unfinished';
    if (filter === this.data.filter) return;
    this.setData({ filter, items: [], cursor: null });
    void this.load(true);
  },
  openRecord(event: any) {
    const { id, activity } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(activity)}&participationId=${encodeURIComponent(id)}` });
  },
  async openAudit(event: any) {
    const { id, activity, title } = event.currentTarget.dataset;
    this.setData({ showAudit: true, auditTitle: title, auditRecordId: id, auditActivityId: activity, auditError: '', audit: [] });
    await this.loadAudit();
  },
  async loadAudit() {
    if (this.disposed || !this.data.showAudit || !this.data.auditRecordId) return;
    const sequence = this.data.auditSequence + 1;
    const query = { activityId: this.data.auditActivityId, participationId: this.data.auditRecordId };
    this.setData({ auditSequence: sequence, auditLoading: true, auditError: '' });
    try {
      const detail = await api.query('activity.get', query);
      if (this.disposed || sequence !== this.data.auditSequence || !this.data.showAudit) return;
      this.setData({ audit: detail.audit.map((item: AuditEvent) => ({ id: item.id, label: auditLabel(item, detail.participation), at: auditTime(item.at), description: auditDescription(item, detail.participation) })) });
    } catch (error) {
      if (!this.disposed && sequence === this.data.auditSequence && this.data.showAudit) {
        this.setData({ auditError: '操作记录未加载成功，请重试。' }); showError(error);
      }
    }
    finally { if (!this.disposed && sequence === this.data.auditSequence) this.setData({ auditLoading: false }); }
  },
  closeAudit() { this.setData({ showAudit: false, auditLoading: false, auditSequence: this.data.auditSequence + 1 }); },
  retry() { void this.load(true); },
  loadMore() { if (this.data.cursor) void this.load(false); },
});

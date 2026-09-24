import { Dashboard, Participation } from '../../../shared/contracts';
import { banks } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { money, periodLabel, stageLabel, showError, today } from '../../services/format';
import { cardLabel } from '../../services/card-labels';
import { benefitCopy } from '../../services/benefit-copy';
import { addDays, periodFor } from '../../../domain/calendar';

type Filter = 'unfinished' | 'completed' | 'all';
type TaskAction = 'progress' | 'complete' | 'receipt' | 'detail' | 'resume';
type TaskGroup = 'overdue' | 'soon' | 'later' | '';
interface TaskRow {
  id: string; activityId: string; title: string; bank: string; logo: string;
  dateDay: string; dateMonth: string; deadline: string; period: string; showPeriod: boolean; status: string; progress: string;
  reward: string; rewardLabel: string; estimate: string; cardName: string; closed: boolean; skipped: boolean; late: boolean; pending: boolean;
  primaryAction: TaskAction; primaryLabel: string; resultNote: string;
  groupKey: TaskGroup; groupTitle: string; groupCount: number; showGroupTitle: boolean;
}

function nextAction(record: Participation): TaskAction {
  if (record.stage === 'received') return 'detail';
  if (record.stage === 'skipped') return 'resume';
  if (record.stage === 'completed' || record.snapshot.rewardKind === 'discount') return 'receipt';
  return record.snapshot.target > 1 && record.progress < record.snapshot.target ? 'progress' : 'complete';
}

function recordPeriodLabel(record: Participation): string {
  const label = periodLabel(record.periodKey);
  return record.periodKey === 'once' ? `${label} · ${record.startsOn} 至 ${record.endsOn}` : label;
}

Page({
  data: {
    loading: true, refreshing: false, refreshError: '', outdated: false, mutationNotice: '', failed: false, busyId: '', filter: 'unfinished' as Filter,
    closingOnly: false, monthLabel: '', dateLabel: '', tasks: [] as TaskRow[],
    raw: null as Dashboard | null, unfinishedCount: 0, completedCount: 0,
    allCount: 0, pendingCount: 0, nearestBill: '', billCount: 0,
    showActions: false, actionId: '', actionTitle: '', actionStage: '', actionCardName: '', actionPeriod: '', actionDeadline: '',
    actionReceiptLabel: '', actionCanComplete: false, actionCanProgress: false,
  },
  loadVersion: 0,
  disposed: false,
  onUnload() { this.disposed = true; this.loadVersion += 1; },
  onShow() { void this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    if (this.disposed) return;
    const version = ++this.loadVersion;
    this.setData({ loading: !this.data.raw, refreshing: !!this.data.raw, refreshError: '', failed: false, showActions: false });
    try {
      await ensureSession();
      if (this.disposed || version !== this.loadVersion) return;
      const raw = await api.query('dashboard.get', {});
      if (this.disposed || version !== this.loadVersion) return;
      const date = raw.today || today();
      const openBills = raw.bills.filter(bill => !bill.paidAt).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
      this.setData({ raw, outdated: false, mutationNotice: '', dateLabel: `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`,
        monthLabel: `${Number(date.slice(5, 7))} 月底前截止`, pendingCount: raw.pendingRewards.length,
        nearestBill: openBills[0] ? `${Number(openBills[0].dueOn.slice(5, 7))}/${Number(openBills[0].dueOn.slice(8))}` : '',
        billCount: openBills.length });
      this.applyFilter();
    } catch (error) {
      if (!this.disposed && version === this.loadVersion) {
        if (this.data.raw) this.setData({ outdated: true, refreshError: `${this.data.mutationNotice}待办尚未更新，以下为上次读取的记录。请刷新成功后再操作。` });
        else { this.setData({ failed: true }); showError(error); }
      }
    }
    finally { if (!this.disposed && version === this.loadVersion) this.setData({ loading: false, refreshing: false }); }
  },
  actionsBlocked(): boolean { return this.disposed || !this.data.raw || this.data.refreshing || this.data.outdated || !!this.data.busyId; },
  applyFilter() {
    const raw = this.data.raw;
    if (!raw) return;
    const closed = (p: Participation) => p.stage === 'completed' || p.stage === 'received';
    const unfinished = (p: Participation) => !closed(p) && p.stage !== 'skipped';
    const date = raw.today || today();
    const soonUntil = addDays(date, 7);
    let visible = raw.tasks.filter(p => this.data.filter === 'all' || (this.data.filter === 'completed' ? closed(p) : unfinished(p)));
    if (this.data.filter === 'unfinished' && this.data.closingOnly) visible = visible.filter(p => p.endsOn.slice(0, 7) <= date.slice(0, 7));
    visible.sort((a, b) => a.endsOn.localeCompare(b.endsOn) || a.snapshot.title.localeCompare(b.snapshot.title) || a.id.localeCompare(b.id));
    const tasks: TaskRow[] = visible.map(p => {
      const bank = banks.find(b => b.id === p.snapshot.bankId);
      const remaining = Math.max(0, p.snapshot.target - p.progress);
      const copy = benefitCopy(p.snapshot.rewardKind);
      const primaryAction = nextAction(p);
      const primaryLabel = primaryAction === 'progress' ? '更新进度' : primaryAction === 'complete' ? '标记完成' : primaryAction === 'receipt' ? copy.recordAction : primaryAction === 'resume' ? '恢复参与' : '查看记录';
      const groupKey: TaskGroup = this.data.filter !== 'unfinished' ? '' : p.endsOn < date ? 'overdue' : p.endsOn <= soonUntil ? 'soon' : 'later';
      const groupTitle = groupKey === 'overdue' ? '已逾期' : groupKey === 'soon' ? '未来7天内截止' : groupKey === 'later' ? '其他活动' : '';
      const currentPeriod = periodFor(p.snapshot, date);
      return { id: p.id, activityId: p.activityId, title: p.snapshot.title,
        bank: bank?.shortName || '', logo: bank?.logo || '', dateDay: String(Number(p.endsOn.slice(8))),
        dateMonth: `${Number(p.endsOn.slice(5, 7))}月`, deadline: p.endsOn,
        period: recordPeriodLabel(p), showPeriod: currentPeriod?.periodKey !== p.periodKey || p.startsOn.slice(0, 4) !== p.endsOn.slice(0, 4),
        status: stageLabel(p), progress: remaining > 0 ? `还差 ${remaining} ${p.snapshot.unit}` : '目标已达成',
        reward: money(p.stage === 'received' ? p.receivedMinor ?? p.snapshot.rewardMinor : p.snapshot.rewardMinor, p.snapshot.currency),
        rewardLabel: p.stage === 'received' ? copy.actualLabel : copy.expectedLabel,
        estimate: p.stage === 'received' && p.receivedMinor !== null && p.receivedMinor !== p.snapshot.rewardMinor ? money(p.snapshot.rewardMinor, p.snapshot.currency) : '',
        cardName: cardLabel(p.cardId, raw.cards || []), closed: closed(p), skipped: p.stage === 'skipped',
        late: unfinished(p) && p.endsOn < date, pending: p.stage === 'completed', primaryAction, primaryLabel,
        resultNote: p.stage === 'skipped' ? '本期已跳过，可恢复参与' : p.stage === 'received' ? (copy.isDiscount ? '优惠已计入实际享受的月份' : '返现已计入实际到账月份') : p.stage === 'completed' ? (copy.isDiscount ? '已享受优惠后，记录实际金额' : '收到返现后，再确认金额与日期') : '',
        groupKey, groupTitle, groupCount: 0, showGroupTitle: false };
    });
    const groupCounts = { overdue: 0, soon: 0, later: 0, '': 0 };
    tasks.forEach(task => { groupCounts[task.groupKey] += 1; });
    tasks.forEach((task, index) => {
      task.groupCount = groupCounts[task.groupKey];
      task.showGroupTitle = !!task.groupKey && (index === 0 || tasks[index - 1].groupKey !== task.groupKey);
    });
    this.setData({
      unfinishedCount: raw.tasks.filter(unfinished).length,
      completedCount: raw.tasks.filter(closed).length,
      allCount: raw.tasks.length,
      tasks,
    });
  },
  selectFilter(event: WechatMiniprogram.TouchEvent) {
    this.setData({ filter: event.currentTarget.dataset.filter as Filter });
    this.applyFilter();
  },
  toggleClosing(event: WechatMiniprogram.SwitchChange) {
    if (this.data.filter !== 'unfinished') return;
    this.setData({ closingOnly: event.detail.value });
    this.applyFilter();
  },
  openTask(event: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    const row = this.data.raw?.tasks.find(item => item.id === event.currentTarget.dataset.id);
    this.setData({ showActions: false });
    if (row) wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(row.activityId)}&participationId=${encodeURIComponent(row.id)}` });
  },
  async runPrimaryAction(event: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    const row = this.data.raw?.tasks.find(item => item.id === event.currentTarget.dataset.id);
    if (!row) return;
    const action = nextAction(row);
    if (action === 'progress') this.editProgress(event);
    else if (action === 'complete') await this.complete(event);
    else if (action === 'receipt') this.receipt(event);
    else if (action === 'resume') await this.toggleSkip(event);
    else this.openTask(event);
  },
  editProgress(event: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    const id = event.currentTarget.dataset.id || this.data.actionId;
    const row = this.data.raw?.tasks.find(item => item.id === id);
    if (!row || ['completed', 'received', 'skipped'].includes(row.stage)) return;
    this.setData({ showActions: false });
    wx.navigateTo({ url: `/pages/progress/index?id=${encodeURIComponent(row.id)}&activityId=${encodeURIComponent(row.activityId)}` });
  },
  receipt(event: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    const id = event.currentTarget.dataset.id || this.data.actionId;
    const row = this.data.raw?.tasks.find(item => item.id === id);
    this.setData({ showActions: false });
    if (row && row.stage !== 'skipped') wx.navigateTo({ url: `/pages/receipt/index?activityId=${encodeURIComponent(row.activityId)}&id=${encodeURIComponent(row.id)}` });
  },
  async complete(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id || this.data.actionId;
    if (!id || this.actionsBlocked()) return;
    const row = this.data.raw?.tasks.find(item => item.id === id);
    if (!row || row.stage === 'skipped') return;
    this.setData({ busyId: id, showActions: false });
    try {
      await api.command('participation.complete', { participationId: id });
      if (this.disposed) return;
      this.setData({ mutationNotice: '完成状态已保存。' });
      wx.showToast({ title: benefitCopy(row.snapshot.rewardKind).completedToast, icon: 'none' });
      await this.load();
    } catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ busyId: '' }); }
  },
  showMore(event: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    const row = this.data.raw?.tasks.find(item => item.id === event.currentTarget.dataset.id);
    if (row) {
      const copy = benefitCopy(row.snapshot.rewardKind);
      const unfinished = !['completed', 'received', 'skipped'].includes(row.stage);
      this.setData({ showActions: true, actionId: row.id, actionTitle: row.snapshot.title, actionStage: row.stage,
        actionPeriod: recordPeriodLabel(row), actionDeadline: row.endsOn,
        actionCardName: cardLabel(row.cardId, this.data.raw?.cards || []), actionCanComplete: unfinished, actionCanProgress: unfinished,
        actionReceiptLabel: row.stage === 'completed' ? copy.recordAction : copy.completeAndRecordAction });
    }
  },
  closeActions() { this.setData({ showActions: false }); },
  async toggleSkip(event?: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    const id = event?.currentTarget.dataset.id || this.data.actionId;
    const row = this.data.raw?.tasks.find(item => item.id === id);
    if (!row || ['completed', 'received'].includes(row.stage)) return;
    const skipped = row.stage !== 'skipped';
    this.setData({ busyId: id, showActions: false });
    try {
      await api.command('participation.skip', { participationId: id, skipped });
      if (this.disposed) return;
      this.setData({ mutationNotice: skipped ? '本期跳过状态已保存。' : '本期参与已恢复。' });
      wx.showToast({ title: skipped ? '本期已跳过' : '已恢复本期参与', icon: 'none' });
      await this.load();
    } catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ busyId: '' }); }
  },
  async undoComplete() {
    if (this.actionsBlocked()) return;
    const id = this.data.actionId;
    const row = this.data.raw?.tasks.find(item => item.id === id);
    if (!row || row.stage !== 'completed') return;
    this.setData({ busyId: id, showActions: false });
    try {
      await api.command('participation.undoComplete', { participationId: id });
      if (this.disposed) return;
      this.setData({ mutationNotice: '撤销完成已保存。' });
      wx.showToast({ title: '已撤销完成', icon: 'none' });
      await this.load();
    }
    catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ busyId: '' }); }
  },
  browse() { wx.switchTab({ url: '/pages/activities/index' }); },
  openHistory() { wx.navigateTo({ url: '/pages/history/index' }); },
  openRewards() {
    wx.setStorageSync('rewards.initialTab', 'pending');
    wx.switchTab({ url: '/pages/rewards/index' });
  },
  openWallet() { wx.switchTab({ url: '/pages/wallet/index' }); },
});

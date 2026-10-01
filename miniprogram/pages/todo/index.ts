import { Currency, Dashboard, Participation } from '../../../shared/contracts';
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
interface FocusTask extends TaskRow {
  bankLine: string; progressText: string; progressPct: number; segments: { active: boolean }[]; isSegment: boolean;
  rewardKind: string; deadlineLabel: string; hint: string;
}
interface UpcomingRow {
  id: string; kind: 'activity' | 'bill'; title: string; note: string; logo: string; reward: string;
  dateTop: string; dateSub: string; today: boolean; late: boolean; done: boolean; deadline: string;
}

function daysUntil(date: string, deadline: string): number {
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

function deadlineCopy(date: string, deadline: string, event: string) {
  const days = daysUntil(date, deadline);
  return { dateTop: days === 0 ? '今天' : String(Math.abs(days)),
    dateSub: days === 0 ? event : days < 0 ? `天前${event}` : `天后${event}`, today: days === 0, late: days < 0 };
}

function shortDate(date: string): string { return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`; }

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
    showManager: false, focusIndex: 0, focusTasks: [] as FocusTask[], focusTask: null as FocusTask | null,
    focusPosition: '', headline: '', upcoming: [] as UpcomingRow[], upcomingCount: 0,
    incomeMonth: '', incomeCny: '—', incomeOther: '按币种分别统计', incomeReady: false, pendingShort: '',
  },
  loadVersion: 0,
  disposed: false,
  onUnload() { this.disposed = true; this.loadVersion += 1; },
  onShow() { void this.load().then(() => this.loadIncome()); },
  async onPullDownRefresh() { await this.load(); await this.loadIncome(); wx.stopPullDownRefresh(); },
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
      const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()];
      const lastDay = addDays(date, 1).slice(0, 7) !== date.slice(0, 7);
      this.setData({ raw, outdated: false, mutationNotice: '', dateLabel: `${shortDate(date)} ${weekday}${lastDay ? ' · 本月最后一天' : ''}`,
        incomeMonth: `${Number(date.slice(5, 7))}月已获得`,
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
    const mapTask = (p: Participation): TaskRow => {
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
        reward: money(p.stage === 'received' ? p.receivedMinor ?? p.snapshot.rewardMinor : p.snapshot.rewardMinor, p.snapshot.currency, p.snapshot.rewardKind),
        rewardLabel: p.stage === 'received' ? copy.actualLabel : copy.expectedLabel,
        estimate: p.stage === 'received' && p.receivedMinor !== null && p.receivedMinor !== p.snapshot.rewardMinor ? money(p.snapshot.rewardMinor, p.snapshot.currency, p.snapshot.rewardKind) : '',
        cardName: cardLabel(p.cardId, raw.cards || []), closed: closed(p), skipped: p.stage === 'skipped',
        late: unfinished(p) && p.endsOn < date, pending: p.stage === 'completed', primaryAction, primaryLabel,
        resultNote: p.stage === 'skipped' ? '本期已跳过，可恢复参与' : p.stage === 'received' ? (copy.isDiscount ? '优惠已计入实际享受的月份' : p.snapshot.rewardKind === 'cashback' ? '返现已计入实际到账月份' : '奖励已计入实际获得的月份') : p.stage === 'completed' ? copy.pendingDescription : '',
        groupKey, groupTitle, groupCount: 0, showGroupTitle: false };
    };
    const tasks: TaskRow[] = visible.map(mapTask);
    const groupCounts = { overdue: 0, soon: 0, later: 0, '': 0 };
    tasks.forEach(task => { groupCounts[task.groupKey] += 1; });
    tasks.forEach((task, index) => {
      task.groupCount = groupCounts[task.groupKey];
      task.showGroupTitle = !!task.groupKey && (index === 0 || tasks[index - 1].groupKey !== task.groupKey);
    });
    const focusTasks = raw.tasks.filter(unfinished).slice().sort((a, b) => a.endsOn.localeCompare(b.endsOn) || a.id.localeCompare(b.id)).map(p => {
      const task = mapTask(p);
      const isSegment = Number.isInteger(p.snapshot.target) && p.snapshot.target > 1 && p.snapshot.target <= 8;
      const days = daysUntil(date, p.endsOn);
      return { ...task, bankLine: task.cardName || task.bank,
        progressText: `${p.progress} / ${p.snapshot.target} ${p.snapshot.unit}`, progressPct: Math.min(100, Math.max(0, p.progress / p.snapshot.target * 100)),
        isSegment, segments: isSegment ? Array.from({ length: p.snapshot.target }, (_, index) => ({ active: index < p.progress })) : [],
        rewardKind: { cashback: '返现', discount: '立减优惠', voucher: '券码', points: '积分', gift: '实物礼' }[p.snapshot.rewardKind],
        deadlineLabel: days < 0 ? `${shortDate(p.endsOn)} 已截止 · 可补记本期结果` : days === 0 ? '今天截止 · 请在银行端完成实际消费' : `${shortDate(p.endsOn)} 截止 · 还有 ${days} 天`,
        hint: p.snapshot.requiresRegistration && !p.registeredAt ? '尚未报名，请先在银行端完成报名' : task.progress };
    });
    const focusIndex = focusTasks.length ? ((this.data.focusIndex % focusTasks.length) + focusTasks.length) % focusTasks.length : 0;
    const focusTask = focusTasks[focusIndex] || null;
    const upcoming: UpcomingRow[] = raw.tasks.filter(p => p.stage !== 'skipped' && p.id !== focusTask?.id).map(p => {
      const task = mapTask(p);
      const arrival = p.stage === 'completed' && p.snapshot.rewardKind !== 'discount' && !!p.expectedOn;
      const deadline = arrival ? p.expectedOn! : p.endsOn;
      const benefit = benefitCopy(p.snapshot.rewardKind);
      const note = p.stage === 'received' ? `${task.rewardLabel} ${task.reward}` : p.stage === 'completed' ? (arrival ? `预计 ${shortDate(deadline)} ${benefit.dateEvent}` : benefit.pendingDescription) : task.progress;
      return { id: p.id, kind: 'activity' as const, title: task.title, note: task.showPeriod ? `${task.period} · ${note}` : note, logo: task.logo, reward: task.reward,
        ...deadlineCopy(date, deadline, arrival ? benefit.dateEvent : '截止'), done: p.stage === 'received', deadline };
    });
    raw.bills.forEach(bill => {
      const account = raw.accounts.find(item => item.id === bill.billingAccountId);
      const bank = banks.find(item => item.id === account?.bankId);
      upcoming.push({ id: bill.id, kind: 'bill', title: `${account?.label || bank?.shortName || '信用卡'}还款`,
        note: bill.paidAt ? '本期已还清' : `${shortDate(bill.dueOn)}前完成还款`, logo: bank?.logo || '', reward: bill.paidAt ? '已还清' : '还款',
        ...deadlineCopy(date, bill.dueOn, '还款'), done: !!bill.paidAt, deadline: bill.dueOn });
    });
    upcoming.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.id.localeCompare(b.id));
    const pendingAmounts: Record<Currency, number> = { CNY: 0, HKD: 0, MOP: 0 };
    let pendingPoints = 0;
    raw.pendingRewards.forEach(p => {
      if (p.snapshot.rewardKind === 'points') pendingPoints += p.snapshot.rewardMinor;
      else pendingAmounts[p.snapshot.currency] += p.snapshot.rewardMinor;
    });
    const pendingValues = (['CNY', 'HKD', 'MOP'] as Currency[]).filter(currency => pendingAmounts[currency] > 0).map(currency => money(pendingAmounts[currency], currency));
    if (pendingPoints > 0) pendingValues.push(money(pendingPoints, 'CNY', 'points'));
    const todayCount = focusTasks.filter(task => task.deadline === date).length;
    this.setData({
      unfinishedCount: raw.tasks.filter(unfinished).length,
      completedCount: raw.tasks.filter(closed).length,
      allCount: raw.tasks.length,
      tasks, focusTasks, focusTask, focusIndex, focusPosition: focusTasks.length ? `${focusIndex + 1} / ${focusTasks.length}` : '',
      headline: todayCount ? `今日还有 ${todayCount} 个活动截止` : focusTasks.length ? `${focusTasks.length} 个活动正在参加` : '今日待办已全部完成',
      upcoming, upcomingCount: upcoming.filter(item => !item.done).length,
      pendingShort: pendingValues.join(' · ') || (raw.pendingRewards.length ? '待确认奖励' : '暂无待确认'),
    });
  },
  async loadIncome() {
    if (this.disposed || !this.data.raw || this.data.failed) return;
    const version = this.loadVersion;
    const month = (this.data.raw.today || today()).slice(0, 7);
    try {
      const [cny, hkd, mop] = await Promise.all((['CNY', 'HKD', 'MOP'] as Currency[]).map(currency => api.query('rewards.get', { month, currency, limit: 1 })));
      if (this.disposed || version !== this.loadVersion) return;
      this.setData({ incomeReady: true, incomeCny: money(cny.totalMinor, 'CNY'),
        incomeOther: `${money(hkd.totalMinor, 'HKD')} · ${money(mop.totalMinor, 'MOP')}` });
    } catch {
      if (!this.disposed && version === this.loadVersion) this.setData({ incomeReady: false, incomeCny: '—', incomeOther: '进入收益页查看完整记录' });
    }
  },
  changeFocus(event: WechatMiniprogram.TouchEvent) {
    const direction = Number(event.currentTarget.dataset.direction) || 1;
    if (!this.data.focusTasks.length) return;
    this.setData({ focusIndex: this.data.focusIndex + direction });
    this.applyFilter();
  },
  toggleManager() { this.setData({ showManager: !this.data.showManager }); },
  openUpcoming(event: WechatMiniprogram.TouchEvent) {
    if (this.actionsBlocked()) return;
    if (event.currentTarget.dataset.kind === 'bill') this.openWallet();
    else this.openTask(event);
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
  openIncome() { wx.navigateTo({ url: '/pages/rewards/index' }); },
  openRewards() {
    wx.setStorageSync('rewards.initialTab', 'pending');
    wx.navigateTo({ url: '/pages/rewards/index' });
  },
  openWallet() { wx.switchTab({ url: '/pages/wallet/index' }); },
});

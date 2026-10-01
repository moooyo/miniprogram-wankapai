import { Bill, BillingAccount, Card, Currency, Dashboard, EntitlementList, Wallet } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession, requestReminder } from '../../services/api';
import { money, periodLabel, showError } from '../../services/format';
import { cardLabel, cardNeedsNickname } from '../../services/card-labels';
import { EntitlementRow, countedEntitlement, currentEntitlement, entitlementKindLabels, entitlementRow, pointsText, sumPointsBalance } from '../../services/entitlement-view';

const networkLabels: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', unionpay: '银联', amex: 'American Express', other: '其他卡组织' };
interface CardRow { id: string; title: string; description: string; bank: string; logo: string; issuer: string; credit: boolean; needsNickname: boolean; }
interface BillRow { id: string; dueOn: string; dateLabel: string; statementDateLabel: string; compactDueDate: string; period: string; paid: boolean; late: boolean; reminderExpired: boolean; amountText: string; amountMinor: number | null; currency: Currency; }
interface AccountGroup { id: string; title: string; logo: string; identity: string; subtitle: string; cards: CardRow[]; primaryCardId: string; bills: BillRow[]; primaryBill: BillRow | null; otherBills: BillRow[]; statement: string; expanded: boolean; archived: boolean; settledArchive: boolean; reminderAvailable: boolean; }
interface StackCard extends CardRow { color: string; network: string; kindLabel: string; dueLabel: string; dueDate: string; dueAmount: string; dueChip: string; dueSoon: boolean; dueOn: string; groupId: string; perkCount: number; activityCount: number | null; }
interface PerkKind { value: string; label: string; count: number; remaining: number; stat: string; sub: string; }
type WalletPerkRow = EntitlementRow & { logo: string };
interface CardActivityRow { id: string; activityId: string; title: string; scopeLabel: string; progress: string; status: string; }
const cardColors: Record<string, string> = { cmb: '#B3302A', hsbc: '#3A3430', boc: '#8A2C2C', icbc: '#A3362E', ccb: '#2B4C7E', abc: '#2F6B5B', bocom: '#34467A', citic: '#94392F', spdb: '#3A5889', cib: '#2A5A86', pab: '#B4501E', psbc: '#2E6A49' };
const primaryPerkKinds = ['lounge', 'delay_insurance', 'airport_transfer', 'health_check', 'car_wash', 'points'];
function billAmountInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  const cents = String(minor % 100).padStart(2, '0');
  return String(Math.floor(minor / 100)) + (cents === '00' ? '' : `.${cents.replace(/0$/, '')}`);
}

function archivedAccountIdentity(account: BillingAccount, accounts: BillingAccount[], cards: Card[]): string {
  const describe = (target: BillingAccount) => {
    const ownedCards = cards.filter(card => card.ownerId === target.ownerId);
    const linkedCards = ownedCards.filter(card => card.billingAccountId === target.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const names = linkedCards.map(card => cardLabel(card.id, ownedCards).replace(/（已移除）$/, '')).join('、');
    return { id: target.id, label: target.label.trim() || names || '信用卡账单', names, createdAt: linkedCards[0]?.createdAt || '' };
  };
  const current = describe(account);
  const peers = accounts.filter(item => item.ownerId === account.ownerId && item.bankId === account.bankId && item.issuerId === account.issuerId)
    .map(describe).filter(item => item.label === current.label);
  if (peers.length < 2) return current.label;
  const withCards = (item: ReturnType<typeof describe>) => item.names && item.names !== item.label ? `${item.label} · 原卡：${item.names}` : item.label;
  const label = withCards(current);
  const duplicates = peers.filter(item => withCards(item) === label)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return duplicates.length > 1 ? `${label} · 同名账单${duplicates.findIndex(item => item.id === account.id) + 1}` : label;
}

function billReminderEligible(bill: Bill | undefined, accounts: BillingAccount[], serverToday: string, repaymentEnabled: boolean | null): boolean {
  return !!bill && !!serverToday && !bill.paidAt && bill.dueOn >= serverToday && repaymentEnabled === true
    && accounts.some(account => account.id === bill.billingAccountId && account.ownerId === bill.ownerId && account.enabled);
}

Page({
  data: { loading: true, refreshing: false, refreshError: '', outdated: false, failed: false, busyId: '', reminderBusyId: '', reminderNoticeId: '', reminderNotice: '', demo: false, serverToday: '', repaymentEnabled: null as boolean | null, cardCount: 0, bankCount: 0, groups: [] as AccountGroup[], looseCards: [] as CardRow[], namingCards: [] as CardRow[], raw: null as Wallet | null,
    segment: 'cards', stackCards: [] as StackCard[], selectedCard: null as StackCard | null, selectedGroup: null as AccountGroup | null, cardSheet: false, showBills: false, pendingBillCount: 0,
    perks: null as EntitlementList | null, perkCount: 0, perkKind: 'lounge', perkKindLabel: '贵宾厅', perkKinds: [] as PerkKind[], perkRows: [] as WalletPerkRow[], perkError: '', otherPerkCount: 0,
    billAmountInput: '', billAmountTargetId: '', billCurrencyIndex: 0, billCurrencies: [{ value: 'CNY', label: '人民币 CNY' }, { value: 'HKD', label: '港币 HKD' }, { value: 'MOP', label: '澳门币 MOP' }], billAmountError: '', showBillControls: false,
    dashboard: null as Dashboard | null, selectedPerkRows: [] as WalletPerkRow[], selectedActivities: [] as CardActivityRow[],
  },
  loadVersion: 0,
  onShow() { void this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load(forceSession = false) {
    const version = ++this.loadVersion;
    this.setData({ loading: !this.data.raw, refreshing: !!this.data.raw, refreshError: '', failed: false });
    try {
      const session = await ensureSession(forceSession === true);
      const [raw, preferences, perks, dashboard] = await Promise.all([
        api.query('wallet.get', {}),
        api.query('preferences.get', {}).catch(() => null),
        api.query('entitlements.list', {}).catch(() => null),
        api.query('dashboard.get', {}).catch(() => null),
      ]);
      if (version !== this.loadVersion) return;
      const cards = raw.cards.filter(card => !card.archivedAt);
      const liveAccounts = raw.accounts.filter(account => account.enabled && cards.some(card => card.billingAccountId === account.id));
      const visibleAccounts = raw.accounts.filter(account => liveAccounts.some(live => live.id === account.id) || raw.bills.some(bill => bill.billingAccountId === account.id));
      const groups = visibleAccounts.map(account => this.accountGroup(account, cards, raw.bills, raw.cards, raw.accounts, session.today)).sort((a, b) => {
        const left = a.primaryBill, right = b.primaryBill;
        return Number(!!left?.paid) - Number(!!right?.paid) || (left?.dueOn || '9999').localeCompare(right?.dueOn || '9999');
      });
      const attached = new Set(liveAccounts.map(account => account.id));
      const notifiedBill = raw.bills.find(bill => bill.id === this.data.reminderNoticeId);
      const previousNotifiedBill = this.data.raw?.bills.find(bill => bill.id === this.data.reminderNoticeId);
      const keepReminderNotice = billReminderEligible(notifiedBill, raw.accounts, session.today, preferences?.repayments ?? null)
        && notifiedBill?.dueOn === previousNotifiedBill?.dueOn && notifiedBill?.ownerId === previousNotifiedBill?.ownerId
        && notifiedBill?.billingAccountId === previousNotifiedBill?.billingAccountId;
      this.setData({ raw, groups, outdated: false, demo: session.demo, serverToday: session.today, repaymentEnabled: preferences?.repayments ?? null, cardCount: cards.length, bankCount: new Set(cards.map(card => card.bankId)).size,
        reminderNoticeId: keepReminderNotice ? this.data.reminderNoticeId : '', reminderNotice: keepReminderNotice ? this.data.reminderNotice : '',
        namingCards: cards.map(card => this.cardRow(card, raw.cards)).filter(card => card.needsNickname),
        looseCards: cards.filter(card => !card.billingAccountId || !attached.has(card.billingAccountId)).map(card => this.cardRow(card, raw.cards)) });
      const visiblePerks = perks && perks.items.every(item => item.ownerId === session.userId) && perks.cards.every(card => card.ownerId === session.userId) ? perks : null;
      const stackCards = cards.map(card => {
        const group = groups.find(item => item.id === card.billingAccountId), bill = group?.primaryBill;
        const days = bill ? Math.round((Date.parse(bill.dueOn + 'T00:00:00Z') - Date.parse(session.today + 'T00:00:00Z')) / 86400000) : 999;
        return { ...this.cardRow(card, raw.cards), color: cardColors[card.bankId] || '#315D88', network: networkLabels[card.network] || card.network,
          kindLabel: card.kind === 'credit' ? '信用卡' : '借记卡', dueLabel: bill ? bill.paid ? '本期已标记还款' : '本期待还' : card.kind === 'credit' ? '未设置还款计划' : '无需还款',
          dueAmount: bill ? bill.amountText : card.kind === 'credit' ? '待填写' : '—',
          dueDate: bill?.dateLabel || '匹配活动与权益', dueOn: bill?.dueOn || '9999', dueSoon: !!bill && !bill.paid && days <= 7,
          dueChip: days < 0 ? '还款日已过' : days === 0 ? '今日还款' : `${days} 天后还款`, groupId: group?.id || '',
          perkCount: visiblePerks?.items.filter(item => item.cardId === card.id && !item.archivedAt).length || 0,
          activityCount: dashboard ? new Set([...dashboard.tasks, ...dashboard.pendingRewards].filter(item => item.cardId === card.id && item.ownerId === session.userId).map(item => item.id)).size : null };
      }).sort((left, right) => left.dueOn.localeCompare(right.dueOn));
      const selectedCard = stackCards.find(card => card.id === this.data.selectedCard?.id) || null;
      this.setData({ stackCards, perks: visiblePerks, dashboard: dashboard && [...dashboard.tasks, ...dashboard.pendingRewards].every(item => item.ownerId === session.userId) ? dashboard : null,
        perkCount: visiblePerks?.items.filter(item => !item.archivedAt).length || 0,
        perkError: visiblePerks ? '' : '权益资料暂未读取，可进入持有权益重新加载。', pendingBillCount: raw.bills.filter(bill => !bill.paidAt).length,
        selectedCard, selectedGroup: groups.find(group => group.id === selectedCard?.groupId) || null, cardSheet: !!selectedCard && this.data.cardSheet });
      this.updatePerks();
      this.updateCardDetails();
    } catch (error) {
      if (version === this.loadVersion) {
        if (this.data.raw) this.setData({ outdated: true, refreshError: '卡包尚未更新，以下为上次读取的记录。请刷新成功后再修改账单。' });
        else { this.setData({ failed: true }); showError(error); }
      }
    }
    finally { if (version === this.loadVersion) this.setData({ loading: false, refreshing: false }); }
  },
  cardRow(card: Card, cards: Card[]): CardRow {
    const bank = banks.find(item => item.id === card.bankId);
    const issuer = issuers.find(item => item.id === card.issuerId);
    const description = `${networkLabels[card.network] || card.network} ${card.kind === 'credit' ? '信用卡' : '借记卡'}`;
    return { id: card.id, title: cardLabel(card.id, cards), description: card.nickname ? description : '',
      bank: bank?.name || '', logo: bank?.logo || '', issuer: issuer?.name || '', credit: card.kind === 'credit',
      needsNickname: cardNeedsNickname(card.id, cards) };
  },
  billRow(bill: Bill, serverToday: string): BillRow {
    const reminderExpired = !bill.paidAt && bill.dueOn < serverToday;
    const amountMinor = typeof bill.amountMinor === 'number' && Number.isSafeInteger(bill.amountMinor) && bill.amountMinor >= 0 ? bill.amountMinor : null;
    return { id: bill.id, dueOn: bill.dueOn, dateLabel: `${Number(bill.dueOn.slice(5, 7))} 月 ${Number(bill.dueOn.slice(8))} 日`,
      statementDateLabel: bill.statementOn ? `${Number(bill.statementOn.slice(5, 7))}月${Number(bill.statementOn.slice(8))}日` : '待填写', compactDueDate: `${Number(bill.dueOn.slice(5, 7))}月${Number(bill.dueOn.slice(8))}日`,
      period: periodLabel(bill.periodKey), paid: !!bill.paidAt, late: reminderExpired, reminderExpired,
      amountText: amountMinor === null ? '待填写' : money(amountMinor, bill.currency || 'CNY'), amountMinor, currency: bill.currency || 'CNY' };
  },
  accountGroup(account: BillingAccount, cards: Card[], bills: Bill[], allCards: Card[], allAccounts: BillingAccount[], serverToday: string): AccountGroup {
    const members = cards.filter(card => card.billingAccountId === account.id);
    const bank = banks.find(item => item.id === account.bankId);
    const issuer = issuers.find(item => item.id === account.issuerId);
    const accountBills = bills.filter(bill => bill.billingAccountId === account.id).sort((a, b) => Number(!!a.paidAt) - Number(!!b.paidAt) || (a.paidAt && b.paidAt ? b.dueOn.localeCompare(a.dueOn) : a.dueOn.localeCompare(b.dueOn))).map(bill => this.billRow(bill, serverToday));
    const cardRows = members.map(card => this.cardRow(card, allCards));
    const archived = !account.enabled || members.length === 0;
    const settledArchive = archived && accountBills.every(bill => bill.paid);
    return { id: account.id, title: issuer?.name || bank?.name || account.label, logo: bank?.logo || '',
      identity: archived ? archivedAccountIdentity(account, allAccounts, allCards) : '',
      subtitle: archived ? settledArchive ? '历史账单均已标记还款' : '卡片已移除，待还账单继续保留' : members.length > 1 ? `${members.length} 张卡共用账单` : cardRows[0]?.title || account.label,
      cards: cardRows, primaryCardId: members[0]?.id || '', bills: accountBills,
      primaryBill: accountBills[0] || null, otherBills: accountBills.slice(1),
      statement: !account.enabled ? '账户已停用，不再生成新账单或发送微信提醒。历史账单仍可标记还款和修改日期。' : archived ? '账户已归档，不再生成新账单。' : `每月 ${account.statementDay} 日出账 · 微信提醒时间为还款日前 ${account.remindDays} 天，需单独授权。`,
      expanded: this.data.groups.find(group => group.id === account.id)?.expanded || false, archived, settledArchive, reminderAvailable: account.enabled };
  },
  addCard() { wx.navigateTo({ url: '/pages/card-edit/index' }); },
  changeSegment(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busyId || this.data.reminderBusyId) return;
    this.setData({ segment: event.currentTarget.dataset.value === 'perks' ? 'perks' : 'cards' });
  },
  changePerkKind(event: WechatMiniprogram.TouchEvent) { this.setData({ perkKind: event.currentTarget.dataset.value }); this.updatePerks(); },
  updatePerks() {
    const raw = this.data.perks;
    const labels: Record<string, string> = { ...entitlementKindLabels, lounge: '贵宾厅' };
    this.setData({ perkKindLabel: labels[this.data.perkKind], otherPerkCount: raw?.items.filter(item => item.kind === 'other' && !item.archivedAt).length || 0,
      perkKinds: primaryPerkKinds.map(value => {
        const items = raw?.items.filter(item => item.kind === value && currentEntitlement(item, raw.today)) || [];
        const remaining = items.filter(countedEntitlement).reduce((total, item) => total + item.totalUses - item.usedUses, 0);
        const points = value === 'points' ? sumPointsBalance(items) : '0';
        return { value, label: labels[value], count: items.length, remaining,
          stat: !raw ? '待读取' : value === 'points' ? points === null ? '余额待填写' : `${pointsText(points)} 分` : value === 'delay_insurance' ? `${new Set(items.map(item => item.cardId).filter(Boolean)).size} 张卡` : `${remaining} 次可用`,
          sub: !raw ? '权益资料暂未读取' : value === 'points' ? `${items.length} 项余额记录` : value === 'delay_insurance' ? `${items.length} 项保障说明` : `${items.length} 项当前可用` };
      }), perkRows: raw?.items.filter(item => item.kind === this.data.perkKind && !item.archivedAt).map(item => {
        const card = raw.cards.find(value => value.id === item.cardId);
        return { ...entitlementRow(item, raw.cards, raw.today), logo: banks.find(bank => bank.id === card?.bankId)?.logo || '' };
      }) || [] });
  },
  addEntitlement() { wx.navigateTo({ url: `/pages/entitlement-edit/index?kind=${encodeURIComponent(this.data.perkKind)}` }); },
  updateCardDetails() {
    const selectedCard = this.data.selectedCard, raw = this.data.raw, perks = this.data.perks, dashboard = this.data.dashboard;
    const card = raw?.cards.find(item => item.id === selectedCard?.id);
    const rows = perks?.items.filter(item => item.cardId === selectedCard?.id && !item.archivedAt).map(item => ({ ...entitlementRow(item, perks.cards, perks.today), logo: selectedCard?.logo || '' })) || [];
    const records = dashboard ? [...dashboard.tasks, ...dashboard.pendingRewards] : [];
    const seen = new Set<string>();
    const labels: Record<string, string> = { available: '可以参与', registered: '已报名', in_progress: '进行中', completed: '已达标', received: '已记录奖励', skipped: '已跳过' };
    const selectedActivities = card ? records.filter(record => {
      if (seen.has(record.id)) return false;
      const activity = record.snapshot;
      const matchesCard = record.cardId === card.id;
      const matchesUser = !record.cardId && activity.scope === 'user' && activity.bankId === card.bankId
        && (!activity.issuerIds.length || activity.issuerIds.includes(card.issuerId)) && (!activity.networks.length || activity.networks.includes(card.network))
        && (activity.cardKind === 'any' || activity.cardKind === card.kind);
      if (!matchesCard && !matchesUser) return false;
      seen.add(record.id); return true;
    }).map(record => ({ id: record.id, activityId: record.activityId, title: record.snapshot.title,
      scopeLabel: record.snapshot.scope === 'user' ? '按用户记录，未确认使用本卡' : '已关联这张卡片', progress: `${record.progress} / ${record.snapshot.target}`, status: labels[record.stage] || '' })) : [];
    this.setData({ selectedPerkRows: rows, selectedActivities });
    const bill = this.data.selectedGroup?.primaryBill;
    if ((bill?.id || '') !== this.data.billAmountTargetId) this.setData({ billAmountTargetId: bill?.id || '',
      billAmountInput: billAmountInput(bill?.amountMinor),
      billCurrencyIndex: Math.max(0, this.data.billCurrencies.findIndex(item => item.value === bill?.currency)), billAmountError: '', showBillControls: false });
  },
  registerCardEntitlement() {
    if (!this.data.selectedCard || this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    wx.navigateTo({ url: `/pages/entitlement-edit/index?cardId=${encodeURIComponent(this.data.selectedCard.id)}` });
  },
  toggleBillControls() {
    if (this.data.loading || this.data.refreshing || this.data.busyId || this.data.reminderBusyId) return;
    this.setData({ showBillControls: !this.data.showBillControls });
  },
  openCardActivity(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busyId || this.data.reminderBusyId) return;
    const row = this.data.selectedActivities.find(item => item.id === event.currentTarget.dataset.id);
    if (row) wx.navigateTo({ url: `/pages/detail/index?activityId=${encodeURIComponent(row.activityId)}&participationId=${encodeURIComponent(row.id)}` });
  },
  openCard(event: WechatMiniprogram.TouchEvent) {
    const selectedCard = this.data.stackCards.find(card => card.id === event.currentTarget.dataset.id);
    if (!selectedCard || this.data.busyId || this.data.reminderBusyId) return;
    const selectedGroup = this.data.groups.find(group => group.id === selectedCard.groupId) || null;
    this.setData({ selectedCard, selectedGroup, cardSheet: true, billAmountTargetId: selectedGroup?.primaryBill?.id || '', showBillControls: false,
      billAmountInput: billAmountInput(selectedGroup?.primaryBill?.amountMinor),
      billCurrencyIndex: Math.max(0, this.data.billCurrencies.findIndex(item => item.value === selectedGroup?.primaryBill?.currency)), billAmountError: '' });
    this.updateCardDetails();
  },
  changeBillAmount(event: WechatMiniprogram.Input) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    this.setData({ billAmountInput: event.detail.value, billAmountError: '' });
  },
  changeBillCurrency(event: WechatMiniprogram.PickerChange) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    const index = Number(event.detail.value);
    if (index >= 0 && index < this.data.billCurrencies.length) this.setData({ billCurrencyIndex: index });
  },
  async saveBillAmount() {
    const bill = this.data.selectedGroup?.primaryBill;
    if (!bill || bill.id !== this.data.billAmountTargetId || this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    const input = this.data.billAmountInput.trim(), parts = input.split('.');
    const amountMinor = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    if (!/^\d+(\.\d{1,2})?$/.test(input) || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      this.setData({ billAmountError: '请输入非负金额，最多保留两位小数。' }); return;
    }
    this.setData({ busyId: bill.id, billAmountError: '' });
    try {
      await api.command('bill.update', { id: bill.id, amountMinor, currency: this.data.billCurrencies[this.data.billCurrencyIndex].value as Currency });
      wx.showToast({ title: '账单金额已更新', icon: 'none' }); await this.load();
    } catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  closeCard() { if (!this.data.busyId && !this.data.reminderBusyId) this.setData({ cardSheet: false }); },
  toggleBillManagement() { this.setData({ showBills: !this.data.showBills }); },
  editCard(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    wx.navigateTo({ url: `/pages/card-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  openPreferences() { wx.navigateTo({ url: '/pages/preferences/index' }); },
  openEntitlements(event?: WechatMiniprogram.TouchEvent) {
    if (this.data.busyId || this.data.reminderBusyId) return;
    const id = event?.currentTarget?.dataset?.id;
    wx.navigateTo({ url: `/pages/entitlements/index${id ? `?id=${encodeURIComponent(id)}` : ''}` });
  },
  openLounges() { if (!this.data.busyId && !this.data.reminderBusyId) wx.navigateTo({ url: '/pages/lounges/index' }); },
  toggleGroup(event: WechatMiniprogram.TouchEvent) {
    this.setData({ groups: this.data.groups.map(group => group.id === event.currentTarget.dataset.id ? { ...group, expanded: !group.expanded } : group) });
  },
  async togglePaid(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id;
    const bill = this.data.raw?.bills.find(item => item.id === id);
    if (!bill || this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    this.setData({ busyId: id });
    try {
      await api.command('bill.update', { id, paid: !bill.paidAt });
      wx.showToast({ title: bill.paidAt ? '已撤销还款标记' : '已标记还款', icon: 'none' });
      await this.load();
    } catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  async changeDueDate(event: WechatMiniprogram.PickerChange) {
    const id = event.currentTarget.dataset.id;
    const dueOn = String(event.detail.value);
    if (!id || this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    this.setData({ busyId: id });
    try { await api.command('bill.update', { id, dueOn }); wx.showToast({ title: '本期日期已更新', icon: 'none' }); await this.load(); }
    catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  async requestBillReminder(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id;
    const bill = this.data.raw?.bills.find(item => item.id === id);
    if (this.data.loading || this.data.refreshing || this.data.outdated || this.data.busyId || this.data.reminderBusyId) return;
    const account = this.data.raw?.accounts.find(item => item.id === bill?.billingAccountId);
    if (!bill || bill.paidAt || !account?.enabled) {
      this.setData({ reminderNoticeId: '', reminderNotice: '' });
      if (bill && !bill.paidAt) wx.showToast({ title: account ? '账户已停用，历史账单不提供微信提醒。' : '账单账户暂不可用，请刷新后重试。', icon: 'none' });
      return;
    }
    if (!this.data.serverToday || bill.dueOn < this.data.serverToday) {
      this.setData({ reminderNoticeId: '', reminderNotice: '' });
      wx.showToast({ title: this.data.serverToday ? '已逾期，不补发微信提醒。仍可标记还款和修改日期。' : '当前日期暂未读取，请刷新后重试。', icon: 'none' });
      return;
    }
    const loadVersion = this.loadVersion;
    const requestScope = { ownerId: bill.ownerId, billingAccountId: bill.billingAccountId, dueOn: bill.dueOn };
    this.setData({ reminderBusyId: id, reminderNoticeId: '', reminderNotice: '' });
    try {
      if (!this.data.demo && this.data.repaymentEnabled !== true) {
        if (this.data.repaymentEnabled === null) {
          wx.showToast({ title: '提醒设置暂未读取，请刷新后重试。', icon: 'none' });
          return;
        }
        const result = await wx.showModal({ title: '先开启还款提醒偏好', content: '请在提醒设置开启“信用卡还款”并保存，再回到这笔账单申请本期微信提醒。站内待办会继续保留。', confirmText: '前往设置', cancelText: '暂不开启' });
        if (result.confirm) this.openPreferences();
        return;
      }
      const accepted = await requestReminder('repayment', bill.id);
      const currentBill = this.data.raw?.bills.find(item => item.id === id);
      if (accepted && loadVersion === this.loadVersion && billReminderEligible(currentBill, this.data.raw?.accounts || [], this.data.serverToday, this.data.repaymentEnabled)
        && currentBill?.dueOn === requestScope.dueOn && currentBill?.ownerId === requestScope.ownerId && currentBill?.billingAccountId === requestScope.billingAccountId) {
        this.setData({ reminderNoticeId: id, reminderNotice: '本期微信提醒已申请，下一期需要重新授权。' });
      }
    } catch (error) {
      showError(error);
      if ((error as { code?: string })?.code === 'REMINDER_UNAVAILABLE') await this.load(true);
    }
    finally { this.setData({ reminderBusyId: '' }); }
  },
  browseMine() { wx.setStorageSync('activities.mineOnly', true); wx.switchTab({ url: '/pages/activities/index' }); },
});

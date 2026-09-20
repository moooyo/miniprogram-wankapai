import { Bill, BillingAccount, Card, Wallet } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { periodLabel, showError, today } from '../../services/format';

const networkLabels: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', unionpay: '银联', amex: 'American Express', other: '其他卡组织' };
interface CardRow { id: string; title: string; description: string; bank: string; logo: string; issuer: string; credit: boolean; }
interface BillRow { id: string; dueOn: string; dateLabel: string; period: string; paid: boolean; late: boolean; }
interface AccountGroup { id: string; title: string; logo: string; subtitle: string; cards: CardRow[]; primaryCardId: string; bills: BillRow[]; primaryBill: BillRow | null; otherBills: BillRow[]; statement: string; expanded: boolean; archived: boolean; settledArchive: boolean; }

Page({
  data: { loading: true, failed: false, busyId: '', cardCount: 0, bankCount: 0, groups: [] as AccountGroup[], looseCards: [] as CardRow[], raw: null as Wallet | null },
  onShow() { void this.load(); },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      await ensureSession();
      const raw = await api.query('wallet.get', {});
      const cards = raw.cards.filter(card => !card.archivedAt);
      const liveAccounts = raw.accounts.filter(account => account.enabled && cards.some(card => card.billingAccountId === account.id));
      const visibleAccounts = raw.accounts.filter(account => liveAccounts.some(live => live.id === account.id) || raw.bills.some(bill => bill.billingAccountId === account.id));
      const groups = visibleAccounts.map(account => this.accountGroup(account, cards, raw.bills)).sort((a, b) => {
        const left = a.primaryBill, right = b.primaryBill;
        return Number(!!left?.paid) - Number(!!right?.paid) || (left?.dueOn || '9999').localeCompare(right?.dueOn || '9999');
      });
      const attached = new Set(liveAccounts.map(account => account.id));
      this.setData({ raw, groups, cardCount: cards.length, bankCount: new Set(cards.map(card => card.bankId)).size,
        looseCards: cards.filter(card => !card.billingAccountId || !attached.has(card.billingAccountId)).map(card => this.cardRow(card)) });
    } catch (error) { this.setData({ failed: true }); showError(error); }
    finally { this.setData({ loading: false }); }
  },
  cardRow(card: Card): CardRow {
    const bank = banks.find(item => item.id === card.bankId);
    const issuer = issuers.find(item => item.id === card.issuerId);
    const description = `${networkLabels[card.network] || card.network} ${card.kind === 'credit' ? '信用卡' : '借记卡'}`;
    return { id: card.id, title: card.nickname || description, description: card.nickname ? description : '',
      bank: bank?.name || '', logo: bank?.logo || '', issuer: issuer?.name || '', credit: card.kind === 'credit' };
  },
  billRow(bill: Bill): BillRow {
    return { id: bill.id, dueOn: bill.dueOn, dateLabel: `${Number(bill.dueOn.slice(5, 7))} 月 ${Number(bill.dueOn.slice(8))} 日`,
      period: periodLabel(bill.periodKey), paid: !!bill.paidAt, late: !bill.paidAt && bill.dueOn < today() };
  },
  accountGroup(account: BillingAccount, cards: Card[], bills: Bill[]): AccountGroup {
    const members = cards.filter(card => card.billingAccountId === account.id);
    const bank = banks.find(item => item.id === account.bankId);
    const issuer = issuers.find(item => item.id === account.issuerId);
    const accountBills = bills.filter(bill => bill.billingAccountId === account.id).sort((a, b) => Number(!!a.paidAt) - Number(!!b.paidAt) || (a.paidAt && b.paidAt ? b.dueOn.localeCompare(a.dueOn) : a.dueOn.localeCompare(b.dueOn))).map(bill => this.billRow(bill));
    const cardRows = members.map(card => this.cardRow(card));
    const archived = !account.enabled || members.length === 0;
    const settledArchive = archived && accountBills.every(bill => bill.paid);
    return { id: account.id, title: issuer?.name || bank?.name || account.label, logo: bank?.logo || '',
      subtitle: archived ? settledArchive ? '历史账单均已标记还款' : '卡片已移除，待还账单继续保留' : members.length > 1 ? `${members.length} 张卡共用账单` : cardRows[0]?.title || account.label,
      cards: cardRows, primaryCardId: members[0]?.id || '', bills: accountBills,
      primaryBill: accountBills[0] || null, otherBills: accountBills.slice(1),
      statement: archived ? '账户已归档，不再生成新账单。' : `每月 ${account.statementDay} 日出账 · 提前 ${account.remindDays} 天提醒`,
      expanded: this.data.groups.find(group => group.id === account.id)?.expanded || false, archived, settledArchive };
  },
  addCard() { wx.navigateTo({ url: '/pages/card-edit/index' }); },
  editCard(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/card-edit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  toggleGroup(event: WechatMiniprogram.TouchEvent) {
    this.setData({ groups: this.data.groups.map(group => group.id === event.currentTarget.dataset.id ? { ...group, expanded: !group.expanded } : group) });
  },
  async togglePaid(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id;
    const bill = this.data.raw?.bills.find(item => item.id === id);
    if (!bill || this.data.busyId) return;
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
    if (!id || this.data.busyId) return;
    this.setData({ busyId: id });
    try { await api.command('bill.update', { id, dueOn }); wx.showToast({ title: '本期日期已更新', icon: 'none' }); await this.load(); }
    catch (error) { showError(error); }
    finally { this.setData({ busyId: '' }); }
  },
  browseMine() { wx.setStorageSync('activities.mineOnly', true); wx.switchTab({ url: '/pages/activities/index' }); },
});

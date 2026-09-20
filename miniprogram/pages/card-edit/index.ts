import { Card, Commands, Network, Wallet } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { showError, monthKey } from '../../services/format';

const networks: { value: Network; label: string }[] = [{ value: 'unionpay', label: '银联 UnionPay' }, { value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }, { value: 'amex', label: 'American Express' }, { value: 'other', label: '其他卡组织' }];
interface BillingChoice { id: string; label: string; }

Page({
  data: {
    id: '', editing: false, loading: true, failed: false, saving: false, removing: false,
    banks, bankIndex: 0, issuerOptions: issuers.filter(item => item.bankId === banks[0]?.id), issuerIndex: 0,
    networks, networkIndex: 0, kind: 'credit' as 'credit' | 'debit', nickname: '',
    reminderEnabled: false, billingChoices: [{ id: '', label: '使用独立账单' }] as BillingChoice[], billingIndex: 0,
    sharingNote: '', independentNote: '', days: Array.from({ length: 31 }, (_, i) => i + 1), statementDay: 0,
    dueDay: 0, offsets: ['账单当月', '账单次月'], dueMonthOffset: 1, dueOn: '',
    remindOptions: [0, 1, 3, 5, 7], remindLabels: ['还款当天', '提前 1 天', '提前 3 天', '提前 5 天', '提前 7 天'], remindIndex: 2,
    raw: null as Wallet | null, card: null as Card | null, errors: {} as Record<string, string>,
    currentMonth: '', showCycle: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '', editing: !!options.id });
    wx.setNavigationBarTitle({ title: options.id ? '编辑卡片' : '添加卡片' });
    void this.load();
  },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const session = await ensureSession();
      const raw = await api.query('wallet.get', {});
      const card = this.data.id ? raw.cards.find(item => item.id === this.data.id && !item.archivedAt) : undefined;
      if (this.data.id && !card) throw new Error('这张卡已移出卡包，请返回后重新选择。');
      const bankIndex = Math.max(0, banks.findIndex(item => item.id === card?.bankId));
      const issuerOptions = issuers.filter(item => item.bankId === banks[bankIndex]?.id);
      const issuerIndex = Math.max(0, issuerOptions.findIndex(item => item.id === card?.issuerId));
      const account = raw.accounts.find(item => item.id === card?.billingAccountId && item.enabled);
      const currentMonth = session.month || monthKey();
      const bill = account ? raw.bills.find(item => item.billingAccountId === account.id && item.periodKey === currentMonth) : undefined;
      let remindOptions = this.data.remindOptions;
      if (account && !remindOptions.includes(account.remindDays)) remindOptions = [...remindOptions, account.remindDays].sort((a, b) => a - b);
      this.setData({ raw, card: card || null, currentMonth, bankIndex, issuerOptions, issuerIndex,
        networkIndex: Math.max(0, networks.findIndex(item => item.value === card?.network)), kind: card?.kind || 'credit', nickname: card?.nickname || '',
        reminderEnabled: !!account && card?.kind === 'credit', statementDay: account?.statementDay || 0,
        dueDay: account?.dueDay || 0, dueMonthOffset: account?.dueMonthOffset ?? 1, dueOn: bill?.dueOn || '',
        remindOptions, remindLabels: remindOptions.map(days => days ? `提前 ${days} 天` : '还款当天'),
        remindIndex: Math.max(0, remindOptions.indexOf(account?.remindDays ?? 3)) });
      this.updateBillingChoices(account?.id);
    } catch (error) { this.setData({ failed: true }); showError(error); }
    finally { this.setData({ loading: false }); }
  },
  updateBillingChoices(preferredId?: string) {
    const bank = banks[this.data.bankIndex];
    const issuer = this.data.issuerOptions[this.data.issuerIndex];
    const raw = this.data.raw;
    const card = this.data.card;
    const accountId = preferredId ?? this.data.billingChoices[this.data.billingIndex]?.id ?? '';
    const otherMembers = (id: string) => raw?.cards.filter(item => !item.archivedAt && item.kind === 'credit' && item.id !== card?.id && item.billingAccountId === id) || [];
    const choices: BillingChoice[] = [{ id: '', label: '使用独立账单' }];
    raw?.accounts.filter(account => account.enabled && account.bankId === bank?.id && account.issuerId === issuer?.id && otherMembers(account.id).length > 0).forEach(account => {
      const member = otherMembers(account.id)[0];
      const title = member.nickname || `${networks.find(n => n.value === member.network)?.label || ''}信用卡`;
      choices.push({ id: account.id, label: `与 ${title} 共用账单` });
    });
    const billingIndex = Math.max(0, choices.findIndex(item => item.id === accountId));
    this.setData({ billingChoices: choices, billingIndex,
      independentNote: card?.billingAccountId && otherMembers(card.billingAccountId).length ? '改为独立账单后，仅这张卡使用新设置，其他卡保持原账单。' : '每期单独生成账单，实际还款日期可在卡包中修改。' });
    this.updateSharingNote();
  },
  updateSharingNote() {
    const id = this.data.billingChoices[this.data.billingIndex]?.id;
    const account = this.data.raw?.accounts.find(item => item.id === id);
    const bill = this.data.raw?.bills.find(item => item.billingAccountId === id && item.periodKey === this.data.currentMonth);
    this.setData({ sharingNote: account ? `每月 ${account.statementDay} 日出账${bill ? ` · 本期 ${bill.dueOn} 还款` : ''}。共用账单只登记和提醒一次。` : '' });
  },
  changeBank(event: WechatMiniprogram.PickerChange) {
    if (this.data.editing) return;
    const bankIndex = Number(event.detail.value);
    this.setData({ bankIndex, issuerOptions: issuers.filter(item => item.bankId === banks[bankIndex]?.id), issuerIndex: 0, billingIndex: 0, errors: {} });
    this.updateBillingChoices('');
  },
  changeIssuer(event: WechatMiniprogram.PickerChange) {
    if (this.data.editing) return;
    this.setData({ issuerIndex: Number(event.detail.value), billingIndex: 0, errors: {} }); this.updateBillingChoices('');
  },
  changeNetwork(event: WechatMiniprogram.PickerChange) { this.setData({ networkIndex: Number(event.detail.value) }); },
  changeKind(event: WechatMiniprogram.TouchEvent) { const kind = event.currentTarget.dataset.kind; this.setData({ kind, reminderEnabled: kind === 'credit' && this.data.reminderEnabled, errors: {} }); },
  changeNickname(event: WechatMiniprogram.Input) { this.setData({ nickname: event.detail.value }); },
  toggleReminder(event: WechatMiniprogram.SwitchChange) { this.setData({ reminderEnabled: event.detail.value, errors: {} }); },
  changeBilling(event: WechatMiniprogram.PickerChange) { this.setData({ billingIndex: Number(event.detail.value), errors: {} }); this.updateSharingNote(); },
  changeStatement(event: WechatMiniprogram.PickerChange) { this.setData({ statementDay: Number(event.detail.value) + 1, errors: {} }); },
  changeDueDay(event: WechatMiniprogram.PickerChange) { this.setData({ dueDay: Number(event.detail.value) + 1, errors: {} }); },
  changeOffset(event: WechatMiniprogram.PickerChange) { this.setData({ dueMonthOffset: Number(event.detail.value), errors: {} }); },
  changeRemind(event: WechatMiniprogram.PickerChange) { this.setData({ remindIndex: Number(event.detail.value) }); },
  changeDueDate(event: WechatMiniprogram.PickerChange) {
    const dueOn = String(event.detail.value);
    const next: Record<string, unknown> = { dueOn, errors: {} };
    if (!this.data.dueDay) { next.dueDay = Number(dueOn.slice(8)); next.dueMonthOffset = dueOn.slice(0, 7) === this.data.currentMonth ? 0 : 1; }
    this.setData(next);
  },
  toggleCycle() { this.setData({ showCycle: !this.data.showCycle }); },
  validate(): boolean {
    const errors: Record<string, string> = {};
    const bank = banks[this.data.bankIndex];
    const issuer = this.data.issuerOptions[this.data.issuerIndex];
    if (!bank || !issuer || issuer.bankId !== bank.id) errors.bankId = '请选择银行和对应发卡机构。';
    if (!networks[this.data.networkIndex]) errors.network = '请选择卡组织。';
    if (this.data.nickname.trim().length > 40) errors.nickname = '昵称最多 40 个字。';
    if (this.data.kind === 'credit' && this.data.reminderEnabled && this.data.billingIndex === 0) {
      if (!this.data.statementDay) errors.statementDay = '请选择每月账单日。';
      if (!this.data.dueOn) errors.dueOn = '请按银行账单选择本期实际还款日期。';
      if (!this.data.dueDay) errors.dueDay = '请选择后续每期的常规还款日。';
      if (this.data.dueMonthOffset === 0 && this.data.dueDay < this.data.statementDay) errors.dueMonthOffset = '同月还款不能早于账单日，请改为账单次月。';
      if (this.data.dueOn && this.data.statementDay) {
        const [year, month] = this.data.currentMonth.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const statementOn = `${this.data.currentMonth}-${String(Math.min(this.data.statementDay, daysInMonth)).padStart(2, '0')}`;
        const existingAccount = this.data.card?.billingAccountId;
        const hasOtherMembers = this.data.raw?.cards.some(card => !card.archivedAt && card.id !== this.data.card?.id && card.billingAccountId === existingAccount);
        const existingBill = !hasOtherMembers ? this.data.raw?.bills.find(bill => bill.billingAccountId === existingAccount && bill.periodKey === this.data.currentMonth) : undefined;
        if (this.data.dueOn < (existingBill?.statementOn || statementOn)) errors.dueOn = '还款日期不能早于本期账单日。';
      }
    }
    this.setData({ errors, showCycle: this.data.showCycle || !!errors.dueDay || !!errors.dueMonthOffset });
    if (Object.keys(errors).length) { wx.showToast({ title: '请检查标出的内容', icon: 'none' }); return false; }
    return true;
  },
  async save() {
    if (this.data.saving || this.data.removing || this.data.loading || !this.validate()) return;
    const bank = banks[this.data.bankIndex], issuer = this.data.issuerOptions[this.data.issuerIndex];
    const payload: Commands['card.save'] = { bankId: bank.id, issuerId: issuer.id, network: networks[this.data.networkIndex].value,
      kind: this.data.kind, nickname: this.data.nickname.trim() };
    if (this.data.id) payload.id = this.data.id;
    if (this.data.kind === 'debit' || !this.data.reminderEnabled) payload.billingAccountId = null;
    else if (this.data.billingIndex > 0) payload.billingAccountId = this.data.billingChoices[this.data.billingIndex].id;
    else payload.billing = { statementDay: this.data.statementDay, dueDay: this.data.dueDay, dueMonthOffset: this.data.dueMonthOffset as 0 | 1, dueOn: this.data.dueOn, remindDays: this.data.remindOptions[this.data.remindIndex] };
    this.setData({ saving: true });
    try {
      await api.command('card.save', payload);
      wx.showToast({ title: '卡片已保存', icon: 'success' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wallet/index' }) });
    } catch (error) {
      const failure = error as { field?: string; message?: string };
      if (failure.field) this.setData({ errors: { [failure.field]: failure.message || '请检查此项。' }, showCycle: true });
      showError(error);
    } finally { this.setData({ saving: false }); }
  },
  async remove() {
    if (!this.data.id || this.data.removing || this.data.saving) return;
    const result = await wx.showModal({ title: '移除此卡？', content: '卡片将不再用于匹配新活动。过去的参与、收益和账单记录都会保留。', confirmText: '移除', confirmColor: '#A8442C' });
    if (!result.confirm) return;
    this.setData({ removing: true });
    try { await api.command('card.remove', { id: this.data.id }); wx.showToast({ title: '已移出卡包', icon: 'none' }); wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wallet/index' }) }); }
    catch (error) { showError(error); }
    finally { this.setData({ removing: false }); }
  },
});

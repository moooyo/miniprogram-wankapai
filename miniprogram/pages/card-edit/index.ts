import { Card, Commands, Network, Wallet } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { showError, monthKey } from '../../services/format';
import { confirmDraftRecovery, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';
import { cardLabel, cardNeedsNickname, cardReference } from '../../services/card-labels';

const networks: { value: Network; label: string }[] = [{ value: 'unionpay', label: '银联 UnionPay' }, { value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }, { value: 'amex', label: 'American Express' }, { value: 'other', label: '其他卡组织' }];
interface BillingChoice { id: string; label: string; }
interface CardFormDraft {
  bankId: string; issuerId: string; network: Network; kind: 'credit' | 'debit'; nickname: string;
  reminderEnabled: boolean; billingAccountId: string; statementDay: number; dueDay: number;
  dueMonthOffset: number; dueOn: string; remindDays: number; periodKey: string;
}
const billingFields = ['billing', 'billingAccountId', 'statementDay', 'dueOn', 'dueDay', 'dueMonthOffset', 'remindDays'];
const fieldOrder = ['bankId', 'issuerId', 'kind', 'network', 'nickname', 'billing', 'billingAccountId', 'statementDay', 'dueOn', 'dueMonthOffset', 'dueDay', 'remindDays'];
function isCardFormDraft(value: unknown): value is CardFormDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as CardFormDraft;
  return banks.some(bank => bank.id === draft.bankId)
    && issuers.some(issuer => issuer.id === draft.issuerId && issuer.bankId === draft.bankId)
    && networks.some(network => network.value === draft.network)
    && (draft.kind === 'credit' || draft.kind === 'debit')
    && typeof draft.nickname === 'string' && draft.nickname.length <= 40
    && typeof draft.reminderEnabled === 'boolean' && typeof draft.billingAccountId === 'string'
    && [draft.statementDay, draft.dueDay].every(day => Number.isInteger(day) && day >= 0 && day <= 31)
    && (draft.dueMonthOffset === 0 || draft.dueMonthOffset === 1)
    && typeof draft.dueOn === 'string' && (!draft.dueOn || /^\d{4}-\d{2}-\d{2}$/.test(draft.dueOn))
    && Number.isInteger(draft.remindDays) && draft.remindDays >= 0 && draft.remindDays <= 30
    && typeof draft.periodKey === 'string';
}

Page({
  data: {
    id: '', initialBankId: '', editing: false, loading: true, failed: false, saving: false, removing: false,
    banks, bankIndex: 0, issuerOptions: issuers.filter(item => item.bankId === banks[0]?.id), issuerIndex: 0,
    networks, networkIndex: 0, kind: 'credit' as 'credit' | 'debit', nickname: '',
    reminderEnabled: false, billingChoices: [{ id: '', label: '使用独立账单' }] as BillingChoice[], billingIndex: 0,
    sharingNote: '', independentNote: '', days: Array.from({ length: 31 }, (_, i) => i + 1), statementDay: 0,
    dueDay: 0, offsets: ['账单当月', '账单次月'], dueMonthOffset: 1, dueOn: '',
    remindOptions: [0, 1, 3, 5, 7], remindLabels: ['还款当天', '提前 1 天', '提前 3 天', '提前 5 天', '提前 7 天'], remindIndex: 2,
    raw: null as Wallet | null, card: null as Card | null, errors: {} as Record<string, string>,
    currentMonth: '', showCycle: false, showAdvanced: false, systemReference: '',
    userId: '', draftEntityId: '', draftBaseVersion: '', dirty: false, draftSaved: false,
  },
  disposed: false,
  onUnload() { this.disposed = true; },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '', initialBankId: options.bankId || '', editing: !!options.id });
    wx.setNavigationBarTitle({ title: options.id ? '编辑卡片' : '添加卡片' });
    void this.load();
  },
  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const session = await ensureSession();
      const raw = await api.query('wallet.get', {});
      if (this.disposed) return;
      const card = this.data.id ? raw.cards.find(item => item.id === this.data.id && !item.archivedAt) : undefined;
      if (this.data.id && !card) throw new Error('这张卡已移出卡包，请返回后重新选择。');
      const bankIndex = Math.max(0, banks.findIndex(item => item.id === (card?.bankId || this.data.initialBankId)));
      const issuerOptions = issuers.filter(item => item.bankId === banks[bankIndex]?.id);
      const issuerIndex = Math.max(0, issuerOptions.findIndex(item => item.id === card?.issuerId));
      const account = raw.accounts.find(item => item.id === card?.billingAccountId && item.enabled);
      const currentMonth = session.month || monthKey();
      const bill = account ? raw.bills.find(item => item.billingAccountId === account.id && item.periodKey === currentMonth) : undefined;
      let remindOptions = this.data.remindOptions;
      if (account && !remindOptions.includes(account.remindDays)) remindOptions = [...remindOptions, account.remindDays].sort((a, b) => a - b);
      this.setData({ raw, card: card || null, currentMonth, bankIndex, issuerOptions, issuerIndex,
        userId: session.userId, draftEntityId: this.data.id || `new:${this.data.initialBankId}`, dirty: false, draftSaved: false, errors: {},
        networkIndex: Math.max(0, networks.findIndex(item => item.value === card?.network)), kind: card?.kind || 'credit', nickname: card?.nickname || '',
        reminderEnabled: !!account && card?.kind === 'credit', statementDay: account?.statementDay || 0,
        dueDay: account?.dueDay || 0, dueMonthOffset: account?.dueMonthOffset ?? 1, dueOn: bill?.dueOn || '',
        remindOptions, remindLabels: remindOptions.map(days => days ? `提前 ${days} 天` : '还款当天'),
        remindIndex: Math.max(0, remindOptions.indexOf(account?.remindDays ?? 3)) });
      this.updateBillingChoices(account?.id);
      this.setData({ draftBaseVersion: JSON.stringify(this.formDraft()), systemReference: card ? cardReference(card.id, raw.cards) : '' });
      await this.restoreDraft();
    } catch (error) { if (!this.disposed) { this.setData({ failed: true }); showError(error); } }
    finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  formDraft(): CardFormDraft {
    return {
      bankId: banks[this.data.bankIndex]?.id || '', issuerId: this.data.issuerOptions[this.data.issuerIndex]?.id || '',
      network: networks[this.data.networkIndex]?.value || 'unionpay', kind: this.data.kind, nickname: this.data.nickname,
      reminderEnabled: this.data.reminderEnabled, billingAccountId: this.data.billingChoices[this.data.billingIndex]?.id || '',
      statementDay: this.data.statementDay, dueDay: this.data.dueDay, dueMonthOffset: this.data.dueMonthOffset,
      dueOn: this.data.dueOn, remindDays: this.data.remindOptions[this.data.remindIndex], periodKey: this.data.currentMonth,
    };
  },
  markChanged() {
    if (this.disposed) return;
    const draft = this.formDraft();
    if (JSON.stringify(draft) === this.data.draftBaseVersion) { this.clearDraft(); return; }
    const draftSaved = saveDraft('card', this.data.userId, this.data.draftEntityId, this.data.draftBaseVersion, draft);
    this.setData({ dirty: true, draftSaved });
    wx.enableAlertBeforeUnload({ message: draftSaved ? '卡片尚未保存，离开后可从本机草稿继续。' : '卡片尚未保存，离开后修改将丢失。' });
  },
  clearDraft(expectedRevision?: string | null) {
    removeDraft('card', this.data.userId, this.data.draftEntityId, expectedRevision);
    if (this.disposed) return;
    this.setData({ dirty: false, draftSaved: false });
    wx.disableAlertBeforeUnload();
  },
  async restoreDraft() {
    if (this.disposed) return;
    const saved = loadDraft<CardFormDraft>('card', this.data.userId, this.data.draftEntityId);
    if (!saved) return;
    if (!isCardFormDraft(saved.value) || JSON.stringify(saved.value) === this.data.draftBaseVersion) {
      removeDraft('card', this.data.userId, this.data.draftEntityId); return;
    }
    const recover = await confirmDraftRecovery(saved, this.data.draftBaseVersion);
    if (this.disposed) return;
    if (!recover) {
      removeDraft('card', this.data.userId, this.data.draftEntityId); return;
    }
    const draft = saved.value;
    const bankIndex = this.data.editing ? this.data.bankIndex : banks.findIndex(bank => bank.id === draft.bankId);
    const issuerOptions = issuers.filter(issuer => issuer.bankId === banks[bankIndex]?.id);
    const issuerIndex = this.data.editing ? this.data.issuerIndex : issuerOptions.findIndex(issuer => issuer.id === draft.issuerId);
    const remindOptions = this.data.remindOptions.includes(draft.remindDays) ? this.data.remindOptions : [...this.data.remindOptions, draft.remindDays].sort((a, b) => a - b);
    this.setData({ bankIndex, issuerOptions, issuerIndex, networkIndex: networks.findIndex(network => network.value === draft.network),
      kind: draft.kind, nickname: draft.nickname, reminderEnabled: draft.kind === 'credit' && draft.reminderEnabled,
      statementDay: draft.statementDay, dueDay: draft.dueDay, dueMonthOffset: draft.dueMonthOffset, dueOn: draft.dueOn,
      remindOptions, remindLabels: remindOptions.map(days => days ? `提前 ${days} 天` : '还款当天'), remindIndex: remindOptions.indexOf(draft.remindDays) });
    this.updateBillingChoices(draft.billingAccountId);
    if (draft.billingAccountId && this.data.billingIndex === 0) {
      this.setData({ billingIndex: this.data.billingChoices.length,
        billingChoices: [...this.data.billingChoices, { id: draft.billingAccountId, label: '原共用账单已不可用，请重新选择' }],
        sharingNote: '请改选可用的共用账单，或为这张卡建立独立账单。',
        errors: { billingAccountId: '草稿中的共用账单已不可用，请重新选择。' } });
    }
    this.markChanged();
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
      const title = cardLabel(member.id, raw?.cards || []);
      choices.push({ id: account.id, label: `与 ${title} 共用 · ${account.statementDay}日出账 · ${account.dueMonthOffset ? '次月' : '当月'}${account.dueDay}日还款` });
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
  isBusy(): boolean { return this.disposed || this.data.loading || this.data.saving || this.data.removing; },
  refreshErrors(fields: string[]) {
    const errors = { ...this.data.errors };
    const current = this.validationErrors();
    fields.forEach(field => {
      if (!errors[field]) return;
      if (current[field]) errors[field] = current[field];
      else delete errors[field];
    });
    this.setData({ errors });
  },
  changeBank(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy() || this.data.editing) return;
    const bankIndex = Number(event.detail.value);
    this.setData({ bankIndex, issuerOptions: issuers.filter(item => item.bankId === banks[bankIndex]?.id), issuerIndex: 0, billingIndex: 0 });
    this.updateBillingChoices('');
    this.refreshErrors(['bankId', 'issuerId', 'billingAccountId', 'nickname']);
    this.markChanged();
  },
  changeIssuer(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy() || this.data.editing) return;
    this.setData({ issuerIndex: Number(event.detail.value), billingIndex: 0 }); this.updateBillingChoices('');
    this.refreshErrors(['bankId', 'issuerId', 'billingAccountId', 'nickname']);
    this.markChanged();
  },
  changeNetwork(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    this.setData({ networkIndex: Number(event.detail.value) }); this.refreshErrors(['network', 'nickname']); this.markChanged();
  },
  changeKind(event: WechatMiniprogram.TouchEvent) {
    if (this.isBusy()) return;
    const kind = event.currentTarget.dataset.kind;
    this.setData({ kind, reminderEnabled: kind === 'credit' && this.data.reminderEnabled }); this.refreshErrors(['kind', 'nickname', ...billingFields]); this.markChanged();
  },
  changeNickname(event: WechatMiniprogram.Input) {
    if (this.isBusy()) return;
    this.setData({ nickname: event.detail.value }); this.refreshErrors(['nickname']); this.markChanged();
  },
  toggleReminder(event: WechatMiniprogram.SwitchChange) {
    if (this.isBusy()) return;
    this.setData({ reminderEnabled: event.detail.value }); this.refreshErrors(billingFields); this.markChanged();
  },
  changeBilling(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    this.setData({ billingIndex: Number(event.detail.value) }); this.updateSharingNote(); this.refreshErrors(billingFields); this.markChanged();
  },
  changeStatement(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    this.setData({ statementDay: Number(event.detail.value) + 1 }); this.refreshErrors(['statementDay', 'dueOn', 'dueMonthOffset']); this.markChanged();
  },
  changeDueDay(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    this.setData({ dueDay: Number(event.detail.value) + 1 }); this.refreshErrors(['dueDay', 'dueMonthOffset']); this.markChanged();
  },
  changeOffset(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    this.setData({ dueMonthOffset: Number(event.detail.value) }); this.refreshErrors(['dueMonthOffset']); this.markChanged();
  },
  changeRemind(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    this.setData({ remindIndex: Number(event.detail.value) }); this.refreshErrors(['remindDays']); this.markChanged();
  },
  changeDueDate(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy()) return;
    const dueOn = String(event.detail.value);
    const next: Record<string, unknown> = { dueOn };
    if (!this.data.dueDay) { next.dueDay = Number(dueOn.slice(8)); next.dueMonthOffset = dueOn.slice(0, 7) === this.data.currentMonth ? 0 : 1; }
    this.setData(next);
    this.refreshErrors(['dueOn', 'dueDay', 'dueMonthOffset']);
    this.markChanged();
  },
  toggleCycle() { if (!this.isBusy()) this.setData({ showCycle: !this.data.showCycle }); },
  toggleAdvanced() { if (!this.isBusy()) this.setData({ showAdvanced: !this.data.showAdvanced }); },
  validationErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    const bank = banks[this.data.bankIndex];
    const issuer = this.data.issuerOptions[this.data.issuerIndex];
    if (!bank) errors.bankId = '请选择银行。';
    if (!issuer || issuer.bankId !== bank?.id) errors.issuerId = '请选择对应的发卡机构。';
    if (!networks[this.data.networkIndex]) errors.network = '请选择卡组织。';
    if (this.data.nickname.trim().length > 40) errors.nickname = '昵称最多 40 个字。';
    else if (bank && issuer && networks[this.data.networkIndex]) {
      const candidate: Card = {
        ...(this.data.card || {}), id: this.data.id || '__new_card__', ownerId: this.data.userId,
        bankId: bank.id, issuerId: issuer.id, network: networks[this.data.networkIndex].value,
        kind: this.data.kind, nickname: this.data.nickname.trim(), createdAt: this.data.card?.createdAt || new Date().toISOString(),
      };
      const cards = [...(this.data.raw?.cards || []).filter(card => card.id !== candidate.id), candidate];
      if (cardNeedsNickname(candidate.id, cards)) errors.nickname = '这张卡与另一张卡难以区分，请改用“日常消费卡”或“旅行卡”等不同昵称。';
    }
    if (this.data.kind === 'credit' && this.data.reminderEnabled && this.data.billingIndex > 0) {
      const accountId = this.data.billingChoices[this.data.billingIndex]?.id;
      const account = this.data.raw?.accounts.find(item => item.id === accountId && item.enabled && item.bankId === bank?.id && item.issuerId === issuer?.id);
      if (!account) errors.billingAccountId = '共用账单已不可用，请重新选择。';
    }
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
    return errors;
  },
  showValidationErrors(errors: Record<string, string>) {
    const field = fieldOrder.find(item => errors[item]);
    this.setData({ errors, showCycle: this.data.showCycle || !!errors.dueDay || !!errors.dueMonthOffset }, () => {
      if (this.disposed) return;
      if (field) wx.pageScrollTo({ selector: `#field-${field}`, duration: 180 });
    });
  },
  validate(): boolean {
    const errors = this.validationErrors();
    this.showValidationErrors(errors);
    if (Object.keys(errors).length) { wx.showToast({ title: '请检查标出的内容', icon: 'none' }); return false; }
    return true;
  },
  async save() {
    if (this.isBusy() || !this.validate()) return;
    const bank = banks[this.data.bankIndex], issuer = this.data.issuerOptions[this.data.issuerIndex];
    const payload: Commands['card.save'] = { bankId: bank.id, issuerId: issuer.id, network: networks[this.data.networkIndex].value,
      kind: this.data.kind, nickname: this.data.nickname.trim() };
    if (this.data.id) payload.id = this.data.id;
    if (this.data.kind === 'debit' || !this.data.reminderEnabled) payload.billingAccountId = null;
    else if (this.data.billingIndex > 0) payload.billingAccountId = this.data.billingChoices[this.data.billingIndex].id;
    else payload.billing = { statementDay: this.data.statementDay, dueDay: this.data.dueDay, dueMonthOffset: this.data.dueMonthOffset as 0 | 1, dueOn: this.data.dueOn, remindDays: this.data.remindOptions[this.data.remindIndex] };
    const draftRevision = getDraftRevision('card', this.data.userId, this.data.draftEntityId);
    this.setData({ saving: true });
    try {
      await api.command('card.save', payload);
      this.clearDraft(draftRevision);
      if (this.disposed) return;
      wx.showToast({ title: '卡片已保存', icon: 'success' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wallet/index' }) });
    } catch (error) {
      if (this.disposed) return;
      const failure = error as { field?: string; message?: string };
      if (failure.field) this.showValidationErrors({ [failure.field]: failure.message || '请检查此项。' });
      showError(error);
    } finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  async remove() {
    if (!this.data.id || this.isBusy()) return;
    this.setData({ removing: true });
    try {
      const result = await wx.showModal({ title: '移除此卡？', content: '卡片将不再用于匹配新活动。过去的参与、收益和账单记录都会保留。', confirmText: '移除', confirmColor: '#A8442C' });
      if (!result.confirm || this.disposed) return;
      const draftRevision = getDraftRevision('card', this.data.userId, this.data.draftEntityId);
      await api.command('card.remove', { id: this.data.id });
      this.clearDraft(draftRevision);
      if (this.disposed) return;
      wx.showToast({ title: '已移出卡包', icon: 'none' }); wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wallet/index' }) });
    }
    catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ removing: false }); }
  },
});

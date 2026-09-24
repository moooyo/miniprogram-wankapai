import { Bill, BillingAccount, Card, Commands, MutationResult, Network, Wallet } from '../../../shared/contracts';
import { banks, issuers } from '../../../shared/catalog';
import { api, ensureSession } from '../../services/api';
import { showError, monthKey, periodLabel } from '../../services/format';
import { confirmDraftRecovery, createCommandIntent, getDraftRevision, loadDraft, removeDraft, saveDraft } from '../../services/form-draft';
import { cardLabel, cardNeedsNickname, cardReference } from '../../services/card-labels';
import { navigateBackOr } from '../../services/navigation';

const networks: { value: Network; label: string }[] = [{ value: 'unionpay', label: '银联 UnionPay' }, { value: 'visa', label: 'Visa' }, { value: 'mastercard', label: 'Mastercard' }, { value: 'amex', label: 'American Express' }, { value: 'other', label: '其他卡组织' }];
interface BillingChoice { id: string; label: string; }
interface BillingTarget { billId: string; accountId: string; periodKey: string; statementOn: string; originalDueOn: string; }
interface PendingCardCreation { pending: true; intentKey: string; payloadSignature: string; }
interface RecoveredCreationCandidate { ownerId: string; entityId: string; intentKey: string; payload: Commands['card.save']; signature: string; }
interface CardFormInput {
  bankId: string; issuerId: string; network: Network; kind: 'credit' | 'debit'; nickname: string;
  reminderEnabled: boolean; billingAccountId: string; statementDay: number; dueDay: number;
  dueMonthOffset: number; dueOn: string; remindDays: number; periodKey: string;
  billingTarget?: BillingTarget;
  dateNeedsReview?: boolean;
}
interface CardFormDraft extends CardFormInput {
  intentKey?: string;
  pendingCreation?: PendingCardCreation;
  pendingCreationPeriod?: string;
  pendingCreationInput?: CardFormInput;
}
interface CreationContext { ownerId: string; entityId: string; intentKey: string; signature: string; revision: string | null; generation: number; }
function validBillingTarget(value: unknown): value is BillingTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as BillingTarget;
  return typeof target.periodKey === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(target.periodKey)
    && ['billId', 'accountId', 'statementOn', 'originalDueOn'].every(key => typeof target[key as keyof BillingTarget] === 'string')
    && (!target.statementOn || /^\d{4}-\d{2}-\d{2}$/.test(target.statementOn))
    && (!target.originalDueOn || /^\d{4}-\d{2}-\d{2}$/.test(target.originalDueOn));
}
function billingTargetFor(periodKey: string, accountId = '', bill?: Bill): BillingTarget {
  return { billId: bill?.id || '', accountId, periodKey, statementOn: bill?.statementOn || '', originalDueOn: bill?.dueOn || '' };
}
function validIntentKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}
function cardFormVersion(draft: CardFormDraft): string {
  const { intentKey, pendingCreation, pendingCreationPeriod, pendingCreationInput, ...fields } = draft;
  return JSON.stringify(fields);
}
function comparablePayload(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(comparablePayload).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + comparablePayload(object[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}
function pendingCreationSignature(value: unknown, intentKey: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const pending = value as Partial<PendingCardCreation>;
  return pending.pending === true && pending.intentKey === intentKey && typeof pending.payloadSignature === 'string'
    && pending.payloadSignature.length > 0 && pending.payloadSignature.length <= 2048 ? pending.payloadSignature : '';
}
const rejectedCreationCodes = new Set(['INVALID_INPUT', 'INVALID_DATE', 'NOT_FOUND', 'CONFLICT', 'IMMUTABLE', 'VERSION_CONFLICT', 'INVALID_STATE']);
const billingFields = ['billing', 'billingAccountId', 'statementDay', 'dueOn', 'dueDay', 'dueMonthOffset', 'remindDays'];
const fieldOrder = ['bankId', 'issuerId', 'kind', 'network', 'nickname', 'billing', 'billingAccountId', 'statementDay', 'dueOn', 'dueMonthOffset', 'dueDay', 'remindDays'];
const fieldLabels: Record<string, string> = { bankId: '银行', issuerId: '发卡机构', kind: '卡片类型', network: '卡组织', nickname: '卡片昵称', billing: '还款计划', billingAccountId: '账单', statementDay: '每月账单日', dueOn: '本期实际还款日期', dueMonthOffset: '还款月份', dueDay: '常规还款日', remindDays: '提前提醒' };
function validationSummary(errors: Record<string, string>) {
  return fieldOrder.filter(field => errors[field]).map(field => ({ field, label: fieldLabels[field], message: errors[field] }));
}
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
    id: '', initialBankId: '', editing: false, loading: true, failed: false, saving: false, removing: false, rebasing: false,
    banks, bankIndex: 0, issuerOptions: issuers.filter(item => item.bankId === banks[0]?.id), issuerIndex: 0,
    networks, networkIndex: 0, kind: 'credit' as 'credit' | 'debit', nickname: '',
    reminderEnabled: false, billingChoices: [{ id: '', label: '使用独立账单' }] as BillingChoice[], billingIndex: 0,
    sharingNote: '', independentNote: '', days: Array.from({ length: 31 }, (_, i) => i + 1), statementDay: 0,
    dueDay: 0, offsets: ['账单当月', '账单次月'], dueMonthOffset: 1, dueOn: '',
    remindOptions: [0, 1, 3, 5, 7], remindLabels: ['还款当天', '提前 1 天', '提前 3 天', '提前 5 天', '提前 7 天'], remindIndex: 2,
    raw: null as Wallet | null, card: null as Card | null, errors: {} as Record<string, string>,
    errorSummary: [] as ReturnType<typeof validationSummary>, focusField: '',
    currentMonth: '', showCycle: false, showAdvanced: false, systemReference: '',
    billingTarget: billingTargetFor(''), datePeriodLabel: '', billingContextNotice: '', pendingRetryNotice: '',
    dateNeedsReview: false, periodRebaseNeeded: false, billingTargetUnavailable: false, periodConflict: false, retryingPending: false, pendingLookupOnly: false, pendingLookupNotice: '',
    recoveredDraftLookupAvailable: false, recoveredDraftLookupNotice: '',
    userId: '', draftEntityId: '', draftBaseVersion: '', intentKey: '', pendingCreationSignature: '', pendingCreationPeriod: '', pendingCreationUnconfirmed: false, dirty: false, draftSaved: false,
  },
  disposed: false,
  loadGeneration: 0,
  creationSubmitted: false,
  pendingCreationInput: null as CardFormInput | null,
  recoveredCreationCandidate: null as RecoveredCreationCandidate | null,
  onUnload() { this.disposed = true; this.loadGeneration += 1; },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '', initialBankId: options.bankId || '', editing: !!options.id });
    wx.setNavigationBarTitle({ title: options.id ? '编辑卡片' : '添加卡片' });
    void this.load();
  },
  async load() {
    const generation = ++this.loadGeneration;
    this.recoveredCreationCandidate = null;
    this.pendingCreationInput = null;
    this.setData({ loading: true, failed: false, recoveredDraftLookupAvailable: false, recoveredDraftLookupNotice: '' });
    try {
      const session = await ensureSession(true);
      const raw = await api.query('wallet.get', {});
      if (this.disposed || generation !== this.loadGeneration) return;
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
      this.creationSubmitted = false;
      this.setData({ raw, card: card || null, currentMonth, bankIndex, issuerOptions, issuerIndex,
        userId: session.userId, draftEntityId: this.data.id || `new:${this.data.initialBankId}`, intentKey: this.data.editing ? '' : createCommandIntent(),
        pendingCreationSignature: '', pendingCreationPeriod: '', pendingCreationUnconfirmed: false, dirty: false, draftSaved: false, errors: {}, errorSummary: [], focusField: '',
        billingTarget: billingTargetFor(currentMonth, account?.id, bill), dateNeedsReview: false, periodRebaseNeeded: false, billingTargetUnavailable: false, periodConflict: false,
        pendingLookupOnly: false, pendingLookupNotice: '',
        networkIndex: Math.max(0, networks.findIndex(item => item.value === card?.network)), kind: card?.kind || 'credit', nickname: card?.nickname || '',
        reminderEnabled: !!account && card?.kind === 'credit', statementDay: account?.statementDay || 0,
        dueDay: account?.dueDay || 0, dueMonthOffset: account?.dueMonthOffset ?? 1, dueOn: bill?.dueOn || '',
        remindOptions, remindLabels: remindOptions.map(days => days ? `提前 ${days} 天` : '还款当天'),
        remindIndex: Math.max(0, remindOptions.indexOf(account?.remindDays ?? 3)) });
      this.updateBillingChoices(account?.id);
      this.updateBillingContext();
      this.setData({ draftBaseVersion: cardFormVersion(this.formDraft()), systemReference: card ? cardReference(card.id, raw.cards) : '' });
      await this.restoreDraft();
    } catch (error) { if (!this.disposed && generation === this.loadGeneration) { this.setData({ failed: true }); showError(error); } }
    finally { if (!this.disposed && generation === this.loadGeneration) this.setData({ loading: false }); }
  },
  formDraft(): CardFormDraft {
    return {
      bankId: banks[this.data.bankIndex]?.id || '', issuerId: this.data.issuerOptions[this.data.issuerIndex]?.id || '',
      network: networks[this.data.networkIndex]?.value || 'unionpay', kind: this.data.kind, nickname: this.data.nickname,
      reminderEnabled: this.data.reminderEnabled, billingAccountId: this.data.billingChoices[this.data.billingIndex]?.id || '',
      statementDay: this.data.statementDay, dueDay: this.data.dueDay, dueMonthOffset: this.data.dueMonthOffset,
      dueOn: this.data.dueOn, remindDays: this.data.remindOptions[this.data.remindIndex], periodKey: this.data.billingTarget.periodKey || this.data.currentMonth,
      billingTarget: this.data.billingTarget, dateNeedsReview: this.data.dateNeedsReview,
      ...(this.data.editing ? {} : { intentKey: this.data.intentKey,
        ...(this.data.pendingCreationSignature ? { pendingCreationPeriod: this.data.pendingCreationPeriod,
          ...(this.pendingCreationInput ? { pendingCreationInput: this.pendingCreationInput } : {}),
          pendingCreation: { pending: true as const, intentKey: this.data.intentKey, payloadSignature: this.data.pendingCreationSignature } } : {}) }),
    };
  },
  markChanged() {
    if (this.disposed) return false;
    this.updateBillingContext();
    this.updateRecoveredDraftLookup();
    const draft = this.formDraft();
    if (cardFormVersion(draft) === this.data.draftBaseVersion && !this.creationSubmitted) { this.clearDraft(); return true; }
    const draftSaved = saveDraft('card', this.data.userId, this.data.draftEntityId, this.data.draftBaseVersion, draft);
    this.setData({ dirty: true, draftSaved });
    wx.enableAlertBeforeUnload({ message: this.data.pendingLookupOnly && draftSaved ? '上次保存结果尚未确认，离开后可从本机草稿继续核对。' : draftSaved ? '卡片尚未保存，离开后可从本机草稿继续。' : '卡片尚未保存，离开后修改将丢失。' });
    return draftSaved;
  },
  clearDraft(expectedRevision?: string | null) {
    removeDraft('card', this.data.userId, this.data.draftEntityId, expectedRevision);
    this.recoveredCreationCandidate = null;
    this.pendingCreationInput = null;
    if (this.disposed) return;
    this.setData({ dirty: false, draftSaved: false, pendingCreationSignature: '', pendingCreationPeriod: '', pendingCreationUnconfirmed: false, pendingRetryNotice: '', retryingPending: false, pendingLookupOnly: false, pendingLookupNotice: '', recoveredDraftLookupAvailable: false, recoveredDraftLookupNotice: '' });
    wx.disableAlertBeforeUnload();
  },
  async restoreDraft() {
    if (this.disposed) return;
    const generation = this.loadGeneration;
    const saved = loadDraft<CardFormDraft>('card', this.data.userId, this.data.draftEntityId);
    if (!saved) return;
    const savedRevision = getDraftRevision('card', this.data.userId, this.data.draftEntityId);
    if (!isCardFormDraft(saved.value) || (cardFormVersion(saved.value) === this.data.draftBaseVersion &&
      (this.data.editing || !validIntentKey(saved.value.intentKey)))) {
      removeDraft('card', this.data.userId, this.data.draftEntityId, savedRevision); return;
    }
    const pendingSignature = !this.data.editing && validIntentKey(saved.value.intentKey) ? pendingCreationSignature(saved.value.pendingCreation, saved.value.intentKey) : '';
    let recover: boolean;
    if (pendingSignature) {
      const originalPeriod = saved.value.pendingCreationPeriod || saved.value.periodKey;
      const periodNote = saved.value.reminderEnabled && /^\d{4}-(0[1-9]|1[0-2])$/.test(originalPeriod) ? `草稿填写账期：${periodLabel(originalPeriod)}。` : '';
      recover = !!(await wx.showModal({ title: '发现待确认的卡片保存',
        content: `${periodNote}上次保存结果尚未确认，也可能已经成功。恢复后将核对原操作。放弃草稿不会取消已发出的操作，请先到卡包核对，避免再次添加。`,
        confirmText: '恢复核对', cancelText: '放弃草稿' })).confirm;
    } else recover = await confirmDraftRecovery(saved, this.data.draftBaseVersion);
    if (this.disposed || generation !== this.loadGeneration) return;
    if (!recover) {
      removeDraft('card', this.data.userId, this.data.draftEntityId, savedRevision); return;
    }
    const draft = saved.value;
    const intentKey = !this.data.editing && validIntentKey(draft.intentKey) ? draft.intentKey : this.data.intentKey;
    this.creationSubmitted = !this.data.editing && validIntentKey(draft.intentKey);
    this.pendingCreationInput = pendingSignature && isCardFormDraft(draft.pendingCreationInput) ? JSON.parse(JSON.stringify(draft.pendingCreationInput)) as CardFormInput : null;
    const bankIndex = this.data.editing ? this.data.bankIndex : banks.findIndex(bank => bank.id === draft.bankId);
    const issuerOptions = issuers.filter(issuer => issuer.bankId === banks[bankIndex]?.id);
    const issuerIndex = this.data.editing ? this.data.issuerIndex : issuerOptions.findIndex(issuer => issuer.id === draft.issuerId);
    const remindOptions = this.data.remindOptions.includes(draft.remindDays) ? this.data.remindOptions : [...this.data.remindOptions, draft.remindDays].sort((a, b) => a - b);
    this.setData({ bankIndex, issuerOptions, issuerIndex, networkIndex: networks.findIndex(network => network.value === draft.network), intentKey, pendingCreationSignature: pendingSignature,
      pendingCreationPeriod: pendingSignature ? draft.pendingCreationPeriod || draft.periodKey : '', pendingCreationUnconfirmed: !!pendingSignature,
      kind: draft.kind, nickname: draft.nickname, reminderEnabled: draft.kind === 'credit' && draft.reminderEnabled,
      statementDay: draft.statementDay, dueDay: draft.dueDay, dueMonthOffset: draft.dueMonthOffset, dueOn: draft.dueOn,
      remindOptions, remindLabels: remindOptions.map(days => days ? `提前 ${days} 天` : '还款当天'), remindIndex: remindOptions.indexOf(draft.remindDays) });
    this.updateBillingChoices(draft.billingAccountId);
    const restoredPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(draft.periodKey) ? draft.periodKey : this.data.currentMonth;
    const account = this.reusableBillingAccount();
    const originalBill = account ? this.data.raw?.bills.find(item => item.billingAccountId === account.id && item.periodKey === restoredPeriod) : undefined;
    this.setData({ billingTarget: validBillingTarget(draft.billingTarget) ? draft.billingTarget : billingTargetFor(restoredPeriod, account?.id, originalBill),
      dateNeedsReview: draft.dateNeedsReview === true });
    if (draft.billingAccountId && this.data.billingIndex === 0) {
      this.setData({ billingIndex: this.data.billingChoices.length,
        billingChoices: [...this.data.billingChoices, { id: draft.billingAccountId, label: '原共用账单已不可用，请重新选择' }],
        sharingNote: '请改选可用的共用账单，或为这张卡建立独立账单。',
        errors: { billingAccountId: '草稿中的共用账单已不可用，请重新选择。' },
        errorSummary: validationSummary({ billingAccountId: '草稿中的共用账单已不可用，请重新选择。' }) });
    }
    if (!this.data.editing && validIntentKey(draft.intentKey) && draft.pendingCreation === undefined) {
      const payload = JSON.parse(JSON.stringify(this.commandPayload())) as Commands['card.save'];
      this.recoveredCreationCandidate = { ownerId: this.data.userId, entityId: this.data.draftEntityId, intentKey,
        payload, signature: comparablePayload(payload) };
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
  reusableBillingAccount(): BillingAccount | null {
    const card = this.data.card;
    if (!this.data.editing || !card?.billingAccountId || this.data.kind !== 'credit' || this.data.billingIndex !== 0) return null;
    const account = this.data.raw?.accounts.find(item => item.id === card.billingAccountId && item.enabled);
    const otherMembers = this.data.raw?.cards.some(item => !item.archivedAt && item.kind === 'credit' && item.id !== card.id && item.billingAccountId === card.billingAccountId);
    return account && !otherMembers ? account : null;
  },
  resetBillingTarget() {
    const account = this.reusableBillingAccount();
    const bill = account ? this.data.raw?.bills.find(item => item.billingAccountId === account.id && item.periodKey === this.data.currentMonth) : undefined;
    this.setData({ billingTarget: billingTargetFor(this.data.currentMonth, account?.id, bill), dateNeedsReview: false, periodRebaseNeeded: false, periodConflict: false });
    this.updateBillingContext();
  },
  hasUnavailableBillingTarget(): boolean {
    if (!this.data.editing || this.data.kind !== 'credit' || !this.data.reminderEnabled || this.data.billingIndex !== 0) return false;
    const account = this.reusableBillingAccount();
    const target = this.data.billingTarget;
    if (!account || this.data.dueOn === target.originalDueOn) return false;
    return !target.billId || target.accountId !== account.id || !this.data.raw?.bills.some(bill =>
      bill.id === target.billId && bill.billingAccountId === account.id && bill.periodKey === target.periodKey);
  },
  updateBillingContext() {
    const target = this.data.billingTarget;
    const datePeriodLabel = periodLabel(target.periodKey || this.data.currentMonth);
    const retryingPending = this.retryingCreation();
    const lookupPending = this.lookupOnlyPendingPayload();
    const previousPeriod = target.periodKey !== this.data.currentMonth;
    const account = this.reusableBillingAccount();
    const correctingDate = !account || this.data.dueOn !== target.originalDueOn;
    const existingTarget = !!account && !!target.billId && target.accountId === account.id
      && !!this.data.raw?.bills.some(bill => bill.id === target.billId && bill.billingAccountId === account.id && bill.periodKey === target.periodKey);
    const billingTargetUnavailable = this.hasUnavailableBillingTarget();
    const billingContextNotice = billingTargetUnavailable
      ? '原账单关联已变化，请先重新读取当前账单，再核对实际还款日期。'
      : existingTarget && this.data.dateNeedsReview
      ? `已重新读取这张卡当前关联的${datePeriodLabel}账单，原登记还款日为 ${target.originalDueOn}。草稿日期 ${this.data.dueOn || '尚未填写'} 仍保留；确认后保存将用于这笔当前账单。`
      : existingTarget ? `实际日期只调整${datePeriodLabel}账单；后续规则用于以后生成的账单。`
      : previousPeriod ? `当前填写对应${datePeriodLabel}。如需新建，请先更新为当前账期并重新核对实际日期。` : `实际日期对应${datePeriodLabel}账单，后续按常规规则生成。`;
    const pendingRetryNotice = lookupPending
      ? `上次待确认：${lookupPending.nickname || '未命名卡片'}，实际还款日期 ${lookupPending.billing!.dueOn}。${lookupPending.billing!.periodKey ? '原账单已跨期' : '这份旧草稿缺少可确认的账期'}，只能核对上次保存结果，不会重新添加。`
      : this.data.pendingCreationSignature
      ? retryingPending ? `上次保存结果尚未确认。重试会核对同一次创建${this.data.reminderEnabled ? `，保留${datePeriodLabel}的原账单日期` : ''}，不会重复新增。`
        : '本机保留了后续修改。请先确认上次保存；本次只核对原内容，确认后再修改已创建的卡片。' : '';
    this.setData({ datePeriodLabel, billingContextNotice, pendingRetryNotice, retryingPending, pendingLookupOnly: !!lookupPending, billingTargetUnavailable,
      periodRebaseNeeded: !lookupPending && (billingTargetUnavailable || this.data.periodConflict || (!!this.data.reminderEnabled && this.data.billingIndex === 0 && correctingDate && !existingTarget && previousPeriod && !retryingPending)) });
  },
  async rebaseBillingPeriod() {
    if (this.isBusy()) return;
    this.setData({ rebasing: true });
    try {
      const [session, raw] = await Promise.all([ensureSession(true), api.query('wallet.get', {})]);
      if (this.disposed) return;
      if (session.userId !== this.data.userId) { wx.showToast({ title: '身份已变化，请重新打开卡片表单。', icon: 'none' }); return; }
      const currentCard = this.data.editing ? raw.cards.find(card => card.id === this.data.id && !card.archivedAt) : undefined;
      if (this.data.editing && !currentCard) throw new Error('这张卡已移出卡包，请返回后重新选择；当前填写仍然保留。');
      const selectedAccountId = this.data.billingChoices[this.data.billingIndex]?.id || '';
      this.setData({ currentMonth: session.month || monthKey(), raw, ...(this.data.editing ? { card: currentCard! } : {}) });
      this.updateBillingChoices(selectedAccountId);
      if (selectedAccountId && this.data.billingIndex === 0) this.setData({ billingIndex: this.data.billingChoices.length,
        billingChoices: [...this.data.billingChoices, { id: selectedAccountId, label: '原共用账单已不可用，请重新选择' }],
        sharingNote: '请重新选择可用的共用账单，或改用独立账单。' });
      this.resetBillingTarget();
      this.setData({ dateNeedsReview: true, periodRebaseNeeded: false });
      this.refreshErrors(billingFields);
      this.markChanged();
    } catch (error) { if (!this.disposed) showError(error); }
    finally { if (!this.disposed) this.setData({ rebasing: false }); }
  },
  confirmDueDate() {
    if (this.isBusy() || !this.data.dueOn) return;
    this.setData({ dateNeedsReview: false });
    this.refreshErrors(['dueOn']);
    this.markChanged();
  },
  isBusy(): boolean { return this.disposed || this.data.loading || this.data.saving || this.data.removing || this.data.rebasing || this.data.pendingCreationUnconfirmed || this.data.pendingLookupOnly; },
  back() { if (!this.data.saving && !this.data.removing) navigateBackOr('/pages/wallet/index', true); },
  refreshErrors(fields: string[]) {
    const errors = { ...this.data.errors };
    const current = this.validationErrors();
    fields.forEach(field => {
      if (!errors[field]) return;
      if (current[field]) errors[field] = current[field];
      else delete errors[field];
    });
    this.setData({ errors, errorSummary: validationSummary(errors) });
  },
  changeBank(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy() || this.data.editing) return;
    const bankIndex = Number(event.detail.value);
    this.setData({ bankIndex, issuerOptions: issuers.filter(item => item.bankId === banks[bankIndex]?.id), issuerIndex: 0, billingIndex: 0 });
    this.updateBillingChoices('');
    this.resetBillingTarget();
    this.refreshErrors(['bankId', 'issuerId', 'billingAccountId', 'nickname']);
    this.markChanged();
  },
  changeIssuer(event: WechatMiniprogram.PickerChange) {
    if (this.isBusy() || this.data.editing) return;
    this.setData({ issuerIndex: Number(event.detail.value), billingIndex: 0 }); this.updateBillingChoices(''); this.resetBillingTarget();
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
    this.setData({ billingIndex: Number(event.detail.value) }); this.updateSharingNote(); this.resetBillingTarget(); this.refreshErrors(billingFields); this.markChanged();
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
    const next: Record<string, unknown> = { dueOn, dateNeedsReview: false };
    if (!this.data.dueDay) { next.dueDay = Number(dueOn.slice(8)); next.dueMonthOffset = dueOn.slice(0, 7) === this.data.billingTarget.periodKey ? 0 : 1; }
    this.setData(next);
    this.refreshErrors(['dueOn', 'dueDay', 'dueMonthOffset']);
    this.markChanged();
  },
  toggleCycle() { if (!this.isBusy()) this.setData({ showCycle: !this.data.showCycle }); },
  toggleAdvanced() { if (!this.isBusy()) this.setData({ showAdvanced: !this.data.showAdvanced }); },
  commandPayload(): Commands['card.save'] {
    const payload: Commands['card.save'] = {
      bankId: banks[this.data.bankIndex]?.id || '', issuerId: this.data.issuerOptions[this.data.issuerIndex]?.id || '',
      network: networks[this.data.networkIndex]?.value || 'unionpay', kind: this.data.kind, nickname: this.data.nickname.trim(),
    };
    if (this.data.id) payload.id = this.data.id;
    if (this.data.kind === 'debit' || !this.data.reminderEnabled) payload.billingAccountId = null;
    else if (this.data.billingIndex > 0) {
      const accountId = this.data.billingChoices[this.data.billingIndex]?.id;
      if (accountId !== this.data.card?.billingAccountId) payload.billingAccountId = accountId;
    } else {
      const account = this.reusableBillingAccount();
      const target = this.data.billingTarget;
      const dateChanged = this.data.dueOn !== target.originalDueOn;
      const remindDays = this.data.remindOptions[this.data.remindIndex];
      const rulesChanged = !account || account.statementDay !== this.data.statementDay || account.dueDay !== this.data.dueDay
        || account.dueMonthOffset !== this.data.dueMonthOffset || account.remindDays !== remindDays;
      if (!account || rulesChanged || dateChanged) {
        payload.billing = { statementDay: this.data.statementDay, dueDay: this.data.dueDay, dueMonthOffset: this.data.dueMonthOffset as 0 | 1,
          ...(!account || dateChanged ? { dueOn: this.data.dueOn, ...(account && target.billId ? { billId: target.billId } : {}), periodKey: target.periodKey } : {}), remindDays };
      }
    }
    if (!this.data.editing && !this.data.id && validIntentKey(this.data.intentKey) && this.data.pendingCreationSignature && !this.data.dateNeedsReview) {
      try {
        const original = JSON.parse(this.data.pendingCreationSignature) as Commands['card.save'];
        if (comparablePayload(payload) === comparablePayload(original)) return original;
        if (original?.billing && payload.billing && original.billing.periodKey === undefined && original.billing.billId === undefined
          && this.data.pendingCreationPeriod === this.data.billingTarget.periodKey) {
          const legacy = { ...payload, billing: { ...payload.billing } };
          delete legacy.billing.periodKey; delete legacy.billing.billId;
          if (comparablePayload(legacy) === comparablePayload(original)) return original;
        }
      } catch { /* Invalid legacy payload signatures never grant replay privileges. */ }
    }
    return payload;
  },
  retryingCreation(): boolean {
    return !this.data.editing && !this.data.id && validIntentKey(this.data.intentKey) && !!this.data.pendingCreationSignature
      && this.data.pendingCreationSignature === JSON.stringify(this.commandPayload());
  },
  creationInput(): CardFormInput {
    const { intentKey, pendingCreation, pendingCreationPeriod, pendingCreationInput, ...input } = this.formDraft();
    return JSON.parse(JSON.stringify(input)) as CardFormInput;
  },
  pendingCreationPayload(): Commands['card.save'] | null {
    if (this.data.editing || this.data.id || !validIntentKey(this.data.intentKey) || !this.data.pendingCreationSignature) return null;
    try {
      const payload = JSON.parse(this.data.pendingCreationSignature) as Commands['card.save'];
      return payload && typeof payload === 'object' && !Array.isArray(payload) && payload.id === undefined
        && typeof payload.bankId === 'string' && typeof payload.issuerId === 'string' && typeof payload.nickname === 'string'
        && networks.some(network => network.value === payload.network) && (payload.kind === 'credit' || payload.kind === 'debit') ? payload : null;
    } catch { return null; }
  },
  hasRetainedCreationInput(payload: Commands['card.save']): boolean {
    if (this.pendingCreationInput) return comparablePayload(this.creationInput()) !== comparablePayload(this.pendingCreationInput);
    // A legacy command omits hidden fields. Only discard input matching its reconstructed defaults.
    const periodKey = payload.billing?.periodKey || this.data.pendingCreationPeriod;
    if (!periodKey) return true;
    const original: CardFormInput = {
      bankId: payload.bankId, issuerId: payload.issuerId, network: payload.network, kind: payload.kind, nickname: payload.nickname,
      reminderEnabled: payload.kind === 'credit' && (!!payload.billing || typeof payload.billingAccountId === 'string'),
      billingAccountId: typeof payload.billingAccountId === 'string' ? payload.billingAccountId : '',
      statementDay: payload.billing?.statementDay ?? 0, dueDay: payload.billing?.dueDay ?? 0,
      dueMonthOffset: payload.billing?.dueMonthOffset ?? 1, dueOn: payload.billing?.dueOn ?? '', remindDays: payload.billing?.remindDays ?? 3,
      periodKey, billingTarget: billingTargetFor(periodKey), dateNeedsReview: false,
    };
    return comparablePayload(this.creationInput()) !== comparablePayload(original);
  },
  creationContext(): CreationContext {
    return { ownerId: this.data.userId, entityId: this.data.draftEntityId, intentKey: this.data.intentKey,
      signature: this.data.pendingCreationSignature, revision: getDraftRevision('card', this.data.userId, this.data.draftEntityId), generation: this.loadGeneration };
  },
  matchesCreationContext(context: CreationContext): boolean {
    return !this.disposed && context.generation === this.loadGeneration && this.data.userId === context.ownerId
      && this.data.draftEntityId === context.entityId && this.data.intentKey === context.intentKey && this.data.pendingCreationSignature === context.signature;
  },
  async confirmCreatedCard(result: MutationResult, payload: Commands['card.save'], context: CreationContext, retained: CardFormInput | null) {
    if (!result || typeof result.id !== 'string' || !result.id.trim()) throw Object.assign(new Error('保存结果暂时无法确认，请重试确认原操作。'), { code: 'INVALID_RESPONSE' });
    if (!this.matchesCreationContext(context) || getDraftRevision('card', context.ownerId, context.entityId) !== context.revision) return;
    if (!retained) {
      this.clearDraft(context.revision);
      wx.showToast({ title: '卡片已保存', icon: 'success' });
      wx.navigateBack({ fail: () => { if (!this.disposed) wx.switchTab({ url: '/pages/wallet/index' }); } });
      return;
    }
    const session = await ensureSession(true);
    if (!this.matchesCreationContext(context)) return;
    if (session.userId !== context.ownerId) throw new Error('当前账号已变化，本机修改仍保留，请使用原账号到卡包核对。');
    const raw = await api.query('wallet.get', {});
    if (!this.matchesCreationContext(context)) return;
    const card = raw.cards.find(item => item.id === result.id && item.ownerId === context.ownerId && !item.archivedAt);
    if (!card || card.bankId !== payload.bankId || card.issuerId !== payload.issuerId) throw new Error('暂时无法核对已创建的卡片，本机副本仍保留，请到卡包核对。');
    if (retained.bankId !== card.bankId || retained.issuerId !== card.issuerId) throw new Error('上次卡片已保存，但后续填写的银行或发卡机构不同。本机副本仍保留，请到卡包核对后分别处理。');
    if (getDraftRevision('card', context.ownerId, context.entityId) !== context.revision) throw new Error('另一处本机草稿已有更新，两份内容均已保留，请到卡包核对。');
    const currentMonth = session.month || monthKey();
    const account = raw.accounts.find(item => item.id === card.billingAccountId && item.ownerId === context.ownerId && item.enabled);
    const shared = !!account && raw.cards.some(item => item.id !== card.id && !item.archivedAt && item.kind === 'credit' && item.billingAccountId === account.id);
    const currentBill = account ? raw.bills.find(item => item.billingAccountId === account.id && item.periodKey === currentMonth) : undefined;
    const baseVersion = cardFormVersion({ bankId: card.bankId, issuerId: card.issuerId, kind: card.kind, network: card.network, nickname: card.nickname,
      reminderEnabled: !!account && card.kind === 'credit', billingAccountId: shared ? account!.id : '', statementDay: account?.statementDay || 0,
      dueDay: account?.dueDay || 0, dueMonthOffset: account?.dueMonthOffset ?? 1, dueOn: currentBill?.dueOn || '', remindDays: account?.remindDays ?? 3,
      periodKey: currentMonth, billingTarget: billingTargetFor(currentMonth, account?.id, currentBill), dateNeedsReview: false });
    let target = validBillingTarget(retained.billingTarget) ? retained.billingTarget : billingTargetFor(retained.periodKey);
    // Bind a former creation date only to its original period, never to the new current bill.
    if (account && !shared && !retained.billingAccountId && payload.billing && target.periodKey === (payload.billing.periodKey || this.data.pendingCreationPeriod)) {
      const originalBill = raw.bills.find(item => item.billingAccountId === account.id && item.periodKey === target.periodKey);
      target = billingTargetFor(target.periodKey, account.id, originalBill);
    }
    const value: CardFormDraft = { ...retained, billingTarget: target,
      dateNeedsReview: retained.dateNeedsReview === true || (retained.kind === 'credit' && retained.reminderEnabled && !retained.billingAccountId && !!retained.dueOn) };
    const existing = loadDraft<CardFormDraft>('card', context.ownerId, result.id);
    if (existing && comparablePayload(existing.value) !== comparablePayload(value)) throw new Error('这张卡另有本机修改，两份副本均已保留，请到卡包核对。');
    if (!saveDraft('card', context.ownerId, result.id, baseVersion, value)) throw new Error('卡片已确认，但后续修改暂时无法保存到该卡片。原副本仍保留，请重试确认。');
    removeDraft('card', context.ownerId, context.entityId, context.revision);
    this.pendingCreationInput = null;
    this.recoveredCreationCandidate = null;
    this.creationSubmitted = false;
    this.setData({ id: card.id, editing: true, card, raw, currentMonth, draftEntityId: card.id, draftBaseVersion: baseVersion,
      intentKey: '', pendingCreationSignature: '', pendingCreationPeriod: '', pendingCreationUnconfirmed: false, pendingLookupOnly: false,
      pendingRetryNotice: '', pendingLookupNotice: '上次保存已确认。后续修改仍是本机草稿，请核对后保存到这张卡片。',
      recoveredDraftLookupAvailable: false, recoveredDraftLookupNotice: '', dirty: true, draftSaved: true,
      billingTarget: target, dateNeedsReview: value.dateNeedsReview, errors: {}, errorSummary: [], systemReference: cardReference(card.id, raw.cards) });
    this.updateBillingChoices(retained.billingAccountId);
    if (retained.billingAccountId && this.data.billingIndex === 0) this.setData({ billingIndex: this.data.billingChoices.length,
      billingChoices: [...this.data.billingChoices, { id: retained.billingAccountId, label: '原共用账单已不可用，请重新选择' }] });
    this.updateBillingContext();
    wx.setNavigationBarTitle({ title: '编辑卡片' });
    wx.enableAlertBeforeUnload({ message: '后续修改已保存在这张卡的本机草稿中，尚未保存到卡片。' });
  },
  lookupOnlyPendingPayload(): Commands['card.save'] | null {
    if (this.data.editing || this.data.id || !validIntentKey(this.data.intentKey) || !this.data.pendingCreationSignature) return null;
    try {
      const original = JSON.parse(this.data.pendingCreationSignature) as Commands['card.save'];
      return original && typeof original === 'object' && !original.id && original.billing && typeof original.billing.dueOn === 'string'
        && ((!original.billing.periodKey && !original.billing.billId) || (!!original.billing.periodKey && original.billing.periodKey !== this.data.currentMonth)) ? original : null;
    } catch { return null; }
  },
  async resolvePendingCreation() {
    if (this.lookupOnlyPendingPayload()) await this.save();
  },
  recoveredDraftLookupPayload(): Commands['card.save'] | null {
    const candidate = this.recoveredCreationCandidate;
    if (!candidate || this.data.editing || this.data.id || this.data.pendingCreationSignature
      || this.data.userId !== candidate.ownerId || this.data.draftEntityId !== candidate.entityId || this.data.intentKey !== candidate.intentKey
      || comparablePayload(this.commandPayload()) !== candidate.signature || !this.validationErrors().nickname) return null;
    return candidate.payload;
  },
  updateRecoveredDraftLookup() {
    const recoveredDraftLookupAvailable = !!this.recoveredDraftLookupPayload();
    this.setData({ recoveredDraftLookupAvailable, ...(!recoveredDraftLookupAvailable ? { recoveredDraftLookupNotice: '' } : {}) });
  },
  async resolveRecoveredDraftCreation() {
    if (this.isBusy()) return;
    const candidate = this.recoveredCreationCandidate;
    const payload = this.recoveredDraftLookupPayload();
    if (!candidate || !payload) return;
    const revision = getDraftRevision('card', candidate.ownerId, candidate.entityId);
    this.setData({ saving: true, recoveredDraftLookupNotice: '' });
    try {
      const session = await ensureSession(true);
      if (this.disposed) return;
      if (session.userId !== candidate.ownerId) {
        this.setData({ recoveredDraftLookupNotice: '身份已变化，当前填写仍保留，请重新打开卡片表单后核对。' });
        return;
      }
      if (this.recoveredCreationCandidate !== candidate || !this.recoveredDraftLookupPayload()) return;
      await api.command('card.save', payload, { intentKey: candidate.intentKey, replayOnly: true });
      // A confirmed historical result may clear only the exact draft revision that was inspected.
      if (revision !== null) removeDraft('card', candidate.ownerId, candidate.entityId, revision);
      if (this.disposed || this.recoveredCreationCandidate !== candidate || !this.recoveredDraftLookupPayload()) return;
      this.recoveredCreationCandidate = null;
      this.setData({ dirty: false, draftSaved: false, recoveredDraftLookupAvailable: false, recoveredDraftLookupNotice: '' });
      wx.disableAlertBeforeUnload();
      wx.showToast({ title: '已找到这份草稿的保存记录，请到卡包查看。', icon: 'none' });
      wx.switchTab({ url: '/pages/wallet/index' });
    } catch (error) {
      if (this.disposed || this.recoveredCreationCandidate !== candidate) return;
      this.setData({ recoveredDraftLookupNotice: (error as { code?: string }).code === 'REQUEST_UNRESOLVED'
        ? '暂未查到这份草稿的保存记录，无法确认是否曾提交，原操作也可能稍后完成。当前填写仍保留，可稍后再核对或到卡包查看。'
        : '目前无法核对这份草稿的保存结果。当前填写仍保留，请稍后再试或到卡包查看。' });
    } finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  openWalletForVerification() {
    if (!this.disposed && !this.data.saving && !this.data.removing && !this.data.rebasing) wx.switchTab({ url: '/pages/wallet/index' });
  },
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
      if (cardNeedsNickname(candidate.id, cards) && !this.retryingCreation()) errors.nickname = '这张卡与另一张卡难以区分，请改用“日常消费卡”或“旅行卡”等不同昵称。';
    }
    if (this.data.kind === 'credit' && this.data.reminderEnabled && this.data.billingIndex > 0) {
      const accountId = this.data.billingChoices[this.data.billingIndex]?.id;
      const account = this.data.raw?.accounts.find(item => item.id === accountId && item.enabled && item.bankId === bank?.id && item.issuerId === issuer?.id);
      if (!account) errors.billingAccountId = '共用账单已不可用，请重新选择。';
    }
    if (this.data.kind === 'credit' && this.data.reminderEnabled && this.data.billingIndex === 0) {
      if (!this.data.statementDay) errors.statementDay = '请选择每月账单日。';
      const account = this.reusableBillingAccount();
      const target = this.data.billingTarget;
      const correctingDate = !account || this.data.dueOn !== target.originalDueOn;
      const retrying = this.retryingCreation();
      if (correctingDate && !this.data.dueOn) errors.dueOn = '请按银行账单选择实际还款日期。';
      if (!this.data.dueDay) errors.dueDay = '请选择后续每期的常规还款日。';
      if (this.data.dueMonthOffset === 0 && this.data.dueDay < this.data.statementDay) errors.dueMonthOffset = '同月还款不能早于账单日，请改为账单次月。';
      if (correctingDate && this.data.dateNeedsReview) errors.dueOn = `请先核对并确认${this.data.datePeriodLabel}账单的实际还款日期。`;
      if (correctingDate && !account && target.periodKey !== this.data.currentMonth && !retrying) errors.dueOn = '账期已变化，请先更新为当前账期并重新核对实际日期。';
      if (this.hasUnavailableBillingTarget()) {
        errors.dueOn = '原账单目标已不可用，请先重新读取账单，再核对实际日期。';
      }
      if (correctingDate && this.data.dueOn && this.data.statementDay && !retrying) {
        const [year, month] = (target.periodKey || this.data.currentMonth).split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const statementOn = account && target.billId ? target.statementOn : `${target.periodKey || this.data.currentMonth}-${String(Math.min(this.data.statementDay, daysInMonth)).padStart(2, '0')}`;
        if (this.data.dueOn < statementOn) errors.dueOn = `还款日期不能早于${this.data.datePeriodLabel}账单日。`;
      }
    }
    return errors;
  },
  showValidationErrors(errors: Record<string, string>) {
    const field = fieldOrder.find(item => errors[item]);
    const errorSummary = validationSummary(errors);
    this.setData({ errors, errorSummary, focusField: '', showCycle: this.data.showCycle || !!errors.dueDay || !!errors.dueMonthOffset }, () => {
      if (this.disposed) return;
      if (errorSummary.length > 1) wx.pageScrollTo({ selector: '#card-error-summary', duration: 180 });
      else if (field) this.focusErrorField({ currentTarget: { dataset: { field } } });
    });
  },
  focusErrorField(event: { currentTarget: { dataset: { field: string } } }) {
    const field = event.currentTarget.dataset.field;
    if (this.disposed || !fieldOrder.includes(field)) return;
    this.setData({ focusField: '', showCycle: this.data.showCycle || field === 'dueDay' || field === 'dueMonthOffset' }, () => {
      if (this.disposed) return;
      wx.pageScrollTo({ selector: `#field-${field}`, duration: 180 });
      if (field === 'nickname') wx.nextTick(() => { if (!this.disposed) this.setData({ focusField: 'nickname' }); });
    });
  },
  validate(): boolean {
    const errors = this.validationErrors();
    this.showValidationErrors(errors);
    this.updateRecoveredDraftLookup();
    if (Object.keys(errors).length) { wx.showToast({ title: '请检查标出的内容', icon: 'none' }); return false; }
    return true;
  },
  async save() {
    if (this.disposed || this.data.loading || this.data.saving || this.data.removing || this.data.rebasing) return;
    const pending = this.pendingCreationPayload();
    if (this.data.pendingCreationUnconfirmed && !pending) {
      this.setData({ pendingLookupNotice: '原保存恢复信息不完整，本机副本仍保留。请先到卡包核对，暂不能再次新建。' }); return;
    }
    if ((!pending && this.isBusy()) || ((!pending || this.retryingCreation()) && !this.validate())) return;
    const payload = pending || this.commandPayload();
    const creating = !this.data.editing && !payload.id;
    if (creating && !pending) {
      if (!validIntentKey(this.data.intentKey)) this.setData({ intentKey: createCommandIntent() });
      const previouslySubmitted = this.creationSubmitted;
      this.pendingCreationInput = this.creationInput();
      this.creationSubmitted = true;
      this.setData({ pendingCreationSignature: JSON.stringify(payload), pendingCreationPeriod: this.data.billingTarget.periodKey, pendingCreationUnconfirmed: true });
      if (!this.markChanged()) {
        this.pendingCreationInput = null;
        this.creationSubmitted = previouslySubmitted;
        this.setData({ pendingCreationSignature: '', pendingCreationPeriod: '', pendingCreationUnconfirmed: false,
          pendingLookupNotice: '保存恢复信息未能写入本机，请重试保存草稿后再提交。' });
        this.updateBillingContext();
        return;
      }
    }
    const context = this.creationContext();
    const draftRevision = getDraftRevision('card', this.data.userId, this.data.draftEntityId);
    const retained = creating && this.hasRetainedCreationInput(payload) ? this.creationInput() : null;
    let replayOnly = false, dispatched = false, confirmed = false;
    this.setData({ saving: true, pendingLookupNotice: '' });
    try {
      if (creating) {
        const saved = loadDraft<CardFormDraft>('card', context.ownerId, context.entityId);
        if (!saved || saved.value.intentKey !== context.intentKey || saved.value.pendingCreation?.payloadSignature !== context.signature
          || comparablePayload(saved.value) !== comparablePayload(this.formDraft())) throw new Error('本机草稿已有变化，请重新打开后核对。原提交仍保留。');
        const session = await ensureSession(true);
        if (!this.matchesCreationContext(context)) return;
        if (session.userId !== context.ownerId) throw new Error('身份已变化，原草稿仍保留，请重新打开后核对。');
        if (getDraftRevision('card', context.ownerId, context.entityId) !== context.revision) return;
        if (pending) {
          this.setData({ currentMonth: session.month || monthKey() });
          this.updateBillingContext();
        }
        replayOnly = !!this.lookupOnlyPendingPayload();
        dispatched = true;
        const result = await api.command('card.save', payload, { intentKey: context.intentKey, ...(replayOnly ? { replayOnly: true } : {}) });
        if (!result || typeof result.id !== 'string' || !result.id.trim()) throw Object.assign(new Error('保存结果暂时无法确认，请重试确认原操作。'), { code: 'INVALID_RESPONSE' });
        confirmed = true;
        await this.confirmCreatedCard(result, payload, context, retained);
        return;
      }
      await api.command('card.save', payload);
      this.clearDraft(draftRevision);
      if (this.disposed) return;
      wx.showToast({ title: '卡片已保存', icon: 'success' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wallet/index' }) });
    } catch (error) {
      const failure = error as { code?: string; field?: string; message?: string };
      if (creating && dispatched && !confirmed && !replayOnly && failure.code && rejectedCreationCodes.has(failure.code)) {
        const saved = loadDraft<CardFormDraft>('card', context.ownerId, context.entityId);
        if (saved && getDraftRevision('card', context.ownerId, context.entityId) === context.revision
          && saved.value.intentKey === context.intentKey && saved.value.pendingCreation?.payloadSignature === context.signature) {
          const { pendingCreation, pendingCreationPeriod, pendingCreationInput, ...value } = saved.value;
          saveDraft('card', context.ownerId, context.entityId, saved.baseVersion, value);
        }
        if (this.matchesCreationContext(context)) {
          this.pendingCreationInput = null;
          this.setData({ pendingCreationSignature: '', pendingCreationPeriod: '', pendingCreationUnconfirmed: false });
          this.updateBillingContext();
        }
      }
      if (this.disposed || (creating && (context.generation !== this.loadGeneration || this.data.userId !== context.ownerId || this.data.draftEntityId !== context.entityId))) return;
      if (creating && this.data.pendingCreationUnconfirmed) this.setData({ pendingLookupNotice: failure.code === 'REQUEST_UNRESOLVED'
        ? '暂未查到上次保存结果，原操作仍可能稍后完成。草稿已保留，请稍后再核对或到卡包查看。'
        : replayOnly ? '目前无法核对上次保存结果，草稿仍然保留。请稍后重新核对，或到卡包查看。'
          : failure.message || '上次保存结果尚未确认，原内容与本机修改仍保留，请重试确认。' });
      if (failure.field) this.showValidationErrors({ [failure.field]: failure.message || '请检查此项。' });
      if (failure.code === 'VERSION_CONFLICT' && failure.field === 'dueOn') {
        this.setData({ periodConflict: true }); this.updateBillingContext();
      }
      showError(error);
    } finally { if (!this.disposed && context.generation === this.loadGeneration) this.setData({ saving: false }); }
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

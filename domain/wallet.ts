import { Bill, BillingAccount, Card, Commands, MutationResult, Network, Wallet } from '../shared/contracts';
import { assertDate, assertMonth, billDates, monthOf } from './calendar';
import { Context } from './context';
import { DomainError, requireValue } from './errors';
import { banks, issuers } from '../shared/catalog';

const networks: Network[] = ['visa', 'mastercard', 'unionpay', 'amex', 'other'];

function text(value: unknown, field: string, maxLength: number, required = true): string {
  requireValue(typeof value === 'string', 'INVALID_INPUT', '请填写有效内容', field);
  const result = value.trim();
  requireValue((!required || result.length > 0) && result.length <= maxLength, 'INVALID_INPUT', required ? '内容不能为空或过长' : '内容过长', field);
  requireValue(!/[\u0000-\u001f\u007f]/.test(result), 'INVALID_INPUT', '内容包含无效字符', field);
  return result;
}

function validId(value: unknown, field: string): string {
  const result = text(value, field, 128);
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result), 'INVALID_INPUT', '标识无效', field);
  return result;
}

function requireDay(value: unknown, field: string): number {
  requireValue(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31, 'INVALID_INPUT', '请选择 1 至 31 日', field);
  return value;
}

async function ownedCards(ctx: Context): Promise<Card[]> {
  return ctx.store.find<Card>('cards', { where: [{ field: 'ownerId', op: 'eq', value: ctx.actor.userId }] });
}

async function currentBill(ctx: Context, accountId: string): Promise<Bill | undefined> {
  const rows = await ctx.store.find<Bill>('bills', { where: [
    { field: 'ownerId', op: 'eq', value: ctx.actor.userId },
    { field: 'billingAccountId', op: 'eq', value: accountId },
    { field: 'periodKey', op: 'eq', value: monthOf(ctx.today) }
  ] });
  return rows[0];
}

function checkDueOn(value: unknown, statementOn: string): string {
  const dueOn = assertDate(value, 'dueOn');
  requireValue(dueOn >= statementOn, 'INVALID_DATE', '还款日不能早于本期账单日', 'dueOn');
  return dueOn;
}

function readBilling(value: NonNullable<Commands['card.save']['billing']>): Omit<BillingAccount, 'id' | 'ownerId' | 'bankId' | 'issuerId' | 'label' | 'enabled'> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', '账单设置无效', 'billing');
  const statementDay = requireDay(value.statementDay, 'statementDay');
  const dueDay = requireDay(value.dueDay, 'dueDay');
  requireValue(value.dueMonthOffset === 0 || value.dueMonthOffset === 1, 'INVALID_INPUT', '请选择本月或下月还款', 'dueMonthOffset');
  requireValue(value.dueMonthOffset !== 0 || dueDay >= statementDay, 'INVALID_INPUT', '同月还款日不能早于账单日，请选择下月还款', 'dueMonthOffset');
  requireValue(typeof value.remindDays === 'number' && Number.isInteger(value.remindDays) && value.remindDays >= 0 && value.remindDays <= 30, 'INVALID_INPUT', '提前提醒天数应为 0 至 30 天', 'remindDays');
  if (value.dueOn !== undefined) assertDate(value.dueOn, 'dueOn');
  if (value.periodKey !== undefined) assertMonth(value.periodKey, 'periodKey');
  if (value.billId !== undefined) {
    validId(value.billId, 'billId');
    requireValue(value.dueOn !== undefined && value.periodKey !== undefined, 'INVALID_INPUT', '修正账单日期时需要指定账单及所属月份', 'dueOn');
  }
  return { statementDay, dueDay, dueMonthOffset: value.dueMonthOffset, remindDays: value.remindDays };
}

async function disableUnusedAccount(ctx: Context, accountId: string | undefined): Promise<void> {
  if (!accountId) return;
  const account = await ctx.owned<BillingAccount>('billing_accounts', accountId);
  const cards = await ownedCards(ctx);
  if (cards.some(card => !card.archivedAt && card.kind === 'credit' && card.billingAccountId === accountId)) return;
  if (!account.enabled) return;
  const next: BillingAccount = { ...account, enabled: false };
  await ctx.store.set('billing_accounts', account.id, next);
  await ctx.audit(account.id, 'billing_account.disabled', account, next);
}

export async function ensureBills(ctx: Context, limit = 20, accountId?: string): Promise<number> {
  requireValue(Number.isSafeInteger(limit) && limit >= 0 && limit <= 40, 'INVALID_INPUT', '账单批量生成数量无效');
  if (limit === 0) return 0;
  const selectedAccountId = accountId === undefined ? undefined : validId(accountId, 'billingAccountId');
  const periodKey = monthOf(ctx.today);
  const cards = (await ownedCards(ctx)).filter(card => !card.archivedAt && card.kind === 'credit' && card.billingAccountId && (!selectedAccountId || card.billingAccountId === selectedAccountId));
  const accountIds = new Set(cards.map(card => card.billingAccountId));
  const accounts = await ctx.store.find<BillingAccount>('billing_accounts', { where: [
    { field: 'ownerId', op: 'eq', value: ctx.actor.userId },
    { field: 'enabled', op: 'eq', value: true },
    ...(selectedAccountId ? [{ field: 'id', op: 'eq' as const, value: selectedAccountId }] : [])
  ] });
  const existing = await ctx.store.find<Bill>('bills', { where: [
    { field: 'ownerId', op: 'eq', value: ctx.actor.userId },
    { field: 'periodKey', op: 'eq', value: periodKey },
    ...(selectedAccountId ? [{ field: 'billingAccountId', op: 'eq' as const, value: selectedAccountId }] : [])
  ] });
  const existingAccountIds = new Set(existing.map(bill => bill.billingAccountId));
  let created = 0;
  for (const account of accounts) {
    if (created >= limit) break;
    if (!accountIds.has(account.id) || existingAccountIds.has(account.id)) continue;
    const hasMatchingCard = cards.some(card => card.billingAccountId === account.id && card.bankId === account.bankId && card.issuerId === account.issuerId);
    if (!hasMatchingCard) continue;
    const dates = billDates(account, periodKey);
    requireValue(dates.dueOn >= dates.statementOn, 'INVALID_DATE', '账单账户的还款日设置无效', 'dueDay');
    const id = `bill_${account.id}_${periodKey}`;
    const collision = await ctx.store.get<Bill>('bills', id);
    if (collision) {
      requireValue(collision.ownerId === ctx.actor.userId && collision.billingAccountId === account.id && collision.periodKey === periodKey, 'CONFLICT', '账单记录冲突，请重试');
      existingAccountIds.add(account.id);
      continue;
    }
    const bill: Bill = { id, ownerId: ctx.actor.userId, billingAccountId: account.id, periodKey, ...dates, paidAt: null };
    await ctx.store.set('bills', bill.id, bill);
    await ctx.audit(bill.id, 'bill.created', undefined, bill);
    existingAccountIds.add(account.id);
    created += 1;
  }
  return created;
}

export async function getWallet(ctx: Context): Promise<Wallet> {
  // Historical records still need the identity of cards removed from the active wallet.
  const cards = await ownedCards(ctx);
  const accounts = await ctx.store.find<BillingAccount>('billing_accounts', { where: [{ field: 'ownerId', op: 'eq', value: ctx.actor.userId }] });
  const bills = await ctx.store.find<Bill>('bills', { where: [{ field: 'ownerId', op: 'eq', value: ctx.actor.userId }] });
  cards.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  bills.sort((left, right) => left.dueOn.localeCompare(right.dueOn) || left.id.localeCompare(right.id));
  return { cards, accounts, bills };
}

export async function saveCard(ctx: Context, payload: Commands['card.save']): Promise<MutationResult> {
  requireValue(payload !== null && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_INPUT', '卡片信息无效');
  const bankId = validId(payload.bankId, 'bankId');
  const issuerId = validId(payload.issuerId, 'issuerId');
  requireValue(banks.some(bank => bank.id === bankId), 'INVALID_INPUT', '请选择有效银行', 'bankId');
  requireValue(issuers.some(issuer => issuer.id === issuerId && issuer.bankId === bankId), 'INVALID_INPUT', '发卡机构与银行不匹配', 'issuerId');
  requireValue(networks.includes(payload.network), 'INVALID_INPUT', '请选择有效卡组织', 'network');
  requireValue(payload.kind === 'credit' || payload.kind === 'debit', 'INVALID_INPUT', '请选择信用卡或借记卡', 'kind');
  const nickname = text(payload.nickname, 'nickname', 40, false);
  const previous = payload.id === undefined ? null : await ctx.owned<Card>('cards', validId(payload.id, 'id'));
  requireValue(!previous?.archivedAt, 'NOT_FOUND', '这张卡已移出卡包');
  requireValue(!previous || (previous.bankId === bankId && previous.issuerId === issuerId), 'INVALID_INPUT', '已保存卡片不能更换银行或发卡机构，请添加新卡', 'bankId');

  const requestedAccount = typeof payload.billingAccountId === 'string' ? validId(payload.billingAccountId, 'billingAccountId') : undefined;
  requireValue(payload.billingAccountId === undefined || payload.billingAccountId === null || typeof payload.billingAccountId === 'string', 'INVALID_INPUT', '账单账户无效', 'billingAccountId');
  const cancelBilling = payload.kind === 'debit' || payload.billingAccountId === null || payload.billing === null;
  requireValue(!(requestedAccount && payload.billing !== undefined && payload.billing !== null), 'INVALID_INPUT', '关联已有账单时无需填写独立账单设置', 'billingAccountId');
  requireValue(!(requestedAccount && payload.billing === null), 'INVALID_INPUT', '请选择关联账单或关闭提醒', 'billingAccountId');
  requireValue(!(payload.billingAccountId === null && payload.billing !== undefined && payload.billing !== null), 'INVALID_INPUT', '请选择独立账单或关闭提醒', 'billing');

  let accountId = cancelBilling ? undefined : previous?.billingAccountId;
  let account: BillingAccount | undefined;
  let correctedDueOn: string | undefined;
  let correctedBill: Bill | undefined;
  if (!cancelBilling && requestedAccount) {
    const existing = await ctx.owned<BillingAccount>('billing_accounts', requestedAccount);
    requireValue(existing.bankId === bankId && existing.issuerId === issuerId, 'INVALID_INPUT', '只能共用同一家发卡机构的账单', 'billingAccountId');
    accountId = existing.id;
    account = { ...existing, enabled: true };
  } else if (!cancelBilling && payload.billing !== undefined && payload.billing !== null) {
    const settings = readBilling(payload.billing);
    const previousAccount = previous?.billingAccountId ? await ctx.owned<BillingAccount>('billing_accounts', previous.billingAccountId) : null;
    if (previousAccount) requireValue(previousAccount.bankId === bankId && previousAccount.issuerId === issuerId, 'INVALID_INPUT', '原账单账户与卡片不匹配', 'billingAccountId');
    const otherCards = previousAccount ? (await ownedCards(ctx)).filter(card => !card.archivedAt && card.kind === 'credit' && card.id !== previous?.id && card.billingAccountId === previousAccount.id) : [];
    const canReuse = previousAccount && otherCards.length === 0;
    accountId = canReuse ? previousAccount.id : ctx.newId('account');
    account = { id: accountId, ownerId: ctx.actor.userId, bankId, issuerId, label: nickname || '信用卡账单', ...settings, enabled: true };
    if (payload.billing.dueOn !== undefined) {
      if (payload.billing.billId !== undefined) {
        correctedBill = await ctx.owned<Bill>('bills', payload.billing.billId);
        requireValue(canReuse && correctedBill.billingAccountId === accountId && correctedBill.periodKey === payload.billing.periodKey,
          'VERSION_CONFLICT', '账单关联已变化，请重新读取后再修正日期', 'dueOn');
      } else {
        requireValue(payload.billing.periodKey === undefined || payload.billing.periodKey === monthOf(ctx.today),
          'VERSION_CONFLICT', '账单月份已变化，请重新读取本期账单后再保存', 'dueOn');
        correctedBill = canReuse ? await currentBill(ctx, accountId) : undefined;
      }
      correctedDueOn = checkDueOn(payload.billing.dueOn, correctedBill?.statementOn || billDates(account, monthOf(ctx.today)).statementOn);
    }
  } else if (!cancelBilling && accountId) {
    const existing = await ctx.owned<BillingAccount>('billing_accounts', accountId);
    requireValue(existing.bankId === bankId && existing.issuerId === issuerId, 'INVALID_INPUT', '账单账户与卡片不匹配', 'billingAccountId');
  }

  const id = previous?.id || ctx.newId('card');
  const card: Card = { id, ownerId: ctx.actor.userId, bankId, issuerId, network: payload.network, kind: payload.kind, nickname, createdAt: previous?.createdAt || ctx.now };
  if (accountId) card.billingAccountId = accountId;
  if (account) {
    const before = await ctx.store.get<BillingAccount>('billing_accounts', account.id);
    await ctx.store.set('billing_accounts', account.id, account);
    await ctx.audit(account.id, before ? 'billing_account.updated' : 'billing_account.created', before || undefined, account);
  }
  await ctx.store.set('cards', id, card);
  await ctx.audit(id, previous ? 'card.updated' : 'card.created', previous || undefined, card);
  if (previous?.billingAccountId && previous.billingAccountId !== accountId) await disableUnusedAccount(ctx, previous.billingAccountId);
  if (accountId) await ensureBills(ctx, 1, accountId);
  if (accountId && correctedDueOn !== undefined) {
    const bill = correctedBill || await currentBill(ctx, accountId);
    if (!bill) throw new DomainError('CONFLICT', '未能生成本期账单，请重试');
    if (bill.dueOn !== correctedDueOn) {
      const updated = { ...bill, dueOn: correctedDueOn };
      await ctx.store.set('bills', bill.id, updated);
      await ctx.audit(bill.id, 'bill.updated', bill, updated);
    }
  }
  return { id };
}

export async function removeCard(ctx: Context, payload: Commands['card.remove']): Promise<MutationResult> {
  const card = await ctx.owned<Card>('cards', validId(payload?.id, 'id'));
  if (card.archivedAt) return { id: card.id };
  const archived: Card = { ...card, archivedAt: ctx.now };
  await ctx.store.set('cards', card.id, archived);
  await ctx.audit(card.id, 'card.archived', card, archived);
  await disableUnusedAccount(ctx, card.billingAccountId);
  return { id: card.id };
}

export async function updateBill(ctx: Context, payload: Commands['bill.update']): Promise<MutationResult> {
  const bill = await ctx.owned<Bill>('bills', validId(payload?.id, 'id'));
  requireValue(payload.dueOn !== undefined || payload.paid !== undefined || payload.amountMinor !== undefined || payload.currency !== undefined,
    'INVALID_INPUT', '请选择要修改的账单内容');
  requireValue(payload.paid === undefined || typeof payload.paid === 'boolean', 'INVALID_INPUT', '还款状态无效', 'paid');
  if (payload.amountMinor !== undefined) {
    requireValue(Number.isSafeInteger(payload.amountMinor) && payload.amountMinor >= 0 && payload.amountMinor <= 1e11,
      'INVALID_INPUT', '请填写有效账单金额', 'amountMinor');
  }
  requireValue(payload.currency === undefined || ['CNY', 'HKD', 'MOP'].includes(payload.currency), 'INVALID_INPUT', '请选择有效币种', 'currency');
  const amountMinor = payload.amountMinor === undefined ? bill.amountMinor : payload.amountMinor;
  requireValue(payload.currency === undefined || amountMinor !== undefined, 'INVALID_INPUT', '请先填写账单金额，再选择币种', 'currency');
  const currency = amountMinor === undefined ? bill.currency : payload.currency || bill.currency || 'CNY';
  const dueOn = payload.dueOn === undefined ? bill.dueOn : checkDueOn(payload.dueOn, bill.statementOn);
  const paidAt = payload.paid === undefined ? bill.paidAt : payload.paid ? bill.paidAt || ctx.now : null;
  if (dueOn !== bill.dueOn || paidAt !== bill.paidAt || amountMinor !== bill.amountMinor || currency !== bill.currency) {
    const updated: Bill = { ...bill, dueOn, paidAt, ...(amountMinor === undefined ? {} : { amountMinor, currency }) };
    await ctx.store.set('bills', bill.id, updated);
    await ctx.audit(bill.id, 'bill.updated', bill, updated);
  }
  return { id: bill.id };
}

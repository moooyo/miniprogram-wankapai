import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, ApiEnvelope, ApiRequest, AuditEvent, Bill, BillingAccount, Card, CommandName, Commands } from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';

type RecordedRequest = { action: ApiRequest['action']; payload: unknown; requestId?: string };
type CloudResponse = { result: ApiEnvelope<unknown> };
type Transport = (request: RecordedRequest, commit: () => Promise<CloudResponse>) => Promise<CloudResponse>;

const originalSettings = { mode: settings.mode, cloudEnvId: settings.cloudEnvId, templateIds: settings.templateIds };
const originalWx = (globalThis as any).wx;
let fixtureSequence = 0;
let requests: RecordedRequest[];
let transport: Transport;
let f: ReturnType<typeof fixture>;

function fixture() {
  const prefix = `billing-target-${++fixtureSequence}`;
  const actor: Actor = { userId: `${prefix}-owner`, isModerator: false };
  const account: BillingAccount = {
    id: `${prefix}-account`, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', label: 'Independent account',
    statementDay: 5, dueDay: 10, dueMonthOffset: 1, remindDays: 3, enabled: true,
  };
  const card: Card = {
    id: `${prefix}-card`, ownerId: actor.userId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit',
    nickname: 'Independent credit card', billingAccountId: account.id, createdAt: '2026-09-01T04:00:00.000Z',
  };
  const oldBill: Bill = {
    id: `${prefix}-september`, ownerId: actor.userId, billingAccountId: account.id, periodKey: '2026-09',
    statementOn: '2026-09-05', dueOn: '2026-10-10', paidAt: null,
  };
  const currentBill: Bill = {
    id: `${prefix}-october`, ownerId: actor.userId, billingAccountId: account.id, periodKey: '2026-10',
    statementOn: '2026-10-05', dueOn: '2026-11-10', paidAt: null,
  };
  const templateIds = {
    new_activity: `${prefix}-new-activity`, deadline: `${prefix}-deadline`,
    reward: `${prefix}-reward`, repayment: `${prefix}-repayment`,
  };
  const store = new MemoryStore({
    cards: { [card.id]: card }, billing_accounts: { [account.id]: account },
    bills: { [oldBill.id]: oldBill, [currentBill.id]: currentBill },
  });
  const service = createService(store, {
    now: () => new Date('2026-10-02T04:00:00.000Z'), demo: true, templateIds,
  });
  const oldBillCorrection: Commands['card.save'] = {
    id: card.id, bankId: card.bankId, issuerId: card.issuerId, network: card.network, kind: card.kind, nickname: card.nickname,
    billing: {
      statementDay: 5, dueDay: 10, dueMonthOffset: 1, remindDays: 3,
      billId: oldBill.id, periodKey: oldBill.periodKey, dueOn: '2026-10-12',
    },
  };
  return { prefix, actor, account, card, oldBill, currentBill, templateIds, store, service, oldBillCorrection };
}

beforeEach(async () => {
  f = fixture();
  requests = [];
  settings.mode = 'cloud';
  settings.cloudEnvId = `${f.prefix}-environment`;
  settings.templateIds = f.templateIds;
  transport = async (_request, commit) => commit();
  (globalThis as any).wx = {
    cloud: {
      init: () => {},
      callFunction: async ({ data }: { data: ApiRequest }) => {
        const request = structuredClone(data) as RecordedRequest;
        requests.push(request);
        return transport(request, async () => {
          try { return { result: { ok: true, data: await f.service.execute(f.actor, request as ApiRequest) } }; }
          catch (error) {
            if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
            throw error;
          }
        });
      },
    },
  };
  await api.query('session.get', {});
  await api.query('wallet.get', {});
  requests = [];
});

after(() => {
  settings.mode = originalSettings.mode;
  settings.cloudEnvId = originalSettings.cloudEnvId;
  settings.templateIds = originalSettings.templateIds;
  if (originalWx === undefined) delete (globalThis as any).wx;
  else (globalThis as any).wx = originalWx;
});

function loseFirstResponse(action: CommandName): void {
  let lost = false;
  transport = async (request, commit) => {
    const response = await commit();
    if (!lost && request.action === action && response.result.ok) {
      lost = true;
      throw new Error('Response lost after commit');
    }
    return response;
  };
}

function hasCode(code: string) {
  return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function attempts(action: CommandName): RecordedRequest[] {
  const sent = requests.filter(request => request.action === action);
  for (const request of sent) assert.ok(request.requestId, 'Every mutation must retain its request identity.');
  return sent;
}

async function billAuditCount(id: string): Promise<number> {
  return (await f.store.find<AuditEvent>('audit_events')).filter(event => event.entityId === id && event.action === 'bill.updated').length;
}

test('an explicit historical card correction retires the retry for that historical bill', async () => {
  const original: Commands['bill.update'] = { id: f.oldBill.id, dueOn: '2026-10-11' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', original), hasCode('NETWORK_ERROR'));
  assert.equal((await f.store.get<Bill>('bills', f.oldBill.id))?.dueOn, original.dueOn);

  await api.command('card.save', f.oldBillCorrection);
  assert.equal((await f.store.get<Bill>('bills', f.oldBill.id))?.dueOn, '2026-10-12');
  await api.command('bill.update', original);

  const sent = attempts('bill.update');
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].requestId, sent[0].requestId);
  assert.deepEqual(await f.store.get<Bill>('bills', f.oldBill.id), { ...f.oldBill, dueOn: original.dueOn });
  assert.deepEqual(await f.store.get<Bill>('bills', f.currentBill.id), f.currentBill);
  assert.equal(await billAuditCount(f.oldBill.id), 3);
  assert.equal(await billAuditCount(f.currentBill.id), 0);
  assert.equal((await f.store.find('requests')).length, 3);
});

test('an explicit historical card correction preserves the current bill retry identity', async () => {
  const original: Commands['bill.update'] = { id: f.currentBill.id, dueOn: '2026-11-11' };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', original), hasCode('NETWORK_ERROR'));
  await api.command('card.save', f.oldBillCorrection);
  const auditsBeforeRetry = (await f.store.find('audit_events')).length;
  const requestsBeforeRetry = (await f.store.find('requests')).length;

  await api.command('bill.update', original);

  const sent = attempts('bill.update');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.deepEqual(await f.store.get<Bill>('bills', f.currentBill.id), { ...f.currentBill, dueOn: original.dueOn });
  assert.deepEqual(await f.store.get<Bill>('bills', f.oldBill.id), { ...f.oldBill, dueOn: '2026-10-12' });
  assert.equal(await billAuditCount(f.currentBill.id), 1);
  assert.equal(await billAuditCount(f.oldBill.id), 1);
  assert.equal((await f.store.find('audit_events')).length, auditsBeforeRetry);
  assert.equal((await f.store.find('requests')).length, requestsBeforeRetry);
});

test('a billing rule change without a due date preserves existing bills and the current bill retry identity', async () => {
  const original: Commands['bill.update'] = { id: f.currentBill.id, dueOn: '2026-11-11' };
  const ruleChange: Commands['card.save'] = {
    ...f.oldBillCorrection,
    nickname: 'Updated billing rules',
    billing: { statementDay: 6, dueDay: 15, dueMonthOffset: 1, remindDays: 5 },
  };
  loseFirstResponse('bill.update');
  await assert.rejects(api.command('bill.update', original), hasCode('NETWORK_ERROR'));
  await api.command('card.save', ruleChange);
  const auditsBeforeRetry = (await f.store.find('audit_events')).length;
  const requestsBeforeRetry = (await f.store.find('requests')).length;

  await api.command('bill.update', original);

  const sent = attempts('bill.update');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].requestId, sent[0].requestId);
  assert.deepEqual(await f.store.get<Bill>('bills', f.currentBill.id), { ...f.currentBill, dueOn: original.dueOn });
  assert.deepEqual(await f.store.get<Bill>('bills', f.oldBill.id), f.oldBill);
  assert.equal((await f.store.find('bills')).length, 2);
  assert.equal((await f.store.get<Card>('cards', f.card.id))?.billingAccountId, f.account.id);
  const account = await f.store.get<BillingAccount>('billing_accounts', f.account.id);
  assert.equal(account?.statementDay, 6);
  assert.equal(account?.dueDay, 15);
  assert.equal(account?.remindDays, 5);
  assert.equal(await billAuditCount(f.currentBill.id), 1);
  assert.equal(await billAuditCount(f.oldBill.id), 0);
  assert.equal((await f.store.find('audit_events')).length, auditsBeforeRetry);
  assert.equal((await f.store.find('requests')).length, requestsBeforeRetry);
});

test('a direct historical bill correction retires the lost response for a card edit of that same bill', async () => {
  loseFirstResponse('card.save');
  await assert.rejects(api.command('card.save', f.oldBillCorrection), hasCode('NETWORK_ERROR'));
  assert.equal((await f.store.get<Bill>('bills', f.oldBill.id))?.dueOn, '2026-10-12');
  await api.command('bill.update', { id: f.oldBill.id, dueOn: '2026-10-13' });
  assert.equal((await f.store.get<Bill>('bills', f.oldBill.id))?.dueOn, '2026-10-13');

  await api.command('card.save', f.oldBillCorrection);

  const sent = attempts('card.save');
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].requestId, sent[0].requestId);
  assert.deepEqual(await f.store.get<Bill>('bills', f.oldBill.id), { ...f.oldBill, dueOn: '2026-10-12' });
  assert.deepEqual(await f.store.get<Bill>('bills', f.currentBill.id), f.currentBill);
  assert.equal(await billAuditCount(f.oldBill.id), 3);
  assert.equal(await billAuditCount(f.currentBill.id), 0);
  assert.equal((await f.store.find('requests')).length, 3);
});

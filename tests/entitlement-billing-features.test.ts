import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Actor, ApiRequest, Bill, Commands, Entitlement, EntitlementDetail, EntitlementDraft, MutationResult, Wallet,
} from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';

const owner: Actor = { userId: 'feature-owner', isModerator: false };
const stranger: Actor = { userId: 'feature-stranger', isModerator: false };
const moderator: Actor = { userId: 'feature-moderator', isModerator: true };

function draft(overrides: Partial<EntitlementDraft> = {}): EntitlementDraft {
  return {
    title: 'Personal benefit', kind: 'airport_transfer', cardId: '', provider: 'Fixture provider',
    totalUses: 4, initialUsed: 0, startsOn: '2026-01-01', endsOn: '2026-12-31',
    transferability: 'not_allowed', transferNote: '', notes: '', lounges: [], ...overrides,
  };
}

function fixture() {
  const store = new MemoryStore();
  let now = new Date('2026-09-24T04:00:00.000Z');
  const service = createService(store, { now: () => now });
  let sequence = 0;
  return {
    store, service,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `feature-request-${++sequence}`) =>
      service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
    query: <T>(action: string, payload: unknown = {}, actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T>,
  };
}

function code(expected: string, field?: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected && (field === undefined || error.field === field);
}

async function createBill(f: ReturnType<typeof fixture>) {
  const created = await f.command('card.save', {
    bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Fixture card',
    billing: { statementDay: 20, dueDay: 10, dueMonthOffset: 1, remindDays: 3 },
  });
  const wallet = await f.query<Wallet>('wallet.get');
  const card = wallet.cards.find(row => row.id === created.id)!;
  const bill = wallet.bills.find(row => row.billingAccountId === card.billingAccountId && row.periodKey === '2026-09')!;
  return { card, bill };
}

test('information benefits store details and point balances without creating use counters', async () => {
  const f = fixture();
  for (const kind of ['delay_insurance', 'points'] as const) {
    const created = await f.command('entitlement.save', {
      draft: draft({ kind, totalUses: 0, initialUsed: 0, description: ' Confirm eligibility and the provider terms. ',
        ...(kind === 'points' ? { pointsBalance: 12500 } : {}) }),
    });
    const detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
    assert.equal(detail.entitlement.kind, kind);
    assert.equal(detail.entitlement.description, 'Confirm eligibility and the provider terms.');
    assert.equal(detail.entitlement.usedUses, 0);
    assert.equal(detail.entitlement.totalUses, 0);
    assert.equal(detail.entitlement.initialUsed, 0);
    assert.equal(detail.entitlement.pointsBalance, kind === 'points' ? 12500 : undefined);
    assert.deepEqual(detail.usages, []);
    const unchanged = await f.store.exportSeed();
    await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 1 }), code('ENTITLEMENT_INFORMATION_ONLY'));
    assert.deepEqual(await f.store.exportSeed(), unchanged);
    await f.command('entitlement.archive', { id: created.id, archived: true, expectedVersion: 1 });
    await f.command('entitlement.archive', { id: created.id, archived: false, expectedVersion: 2 });
  }
});

test('information counters and optional metadata reject incompatible or malformed inputs atomically', async () => {
  const f = fixture();
  const cases: [Partial<EntitlementDraft>, string][] = [
    [{ kind: 'delay_insurance', totalUses: 1 }, 'totalUses'],
    [{ kind: 'points', totalUses: 1 }, 'totalUses'],
    [{ kind: 'points', totalUses: 0, initialUsed: 1 }, 'initialUsed'],
    [{ description: 'x'.repeat(2001) }, 'description'],
    [{ description: 'invalid\u0000description' }, 'description'],
    [{ pointsBalance: 0 }, 'pointsBalance'],
    [{ kind: 'points', totalUses: 0, pointsBalance: -1 }, 'pointsBalance'],
    [{ kind: 'points', totalUses: 0, pointsBalance: 0.1 }, 'pointsBalance'],
    [{ kind: 'points', totalUses: 0, pointsBalance: Number.MAX_SAFE_INTEGER + 1 }, 'pointsBalance'],
    [{ kind: 'points', totalUses: 0, pointsBalance: Number.NaN }, 'pointsBalance'],
    [{ loungeProgram: 'pp' }, 'loungeProgram'],
    [{ kind: 'lounge', loungeProgram: 'invalid' as EntitlementDraft['loungeProgram'] }, 'loungeProgram'],
  ];
  const before = await f.store.exportSeed();
  for (const [overrides, field] of cases) {
    await assert.rejects(f.command('entitlement.save', { draft: draft(overrides) }), code('INVALID_INPUT', field));
    assert.deepEqual(await f.store.exportSeed(), before);
  }
  const maximum = await f.command('entitlement.save', { draft: draft({ kind: 'points', totalUses: 0, pointsBalance: Number.MAX_SAFE_INTEGER }) });
  assert.equal((await f.store.get<Entitlement>('entitlements', maximum.id))?.pointsBalance, Number.MAX_SAFE_INTEGER);
});

test('new counted benefits retain ownership, version, concurrent spending, and exact reversal guarantees', async () => {
  const f = fixture();
  for (const kind of ['airport_transfer', 'car_wash'] as const) {
    const created = await f.command('entitlement.save', { draft: draft({ kind, totalUses: 3, initialUsed: 1 }) });
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => f.command('entitlement.use', {
      id: created.id, quantity: 2, usedOn: '2026-09-24', expectedVersion: 1,
    })));
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<MutationResult> => result.status === 'fulfilled');
    assert.equal(fulfilled.length, 1);
    assert.ok(results.filter(result => result.status === 'rejected').every(result => result.status === 'rejected' && code('VERSION_CONFLICT')(result.reason)));
    const usage = fulfilled[0].value;
    assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 3);
    await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 2 }), code('INSUFFICIENT_USES'));
    const beforeForeignRequests = await f.store.exportSeed();
    for (const actor of [stranger, moderator]) {
      await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 2 }, actor), code('NOT_FOUND'));
      await assert.rejects(f.command('entitlement.undo', { id: usage.id, expectedVersion: 2 }, actor), code('NOT_FOUND'));
    }
    assert.deepEqual(await f.store.exportSeed(), beforeForeignRequests);
    await f.command('entitlement.undo', { id: usage.id, expectedVersion: 2 });
    assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 1);
  }
});

test('kind changes cannot hide active uses and remove metadata that no longer belongs to the draft', async () => {
  const f = fixture();
  const lounge = await f.command('entitlement.save', { draft: draft({ kind: 'lounge', loungeProgram: 'dragon', description: 'Provider details' }) });
  const usage = await f.command('entitlement.use', { id: lounge.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 1 });
  const before = await f.store.exportSeed();
  for (const kind of ['delay_insurance', 'points'] as const) {
    await assert.rejects(f.command('entitlement.save', {
      id: lounge.id, expectedVersion: 2, draft: draft({ kind, totalUses: 0 }),
    }), code('ENTITLEMENT_INFORMATION_ONLY', 'kind'));
    assert.deepEqual(await f.store.exportSeed(), before);
  }
  await f.command('entitlement.undo', { id: usage.id, expectedVersion: 2 });
  await f.command('entitlement.save', { id: lounge.id, expectedVersion: 3, draft: draft({ kind: 'points', totalUses: 0, pointsBalance: 0 }) });
  const points = (await f.store.get<Entitlement>('entitlements', lounge.id))!;
  assert.equal(points.pointsBalance, 0);
  assert.equal('loungeProgram' in points, false);
  assert.equal('description' in points, false);
  assert.equal(points.usedUses, 0);
  await assert.rejects(f.command('entitlement.undo', { id: usage.id, expectedVersion: 4 }), code('ENTITLEMENT_INFORMATION_ONLY'));
  await f.command('entitlement.save', { id: lounge.id, expectedVersion: 4, draft: draft({ kind: 'car_wash' }) });
  const counted = (await f.store.get<Entitlement>('entitlements', lounge.id))!;
  assert.equal('pointsBalance' in counted, false);
  assert.equal((await f.query<EntitlementDetail>('entitlement.get', { id: lounge.id })).usages.length, 1);
});

test('all lounge programs are saved only for lounge benefits', async () => {
  const f = fixture();
  for (const loungeProgram of ['dragon', 'pp', 'plaza', 'unionpay', 'other'] as const) {
    const created = await f.command('entitlement.save', { draft: draft({ kind: 'lounge', loungeProgram }) });
    assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.loungeProgram, loungeProgram);
  }
});

test('generated bills and date or paid edits keep an unknown amount absent', async () => {
  const f = fixture();
  const { bill } = await createBill(f);
  assert.equal('amountMinor' in bill, false);
  assert.equal('currency' in bill, false);
  await f.command('bill.update', { id: bill.id, dueOn: '2026-10-12', paid: true });
  const updated = (await f.store.get<Bill>('bills', bill.id))!;
  assert.equal('amountMinor' in updated, false);
  assert.equal('currency' in updated, false);
  f.setDate('2026-10-01');
  const next = (await f.query<Wallet>('wallet.get')).bills.find(row => row.periodKey === '2026-10')!;
  assert.equal('amountMinor' in next, false);
  assert.equal('currency' in next, false);
});

test('bill amounts default once to CNY and retain explicit currencies across amount and status edits', async () => {
  const f = fixture();
  const { bill } = await createBill(f);
  await f.command('bill.update', { id: bill.id, amountMinor: 0 });
  assert.equal((await f.store.get<Bill>('bills', bill.id))?.amountMinor, 0);
  assert.equal((await f.store.get<Bill>('bills', bill.id))?.currency, 'CNY');
  await f.command('bill.update', { id: bill.id, currency: 'HKD' });
  await f.command('bill.update', { id: bill.id, amountMinor: 1e11, paid: true });
  const known = (await f.store.get<Bill>('bills', bill.id))!;
  assert.equal(known.amountMinor, 1e11);
  assert.equal(known.currency, 'HKD');
  assert.equal(known.paidAt, '2026-09-24T04:00:00.000Z');
  const auditCount = (await f.store.find('audit_events')).length;
  await f.command('bill.update', { id: bill.id, amountMinor: 1e11, currency: 'HKD', paid: true });
  assert.equal((await f.store.find('audit_events')).length, auditCount);
  f.setDate('2026-09-25');
  await f.command('bill.update', { id: bill.id, dueOn: '2026-10-15', paid: true });
  const changed = (await f.store.get<Bill>('bills', bill.id))!;
  assert.equal(changed.amountMinor, 1e11);
  assert.equal(changed.currency, 'HKD');
  assert.equal(changed.paidAt, known.paidAt);
  const second = await createBill(f);
  await f.command('bill.update', { id: second.bill.id, amountMinor: 1299, currency: 'MOP' });
  assert.equal((await f.store.get<Bill>('bills', second.bill.id))?.currency, 'MOP');
});

test('invalid bill amounts and currencies reject mixed edits without partial changes or audits', async () => {
  const f = fixture();
  const { bill } = await createBill(f);
  const before = await f.store.exportSeed();
  await assert.rejects(f.command('bill.update', { id: bill.id, currency: 'HKD', paid: true }), code('INVALID_INPUT', 'currency'));
  for (const amountMinor of [-1, 0.1, 1e11 + 1, Number.NaN, Number.POSITIVE_INFINITY, '100', null]) {
    await assert.rejects(f.command('bill.update', {
      id: bill.id, amountMinor: amountMinor as number, dueOn: '2026-10-15', paid: true,
    }), code('INVALID_INPUT', 'amountMinor'));
    assert.deepEqual(await f.store.exportSeed(), before);
  }
  for (const currency of ['', 'USD', null]) {
    await assert.rejects(f.command('bill.update', {
      id: bill.id, amountMinor: 100, currency: currency as Bill['currency'], paid: true,
    }), code('INVALID_INPUT', 'currency'));
    assert.deepEqual(await f.store.exportSeed(), before);
  }
  await assert.rejects(f.command('bill.update', { id: bill.id, amountMinor: 100, dueOn: '2026-09-19', paid: true }), code('INVALID_DATE', 'dueOn'));
  await assert.rejects(f.command('bill.update', { id: bill.id }), code('INVALID_INPUT'));
  assert.deepEqual(await f.store.exportSeed(), before);
});

test('historical bill amounts preserve their snapshots and exact request replay across a month change', async () => {
  const f = fixture();
  const { card, bill } = await createBill(f);
  const payload: Commands['bill.update'] = { id: bill.id, amountMinor: 220050, currency: 'HKD', paid: true };
  const result = await f.command('bill.update', payload, owner, 'original-bill-amount');
  const original = (await f.store.get<Bill>('bills', bill.id))!;
  f.setDate('2026-10-01');
  const next = (await f.query<Wallet>('wallet.get')).bills.find(row => row.periodKey === '2026-10')!;
  const beforeReplay = await f.store.exportSeed();
  assert.deepEqual(await f.command('bill.update', payload, owner, 'original-bill-amount'), result);
  assert.deepEqual(await f.store.exportSeed(), beforeReplay);
  await assert.rejects(f.command('bill.update', { ...payload, amountMinor: 1 }, owner, 'original-bill-amount'), code('REQUEST_CONFLICT'));
  for (const actor of [stranger, moderator]) {
    await assert.rejects(f.command('bill.update', { id: bill.id, amountMinor: 1, paid: false }, actor), code('NOT_FOUND'));
  }
  await f.command('bill.update', { id: bill.id, amountMinor: 199900 });
  const corrected = (await f.store.get<Bill>('bills', bill.id))!;
  assert.deepEqual(corrected, { ...original, amountMinor: 199900 });
  assert.deepEqual(await f.store.get<Bill>('bills', next.id), next);
  await f.command('card.save', {
    id: card.id, bankId: card.bankId, issuerId: card.issuerId, network: card.network, kind: card.kind, nickname: card.nickname,
    billing: { statementDay: 25, dueDay: 15, dueMonthOffset: 1, remindDays: 5, dueOn: '2026-10-12', billId: bill.id, periodKey: '2026-09' },
  });
  assert.deepEqual(await f.store.get<Bill>('bills', bill.id), { ...corrected, dueOn: '2026-10-12' });
  assert.deepEqual(await f.store.get<Bill>('bills', next.id), next);
});

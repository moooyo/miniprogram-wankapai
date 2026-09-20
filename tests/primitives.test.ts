import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityDraft } from '../shared/contracts';
import { addDays, addMonths, billDates, isDate, periodFor, todayCN } from '../domain/calendar';
import { MemoryStore } from '../domain/memory-store';
import { validateDraft, validatePublicHttps } from '../domain/validation';

function draft(): ActivityDraft {
  return {
    title: 'Monthly card benefit', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'],
    cardKind: 'credit', cardDescription: 'Eligible cards', frequency: 'monthly',
    startsOn: '2026-09-05', endsOn: '2026-12-20', target: 3, unit: 'visits',
    currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: 'Three eligible visits',
    sourceUrl: 'https://www.cmbchina.com/promotion', sourceNote: '',
    entrance: { kind: 'guide', label: 'Open the bank app', instructions: 'Open benefits', imageIds: [] }
  };
}

test('periods follow calendar boundaries and clip first and final periods', () => {
  const activity = draft();
  assert.deepEqual(periodFor(activity, '2026-09-20'), { periodKey: '2026-09', startsOn: '2026-09-05', endsOn: '2026-09-30' });
  assert.deepEqual(periodFor(activity, '2026-12-15'), { periodKey: '2026-12', startsOn: '2026-12-01', endsOn: '2026-12-20' });
  assert.equal(periodFor(activity, '2026-12-21'), null);
  activity.frequency = 'quarterly';
  assert.deepEqual(periodFor(activity, '2026-09-20'), { periodKey: '2026-Q3', startsOn: '2026-09-05', endsOn: '2026-09-30' });
  activity.frequency = 'yearly';
  assert.deepEqual(periodFor(activity, '2026-09-20'), { periodKey: '2026', startsOn: '2026-09-05', endsOn: '2026-12-20' });
  activity.frequency = 'once';
  assert.equal(periodFor(activity, '2026-09-20')!.periodKey, 'once');
});

test('dates clamp month-end without accidental UTC or year rollover', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', -1), '2025-12-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(todayCN(new Date('2026-09-19T16:00:00Z')), '2026-09-20');
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2024-02-29'), true);
  assert.deepEqual(billDates({ statementDay: 31, dueDay: 31, dueMonthOffset: 1 }, '2026-01'), { statementOn: '2026-01-31', dueOn: '2026-02-28' });
});

test('memory snapshots never retain caller references', async () => {
  const input = { id: 'one', nested: { amount: 1 } };
  const store = new MemoryStore({ requests: { one: input } });
  input.nested.amount = 9;
  const first = await store.get<typeof input>('requests', 'one');
  assert.equal(first!.nested.amount, 1);
  first!.nested.amount = 20;
  assert.equal((await store.get<typeof input>('requests', 'one'))!.nested.amount, 1);
  const seed = await store.exportSeed();
  (seed.requests!.one as typeof input).nested.amount = 30;
  assert.equal((await store.get<typeof input>('requests', 'one'))!.nested.amount, 1);
});

test('transactions roll back all writes and serialize competing updates', async () => {
  const store = new MemoryStore({ requests: { count: { value: 0 } } });
  await assert.rejects(store.transaction(async transaction => {
    await transaction.set('requests', 'count', { value: 99 });
    await transaction.set('requests', 'extra', { value: 1 });
    throw new Error('Rollback');
  }));
  assert.equal(await store.get('requests', 'extra'), null);
  await Promise.all(Array.from({ length: 20 }, () => store.transaction(async transaction => {
    const current = await transaction.get<{ value: number }>('requests', 'count');
    await transaction.set('requests', 'count', { value: current!.value + 1 });
  })));
  assert.deepEqual(await store.get('requests', 'count'), { value: 20 });
});

test('find applies owner filters before ordering and pagination', async () => {
  const store = new MemoryStore({ requests: {
    a: { ownerId: 'one', value: 2 }, b: { ownerId: 'two', value: 1 },
    c: { ownerId: 'one', value: 4 }, d: { ownerId: 'one', value: 3 }
  } });
  const found = await store.find('requests', { where: [{ field: 'ownerId', op: 'eq', value: 'one' }], orderBy: [{ field: 'value', direction: 'desc' }], offset: 1, limit: 1 });
  assert.deepEqual(found, [{ ownerId: 'one', value: 3 }]);
});

test('submission drafts may omit editorial content but publication may not', () => {
  const incomplete = draft();
  incomplete.conditions = '';
  incomplete.sourceUrl = '';
  incomplete.sourceNote = 'Bank app > Card benefits > Monthly card benefit';
  incomplete.entrance.instructions = '';
  assert.doesNotThrow(() => validateDraft(incomplete, false));
  assert.throws(() => validateDraft(incomplete, true));
  assert.equal(validateDraft(draft(), true).title, 'Monthly card benefit');
  const input = draft();
  const validated = validateDraft(input, true);
  input.issuerIds.push('another');
  assert.deepEqual(validated.issuerIds, ['cmb-cn']);
});

test('monetary thresholds allow two decimals while count thresholds require integers', () => {
  for (const unit of ['元', '港元', '澳门元']) {
    for (const target of [0.01, 1.01, 999.99, 100000000]) {
      assert.equal(validateDraft({ ...draft(), unit, target }).target, target);
    }
    for (const target of [0, -1, 0.001, 1.001, 100000000.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => validateDraft({ ...draft(), unit, target }), `${unit}: ${target}`);
    }
  }
  for (const unit of ['笔', '次']) {
    assert.equal(validateDraft({ ...draft(), unit, target: 3 }).target, 3);
    assert.throws(() => validateDraft({ ...draft(), unit, target: 1.5 }));
    assert.throws(() => validateDraft({ ...draft(), unit, target: 0 }));
  }
});

test('verified app source paths can be published without an external source URL', () => {
  const input = { ...draft(), sourceUrl: '', sourceNote: 'Bank app > Card benefits > Monthly card benefit' };
  assert.equal(validateDraft(input, true).sourceNote, input.sourceNote);
  assert.equal(validateDraft(input, true).sourceUrl, '');
  for (const publish of [false, true]) {
    assert.throws(() => validateDraft({ ...input, sourceNote: '' }, publish));
    assert.throws(() => validateDraft({ ...input, sourceNote: '   ' }, publish));
    assert.throws(() => validateDraft({ ...input, sourceUrl: 'http://www.cmbchina.com/' }, publish));
    assert.throws(() => validateDraft({ ...input, entrance: { ...input.entrance, kind: 'web', url: 'https://localhost/' } }, publish));
  }
});

test('public URL validation rejects local, encoded and credential authorities', () => {
  for (const url of ['http://www.cmbchina.com', 'https://localhost/path', 'https://127.0.0.1', 'https://10.0.0.2', 'https://[::1]', 'https://2130706433', 'https://0177.0.0.1', 'https://user:pass@www.cmbchina.com', 'https://www.cmbchina.com\\@localhost', 'https://example.com', 'https://foo.internal', 'https://%31%32%37.0.0.1']) {
    assert.throws(() => validatePublicHttps(url), url);
  }
  assert.equal(validatePublicHttps('https://www.cmbchina.com/promotion?id=1'), 'https://www.cmbchina.com/promotion?id=1');
});

test('entrances validate real identifiers and bound image lists', () => {
  const input = draft();
  input.entrance = { kind: 'miniprogram', label: 'Open', appId: 'wx0123456789abcdef', instructions: '', imageIds: [] };
  assert.doesNotThrow(() => validateDraft(input, true));
  input.entrance.appId = 'wx-invalid';
  assert.throws(() => validateDraft(input, true));
  input.entrance = { kind: 'guide', label: 'Open', instructions: 'Open benefits', imageIds: Array.from({ length: 7 }, (_, index) => `asset_${index}`) };
  assert.throws(() => validateDraft(input, true));
});

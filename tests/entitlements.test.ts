import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Actor, ApiRequest, Card, Commands, Entitlement, EntitlementDetail, EntitlementDraft, EntitlementList,
  EntitlementUsage, LoungeAccess, MutationResult,
} from '../shared/contracts';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { Store } from '../domain/store';

const user: Actor = { userId: 'entitlement-owner', isModerator: false };
const other: Actor = { userId: 'other-owner', isModerator: false };
const moderator: Actor = { userId: 'operator', isModerator: true };

function lounge(overrides: Partial<LoungeAccess> = {}): LoungeAccess {
  return {
    id: 'lounge-a', airportName: 'Fixture airport', airportCode: 'TST', city: 'Fixture city', loungeName: 'Fixture lounge',
    terminal: 'T1', zone: 'domestic', reservation: 'required', advanceHours: 4, reservationNote: 'Book through the issuer.',
    customerScope: 'local_bank', customerNote: 'Fixture bank customers in the fixture region only.',
    guestNote: 'Confirm guest pricing.', openingHours: '', location: '', unitsPerVisit: 1,
    sourceNote: 'Synthetic test fixture.', verifiedOn: '2026-09-01', ...overrides,
  };
}

function draft(overrides: Partial<EntitlementDraft> = {}): EntitlementDraft {
  return {
    title: 'Fixture personal entitlement', kind: 'lounge', cardId: '', provider: 'Fixture provider', totalUses: 6, initialUsed: 0,
    startsOn: '2026-01-01', endsOn: '2026-12-31', transferability: 'grey',
    transferNote: 'Unofficial information; confirm with the provider.', notes: '', lounges: [lounge()], ...overrides,
  };
}

function card(id: string, ownerId = user.userId, archived = false): Card {
  return {
    id, ownerId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Fixture card',
    createdAt: '2026-01-01T00:00:00.000Z', ...(archived ? { archivedAt: '2026-09-01T00:00:00.000Z' } : {}),
  };
}

function fixture(store = new MemoryStore()) {
  let now = new Date('2026-09-24T04:00:00.000Z');
  let sequence = 0;
  const service = createService(store, { now: () => now });
  return {
    store, service,
    setDate: (date: string) => { now = new Date(`${date}T04:00:00.000Z`); },
    query: <T>(action: string, payload: unknown = {}, actor = user) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T>,
    command: <K extends keyof Commands>(action: K, payload: Commands[K], actor = user, requestId = `entitlement-request-${++sequence}`) =>
      service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>,
  };
}

function code(expected: string, field?: string) {
  return (error: unknown) => error instanceof DomainError && error.code === expected && (field === undefined || error.field === field);
}

test('held entitlements retain explicit validity and opening balances without recurring resets or query writes', async () => {
  const f = fixture(new MemoryStore({ cards: {
    active: card('active'), archived: card('archived', user.userId, true), foreign: card('foreign', other.userId),
  } }));
  const created = await f.command('entitlement.save', { draft: draft({ initialUsed: 2, cardId: 'active' }) });
  await f.command('entitlement.save', { draft: draft({ kind: 'health_check', transferability: 'allowed', lounges: [] }) });
  await f.command('entitlement.save', { draft: draft({ kind: 'other', transferability: 'not_allowed', totalUses: 0, lounges: [] }) });
  await f.command('entitlement.save', { draft: draft() }, other);
  const beforeQueries = await f.store.exportSeed();
  const list = await f.query<EntitlementList>('entitlements.list');
  assert.equal(list.today, '2026-09-24');
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.cards.map(item => item.id).sort(), ['active', 'archived']);
  assert.deepEqual(list.items.map(item => item.transferability).sort(), ['allowed', 'grey', 'not_allowed']);
  const detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.equal(detail.entitlement.usedUses, 2);
  assert.equal(detail.entitlement.totalUses - detail.entitlement.usedUses, 4);
  assert.deepEqual(detail.usages, []);
  assert.deepEqual(await f.store.exportSeed(), beforeQueries);
  f.setDate('2027-01-01');
  const expired = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.equal(expired.entitlement.usedUses, 2);
  assert.equal(expired.entitlement.startsOn, '2026-01-01');
  assert.equal(expired.entitlement.endsOn, '2026-12-31');
  assert.deepEqual(await f.store.exportSeed(), beforeQueries);
});

test('ownership applies to reads, edits, use, undo, archive and linked cards even for moderators', async () => {
  const f = fixture(new MemoryStore({ cards: { owned: card('owned'), foreign: card('foreign', other.userId) } }));
  const created = await f.command('entitlement.save', { draft: draft({ cardId: 'owned' }) });
  const usage = await f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 1 });
  const unchanged = await f.store.exportSeed();
  for (const actor of [other, moderator]) {
    await assert.rejects(f.query('entitlement.get', { id: created.id }, actor), code('NOT_FOUND'));
    assert.deepEqual((await f.query<EntitlementList>('entitlements.list', {}, actor)).items, []);
    await assert.rejects(f.command('entitlement.save', { id: created.id, draft: draft(), expectedVersion: 2 }, actor), code('NOT_FOUND'));
    await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 2 }, actor), code('NOT_FOUND'));
    await assert.rejects(f.command('entitlement.undo', { id: usage.id, expectedVersion: 2 }, actor), code('NOT_FOUND'));
    await assert.rejects(f.command('entitlement.archive', { id: created.id, archived: true, expectedVersion: 2 }, actor), code('NOT_FOUND'));
  }
  await assert.rejects(f.command('entitlement.save', { draft: draft({ cardId: 'foreign' }) }), code('NOT_FOUND'));
  await assert.rejects(f.command('entitlement.save', { draft: draft({ cardId: 'missing' }) }), code('NOT_FOUND'));
  assert.deepEqual(await f.store.exportSeed(), unchanged);
});

test('existing archived card links stay editable but cannot be added or relinked', async () => {
  const f = fixture(new MemoryStore({ cards: { owned: card('owned'), archived: card('archived', user.userId, true) } }));
  const created = await f.command('entitlement.save', { draft: draft({ cardId: 'owned' }) });
  await f.command('card.remove', { id: 'owned' });
  await f.command('entitlement.save', { id: created.id, draft: draft({ cardId: 'owned', title: 'Edited fixture' }), expectedVersion: 1 });
  await assert.rejects(f.command('entitlement.save', { draft: draft({ cardId: 'owned' }) }), code('CARD_ARCHIVED', 'cardId'));
  await assert.rejects(f.command('entitlement.save', { id: created.id, draft: draft({ cardId: 'archived' }), expectedVersion: 2 }), code('CARD_ARCHIVED', 'cardId'));
  await f.command('entitlement.save', { id: created.id, draft: draft({ cardId: '' }), expectedVersion: 2 });
  await assert.rejects(f.command('entitlement.save', { id: created.id, draft: draft({ cardId: 'owned' }), expectedVersion: 3 }), code('CARD_ARCHIVED', 'cardId'));
});

test('successful requests replay before version checks and never duplicate usages or opening records', async () => {
  const f = fixture();
  const savePayload: Commands['entitlement.save'] = { draft: draft({ totalUses: 2 }) };
  const created = await f.command('entitlement.save', savePayload, user, 'save-once');
  assert.deepEqual(await f.command('entitlement.save', savePayload, user, 'save-once'), created);
  const payload: Commands['entitlement.use'] = { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 1 };
  const results = await Promise.all(Array.from({ length: 8 }, () => f.command('entitlement.use', payload, user, 'use-once')));
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  assert.ok(results.every(result => result.version === 2));
  assert.equal((await f.store.find('entitlement_usages')).length, 1);
  assert.equal((await f.store.find('entitlements')).length, 1);
  assert.deepEqual(await f.query('request.replay', { action: 'entitlement.use', payload, requestId: 'use-once' }), results[0]);
  await assert.rejects(f.command('entitlement.use', { ...payload, quantity: 2 }, user, 'use-once'), code('REQUEST_CONFLICT'));
  const undoPayload: Commands['entitlement.undo'] = { id: results[0].id, expectedVersion: 2 };
  const undone = await f.command('entitlement.undo', undoPayload, user, 'undo-once');
  assert.equal(undone.id, created.id);
  assert.deepEqual(await f.command('entitlement.undo', undoPayload, user, 'undo-once'), undone);
  assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 0);
});

test('concurrent spends and mandatory versions prevent overspending and stale edits', async () => {
  const f = fixture();
  const created = await f.command('entitlement.save', { draft: draft({ totalUses: 3 }) });
  const concurrent = await Promise.allSettled(Array.from({ length: 5 }, () => f.command('entitlement.use', {
    id: created.id, quantity: 2, usedOn: '2026-09-24', expectedVersion: 1,
  })));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(concurrent.filter(result => result.status === 'rejected').every(result => code('VERSION_CONFLICT')(result.reason)));
  assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 2);
  assert.equal((await f.store.find('entitlement_usages')).length, 1);
  await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 2, usedOn: '2026-09-24', expectedVersion: 2 }), code('INSUFFICIENT_USES', 'quantity'));
  await assert.rejects(f.command('entitlement.save', { id: created.id, draft: draft(), expectedVersion: 1 }), code('VERSION_CONFLICT'));
  await assert.rejects(f.command('entitlement.save', { id: created.id, draft: draft() }), code('VERSION_CONFLICT'));
  const usage = (await f.store.find<EntitlementUsage>('entitlement_usages'))[0];
  for (const request of [
    { action: 'entitlement.use', payload: { id: created.id, quantity: 1, usedOn: '2026-09-24' } },
    { action: 'entitlement.undo', payload: { id: usage.id } },
    { action: 'entitlement.archive', payload: { id: created.id, archived: true } },
  ]) {
    await assert.rejects(f.service.execute(user, { ...request, requestId: `missing-version-${request.action}` } as ApiRequest), code('VERSION_CONFLICT', 'expectedVersion'));
  }
  await f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 2 });
  assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 3);
  await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 3 }), code('INSUFFICIENT_USES'));
});

test('usage dates must be actual past dates inside the explicit validity period', async () => {
  const f = fixture();
  const created = await f.command('entitlement.save', { draft: draft({ startsOn: '2026-09-01', endsOn: '2026-09-24' }) });
  for (const usedOn of ['2026-08-31', '2026-09-25', '2026-02-30', 'invalid']) {
    await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn, expectedVersion: 1 }), code('INVALID_DATE', 'usedOn'));
  }
  for (const quantity of [0, -1, 0.5, 10000, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(f.command('entitlement.use', { id: created.id, quantity, usedOn: '2026-09-24', expectedVersion: 1 }), code('INVALID_INPUT', 'quantity'));
  }
  f.setDate('2026-09-30');
  const first = await f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-01', expectedVersion: 1 });
  await f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: first.version! });
  const future = await f.command('entitlement.save', { draft: draft({ startsOn: '2026-10-01' }) });
  await assert.rejects(f.command('entitlement.use', { id: future.id, quantity: 1, usedOn: '2026-10-01', expectedVersion: 1 }), code('INVALID_DATE', 'usedOn'));
});

test('quota edits recalculate opening balance plus unreversed usage while protecting every recorded date', async () => {
  const f = fixture();
  const original = draft({ totalUses: 7, initialUsed: 2 });
  const created = await f.command('entitlement.save', { draft: original });
  const usage = await f.command('entitlement.use', { id: created.id, quantity: 3, usedOn: '2026-09-01', expectedVersion: 1 });
  await assert.rejects(f.command('entitlement.save', { id: created.id, expectedVersion: 2, draft: { ...original, totalUses: 4 } }), code('INSUFFICIENT_USES', 'totalUses'));
  await assert.rejects(f.command('entitlement.save', { id: created.id, expectedVersion: 2, draft: { ...original, initialUsed: 5 } }), code('INSUFFICIENT_USES', 'totalUses'));
  await assert.rejects(f.command('entitlement.save', { id: created.id, expectedVersion: 2, draft: { ...original, startsOn: '2026-09-02' } }), code('INVALID_DATE', 'startsOn'));
  await assert.rejects(f.command('entitlement.save', { id: created.id, expectedVersion: 2, draft: { ...original, endsOn: '2026-08-31' } }), code('INVALID_DATE', 'endsOn'));
  const edited = await f.command('entitlement.save', {
    id: created.id, expectedVersion: 2, draft: { ...original, initialUsed: 3, startsOn: '2025-12-01', endsOn: '2027-12-31' },
  });
  assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 6);
  await f.command('entitlement.undo', { id: usage.id, expectedVersion: edited.version! });
  assert.equal((await f.store.get<Entitlement>('entitlements', created.id))?.usedUses, 3);
  await assert.rejects(f.command('entitlement.save', { id: created.id, expectedVersion: 4, draft: { ...original, startsOn: '2027-01-01', endsOn: '2027-12-31' } }), code('INVALID_DATE', 'startsOn'));
  await f.command('entitlement.save', { id: created.id, expectedVersion: 4, draft: { ...original, initialUsed: 1, totalUses: 1 } });
  const detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.equal(detail.entitlement.usedUses, 1);
  assert.equal(detail.usages.length, 1);
  assert.ok(detail.usages[0].reversedAt);
});

test('archive preserves history, blocks spending and permits one exact usage reversal', async () => {
  const f = fixture();
  const created = await f.command('entitlement.save', { draft: draft({ initialUsed: 1 }) });
  const usage = await f.command('entitlement.use', { id: created.id, quantity: 2, usedOn: '2026-09-24', expectedVersion: 1 });
  const archived = await f.command('entitlement.archive', { id: created.id, archived: true, expectedVersion: 2 });
  await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: archived.version! }), code('ENTITLEMENT_ARCHIVED'));
  await assert.rejects(f.command('entitlement.archive', { id: created.id, archived: false, expectedVersion: 2 }), code('VERSION_CONFLICT'));
  const undone = await f.command('entitlement.undo', { id: usage.id, expectedVersion: archived.version! });
  await assert.rejects(f.command('entitlement.undo', { id: usage.id, expectedVersion: undone.version! }), code('USAGE_REVERSED'));
  let detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.ok(detail.entitlement.archivedAt);
  assert.equal(detail.entitlement.usedUses, 1);
  assert.equal(detail.usages.length, 1);
  assert.equal(detail.usages[0].quantity, 2);
  assert.ok(detail.usages[0].reversedAt);
  assert.equal((await f.query<EntitlementList>('entitlements.list')).items.length, 1);
  const restored = await f.command('entitlement.archive', { id: created.id, archived: false, expectedVersion: undone.version! });
  await f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: restored.version! });
  detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.equal(detail.entitlement.archivedAt, null);
  assert.equal(detail.entitlement.usedUses, 2);
  assert.equal(detail.usages.length, 2);
});

test('selected lounge costs and membership are validated and usage keeps its historical lounge name', async () => {
  const f = fixture();
  const original = draft({ lounges: [lounge({ unitsPerVisit: 2, airportCode: 'tst' })] });
  const created = await f.command('entitlement.save', { draft: original });
  assert.equal((await f.query<EntitlementDetail>('entitlement.get', { id: created.id })).entitlement.lounges[0].airportCode, 'TST');
  await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', loungeId: 'lounge-a', expectedVersion: 1 }), code('INVALID_INPUT', 'quantity'));
  await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 2, usedOn: '2026-09-24', loungeId: 'foreign-lounge', expectedVersion: 1 }), code('INVALID_INPUT', 'loungeId'));
  const usage = await f.command('entitlement.use', { id: created.id, quantity: 3, usedOn: '2026-09-24', loungeId: 'lounge-a', expectedVersion: 1 });
  await f.command('entitlement.save', { id: created.id, draft: { ...original, lounges: [lounge({ loungeName: 'Renamed fixture lounge' })] }, expectedVersion: 2 });
  const detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.equal(detail.usages[0].loungeName, 'Fixture lounge');
  assert.equal(detail.usages[0].quantity, 3);
  await f.command('entitlement.save', { id: created.id, draft: { ...original, lounges: [] }, expectedVersion: 3 });
  await f.command('entitlement.undo', { id: usage.id, expectedVersion: 4 });
  const health = await f.command('entitlement.save', { draft: draft({ kind: 'health_check', lounges: [] }) });
  await assert.rejects(f.command('entitlement.use', { id: health.id, quantity: 1, usedOn: '2026-09-24', loungeId: 'lounge-a', expectedVersion: 1 }), code('INVALID_INPUT', 'loungeId'));
  await f.command('entitlement.use', { id: health.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 1 });
});

test('manual lounge rules preserve unknown states and require explicit restricted customer notes', async () => {
  const f = fixture();
  const unknown = lounge({ zone: 'unknown', reservation: 'unknown', advanceHours: 0, customerScope: 'unknown', customerNote: '', verifiedOn: '', sourceNote: '', airportCode: '' });
  const created = await f.command('entitlement.save', { draft: draft({ lounges: [unknown] }) });
  const stored = (await f.query<EntitlementDetail>('entitlement.get', { id: created.id })).entitlement;
  assert.deepEqual(stored.lounges, [{ ...unknown, supportedBanks: [] }]);
  const invalid: [Partial<LoungeAccess>, string][] = [
    [{ airportName: '' }, 'airportName'], [{ loungeName: '' }, 'loungeName'], [{ airportCode: 'AB1' }, 'airportCode'],
    [{ advanceHours: -1 }, 'advanceHours'], [{ advanceHours: 721 }, 'advanceHours'], [{ advanceHours: 0.5 }, 'advanceHours'],
    [{ unitsPerVisit: 0 }, 'unitsPerVisit'], [{ unitsPerVisit: 1.5 }, 'unitsPerVisit'],
    [{ customerScope: 'local_bank', customerNote: '' }, 'customerNote'], [{ customerScope: 'specified', customerNote: ' ' }, 'customerNote'],
    [{ verifiedOn: '2026-09-25' }, 'verifiedOn'], [{ verifiedOn: '2026-02-30' }, 'verifiedOn'],
  ];
  for (const [overrides, field] of invalid) {
    await assert.rejects(f.command('entitlement.save', { draft: draft({ lounges: [lounge(overrides)] }) }),
      (error: unknown) => error instanceof DomainError && error.field === `lounges.0.${field}`);
  }
  await assert.rejects(f.command('entitlement.save', { draft: draft({ lounges: [lounge(), lounge()] }) }), code('INVALID_INPUT', 'lounges.1.id'));
  await assert.rejects(f.command('entitlement.save', { draft: draft({ lounges: Array.from({ length: 31 }, (_, index) => lounge({ id: `lounge-${index}` })) }) }), code('INVALID_INPUT', 'lounges'));
  await assert.rejects(f.command('entitlement.save', { draft: draft({ kind: 'health_check' }) }), code('INVALID_INPUT', 'lounges'));
  assert.equal((await f.store.find('entitlements')).length, 1);
});

test('supported bank names are trimmed, deduplicated and saved without changing the caller request', async () => {
  const f = fixture();
  const payload = { draft: draft({ lounges: [lounge({ supportedBanks: [' Fixture Bank ', 'Second Bank', 'Fixture Bank'] })] }) };
  const original = structuredClone(payload);
  const created = await f.command('entitlement.save', payload, user, 'supported-banks-save');
  const detail = await f.query<EntitlementDetail>('entitlement.get', { id: created.id });
  assert.deepEqual(detail.entitlement.lounges[0].supportedBanks, ['Fixture Bank', 'Second Bank']);
  assert.deepEqual(payload, original);
  assert.deepEqual(await f.command('entitlement.save', payload, user, 'supported-banks-save'), created);
  await f.command('entitlement.save', { id: created.id, expectedVersion: 1, draft: draft({ lounges: [lounge({ supportedBanks: [] })] }) });
  assert.deepEqual((await f.query<EntitlementDetail>('entitlement.get', { id: created.id })).entitlement.lounges[0].supportedBanks, []);
});

test('legacy lounges without bank names remain readable and old save fingerprints replay unchanged', async () => {
  const legacy: Entitlement = {
    ...draft(), id: 'legacy-entitlement', ownerId: user.userId, usedUses: 0, version: 1,
    createdAt: '2026-09-01T04:00:00.000Z', updatedAt: '2026-09-01T04:00:00.000Z', archivedAt: null,
  };
  const f = fixture(new MemoryStore({ entitlements: { [legacy.id]: legacy } }));
  const before = await f.store.exportSeed();
  assert.equal((await f.query<EntitlementDetail>('entitlement.get', { id: legacy.id })).entitlement.lounges[0].supportedBanks, undefined);
  assert.deepEqual(await f.store.exportSeed(), before);
  const payload = { id: legacy.id, expectedVersion: 1, draft: draft() };
  const original = structuredClone(payload);
  const saved = await f.command('entitlement.save', payload, user, 'legacy-bankless-save');
  assert.deepEqual((await f.query<EntitlementDetail>('entitlement.get', { id: legacy.id })).entitlement.lounges[0].supportedBanks, []);
  assert.deepEqual(payload, original);
  assert.deepEqual(await f.command('entitlement.save', payload, user, 'legacy-bankless-save'), saved);
  const normalizedPayload = { ...payload, draft: { ...payload.draft, lounges: payload.draft.lounges.map(item => ({ ...item, supportedBanks: [] })) } };
  await assert.rejects(f.command('entitlement.save', normalizedPayload, user, 'legacy-bankless-save'), code('REQUEST_CONFLICT'));
});

test('invalid supported bank lists reject the whole save with the exact lounge field', async () => {
  const f = fixture();
  const invalid: unknown[] = [null, 'Fixture Bank', 1, {}, [1], [''], ['   '], [null], ['a'.repeat(121)], Array.from({ length: 31 }, () => 'Fixture Bank')];
  for (const value of invalid) {
    await assert.rejects(f.command('entitlement.save', { draft: draft({ lounges: [lounge({ supportedBanks: value as string[] })] }) }),
      code('INVALID_INPUT', 'lounges.0.supportedBanks'));
  }
  assert.equal(Object.keys(await f.store.exportSeed()).length, 0);
  const created = await f.command('entitlement.save', { draft: draft({ lounges: [lounge({ supportedBanks: Array.from({ length: 30 }, (_, index) => `Fixture bank ${index}`) })] }) });
  assert.equal((await f.query<EntitlementDetail>('entitlement.get', { id: created.id })).entitlement.lounges[0].supportedBanks?.length, 30);
});

test('draft quota and date validation rejects invalid input atomically', async () => {
  const f = fixture();
  const invalid: [Partial<EntitlementDraft>, string][] = [
    [{ totalUses: -1 }, 'totalUses'], [{ totalUses: 10000 }, 'totalUses'], [{ totalUses: 1.5 }, 'totalUses'],
    [{ initialUsed: -1 }, 'initialUsed'], [{ initialUsed: 10000 }, 'initialUsed'], [{ initialUsed: 1.5 }, 'initialUsed'],
    [{ initialUsed: 7 }, 'initialUsed'], [{ title: '' }, 'title'],
    [{ startsOn: '2026-02-30' }, 'startsOn'], [{ endsOn: '2025-12-31' }, 'endsOn'],
  ];
  for (const [overrides, field] of invalid) {
    await assert.rejects(f.command('entitlement.save', { draft: draft(overrides) }),
      (error: unknown) => error instanceof DomainError && error.field === field);
  }
  await assert.rejects(f.command('entitlement.save', { draft: draft({ transferability: 'unverified' as EntitlementDraft['transferability'] }) }), code('INVALID_INPUT', 'transferability'));
  assert.equal(Object.keys(await f.store.exportSeed()).length, 0);
  const created = await f.command('entitlement.save', { draft: draft({ totalUses: 9999, initialUsed: 9999 }) });
  await assert.rejects(f.command('entitlement.use', { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: 1 }), code('INSUFFICIENT_USES'));
});

class InterruptedRequestStore extends MemoryStore {
  interruptNextRequest = false;

  override transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
    return super.transaction(transaction => callback({
      get: transaction.get.bind(transaction), find: transaction.find.bind(transaction),
      remove: transaction.remove.bind(transaction), transaction: transaction.transaction.bind(transaction),
      set: async <Row>(collection: Parameters<Store['set']>[0], id: string, value: Row) => {
        if (collection === 'requests' && this.interruptNextRequest) {
          this.interruptNextRequest = false;
          throw new Error('INTERRUPTED_REQUEST_LEDGER');
        }
        await transaction.set(collection, id, value);
      },
    }));
  }
}

test('interruption at the request ledger rolls back balance, usage and audit together and allows an exact retry', async () => {
  const store = new InterruptedRequestStore();
  const f = fixture(store);
  const created = await f.command('entitlement.save', { draft: draft() });
  const before = await store.exportSeed();
  const payload: Commands['entitlement.use'] = { id: created.id, quantity: 2, usedOn: '2026-09-24', expectedVersion: 1 };
  store.interruptNextRequest = true;
  await assert.rejects(f.command('entitlement.use', payload, user, 'interrupted-use'), /INTERRUPTED_REQUEST_LEDGER/);
  assert.deepEqual(await store.exportSeed(), before);
  const usage = await f.command('entitlement.use', payload, user, 'interrupted-use');
  assert.equal(usage.version, 2);
  assert.equal((await store.get<Entitlement>('entitlements', created.id))?.usedUses, 2);
  const spent = await store.exportSeed();
  store.interruptNextRequest = true;
  await assert.rejects(f.command('entitlement.undo', { id: usage.id, expectedVersion: 2 }, user, 'interrupted-undo'), /INTERRUPTED_REQUEST_LEDGER/);
  assert.deepEqual(await store.exportSeed(), spent);
  await f.command('entitlement.undo', { id: usage.id, expectedVersion: 2 }, user, 'interrupted-undo');
  assert.equal((await store.get<Entitlement>('entitlements', created.id))?.usedUses, 0);
  assert.equal((await store.find('entitlement_usages')).length, 1);
});

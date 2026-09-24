import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Entitlement, EntitlementDetail, EntitlementList, LoungeAccess } from '../shared/contracts';
import { api } from '../miniprogram/services/api';
import { currentEntitlement, filterEntitlements, searchLounges, validateUsage } from '../miniprogram/services/entitlement-view';

const today = '2026-09-24';
const ownerId = 'entitlement-view-user';
const card: Card = { id: 'card-a', ownerId, bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: 'Travel card', createdAt: today };
function lounge(id = 'lounge-a', patch: Partial<LoungeAccess> = {}): LoungeAccess {
  return { id, airportName: 'Example Airport', airportCode: 'EXA', city: 'Example City', loungeName: `Example ${id}`, terminal: 'T2', zone: 'domestic',
    reservation: 'required', advanceHours: 4, reservationNote: 'Call the provider', customerScope: 'local_bank', customerNote: 'Only local Example Bank customers',
    guestNote: 'Guests require a separate unit', openingHours: '08:00–20:00', location: 'Gate 1', unitsPerVisit: 1, sourceNote: 'Personal notes', verifiedOn: today, ...patch };
}
function entitlement(patch: Partial<Entitlement> = {}): Entitlement {
  return { id: 'benefit-a', ownerId, title: 'Airport visits', kind: 'lounge', cardId: card.id, provider: 'Example Provider', totalUses: 6,
    initialUsed: 1, usedUses: 2, startsOn: '2026-01-01', endsOn: '2026-12-31', transferability: 'grey', transferNote: 'Unconfirmed transfer', notes: '',
    lounges: [lounge(), lounge('lounge-b', { unitsPerVisit: 2 })], version: 3, createdAt: today, updatedAt: today, archivedAt: null, ...patch };
}

test('airport matching preserves independently registered banks and per-lounge requirements', () => {
  const item = entitlement({ lounges: [lounge('lounge-a', { supportedBanks: ['Example Bank A', 'Example Bank B'] }), lounge('lounge-b', { supportedBanks: ['Example Bank C'] })] });
  const rows = searchLounges([item], 'eXa');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.supportedBanks), [['Example Bank A', 'Example Bank B'], ['Example Bank C']]);
  assert.equal(rows[0].reservation, '需提前 4 小时预约');
  assert.equal(rows[0].customerScope, '仅限当地银行客户');
  assert.match(rows[0].customerNote, /Example Bank/);
  assert.equal(searchLounges([item], 'example city', '', 't2', 'international').length, 0);
  assert.equal(searchLounges([item], 'example city', '', 't2', 'domestic').length, 2);
});

test('supported bank names never derive from linked card, provider or customer notes', () => {
  const item = entitlement({ provider: 'Provider Bank', lounges: [lounge('legacy'), lounge('empty', { supportedBanks: [] }), lounge('registered', { supportedBanks: ['Registered Bank'] })] });
  const rows = searchLounges([item], '');
  assert.equal(item.cardId, card.id);
  assert.match(item.lounges[0].customerNote, /Example Bank/);
  assert.deepEqual(rows.find(row => row.loungeId === 'legacy')?.supportedBanks, []);
  assert.deepEqual(rows.find(row => row.loungeId === 'empty')?.supportedBanks, []);
  assert.deepEqual(rows.find(row => row.loungeId === 'registered')?.supportedBanks, ['Registered Bank']);
});

test('airport bank lookup includes expired and exhausted records, excludes archived records and sorts by location', () => {
  const expired = entitlement({ id: 'expired', endsOn: '2026-09-23', lounges: [lounge('a', { airportName: 'A Airport', supportedBanks: ['Expired Record Bank'] })] });
  const exhausted = entitlement({ id: 'exhausted', usedUses: 6, lounges: [lounge('b', { airportName: 'B Airport', supportedBanks: ['Exhausted Record Bank'] })] });
  const active = entitlement({ id: 'active', lounges: [lounge('c', { airportName: 'C Airport', supportedBanks: ['Active Record Bank'] })] });
  const archived = entitlement({ id: 'archived', archivedAt: today, lounges: [lounge('archived', { supportedBanks: ['Archived Record Bank'] })] });
  const rows = searchLounges([active, archived, exhausted, expired], '');
  assert.deepEqual(rows.map(row => row.entitlementId), ['expired', 'exhausted', 'active']);
  assert.deepEqual(rows.map(row => row.supportedBanks), [['Expired Record Bank'], ['Exhausted Record Bank'], ['Active Record Bank']]);
  assert.equal(searchLounges([expired, exhausted], 'unknown').length, 0);
  assert.deepEqual(searchLounges([expired, exhausted], '', 'exhausted').map(row => row.entitlementId), ['exhausted']);
});

test('current filters use server day, period boundaries, balance and archive state', () => {
  const items = [entitlement(), entitlement({ id: 'future', startsOn: '2026-09-25' }), entitlement({ id: 'empty', usedUses: 6 }), entitlement({ id: 'archived', archivedAt: today })];
  assert.equal(currentEntitlement(entitlement({ startsOn: today, endsOn: today }), today), true);
  assert.deepEqual(filterEntitlements(items, today, 'valid', 'all', '').map(item => item.id), ['benefit-a']);
  assert.equal(filterEntitlements(items, today, 'all', 'all', '').length, 3);
  assert.equal(filterEntitlements(items, today, 'archived', 'all', '').length, 1);
  assert.equal(filterEntitlements(items, today, 'all', 'health_check', '').length, 0);
  assert.equal(filterEntitlements(items, today, 'all', 'all', 'missing').length, 0);
});

test('usage validation rejects fractional, overdrawn, future and out-of-period dates', () => {
  assert.ok(validateUsage(entitlement(), today, '1.5', today).quantityError);
  assert.ok(validateUsage(entitlement(), today, '5', today).quantityError);
  assert.ok(validateUsage(entitlement(), today, '1', '2026-09-25').dateError);
  assert.ok(validateUsage(entitlement(), today, '1', '2025-12-31').dateError);
  assert.ok(validateUsage(entitlement(), today, '1', '2026-02-31').dateError);
  assert.deepEqual(validateUsage(entitlement(), today, '2', today), { quantity: 2, quantityError: '', dateError: '' });
});

type PageInstance = { data: Record<string, any>; [key: string]: any };
let definition: PageInstance;
let loungeDefinition: PageInstance;
let raw: EntitlementList;
let detail: EntitlementDetail;
let commands: { action: string; payload: any }[];
let navigation: string[];
let modalCalls: number;
let modalHandler: () => Promise<{ confirm: boolean }>;
let commandHandler: (action: string, payload: any) => Promise<any>;
let queryHandler: (action: string, payload: any) => Promise<any>;
const originalWx = (globalThis as any).wx;
const originalQuery = api.query;
const originalCommand = api.command;

before(async () => {
  const runtime = globalThis as any, originalPage = runtime.Page;
  try {
    runtime.Page = (value: PageInstance) => { definition = value; };
    await import('../miniprogram/pages/entitlements/index');
    runtime.Page = (value: PageInstance) => { loungeDefinition = value; };
    await import('../miniprogram/pages/lounges/index');
  } finally { runtime.Page = originalPage; }
});
beforeEach(() => {
  raw = { today, items: [entitlement()], cards: [card] };
  detail = { today, entitlement: raw.items[0], cards: [card], usages: [] };
  commands = []; navigation = []; modalCalls = 0;
  modalHandler = async () => ({ confirm: true });
  commandHandler = async () => ({ id: 'usage-a', version: 4 });
  queryHandler = async action => {
    if (action === 'session.get') return { userId: ownerId, demo: true, isModerator: false, today, month: '2026-09' };
    if (action === 'entitlements.list') return structuredClone(raw);
    if (action === 'entitlement.get') return structuredClone(detail);
    throw new Error(`Unexpected query ${action}`);
  };
  api.query = (async (action: string, payload: any) => queryHandler(action, payload)) as typeof api.query;
  api.command = (async (action: string, payload: any) => { commands.push({ action, payload: structuredClone(payload) }); return commandHandler(action, payload); }) as typeof api.command;
  (globalThis as any).wx = { enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, stopPullDownRefresh() {},
    navigateTo: ({ url }: { url: string }) => { navigation.push(url); },
    showModal: async () => { modalCalls += 1; return modalHandler(); } };
});
after(() => { api.query = originalQuery; api.command = originalCommand; (globalThis as any).wx = originalWx; });

function page(source = definition): PageInstance {
  const instance: PageInstance = { ...source, data: structuredClone(source.data) };
  instance.setData = (patch: Record<string, unknown>) => { Object.assign(instance.data, patch); };
  return instance;
}
function event(id: string) { return { currentTarget: { dataset: { id } } }; }
function value(value: string) { return { detail: { value } }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function ready(sheet: 'use' | 'history' = 'use') {
  const instance = page();
  await instance.load();
  await instance.openSelection('benefit-a', sheet);
  return instance;
}

test('busy use freezes fields and sends one immutable versioned command', async () => {
  const instance = await ready();
  const pending = deferred<{ id: string }>();
  commandHandler = () => pending.promise;
  instance.changeQuantity(value('2'));
  instance.changeDate(value('2026-09-23'));
  const saving = instance.submitUsage();
  instance.changeQuantity(value('4'));
  instance.changeDate(value('2026-09-22'));
  instance.changeLounge(value('2'));
  instance.changeNote(value('Changed while busy'));
  await instance.submitUsage();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], { action: 'entitlement.use', payload: { id: 'benefit-a', quantity: 2, usedOn: '2026-09-23', note: '', loungeId: '', expectedVersion: 3 } });
  assert.equal(instance.data.quantityInput, '2');
  pending.resolve({ id: 'usage-a' });
  await saving;
  assert.equal(instance.data.sheet, '');
  assert.match(instance.data.status, /已记录/);
});

test('network uncertainty retains an identical retry and prevents editing or dismissing', async () => {
  const instance = await ready();
  commandHandler = async () => { throw Object.assign(new Error('Disconnected'), { code: 'NETWORK_ERROR' }); };
  instance.changeNote(value('Original note'));
  await instance.submitUsage();
  assert.equal(instance.data.pendingUse, true);
  instance.changeQuantity(value('3'));
  instance.changeNote(value('Changed note'));
  await instance.closeSheet();
  assert.equal(instance.data.sheet, 'use');
  commandHandler = async () => ({ id: 'usage-a' });
  await instance.submitUsage();
  assert.deepEqual(commands[1], commands[0]);
  assert.equal(instance.data.sheet, '');
});

test('version conflict reads fresh quota while preserving the draft and never automatically writes again', async () => {
  const instance = await ready();
  instance.changeQuantity(value('3')); instance.changeDate(value('2026-09-23')); instance.changeNote(value('Keep this note'));
  commandHandler = async () => {
    detail.entitlement = entitlement({ version: 4, usedUses: 4 });
    throw Object.assign(new Error('Changed'), { code: 'VERSION_CONFLICT' });
  };
  await instance.submitUsage();
  assert.equal(commands.length, 1);
  assert.equal(instance.data.selected.version, 4);
  assert.equal(instance.data.quantityInput, '3');
  assert.equal(instance.data.usedOn, '2026-09-23');
  assert.equal(instance.data.note, 'Keep this note');
  assert.equal(instance.data.remainingAfter, -1);
  assert.match(instance.data.formError, /权益已更新/);
  await instance.submitUsage();
  assert.equal(commands.length, 1);
  assert.match(instance.data.quantityError, /最多可记录 2 次/);
});

test('failed refresh disables mutations until list and selected record are fresh', async () => {
  const instance = await ready();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => { if (action === 'entitlements.list') throw new Error('Unavailable'); return fallback(action, payload); };
  await instance.load();
  assert.equal(instance.data.outdated, true);
  await instance.submitUsage(); await instance.toggleArchive(event('benefit-a'));
  assert.equal(commands.length, 0);
  queryHandler = fallback;
  await instance.load(); await instance.refreshSelected();
  await instance.submitUsage();
  assert.equal(commands.length, 1);
});

test('dirty sheet dismiss uses one confirmation and retains inputs when cancelled', async () => {
  const instance = await ready();
  instance.changeNote(value('Unsaved note'));
  const pending = deferred<{ confirm: boolean }>();
  modalHandler = () => pending.promise;
  const closing = instance.closeSheet();
  await instance.closeSheet();
  assert.equal(modalCalls, 1);
  pending.resolve({ confirm: false });
  await closing;
  assert.equal(instance.data.sheet, 'use');
  assert.equal(instance.data.note, 'Unsaved note');
});

test('undo confirms once, uses the entitlement version and preserves a reversed history row', async () => {
  detail.usages = [{ id: 'usage-a', ownerId, entitlementId: 'benefit-a', quantity: 1, usedOn: today, note: '', loungeId: '', loungeName: '', reversedAt: null, createdAt: today }];
  const instance = await ready('history');
  const pending = deferred<{ confirm: boolean }>(); modalHandler = () => pending.promise;
  commandHandler = async () => { detail.usages[0].reversedAt = today; detail.entitlement.version += 1; return { id: 'usage-a' }; };
  const undoing = instance.undoUsage(event('usage-a'));
  await instance.undoUsage(event('usage-a'));
  assert.equal(modalCalls, 1);
  pending.resolve({ confirm: true }); await undoing;
  assert.deepEqual(commands[0], { action: 'entitlement.undo', payload: { id: 'usage-a', expectedVersion: 3 } });
  assert.equal(instance.data.usages[0].reversed, true);
  await instance.undoUsage(event('usage-a'));
  assert.equal(commands.length, 1);
});

test('foreign usage rows fail closed', async () => {
  detail.usages = [{ id: 'foreign', ownerId: 'another-owner', entitlementId: 'benefit-a', quantity: 1, usedOn: today, note: '', loungeId: '', loungeName: '', reversedAt: null, createdAt: today }];
  const instance = await ready('history');
  assert.equal(instance.data.selectedFresh, false);
  assert.equal(instance.data.usages.length, 0);
  assert.equal(commands.length, 0);
});

test('airport lookup preserves filters and prior bank data when refresh fails', async () => {
  raw.items = [
    entitlement({ id: 'first', lounges: [lounge('a', { supportedBanks: ['First Bank'] })] }),
    entitlement({ id: 'second', lounges: [lounge('b', { terminal: 'T3', supportedBanks: ['Second Bank'] })] }),
  ];
  const airport = page(loungeDefinition);
  airport.onLoad({ entitlementId: 'first' });
  await airport.load();
  assert.deepEqual(airport.data.matches.map((row: { supportedBanks: string[] }) => row.supportedBanks), [['First Bank']]);
  airport.clearScope();
  airport.changeSearch(value('exa'));
  airport.changeTerminal(value('t3'));
  airport.changeZone({ currentTarget: { dataset: { value: 'domestic' } } });
  assert.deepEqual(airport.data.matches.map((row: { supportedBanks: string[] }) => row.supportedBanks), [['Second Bank']]);
  const fallback = queryHandler;
  queryHandler = async (action, payload) => { if (action === 'entitlements.list') throw new Error('Unavailable'); return fallback(action, payload); };
  await airport.load();
  assert.equal(airport.data.outdated, true);
  assert.equal(airport.data.terminal, 't3');
  assert.deepEqual(airport.data.matches[0].supportedBanks, ['Second Bank']);
  assert.match(airport.data.error, /核实支持银行与准入条件/);
  assert.equal(commands.length, 0);
});

test('first detail read failure can retry with a valid initial usage date', async () => {
  const instance = page(); await instance.load();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => { if (action === 'entitlement.get') throw new Error('Temporarily unavailable'); return fallback(action, payload); };
  await instance.openSelection('benefit-a', 'use');
  assert.equal(instance.data.selectedFresh, false);
  queryHandler = fallback;
  await instance.refreshSelected();
  assert.equal(instance.data.usedOn, today);
  assert.equal(instance.data.quantityInput, '1');
  assert.equal(instance.data.selectedFresh, true);
});

test('archive and restore retain original history and require the latest entitlement version', async () => {
  const instance = page(); await instance.load();
  commandHandler = async (_action, payload) => {
    raw.items[0].archivedAt = payload.archived ? today : null;
    raw.items[0].version += 1;
    return { id: 'benefit-a' };
  };
  await instance.toggleArchive(event('benefit-a'));
  assert.deepEqual(commands[0], { action: 'entitlement.archive', payload: { id: 'benefit-a', archived: true, expectedVersion: 3 } });
  assert.equal(instance.data.archivedCount, 1);
  assert.equal(instance.data.rows.length, 0);
  instance.changeScope({ currentTarget: { dataset: { value: 'archived' } } });
  assert.equal(instance.data.rows.length, 1);
  await instance.toggleArchive(event('benefit-a'));
  assert.deepEqual(commands[1], { action: 'entitlement.archive', payload: { id: 'benefit-a', archived: false, expectedVersion: 4 } });
  assert.equal(instance.data.raw.items[0].usedUses, 2);
  assert.match(instance.data.status, /使用记录已保留/);
});

test('archived records cannot open editing until restored', async () => {
  raw.items[0].archivedAt = today;
  const instance = page(); await instance.load();
  instance.editEntitlement(event('benefit-a'));
  assert.equal(navigation.length, 0);
  commandHandler = async () => { raw.items[0].archivedAt = null; raw.items[0].version += 1; return { id: 'benefit-a' }; };
  await instance.toggleArchive(event('benefit-a'));
  instance.editEntitlement(event('benefit-a'));
  assert.deepEqual(navigation, ['/pages/entitlement-edit/index?id=benefit-a']);
});

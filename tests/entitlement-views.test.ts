import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Entitlement, EntitlementDetail, EntitlementKind, EntitlementList, LoungeAccess } from '../shared/contracts';
import { api, ensureSession } from '../miniprogram/services/api';
import { countedEntitlement, currentEntitlement, entitlementRow, entitlementStatus, filterEntitlements, pointsText, searchLounges, sumPointsBalance, validateUsage } from '../miniprogram/services/entitlement-view';

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

const categories: { kind: EntitlementKind; label: string; counted: boolean }[] = [
  { kind: 'lounge', label: '机场贵宾厅', counted: true },
  { kind: 'delay_insurance', label: '延误险', counted: false },
  { kind: 'airport_transfer', label: '接送机', counted: true },
  { kind: 'health_check', label: '体检', counted: true },
  { kind: 'car_wash', label: '洗车', counted: true },
  { kind: 'points', label: '积分', counted: false },
  { kind: 'other', label: '其他权益', counted: true },
];
function categoryEntitlement(kind: EntitlementKind, patch: Partial<Entitlement> = {}): Entitlement {
  const counted = kind !== 'delay_insurance' && kind !== 'points';
  return entitlement({ id: `benefit-${kind}`, title: `Benefit ${kind}`, kind, lounges: [],
    totalUses: counted ? 6 : 0, initialUsed: counted ? 1 : 0, usedUses: counted ? 2 : 0, ...patch });
}

test('all six benefit categories and legacy other records retain their exact labels and kind filters', () => {
  const items = categories.map(category => categoryEntitlement(category.kind));
  for (const category of categories) {
    const row = entitlementRow(items.find(item => item.kind === category.kind)!, [card], today);
    assert.equal(row.kindLabel, category.label);
    assert.equal(row.counted, category.counted);
    assert.deepEqual(filterEntitlements(items, today, 'valid', category.kind, '').map(item => item.id), [`benefit-${category.kind}`]);
  }
  assert.equal(filterEntitlements(items, today, 'valid', 'all', '').length, categories.length);
});

test('counted categories preserve real remaining uses and become unavailable when their quota is exhausted', () => {
  for (const category of categories.filter(item => item.counted)) {
    const item = categoryEntitlement(category.kind);
    const row = entitlementRow(item, [card], today);
    assert.equal(countedEntitlement(item), true);
    assert.equal(row.remaining, 4);
    assert.equal(row.balanceText, '4');
    assert.equal(row.balanceUnit, '次');
    assert.equal(row.usable, true);
    const exhausted = { ...item, usedUses: item.totalUses };
    assert.equal(currentEntitlement(exhausted, today), false);
    assert.equal(entitlementRow(exhausted, [card], today).usable, false);
    assert.equal(entitlementStatus(exhausted, today), '次数已用完');
  }
});

for (const kind of ['delay_insurance', 'points'] as const) {
  test(`an effective ${kind} record remains visible without offering a count-based usage action`, () => {
    const item = categoryEntitlement(kind, { startsOn: today, endsOn: today, description: 'Registered terms requiring verification' });
    const row = entitlementRow(item, [card], today);
    assert.equal(currentEntitlement(item, today), true);
    assert.equal(entitlementStatus(item, today), '当前有效');
    assert.equal(row.counted, false);
    assert.equal(row.usable, false);
    assert.equal(row.description, item.description);
    assert.deepEqual(filterEntitlements([item], today, 'valid', 'all', ''), [item]);
    assert.ok(validateUsage(item, today, '1', today).quantityError);
    for (const [patch, status] of [
      [{ startsOn: '2026-09-25', endsOn: '2026-12-31' }, '尚未生效'],
      [{ startsOn: '2026-01-01', endsOn: '2026-09-23' }, '已过期'],
      [{ archivedAt: today }, '已归档'],
    ] as const) {
      const inactive = { ...item, ...patch };
      assert.equal(currentEntitlement(inactive, today), false);
      assert.equal(entitlementStatus(inactive, today), status);
      assert.equal(filterEntitlements([inactive], today, 'valid', 'all', '').length, 0);
    }
  });
}

test('points display distinguishes an unregistered balance from explicit zero without interpreting points as money or uses', () => {
  const missing = entitlementRow(categoryEntitlement('points'), [card], today);
  assert.equal(missing.pointsBalance, null);
  assert.equal(missing.balanceText, '待填写');
  assert.equal(missing.balanceUnit, '');
  const zero = entitlementRow(categoryEntitlement('points', { pointsBalance: 0 }), [card], today);
  assert.equal(zero.pointsBalance, 0);
  assert.equal(zero.balanceText, '0');
  assert.equal(zero.balanceUnit, '分');
  assert.equal(zero.usable, false);
  const registered = entitlementRow(categoryEntitlement('points', { pointsBalance: 128650 }), [card], today);
  assert.equal(registered.pointsBalance, 128650);
  assert.equal(registered.balanceText, '128,650');
  assert.equal(registered.balanceUnit, '分');
  assert.equal(registered.remaining, 0);
  assert.equal(registered.totalUses, 0);
});

test('delay insurance displays registered terms while lounge programs come only from the explicit program field', () => {
  const insurance = entitlementRow(categoryEntitlement('delay_insurance', { description: 'Coverage depends on registered flight conditions' }), [card], today);
  assert.equal(insurance.balanceText, '保障说明');
  assert.equal(insurance.balanceUnit, '');
  assert.equal(insurance.description, 'Coverage depends on registered flight conditions');
  const unregistered = entitlementRow(entitlement({ title: 'Priority Pass lounge', provider: 'Dragon Provider' }), [card], today);
  assert.equal(unregistered.loungeProgram, '');
  const registered = entitlementRow(entitlement({ loungeProgram: 'pp' }), [card], today);
  assert.equal(registered.loungeProgram, 'Priority Pass');
});

test('a points total stays unknown when any registered balance is missing and preserves exact integers beyond the safe sum range', () => {
  assert.equal(sumPointsBalance([{ pointsBalance: 128650 }, {}]), null);
  assert.equal(sumPointsBalance([{ pointsBalance: 0 }, { pointsBalance: 0 }]), '0');
  assert.equal(sumPointsBalance([{ pointsBalance: Number.MAX_SAFE_INTEGER }, { pointsBalance: Number.MAX_SAFE_INTEGER }, { pointsBalance: 9 }]), '18014398509481991');
  assert.equal(pointsText('18014398509481991'), '18,014,398,509,481,991');
});

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
let sessionOwnerId: string;
let storage: Map<string, unknown>;
let storageWrites: { key: string; value: any }[];
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
beforeEach(async () => {
  raw = { today, items: [entitlement()], cards: [card] };
  detail = { today, entitlement: raw.items[0], cards: [card], usages: [] };
  commands = []; navigation = []; modalCalls = 0;
  sessionOwnerId = ownerId; storage = new Map(); storageWrites = [];
  modalHandler = async () => ({ confirm: true });
  commandHandler = async () => ({ id: 'usage-a', version: 4 });
  queryHandler = async action => {
    if (action === 'session.get') return { userId: sessionOwnerId, demo: true, isModerator: false, today, month: '2026-09' };
    if (action === 'entitlements.list') return structuredClone(raw);
    if (action === 'entitlement.get') return structuredClone(detail);
    throw new Error(`Unexpected query ${action}`);
  };
  api.query = (async (action: string, payload: any) => queryHandler(action, payload)) as typeof api.query;
  api.command = (async (action: string, payload: any) => { commands.push({ action, payload: structuredClone(payload) }); return commandHandler(action, payload); }) as typeof api.command;
  (globalThis as any).wx = { enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, stopPullDownRefresh() {},
    getStorageSync: (key: string) => structuredClone(storage.get(key)),
    setStorageSync: (key: string, value: unknown) => { storageWrites.push({ key, value: structuredClone(value) }); storage.set(key, structuredClone(value)); },
    navigateTo: ({ url }: { url: string }) => { navigation.push(url); },
    showModal: async () => { modalCalls += 1; return modalHandler(); } };
  await ensureSession(true);
});
after(() => { api.query = originalQuery; api.command = originalCommand; (globalThis as any).wx = originalWx; });

function page(source = definition): PageInstance {
  const instance: PageInstance = { ...source, data: structuredClone(source.data) };
  instance.setData = (patch: Record<string, unknown>) => { Object.assign(instance.data, patch); };
  return instance;
}
function event(id: string) { return { currentTarget: { dataset: { id } } }; }
function value(value: string) { return { detail: { value } }; }
function filterEvent(value: string) { return { currentTarget: { dataset: { value } } }; }
function recentAirportKey(owner = ownerId) { return `lounges.recent.${encodeURIComponent(owner)}`; }
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

for (const kind of ['delay_insurance', 'points'] as const) {
  test(`the ${kind} page retains detail and editing access while refusing usage sheet and mutations`, async () => {
    raw.items = [categoryEntitlement(kind)];
    detail = { today, entitlement: raw.items[0], cards: [card], usages: [] };
    const instance = page();
    await instance.load();
    assert.equal(instance.data.validCount, 1);
    assert.equal(instance.data.rows[0].usable, false);
    await instance.recordUse(event(raw.items[0].id));
    assert.equal(instance.data.sheet, '');
    await instance.openHistory(event(raw.items[0].id));
    assert.equal(instance.data.selectedFresh, true);
    assert.equal(instance.data.selectedRow.counted, false);
    await instance.submitUsage();
    assert.equal(commands.length, 0);
    instance.editEntitlement(event(raw.items[0].id));
    assert.deepEqual(navigation, [`/pages/entitlement-edit/index?id=${raw.items[0].id}`]);
  });
}

test('a version conflict that changes a counted entitlement to information-only never resubmits a count mutation', async () => {
  const instance = await ready();
  instance.changeQuantity(value('2'));
  instance.changeNote(value('Retain this draft for review'));
  commandHandler = async () => {
    detail.entitlement = categoryEntitlement('points', { id: 'benefit-a', version: 4, pointsBalance: 0 });
    throw Object.assign(new Error('Changed'), { code: 'VERSION_CONFLICT' });
  };
  await instance.submitUsage();
  assert.equal(commands.length, 1);
  assert.equal(instance.data.selected.kind, 'points');
  assert.equal(instance.data.selected.version, 4);
  assert.equal(instance.data.quantityInput, '2');
  assert.equal(instance.data.note, 'Retain this draft for review');
  assert.equal(instance.data.selectedRow.usable, false);
  await instance.submitUsage();
  assert.equal(commands.length, 1);
});

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

test('recent airport queries reuse registered airport codes and deduplicate successful selections', async () => {
  const originalItems = structuredClone(raw.items);
  const airport = page(loungeDefinition);
  await airport.load();
  airport.changeSearch(value('exa'));
  assert.equal(storageWrites.length, 0);
  airport.confirmSearch();
  const firstMatches = airport.data.matches.map((row: { key: string }) => row.key);
  assert.equal(firstMatches.length, 2);
  assert.equal(airport.data.recentAirports.length, 1);
  assert.equal(airport.data.recentAirports[0].key, 'EXA');
  assert.equal(airport.data.recentAirports[0].code, 'EXA');
  assert.equal(airport.data.recentAirports[0].count, 2);
  airport.changeSearch(value('eXa'));
  airport.confirmSearch();
  airport.clearFilters();
  airport.selectAirport(filterEvent(airport.data.recentAirports[0].key));
  assert.deepEqual(airport.data.matches.map((row: { key: string }) => row.key), firstMatches);
  assert.equal(airport.data.recentAirports.length, 1);
  const envelope = storage.get(recentAirportKey()) as { version: number; ownerId: string; items: unknown[] };
  assert.equal(envelope.version, 1);
  assert.equal(envelope.ownerId, ownerId);
  assert.deepEqual(envelope.items, airport.data.recentAirports);
  const reopened = page(loungeDefinition);
  await reopened.load();
  assert.deepEqual(reopened.data.recentAirports, airport.data.recentAirports);
  reopened.selectAirport(filterEvent(reopened.data.recentAirports[0].key));
  assert.deepEqual(reopened.data.matches.map((row: { key: string }) => row.key), firstMatches);
  assert.deepEqual(raw.items, originalItems);
  assert.equal(commands.length, 0);
});

test('unmatched or ambiguous airport searches never enter recent successful queries', async () => {
  raw.items = [entitlement({ lounges: [lounge('first'), lounge('second', { airportName: 'Other Airport', airportCode: 'OTH' })] })];
  const airport = page(loungeDefinition);
  await airport.load();
  airport.changeSearch(value('unknown'));
  airport.confirmSearch();
  assert.equal(airport.data.matches.length, 0);
  airport.selectAirport(filterEvent('unknown'));
  assert.equal(storageWrites.length, 0);
  airport.changeSearch(value('Example City'));
  assert.equal(airport.data.matches.length, 2);
  airport.confirmSearch();
  assert.equal(airport.data.recentAirports.length, 0);
  assert.equal(storageWrites.length, 0);
  assert.equal(commands.length, 0);
});

test('registered lounge program summaries keep owned card names and only include currently valid remaining uses', async () => {
  const secondCard = { ...card, id: 'card-b', nickname: 'Work card' };
  raw = { today, cards: [card, secondCard], items: [
    entitlement({ id: 'pp-a', loungeProgram: 'pp' }),
    entitlement({ id: 'pp-b', loungeProgram: 'pp', cardId: secondCard.id, totalUses: 10, usedUses: 3 }),
    entitlement({ id: 'pp-expired', loungeProgram: 'pp', endsOn: '2026-09-23', totalUses: 100, usedUses: 0, initialUsed: 0 }),
    entitlement({ id: 'pp-future', loungeProgram: 'pp', startsOn: '2026-09-25', totalUses: 20, usedUses: 0, initialUsed: 0 }),
    entitlement({ id: 'pp-exhausted', loungeProgram: 'pp', usedUses: 6 }),
    entitlement({ id: 'archived-dragon', loungeProgram: 'dragon', archivedAt: today }),
    entitlement({ id: 'unregistered-program', title: 'Priority Pass Airport visits', provider: 'Dragon Provider', totalUses: 3, usedUses: 1 }),
  ] };
  const originalItems = structuredClone(raw.items);
  const airport = page(loungeDefinition);
  await airport.load();
  const registered = airport.data.programSummaries.find((item: { value: string }) => item.value === 'pp');
  assert.equal(registered.label, 'Priority Pass');
  assert.equal(registered.remaining, 11);
  assert.deepEqual(registered.cards.split('、'), ['Travel card', 'Work card']);
  const unregistered = airport.data.programSummaries.find((item: { value: string }) => item.value === 'unknown');
  assert.equal(unregistered.label, '通道待填写');
  assert.equal(unregistered.remaining, 2);
  assert.equal(airport.data.programSummaries.some((item: { value: string }) => item.value === 'dragon'), false);
  assert.deepEqual(raw.items, originalItems);
  assert.equal(commands.length, 0);
});

test('recent airport loading normalizes duplicate codes and discards malformed stored queries without writing replacements', async () => {
  const valid = { key: 'EXA', name: 'Example Airport', code: 'EXA', city: 'Example City', count: 2 };
  const envelope = { version: 1, ownerId, items: [
    valid,
    { ...valid, key: 'exa', code: 'exa', count: 1 },
    { ...valid, key: 'blank-code', code: '' },
    { ...valid, key: 'blank-name', name: '' },
    { ...valid, key: 'zero-count', code: 'OTH', count: 0 },
    { ...valid, key: 'unsafe-count', code: 'BIG', count: Number.MAX_SAFE_INTEGER + 1 },
  ] };
  storage.set(recentAirportKey(), structuredClone(envelope));
  const airport = page(loungeDefinition);
  await airport.load();
  assert.deepEqual(airport.data.recentAirports, [valid]);
  assert.deepEqual(storage.get(recentAirportKey()), envelope);
  assert.equal(storageWrites.length, 0);
  assert.equal(commands.length, 0);
});

test('a successful airport search cannot update recent queries while its records are refreshing or outdated', async () => {
  const airport = page(loungeDefinition);
  await airport.load();
  airport.selectAirport(filterEvent('EXA'));
  const saved = structuredClone(storage.get(recentAirportKey()));
  const pending = deferred<EntitlementList>();
  const started = deferred<boolean>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'entitlements.list') { started.resolve(true); return pending.promise; }
    return fallback(action, payload);
  };
  const refreshing = airport.load();
  await started.promise;
  airport.changeSearch(value('exa'));
  airport.confirmSearch();
  assert.deepEqual(storage.get(recentAirportKey()), saved);
  assert.equal(storageWrites.length, 1);
  pending.resolve(structuredClone(raw));
  await refreshing;
  queryHandler = async (action, payload) => {
    if (action === 'entitlements.list') throw new Error('Unavailable');
    return fallback(action, payload);
  };
  await airport.load();
  assert.equal(airport.data.outdated, true);
  airport.selectAirport(filterEvent('EXA'));
  airport.confirmSearch();
  assert.deepEqual(storage.get(recentAirportKey()), saved);
  assert.equal(storageWrites.length, 1);
  assert.equal(commands.length, 0);
});

test('recent airport history keeps six reusable airports and uses the registered name when no code exists', async () => {
  const codes = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG'];
  raw.items = [entitlement({ lounges: codes.map(code => lounge(code, { airportCode: code, airportName: `Airport ${code}` })) })];
  const airport = page(loungeDefinition);
  await airport.load();
  for (const code of codes) airport.selectAirport(filterEvent(code));
  assert.deepEqual(airport.data.recentAirports.map((item: { key: string }) => item.key), codes.slice(1).reverse());
  raw.items = [entitlement({ lounges: [lounge('without-code', { airportCode: '', airportName: 'Registered Airport Without Code' })] })];
  await airport.load();
  airport.changeSearch(value('Registered Airport Without Code'));
  airport.confirmSearch();
  assert.equal(airport.data.recentAirports[0].key, 'Registered Airport Without Code');
  airport.clearFilters();
  airport.selectAirport(filterEvent(airport.data.recentAirports[0].key));
  assert.equal(airport.data.matches.length, 1);
  assert.equal(airport.data.matches[0].loungeId, 'without-code');
  assert.equal(commands.length, 0);
});

test('recent airport storage follows the verified owner and rejects a foreign-owner envelope', async () => {
  const airport = page(loungeDefinition);
  await airport.load();
  airport.selectAirport(filterEvent('EXA'));
  const firstOwnerHistory = structuredClone(storage.get(recentAirportKey()));
  const otherOwner = 'other-owner / private';
  storage.set(recentAirportKey(otherOwner), structuredClone(firstOwnerHistory));
  sessionOwnerId = otherOwner;
  await ensureSession(true);
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'entitlements.list') throw new Error('Other owner records unavailable');
    return fallback(action, payload);
  };
  await airport.load();
  assert.equal(airport.data.ownerId, otherOwner);
  assert.equal(airport.data.raw, null);
  assert.equal(airport.data.matches.length, 0);
  assert.equal(airport.data.airports.length, 0);
  assert.equal(airport.data.recentAirports.length, 0);
  assert.equal(airport.data.search, '');
  assert.equal(airport.data.terminal, '');
  assert.equal(airport.data.zone, 'all');
  airport.confirmSearch();
  assert.deepEqual(storage.get(recentAirportKey()), firstOwnerHistory);
  assert.deepEqual(storage.get(recentAirportKey(otherOwner)), firstOwnerHistory);
  assert.equal(storageWrites.length, 1);
  raw = { today, items: [entitlement({ ownerId: otherOwner, lounges: [lounge('other', { airportName: 'Other Owner Airport', airportCode: 'OTH' })] })], cards: [] };
  queryHandler = fallback;
  await airport.load();
  airport.selectAirport(filterEvent('OTH'));
  assert.deepEqual(airport.data.recentAirports.map((item: { key: string }) => item.key), ['OTH']);
  assert.equal((storage.get(recentAirportKey(otherOwner)) as any).ownerId, otherOwner);
  assert.deepEqual(storage.get(recentAirportKey()), firstOwnerHistory);
  assert.equal(commands.length, 0);
});

test('a late previous-owner airport read cannot replace current results or write either owner history', async () => {
  const airport = page(loungeDefinition);
  await airport.load();
  airport.selectAirport(filterEvent('EXA'));
  const firstOwnerHistory = structuredClone(storage.get(recentAirportKey()));
  const pending = deferred<EntitlementList>();
  const started = deferred<boolean>();
  const fallback = queryHandler;
  queryHandler = async (action, payload) => {
    if (action === 'entitlements.list') { started.resolve(true); return pending.promise; }
    return fallback(action, payload);
  };
  const oldLoad = airport.load();
  await started.promise;
  const oldRecords = structuredClone(raw);
  const otherOwner = 'another-owner';
  sessionOwnerId = otherOwner;
  await ensureSession(true);
  raw = { today, items: [entitlement({ ownerId: otherOwner, lounges: [lounge('other', { airportName: 'Another Airport', airportCode: 'OTH' })] })], cards: [] };
  queryHandler = fallback;
  await airport.load();
  airport.selectAirport(filterEvent('OTH'));
  const secondOwnerHistory = structuredClone(storage.get(recentAirportKey(otherOwner)));
  pending.resolve(oldRecords);
  await oldLoad;
  assert.equal(airport.data.ownerId, otherOwner);
  assert.equal(airport.data.matches[0].airportCode, 'OTH');
  assert.deepEqual(airport.data.recentAirports.map((item: { key: string }) => item.key), ['OTH']);
  assert.deepEqual(storage.get(recentAirportKey()), firstOwnerHistory);
  assert.deepEqual(storage.get(recentAirportKey(otherOwner)), secondOwnerHistory);
  assert.equal(storageWrites.length, 2);
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

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Commands, Entitlement, EntitlementList, LoungeAccess, MutationResult } from '../shared/contracts';
import type { MemorySeed } from '../domain/memory-store';
import { demoActor, demoService, resetDemoCache } from '../miniprogram/services/demo';

const storageKey = 'card-benefits.native.demo.v1';
const originalWx = (globalThis as any).wx;
type StoredDemo = { version: 1; seed: MemorySeed };
type SeedRequest = { id: string; ownerId: string; requestId: string; fingerprint: string; result: MutationResult; createdAt: string };

function installStorage() {
  const storage = new Map<string, unknown>();
  (globalThis as any).wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
  };
  demoActor.isModerator = false;
  resetDemoCache();
  return storage;
}

async function legacyFixture(storage: Map<string, unknown>) {
  await demoService();
  const stored = structuredClone(storage.get(storageKey)) as StoredDemo;
  const entitlement = Object.values(stored.seed.entitlements || {}).find(item => (item as Entitlement).kind === 'lounge') as Entitlement;
  for (const item of entitlement.lounges) delete item.supportedBanks;
  const request = Object.values(stored.seed.requests || {}).find(item => (item as SeedRequest).requestId === 'demo-held-benefits-v1-0') as SeedRequest;
  const original = JSON.parse(request.fingerprint) as { action: 'entitlement.save'; payload: Commands['entitlement.save'] };
  for (const item of original.payload.draft.lounges) delete item.supportedBanks;
  request.fingerprint = JSON.stringify(original);
  for (const event of Object.values(stored.seed.audit_events || {})) {
    const after = (event as { after?: Partial<Entitlement> }).after;
    if (after?.id === entitlement.id) for (const item of after.lounges || []) delete item.supportedBanks;
  }
  storage.set(storageKey, structuredClone(stored));
  resetDemoCache();
  return { stored, entitlement, request, original };
}

afterEach(() => { resetDemoCache(); (globalThis as any).wx = originalWx; });

test('fresh fictional demo lounges name their supported bank explicitly', async () => {
  installStorage();
  const service = await demoService();
  const list = await service.execute(demoActor, { action: 'entitlements.list', payload: {} }) as EntitlementList;
  const lounges = list.items.flatMap(item => item.lounges);
  assert.equal(lounges.length, 2);
  assert.ok(lounges.every(item => item.supportedBanks?.length === 1 && item.supportedBanks[0] === '示例银行'));
});

test('untouched legacy demo lounges receive only bank annotations and retain original request replay', async () => {
  const storage = installStorage();
  const { stored, entitlement, request, original } = await legacyFixture(storage);
  const expected = structuredClone(stored);
  const expectedEntitlement = expected.seed.entitlements![entitlement.id] as Entitlement;
  expectedEntitlement.lounges.forEach(item => { item.supportedBanks = ['示例银行']; });
  const service = await demoService();
  assert.deepEqual(storage.get(storageKey), expected);
  const result = await service.execute(demoActor, { ...original, requestId: request.requestId });
  assert.deepEqual(result, request.result);
  const list = await service.execute(demoActor, { action: 'entitlements.list', payload: {} }) as EntitlementList;
  assert.equal(list.items.length, 3);
  assert.equal(list.items.find(item => item.id === entitlement.id)?.version, entitlement.version);
  assert.equal(list.items.find(item => item.id === entitlement.id)?.usedUses, entitlement.usedUses);
  resetDemoCache();
  await demoService();
  assert.deepEqual(storage.get(storageKey), expected);
});

test('custom supported bank lists and deliberately cleared lists survive demo loading', async () => {
  const storage = installStorage();
  const { stored, entitlement } = await legacyFixture(storage);
  entitlement.lounges[0].supportedBanks = ['Custom fixture bank'];
  entitlement.lounges[1].supportedBanks = [];
  storage.set(storageKey, structuredClone(stored));
  const service = await demoService();
  assert.deepEqual(storage.get(storageKey), stored);
  const list = await service.execute(demoActor, { action: 'entitlements.list', payload: {} }) as EntitlementList;
  const actual = list.items.find(item => item.id === entitlement.id)!;
  assert.deepEqual(actual.lounges[0].supportedBanks, ['Custom fixture bank']);
  assert.deepEqual(actual.lounges[1].supportedBanks, []);
});

test('every legacy lounge field must match the original template before adding a bank', async () => {
  const storage = installStorage();
  const { stored, entitlement } = await legacyFixture(storage);
  for (const field of Object.keys(entitlement.lounges[0])) {
    const candidate = structuredClone(stored);
    const record = candidate.seed.entitlements![entitlement.id] as Entitlement;
    const changed = record.lounges[0] as unknown as Record<string, unknown>;
    changed[field] = typeof changed[field] === 'number' ? Number(changed[field]) + 1 : `${changed[field]} edited`;
    const before = structuredClone(record.lounges[0]);
    storage.set(storageKey, candidate);
    resetDemoCache();
    const service = await demoService();
    const list = await service.execute(demoActor, { action: 'entitlements.list', payload: {} }) as EntitlementList;
    const actual = list.items.find(item => item.id === entitlement.id)!;
    assert.deepEqual(actual.lounges[0], before, field);
    assert.deepEqual(actual.lounges[1].supportedBanks, ['示例银行'], field);
  }
  const candidate = structuredClone(stored);
  const record = candidate.seed.entitlements![entitlement.id] as Entitlement;
  (record.lounges[0] as LoungeAccess & { customRule: string }).customRule = 'Preserve this annotation';
  storage.set(storageKey, candidate);
  resetDemoCache();
  await demoService();
  assert.equal(((storage.get(storageKey) as StoredDemo).seed.entitlements![entitlement.id] as Entitlement).lounges[0].supportedBanks, undefined);
});

test('ambiguous owner, provider, creation time or missing origin prevents demo annotations', async () => {
  const storage = installStorage();
  const { stored, entitlement, request } = await legacyFixture(storage);
  const changes: Array<(seed: MemorySeed) => void> = [
    seed => { (seed.entitlements![entitlement.id] as Entitlement).ownerId = 'another-owner'; },
    seed => { (seed.entitlements![entitlement.id] as Entitlement).provider = 'Custom provider'; },
    seed => { (seed.entitlements![entitlement.id] as Entitlement).createdAt = '2000-01-01T04:00:00.000Z'; },
    seed => { delete seed.requests![request.id]; },
  ];
  for (const change of changes) {
    const candidate = structuredClone(stored);
    change(candidate.seed);
    storage.set(storageKey, structuredClone(candidate));
    resetDemoCache();
    await demoService();
    assert.deepEqual(storage.get(storageKey), candidate);
  }
});

test('manual copies and empty existing entitlement collections are never rebuilt or seeded', async () => {
  const storage = installStorage();
  const { stored, entitlement } = await legacyFixture(storage);
  const manual: Entitlement = { ...entitlement, id: 'manual-copy', lounges: entitlement.lounges.map(item => ({ ...item })) };
  const candidate = structuredClone(stored);
  candidate.seed.entitlements = { [manual.id]: manual };
  storage.set(storageKey, structuredClone(candidate));
  resetDemoCache();
  const service = await demoService();
  assert.deepEqual(storage.get(storageKey), candidate);
  const list = await service.execute(demoActor, { action: 'entitlements.list', payload: {} }) as EntitlementList;
  assert.deepEqual(list.items, [manual]);
  candidate.seed.entitlements = {};
  storage.set(storageKey, structuredClone(candidate));
  resetDemoCache();
  const empty = await demoService();
  assert.deepEqual((await empty.execute(demoActor, { action: 'entitlements.list', payload: {} }) as EntitlementList).items, []);
  assert.deepEqual(storage.get(storageKey), candidate);
});

import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import { api } from '../miniprogram/services/api';
import settings from '../miniprogram/runtime-config';
import type { Actor, ApiRequest, Commands, EntitlementDraft, MutationResult } from '../shared/contracts';

const originalMode = settings.mode, originalEnv = settings.cloudEnvId, originalWx = (globalThis as any).wx;
let index = 0;
let store: MemoryStore;
let service: ReturnType<typeof createService>;
let actor: Actor;
let requests: ApiRequest[];
let loseAction = '';
const draft = (): EntitlementDraft => ({ title: 'Airport visits', kind: 'lounge', cardId: '', provider: 'Manual source',
  totalUses: 6, initialUsed: 1, startsOn: '2026-01-01', endsOn: '2026-12-31', transferability: 'grey',
  transferNote: 'Check current terms', notes: '', lounges: [] });

beforeEach(() => {
  actor = { userId: `client-entitlements-${++index}`, isModerator: false };
  store = new MemoryStore(); service = createService(store, { now: () => new Date('2026-09-24T04:00:00Z') });
  requests = []; loseAction = '';
  settings.mode = 'cloud'; settings.cloudEnvId = 'isolated-entitlements';
  (globalThis as any).wx = { cloud: { init() {}, async callFunction({ data }: { data: ApiRequest }) {
    requests.push(structuredClone(data));
    let result: unknown;
    try { result = await service.execute(actor, data); }
    catch (error) {
      if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
      throw error;
    }
    if (loseAction === data.action) { loseAction = ''; throw new Error('Response lost after commit'); }
    return { result: { ok: true, data: result } };
  } } };
});
after(() => { settings.mode = originalMode; settings.cloudEnvId = originalEnv; (globalThis as any).wx = originalWx; });

async function create() {
  return api.command('entitlement.save', { draft: draft() }, { intentKey: `${actor.userId}-create` });
}

test('a retained creation intent recovers one entitlement after a lost response', async () => {
  const payload = { draft: draft() }, options = { intentKey: `${actor.userId}-stable` };
  loseAction = 'entitlement.save';
  await assert.rejects(api.command('entitlement.save', payload, options), (error: any) => error.code === 'NETWORK_ERROR');
  const result = await api.command('entitlement.save', payload, options);
  const records = await api.query('entitlements.list', {});
  assert.equal(records.items.length, 1); assert.equal(records.items[0].id, result.id);
  const commands = requests.filter(item => item.action === 'entitlement.save') as Array<ApiRequest & { requestId: string }>;
  assert.equal(commands[0].requestId, commands[1].requestId);
});

test('a repeated uncertain use deducts once and an owned history reversal restores the balance', async () => {
  const created = await create();
  const payload: Commands['entitlement.use'] = { id: created.id, quantity: 2, usedOn: '2026-09-24', expectedVersion: created.version! };
  loseAction = 'entitlement.use';
  await assert.rejects(api.command('entitlement.use', payload), (error: any) => error.code === 'NETWORK_ERROR');
  const first = await api.query('entitlement.get', { id: created.id });
  assert.equal(first.entitlement.usedUses, 3); assert.equal(first.usages.length, 1);
  const confirmed = await api.command('entitlement.use', payload);
  assert.equal(confirmed.id, first.usages[0].id);
  const undone = await api.command('entitlement.undo', { id: confirmed.id, expectedVersion: confirmed.version! });
  assert.equal(undone.id, created.id);
  const final = await api.query('entitlement.get', { id: created.id });
  assert.equal(final.entitlement.usedUses, 1); assert.ok(final.usages[0].reversedAt);
});

test('two simultaneous duplicate use calls share the same request and result', async () => {
  const created = await create();
  const payload: Commands['entitlement.use'] = { id: created.id, quantity: 1, usedOn: '2026-09-24', expectedVersion: created.version! };
  const results = await Promise.all([api.command('entitlement.use', payload), api.command('entitlement.use', payload)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(requests.filter(item => item.action === 'entitlement.use').length, 1);
  assert.equal((await api.query('entitlement.get', { id: created.id })).entitlement.usedUses, 2);
});

test('a failed original creation can be looked up without creating a missing entitlement', async () => {
  const payload = { draft: draft() }, intentKey = `${actor.userId}-absent`;
  await assert.rejects(api.command('entitlement.save', payload, { intentKey, replayOnly: true }), (error: any) => error.code === 'REQUEST_UNRESOLVED');
  assert.equal((await api.query('entitlements.list', {})).items.length, 0);
  const created = await api.command('entitlement.save', payload, { intentKey });
  const resolved: MutationResult = await api.command('entitlement.save', payload, { intentKey, replayOnly: true });
  assert.equal(resolved.id, created.id);
  assert.equal((await api.query('entitlements.list', {})).items.length, 1);
});

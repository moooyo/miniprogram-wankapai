import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type { Entitlement, LoungeAccess } from '../shared/contracts';
import { banks } from '../shared/catalog';

type PageInstance = { data: Record<string, any>; [key: string]: any };
type Pending<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };
function deferred<T>(): Pending<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function record(): Entitlement {
  return { id: 'ent-1', ownerId: 'owner-1', title: 'Annual lounge', kind: 'lounge', cardId: '', provider: '', totalUses: 10, initialUsed: 2,
    usedUses: 5, startsOn: '2026-01-01', endsOn: '2026-12-31', transferability: 'not_allowed', transferNote: '', notes: '', lounges: [], version: 4,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z', archivedAt: null };
}
function legacyLounge(): LoungeAccess {
  return { id: 'lounge-legacy', airportName: 'Example Airport', airportCode: 'PEK', city: 'Example City', loungeName: 'Example Lounge', terminal: 'T1',
    zone: 'unknown', reservation: 'unknown', advanceHours: 0, reservationNote: '', customerScope: 'unknown', customerNote: '', guestNote: '',
    openingHours: '', location: '', unitsPerVisit: 1, sourceNote: '', verifiedOn: '' };
}
const input = (field: string, value: string) => ({ currentTarget: { dataset: { field } }, detail: { value } });
const press = (index?: number) => ({ currentTarget: { dataset: index === undefined ? {} : { index } } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function harness(today = '2026-09-24') {
  let definition!: PageInstance;
  let current: PageInstance | undefined;
  let ownerId = 'owner-1';
  let sequence = 0;
  let intentSequence = 0;
  let modalResult = true;
  let readError: Error | null = null;
  let currentRecord = record();
  let handler: (payload: any, options: any) => Promise<any> = async payload => ({ id: payload.id || 'ent-created', version: 1 });
  const effects: string[] = [];
  const commands: { payload: any; options: any }[] = [];
  const modals: any[] = [];
  const drafts = new Map<string, any>();
  const key = (scope: string, owner: string, id: string) => `${scope}:${owner}:${id}`;
  const draftApi = {
    createCommandIntent: () => `intent_${++intentSequence}`,
    getDraftRevision: (scope: string, owner: string, id: string) => drafts.get(key(scope, owner, id))?.revision || null,
    loadDraft: (scope: string, owner: string, id: string) => structuredClone(drafts.get(key(scope, owner, id)) || null),
    saveDraft: (scope: string, owner: string, id: string, baseVersion: number | null, value: unknown) => {
      drafts.set(key(scope, owner, id), { value: structuredClone(value), baseVersion, ownerId: owner, entityId: id, revision: `revision_${++sequence}` }); return true;
    },
    removeDraft: (scope: string, owner: string, id: string, revision?: string | null) => {
      const draftKey = key(scope, owner, id);
      if (revision === undefined || (drafts.get(draftKey)?.revision || null) === revision) drafts.delete(draftKey);
    },
    confirmDraftRecovery: async () => { modals.push({ recovery: true }); return modalResult; },
  };
  const source = readFileSync(path.join(process.cwd(), 'miniprogram/pages/entitlement-edit/index.ts'), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(javascript, {
    exports: {}, Error, Date, Page: (value: PageInstance) => { definition = value; }, getCurrentPages: () => current ? [current] : [],
    require: (name: string) => {
      if (name.endsWith('/form-draft')) return draftApi;
      if (name.endsWith('/card-labels')) return { cardLabel: (id: string) => `Card ${id}` };
      if (name.endsWith('/catalog')) return { banks };
      if (name.endsWith('/navigation')) return { navigateBackOr: () => { effects.push('navigate'); } };
      if (name.endsWith('/api')) return {
        ensureSession: async () => ({ userId: ownerId, today }),
        api: {
          query: async (action: string) => {
            if (readError) throw readError;
            if (action === 'entitlement.get') return { today, entitlement: structuredClone(currentRecord), usages: [], cards: [] };
            if (action === 'entitlements.list') return { today, items: [], cards: [] };
            throw new Error(`Unexpected query: ${action}`);
          },
          command: async (_action: string, payload: unknown, options?: unknown) => {
            commands.push({ payload: structuredClone(payload), options: structuredClone(options) }); return handler(payload, options);
          },
        },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    wx: {
      setNavigationBarTitle: () => {}, nextTick: (callback: () => void) => callback(),
      enableAlertBeforeUnload: () => { effects.push('guard-on'); }, disableAlertBeforeUnload: () => { effects.push('guard-off'); },
      pageScrollTo: ({ selector }: { selector: string }) => { effects.push(`scroll:${selector}`); }, showToast: () => { effects.push('toast'); },
      showModal: async (options: unknown) => { modals.push(options); return { confirm: modalResult }; },
    },
  });
  return {
    async create(id = '') {
      const instance: PageInstance = { ...definition, data: structuredClone(definition.data) };
      instance.setData = (patch: Record<string, unknown>, callback?: () => void) => { Object.assign(instance.data, structuredClone(patch)); callback?.(); };
      instance.setData({ id, editing: !!id }); current = instance;
      await instance.load(); return instance;
    },
    setOwner(value: string) { ownerId = value; },
    setRecord(value: Entitlement) { currentRecord = value; },
    setReadError(value: Error | null) { readError = value; },
    setModal(value: boolean) { modalResult = value; },
    setHandler(value: typeof handler) { handler = value; },
    activate(value: PageInstance) { current = value; value.hidden = false; },
    draft(id = 'new', owner = 'owner-1') { return draftApi.loadDraft('entitlement', owner, id); },
    effects, commands, drafts, modals,
  };
}
function fill(instance: PageInstance) {
  instance.input(input('title', 'Annual lounge'));
  instance.input(input('totalUses', '6'));
  instance.input(input('endsOn', '2026-12-31'));
}
function fillLounge(instance: PageInstance) {
  instance.loungeInput(input('airportName', 'Example Airport'));
  instance.loungeInput(input('loungeName', 'Example Lounge'));
}
function choose(instance: PageInstance, field: 'kind' | 'loungeProgram', value: string, chip = false) {
  const options = field === 'kind' ? instance.data.kinds : instance.data.loungePrograms;
  const index = options.findIndex((item: { value: string }) => item.value === value);
  assert.ok(index >= 0, `Missing ${field} option: ${value}`);
  instance.select(chip ? { currentTarget: { dataset: { field, index } } } : input(field, String(index)));
}

test('count-based categories save through picker and chip selections', async () => {
  for (const [index, kind] of ['lounge', 'airport_transfer', 'health_check', 'car_wash', 'other'].entries()) {
    const env = harness(); const page = await env.create(); fill(page);
    choose(page, 'kind', kind, index % 2 === 1);
    assert.equal(page.data.draft.kind, kind);
    await page.save();
    assert.equal(env.commands.length, 1);
    assert.equal(env.commands[0].payload.draft.kind, kind);
    assert.equal(env.commands[0].payload.draft.totalUses, 6);
    assert.equal(env.commands[0].payload.draft.initialUsed, 0);
  }
});

test('description and lounge program survive loading, draft recovery, and version refresh', async () => {
  const env = harness(); env.setRecord({ ...record(), description: 'Original access rules', loungeProgram: 'dragon' });
  const first = await env.create('ent-1');
  assert.equal(first.data.draft.description, 'Original access rules');
  assert.equal(first.data.draft.loungeProgram, 'dragon');
  first.input(input('description', '  Access through the issuing bank  '));
  choose(first, 'loungeProgram', 'pp', true);
  assert.equal(env.draft('ent-1').value.draft.description, '  Access through the issuing bank  ');
  assert.equal(env.draft('ent-1').value.draft.loungeProgram, 'pp');
  first.onUnload(); const second = await env.create('ent-1');
  assert.equal(second.data.draft.description, '  Access through the issuing bank  ');
  assert.equal(second.data.draft.loungeProgram, 'pp');
  env.setRecord({ ...record(), description: 'Newer server access rules', loungeProgram: 'plaza', version: 5 });
  await second.reloadLatest();
  assert.equal(second.data.expectedVersion, 5);
  assert.equal(second.data.draft.description, '  Access through the issuing bank  ');
  assert.equal(second.data.draft.loungeProgram, 'pp');
  await second.save();
  assert.equal(env.commands[0].payload.expectedVersion, 5);
  assert.equal(env.commands[0].payload.draft.description, 'Access through the issuing bank');
  assert.equal(env.commands[0].payload.draft.loungeProgram, 'pp');
  assert.equal(Object.hasOwn(env.commands[0].payload.draft, 'pointsBalance'), false);
});

test('all lounge programs can be selected by picker and chip', async () => {
  const env = harness(); const page = await env.create();
  for (const [index, program] of ['dragon', 'pp', 'plaza', 'unionpay', 'other'].entries()) {
    choose(page, 'loungeProgram', program, index % 2 === 1);
    assert.equal(page.data.draft.loungeProgram, program);
    assert.equal(env.draft().value.draft.loungeProgram, program);
  }
});

test('point edits survive loading, recovery, and version refresh before saving', async () => {
  const env = harness();
  env.setRecord({ ...record(), kind: 'points', totalUses: 0, initialUsed: 0, usedUses: 0,
    description: 'Original point program', pointsBalance: 12500 });
  const first = await env.create('ent-1');
  assert.equal(first.data.draft.description, 'Original point program');
  assert.equal(first.data.draft.pointsBalance, '12500');
  first.input(input('description', '  Updated point program  '));
  first.input(input('pointsBalance', '18000'));
  first.onUnload(); const second = await env.create('ent-1');
  assert.equal(second.data.draft.description, '  Updated point program  ');
  assert.equal(second.data.draft.pointsBalance, '18000');
  env.setRecord({ ...record(), kind: 'points', totalUses: 0, initialUsed: 0, usedUses: 0,
    description: 'Newer server program', pointsBalance: 22000, version: 5 });
  await second.reloadLatest();
  assert.equal(second.data.expectedVersion, 5);
  assert.equal(second.data.draft.description, '  Updated point program  ');
  assert.equal(second.data.draft.pointsBalance, '18000');
  await second.save();
  assert.equal(env.commands[0].payload.expectedVersion, 5);
  assert.equal(env.commands[0].payload.draft.description, 'Updated point program');
  assert.equal(env.commands[0].payload.draft.pointsBalance, 18000);
  assert.equal(env.commands[0].payload.draft.totalUses, 0);
  assert.equal(env.commands[0].payload.draft.initialUsed, 0);
});

test('informational categories submit zero counts and require their own information', async () => {
  for (const kind of ['delay_insurance', 'points']) {
    const env = harness(); const page = await env.create(); fill(page);
    page.input(input('initialUsed', '2'));
    choose(page, 'kind', kind, true);
    await page.save();
    assert.equal(env.commands.length, 0);
    assert.ok(page.data.errors[kind === 'points' ? 'pointsBalance' : 'description']);
    page.input(input('description', '  Program rules  '));
    if (kind === 'points') page.input(input('pointsBalance', '0'));
    await page.save();
    assert.equal(env.commands.length, 1);
    assert.equal(env.commands[0].payload.draft.kind, kind);
    assert.equal(env.commands[0].payload.draft.description, 'Program rules');
    assert.equal(env.commands[0].payload.draft.totalUses, 0);
    assert.equal(env.commands[0].payload.draft.initialUsed, 0);
    if (kind === 'points') assert.equal(env.commands[0].payload.draft.pointsBalance, 0);
    else assert.equal(Object.hasOwn(env.commands[0].payload.draft, 'pointsBalance'), false);
  }
});

test('points balance rejects negative, fractional, unsafe, and malformed values', async () => {
  const env = harness(); const page = await env.create(); fill(page); choose(page, 'kind', 'points');
  for (const value of ['-1', '1.5', '9007199254740992', 'NaN', '1e3', '']) {
    page.input(input('pointsBalance', value)); await page.save();
    assert.equal(env.commands.length, 0, `Unexpected save for points balance: ${value}`);
    assert.ok(page.data.errors.pointsBalance);
    assert.equal(page.data.openSection, 'content');
    assert.ok(env.effects.includes('scroll:#field-pointsBalance'));
  }
  page.input(input('pointsBalance', String(Number.MAX_SAFE_INTEGER))); await page.save();
  assert.equal(env.commands.length, 1);
  assert.equal(env.commands[0].payload.draft.pointsBalance, Number.MAX_SAFE_INTEGER);
});

test('informational description and notes errors reveal the content fields', async () => {
  for (const kind of ['delay_insurance', 'points']) {
    const env = harness(); const page = await env.create(); fill(page); choose(page, 'kind', kind);
    for (const field of ['description', 'notes']) {
      page.showErrors({ [field]: 'Review the program information' });
      assert.equal(page.data.openSection, 'content');
      assert.equal(page.data.focusField, field);
      assert.ok(env.effects.includes(`scroll:#field-${field}`));
    }
  }
});

test('informational categories cannot discard recorded quota usage', async () => {
  for (const kind of ['delay_insurance', 'points']) {
    const env = harness(); const page = await env.create('ent-1');
    choose(page, 'kind', kind); page.input(input('description', 'Program rules'));
    if (kind === 'points') page.input(input('pointsBalance', '1000'));
    await page.save();
    assert.equal(env.commands.length, 0);
    assert.equal(page.data.trackedUsed, 3);
    assert.ok(page.data.errors.kind);
  }
});

test('unknown kind and lounge program selections leave the current draft unchanged', async () => {
  const env = harness(); const page = await env.create(); fill(page); choose(page, 'loungeProgram', 'dragon');
  const before = structuredClone(page.data.draft), stored = structuredClone(env.draft());
  for (const field of ['kind', 'loungeProgram']) {
    const length = field === 'kind' ? page.data.kinds.length : page.data.loungePrograms.length;
    for (const index of [-1, 0.5, length, 'unknown']) {
      page.select(input(field, String(index)));
      assert.deepEqual(page.data.draft, before);
      page.select({ currentTarget: { dataset: { field, index } } });
      assert.deepEqual(page.data.draft, before);
    }
  }
  assert.deepEqual(env.draft(), stored);
});

test('draft recovery rejects unknown kinds and lounge programs while retaining the stored copy', async () => {
  for (const patch of [{ kind: 'unknown_kind' }, { loungeProgram: 'unknown_program' }]) {
    const env = harness(); const first = await env.create(); fill(first); first.onUnload();
    const saved = env.draft(); Object.assign(saved.value.draft, patch);
    env.drafts.set('entitlement:owner-1:new', saved);
    const second = await env.create();
    assert.equal(second.data.draft.title, '');
    assert.equal(second.data.draft.kind, 'lounge');
    assert.equal(second.data.pending, false);
    assert.equal(env.modals.length, 0);
    assert.deepEqual(env.draft(), saved);
    assert.ok(second.data.notice);
  }
});

test('legacy local forms recover without adding optional entitlement fields', async () => {
  const env = harness(); const first = await env.create(); fill(first);
  const fields = ['description', 'pointsBalance', 'loungeProgram'];
  for (const field of fields) assert.equal(Object.hasOwn(env.draft().value.draft, field), false);
  first.onUnload(); const second = await env.create();
  assert.equal(second.data.draft.title, 'Annual lounge');
  for (const field of fields) assert.equal(Object.hasOwn(second.data.draft, field), false);
  await second.save();
  for (const field of fields) assert.equal(Object.hasOwn(env.commands[0].payload.draft, field), false);
});

test('a pending point creation restores the exact optional field body and intent', async () => {
  const env = harness(); const first = await env.create(); fill(first); choose(first, 'kind', 'points', true);
  first.input(input('description', '  Point program  ')); first.input(input('pointsBalance', '12345'));
  env.setHandler(async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); });
  await first.save(); assert.equal(first.data.pending, true);
  const sent = structuredClone(env.commands[0]);
  assert.equal(sent.payload.draft.description, 'Point program');
  assert.equal(sent.payload.draft.pointsBalance, 12345);
  assert.equal(sent.payload.draft.totalUses, 0); assert.equal(sent.payload.draft.initialUsed, 0);
  first.onUnload(); const second = await env.create();
  assert.equal(second.data.pending, true);
  assert.equal(second.data.draft.description, '  Point program  ');
  assert.equal(second.data.draft.pointsBalance, '12345');
  second.input(input('pointsBalance', '99999'));
  assert.equal(second.data.draft.pointsBalance, '12345');
  env.setHandler(async () => ({ id: 'ent-created', version: 1 })); await second.save();
  assert.deepEqual(env.commands[1], sent); assert.equal(env.draft(), null);
});

test('count steppers preserve tracked usage and persist eligible changes', async () => {
  const env = harness(); const page = await env.create('ent-1');
  page.showErrors({ totalUses: 'Review the quota' });
  for (let index = 0; index < 5; index++) page.adjustCount({ currentTarget: { dataset: { field: 'totalUses', delta: -1 } } });
  assert.equal(page.data.draft.totalUses, '5'); assert.equal(page.data.remaining, '0');
  assert.equal(page.data.errors.totalUses, undefined);
  const lowerBound = structuredClone(page.data.draft), savedBound = structuredClone(env.draft('ent-1'));
  page.adjustCount({ currentTarget: { dataset: { field: 'totalUses', delta: -1 } } });
  page.adjustCount({ currentTarget: { dataset: { field: 'initialUsed', delta: 1 } } });
  assert.deepEqual(page.data.draft, lowerBound); assert.deepEqual(env.draft('ent-1'), savedBound);
  page.adjustCount({ currentTarget: { dataset: { field: 'initialUsed', delta: -1 } } });
  assert.equal(page.data.draft.initialUsed, '1'); assert.equal(page.data.remaining, '1');
  page.adjustCount({ currentTarget: { dataset: { field: 'initialUsed', delta: 1 } } });
  page.adjustCount({ currentTarget: { dataset: { field: 'totalUses', delta: 1 } } });
  page.adjustCount({ currentTarget: { dataset: { field: 'initialUsed', delta: 1 } } });
  assert.equal(page.data.draft.totalUses, '6'); assert.equal(page.data.draft.initialUsed, '3');
  assert.equal(page.data.trackedUsed, 3); assert.equal(page.data.remaining, '0');
  assert.equal(env.draft('ent-1').value.draft.totalUses, '6');
  assert.equal(env.draft('ent-1').value.draft.initialUsed, '3');
  await page.save();
  assert.equal(env.commands[0].payload.expectedVersion, 4);
  assert.equal(env.commands[0].payload.draft.totalUses, 6);
  assert.equal(env.commands[0].payload.draft.initialUsed, 3);
});

test('count steppers retain zero and maximum quota boundaries', async () => {
  const env = harness(); const page = await env.create(); fill(page);
  page.input(input('totalUses', '0'));
  for (const field of ['totalUses', 'initialUsed']) page.adjustCount({ currentTarget: { dataset: { field, delta: -1 } } });
  assert.equal(page.data.draft.totalUses, '0'); assert.equal(page.data.draft.initialUsed, '0');
  page.input(input('totalUses', '9999'));
  page.adjustCount({ currentTarget: { dataset: { field: 'totalUses', delta: 1 } } });
  assert.equal(page.data.draft.totalUses, '9999');
  page.input(input('initialUsed', '9999'));
  page.adjustCount({ currentTarget: { dataset: { field: 'initialUsed', delta: 1 } } });
  assert.equal(page.data.draft.initialUsed, '9999'); assert.equal(page.data.remaining, '0');
});

test('count steppers ignore unknown fields and unsupported deltas', async () => {
  const env = harness(); const page = await env.create(); fill(page);
  const before = structuredClone(page.data.draft), stored = structuredClone(env.draft());
  for (const field of ['notes', 'usedUses', 'unknown']) page.adjustCount({ currentTarget: { dataset: { field, delta: 1 } } });
  for (const delta of [undefined, 0, 2, -2, 0.5, Number.NaN, 'unknown']) {
    for (const field of ['totalUses', 'initialUsed']) page.adjustCount({ currentTarget: { dataset: { field, delta } } });
  }
  assert.deepEqual(page.data.draft, before); assert.deepEqual(env.draft(), stored);
});

test('expiry shortcuts derive dates from today and preserve the effective date', async () => {
  const env = harness('2030-02-03'); const page = await env.create();
  page.input(input('title', 'Annual lounge')); page.input(input('totalUses', '6'));
  const expected = ['2030-12-31', '2031-03-31', '2031-06-30', '2031-12-31'];
  assert.deepEqual(page.data.expiryChoices.map((item: { value: string }) => item.value), expected);
  assert.ok(page.data.expiryChoices.every((item: { label: string }) => typeof item.label === 'string' && item.label.length > 0));
  for (const [index, value] of expected.entries()) {
    page.showErrors({ endsOn: 'Choose an expiry date' });
    page.chooseExpiry({ currentTarget: { dataset: { index } } });
    assert.equal(page.data.draft.endsOn, value); assert.equal(page.data.draft.startsOn, '2030-02-03');
    assert.equal(page.data.errors.endsOn, undefined);
    assert.equal(env.draft().value.draft.endsOn, value);
    assert.equal(env.draft().value.draft.startsOn, '2030-02-03');
  }
  await page.save();
  assert.equal(env.commands[0].payload.draft.startsOn, '2030-02-03');
  assert.equal(env.commands[0].payload.draft.endsOn, '2031-12-31');
});

test('expiry shortcuts reject earlier dates and invalid indices without replacing the stored draft', async () => {
  const env = harness(); const page = await env.create(); fill(page);
  page.input(input('startsOn', '2027-09-01')); page.input(input('endsOn', '2028-01-31'));
  const before = structuredClone(page.data.draft), stored = structuredClone(env.draft());
  for (const index of [0, 1, 2, -1, 0.5, page.data.expiryChoices.length, 'unknown']) {
    page.chooseExpiry({ currentTarget: { dataset: { index } } });
    assert.deepEqual(page.data.draft, before); assert.deepEqual(env.draft(), stored);
  }
  page.chooseExpiry({ currentTarget: { dataset: { index: 3 } } });
  assert.equal(page.data.draft.startsOn, '2027-09-01'); assert.equal(page.data.draft.endsOn, '2027-12-31');
  assert.equal(env.draft().value.draft.endsOn, '2027-12-31');
});

test('card and transfer chips use the validated picker path before saving', async () => {
  const env = harness(); const page = await env.create(); fill(page);
  page.setData({ cards: [{ id: 'card-own', ownerId: 'owner-1', bankId: 'bank-1', issuerId: 'issuer-1',
    network: 'visa', kind: 'credit', nickname: 'Primary card', createdAt: '2026-01-01T00:00:00Z' }] });
  page.refreshDerived();
  const cardIndex = page.data.cardChoices.findIndex((item: { id: string }) => item.id === 'card-own');
  assert.ok(cardIndex > 0);
  page.select({ currentTarget: { dataset: { field: 'cardId', index: cardIndex } } });
  assert.equal(page.data.draft.cardId, 'card-own');
  page.select(input('cardId', '0')); assert.equal(page.data.draft.cardId, '');
  page.select({ currentTarget: { dataset: { field: 'cardId', index: cardIndex } } });
  for (const [index, value] of ['allowed', 'not_allowed', 'grey'].entries()) {
    const choice = page.data.transfers.findIndex((item: { value: string }) => item.value === value);
    page.select(index === 0 ? input('transferability', String(choice)) : { currentTarget: { dataset: { field: 'transferability', index: choice } } });
    assert.equal(page.data.draft.transferability, value);
  }
  await page.save();
  assert.equal(env.commands[0].payload.draft.cardId, 'card-own');
  assert.equal(env.commands[0].payload.draft.transferability, 'grey');
});

test('pending creations lock count steppers, expiry shortcuts, and selection chips', async () => {
  const env = harness(); const page = await env.create(); fill(page);
  env.setHandler(async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); });
  await page.save(); assert.equal(page.data.pending, true);
  const before = structuredClone(page.data.draft), stored = structuredClone(env.draft());
  page.adjustCount({ currentTarget: { dataset: { field: 'totalUses', delta: 1 } } });
  page.adjustCount({ currentTarget: { dataset: { field: 'initialUsed', delta: 1 } } });
  page.chooseExpiry({ currentTarget: { dataset: { index: 1 } } });
  const allowedIndex = page.data.transfers.findIndex((item: { value: string }) => item.value === 'allowed');
  page.select({ currentTarget: { dataset: { field: 'transferability', index: allowedIndex } } });
  assert.deepEqual(page.data.draft, before); assert.deepEqual(env.draft(), stored);
  assert.equal(env.commands.length, 1);
});

test('leaving points clears the hidden balance and its error while preserving the description', async () => {
  const env = harness(); const page = await env.create(); fill(page); choose(page, 'kind', 'points');
  page.input(input('pointsBalance', '-1')); page.input(input('description', '  Transfer program rules  '));
  await page.save(); assert.equal(env.commands.length, 0); assert.ok(page.data.errors.pointsBalance);
  choose(page, 'kind', 'points', true);
  assert.equal(page.data.draft.pointsBalance, '-1');
  assert.equal(page.data.draft.description, '  Transfer program rules  ');
  choose(page, 'kind', 'airport_transfer', true);
  assert.equal(page.data.draft.pointsBalance, undefined); assert.equal(page.data.errors.pointsBalance, undefined);
  assert.equal(page.data.draft.description, '  Transfer program rules  ');
  page.input(input('totalUses', '4')); page.input(input('endsOn', '2026-12-31'));
  await page.save();
  assert.equal(env.commands.length, 1);
  assert.equal(env.commands[0].payload.draft.kind, 'airport_transfer');
  assert.equal(env.commands[0].payload.draft.totalUses, 4);
  assert.equal(env.commands[0].payload.draft.description, 'Transfer program rules');
  assert.equal(Object.hasOwn(env.commands[0].payload.draft, 'pointsBalance'), false);
});

test('leaving lounge clears its program while selecting lounge again keeps the metadata', async () => {
  const env = harness(); const page = await env.create(); fill(page); choose(page, 'loungeProgram', 'dragon');
  choose(page, 'kind', 'lounge', true); assert.equal(page.data.draft.loungeProgram, 'dragon');
  page.showErrors({ loungeProgram: 'Review the lounge program' });
  choose(page, 'kind', 'car_wash', true);
  assert.equal(page.data.draft.loungeProgram, undefined); assert.equal(page.data.errors.loungeProgram, undefined);
  await page.save();
  assert.equal(env.commands.length, 1);
  assert.equal(env.commands[0].payload.draft.kind, 'car_wash');
  assert.equal(env.commands[0].payload.draft.totalUses, 6);
  assert.equal(Object.hasOwn(env.commands[0].payload.draft, 'loungeProgram'), false);
});

test('new forms default access rules to unknown and preserve add versus cancel', async () => {
  const env = harness(); const page = await env.create();
  page.openLounge(press());
  assert.equal(page.data.loungeDraft.zone, 'unknown');
  assert.equal(page.data.loungeDraft.reservation, 'unknown');
  assert.equal(page.data.loungeDraft.customerScope, 'unknown');
  fillLounge(page); env.setModal(false); await page.closeLounge();
  assert.equal(page.data.loungeVisible, true);
  assert.equal(page.data.draft.lounges.length, 0);
  env.setModal(true); await page.closeLounge();
  assert.equal(page.data.draft.lounges.length, 0);
  page.openLounge(press()); fillLounge(page); page.commitLounge();
  assert.equal(page.data.draft.lounges.length, 1);
  assert.equal(page.data.draft.lounges[0].unitsPerVisit, 1);
  assert.equal(page.data.loungeVisible, false);
});

test('four-hour reservations and local-bank restrictions remain separate from transfer rules', async () => {
  const env = harness(); const page = await env.create(); page.openLounge(press()); fillLounge(page);
  page.loungeSelect(input('reservation', '1')); page.loungeInput(input('advanceHours', '4'));
  page.loungeSelect(input('customerScope', '2')); page.commitLounge();
  assert.equal(page.data.draft.lounges.length, 0);
  assert.ok(page.data.loungeErrors.customerNote);
  assert.equal(page.data.loungeScrollTarget, 'lounge-field-customerNote');
  page.loungeInput(input('customerNote', 'Example Bank customers in City A'));
  page.loungeInput(input('airportCode', 'pek')); page.loungeInput(input('guestNote', 'One accompanying guest'));
  page.commitLounge();
  assert.equal(page.data.draft.lounges[0].advanceHours, 4);
  assert.equal(page.data.draft.lounges[0].customerScope, 'local_bank');
  assert.equal(page.data.draft.lounges[0].airportCode, 'PEK');
  assert.equal(page.data.draft.transferability, 'not_allowed');
});

test('editing and removing lounge rules require explicit commitment', async () => {
  const env = harness(); const page = await env.create(); page.openLounge(press()); fillLounge(page); page.commitLounge();
  const before = structuredClone(page.data.draft.lounges[0]);
  page.openLounge(press(0)); page.loungeInput(input('loungeName', 'Changed lounge')); await page.closeLounge();
  assert.deepEqual(page.data.draft.lounges[0], before);
  page.openLounge(press(0)); env.setModal(false); await page.removeLounge(); assert.equal(page.data.draft.lounges.length, 1);
  env.setModal(true); await page.removeLounge(); assert.equal(page.data.draft.lounges.length, 0);
});

test('editing quota keeps recorded usage distinct from initial historical usage', async () => {
  const env = harness(); const page = await env.create('ent-1');
  assert.equal(page.data.trackedUsed, 3); assert.equal(page.data.remaining, '5');
  page.input(input('initialUsed', '4')); assert.equal(page.data.remaining, '3');
  page.input(input('totalUses', '6')); assert.equal(page.data.remaining, '-1');
  await page.save(); assert.equal(env.commands.length, 0); assert.ok(page.data.errors.totalUses);
  page.input(input('totalUses', '8')); await page.save();
  assert.equal(env.commands[0].payload.expectedVersion, 4); assert.equal(env.commands[0].payload.draft.initialUsed, 4);
  assert.equal(env.commands[0].options, undefined);
});

test('a lost create response locks the submitted body and restores the same intent on retry', async () => {
  const env = harness(); const first = await env.create(); fill(first);
  env.setHandler(async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); });
  await first.save(); assert.equal(first.data.pending, true);
  const sent = structuredClone(env.commands[0]);
  first.input(input('title', 'Do not change a pending creation')); assert.equal(first.data.draft.title, 'Annual lounge');
  assert.deepEqual(env.draft().value.pending.payload, sent.payload);
  first.onUnload(); const second = await env.create();
  assert.equal(second.data.pending, true); assert.equal(second.data.draft.title, 'Annual lounge');
  env.setHandler(async () => ({ id: 'ent-created', version: 1 })); await second.save();
  assert.deepEqual(env.commands[1], sent); assert.equal(env.draft(), null);
});

test('a definite server validation error unlocks editing and targets the inline field', async () => {
  const env = harness(); const page = await env.create(); fill(page);
  env.setHandler(async () => { throw Object.assign(new Error('Quota is no longer sufficient'), { code: 'INSUFFICIENT_USES', field: 'totalUses' }); });
  await page.save();
  assert.equal(page.data.pending, false); assert.equal(page.data.openSection, 'quota');
  assert.ok(page.data.errors.totalUses); assert.ok(env.effects.includes('scroll:#field-totalUses'));
  page.input(input('totalUses', '8')); assert.equal(page.data.draft.totalUses, '8');
});

test('conflict refresh retains input and only then adopts the newest version', async () => {
  const env = harness(); const page = await env.create('ent-1'); page.input(input('title', 'Unsaved title'));
  env.setHandler(async () => { throw Object.assign(new Error('Changed'), { code: 'VERSION_CONFLICT', field: 'expectedVersion' }); });
  await page.save(); assert.equal(page.data.conflict, true); assert.equal(page.data.draft.title, 'Unsaved title');
  env.setReadError(new Error('Read failed')); await page.reloadLatest();
  assert.equal(page.data.expectedVersion, 4); assert.equal(page.data.draft.title, 'Unsaved title');
  env.setReadError(null); env.setRecord({ ...record(), version: 5, usedUses: 6 }); await page.reloadLatest();
  assert.equal(page.data.expectedVersion, 5); assert.equal(page.data.trackedUsed, 4); assert.equal(page.data.conflict, false);
  assert.equal(page.data.draft.title, 'Unsaved title');
});

test('late saves cannot clear a newer page draft or alter its navigation and leave warning', async () => {
  const env = harness(); const first = await env.create(); fill(first); const result = deferred<unknown>();
  env.setHandler(async () => result.promise); const saving = first.save(); await tick();
  first.onUnload(); const second = await env.create();
  second.pendingSave = null; second.setData({ pending: false }); second.input(input('title', 'Newer draft'));
  const before = structuredClone(env.draft()); const effects = env.effects.length;
  result.resolve({ id: 'ent-created', version: 1 }); await saving;
  assert.deepEqual(env.draft(), before); assert.equal(env.effects.length, effects); assert.equal(second.data.dirty, true);
});

test('draft recovery is explicit and isolated by entity and owner', async () => {
  const env = harness(); const first = await env.create(); fill(first); first.onUnload();
  const edited = await env.create('ent-1'); assert.equal(edited.data.draft.title, 'Annual lounge');
  assert.equal(env.modals.length, 0); edited.onUnload(); env.setOwner('owner-2');
  const otherOwner = await env.create(); assert.equal(otherOwner.data.draft.title, ''); assert.equal(env.modals.length, 0);
  otherOwner.onUnload(); env.setOwner('owner-1'); env.setModal(false);
  const declined = await env.create(); assert.equal(declined.data.draft.title, ''); assert.equal(env.modals.length, 1);
});

test('identity changes block saves without moving another owner draft', async () => {
  const env = harness(); const page = await env.create(); fill(page); const before = structuredClone(env.draft());
  env.setOwner('owner-2'); await page.save();
  assert.equal(env.commands.length, 0); assert.equal(page.data.identityChanged, true); assert.deepEqual(env.draft(), before);
});

test('multiple errors expose linked summaries and lounge errors open the appropriate sheet', async () => {
  const env = harness(); const page = await env.create(); await page.save();
  assert.ok(page.data.errorSummary.length >= 2); assert.ok(env.effects.includes('scroll:#entitlement-errors'));
  page.openLounge(press()); fillLounge(page); page.commitLounge();
  page.showErrors({ 'lounges.0.customerNote': 'Describe the local restriction' });
  assert.equal(page.data.loungeVisible, true); assert.equal(page.data.loungeIndex, 0);
  assert.equal(page.data.loungeScrollTarget, 'lounge-field-customerNote');
});

test('future verification dates fail locally and the lounge limit is enforced', async () => {
  const env = harness(); const page = await env.create(); page.openLounge(press()); fillLounge(page);
  page.loungeInput(input('verifiedOn', '2026-09-25')); page.commitLounge(); assert.ok(page.data.loungeErrors.verifiedOn);
  page.loungeInput(input('verifiedOn', '2026-09-24')); page.commitLounge();
  const lounge = page.data.draft.lounges[0];
  page.data.draft.lounges = Array.from({ length: 30 }, (_, index) => ({ ...lounge, id: `lounge-${index}` }));
  page.openLounge(press()); assert.equal(page.data.loungeVisible, false); assert.ok(page.data.formError);
});

test('supported banks normalize on lounge commitment and persist through draft recovery and saving', async () => {
  const env = harness(); const first = await env.create(); fill(first); first.openLounge(press()); fillLounge(first);
  const expected = ['Bank A', 'Bank B', 'Bank C', 'Bank D', 'Bank E', 'Bank F'];
  first.loungeInput(input('supportedBanksInput', ' Bank A\nBank B,Bank C，Bank D、Bank E;Bank F；Bank A\n\n'));
  assert.equal(first.data.draft.lounges.length, 0);
  first.commitLounge();
  assert.deepEqual(first.data.draft.lounges[0].supportedBanks, expected);
  assert.equal(Object.hasOwn(first.data.draft.lounges[0], 'supportedBanksInput'), false);
  assert.deepEqual(env.draft().value.draft.lounges[0].supportedBanks, expected);
  assert.ok(first.data.loungeRows[0].banks.includes('Bank A'));
  first.onUnload(); const second = await env.create();
  assert.deepEqual(second.data.draft.lounges[0].supportedBanks, expected);
  second.openLounge(press(0));
  assert.equal(second.data.loungeDraft.supportedBanksInput, expected.join('\n'));
  await second.closeLounge(); await second.save();
  assert.deepEqual(env.commands[0].payload.draft.lounges[0].supportedBanks, expected);
  assert.equal(Object.hasOwn(env.commands[0].payload.draft.lounges[0], 'supportedBanksInput'), false);
});

test('bank edits remain in the sheet until committed and can clear the supported-bank list', async () => {
  const env = harness(); env.setRecord({ ...record(), lounges: [{ ...legacyLounge(), supportedBanks: ['Original Bank'] }] });
  const page = await env.create('ent-1'); page.openLounge(press(0));
  page.loungeInput(input('supportedBanksInput', 'Changed Bank')); await page.closeLounge();
  assert.deepEqual(page.data.draft.lounges[0].supportedBanks, ['Original Bank']);
  page.openLounge(press(0)); page.loungeInput(input('supportedBanksInput', '  \n，；')); page.commitLounge();
  assert.deepEqual(page.data.draft.lounges[0].supportedBanks, []);
  assert.deepEqual(env.draft('ent-1').value.draft.lounges[0].supportedBanks, []);
});

test('bank limits and server field paths focus the supported-bank textarea', async () => {
  const env = harness(); const page = await env.create(); page.openLounge(press()); fillLounge(page);
  const tooManyBanks = Array.from({ length: 31 }, (_, index) => `Bank ${index}`).join('\n');
  page.loungeInput(input('supportedBanksInput', tooManyBanks));
  page.commitLounge();
  assert.equal(page.data.draft.lounges.length, 0);
  assert.ok(page.data.loungeErrors.supportedBanksInput);
  assert.equal(page.data.loungeErrorSummary[0].field, 'supportedBanksInput');
  assert.equal(page.data.loungeScrollTarget, 'lounge-field-supportedBanksInput');
  page.loungeInput(input('supportedBanksInput', 'B'.repeat(121))); page.commitLounge();
  assert.ok(page.data.loungeErrors.supportedBanksInput);
  page.loungeInput(input('supportedBanksInput', Array.from({ length: 31 }, () => 'Same Bank').join('\n'))); page.commitLounge();
  assert.deepEqual(page.data.draft.lounges[0].supportedBanks, ['Same Bank']);
  page.showErrors({ 'lounges.0.supportedBanks.1': 'Invalid bank name' });
  assert.equal(page.data.loungeVisible, true);
  assert.equal(page.data.loungeFocus, 'supportedBanksInput');
  assert.equal(page.data.loungeScrollTarget, 'lounge-field-supportedBanksInput');
  assert.equal(page.data.loungeErrors.supportedBanksInput, 'Invalid bank name');
  assert.equal(page.data.loungeErrorSummary[0].field, 'supportedBanksInput');
});

test('legacy lounge records keep omitted supported-bank data until explicit lounge commitment', async () => {
  const env = harness(); env.setRecord({ ...record(), lounges: [legacyLounge()] });
  const page = await env.create('ent-1');
  assert.equal(Object.hasOwn(page.data.draft.lounges[0], 'supportedBanks'), false);
  page.openLounge(press(0));
  assert.equal(page.data.loungeDraft.supportedBanksInput, '');
  await page.closeLounge(); page.input(input('title', 'Updated title')); await page.save();
  assert.equal(Object.hasOwn(env.commands[0].payload.draft.lounges[0], 'supportedBanks'), false);
});

test('legacy pending creation preserves the exact body and intent without adding supported-bank defaults', async () => {
  const env = harness(); const first = await env.create(); fill(first);
  first.data.draft.lounges = [legacyLounge()]; first.refreshDerived(); first.persistDraft();
  env.setHandler(async () => { throw Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' }); });
  await first.save();
  const sent = structuredClone(env.commands[0]);
  assert.equal(Object.hasOwn(sent.payload.draft.lounges[0], 'supportedBanks'), false);
  for (const field of ['description', 'pointsBalance', 'loungeProgram']) assert.equal(Object.hasOwn(sent.payload.draft, field), false);
  first.onUnload(); const second = await env.create();
  assert.equal(second.data.pending, true);
  assert.equal(Object.hasOwn(second.data.draft.lounges[0], 'supportedBanks'), false);
  for (const field of ['description', 'pointsBalance', 'loungeProgram']) assert.equal(Object.hasOwn(second.data.draft, field), false);
  assert.deepEqual(env.draft().value.pending.payload, sent.payload);
  env.setHandler(async () => ({ id: 'ent-created', version: 1 })); await second.save();
  assert.deepEqual(env.commands[1], sent);
  assert.equal(Object.hasOwn(env.commands[1].payload.draft.lounges[0], 'supportedBanks'), false);
  for (const field of ['description', 'pointsBalance', 'loungeProgram']) assert.equal(Object.hasOwn(env.commands[1].payload.draft, field), false);
});

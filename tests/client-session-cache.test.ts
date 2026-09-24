import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { Actor, ApiRequest, Session } from '../shared/contracts';
import { banks } from '../shared/catalog';
import { MemoryStore } from '../domain/memory-store';
import { createService, DomainError } from '../domain/service';
import * as calendar from '../domain/calendar';

type Client = Pick<typeof import('../miniprogram/services/api'), 'api' | 'ensureSession' | 'setDemoRole'>;
type ReadPlan = { computed: (result: Session) => void; release?: Promise<void>; failure?: Error };
type RecordedRequest = { request: ApiRequest; actor: Actor; result?: unknown };
const compiled = new Map<string, string>();

function source(file: string): string {
  const existing = compiled.get(file);
  if (existing !== undefined) return existing;
  const javascript = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  compiled.set(file, javascript);
  return javascript;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function hasCode(code: string) {
  return (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function observe(promise: Promise<Session>) {
  return promise.then(result => ({ ok: true as const, result }), error => ({ ok: false as const, error }));
}

function harness(mode: 'demo' | 'cloud' = 'demo') {
  let cacheTime = 0;
  let serviceTime = new Date('2026-09-20T04:00:00.000Z');
  const settings = { mode, cloudEnvId: 'session-cache-test', apiFunctionName: 'api',
    templateIds: { new_activity: '', deadline: '', reward: '', repayment: '' }, webViewEnabled: false, allowedWebViewHosts: [] };
  const plans: ReadPlan[] = [];
  const requests: RecordedRequest[] = [];
  const storage = new Map<string, unknown>([['card-benefits.native.demo.v1', { version: 1, seed: {} }]]);
  const cloudActor: Actor = { userId: 'cloud-session-user', isModerator: false };
  class ControlledDate extends Date {
    constructor(value?: string | number) { super(value === undefined ? cacheTime : value); }
    static now(): number { return cacheTime; }
  }

  function wrappedService(store: MemoryStore, options: Parameters<typeof createService>[1] = {}) {
    const service = createService(store, { ...options, now: () => new Date(serviceTime.getTime()) });
    return {
      async execute(actor: Actor, request: ApiRequest): Promise<unknown> {
        const capturedActor = { ...actor };
        const capturedRequest = structuredClone(request);
        const plan = request.action === 'session.get' ? plans.shift() : undefined;
        const entry: RecordedRequest = { request: capturedRequest, actor: capturedActor };
        requests.push(entry);
        const result = await service.execute(capturedActor, capturedRequest);
        entry.result = structuredClone(result);
        if (plan) {
          plan.computed(structuredClone(result) as Session);
          if (plan.release) await plan.release;
          if (plan.failure) throw plan.failure;
        }
        return result;
      },
    };
  }

  const cloudService = wrappedService(new MemoryStore());
  const wx = {
    getStorageSync: (key: string) => storage.has(key) ? structuredClone(storage.get(key)) : undefined,
    setStorageSync: (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
    cloud: {
      init() {},
      callFunction: async ({ data }: { data: ApiRequest }) => {
        try { return { result: { ok: true, data: await cloudService.execute(cloudActor, data) } }; }
        catch (error) {
          if (error instanceof DomainError) return { result: { ok: false, error: { code: error.code, message: error.message, field: error.field } } };
          throw error;
        }
      },
    },
  };

  function evaluate(file: string, imports: Record<string, unknown>): Record<string, any> {
    const exports: Record<string, any> = {};
    vm.runInNewContext(source(file), {
      exports, wx, Date: ControlledDate,
      require(name: string) {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name} in ${file}`);
        return imports[name];
      },
    }, { filename: file });
    return exports;
  }

  const demo = evaluate('miniprogram/services/demo.ts', {
    '../../shared/catalog': { banks }, '../../domain/memory-store': { MemoryStore },
    '../../domain/service': { createService: wrappedService }, '../../domain/calendar': calendar,
  });
  const client = evaluate('miniprogram/services/api.ts', {
    '../runtime-config': { default: settings }, './demo': demo,
    './entrance': { entranceBehavior() { assert.fail('Session tests must not open an entrance.'); } },
  }) as Client;

  function holdNextSession() {
    const computed = deferred<Session>();
    const release = deferred<void>();
    plans.push({ computed: computed.resolve, release: release.promise });
    return { computed: computed.promise, release: () => release.resolve() };
  }

  function failNextSession(): Error {
    const error = new Error('Session response unavailable after its result was computed');
    plans.push({ computed() {}, failure: error });
    return error;
  }

  return {
    client, demoActor: demo.demoActor as Actor, cloudActor, requests, holdNextSession, failNextSession,
    setCacheTime: (value: number) => { cacheTime = value; },
    setServiceDate: (value: string) => { serviceTime = new Date(`${value}T04:00:00.000Z`); },
    readCount: () => requests.filter(entry => entry.request.action === 'session.get').length,
  };
}

test('a late moderator result reaches its original caller without replacing the current user session or granting moderation', { timeout: 10_000 }, async () => {
  const env = harness();
  await env.client.setDemoRole('moderator');
  const held = env.holdNextSession();
  const oldRead = env.client.ensureSession(true);
  const settled = observe(oldRead);
  try {
    assert.equal((await held.computed).isModerator, true);
    await env.client.setDemoRole('user');
    const current = await env.client.ensureSession(true);
    assert.equal(current.isModerator, false);
    held.release();
    assert.equal((await oldRead).isModerator, true);
    assert.equal(await env.client.ensureSession(), current);
    assert.equal(env.readCount(), 2);
    await assert.rejects(env.client.api.query('submissions.list', { moderation: true }), hasCode('FORBIDDEN'));
    assert.equal(env.demoActor.isModerator, false);
  } finally { held.release(); await settled; }
});

test('clearing the role prevents an earlier response from seeding an empty cache even before a new read starts', { timeout: 10_000 }, async () => {
  const env = harness();
  await env.client.setDemoRole('moderator');
  const held = env.holdNextSession();
  const oldRead = env.client.ensureSession(true);
  const settled = observe(oldRead);
  try {
    assert.equal((await held.computed).isModerator, true);
    await env.client.setDemoRole('user');
    held.release();
    assert.equal((await oldRead).isModerator, true);
    assert.equal(env.readCount(), 1);

    const current = await env.client.ensureSession();
    assert.equal(current.isModerator, false);
    assert.equal(env.readCount(), 2, 'The old generation must not populate the cleared cache.');
    assert.equal(await env.client.ensureSession(), current);
    assert.equal(env.readCount(), 2);
  } finally { held.release(); await settled; }
});

test('setting the same demo role also invalidates a pending response and requires a fresh read', { timeout: 10_000 }, async () => {
  const env = harness();
  assert.equal(env.demoActor.isModerator, false);
  const held = env.holdNextSession();
  const oldRead = env.client.ensureSession(true);
  const settled = observe(oldRead);
  try {
    assert.equal((await held.computed).today, '2026-09-20');
    await env.client.setDemoRole('user');
    env.setServiceDate('2026-09-21');
    held.release();
    assert.equal((await oldRead).today, '2026-09-20');
    const current = await env.client.ensureSession();
    assert.equal(current.today, '2026-09-21');
    assert.equal(current.isModerator, false);
    assert.equal(env.readCount(), 2);
    assert.equal(await env.client.ensureSession(), current);
  } finally { held.release(); await settled; }
});

test('two forced reads completed in reverse order retain their own results while only the newest read owns the cache', { timeout: 10_000 }, async () => {
  const env = harness();
  const firstHeld = env.holdNextSession();
  const first = env.client.ensureSession(true);
  const firstSettled = observe(first);
  let secondSettled: ReturnType<typeof observe> | undefined;
  let secondHeld: ReturnType<typeof env.holdNextSession> | undefined;
  try {
    assert.equal((await firstHeld.computed).today, '2026-09-20');
    env.setServiceDate('2026-09-21');
    secondHeld = env.holdNextSession();
    const second = env.client.ensureSession(true);
    secondSettled = observe(second);
    assert.equal((await secondHeld.computed).today, '2026-09-21');
    secondHeld.release();
    const latest = await second;
    assert.equal(latest.today, '2026-09-21');
    firstHeld.release();
    assert.equal((await first).today, '2026-09-20');
    assert.equal(await env.client.ensureSession(), latest);
    assert.equal(env.readCount(), 2);
  } finally {
    firstHeld.release(); secondHeld?.release();
    await firstSettled;
    if (secondSettled) await secondSettled;
  }
});

test('a failed newest read retains an existing fresh cache and a late older response cannot replace it or extend its expiry', { timeout: 10_000 }, async () => {
  const env = harness();
  const cached = await env.client.ensureSession();
  assert.equal(cached.today, '2026-09-20');
  env.setCacheTime(100);
  env.setServiceDate('2026-09-21');
  const held = env.holdNextSession();
  const older = env.client.ensureSession(true);
  const settled = observe(older);
  try {
    assert.equal((await held.computed).today, '2026-09-21');
    env.setCacheTime(200);
    env.setServiceDate('2026-09-22');
    env.failNextSession();
    await assert.rejects(env.client.ensureSession(true), hasCode('NETWORK_ERROR'));
    assert.equal(await env.client.ensureSession(), cached);
    assert.equal(env.readCount(), 3);

    env.setCacheTime(29_999);
    held.release();
    assert.equal((await older).today, '2026-09-21');
    assert.equal(await env.client.ensureSession(), cached);
    assert.equal(env.readCount(), 3);
    env.setCacheTime(30_000);
    env.setServiceDate('2026-09-23');
    const refreshed = await env.client.ensureSession();
    assert.equal(refreshed.today, '2026-09-23');
    assert.equal(env.readCount(), 4, 'Neither a failed refresh nor an ignored response may renew the old cache timestamp.');
  } finally { held.release(); await settled; }
});

test('a failed newest read leaves an empty cache empty when an older response arrives afterward', { timeout: 10_000 }, async () => {
  const env = harness();
  const held = env.holdNextSession();
  const older = env.client.ensureSession(true);
  const settled = observe(older);
  try {
    assert.equal((await held.computed).today, '2026-09-20');
    env.setServiceDate('2026-09-21');
    env.failNextSession();
    await assert.rejects(env.client.ensureSession(true), hasCode('NETWORK_ERROR'));
    held.release();
    assert.equal((await older).today, '2026-09-20');
    assert.equal(env.readCount(), 2);

    env.setServiceDate('2026-09-22');
    const current = await env.client.ensureSession();
    assert.equal(current.today, '2026-09-22');
    assert.equal(env.readCount(), 3);
    assert.equal(await env.client.ensureSession(), current);
    assert.equal(env.readCount(), 3);
  } finally { held.release(); await settled; }
});

test('a forbidden cloud role change preserves the actor, fresh cache, and eligibility of an already pending read', { timeout: 10_000 }, async () => {
  const env = harness('cloud');
  const actorBefore = structuredClone(env.demoActor);
  const cloudActorBefore = structuredClone(env.cloudActor);
  const cached = await env.client.ensureSession();
  assert.equal(cached.demo, false);
  env.setServiceDate('2026-09-21');
  const held = env.holdNextSession();
  const pending = env.client.ensureSession(true);
  const settled = observe(pending);
  try {
    assert.equal((await held.computed).today, '2026-09-21');
    await assert.rejects(env.client.setDemoRole('moderator'), hasCode('FORBIDDEN'));
    assert.deepEqual(structuredClone(env.demoActor), actorBefore);
    assert.deepEqual(env.cloudActor, cloudActorBefore);
    assert.equal(await env.client.ensureSession(), cached);
    assert.equal(env.readCount(), 2, 'Rejected role switching must not clear the existing cloud cache.');
    held.release();
    const current = await pending;
    assert.equal(current.today, '2026-09-21');
    assert.equal(await env.client.ensureSession(), current, 'Rejected role switching must not invalidate a valid in-flight read.');
    assert.equal(env.readCount(), 2);
  } finally { held.release(); await settled; }
});

test('the thirty-second boundary and forced refresh preserve cache hits without changing the pending read owner', { timeout: 10_000 }, async () => {
  const env = harness();
  const initial = await env.client.ensureSession();
  env.setServiceDate('2026-09-21');
  env.setCacheTime(29_999);
  assert.equal(await env.client.ensureSession(), initial);
  assert.equal(env.readCount(), 1);
  env.setCacheTime(30_000);
  const refreshed = await env.client.ensureSession();
  assert.equal(refreshed.today, '2026-09-21');
  assert.equal(env.readCount(), 2);

  env.setCacheTime(30_001);
  env.setServiceDate('2026-09-22');
  const held = env.holdNextSession();
  const forced = env.client.ensureSession(true);
  const settled = observe(forced);
  try {
    assert.equal((await held.computed).today, '2026-09-22');
    assert.equal(env.readCount(), 3, 'A forced call must bypass a one-millisecond-old cache.');
    assert.equal(await env.client.ensureSession(), refreshed);
    assert.equal(await env.client.ensureSession(), refreshed);
    assert.equal(env.readCount(), 3);
    env.setCacheTime(30_002);
    held.release();
    const current = await forced;
    assert.equal(current.today, '2026-09-22');
    assert.equal(await env.client.ensureSession(), current, 'Serving the prior cache must not supersede a pending forced read.');
    assert.equal(env.readCount(), 3);
  } finally { held.release(); await settled; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get as httpsGet } from 'node:https';
import { CloudDatabase, CloudDocument, CloudQuery, CloudStore } from '../cloudfunctions/shared/cloud-store';
import { CloudStorage, createAssetValidator, downloadBoundedImage } from '../cloudfunctions/shared/assets';
import { createApiHandler } from '../cloudfunctions/api/handler';
import { MemorySeed, MemoryStore } from '../domain/memory-store';
import { Collection, Condition, FindOptions, Store } from '../domain/store';

function databaseFixture(seed: MemorySeed = {}) {
  const backing = new MemoryStore(seed);
  const calls: { operation: string; value: unknown; transaction: boolean }[] = [];
  const transactionSizes: number[] = [];
  let transactionCount = 0;
  const command = Object.fromEntries(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'and'].map(name => [name, (value: unknown) => ({ [name]: value })]));
  function document(source: Store, name: Collection, id: string, transaction: boolean): CloudDocument {
    return {
      async get() { if (transaction) transactionCount += 1; const value = await source.get<Record<string, unknown>>(name, id); return { data: value ? { ...value, _id: id, _openid: 'metadata' } : null }; },
      async set(input) { if (transaction) transactionCount += 1; await source.set(name, id, input.data); },
      async remove() { if (transaction) transactionCount += 1; await source.remove(name, id); },
    };
  }
  function parse(value: any): Condition[] {
    if (value.and) return value.and.flatMap(parse);
    return Object.entries(value).flatMap(([field, operations]) => Object.entries(operations as object).map(([op, item]) => ({ field, op: (op === 'neq' ? 'ne' : op) as Condition['op'], value: item })));
  }
  function collection(name: Collection): CloudQuery {
    const options: FindOptions = {};
    const query: CloudQuery = {
      where(value) { options.where = parse(value); calls.push({ operation: 'where', value, transaction: false }); return query; },
      orderBy(field, direction) { if (field !== '_id') (options.orderBy ||= []).push({ field, direction }); return query; },
      skip(value) { options.offset = value; return query; },
      limit(value) { options.limit = value; return query; },
      async get() { calls.push({ operation: 'get', value: [options.offset, options.limit], transaction: false }); return { data: (await backing.find<Record<string, unknown>>(name, options)).map(value => ({ ...value, _id: value.id || value.ownerId, _openid: 'metadata' })) }; },
      doc(id) { return document(backing, name, id, false); },
    };
    return query;
  }
  const database: CloudDatabase = { collection: name => collection(name as Collection), command, async runTransaction(callback) {
    return backing.transaction(async source => {
      transactionCount = 0;
      const result = await callback({ collection: name => ({ doc: id => document(source, name as Collection, id, true) }) });
      transactionSizes.push(transactionCount);
      return result;
    });
  } };
  return { database, backing, calls, transactionSizes };
}

test('CloudStore scans outside SDK transactions and only commits documented single-document operations', async () => {
  const fixture = databaseFixture({ rewards: Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`r-${index}`, { id: `r-${index}`, ownerId: 'user', amount: 9 }])) });
  const store = new CloudStore(fixture.database);
  const result = await store.transaction(transaction => transaction.find<{ id: string }>('rewards', {
    where: [{ field: 'ownerId', op: 'eq', value: 'user' }, { field: 'amount', op: 'gte', value: 1 }, { field: 'amount', op: 'lt', value: 20 }],
    orderBy: [{ field: 'receivedOn', direction: 'desc' }],
  }));
  assert.equal(result.length, 205);
  assert.equal(fixture.calls.every(call => !call.transaction), true);
  assert.deepEqual(fixture.transactionSizes, []);
  assert.deepEqual(fixture.calls.filter(call => call.operation === 'get').map(call => call.value), [[0, 100], [100, 100], [200, 100]]);
  assert.deepEqual(fixture.calls.find(call => call.operation === 'where')?.value, { and: [{ ownerId: { eq: 'user' } }, { amount: { gte: 1 } }, { amount: { lt: 20 } }] });
});

test('CloudStore preserves explicit limits and treats missing records as null', async () => {
  const fixture = databaseFixture({ cards: { one: { id: 'one', amount: 9 }, ...Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`c-${index}`, { id: `c-${index}` }])) } });
  const store = new CloudStore(fixture.database);
  assert.equal(await store.get('cards', 'missing'), null);
  assert.deepEqual(await store.get('cards', 'one'), { id: 'one', amount: 9 });
  assert.equal((await store.find('cards', { offset: 10, limit: 101 })).length, 101);
  await store.set('cards', 'one', { id: 'one', omitted: undefined, nested: { empty: undefined, value: 1 }, _id: 'untrusted' });
  assert.deepEqual(await fixture.backing.get('cards', 'one'), { id: 'one', nested: { value: 1 } });
  assert.deepEqual(fixture.transactionSizes, [3]);
});

test('planning reads include staged creations, changes and deletions before commit', async () => {
  const fixture = databaseFixture({ requests: { a: { id: 'a', ownerId: 'one', value: 1 }, b: { id: 'b', ownerId: 'one', value: 3 } } });
  const store = new CloudStore(fixture.database);
  await store.transaction(async transaction => {
    await transaction.remove('requests', 'a');
    await transaction.set('requests', 'b', { id: 'b', ownerId: 'two', value: 2 });
    await transaction.set('requests', 'c', { id: 'c', ownerId: 'one', value: 4 });
    assert.equal(await transaction.get('requests', 'a'), null);
    assert.deepEqual(await transaction.find('requests', { where: [{ field: 'ownerId', op: 'eq', value: 'one' }], limit: 1 }), [{ id: 'c', ownerId: 'one', value: 4 }]);
  });
  assert.deepEqual(fixture.transactionSizes, [5]);
});

test('concurrent epoch changes replan updates without lost writes', async () => {
  const fixture = databaseFixture({ requests: { counter: { id: 'counter', value: 0 } } });
  const store = new CloudStore(fixture.database);
  let plans = 0;
  await Promise.all(Array.from({ length: 4 }, () => store.transaction(async transaction => {
    plans += 1;
    const current = await transaction.get<{ id: string; value: number }>('requests', 'counter');
    await transaction.set('requests', 'counter', { ...current, value: current!.value + 1 });
  })));
  assert.equal((await store.get<{ value: number }>('requests', 'counter'))?.value, 4);
  assert.ok(plans > 4);
  assert.equal(fixture.transactionSizes.every(size => size === 3), true);
});

test('oversized write plans fail before the SDK transaction and leave no partial data', async () => {
  const fixture = databaseFixture();
  const store = new CloudStore(fixture.database);
  await assert.rejects(store.transaction(async transaction => {
    for (let index = 0; index < 99; index += 1) await transaction.set('cards', `c-${index}`, { id: `c-${index}` });
  }), (error: any) => error.code === 'TRANSACTION_LIMIT');
  assert.equal((await store.find('cards')).length, 0);
  assert.equal(fixture.transactionSizes.length, 0);
});

test('read-only plans retry when the global epoch changes during a scan', async () => {
  const fixture = databaseFixture({ requests: { counter: { id: 'counter', value: 0 } } });
  const store = new CloudStore(fixture.database);
  let plans = 0;
  const result = await store.transaction(async transaction => {
    const value = await transaction.get<{ value: number }>('requests', 'counter');
    if (plans++ === 0) await store.set('requests', 'counter', { id: 'counter', value: 1 });
    return value?.value;
  });
  assert.equal(result, 1);
  assert.equal(plans, 2);
});

function storageFixture(content = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])) {
  const uploads: { cloudPath: string; fileContent: Buffer }[] = [];
  let downloads = 0;
  const storage: CloudStorage = {
    async uploadFile(input) { uploads.push(input); return { fileID: `cloud://env-123.bucket/${input.cloudPath}` }; },
    async getTempFileURL(input) { return { fileList: input.fileList.map(item => ({ fileID: item.fileID, status: 0, tempFileURL: 'https://signed.example.invalid/file' })) }; },
  };
  return { content, storage, uploads, download: async () => { downloads += 1; return content; }, getDownloads: () => downloads };
}

test('image verification rejects forged environment and paths before reading cloud storage', async () => {
  const fixture = storageFixture();
  const validator = createAssetValidator(fixture.storage, 'env-123', fixture.download);
  const actor = { userId: 'owner', isModerator: false };
  const input = { id: 'asset-1', fileId: 'cloud://other-env.bucket/uploads/owner/asset-1.png', cloudPath: 'uploads/owner/asset-1.png', size: fixture.content.length, mime: 'image/png' };
  await assert.rejects(validator(actor, input));
  await assert.rejects(validator(actor, { ...input, fileId: 'cloud://env-123.bucket/uploads/someone/asset-1.png', cloudPath: 'uploads/someone/asset-1.png' }));
  assert.equal(fixture.getDownloads(), 0);
});

test('image validation seals exactly the verified bytes at a content-addressed path', async () => {
  const fixture = storageFixture();
  const validator = createAssetValidator(fixture.storage, 'env-123', fixture.download);
  const input = { id: 'asset-1', fileId: 'cloud://env-123.bucket/uploads/owner/asset-1.png', cloudPath: 'uploads/owner/asset-1.png', size: fixture.content.length, mime: 'image/png' };
  const result = await validator({ userId: 'owner', isModerator: false }, input);
  assert.match(result.cloudPath, /^sealed\/owner\/asset-1\/[a-f0-9]{64}\.png$/);
  assert.equal(fixture.uploads[0].fileContent, fixture.content);
  assert.equal((await validator({ userId: 'owner', isModerator: false }, input)).fileId, result.fileId);
  await assert.rejects(validator({ userId: 'owner', isModerator: false }, { ...input, size: 1 }));
  const text = storageFixture(Buffer.from('<script>alert(1)</script>'));
  await assert.rejects(createAssetValidator(text.storage, 'env-123', text.download)({ userId: 'owner', isModerator: false }, { ...input, size: text.content.length }));
  assert.equal(text.uploads.length, 0);
});

test('streaming image reads stop at the byte cap even when content length is omitted', async () => {
  let destroyed = false;
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy() { destroyed = true; } });
  const request = Object.assign(new EventEmitter(), { destroy() { destroyed = true; return request; } });
  const factory = ((_url: unknown, _options: unknown, callback: (value: unknown) => void) => {
    queueMicrotask(() => {
      callback(response);
      response.emit('data', Buffer.alloc(5 * 1024 * 1024));
      response.emit('data', Buffer.from([1]));
    });
    return request;
  }) as unknown as typeof httpsGet;
  await assert.rejects(downloadBoundedImage('https://signed.example.invalid/image', factory), (error: any) => error.code === 'INVALID_ASSET');
  assert.equal(destroyed, true);
});

test('API ignores payload roles, rejects missing trusted identity, and hides infrastructure failures', async () => {
  const storage = storageFixture().storage;
  const store = new MemoryStore();
  const handler = createApiHandler({ store, storage, context: () => ({ OPENID: 'ordinary', SOURCE: 'wx_client' }), moderatorOpenIds: ['operator'] });
  const session = await handler({ action: 'session.get', payload: {}, actor: { userId: 'operator', isModerator: true } });
  assert.equal(session.ok, true);
  if (session.ok) assert.equal((session.data as { isModerator: boolean }).isModerator, false);
  const forbidden = await handler({ action: 'submissions.list', payload: { moderation: true }, isModerator: true });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.error.code, 'FORBIDDEN');
  const unauthenticated = createApiHandler({ store, storage, context: () => ({}), moderatorOpenIds: [] });
  assert.equal((await unauthenticated({ action: 'session.get', payload: {} })).ok, false);
  store.transaction = async () => { throw new Error('secret token and database stack'); };
  const failure = await handler({ action: 'session.get', payload: {} });
  assert.deepEqual(failure, { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } });
});

test('asset URLs are granted only after domain authorization', async () => {
  const storage = storageFixture().storage;
  const store = new MemoryStore({ assets: { private: { id: 'private', ownerId: 'owner', fileId: 'cloud://env.bucket/sealed/private.png', cloudPath: 'sealed/private.png', size: 10, mime: 'image/png', status: 'pending', createdAt: '2026-09-20' } } });
  const foreign = createApiHandler({ store, storage, context: () => ({ OPENID: 'stranger', SOURCE: 'wx_client' }), moderatorOpenIds: [] });
  const own = createApiHandler({ store, storage, context: () => ({ OPENID: 'owner', SOURCE: 'wx_client' }), moderatorOpenIds: [] });
  assert.deepEqual(await foreign({ action: 'assets.urls', payload: { ids: ['private'] } }), { ok: false, error: { code: 'NOT_FOUND', message: '图片不存在或无权访问' } });
  assert.deepEqual(await own({ action: 'assets.urls', payload: { ids: ['private'] } }), { ok: true, data: [{ id: 'private', url: 'https://signed.example.invalid/file' }] });
});

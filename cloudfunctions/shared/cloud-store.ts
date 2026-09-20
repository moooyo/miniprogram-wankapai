import { isDeepStrictEqual } from 'node:util';
import { DomainError } from '../../domain/errors';
import { Collection, Condition, FindOptions, Store } from '../../domain/store';

export interface CloudDocument {
  get(): Promise<{ data: unknown; code?: string }>;
  set(value: { data: unknown }): Promise<unknown>;
  remove(): Promise<unknown>;
}
export interface CloudQuery {
  where(value: unknown): CloudQuery;
  orderBy(field: string, direction: 'asc' | 'desc'): CloudQuery;
  skip(value: number): CloudQuery;
  limit(value: number): CloudQuery;
  get(): Promise<{ data: unknown[]; code?: string }>;
  doc(id: string): CloudDocument;
}
export interface CloudTransaction {
  collection(name: string): { doc(id: string): CloudDocument };
}
export interface CloudDatabase {
  collection(name: string): CloudQuery;
  command: Record<string, (...args: any[]) => unknown>;
  runTransaction<T>(callback: (transaction: CloudTransaction) => Promise<T>): Promise<T>;
}

const epochId = '__cloud_store_epoch_v1';
const maxWrites = 98;
type Row = { id: string; value: unknown };
type Change = { collection: Collection; id: string; remove: boolean; value?: unknown };
class PlanChanged extends Error {}

function withoutMetadata<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value as T;
  const { _id, _openid, ...data } = value as Record<string, unknown>;
  return data as T;
}
function serializable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined && key !== '_id' && key !== '_openid').map(([key, item]) => [key, serializable(item)]));
  return value;
}
function field(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function compare(left: unknown, right: unknown): number {
  if (isDeepStrictEqual(left, right)) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  return String(left) < String(right) ? -1 : 1;
}
function matches(value: unknown, condition: Condition): boolean {
  const actual = field(value, condition.field);
  switch (condition.op) {
    case 'eq': return isDeepStrictEqual(actual, condition.value);
    case 'ne': return !isDeepStrictEqual(actual, condition.value);
    case 'in': return Array.isArray(condition.value) && condition.value.some(item => isDeepStrictEqual(actual, item));
    case 'lt': return actual !== undefined && actual !== null && compare(actual, condition.value) < 0;
    case 'lte': return actual !== undefined && actual !== null && compare(actual, condition.value) <= 0;
    case 'gt': return actual !== undefined && actual !== null && compare(actual, condition.value) > 0;
    case 'gte': return actual !== undefined && actual !== null && compare(actual, condition.value) >= 0;
  }
}
function epoch(value: unknown): number {
  if (!value) return 0;
  const version = (value as { version?: unknown }).version;
  if (!Number.isSafeInteger(version) || Number(version) < 0 || Number(version) >= Number.MAX_SAFE_INTEGER) throw new DomainError('STORE_UNAVAILABLE', '数据服务暂不可用');
  return Number(version);
}

class PlanningStore implements Store {
  readonly changes = new Map<string, Change>();
  constructor(private readonly source: CloudStore) {}
  private key(collection: Collection, id: string): string { return `${collection}\u0000${id}`; }
  async get<T>(collection: Collection, id: string): Promise<T | null> {
    const change = this.changes.get(this.key(collection, id));
    if (change) return change.remove ? null : structuredClone(change.value) as T;
    return this.source.get<T>(collection, id);
  }
  async find<T>(collection: Collection, options: FindOptions = {}): Promise<T[]> {
    const rows = new Map((await this.source.scan(collection, { where: options.where })).map(row => [row.id, row.value]));
    for (const change of this.changes.values()) {
      if (change.collection !== collection) continue;
      if (change.remove) rows.delete(change.id);
      else rows.set(change.id, change.value);
    }
    const selected = Array.from(rows.entries()).filter(([, value]) => (options.where || []).every(condition => matches(value, condition)));
    selected.sort(([leftId, left], [rightId, right]) => {
      for (const order of options.orderBy || []) {
        const result = compare(field(left, order.field), field(right, order.field));
        if (result) return order.direction === 'desc' ? -result : result;
      }
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    const offset = options.offset || 0;
    return selected.slice(offset, options.limit === undefined ? undefined : offset + options.limit).map(([, value]) => structuredClone(value) as T);
  }
  async set<T>(collection: Collection, id: string, value: T): Promise<void> {
    this.changes.set(this.key(collection, id), { collection, id, remove: false, value: serializable(value) });
    if (this.changes.size > maxWrites) throw new DomainError('TRANSACTION_LIMIT', '本次修改数量过多，请分批处理');
  }
  async remove(collection: Collection, id: string): Promise<void> {
    this.changes.set(this.key(collection, id), { collection, id, remove: true });
    if (this.changes.size > maxWrites) throw new DomainError('TRANSACTION_LIMIT', '本次修改数量过多，请分批处理');
  }
  async transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
    const previous = new Map(this.changes);
    try { return await callback(this); }
    catch (error) { this.changes.clear(); for (const [key, change] of previous) this.changes.set(key, change); throw error; }
  }
}

export class CloudStore implements Store {
  constructor(private readonly database: CloudDatabase) {}

  async get<T>(collection: Collection, id: string): Promise<T | null> {
    const result = await this.database.collection(collection).doc(id).get();
    if (result.code) throw new Error(`Database read failed: ${result.code}`);
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    return data ? withoutMetadata<T>(data) : null;
  }
  private condition(condition: Condition): Record<string, unknown> {
    const operator = { eq: 'eq', ne: 'neq', lt: 'lt', lte: 'lte', gt: 'gt', gte: 'gte', in: 'in' }[condition.op];
    return { [condition.field]: this.database.command[operator](condition.value) };
  }
  async scan(collection: Collection, options: FindOptions = {}): Promise<Row[]> {
    let query = this.database.collection(collection);
    if (options.where?.length) {
      const conditions = options.where.map(condition => this.condition(condition));
      query = query.where(conditions.length === 1 ? conditions[0] : this.database.command.and(conditions));
    }
    for (const order of options.orderBy || []) query = query.orderBy(order.field, order.direction);
    if (!options.orderBy?.some(order => order.field === '_id')) query = query.orderBy('_id', 'asc');
    const rows: Row[] = [];
    const limit = options.limit ?? Infinity;
    let offset = options.offset || 0;
    while (rows.length < limit) {
      const count = Math.min(100, limit - rows.length);
      const result = await query.skip(offset).limit(count).get();
      if (result.code) throw new Error(`Database query failed: ${result.code}`);
      rows.push(...result.data.map(value => ({ id: String((value as { _id: string })._id), value: withoutMetadata(value) })));
      if (result.data.length < count) break;
      offset += result.data.length;
    }
    return rows;
  }
  async find<T>(collection: Collection, options: FindOptions = {}): Promise<T[]> { return (await this.scan(collection, options)).map(row => row.value as T); }
  async set<T>(collection: Collection, id: string, value: T): Promise<void> { return this.transaction(store => store.set(collection, id, value)); }
  async remove(collection: Collection, id: string): Promise<void> { return this.transaction(store => store.remove(collection, id)); }

  async transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = epoch(await this.get('requests', epochId));
      const planning = new PlanningStore(this);
      const result = await callback(planning);
      if (!planning.changes.size) {
        if (epoch(await this.get('requests', epochId)) === before) return result;
        continue;
      }
      try {
        await this.database.runTransaction(async transaction => {
          const guard = transaction.collection('requests').doc(epochId);
          const existing = await guard.get();
          if (existing.code) throw new Error(`Database guard read failed: ${existing.code}`);
          if (epoch(Array.isArray(existing.data) ? existing.data[0] : existing.data) !== before) throw new PlanChanged();
          for (const change of planning.changes.values()) {
            const document = transaction.collection(change.collection).doc(change.id);
            if (change.remove) await document.remove();
            else await document.set({ data: change.value });
          }
          await guard.set({ data: { version: before + 1 } });
        });
        return result;
      } catch (error) {
        if (!(error instanceof PlanChanged)) throw error;
      }
    }
    throw new DomainError('CONFLICT', '记录正在更新，请稍后重试');
  }
}

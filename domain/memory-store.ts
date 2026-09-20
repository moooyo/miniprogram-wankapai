import { Collection, Condition, FindOptions, Store } from './store';

export type MemorySeed = Partial<Record<Collection, Record<string, unknown>>>;

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  const output: Record<string, unknown> = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(output, key, { value: clone((value as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true });
  }
  return output as T;
}

function fieldValue(value: unknown, path: string): unknown {
  let result = value;
  for (const part of path.split('.')) {
    if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, part)) return undefined;
    result = (result as Record<string, unknown>)[part];
  }
  return result;
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function compare(left: unknown, right: unknown): number {
  if (equal(left, right)) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left ? 1 : -1;
  return String(left) < String(right) ? -1 : 1;
}

function matches(value: unknown, condition: Condition): boolean {
  const actual = fieldValue(value, condition.field);
  switch (condition.op) {
    case 'eq': return equal(actual, condition.value);
    case 'ne': return !equal(actual, condition.value);
    case 'in': return Array.isArray(condition.value) && condition.value.some(item => equal(actual, item));
    case 'lt': return actual !== undefined && actual !== null && compare(actual, condition.value) < 0;
    case 'lte': return actual !== undefined && actual !== null && compare(actual, condition.value) <= 0;
    case 'gt': return actual !== undefined && actual !== null && compare(actual, condition.value) > 0;
    case 'gte': return actual !== undefined && actual !== null && compare(actual, condition.value) >= 0;
  }
}

export class MemoryStore implements Store {
  private data = new Map<Collection, Map<string, unknown>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(seed: MemorySeed = {}) {
    for (const collection of Object.keys(seed) as Collection[]) {
      const items = new Map<string, unknown>();
      for (const id of Object.keys(seed[collection] || {})) items.set(id, clone(seed[collection]![id]));
      this.data.set(collection, items);
    }
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private snapshot(): MemorySeed {
    const seed: MemorySeed = Object.create(null) as MemorySeed;
    this.data.forEach((items, collection) => {
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      items.forEach((value, id) => { output[id] = clone(value); });
      seed[collection] = output;
    });
    return seed;
  }

  get<T>(collection: Collection, id: string): Promise<T | null> {
    return this.serialize(() => {
      const items = this.data.get(collection);
      return items && items.has(id) ? clone(items.get(id)) as T : null;
    });
  }

  find<T>(collection: Collection, options: FindOptions = {}): Promise<T[]> {
    const query = clone(options);
    return this.serialize(() => {
      let rows = Array.from(this.data.get(collection)?.entries() || []);
      if (query.where) rows = rows.filter(([, value]) => query.where!.every(condition => matches(value, condition)));
      if (query.orderBy?.length) {
        rows.sort(([leftId, left], [rightId, right]) => {
          for (const order of query.orderBy!) {
            const result = compare(fieldValue(left, order.field), fieldValue(right, order.field));
            if (result !== 0) return order.direction === 'desc' ? -result : result;
          }
          return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
        });
      }
      const offset = Math.max(0, Math.floor(query.offset || 0));
      const limit = query.limit === undefined ? rows.length : Math.max(0, Math.floor(query.limit));
      return rows.slice(offset, offset + limit).map(([, value]) => clone(value) as T);
    });
  }

  set<T>(collection: Collection, id: string, value: T): Promise<void> {
    const copy = clone(value);
    return this.serialize(() => {
      if (!this.data.has(collection)) this.data.set(collection, new Map<string, unknown>());
      this.data.get(collection)!.set(id, copy);
    });
  }

  remove(collection: Collection, id: string): Promise<void> {
    return this.serialize(() => { this.data.get(collection)?.delete(id); });
  }

  transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const working = new MemoryStore(this.snapshot());
      const result = await callback(working);
      await working.queue;
      this.data = new MemoryStore(working.snapshot()).data;
      return result;
    });
  }

  exportSeed(): Promise<MemorySeed> { return this.serialize(() => this.snapshot()); }
}

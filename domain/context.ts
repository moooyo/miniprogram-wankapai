import { Actor, AuditEvent } from '../shared/contracts';
import { Collection, Store } from './store';
import { DomainError } from './errors';

export interface Context {
  store: Store;
  actor: Actor;
  today: string;
  now: string;
  newId(prefix: string): string;
  audit(entityId: string, action: string, before?: unknown, after?: unknown, ownerId?: string): Promise<void>;
  owned<T extends { ownerId: string }>(collection: Collection, id: string): Promise<T>;
}

export function createContext(store: Store, actor: Actor, today: string, now: string, newId: Context['newId']): Context {
  return {
    store, actor, today, now, newId,
    async owned<T extends { ownerId: string }>(collection: Collection, id: string): Promise<T> {
      if (typeof id !== 'string' || !id.length || id.length > 160) throw new DomainError('INVALID_INPUT', '记录标识无效');
      const row = await store.get<T>(collection, id);
      if (!row || row.ownerId !== actor.userId) throw new DomainError('NOT_FOUND', '未找到这条记录');
      return row;
    },
    async audit(entityId, action, before, after, ownerId = actor.userId) {
      const event: AuditEvent = { id: newId('audit'), ownerId, entityId, action, at: now };
      if (before !== undefined) event.before = before;
      if (after !== undefined) event.after = after;
      await store.set('audit_events', event.id, event);
    },
  };
}

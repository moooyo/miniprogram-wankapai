export type Collection = 'activities' | 'activity_revisions' | 'submissions' | 'cards' | 'billing_accounts' | 'bills' | 'trackings' | 'participations' | 'rewards' | 'assets' | 'audit_events' | 'preferences' | 'requests' | 'reminder_jobs' | 'reminder_grants';
export interface Condition { field: string; op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in'; value: unknown; }
export interface FindOptions { where?: Condition[]; orderBy?: { field: string; direction: 'asc' | 'desc' }[]; offset?: number; limit?: number; }
export interface Store {
  get<T>(collection: Collection, id: string): Promise<T | null>;
  find<T>(collection: Collection, options?: FindOptions): Promise<T[]>;
  set<T>(collection: Collection, id: string, value: T): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  transaction<T>(callback: (store: Store) => Promise<T>): Promise<T>;
}
export interface ServiceOptions {
  now?: () => Date;
  demo?: boolean;
  templateIds?: Partial<Record<import('../shared/contracts').ReminderJob['kind'], string>>;
  validateAsset?: (actor: import('../shared/contracts').Actor, payload: import('../shared/contracts').Commands['asset.register']) => Promise<void | Pick<import('../shared/contracts').Asset, 'fileId' | 'cloudPath' | 'size' | 'mime'>>;
}

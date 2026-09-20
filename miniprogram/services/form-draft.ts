export interface SavedFormDraft<T> {
  version: 1;
  ownerId: string;
  entityId: string;
  baseVersion: string | number | null;
  value: T;
  updatedAt: string;
  revision?: string;
}

const prefix = 'card-benefits.form-draft.v1';
let revisionSequence = 0;

function stableFingerprint(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableFingerprint).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + stableFingerprint(object[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

function revisionOf(saved: unknown): string | null {
  if (!saved) return null;
  const revision = typeof saved === 'object' && 'revision' in saved ? saved.revision : undefined;
  return typeof revision === 'string' && revision ? revision : 'legacy:' + stableFingerprint(saved);
}

export function draftKey(scope: string, userId: string, entityId: string): string {
  return [prefix, scope, userId, entityId].map(encodeURIComponent).join(':');
}

export function loadDraft<T>(scope: string, userId: string, entityId: string): SavedFormDraft<T> | null {
  if (!userId || !entityId) return null;
  try {
    const saved = wx.getStorageSync(draftKey(scope, userId, entityId)) as SavedFormDraft<T> | undefined;
    if (!saved || saved.version !== 1 || saved.ownerId !== userId || saved.entityId !== entityId
      || !saved.value || typeof saved.value !== 'object') return null;
    return saved;
  } catch { return null; }
}

export function saveDraft<T>(scope: string, userId: string, entityId: string, baseVersion: string | number | null, value: T): boolean {
  if (!userId || !entityId) return false;
  try {
    const revision = `${Date.now().toString(36)}-${(++revisionSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
    const saved: SavedFormDraft<T> = { version: 1, ownerId: userId, entityId, baseVersion, value, updatedAt: new Date().toISOString(), revision };
    wx.setStorageSync(draftKey(scope, userId, entityId), saved);
    return true;
  } catch { return false; }
}

export function getDraftRevision(scope: string, userId: string, entityId: string): string | null {
  const saved = loadDraft<unknown>(scope, userId, entityId);
  return revisionOf(saved);
}

export function removeDraft(scope: string, userId: string, entityId: string, expectedRevision?: string | null): void {
  if (!userId || !entityId) return;
  try {
    // Pending requests may only clear the draft that existed when they started.
    if (expectedRevision !== undefined
      && revisionOf(wx.getStorageSync(draftKey(scope, userId, entityId))) !== expectedRevision) return;
    wx.removeStorageSync(draftKey(scope, userId, entityId));
  } catch {}
}

export async function confirmDraftRecovery<T>(saved: SavedFormDraft<T>, currentBaseVersion: string | number | null): Promise<boolean> {
  const changed = saved.baseVersion !== currentBaseVersion;
  const result = await wx.showModal({
    title: '发现未保存的草稿',
    content: changed
      ? '这条记录已有更新。恢复只会取回上次填写的内容，不会自动保存；请与最新记录核对后再提交。'
      : '是否恢复上次未保存的填写内容？恢复后仍需由你确认保存。',
    confirmText: '恢复草稿',
    cancelText: '放弃草稿',
  });
  return !!result.confirm;
}

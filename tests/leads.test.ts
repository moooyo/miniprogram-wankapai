import test from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, ActivityDraft, ActivityItem, ActivityLead, Actor, ApiRequest, Asset, Commands, MutationResult, PageResult, Submission } from '../shared/contracts';
import { createService, DomainError } from '../domain/service';
import { MemoryStore } from '../domain/memory-store';
import { validateLead } from '../domain/validation';

const owner: Actor = { userId: 'lead-owner', isModerator: false };
const outsider: Actor = { userId: 'another-user', isModerator: false };
const moderator: Actor = { userId: 'lead-reviewer', isModerator: true };
const now = '2026-09-21T04:00:00.000Z';

function lead(overrides: Partial<ActivityLead> = {}): ActivityLead {
  return { title: 'A bank offer to verify', bankId: 'cmb', sourceUrl: 'https://www.cmbchina.com/', sourceNote: '', imageIds: [], ...overrides };
}
function completeDraft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  return { title: 'Verified bank offer', bankId: 'cmb', issuerIds: ['cmb-cn'], networks: ['visa'], cardKind: 'credit', cardDescription: 'Eligible Visa credit cards', frequency: 'monthly', startsOn: '2026-09-01', endsOn: '2026-12-31', target: 3, unit: '笔', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'card', requiresRegistration: true, requiresInvitation: false, conditions: 'Three eligible transactions per card each month', sourceUrl: 'https://www.cmbchina.com/', sourceNote: 'Verified official terms', entrance: { kind: 'guide', label: 'Bank app offer', instructions: 'Bank app > offers > registration', imageIds: [] }, ...overrides };
}
function fixture() {
  const store = new MemoryStore();
  let sealed = 0;
  const service = createService(store, { now: () => new Date(now), validateAsset: async (actor, payload) => {
    sealed += 1;
    return { fileId: `cloud://sealed/${actor.userId}/${payload.id}.png`, cloudPath: `sealed/${actor.userId}/${payload.id}.png`, size: payload.size, mime: payload.mime };
  } });
  let sequence = 0;
  const command = <K extends keyof Commands>(action: K, payload: Commands[K], actor = owner, requestId = `lead-request-${++sequence}`) => service.execute(actor, { action, payload, requestId } as ApiRequest) as Promise<MutationResult>;
  return {
    store, command,
    query: <T>(action: string, payload: unknown = {}, actor = owner) => service.execute(actor, { action, payload } as ApiRequest) as Promise<T>,
    register: (id: string, actor = owner) => command('asset.register', { id, fileId: `cloud://temporary/${id}`, cloudPath: `uploads/${actor.userId}/${id}.png`, size: 100, mime: 'image/png' }, actor),
    sealed: () => sealed,
  };
}
function code(expected: string) { return (error: unknown) => error instanceof DomainError && error.code === expected; }

test('a three-field lead is private and idempotent without inventing a complete activity draft', async () => {
  const f = fixture();
  const input = lead();
  const created = await f.command('submission.lead.save', { lead: input }, owner, 'same-lead-request');
  assert.deepEqual(await f.command('submission.lead.save', { lead: input }, owner, 'same-lead-request'), created);
  input.title = 'Caller mutation';
  const saved = await f.query<Submission>('submission.get', { id: created.id });
  assert.equal(saved.status, 'pending');
  assert.equal(saved.draft, null);
  assert.equal(saved.lead?.title, 'A bank offer to verify');
  assert.equal('target' in saved.lead!, false);
  assert.equal((await f.store.find('submissions')).length, 1);
  assert.equal((await f.store.find('activities')).length, 0);
  assert.equal((await f.query<PageResult<ActivityItem>>('catalog.list', {}, outsider)).items.length, 0);
  await assert.rejects(f.query('submission.get', { id: created.id }, outsider), code('NOT_FOUND'));
  assert.equal((await f.query<PageResult<Submission>>('submissions.list', { moderation: true }, moderator)).items[0].id, created.id);
});

test('lead validation accepts an explicit source but rejects missing, malformed, duplicate, or oversized input', () => {
  assert.equal(validateLead(lead({ sourceUrl: '', sourceNote: 'Bank app > offers' })).sourceNote, 'Bank app > offers');
  assert.deepEqual(validateLead(lead({ sourceUrl: '', imageIds: ['source-image'] })).imageIds, ['source-image']);
  for (const invalid of [
    lead({ title: '' }), lead({ title: 'x'.repeat(61) }), lead({ bankId: 'unknown' }), lead({ sourceUrl: '' }),
    lead({ sourceUrl: 'http://www.cmbchina.com/' }), lead({ sourceUrl: 'https://localhost/' }),
    lead({ sourceNote: 'x'.repeat(501) }), lead({ imageIds: ['repeat', 'repeat'] }),
    lead({ imageIds: Array.from({ length: 7 }, (_, index) => `image-${index}`) }),
  ]) assert.throws(() => validateLead(invalid), code('INVALID_INPUT'));
});

test('screenshot-only leads keep sealed source images private and enforce image ownership', async () => {
  const f = fixture();
  await f.register('source-image');
  const created = await f.command('submission.lead.save', { lead: lead({ sourceUrl: '', imageIds: ['source-image'] }) });
  assert.equal(f.sealed(), 1);
  const asset = (await f.store.get<Asset>('assets', 'source-image'))!;
  assert.equal(asset.fileId, 'cloud://sealed/lead-owner/source-image.png');
  assert.equal(asset.status, 'pending');
  assert.equal((await f.query<Asset[]>('assets.get', { ids: ['source-image'] }, moderator)).length, 1);
  await assert.rejects(f.query('assets.get', { ids: ['source-image'] }, outsider), code('NOT_FOUND'));
  await assert.rejects(f.command('submission.lead.save', { lead: lead({ sourceUrl: '', imageIds: ['source-image'] }) }, outsider), code('INVALID_ASSET'));
  await assert.rejects(f.command('submission.lead.save', { id: created.id, expectedVersion: created.version, lead: lead() }, outsider), code('NOT_FOUND'));
  await assert.rejects(f.command('submission.lead.save', { lead: lead({ imageIds: ['missing-image'] }) }), code('INVALID_ASSET'));
});

test('returning and resubmitting a lead preserve ownership, version checks, and the original source type', async () => {
  const f = fixture();
  const created = await f.command('submission.lead.save', { lead: lead() });
  await assert.rejects(f.command('submission.review', { id: created.id, decision: 'return', expectedVersion: created.version, reviewNote: 'Clarify the bank path' }), code('FORBIDDEN'));
  const returned = await f.command('submission.review', { id: created.id, decision: 'return', expectedVersion: created.version, reviewNote: 'Clarify the bank path' }, moderator);
  assert.equal((await f.query<Submission>('submission.get', { id: created.id })).draft, null);
  await assert.rejects(f.command('submission.lead.save', { id: created.id, lead: lead() }), code('VERSION_CONFLICT'));
  await assert.rejects(f.command('submission.lead.save', { id: created.id, expectedVersion: created.version, lead: lead() }), code('VERSION_CONFLICT'));
  const resubmitted = await f.command('submission.lead.save', { id: created.id, expectedVersion: returned.version, lead: lead({ sourceUrl: '', sourceNote: 'Bank app > credit cards > offers' }) });
  const saved = await f.query<Submission>('submission.get', { id: created.id });
  assert.equal(resubmitted.version, 3);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.reviewNote, '');
  assert.equal(saved.draft, null);
  assert.equal(saved.lead?.sourceNote, 'Bank app > credit cards > offers');
});

test('publishing a lead requires verified complete rules and atomically validates every chosen public image', async () => {
  const f = fixture();
  await f.register('owner-source');
  await f.register('unused-source');
  await f.register('foreign-image', outsider);
  await f.register('reviewer-image', moderator);
  const created = await f.command('submission.lead.save', { lead: lead({ imageIds: ['owner-source', 'unused-source'] }) });
  const base = { id: created.id, decision: 'publish' as const, expectedVersion: created.version };
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: true, draft: completeDraft() }), code('FORBIDDEN'));
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: false, draft: completeDraft() }, moderator), code('SOURCE_UNVERIFIED'));
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: true }, moderator), code('INVALID_INPUT'));
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: true, draft: completeDraft({ conditions: '' }) }, moderator), code('INVALID_INPUT'));
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: true, draft: completeDraft({ rewardMinor: 0, entrance: { kind: 'guide', label: 'Verified participation steps', instructions: 'Bank app > verified offer', imageIds: ['owner-source'] } }) }, moderator), error => error instanceof DomainError && error.code === 'INVALID_INPUT' && error.field === 'rewardMinor');
  assert.equal((await f.store.find('activities')).length, 0);
  assert.equal((await f.store.find('activity_revisions')).length, 0);
  assert.equal((await f.store.get<Asset>('assets', 'owner-source'))?.status, 'pending');
  assert.equal((await f.query<Submission>('submission.get', { id: created.id })).status, 'pending');
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: true, expectedVersion: 0, draft: completeDraft() }, moderator), code('VERSION_CONFLICT'));
  const entrance = { kind: 'guide' as const, label: 'Verified participation steps', instructions: '', imageIds: ['owner-source', 'foreign-image'] };
  await assert.rejects(f.command('submission.review', { ...base, sourceVerified: true, draft: completeDraft({ entrance }) }, moderator), code('INVALID_ASSET'));
  assert.equal((await f.store.get<Asset>('assets', 'owner-source'))?.status, 'pending');
  assert.equal((await f.store.find('activities')).length, 0);
  const published = await f.command('submission.review', { ...base, sourceVerified: true, draft: completeDraft({ entrance: { ...entrance, imageIds: ['owner-source', 'reviewer-image'] } }) }, moderator);
  const saved = await f.query<Submission>('submission.get', { id: created.id });
  assert.equal(saved.status, 'published');
  assert.ok(saved.draft);
  assert.equal(saved.draft.target, 3);
  assert.equal(saved.lead?.title, 'A bank offer to verify');
  assert.equal((await f.store.get<Activity>('activities', published.id))?.entrance.verifiedAt, now);
  assert.equal((await f.query<PageResult<ActivityItem>>('catalog.list', {}, outsider)).items.length, 1);
  assert.equal((await f.query<Asset[]>('assets.get', { ids: ['owner-source'] }, outsider))[0].ownerId, '');
  assert.equal((await f.store.get<Asset>('assets', 'unused-source'))?.status, 'pending');
  await assert.rejects(f.query('assets.get', { ids: ['unused-source'] }, outsider), code('NOT_FOUND'));
  await assert.rejects(f.command('submission.lead.save', { id: created.id, expectedVersion: saved.version, lead: lead() }), code('IMMUTABLE'));
});

test('a full submission cannot be silently downgraded to an incomplete lead', async () => {
  const f = fixture();
  const complete = await f.command('submission.save', { draft: completeDraft() });
  await assert.rejects(f.command('submission.lead.save', { id: complete.id, expectedVersion: complete.version, lead: lead() }), code('INVALID_STATE'));
  const saved = await f.query<Submission>('submission.get', { id: complete.id });
  assert.ok(saved.draft);
  assert.equal(saved.draft.title, 'Verified bank offer');
  assert.equal(saved.version, complete.version);
});

test('an unpublished complete draft can retain a zero reward while awaiting editorial verification', async () => {
  const f = fixture();
  const saved = await f.command('submission.save', { draft: completeDraft({ rewardMinor: 0 }) });
  const pending = await f.query<Submission>('submission.get', { id: saved.id });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.draft?.rewardMinor, 0);
  assert.equal((await f.store.find('activities')).length, 0);
});

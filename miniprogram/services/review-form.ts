import type { ActivityDraft, Submission } from '../../shared/contracts';
import { banks, issuers } from '../../shared/catalog';
import { activityCycle } from '../../shared/activity-cycle';
import { validateCycle, validateDraft } from '../../domain/validation';
import { cyclePreview, intervalOptions, rewardUnit, rewardValue } from './recognition-form';

export interface InlineReviewForm {
  draft: ActivityDraft;
  baseVersion: number;
  draftRevision: string | null;
  legacyCycle: boolean;
  rewardText: string;
  rewardTypeSelected: boolean;
  sourceVerified: boolean;
  dirty: boolean;
  conflict: boolean;
  busy: boolean;
  error: string;
  cycleType: string;
  cycleDay: number;
  cycleWeekday: number;
  cycleN: number;
  cycleUnit: string;
  intervalLabel: string;
  cyclePreview: string;
  rewardUnit: string;
  publishReady: boolean;
  complete: boolean;
  missing: string[];
  hasOcr: boolean;
}

export function reviewDraft(submission: Submission): ActivityDraft {
  if (submission.draft) {
    return JSON.parse(JSON.stringify(submission.draft)) as ActivityDraft;
  }
  const lead = submission.lead;
  const rules = JSON.parse(JSON.stringify(lead?.rules || {})) as Partial<ActivityDraft>;
  return {
    issuerIds: [], networks: [], cardKind: 'credit', cardDescription: '',
    frequency: 'once', startsOn: rules.cycle?.t === 'once' ? rules.cycle.start : '', endsOn: rules.cycle?.t === 'once' ? rules.cycle.end : '',
    target: 0, unit: '次', currency: lead?.bankId === 'hsbc' ? 'HKD' : 'CNY', rewardMinor: 0, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: '', ...rules,
    title: lead?.title || '', bankId: lead?.bankId || '', sourceUrl: lead?.sourceUrl || '', sourceNote: lead?.sourceNote || '',
    entrance: { kind: 'guide', label: '参与入口', instructions: '', imageIds: [], ...rules.entrance },
  };
}

export function normalizedReviewDraft(form: InlineReviewForm): ActivityDraft {
  const draft = JSON.parse(JSON.stringify(form.draft)) as ActivityDraft;
  for (const field of ['title', 'cardDescription', 'conditions', 'sourceUrl', 'sourceNote'] as const) draft[field] = draft[field].trim();
  draft.rewardMinor = rewardValue(form.rewardText.trim(), draft.rewardKind === 'points') || 0;
  draft.entrance.label = draft.entrance.label.trim() || '参与入口';
  draft.entrance.instructions = draft.entrance.instructions.trim();
  if (draft.entrance.kind !== 'web') delete draft.entrance.url;
  if (draft.entrance.kind !== 'miniprogram') { delete draft.entrance.appId; delete draft.entrance.path; delete draft.entrance.shortLink; }
  if (draft.entrance.shortLink) { delete draft.entrance.appId; delete draft.entrance.path; }
  if (draft.cycle?.t === 'once') draft.cycle = { t: 'once', start: draft.startsOn, end: draft.endsOn };
  if (draft.cycle?.t === 'custom') draft.cycle.anchor = draft.startsOn;
  return draft;
}

function missingRules(form: InlineReviewForm): string[] {
  const draft = normalizedReviewDraft(form);
  const missing: string[] = [];
  if (!draft.title || draft.title.length > 60) missing.push('活动名称');
  if (!banks.some(bank => bank.id === draft.bankId)) missing.push('所属银行');
  if (!draft.issuerIds.length || draft.issuerIds.some(id => !issuers.some(issuer => issuer.id === id && issuer.bankId === draft.bankId))) missing.push('适用发卡机构');
  if (!draft.cardDescription) missing.push('适用卡片说明');
  if (!draft.conditions || draft.conditions.length > 2000) missing.push('参与条件');
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(draft.startsOn) || !validDate(draft.endsOn) || draft.endsOn < draft.startsOn) missing.push('活动时间');
  if (!Number.isFinite(draft.target) || draft.target <= 0 || (['次', '笔'].includes(draft.unit) && !Number.isInteger(draft.target))) missing.push('累计门槛');
  if (!form.rewardTypeSelected || draft.rewardMinor <= 0) missing.push('奖励');
  if (!draft.cycle && !form.legacyCycle) missing.push('重置周期');
  if (!draft.sourceUrl && !draft.sourceNote) missing.push('可核实来源');
  if (draft.entrance.kind === 'guide' && !draft.entrance.instructions && !draft.entrance.imageIds.length) missing.push('参与入口');
  if (!missing.length) {
    try { validateDraft(draft, true); }
    catch (error) { missing.push(error instanceof Error ? error.message : '完整规则'); }
  }
  return missing;
}

export function updateReviewForm(form: InlineReviewForm, today: string): InlineReviewForm {
  const cycle = effectiveReviewCycle(form);
  const missing = missingRules(form);
  const amount = rewardValue(form.rewardText.trim(), form.draft.rewardKind === 'points');
  let validCycle = false;
  if (cycle) { try { validateCycle(cycle); validCycle = true; } catch {} }
  return { ...form, cycleType: cycle?.t || '', cycleDay: cycle?.t === 'month' ? cycle.day : 1, cycleWeekday: cycle?.t === 'week' ? cycle.weekday : 1,
    cycleN: cycle?.t === 'custom' ? cycle.n : 1, cycleUnit: cycle?.t === 'custom' ? cycle.unit : 'month',
    intervalLabel: cycle?.t === 'custom' ? intervalOptions.find(unit => unit.id === cycle.unit)?.name || '个月' : '个月',
    cyclePreview: cyclePreview(cycle, today), rewardUnit: rewardUnit(form.draft), publishReady: form.rewardTypeSelected && amount !== null && amount > 0 && validCycle,
    complete: missing.length === 0, missing };
}

export function createReviewForm(submission: Submission, today: string): InlineReviewForm {
  const draft = reviewDraft(submission);
  return updateReviewForm({ draft, baseVersion: submission.version, draftRevision: null, legacyCycle: !!submission.draft && !submission.draft.cycle, rewardText: draft.rewardMinor ? String(draft.rewardMinor / 100) : '',
    rewardTypeSelected: !!submission.draft || !!submission.lead?.rules?.rewardKind, sourceVerified: false, dirty: false, conflict: false, busy: false, error: '',
    cycleType: '', cycleDay: 1, cycleWeekday: 1, cycleN: 1, cycleUnit: 'month', intervalLabel: '个月', cyclePreview: '', rewardUnit: '元',
    publishReady: false, complete: false, missing: [], hasOcr: !!submission.lead?.rules && !!(submission.lead.rules.rewardMinor || submission.lead.rules.cycle) }, today);
}

export function effectiveReviewCycle(form: InlineReviewForm) {
  return form.draft.cycle || (form.legacyCycle ? activityCycle(form.draft) : undefined);
}

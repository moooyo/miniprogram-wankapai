import type { ActivityDraft, ActivityCycle } from '../../shared/contracts';
import { cycleWindow } from '../../shared/activity-cycle';

export type RecognizedField = 'bankId' | 'title' | 'reward' | 'cycle' | 'time' | 'conditions' | 'entrance';
export type RecognitionMarks = Partial<Record<RecognizedField, boolean>>;
export type DateRecognitionMarks = Partial<Record<'startsOn' | 'endsOn', boolean>>;
export interface RecognitionRegion { field: string; label: string; x: number; y: number; width: number; height: number; }
export interface RecognizedImage { assetId: string; recognized: boolean; regions: RecognitionRegion[]; }
export const rewardOptions = [
  { id: 'cashback', name: '返现' }, { id: 'discount', name: '立减' }, { id: 'voucher', name: '立减金' }, { id: 'points', name: '积分' }, { id: 'gift', name: '实物礼品' },
];
export const cycleOptions = [{ id: 'once', name: '单次' }, { id: 'week', name: '按周' }, { id: 'month', name: '按月' }, { id: 'custom', name: '自定义' }];
export const weekdayOptions = [{ id: 1, name: '一' }, { id: 2, name: '二' }, { id: 3, name: '三' }, { id: 4, name: '四' }, { id: 5, name: '五' }, { id: 6, name: '六' }, { id: 0, name: '日' }];
export const intervalOptions = [{ id: 'day', name: '天' }, { id: 'week', name: '周' }, { id: 'month', name: '个月' }];
export const recognitionLabels: Record<RecognizedField, string> = { bankId: '所属银行', title: '活动名称', reward: '奖励', cycle: '重置周期', time: '活动时间', conditions: '参与条件', entrance: '入口路径' };

export function cleanRewardInput(value: string, points: boolean): string {
  const digits = value.replace(/[^\d.]/g, '');
  if (points) return digits.split('.')[0].replace(/^0+(?=\d)/, '').slice(0, 9);
  const [whole = '', ...parts] = digits.split('.');
  return (whole + (parts.length ? '.' + parts.join('').slice(0, 2) : '')).replace(/^0+(?=\d)/, '').slice(0, 9);
}
export function rewardValue(value: string, points: boolean): number | null {
  if (value.length > 9 || !(points ? /^(?:0|[1-9]\d{0,8})$/ : /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/).test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function defaultCycle(type: string, startsOn: string, endsOn: string): ActivityCycle {
  if (type === 'week') return { t: 'week', weekday: 1 };
  if (type === 'month') return { t: 'month', day: 1 };
  if (type === 'custom') return { t: 'custom', n: 1, unit: 'month', anchor: startsOn };
  return { t: 'once', start: startsOn, end: endsOn };
}
export function cyclePreview(cycle: ActivityCycle | undefined, today: string): string {
  if (!cycle || !today) return '';
  try {
    const notStarted = cycle.t === 'custom' && !!cycle.anchor && today < cycle.anchor;
    const window = cycleWindow(cycle, notStarted && cycle.t === 'custom' ? cycle.anchor : today);
    const short = (value: string) => `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
    if (notStarted) return `首期：${short(window.s)} – ${short(window.e)}，尚未开始`;
    return window.ns ? `当前周期：${short(window.s)} – ${short(window.e)}，${short(window.ns)} 00:00 重置` : `${short(window.s)} – ${short(window.e)}，到期后不再开放`;
  } catch { return cycle.t === 'custom' ? '选择活动开始日期后，将显示当前周期' : '选择活动时间后，将显示当前周期'; }
}
export function rewardUnit(rules: Partial<ActivityDraft>): string {
  return rules.rewardKind === 'points' ? '分' : rules.currency === 'HKD' ? '港元' : rules.currency === 'MOP' ? '澳门元' : '元';
}
export function mergeRecognition(current: Partial<ActivityDraft>, fields: Partial<ActivityDraft>, marks: RecognitionMarks, dateMarks: DateRecognitionMarks = {}): { value: Partial<ActivityDraft>; marks: RecognitionMarks; dateMarks: DateRecognitionMarks; suggestion: string } {
  const value = JSON.parse(JSON.stringify(current)) as Partial<ActivityDraft>;
  const next = { ...marks };
  const nextDates = { ...dateMarks };
  let suggestion = '';
  const merge = (key: RecognizedField, empty: boolean, apply: () => void) => { if (empty || marks[key]) { apply(); next[key] = true; } };
  if (fields.bankId) merge('bankId', !value.bankId, () => { value.bankId = fields.bankId; if (fields.currency) value.currency = fields.currency; });
  if (fields.title) {
    if (value.title && value.title !== fields.title && !marks.title) suggestion = fields.title;
    merge('title', !value.title?.trim(), () => { value.title = fields.title; });
  }
  if (fields.rewardKind && fields.rewardMinor && fields.rewardMinor > 0) merge('reward', !value.rewardMinor, () => { value.rewardKind = fields.rewardKind; value.rewardMinor = fields.rewardMinor; if (fields.currency) value.currency = fields.currency; });
  if (fields.cycle) merge('cycle', !value.cycle, () => { value.cycle = fields.cycle; });
  if (fields.startsOn || fields.endsOn) {
    let changed = false;
    if (fields.startsOn && (!value.startsOn || dateMarks.startsOn)) { value.startsOn = fields.startsOn; nextDates.startsOn = true; changed = true; }
    if (fields.endsOn && (!value.endsOn || dateMarks.endsOn)) { value.endsOn = fields.endsOn; nextDates.endsOn = true; changed = true; }
    if (changed) next.time = true;
  }
  if (fields.conditions) merge('conditions', !value.conditions?.trim(), () => { value.conditions = fields.conditions; });
  if (fields.entrance?.instructions) merge('entrance', !value.entrance?.instructions?.trim(), () => { value.entrance = { kind: 'guide', label: '参与入口', imageIds: [], ...value.entrance, instructions: fields.entrance!.instructions }; });
  return { value, marks: next, dateMarks: nextDates, suggestion };
}

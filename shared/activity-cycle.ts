import { ActivityCycle, ActivityDraft } from './contracts';

export interface CycleWindow { s: string; e: string; ns: string | null; ps: string | null; }

function parse(date: string): number[] {
  const parts = date.split('-').map(Number);
  const instant = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parts[0] < 1 || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) throw new RangeError('Invalid cycle date');
  return parts;
}
function dayShift(date: string, days: number): string {
  parse(date);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}
function monthShift(date: string, months: number): string {
  const [year, month, day] = parse(date);
  const index = year * 12 + month - 1 + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12 + 1;
  const leap = nextYear % 400 === 0 || (nextYear % 4 === 0 && nextYear % 100 !== 0);
  const last = nextMonth === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(nextMonth) ? 30 : 31;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function activityCycle(activity: Pick<ActivityDraft, 'cycle' | 'frequency' | 'startsOn' | 'endsOn'>): ActivityCycle {
  if (activity.cycle) return activity.cycle;
  if (activity.frequency === 'once') return { t: 'once', start: activity.startsOn, end: activity.endsOn };
  if (activity.frequency === 'monthly') return { t: 'month', day: 1 };
  return { t: 'custom', n: activity.frequency === 'quarterly' ? 3 : 12, unit: 'month', anchor: `${activity.startsOn.slice(0, 4)}-01-01` };
}

// The same untruncated window powers forms, timelines, and participation periods.
export function cycleWindow(cycle: ActivityCycle, date: string): CycleWindow {
  const [year, month, day] = parse(date);
  if (cycle.t === 'once') return { s: cycle.start, e: cycle.end, ns: null, ps: null };
  let s: string;
  let ns: string;
  let ps: string;
  if (cycle.t === 'week') {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    s = dayShift(date, -((weekday - cycle.weekday + 7) % 7));
    ns = dayShift(s, 7);
    ps = dayShift(s, -7);
  } else if (cycle.t === 'month') {
    const reset = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(cycle.day).padStart(2, '0')}`;
    s = day >= cycle.day ? reset : monthShift(reset, -1);
    ns = monthShift(s, 1);
    ps = monthShift(s, -1);
  } else if (cycle.unit === 'month') {
    const [anchorYear, anchorMonth] = parse(cycle.anchor);
    const elapsed = (year - anchorYear) * 12 + month - anchorMonth;
    let index = Math.floor(elapsed / cycle.n) * cycle.n;
    if (monthShift(cycle.anchor, index) > date) index -= cycle.n;
    s = monthShift(cycle.anchor, index);
    ns = monthShift(cycle.anchor, index + cycle.n);
    ps = monthShift(cycle.anchor, index - cycle.n);
  } else {
    const length = cycle.n * (cycle.unit === 'week' ? 7 : 1);
    const elapsed = (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${cycle.anchor}T00:00:00.000Z`)) / 86400000;
    s = dayShift(cycle.anchor, Math.floor(elapsed / length) * length);
    ns = dayShift(s, length);
    ps = dayShift(s, -length);
  }
  return { s, e: dayShift(ns, -1), ns, ps };
}

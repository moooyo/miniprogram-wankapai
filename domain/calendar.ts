import { ActivityDraft, BillingAccount } from '../shared/contracts';
import { DomainError } from './errors';
import { cycleWindow } from '../shared/activity-cycle';

export interface ActivityPeriod { periodKey: string; startsOn: string; endsOn: string; }

function pad(value: number): string { return String(value).padStart(2, '0'); }

export function lastDay(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError('INVALID_DATE', '日期无效');
  }
  if (month === 2) return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= lastDay(year, month);
}

export function assertDate(value: unknown, field = 'date'): string {
  if (!isDate(value)) throw new DomainError('INVALID_DATE', '请填写有效日期', field);
  return value;
}

export function todayCN(now: Date = new Date()): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DomainError('INVALID_DATE', '当前日期无效');
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(shifted.getTime())) throw new DomainError('INVALID_DATE', '当前日期无效');
  return assertDate(shifted.toISOString().slice(0, 10));
}

export function monthOf(date: string): string { return assertDate(date).slice(0, 7); }

export function assertMonth(value: unknown, field = 'month'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value) || !isDate(`${value}-01`)) {
    throw new DomainError('INVALID_DATE', '请选择有效月份', field);
  }
  return value;
}

export function addMonths(date: string, delta: number): string {
  assertDate(date);
  if (!Number.isSafeInteger(delta)) throw new DomainError('INVALID_DATE', '月份间隔无效');
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + month - 1 + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12 + 1;
  const nextDay = Math.min(day, lastDay(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, '0')}-${pad(nextMonth)}-${pad(nextDay)}`;
}

export function addDays(date: string, delta: number): string {
  assertDate(date);
  if (!Number.isSafeInteger(delta)) throw new DomainError('INVALID_DATE', '天数间隔无效');
  const time = Date.parse(`${date}T00:00:00.000Z`) + delta * 86400000;
  const shifted = new Date(time);
  if (!Number.isFinite(shifted.getTime())) throw new DomainError('INVALID_DATE', '日期无效');
  const result = shifted.toISOString().slice(0, 10);
  return assertDate(result);
}

export function periodFor(activity: Pick<ActivityDraft, 'frequency' | 'cycle' | 'startsOn' | 'endsOn'>, date: string): ActivityPeriod | null {
  assertDate(date);
  assertDate(activity.startsOn, 'startsOn');
  assertDate(activity.endsOn, 'endsOn');
  if (activity.startsOn > activity.endsOn) throw new DomainError('INVALID_DATE', '结束日期不能早于开始日期', 'endsOn');
  if (date < activity.startsOn || date > activity.endsOn) return null;
  if (activity.cycle) {
    const window = cycleWindow(activity.cycle, date);
    if (date < window.s || date > window.e) return null;
    return {
      periodKey: activity.cycle.t === 'once' ? 'once' : `${activity.cycle.t}:${window.s}`,
      startsOn: window.s < activity.startsOn ? activity.startsOn : window.s,
      endsOn: window.e > activity.endsOn ? activity.endsOn : window.e,
    };
  }
  const [year, month] = date.split('-').map(Number);
  let periodKey: string;
  let startsOn: string;
  let endsOn: string;
  switch (activity.frequency) {
    case 'once': return { periodKey: 'once', startsOn: activity.startsOn, endsOn: activity.endsOn };
    case 'monthly':
      periodKey = date.slice(0, 7);
      startsOn = `${periodKey}-01`;
      endsOn = `${periodKey}-${pad(lastDay(year, month))}`;
      break;
    case 'quarterly': {
      const quarter = Math.floor((month - 1) / 3) + 1;
      const firstMonth = (quarter - 1) * 3 + 1;
      const finalMonth = firstMonth + 2;
      periodKey = `${String(year).padStart(4, '0')}-Q${quarter}`;
      startsOn = `${String(year).padStart(4, '0')}-${pad(firstMonth)}-01`;
      endsOn = `${String(year).padStart(4, '0')}-${pad(finalMonth)}-${pad(lastDay(year, finalMonth))}`;
      break;
    }
    case 'yearly':
      periodKey = String(year).padStart(4, '0');
      startsOn = `${periodKey}-01-01`;
      endsOn = `${periodKey}-12-31`;
      break;
    default: throw new DomainError('INVALID_INPUT', '活动周期无效', 'frequency');
  }
  return {
    periodKey,
    startsOn: startsOn < activity.startsOn ? activity.startsOn : startsOn,
    endsOn: endsOn > activity.endsOn ? activity.endsOn : endsOn
  };
}

export function billDates(account: Pick<BillingAccount, 'statementDay' | 'dueDay' | 'dueMonthOffset'>, month: string): { statementOn: string; dueOn: string } {
  assertMonth(month);
  for (const field of ['statementDay', 'dueDay'] as const) {
    if (!Number.isInteger(account[field]) || account[field] < 1 || account[field] > 31) {
      throw new DomainError('INVALID_INPUT', '账单日和还款日应为 1 至 31 日', field);
    }
  }
  if (account.dueMonthOffset !== 0 && account.dueMonthOffset !== 1) throw new DomainError('INVALID_INPUT', '还款月份无效', 'dueMonthOffset');
  const [year, number] = month.split('-').map(Number);
  const statementOn = `${month}-${pad(Math.min(account.statementDay, lastDay(year, number)))}`;
  const dueMonth = addMonths(`${month}-01`, account.dueMonthOffset).slice(0, 7);
  const [dueYear, dueNumber] = dueMonth.split('-').map(Number);
  const dueOn = `${dueMonth}-${pad(Math.min(account.dueDay, lastDay(dueYear, dueNumber)))}`;
  return { statementOn, dueOn };
}

import type { Currency, Participation, RewardKind, Stage } from '../../shared/contracts';
import { todayCN } from '../../domain/calendar';
import { benefitCopy, BenefitKind } from './benefit-copy';

const symbols: Record<Currency,string> = {CNY:'¥',HKD:'HK$',MOP:'MOP$'};
export function money(minor: number, currency: Currency='CNY', kind?: RewardKind): string {
  const safe=Number.isSafeInteger(minor)?minor:0;
  if(kind==='points')return `${(safe/100).toLocaleString('en-US')} 分`;
  const absolute=Math.abs(safe), whole=Math.floor(absolute/100).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','), cents=String(absolute%100).padStart(2,'0');
  return symbols[currency]+(safe<0?'-':'')+whole+(cents==='00'?'':'.'+cents);
}
export function today(): string { return todayCN(); }
export function monthKey(date=today()): string { return date.slice(0,7); }
export function periodLabel(period: string): string {
  if(/^(week|month|custom):\d{4}-\d{2}-\d{2}$/.test(period))return `${period.slice(-10).replace(/-/g,'/')} 起`;
  if(period==='once')return '单次活动';
  if(/^\d{4}-Q\d$/.test(period))return `${period.slice(0,4)}年第${period.slice(-1)}季度`;
  if(/^\d{4}-\d{2}$/.test(period))return `${period.slice(0,4)}年${Number(period.slice(5))}月`;
  if(/^\d{4}$/.test(period))return `${period}年度`;
  return period;
}
export function stageLabel(value: Participation|Stage, kind: BenefitKind = 'cashback'): string {
  const stage=typeof value==='string'?value:value.stage;
  const copy=benefitCopy(typeof value==='string'?kind:value.snapshot.rewardKind);
  return {available:'可以参与',registered:'已报名',in_progress:'进行中',completed:copy.completedStatus,received:copy.recordedStatus,skipped:'本期不参加'}[stage]||'';
}
export function showError(error: unknown): void {
  const value=error as {message?:string;errMsg?:string};
  if(value?.errMsg?.includes('cancel')||value?.message==='USER_CANCELLED')return;
  wx.showToast({title:value?.message||'操作未完成，请稍后重试',icon:'none',duration:2500});
}

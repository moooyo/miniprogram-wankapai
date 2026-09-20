import type { Currency, Participation, Stage } from '../../shared/contracts';
import { todayCN } from '../../domain/calendar';

const symbols: Record<Currency,string> = {CNY:'¥',HKD:'HK$',MOP:'MOP$'};
export function money(minor: number, currency: Currency='CNY'): string {
  const safe=Number.isSafeInteger(minor)?minor:0;
  return symbols[currency]+(safe/100).toFixed(2).replace(/\.00$/,'');
}
export function today(): string { return todayCN(); }
export function monthKey(date=today()): string { return date.slice(0,7); }
export function periodLabel(period: string): string {
  if(period==='once')return '单次活动';
  if(/^\d{4}-Q\d$/.test(period))return `${period.slice(0,4)}年第${period.slice(-1)}季度`;
  if(/^\d{4}-\d{2}$/.test(period))return `${period.slice(0,4)}年${Number(period.slice(5))}月`;
  if(/^\d{4}$/.test(period))return `${period}年度`;
  return period;
}
export function stageLabel(value: Participation|Stage): string {
  const stage=typeof value==='string'?value:value.stage;
  return {available:'可以参与',registered:'已报名',in_progress:'进行中',completed:'已完成 · 待到账',received:'已到账',skipped:'本期不参加'}[stage]||'';
}
export function showError(error: unknown): void {
  const value=error as {message?:string;errMsg?:string};
  if(value?.errMsg?.includes('cancel')||value?.message==='USER_CANCELLED')return;
  wx.showToast({title:value?.message||'操作未完成，请稍后重试',icon:'none',duration:2500});
}

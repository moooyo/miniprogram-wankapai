import type { Activity, ActivityCycle, Asset, Card, Participation } from '../../shared/contracts';
import { activityCycle as normalizedCycle, cycleWindow } from '../../shared/activity-cycle';
import { cardLabel } from './card-labels';

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const dayMs = 86400000;
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, count: number) => new Date(date.getTime() + count * dayMs);
const difference = (later: Date, earlier: Date) => Math.round((later.getTime() - earlier.getTime()) / dayMs);

export function shortDate(value: string): string {
  if (!value) return '';
  return `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
}

export function matchingCards(activity: Activity, cards: Card[]): Card[] {
  return cards.filter(card => !card.archivedAt && card.bankId === activity.bankId
    && (!activity.issuerIds.length || activity.issuerIds.includes(card.issuerId))
    && (!activity.networks.length || activity.networks.includes(card.network))
    && (activity.cardKind === 'any' || activity.cardKind === card.kind));
}

export function usableCardLabel(activity: Activity, cards: Card[]): string {
  const matches = matchingCards(activity, cards);
  return matches.length ? `可用卡片：${cardLabel(matches[0].id, cards)}${matches.length > 1 ? ` 等 ${matches.length} 张` : ''}` : '暂无可参加的卡片';
}

export function rewardKindLabel(activity: Activity): string {
  const names: Record<string, string> = { cashback: '返现', discount: '立减', voucher: '立减金', points: '积分', gift: '实物礼品' };
  return names[activity.rewardKind] || '返现';
}

export function activityCycle(activity: Activity): ActivityCycle {
  return normalizedCycle(activity);
}

export function cycleLabel(activity: Activity): string {
  const cycle = activityCycle(activity);
  if (cycle.t === 'once') return '单次';
  if (cycle.t === 'week') return `每周${weekdays[cycle.weekday]}重置`;
  if (cycle.t === 'month') return `每月 ${cycle.day} 日重置`;
  return `每 ${cycle.n} ${cycle.unit === 'day' ? '天' : cycle.unit === 'week' ? '周' : '个月'}重置`;
}

export function cycleView(activity: Activity, today: string, record?: Participation | null) {
  const cycle = activityCycle(activity), date = parse(today);
  const window = cycleWindow(normalizedCycle(activity), record?.startsOn || today);
  let start = parse(window.s), end = parse(window.e), next = window.ns ? parse(window.ns) : null;
  const previous = window.ps ? parse(window.ps) : null;
  if (record) {
    start = parse(record.startsOn); end = parse(record.endsOn);
    if (cycle.t !== 'once') next = addDays(end, 1);
  } else {
    if (iso(start) < activity.startsOn) start = parse(activity.startsOn);
    if (iso(end) > activity.endsOn) end = parse(activity.endsOn);
  }
  if (next && iso(next) > activity.endsOn) next = null;
  const total = Math.max(1, difference(end, start) + 1), past = date > end, before = date < start;
  const remaining = Math.max(0, difference(end, date)), percent = Math.min(100, Math.max(0, Math.round((difference(date, start) + 1) / total * 100)));
  const done = record?.stage === 'completed' || record?.stage === 'received';
  const md = (value: Date) => shortDate(iso(value));
  const tick = (value: Date) => `${value.getUTCMonth() + 1}/${value.getUTCDate()}`;
  let description = '仅此一期，完成后即结束，不会重置。';
  if (cycle.t === 'month') description = `每月 ${cycle.day} 日 00:00 重置，各周期单独计算进度与奖励${cycle.day !== 1 ? `。每期为当月 ${cycle.day} 日至次月 ${cycle.day - 1} 日，非自然月。` : '。'}`;
  if (cycle.t === 'week') description = `每周${weekdays[cycle.weekday]} 00:00 重置，每周单独计算进度与奖励${cycle.days?.length ? `，仅限${cycle.days.map(value => `周${weekdays[value]}`).join('、')}使用。` : '。'}`;
  if (cycle.t === 'custom') description = `自 ${shortDate(cycle.anchor)}起，每 ${cycle.n} ${cycle.unit === 'day' ? '天' : cycle.unit === 'week' ? '周' : '个月'}重置一次，各周期单独计算进度与奖励。`;
  let foot = done ? '已达标，活动已完成' : past ? '活动已结束' : remaining === 0 ? '今日 24:00 截止，逾期不再开放' : `${md(end)}截止，逾期不再开放`;
  if (next) foot = past ? `本期已结束，下一期 ${md(next)} 开始` : done ? `本期已达标，${md(next)} 00:00 重置后可参加下一期`
    : remaining === 0 ? `本期今日 24:00 结束，${md(next)} 00:00 重置，进度清零` : `本期截至 ${md(end)}，${md(next)} 00:00 重置，进度清零`;
  if (cycle.t === 'week' && next) foot = done ? `本周已达标，${md(next)}（周${weekdays[next.getUTCDay()]}）重置后可再次参加` : `本周剩余 ${remaining} 天，${md(next)}（周${weekdays[next.getUTCDay()]}）00:00 重置`;
  return {
    label: cycleLabel(activity), repeating: cycle.t !== 'once', isWeek: cycle.t === 'week', isOnce: cycle.t === 'once',
    kindLine: cycle.t === 'once' ? '单次活动' : `周期重置 · ${cycle.t === 'week' ? '按周' : cycle.t === 'month' ? '按月' : '自定义'}`,
    description, foot, percent, todayPercent: Math.min(88, Math.max(12, percent)), showToday: !past && !before,
    todayLabel: `今日 ${tick(date)}`, currentLabel: past ? '已结束' : before ? `${md(start)} 开始` : remaining === 0 ? '今日截止' : `剩余 ${remaining} 天`,
    startsOn: iso(start), endsOn: iso(end), nextStartsOn: next ? iso(next) : '', startTick: tick(start), endTick: tick(end),
    previousTick: previous ? `${tick(previous)} 起` : '', nextTick: next ? `${tick(next)} 起` : cycle.t === 'once' ? '' : '活动结束',
    days: cycle.t === 'week' ? Array.from({ length: 7 }, (_, index) => {
      const value = addDays(start, index), elapsed = difference(value, date), usable = !!cycle.days?.includes(value.getUTCDay());
      return { date: iso(value), weekday: weekdays[value.getUTCDay()], day: value.getUTCDate(), today: elapsed === 0, past: elapsed < 0,
        usable, label: elapsed === 0 ? '今天' : usable && elapsed > 0 ? '可用' : '' };
    }) : [],
  };
}

export function screenshotItems(assets: Asset[], urls: { id: string; url: string }[] = []) {
  const resolved = new Map(urls.map(value => [value.id, value.url]));
  return assets.map((asset, index) => {
    const metadata = asset as Asset & { label?: string; uploader?: string };
    return { id: asset.id, url: resolved.get(asset.id) || (asset.fileId.startsWith('cloud://') ? '' : asset.fileId),
      label: metadata.label || (index === 0 ? '活动规则' : index === 1 ? '报名入口' : '活动细则'),
      uploader: metadata.uploader || `用户 ${asset.ownerId.replace(/^.*?([0-9]{4})$/, '$1')}`,
      uploadedOn: shortDate(asset.createdAt.slice(0, 10)) };
  });
}

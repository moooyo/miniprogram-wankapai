import type { ActivityDraft } from '../../shared/contracts';

export type BenefitKind = ActivityDraft['rewardKind'];

const copy = {
  cashback: {
    kind: 'cashback' as const, isDiscount: false,
    recordAction: '确认到账', actualLabel: '实际到账', dateLabel: '到账日期', dateEvent: '到账',
    recordedStatus: '已到账', pendingStatus: '待到账', completedStatus: '已完成 · 待到账',
    editAction: '修改到账', revokeAction: '撤销到账', recordSuccess: '已记录到账', editSuccess: '到账记录已更正', revokeSuccess: '已撤销到账',
    amountLabel: '实际到账金额', recordTitle: '确认返现到账', editTitle: '更正到账记录', recordNoun: '到账记录',
    pendingDescription: '收到返现后确认实际金额和到账日期', expectedLabel: '预计返现',
    completeAndRecordAction: '完成并确认到账', completedToast: '已完成，收到返现后确认到账',
  },
  discount: {
    kind: 'discount' as const, isDiscount: true,
    recordAction: '记录已享优惠', actualLabel: '实际优惠', dateLabel: '享受优惠日期', dateEvent: '享受优惠',
    recordedStatus: '已享优惠', pendingStatus: '待确认优惠', completedStatus: '已完成 · 待确认优惠',
    editAction: '修改优惠', revokeAction: '撤销优惠记录', recordSuccess: '已记录优惠', editSuccess: '优惠记录已更正', revokeSuccess: '已撤销优惠记录',
    amountLabel: '实际优惠金额', recordTitle: '记录已享优惠', editTitle: '更正优惠记录', recordNoun: '优惠记录',
    pendingDescription: '享受优惠后确认实际抵扣金额，无需等待银行到账', expectedLabel: '预计优惠',
    completeAndRecordAction: '完成并记录优惠', completedToast: '已完成，可记录已享优惠',
  },
};

export function benefitCopy(kind: BenefitKind = 'cashback') {
  if (kind === 'voucher') return { ...copy.cashback, kind, amountLabel:'实际到账立减金', recordTitle:'确认立减金到账', pendingDescription:'收到立减金后确认实际金额和到账日期', expectedLabel:'预计立减金' };
  if (kind === 'points') return { ...copy.cashback, kind, amountLabel:'实际到账积分', recordTitle:'确认积分到账', pendingDescription:'收到积分后确认数量和到账日期', expectedLabel:'预计积分' };
  if (kind === 'gift') return { ...copy.cashback, kind, amountLabel:'实物参考价值', recordTitle:'确认礼品领取', recordAction:'确认领取', actualLabel:'参考价值', dateLabel:'领取日期', dateEvent:'领取', recordedStatus:'已领取', pendingStatus:'待领取', completedStatus:'已完成 · 待领取', recordSuccess:'已记录领取', expectedLabel:'礼品参考价值', pendingDescription:'收到礼品后记录领取日期和参考价值' };
  return copy[kind];
}

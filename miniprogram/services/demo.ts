import type { Activity, Actor, Asset, Bill, Card, Commands, Entitlement, EntitlementDraft, EntitlementKind, LoungeAccess, MutationResult, Participation } from '../../shared/contracts';
import { banks } from '../../shared/catalog';
import { MemoryStore, MemorySeed } from '../../domain/memory-store';
import { createService } from '../../domain/service';
import { addDays, addMonths, lastDay, monthOf, periodFor, todayCN } from '../../domain/calendar';

export const demoActor: Actor = {userId:'demo-user',isModerator:false,demo:true};
const storageKey='card-benefits.native.demo.v1';
let servicePromise: Promise<ReturnType<typeof createService>>|null=null;
let memory: MemoryStore;

const screenshotFiles = [
  ['cmb-rule', 39148], ['cmb-entry', 30743], ['hsbc-rule', 38832],
  ['icbc-rule', 39742], ['icbc-entry', 30055], ['bocom-rule', 38101],
  ['bocom-entry', 29591], ['abc-rule', 38754], ['ocr-rule', 41978],
] as const;

function demoScreenshots(createdAt: string): Asset[] {
  return screenshotFiles.map(([name, size]) => ({
    id: `demo-shot-${name}`, ownerId: demoActor.userId, fileId: `/assets/demo/${name}.png`,
    cloudPath: `demo/${name}.png`, size, mime: 'image/png', status: 'approved', createdAt,
    label:name.endsWith('-entry') ? '报名入口' : '活动规则', uploader:'用户 1024',
  }));
}

export interface DesignDemoFixtures {
  activityIds: string[];
  cardIds: string[];
  ocrAssetId: string;
  ocrSubmissionId: string;
  inlineReviewSubmissionId: string;
  consumptionActivityId: string;
  entitlementIds: Record<Exclude<EntitlementKind, 'other'>, string>;
  billingAmountFixture: { cardId: string; accountId: string; billId: string };
}

async function designFixtureCommand<K extends keyof Commands>(service: ReturnType<typeof createService>, requestId: string, action: K, payload: Commands[K]): Promise<MutationResult> {
  const prior = await memory.find<{ ownerId: string; requestId: string; result?: MutationResult }>('requests', {
    where: [{ field: 'ownerId', op: 'eq', value: demoActor.userId }, { field: 'requestId', op: 'eq', value: requestId }],
  });
  if (prior.length === 1 && typeof prior[0].result?.id === 'string') return prior[0].result;
  return service.execute(demoActor, { action, payload, requestId }) as Promise<MutationResult>;
}

// Explicit acceptance fixtures leave the ordinary demo seed and edited records intact.
export async function installDesignDemoFixtures(): Promise<DesignDemoFixtures> {
  const service = await demoService();
  const now = new Date(), day = todayCN(now), year = day.slice(0, 4), createdAt = now.toISOString();
  const first = `${year}-01-01`, end = `${year}-12-31`;
  for (const asset of demoScreenshots(createdAt)) {
    if (!await memory.get<Asset>('assets', asset.id)) await memory.set('assets', asset.id, asset);
  }
  const guide = (imageNames: string[], instructions: string) => ({
    kind: 'guide' as const, label: '活动入口（示意）', instructions, imageIds: imageNames.map(name => `demo-shot-${name}`),
  });
  const activity = (id: string, bankId: string, overrides: Partial<Activity>): Activity => ({
    id, revision: 1, status: 'published', publishedAt: createdAt, updatedAt: createdAt, publishedBy: 'demo-moderator',
    title: '消费奖励（演示）', bankId, issuerIds: [`${bankId}-cn`], networks: ['visa'], cardKind: 'credit', cardDescription: 'Visa 信用卡（演示）',
    frequency: 'monthly', startsOn: first, endsOn: end, target: 3, unit: '笔', currency: 'CNY', rewardMinor: 2000, rewardKind: 'cashback', scope: 'user',
    requiresRegistration: false, requiresInvitation: false, conditions: '虚构演示规则，请勿据此参加真实银行活动。', sourceUrl: '',
    sourceNote: '虚构演示数据，仅供界面验收。', entrance: guide([], '银行 App → 信用卡 → 优惠活动（示意）'), ...overrides,
  });
  const activities: Activity[] = [
    activity('design-weekly', 'bocom', {
      title: '周末超市满 60 减 10（演示）', cycle: { t: 'week', weekday: 1, days: [6, 0] },
      target: 1, unit: '次', rewardMinor: 1000, rewardKind: 'discount',
      conditions: '周六、周日在指定超市单笔满 60 元立减 10 元，每周 1 次，每周一 00:00 重置。演示规则。',
      entrance: guide(['bocom-rule', 'bocom-entry'], '交通银行买单吧 App → 精选优惠 → 周末超市（示意）'),
    }),
    activity('design-month-day21', 'icbc', {
      title: '账单月刷满 8 笔返 30 元（演示）', cycle: { t: 'month', day: 21 }, target: 8,
      rewardMinor: 3000, requiresRegistration: true,
      conditions: '每月 21 日至次月 20 日为一期，单笔满 50 元累计 8 笔返 30 元，需先报名。演示规则。',
      entrance: guide(['icbc-rule', 'icbc-entry'], '工商银行 App → 信用卡 → 优惠活动 → 账单月返现（示意）'),
    }),
    activity('design-custom-quarterly', 'hsbc', {
      title: '季度消费 3 笔返 HK$80（自定义演示）', issuerIds: ['hsbc-hk'], frequency: 'quarterly',
      cycle: { t: 'custom', n: 3, unit: 'month', anchor: first }, currency: 'HKD', rewardMinor: 8000,
      conditions: '从活动开始日期起每 3 个月重置，期内完成 3 笔合资格消费，达标后等待回赠。演示规则。',
      entrance: guide(['hsbc-rule'], 'HSBC HK App → 优惠 → 已登记（示意）'),
    }),
    activity('design-points', 'abc', {
      title: '每月 5 笔 10 元以上送积分（演示）', cycle: { t: 'month', day: 1 }, target: 5,
      rewardMinor: 200000, rewardKind: 'points',
      conditions: '每笔满 10 元计 1 笔，每月累计 5 笔送 2,000 积分，次月 20 日前到账。演示规则。',
      entrance: guide(['abc-rule'], '农业银行 App → 信用卡 → 活动（示意）'),
    }),
    activity('design-consumption', 'cmb', {
      title: '每月消费 2 笔返 10 元（演示）', cycle: { t: 'month', day: 1 }, target: 2,
      rewardMinor: 1000, scope: 'card',
      conditions: '本期记录 2 笔合资格消费后达标。此为虚构规则，仅用于逐笔消费记录界面验收。',
      entrance: guide([], '招商银行 App → 信用卡 → 消费奖励（虚构示意）'),
    }),
  ];
  const cards: Card[] = [
    ['bocom', 'bocom-cn', '周末超市卡（演示）'], ['icbc', 'icbc-cn', '账单月消费卡（演示）'],
    ['hsbc', 'hsbc-hk', '自定义周期卡（演示）'], ['abc', 'abc-cn', '积分消费卡（演示）'],
  ].map(([bankId, issuerId, nickname]) => ({ id: `design-card-${bankId}`, ownerId: demoActor.userId, bankId, issuerId, nickname, network: 'visa', kind: 'credit', createdAt }));
  for (const card of cards) if (!await memory.get<Card>('cards', card.id)) await memory.set('cards', card.id, card);
  for (const row of activities) {
    if (await memory.get<Activity>('activities', row.id)) continue;
    await memory.set('activities', row.id, row);
    if (row.id === 'design-month-day21') continue;
    const joined = await service.execute(demoActor, { action: 'activity.join', payload: { activityId: row.id, ...(row.id === 'design-consumption' ? { cardId: 'demo-card-cmb' } : {}) }, requestId: `design-fixture-join-${row.id}` }) as MutationResult;
    if (row.id === 'design-points') await service.execute(demoActor, { action: 'participation.progress', payload: { participationId: joined.id, progress: 4, registered: false }, requestId: 'design-fixture-points-progress' });
    if (row.id === 'design-custom-quarterly') {
      await service.execute(demoActor, { action: 'participation.complete', payload: { participationId: joined.id }, requestId: 'design-fixture-custom-complete' });
      await service.execute(demoActor, { action: 'participation.expected', payload: { participationId: joined.id, expectedOn: addDays(day, 12) }, requestId: 'design-fixture-custom-expected' });
    }
  }
  const entitlementCommon: EntitlementDraft = {
    title: '个人权益（演示）', kind: 'other', cardId: '', provider: '', totalUses: 0, initialUsed: 0,
    startsOn: first, endsOn: end, transferability: 'not_allowed', transferNote: '',
    notes: '虚构演示权益，仅用于界面验收，不代表任何真实银行的权益或准入规则。', lounges: [],
  };
  const entitlementDrafts: EntitlementDraft[] = [
    { ...entitlementCommon, kind: 'lounge', title: '机场贵宾厅（演示）', cardId: 'demo-card-hsbc', provider: '汇丰香港（演示）',
      totalUses: 6, initialUsed: 2, transferability: 'grey', transferNote: '演示：转让规则未知，使用前需要核实。', loungeProgram: 'pp',
      description: 'PP 计划样式演示；以下贵宾厅与准入条件均为虚构，不代表真实 PP 计划或汇丰权益。',
      lounges: demoLounges(day).map(item => ({ ...item, supportedBanks: ['汇丰银行', '汇丰香港'],
        loungeName: item.zone === 'domestic' ? '示例国内出发贵宾厅' : '示例国际出发贵宾厅', customerScope: 'specified',
        customerNote: '仅用于模拟演示汇丰卡片的资格筛选，不代表实际银行客户范围。',
        sourceNote: '虚构验收素材，不代表真实 PP 计划、汇丰银行或机场的服务与准入规则。' })),
    },
    { ...entitlementCommon, kind: 'delay_insurance', title: '航班延误险（演示）', cardId: 'demo-card-hsbc', provider: '汇丰香港（演示）',
      description: '延误 4 小时赔 HK$1,000（虚构演示）', notes: '虚构演示条件：需用本卡全额付机票。本记录不代表真实银行权益，赔付规则、保单范围与申请材料必须向真实银行核实。',
    },
    { ...entitlementCommon, kind: 'airport_transfer', title: '接送机（演示）', cardId: 'demo-card-boc', provider: '中国银行澳门分行（演示）',
      totalUses: 2, initialUsed: 0, description: '提前 24 小时预约，50 公里内（虚构演示）',
    },
    { ...entitlementCommon, kind: 'health_check', title: '年度体检（演示）', cardId: 'demo-card-cmb', provider: '招商银行（演示）',
      totalUses: 1, initialUsed: 0, description: '提前 3 天预约，体检项目需向服务方核实（虚构演示）',
    },
    { ...entitlementCommon, kind: 'car_wash', title: '洗车（演示）', cardId: 'demo-card-cmb', provider: '招商银行（演示）',
      totalUses: 3, initialUsed: 1, transferability: 'allowed', transferNote: '虚构演示规则允许赠予亲友，不代表真实银行条款。',
      description: '指定门店，含内饰清洁（虚构演示）',
    },
    { ...entitlementCommon, kind: 'points', title: '积分余额（演示）', cardId: 'demo-card-cmb', provider: '招商银行（演示）',
      pointsBalance: 12480, description: '12 月 31 日有 3,200 分到期（虚构演示）',
    },
  ];
  const entitlementIds = {} as DesignDemoFixtures['entitlementIds'];
  for (const draft of entitlementDrafts) {
    const result = await designFixtureCommand(service, `design-entitlement-v1-${draft.kind}`, 'entitlement.save', { draft });
    entitlementIds[draft.kind as keyof DesignDemoFixtures['entitlementIds']] = result.id;
  }
  const billingDueOn = addDays(day, 4);
  const billingCard = await designFixtureCommand(service, 'design-billing-card-v1', 'card.save', {
    bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit', nickname: '账单金额验收卡（演示）',
    billing: { statementDay: Math.min(6, Number(day.slice(8))), dueDay: Number(billingDueOn.slice(8)),
      dueMonthOffset: billingDueOn.slice(0, 7) > monthOf(day) ? 1 : 0, dueOn: billingDueOn, remindDays: 3 },
  });
  const storedBillingCard = (await memory.get<Card>('cards', billingCard.id))!;
  const billingBills = await memory.find<Bill>('bills', { where: [{ field: 'ownerId', op: 'eq', value: demoActor.userId }, { field: 'billingAccountId', op: 'eq', value: storedBillingCard.billingAccountId! }], orderBy: [{ field: 'periodKey', direction: 'asc' }] });
  const billingAmount = await designFixtureCommand(service, 'design-billing-amount-v1', 'bill.update', { id: billingBills[0].id, amountMinor: 128050, currency: 'CNY' });
  const ocrLead = await service.execute(demoActor, { action:'submission.lead.save', payload:{ lead:{ bankId:'cmb', title:'截图待补全活动（演示）', sourceUrl:'', sourceNote:'', imageIds:['demo-shot-ocr-rule'] } }, requestId:'design-ocr-lead-v1' }) as MutationResult;
  const inlineReview = await designFixtureCommand(service,'design-inline-review-v1','submission.save',{draft:activity('design-inline-proposal','cmb',{title:'完整规则审核（演示）',cycle:{t:'month',day:1},entrance:guide(['cmb-rule'],'银行 App → 示例活动（虚构演示）')})});
  await persistDemo();
  return { activityIds: activities.map(row => row.id), cardIds: cards.map(row => row.id), ocrAssetId: 'demo-shot-ocr-rule', ocrSubmissionId:ocrLead.id, inlineReviewSubmissionId:inlineReview.id,
    consumptionActivityId: 'design-consumption', entitlementIds,
    billingAmountFixture: { cardId: billingCard.id, accountId: storedBillingCard.billingAccountId!, billId: billingAmount.id } };
}

function demoLounges(day: string): LoungeAccess[] {
  return [
    { id: 'demo-lounge-local', airportName: '示例国际机场', airportCode: 'ZZZ', city: '示例城市', loungeName: '示例银行贵宾厅', terminal: 'T1', zone: 'domestic',
      supportedBanks: ['示例银行'], reservation: 'required', advanceHours: 4, reservationNote: '示例：通过权益平台预约，取得确认后到店。', customerScope: 'local_bank', customerNote: '仅限示例银行在示例城市开户的客户；此条件仅用于演示。',
      guestNote: '携伴需另行核实，不能据此认定权益可转让。', openingHours: '08:00–22:00（演示）', location: '安检后，示例登机口旁', unitsPerVisit: 1,
      sourceNote: '虚构示例，不代表真实机场、贵宾厅或准入规则。', verifiedOn: day },
    { id: 'demo-lounge-international', airportName: '示例国际机场', airportCode: 'ZZZ', city: '示例城市', loungeName: '示例国际出发休息室', terminal: 'T2', zone: 'international',
      supportedBanks: ['示例银行'], reservation: 'not_required', advanceHours: 0, reservationNote: '现场须核验当日登机牌及权益。', customerScope: 'specified', customerNote: '示例高端卡持卡人，需与登机牌姓名一致。',
      guestNote: '本人和同行人各扣 1 次（示例）。', openingHours: '', location: '国际出发安检后', unitsPerVisit: 1,
      sourceNote: '与同一演示权益共用次数，不代表真实准入。', verifiedOn: day },
  ];
}

async function annotateUneditedDemoLounges(): Promise<boolean> {
  const origins = await memory.find<{ ownerId: string; requestId: string; result?: MutationResult; createdAt: string }>('requests', {
    where: [{ field: 'ownerId', op: 'eq', value: demoActor.userId }, { field: 'requestId', op: 'eq', value: 'demo-held-benefits-v1-0' }],
  });
  if (origins.length !== 1 || typeof origins[0].result?.id !== 'string') return false;
  const record = await memory.get<Entitlement>('entitlements', origins[0].result.id);
  if (!record || record.ownerId !== demoActor.userId || record.provider !== '演示银行' || record.kind !== 'lounge'
    || record.createdAt !== origins[0].createdAt || !Array.isArray(record.lounges)) return false;
  const created = new Date(record.createdAt);
  if (!Number.isFinite(created.getTime())) return false;
  const templates = demoLounges(todayCN(created));
  let changed = false;
  const lounges = record.lounges.map(item => {
    if (!item || typeof item !== 'object' || Object.prototype.hasOwnProperty.call(item, 'supportedBanks')) return item;
    const template = templates.find(candidate => candidate.id === item.id);
    if (!template) return item;
    const { supportedBanks: bankNames, ...legacy } = template;
    const keys = Object.keys(legacy) as Array<keyof typeof legacy>;
    if (Object.keys(item).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(item, key) && item[key] === legacy[key])) return item;
    changed = true;
    return { ...item, supportedBanks: [...bankNames!] };
  });
  if (changed) await memory.set('entitlements', record.id, { ...record, lounges });
  return changed;
}

async function seedEntitlements(service: ReturnType<typeof createService>): Promise<void> {
  const day = todayCN(new Date()), year = day.slice(0, 4);
  const common = { cardId: '', provider: '演示银行', totalUses: 6, initialUsed: 2, startsOn: `${year}-01-01`, endsOn: `${year}-12-31`,
    transferNote: '', notes: '个人手动记录示例，不代表任何真实银行权益。', lounges: [] };
  const drafts: EntitlementDraft[] = [
    { ...common, title: '机场贵宾厅（演示权益）', kind: 'lounge', transferability: 'grey', transferNote: '官方转让规则未明确，使用前请自行核实。', lounges: demoLounges(day) },
    { ...common, title: '年度体检（演示权益）', kind: 'health_check', totalUses: 1, initialUsed: 0, transferability: 'not_allowed', notes: '示例：体检套餐与预约资格需向服务方核实。' },
    { ...common, title: '洗车券（演示权益）', kind: 'other', totalUses: 3, initialUsed: 1, transferability: 'allowed', transferNote: '演示：规则明确允许赠予亲友。' },
  ];
  for (let index = 0; index < drafts.length; index++) {
    await service.execute(demoActor, { action: 'entitlement.save', payload: { draft: drafts[index] }, requestId: `demo-held-benefits-v1-${index}` });
  }
}
export async function demoService(): Promise<ReturnType<typeof createService>> {
  if(servicePromise)return servicePromise;
  servicePromise=(async()=>{
    let stored: {version:number;seed:MemorySeed}|null=null;
    try{stored=wx.getStorageSync(storageKey)||null;}catch{}
    if(stored?.version===1){
      memory=new MemoryStore(stored.seed);
      const service=createService(memory,{demo:true});
      if (!Object.prototype.hasOwnProperty.call(stored.seed, 'entitlements')) { await seedEntitlements(service); await persistDemo(); }
      else if (await annotateUneditedDemoLounges()) await persistDemo();
      return service;
    }
    const now=new Date(), day=todayCN(now),year=day.slice(0,4),month=monthOf(day);
    const first=`${year}-01-01`,end=`${year}-12-31`,monthEnd=`${month}-${lastDay(Number(year),Number(month.slice(5)))}`;
    const activity=(id:string,bankId:string,overrides:Partial<Activity>={}):Activity=>({
      id,revision:1,status:'published',publishedAt:now.toISOString(),updatedAt:now.toISOString(),publishedBy:'demo-moderator',
      title:'信用卡消费奖励（示例）',bankId,issuerIds:[`${bankId}-cn`],networks:['visa'],cardKind:'credit',cardDescription:'Visa 信用卡',
      frequency:'monthly',startsOn:first,endsOn:end,target:3,unit:'笔',currency:'CNY',rewardMinor:2000,rewardKind:'cashback',scope:'user',
      requiresRegistration:true,requiresInvitation:false,conditions:'每笔满 100 元，本期累计 3 笔。此为演示规则。',sourceUrl:'',sourceNote:'演示数据，不代表银行真实活动。',
      entrance:{kind:'guide',label:'入口指引',instructions:'银行 App → 信用卡 → 优惠活动（示意）',imageIds:[]},...overrides,
    });
    const activities:Activity[]=[
      activity('monthly','cmb',{title:'每月消费 3 笔返 20 元',entrance:{kind:'web',label:'招商信用卡优惠总览',url:'https://cc.cmbchina.com/promotion/',instructions:'示例跳转至银行优惠总览，并非本示例活动的报名页。',imageIds:['demo-shot-cmb-rule','demo-shot-cmb-entry']}}),
      activity('quarterly','hsbc',{title:'季度消费 3 笔返 HK$80',issuerIds:['hsbc-hk'],frequency:'quarterly',currency:'HKD',rewardMinor:8000,conditions:'本季度完成 3 笔合资格消费。演示规则。',entrance:{kind:'web',label:'汇丰香港优惠总览',url:'https://www.redhotoffers.hsbc.com.hk/tc/home/',instructions:'示例跳转至银行优惠总览。',imageIds:['demo-shot-hsbc-rule']}}),
      activity('annual','boc',{title:'餐饮满 MOP$200 返 MOP$50',issuerIds:['boc-mo'],networks:['mastercard'],cardDescription:'Mastercard 信用卡',frequency:'yearly',target:1,unit:'次',currency:'MOP',rewardMinor:5000,conditions:'完成一次指定消费，每卡每年一次。演示规则。',scope:'card'}),
      activity('instant','cmb',{title:'周末餐饮满 100 减 30 元',frequency:'once',startsOn:`${month}-01`,endsOn:monthEnd,target:1,unit:'次',rewardMinor:3000,rewardKind:'discount',requiresRegistration:false,requiresInvitation:true,conditions:'受邀用户在指定商户消费立减，演示规则。'}),
      ...banks.filter(bank=>!['cmb','hsbc','boc'].includes(bank.id)).map((bank,i)=>activity(`extra-${bank.id}`,bank.id,{title:`${bank.shortName}消费礼（示例）`,rewardMinor:(i+1)*1000,requiresRegistration:false})),
    ];
    const cards:Card[]=[['cmb','cmb-cn','visa'],['hsbc','hsbc-hk','visa'],['boc','boc-mo','mastercard']].map(([bankId,issuerId,network],index)=>({id:`demo-card-${bankId}`,ownerId:demoActor.userId,bankId,issuerId,network:network as Card['network'],kind:'credit',nickname:['日常消费卡','香港消费卡','澳门消费卡'][index],createdAt:now.toISOString()}));
    memory=new MemoryStore({activities:Object.fromEntries(activities.map(item=>[item.id,item])),cards:Object.fromEntries(cards.map(item=>[item.id,item])),assets:Object.fromEntries(demoScreenshots(now.toISOString()).map(item=>[item.id,item]))});
    const service=createService(memory,{demo:true});
    let sequence=0;
    const command=async<K extends keyof Commands>(action:K,payload:Commands[K])=>service.execute(demoActor,{action,payload,requestId:`seed-${++sequence}`}) as Promise<MutationResult>;
    const monthly=await command('activity.join',{activityId:'monthly'});
    await command('participation.progress',{participationId:monthly.id,progress:2,registered:true});
    const quarterly=await command('activity.join',{activityId:'quarterly'});
    await command('participation.complete',{participationId:quarterly.id});
    await command('participation.expected',{participationId:quarterly.id,expectedOn:addDays(day,12)});
    const annual=await command('activity.join',{activityId:'annual',cardId:'demo-card-boc'});
    await command('participation.progress',{participationId:annual.id,progress:0,registered:true});
    for(const [index,card] of cards.entries()){
      const dueOn=addDays(day,index+3);
      const statementDay=Math.min(6+index,Number(day.slice(8)));
      await command('card.save',{...card,billing:{statementDay,dueDay:Number(dueOn.slice(8)),dueMonthOffset:dueOn.slice(0,7)>month?1:0,dueOn,remindDays:3}});
    }
    const previousDate=addMonths(day,-1), previousActivity={...activities[0],startsOn:`${Number(year)-1}-01-01`},period=periodFor(previousActivity,previousDate)!;
    const prior:Participation={id:'demo-prior-pending',ownerId:demoActor.userId,activityId:'monthly',activityRevision:1,periodKey:period.periodKey,startsOn:period.startsOn,endsOn:period.endsOn,scopeKey:'user',snapshot:previousActivity,stage:'completed',progress:3,registeredAt:previousDate,startedAt:previousDate,completedAt:previousDate,expectedOn:day,receivedOn:null,receivedMinor:null,version:1,createdAt:new Date(`${previousDate}T04:00:00Z`).toISOString(),updatedAt:now.toISOString()};
    await memory.set('participations',prior.id,prior);
    await seedEntitlements(service);
    await persistDemo();
    return service;
  })();
  try{return await servicePromise;}catch(error){servicePromise=null;throw error;}
}
export async function persistDemo(): Promise<void> {
  if(memory)wx.setStorageSync(storageKey,{version:1,seed:await memory.exportSeed()});
}
export function resetDemoCache(): void { servicePromise=null; }

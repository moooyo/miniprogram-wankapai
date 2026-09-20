import type { Activity, Actor, Card, Commands, MutationResult, Participation } from '../../shared/contracts';
import { banks } from '../../shared/catalog';
import { MemoryStore, MemorySeed } from '../../domain/memory-store';
import { createService } from '../../domain/service';
import { addDays, addMonths, lastDay, monthOf, periodFor, todayCN } from '../../domain/calendar';

export const demoActor: Actor = {userId:'demo-user',isModerator:false,demo:true};
const storageKey='card-benefits.native.demo.v1';
let servicePromise: Promise<ReturnType<typeof createService>>|null=null;
let memory: MemoryStore;
export async function demoService(): Promise<ReturnType<typeof createService>> {
  if(servicePromise)return servicePromise;
  servicePromise=(async()=>{
    let stored: {version:number;seed:MemorySeed}|null=null;
    try{stored=wx.getStorageSync(storageKey)||null;}catch{}
    if(stored?.version===1){memory=new MemoryStore(stored.seed);return createService(memory,{demo:true});}
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
      activity('monthly','cmb',{title:'每月消费 3 笔返 20 元',entrance:{kind:'web',label:'招商信用卡优惠总览',url:'https://cc.cmbchina.com/promotion/',instructions:'示例跳转至银行优惠总览，并非本示例活动的报名页。',imageIds:[]}}),
      activity('quarterly','hsbc',{title:'季度消费 3 笔返 HK$80',issuerIds:['hsbc-hk'],frequency:'quarterly',currency:'HKD',rewardMinor:8000,conditions:'本季度完成 3 笔合资格消费。演示规则。',entrance:{kind:'web',label:'汇丰香港优惠总览',url:'https://www.redhotoffers.hsbc.com.hk/tc/home/',instructions:'示例跳转至银行优惠总览。',imageIds:[]}}),
      activity('annual','boc',{title:'餐饮满 MOP$200 返 MOP$50',issuerIds:['boc-mo'],networks:['mastercard'],cardDescription:'Mastercard 信用卡',frequency:'yearly',target:1,unit:'次',currency:'MOP',rewardMinor:5000,conditions:'完成一次指定消费，每卡每年一次。演示规则。',scope:'card'}),
      activity('instant','cmb',{title:'周末餐饮满 100 减 30 元',frequency:'once',startsOn:`${month}-01`,endsOn:monthEnd,target:1,unit:'次',rewardMinor:3000,rewardKind:'discount',requiresRegistration:false,requiresInvitation:true,conditions:'受邀用户在指定商户消费立减，演示规则。'}),
      ...banks.filter(bank=>!['cmb','hsbc','boc'].includes(bank.id)).map((bank,i)=>activity(`extra-${bank.id}`,bank.id,{title:`${bank.shortName}消费礼（示例）`,rewardMinor:(i+1)*1000,requiresRegistration:false})),
    ];
    const cards:Card[]=[['cmb','cmb-cn','visa'],['hsbc','hsbc-hk','visa'],['boc','boc-mo','mastercard']].map(([bankId,issuerId,network],index)=>({id:`demo-card-${bankId}`,ownerId:demoActor.userId,bankId,issuerId,network:network as Card['network'],kind:'credit',nickname:['日常消费卡','香港消费卡','澳门消费卡'][index],createdAt:now.toISOString()}));
    memory=new MemoryStore({activities:Object.fromEntries(activities.map(item=>[item.id,item])),cards:Object.fromEntries(cards.map(item=>[item.id,item]))});
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
      await command('card.save',{...card,billing:{statementDay:6+index,dueDay:Number(dueOn.slice(8)),dueMonthOffset:dueOn.slice(0,7)>month?1:0,dueOn,remindDays:3}});
    }
    const previousDate=addMonths(day,-1), previousActivity={...activities[0],startsOn:`${Number(year)-1}-01-01`},period=periodFor(previousActivity,previousDate)!;
    const prior:Participation={id:'demo-prior-pending',ownerId:demoActor.userId,activityId:'monthly',activityRevision:1,periodKey:period.periodKey,startsOn:period.startsOn,endsOn:period.endsOn,scopeKey:'user',snapshot:previousActivity,stage:'completed',progress:3,registeredAt:previousDate,startedAt:previousDate,completedAt:previousDate,expectedOn:day,receivedOn:null,receivedMinor:null,version:1,createdAt:new Date(`${previousDate}T04:00:00Z`).toISOString(),updatedAt:now.toISOString()};
    await memory.set('participations',prior.id,prior);
    await persistDemo();
    return service;
  })();
  try{return await servicePromise;}catch(error){servicePromise=null;throw error;}
}
export async function persistDemo(): Promise<void> {
  if(memory)wx.setStorageSync(storageKey,{version:1,seed:await memory.exportSeed()});
}
export function resetDemoCache(): void { servicePromise=null; }

import type { Activity, Actor, ApiEnvelope, ApiRequest, Asset, Commands, CommandName, Entrance, MutationResult, Participation, Queries, QueryName, ReminderJob, Session, Wallet } from '../../shared/contracts';
import settings from '../runtime-config';
import { demoActor, demoService, persistDemo, installDesignDemoFixtures as installFixtures } from './demo';
import { entranceBehavior } from './entrance';

export class ApiError extends Error {
  constructor(public code:string,message:string,public field?:string){super(message);this.name='ApiError';}
}
export async function installDesignDemoFixtures() {
  if (settings.mode !== 'demo') throw new ApiError('FORBIDDEN', '设计验收数据仅限演示模式');
  return installFixtures();
}
let initialized=false;
let sessionCache:{value:Session;at:number}|null=null;
let sessionCacheGeneration = 0;
let sessionReadSequence = 0;
export interface CommandOptions { intentKey?: string; replayOnly?: boolean; }
interface RetryIntent { id: string; sequence: number; action: CommandName; payload: Commands[CommandName]; resources: string[]; }
interface InflightCommand { intent: RetryIntent; promise: Promise<MutationResult>; }
const inflight = new Map<string, InflightCommand>();
const retryIntents = new Map<string, RetryIntent>();
const replayInflight = new Map<string, Promise<MutationResult>>();
let intentSequence = 0;
let reminderConsentSequence = 0;
let querySequence = 0;
let walletSequence = 0;
let monthSequence = 0;
let observedMonth = '';
let observedWallet: Wallet | null = null;
let walletRelationshipsDirty = false;
const activityScopes = new Map<string, Pick<Activity, 'scope' | 'revision'>>();
const participationTracking = new Map<string, string>();
const entitlementUsages = new Map<string, string>();
const consumptionParticipations = new Map<string, string>();

function trackingResource(activityId: string, scopeKey: string): string {
  return 'tracking:' + JSON.stringify([activityId, scopeKey]);
}

function observeActivity(activity: Activity | undefined): void {
  if (!activity?.id || !['user', 'card'].includes(activity.scope)) return;
  const previous = activityScopes.get(activity.id);
  if (!previous || previous.revision <= activity.revision) activityScopes.set(activity.id, { scope: activity.scope, revision: activity.revision });
}

function observeParticipation(record: Participation | null | undefined): void {
  if (!record?.id || !record.activityId || !record.scopeKey) return;
  participationTracking.set(record.id, trackingResource(record.activityId, record.scopeKey));
  observeActivity(record.snapshot);
}

function observeMonth(month: string, sequence: number): void {
  if (sequence >= monthSequence) { observedMonth = month; monthSequence = sequence; }
}

function observeQuery<K extends QueryName>(action: K, result: Queries[K]['output'], sequence: number): void {
  if (action === 'session.get') observeMonth((result as Queries['session.get']['output']).month, sequence);
  if (action === 'wallet.get' && sequence >= walletSequence) {
    observedWallet = result as Wallet;
    walletSequence = sequence;
    walletRelationshipsDirty = false;
  }
  if (action === 'activity.get') {
    const detail = result as Queries['activity.get']['output'];
    for (const record of detail.history || []) observeParticipation(record);
    observeParticipation(detail.participation);
    observeActivity(detail.activity);
    for (const consumption of detail.consumptions || []) consumptionParticipations.set(consumption.id, consumption.participationId);
  }
  if (action === 'catalog.list') {
    for (const item of (result as Queries['catalog.list']['output']).items || []) {
      observeParticipation(item.participation);
      observeActivity(item.activity);
    }
  }
  if (action === 'dashboard.get') {
    const dashboard = result as Queries['dashboard.get']['output'];
    observeMonth(dashboard.today.slice(0, 7), sequence);
    for (const record of [...dashboard.tasks, ...dashboard.pendingRewards]) observeParticipation(record);
  }
  if (action === 'history.list') for (const record of (result as Queries['history.list']['output']).items || []) observeParticipation(record);
  if (action === 'rewards.get') for (const record of (result as Queries['rewards.get']['output']).pending || []) observeParticipation(record);
  if (action === 'entitlement.get') {
    const detail = result as Queries['entitlement.get']['output'];
    for (const usage of detail.usages) entitlementUsages.set(usage.id, detail.entitlement.id);
  }
}

function mutationResources(action: CommandName, payload: Commands[CommandName]): string[] {
  const value = payload as { id?: string; participationId?: string; activityId?: string; cardId?: string };
  if (action === 'consumption.revoke' && value.id) {
    const participationId = consumptionParticipations.get(value.id);
    return [`consumption:${value.id}`, ...(participationId ? [`participation:${participationId}`] : [])];
  }
  if (action === 'entitlement.undo' && value.id) {
    const entitlementId = entitlementUsages.get(value.id);
    return [`entitlement-usage:${value.id}`, ...(entitlementId ? [`entitlement:${entitlementId}`] : [])];
  }
  if (action.startsWith('entitlement.') && value.id) return [`entitlement:${value.id}`];
  if (action === 'bill.update' && value.id) return [`bill:${value.id}`];
  if ((action === 'card.save' || action === 'card.remove') && value.id) {
    const resources = [`card:${value.id}`];
    const cardPayload = payload as Commands['card.save'];
    if (action === 'card.save' && cardPayload.kind === 'credit' && cardPayload.billing?.dueOn !== undefined) {
      const billing = cardPayload.billing;
      if (billing.billId) resources.push(`bill:${billing.billId}`);
      else if (!cardPayload.billingAccountId && cardPayload.billingAccountId !== null && observedWallet && observedMonth
        && (billing.periodKey === undefined || billing.periodKey === observedMonth)) {
        const card = observedWallet.cards.find(row => row.id === value.id);
        const accountId = card?.billingAccountId;
        const shared = accountId && observedWallet.cards.some(row => row.id !== value.id && !row.archivedAt && row.kind === 'credit' && row.billingAccountId === accountId);
        if (accountId && !shared) {
          const bill = observedWallet.bills.find(row => row.billingAccountId === accountId && row.periodKey === observedMonth);
          if (bill) resources.push(`bill:${bill.id}`);
        }
      }
    }
    return resources;
  }
  if (action.startsWith('submission.') && value.id) return [`submission:${value.id}`];
  if (action === 'preferences.save') return ['preferences'];
  if ((action.startsWith('participation.') || action === 'reward.confirm' || action === 'reward.revoke') && value.participationId) {
    return [`participation:${value.participationId}`];
  }
  if (action === 'activity.join' && value.activityId) {
    const scope = activityScopes.get(value.activityId)?.scope;
    if (scope === 'user') return [trackingResource(value.activityId, 'user')];
    if (scope === 'card' && value.cardId) return [trackingResource(value.activityId, `card:${value.cardId}`)];
  }
  if (action === 'activity.untrack' && value.participationId) {
    const resource = participationTracking.get(value.participationId);
    if (resource) return [resource];
  }
  return [];
}

function resourcesFor(intent: RetryIntent): string[] {
  return [...new Set([...intent.resources, ...mutationResources(intent.action, intent.payload)])];
}

function invalidateWalletRelationships(action: CommandName): void {
  if (action !== 'card.save' && action !== 'card.remove') return;
  walletRelationshipsDirty = true;
  walletSequence = ++querySequence;
}

async function executeIntent(intent: RetryIntent, onDispatch: () => void): Promise<unknown> {
  const payload = intent.payload as Commands['card.save'];
  const correctsBilling = intent.action === 'card.save' && !!payload.id && payload.billing?.dueOn !== undefined;
  const usesWallet = ['card.save', 'card.remove', 'bill.update'].includes(intent.action);
  if (correctsBilling || (usesWallet && walletRelationshipsDirty)) {
    await Promise.all([api.query('session.get', {}), api.query('wallet.get', {})]);
    intent.resources = mutationResources(intent.action, intent.payload);
  }
  onDispatch();
  return execute({ action: intent.action, payload: intent.payload, requestId: intent.id });
}

function completeIntent(fingerprint: string, intent: RetryIntent): void {
  const resources = resourcesFor(intent);
  if (!resources.length) {
    if (retryIntents.get(fingerprint) === intent) retryIntents.delete(fingerprint);
    return;
  }
  // A confirmed later mutation retires older retry intents for the same record.
  for (const [key, candidate] of retryIntents) {
    if (candidate.sequence <= intent.sequence && resourcesFor(candidate).some(resource => resources.includes(resource))) retryIntents.delete(key);
  }
  for (const [key, candidate] of inflight) {
    if (candidate.intent.sequence < intent.sequence && resourcesFor(candidate.intent).some(resource => resources.includes(resource))) inflight.delete(key);
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function intentRequestId(intentKey: string, action: CommandName, payload: Commands[CommandName]): string {
  const text = canonical([intentKey, action, payload]);
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < text.length; index += 1) {
    for (let lane = 0; lane < words.length; lane += 1) words[lane] = Math.imul(words[lane] ^ (text.charCodeAt(index) + lane * 17), 0x01000193) >>> 0;
  }
  return 'intent_' + words.map(word => word.toString(16).padStart(8, '0')).join('');
}
export function initialize(): void {
  if(initialized)return;
  if(settings.mode==='cloud'&&settings.cloudEnvId)wx.cloud.init({env:settings.cloudEnvId,traceUser:true});
  initialized=true;
}
function requestId():string{return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`;}
function transportError(error:unknown):ApiError {
  if(error instanceof ApiError)return error;
  const detail=error as {code?:string;message?:string;field?:string;errMsg?:string};
  return new ApiError(detail.code||'NETWORK_ERROR',detail.message||'网络暂时不可用，请重试。',detail.field);
}
async function execute(request:ApiRequest):Promise<unknown> {
  initialize();
  if(settings.mode==='demo'){
    const service=await demoService();
    if(request.action==='assets.urls'){
      const assets=await service.execute(demoActor,{action:'assets.get',payload:request.payload}) as Asset[];
      return assets.map(asset=>({id:asset.id,url:asset.fileId}));
    }
    const result=await service.execute(demoActor,request);if(request.action!=='request.replay')await persistDemo();return result;
  }
  if(!settings.cloudEnvId)throw new ApiError('CONFIGURATION_REQUIRED','请先配置云开发环境。');
  const response=await wx.cloud.callFunction({name:settings.apiFunctionName||'api',data:request});
  const result=response.result as ApiEnvelope<unknown>;
  if(!result||typeof result.ok!=='boolean')throw new ApiError('INVALID_RESPONSE','服务返回异常，请稍后重试。');
  if(!result.ok)throw new ApiError(result.error.code,result.error.message,result.error.field);
  return result.data;
}
export const api={
  async query<K extends QueryName>(action:K,payload:Queries[K]['input']):Promise<Queries[K]['output']>{
    const sequence = ++querySequence;
    try {
      const result = await execute({action,payload}) as Queries[K]['output'];
      observeQuery(action, result, sequence);
      return result;
    } catch(error){throw transportError(error);}
  },
  command<K extends CommandName>(action:K,payload:Commands[K],options:CommandOptions={}):Promise<MutationResult>{
    if (options.replayOnly !== undefined && typeof options.replayOnly !== 'boolean') {
      return Promise.reject(new ApiError('INVALID_INPUT', '原操作查询方式无效，请重试。'));
    }
    if (options.intentKey !== undefined && (typeof options.intentKey !== 'string' || !options.intentKey.trim() || options.intentKey.length > 128)) {
      return Promise.reject(new ApiError('INVALID_INPUT', '操作标识无效，请重试。'));
    }
    const createsRecord = ['card.save', 'submission.save', 'submission.lead.save', 'entitlement.save'].includes(action) && (payload as { id?: string }).id === undefined;
    const receipt = payload as Commands['reward.confirm'];
    const createsReceipt = action === 'reward.confirm' && receipt.expectNew === true && receipt.participationId === undefined && receipt.expectedVersion === undefined;
    if (options.intentKey !== undefined && action !== 'reminder.authorize' && action !== 'participation.consume' && action !== 'consumption.revoke' && !createsRecord && !createsReceipt) {
      return Promise.reject(new ApiError('INVALID_INPUT', '操作标识仅用于新建表单或提醒授权。'));
    }
    if (options.replayOnly && options.intentKey === undefined) {
      return Promise.reject(new ApiError('INVALID_INPUT', '缺少原操作标识，暂时无法核实结果。'));
    }
    const serialized = JSON.stringify(payload);
    const submittedPayload = JSON.parse(serialized) as Commands[K];
    const fingerprint = options.intentKey === undefined ? action + serialized : canonical([options.intentKey, action, submittedPayload]);
    if (options.replayOnly) {
      const existing = replayInflight.get(fingerprint);
      if (existing) return existing;
      // A separate query fails closed on older servers and never joins or retires a write intent.
      const pending = execute({ action: 'request.replay', payload: {
        action, payload: submittedPayload, requestId: intentRequestId(options.intentKey!, action, submittedPayload),
      } }).then(result => {
        const value = result as Partial<MutationResult> | null;
        if (!value || typeof value.id !== 'string' || !value.id) throw new ApiError('INVALID_RESPONSE', '原操作结果暂时无法确认，请稍后重试。');
        return value as MutationResult;
      }).catch(error => { throw transportError(error); }).finally(() => {
        if (replayInflight.get(fingerprint) === pending) replayInflight.delete(fingerprint);
      });
      replayInflight.set(fingerprint, pending);
      return pending;
    }
    const existing = inflight.get(fingerprint);
    if (existing) return existing.promise;
    const intent = retryIntents.get(fingerprint) || {
      id: options.intentKey === undefined ? requestId() : intentRequestId(options.intentKey, action, submittedPayload),
      sequence: ++intentSequence, action, payload: submittedPayload, resources: mutationResources(action, submittedPayload),
    };
    retryIntents.set(fingerprint, intent);
    let mutationDispatched = false;
    const pending = executeIntent(intent, () => { mutationDispatched = true; }).then(result => {
      if (action === 'entitlement.use' && (result as MutationResult).id) {
        entitlementUsages.set((result as MutationResult).id, (submittedPayload as Commands['entitlement.use']).id);
      }
      if (action === 'participation.consume' && (result as MutationResult).id) {
        consumptionParticipations.set((result as MutationResult).id, (submittedPayload as Commands['participation.consume']).participationId);
      }
      completeIntent(fingerprint, intent);
      invalidateWalletRelationships(action);
      return result as MutationResult;
    }).catch(error => {
      const converted = transportError(error);
      if (converted.code === 'NETWORK_ERROR') invalidateWalletRelationships(action);
      if (mutationDispatched && converted.code !== 'NETWORK_ERROR' && retryIntents.get(fingerprint) === intent) retryIntents.delete(fingerprint);
      throw converted;
    }).finally(() => {
      if (inflight.get(fingerprint)?.promise === pending) inflight.delete(fingerprint);
    });
    inflight.set(fingerprint, { intent, promise: pending });
    return pending;
  },
};
export async function ensureSession(force = false):Promise<Session>{
  if(!force&&sessionCache&&Date.now()-sessionCache.at<30000)return sessionCache.value;
  const generation = sessionCacheGeneration, sequence = ++sessionReadSequence;
  const value = await api.query('session.get', {});
  // Only the latest read in the current identity generation may publish shared cache state.
  if (generation === sessionCacheGeneration && sequence === sessionReadSequence) sessionCache = { value, at: Date.now() };
  return value;
}
export async function setDemoRole(role:'user'|'moderator'):Promise<void>{
  if(settings.mode!=='demo')throw new ApiError('FORBIDDEN','正式环境不能切换身份。');
  demoActor.isModerator=role==='moderator';sessionCacheGeneration++;sessionCache=null;
}
export async function uploadImage():Promise<Asset>{
  const session=await ensureSession();
  const chosen=await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:resolve,fail:reject}));
  const file=chosen.tempFiles[0];
  if(!file||file.size<=0||file.size>5*1024*1024)throw new ApiError('INVALID_IMAGE','请选择不超过 5 MB 的图片。');
  const info=await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve,reject)=>wx.getImageInfo({src:file.tempFilePath,success:resolve,fail:reject}));
  const extension=info.type==='jpeg'?'jpg':info.type;
  const mime=({jpg:'image/jpeg',png:'image/png',webp:'image/webp'} as Record<string,string>)[extension];
  if(!mime)throw new ApiError('INVALID_IMAGE','请选择 JPG、PNG 或 WebP 图片。');
  const id=`image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
  const cloudPath=`uploads/${session.userId}/${id}.${extension}`;
  let fileId:string;
  if(settings.mode==='demo'){
    fileId=await new Promise<string>((resolve,reject)=>wx.getFileSystemManager().saveFile({tempFilePath:file.tempFilePath,success:result=>resolve(result.savedFilePath),fail:reject}));
  }else{
    const result=await wx.cloud.uploadFile({cloudPath,filePath:file.tempFilePath});fileId=result.fileID;
  }
  await api.command('asset.register',{id,fileId,cloudPath,mime,size:file.size});
  return (await api.query('assets.get',{ids:[id]}))[0];
}
export async function previewAssets(assets:Asset[],index=0,shouldOpen:()=>boolean=()=>true):Promise<void>{
  if(!shouldOpen())return;
  if(!assets.length)throw new ApiError('NOT_FOUND','暂无入口图片。');
  const selected=Number.isInteger(index)?assets[index]:undefined;
  if(!selected)throw new ApiError('NOT_FOUND','这张图片暂时无法查看，请重新读取后重试。');
  const files=await api.query('assets.urls',{ids:assets.map(asset=>asset.id)});
  if(!shouldOpen())return;
  const byId=new Map(files.filter(file=>!!file.url).map(file=>[file.id,file.url]));
  const current=byId.get(selected.id);
  if(!current)throw new ApiError('NOT_FOUND','这张图片暂时无法加载，请重新读取后重试。');
  const urls=assets.map(asset=>byId.get(asset.id)).filter((url):url is string=>!!url);
  await new Promise<void>((resolve,reject)=>wx.previewImage({urls,current,success:()=>resolve(),fail:reject}));
}
export async function openEntrance(entrance:Entrance):Promise<void>{
  const behavior=entranceBehavior(entrance);
  if(behavior==='miniprogram'){
    const options=entrance.shortLink?{shortLink:entrance.shortLink}:{appId:entrance.appId||'',path:entrance.path||''};
    await new Promise<void>((resolve,reject)=>wx.navigateToMiniProgram({...options,success:()=>resolve(),fail:reject}));return;
  }
  if((behavior==='webview'||behavior==='clipboard')&&entrance.url){
    if(behavior==='webview'){
      await wx.navigateTo({url:`/pages/web-entry/index?url=${encodeURIComponent(entrance.url)}`});return;
    }
    await new Promise<void>((resolve,reject)=>wx.setClipboardData({data:entrance.url!,success:()=>resolve(),fail:reject}));
    wx.showModal({title:'活动地址已复制',content:'可粘贴到浏览器查看。也可以按入口图片在银行 App 中参加。',showCancel:false,confirmText:'知道了'});return;
  }
  wx.showModal({title:entrance.label||'参与路径',content:entrance.instructions||'请查看活动入口图片。',showCancel:false,confirmText:'知道了'});
}
export async function requestReminder(kind:ReminderJob['kind'],entityId:string):Promise<boolean>{
  if(settings.mode==='demo'){
    wx.showModal({title:'演示提醒',content:'演示模式不发送微信消息。配置正式模板后，可以开启本期提醒。',showCancel:false,confirmText:'知道了'});return false;
  }
  const templateId=settings.templateIds[kind];
  if(!templateId){wx.showToast({title:'此类微信提醒尚未开通，站内待办仍会保留。',icon:'none'});return false;}
  const result=await new Promise<Record<string,string>>((resolve,reject)=>wx.requestSubscribeMessage({tmplIds:[templateId],success:value=>resolve(value as unknown as Record<string,string>),fail:reject}));
  const accepted=result[templateId]==='accept';
  // Every completed platform consent is a new event, even when its payload matches an uncertain earlier grant.
  const intentKey = `reminder_${(++reminderConsentSequence).toString(36)}_${requestId()}`;
  await api.command('reminder.authorize',{kind,entityId,templateId,accepted},{intentKey});
  wx.showToast({title:accepted?(kind==='new_activity'?'已申请新活动提醒':'本期提醒已申请'):'未开启微信提醒',icon:'none'});return accepted;
}

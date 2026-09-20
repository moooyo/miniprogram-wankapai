import type { Actor, ApiEnvelope, ApiRequest, Asset, Commands, CommandName, Entrance, MutationResult, Queries, QueryName, ReminderJob, Session } from '../../shared/contracts';
import settings from '../runtime-config';
import { demoActor, demoService, persistDemo } from './demo';

export class ApiError extends Error {
  constructor(public code:string,message:string,public field?:string){super(message);this.name='ApiError';}
}
let initialized=false;
let sessionCache:{value:Session;at:number}|null=null;
const inflight=new Map<string,Promise<MutationResult>>();
const retryIds=new Map<string,string>();
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
    const result=await service.execute(demoActor,request);await persistDemo();return result;
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
    try{return await execute({action,payload}) as Queries[K]['output'];}catch(error){throw transportError(error);}
  },
  command<K extends CommandName>(action:K,payload:Commands[K]):Promise<MutationResult>{
    const fingerprint=action+JSON.stringify(payload),existing=inflight.get(fingerprint);
    if(existing)return existing;
    const id=retryIds.get(fingerprint)||requestId();retryIds.set(fingerprint,id);
    const pending=execute({action,payload,requestId:id}).then(result=>{retryIds.delete(fingerprint);return result as MutationResult;}).catch(error=>{
      const converted=transportError(error);if(converted.code!=='NETWORK_ERROR')retryIds.delete(fingerprint);throw converted;
    }).finally(()=>{inflight.delete(fingerprint);});
    inflight.set(fingerprint,pending);return pending;
  },
};
export async function ensureSession():Promise<Session>{
  if(sessionCache&&Date.now()-sessionCache.at<30000)return sessionCache.value;
  const value=await api.query('session.get',{});sessionCache={value,at:Date.now()};return value;
}
export async function setDemoRole(role:'user'|'moderator'):Promise<void>{
  if(settings.mode!=='demo')throw new ApiError('FORBIDDEN','正式环境不能切换身份。');
  demoActor.isModerator=role==='moderator';sessionCache=null;
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
export async function previewAssets(assets:Asset[],index=0):Promise<void>{
  if(!assets.length)throw new ApiError('NOT_FOUND','暂无入口图片。');
  const files=await api.query('assets.urls',{ids:assets.map(asset=>asset.id)});
  const urls=files.map(file=>file.url).filter(Boolean);
  if(!urls.length)throw new ApiError('NOT_FOUND','图片暂时无法查看。');
  await new Promise<void>((resolve,reject)=>wx.previewImage({urls,current:urls[Math.min(index,urls.length-1)],success:()=>resolve(),fail:reject}));
}
export async function openEntrance(entrance:Entrance):Promise<void>{
  if(entrance.kind==='miniprogram'){
    const options=entrance.shortLink?{shortLink:entrance.shortLink}:{appId:entrance.appId||'',path:entrance.path||''};
    await new Promise<void>((resolve,reject)=>wx.navigateToMiniProgram({...options,success:()=>resolve(),fail:reject}));return;
  }
  if(entrance.kind==='web'&&entrance.url){
    const host=/^https:\/\/([^/:?#]+)/i.exec(entrance.url)?.[1].toLowerCase();
    if(settings.webViewEnabled&&host&&(settings.allowedWebViewHosts as string[]).includes(host)){
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
  await api.command('reminder.authorize',{kind,entityId,templateId,accepted});
  wx.showToast({title:accepted?(kind==='new_activity'?'已申请新活动提醒':'本期提醒已申请'):'未开启微信提醒',icon:'none'});return accepted;
}

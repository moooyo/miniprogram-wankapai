type PrivacyResolve = (result:{event:'agree'|'disagree';buttonId?:string})=>void;
const pending=new Set<PrivacyResolve>();
const listeners=new Set<(visible:boolean)=>void>();
let initialized=false;
export function initializePrivacy():void {
  if(initialized||!wx.onNeedPrivacyAuthorization)return;initialized=true;
  wx.onNeedPrivacyAuthorization(resolve=>{if(typeof resolve!=='function')return;pending.add(resolve as unknown as PrivacyResolve);listeners.forEach(listener=>listener(true));});
}
export function observePrivacy(listener:(visible:boolean)=>void):()=>void {
  listeners.add(listener);if(pending.size)listener(true);return ()=>{listeners.delete(listener);};
}
export function privacyPending():boolean{return pending.size>0;}
export function resolvePrivacy(agree:boolean):void {
  pending.forEach(resolve=>resolve(agree?{event:'agree',buttonId:'privacy-agree'}:{event:'disagree'}));
  pending.clear();listeners.forEach(listener=>listener(false));
}

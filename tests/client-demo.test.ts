import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityDraft } from '../shared/contracts';

test('native client demo persists a complete record and moderator flow across queries',async()=>{
  const storage=new Map<string,unknown>();
  (globalThis as any).wx={
    getStorageSync:(key:string)=>storage.get(key),
    setStorageSync:(key:string,value:unknown)=>storage.set(key,JSON.parse(JSON.stringify(value))),
    showToast:()=>{},showModal:()=>{},
  };
  const {api,ensureSession,setDemoRole}=await import('../miniprogram/services/api');
  const session=await ensureSession();assert.equal(session.demo,true);assert.equal(session.isModerator,false);
  const all=await api.query('catalog.list',{limit:50}),mine=await api.query('catalog.list',{mineOnly:true,limit:50});
  assert.equal(all.items.length,13);assert.equal(mine.items.length,4);
  const wallet=await api.query('wallet.get',{});assert.equal(wallet.cards.length,3);assert.equal(wallet.accounts.length,3);
  const detail=await api.query('activity.get',{activityId:'monthly'});assert.equal(detail.participation?.progress,2);
  const id=detail.participation!.id;
  const first=api.command('reward.confirm',{participationId:id,amountMinor:1875,receivedOn:session.today});
  const duplicate=api.command('reward.confirm',{participationId:id,amountMinor:1875,receivedOn:session.today});
  assert.equal(first,duplicate);await first;
  const rewards=await api.query('rewards.get',{currency:'CNY'});assert.equal(rewards.totalMinor,1875);assert.equal(rewards.received.length,1);
  await api.command('reward.revoke',{participationId:id});
  assert.equal((await api.query('rewards.get',{currency:'CNY'})).totalMinor,0);
  assert((await api.query('rewards.get',{currency:'CNY'})).pending.some(record=>record.id===id));
  const draft:ActivityDraft={...all.items[0].activity,title:'测试投稿',sourceUrl:'',sourceNote:'银行 App 内可核实的优惠页面',entrance:{kind:'guide',label:'参与路径',instructions:'银行 App → 优惠',imageIds:[]}};
  const submitted=await api.command('submission.save',{draft});
  await assert.rejects(api.query('submissions.list',{moderation:true}),/权限|审核|运营/);
  await setDemoRole('moderator');
  const pending=await api.query('submission.get',{id:submitted.id});
  assert.ok(pending.draft);
  await api.command('submission.review',{id:submitted.id,decision:'publish',draft:pending.draft,sourceVerified:true,expectedVersion:pending.version});
  await setDemoRole('user');
  assert.equal((await api.query('submission.get',{id:submitted.id})).status,'published');
  assert.equal((await api.query('catalog.list',{limit:50})).items.length,14);
  assert(storage.size>0);
});

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createLocalStore } from '../server/office-store.mjs'
import { createOfficeService } from '../server/office-service.mjs'
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const runFor=(input)=>({id:randomUUID(),status:'completed',question:input.question,answer:'依据当前事项资料回答。',mode:input.mode,role:input.role,variant:'ontology',revision:input.state.revision,createdAt:new Date().toISOString(),sources:[],toolCalls:[],facts:{state:input.state}})
function fixture(options={}){
 const dir=mkdtempSync(join(tmpdir(),'office-service-')),store=createLocalStore(join(dir,'office.sqlite'))
 const service=createOfficeService({store,defaultMode:'live',...options});const token='a'.repeat(64)
 const call=async(path,body,role='lead',matterId='SUP-001')=>(await service.handle({token,method:body?'POST':'GET',path,body:body||{},query:{matterId},role})).body
 return {store,service,token,call,close:()=>{store.close();rmSync(dir,{recursive:true,force:true})}}
}
test('long model result appends to fresh data; duplicate request executes once; conversation and matter isolation',async()=>{
 const entered=deferred(),finish=deferred();let calls=0,inputSeen
 const f=fixture({chatRunner:async input=>{calls++;inputSeen=input;entered.resolve();await finish.promise;return runFor(input)}})
 try{
  const snapshot=await f.call('/snapshot'),conv=(await f.call('/conversations',{})).conversation,id=randomUUID()
  const pending=f.call('/chat',{question:'哪些订单受影响？',conversationId:conv.id,requestId:id});await entered.promise
  const duplicate=await f.call('/chat',{question:'哪些订单受影响？',conversationId:conv.id,requestId:id});assert.equal(duplicate.request.status,'running');assert.equal(calls,1)
  const p=(await f.call('/preview',{action:{type:'select_plan',supplierId:'A',planVersionId:snapshot.state.planVersions.find(p=>p.supplierId==='A').id},expectedVersion:snapshot.state.revision})).preview
  await f.call('/confirm',{previewId:p.id,expectedVersion:p.revision,idempotencyKey:randomUUID()})
  finish.resolve();const result=await pending
  const latest=await f.call('/snapshot');assert.equal(latest.state.matter.planSelection.supplierId,'A');assert.ok(latest.state.revision>result.run.revision);assert.equal(result.run.facts.state.matter.planSelection,undefined)
  const conversation=await f.call('/conversations/'+conv.id);assert.equal(conversation.runs.length,1)
  await assert.rejects(()=>f.call('/conversations/'+conv.id,undefined,'sales'),{code:'CONVERSATION_NOT_FOUND'})
  await assert.rejects(()=>f.call('/conversations/'+conv.id,undefined,'lead','SUP-007'),{code:'CONVERSATION_NOT_FOUND'})
  const second=await f.call('/chat',{question:'另一个呢？',conversationId:conv.id,requestId:randomUUID()});assert.equal(inputSeen.conversationMessages.length,2);assert.equal(second.run.status,'completed')
  assert.equal((await f.call('/snapshot',undefined,'lead','SUP-007')).state.matter.id,'SUP-007')
 }finally{finish.resolve();f.close()}
})
test('cancel prevents late success and duplicate model execution; public debug actions are denied',async()=>{
 const entered=deferred(),finish=deferred();const f=fixture({publicDemo:true,chatRunner:async input=>{entered.resolve();await finish.promise;return runFor(input)}})
 try{
  const conv=(await f.call('/conversations',{})).conversation,id=randomUUID()
  const pending=f.call('/chat',{question:'分析方案',conversationId:conv.id,requestId:id});await entered.promise
  assert.equal((await f.call('/requests/'+id+'/cancel',{})).request.status,'cancelled')
  finish.resolve();assert.equal((await pending).request.status,'cancelled')
  assert.equal((await f.call('/runs')).runs.length,0)
  for(const type of ['reset','set_arrival','arm_delivery_failure'])await assert.rejects(()=>f.call('/preview',{action:{type}}),{code:'PUBLIC_ACTION_DENIED'})
  await assert.rejects(()=>f.call('/model',{apiKey:'private'}),{code:'INTERNAL_ONLY'})
 }finally{finish.resolve();f.close()}
})
test('persisted workspace/global quotas and running leases apply across service instances',async()=>{
 const entered=deferred(),finish=deferred();const runner=async input=>{entered.resolve();await finish.promise;return runFor(input)}
 const f=fixture({chatRunner:runner,siteConcurrency:1,workspaceDailyLimit:1})
 try{
  const id=randomUUID(),pending=f.call('/chat',{question:'分析',requestId:id});await entered.promise
  const second=createOfficeService({store:f.store,chatRunner:runner,siteConcurrency:1})
  await assert.rejects(()=>second.handle({token:f.token,method:'POST',path:'/chat',body:{question:'第二问'},query:{},role:'lead'}),{code:'MODEL_BUSY'})
  await assert.rejects(()=>second.handle({token:'b'.repeat(64),method:'POST',path:'/chat',body:{question:'其他空间'},query:{},role:'lead'}),{code:'MODEL_CAPACITY'})
  finish.resolve();await pending
  await assert.rejects(()=>f.call('/chat',{question:'超额查询'}),{code:'WORKSPACE_DAILY_LIMIT'})
 }finally{finish.resolve();f.close()}
})
test('expired persisted attempt becomes failed; late output cannot revive it',async()=>{
 const entered=deferred(),finish=deferred();const f=fixture({requestLeaseMs:25,chatRunner:async input=>{entered.resolve();await finish.promise;return runFor(input)}})
 try{
  const id=randomUUID(),pending=f.call('/chat',{question:'超时测试',requestId:id});await entered.promise
  await new Promise(r=>setTimeout(r,40));assert.equal((await f.call('/requests/'+id)).request.status,'failed')
  finish.resolve();assert.equal((await pending).run.status,'failed');assert.equal((await f.call('/runs')).runs.length,1)
 }finally{finish.resolve();f.close()}
})

test('cancel before registration persists a tombstone and prevents late paid execution',async()=>{
 let calls=0;const f=fixture({chatRunner:async input=>{calls++;return runFor(input)}})
 try{const conv=(await f.call('/conversations',{})).conversation,id=randomUUID();const cancelled=await f.call('/requests/'+id+'/cancel',{conversationId:conv.id,question:'提前取消'});assert.equal(cancelled.request.status,'cancelled');const result=await f.call('/chat',{conversationId:conv.id,requestId:id,question:'提前取消'});assert.equal(result.request.status,'cancelled');assert.equal(calls,0);assert.equal((await f.call('/runs')).runs.length,0)}finally{f.close()}
})
test('default global concurrency is four across separate visitor spaces',async()=>{
 const entered=deferred(),finish=deferred();let calls=0;const f=fixture({chatRunner:async input=>{if(++calls===4)entered.resolve();await finish.promise;return runFor(input)}});let running=[]
 try{running=['a','b','c','d'].map(c=>f.service.handle({token:c.repeat(64),method:'POST',path:'/chat',body:{question:'并发额度验收',requestId:randomUUID()},role:'lead'}));await entered.promise;await assert.rejects(()=>f.service.handle({token:'e'.repeat(64),method:'POST',path:'/chat',body:{question:'第五个请求'},role:'lead'}),{code:'MODEL_CAPACITY'});assert.equal(calls,4);finish.resolve();await Promise.all(running)}finally{finish.resolve();await Promise.allSettled(running);f.close()}
})
test('default daily boundaries enforce 40 per visitor and 200 for the site',async()=>{
 let calls=0;const f=fixture({chatRunner:async input=>{calls++;return runFor(input)}})
 try{const today=new Date().toISOString().slice(0,10);await f.store.quota(q=>{q.day=today;q.count=199});await f.call('/chat',{question:'第200次'});assert.equal(calls,1);await assert.rejects(()=>f.call('/chat',{question:'超出全站额度'}),{code:'MODEL_DAILY_LIMIT'});await f.store.quota(q=>{q.count=0});await f.store.transact(f.token,ws=>{ws.modelQuota={day:today,count:40}});await assert.rejects(()=>f.call('/chat',{question:'超出空间额度'}),{code:'WORKSPACE_DAILY_LIMIT'});assert.equal(calls,1)}finally{f.close()}
})

test('identical request IDs in two visitor spaces never share cancellation controllers',async()=>{
 const entered=deferred(),finish=deferred();const inputs=[];const f=fixture({chatRunner:async input=>{inputs.push(input);if(inputs.length===2)entered.resolve();await finish.promise;return runFor(input)}});let one,two
 try{const id='same-request-id-across-spaces';one=f.call('/chat',{question:'访客一',requestId:id});two=f.service.handle({token:'b'.repeat(64),method:'POST',path:'/chat',body:{question:'访客二',requestId:id},role:'lead'});await entered.promise;await f.call('/requests/'+id+'/cancel',{});assert.equal(inputs.find(i=>i.question==='访客一').signal.aborted,true);assert.equal(inputs.find(i=>i.question==='访客二').signal.aborted,false);finish.resolve();assert.equal((await one).request.status,'cancelled');assert.equal((await two).body.run.status,'completed')}finally{finish.resolve();await Promise.allSettled([one,two]);f.close()}
})

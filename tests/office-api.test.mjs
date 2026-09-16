import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createOfficeServer } from '../server/office-server.mjs'

test('HTTP full chain: both plan review, preview/idempotency, isolation, restart, history and public configuration boundary', async () => {
 const dir=mkdtempSync(join(tmpdir(),'office-api-')); let server,base
 async function start(){server=createOfficeServer({dbPath:join(dir,'office.sqlite'),defaultMode:'rules'});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api/office`}
 async function stop(){await new Promise(r=>server.close(r));server=null}
 function client(){let cookie='';return async(path,body,role='lead')=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'X-Demo-Role':role,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:r.status,body:await r.json()}}}
 await start();const a=client(),b=client()
 const prepare=async(action,role='lead')=>(await a('/preview',{action},role)).body.preview
 const confirm=async(p,role='lead',key=randomUUID())=>a('/confirm',{previewId:p.id,expectedVersion:p.revision,idempotencyKey:key},role)
 async function act(action,role='lead'){const p=await prepare(action,role);assert.equal(p.allowed,true,p.reason);const r=await confirm(p,role);assert.equal(r.status,200,JSON.stringify(r.body));return r.body}
 try{
  const initial=(await a('/snapshot')).body;assert.equal(initial.matters.length,4);assert.equal(initial.analysis.riskCount,1)
  const independent=(await b('/snapshot')).body;assert.notEqual(initial.workspaceId,independent.workspaceId)
  const version=initial.state.planVersions.find(p=>p.supplierId==='A')
  const p=await prepare({type:'select_plan',supplierId:'A',planVersionId:version.id});assert.equal((await a('/snapshot')).body.state.matter.planSelection,undefined)
  assert.equal((await confirm(p,'sales')).status,403)
  const key=randomUUID(),selected=await confirm(p,'lead',key);assert.equal(selected.status,200)
  assert.deepEqual((await confirm(p,'lead',key)).body,selected.body)
  assert.equal((await confirm(p)).status,409)
  assert.equal((await prepare({type:'approve_keep_a'})).allowed,false,'A must be reviewed')
  assert.equal((await a('/preview',{action:{type:'request_quality'},expectedVersion:initial.state.revision})).status,409)
  await act({type:'request_quality'})
  await act({type:'accept_task',taskId:'T-QA'},'quality');await act({type:'start_task',taskId:'T-QA'},'quality')
  await act({type:'submit_quality',taskId:'T-QA',result:'approved',evidence:'合成凭据：当前方案已人工核对'},'quality')
  await act({type:'approve_keep_a'});await act({type:'send_tasks'})
  assert.equal((await prepare({type:'close_matter'})).allowed,false)
  for(const [role,taskId] of [['procurement','T-PUR'],['sales','T-SALES']]){
   await act({type:'accept_task',taskId},role);await act({type:'start_task',taskId},role)
   await act({type:'submit_receipt',taskId,evidence:'合成回执：本岗位已核对处理安排'},role)
  }
  const closed=await act({type:'close_matter'});assert.equal(closed.state.matter.status,'closed')
  await stop();await start();assert.equal((await a('/snapshot')).body.state.matter.status,'closed');assert.equal((await b('/snapshot')).body.state.revision,independent.state.revision)
  assert.equal((await a('/graph')).body.revision,closed.state.revision)
  assert.equal((await a('/relations?depth=3')).status,422)
  const conv=(await a('/conversations',{})).body.conversation
  const chat=await a('/chat',{question:'延期影响哪些订单？',conversationId:conv.id,requestId:randomUUID()})
  assert.equal(chat.body.run.status,'completed');assert.equal((await a('/conversations/'+conv.id)).body.runs.length,1)
  assert.equal((await b('/conversations/'+conv.id)).status,404)
  assert.equal((await a('/model',{apiKey:'should-never-be-stored'})).status,403)
  assert.equal((await a('/compare',{question:'internal'})).status,403)
  assert.equal((await a('/snapshot?matterId=SUP-007')).body.state.matter.id,'SUP-007')
  const cross=await fetch(base+'/snapshot',{headers:{Origin:'https://evil.example'}});assert.equal(cross.status,403)
 }finally{if(server)await stop();rmSync(dir,{recursive:true,force:true})}
})

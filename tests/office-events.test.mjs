import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {createEventStates,eventRoles} from '../server/office-events.mjs'
import {createSeedMatters} from '../server/office-seeds.mjs'
import {analyze,applyAction,previewAction,getDocuments} from '../server/office-domain.mjs'
import {presentMatter} from '../server/office-presentation.mjs'
import {projectOffice} from '../server/office-ontology.mjs'
import {runOfficeChat} from '../server/office-model.mjs'
import {createOfficeServer} from '../server/office-server.mjs'

test('event live model uses only event sources and fails visibly on invalid references or HTTP failure',async t=>{
  const s=createEventStates({staged:false})[2],before=structuredClone(s),requests=[]
  let status=200,content='请先核对设备检修与排产条件。[DOC-NOTICE-SUP-009]'
  const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const provider={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test-event-only',model:'mock-event-model'}
  const run=()=>runOfficeChat({state:s,question:'设备检修如何处理？',role:'maintenance',mode:'live',provider})
  const good=await run();assert.equal(good.status,'completed');assert.equal(good.mode,'live');assert.equal(good.intent,'event');assert.ok(good.sources.every(d=>d.id.endsWith('SUP-009')))
  assert.ok(requests[0].messages[0].content.includes(s.scenario.trigger));assert.equal(good.proposal,undefined)
  content='供应商已发送。[DOC-NOTICE-SUP-001]';const foreign=await run();assert.equal(foreign.status,'failed');assert.equal(foreign.error.code,'SOURCE_INVALID');assert.equal(foreign.answer,'')
  status=503;const failed=await run();assert.equal(failed.status,'failed');assert.equal(failed.error.code,'MODEL_HTTP_ERROR');assert.equal(failed.mode,'live');assert.deepEqual(s,before)
})

test('old visitors receive added events without replacing existing tasks, conversations or receipts',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'office-event-migration-')),path=join(dir,'office.sqlite')
  let server=createOfficeServer({dbPath:path,defaultMode:'rules'})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/office/snapshot`),cookie=response.headers.get('set-cookie').split(';')[0]
  await response.json();await new Promise(r=>server.close(r))
  const db=new DatabaseSync(path),row=db.prepare('SELECT * FROM spaces').get(),raw=JSON.parse(row.state)
  delete raw.eventCatalogVersion
  for(const id of ['SUP-007','SUP-008','SUP-009','SUP-010'])delete raw.matters[id]
  const old=structuredClone(raw)
  db.prepare('UPDATE spaces SET state=? WHERE id=?').run(JSON.stringify(raw),row.id);db.close()
  server=createOfficeServer({dbPath:path,defaultMode:'rules'});await new Promise(r=>server.listen(0,'127.0.0.1',r))
  t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true})})
  const snapshot=await (await fetch(`http://127.0.0.1:${server.address().port}/api/office/snapshot`,{headers:{Cookie:cookie}})).json()
  assert.equal(snapshot.matters.length,10)
  const restored=new DatabaseSync(path),current=JSON.parse(restored.prepare('SELECT state FROM spaces WHERE id=?').get(row.id).state);restored.close()
  for(const [id,state]of Object.entries(old.matters))assert.deepEqual(current.matters[id],state)
  for(const field of ['conversations','runs','requests','idempotency','previews'])assert.deepEqual(current[field],old[field])
})

const base=id=>createEventStates({staged:false}).find(s=>s.matter.id===id)
for(const id of ['SUP-007','SUP-008','SUP-009']) for(const choice of ['A','B']) test(`${id} ${choice}: independent reviewer, dispatch, receipts, rejection and closure`,()=>{
  let s=base(id)
  const act=(type,role='lead',rest={})=>{s=applyAction(s,{type,...rest},role)}
  const plan=s.planVersions.find(p=>p.supplierId===choice)
  act('select_event_plan','lead',{planVersionId:plan.id})
  assert.equal(previewAction(s,{type:'approve_event'},'lead').allowed,false)
  act('request_event_review')
  assert.equal(s.tasks[0].assignee,s.scenario.reviewer)
  assert.equal(previewAction(s,{type:'submit_quality',taskId:'T-QA',result:'approved',evidence:'凭据'},s.scenario.reviewer).allowed,false)
  act('accept_task',s.scenario.reviewer,{taskId:'T-QA'});act('start_task',s.scenario.reviewer,{taskId:'T-QA'})
  act('submit_quality',s.scenario.reviewer,{taskId:'T-QA',result:'rejected',evidence:'当前条件不满足，保留核验记录'})
  assert.equal(previewAction(s,{type:'approve_event'},'lead').allowed,false)
  act('request_event_review');assert.equal(s.reviewHistory.length,1)
  act('accept_task',s.scenario.reviewer,{taskId:'T-QA'});act('start_task',s.scenario.reviewer,{taskId:'T-QA'})
  act('submit_quality',s.scenario.reviewer,{taskId:'T-QA',result:'approved',evidence:'补齐本方案条件的核验凭据'})
  act('approve_event')
  const tasks=s.tasks.filter(t=>t.id!=='T-QA')
  assert.deepEqual(tasks.map(t=>[t.id,t.assignee,t.title]),plan.tasks.map(t=>[t.id,t.assignee,t.title]))
  assert.ok(tasks.every(t=>t.status==='pending_delivery'))
  assert.equal(presentMatter(s,'lead').actions[0].type,'send_tasks')
  act('arm_delivery_failure');act('send_tasks')
  assert.equal(s.tasks.find(t=>t.id===tasks[0].id).status,'delivery_failed')
  act('retry_delivery','lead',{taskId:tasks[0].id});assert.equal(s.tasks.length,tasks.length+1)
  assert.equal(s.tasks.find(t=>t.id===tasks[0].id).attempts,2)
  assert.equal(previewAction(s,{type:'send_tasks'},'lead').allowed,false)
  for(const [index,t] of [...tasks].reverse().entries()){
    assert.equal(previewAction(s,{type:'accept_task',taskId:t.id},'lead').allowed,false)
    act('accept_task',t.assignee,{taskId:t.id});act('start_task',t.assignee,{taskId:t.id})
    assert.equal(previewAction(s,{type:'submit_receipt',taskId:t.id,evidence:''},t.assignee).allowed,false)
    assert.equal(previewAction(s,{type:'submit_receipt',taskId:t.id,evidence:'凭据',sourceIds:['FOREIGN']},t.assignee).allowed,false)
    act('submit_receipt',t.assignee,{taskId:t.id,evidence:`已核对：${t.title}，记录编号 ${t.id}-001`,sourceIds:[getDocuments(s)[0].id]})
    assert.equal(analyze(s).canClose,index===tasks.length-1)
    assert.equal(previewAction(s,{type:'close_matter'},'lead').allowed,index===tasks.length-1)
  }
  act('close_matter');assert.equal(s.matter.status,'closed');assert.deepEqual(s.matter.review.receiptTaskIds,tasks.map(t=>t.id))
  assert.equal(presentMatter(s,'lead').category,'closed')
  assert.ok(Object.keys(eventRoles).every(role=>presentMatter(s,role).actions.length===0))
})

test('four event types have distinct objects, real seeded transitions, scoped sources and no invented suppliers',async()=>{
  const states=createSeedMatters();assert.equal(states.length,10);assert.equal(new Set(states.map(s=>s.matter.eventType)).size,4)
  for(const s of states.filter(s=>s.scenario)){
    assert.ok(s.matter.dueAt&&s.matter.urgency&&s.matter.businessObject)
    const graph=projectOffice(s),ids=new Set(graph.objects.map(o=>o.id))
    assert.ok(graph.objects.some(o=>o.type==='BusinessObject'));assert.ok(!graph.objects.some(o=>o.type==='Supplier'||o.type==='Material'))
    assert.ok(graph.relations.every(e=>ids.has(e.from)&&ids.has(e.to)))
    for(const obj of graph.objects){const fields=graph.model.types.find(t=>t.id===obj.type).properties.map(p=>p.id);for(const key of Object.keys(obj.properties))assert.ok(fields.includes(key),obj.type+'.'+key)}
    assert.ok(graph.sources.every(d=>d.id.endsWith(s.matter.id)))
    const before=structuredClone(s)
    const run=await runOfficeChat({state:s,question:'影响和处理方案是什么？',role:s.scenario.reviewer,mode:'rules'})
    assert.equal(run.status,'completed');assert.equal(run.intent,'event');assert.ok(run.answer.includes(s.scenario.trigger));assert.deepEqual(s,before)
  }
  const events=states.filter(s=>s.scenario)
  assert.deepEqual(new Set(events.map(s=>presentMatter(s,'lead').category)),new Set(['warning','processing','closed']))
})

test('event HTTP confirmation remains versioned, idempotent, isolated and restart persistent',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'office-event-test-'))
  let server
  t.after(async()=>{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true})})
  const start=async()=>{server=createOfficeServer({dbPath:join(dir,'demo.sqlite'),defaultMode:'rules'});await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`}
  let url=await start(),cookie=''
  const call=async(path,body,id='SUP-007',role='lead')=>{const r=await fetch(url+'/api/office'+path+'?matterId='+id,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-Demo-Role':role},...(body?{body:JSON.stringify(body)}:{})});cookie||=r.headers.get('set-cookie')?.split(';')[0];return {status:r.status,body:await r.json()}}
  const initial=(await call('/snapshot')).body, untouched=initial.matters.find(s=>s.state.matter.id==='SUP-001').state
  const pre=(await call('/preview',{expectedVersion:initial.state.revision,action:{type:'select_event_plan',planVersionId:initial.state.planVersions[0].id}})).body.preview
  assert.equal(pre.allowed,true)
  const payload={previewId:pre.id,expectedVersion:pre.revision,idempotencyKey:randomUUID()}
  const first=await call('/confirm',payload), repeat=await call('/confirm',payload)
  assert.equal(first.status,200);assert.deepEqual(repeat.body.state,first.body.state)
  assert.equal((await call('/confirm',{...payload,idempotencyKey:randomUUID()})).status,409)
  assert.equal((await call('/preview',{expectedVersion:1,action:{type:'request_event_review'}})).status,409)
  assert.equal((await call('/confirm',payload,'SUP-008')).status,409)
  assert.deepEqual((await call('/snapshot',undefined,'SUP-001')).body.state,untouched)
  await new Promise(r=>server.close(r));url=await start()
  assert.deepEqual((await call('/snapshot')).body.state,first.body.state)
})

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createState,applyAction,analyze,factsSignature,migrateState,getDocuments} from '../server/office-domain.mjs';
import {createSeedMatters} from '../server/office-seeds.mjs';
import {projectOffice} from '../server/office-ontology.mjs';
import {runOfficeChat} from '../server/office-model.mjs';
const act=(s,type,role='lead',args={})=>applyAction(s,{type,...args},role);
function review(s,result='approved'){s=act(s,'request_quality');s=act(s,'accept_task','quality',{taskId:'T-QA'});s=act(s,'start_task','quality',{taskId:'T-QA'});return act(s,'submit_quality','quality',{taskId:'T-QA',result,evidence:'所选版本人工核验说明与凭据'})}
test('six independent seeded matters use actual transitions, isolated orders and graph source endpoints',()=>{
 const matters=createSeedMatters().filter(s=>!s.scenario);assert.equal(matters.length,6);assert.equal(new Set(matters.flatMap(s=>s.orders.map(o=>o.id))).size,12);
 assert.deepEqual(matters.map(s=>[Boolean(s.matter.planSelection),Boolean(analyze(s).executionApproved),s.matter.status]),[[false,false,'open'],[true,false,'open'],[true,false,'open'],[true,true,'open'],[true,true,'open'],[true,true,'closed']]);
 for(const state of matters){const graph=projectOffice(state),ids=new Set(graph.objects.map(o=>o.id));assert.ok(graph.relations.every(e=>ids.has(e.from)&&ids.has(e.to)));assert.ok(graph.sources.every(d=>state.matter.id==='SUP-001'||d.id.endsWith(state.matter.id)));assert.ok(graph.relations.some(r=>r.type==='decisionSource'));assert.ok(state.tasks.every(t=>t.planVersionId===state.matter.planSelection.planVersionId))}
 const before=structuredClone(matters.slice(1));act(matters[0],'select_plan','lead',{supplierId:'A'});assert.deepEqual(matters.slice(1),before);
});
test('new draft selection invalidates prior review, preserves provenance, and rejects stale or foreign plan',()=>{
 let s=review(act(createState(),'select_plan','lead',{supplierId:'A'}));const original=structuredClone(s.planReviews);
 const p={...s.planVersions[0],id:'A-adjusted',title:'A反馈调整',summary:'保留 A 并跟进到料风险',origin:'model',feedback:'保留供货关系',parentVersionId:s.planVersions[0].id,factsSignature:factsSignature(s)};s.planVersions.push(p);
 assert.equal(s.matter.planSelection.planVersionId,'SUP-001-A-v1','draft creation changes no selection');
 s=act(s,'select_plan','lead',{supplierId:'A',planVersionId:p.id});assert.throws(()=>act(s,'approve_keep_a'),{code:'QUALITY_NOT_APPROVED'});assert.deepEqual(s.planReviews,original);assert.match(s.matter.planSelection.reason,/保留 A/);
 s=review(s,'rejected');assert.throws(()=>act(s,'approve_keep_a'),{code:'QUALITY_NOT_APPROVED'});s=review(s);s=act(s,'approve_keep_a');assert.equal(s.matter.executionApproval.planVersionId,p.id);assert.ok(s.tasks.every(t=>t.planVersionId===p.id));assert.throws(()=>act(s,'select_plan','lead',{supplierId:'B'}),{code:'PLAN_LOCKED'});
 const changed=act(createState(),'set_arrival','lead',{supplierId:'A',day:9});changed.planVersions.push(p);assert.throws(()=>act(changed,'select_plan','lead',{supplierId:'A',planVersionId:p.id}),{code:'PLAN_STALE'});assert.throws(()=>act(createState(),'select_plan','lead',{supplierId:'A',planVersionId:'SUP-002-A-v1'}),{code:'PLAN_INVALID'});
});
test('unfinished legacy supplier qualification never becomes current plan approval; old closed history remains',()=>{
 const old=createSeedMatters()[4];delete old.workflowVersion;delete old.planVersions;delete old.planReviews;delete old.matter.executionApproval;
 const migrated=migrateState(old);assert.deepEqual(migrated.legacyWorkflow.tasks,old.tasks);assert.equal(migrated.tasks.length,0);assert.equal(analyze(migrated).executionApproved,false);assert.throws(()=>act(migrated,'approve_keep_a'),{code:'QUALITY_NOT_APPROVED'});
 const closed=createSeedMatters()[5];delete closed.workflowVersion;const history=structuredClone(closed.tasks);const result=migrateState(closed);assert.equal(result.matter.status,'closed');assert.equal(analyze(result).executionApproved,true);assert.equal(analyze(result).canClose,false);assert.deepEqual(result.tasks,history);assert.deepEqual(migrateState(result),result);
});
async function mock(t,handler){let n=0;const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);const message=handler(body,++n);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]}))});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {requests,provider:{baseUrl:`http://127.0.0.1:${server.address().port}`,model:'fixture',apiKey:'fixture'}}}
const tools=(name,args,id='tool')=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const plan={supplierId:'A',summary:'沿用 A，预计 D6 到料，无法满足用户 D2 要求',advantages:['沿用供货安排'],risks:['到料风险'],constraints:['质量岗位核验并由负责人批准'],sourceIds:['DOC-LEDGER'],gaps:['无法满足用户要求的 D2 到料'],suggestions:['核对交期']};
test('multi-turn uses latest facts separately, forces fresh retrieval and returns exact structured drafts with feedback',async t=>{
 const state=createState(),before=structuredClone(state);const {provider,requests}=await mock(t,(_b,n)=>n===1?tools('search_documents',{}):n===2?tools('present_plans',{plans:[plan]}):{role:'assistant',content:'已生成待选草稿，无法满足 D2 约束。[DOC-LEDGER]'});
 const run=await runOfficeChat({state,question:'请调整方案',feedback:'要求 D2 到料',parentVersionId:state.planVersions[0].id,role:'lead',provider,conversationMessages:[{role:'user',content:'关注到料风险'},{role:'assistant',content:'旧答案仅供追问理解'}]});
 assert.equal(run.status,'completed',JSON.stringify(run.error));assert.equal(requests[0].tool_choice.function.name,'search_documents');assert.ok(requests[0].messages.some(m=>m.content==='旧答案仅供追问理解'));assert.match(requests[0].messages[0].content,/当前事实仅以本次工具读取为准/);assert.equal(run.planVersions[0].feedback,'要求 D2 到料');assert.equal(run.planVersions[0].parentVersionId,state.planVersions[0].id);assert.notEqual(run.planVersions[0].id,state.planVersions[0].id);assert.ok(run.planVersions[0].suggestions.every(s=>s.startsWith('待核实')));assert.deepEqual(state,before);
});
test('unsupported third supplier cannot become a draft or silently fall back',async t=>{
 const {provider}=await mock(t,(_b,n)=>n===1?tools('search_documents',{}):n===2?tools('present_plans',{plans:[{...plan,supplierId:'C'}]}):{role:'assistant',content:'已生成方案。[DOC-LEDGER]'});
 const run=await runOfficeChat({state:createState(),question:'比较方案',role:'lead',provider});assert.equal(run.status,'failed');assert.equal(run.error.code,'MODEL_PLANS_MISSING');assert.equal(run.planVersions,undefined);assert.equal(run.answer,'');assert.equal(run.mode,'live');
});

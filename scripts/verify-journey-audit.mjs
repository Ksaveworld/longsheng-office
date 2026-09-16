import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const base=process.env.OFFICE_BASE_URL || 'http://127.0.0.1:5198'
const out=resolve('docs/evidence/journey-review-20260916')
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[]
let page,ctx
const btn=(name,root=page)=>root.getByRole('button',{name,exact:true})
const work=()=>page.getByRole('region',{name:'当前办理',exact:true})
const ready=async()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='刷新数据'&&!b.disabled))
async function fresh(){await ctx?.close();ctx=await browser.newContext({viewport:{width:1440,height:1000}});page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await api('/snapshot')}
async function api(path,body,role='lead',id='SUP-001'){const r=await ctx.request.fetch(`${base}/api/office${path}?matterId=${id}`,{method:body?'POST':'GET',headers:{'X-Demo-Role':role},...(body?{data:body}:{})});assert.equal(r.status(),200,await r.text());return r.json()}
async function act(action,role='lead',id='SUP-001'){const {preview}=await api('/preview',{action},role,id);assert.ok(preview.allowed,preview.reason);return api('/confirm',{previewId:preview.id,expectedVersion:preview.revision,idempotencyKey:randomUUID()},role,id)}
async function go(route='matter-detail',id='SUP-001'){await page.goto(`${base}/office#${route}?id=${id}`);await ready();await (route==='matter-detail'?work():page.locator('main')).waitFor()}
async function select(){await act({type:'select_plan',supplierId:'B',planVersionId:'SUP-001-B-v1'})}
async function shot(name){await page.screenshot({path:resolve(out,name+'.png'),fullPage:true})}
async function stage(name,fn){await fn();checks.push(name);console.log('PASS '+name)}
try{
  await stage('任意入口识别当前状态、我的任务、责任岗位；长历史不遮住当前摘要',async()=>{
    await fresh();await select();await act({type:'request_quality'})
    const {conversation}=await api('/conversations',{})
    for(let n=0;n<4;n++)await api('/chat',{question:'请解释当前状态及会议决定，当前采用哪家供应商？',mode:'rules',conversationId:conversation.id,requestId:randomUUID()})
    for(const route of ['assistant','knowledge','matter-detail','home']){
      await go(route)
      const target=route==='matter-detail'?work():route==='home'?page.locator('.office-home-matter').filter({hasText:'SUP-001'}):page.getByRole('region',{name:'当前事项摘要',exact:true})
      await target.waitFor();const text=await target.innerText();assert.match(text,/等待质量负责人接收/);assert.match(text,/你当前无需操作/);assert.match(text,/质量负责人/)
      if(route==='assistant'){
        for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});await page.locator('.office-chat-messages').evaluate(e=>{e.scrollTop=e.scrollHeight});const box=await target.boundingBox();assert.ok(box.y>=0&&box.y+box.height<1000);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('summary-assistant-'+width)}
        await page.setViewportSize({width:1440,height:1000})
      }
      await shot('summary-'+route)
    }
  })
  await stage('读取失败明确标识旧数据、禁用办理，刷新恢复后才继续',async()=>{
    await fresh();await go();await page.route('**/api/office/snapshot?**',r=>r.abort('failed'));await btn('刷新数据').click();await page.getByRole('alert').filter({hasText:'已暂停办理'}).waitFor()
    assert.ok(await btn('选择 B 此版本',work()).isDisabled());assert.ok(await btn('比较并选择方案',work()).isDisabled());await shot('read-failure')
    await page.unroute('**/api/office/snapshot?**');await btn('刷新数据').click();await ready();assert.ok(await btn('选择 B 此版本',work()).isEnabled())
  })
  for(const persisted of [false,true])await stage(persisted?'提交已保存但响应丢失：按原编号核对，无重复申请':'提交前服务失败：不宣称成功，按原编号重试后仅生成一条申请',async()=>{
    await fresh();await select();await go();await btn('准备核验申请',work()).click();const ids=[]
    await page.route('**/api/office/confirm?**',async route=>{ids.push(route.request().postDataJSON().idempotencyKey);if(persisted){await route.fetch();await route.abort('failed')}else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_UNAVAILABLE',message:'受控测试失败'}})})})
    await btn('提交给质量负责人',page.getByRole('dialog')).click();await page.getByText('暂时无法确认提交结果。请核对提交结果，系统会使用同一提交编号，不会重复办理。',{exact:true}).waitFor()
    const before=await api('/snapshot');assert.equal(before.state.tasks.filter(t=>t.id==='T-QA').length,persisted?1:0);assert.equal(await btn('重新检查',page.getByRole('dialog')).count(),0);await shot(persisted?'response-lost':'submission-failed')
    await page.unroute('**/api/office/confirm?**');page.once('request',()=>{})
    const response=page.waitForRequest(r=>r.url().includes('/confirm')&&r.method()==='POST');await btn('核对提交结果',page.getByRole('dialog')).click();ids.push((await response).postDataJSON().idempotencyKey)
    await page.getByRole('dialog').waitFor({state:'hidden'});await ready();assert.equal(ids[0],ids[1]);const after=await api('/snapshot');assert.equal(after.state.tasks.filter(t=>t.id==='T-QA').length,1);assert.equal(after.state.events.filter(e=>e.type==='request_quality').length,1);await work().getByRole('heading',{name:'核验申请已提交'}).waitFor()
  })
  await stage('确认前版本变化被阻止；未产生核验任务，必须重新核对',async()=>{
    await fresh();await select();await go();await btn('准备核验申请',work()).click();await act({type:'set_arrival',supplierId:'A',day:9});await btn('提交给质量负责人',page.getByRole('dialog')).click();await page.getByText('事项已更新，请重新核对后确认。',{exact:true}).waitFor();assert.ok(await btn('提交给质量负责人',page.getByRole('dialog')).isDisabled());assert.equal((await api('/snapshot')).state.tasks.length,0);await shot('stale-version')
  })
  await stage('质量案例同样使用准备、核对、提交与显式角色交接；非责任岗位不能代办',async()=>{
    await fresh();await go('matter-detail','SUP-007');await work().getByRole('button',{name:/^选择：/}).first().click();await btn('确认选择',page.getByRole('dialog')).click();await page.getByRole('dialog').waitFor({state:'hidden'});await ready()
    await btn('准备核验申请',work()).click();await page.getByRole('heading',{name:'核对核验申请',exact:true}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/SUP-007-A-v1/);await btn('提交给质量负责人',page.getByRole('dialog')).click();await page.getByRole('dialog').waitFor({state:'hidden'});await ready();await work().getByRole('heading',{name:'核验申请已提交'}).waitFor();assert.equal(await btn('接收核验申请',work()).count(),0);await shot('quality-case-handoff')
    await btn('切换至质量负责人体验下一步',work()).click();await ready();assert.ok(await btn('接收核验申请',work()).isVisible());assert.match(await work().innerText(),/演示岗位 · 质量负责人/)
  })
  await stage('核验不通过仍用A，回到发起岗位补齐依据或重选',async()=>{
    await fresh();await select();await act({type:'request_quality'});await act({type:'accept_task',taskId:'T-QA'},'quality');await act({type:'start_task',taskId:'T-QA'},'quality');await act({type:'submit_quality',taskId:'T-QA',result:'rejected',evidence:'合成核验：本次缺少批次检测记录，需要补齐后重新核验。'},'quality');await go();assert.match(await work().innerText(),/核验不通过/);assert.match(await work().innerText(),/准备核验申请/);assert.equal((await api('/snapshot')).state.matter.supplierId,'A');assert.equal(await btn('批准切换至 B',work()).count(),0);await shot('review-rejected')
  })
  assert.deepEqual(errors,[])
}catch(error){errors.push(error.stack);process.exitCode=1;await shot('audit-failure');console.error(error.stack)}
finally{writeFileSync(resolve(out,'audit.json'),JSON.stringify({at:new Date().toISOString(),base,checks,errors,note:'Fault injection and setup use independent synthetic sessions. This is not a user study.'},null,2));await ctx?.close();await browser.close()}

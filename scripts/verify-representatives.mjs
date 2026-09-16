import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base='http://127.0.0.1:5198', out=resolve('docs/evidence/representatives-20260916')
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1100}})
const page=await context.newPage(), checks=[], errors=[], queryRuns=[]
page.setDefaultTimeout(20000)
page.on('pageerror', e=>errors.push(e.message))
const button=(name,root=page)=>root.getByRole('button',{name,exact:true})
const work=()=>page.getByRole('region',{name:'当前办理',exact:true})
const ready=async()=>{await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='刷新数据'&&!b.disabled))}
async function snap(id='SUP-001',role='lead') { const r=await context.request.get(`${base}/api/office/snapshot?matterId=${id}`,{headers:{'X-Demo-Role':role}});assert.equal(r.status(),200);return r.json() }
async function go(route,id='SUP-001'){await page.goto(`${base}/office#${route}?id=${id}`);await ready()}
async function shot(name){await page.screenshot({path:resolve(out,name+'.png'),fullPage:true})}
async function action(label,confirm){await button(label,work()).click();await button(confirm,page.getByRole('dialog')).click();await page.getByRole('dialog').waitFor({state:'hidden'});await ready()}
async function role(name){await page.getByRole('combobox',{name:'当前岗位'}).click();await page.getByRole('option',{name,exact:true}).click();await ready();await work().getByText('演示岗位 · '+name,{exact:true}).waitFor()}
async function stage(name,fn){await fn();checks.push(name);console.log('PASS '+name)}
try {
  await stage('首页四种类型各一例，待办/跟进/分类计数一致',async()=>{
    await go('home');const s=await snap();assert.equal(s.matters.length,4)
    assert.equal(await page.locator('.office-home-matter').count(),4)
    assert.doesNotMatch(await page.locator('.office-home').innerText(),/M-0[2-6]|SUP-010/)
    assert.equal(await page.locator('.office-home-matter').filter({hasText:'供应商交期变更'}).count(),1)
    await page.getByText('4 种业务类型 · 4 个代表事项',{exact:true}).waitFor()
    for(const [key,label] of [['warning','预警'],['processing','处理中'],['closed','已办结']]){
      const count=s.matters.filter(m=>m.presentation.category===key).length
      const filter=page.locator('button[aria-pressed]').filter({hasText:label})
      assert.equal((await filter.locator('strong').innerText()).trim(),String(count))
      await filter.click();assert.equal(await page.locator('.office-home-matter').count(),count);await filter.click()
    }
    await shot('01-home-four-cases')
  })
  await stage('事项搜索/筛选四条代表事项，旧链接可恢复且不办理隐藏事项',async()=>{
    await go('matter');await page.getByText('共 4 条',{exact:true}).waitFor()
    for(const id of ['M-02','M-03','M-04','M-05','M-06','SUP-010']){
      await page.getByRole('textbox',{name:'搜索事项'}).fill(id);await page.getByText('共 0 条',{exact:true}).waitFor()
    }
    await button('清除筛选').click()
    await page.getByLabel('事件类型',{exact:true}).selectOption('供应商交期变更');await page.getByText('共 1 条',{exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/M-01/)
    await button('清除筛选').click();await shot('02-matter-list')
    await go('matter-detail','SUP-002');await button('打开代表事项').click();await work().waitFor();await ready();assert.match(page.url(),/id=SUP-001/)
    const archived=await context.request.get(`${base}/api/office/conversations?matterId=SUP-003`);assert.equal(archived.status(),410)
  })
  const others=(await snap()).matters.filter(s=>s.state.matter.id!=='SUP-001').map(s=>s.state)
  await stage('M-01保留配套导入、两条订单、A/B与来源；真实模型查询影响',async()=>{
    await go('knowledge')
    for(const type of ['Supplier','Order'])await page.getByLabel(type==='Supplier'?'供应商 CSV':'订单 CSV').setInputFiles(resolve(`public/supply-samples/${type}.csv`))
    const importer=page.getByRole('region',{name:'导入供应样例',exact:true})
    await button('校验并预览导入',importer).click();await button('确认导入合成样例',importer).waitFor();assert.equal((await snap()).analysis.riskCount,1)
    await button('确认导入合成样例',importer).click();await page.getByRole('status').filter({hasText:'合成样例已导入'}).waitFor()
    const s=await snap();assert.equal(s.analysis.riskCount,2);assert.deepEqual(s.state.orders.map(o=>o.id),['ORD-001-01','ORD-001-02']);assert.deepEqual(s.state.suppliers.map(s=>s.id),['A','B']);assert.ok(s.state.documents.some(d=>d.id==='DOC-MEETING-01'));assert.ok(s.state.documents.some(d=>d.id==='DOC-MEETING-02'))
    await go('assistant');await page.getByPlaceholder('输入问题，或继续追问…').fill('筛选当前有到料风险且至少晚 2 天的订单，统计数量并引用导入记录；不要执行修改。')
    const response=page.waitForResponse(r=>r.url().includes('/api/office/chat')&&r.request().method()==='POST',{timeout:65000})
    await button('发送问题').click();const {run}=await (await response).json();assert.equal(run.status,'completed',JSON.stringify(run.error));assert.equal(run.mode,'live');assert.equal(run.supplyQuery.matchedCount,1);assert.equal(run.supplyQuery.records[0].id,'ORD-001-01');queryRuns.push({question:run.question,answer:run.answer,revision:run.revision,supplyQuery:run.supplyQuery,mode:run.mode})
    const result=page.getByRole('region',{name:'订单条件核对',exact:true}).last();await result.waitFor();await result.locator('article').first().getByText('查看这条订单的来源',{exact:true}).click();await result.getByRole('button',{name:'Order.csv · 第 2 行 · ORD-001-01',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/原始记录/);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await shot('03-live-impact-query')
    await button('查看办理进度').click();await work().waitFor();assert.match(page.url(),/matter-detail/)
  })
  await stage('事项中准备核验、取消不提交、最终提交后发起人明确完成',async()=>{
    await button('比较并选择方案',work()).click()
    await action('选择 B 此版本','确认选择')
    const before=await snap();await button('准备核验申请',work()).click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/方案版本/);assert.equal((await snap()).state.tasks.length,0)
    await button('取消',page.getByRole('dialog')).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await snap()).state.revision,before.state.revision)
    await action('准备核验申请','提交给质量负责人')
    await work().getByRole('heading',{name:'核验申请已提交',exact:true}).waitFor();assert.match(await work().innerText(),/等待质量负责人接收/);assert.match(await work().innerText(),/你当前无需操作/);assert.match(await work().innerText(),/当前仍采用 A/);assert.equal(await button('准备核验申请',work()).count(),0)
    const saved=await snap();assert.equal(saved.state.tasks.filter(t=>t.id==='T-QA').length,1);assert.equal(await button('选择 A 此版本',work()).count(),0)
    await shot('04-submitted-handoff');await page.reload();await ready();assert.match(await work().innerText(),/你当前无需操作/)
    for(const width of [1024,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(`05-handoff-${width}`)}
    await page.setViewportSize({width:1440,height:1100})
    await go('home');const card=page.locator('.office-home-matter').filter({hasText:'SUP-001'});await button('查看进度',card).click();await work().waitFor();await ready()
  })
  await stage('显式切换质量岗位、接收、开始、提交核验，尚未批准仍用A',async()=>{
    await button('切换至质量负责人体验下一步',work()).click();await ready();await work().getByText('演示岗位 · 质量负责人',{exact:true}).waitFor()
    await action('接收核验申请','确认接收');await button('开始核验',work()).click();await button('提交方案核验结论',work()).waitFor();await ready()
    await button('提交方案核验结论',work()).click();await page.locator('#office-evidence').fill('合成演示核验：已核对当前 B 方案版本与两个订单窗口。实际到货与交付凭据仍待补。');await button('检查提交内容').click();await button('确认提交').click();await page.getByRole('dialog').waitFor({state:'hidden'});await ready()
    assert.equal((await snap()).state.matter.supplierId,'A');assert.match(await work().innerText(),/你当前无需操作/);await shot('06-quality-complete')
  })
  await stage('负责人批准与发送分开，采购/销售独立回执，复核关闭',async()=>{
    await button('切换至业务负责人体验下一步',work()).click();await ready();await action('批准切换至 B','确认批准')
    let s=await snap();assert.equal(s.state.matter.supplierId,'B');assert.ok(s.state.tasks.filter(t=>t.id!=='T-QA').every(t=>t.status==='pending_delivery'))
    await action('确认并发送部门任务','确认发送')
    for(const name of ['采购经办','销售经办']){
      await role(name);await action('确认接收任务','确认接收');await button('开始处理任务',work()).click();await button('提交处理回执',work()).waitFor();await ready();await button('提交处理回执',work()).click()
      if(name==='采购经办'){await page.locator('#receipt-arrangement').fill('合成回执：已确认 B 供应安排及跟进窗口。');await page.locator('#receipt-pending').fill('实际到货凭据待补。')}
      else{for(const id of ['ORD-001-01','ORD-001-02'])await page.getByRole('checkbox',{name:id,exact:true}).check();await page.locator('#receipt-communication').fill('合成回执：已同步两条订单的预计到料信息。');await page.locator('#receipt-result').fill('沟通记录完成，实际交付凭据待补。')}
      await button('检查提交内容').click();await button('确认提交').click();await page.getByRole('dialog').waitFor({state:'hidden'});await ready()
    }
    await role('业务负责人');await action('复核回执并关闭事项','确认关闭');s=await snap();assert.equal(s.state.matter.status,'closed');assert.equal(s.state.orders.length,2);assert.ok(s.state.tasks.filter(t=>t.id!=='T-QA').every(t=>t.receipt));await shot('07-closed')
    await page.reload();await ready();assert.equal((await snap()).state.matter.status,'closed');assert.deepEqual((await snap()).matters.filter(s=>s.state.matter.id!=='SUP-001').map(s=>s.state),others)
  })
  await stage('办理后计数更新；所有代表案例、窄屏与岗位均可访问',async()=>{
    await go('home');await page.getByText('4 种业务类型 · 4 个代表事项',{exact:true}).waitFor();assert.equal(await page.locator('.office-home-matter').count(),4);const closed=page.locator('button[aria-pressed]').filter({hasText:'已办结'});assert.equal(await closed.locator('strong').innerText(),'1');await closed.click();assert.equal(await page.locator('.office-home-matter').count(),1);await closed.click()
    for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});for(const route of ['home','matter']){await go(route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(`08-${route}-${width}`)}}
    await page.setViewportSize({width:1440,height:1100})
    for(const id of ['SUP-007','SUP-008','SUP-009']){await go('matter-detail',id);await work().waitFor();assert.match(await work().innerText(),new RegExp(id));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
    const otherContext=await browser.newContext();const r=await otherContext.request.get(`${base}/api/office/snapshot`);const fresh=await r.json();assert.equal(fresh.state.matter.status,'open');assert.equal(fresh.matters.length,4);await otherContext.close()
    assert.deepEqual(errors,[])
  })
} catch(error){errors.push(error.stack);process.exitCode=1;await shot('failure');console.error(error.stack)}
finally{writeFileSync(resolve(out,'verification.json'),JSON.stringify({at:new Date().toISOString(),base,checks,errors,queryRuns},null,2));await browser.close()}

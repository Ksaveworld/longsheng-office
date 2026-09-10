import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { chromium } from 'playwright'
import { createOfficeServer } from '../server/office-server.mjs'

// Uses a fresh database and browser. Existing demo spaces are never reset.
const out = resolve(process.env.OFFICE_VERIFY_OUT || '.runtime/workflow-verification')
mkdirSync(out, { recursive: true })
const env = process.env.OFFICE_VERIFY_ENV
  ? parseEnv(readFileSync(process.env.OFFICE_VERIFY_ENV, 'utf8')) : {}
const live = Boolean(process.env.OFFICE_VERIFY_ENV)
const server = createOfficeServer({
  dbPath: join(mkdtempSync(join(tmpdir(), 'office-handoff-')), 'office.sqlite'),
  provider: live ? { baseUrl: env.MODEL_BASE_URL, model: env.MODEL_NAME,
    apiKey: env.MODEL_API_KEY?.replaceAll('$$', '$') } : {},
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = process.env.OFFICE_VERIFY_URL?.replace(/\/$/, '') || `http://127.0.0.1:${server.address().port}`
const apiPrefix = new URL(base).pathname.replace(/\/$/, '') + '/api/office'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)
const report = { at: new Date().toISOString(), checks: [], models: [], errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
let confirms = 0, chats = 0
page.on('request', request => {
  if (request.url().endsWith('/confirm')) confirms++
  if (request.url().endsWith('/chat')) chats++
})
const button = name => page.getByRole('button', { name, exact: true })
const region = () => page.getByRole('region', { name: '下一步处理' })
const ready = () => page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '刷新数据')
  return b && !b.disabled
})
const api = (path, body, role = 'lead') => page.evaluate(async ({ path, body, role, apiPrefix }) => {
  const response = await fetch(apiPrefix + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Demo-Role': role },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json() }
}, { path, body, role, apiPrefix })
const snapshot = async () => (await api('/snapshot')).body
const act = async action => {
  const p = (await api('/preview', { action })).body.preview
  assert(p.allowed, p.reason)
  const result = await api('/confirm', { previewId: p.id, expectedVersion: p.revision, idempotencyKey: crypto.randomUUID() })
  assert.equal(result.status, 200)
}
const go = async hash => { await page.evaluate(hash => { location.hash = hash }, hash); await ready() }
const role = async name => {
  await page.getByRole('combobox', { name: '当前岗位', exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await ready()
}
const ask = async (question = '供应商 A 延期会影响哪些订单？有几条需要处理？') => {
  await go('assistant')
  await page.locator('#office-question').fill(question)
  const response = page.waitForResponse(r => r.url().endsWith('/chat'), { timeout: 135000 })
  await button('发送问题').click()
  const result = (await (await response).json()).run
  assert.equal(result.status, 'completed', JSON.stringify(result.error))
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送问题')?.disabled)
  await region().waitFor()
  report.models.push({ mode: result.mode, proposal: result.proposal?.type || null, sources: result.sources.length })
  return result
}
const confirm = async () => {
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('button', { name: /^确认(选择|发起|批准|提交|关闭|重试)$/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  await ready()
}
const receipt = async (label, text) => {
  await button(label).click()
  await page.locator('#office-evidence').fill(text)
  await button('检查提交内容').click()
  await confirm()
}
const pane = () => page.getByRole('region', { name: '当前分析结果' })
const stay = () => assert.equal(new URL(page.url()).hash, '#assistant', 'business work stays in assistant')
async function selectPlan(supplier) {
  await page.locator('#office-plan-reason').fill(supplier === 'A' ? '保留 A，明确到料风险并由采购销售持续跟进。' : 'B 到料时间满足要求，先核验资格再申请批准。')
  await button(supplier === 'A' ? '选择 A · 沿用并跟进' : '选择 B · 准备切换').click()
  await confirm(); stay()
}
async function finishDepartments(supplier) {
  const order = supplier === 'A' ? [['销售经办', '提交销售回执'], ['采购经办', '提交采购回执']] : [['采购经办', '提交采购回执'], ['销售经办', '提交销售回执']]
  for (const [name,label] of order) {
    await role(name)
    await region().getByRole('button',{name:'开始处理',exact:true}).click(); await ready(); stay()
    await receipt(label, supplier + '方案 · ' + name + ' 已完成跟进，凭据已核对。'); stay()
    const count = (await snapshot()).analysis.missingReceipts.length
    if (count === 1) assert.equal((await snapshot()).analysis.canClose, false)
  }
  await role('业务负责人')
  await region().getByRole('button', {name:'复核并关闭事项',exact:true}).click()
  const summary = await page.getByRole('dialog').innerText()
  assert(summary.includes(supplier+'方案 · 采购经办'))
  assert(summary.includes(supplier+'方案 · 销售经办'))
  const previous = confirms
  await page.getByRole('dialog').getByRole('button',{name:'确认关闭',exact:true}).evaluate(b=>{b.click();b.click()})
  await page.getByRole('dialog').waitFor({state:'hidden'});await ready();stay()
  assert.equal(confirms-previous,1)
  const state = (await snapshot()).state
  assert.equal(state.matter.status,'closed')
  assert.equal(state.matter.review.supplierId,supplier)
  assert.equal(state.matter.review.reviewedBy,'lead')
  assert.equal(state.matter.review.receiptTaskIds.length,2)
  return state
}
async function visit() {
  if (process.env.OFFICE_VERIFY_URL) {
    const result = await page.request.post(base+'/api/office/session', {data:{accessCode:env.ACCESS_CODE?.replaceAll('$$','$')}})
    assert.equal(result.status(),200,'public demo login')
  }
  await page.goto(base+'/office');await ready()
}
try {
  await visit()
  if(!live){await api('/model',{mode:'rules'});await page.reload();await ready()}
  await button('继续处理').click()
  assert.equal(chats,0)
  assert.equal(await page.getByRole('navigation',{name:'事项八步办理进度'}).getByRole('button').count(),8)
  const first=await ask()
  const answer=await pane().innerText()
  await page.locator('#office-question').fill('尚未发送的原岗位追问')
  const beforeNavigation=chats
  await button('查看事项全过程').click();await ready()
  assert.equal(await page.getByRole('button',{name:'准备质量核验',exact:true}).count(),0,'matter is a review page')
  await button('返回业务助手').click();await ready()
  assert.equal(await pane().innerText(),answer)
  assert.equal(await page.locator('#office-question').inputValue(),'尚未发送的原岗位追问')
  await page.goBack();await ready();await page.goForward();await ready()
  assert.equal(await pane().innerText(),answer)
  assert.equal(chats,beforeNavigation)
  report.checks.push('8 steps; review/back/forward preserve exact result and unsent draft without a new model request')
  await role('质量负责人')
  assert.equal(await pane().count(),0)
  await role('业务负责人')
  assert.equal(await pane().innerText(),answer)
  assert.equal(await page.locator('#office-question').inputValue(),'尚未发送的原岗位追问')
  report.checks.push('role-scoped result and draft isolation')

  await api('/model',{mode:'rules'});await page.reload();await ready()
  let release
  const gate=new Promise(resolve=>{release=resolve})
  await page.route('**/api/office/chat',async route=>{await gate;await route.continue()})
  await page.locator('#office-question').fill('查询处理中切页和切岗位的结果保留。')
  const request=page.waitForRequest(r=>r.url().endsWith('/chat'))
  const response=page.waitForResponse(r=>r.url().endsWith('/chat'))
  await button('发送问题').click();await request
  await button('查看事项全过程').click();await ready()
  await role('质量负责人');await button('返回业务助手').click();await ready()
  release();const flight=(await(await response).json()).run
  assert.equal(flight.status,'completed')
  assert.equal(await pane().count(),0,'old role response does not leak into the new role')
  await page.unroute('**/api/office/chat')
  await role('业务负责人');await pane().waitFor()
  assert.match(await pane().innerText(),/查询处理中切页/)
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '发送问题')?.disabled)
  assert.equal(await button('发送问题').isDisabled(),false)
  report.checks.push('in-flight navigation and role switch retain result under original role')

  await page.locator('#office-plan-reason').fill('预览取消测试')
  await button('选择 B · 准备切换').click()
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
  assert.equal((await snapshot()).state.matter.planSelection,undefined)
  await selectPlan('B')
  assert.equal((await snapshot()).state.matter.supplierId,'A')
  await region().getByRole('button',{name:'准备质量核验',exact:true}).click()
  await act({type:'set_arrival',supplierId:'A',day:9})
  await page.getByRole('dialog').getByRole('button',{name:'确认发起',exact:true}).click()
  await page.getByRole('dialog').getByText(/数据已更新|事项已更新/).first().waitFor()
  assert.equal((await snapshot()).state.tasks.length,0)
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
  await region().getByRole('button',{name:'准备质量核验',exact:true}).click();await confirm();stay()
  const processingChats=chats
  await role('质量负责人')
  await region().getByRole('button',{name:'开始处理',exact:true}).click();await ready();stay()
  await receipt('提交核验结果','B资格核验通过，证据 QA-WORKFLOW');stay()
  await role('业务负责人')
  await region().getByRole('button',{name:'批准切换供应商 B',exact:true}).click();await confirm();stay()
  await finishDepartments('B')
  assert.equal(chats,processingChats,'remaining work needs no repeated model query')
  assert.equal((await snapshot()).analysis.riskCount,0)
  await page.screenshot({path:join(out,'b-closed-assistant.png'),fullPage:true})
  await button('查看事项全过程').click();await ready()
  assert.match(await page.locator('main').innerText(),/B资格核验通过/)
  assert.match(await page.locator('main').innerText(),/业务负责人/)
  await button('返回业务助手').click();await ready();await pane().waitFor()
  await page.reload();await ready();await pane().waitFor()
  assert.equal((await snapshot()).state.matter.review.supplierId,'B')
  report.checks.push('B chain entirely in assistant; both receipts visible in final confirmation; cancel/stale/double-confirm protected; reload retains review and role history')

  await page.context().clearCookies();await visit()
  await api('/model',{mode:'rules'});await page.reload();await ready()
  await button('继续处理').click();await ask('比较 A/B，选择 A 后如何跟进？')
  await selectPlan('A')
  await role('采购经办')
  assert.equal(await region().getByRole('button',{name:'确认沿用 A 并安排跟进',exact:true}).count(),0)
  await role('业务负责人')
  await region().getByRole('button',{name:'确认沿用 A 并安排跟进',exact:true}).click()
  assert.match(await page.getByRole('dialog').innerText(),/1 单存在到料风险/)
  await confirm();stay()
  assert.equal((await snapshot()).state.tasks.length,2)
  assert.equal((await snapshot()).analysis.effectiveDecisionId,'DEC-01')
  await finishDepartments('A')
  assert.equal((await snapshot()).analysis.riskCount,1)
  assert.equal((await snapshot()).state.suppliers.find(s=>s.id==='B').quality,'pending')
  await page.screenshot({path:join(out,'a-closed-assistant.png'),fullPage:true})
  report.checks.push('A confirmation requires lead; A keeps DEC-01 and risk; reverse-order receipts; no invented B quality; final review saved')

  await page.route('**/api/office/chat',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_UNAVAILABLE',message:'测试模型不可用'}})}))
  await button('发送问题').click();await button('重试原问题').waitFor()
  await button('查看事项全过程').click();await ready();await button('返回业务助手').click();await ready()
  await button('重试原问题').waitFor()
  await page.unroute('**/api/office/chat');await button('重试原问题').click()
  await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='发送问题')?.disabled)
  await pane().waitFor()
  assert.equal(await button('重试原问题').count(),0)
  report.checks.push('failure and retry survive navigation; successful retry clears failure')
  for(const width of [1440,1280,390]){
    await page.setViewportSize({width,height:1000})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
    const nav=page.getByRole('navigation',{name:'事项八步办理进度'})
    for(let i=0;i<8;i++){await nav.getByRole('button').nth(i).click();stay()}
    if(width===390)await page.screenshot({path:join(out,'mobile-review.png')})
  }
  report.checks.push('1440/1280/390 layouts; 8 navigation anchors keep assistant route')
  assert.deepEqual(report.errors,[])
  writeFileSync(join(out,'verification.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}catch(error){
  await page.screenshot({path:join(out,'failure.png'),fullPage:true})
  writeFileSync(join(out,'failure.json'),JSON.stringify({...report,error:error.stack},null,2));throw error
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}

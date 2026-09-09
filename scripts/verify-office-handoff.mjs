import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { chromium } from 'playwright'
import { createOfficeServer } from '../server/office-server.mjs'

// Uses a fresh database and browser. Existing demo spaces are never reset.
const out = resolve(process.env.OFFICE_VERIFY_OUT || '.runtime/handoff-verification')
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
const base = `http://127.0.0.1:${server.address().port}`
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
const api = (path, body, role = 'lead') => page.evaluate(async ({ path, body, role }) => {
  const response = await fetch('/api/office' + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Demo-Role': role },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json() }
}, { path, body, role })
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
  await dialog.getByRole('button', { name: /^确认(发起|批准|提交|关闭|重试)$/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  await ready()
}
const receipt = async (label, text) => {
  await button(label).click()
  await page.locator('#office-evidence').fill(text)
  await button('检查提交内容').click()
  await confirm()
}
try {
  await page.goto(base + '/office')
  await ready()
  if (!live) { await api('/model', { mode: 'rules' }); await page.reload(); await ready() }
  await button('继续处理').click()
  assert.equal(chats, 0, 'continue pre-fills without silently calling the model')
  assert.match(await page.locator('#office-question').inputValue(), /供应商 A/)
  const result = await ask()
  assert.equal(result.proposal, undefined, 'ordinary analysis must not need a model-generated action')
  await region().getByRole('button', { name: '准备质量核验', exact: true }).waitFor()
  await page.screenshot({ path: join(out, 'after-analysis.png'), fullPage: true })
  report.checks.push('home → ordinary analysis → explicit next action without model proposal')

  await region().getByRole('button', { name: '准备质量核验', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await snapshot()).state.tasks.length, 0)
  report.checks.push('cancelled preview does not create a task')

  await act({ type: 'set_arrival', supplierId: 'A', day: 9 })
  await region().getByRole('button', { name: '准备质量核验', exact: true }).click()
  await page.getByText(/事项已更新，请重新查询或核对最新任务后再操作/).waitFor()
  assert.equal((await snapshot()).state.tasks.length, 0)
  await region().getByRole('button', { name: '重新查询最新情况', exact: true }).waitFor()
  assert.equal(await region().getByRole('button', { name: '准备质量核验', exact: true }).count(), 0)
  report.checks.push('server rejects stale analysis before preview; UI refreshes and requires re-query')

  // Subsequent cases are deterministic rules-mode UI tests, even for --live runs.
  await api('/model', { mode: 'rules' }); await page.reload(); await ready()
  await ask()
  await region().getByRole('button', { name: '准备质量核验', exact: true }).click()
  await act({ type: 'set_arrival', supplierId: 'A', day: 6 })
  await page.getByRole('dialog').getByRole('button', { name: '确认发起', exact: true }).click()
  await page.getByRole('dialog').getByText(/数据已更新|事项已更新/).first().waitFor()
  assert.equal((await snapshot()).state.tasks.length, 0)
  assert(await page.getByRole('dialog').getByRole('button', { name: '确认发起', exact: true }).isDisabled())
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await ask()
  await region().getByRole('button', { name: '准备质量核验', exact: true }).click()
  const before = confirms
  await page.getByRole('dialog').getByRole('button', { name: '确认发起', exact: true }).evaluate(b => { b.click(); b.click() })
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await ready()
  assert.equal(confirms - before, 1)
  assert.equal((await snapshot()).state.tasks.length, 1)
  assert.equal(new URL(page.url()).hash, '#matter')
  await page.reload(); await ready()
  assert.equal((await snapshot()).state.tasks[0].id, 'T-QA')
  report.checks.push('stale confirmation blocked; double click sends one confirmation; success returns to matter and survives reload')

  await ask()
  assert.equal(await region().getByRole('button', { name: '准备质量核验', exact: true }).count(), 0)
  await region().getByRole('button', { name: '查看核验任务', exact: true }).click()
  assert.equal(new URL(page.url()).hash, '#matter')
  assert.equal((await snapshot()).state.tasks.length, 1)
  await role('销售经办'); await ask()
  assert.match(await region().innerText(), /质量负责人/)
  assert.equal(await region().getByRole('button').count(), 1)
  report.checks.push('existing task opens without duplication; unauthorized role gets waiting reason and view entry')

  await role('质量负责人'); await ask()
  await region().getByRole('button', { name: '开始处理', exact: true }).click()
  await page.waitForURL(/#matter$/); await ready()
  await ask()
  await region().getByRole('button', { name: '提交核验结果', exact: true }).click()
  await page.locator('#office-evidence').fill('QA-HANDOFF：合成核验通过')
  await button('检查提交内容').click(); await confirm()
  assert.equal(new URL(page.url()).hash, '#matter')
  await role('业务负责人'); await ask()
  await region().getByRole('button', { name: '批准切换供应商 B', exact: true }).click(); await confirm()
  assert.equal((await snapshot()).state.matter.supplierId, 'B')
  for (const [name, label] of [['采购经办', '提交采购回执'], ['销售经办', '提交销售回执']]) {
    await role(name); await ask()
    await region().getByRole('button', { name: '开始处理', exact: true }).click()
    await page.waitForURL(/#matter$/); await ready()
    await ask(); await receipt(label, name + '合成处理凭据')
    assert.equal(new URL(page.url()).hash, '#matter')
    if (name === '采购经办') assert.equal((await snapshot()).analysis.canClose, false)
  }
  await role('业务负责人'); await ask()
  await region().getByRole('button', { name: '复核并关闭事项', exact: true }).click(); await confirm()
  assert.equal((await snapshot()).state.matter.status, 'closed')
  await ask()
  await region().getByRole('button', { name: '查看处理记录', exact: true }).waitFor()
  report.checks.push('four-role assistant handoff completes quality → approval → both receipts → closure')

  await page.route('**/api/office/chat', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: '测试服务暂不可用' } }) }))
  await button('发送问题').click(); await button('重试原问题').waitFor()
  assert.equal(await region().getByRole('button').count(), 1)
  await page.unroute('**/api/office/chat')
  await button('重试原问题').click()
  await region().getByRole('button', { name: '查看处理记录', exact: true }).waitFor()
  report.checks.push('analysis failure exposes retry and view only; retry restores next-step region')

  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await region().scrollIntoViewIfNeeded()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false, `no page overflow at ${width}`)
    await region().getByRole('button', { name: '查看处理记录', exact: true }).click()
    assert.equal(new URL(page.url()).hash, '#matter')
    await ask()
  }
  report.checks.push('1440/1280/390px: next action reachable and no horizontal overflow')
  assert.deepEqual(report.errors, [])
  writeFileSync(join(out, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await page.screenshot({ path: join(out, 'failure.png'), fullPage: true })
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ ...report, error: error.stack }, null, 2))
  throw error
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

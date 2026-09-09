import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseEnv } from 'node:util'
import { createState, applyAction } from '../server/office-domain.mjs'
import { runOfficeChat } from '../server/office-model.mjs'

assert(process.env.OFFICE_VERIFY_ENV, 'Set OFFICE_VERIFY_ENV to an existing private provider configuration')
const env = parseEnv(readFileSync(process.env.OFFICE_VERIFY_ENV, 'utf8'))
const provider = { baseUrl: env.MODEL_BASE_URL, model: env.MODEL_NAME, apiKey: env.MODEL_API_KEY?.replaceAll('$$', '$') }
const out = resolve(process.env.OFFICE_VERIFY_OUT || '.runtime/workflow-verification')
mkdirSync(out, { recursive: true })
const selected = applyAction(createState(), { type: 'select_plan', supplierId: 'A', evidence: '保留 A，采购销售持续跟进预计到料风险。' }, 'lead')
let closed = applyAction(selected, { type: 'approve_keep_a' }, 'lead')
for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
  closed = applyAction(closed, { type: 'start_task', taskId }, role)
  closed = applyAction(closed, { type: 'submit_receipt', taskId, evidence: `${taskId} 已沟通跟进安排，尚无实际收货凭证。` }, role)
}
closed = applyAction(closed, { type: 'close_matter' }, 'lead')
const cases = [
  { name: 'A selected, not approved', state: selected, question: '比较 A/B，已选择 A 后目前是否可以关闭？下一步应由谁做什么？' },
  { name: 'A closed with remaining risk', state: closed, question: '请回顾事项当前进度、采购销售回执和最终复核结果。关闭是否表示到料风险已消失或已经到货？' },
]
const results = await Promise.all(cases.map(async item => {
  const before = JSON.stringify(item.state)
  const run = await runOfficeChat({ state: item.state, question: item.question, role: 'lead', provider, mode: 'live', signal: AbortSignal.timeout(120000) })
  assert.equal(JSON.stringify(item.state), before, 'model cannot mutate business state')
  return { name: item.name, ...run }
}))
writeFileSync(join(out, 'a-plan-model.json'), JSON.stringify(results, null, 2))
for (const run of results) {
  assert.equal(run.status, 'completed', JSON.stringify(run.error))
  assert.equal(run.mode, 'live')
  assert(run.sources.length > 0)
  const cited = [...run.answer.matchAll(/\[(DOC-[\w-]+)\]/g)].map(match => match[1])
  assert(cited.length > 0, 'expected grounded source citations')
  for (const id of cited) assert(run.sources.some(source => source.id === id), `unreturned source ${id}`)
  console.log(JSON.stringify({ name: run.name, mode: run.mode, model: run.model, answer: run.answer, sources: run.sources.length, proposal: run.proposal || null }, null, 2))
}

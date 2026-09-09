import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createState, applyAction, previewAction, analyze, getDocuments, migrateState } from '../server/office-domain.mjs'
import { projectOffice } from '../server/office-ontology.mjs'
import { runOfficeChat } from '../server/office-model.mjs'

const act = (state, type, role = 'lead', args = {}) => applyAction(state, { type, ...args }, role)
const select = (state, supplierId, role = 'procurement') => act(state, 'select_plan', role, { supplierId, evidence: `选择 ${supplierId}：已比较到料风险与质量前提，交负责人复核。` })
const receipt = (state, taskId, role) => act(act(state, 'start_task', role, { taskId }), 'submit_receipt', role, { taskId, evidence: `${taskId} 已沟通的跟进记录；未确认实际到货。` })
const qaDone = (state, result) => act(act(state, 'start_task', 'quality', { taskId: 'T-QA' }), 'submit_quality', 'quality', { taskId: 'T-QA', result, evidence: `质量检验记录：${result}` })

test('A 全链：选择不批准，负责人确认、独立回执和最终复核均可追溯，关闭仍保留风险', () => {
  const initial = createState()
  const meetings = getDocuments(initial).filter(doc => doc.id.startsWith('DOC-MEETING'))
  let state = select(initial, 'A')
  assert.equal(state.matter.supplierId, 'A')
  assert.equal(state.tasks.length, 0)
  assert.equal(analyze(state).executionApproved, false)
  assert.equal(state.matter.planSelection.revision, state.revision)
  assert.equal(state.matter.planSelection.selectedBy, 'procurement')
  assert.equal(previewAction(state, { type: 'approve_keep_a' }, 'lead').allowed, true)
  assert.equal(state.matter.followupApproval, undefined)
  state = act(state, 'approve_keep_a')
  assert.equal(analyze(state).executionSupplierId, 'A')
  assert.equal(state.matter.followupApproval.riskCount, 1)
  assert.equal(state.matter.followupApproval.reason, state.matter.planSelection.reason)
  assert.deepEqual(state.tasks.map(task => task.id), ['T-PUR', 'T-SALES'])
  assert.equal(state.suppliers.find(supplier => supplier.id === 'B').quality, 'pending')
  assert.equal(state.decisions.find(decision => decision.id === 'DEC-01').status, 'effective')
  assert.equal(state.decisions.find(decision => decision.id === 'DEC-02').status, 'conditional')
  assert.throws(() => act(state, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
  state = receipt(state, 'T-PUR', 'procurement')
  assert.deepEqual(analyze(state).missingReceipts, ['T-SALES'])
  assert.throws(() => act(state, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
  state = receipt(state, 'T-SALES', 'sales')
  assert.equal(analyze(state).canClose, true)
  const preview = previewAction(state, { type: 'close_matter' }, 'lead')
  assert.ok(preview.details.some(text => text.includes('T-PUR 已沟通')))
  assert.ok(preview.details.some(text => text.includes('T-SALES 已沟通')))
  state = act(state, 'close_matter')
  assert.equal(state.matter.review.reviewedBy, 'lead')
  assert.equal(state.matter.review.reviewedAt, state.matter.closedAt)
  assert.equal(state.matter.review.decisionId, 'DEC-01')
  assert.equal(state.matter.review.supplierId, 'A')
  assert.equal(state.matter.review.riskCount, 1)
  assert.equal(analyze(state).riskCount, 1)
  assert.equal(analyze(state).canClose, false)
  assert.equal(analyze(state).pendingActionCount, 0)
  assert.deepEqual(getDocuments(state).filter(doc => doc.id.startsWith('DOC-MEETING')), meetings)
  for (const id of ['DOC-PLAN-SELECTION', 'DOC-KEEP-A', 'DOC-CLOSE-REVIEW']) assert.ok(getDocuments(state).some(doc => doc.id === id))
  const graph = projectOffice(state)
  assert.ok(graph.relations.some(edge => edge.type === 'matterReviewedBy' && edge.to === 'Role:lead'))
  assert.ok(graph.relations.some(edge => edge.type === 'matterPlannedSupplier' && edge.to === 'Supplier:A'))
  for (const taskId of ['T-PUR', 'T-SALES']) {
    assert.ok(graph.relations.some(edge => edge.type === 'taskSupplier' && edge.from === `Task:${taskId}` && edge.to === 'Supplier:A'))
    assert.ok(!graph.relations.some(edge => edge.type === 'taskSupplier' && edge.from === `Task:${taskId}` && edge.to === 'Supplier:B'))
  }
  assert.deepEqual(migrateState(migrateState(state)), migrateState(state))
})

test('B 显式选择和旧调用隐式选择均保留质量、批准及关闭条件', () => {
  for (const initial of [createState(), select(createState(), 'B')]) {
    let state = act(initial, 'request_quality', 'procurement')
    assert.equal(state.matter.planSelection.supplierId, 'B')
    assert.equal(state.matter.supplierId, 'A')
    assert.throws(() => act(state, 'approve_switch'), { code: 'QUALITY_NOT_APPROVED' })
    state = act(qaDone(state, 'approved'), 'approve_switch')
    assert.equal(analyze(state).executionSupplierId, 'B')
    state = receipt(receipt(state, 'T-PUR', 'procurement'), 'T-SALES', 'sales')
    state = act(state, 'close_matter')
    assert.equal(state.matter.review.decisionId, 'DEC-03')
    assert.equal(state.matter.review.riskCount, 0)
    assert.equal(state.matter.followupApproval, undefined)
  }
})

test('未选择、未批准、空理由与越权不产生任务或确认', () => {
  const initial = createState()
  assert.throws(() => act(initial, 'approve_keep_a'), { code: 'PLAN_NOT_SELECTED' })
  assert.throws(() => act(initial, 'select_plan', 'procurement', { supplierId: 'A', evidence: ' ' }), { code: 'EVIDENCE_REQUIRED' })
  assert.throws(() => select(initial, 'C'), { code: 'PLAN_INVALID' })
  assert.throws(() => select(initial, 'A', 'sales'), { code: 'FORBIDDEN' })
  const selected = select(initial, 'A')
  assert.throws(() => act(selected, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
  assert.throws(() => act(selected, 'approve_keep_a', 'procurement'), { code: 'FORBIDDEN' })
  assert.throws(() => act(selected, 'approve_keep_a', 'lead', { evidence: '' }), { code: 'EVIDENCE_REQUIRED' })
  assert.throws(() => act(selected, 'request_quality'), { code: 'PLAN_MISMATCH' })
  assert.throws(() => act(selected, 'approve_switch'), { code: 'PLAN_MISMATCH' })
  assert.equal(selected.tasks.length, 0)
})

test('执行前可改选；未完成的 QA 阻止改选 A，拒绝后允许且保留原核验凭据', () => {
  let state = select(select(createState(), 'A'), 'B')
  state = act(state, 'request_quality')
  assert.throws(() => select(state, 'A'), { code: 'QUALITY_IN_PROGRESS' })
  state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
  assert.throws(() => select(state, 'A'), { code: 'QUALITY_IN_PROGRESS' })
  state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'rejected', evidence: '本轮 B 核验不通过的真实记录' })
  const priorQa = structuredClone(state.tasks[0])
  state = act(select(state, 'A'), 'approve_keep_a')
  assert.deepEqual(state.tasks.find(task => task.id === 'T-QA'), priorQa)
  assert.equal(state.suppliers.find(supplier => supplier.id === 'B').quality, 'rejected')
  state = act(receipt(receipt(state, 'T-PUR', 'procurement'), 'T-SALES', 'sales'), 'close_matter')
  assert.equal(state.matter.status, 'closed')
  assert.equal(state.decisions.find(decision => decision.id === 'DEC-02').status, 'conditional')
  const failed = act(act(createState(), 'arm_delivery_failure'), 'request_quality')
  assert.throws(() => select(failed, 'A'), { code: 'QUALITY_IN_PROGRESS' })
})

test('A 批准后锁定方案并阻止重复任务；发送失败必须重试，回执岗位隔离', () => {
  let state = act(select(act(createState(), 'arm_delivery_failure'), 'A'), 'approve_keep_a')
  assert.equal(state.tasks[0].status, 'delivery_failed')
  assert.throws(() => select(state, 'B'), { code: 'PLAN_LOCKED' })
  assert.throws(() => act(state, 'approve_keep_a'), { code: 'ALREADY_APPROVED' })
  assert.throws(() => act(state, 'request_quality'), { code: 'ALREADY_APPROVED' })
  assert.throws(() => act(state, 'approve_switch'), { code: 'ALREADY_APPROVED' })
  assert.equal(analyze(state).canClose, false)
  state = act(state, 'retry_delivery', 'procurement', { taskId: 'T-PUR' })
  assert.equal(state.tasks.length, 2)
  assert.throws(() => act(state, 'start_task', 'sales', { taskId: 'T-PUR' }), { code: 'FORBIDDEN' })
  state = receipt(receipt(state, 'T-PUR', 'procurement'), 'T-SALES', 'sales')
  assert.throws(() => act(state, 'close_matter', 'procurement'), { code: 'FORBIDDEN' })
  const missing = structuredClone(state)
  missing.tasks.find(task => task.id === 'T-PUR').receipt.evidence = ' '
  assert.equal(analyze(missing).canClose, false)
  assert.throws(() => act(missing, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
  state = act(state, 'set_arrival', 'lead', { supplierId: 'A', day: 9 })
  state = act(state, 'close_matter')
  assert.equal(state.matter.followupApproval.riskCount, 1)
  assert.equal(state.matter.review.riskCount, 2)
})

test('A 规则答复反映选择和跟进，不要求 B 核验或假称风险消除', async () => {
  const selected = select(createState(), 'A')
  const pending = await runOfficeChat({ state: selected, question: '下一步是什么', role: 'lead', mode: 'rules' })
  assert.match(pending.answer, /保留 A 尚待负责人确认/)
  assert.doesNotMatch(pending.answer, /B 质量核验待完成/)
  const approved = await runOfficeChat({ state: act(selected, 'approve_keep_a'), question: '下一步是什么', role: 'lead', mode: 'rules' })
  assert.match(approved.answer, /待补齐 T-PUR、T-SALES/)
  assert.match(approved.answer, /1 条存在到料风险/)
  assert.ok(approved.sources.some(source => source.id === 'DOC-KEEP-A'))
})

test('模型新动作只准备选择，工具暴露参数契约，不能执行或更换操作者', async t => {
  let calls = 0
  const requests = []
  const server = createServer(async (req, res) => {
    let data = ''
    for await (const chunk of req) data += chunk
    requests.push(JSON.parse(data))
    const message = calls++ === 0
      ? { role: 'assistant', content: null, tool_calls: [
        { id: 'read', type: 'function', function: { name: 'search_documents', arguments: '{}' } },
        { id: 'select', type: 'function', function: { name: 'preview_action', arguments: JSON.stringify({ action: { type: 'select_plan', supplierId: 'A', evidence: '继续采用现有合格供应商并处理到料风险' }, role: 'lead' }) } },
      ] }
      : { role: 'assistant', content: '已准备选择 A，待确认；随后仍需负责人确认跟进。[DOC-RULES]' }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ finish_reason: calls === 1 ? 'tool_calls' : 'stop', message }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const state = createState()
  const run = await runOfficeChat({ state, question: '选择 A，继续采用现有合格供应商并处理到料风险', role: 'procurement', provider: { apiKey: 'test-key', model: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}` } })
  assert.equal(run.status, 'completed')
  assert.equal(run.proposal.type, 'select_plan')
  assert.equal(run.proposal.supplierId, 'A')
  assert.equal(state.matter.planSelection, undefined)
  assert.equal(state.tasks.length, 0)
  const params = requests[0].tools.find(item => item.function.name === 'preview_action').function.parameters.properties.action.properties
  assert.ok(params.type.enum.includes('select_plan'))
  assert.ok(params.type.enum.includes('approve_keep_a'))
  assert.match(params.supplierId.description, /evidence/)
})

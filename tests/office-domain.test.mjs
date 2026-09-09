import test from 'node:test'
import assert from 'node:assert/strict'
import { createState, analyze, getDocuments, previewAction, applyAction } from '../server/office-domain.mjs'

const run = (state, type, role = 'lead', args = {}) => applyAction(state, { type, ...args }, role)
function qualityPass(state = createState()) {
  state = run(state, 'request_quality', 'procurement')
  return run(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '资格材料 QA-001 已核验' })
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child) }
  return value
}

test('初始数据与来源唯一、会议先后不覆盖有效决定', () => {
  const state = createState(), report = analyze(state)
  assert.equal(report.linkedCount, 2); assert.equal(report.riskCount, 1)
  assert.equal(report.orders[0].lateDays, 1)
  assert.equal(report.effectiveDecisionId, 'DEC-01'); assert.equal(report.conditionalDecisionId, 'DEC-02')
  assert.equal(report.options.find(item => item.supplierId === 'B').eligible, false)
  assert.equal(state.tasks.length, 0)
  const docs = getDocuments(state)
  assert.equal(new Set(docs.map(doc => doc.id)).size, docs.length)
  assert.ok(docs.every(doc => doc.text.includes(`[${doc.id}]`) && doc.source.includes('合成样例')))
})

test('完整链路：预览不执行、质量通过、负责人批准、两份回执后关闭', () => {
  let state = createState()
  const preview = previewAction(state, { type: 'request_quality' }, 'procurement')
  assert.equal(preview.allowed, true); assert.equal(state.tasks.length, 0)
  state = qualityPass(state)
  assert.equal(analyze(state).effectiveDecisionId, 'DEC-01')
  state = run(state, 'approve_switch')
  assert.equal(analyze(state).effectiveDecisionId, 'DEC-03')
  assert.equal(analyze(state).riskCount, 0)
  assert.deepEqual(state.tasks.map(task => task.id), ['T-QA', 'T-PUR', 'T-SALES'])
  assert.equal(state.decisions.find(item => item.id === 'DEC-01').status, 'superseded')
  assert.ok(getDocuments(state).some(doc => doc.id === 'DOC-DECISION-03' && doc.text.includes('QA-001')))
  state = run(state, 'start_task', 'procurement', { taskId: 'T-PUR' })
  state = run(state, 'submit_receipt', 'procurement', { taskId: 'T-PUR', evidence: '采购安排已确认' })
  state = run(state, 'submit_receipt', 'sales', { taskId: 'T-SALES', evidence: '两条订单交期已同步' })
  assert.equal(state.matter.status, 'open')
  state = run(state, 'close_matter')
  assert.equal(state.matter.status, 'closed')
  assert.ok(state.tasks.every(task => task.status === 'completed'))
  assert.match(analyze(state).nextStep, /不代表/)
  assert.ok(state.events.every(event => event.id && Number.isFinite(Date.parse(event.at))))
  assert.equal(state.revision, 8)
})

test('角色权限与资格条件由执行层校验', () => {
  const seed = createState()
  assert.throws(() => run(seed, 'approve_switch'), { code: 'QUALITY_NOT_APPROVED' })
  assert.throws(() => run(seed, 'request_quality', 'sales'), { status: 403 })
  assert.throws(() => run(seed, 'reset', 'admin'), { status: 403 })
  const passed = qualityPass()
  assert.throws(() => run(passed, 'approve_switch', 'procurement'), { status: 403 })
  assert.equal(previewAction(passed, { type: 'approve_switch' }, 'quality').allowed, false)
  const switched = run(passed, 'approve_switch')
  assert.throws(() => run(switched, 'submit_receipt', 'sales', { taskId: 'T-PUR', evidence: '越权' }), { status: 403 })
})

test('质量拒绝后不得切换，可重开同任务且历史证据保留', () => {
  let state = run(createState(), 'request_quality', 'procurement')
  state = run(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'rejected', evidence: '缺少检验报告' })
  assert.throws(() => run(state, 'approve_switch'), { code: 'QUALITY_NOT_APPROVED' })
  state = run(state, 'request_quality', 'procurement')
  assert.equal(state.tasks.length, 1)
  assert.equal(state.tasks[0].history[0].receipt.evidence, '缺少检验报告')
  assert.equal(state.suppliers[1].quality, 'pending')
  assert.equal(state.tasks[0].receipt, undefined)
  state = run(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '补齐报告后核验通过' })
  assert.equal(previewAction(state, { type: 'approve_switch' }, 'lead').allowed, true)
})

test('D9 与 D6 数据联动；切换后风险采用 B，比较仍分别计算 A/B', () => {
  let state = run(createState(), 'set_arrival', 'lead', { supplierId: 'A', day: 9 })
  assert.equal(analyze(state).riskCount, 2)
  assert.match(getDocuments(state).find(doc => doc.id === 'DOC-NOTICE').text, /D9/)
  state = run(state, 'set_arrival', 'lead', { supplierId: 'A', day: 6 })
  assert.equal(analyze(state).riskCount, 1)
  state = run(qualityPass(state), 'approve_switch')
  state = run(state, 'set_arrival', 'lead', { supplierId: 'A', day: 9 })
  assert.equal(analyze(state).riskCount, 0)
  assert.deepEqual(analyze(state).options.map(item => item.riskCount), [2, 0])
  assert.throws(() => run(state, 'set_arrival', 'lead', { supplierId: 'A', day: 9.5 }), { status: 422 })
})

test('发送失败消耗一次故障，可重试原任务且不重复创建', () => {
  let state = run(createState(), 'arm_delivery_failure')
  state = run(state, 'request_quality', 'procurement')
  assert.equal(state.failNextDelivery, false)
  assert.equal(state.tasks[0].status, 'delivery_failed')
  assert.equal(state.tasks[0].attempts, 1)
  assert.throws(() => run(state, 'request_quality', 'procurement'), { code: 'TASK_EXISTS' })
  assert.throws(() => run(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '未送达' }), { code: 'TASK_STATE_CONFLICT' })
  state = run(state, 'retry_delivery', 'quality', { taskId: 'T-QA' })
  assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0].status, 'delivered'); assert.equal(state.tasks[0].attempts, 2)
  assert.throws(() => run(state, 'retry_delivery', 'quality', { taskId: 'T-QA' }), { code: 'TASK_STATE_CONFLICT' })
})

test('送达重试上限三次；同次批准仅第一个新任务受一次故障影响', () => {
  let state = run(createState(), 'arm_delivery_failure')
  state = run(state, 'request_quality')
  for (let attempt = 2; attempt <= 3; attempt++) {
    state = run(state, 'arm_delivery_failure')
    state = run(state, 'retry_delivery', 'lead', { taskId: 'T-QA' })
  }
  assert.equal(state.tasks[0].attempts, 3)
  assert.throws(() => run(state, 'retry_delivery', 'lead', { taskId: 'T-QA' }), { code: 'RETRY_LIMIT' })
  let next = run(qualityPass(), 'arm_delivery_failure')
  next = run(next, 'approve_switch')
  assert.equal(next.tasks[1].status, 'delivery_failed')
  assert.equal(next.tasks[2].status, 'delivered')
  assert.equal(next.tasks.length, 3)
})

test('缺少回执或证据时不能关闭，重复审批不得新增决定或任务', () => {
  assert.throws(() => run(createState(), 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
  let state = run(createState(), 'request_quality')
  assert.throws(() => run(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '  ' }), { code: 'EVIDENCE_REQUIRED' })
  state = run(qualityPass(), 'approve_switch')
  assert.throws(() => run(state, 'approve_switch'), { code: 'ALREADY_APPROVED' })
  assert.throws(() => run(state, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
  state = run(state, 'submit_receipt', 'procurement', { taskId: 'T-PUR', evidence: '已确认' })
  assert.throws(() => run(state, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
})

test('冻结输入仍可预览和执行，原始会议保留，重置版本递增', () => {
  const original = deepFreeze(createState())
  const originalMeetings = getDocuments(original).filter(doc => doc.id.startsWith('DOC-MEETING'))
  const action = deepFreeze({ type: 'request_quality' })
  assert.equal(previewAction(original, action, 'procurement').allowed, true)
  const next = applyAction(original, action, 'procurement')
  assert.equal(original.revision, 1); assert.equal(original.tasks.length, 0)
  assert.equal(next.revision, 2); assert.equal(next.tasks.length, 1)
  assert.deepEqual(getDocuments(next).filter(doc => doc.id.startsWith('DOC-MEETING')), originalMeetings)
  const reset = run(next, 'reset')
  assert.equal(reset.revision, 3); assert.equal(reset.tasks.length, 0); assert.equal(reset.events.length, 1)
  assert.equal(reset.events[0].type, 'reset')
})

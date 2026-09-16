import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze, applyAction, createState, getDocuments, previewAction } from '../server/office-domain.mjs'
import { createSeedMatters } from '../server/office-seeds.mjs'
import { presentMatter } from '../server/office-presentation.mjs'

const roles = ['lead', 'procurement', 'quality', 'sales']
const act = (state, type, role = 'lead', data = {}) => applyAction(state, { type, ...data }, role)
const select = (state, supplierId = 'A') => act(state, 'select_plan', 'lead', { supplierId })
function reject(state) {
  state = act(state, 'request_quality')
  state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
  state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
  return act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'rejected', evidence: '当前版本条件尚未核实' })
}
function assertActionsAllowed(state, role, view) {
  for (const item of view.actions) {
    if (item.type === 'choose_plan') {
      assert.ok(state.planVersions.some(plan => previewAction(state, { type: 'select_plan', supplierId: plan.supplierId, planVersionId: plan.id }, role).allowed))
      continue
    }
    const action = { type: item.type, ...(item.taskId ? { taskId: item.taskId } : {}), ...(item.supplierId ? { supplierId: item.supplierId } : {}) }
    if (item.type === 'submit_quality') Object.assign(action, { result: 'approved', evidence: '人工填写的核验凭据' })
    if (item.type === 'submit_receipt') action.evidence = '人工填写的回执'
    assert.equal(previewAction(state, action, role).allowed, true, `${state.matter.id}/${role}/${item.type}`)
    assert.equal(Object.hasOwn(item, 'evidence'), false)
  }
}

test('six seeded matters expose one revision-consistent view and only guarded role actions', () => {
  const states = createSeedMatters({includeArchived:true}).filter(s=>!s.scenario)
  const original = structuredClone(states)
  assert.deepEqual(states.map(state => presentMatter(state, 'lead').stage), ['待选择', '核验中', '待批准', '待发送', '部门执行', '已办结'])
  assert.deepEqual(states.map(state => presentMatter(state, 'lead').category), ['warning', 'processing', 'processing', 'processing', 'processing', 'closed'])
  for (const state of states) for (const role of roles) {
    const view = presentMatter(state, role)
    assert.equal(view.revision, state.revision)
    assertActionsAllowed(state, role, view)
    assert.ok(view.sourceIds.every(id => getDocuments(state).some(document => document.id === id)))
    if (state.matter.id !== 'SUP-001') assert.ok(view.sourceIds.every(id => id.endsWith(state.matter.id)))
    for (const option of view.options) {
      assert.equal(option.riskCount, option.riskOrderIds.length)
      assert.equal(option.arrivalDay, analyze(state).options.find(item => item.supplierId === option.supplierId).arrivalDay)
      assert.ok(option.riskOrderIds.every(id => state.orders.some(order => order.id === id && order.materialId === state.matter.materialId && order.requiredDay < option.arrivalDay)))
    }
    assert.equal(view.events.length, state.events.length)
  }
  assert.deepEqual(states, original, 'presentation must not mutate business state, raw sources or event history')
})

test('selection is distinct from approval and only successful analysis changes the initial category', () => {
  const state = createState()
  const view = presentMatter(state, 'lead')
  assert.equal(view.title, '原料 M-01 预计延期 3 天')
  assert.equal(view.originalDay, 3)
  assert.equal(view.noticeArrivalDay, 6)
  assert.equal(view.delayDays, 3)
  assert.equal(view.earliestRequiredDay, 5)
  assert.deepEqual(view.delta, { arrivalDaysEarlier: 2, riskOrdersFewer: 1 })
  assert.deepEqual(view.actions.map(action => action.type), ['choose_plan'])
  assert.deepEqual(presentMatter(state, 'quality').actions, [])
  assert.deepEqual(presentMatter(state, 'sales').actions, [])
  const selected = presentMatter(select(state, 'B'), 'lead')
  assert.equal(selected.effectiveSupplierId, 'A')
  assert.equal(selected.selectedVersionId, 'SUP-001-B-v1')
  assert.equal(selected.approvedVersionId, undefined)
  assert.deepEqual(selected.actions.map(action => action.type), ['request_quality', 'choose_plan'])
  assert.equal(selected.stage, '待发起核验')
  assert.equal(selected.category, 'processing')
  assert.match(selected.conclusion, /生效安排仍为 A/)
  assert.equal(presentMatter({ ...state, firstAnalyzedAt: '2026-09-10T12:00:00Z' }, 'lead').category, 'processing')
})

test('department waiting roles shrink with receipts; closed matters have no blockers or actions', () => {
  let state = createSeedMatters({includeArchived:true})[4]
  assert.deepEqual(presentMatter(state, 'lead').waitingRoles, ['procurement', 'sales'])
  assert.deepEqual(presentMatter(state, 'lead').actions, [])
  assert.deepEqual(presentMatter(state, 'procurement').actions.map(action => action.type), ['submit_receipt'])
  state = act(state, 'submit_receipt', 'procurement', { taskId: 'T-PUR', evidence: '采购跟进回执' })
  assert.deepEqual(presentMatter(state, 'lead').waitingRoles, ['sales'])
  assert.deepEqual(presentMatter(state, 'procurement').actions, [])
  state = act(state, 'accept_task', 'sales', { taskId: 'T-SALES' })
  state = act(state, 'start_task', 'sales', { taskId: 'T-SALES' })
  state = act(state, 'submit_receipt', 'sales', { taskId: 'T-SALES', evidence: '销售同步回执' })
  assert.equal(presentMatter(state, 'lead').stage, '待复核')
  assert.deepEqual(presentMatter(state, 'lead').waitingRoles, ['lead'])
  assert.deepEqual(presentMatter(state, 'lead').actions.map(action => action.type), ['close_matter'])
  state = act(state, 'close_matter')
  for (const role of roles) {
    const view = presentMatter(state, role)
    assert.equal(view.category, 'closed')
    assert.deepEqual(view.actions, [])
    assert.deepEqual(view.blockers, [])
    assert.deepEqual(view.waitingRoles, [])
    assert.match(view.conclusion, /不代表原料已到货或订单已交付/)
  }
})

test('failed delivery and current rejection take priority; retry/review history is not a current blocker', () => {
  let state = act(select(createState()), 'arm_delivery_failure')
  state = act(state, 'request_quality')
  for (const role of roles) assertActionsAllowed(state, role, presentMatter(state, role))
  const failed = presentMatter(state, 'lead')
  assert.equal(failed.priority, 0)
  assert.equal(failed.stage, '核验中')
  assert.equal(failed.actions[0].type, 'retry_delivery')
  assert.deepEqual(failed.waitingRoles, ['quality'])
  assert.match(failed.blockers.join(''), /发送失败/)
  state = act(state, 'retry_delivery', 'quality', { taskId: 'T-QA' })
  assert.equal(presentMatter(state, 'quality').priority, 1)
  state = reject(select(createState(), 'B'))
  const rejected = presentMatter(state, 'lead')
  assert.equal(rejected.priority, 0)
  assert.equal(rejected.stage, '核验不通过')
  assert.equal(rejected.actions[0].type, 'request_quality')
  assert.ok(!rejected.actions.some(action => action.type.startsWith('approve')))
  state = act(state, 'request_quality')
  assert.equal(presentMatter(state, 'quality').stage, '核验中')
  assert.equal(presentMatter(state, 'quality').priority, 1)
  assert.deepEqual(presentMatter(state, 'quality').waitingRoles, ['quality'])
  assert.equal(state.planReviews[0].result, 'rejected', 'history is preserved')
})

test('stale QA cannot produce a task action after another version is selected', () => {
  let state = act(select(createState()), 'request_quality')
  state = select(state, 'B')
  assert.equal(presentMatter(state, 'quality').stage, '待发起核验')
  assert.deepEqual(presentMatter(state, 'quality').actions, [])
  assert.deepEqual(presentMatter(state, 'lead').actions.map(action => action.type), ['request_quality', 'choose_plan'])
  assert.deepEqual(presentMatter(state, 'unknown-role').actions, [])
})

test('both supplier paths require review before approval and lock plan choices after approval', () => {
  for (const supplierId of ['A', 'B']) {
    let state = select(createState(), supplierId)
    assert.ok(!presentMatter(state, 'lead').actions.some(action => action.type.startsWith('approve')))
    state = act(state, 'request_quality')
    state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
    state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
    assert.deepEqual(presentMatter(state, 'quality').actions.map(action => action.type), ['submit_quality'])
    state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '当前版本核验通过' })
    const approvalType = supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'
    assert.deepEqual(presentMatter(state, 'lead').actions.map(action => action.type), [approvalType, 'choose_plan'])
    assert.ok(!presentMatter(state, 'procurement').actions.some(action => action.type.startsWith('approve')))
    state = act(state, approvalType)
    const view = presentMatter(state, 'lead')
    assert.equal(view.effectiveSupplierId, supplierId)
    assert.equal(view.approvedVersionId, view.selectedVersionId)
    assert.deepEqual(view.actions.map(action => action.type), ['send_tasks'])
    assert.deepEqual(view.waitingRoles, ['lead'])
  }
})

test('one failed department delivery remains visible without blocking the other role action', () => {
  let state = act(createSeedMatters({includeArchived:true})[3], 'arm_delivery_failure')
  state = act(state, 'send_tasks')
  const before = structuredClone(state)
  const lead = presentMatter(state, 'lead')
  assert.equal(lead.stage, '部门执行')
  assert.equal(lead.priority, 0)
  assert.deepEqual(lead.waitingRoles, ['procurement', 'sales'])
  assert.deepEqual(lead.actions.map(action => [action.type, action.taskId]), [['retry_delivery', 'T-PUR']])
  assert.deepEqual(presentMatter(state, 'sales').actions.map(action => [action.type, action.taskId]), [['accept_task', 'T-SALES']])
  assert.deepEqual(presentMatter(state, 'quality').actions, [])
  assert.deepEqual(state, before)
  for (let attempt = 1; attempt < 3; attempt++) {
    state = act(state, 'arm_delivery_failure')
    state = act(state, 'retry_delivery', 'lead', { taskId: 'T-PUR' })
  }
  assert.deepEqual(presentMatter(state, 'lead').actions, [])
  assert.equal(presentMatter(state, 'lead').priority, 0)
  assert.match(presentMatter(state, 'lead').blockers.join(''), /尝试上限/)
})

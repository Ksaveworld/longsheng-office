import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { analyze, applyAction, createState, currentPlanReview, getDocuments, isCurrentQualityTask, migrateState, previewAction } from '../server/office-domain.mjs'
import { presentMatter } from '../server/office-presentation.mjs'
import { projectOffice } from '../server/office-ontology.mjs'
import { createSeedMatters } from '../server/office-seeds.mjs'
import { createLocalStore } from '../server/office-store.mjs'
import { createOfficeService } from '../server/office-service.mjs'
import { runOfficeChat } from '../server/office-model.mjs'

const act = (state, type, role = 'lead', data = {}) => applyAction(state, { type, ...data }, role)
const ledgerId = state => getDocuments(state).find(document => document.id.startsWith('DOC-LEDGER')).id
function qualityInProgress(supplierId = 'A') {
  let state = act(createState(), 'select_plan', 'lead', { supplierId })
  state = act(state, 'request_quality')
  state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
  return act(state, 'start_task', 'quality', { taskId: 'T-QA' })
}
function executionState(supplierId = 'A') {
  let state = qualityInProgress(supplierId)
  state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '核对所选版本、订单影响及方案条件', sourceIds: [ledgerId(state)] })
  state = act(state, supplierId === 'A' ? 'approve_keep_a' : 'approve_switch')
  state = act(state, 'send_tasks')
  for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
    state = act(state, 'accept_task', role, { taskId })
    state = act(state, 'start_task', role, { taskId })
  }
  return state
}
const receiptAction = (state, taskId) => ({
  type: 'submit_receipt', taskId, evidence: taskId === 'T-PUR' ? '已登记采购跟进安排' : '已同步订单到料信息',
  sourceIds: [ledgerId(state)],
  record: taskId === 'T-PUR' ? { arrangement: '跟进当前获批供应安排', pending: '仍待核对到料凭证' } : {
    orderIds: [state.orders[0].id], communication: '同步当前到料日及订单影响', result: '已登记同步结果，继续关注到料凭证',
  },
})

// Reproduce the saved schema-3 shape from before selection/approval bindings.
function legacyReturnedSelection(supplierId) {
  let state = act(qualityInProgress(supplierId), 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '旧版首次核验凭据' })
  state = act(state, 'select_plan', 'lead', { supplierId: supplierId === 'A' ? 'B' : 'A' })
  state = act(state, 'select_plan', 'lead', { supplierId })
  delete state.tasks[0].selectionInvalidated
  delete state.tasks[0].selectionRevision
  // A timestamp comparison alone cannot distinguish these operations.
  state.tasks[0].createdAt = state.matter.planSelection.selectedAt
  return state
}
function legacyApprovedReturn(supplierId, stage) {
  let state = act(qualityInProgress(supplierId), 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '旧版批准所引用的核验原文' })
  state = act(state, supplierId === 'A' ? 'approve_keep_a' : 'approve_switch')
  if (stage !== 'pending') {
    state = act(state, 'send_tasks')
    for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
      state = act(state, 'accept_task', role, { taskId })
      state = act(state, 'start_task', role, { taskId })
      if (stage === 'receipts' || stage === 'closed') state = applyAction(state, receiptAction(state, taskId), role)
    }
  }
  if (stage === 'closed') state = act(state, 'close_matter')
  const returned = legacyReturnedSelection(supplierId)
  const approvalIndex = state.events.findIndex(event => event.type === (supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'))
  state.events.splice(approvalIndex, 0, ...returned.events.slice(-2))
  state.matter.planSelection = returned.matter.planSelection
  state.revision += 2
  delete state.tasks.find(task => task.id === 'T-QA').selectionRevision
  delete state.matter.executionApproval.qualityReviewId
  delete state.matter.outcome
  return state
}

for (const supplierId of ['A', 'B']) {
  test(`legacy unflagged return to ${supplierId} cannot revive review and can restart quality normally`, async () => {
    const store = createLocalStore(':memory:')
    try {
      const token = 'legacy-return-fixture'.repeat(3)
      const legacy = legacyReturnedSelection(supplierId)
      await store.transact(token, workspace => { workspace.matters[legacy.matter.id] = legacy })
      const service = createOfficeService({ store, publicDemo: true })
      const snapshot = (await service.handle({ token, method: 'GET', path: '/snapshot' })).body
      assert.equal(snapshot.presentation.stage, '待发起核验')
      assert.equal(currentPlanReview(snapshot.state), undefined)
      const approval = supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'
      assert.equal(previewAction(snapshot.state, { type: approval }, 'lead').allowed, false)
      assert.deepEqual(presentMatter(snapshot.state, 'quality').actions, [])
      assert.equal(isCurrentQualityTask(snapshot.state, snapshot.state.tasks[0]), false)
      const savedReview = structuredClone(legacy.planReviews[0])
      const savedReceipt = structuredClone(legacy.tasks[0].receipt)
      let state = act(snapshot.state, 'request_quality')
      assert.equal(state.tasks[0].selectionRevision, state.matter.planSelection.revision)
      assert.equal(state.tasks[0].history[0].selectionInvalidated, true)
      state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
      state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
      state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '重新核验本次选择' })
      state = act(state, approval)
      assert.equal(analyze(state).executionApproved, true)
      assert.equal(state.matter.executionApproval.qualityReviewId, currentPlanReview(state).id)
      assert.deepEqual(state.planReviews[0], savedReview)
      assert.deepEqual(state.tasks[0].history[0].receipt, savedReceipt)
    } finally { store.close() }
  })
  for (const stage of ['pending', 'working', 'receipts']) {
    test(`legacy invalid ${supplierId} approval at ${stage} needs fresh quality and explicit reapproval; archives tasks without duplicate IDs`, () => {
      let state = legacyApprovedReturn(supplierId, stage)
      state.decisions.find(decision => decision.status === 'effective').text = `原有效 ${supplierId} 决定全文，重新批准时必须保留。`
      if (state.matter.followupApproval) state.matter.followupApproval.reason = '原 A 批准独立理由，与当前选择理由不同。'
      const original = structuredClone(state)
      const oldTasks = structuredClone(state.tasks.filter(task => task.id !== 'T-QA'))
      const oldApproval = structuredClone(state.matter.executionApproval)
      const archivedApproval = { ...oldApproval, decision:structuredClone(state.decisions.find(decision => decision.status === 'effective')),
        ...(state.matter.followupApproval ? {followupApproval:structuredClone(state.matter.followupApproval)} : {}) }
      const oldQa = structuredClone(state.tasks[0].receipt)
      assert.equal(analyze(state).executionApproved, false)
      assert.match(presentMatter(state, 'lead').conclusion, /原批准依据的核验已失效/)
      assert.match(presentMatter(state, 'lead').blockers.join(''), /历史任务及凭据保留/)
      assert.deepEqual(state, original, 'reading old records must not migrate or rewrite them')
      for (const type of ['accept_task', 'start_task', 'submit_receipt', 'retry_delivery']) {
        for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
          assert.throws(() => act(state, type, role, { taskId, evidence: '不允许继续旧执行轮次' }), { code: 'NOT_APPROVED' })
        }
      }
      assert.throws(() => act(state, 'select_plan', 'lead', { supplierId: supplierId === 'A' ? 'B' : 'A' }), { code: 'PLAN_LOCKED' })
      state = act(state, 'request_quality')
      state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
      state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
      state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '存量选择重新核验的凭据' })
      assert.equal(analyze(state).executionApproved, false, 'new quality must not revive the previous approval')
      assert.equal(presentMatter(state, 'lead').stage, '待批准')
      assert.deepEqual(state.matter.executionApproval, oldApproval)
      assert.deepEqual(state.tasks.filter(task => task.id !== 'T-QA'), oldTasks, 'tasks change only on explicit reapproval')
      assert.throws(() => act(state, 'send_tasks'), { code: 'NOT_APPROVED' })
      assert.throws(() => act(state, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
      const approvalType = supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'
      assert.throws(() => act(state, approvalType, 'procurement'), { code: 'FORBIDDEN' })
      state = act(state, approvalType)
      assert.equal(analyze(state).executionApproved, true)
      assert.equal(state.matter.executionApproval.qualityReviewId, currentPlanReview(state).id)
      assert.deepEqual(state.matter.executionApproval.history, [archivedApproval])
      assert.deepEqual(state.matter.planSelection, original.matter.planSelection)
      assert.equal(new Set(state.tasks.map(task => task.id)).size, 3)
      for (const prior of oldTasks) {
        const task = state.tasks.find(task => task.id === prior.id)
        const { archivedAt, archiveReason, ...archived } = task.history.at(-1)
        assert.ok(archivedAt && archiveReason)
        assert.deepEqual(archived, prior)
        assert.equal(task.status, 'pending_delivery')
        assert.equal(task.attempts, 0)
        for (const key of ['receipt', 'deliveredAt', 'acceptedAt', 'startedAt', 'completedAt']) assert.equal(task[key], undefined)
      }
      assert.equal(analyze(state).canClose, false, 'historical receipts do not satisfy the new execution round')
      state = act(state, 'send_tasks')
      for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
        state = act(state, 'accept_task', role, { taskId })
        state = act(state, 'start_task', role, { taskId })
        state = applyAction(state, receiptAction(state, taskId), role)
      }
      state = act(state, 'close_matter')
      assert.equal(state.matter.status, 'closed')
      assert.equal(state.matter.outcome.approval.qualityReviewId, state.matter.outcome.qualityReview.id)
      assert.deepEqual(state.tasks[0].history[0].receipt, oldQa)
      assert.deepEqual(state.matter.executionApproval.history[0], archivedApproval)
    })
  }
}

test('legacy valid approvals and closed history keep their existing meaning without binding fields', () => {
  for (const supplierId of ['A', 'B']) {
    const state = executionState(supplierId)
    assert.equal(state.matter.executionApproval.history, undefined, 'normal first approval adds no redundant history')
    delete state.tasks[0].selectionRevision
    delete state.matter.executionApproval.qualityReviewId
    const before = structuredClone(state)
    assert.equal(analyze(state).executionApproved, true)
    assert.equal(presentMatter(state, 'lead').stage, '部门执行')
    assert.equal(previewAction(state, receiptAction(state, 'T-PUR'), 'procurement').allowed, true)
    assert.equal(previewAction(state, { type: 'request_quality' }, 'lead').allowed, false)
    assert.deepEqual(state, before)
    const closed = legacyApprovedReturn(supplierId, 'closed')
    const closedBefore = structuredClone(closed)
    assert.equal(analyze(closed).executionApproved, true)
    assert.equal(presentMatter(closed, 'lead').stage, '已办结')
    assert.deepEqual(presentMatter(closed, 'lead').actions, [])
    assert.deepEqual(migrateState(closed), closedBefore)
    assert.equal(closed.matter.outcome, undefined)
  }
})

test('quality graph supplier follows the task own plan version for A, B and invalidated historical tasks', () => {
  for (const supplierId of ['A', 'B']) {
    const current = qualityInProgress(supplierId)
    const changed = act(current, 'select_plan', 'lead', { supplierId: supplierId === 'A' ? 'B' : 'A' })
    const legacy = legacyReturnedSelection(supplierId)
    for (const state of [current, changed, legacy]) {
      const graph = projectOffice(state)
      assert.deepEqual(graph.relations.filter(edge => edge.type === 'taskSupplier' && edge.from === 'Task:T-QA').map(edge => edge.to), [`Supplier:${supplierId}`])
    }
    assert.equal(projectOffice(legacy).objects.find(object => object.id === 'Task:T-QA').properties.selectionInvalidated, true)
  }
})

test('all six matter source texts preserve complete order IDs and scope template fields once', () => {
  for (const state of createSeedMatters().filter(s=>!s.scenario)) {
    const before = structuredClone(state)
    const documents = getDocuments(state)
    const knownOrders = new Set(state.orders.map(order => order.id))
    for (const document of documents) {
      for (const [id] of document.text.matchAll(/\bORD-[A-Za-z0-9_-]+/g)) assert.ok(knownOrders.has(id), `${state.matter.id}/${document.id}: unexpected order ${id}`)
      const sourcePrefix = `[${document.id}] `
      assert.ok(document.text.startsWith(sourcePrefix))
    }
    const ledger = documents.find(document => document.id.startsWith('DOC-LEDGER'))
    assert.deepEqual([...ledger.text.matchAll(/\bORD-[A-Za-z0-9_-]+/g)].map(match => match[0]), state.orders.map(order => order.id))
    assert.ok(ledger.text.includes(`${state.matter.id} 关联物料 ${state.matter.materialId}`))
    const notice = documents.find(document => document.id.startsWith('DOC-NOTICE'))
    assert.ok(notice.text.includes(`${state.matter.id}：原料 ${state.matter.materialId}`))
    assert.ok(documents.find(document => document.id.startsWith('DOC-MEETING-01')).text.includes(`供应 ${state.matter.materialId}，`))
    assert.ok(documents.find(document => document.id.startsWith('DOC-MEETING-02')).text.includes(`B 可在 D${state.suppliers.find(supplier => supplier.id === 'B').arrivalDay} 到料`))
    assert.deepEqual(getDocuments(state), documents)
    assert.deepEqual(state, before)
  }
})

test('source projections preserve recorded evidence and embedded identifiers verbatim', () => {
  const literal = '原始凭据 SUP-001 / M-01 / ORD-001 / ORD-002；外部原文：B 可在 D4；当前完整号 ORD-001-01。'
  for (const supplierId of ['A', 'B']) {
    let state = createState({ matterId: 'SUP-009', materialId: 'M-09', alternativeDay: 7, orders: [
      { id: 'ORD-009-01', materialId: 'M-09', requiredDay: 5 }, { id: 'ORD-009-02', materialId: 'M-09', requiredDay: 8 },
    ] })
    state = act(state, 'select_plan', 'lead', { supplierId, evidence: literal })
    state = act(state, 'request_quality')
    state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
    state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
    state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: literal })
    state = act(state, supplierId === 'A' ? 'approve_keep_a' : 'approve_switch')
    state = act(state, 'send_tasks')
    for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
      state = act(state, 'accept_task', role, { taskId })
      state = act(state, 'start_task', role, { taskId })
      state = act(state, 'submit_receipt', role, { taskId, evidence: literal })
    }
    state.planVersions[0].summary = literal
    const before = structuredClone(state)
    const documents = getDocuments(state)
    for (const prefix of ['DOC-STATE', 'DOC-PLAN-SELECTION', 'DOC-PLAN-VERSIONS', 'QA-B-001', 'DOC-RECEIPT-T-PUR', 'DOC-RECEIPT-T-SALES', supplierId === 'A' ? 'DOC-KEEP-A' : 'DOC-DECISION-03']) {
      assert.ok(documents.find(document => document.id.startsWith(prefix)).text.includes(literal), `${supplierId}/${prefix} must retain original evidence`)
    }
    const versionDocument = documents.find(document => document.id.startsWith('DOC-PLAN-VERSIONS'))
    const projected = JSON.parse(versionDocument.text.slice(versionDocument.text.indexOf('] ') + 2))
    assert.deepEqual(projected, { selection: state.matter.planSelection, versions: state.planVersions, reviews: state.planReviews })
    assert.deepEqual(state, before)
  }
})

for (const supplierId of ['A', 'B']) for (const beginOtherQa of [false, true]) {
  test(`returning to reviewed ${supplierId}, with other QA ${beginOtherQa ? 'started' : 'not started'}, requires a fresh review before approval and sending`, () => {
    let state = qualityInProgress(supplierId)
    state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '原选择轮次的人工核验凭据', sourceIds: [ledgerId(state)] })
    const originalReview = structuredClone(currentPlanReview(state))
    const originalReceipt = structuredClone(state.tasks.find(task => task.id === 'T-QA').receipt)
    const otherSupplierId = supplierId === 'A' ? 'B' : 'A'
    state = act(state, 'select_plan', 'lead', { supplierId: otherSupplierId })
    assert.equal(state.tasks.find(task => task.id === 'T-QA').selectionInvalidated, true)
    assert.equal(currentPlanReview(state), undefined)
    assert.deepEqual(state.planReviews[0], originalReview)
    assert.deepEqual(state.tasks.find(task => task.id === 'T-QA').receipt, originalReceipt)
    if (beginOtherQa) {
      state = act(state, 'request_quality')
      state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
      state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
    }
    state = act(state, 'select_plan', 'lead', { supplierId })
    assert.equal(state.tasks.find(task => task.id === 'T-QA').selectionInvalidated, true)
    assert.equal(currentPlanReview(state), undefined, 'returning to an old version cannot restore its previous review')
    assert.equal(analyze(state).executionApproved, false)
    const leadView = presentMatter(state, 'lead')
    assert.equal(leadView.stage, '待发起核验')
    assert.deepEqual(leadView.actions.map(action => action.type), ['request_quality', 'choose_plan'])
    assert.deepEqual(leadView.waitingRoles, ['lead', 'procurement'])
    assert.deepEqual(presentMatter(state, 'quality').actions, [])
    assert.throws(() => act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '不得提交已失效任务' }), { code: 'PLAN_CHANGED' })
    const approvalType = supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'
    assert.equal(previewAction(state, { type: approvalType }, 'lead').allowed, false)
    assert.throws(() => act(state, approvalType), { code: 'QUALITY_NOT_APPROVED' })
    assert.ok(!state.tasks.some(task => ['T-PUR', 'T-SALES'].includes(task.id)))
    const graph = projectOffice(state)
    const qaObject = graph.objects.find(object => object.id === 'Task:T-QA')
    assert.equal(qaObject.properties.selectionInvalidated, true)
    assert.match(qaObject.properties.statusLabel, /历史核验.*失效/)
    state = act(state, 'request_quality')
    const currentQa = state.tasks.find(task => task.id === 'T-QA')
    assert.equal(currentQa.selectionInvalidated, undefined)
    assert.equal(currentPlanReview(state), undefined)
    assert.deepEqual(currentQa.history[0].receipt, originalReceipt)
    assert.equal(currentQa.history[0].selectionInvalidated, true)
    state = act(state, 'accept_task', 'quality', { taskId: 'T-QA' })
    state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
    state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '改回方案后重新核验的人工凭据', sourceIds: [ledgerId(state)] })
    assert.equal(currentPlanReview(state).evidence, '改回方案后重新核验的人工凭据')
    assert.deepEqual(state.planReviews[0], originalReview)
    assert.deepEqual(state.tasks.find(task => task.id === 'T-QA').history[0].receipt, originalReceipt)
    state = act(state, approvalType)
    assert.equal(analyze(state).executionApproved, true)
    assert.equal(presentMatter(state, 'lead').stage, '待发送')
    assert.equal(previewAction(state, { type: 'send_tasks' }, 'lead').allowed, true)
    state = act(state, 'send_tasks')
    for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
      state = act(state, 'accept_task', role, { taskId })
      state = act(state, 'start_task', role, { taskId })
      state = applyAction(state, receiptAction(state, taskId), role)
    }
    state = act(state, 'close_matter')
    assert.equal(state.matter.status, 'closed')
    assert.equal(state.matter.outcome.qualityReview.evidence, '改回方案后重新核验的人工凭据')
    assert.deepEqual(state.planReviews[0], originalReview)
  })
}

test('invalidated failed or rejected quality tasks cannot block or authorize the returned selection', () => {
  let failed = act(createState(), 'select_plan', 'lead', { supplierId: 'A' })
  failed = act(act(failed, 'arm_delivery_failure'), 'request_quality')
  let rejected = act(qualityInProgress('A'), 'submit_quality', 'quality', { taskId: 'T-QA', result: 'rejected', evidence: '原方案依据不足' })
  for (let state of [failed, rejected]) {
    const priorTask = structuredClone(state.tasks.find(task => task.id === 'T-QA'))
    state = act(act(state, 'select_plan', 'lead', { supplierId: 'B' }), 'select_plan', 'lead', { supplierId: 'A' })
    const before = structuredClone(state)
    const view = presentMatter(state, 'lead')
    assert.equal(view.stage, '待发起核验')
    assert.equal(view.priority, 1)
    assert.ok(view.blockers.every(blocker => !/失败|不通过/.test(blocker)))
    assert.deepEqual(presentMatter(state, 'quality').actions, [])
    for (const type of ['retry_delivery', 'accept_task', 'start_task']) {
      assert.equal(previewAction(state, { type, taskId: 'T-QA' }, 'quality').allowed, false)
      assert.throws(() => act(state, type, 'quality', { taskId: 'T-QA' }), { code: 'PLAN_CHANGED' })
    }
    assert.deepEqual(state, before)
    assert.deepEqual(state.tasks.find(task => task.id === 'T-QA').receipt, priorTask.receipt)
    state = act(state, 'request_quality')
    assert.equal(state.tasks.find(task => task.id === 'T-QA').selectionInvalidated, undefined)
    assert.equal(presentMatter(state, 'quality').stage, '核验中')
    assert.deepEqual(presentMatter(state, 'quality').actions.map(action => action.type), ['accept_task'])
  }
})

test('approval requires completed current quality task and matching evidence, not merely a stored approved review', () => {
  for (const supplierId of ['A', 'B']) {
    const reviewed = act(qualityInProgress(supplierId), 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '当前核验凭据' })
    for (const corrupt of [
      state => { state.tasks.find(task => task.id === 'T-QA').status = 'in_progress' },
      state => { delete state.tasks.find(task => task.id === 'T-QA').receipt },
      state => { state.tasks.find(task => task.id === 'T-QA').receipt.evidence = ' ' },
      state => { state.tasks.find(task => task.id === 'T-QA').qualityResult = 'rejected' },
      state => { state.planReviews[0].reviewedAt = '2000-01-01T00:00:00.000Z' },
      state => { state.planReviews[0].evidence = ' ' },
    ]) {
      const state = structuredClone(reviewed)
      corrupt(state)
      const type = supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'
      assert.equal(previewAction(state, { type }, 'lead').allowed, false)
      assert.throws(() => act(state, type), { code: 'QUALITY_NOT_APPROVED' })
      assert.ok(!presentMatter(state, 'lead').actions.some(action => action.type.startsWith('approve')))
      assert.equal(analyze(state).executionApproved, false)
    }
  }
})

test('delivery event summaries preserve the task target from recorded event messages', () => {
  const state = createState()
  state.events = ['T-QA', 'T-PUR', 'T-SALES', 'T-OTHER'].flatMap(taskId => ['delivered', 'delivery_failed'].map(type => ({
    id: `${taskId}:${type}`, type, actor: 'lead', message: `${taskId} 第 1 次送达：${type}`, at: '2026-09-10T00:00:00.000Z',
  })))
  const original = structuredClone(state.events)
  assert.deepEqual(presentMatter(state, 'lead').events.map(event => event.summary), [
    '质量核验任务已送达', '质量核验任务发送失败', '采购任务已送达', '采购任务发送失败',
    '销售任务已送达', '销售任务发送失败', '任务已送达', '任务发送失败',
  ])
  assert.deepEqual(state.events, original)
})

test('quality evidence accepts current sources, rejects foreign references and preserves plain evidence compatibility', () => {
  const state = qualityInProgress('B')
  const base = { type: 'submit_quality', taskId: 'T-QA', result: 'approved', evidence: '当前版本核验凭据' }
  const before = structuredClone(state)
  for (const sourceIds of [['DOC-LEDGER-SUP-002'], ['DOC-NOT-FOUND'], [1], 'DOC-LEDGER', Array(13).fill(ledgerId(state))]) {
    assert.equal(previewAction(state, { ...base, sourceIds }, 'quality').allowed, false)
    assert.throws(() => applyAction(state, { ...base, sourceIds }, 'quality'), { code: 'SOURCE_INVALID' })
  }
  const sourceIds = [ledgerId(state), ledgerId(state)]
  const preview = previewAction(state, { ...base, sourceIds }, 'quality')
  assert.equal(preview.allowed, true)
  assert.match(preview.details.join('\n'), /采购与订单台账样例/)
  const saved = applyAction(state, { ...base, sourceIds }, 'quality')
  assert.deepEqual(saved.planReviews[0].sourceIds, [ledgerId(state)])
  assert.deepEqual(saved.tasks.find(task => task.id === 'T-QA').receipt.sourceIds, [ledgerId(state)])
  const legacyInput = applyAction(state, base, 'quality')
  assert.equal(legacyInput.planReviews[0].evidence, base.evidence)
  assert.equal(legacyInput.planReviews[0].sourceIds, undefined)
  assert.deepEqual(state, before)
})

test('structured receipts show all fields in preview and persist detached current-matter evidence', () => {
  const state = executionState()
  const before = structuredClone(state)
  for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
    const action = receiptAction(state, taskId)
    const preview = previewAction(state, action, role)
    assert.equal(preview.allowed, true)
    assert.match(preview.details.join('\n'), /采购与订单台账样例/)
    for (const value of Object.values(action.record).flat()) assert.ok(preview.details.join('\n').includes(value))
    const saved = applyAction(state, action, role)
    const receipt = saved.tasks.find(task => task.id === taskId).receipt
    assert.deepEqual(receipt.record, action.record)
    assert.deepEqual(receipt.sourceIds, action.sourceIds)
    assert.equal(receipt.evidence, action.evidence)
    assert.equal(receipt.actor, role)
    const expectedRecord = structuredClone(receipt.record)
    action.record.result = '修改请求对象不应改写保存值'
    action.sourceIds.push('DOC-NOT-FOUND')
    assert.deepEqual(receipt.record, expectedRecord)
    assert.deepEqual(receipt.sourceIds, [ledgerId(state)])
    const plain = applyAction(state, { type: 'submit_receipt', taskId, evidence: '原版纯文本回执' }, role)
    assert.equal(plain.tasks.find(task => task.id === taskId).receipt.evidence, '原版纯文本回执')
    assert.equal(plain.tasks.find(task => task.id === taskId).receipt.record, undefined)
  }
  assert.deepEqual(state, before)
})

test('receipt source and order references must belong to the current matter and structured fields stay complete', () => {
  const state = executionState()
  const sales = receiptAction(state, 'T-SALES')
  for (const sourceIds of [['DOC-LEDGER-SUP-002'], ['QA-B-001-SUP-002']]) assert.throws(() => applyAction(state, { ...sales, sourceIds }, 'sales'), { code: 'SOURCE_INVALID' })
  const foreignOrder = createSeedMatters()[1].orders[0].id
  for (const orderIds of [[foreignOrder], ['ORD-UNKNOWN'], [123]]) assert.throws(() => applyAction(state, { ...sales, record: { ...sales.record, orderIds } }, 'sales'), { code: 'ORDER_INVALID' })
  const unrelatedOrderState = structuredClone(state)
  unrelatedOrderState.orders.push({ id: 'ORD-OTHER-MATERIAL', materialId: 'M-OTHER', requiredDay: 5 })
  assert.throws(() => applyAction(unrelatedOrderState, { ...sales, record: { ...sales.record, orderIds: ['ORD-OTHER-MATERIAL'] } }, 'sales'), { code: 'ORDER_INVALID' })
  for (const record of [[], null, { ...sales.record, unexpected: '无定义字段' }, { ...sales.record, orderIds: [] }, { ...sales.record, communication: ' ' }, { ...sales.record, result: 'x'.repeat(2001) }]) {
    assert.throws(() => applyAction(state, { ...sales, record }, 'sales'), { code: 'RECEIPT_INVALID' })
  }
  const procurement = receiptAction(state, 'T-PUR')
  for (const record of [{ arrangement: '已跟进' }, { arrangement: ' ', pending: '仍待凭证' }]) assert.throws(() => applyAction(state, { ...procurement, record }, 'procurement'), { code: 'RECEIPT_INVALID' })
})

test('closing captures a detached approved outcome with A residual risk or B zero calculated risk', () => {
  for (const supplierId of ['A', 'B']) {
    let state = executionState(supplierId)
    for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) state = applyAction(state, receiptAction(state, taskId), role)
    const beforeClose = structuredClone(state)
    const closed = act(state, 'close_matter')
    const outcome = closed.matter.outcome
    assert.equal(state.matter.outcome, undefined, 'preview/pre-close history has no fabricated outcome')
    assert.deepEqual(state, beforeClose)
    assert.equal(outcome.revision, closed.revision)
    assert.equal(outcome.capturedAt, closed.matter.closedAt)
    assert.equal(outcome.plan.id, closed.matter.planSelection.planVersionId)
    assert.equal(outcome.selection.supplierId, supplierId)
    assert.equal(outcome.approval.planVersionId, outcome.plan.id)
    assert.equal(outcome.decision.supplierId, supplierId)
    assert.equal(outcome.decision.status, 'effective')
    assert.equal(outcome.qualityReview.planVersionId, outcome.plan.id)
    assert.equal(outcome.analysis.riskCount, supplierId === 'A' ? 1 : 0)
    assert.equal(outcome.review.riskCount, outcome.analysis.riskCount)
    assert.equal(outcome.receipts.length, 2)
    assert.ok(outcome.receipts.every(receipt => receipt.record && receipt.sourceIds.includes(ledgerId(closed))))
    const captured = structuredClone(outcome)
    const changed = structuredClone(closed)
    changed.suppliers.find(supplier => supplier.id === supplierId).arrivalDay = 20
    changed.orders[0].requiredDay = 1
    changed.planVersions.find(plan => plan.id === outcome.plan.id).summary = '后续资料改变'
    changed.matter.planSelection.reason = '后续选择说明'
    changed.matter.executionApproval.approvedBy = 'procurement'
    changed.matter.review.riskCount = 99
    changed.decisions.find(decision => decision.status === 'effective').text = '后续决定内容'
    changed.planReviews.at(-1).evidence = '后续核验文本'
    changed.tasks.find(task => task.id === 'T-PUR').receipt.record.arrangement = '后续安排'
    assert.notEqual(analyze(changed).riskCount, captured.analysis.riskCount)
    assert.deepEqual(changed.matter.outcome, captured)
    assert.deepEqual(outcome, captured)
    assert.deepEqual(migrateState(changed).matter.outcome, captured)
  }
})

test('existing closed records never acquire a fabricated outcome during migration or presentation', () => {
  const closed = createSeedMatters()[5]
  delete closed.matter.outcome
  const savedHistory = structuredClone(closed)
  for (const role of ['lead', 'procurement', 'quality', 'sales']) {
    const current = migrateState(closed)
    assert.equal(current.matter.outcome, undefined)
    assert.equal(presentMatter(current, role).stage, '已办结')
    assert.equal(current.matter.outcome, undefined)
  }
  assert.deepEqual(closed, savedHistory)
  delete closed.workflowVersion
  const legacy = migrateState(closed)
  assert.equal(legacy.matter.outcome, undefined)
  assert.equal(legacy.matter.closedAt, closed.matter.closedAt)
  assert.deepEqual(legacy.matter.review, closed.matter.review)
  assert.deepEqual(legacy.tasks, closed.tasks)
})

function serviceFixture(t, runner) {
  const store = createLocalStore(':memory:')
  t.after(() => store.close())
  const service = createOfficeService({ store, chatRunner: runner, publicDemo: true })
  const token = 'value-test-visitor'.repeat(4)
  const call = (path, body, role = 'lead', matterId = 'SUP-001') => service.handle({ token, path, method: body === undefined ? 'GET' : 'POST', body: body || {}, query: { matterId }, role })
  return { store, token, call }
}
const finishedRun = input => ({ id: randomUUID(), question: input.question, queryType: input.queryType, role: input.role, revision: input.state.revision, status: 'completed', mode: 'live', variant: 'ontology', answer: '已形成当前事项简报。', sources: [], toolCalls: [], createdAt: new Date().toISOString(), facts: { state: structuredClone(input.state), presentation: presentMatter(input.state, input.role) } })

test('chat forwards briefing with server-selected matter/role and includes queryType in request idempotency', async t => {
  const inputs = []
  const { call } = serviceFixture(t, async input => { inputs.push(input); return finishedRun(input) })
  const role = 'quality', matterId = 'SUP-002'
  const initial = (await call('/snapshot', undefined, role, matterId)).body.state
  const conversation = (await call('/conversations', {}, role, matterId)).body.conversation
  const body = { question: '这次延期影响什么，我现在需要处理什么？', queryType: 'briefing', requestId: randomUUID(), conversationId: conversation.id, role: 'lead' }
  const first = await call('/chat', body, role, matterId)
  assert.equal(first.status, 200)
  assert.equal(first.body.run.queryType, 'briefing')
  assert.equal(inputs.length, 1)
  assert.equal(inputs[0].queryType, 'briefing')
  assert.equal(inputs[0].role, role, 'body cannot impersonate another role')
  assert.equal(inputs[0].state.matter.id, matterId)
  assert.deepEqual(first.body.run.facts.state, initial)
  const duplicate = await call('/chat', body, role, matterId)
  assert.equal(duplicate.body.run.id, first.body.run.id)
  assert.equal(inputs.length, 1)
  const { queryType, ...ordinaryRequest } = body
  await assert.rejects(() => call('/chat', ordinaryRequest, role, matterId), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(inputs.length, 1)
  const latest = (await call('/snapshot', undefined, role, matterId)).body.state
  const { firstAnalyzedAt, ...businessState } = latest
  assert.ok(firstAnalyzedAt)
  assert.deepEqual(businessState, initial, 'briefing only records successful analysis, not selection or actions')
})

test('chat rejects invalid query types before dispatch or request persistence', async t => {
  let calls = 0
  const { call, store, token } = serviceFixture(t, async input => { calls++; return finishedRun(input) })
  await call('/snapshot')
  const before = await store.transact(token, workspace => workspace)
  for (const queryType of ['', null, 'progress', 'Briefing', {}, 1]) await assert.rejects(() => call('/chat', { question: '当前进展', queryType, requestId: randomUUID() }), { code: 'QUERY_TYPE_INVALID', status: 422 })
  await assert.rejects(() => call('/chat', { question: '当前进展', queryType: 'briefing', feedback: '重新生成更合适的方案', requestId: randomUUID() }), { code: 'QUERY_TYPE_INVALID', status: 422 })
  assert.equal(calls, 0)
  assert.deepEqual(await store.transact(token, workspace => workspace), before)
})

async function providerServer(t, handler) {
  const requests = []
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    requests.push(body)
    try {
      const message = await handler(body, requests.length)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] }))
    } catch { response.writeHead(500); response.end('Fixture error') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return { requests, provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'value-protocol-fixture', apiKey: 'test-only-not-a-real-model-key' } }
}

test('plans generated from each matter actual retrieved ledger use valid exact order IDs', async t => {
  for (const state of createSeedMatters().filter(s=>!s.scenario)) {
    const before = structuredClone(state)
    const { requests, provider } = await providerServer(t, (body, number) => {
      if (number === 1) return { role: 'assistant', content: null, tool_calls: [{ id: 'read-ledger', type: 'function', function: { name: 'search_documents', arguments: '{}' } }] }
      if (number === 2) {
        const result = JSON.parse(body.messages.at(-1).content)
        const ledger = result.documents.find(document => document.id.startsWith('DOC-LEDGER'))
        const orderIdFromSource = /\bORD-[A-Za-z0-9_-]+/.exec(ledger.text)[0]
        const draft = { supplierId: 'B', summary: `核对订单 ${orderIdFromSource} 的到料安排`, advantages: ['已有到料通知可核对'], risks: ['仍需跟进到料风险'], constraints: ['质量岗位核验当前版本并由负责人批准'], sourceIds: [ledger.id] }
        return { role: 'assistant', content: null, tool_calls: [{ id: 'source-derived-plan', type: 'function', function: { name: 'present_plans', arguments: JSON.stringify({ plans: [draft] }) } }] }
      }
      return { role: 'assistant', content: '候选方案已形成，等待人工选择及核验。' }
    })
    const run = await runOfficeChat({ state, question: '比较方案', role: 'lead', provider, signal: AbortSignal.timeout(5000) })
    assert.equal(run.status, 'completed', `${state.matter.id}: ${JSON.stringify(run.error)}`)
    assert.equal(requests.length, 3)
    assert.equal(run.planVersions[0].summary, `核对订单 ${state.orders[0].id} 的到料安排`)
    assert.deepEqual(run.planVersions[0].sourceIds, [ledgerId(state)])
    assert.deepEqual(run.facts.state, before)
    assert.deepEqual(state, before)
  }
})

test('live HTTP briefing keeps role-specific presentation, original facts and sources fixed without business writes', async t => {
  const state = createSeedMatters()[4]
  const before = structuredClone(state)
  const docId = ledgerId(state)
  const { requests, provider } = await providerServer(t, (_body, number) => number % 2 ? {
    role: 'assistant', content: null,
    tool_calls: [{ id: `read-${number}`, type: 'function', function: { name: 'search_documents', arguments: '{}' } }],
  } : { role: 'assistant', content: `当前到料安排已批准，等待相关岗位回执；尚无实际到货凭证。[${docId}]` })
  const runs = []
  for (const role of ['lead', 'procurement', 'quality', 'sales']) {
    const run = await runOfficeChat({ state, role, question: '这次延期影响什么，我现在需要处理什么？', queryType: 'briefing', provider, signal: AbortSignal.timeout(5000) })
    assert.equal(run.status, 'completed', JSON.stringify(run.error))
    assert.equal(run.queryType, 'briefing')
    assert.equal(run.intent, 'briefing')
    assert.equal(run.role, role)
    assert.equal(run.revision, before.revision)
    assert.deepEqual(run.facts.state, before)
    assert.deepEqual(run.facts.presentation, presentMatter(before, role))
    assert.deepEqual(run.facts.analysis, analyze(before))
    assert.equal(run.proposal, undefined)
    assert.equal(run.planVersions, undefined)
    assert.deepEqual(state, before)
    const firstRequest = requests.at(-2)
    assert.equal(firstRequest.tool_choice.function.name, 'search_documents')
    assert.ok(firstRequest.tools.every(tool => !['present_plans', 'preview_action'].includes(tool.function.name)))
    assert.ok(firstRequest.messages[0].content.includes(`当前角色固定为 ${role}`))
    assert.match(firstRequest.messages.at(-1).content, /本次只形成综合简报/)
    assert.ok(run.sources.every(source => getDocuments(before).some(document => document.id === source.id && document.text === source.text)))
    assert.equal(run.toolCalls[0].result.revision, before.revision)
    runs.push(run)
  }
  assert.equal(requests.length, 8)
  const historicalRuns = structuredClone(runs)
  state.suppliers[0].arrivalDay = 20
  state.orders[0].requiredDay = 1
  state.matter.planSelection.reason = '后续业务资料已更新'
  state.tasks.find(task => task.id === 'T-PUR').title = '后续任务内容'
  state.revision++
  assert.deepEqual(runs, historicalRuns)
  assert.notDeepEqual(presentMatter(state, 'lead'), runs[0].facts.presentation)
})

test('explicit and inferred briefings deny model plan/preview tool calls even when the ordinary action is allowed', async t => {
  const state = act(createState(), 'select_plan', 'lead', { supplierId: 'B' })
  const before = structuredClone(state)
  assert.equal(previewAction(state, { type: 'request_quality' }, 'lead').allowed, true)
  const plan = { supplierId: 'B', summary: '依据现有到料通知比较 B 方案', advantages: ['到料通知较早'], risks: ['仍须核对执行条件'], constraints: ['质量核验及负责人批准'], sourceIds: [ledgerId(state)] }
  const toolCall = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  const { requests, provider } = await providerServer(t, (_body, n) => n % 3 === 1 ? {
    role: 'assistant', content: null, tool_calls: [toolCall('search_documents', {}, `read-${n}`)],
  } : n % 3 === 2 ? {
    role: 'assistant', content: null, tool_calls: [
      toolCall('preview_action', { action: { type: 'request_quality' } }, `preview-${n}`),
      toolCall('present_plans', { plans: [plan] }, `plans-${n}`),
    ],
  } : { role: 'assistant', content: `当前选择仍待核验及负责人批准，未准备动作或新方案。[${ledgerId(state)}]` })
  for (const query of [{ question: '说明当前事项', queryType: 'briefing' }, { question: '请给我综合简报' }]) {
    const run = await runOfficeChat({ state, role: 'lead', provider, signal: AbortSignal.timeout(5000), ...query })
    assert.equal(run.status, 'completed', JSON.stringify(run.error))
    assert.equal(run.intent, 'briefing')
    assert.equal(run.proposal, undefined)
    assert.equal(run.planVersions, undefined)
    const denied = run.toolCalls.filter(call => ['present_plans', 'preview_action'].includes(call.name))
    assert.equal(denied.length, 2)
    assert.ok(denied.every(call => call.result.error?.code === 'TOOL_NOT_ALLOWED'))
    const request = requests.at(-3)
    assert.ok(request.tools.every(tool => !['present_plans', 'preview_action'].includes(tool.function.name)))
    assert.match(request.messages.at(-1).content, /不生成新方案，不预览执行动作/)
    assert.deepEqual(state, before)
  }
})

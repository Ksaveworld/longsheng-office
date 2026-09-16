import { analyze, closingFacts, currentPlanReview, getDocuments, isCurrentQualityTask, previewAction } from './office-domain.mjs'

import { isBusinessEvent, eventPresentation } from './office-events.mjs'

const ROLE_NAMES = { lead: '业务负责人', procurement: '采购经办', quality: '质量负责人', sales: '销售经办' }
// Evidence is collected in the UI before preview/confirmation. This text only
// probes whether that operation is available, and is never returned or saved.
const PROBE_EVIDENCE = '待当前岗位填写核验说明或处理回执'

function availableActions(state, role) {
  if (state.matter.status === 'closed') return []
  const allowed = action => previewAction(state, action, role).allowed
  const actions = []
  const add = (action, label) => {
    if (allowed(action)) actions.push({ type: action.type, label, ...(action.taskId ? { taskId: action.taskId } : {}), ...(action.supplierId ? { supplierId: action.supplierId } : {}) })
  }
  // Failures are actionable before normal work; each task still uses its own guard.
  for (const task of state.tasks) add({ type: 'retry_delivery', taskId: task.id }, `重试发送${task.id === 'T-QA' ? '核验' : task.assignee === 'procurement' ? '采购' : '销售'}任务`)
  add({ type: 'request_quality' }, '发起方案核验')
  add({ type: 'approve_keep_a' }, state.matter.executionApproval ? '重新批准保留 A 并跟进' : '批准保留 A 并跟进')
  add({ type: 'approve_switch' }, state.matter.executionApproval ? '重新批准 B 方案执行' : '批准切换至 B')
  add({ type: 'send_tasks' }, '确认并发送部门任务')
  for (const task of state.tasks) {
    add({ type: 'accept_task', taskId: task.id }, '确认接收任务')
    add({ type: 'start_task', taskId: task.id }, '开始处理任务')
    if (task.id === 'T-QA') add({ type: 'submit_quality', taskId: task.id, result: 'approved', evidence: PROBE_EVIDENCE }, '提交方案核验结论')
    else add({ type: 'submit_receipt', taskId: task.id, evidence: PROBE_EVIDENCE }, '提交处理回执')
  }
  add({ type: 'close_matter' }, '复核回执并关闭事项')
  const canChoose = (state.planVersions || []).some(version => allowed({ type: 'select_plan', supplierId: version.supplierId, planVersionId: version.id }))
  if (canChoose) {
    const choice = { type: 'choose_plan', label: state.matter.planSelection ? '调整方案选择' : '比较并选择方案' }
    if (state.matter.planSelection) actions.push(choice)
    else actions.unshift(choice)
  }
  return actions
}

function eventSummary(event) {
  if (event.type === 'delivered' || event.type === 'delivery_failed') {
    const taskId = /\bT-(?:QA|PUR|SALES)\b/.exec(event.message || '')?.[0]
    const target = { 'T-QA': '质量核验任务', 'T-PUR': '采购任务', 'T-SALES': '销售任务' }[taskId] || '任务'
    return { id: event.id, summary: target + (event.type === 'delivered' ? '已送达' : '发送失败') }
  }
  const actor = ROLE_NAMES[event.actor] || '系统'
  const text = {
    select_plan: '记录了方案选择意向',
    request_quality: '发起了方案版本核验',
    accept_task: '确认接收了任务',
    start_task: '开始处理任务',
    submit_quality: '提交了方案核验结论',
    approve_keep_a: '批准保留 A 并跟进',
    approve_switch: '批准切换至 B',
    send_tasks: '确认发送部门任务',
    submit_receipt: '提交了处理回执',
    close_matter: '复核回执并关闭了办公事项',
    retry_delivery: '重试了任务送达',
    delivered: '完成了一次任务送达',
    delivery_failed: '发送任务未成功',
    set_arrival: '更新了演示到料信息',
    reset: '重置了演示事项',
  }[event.type]
  return { id: event.id, summary: `${actor}${text || '记录了事项进展'}` }
}

/** One immutable-revision view for cards, lists, detail and assistant context. */
export function presentMatter(state, role) {
  if (isBusinessEvent(state)) return eventPresentation(state, role)
  const analysis = analyze(state)
  const closing = closingFacts(state)
  const selection = state.matter.planSelection
  const review = currentPlanReview(state)
  const qa = state.tasks.find(task => isCurrentQualityTask(state,task))
  const closed = state.matter.status === 'closed'
  const invalidApproval = !closed && Boolean(state.matter.executionApproval) && !closing.executionApproved
  const activeQa = qa && qa.status !== 'completed'
  // A rejected historical review does not block a newly opened review round.
  const rejected = !closed && review?.result === 'rejected' && !activeQa
  const relevantTasks = state.tasks.filter(task => task.id === 'T-QA' ? isCurrentQualityTask(state,task) : !invalidApproval)
  const failedTasks = closed ? [] : relevantTasks.filter(task => task.status === 'delivery_failed')
  let stage
  if (closed) stage = '已办结'
  else if (closing.executionApproved) stage = closing.canClose ? '待复核' : relevantTasks.some(task => task.status === 'pending_delivery') ? '待发送' : '部门执行'
  else if (!selection) stage = '待选择'
  else if (activeQa) stage = '核验中'
  else if (rejected) stage = '核验不通过'
  else if (review?.result === 'approved') stage = '待批准'
  else stage = '待发起核验'

  const blockers = []
  const waitingRoles = []
  const wait = (roles, message) => { waitingRoles.push(...roles); blockers.push(message) }
  if (!closed) {
    if (invalidApproval) blockers.push('原批准依据的核验已失效，须补核验并由负责人重新批准；历史任务及凭据保留，重新批准前暂停部门办理。')
    for (const task of failedTasks) wait([task.assignee], `${ROLE_NAMES[task.assignee]}任务发送失败，${task.attempts >= 3 ? '已达本轮送达尝试上限，需检查失败原因' : '需重试送达'}。`)
    if (stage === '待选择') wait(['lead', 'procurement'], '等待业务负责人或采购经办选择方案；选择意向不改变生效安排。')
    else if (stage === '待发起核验') wait(['lead', 'procurement'], '等待业务负责人或采购经办发起所选方案版本的质量核验。')
    else if (stage === '核验不通过') wait(['lead', 'procurement'], '所选方案版本核验不通过，需补齐依据或改选后重新发起核验。')
    else if (stage === '核验中' && !failedTasks.some(task => task.id === 'T-QA')) wait(['quality'], `等待质量负责人${qa.status === 'delivered' ? '接收核验任务' : qa.status === 'accepted' ? '开始核验' : '提交核验结论和凭据'}。`)
    else if (stage === '待批准') wait(['lead'], '当前方案版本已通过核验，等待业务负责人批准。')
    else if (stage === '待发送') wait(['lead'], '已批准方案，等待业务负责人单独确认发送部门任务。')
    else if (stage === '部门执行') {
      for (const id of closing.missingReceipts) {
        const task = relevantTasks.find(item => item.id === id)
        const assignee = task?.assignee || (id === 'T-PUR' ? 'procurement' : 'sales')
        if (task?.status !== 'delivery_failed') wait([assignee], `等待${ROLE_NAMES[assignee]}${task?.status === 'delivered' ? '接收任务并提交回执' : task?.status === 'accepted' ? '开始处理并提交回执' : '提交处理回执'}。`)
      }
    } else if (stage === '待复核') wait(['lead'], '采购与销售回执已齐，等待业务负责人最终复核。')
  }

  const supplierA = state.suppliers.find(supplier => supplier.id === 'A')
  const originalDay = supplierA.originalDay
  const noticeArrivalDay = supplierA.arrivalDay
  const delayDays = Math.max(0, noticeArrivalDay - originalDay)
  const title = delayDays > 0 ? `原料 ${state.matter.materialId} 预计延期 ${delayDays} 天` : `原料 ${state.matter.materialId} 预计${noticeArrivalDay < originalDay ? `提前 ${originalDay - noticeArrivalDay} 天` : '按原计划'}到料`
  const linkedOrders = state.orders.filter(order => order.materialId === state.matter.materialId)
  const options = analysis.options.map(option => ({
    supplierId: option.supplierId,
    arrivalDay: option.arrivalDay,
    riskCount: option.riskCount,
    riskOrderIds: linkedOrders.filter(order => option.arrivalDay > order.requiredDay).map(order => order.id),
    arrangement: option.supplierId === 'A' ? '沿用供应商 A 的供货安排，继续跟进到料风险' : '提出切换至供应商 B，须核验并获批准后才生效',
    conditions: ['质量岗位人工核验所选方案版本', '业务负责人明确批准', '批准后另行确认发送部门任务'],
  }))
  const a = options.find(option => option.supplierId === 'A')
  const b = options.find(option => option.supplierId === 'B')
  let conclusion
  if (closed) conclusion = `办公协同事项已办结，关闭时生效安排为 ${state.matter.review?.supplierId || state.matter.supplierId}；不代表原料已到货或订单已交付。`
  else if (invalidApproval) conclusion = `${stage === '待批准' ? '当前版本已补齐核验，等待负责人重新批准' : '原批准依据的核验已失效，需补核验并由负责人重新批准'}；历史任务及凭据保留，重新批准后另行发送部门任务。`
  else if (failedTasks.length) conclusion = `${failedTasks.length} 项任务发送失败，当前办理停留在${stage}；需处理送达问题。`
  else if (rejected) conclusion = `所选 ${selection.supplierId} 方案版本核验不通过，需补齐依据或调整方案；当前生效安排仍为 ${state.matter.supplierId}。`
  else if (closing.executionApproved) conclusion = `已批准${selection?.supplierId === 'A' ? '保留 A 并跟进' : '切换至 B'}，${stage === '待复核' ? '双回执已齐，等待最终复核' : stage === '待发送' ? '等待单独确认发送部门任务' : '等待部门完成办理与回执'}；当前 ${analysis.riskCount} 条订单存在到料风险。`
  else if (selection) conclusion = `已选择 ${selection.supplierId} 方案，${stage === '待批准' ? '当前版本已通过核验，等待负责人批准' : stage === '核验中' ? '等待质量岗位完成版本核验' : '等待发起版本核验'}；当前生效安排仍为 ${state.matter.supplierId}。`
  else conclusion = `A 到料通知由 D${originalDay} 更新至 D${noticeArrivalDay}，${analysis.linkedCount} 条关联订单中 ${analysis.riskCount} 条存在到料风险；待比较并选择方案。`

  return {
    revision: state.revision,
    title,
    category: closed ? 'closed' : state.firstAnalyzedAt || selection || state.tasks.length ? 'processing' : 'warning',
    stage,
    conclusion,
    blockers,
    waitingRoles: [...new Set(waitingRoles)],
    actions: availableActions(state, role),
    priority: failedTasks.length || rejected ? 0 : 1,
    earliestRequiredDay: linkedOrders.length ? Math.min(...linkedOrders.map(order => order.requiredDay)) : 0,
    delayDays,
    originalDay,
    noticeArrivalDay,
    effectiveSupplierId: state.matter.supplierId,
    ...(selection ? { selectedVersionId: selection.planVersionId } : {}),
    ...(closing.executionApproved && state.matter.executionApproval?.planVersionId ? { approvedVersionId: state.matter.executionApproval.planVersionId } : {}),
    options,
    delta: { arrivalDaysEarlier: a.arrivalDay - b.arrivalDay, riskOrdersFewer: a.riskCount - b.riskCount },
    sourceIds: getDocuments(state).map(document => document.id),
    events: state.events.map(eventSummary),
  }
}

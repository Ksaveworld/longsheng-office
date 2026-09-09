import { randomUUID } from 'node:crypto'

const ROLES = ['procurement', 'quality', 'sales', 'lead']
const LABELS = { procurement: '采购经办', quality: '质量负责人', sales: '销售经办', lead: '业务负责人' }
const SOURCE = '合成样例 · 独立演示后台'

function fail(message, code = 'INVALID_ACTION', status = 422) {
  const error = new Error(message)
  Object.assign(error, { status, code })
  throw error
}

export function createState() {
  const state = {
    revision: 1,
    matter: { id: 'SUP-001', title: '供应商交期变更', status: 'open', supplierId: 'A', materialId: 'M-01' },
    suppliers: [
      { id: 'A', name: '供应商 A', arrivalDay: 6, originalDay: 3, quality: 'approved' },
      { id: 'B', name: '供应商 B', arrivalDay: 4, quality: 'pending' },
    ],
    orders: [
      { id: 'ORD-001', requiredDay: 5, materialId: 'M-01' },
      { id: 'ORD-002', requiredDay: 8, materialId: 'M-01' },
    ],
    decisions: [
      { id: 'DEC-01', status: 'effective', supplierId: 'A', sequence: 1, sourceId: 'DOC-MEETING-01', text: '已批准由供应商 A 供应 M-01；在新的切换决定批准前继续有效。' },
      { id: 'DEC-02', status: 'conditional', supplierId: 'B', sequence: 2, sourceId: 'DOC-MEETING-02', text: '提出备选供应商 B；仅在质量核验通过且业务负责人明确批准后切换。此记录不构成切换批准。' },
    ],
    documents: [], tasks: [], events: [], failNextDelivery: false,
  }
  state.documents = getDocuments(state)
  return state
}

export function analyze(state) {
  const linked = state.orders.filter(order => order.materialId === state.matter.materialId)
  const selected = state.suppliers.find(supplier => supplier.id === state.matter.supplierId)
  const orders = linked.map(order => ({ id: order.id, requiredDay: order.requiredDay,
    arrivalDay: selected.arrivalDay, lateDays: Math.max(0, selected.arrivalDay - order.requiredDay), atRisk: selected.arrivalDay > order.requiredDay }))
  const qa = state.tasks.find(task => task.id === 'T-QA')
  const supplierB = state.suppliers.find(supplier => supplier.id === 'B')
  const closing = closingFacts(state)
  let nextStep
  if (state.matter.status === 'closed') nextStep = '办公协同事项已关闭；不代表原料到货或订单已交付。'
  else if (closing.executionApproved) {
    nextStep = closing.canClose
      ? '采购、销售回执已齐，请业务负责人复核并关闭办公事项。'
      : '请采购、销售处理各自任务并提交回执；发送失败的任务需先重试。'
  } else if (state.matter.planSelection?.supplierId === 'A') nextStep = '已选择保留供应商 A，尚未批准跟进；请业务负责人复核到料风险并确认采购、销售跟进。'
  else if (!state.matter.planSelection && !qa) nextStep = '请采购或业务负责人比较 A、B 方案，填写理由并选择后继续办理。'
  else if (!qa) nextStep = '已选择供应商 B；请采购或业务负责人确认发起质量核验任务。'
  else if (supplierB.quality === 'rejected') nextStep = '供应商 B 质量核验未通过，不能切换；补齐依据后由采购或负责人重新发起核验。'
  else if (qa.status === 'delivery_failed') nextStep = '质量任务发送失败，请重试送达。'
  else if (supplierB.quality === 'approved' && qa.status === 'completed') nextStep = '质量核验已通过，请业务负责人审阅并确认切换方案。'
  else nextStep = '等待质量负责人提交核验结论和证据，期间 DEC-01 继续有效。'
  return {
    linkedCount: linked.length, riskCount: orders.filter(order => order.atRisk).length, orders,
    options: state.suppliers.map(supplier => ({ supplierId: supplier.id, name: supplier.name,
      arrivalDay: supplier.arrivalDay, quality: supplier.quality,
      riskCount: linked.filter(order => supplier.arrivalDay > order.requiredDay).length,
      eligible: supplier.quality === 'approved' })),
    effectiveDecisionId: state.decisions.find(decision => decision.status === 'effective')?.id ?? null,
    conditionalDecisionId: state.decisions.find(decision => decision.status === 'conditional')?.id ?? null,
    nextStep, ...closing,
  }
}

export function closingFacts(state) {
  const qa = state.tasks.find(task => task.id === 'T-QA')
  const missingReceipts = ['T-PUR', 'T-SALES'].filter(id => !state.tasks.some(task => task.id === id && ['awaiting_review', 'completed'].includes(task.status) && task.receipt?.evidence?.trim()))
  const switched = state.matter.supplierId === 'B' && state.decisions.some(decision => decision.id === 'DEC-03' && decision.status === 'effective' && decision.supplierId === 'B')
  const keptA = state.matter.supplierId === 'A' && state.matter.planSelection?.supplierId === 'A' && state.matter.followupApproval?.approvedBy === 'lead' && Boolean(state.matter.followupApproval.reason?.trim()) && state.decisions.some(decision => decision.id === 'DEC-01' && decision.status === 'effective')
  const approved = switched || keptA
  const qualityComplete = state.suppliers.find(supplier => supplier.id === 'B').quality === 'approved' && qa?.status === 'completed' && qa.qualityResult === 'approved' && Boolean(qa.receipt?.evidence?.trim())
  const canClose = state.matter.status !== 'closed' && approved && (keptA || qualityComplete) && missingReceipts.length === 0 && !state.tasks.some(task => task.status === 'delivery_failed')
  const pendingActionCount = state.matter.status === 'closed' ? 0 : approved ? missingReceipts.length + (canClose ? 1 : 0) : 1
  return { pendingActionCount, missingReceipts, canClose, executionApproved: approved, ...(approved ? { executionSupplierId: keptA ? 'A' : 'B' } : {}) }
}

// V1 and V2 JSON records retain their original history. Legacy workflow metadata
// remains available as historical data but never controls current actions.
export function migrateState(state) {
  const next = structuredClone(state)
  for (const task of next.tasks) {
    task.workStatus = ['in_progress', 'awaiting_review', 'completed'].includes(task.status) ? task.status : 'pending'
    task.delivery = { status: task.status === 'delivery_failed' ? 'failed' : task.status === 'pending_delivery' ? 'pending' : 'sent', attempts: task.attempts ?? 0, ...(task.deliveryError ? { error: task.deliveryError } : {}) }
  }
  if (next.decisions.some(decision => decision.id === 'DEC-03' && decision.supplierId === 'B')) {
    const candidate = next.decisions.find(decision => decision.id === 'DEC-02')
    if (candidate) candidate.status = 'fulfilled'
  }
  return next
}

export function getDocuments(state) {
  const supplierA = state.suppliers.find(supplier => supplier.id === 'A')
  const supplierB = state.suppliers.find(supplier => supplier.id === 'B')
  const analysis = analyze(state)
  const rows = [
    ['DOC-NOTICE', '采购延期通知样例', `SUP-001：原料 M-01 的供应商 A 原定 D${supplierA.originalDay} 到料，当前通知更新为 D${supplierA.arrivalDay}。业务日期为相对演示日期。`],
    ['DOC-LEDGER', '采购与订单台账样例', `SUP-001 关联物料 M-01。ORD-001 最迟 D5 到料；ORD-002 最迟 D8 到料。A 当前 D${supplierA.arrivalDay}，B 当前 D${supplierB.arrivalDay}。当前方案为 ${state.matter.supplierId}；关联 ${analysis.linkedCount} 单，${analysis.riskCount} 单有到料风险。B 质量状态：${supplierB.quality}。`],
    ['DOC-MEETING-01', '第一次会议记录样例 · DEC-01', '原始会议事实（较早）：批准供应商 A 供应 M-01，形成 DEC-01。新切换决定获批准前，DEC-01 持续有效。历史原文保留，不随当前状态改写。'],
    ['DOC-MEETING-02', '第二次会议记录样例 · DEC-02', '原始会议事实（较新）：建议将供应商 B 作为备选，B 可在 D4 到料。条件为 B 通过质量资格核验，并由业务负责人明确批准。形成有条件方案 DEC-02，未批准直接切换；较新的会议不能自动替代有效决定 DEC-01。'],
    ['DOC-ROLES', '组织与任务职责样例', '采购经办（procurement）：选择方案、发起质量核验、采购跟进并提交回执；质量负责人（quality）：核验 B 并提供凭据；销售经办（sales）：同步交期并提交回执；业务负责人（lead）：选择方案、批准切换或确认保留 A 的跟进、复核关闭。全部岗位为演示角色，收件箱为页面内模拟。'],
    ['DOC-RULES', '方案选择、跟进与关闭规则样例', '采购或负责人填写理由选择 A 或 B；选择不改变当前有效供应商，也不等于批准。B 质量核验通过且 T-QA 完成后，业务负责人才能人工确认切换，产生 DEC-03，替代 DEC-01 并创建 T-PUR、T-SALES。选择 A 后由负责人确认现存到料风险及跟进，DEC-01 保持有效，DEC-02 仍为条件建议，不伪造 B 核验通过，同样创建采购、销售跟进任务。执行任务创建后不可改选；B 核验正在办理或送达失败时不可改选 A，核验完成后可以改选并保留核验记录。助手只能预览，不能自动批准。两项任务须分别提交非空证据；业务负责人复核后关闭办公协同事项，不代表风险消除、到货、生产完成或订单交付。质量拒绝后可重新发起 T-QA 核验，同一任务保留历史。发送失败可重试，每轮核验或任务最多三次送达尝试。'],
    ['DOC-STATE', '事项当前状态与回执', `当前数据版本 ${state.revision}；事项 ${state.matter.id} 状态 ${state.matter.status}，当前生效供应商 ${state.matter.supplierId}。选择意向：${state.matter.planSelection ? `${state.matter.planSelection.supplierId}（${state.matter.planSelection.reason}）` : '尚未记录'}。跟进批准：${analysis.executionApproved ? `已批准 ${analysis.executionSupplierId}` : '尚未批准'}。决定：${state.decisions.map(decision => `${decision.id}=${decision.status}（${decision.text}）`).join('；')}。任务：${state.tasks.length ? state.tasks.map(task => `${task.id} 收件人 ${LABELS[task.assignee]}，状态 ${task.status}，送达尝试 ${task.attempts}，核验结论 ${task.qualityResult ?? '无'}，回执 ${typeof task.receipt === 'string' ? task.receipt : task.receipt?.evidence ?? '无'}`).join('；') : '尚未创建'}。下一步：${analysis.nextStep}`],
    ['DEMO-STATE', '当前事项及业务记录（合成样例）', JSON.stringify({ revision: state.revision, matter: state.matter, suppliers: state.suppliers, orders: state.orders, decisions: state.decisions, tasks: state.tasks, events: state.events, failNextDelivery: state.failNextDelivery })],
  ]
  const approvedDecision = state.decisions.find(decision => decision.id === 'DEC-03')
  const qualityTask = state.tasks.find(task => task.id === 'T-QA')
  const selection = state.matter.planSelection
  if (selection) rows.push(['DOC-PLAN-SELECTION', '方案选择记录', `选择供应商 ${selection.supplierId}；选择人 ${LABELS[selection.selectedBy]}；时间 ${selection.selectedAt}；版本 ${selection.revision}；理由：${selection.reason}。方案选择不等于批准，当前生效供应商仍以有效决定为准。`])
  const approval = state.matter.followupApproval
  if (approval) rows.push(['DOC-KEEP-A', '保留供应商 A 的跟进确认', `业务负责人 ${LABELS[approval.approvedBy]} 于 ${approval.approvedAt} 确认保留 A 并交采购、销售跟进。理由：${approval.reason}。确认时 ${approval.riskCount} 单有到料风险；当前 ${analysis.riskCount} 单有风险。DEC-01 继续有效，未批准切换 B，也不表示风险消除。`])
  const review = state.matter.review
  if (review) rows.push(['DOC-CLOSE-REVIEW', '回执汇总与最终复核记录', `复核人 ${LABELS[review.reviewedBy]}；时间 ${review.reviewedAt}；复核回执 ${review.receiptTaskIds.join('、')}；有效决定 ${review.decisionId}；供应商 ${review.supplierId}；关闭时仍有 ${review.riskCount} 单到料风险。仅确认办公协同完成，不表示到货或订单交付。`])
  if (qualityTask?.receipt) rows.push(['QA-B-001', '质量核验记录样例', `供应商 B · M-01；结论 ${qualityTask.qualityResult}；凭据 ${qualityTask.receipt.evidence}；记录人 ${LABELS[qualityTask.receipt.actor]}；时间 ${qualityTask.receipt.at}。`])
  for (const id of ['T-PUR', 'T-SALES']) {
    const task = state.tasks.find(task => task.id === id)
    if (task?.receipt) rows.push([`DOC-RECEIPT-${id}`, `${id} 处理回执`, `凭据 ${task.receipt.evidence}；记录人 ${LABELS[task.receipt.actor]}；时间 ${task.receipt.at}。`])
  }
  if (approvedDecision) rows.push(['DOC-DECISION-03', '切换批准记录 · DEC-03', `${approvedDecision.text} 确认人：${LABELS[approvedDecision.approvedBy]}；实际记录时间：${approvedDecision.createdAt}；当前状态：${approvedDecision.status}。关联质量任务凭据：${JSON.stringify(state.tasks.find(task => task.id === 'T-QA')?.receipt ?? null)}。`])
  return rows.map(([id, title, text]) => ({ id, title, text: `[${id}] ${text}`, source: SOURCE }))
}

function check(state, action, role) {
  if (!ROLES.includes(role)) fail('未知演示角色。', 'FORBIDDEN', 403)
  if (!action || typeof action !== 'object' || Array.isArray(action)) fail('请提供有效操作。')
  if (state.matter.status === 'closed' && action.type !== 'reset') fail('事项已关闭，请重置当前演示后重新开始。', 'MATTER_CLOSED', 409)
  const roleIs = (...allowed) => { if (!allowed.includes(role)) fail('当前角色无权执行此操作。', 'FORBIDDEN', 403) }
  const taskFor = id => { const task = state.tasks.find(item => item.id === id); if (!task) fail('任务不存在。', 'TASK_NOT_FOUND', 404); return task }
  const hasEvidence = () => { if (typeof action.evidence !== 'string' || !action.evidence.trim() || action.evidence.length > 4000) fail('请填写 1 至 4000 字的处理证据或回执。', 'EVIDENCE_REQUIRED') }
  const qa = state.tasks.find(task => task.id === 'T-QA')
  const supplierB = state.suppliers.find(supplier => supplier.id === 'B')
  switch (action.type) {
    case 'select_plan':
      roleIs('procurement', 'lead')
      if (!['A', 'B'].includes(action.supplierId)) fail('请选择供应商 A 或 B。', 'PLAN_INVALID')
      hasEvidence()
      if (state.tasks.some(task => ['T-PUR', 'T-SALES'].includes(task.id)) || closingFacts(state).executionApproved) fail('执行跟进已获批准，不能再改选方案。', 'PLAN_LOCKED', 409)
      if (action.supplierId === 'A' && qa && qa.status !== 'completed') fail('质量核验任务仍在办理或等待送达，请先完成原任务后再改选 A。', 'QUALITY_IN_PROGRESS', 409)
      if (state.matter.planSelection?.supplierId === action.supplierId) fail('当前已选择该方案。', 'NO_CHANGE', 409)
      return { title: `选择供应商 ${action.supplierId} 方案`, details: [`选择理由：${action.evidence.trim()}`, '本次仅记录方案选择，不改变有效决定，也不代表负责人批准。', action.supplierId === 'A' ? '保留 A 的到料风险仍然存在，后续须由负责人确认采购、销售跟进。' : 'B 须先通过质量核验，再由负责人批准切换。'] }
    case 'approve_keep_a':
      roleIs('lead')
      if (closingFacts(state).executionApproved || state.tasks.some(task => ['T-PUR', 'T-SALES'].includes(task.id))) fail('执行跟进已获批准。', 'ALREADY_APPROVED', 409)
      if (state.matter.planSelection?.supplierId !== 'A' || state.matter.supplierId !== 'A') fail('请先选择保留供应商 A 并填写理由。', 'PLAN_NOT_SELECTED', 409)
      if (qa && qa.status !== 'completed') fail('请先完成正在办理的质量任务。', 'QUALITY_IN_PROGRESS', 409)
      if (action.evidence !== undefined) hasEvidence()
      if (!(action.evidence ?? state.matter.planSelection.reason)?.trim()) fail('缺少保留 A 的理由。', 'EVIDENCE_REQUIRED')
      return { title: '确认保留供应商 A 并跟进', details: [`理由：${(action.evidence ?? state.matter.planSelection.reason).trim()}`, `当前 ${analyze(state).riskCount} 单存在到料风险；确认跟进不代表风险消除。`, 'DEC-01 继续有效；创建 T-PUR、T-SALES，由采购和销售分别跟进并回执。', '不批准切换 B，不改变 B 的质量结论。'] }
    case 'request_quality':
      roleIs('procurement', 'lead')
      if (state.matter.supplierId !== 'A' || closingFacts(state).executionApproved) fail('执行跟进已批准，无需再次创建质量核验。', 'ALREADY_APPROVED', 409)
      if (state.matter.planSelection?.supplierId === 'A') fail('当前选择保留 A，请先选择 B 后发起质量核验。', 'PLAN_MISMATCH', 409)
      if (qa && !(qa.status === 'completed' && supplierB.quality === 'rejected')) fail('质量任务已存在，请处理或重试原任务。', 'TASK_EXISTS', 409)
      return { title: qa ? '重新发起质量核验' : '发起质量核验', details: ['事项 SUP-001，备选供应商 B；接收人：质量负责人。', '截止时间：切换批准前完成；到料方案为 D4。', qa ? '重开原任务 T-QA，保留上轮凭据。' : '确认后创建 T-QA，并尝试送达模拟收件箱。'] }
    case 'start_task': {
      const task = taskFor(action.taskId); roleIs(task.assignee)
      if (task.status !== 'delivered') fail('仅已送达的任务可以开始处理。', 'TASK_STATE_CONFLICT', 409)
      return { title: '开始处理任务', details: [`${task.id}：${task.title}。`, `处理人：${LABELS[role]}。`] }
    }
    case 'submit_quality':
      roleIs('quality')
      if (action.taskId !== 'T-QA') fail('质量核验必须关联任务 T-QA。')
      if (qa?.status !== 'in_progress') fail('请先开始处理质量任务，再提交核验结果。', 'TASK_STATE_CONFLICT', 409)
      if (!['approved', 'rejected'].includes(action.result)) fail('质量结论须为通过或拒绝。')
      hasEvidence()
      return { title: '提交质量核验', details: [`供应商 B 核验结论：${action.result === 'approved' ? '通过' : '不通过'}。`, `凭据：${action.evidence.trim()}`, '此次确认不批准切换供应商。'] }
    case 'approve_switch':
      roleIs('lead')
      if (closingFacts(state).executionApproved || state.decisions.some(decision => decision.id === 'DEC-03')) fail('执行跟进已批准。', 'ALREADY_APPROVED', 409)
      if (state.matter.planSelection?.supplierId === 'A') fail('当前选择保留 A，不能批准切换 B。', 'PLAN_MISMATCH', 409)
      if (supplierB.quality !== 'approved' || qa?.status !== 'completed' || qa.qualityResult !== 'approved' || !qa.receipt?.evidence?.trim()) fail('供应商 B 尚未通过质量核验，或缺少质量凭据。', 'QUALITY_NOT_APPROVED', 409)
      return { title: '批准切换供应商 B', details: ['依据：DEC-02 条件方案与 T-QA 通过回执。', '生成 DEC-03 为有效决定，DEC-01 保留为已替代历史。', '创建 T-PUR 交采购经办、T-SALES 交销售经办；仅模拟收件箱送达。', '不代表原料已到货或订单已交付。'] }
    case 'submit_receipt': {
      const task = taskFor(action.taskId); roleIs(task.assignee)
      if (!['T-PUR', 'T-SALES'].includes(task.id)) fail('此任务须使用质量核验操作。')
      if (task.status !== 'in_progress') fail('请先开始处理任务，再提交回执。', 'TASK_STATE_CONFLICT', 409)
      hasEvidence()
      return { title: '提交任务回执', details: [`${task.id}：${task.title}。`, `回执：${action.evidence.trim()}`, '提交后进入待复核，由业务负责人确认事项关闭。'] }
    }
    case 'close_matter':
      roleIs('lead')
      if (!closingFacts(state).executionApproved) fail('所选方案尚未完成负责人确认，不能关闭事项。', 'CLOSE_CONDITIONS_UNMET', 409)
      if (!['T-PUR', 'T-SALES'].every(id => { const task = state.tasks.find(item => item.id === id); return task && ['awaiting_review', 'completed'].includes(task.status) && task.receipt?.evidence?.trim() })) fail('采购、销售回执尚未齐全，不能关闭事项。', 'CLOSE_CONDITIONS_UNMET', 409)
      if (!closingFacts(state).canClose) fail('质量凭据或任务送达条件尚未满足，不能关闭事项。', 'CLOSE_CONDITIONS_UNMET', 409)
      return { title: '复核并关闭办公事项', details: ['复核采购安排和销售同步两份回执。', ...state.tasks.filter(task => ['T-PUR', 'T-SALES'].includes(task.id)).map(task => `${task.id}：${task.receipt.evidence}`), `当前方案 ${state.matter.supplierId}，仍有 ${analyze(state).riskCount} 单到料风险。`, '确认后任务标记已完成，SUP-001 办公协同事项关闭。', '关闭仅表示办公协同完成，不表示风险消除、采购到货、生产完成或订单交付。'] }
    case 'retry_delivery': {
      const task = taskFor(action.taskId); roleIs('procurement', 'lead', task.assignee)
      if (task.status !== 'delivery_failed') fail('任务当前不需要重试送达。', 'TASK_STATE_CONFLICT', 409)
      if (task.attempts >= 3) fail('已达到三次送达尝试上限，请检查失败原因；演示可重置后重试。', 'RETRY_LIMIT', 409)
      return { title: '重试任务送达', details: [`沿用任务 ${task.id}，不会创建重复任务。`, `接收人：${LABELS[task.assignee]}，即将进行第 ${task.attempts + 1} 次送达尝试。`] }
    }
    case 'set_arrival':
      roleIs('lead')
      if (action.supplierId !== 'A' || !Number.isInteger(action.day) || action.day < 1 || action.day > 30) fail('仅支持将供应商 A 到料日设为 D1 至 D30 的整数。')
      if (state.suppliers.find(supplier => supplier.id === 'A').arrivalDay === action.day) fail('到料日期未发生变化。', 'NO_CHANGE', 409)
      return { title: '调整演示到料日', details: [`供应商 A 更新为 D${action.day}。`, '订单风险及来源台账同步重算；供应商 B 的方案保持独立比较。'] }
    case 'arm_delivery_failure':
      roleIs('lead')
      if (state.failNextDelivery) fail('下一次送达故障已设置。', 'NO_CHANGE', 409)
      return { title: '模拟一次发送失败', details: ['下一次任务创建或重试送达将失败一次。', '故障随后自动清除，原任务可人工重试。'] }
    case 'reset':
      roleIs('lead')
      return { title: '重置当前演示', details: ['清除当前空间的任务与决定变更，恢复合成样例。', '不会影响其他空间或旧产销 Demo。'] }
    default: fail('不支持的操作。', 'UNKNOWN_ACTION')
  }
}

export function previewAction(state, action, role) {
  try {
    const summary = check(state, action, role)
    return { allowed: true, reason: '', ...summary, action: structuredClone(action), revision: state.revision }
  } catch (error) {
    if (!error.code || !error.status) throw error
    return { allowed: false, reason: error.message, title: '当前无法执行', details: [], action: structuredClone(action), revision: state.revision }
  }
}

export function applyAction(state, action, role) {
  const summary = check(state, action, role)
  const next = action.type === 'reset' ? createState() : migrateState(state)
  next.revision = state.revision + 1
  const at = new Date().toISOString()
  const event = (type, message) => next.events.push({ id: randomUUID(), at, type, actor: role, message })
  const deliver = task => {
    task.attempts += 1
    task.status = next.failNextDelivery ? 'delivery_failed' : 'delivered'
    if (next.failNextDelivery) {
      next.failNextDelivery = false
      task.deliveryError = '演示故障：模拟收件箱发送失败，可重试。'
    } else { delete task.deliveryError; task.deliveredAt = at }
    event(task.status, `${task.id} 第 ${task.attempts} 次送达：${task.status === 'delivered' ? '已送达模拟收件箱' : task.deliveryError}`)
  }
  const createTask = (id, title, assignee) => {
    const task = { id, title, assignee, status: 'pending_delivery', attempts: 0, createdAt: at }
    next.tasks.push(task)
    deliver(task)
    return task
  }
  switch (action.type) {
    case 'select_plan':
      next.matter.planSelection = { supplierId: action.supplierId, selectedBy: role, selectedAt: at, revision: next.revision, reason: action.evidence.trim() }
      break
    case 'approve_keep_a':
      next.matter.followupApproval = { approvedBy: role, approvedAt: at, riskCount: analyze(state).riskCount, sourceId: 'DOC-KEEP-A', reason: (action.evidence ?? next.matter.planSelection.reason).trim() }
      createTask('T-PUR', '跟进供应商 A 的到料安排及延期风险', 'procurement')
      createTask('T-SALES', '同步供应商 A 方案的订单交期风险', 'sales')
      break
    case 'request_quality': {
      if (!next.matter.planSelection) next.matter.planSelection = { supplierId: 'B', selectedBy: role, selectedAt: at, revision: next.revision, reason: '通过发起供应商 B 质量核验确认选择 B 备选方案，待核验及负责人批准。' }
      const task = next.tasks.find(item => item.id === 'T-QA')
      if (task) {
        task.history = [...(task.history ?? []), { receipt: task.receipt, qualityResult: task.qualityResult, attempts: task.attempts, completedAt: task.completedAt, startedAt: task.startedAt, deliveredAt: task.deliveredAt, reopenedAt: task.reopenedAt }]
        delete task.receipt; delete task.qualityResult; delete task.completedAt
        delete task.startedAt; delete task.deliveredAt; delete task.deliveryError
        task.attempts = 0
        task.reopenedAt = at
        next.suppliers.find(supplier => supplier.id === 'B').quality = 'pending'
        deliver(task)
      } else createTask('T-QA', '核验供应商 B 的质量资格', 'quality')
      break
    }
    case 'start_task': {
      const task = next.tasks.find(item => item.id === action.taskId)
      task.status = 'in_progress'; task.startedAt = at
      break
    }
    case 'submit_quality': {
      const task = next.tasks.find(item => item.id === 'T-QA')
      task.status = 'completed'; task.qualityResult = action.result; task.completedAt = at
      task.receipt = { evidence: action.evidence.trim(), at, actor: role, sourceId: 'QA-B-001' }
      next.suppliers.find(supplier => supplier.id === 'B').quality = action.result
      break
    }
    case 'approve_switch':
      next.matter.supplierId = 'B'
      next.decisions.find(decision => decision.id === 'DEC-01').status = 'superseded'
      next.decisions.find(decision => decision.id === 'DEC-02').status = 'fulfilled'
      next.decisions.push({ id: 'DEC-03', status: 'effective', supplierId: 'B', sequence: 3, sourceId: 'DOC-DECISION-03', basedOn: ['DEC-02', 'T-QA'], approvedBy: role, createdAt: at, text: '依据 DEC-02 条件方案及 T-QA 通过凭据，由业务负责人确认切换供应商 B；采购和销售分别跟进并回执。' })
      createTask('T-PUR', '确认供应商 B 的采购安排', 'procurement')
      createTask('T-SALES', '同步关联订单交期信息', 'sales')
      break
    case 'submit_receipt': {
      const task = next.tasks.find(item => item.id === action.taskId)
      task.status = 'awaiting_review'
      task.receipt = { evidence: action.evidence.trim(), at, actor: role }
      break
    }
    case 'close_matter':
      next.matter.review = { reviewedBy: role, reviewedAt: at, receiptTaskIds: ['T-PUR', 'T-SALES'], decisionId: analyze(state).effectiveDecisionId, supplierId: state.matter.supplierId, riskCount: analyze(state).riskCount }
      for (const task of next.tasks.filter(item => ['T-PUR', 'T-SALES'].includes(item.id))) { task.status = 'completed'; task.completedAt = at; task.reviewedBy = role }
      next.matter.status = 'closed'; next.matter.closedAt = at
      break
    case 'retry_delivery': deliver(next.tasks.find(task => task.id === action.taskId)); break
    case 'set_arrival': next.suppliers.find(supplier => supplier.id === 'A').arrivalDay = action.day; break
    case 'arm_delivery_failure': next.failNextDelivery = true; break
    case 'reset': break
  }
  event(action.type, [summary.title, ...summary.details].join(' '))
  const normalized = migrateState(next)
  normalized.documents = getDocuments(normalized)
  return normalized
}

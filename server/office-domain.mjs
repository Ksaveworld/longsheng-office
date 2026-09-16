import { randomUUID, createHash } from 'node:crypto'
import { prepareSupplyImport } from './office-supply-import.mjs'
import { isBusinessEvent, eventAnalysis, eventClosing, eventDocuments, eventPreview, applyEvent } from './office-events.mjs'

const ROLES = ['procurement', 'quality', 'sales', 'lead']
const LABELS = { procurement: '采购经办', quality: '质量负责人', sales: '销售经办', lead: '业务负责人' }
const SOURCE = '合成样例 · 独立演示后台'

function fail(message, code = 'INVALID_ACTION', status = 422) {
  const error = new Error(message)
  Object.assign(error, { status, code })
  throw error
}

export function factsSignature(state) { return createHash('sha256').update(JSON.stringify({material:state.matter.materialId,suppliers:state.suppliers.map(s=>({id:s.id,arrivalDay:s.arrivalDay})),orders:state.orders})).digest('hex') }
export function isCurrentQualityTask(state, task) {
  if (isBusinessEvent(state)) return task?.id === 'T-QA' && task.planVersionId === state.matter.planSelection?.planVersionId
  const selection = state.matter.planSelection
  if (!selection || task?.id !== 'T-QA' || task.planVersionId !== selection.planVersionId || task.selectionInvalidated) return false
  if (state.matter.status === 'closed') return true
  if (Number.isInteger(task.selectionRevision)) return task.selectionRevision === selection.revision
  // Existing schema-3 records have no binding field. Event order distinguishes
  // a new selection from an old review even when timestamps share a millisecond.
  const selectedAt = (state.events || []).findLastIndex(event => event.type === 'select_plan')
  const requestedAt = (state.events || []).findLastIndex(event => event.type === 'request_quality')
  if (selectedAt >= 0 && requestedAt >= 0) return requestedAt > selectedAt
  const selectionTime = Date.parse(selection.selectedAt)
  const requestTime = Date.parse(task.reopenedAt || task.createdAt)
  return Number.isFinite(selectionTime) && Number.isFinite(requestTime) && requestTime >= selectionTime
}
function currentQualityTask(state) {
  return state.tasks.find(task => isCurrentQualityTask(state, task))
}
export function currentPlanReview(state) {
  const task = currentQualityTask(state)
  if (!task || task.status !== 'completed') return undefined
  return (state.planReviews || []).filter(review => review.planVersionId === task.planVersionId && review.reviewedAt === task.receipt?.at).at(-1)
}
function currentQualityApproved(state) {
  const task = currentQualityTask(state)
  const review = currentPlanReview(state)
  return Boolean(task?.status === 'completed' && task.qualityResult === 'approved' && task.receipt?.evidence?.trim() && review?.result === 'approved' && review.evidence?.trim())
}
function approvalMatchesReview(state) {
  const approval = state.matter.executionApproval
  const review = currentPlanReview(state)
  if (!approval || !review || approval.planVersionId !== state.matter.planSelection?.planVersionId) return false
  if (state.matter.status === 'closed') return true
  if (approval.qualityReviewId) return approval.qualityReviewId === review.id
  const approvedAt = (state.events || []).findLastIndex(event => event.type === (state.matter.planSelection.supplierId === 'A' ? 'approve_keep_a' : 'approve_switch'))
  const reviewedAt = (state.events || []).findLastIndex(event => event.type === 'submit_quality')
  if (approvedAt >= 0 && reviewedAt >= 0) return approvedAt > reviewedAt
  const approvalTime = Date.parse(approval.approvedAt)
  const reviewTime = Date.parse(review.reviewedAt)
  return Number.isFinite(approvalTime) && Number.isFinite(reviewTime) && approvalTime >= reviewTime
}
function basePlans(state) { return state.suppliers.map(s=>({id:`${state.matter.id}-${s.id}-v1`,supplierId:s.id,title:`${s.name}方案`,summary:`按当前台账由${s.name}供货`,advantages:[s.id==='B'?'当前预计到料日较早':'沿用当前供货安排'],risks:['需人工核验方案及确认到料风险'],constraints:['质量岗位核验当前方案版本','业务负责人批准后另行发送任务'],sourceIds:['DOC-LEDGER','DOC-MEETING-01','DOC-MEETING-02'].map(id=>state.matter.id==='SUP-001'?id:`${id}-${state.matter.id}`),createdAt:new Date().toISOString(),revision:state.revision,factsSignature:factsSignature(state),origin:'baseline'})) }
export function createState(options = {}) {
  const state = {
    revision: 1, workflowVersion: 3, planReviews: [],
    matter: { id: options.matterId || 'SUP-001', title: options.title || '供应商交期变更', status: 'open', supplierId: 'A', materialId: options.materialId || 'M-01' },
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
  if(options.orders) state.orders=options.orders
  if(options.arrivalDay) state.suppliers[0].arrivalDay=options.arrivalDay
  if(options.alternativeDay) state.suppliers[1].arrivalDay=options.alternativeDay
  state.decisions=state.decisions.map(d=>({...d,text:d.text.replaceAll('M-01',state.matter.materialId),sourceId:state.matter.id==='SUP-001'?d.sourceId:`${d.sourceId}-${state.matter.id}`}))
  state.planVersions=basePlans(state)
  state.documents = getDocuments(state)
  return state
}

export function analyze(state) {
  if (isBusinessEvent(state)) return eventAnalysis(state)
  const linked = state.orders.filter(order => order.materialId === state.matter.materialId)
  const selected = state.suppliers.find(supplier => supplier.id === state.matter.supplierId)
  const orders = linked.map(order => ({ id: order.id, requiredDay: order.requiredDay,
    arrivalDay: selected.arrivalDay, lateDays: Math.max(0, selected.arrivalDay - order.requiredDay), atRisk: selected.arrivalDay > order.requiredDay }))
  const qa = currentQualityTask(state)
  const supplierB = state.suppliers.find(supplier => supplier.id === 'B')
  const closing = closingFacts(state)
  const review=currentPlanReview(state)
  let nextStep
  if(state.matter.status==='closed') nextStep='办公协同事项已关闭；不代表原料到货或订单交付。'
  else if(closing.executionApproved) nextStep=closing.canClose?'采购、销售回执已齐，请业务负责人复核关闭。':state.tasks.some(t=>t.status==='pending_delivery')?'负责人确认后发送部门任务。':'请各岗位接收、处理并提交回执。'
  else if(!state.matter.planSelection) nextStep='请比较并选择 A/B 方案，补充理由可选。'
  else if(review?.result==='approved') nextStep='当前方案版本已通过质量核验，请业务负责人批准。'
  else if(qa && qa.planVersionId===state.matter.planSelection.planVersionId && qa.status!=='completed') nextStep='等待质量岗位接收并核验当前方案版本。'
  else nextStep=review?.result==='rejected'?'当前方案核验不通过，请调整方案或补齐依据重新核验。':'已选择方案，请发起当前方案版本的质量核验。'
  return {
    linkedCount: linked.length, riskCount: orders.filter(order => order.atRisk).length, orders,
    options: state.suppliers.map(supplier => ({ supplierId: supplier.id, name: supplier.name,
      arrivalDay: supplier.arrivalDay, quality: supplier.quality,
      riskCount: linked.filter(order => supplier.arrivalDay > order.requiredDay).length,
      eligible: state.matter.planSelection?.supplierId===supplier.id && currentPlanReview(state)?.result==='approved' })),
    effectiveDecisionId: state.decisions.find(decision => decision.status === 'effective')?.id ?? null,
    conditionalDecisionId: state.decisions.find(decision => decision.status === 'conditional')?.id ?? null,
    nextStep, ...closing,
  }
}

export function closingFacts(state) {
  if (isBusinessEvent(state)) return eventClosing(state)
  const missingReceipts = ['T-PUR', 'T-SALES'].filter(id => !state.tasks.some(task => task.id === id && ['awaiting_review', 'completed'].includes(task.status) && task.receipt?.evidence?.trim()))
  const selected=state.matter.planSelection
  const qualityComplete=currentQualityApproved(state)
  const legacyClosed=state.matter.status==='closed'&&Boolean(state.legacyWorkflow)&&Boolean(state.matter.review||state.matter.closedAt)
  const approved=legacyClosed || (qualityComplete && approvalMatchesReview(state))
  const keptA=approved && (selected?.supplierId||state.matter.supplierId)==='A'
  const canClose=state.matter.status!=='closed' && approved && missingReceipts.length===0 && !state.tasks.some(t=>t.status==='delivery_failed' && !t.selectionInvalidated)
  const pendingActionCount = state.matter.status === 'closed' ? 0 : approved ? missingReceipts.length + (canClose ? 1 : 0) : 1
  return { pendingActionCount, missingReceipts, canClose, executionApproved: approved, ...(approved ? { executionSupplierId: keptA ? 'A' : 'B' } : {}) }
}

// V1 and V2 JSON records retain their original history. Legacy workflow metadata
// remains available as historical data but never controls current actions.
export function migrateState(state) {
  const next = structuredClone(state)
  if(!next.workflowVersion){
    next.legacyWorkflow={tasks:structuredClone(next.tasks),decisions:structuredClone(next.decisions),selection:structuredClone(next.matter.planSelection||null),approval:structuredClone(next.matter.followupApproval||null)}
    next.workflowVersion=3;next.planVersions=basePlans(next);next.planReviews=[]
    if(next.matter.status!=='closed'){next.tasks=[];delete next.matter.followupApproval;delete next.matter.executionApproval}
    if(next.matter.planSelection)next.matter.planSelection.planVersionId=next.planVersions.find(p=>p.supplierId===next.matter.planSelection.supplierId)?.id
  }
  next.planVersions ||= basePlans(next);next.planReviews ||= []
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
  if (isBusinessEvent(state)) return eventDocuments(state)
  const supplierA = state.suppliers.find(supplier => supplier.id === 'A')
  const supplierB = state.suppliers.find(supplier => supplier.id === 'B')
  const analysis = analyze(state)
  const rows = [
    ['DOC-NOTICE', '采购延期通知样例', `${state.matter.id}：原料 ${state.matter.materialId} 的供应商 A 原定 D${supplierA.originalDay} 到料，当前通知更新为 D${supplierA.arrivalDay}。业务日期为相对演示日期。`],
    ['DOC-LEDGER', '采购与订单台账样例', `${state.matter.id} 关联物料 ${state.matter.materialId}。${state.orders[0].id} 最迟 D${state.orders[0].requiredDay} 到料；${state.orders[1].id} 最迟 D${state.orders[1].requiredDay} 到料。A 当前 D${supplierA.arrivalDay}，B 当前 D${supplierB.arrivalDay}。当前方案为 ${state.matter.supplierId}；关联 ${analysis.linkedCount} 单，${analysis.riskCount} 单有到料风险。旧供应商 B 资格记录为 ${supplierB.quality}，不代表所选方案版本审核结果。`],
    ['DOC-MEETING-01', '第一次会议记录样例 · DEC-01', `原始会议事实（较早）：批准供应商 A 供应 ${state.matter.materialId}，形成 DEC-01。新切换决定获批准前，DEC-01 持续有效。历史原文保留，不随当前状态改写。`],
    ['DOC-MEETING-02', '第二次会议记录样例 · DEC-02', `原始会议事实（较新）：建议将供应商 B 作为备选，B 可在 D${supplierB.arrivalDay} 到料。条件为 B 通过质量资格核验，并由业务负责人明确批准。形成有条件方案 DEC-02，未批准直接切换；较新的会议不能自动替代有效决定 DEC-01。`],
    ['DOC-ROLES', '组织与任务职责样例', '采购经办（procurement）：选择方案、发起质量核验、采购跟进并提交回执；质量负责人（quality）：人工核验当前所选 A/B 方案版本并提供凭据；销售经办（sales）：同步交期并提交回执；业务负责人（lead）：选择方案、批准切换或确认保留 A 的跟进、复核关闭。全部岗位为演示角色，收件箱为页面内模拟。'],
    ['DOC-RULES', '方案选择、核验与关闭规则样例', '采购或负责人选择具体 A/B 方案版本，补充理由可选。所有方案均须质量岗位人工核验所选版本并提交凭据，再由负责人批准。选择不等于批准；生成或调整草稿不改变当前选择。批准前可以改选，改选后旧版本核验不能授权新版本；批准后不可改选。负责人批准后创建待发送的采购销售任务，需单独确认发送。各岗位确认接收、开始处理、提交回执。双回执齐全后负责人复核关闭，仅表示办公协同闭环，不代表实物到货或订单交付。核验不通过可调整方案或重新发起，保留历史凭据。通知发送失败可重试，每轮最多三次尝试。'],
    ['DOC-STATE', '事项当前状态与回执', `当前数据版本 ${state.revision}；事项 ${state.matter.id} 状态 ${state.matter.status}，当前生效供应商 ${state.matter.supplierId}。选择意向：${state.matter.planSelection ? `${state.matter.planSelection.supplierId}（${state.matter.planSelection.reason}）` : '尚未记录'}。跟进批准：${analysis.executionApproved ? `已批准 ${analysis.executionSupplierId}` : '尚未批准'}。决定：${state.decisions.map(decision => `${decision.id}=${decision.status}（${decision.text}）`).join('；')}。任务：${state.tasks.length ? state.tasks.map(task => `${task.id} 收件人 ${LABELS[task.assignee]}，状态 ${task.status}，送达尝试 ${task.attempts}，核验结论 ${task.qualityResult ?? '无'}，回执 ${typeof task.receipt === 'string' ? task.receipt : task.receipt?.evidence ?? '无'}`).join('；') : '尚未创建'}。下一步：${analysis.nextStep}`],
  ]
  rows.push(['DOC-PLAN-REVIEW-RULE','本轮方案版本审核规则','本轮演示流程要求 A/B 方案均由质量岗位人工审核具体版本，再由负责人批准；旧供应商资格不等同于当前方案审核通过。调整后选择新版本须重新核验。'])
  rows.push(['DOC-PLAN-VERSIONS','方案版本及审核记录', JSON.stringify({selection:state.matter.planSelection,versions:state.planVersions,reviews:state.planReviews})])
  const approvedDecision = state.decisions.find(decision => decision.id === 'DEC-03')
  const qualityTask = state.tasks.find(task => task.id === 'T-QA')
  const selection = state.matter.planSelection
  if (selection) rows.push(['DOC-PLAN-SELECTION', '方案选择记录', `选择供应商 ${selection.supplierId}；选择人 ${LABELS[selection.selectedBy]}；时间 ${selection.selectedAt}；版本 ${selection.revision}；理由：${selection.reason}。方案选择不等于批准，当前生效供应商仍以有效决定为准。`])
  const approval = state.matter.followupApproval
  if (approval) rows.push(['DOC-KEEP-A', '保留供应商 A 的跟进确认', `业务负责人 ${LABELS[approval.approvedBy]} 于 ${approval.approvedAt} 确认保留 A 并交采购、销售跟进。理由：${approval.reason}。确认时 ${approval.riskCount} 单有到料风险；当前 ${analysis.riskCount} 单有风险。DEC-01 继续有效，未批准切换 B，也不表示风险消除。`])
  const review = state.matter.review
  if (review) rows.push(['DOC-CLOSE-REVIEW', '回执汇总与最终复核记录', `复核人 ${LABELS[review.reviewedBy]}；时间 ${review.reviewedAt}；复核回执 ${review.receiptTaskIds.join('、')}；有效决定 ${review.decisionId}；供应商 ${review.supplierId}；关闭时仍有 ${review.riskCount} 单到料风险。仅确认办公协同完成，不表示到货或订单交付。`])
  if (qualityTask?.receipt) rows.push(['QA-B-001', '质量核验记录样例', `事项 ${state.matter.id} · 方案版本 ${qualityTask.planVersionId}；结论 ${qualityTask.qualityResult}；凭据 ${qualityTask.receipt.evidence}；记录人 ${LABELS[qualityTask.receipt.actor]}；时间 ${qualityTask.receipt.at}。`])
  for (const id of ['T-PUR', 'T-SALES']) {
    const task = state.tasks.find(task => task.id === id)
    if (task?.receipt) rows.push([`DOC-RECEIPT-${id}`, `${id} 处理回执`, `凭据 ${task.receipt.evidence}；记录人 ${LABELS[task.receipt.actor]}；时间 ${task.receipt.at}。`])
  }
  if (approvedDecision) rows.push(['DOC-DECISION-03', '切换批准记录 · DEC-03', `${approvedDecision.text} 确认人：${LABELS[approvedDecision.approvedBy]}；实际记录时间：${approvedDecision.createdAt}；当前状态：${approvedDecision.status}。关联质量任务凭据：${JSON.stringify(state.tasks.find(task => task.id === 'T-QA')?.receipt ?? null)}。`])
  // Resolve template fields where they are defined; completed source text can
  // contain full identifiers and human evidence that must never be rewritten.
  return [...rows.map(([id, title, text]) => { const scoped=state.matter.id==='SUP-001'?id:`${id}-${state.matter.id}`; return {id:scoped,title,text:`[${scoped}] ${text}`,source:SOURCE} }), ...(state.supplyImport?.records || []).map(({ id, title, text, source }) => ({ id, title, text, source })), ...(state.supplyImport?.summary ? [state.supplyImport.summary] : [])]
}

function selectionReason(state, action) {
  if (typeof action.evidence === 'string' && action.evidence.trim()) return action.evidence.trim()
  const version=state.planVersions?.find(p=>p.id===action.planVersionId)
  if(version?.origin==='model') return [version.summary,...version.advantages,...version.constraints].join('；').slice(0,4000)
  const option = analyze(state).options.find(item => item.supplierId === action.supplierId)
  return option ? `选择 ${option.name}：预计 D${option.arrivalDay} 到料，${option.riskCount} 条到料风险；须完成方案质量核验和负责人批准，保留到料风险并跟进。` : ''
}

function evidenceDetails(state, action) {
  if (action.sourceIds !== undefined && (!Array.isArray(action.sourceIds) || action.sourceIds.length > 12 || action.sourceIds.some(id => typeof id !== 'string' || !getDocuments(state).some(doc => doc.id === id)))) fail('凭据来源须属于当前事项。', 'SOURCE_INVALID')
  if (action.record !== undefined) {
    const record = action.record
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !['arrangement', 'pending', 'orderIds', 'communication', 'result'].includes(key))) fail('回执结构不正确。', 'RECEIPT_INVALID')
    for (const key of ['arrangement', 'pending', 'communication', 'result']) if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > 2000)) fail('回执字段过长或格式不正确。', 'RECEIPT_INVALID')
    if (record.orderIds !== undefined && (!Array.isArray(record.orderIds) || record.orderIds.some(id => !state.orders.some(order => order.id === id && order.materialId === state.matter.materialId)))) fail('回执订单须属于当前事项。', 'ORDER_INVALID')
    if (action.taskId === 'T-PUR' && (!record.arrangement?.trim() || !record.pending?.trim())) fail('请填写跟进安排及仍待确认事项，无待确认项请明确说明。', 'RECEIPT_INVALID')
    if (action.taskId === 'T-SALES' && (!record.orderIds?.length || !record.communication?.trim() || !record.result?.trim())) fail('请填写涉及订单、同步内容及结果。', 'RECEIPT_INVALID')
  }
  return [
    ...(action.record?.arrangement ? [`跟进安排：${action.record.arrangement}`] : []),
    ...(action.record?.pending ? [`仍待确认：${action.record.pending}`] : []),
    ...(action.record?.orderIds ? [`涉及订单：${action.record.orderIds.join('、')}`] : []),
    ...(action.record?.communication ? [`同步内容：${action.record.communication}`] : []),
    ...(action.record?.result ? [`同步结果：${action.record.result}`] : []),
    ...(action.sourceIds?.length ? [`关联来源：${action.sourceIds.map(id => getDocuments(state).find(doc => doc.id === id).title).join('、')}`] : []),
  ]
}

function check(state, action, role) {
  if (!ROLES.includes(role)) fail('未知演示角色。', 'FORBIDDEN', 403)
  if (!action || typeof action !== 'object' || Array.isArray(action)) fail('请提供有效操作。')
  if (state.matter.status === 'closed' && action.type !== 'reset') fail('事项已关闭，请重置当前演示后重新开始。', 'MATTER_CLOSED', 409)
  const roleIs = (...allowed) => { if (!allowed.includes(role)) fail('当前角色无权执行此操作。', 'FORBIDDEN', 403) }
  const taskFor = id => { const task = state.tasks.find(item => item.id === id); if (!task) fail('任务不存在。', 'TASK_NOT_FOUND', 404); if(task.id==='T-QA'&&!isCurrentQualityTask(state,task))fail('该任务所属方案已改选，请重新发起当前选择的核验。','PLAN_CHANGED',409); if(['T-PUR','T-SALES'].includes(task.id)&&!closingFacts(state).executionApproved)fail('原批准尚无当前有效核验依据，请补核验并由负责人重新批准后办理。','NOT_APPROVED',409); return task }
  const hasEvidence = () => { if (typeof action.evidence !== 'string' || !action.evidence.trim() || action.evidence.length > 4000) fail('请填写 1 至 4000 字的处理证据或回执。', 'EVIDENCE_REQUIRED') }
  const qa = state.tasks.find(task => task.id === 'T-QA')
  const supplierB = state.suppliers.find(supplier => supplier.id === 'B')
  switch (action.type) {
    case 'import_supply': {
      roleIs('procurement', 'lead')
      const imported = prepareSupplyImport(state, action)
      const calculation = analyze({ ...state, suppliers: imported.suppliers, orders: imported.orders })
      return { title: '确认导入合成供应样例', details: [...imported.details, `导入后 ${calculation.linkedCount} 条订单中 ${calculation.riskCount} 条有到料风险。`, '保留原始文件行作为依据；只更新日期，不导入审批、任务或计算结果。'] }
    }
    case 'select_plan':
      roleIs('procurement', 'lead')
      if (!['A', 'B'].includes(action.supplierId)) fail('请选择供应商 A 或 B。', 'PLAN_INVALID')
      if (action.evidence !== undefined && (typeof action.evidence !== 'string' || action.evidence.length > 4000)) fail('补充理由须不超过 4000 字。', 'EVIDENCE_REQUIRED')
      if (state.tasks.some(task => ['T-PUR', 'T-SALES'].includes(task.id)) || state.legacyWorkflow?.tasks?.some(task=>['T-PUR','T-SALES'].includes(task.id)) || closingFacts(state).executionApproved) fail('执行跟进已获批准，不能再改选方案。', 'PLAN_LOCKED', 409)
      const version=state.planVersions?.find(p=>p.id===(action.planVersionId||`${state.matter.id}-${action.supplierId}-v1`))
      if(!version||version.supplierId!==action.supplierId) fail('方案版本不存在或不匹配。','PLAN_INVALID')
      if(version.origin!=='baseline' && version.factsSignature && version.factsSignature!==factsSignature(state)) fail('方案依据已变化，请重新分析。','PLAN_STALE',409)
      if(state.matter.planSelection?.planVersionId===version.id) fail('当前已选择该版本。','NO_CHANGE',409)
      return { title: `选择供应商 ${action.supplierId} 方案`, details: [`选择理由：${selectionReason(state, action)}`, '本次仅记录方案选择，不改变有效决定，也不代表负责人批准。', action.supplierId === 'A' ? '保留 A 的到料风险仍然存在，后续须质量岗位核验当前版本，再由负责人批准采购、销售跟进。' : 'B 须先通过质量核验，再由负责人批准切换。'] }
    case 'approve_keep_a':
      roleIs('lead')
      if (closingFacts(state).executionApproved || (state.tasks.some(task => ['T-PUR', 'T-SALES'].includes(task.id)) && !state.matter.executionApproval)) fail('执行跟进已获批准。', 'ALREADY_APPROVED', 409)
      if (state.matter.planSelection?.supplierId !== 'A' || state.matter.supplierId !== 'A') fail('请先选择保留供应商 A。', 'PLAN_NOT_SELECTED', 409)
      if(!currentQualityApproved(state)) fail('当前选择尚未完成有效的方案核验，请重新核验并提交凭据。','QUALITY_NOT_APPROVED',409)
      if (action.evidence !== undefined) hasEvidence()
      if (!(action.evidence ?? state.matter.planSelection.reason)?.trim()) fail('缺少保留 A 的理由。', 'EVIDENCE_REQUIRED')
      return { title: '确认保留供应商 A 并跟进', details: [`理由：${(action.evidence ?? state.matter.planSelection.reason).trim()}`, `当前 ${analyze(state).riskCount} 单存在到料风险；确认跟进不代表风险消除。`, 'DEC-01 继续有效；创建待发送的 T-PUR、T-SALES，另行人工确认发送后由采购和销售分别跟进并回执。', '不批准切换 B，不改变 B 的质量结论。'] }
    case 'request_quality':
      roleIs('procurement', 'lead')
      if (closingFacts(state).executionApproved) fail('执行跟进已批准，无需再次创建质量核验。', 'ALREADY_APPROVED', 409)
      if(!state.matter.planSelection) fail('请先选择方案版本。','PLAN_NOT_SELECTED',409)
      if (qa && isCurrentQualityTask(state,qa) && !(qa.status === 'completed' && qa.qualityResult === 'rejected')) fail('质量任务已存在，请处理或重试原任务。', 'TASK_EXISTS', 409)
      return { title: qa ? '重新发起方案质量核验' : '发起方案质量核验', details: [`事项 ${state.matter.id}，方案 ${state.matter.planSelection.supplierId}；版本 ${state.matter.planSelection.planVersionId}；接收人：质量负责人。`, '截止时间：负责人批准前完成。', qa ? '重开原任务 T-QA，保留上轮凭据。' : '确认后创建 T-QA，并尝试送达模拟收件箱。'] }
    case 'send_tasks':
      roleIs('lead')
      if (!closingFacts(state).executionApproved) fail('方案尚未获负责人批准。', 'NOT_APPROVED', 409)
      if (!state.tasks.some(task => ['T-PUR', 'T-SALES'].includes(task.id) && task.status === 'pending_delivery')) fail('没有待发送任务；发送失败请重试原任务。', 'NO_PENDING_TASKS', 409)
      return { title: '确认并发送部门任务', details: ['仅向演示收件箱发送已批准的采购、销售任务。', '两方分别记录送达结果；失败可重试原任务，不重复创建。'] }
    case 'accept_task': {
      const task = taskFor(action.taskId); roleIs(task.assignee)
      if (task.status !== 'delivered') fail('仅已送达任务可确认接收。', 'TASK_STATE_CONFLICT', 409)
      return { title: '确认接收任务', details: [`${task.id}：${task.title}。`, '仅确认收到，不代表开始处理或完成。'] }
    }
    case 'start_task': {
      const task = taskFor(action.taskId); roleIs(task.assignee)
      if (task.status !== 'accepted') fail('请先确认接收任务，再开始处理。', 'TASK_STATE_CONFLICT', 409)
      return { title: '开始处理任务', details: [`${task.id}：${task.title}。`, `处理人：${LABELS[role]}。`] }
    }
    case 'submit_quality':
      roleIs('quality')
      if (action.taskId !== 'T-QA') fail('质量核验必须关联任务 T-QA。')
      if(!isCurrentQualityTask(state,qa)) fail('方案已变更，请重新发起当前选择的核验。','PLAN_CHANGED',409)
      if (qa?.status !== 'in_progress') fail('请先开始处理质量任务，再提交核验结果。', 'TASK_STATE_CONFLICT', 409)
      if (!['approved', 'rejected'].includes(action.result)) fail('质量结论须为通过或拒绝。')
      hasEvidence()
      return { title: '提交方案质量核验', details: [`供应商 ${state.matter.planSelection.supplierId} 方案核验结论：${action.result === 'approved' ? '通过' : '不通过'}。`, `凭据：${action.evidence.trim()}`, ...evidenceDetails(state, action), '此次确认不批准切换供应商。'] }
    case 'approve_switch':
      roleIs('lead')
      if (closingFacts(state).executionApproved) fail('执行跟进已批准。', 'ALREADY_APPROVED', 409)
      if (state.matter.planSelection?.supplierId === 'A') fail('当前选择保留 A，不能批准切换 B。', 'PLAN_MISMATCH', 409)
      if(state.matter.planSelection?.supplierId!=='B' || !currentQualityApproved(state)) fail('供应商 B 当前选择尚未完成有效的方案核验，或缺少核验凭据。', 'QUALITY_NOT_APPROVED', 409)
      return { title: '批准切换供应商 B', details: ['依据：DEC-02 条件方案与 T-QA 通过回执。', '生成 DEC-03 为有效决定，DEC-01 保留为已替代历史。', '创建待发送的 T-PUR、T-SALES；另行确认发送到演示收件箱。', '不代表原料已到货或订单已交付。'] }
    case 'submit_receipt': {
      const task = taskFor(action.taskId); roleIs(task.assignee)
      if (!['T-PUR', 'T-SALES'].includes(task.id)) fail('此任务须使用质量核验操作。')
      if (task.status !== 'in_progress') fail('请先开始处理任务，再提交回执。', 'TASK_STATE_CONFLICT', 409)
      hasEvidence()
      return { title: '提交任务回执', details: [`${task.id}：${task.title}。`, `回执：${action.evidence.trim()}`, ...evidenceDetails(state, action), '提交后进入待复核，由业务负责人确认事项关闭。'] }
    }
    case 'close_matter':
      roleIs('lead')
      if (!closingFacts(state).executionApproved) fail('所选方案尚未完成负责人确认，不能关闭事项。', 'CLOSE_CONDITIONS_UNMET', 409)
      if (!['T-PUR', 'T-SALES'].every(id => { const task = state.tasks.find(item => item.id === id); return task && ['awaiting_review', 'completed'].includes(task.status) && task.receipt?.evidence?.trim() })) fail('采购、销售回执尚未齐全，不能关闭事项。', 'CLOSE_CONDITIONS_UNMET', 409)
      if (!closingFacts(state).canClose) fail('质量凭据或任务送达条件尚未满足，不能关闭事项。', 'CLOSE_CONDITIONS_UNMET', 409)
      return { title: '复核并关闭办公事项', details: ['复核采购安排和销售同步两份回执。', ...state.tasks.filter(task => ['T-PUR', 'T-SALES'].includes(task.id)).map(task => `${task.id}：${task.receipt.evidence}`), `当前方案 ${state.matter.supplierId}，仍有 ${analyze(state).riskCount} 单到料风险。`, `确认后任务标记已完成，${state.matter.id} 办公协同事项关闭。`, '关闭仅表示办公协同完成，不表示风险消除、采购到货、生产完成或订单交付。'] }
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
  if (isBusinessEvent(state)) return eventPreview(state, action, role)
  try {
    const summary = check(state, action, role)
    return { allowed: true, reason: '', ...summary, action: structuredClone(action), revision: state.revision }
  } catch (error) {
    if (!error.code || !error.status) throw error
    return { allowed: false, reason: error.message, title: '当前无法执行', details: [], action: structuredClone(action), revision: state.revision }
  }
}

export function applyAction(state, action, role) {
  if (isBusinessEvent(state)) return applyEvent(state, action, role)
  const summary = check(state, action, role)
  const next = action.type === 'reset' ? createState({matterId:state.matter.id,materialId:state.matter.materialId,orders:state.orders}) : migrateState(state)
  next.revision = state.revision + 1
  const at = new Date().toISOString()
  next.matter.updatedAt = at
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
  const createTask = (id, title, assignee, send = true) => {
    const task = { id, title, assignee, planVersionId:next.matter.planSelection?.planVersionId, status: 'pending_delivery', attempts: 0, createdAt: at }
    next.tasks.push(task)
    if (send) deliver(task)
    return task
  }
  const approveExecution = () => {
    const previous = next.matter.executionApproval
    const { history = [], ...record } = previous || {}
    const decision = next.decisions.find(item => item.status === 'effective')
    const previousRecord = previous ? { ...record,
      ...(decision ? {decision:structuredClone(decision)} : {}),
      ...(next.matter.followupApproval ? {followupApproval:structuredClone(next.matter.followupApproval)} : {}) } : undefined
    next.matter.executionApproval = { planVersionId:next.matter.planSelection.planVersionId, approvedBy:role, approvedAt:at, qualityReviewId:currentPlanReview(next).id,
      ...(previous ? {history:[...history,previousRecord]} : {}) }
  }
  const prepareDepartmentTask = (id, title, assignee) => {
    const index = next.tasks.findIndex(task => task.id === id)
    if (index < 0) return createTask(id, title, assignee, false)
    // Only a new, explicit approval can restart an old invalid execution round.
    const { history = [], ...prior } = next.tasks[index]
    next.tasks[index] = { id, title, assignee, planVersionId:next.matter.planSelection.planVersionId, status:'pending_delivery', attempts:0, createdAt:at,
      history:[...history,{...prior,archivedAt:at,archiveReason:'补核验后负责人重新批准，原执行记录保留'}] }
    return next.tasks[index]
  }
  switch (action.type) {
    case 'select_plan':
      for (const task of next.tasks) if (task.id === 'T-QA') task.selectionInvalidated = true
      next.matter.planSelection = { planVersionId: action.planVersionId || `${state.matter.id}-${action.supplierId}-v1`, supplierId: action.supplierId, selectedBy: role, selectedAt: at, revision: next.revision, reason: selectionReason(state, action) }
      break
    case 'approve_keep_a':
      approveExecution()
      next.matter.followupApproval = { approvedBy: role, approvedAt: at, riskCount: analyze(state).riskCount, sourceId: 'DOC-KEEP-A', reason: (action.evidence ?? next.matter.planSelection.reason).trim() }
      prepareDepartmentTask('T-PUR', '跟进供应商 A 的到料安排及延期风险', 'procurement')
      prepareDepartmentTask('T-SALES', '同步供应商 A 方案的订单交期风险', 'sales')
      break
    case 'request_quality': {

      const task = next.tasks.find(item => item.id === 'T-QA')
      if (task) {
        task.history = [...(task.history ?? []), { planVersionId:task.planVersionId, ...(task.selectionRevision !== undefined ? {selectionRevision:task.selectionRevision} : {}), ...(!isCurrentQualityTask(next,task) ? {selectionInvalidated:true} : {}), receipt: task.receipt, qualityResult: task.qualityResult, attempts: task.attempts, completedAt: task.completedAt, acceptedAt: task.acceptedAt, startedAt: task.startedAt, deliveredAt: task.deliveredAt, reopenedAt: task.reopenedAt }]
        delete task.receipt; delete task.qualityResult; delete task.completedAt
        delete task.selectionInvalidated
        delete task.acceptedAt; delete task.startedAt; delete task.deliveredAt; delete task.deliveryError
        task.attempts = 0
        task.reopenedAt = at
        task.planVersionId=next.matter.planSelection.planVersionId
        task.selectionRevision=next.matter.planSelection.revision
        task.title=`核验方案 ${next.matter.planSelection.supplierId} 的质量`
        deliver(task)
      } else { const created=createTask('T-QA', `核验方案 ${next.matter.planSelection.supplierId} 的质量`, 'quality');created.planVersionId=next.matter.planSelection.planVersionId;created.selectionRevision=next.matter.planSelection.revision }
      break
    }
    case 'send_tasks':
      for (const task of next.tasks.filter(item => ['T-PUR', 'T-SALES'].includes(item.id) && item.status === 'pending_delivery')) deliver(task)
      break
    case 'accept_task': {
      const task = next.tasks.find(item => item.id === action.taskId)
      task.status = 'accepted'; task.acceptedAt = at
      break
    }
    case 'start_task': {
      const task = next.tasks.find(item => item.id === action.taskId)
      task.status = 'in_progress'; task.acceptedAt ??= at; task.startedAt = at
      break
    }
    case 'submit_quality': {
      const task = next.tasks.find(item => item.id === 'T-QA')
      task.status = 'completed'; task.qualityResult = action.result; task.completedAt = at
      task.receipt = { evidence: action.evidence.trim(), at, actor: role, sourceId: 'QA-B-001', ...(action.sourceIds ? {sourceIds: [...new Set(action.sourceIds)]} : {}) }
      next.planReviews.push({id:randomUUID(),matterId:next.matter.id,planVersionId:task.planVersionId,result:action.result,evidence:action.evidence.trim(),reviewedBy:role,reviewedAt:at,...(action.sourceIds ? {sourceIds:[...new Set(action.sourceIds)]} : {})})
      break
    }
    case 'approve_switch':
      approveExecution()
      next.matter.supplierId = 'B'
      next.decisions.find(decision => decision.id === 'DEC-01').status = 'superseded'
      next.decisions.find(decision => decision.id === 'DEC-02').status = 'fulfilled'
      next.decisions=next.decisions.filter(d=>d.id!=='DEC-03')
      next.decisions.push({ id: 'DEC-03', status: 'effective', supplierId: 'B', sequence: 3, sourceId: 'DOC-DECISION-03', basedOn: ['DEC-02', 'T-QA'], approvedBy: role, createdAt: at, text: '依据 DEC-02 条件方案及 T-QA 通过凭据，由业务负责人确认切换供应商 B；采购和销售分别跟进并回执。' })
      prepareDepartmentTask('T-PUR', '确认供应商 B 的采购安排', 'procurement')
      prepareDepartmentTask('T-SALES', '同步关联订单交期信息', 'sales')
      break
    case 'submit_receipt': {
      const task = next.tasks.find(item => item.id === action.taskId)
      task.status = 'awaiting_review'
      task.receipt = { evidence: action.evidence.trim(), at, actor: role, ...(action.record ? {record:structuredClone(action.record)} : {}), ...(action.sourceIds ? {sourceIds:[...new Set(action.sourceIds)]} : {}) }
      break
    }
    case 'close_matter':
      next.matter.review = { reviewedBy: role, reviewedAt: at, receiptTaskIds: ['T-PUR', 'T-SALES'], decisionId: analyze(state).effectiveDecisionId, supplierId: state.matter.supplierId, riskCount: analyze(state).riskCount }
      for (const task of next.tasks.filter(item => ['T-PUR', 'T-SALES'].includes(item.id))) { task.status = 'completed'; task.completedAt = at; task.reviewedBy = role }
      next.matter.status = 'closed'; next.matter.closedAt = at
      next.matter.outcome = { revision:next.revision, capturedAt:at, plan:structuredClone(next.planVersions.find(p=>p.id===next.matter.planSelection?.planVersionId)), selection:structuredClone(next.matter.planSelection), approval:structuredClone(next.matter.executionApproval), decision:structuredClone(next.decisions.find(d=>d.status==='effective')), analysis:structuredClone(analyze(next)), review:structuredClone(next.matter.review), receipts:structuredClone(next.tasks.filter(t=>['T-PUR','T-SALES'].includes(t.id)).map(t=>({taskId:t.id,title:t.title,...t.receipt}))), qualityReview:structuredClone(currentPlanReview(next)) }
      break
    case 'retry_delivery': deliver(next.tasks.find(task => task.id === action.taskId)); break
    case 'import_supply': {
      const imported = prepareSupplyImport(state, action)
      next.suppliers = imported.suppliers
      next.orders = imported.orders
      next.supplyImport = { dataKind: 'synthetic', importedAt: at, revision: next.revision, records: imported.records }
      const before = analyze(state), after = analyze(next)
      next.supplyImport.summary = { id: `DOC-IMPORT-CHANGE-V${next.revision}`, title: '本次导入前后影响对照', source: SOURCE, text: `合成样例导入；版本 ${state.revision} → ${next.revision}；导入时间 ${at}。以下是程序在导入时计算的前后对照，并非客户生产数据。\n${imported.details.join('\n')}\n到料风险订单数：导入前 ${before.riskCount} 条 → 导入后 ${after.riskCount} 条。\n${after.orders.map(order => `${order.id}：导入前预计晚 ${before.orders.find(item => item.id === order.id).lateDays} 天 → 导入后预计晚 ${order.lateDays} 天。`).join('\n')}\n仅更新日期，当前采用的供应商、决定与办理任务不变。后续修改以当前数据为准。` }
      next.planVersions = [...basePlans(next), ...next.planVersions.filter(plan => plan.origin !== 'baseline')]
      break
    }
    case 'set_arrival': next.suppliers.find(supplier => supplier.id === 'A').arrivalDay = action.day; break
    case 'arm_delivery_failure': next.failNextDelivery = true; break
    case 'reset': break
  }
  event(action.type, [summary.title, ...summary.details].join(' '))
  const normalized = migrateState(next)
  normalized.documents = getDocuments(normalized)
  return normalized
}

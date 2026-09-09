import { analyze, getDocuments } from './office-domain.mjs'

// The platform projection contract is reused here: typed identities, registered
// properties and schema-checked edges. Office state remains the only writable data.
const ROLES = { procurement: '采购经办', quality: '质量负责人', sales: '销售经办', lead: '业务负责人' }
const STATUS = {
  open: '处理中', closed: '已关闭', approved: '通过', pending: '待核验', rejected: '不通过',
  effective: '当前有效', conditional: '附条件候选方案｜未生效', fulfilled: '条件已落实', superseded: '已被替代',
  pending_delivery: '待送达', delivered: '已送达', delivery_failed: '送达失败',
  in_progress: '处理中', awaiting_review: '待复核', completed: '已完成', historical: '历史回执',
}
const TYPE_DEFINITIONS = [
  ['Matter', '办公事项', { id: '事项编号', title: '事项名称', status: '状态代码', statusLabel: '当前状态', supplierId: '当前供应商', materialId: '物料编号', linkedCount: '关联订单数', riskCount: '风险订单数', nextStep: '下一步', closedAt: '关闭时间' }],
  ['Material', '物料', { id: '物料编号', name: '物料名称' }],
  ['Supplier', '供应商', { id: '供应商编号', name: '名称', arrivalDay: '预计到料日（D）', originalDay: '原到料日（D）', quality: '质量状态代码', qualityLabel: '质量状态', selected: '当前采用', riskCount: '方案风险订单数', eligible: '质量资格已通过' }],
  ['Order', '关联订单', { id: '订单编号', materialId: '物料编号', requiredDay: '最晚到料日（D）', arrivalDay: '当前方案到料日（D）', lateDays: '延误天数', atRisk: '存在到料风险' }],
  ['Decision', '会议与批准决定', { id: '决定编号', text: '决定内容', status: '状态代码', statusLabel: '当前效力', supplierId: '对应供应商', sequence: '先后顺序', sourceId: '原始来源编号', basedOn: '批准依据', approvedBy: '确认人角色', createdAt: '确认时间' }],
  ['Role', '演示角色', { id: '角色代码', name: '角色名称', identity: '身份说明' }],
  ['Task', '协同任务', { id: '任务编号', title: '任务名称', assignee: '责任角色', assigneeLabel: '责任人', status: '状态代码', statusLabel: '当前状态', attempts: '本轮送达次数', deliveryError: '送达失败原因', qualityResult: '核验结论代码', qualityResultLabel: '核验结论', createdAt: '创建时间', deliveredAt: '送达时间', startedAt: '开始时间', completedAt: '完成时间', reopenedAt: '重新发起时间', reviewedBy: '复核人角色', historyCount: '历史核验轮数', workStatus: '工作状态', delivery: '消息送达状态' }],
  ['Receipt', '处理回执', { id: '回执编号', taskId: '所属任务', evidence: '处理凭据', actor: '提交人角色', actorLabel: '提交人', at: '提交时间', status: '状态代码', statusLabel: '当前状态', qualityResult: '核验结论代码', qualityResultLabel: '核验结论', historical: '历史回执', round: '核验轮次', sourceId: '凭据来源编号' }],
  ['Document', '来源文档', { id: '来源编号', title: '标题', text: '来源原文', source: '来源说明' }],
]
const EDGE_DEFINITIONS = [
  ['matterMaterial', '关联物料', 'Matter', 'Material'],
  ['matterOrder', '关联订单', 'Matter', 'Order'],
  ['orderMaterial', '需要物料', 'Order', 'Material'],
  ['matterSupplier', '供货方案', 'Matter', 'Supplier'],
  ['matterSelectedSupplier', '当前采用', 'Matter', 'Supplier'],
  ['supplierMaterial', '可供应物料', 'Supplier', 'Material'],
  ['matterDecision', '关联决定', 'Matter', 'Decision'],
  ['matterEffectiveDecision', '有效决定', 'Matter', 'Decision'],
  ['matterConditionalDecision', '条件建议', 'Matter', 'Decision'],
  ['decisionSupplier', '指向供应商', 'Decision', 'Supplier'],
  ['decisionReplaces', '替代历史决定', 'Decision', 'Decision'],
  ['decisionBasedOnDecision', '依据会议建议', 'Decision', 'Decision'],
  ['decisionBasedOnTask', '依据核验任务', 'Decision', 'Task'],
  ['decisionApprovedBy', '由负责人确认', 'Decision', 'Role'],
  ['matterTask', '推进任务', 'Matter', 'Task'],
  ['taskAssignee', '指派给', 'Task', 'Role'],
  ['taskSupplier', '跟进供应商', 'Task', 'Supplier'],
  ['taskReceipt', '处理回执', 'Task', 'Receipt'],
  ['taskHistoricalReceipt', '历史核验回执', 'Task', 'Receipt'],
  ['receiptActor', '提交人', 'Receipt', 'Role'],
]

function makeModel() {
  return {
    version: 1,
    types: TYPE_DEFINITIONS.map(([id, label, properties]) => ({ id, label,
      properties: Object.entries({ ...properties, revision: '当前数据版本' }).map(([key, title]) => ({ id: key, label: title })) })),
    relations: [
      ...EDGE_DEFINITIONS.map(([id, label, from, to]) => ({ id, from, to, label })),
      ...TYPE_DEFINITIONS.filter(([type]) => type !== 'Document').map(([type]) => ({ id: `${type.toLowerCase()}Source`, from: type, to: 'Document', label: '来源依据' })),
    ],
  }
}

export function projectOffice(state, workspaceId = '') {
  const model = makeModel()
  const sources = getDocuments(state)
  const analysis = analyze(state)
  const objects = [], relations = [], objectMap = new Map(), edgeIds = new Set()
  const schema = new Map(model.relations.map(edge => [edge.id, edge]))
  const sourceIds = new Set(sources.map(source => source.id))
  const add = (type, key, label, properties, provenance = []) => {
    const id = `${type}:${key}`
    if (objectMap.has(id)) return id
    const object = { id, type, label, properties: structuredClone({ ...properties, revision: state.revision }), sourceIds: [...new Set(provenance)].filter(source => sourceIds.has(source)) }
    objects.push(object); objectMap.set(id, object)
    return id
  }
  const link = (type, from, to) => {
    if (!objectMap.has(from) || !objectMap.has(to)) return
    const definition = schema.get(type)
    if (!definition || objectMap.get(from).type !== definition.from || objectMap.get(to).type !== definition.to) throw new Error(`关系类型与端点不符：${type}`)
    const id = `${type}:${from}->${to}`
    if (!edgeIds.has(id)) { relations.push({ id, type, from, to, label: definition.label }); edgeIds.add(id) }
  }
  for (const source of sources) add('Document', source.id, source.title, source, [source.id])
  for (const [id, name] of Object.entries(ROLES)) add('Role', id, name, { id, name, identity: '页面内演示角色，非企业身份认证' }, ['DOC-ROLES'])
  const matterId = add('Matter', state.matter.id, state.matter.title, {
    ...state.matter, statusLabel: STATUS[state.matter.status] ?? state.matter.status,
    linkedCount: analysis.linkedCount, riskCount: analysis.riskCount, nextStep: analysis.nextStep,
  }, ['DOC-NOTICE', 'DOC-LEDGER', 'DOC-STATE'])
  for (const materialId of new Set([state.matter.materialId, ...state.orders.map(order => order.materialId)])) {
    add('Material', materialId, `物料 ${materialId}`, { id: materialId, name: `物料 ${materialId}` }, ['DOC-LEDGER'])
  }
  link('matterMaterial', matterId, `Material:${state.matter.materialId}`)
  for (const supplier of state.suppliers) {
    const option = analysis.options.find(item => item.supplierId === supplier.id)
    const id = add('Supplier', supplier.id, supplier.name, { ...supplier,
      qualityLabel: STATUS[supplier.quality] ?? supplier.quality, selected: supplier.id === state.matter.supplierId,
      riskCount: option?.riskCount ?? 0, eligible: option?.eligible ?? false,
    }, ['DOC-LEDGER', 'DOC-STATE'])
    link('matterSupplier', matterId, id)
    if (supplier.id === state.matter.supplierId) link('matterSelectedSupplier', matterId, id)
    link('supplierMaterial', id, `Material:${state.matter.materialId}`)
  }
  for (const order of state.orders) {
    const impact = analysis.orders.find(item => item.id === order.id)
    const id = add('Order', order.id, order.id, { ...order, ...(impact ?? {}) }, ['DOC-LEDGER'])
    link('orderMaterial', id, `Material:${order.materialId}`)
    if (order.materialId === state.matter.materialId) link('matterOrder', matterId, id)
  }
  for (const decision of state.decisions) {
    const id = add('Decision', decision.id, `${decision.id} · ${STATUS[decision.status] ?? decision.status}`, {
      ...decision, statusLabel: STATUS[decision.status] ?? decision.status,
    }, [decision.sourceId, 'DOC-STATE'])
    link('matterDecision', matterId, id)
    if (decision.status === 'effective') link('matterEffectiveDecision', matterId, id)
    if (decision.status === 'conditional') link('matterConditionalDecision', matterId, id)
    link('decisionSupplier', id, `Supplier:${decision.supplierId}`)
    if (decision.approvedBy) link('decisionApprovedBy', id, `Role:${decision.approvedBy}`)
  }
  for (const task of state.tasks) {
    const { receipt, history, ...properties } = task
    const id = add('Task', task.id, `${task.id} · ${task.title}`, { ...properties,
      assigneeLabel: ROLES[task.assignee] ?? task.assignee, statusLabel: STATUS[task.status] ?? task.status,
      qualityResultLabel: STATUS[task.qualityResult] ?? task.qualityResult ?? '', historyCount: history?.length ?? 0,
    }, ['DOC-STATE', 'DOC-ROLES', 'DOC-RULES'])
    link('matterTask', matterId, id)
    link('taskAssignee', id, `Role:${task.assignee}`)
    if (task.assignee === 'quality') link('taskSupplier', id, 'Supplier:B')
    else link('taskSupplier', id, `Supplier:${state.matter.supplierId}`)
    const addReceipt = (entry, result, historical, round) => {
      if (!entry) return
      const value = typeof entry === 'string' ? { evidence: entry } : entry
      const key = historical ? `${task.id}:history:${round}` : task.id
      const status = historical ? 'historical' : task.status
      const receiptId = add('Receipt', key, `${task.id} · ${historical ? `第 ${round} 轮历史回执` : '处理回执'}`, {
        id: key, taskId: task.id, ...value, actorLabel: ROLES[value.actor] ?? value.actor ?? '',
        status, statusLabel: STATUS[status] ?? status, qualityResult: result ?? '', qualityResultLabel: STATUS[result] ?? result ?? '', historical, round,
      }, ['DOC-STATE', 'DEMO-STATE'])
      link(historical ? 'taskHistoricalReceipt' : 'taskReceipt', id, receiptId)
      if (value.actor) link('receiptActor', receiptId, `Role:${value.actor}`)
    }
    for (const [index, entry] of (history ?? []).entries()) addReceipt(entry.receipt, entry.qualityResult, true, index + 1)
    addReceipt(receipt, task.qualityResult, false, (history?.length ?? 0) + 1)
  }
  for (const decision of state.decisions) {
    const id = `Decision:${decision.id}`
    for (const reference of decision.basedOn ?? []) {
      link('decisionBasedOnDecision', id, `Decision:${reference}`)
      link('decisionBasedOnTask', id, `Task:${reference}`)
    }
    if (decision.status === 'effective') {
      for (const previous of state.decisions.filter(item => item.status === 'superseded' && item.sequence < decision.sequence)) {
        link('decisionReplaces', id, `Decision:${previous.id}`)
      }
    }
  }
  for (const object of objects.filter(item => item.type !== 'Document')) {
    for (const sourceId of object.sourceIds) link(`${object.type.toLowerCase()}Source`, object.id, `Document:${sourceId}`)
  }
  return { revision: state.revision, workspaceId, model, objects, relations, sources, projection: { status: 'ready', revision: state.revision } }
}

function subset(graph, objects, relations) {
  const ids = new Set(objects.flatMap(object => object.sourceIds))
  return { revision: graph.revision, objects, relations, sources: graph.sources.filter(source => ids.has(source.id)) }
}

export function queryOfficeObjects(state, { query = '', type = '', id = '' } = {}) {
  const graph = projectOffice(state)
  const term = String(query).trim().toLocaleLowerCase()
  const objects = graph.objects.filter(object => (!type || object.type === type)
    && (!id || object.id === id || object.properties.id === id)
    && (!term || JSON.stringify(object).toLocaleLowerCase().includes(term)))
  const ids = new Set(objects.map(object => object.id))
  return subset(graph, objects, graph.relations.filter(edge => ids.has(edge.from) && ids.has(edge.to)))
}

export function queryOfficeRelations(state, { id = '', depth = 1 } = {}) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 2) {
    const error = new Error('关系查询深度只支持 1 或 2。')
    Object.assign(error, { code: 'INVALID_DEPTH', status: 422 })
    throw error
  }
  const graph = projectOffice(state)
  if (!id) return subset(graph, graph.objects, graph.relations)
  const selected = new Set(graph.objects.filter(object => object.id === id || object.properties.id === id).map(object => object.id))
  let frontier = new Set(selected)
  for (let level = 0; level < depth; level++) {
    const next = new Set()
    for (const edge of graph.relations) {
      if (frontier.has(edge.from) && !selected.has(edge.to)) next.add(edge.to)
      if (frontier.has(edge.to) && !selected.has(edge.from)) next.add(edge.from)
    }
    for (const objectId of next) selected.add(objectId)
    frontier = next
  }
  return subset(graph, graph.objects.filter(object => selected.has(object.id)), graph.relations.filter(edge => selected.has(edge.from) && selected.has(edge.to)))
}

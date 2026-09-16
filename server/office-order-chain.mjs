import { projectOffice } from './office-ontology.mjs'

// Read-only capability: all steps use one current projection, never cached Agent text.
export function buildOrderChains(graph) {
  const matter = graph.objects.find(object => object.type === 'Matter')
  if (!matter) return []
  const objects = new Map(graph.objects.map(object => [object.id, object]))
  const related = (from, type) => graph.relations
    .filter(edge => edge.from === from && edge.type === type)
    .map(edge => objects.get(edge.to)).filter(Boolean)
  const sourceIds = items => [...new Set(items.flatMap(item => item.sourceIds))]
  const step = (id, title, items, lines) => ({ id, title, objectIds: items.map(item => item.id), sourceIds: sourceIds(items), lines })
  const suppliers = related(matter.id, 'matterSelectedSupplier')
  const decisions = related(matter.id, 'matterDecision')
  const tasks = related(matter.id, 'matterTask')
  const receipts = tasks.flatMap(task => related(task.id, 'taskReceipt'))
  return related(matter.id, 'matterOrder').map(order => {
    const p = order.properties
    const steps = [
      step('order', '订单要求', [order], [`${p.id} · 最晚 D${p.requiredDay} 到料`]),
      step('supply', '当前供货与影响', [order, ...suppliers], [
        ...suppliers.map(supplier => `${supplier.label} · 当前采用 · 预计 D${supplier.properties.arrivalDay} 到料`),
        p.atRisk ? `预计晚 ${p.lateDays} 天，存在到料风险。` : '预计满足到料窗口。',
      ]),
      step('decisions', '决定与生效条件', decisions, decisions.length
        ? decisions.map(item => `${item.properties.id} · ${item.properties.statusLabel}：${item.properties.text}`)
        : ['尚未记录决定。']),
      step('tasks', '办理与回执', [...tasks, ...receipts], tasks.length
        ? tasks.map(item => `${item.properties.title} · ${item.properties.assigneeLabel} · ${item.properties.statusLabel}`)
        : ['尚未创建办理任务。']),
      step('next', '当前事项与下一步', [matter], [
        `${matter.properties.statusLabel} · ${matter.properties.nextStep}`,
        '预计到料不等于实际收货；办公事项关闭不代表订单已交付。',
      ]),
    ]
    return { orderId: p.id, matterId: matter.properties.id, revision: graph.revision,
      steps, sourceIds: [...new Set(steps.flatMap(item => item.sourceIds))] }
  })
}

export function queryOrderChain(state, { orderId } = {}) {
  const graph = projectOffice(state)
  const chain = typeof orderId === 'string' && buildOrderChains(graph).find(item => item.orderId === orderId)
  if (!chain) return { status: 'not_found', revision: state.revision,
    message: '当前事项中未找到这条关联订单，请核对完整订单编号及当前事项。', sources: [] }
  const ids = new Set(chain.sourceIds)
  return { status: 'ready', ...chain, sources: graph.sources.filter(source => ids.has(source.id)) }
}

export function orderChainAnswer(result) {
  if (result.status !== 'ready') return result.message
  return `${result.orderId} 的关联链路（数据版本 ${result.revision}）：\n` + result.steps.map(step =>
    `${step.title}：${step.lines.join(' ')} ${step.sourceIds.map(id => `[${id}]`).join(' ')}`
  ).join('\n')
}

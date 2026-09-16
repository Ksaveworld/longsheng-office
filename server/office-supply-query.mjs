import { projectOffice } from './office-ontology.mjs'

export function querySupplyOrders(state, filters = {}) {
  const invalid = () => { throw Object.assign(new Error('仅支持完整订单编号、到料风险、最少延误天数及最晚到料日条件；日期与天数须为整数。'), { status: 422, code: 'SUPPLY_QUERY_INVALID' }) }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => !['orderId', 'atRisk', 'minLateDays', 'maxRequiredDay'].includes(key))) invalid()
  if (filters.orderId !== undefined && (typeof filters.orderId !== 'string' || !/^ORD-[A-Za-z0-9-]{1,60}$/.test(filters.orderId))) invalid()
  if (filters.atRisk !== undefined && typeof filters.atRisk !== 'boolean') invalid()
  for (const key of ['minLateDays', 'maxRequiredDay']) if (filters[key] !== undefined && (!Number.isInteger(filters[key]) || filters[key] < 0 || filters[key] > 30)) invalid()
  const graph = projectOffice(state)
  const all = graph.objects.filter(object => object.type === 'Order' && object.properties.materialId === state.matter.materialId)
  const supplier = graph.objects.find(object => object.type === 'Supplier' && object.properties.id === state.matter.supplierId)
  const conditions = [
    ...(filters.orderId === undefined ? [] : [{ key: 'orderId', label: `订单编号为 ${filters.orderId}`, test: p => p.id === filters.orderId, actual: p => p.id }]),
    ...(filters.atRisk === undefined ? [] : [{ key: 'atRisk', label: filters.atRisk ? '存在到料风险' : '无到料风险', test: p => p.atRisk === filters.atRisk, actual: p => p.atRisk ? '存在到料风险' : '无到料风险' }]),
    ...(filters.minLateDays === undefined ? [] : [{ key: 'minLateDays', label: `预计至少晚 ${filters.minLateDays} 天`, test: p => p.lateDays >= filters.minLateDays, actual: p => `预计晚 ${p.lateDays} 天` }]),
    ...(filters.maxRequiredDay === undefined ? [] : [{ key: 'maxRequiredDay', label: `最晚到料日不晚于 D${filters.maxRequiredDay}`, test: p => p.requiredDay <= filters.maxRequiredDay, actual: p => `最晚 D${p.requiredDay} 到料` }]),
  ]
  const evaluations = all.map(object => {
    const checks = conditions.map(condition => ({ key: condition.key, label: condition.label, actual: condition.actual(object.properties), passed: condition.test(object.properties) }))
    return { ...object.properties, matched: checks.every(check => check.passed), checks, sourceIds: [...new Set([...object.sourceIds, ...(supplier?.sourceIds || [])])] }
  })
  const matched = evaluations.filter(record => record.matched)
  const ids = new Set([...all.flatMap(object => object.sourceIds), ...(supplier?.sourceIds || [])])
  return { revision: state.revision, dataKind: 'synthetic', status: matched.length ? 'ready' : 'empty', filters, supplierId: state.matter.supplierId, totalCount: all.length, matchedCount: matched.length,
    conditions: conditions.map(({ key, label }) => ({ key, label })), evaluations,
    maxLateDays: matched.length ? Math.max(...matched.map(record => record.lateDays)) : null,
    formula: '延误天数 = max(0, 当前采用供应商预计到料日 - 订单最晚到料日)；预计到料日 > 最晚到料日才计为到料风险。',
    records: matched,
    message: state.scenario ? '当前事件没有供应到料台账，无法计算。' : matched.length ? '已按明确条件筛选当前事项订单。' : '当前事项没有符合条件的记录；不能据此推断其他事项或客户全量订单。',
    sources: graph.sources.filter(source => ids.has(source.id)),
  }
}

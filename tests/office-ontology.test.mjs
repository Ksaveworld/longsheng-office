import test from 'node:test'
import assert from 'node:assert/strict'
import { createState, applyAction, getDocuments } from '../server/office-domain.mjs'
import { projectOffice, queryOfficeObjects, queryOfficeRelations } from '../server/office-ontology.mjs'

const object = (graph, id) => graph.objects.find(item => item.id === id)
const edge = (graph, type, from, to) => graph.relations.find(item => item.type === type && item.from === from && item.to === to)
function assertIntegrity(graph) {
  const objects = new Map(graph.objects.map(item => [item.id, item]))
  const sources = new Set(graph.sources.map(item => item.id))
  assert.equal(objects.size, graph.objects.length)
  assert.equal(new Set(graph.relations.map(item => item.id)).size, graph.relations.length)
  for (const item of graph.objects) {
    assert.equal(item.properties.revision, graph.revision)
    for (const sourceId of item.sourceIds) assert.ok(sources.has(sourceId))
    const properties = new Set(graph.model.types.find(type => type.id === item.type).properties.map(prop => prop.id))
    for (const name of Object.keys(item.properties)) assert.ok(properties.has(name), `${item.type}.${name} has Chinese metadata`)
  }
  for (const relation of graph.relations) {
    assert.ok(objects.has(relation.from)); assert.ok(objects.has(relation.to))
    const schema = graph.model.relations.find(item => item.id === relation.type)
    assert.equal(schema.from, objects.get(relation.from).type)
    assert.equal(schema.to, objects.get(relation.to).type)
  }
  assert.equal(graph.projection.revision, graph.revision)
}
function approve(state = createState()) {
  state = applyAction(state, { type: 'request_quality' }, 'procurement')
  state = applyAction(state, { type: 'submit_quality', taskId: 'T-QA', result: 'approved', evidence: '资格证书及抽检均通过' }, 'quality')
  return applyAction(state, { type: 'approve_switch' }, 'lead')
}

test('initial projection retains type identities, original sources and conditional meeting effect', () => {
  const state = createState(), graph = projectOffice(state, 'workspace-test')
  assertIntegrity(graph)
  assert.equal(graph.workspaceId, 'workspace-test')
  assert.equal(object(graph, 'Matter:SUP-001').properties.riskCount, 1)
  assert.equal(graph.objects.filter(item => item.type === 'Order').length, 2)
  assert.equal(graph.objects.filter(item => item.type === 'Supplier').length, 2)
  assert.ok(edge(graph, 'matterEffectiveDecision', 'Matter:SUP-001', 'Decision:DEC-01'))
  assert.ok(edge(graph, 'matterConditionalDecision', 'Matter:SUP-001', 'Decision:DEC-02'))
  assert.ok(edge(graph, 'decisionSource', 'Decision:DEC-02', 'Document:DOC-MEETING-02'))
  assert.equal(graph.objects.filter(item => item.type === 'Task').length, 0)
  assert.deepEqual(graph.sources, getDocuments(state))
})

test('D9 changes order risks, supplier options and sources in one version without modifying input', () => {
  const initial = createState(), before = structuredClone(initial)
  const next = applyAction(initial, { type: 'set_arrival', supplierId: 'A', day: 9 }, 'lead')
  const graph = projectOffice(next)
  assertIntegrity(graph); assert.deepEqual(initial, before)
  assert.equal(graph.revision, 2)
  assert.equal(object(graph, 'Matter:SUP-001').properties.riskCount, 2)
  assert.equal(object(graph, 'Order:ORD-002').properties.lateDays, 1)
  assert.equal(object(graph, 'Supplier:A').properties.riskCount, 2)
  assert.equal(object(graph, 'Supplier:B').properties.riskCount, 0)
  assert.match(graph.sources.find(item => item.id === 'DOC-LEDGER').text, /A 当前 D9/)
})

test('approved switch projects actual decision replacement, responsibility and QA receipt', () => {
  const state = approve(), graph = projectOffice(state)
  assertIntegrity(graph)
  assert.ok(edge(graph, 'matterEffectiveDecision', 'Matter:SUP-001', 'Decision:DEC-03'))
  assert.ok(!edge(graph, 'matterEffectiveDecision', 'Matter:SUP-001', 'Decision:DEC-01'))
  assert.ok(edge(graph, 'decisionReplaces', 'Decision:DEC-03', 'Decision:DEC-01'))
  assert.ok(edge(graph, 'decisionBasedOnTask', 'Decision:DEC-03', 'Task:T-QA'))
  assert.ok(edge(graph, 'taskAssignee', 'Task:T-SALES', 'Role:sales'))
  assert.ok(edge(graph, 'taskReceipt', 'Task:T-QA', 'Receipt:T-QA'))
  assert.equal(object(graph, 'Supplier:B').properties.selected, true)
  assert.equal(object(graph, 'Matter:SUP-001').properties.riskCount, 0)
  assert.equal(graph.sources.find(item => item.id === 'DOC-MEETING-01').text, getDocuments(createState()).find(item => item.id === 'DOC-MEETING-01').text)
})

test('closure updates task and receipt state without claiming arrival or delivery', () => {
  let state = approve()
  state = applyAction(state, { type: 'submit_receipt', taskId: 'T-PUR', evidence: '采购安排已确认' }, 'procurement')
  state = applyAction(state, { type: 'submit_receipt', taskId: 'T-SALES', evidence: '交期已同步' }, 'sales')
  state = applyAction(state, { type: 'close_matter' }, 'lead')
  const graph = projectOffice(state)
  assertIntegrity(graph)
  assert.equal(object(graph, 'Matter:SUP-001').properties.status, 'closed')
  assert.match(object(graph, 'Matter:SUP-001').properties.nextStep, /不代表原料到货/)
  assert.equal(object(graph, 'Task:T-PUR').properties.status, 'completed')
  assert.equal(object(graph, 'Receipt:T-SALES').properties.evidence, '交期已同步')
  assert.equal(object(graph, 'Receipt:T-SALES').properties.status, 'completed')
})

test('retry and repeated quality review keep one task and preserve historical evidence', () => {
  let state = applyAction(createState(), { type: 'arm_delivery_failure' }, 'lead')
  state = applyAction(state, { type: 'request_quality' }, 'procurement')
  assert.equal(object(projectOffice(state), 'Task:T-QA').properties.status, 'delivery_failed')
  state = applyAction(state, { type: 'retry_delivery', taskId: 'T-QA' }, 'quality')
  state = applyAction(state, { type: 'submit_quality', taskId: 'T-QA', result: 'rejected', evidence: '原证书过期' }, 'quality')
  state = applyAction(state, { type: 'request_quality' }, 'procurement')
  let graph = projectOffice(state)
  assertIntegrity(graph)
  assert.equal(graph.objects.filter(item => item.type === 'Task').length, 1)
  assert.equal(object(graph, 'Receipt:T-QA:history:1').properties.evidence, '原证书过期')
  assert.equal(object(graph, 'Receipt:T-QA'), undefined)
  state = applyAction(state, { type: 'submit_quality', taskId: 'T-QA', result: 'approved', evidence: '更新证书有效' }, 'quality')
  graph = projectOffice(state); assertIntegrity(graph)
  assert.equal(object(graph, 'Receipt:T-QA').properties.round, 2)
})

test('read tools return versioned, bounded and immutable graph data with valid endpoints', () => {
  const state = approve(), before = structuredClone(state)
  const result = queryOfficeObjects(state, { type: 'Supplier', query: '供应商 B' })
  assert.deepEqual(result.objects.map(item => item.id), ['Supplier:B'])
  assert.equal(queryOfficeObjects(state, { id: 'DEC-03' }).objects[0].id, 'Decision:DEC-03')
  const neighborhood = queryOfficeRelations(state, { id: 'Decision:DEC-03', depth: 1 })
  const ids = new Set(neighborhood.objects.map(item => item.id))
  assert.ok(ids.has('Task:T-QA')); assert.ok(ids.has('Decision:DEC-01'))
  assert.ok(!ids.has('Receipt:T-QA'))
  assert.ok(queryOfficeRelations(state, { id: 'Decision:DEC-03', depth: 2 }).objects.some(item => item.id === 'Receipt:T-QA'))
  for (const item of neighborhood.relations) { assert.ok(ids.has(item.from)); assert.ok(ids.has(item.to)) }
  for (const depth of [0, 3, 1.5, '2']) assert.throws(() => queryOfficeRelations(state, { depth }), { code: 'INVALID_DEPTH' })
  assert.deepEqual(queryOfficeRelations(state, { id: 'missing' }).objects, [])
  result.objects[0].properties.name = 'changed externally'
  neighborhood.sources[0].text = 'changed externally'
  assert.deepEqual(state, before)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createState, applyAction } from '../server/office-domain.mjs'
import { querySupplyOrders } from '../server/office-supply-query.mjs'
import { createServer } from 'node:http'
import { runOfficeChat } from '../server/office-model.mjs'

test('matched and excluded orders use the same condition checks and exact inclusive boundary', () => {
  const state = applyAction(createState(), { type: 'set_arrival', supplierId: 'A', day: 9 }, 'lead')
  const before = structuredClone(state)
  const result = querySupplyOrders(state, { atRisk: true, minLateDays: 4 })
  assert.equal(result.matchedCount, 1)
  assert.equal(result.evaluations.length, 2)
  assert.equal(result.evaluations[0].matched, true)
  assert.equal(result.evaluations[1].matched, false)
  assert.deepEqual(result.evaluations[1].checks.map(check => check.passed), [true, false])
  assert.match(result.evaluations[1].checks[1].actual, /1 天/)
  assert.deepEqual(result.records.map(record => record.id), result.evaluations.filter(record => record.checks.every(check => check.passed)).map(record => record.id))
  assert.deepEqual(state, before)
})

test('zero results retain both exclusion reasons and sources; old result stays tied to its revision', () => {
  const initial = createState()
  const zero = querySupplyOrders(initial, { minLateDays: 5 })
  assert.equal(zero.status, 'empty')
  assert.equal(zero.matchedCount, 0)
  assert.equal(zero.maxLateDays, null)
  assert.equal(zero.evaluations.length, 2)
  assert.ok(zero.evaluations.every(record => !record.matched && record.checks.every(check => !check.passed)))
  for (const record of zero.evaluations) assert.ok(record.sourceIds.every(id => zero.sources.some(source => source.id === id)))
  const changed = applyAction(initial, { type: 'set_arrival', supplierId: 'A', day: 15 }, 'lead')
  assert.equal(querySupplyOrders(changed, { minLateDays: 5 }).matchedCount, 2)
  assert.equal(zero.matchedCount, 0)
  assert.equal(zero.revision, 1)
})

test('scope and all supported conditions are explained without broadening a partial identifier', () => {
  const state = createState()
  assert.deepEqual(querySupplyOrders(state).evaluations.map(row => row.matched), [true, true])
  assert.deepEqual(querySupplyOrders(state, { atRisk: false, maxRequiredDay: 8 }).records.map(row => row.id), ['ORD-002'])
  const result = querySupplyOrders(state, { orderId: 'ORD-00' })
  assert.equal(result.matchedCount, 0)
  assert.ok(result.evaluations.every(row => row.checks[0].passed === false))
})

test('unread historical citation is re-read in the current request within four model rounds', async t => {
  const state = createState(), before = structuredClone(state)
  let calls = 0
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); calls++
    const tool = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: `call-${calls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    const message = calls === 1 ? tool('query_supply_orders', { atRisk: true })
      : calls === 3 ? tool('search_documents', { ids: ['DOC-MEETING-01'] })
      : { role: 'assistant', content: '1 条订单有到料风险，当前采用 A。[DOC-MEETING-01]' }
    if (calls === 3) assert.match(body.messages.at(-1).content, /本轮尚未读取的资料/)
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done) }))
  const run = await runOfficeChat({ state, question: '筛选有风险的订单', role: 'lead', mode: 'live', provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', apiKey: 'fixture-only' } })
  assert.equal(run.status, 'completed', JSON.stringify(run.error))
  assert.equal(calls, 4)
  assert.deepEqual(run.toolCalls.map(call => call.name), ['query_supply_orders', 'search_documents'])
  assert.ok(run.sources.some(source => source.id === 'DOC-MEETING-01'))
  assert.deepEqual(state, before)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createState, applyAction, previewAction, getDocuments } from '../server/office-domain.mjs'
import { parseSupplyCsv } from '../server/office-supply-import.mjs'
import { querySupplyOrders } from '../server/office-supply-query.mjs'
import { queryOrderChain } from '../server/office-order-chain.mjs'
import { createLocalStore } from '../server/office-store.mjs'
import { createOfficeService } from '../server/office-service.mjs'
import { runOfficeChat } from '../server/office-model.mjs'

const state = () => createState({ orders: [{ id: 'ORD-001-01', materialId: 'M-01', requiredDay: 5 }, { id: 'ORD-001-02', materialId: 'M-01', requiredDay: 8 }] })
const action = () => ({ type: 'import_supply', dataKind: 'synthetic', files: ['Supplier', 'Order'].map(type => ({ type, name: `${type}.csv`, text: readFileSync(new URL(`../public/supply-samples/${type}.csv`, import.meta.url), 'utf8') })) })

test('existing delayed CSV -> objects -> deterministic conditions -> original row evidence, no approval changes', () => {
  const initial = state(), before = structuredClone(initial), input = action()
  assert.equal(previewAction(initial, input, 'lead').allowed, true)
  assert.deepEqual(initial, before)
  const next = applyAction(initial, input, 'lead')
  const result = querySupplyOrders(next, { atRisk: true })
  assert.equal(result.matchedCount, 2)
  assert.deepEqual(result.records.map(record => record.lateDays), [4, 1])
  assert.equal(result.maxLateDays, 4)
  assert.deepEqual(next.tasks, before.tasks)
  assert.deepEqual(next.decisions, before.decisions)
  assert.equal(next.matter.supplierId, 'A')
  assert.equal(next.revision, before.revision + 1)
  for (const row of result.records) {
    const evidence = result.sources.filter(source => row.sourceIds.includes(source.id) && /^DOC-IMPORT-(ORDER|SUPPLIER)-/.test(source.id))
    assert.equal(evidence.length, 2)
    assert.ok(evidence.some(source => source.text.includes(row.id)))
    assert.ok(evidence.some(source => source.text.includes('Supplier.csv')))
    assert.ok(evidence.every(source => source.text.includes('SHA-256') && source.text.includes('原始记录')))
  }
  assert.equal(querySupplyOrders(next, { minLateDays: 2, maxRequiredDay: 5 }).records[0].id, 'ORD-001-01')
  assert.match(result.sources.find(source => source.id.startsWith('DOC-IMPORT-CHANGE')).text, /导入前 1 条 → 导入后 2 条/)
  assert.equal(querySupplyOrders(next, { atRisk: false }).matchedCount, 0)
  assert.equal(querySupplyOrders(next, { orderId: 'ORD-002-01' }).matchedCount, 0)
  assert.equal(querySupplyOrders(next, { minLateDays: 10 }).maxLateDays, null)
  assert.ok(queryOrderChain(next, { orderId: 'ORD-001-02' }).sources.some(source => source.id.startsWith('DOC-IMPORT-ORDER')))
  assert.throws(() => querySupplyOrders(next, { minLateDays: '2' }), { code: 'SUPPLY_QUERY_INVALID' })
  assert.throws(() => querySupplyOrders(next, { amount: 2 }), { code: 'SUPPLY_QUERY_INVALID' })
})

test('malformed, incomplete, duplicate, cross-matter, mixed-snapshot or real-data imports fail atomically', () => {
  const cases = [
    a => { a.dataKind = 'real' },
    a => { a.files.pop() },
    a => { a.files[0].text = a.files[0].text.replace('"9"', '""') },
    a => { a.files[0].text = a.files[0].text.replace('"9"', '"1e1"') },
    a => { a.files[0].text = a.files[0].text.replace('"4"', '"2"') },
    a => { a.files[0].text = a.files[0].text.split('\n').slice(0, 2).join('\n') },
    a => { a.files[1].text = a.files[1].text.replaceAll('ORD-001-02', 'ORD-001-01') },
    a => { a.files[1].text = a.files[1].text.replaceAll('ORD-001-02', 'ORD-002-02') },
    a => { a.files[1].text = a.files[1].text.replaceAll('M-01', 'M-02') },
    a => { a.files[1].text = a.files[1].text.replaceAll('delayed', 'initial') },
    a => { a.files[0].text += '"unterminated' },
    a => { a.files[0].text = a.files[0].text.replace('"p_id"', '"p_name"') },
    a => { a.files[0].text = 'x'.repeat(60001) },
  ]
  for (const change of cases) {
    const initial = state(), before = structuredClone(initial), input = action()
    change(input)
    assert.equal(previewAction(initial, input, 'lead').allowed, false)
    assert.throws(() => applyAction(initial, input, 'lead'), { code: 'SUPPLY_IMPORT_INVALID' })
    assert.deepEqual(initial, before)
  }
  assert.equal(previewAction(state(), action(), 'sales').allowed, false)
  const selected = applyAction(state(), { type: 'select_plan', supplierId: 'A' }, 'lead')
  assert.equal(previewAction(selected, action(), 'lead').allowed, false)
  assert.equal(previewAction(createState({ matterId: 'SUP-002' }), action(), 'lead').allowed, false)
})

test('CSV parser preserves original physical rows, BOM, quoted newlines and rejects broken quotes', () => {
  const parsed = parseSupplyCsv('\uFEFFid,text\r\n1,"a,b\n""quoted"""\r\n2,end\r\n')
  assert.equal(parsed.rows[0].fields.text, 'a,b\n"quoted"')
  assert.equal(parsed.rows[0].line, 2)
  assert.equal(parsed.rows[1].line, 4)
  for (const text of ['id,id\n1,2', 'id,text\n1,"x"y', 'id,text\n1,x"y', 'id,text\n1']) assert.throws(() => parseSupplyCsv(text))
})

test('model tool protocol uses program filter and imported row citation without treating source IDs as unknown orders', async t => {
  const imported = applyAction(state(), action(), 'lead'), before = structuredClone(imported)
  let calls = 0
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    let message
    if (++calls === 1) {
      assert.equal(body.tool_choice.function.name, 'query_supply_orders')
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'filter-call', type: 'function', function: { name: 'query_supply_orders', arguments: JSON.stringify({ atRisk: true, minLateDays: 2 }) } }] }
    } else {
      const result = JSON.parse(body.messages.at(-1).content)
      assert.equal(result.matchedCount, 1)
      assert.equal(result.records[0].lateDays, 4)
      const source = result.sources.find(item => item.id.startsWith('DOC-IMPORT-ORDER-R2'))
      message = { role: 'assistant', content: `符合条件的订单共 1 条：ORD-001-01，预计晚 4 天。[${source.id}]` }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done) }))
  const run = await runOfficeChat({ state: imported, question: '筛选有到料风险且至少晚 2 天的订单', role: 'lead', mode: 'live', provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-only', model: 'fixture' } })
  assert.equal(run.status, 'completed', JSON.stringify(run.error))
  assert.equal(run.toolCalls[0].result.matchedCount, 1)
  assert.equal(run.supplyQuery.matchedCount, 1)
  assert.equal(run.supplyQuery.evaluations[1].matched, false)
  assert.deepEqual(imported, before)
})

test('projection ignores CSV calculated fields; later arrival edits do not cite obsolete supplier row as current', () => {
  const input = action()
  input.files[1].text = input.files[1].text.replace('"4"', '"999"')
  const imported = applyAction(state(), input, 'lead')
  const oldAnswer = querySupplyOrders(imported)
  assert.deepEqual(oldAnswer.records.map(row => row.lateDays), [4, 1])
  const changed = applyAction(imported, { type: 'set_arrival', supplierId: 'A', day: 6 }, 'lead')
  assert.deepEqual(querySupplyOrders(changed).records.map(row => row.lateDays), [1, 0])
  assert.ok(!querySupplyOrders(changed).sources.some(source => source.id.startsWith('DOC-IMPORT-SUPPLIER-A')))
  assert.ok(oldAnswer.sources.some(source => source.id.startsWith('DOC-IMPORT-SUPPLIER-A')))
  assert.ok(getDocuments(changed).some(source => source.id.startsWith('DOC-IMPORT-SUPPLIER-A')))
})

test('existing confirmation handles versions, duplicate requests, persistence and session isolation for import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-import-')), path = join(dir, 'office.sqlite')
  let store = createLocalStore(path)
  let service = createOfficeService({ store, defaultMode: 'rules' })
  const token = 'e'.repeat(64)
  const call = async (route, body, session = token) => (await service.handle({ token: session, method: body ? 'POST' : 'GET', path: route, body: body || {}, role: 'lead' })).body
  try {
    const initial = await call('/snapshot')
    const first = (await call('/preview', { action: action(), expectedVersion: initial.state.revision })).preview
    const stale = (await call('/preview', { action: action() })).preview
    const body = { previewId: first.id, expectedVersion: first.revision, idempotencyKey: randomUUID() }
    const confirmed = await call('/confirm', body)
    assert.equal(confirmed.analysis.riskCount, 2)
    assert.equal((await call('/confirm', body)).state.revision, confirmed.state.revision)
    await assert.rejects(() => call('/confirm', { previewId: stale.id, expectedVersion: stale.revision, idempotencyKey: randomUUID() }), { code: 'STALE_VERSION' })
    assert.equal((await call('/snapshot', undefined, 'f'.repeat(64))).analysis.riskCount, 1)
    store.close(); store = createLocalStore(path); service = createOfficeService({ store, defaultMode: 'rules' })
    assert.equal((await call('/snapshot')).analysis.riskCount, 2)
    assert.equal((await call('/documents')).documents.filter(doc => doc.id.startsWith('DOC-IMPORT')).length, 5)
    const publicService = createOfficeService({ store, publicDemo: true })
    await assert.rejects(() => publicService.handle({ token, method: 'POST', path: '/preview', body: { action: { type: 'reset' } } }), { code: 'PUBLIC_ACTION_DENIED' })
  } finally { store.close() }
})

test('public demo permits bounded synthetic import with confirmation, role and visitor isolation guards', async () => {
  const store = createLocalStore(join(mkdtempSync(join(tmpdir(), 'office-public-import-')), 'office.sqlite'))
  const service = createOfficeService({ store, publicDemo: true })
  const token = 'a'.repeat(64)
  const call = async (path, body, role = 'lead', session = token) => (await service.handle({ token: session, method: body ? 'POST' : 'GET', path, body: body || {}, role })).body
  try {
    assert.equal((await call('/preview', { action: action() }, 'sales')).preview.allowed, false)
    assert.equal((await call('/preview', { action: { ...action(), dataKind: 'real' } })).preview.allowed, false)
    const malformed = action(); malformed.files[1].text = malformed.files[1].text.replaceAll('M-01', 'M-02')
    assert.equal((await call('/preview', { action: malformed })).preview.allowed, false)
    const { preview } = await call('/preview', { action: action() }, 'procurement')
    assert.equal(preview.allowed, true)
    assert.equal((await call('/snapshot')).analysis.riskCount, 1)
    const confirmed = await call('/confirm', { previewId: preview.id, expectedVersion: preview.revision, idempotencyKey: randomUUID() }, 'procurement')
    assert.equal(confirmed.analysis.riskCount, 2)
    assert.deepEqual((await call('/supply-orders')).records.map(row => row.lateDays), [4, 1])
    assert.equal((await call('/snapshot', undefined, 'lead', 'b'.repeat(64))).analysis.riskCount, 1)
    for (const type of ['reset', 'set_arrival', 'arm_delivery_failure']) {
      await assert.rejects(() => call('/preview', { action: { type } }), { code: 'PUBLIC_ACTION_DENIED' })
    }
  } finally { store.close() }
})

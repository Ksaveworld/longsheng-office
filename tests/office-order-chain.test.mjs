import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createState, applyAction } from '../server/office-domain.mjs'
import { queryOrderChain } from '../server/office-order-chain.mjs'
import { runOfficeChat } from '../server/office-model.mjs'

const text = chain => chain.steps.flatMap(step => step.lines).join('\n')
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/supply-fixtures.json', import.meta.url), 'utf8')).snapshots

test('six independent snapshots retain their actual supplier, decision and source version without writes', () => {
  for (const { id, state } of fixtures) {
    const before = structuredClone(state)
    const result = queryOrderChain(state, { orderId: state.orders[0].id })
    assert.equal(result.status, 'ready', id)
    assert.equal(result.revision, state.revision)
    assert.match(text(result), new RegExp(`供应商 ${['approved', 'closed'].includes(id) ? 'B' : 'A'} · 当前采用`))
    assert.match(text(result), /办公事项关闭不代表订单已交付/)
    const sources = new Set(result.sources.map(source => source.id))
    for (const step of result.steps) for (const source of step.sourceIds) assert.ok(sources.has(source), source)
    assert.deepEqual(state, before)
    if (id === 'selected' || id === 'reviewed') assert.match(text(result), /DEC-01 · 当前有效/)
    if (id === 'approved') assert.match(text(result), /待送达/)
    if (id === 'closed') assert.match(text(result), /已关闭/)
  }
})

test('arrival changes refresh only current order impact; old returned evidence remains a snapshot', () => {
  const state = createState()
  const before = queryOrderChain(state, { orderId: 'ORD-002' })
  const after = queryOrderChain(applyAction(state, { type: 'set_arrival', supplierId: 'A', day: 9 }, 'lead'), { orderId: 'ORD-002' })
  assert.match(text(before), /预计满足到料窗口/)
  assert.match(text(after), /预计晚 1 天/)
  assert.match(text(before), /预计 D6 到料/)
  assert.equal(after.revision, before.revision + 1)
})

test('unknown, partial and other-matter order identifiers never borrow current facts', () => {
  const state = fixtures[0].state
  for (const orderId of [undefined, 'ORD-001', 'ORD-002-01', 'ORD-001-01-extra', {}]) {
    const result = queryOrderChain(state, { orderId })
    assert.equal(result.status, 'not_found')
    assert.deepEqual(result.sources, [])
    assert.equal(result.steps, undefined)
  }
})

test('assistant uses the same order chain and citations and prepares no action', async () => {
  const state = fixtures[0].state
  const run = await runOfficeChat({ state, question: '追溯 ORD-001-02 的供货、决定和办理进度', role: 'lead', mode: 'rules' })
  assert.equal(run.status, 'completed')
  assert.equal(run.toolCalls[0].name, 'query_order_chain')
  assert.match(run.answer, /预计满足到料窗口/)
  assert.doesNotMatch(run.answer, /ORD-001-01/)
  assert.equal(run.proposal, undefined)
  assert.equal(run.planVersions, undefined)
  const ids = new Set(run.sources.map(source => source.id))
  for (const [, id] of run.answer.matchAll(/\[([^\]]+)\]/g)) assert.ok(ids.has(id), id)
  const unknown = await runOfficeChat({ state, question: '追溯 ORD-999-01', role: 'lead', mode: 'rules' })
  assert.match(unknown.answer, /未找到/)
  assert.deepEqual(unknown.sources, [])
})

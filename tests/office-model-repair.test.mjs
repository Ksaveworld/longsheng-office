import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { getDocuments } from '../server/office-domain.mjs'
import { createSeedMatters } from '../server/office-seeds.mjs'
import { runOfficeChat } from '../server/office-model.mjs'

const toolMessage = (name, args = {}, id = 'tool') => ({
  role: 'assistant', content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})
const answer = content => ({ role: 'assistant', content })
const plan = (state, supplierId = 'B') => ({
  supplierId, summary: `核对供应商 ${supplierId} 的到料安排`, advantages: ['已有通知可供核对'],
  risks: ['仍须跟进到料风险'], constraints: ['质量岗位核验所选版本后，由负责人批准'],
  sourceIds: [getDocuments(state).find(document => document.id.startsWith('DOC-LEDGER')).id],
})
async function mockProvider(t, handler) {
  const requests = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    const message = await handler(body, requests.length)
    if (message === undefined) return
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return { requests, provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'repair-test-model', apiKey: 'repair-test-only-secret' } }
}

test('multi-turn plan text is repaired through a real forced tool call within four requests', async t => {
  const state = createSeedMatters()[0]
  const before = structuredClone(state)
  const sourceId = plan(state).sourceIds[0]
  const { requests, provider } = await mockProvider(t, (_body, n) => {
    if (n === 1 || n === 4) return toolMessage('search_documents', {}, `read-${n}`)
    if (n === 2) return toolMessage('present_plans', { plans: [plan(state, 'A'), plan(state, 'B')] }, 'first-plans')
    if (n === 3) return answer(`A/B 方案可比较，仍须核验与批准。[${sourceId}]`)
    if (n === 5) return answer(`另一个方案是 B，需人工确认条件。[${sourceId}]`)
    if (n === 6) return toolMessage('present_plans', { plans: [plan(state, 'B')] }, 'repaired-plans')
    return answer(`B 候选已形成，等待选择及人工核验。[${sourceId}]`)
  })
  const first = await runOfficeChat({ state, question: '比较 A/B 方案', role: 'lead', provider })
  assert.equal(first.status, 'completed', JSON.stringify(first.error))
  const history = [{ role: 'user', content: first.question }, { role: 'assistant', content: first.answer }]
  const historyBefore = structuredClone(history)
  const followup = await runOfficeChat({ state, question: '另一个方案呢？', role: 'lead', provider, conversationMessages: history, signal: AbortSignal.timeout(5000) })
  assert.equal(followup.status, 'completed', JSON.stringify(followup.error))
  assert.equal(followup.mode, 'live')
  assert.equal(followup.intent, 'plans')
  assert.deepEqual(followup.planVersions.map(version => version.supplierId), ['B'])
  assert.ok(first.planVersions.every(version => version.id !== followup.planVersions[0].id))
  assert.equal(followup.planVersions[0].revision, state.revision)
  assert.equal(followup.proposal, undefined)
  assert.deepEqual(followup.toolCalls.map(call => call.name), ['search_documents', 'present_plans'])
  assert.equal(followup.toolCalls.at(-1).result.planVersions[0].id, followup.planVersions[0].id)
  assert.equal(requests.length, 7, 'three calls for the first answer and four for the repaired follow-up')
  assert.equal(requests[2].tool_choice, 'none')
  assert.equal(requests[3].tool_choice.function.name, 'search_documents')
  assert.equal(requests[4].tool_choice.function.name, 'present_plans')
  assert.equal(requests[5].tool_choice.function.name, 'present_plans')
  assert.equal(requests[6].tool_choice, 'none')
  assert.match(requests[5].messages.at(-1).content, /缺少可核对的结构化候选.*请现在调用 present_plans/)
  assert.equal(requests[5].messages.at(-2).role, 'assistant')
  assert.equal(requests[6].messages.at(-1).tool_call_id, 'repaired-plans')
  assert.equal(followup.usage.total_tokens, 12, 'repair is part of this run usage')
  assert.ok(followup.sources.every(source => getDocuments(state).some(document => document.id === source.id && document.text === source.text)))
  assert.equal(JSON.stringify(followup).includes(provider.apiKey), false)
  assert.deepEqual(state, before)
  assert.deepEqual(history, historyBefore)
})

for (const scenario of ['no-room', 'ignored-repair', 'unfinished-final', 'invalid-draft']) {
  test(`plan repair fails explicitly without fake plans or a fifth request: ${scenario}`, async t => {
    const state = createSeedMatters()[0]
    const before = structuredClone(state)
    const { requests, provider } = await mockProvider(t, (_body, n) => {
      if (n === 1) return toolMessage('search_documents')
      if (scenario === 'no-room' && n === 2) return toolMessage('analyze_impact')
      if (n === 3 && scenario === 'unfinished-final') return toolMessage('present_plans', { plans: [plan(state)] })
      if (n === 4 && scenario === 'unfinished-final') return toolMessage('analyze_impact')
      if (n === 3 && scenario === 'invalid-draft') return toolMessage('present_plans', { plans: [{ ...plan(state), supplierId: 'C' }] })
      return answer('另一个方案的条件仍须人工核对。')
    })
    const run = await runOfficeChat({ state, question: '另一个方案呢？', role: 'lead', provider })
    assert.equal(run.status, 'failed')
    assert.equal(run.error.code, scenario === 'unfinished-final' ? 'MODEL_ROUND_LIMIT' : 'MODEL_PLANS_MISSING')
    assert.equal(requests.length, ['unfinished-final', 'invalid-draft'].includes(scenario) ? 4 : 3)
    assert.equal(run.answer, '')
    assert.equal(run.planVersions, undefined)
    assert.equal(run.proposal, undefined)
    assert.equal(run.mode, 'live')
    assert.deepEqual(state, before)
    if (scenario === 'no-room') assert.ok(requests.every(request => !request.messages.some(message => message.role === 'user' && message.content.includes('缺少可核对的结构化候选'))))
    if (scenario === 'invalid-draft') assert.equal(run.toolCalls.at(-1).result.error.code, 'PLAN_DRAFT_INVALID')
  })
}

test('the existing run cancellation signal still aborts a forced repair request', async t => {
  const state = createSeedMatters()[0]
  const controller = new AbortController()
  const { requests, provider } = await mockProvider(t, (_body, n) => {
    if (n === 1) return toolMessage('search_documents')
    if (n === 2) return answer('另一个方案仍需核对。')
    setTimeout(() => controller.abort(), 20)
    return undefined
  })
  const run = await runOfficeChat({ state, question: '另一个方案呢？', role: 'lead', provider, signal: controller.signal })
  assert.equal(requests.length, 3)
  assert.equal(requests[2].tool_choice.function.name, 'present_plans')
  assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'MODEL_TIMEOUT')
  assert.equal(run.answer, '')
  assert.equal(run.planVersions, undefined)
})

test('complete current order IDs are preserved while unknown suffixes cannot pass as known prefixes', async t => {
  const state = createSeedMatters()[0]
  const knownId = state.orders[0].id
  let modelText
  const { provider } = await mockProvider(t, (_body, n) => n % 2 ? toolMessage('search_documents') : answer(modelText))
  modelText = `订单 ${state.orders.map(order => order.id).join('、')} 需核对到料安排。`
  const good = await runOfficeChat({ state, question: '哪些订单受影响', role: 'lead', provider })
  assert.equal(good.status, 'completed')
  assert.equal(good.answer, modelText, 'businessAnswer must not rewrite order IDs')
  for (const invalidId of [`${knownId}-01`, `${knownId}-02`, `${knownId}_extra`, 'ORD-NOT-FOUND']) {
    modelText = `订单${invalidId}存在到料风险。`
    const run = await runOfficeChat({ state, question: '哪些订单受影响', role: 'lead', provider })
    assert.equal(run.status, 'failed')
    assert.equal(run.error.code, 'MODEL_ORDER_INVALID')
    assert.ok(run.error.message.includes(invalidId), 'report the complete invalid token, not the existing prefix')
    assert.equal(run.answer, '')
    assert.equal(run.planVersions, undefined)
  }
})

test('structured plan text cannot contain invented order IDs either', async t => {
  const state = createSeedMatters()[0]
  const invalidId = `${state.orders[0].id}-01`
  for (const field of ['summary', 'advantages', 'risks', 'constraints', 'suggestions', 'gaps']) {
    const malformed = { ...plan(state), [field]: field === 'summary' ? `跟进 ${invalidId}` : [`跟进 ${invalidId}`] }
    const { provider } = await mockProvider(t, (_body, n) => n === 1 ? toolMessage('search_documents') : n === 2 ? toolMessage('present_plans', { plans: [malformed] }) : answer('方案已准备。'))
    const run = await runOfficeChat({ state, question: '比较方案', role: 'lead', provider })
    assert.equal(run.status, 'failed')
    assert.equal(run.error.code, 'MODEL_PLANS_MISSING')
    assert.equal(run.toolCalls.at(-1).result.error.code, 'PLAN_DRAFT_INVALID', field)
    assert.equal(run.planVersions, undefined)
    assert.equal(run.answer, '')
  }
})

test('plan text with an unread source fails citation validation before any repair', async t => {
  const state = createSeedMatters()[0]
  const [read, unread] = getDocuments(state)
  const { requests, provider } = await mockProvider(t, (_body, n) => n === 1 ? toolMessage('search_documents', { ids: [read.id] }) : answer(`另一个方案依据 [${unread.id}]。`))
  const run = await runOfficeChat({ state, question: '另一个方案呢？', role: 'lead', provider })
  assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'MODEL_CITATION_INVALID')
  assert.equal(requests.length, 2)
  assert.equal(run.planVersions, undefined)
})


test('feedback target dates receive a field-specific correction and accepted plans reserve the final reply', async t => {
  const state = createSeedMatters()[0]
  const before = structuredClone(state)
  const { requests, provider } = await mockProvider(t, (body, n) => {
    if (n === 1) return toolMessage('search_documents')
    if (n === 2) return toolMessage('present_plans', { plans: [{ ...plan(state), risks: ['预计 D4，晚于 D2 目标约两天'] }] })
    if (n === 3) {
      const rejected = JSON.parse(body.messages.at(-1).content)
      assert.equal(rejected.error.code, 'PLAN_DRAFT_INVALID')
      assert.match(rejected.error.message, /B\.risks.*D2.*gaps/)
      return toolMessage('present_plans', { plans: [{ ...plan(state), risks: ['预计 D4 到料'], gaps: ['无法满足用户希望 D2 到料的目标，资料仍为 D4'] }] })
    }
    assert.equal(body.tool_choice, 'none', 'accepted structured output is followed by a real model final reply, with no redundant tool round')
    return answer('备选 B 仍预计 D4，无法满足 D2 目标，需核验后批准。')
  })
  const run = await runOfficeChat({ state, question: '请调整方案', feedback: '希望 D2 到料', role: 'lead', provider })
  assert.equal(run.status, 'completed', JSON.stringify(run.error))
  assert.equal(requests.length, 4)
  assert.equal(run.planVersions[0].gaps[0], '无法满足用户希望 D2 到料的目标，资料仍为 D4')
  assert.equal(run.planVersions[0].origin, 'model')
  assert.equal(run.toolCalls[1].result.error.code, 'PLAN_DRAFT_INVALID')
  assert.equal(run.proposal, undefined)
  assert.deepEqual(state, before)
})

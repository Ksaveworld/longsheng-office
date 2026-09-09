import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createState, getDocuments } from '../server/office-domain.mjs'
import { runOfficeChat, testProvider } from '../server/office-model.mjs'
import { projectOffice } from '../server/office-ontology.mjs'

const SECRET = 'test-key-do-not-persist'
const response = (content, calls) => ({ choices: [{ finish_reason: calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })
const call = (name, args = {}, id = 'call-1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

async function providerServer(t, handler) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    const body = JSON.parse(raw)
    requests.push({ path: req.url, headers: req.headers, body })
    try {
      const result = await handler(body, requests.length, res)
      if (result !== undefined && !res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      }
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return { requests, provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'test-model', apiKey: SECRET } }
}

test('real HTTP tool protocol preserves IDs, derives sources from returned documents, and leaves state untouched', async t => {
  const state = createState()
  const before = structuredClone(state)
  const source = getDocuments(state)[0]
  const { provider, requests } = await providerServer(t, (_body, n) => n === 1
    ? response(null, [call('search_documents', { ids: [source.id] }, 'actual-call-id')])
    : response(`当前依据来自 [${source.id}]。`))
  const run = await runOfficeChat({ state, question: '查询影响', role: 'procurement', provider })
  assert.equal(run.status, 'completed')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].path, '/v1/chat/completions')
  assert.equal(requests[0].headers.authorization, `Bearer ${SECRET}`)
  assert.equal(requests[1].body.messages.at(-1).tool_call_id, 'actual-call-id')
  assert.deepEqual(run.sources.map(doc => doc.id), [source.id])
  assert.deepEqual(state, before)
  assert.equal(run.usage.total_tokens, 16)
  assert.equal(JSON.stringify(run).includes(SECRET), false)
})

test('baseline can retrieve all original data and has equal preview action affordance', async t => {
  const state = createState()
  const { provider, requests } = await providerServer(t, (_body, n) => n % 2 === 1
    ? response(null, [call('search_documents')]) : response('读取了全部资料。'))
  const baseline = await runOfficeChat({ state, question: '比较供应方案', role: 'lead', provider, variant: 'baseline' })
  const ontology = await runOfficeChat({ state, question: '比较供应方案', role: 'lead', provider, variant: 'ontology' })
  assert.equal(baseline.status, 'completed')
  assert.equal(ontology.status, 'completed')
  assert.deepEqual(baseline.sources, ontology.sources)
  assert.deepEqual(baseline.sources.map(doc => doc.id), getDocuments(state).map(doc => doc.id))
  const baselineTools = requests[0].body.tools
  const ontologyTools = requests[2].body.tools
  assert.deepEqual(baselineTools.map(item => item.function.name), ['search_documents', 'preview_action'])
  assert.deepEqual(baselineTools.find(item => item.function.name === 'preview_action'), ontologyTools.find(item => item.function.name === 'preview_action'))
  assert.equal(baselineTools.some(item => /execute|confirm/.test(item.function.name)), false)
})

test('permitted action is a preview only; caller role cannot be replaced by tool input', async t => {
  const state = createState()
  const { provider } = await providerServer(t, (_body, n) => n === 1
    ? response(null, [call('preview_action', { action: { type: 'request_quality' }, role: 'lead' })])
    : response('质量核验请求已准备，等待人工确认。'))
  const run = await runOfficeChat({ state, question: '发起质量核验', role: 'procurement', provider })
  assert.equal(run.status, 'completed')
  assert.equal(run.proposal.type, 'request_quality')
  assert.equal(state.tasks.length, 0)
  assert.equal(state.revision, 1)
})

test('ontology tools read the same graph objects and return only actual sources and timestamps', async t => {
  const state = createState()
  const { provider } = await providerServer(t, (_body, n) => n === 1
    ? response(null, [call('query_objects', { id: 'Supplier:B' }, 'object-1'), call('query_relations', { id: 'Matter:SUP-001', depth: 2 }, 'relation-1')])
    : response('供应商 B 待核验，较新会议尚未批准切换。'))
  const run = await runOfficeChat({ state, question: '查询对象关系', role: 'procurement', provider })
  assert.equal(run.status, 'completed', JSON.stringify(run.error))
  const expected = projectOffice(state).objects.find(o => o.id === 'Supplier:B')
  assert.deepEqual(run.toolCalls[0].result.objects.find(o => o.id === 'Supplier:B'), expected)
  assert.equal(run.toolCalls[1].result.revision, state.revision)
  assert.ok(run.toolCalls[1].result.relations.length > 0)
  assert.ok(run.sources.length > 0)
  assert.ok(run.toolCalls.every(entry => Date.parse(entry.startedAt) <= Date.parse(entry.completedAt) && entry.latencyMs >= 0))
  assert.equal(state.revision, 1)
})

test('denied quality/role prerequisites never yield an executable proposal', async t => {
  const state = createState()
  const { provider } = await providerServer(t, (_body, n) => n === 1
    ? response(null, [call('preview_action', { action: { type: 'approve_switch' }, role: 'lead' })])
    : response('当前条件不允许切换。'))
  const run = await runOfficeChat({ state, question: '直接批准切换', role: 'sales', provider })
  assert.equal(run.status, 'completed')
  assert.equal(run.toolCalls[0].result.allowed, false)
  assert.equal(run.proposal, undefined)
  assert.equal(state.matter.supplierId, 'A')
})

test('four model requests is a hard limit and partial proposals are discarded', async t => {
  const { provider, requests } = await providerServer(t, (_body, n) => response(null, [call('preview_action', { action: { type: 'request_quality' } }, `call-${n}`)]))
  const run = await runOfficeChat({ state: createState(), question: '请求核验', role: 'procurement', provider })
  assert.equal(requests.length, 4)
  assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'MODEL_ROUND_LIMIT')
  assert.equal(run.answer, '')
  assert.equal(run.proposal, undefined)
})

test('unknown tools and malformed arguments return tool errors with matching IDs', async t => {
  const { provider, requests } = await providerServer(t, (_body, n) => {
    if (n === 1) return response(null, [call('execute_action', {}, 'forbidden'), { ...call('search_documents', {}, 'malformed'), function: { name: 'search_documents', arguments: '{broken' } }])
    if (n === 2) return response(null, [call('search_documents', {}, 'read')])
    return response('已读取资料，未执行操作。')
  })
  const run = await runOfficeChat({ state: createState(), question: '执行', role: 'lead', provider })
  assert.equal(run.status, 'completed')
  assert.equal(run.toolCalls[0].result.error.code, 'TOOL_NOT_ALLOWED')
  assert.equal(run.toolCalls[1].result.error.code, 'TOOL_ARGUMENTS_INVALID')
  assert.deepEqual(requests[1].body.messages.slice(-2).map(message => message.tool_call_id), ['forbidden', 'malformed'])
})

test('upstream HTTP errors are safe, explicit failures and never silently switch to rules', async t => {
  const { provider } = await providerServer(t, (_body, _n, res) => { res.writeHead(401); res.end(`private ${SECRET}`) })
  const run = await runOfficeChat({ state: createState(), question: '影响', role: 'lead', provider })
  assert.equal(run.status, 'failed')
  assert.equal(run.mode, 'live')
  assert.equal(run.error.code, 'MODEL_HTTP_ERROR')
  assert.equal(run.answer, '')
  assert.equal(JSON.stringify(run).includes(SECRET), false)
})

test('missing key fails without network; rules mode must be explicit', async () => {
  const input = { state: createState(), question: '影响', role: 'lead', provider: { baseUrl: 'https://invalid.example/v1', model: 'x' } }
  const failed = await runOfficeChat(input)
  assert.equal(failed.error.code, 'MODEL_KEY_MISSING')
  const rules = await runOfficeChat({ ...input, mode: 'rules' })
  assert.equal(rules.status, 'completed')
  assert.equal(rules.mode, 'rules')
  assert.equal(rules.mode, 'rules')
  assert.equal(rules.model, '规则演示')
  assert.match(rules.answer, /关联 2 条订单/)
})

test('timeout cancels the actual HTTP request and yields retryable failure', async t => {
  const { provider } = await providerServer(t, () => undefined)
  const run = await runOfficeChat({ state: createState(), question: '影响', role: 'lead', provider: { ...provider, timeoutMs: 100 } })
  assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'MODEL_TIMEOUT')
  assert.ok(run.latencyMs >= 90)
})

test('fabricated citations are rejected rather than recorded as genuine sources', async t => {
  const { provider } = await providerServer(t, (_body, n) => n === 1 ? response(null, [call('search_documents')]) : response('已批准。[FAKE-DOC-999]'))
  const run = await runOfficeChat({ state: createState(), question: '决定是什么', role: 'lead', provider })
  assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'MODEL_CITATION_INVALID')
  assert.equal(run.sources.some(doc => doc.id === 'FAKE-DOC-999'), false)
  assert.match(run.error.message, /FAKE-DOC-999/)
})

test('ordinary bracketed status, entity IDs and Markdown labels are not fabricated citations', async t => {
  const state = createState()
  const source = getDocuments(state)[0]
  const { provider } = await providerServer(t, (_body, n) => n === 1 ? response(null, [call('search_documents')]) : response(`订单 [ORD-001] 可能晚一天；质量状态 [pending]。参考 [API](https://example.test)。依据 [${source.id}]。`))
  const run = await runOfficeChat({ state, question: '查询', role: 'lead', provider })
  assert.equal(run.status, 'completed')
})

test('valid document ID that was not actually read remains rejected', async t => {
  const state = createState()
  const [read, unread] = getDocuments(state)
  const { provider } = await providerServer(t, (_body, n) => n === 1 ? response(null, [call('search_documents', { ids: [read.id] })]) : response(`依据 [${unread.id}]。`))
  const run = await runOfficeChat({ state, question: '查询', role: 'lead', provider })
  assert.equal(run.status, 'failed')
  assert.equal(run.error.code, 'MODEL_CITATION_INVALID')
})

test('DeepSeek v4 uses disabled thinking; connectivity reports actual reply and redacts echoed key', async t => {
  const { provider, requests } = await providerServer(t, () => response(`OK ${SECRET}`))
  const result = await testProvider({ ...provider, model: 'deepseek-v4-flash' })
  assert.equal(result.ok, true)
  assert.deepEqual(requests[0].body.thinking, { type: 'disabled' })
  assert.equal(requests[0].body.temperature, undefined)
  assert.equal(requests[0].body.max_tokens, 1800)
  assert.equal(result.reply, 'OK [REDACTED]')
})

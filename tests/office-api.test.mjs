import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createOfficeServer } from '../server/office-server.mjs'

test('HTTP full chain, confirmation, retries, role/version guards, isolation and restart durability', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'longsheng-office-test-'))
  const dbPath = join(dir, 'office.sqlite')
  let server, base
  async function start() { server = createOfficeServer({ dbPath }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}/api/office` }
  async function stop() { await new Promise(resolve => server.close(resolve)) }
  function client() {
    let cookie = ''
    return async (path, body, role = 'procurement') => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'X-Demo-Role': role, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie
      return { status: response.status, body: await response.json() }
    }
  }
  await start()
  const a = client(), b = client()
  const preview = async (action, role = 'procurement') => (await a('/preview', { action }, role)).body.preview
  const confirm = async (p, role = 'procurement', key = randomUUID()) => a('/confirm', { previewId: p.id, expectedVersion: p.revision, idempotencyKey: key }, role)
  const act = async (action, role = 'procurement') => { const p = await preview(action, role); assert.equal(p.allowed, true, p.reason); const result = await confirm(p, role); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body }
  try {
    assert.equal((await a('/snapshot')).body.analysis.riskCount, 1)
    const bInitial = (await b('/snapshot')).body
    for (const step of ['impact', 'decisions', 'paths']) {
      const current = (await a('/snapshot')).body
      const result = await a('/guided', { step, mode: 'rules', expectedVersion: current.state.revision, idempotencyKey: randomUUID() }, 'lead')
      assert.equal(result.body.run.status, 'completed')
    }
    const cancelled = await preview({ type: 'request_quality' })
    assert.equal((await a('/snapshot')).body.state.tasks.length, 0, 'preview has no side effects')
    assert.equal((await confirm(cancelled, 'sales')).status, 403)
    const late = await act({ type: 'set_arrival', supplierId: 'A', day: 9 }, 'lead')
    assert.equal(late.analysis.riskCount, 2)
    assert.equal(late.graph.revision, late.state.revision)
    assert.equal(late.graph.workspaceId, late.workspaceId)
    assert.deepEqual((await a('/graph')).body, late.graph, 'graph is derived from the same authoritative state')
    assert.equal((await a('/relations?id=Matter%3ASUP-001&depth=2')).status, 200)
    assert.equal((await a('/relations?depth=3')).status, 422)
    assert.equal((await confirm(cancelled)).status, 409, 'stale confirmation rejected')
    await act({ type: 'set_arrival', supplierId: 'A', day: 6 }, 'lead')
    await act({ type: 'arm_delivery_failure' }, 'lead')
    const p = await preview({ type: 'request_quality' }); const key = randomUUID()
    const created = await confirm(p, 'procurement', key)
    assert.equal(created.body.state.tasks[0].status, 'delivery_failed')
    assert.deepEqual((await confirm(p, 'procurement', key)).body, created.body, 'same idempotency key returns saved response')
    assert.equal((await confirm(p, 'procurement', randomUUID())).status, 409, 'same preview cannot execute twice')
    assert.equal((await a('/confirm', { previewId: p.id, expectedVersion: p.revision + 1, idempotencyKey: key })).status, 409)
    const retried = await act({ type: 'retry_delivery', taskId: 'T-QA' })
    assert.equal(retried.state.tasks.length, 1)
    assert.equal(retried.state.tasks[0].attempts, 2)
    assert.equal((await preview({ type: 'approve_switch' }, 'lead')).allowed, false)
    await act({ type: 'submit_quality', taskId: 'T-QA', result: 'rejected', evidence: '合成核验：首次文件不齐。' }, 'quality')
    await act({ type: 'request_quality' })
    const quality = await act({ type: 'submit_quality', taskId: 'T-QA', result: 'approved', evidence: '合成核验：资质补齐并通过。' }, 'quality')
    assert.equal(quality.state.tasks[0].history[0].qualityResult, 'rejected')
    await act({ type: 'approve_switch' }, 'lead')
    assert.equal((await preview({ type: 'close_matter' }, 'lead')).allowed, false)
    await act({ type: 'submit_receipt', taskId: 'T-PUR', evidence: '合成回执：已确认 D4 采购安排。' })
    await stop(); await start()
    const restored = (await a('/snapshot')).body
    assert.match(restored.state.tasks.find(t => t.id === 'T-PUR').receipt.evidence, /采购安排/)
    assert.equal(restored.analysis.effectiveDecisionId, 'DEC-03')
    assert.equal(restored.graph.objects.find(o => o.id === 'Decision:DEC-03').properties.status, 'effective')
    assert.ok(restored.graph.objects.some(o => o.id === 'Receipt:T-PUR'))
    assert.equal(restored.graph.revision, restored.state.revision)
    assert.ok(!(await b('/graph')).body.objects.some(o => o.id === 'Decision:DEC-03'), 'graph isolated by same workspace cookie')
    const forbidden = await preview({ type: 'submit_receipt', taskId: 'T-SALES', evidence: '越权尝试' })
    assert.equal(forbidden.allowed, false)
    assert.equal((await confirm(forbidden)).status, 403)
    await act({ type: 'submit_receipt', taskId: 'T-SALES', evidence: '合成回执：已同步两单交期。' }, 'sales')
    const closed = await act({ type: 'close_matter' }, 'lead')
    assert.equal(closed.state.matter.status, 'closed')
    assert.equal(closed.state.tasks.length, 3)
    assert.equal((await b('/snapshot')).body.state.revision, bInitial.state.revision)
    const reset = await act({ type: 'reset' }, 'lead')
    assert.ok(reset.state.revision > closed.state.revision)
    assert.equal(reset.state.tasks.length, 0)
    assert.equal((await confirm(p, 'procurement', key)).status, 409, 'old confirmation invalid after reset')
    assert.equal((await a('/model', { apiKey: 'test-private-secret', baseUrl: 'https://example.com', model: 'test' }, 'sales')).status, 403)
    const configured = await a('/model', { apiKey: 'test-private-secret', baseUrl: 'https://example.com', model: 'test' }, 'lead')
    assert.equal(configured.body.keyConfigured, true)
    assert.ok(!JSON.stringify(configured).includes('test-private-secret'))
    await stop(); await start()
    assert.equal((await a('/model')).body.keyConfigured, true)
    assert.equal((await b('/model')).body.keyConfigured, false)
    assert.equal((await a('/model', { baseUrl: 'https://other.example.com' }, 'lead')).body.keyConfigured, false, 'provider switch never forwards prior key')
    const rules = await a('/chat', { question: '延期影响哪些订单？', mode: 'rules' })
    assert.equal(rules.body.run.mode, 'rules')
    assert.equal((await a('/runs')).body.runs.length, 4)
    assert.equal((await b('/runs')).body.runs.length, 0)
    const failedLive = await a('/chat', { question: '没有连接时明确失败。', mode: 'live' })
    assert.equal(failedLive.body.run.status, 'failed')
    assert.equal(failedLive.body.run.mode, 'live')
    const comparison = (await a('/compare', { question: '同一问题用相同资料比较。' })).body.comparison
    assert.equal(comparison.baseline.status, 'failed')
    assert.equal(comparison.ontology.status, 'failed')
    assert.equal(comparison.baseline.revision, comparison.ontology.revision)
    assert.equal(comparison.baseline.model, comparison.ontology.model)
    assert.equal(comparison.baseline.role, comparison.ontology.role)
    assert.equal((await a('/runs')).body.comparisons.length, 1, 'failed comparison retained for retry and review')
    const cross = await fetch(base + '/snapshot', { headers: { Origin: 'https://evil.example.com' } })
    assert.equal(cross.status, 403)
    await stop(); server = null
    assert.ok(!readFileSync(dbPath).includes(Buffer.from('test-private-secret')), 'key encrypted in sqlite')
  } finally { if (server) await stop(); rmSync(dir, { recursive: true, force: true }) }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createState, getWorkflow, migrateState, completeGuidedAnalysis, applyAction, getDocuments, previewAction } from '../server/office-domain.mjs'
import { runOfficeChat } from '../server/office-model.mjs'
import { createOfficeServer } from '../server/office-server.mjs'

const act = (state, type, role = 'lead', fields = {}) => applyAction(state, { type, ...fields }, role)
async function analyzedState() {
  let state = createState()
  for (const step of ['impact', 'decisions', 'paths']) {
    const run = await runOfficeChat({ state, question: step, role: 'lead', mode: 'rules', guidedStep: step })
    state = completeGuidedAnalysis(state, step, run, 'lead')
  }
  return state
}

test('S0-S6 follows completed analysis, quality, approval and independent departmental receipts', async () => {
  const initial = createState()
  assert.equal(getWorkflow(initial).stage, 'S0')
  assert.equal(initial.failNextDelivery, false)
  assert.equal(getWorkflow(initial).pendingActionCount, 1)
  assert.equal(previewAction(initial, { type: 'request_quality' }, 'lead').allowed, false)
  let state = await analyzedState()
  assert.equal(getWorkflow(state).stage, 'S1')
  assert.equal(state.workflow.analyses.length, 3)
  assert.equal(state.tasks.length, 0)
  const meetings = getDocuments(state).filter(d => d.id.startsWith('DOC-MEETING'))
  state = act(state, 'request_quality')
  assert.equal(getWorkflow(state).stage, 'S2')
  assert.equal(state.tasks[0].workStatus, 'pending')
  assert.equal(state.tasks[0].delivery.status, 'sent')
  state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
  assert.equal(state.tasks[0].workStatus, 'in_progress')
  state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: 'QA-B-001 核验样例通过' })
  assert.equal(getWorkflow(state).stage, 'S3')
  assert.equal(getWorkflow(state).pendingActionCount, 1, 'completed QA still leaves the human approval action')
  assert.equal(state.tasks[0].receipt.sourceId, 'QA-B-001')
  assert.ok(getDocuments(state).some(d => d.id === 'QA-B-001'))
  state = act(state, 'approve_switch')
  assert.equal(getWorkflow(state).stage, 'S4')
  assert.equal(getWorkflow(state).pendingActionCount, 2)
  assert.equal(state.decisions.find(d => d.id === 'DEC-02').status, 'fulfilled')
  assert.deepEqual(getDocuments(state).filter(d => d.id.startsWith('DOC-MEETING')), meetings)
  state = act(state, 'submit_receipt', 'procurement', { taskId: 'T-PUR', evidence: '采购安排已确认' })
  assert.equal(getWorkflow(state).stage, 'S5')
  assert.deepEqual(getWorkflow(state).missingReceipts, ['T-SALES'])
  assert.equal(getWorkflow(state).canClose, false)
  state = act(state, 'submit_receipt', 'sales', { taskId: 'T-SALES', evidence: '交期信息已同步' })
  assert.equal(getWorkflow(state).canClose, true)
  assert.equal(getWorkflow(state).pendingActionCount, 1, 'both receipts still require the final human review')
  assert.equal(state.tasks[1].workStatus, 'awaiting_review')
  state = act(state, 'close_matter')
  assert.equal(getWorkflow(state).stage, 'S6')
  assert.equal(getWorkflow(state).pendingActionCount, 0)
  assert.ok(state.tasks.every(t => t.workStatus === 'completed' && t.delivery.status === 'sent'))
})

test('quality rejection returns S1 without approval or departmental tasks, reopening keeps evidence', async () => {
  let state = act(await analyzedState(), 'request_quality')
  state = act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'rejected', evidence: '核验文件缺失' })
  assert.equal(getWorkflow(state).stage, 'S1')
  assert.equal(getWorkflow(state).pendingActionCount, 1)
  assert.throws(() => act(state, 'approve_switch'), { code: 'QUALITY_NOT_APPROVED' })
  assert.equal(state.tasks.length, 1)
  assert.equal(state.decisions.length, 2)
  state = act(state, 'request_quality')
  assert.equal(getWorkflow(state).stage, 'S2')
  assert.equal(state.tasks[0].history[0].receipt.evidence, '核验文件缺失')
  assert.equal(state.tasks[0].workStatus, 'pending')
})

test('failed delivery is pending work and retry changes delivery without completing or duplicating task', async () => {
  let state = act(await analyzedState(), 'arm_delivery_failure')
  state = act(state, 'request_quality')
  assert.equal(state.tasks[0].workStatus, 'pending')
  assert.deepEqual(state.tasks[0].delivery, { status: 'failed', attempts: 1, error: state.tasks[0].deliveryError })
  state = act(state, 'retry_delivery', 'lead', { taskId: 'T-QA' })
  assert.equal(state.tasks.length, 1)
  assert.equal(state.tasks[0].workStatus, 'pending')
  assert.deepEqual(state.tasks[0].delivery, { status: 'sent', attempts: 2 })
})

test('legacy state migration is immutable and idempotent, preserving tasks, decisions and original receipts', async () => {
  const empty = createState(); delete empty.workflow
  assert.equal(getWorkflow(migrateState(empty)).stage, 'S0')
  let progressed = act(await analyzedState(), 'request_quality')
  progressed = act(progressed, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '旧版质量凭据' })
  progressed = act(progressed, 'approve_switch')
  delete progressed.workflow
  progressed.decisions.find(d => d.id === 'DEC-02').status = 'conditional'
  for (const task of progressed.tasks) { delete task.workStatus; delete task.delivery }
  const before = structuredClone(progressed)
  const migrated = migrateState(progressed)
  assert.deepEqual(progressed, before)
  assert.equal(getWorkflow(migrated).stage, 'S4')
  assert.equal(migrated.workflow.analysisStep, 3)
  assert.equal(migrated.revision, progressed.revision)
  assert.equal(migrated.tasks[0].receipt.evidence, '旧版质量凭据')
  assert.deepEqual(migrateState(migrated), migrated)
})

async function apiHarness(t, provider = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'office-workflow-'))
  const dbPath = join(dir, 'office.sqlite')
  let server, base, cookie = ''
  const start = async () => { server = createOfficeServer({ dbPath, provider }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}/api/office` }
  const stop = async () => { await new Promise(resolve => server.close(resolve)); server = null }
  await start()
  t.after(async () => { if (server) await stop(); rmSync(dir, { recursive: true, force: true }) })
  const request = async (path, body, role) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(role ? { 'X-Demo-Role': role } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie
    return { status: response.status, body: await response.json() }
  }
  const action = async action => { const p = (await request('/preview', { action })).body.preview; return request('/confirm', { previewId: p.id, expectedVersion: p.revision, idempotencyKey: randomUUID() }) }
  return { request, action, start, stop, dbPath }
}

test('guided HTTP rejects skipped steps and stale versions, persists one result per idempotency key and survives restart', async t => {
  const api = await apiHarness(t)
  const initial = (await api.request('/snapshot')).body
  assert.equal(initial.role, 'lead')
  const request = { step: 'impact', mode: 'rules', expectedVersion: 1, idempotencyKey: randomUUID() }
  assert.equal((await api.request('/guided', { ...request, step: 'paths' })).status, 409)
  assert.equal((await api.request('/guided', { ...request, expectedVersion: 99 })).status, 409)
  assert.equal((await api.request('/guided', request, 'quality')).status, 403)
  const done = await api.request('/guided', request)
  assert.equal(done.body.workflow.analysisStep, 1)
  assert.equal(done.body.run.revision, 1)
  assert.equal(done.body.run.resultRevision, 2)
  assert.equal(done.body.run.step, 'impact')
  assert.equal(done.body.state.tasks.length, 0)
  assert.deepEqual((await api.request('/guided', request)).body, done.body)
  assert.equal((await api.request('/guided', { ...request, step: 'decisions' })).status, 409)
  assert.equal((await api.request('/runs')).body.runs.length, 1)
  await api.stop(); await api.start()
  assert.deepEqual((await api.request('/snapshot')).body.state, done.body.state)
  assert.equal((await api.request('/runs')).body.runs[0].step, 'impact', 'guided step survives record persistence and restart')
  const next = await api.request('/guided', { step: 'decisions', mode: 'rules', expectedVersion: 2, idempotencyKey: randomUUID() })
  assert.equal(next.body.workflow.analysisStep, 2)
  assert.equal(next.body.run.toolCalls[0].name, 'get_decisions')
  assert.ok(next.body.run.sources.some(s => s.id === 'DOC-MEETING-02'))
})

test('failed real model does not advance or silently use rules, explicit rules retry is recorded separately', async t => {
  const api = await apiHarness(t)
  await api.request('/snapshot')
  const failed = await api.request('/guided', { step: 'impact', mode: 'live', expectedVersion: 1, idempotencyKey: randomUUID() })
  assert.equal(failed.body.run.status, 'failed')
  assert.equal(failed.body.run.mode, 'live')
  assert.equal(failed.body.run.error.code, 'MODEL_KEY_MISSING')
  assert.equal(failed.body.state.revision, 1)
  assert.equal(failed.body.workflow.stage, 'S0')
  assert.equal(failed.body.state.events.length, 0)
  const rules = await api.request('/guided', { step: 'impact', mode: 'rules', expectedVersion: 1, idempotencyKey: randomUUID() })
  assert.equal(rules.body.run.status, 'completed')
  assert.match(rules.body.run.answer, /规则演示，未调用模型/)
  assert.equal((await api.request('/runs')).body.runs.length, 2)
})

test('a concurrent data change invalidates a grounded live analysis without advancing workflow', async t => {
  let release, reached
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { reached = resolve })
  let rounds = 0
  const model = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks))
    rounds++
    let message
    if (rounds === 1) {
      assert.equal(body.tool_choice.function.name, 'analyze_impact')
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'impact-1', type: 'function', function: { name: 'analyze_impact', arguments: '{}' } }] }
    } else {
      reached(); await gate
      message = { role: 'assistant', content: '关联两条订单，一条有到料风险。[DOC-LEDGER]' }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }))
  })
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => model.close(resolve)))
  const api = await apiHarness(t, { baseUrl: `http://127.0.0.1:${model.address().port}`, model: 'local-test', apiKey: 'local-fixture' })
  await api.request('/snapshot')
  const pending = api.request('/guided', { step: 'impact', mode: 'live', expectedVersion: 1, idempotencyKey: randomUUID() })
  await ready
  assert.equal((await api.action({ type: 'set_arrival', supplierId: 'A', day: 9 })).status, 200)
  release()
  const result = (await pending).body
  assert.equal(result.run.status, 'failed')
  assert.equal(result.run.error.code, 'STALE_VERSION')
  assert.equal(result.run.answer, '')
  assert.equal(result.run.revision, 1)
  assert.equal(result.state.revision, 2)
  assert.equal(result.workflow.stage, 'S0')
  assert.equal(result.state.events.some(e => e.type === 'analysis_impact'), false)
})

test('opening a legacy SQLite workspace persists additive migration and retains original workspace identity', async t => {
  const api = await apiHarness(t)
  await api.stop()
  const old = act(await analyzedState(), 'request_quality')
  delete old.workflow
  for (const task of old.tasks) { delete task.delivery; delete task.workStatus }
  const db = new DatabaseSync(api.dbPath)
  const token = 'a'.repeat(64)
  db.prepare('INSERT INTO spaces VALUES(?,?,?,?)').run('legacy-space', createHash('sha256').update(token).digest('hex'), JSON.stringify(old), JSON.stringify({ model: 'fixture', baseUrl: 'https://example.com', mode: 'rules' }))
  db.close()
  await api.start()
  // Inspect migration using the workspace cookie rather than altering the new workspace.
  const verify = createOfficeServer({ dbPath: api.dbPath })
  await new Promise(resolve => verify.listen(0, '127.0.0.1', resolve))
  try {
    const result = await (await fetch(`http://127.0.0.1:${verify.address().port}/api/office/snapshot`, { headers: { Cookie: `office_session=${token}` } })).json()
    assert.equal(result.workspaceId, 'legacy-space')
    assert.equal(result.workflow.stage, 'S2')
    assert.equal(result.state.revision, old.revision)
    assert.equal(result.state.tasks[0].delivery.status, 'sent')
    assert.equal(result.state.tasks[0].workStatus, 'pending')
    const stored = new DatabaseSync(api.dbPath)
    assert.equal(JSON.parse(stored.prepare('SELECT state FROM spaces WHERE id=?').get('legacy-space').state).workflow.analysisStep, 3)
    stored.close()
  } finally { await new Promise(resolve => verify.close(resolve)) }
})

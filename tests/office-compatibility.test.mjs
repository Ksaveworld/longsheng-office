import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createState, applyAction, analyze, getDocuments, migrateState } from '../server/office-domain.mjs'
import { projectOffice } from '../server/office-ontology.mjs'
import { createOfficeServer } from '../server/office-server.mjs'

const act = (state, type, role = 'lead', args = {}) => applyAction(state, { type, ...args }, role)
function qualityDone(result = 'approved') {
  let state = act(createState(), 'request_quality')
  state = act(state, 'start_task', 'quality', { taskId: 'T-QA' })
  return act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result, evidence: '质量凭据原文' })
}
function switched() { return act(qualityDone(), 'approve_switch') }
function receipt(state, taskId, role) {
  state = act(state, 'start_task', role, { taskId })
  return act(state, 'submit_receipt', role, { taskId, evidence: `${taskId} 回执原文` })
}

test('quality, procurement and sales must each start before submitting; delivered work is not completed', () => {
  let state = act(createState(), 'request_quality')
  assert.equal(state.tasks[0].delivery.status, 'sent')
  assert.equal(state.tasks[0].workStatus, 'pending')
  assert.throws(() => act(state, 'submit_quality', 'quality', { taskId: 'T-QA', result: 'approved', evidence: '凭据' }), { code: 'TASK_STATE_CONFLICT' })
  state = switched()
  for (const [taskId, role] of [['T-PUR', 'procurement'], ['T-SALES', 'sales']]) {
    assert.throws(() => act(state, 'submit_receipt', role, { taskId, evidence: '回执' }), { code: 'TASK_STATE_CONFLICT' })
    state = receipt(state, taskId, role)
    assert.equal(state.tasks.find(t => t.id === taskId).workStatus, 'awaiting_review')
  }
  const noEvidence = structuredClone(state); delete noEvidence.tasks[0].receipt
  assert.equal(analyze(noEvidence).canClose, false)
  assert.throws(() => act(noEvidence, 'close_matter'), { code: 'CLOSE_CONDITIONS_UNMET' })
})

test('initial facts require no model gate; pending actions and closure are computed from independent receipts', () => {
  const initial = createState()
  assert.equal(initial.workflow, undefined)
  assert.equal(initial.failNextDelivery, false)
  assert.equal(analyze(initial).linkedCount, 2)
  assert.equal(analyze(initial).riskCount, 1)
  assert.equal(analyze(initial).pendingActionCount, 1)
  let state = switched()
  assert.equal(analyze(state).pendingActionCount, 2)
  state = receipt(state, 'T-SALES', 'sales')
  assert.deepEqual(analyze(state).missingReceipts, ['T-PUR'])
  assert.equal(analyze(state).canClose, false)
  state = receipt(state, 'T-PUR', 'procurement')
  assert.equal(analyze(state).canClose, true)
  assert.equal(analyze(state).pendingActionCount, 1)
  state = act(state, 'close_matter')
  assert.equal(analyze(state).pendingActionCount, 0)
  assert.equal(analyze(state).canClose, false)
})

test('QA reopen archives prior timestamps and evidence; a failed new delivery has no stale current-round timestamps', () => {
  let state = qualityDone('rejected')
  const prior = structuredClone(state.tasks[0])
  state = act(state, 'arm_delivery_failure')
  state = act(state, 'request_quality')
  const task = state.tasks[0]
  assert.equal(state.tasks.length, 1)
  assert.equal(task.startedAt, undefined)
  assert.equal(task.deliveredAt, undefined)
  assert.equal(task.receipt, undefined)
  assert.equal(task.history[0].startedAt, prior.startedAt)
  assert.equal(task.history[0].deliveredAt, prior.deliveredAt)
  assert.deepEqual(task.history[0].receipt, prior.receipt)
  state = act(state, 'retry_delivery', 'quality', { taskId: 'T-QA' })
  assert.equal(state.tasks[0].id, task.id)
  assert.equal(state.tasks[0].attempts, 2)
  assert.equal(state.tasks[0].workStatus, 'pending')
})

test('V2 closed SQLite spaces and model history survive migration; cached confirmations rebuild consistent projections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-v2-compat-'))
  const dbPath = join(dir, 'office.sqlite')
  let server
  const start = async () => { server = createOfficeServer({ dbPath }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)) }
  const stop = async () => { await new Promise(resolve => server.close(resolve)); server = null }
  try {
    await start(); await stop()
    let state = switched()
    state = receipt(state, 'T-PUR', 'procurement')
    state = receipt(state, 'T-SALES', 'sales')
    state = act(state, 'close_matter')
    state.workflow = { analysisStep: 3, analyses: [{ step: 'impact', runId: 'old-run', inputRevision: 1 }] }
    state.events.unshift({ id: 'old-analysis-event', type: 'analysis_impact', actor: 'lead', at: '2026-09-09T00:00:00Z', message: '旧版分析记录' })
    state.decisions.find(d => d.id === 'DEC-02').status = 'conditional'
    const before = structuredClone(state)
    const token = 'a'.repeat(64)
    const hash = value => createHash('sha256').update(value).digest('hex')
    const db = new DatabaseSync(dbPath)
    db.prepare('INSERT INTO spaces VALUES(?,?,?,?)').run('v2-space', hash(token), JSON.stringify(state), JSON.stringify({ baseUrl: 'https://example.com', model: 'fixture', mode: 'rules' }))
    const oldRun = { id: 'old-run', revision: 1, mode: 'live', status: 'completed', answer: '旧模型原始回答', step: 'impact' }
    db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(oldRun.id, 'v2-space', 'run', JSON.stringify(oldRun), '2026-09-09T00:00:00Z')
    const oldResponse = { state, workspaceId: 'v2-space', role: 'lead', graph: projectOffice(state), workflow: { stage: 'S6' } }
    const body = { previewId: 'old-preview', expectedVersion: state.revision - 1, idempotencyKey: 'old-confirm-key' }
    const requestHash = hash(JSON.stringify({ role: 'lead', previewId: body.previewId, expectedVersion: body.expectedVersion }))
    db.prepare('INSERT INTO idempotency VALUES(?,?,?,?)').run('v2-space', body.idempotencyKey, requestHash, JSON.stringify(oldResponse))
    db.close()
    await start()
    const base = `http://127.0.0.1:${server.address().port}/api/office`
    const request = async (path, body) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: `office_session=${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      assert.equal(response.status, 200)
      return response.json()
    }
    const snapshot = await request('/snapshot')
    assert.equal(snapshot.workflow, undefined, 'no stage-based interface is restored')
    assert.equal(snapshot.state.matter.status, 'closed')
    assert.equal(snapshot.state.revision, before.revision)
    assert.deepEqual(snapshot.state.workflow, before.workflow)
    assert.deepEqual(snapshot.state.tasks, before.tasks)
    assert.deepEqual(snapshot.state.events, before.events)
    assert.deepEqual((await request('/runs')).runs, [oldRun])
    assert.deepEqual(getDocuments(snapshot.state).filter(d => d.id.startsWith('DOC-MEETING')), getDocuments(before).filter(d => d.id.startsWith('DOC-MEETING')))
    const replay = await request('/confirm', body)
    assert.equal(replay.state.decisions.find(d => d.id === 'DEC-02').status, 'fulfilled')
    assert.equal(replay.graph.objects.find(o => o.id === 'Decision:DEC-02').properties.status, 'fulfilled')
    assert.equal(replay.graph.revision, replay.state.revision)
    assert.equal(replay.analysis.pendingActionCount, 0)
    assert.equal(replay.workflow, undefined)
    assert.deepEqual(migrateState(migrateState(before)), migrateState(before))
  } finally { if (server) await stop(); rmSync(dir, { recursive: true, force: true }) }
})

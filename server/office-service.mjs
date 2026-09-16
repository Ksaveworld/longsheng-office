import { randomUUID } from 'node:crypto'
import { digest, fault } from './office-store.mjs'
import { analyze, applyAction, getDocuments, migrateState, previewAction } from './office-domain.mjs'
import { projectOffice, queryOfficeObjects, queryOfficeRelations } from './office-ontology.mjs'
import { runOfficeChat } from './office-model.mjs'
import { presentMatter } from './office-presentation.mjs'
import { buildOrderChains, queryOrderChain } from './office-order-chain.mjs'
import { querySupplyOrders } from './office-supply-query.mjs'

import { eventRoles } from './office-events.mjs'
const roles = [{ id: 'procurement', label: '采购经办' }, { id: 'quality', label: '质量负责人' }, { id: 'sales', label: '销售经办' }, { id: 'lead', label: '业务负责人' }]
roles.push(...['production','maintenance'].map(id => ({id,label:eventRoles[id]})))
const debugActions = new Set(['reset', 'set_arrival', 'arm_delivery_failure'])
const now = () => new Date().toISOString()
const day = () => now().slice(0, 10)
const publicRequest = r => r && Object.fromEntries(['id','conversationId','matterId','role','status','question','startedAt','finishedAt','runId','error'].map(k => [k, r[k]]))
const publicRun = run => run && { ...run, toolCalls: [] }
function stateOf(ws, id) { const state = ws.matters[id]; if (!state) fault(404, 'MATTER_NOT_FOUND', '事项不存在。'); return state }
function snapshot(ws, id, role, workspaceId, aggregate = true) {
  const state = stateOf(ws, id)
  const graph = projectOffice(state, workspaceId)
  const result = { state: { ...state, documents: getDocuments(state) }, analysis: analyze(state), presentation: presentMatter(state,role), graph, orderChains: buildOrderChains(graph), role, roles, workspaceId }
  if (aggregate) result.matters = Object.keys(ws.matters).map(key => snapshot(ws, key, role, workspaceId, false))
  return result
}
function conversationOf(ws, id, matterId, role) {
  const conv = ws.conversations.find(c => c.id === id)
  if (!conv || conv.matterId !== matterId || conv.role !== role) fault(404, 'CONVERSATION_NOT_FOUND', '会话不存在或不属于当前事项及岗位。')
  return conv
}
function newConversation(ws, matterId, role, title = '新会话') {
  const conv = { id: randomUUID(), matterId, role, title, createdAt: now(), updatedAt: now(), messageIds: [] }
  ws.conversations.push(conv); return conv
}
function requestOf(ws, id, matterId, role) {
  const r = ws.requests[id]
  if (!r || r.matterId !== matterId || r.role !== role) fault(404, 'REQUEST_NOT_FOUND', '查询记录不存在。')
  return r
}
function appendRun(ws, request, run) {
  run.id ||= randomUUID()
  Object.assign(run, { conversationId: request.conversationId, requestId: request.id, matterId: request.matterId })
  ws.runs.push(run)
  const conv = ws.conversations.find(c => c.id === request.conversationId)
  conv.messageIds.push(run.id); conv.updatedAt = now()
  Object.assign(request, { runId: run.id, finishedAt: now(), status: run.status === 'completed' ? 'completed' : 'failed' })
  delete request.input
  return run
}
function failRun(ws, request, code, message) {
  if (request.status !== 'running') return
  appendRun(ws, request, { id: randomUUID(), question: request.question, mode: request.mode, role: request.role, variant: 'ontology', status: 'failed', answer: '', sources: [], toolCalls: [], revision: request.revision, facts: request.input?.facts, error: { code, message }, createdAt: request.startedAt, latencyMs: Date.now() - Date.parse(request.startedAt) })
}
function expire(ws) {
  for (const r of Object.values(ws.requests)) if (r.status === 'running' && r.leaseUntil < Date.now()) failRun(ws, r, 'MODEL_TIMEOUT', '上次查询超时或被中断，请重试。业务数据未修改。')
}

export function createOfficeService({ store, provider = {}, defaultMode = 'live', publicDemo = false, chatRunner = runOfficeChat, modelTimeoutMs = 40000, requestLeaseMs = 55000, workspaceDailyLimit = 40, siteDailyLimit = 200, siteConcurrency = 4 } = {}) {
  const controllers = new Map()
  async function transact(token, fn) { return store.transact(token, (ws, id) => { expire(ws); return fn(ws, id) }) }
  async function reserve(token, id) {
    const key = `${digest(token)}:${id}`
    await store.quota(q => {
      for (const [k, lease] of Object.entries(q.leases)) if (lease < Date.now()) delete q.leases[k]
      if (q.leases[key]) return
      if(Object.keys(q.leases).some(k=>k.startsWith(digest(token)+':')))fault(409,'MODEL_BUSY','上一次查询正在结束，请稍后再试。')
      if (q.day !== day()) { q.day = day(); q.count = 0 }
      if (q.count >= siteDailyLimit) fault(429, 'MODEL_DAILY_LIMIT', '今日演示查询额度已用完，请明天再试。')
      if (Object.keys(q.leases).length >= siteConcurrency) fault(429, 'MODEL_CAPACITY', '当前模型调用较多，请稍后重试。')
      q.leases[key] = Date.now() + requestLeaseMs; q.count++
    })
    return key
  }
  async function release(key) { if (key) await store.quota(q => { delete q.leases[key] }) }
  async function chat(token, body, matterId, role) {
    if(body.queryType==='briefing' && body.feedback) fault(422,'QUERY_TYPE_INVALID','综合简报不调整方案，请单独提交调整意见。')
    if(body.queryType !== undefined && body.queryType !== 'briefing') fault(422,'QUERY_TYPE_INVALID','不支持的查询类型。')
    if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) fault(422, 'INVALID_QUESTION', '请填写 1 至 4000 字的问题。')
    const requestId = body.requestId || randomUUID()
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 160) fault(422, 'INVALID_REQUEST', '查询编号不正确。')
    const mode = publicDemo ? defaultMode : body.mode || defaultMode
    if (!['rules', 'live'].includes(mode)) fault(422, 'INVALID_MODE', '模型运行模式不正确。')
    const fingerprint = digest(JSON.stringify({ question: body.question.trim(), matterId, role, conversationId: body.conversationId, feedback: body.feedback, parentVersionId: body.parentVersionId, mode, ...(body.queryType ? {queryType:body.queryType} : {}) }))
    const registered = await transact(token, ws => {
      const prior = ws.requests[requestId]
      if (prior) {
        if(prior.status==='cancelled'&&!prior.fingerprint&&prior.matterId===matterId&&prior.role===role&&prior.conversationId===body.conversationId)return {prior:publicRequest(prior)}
        if (prior.fingerprint !== fingerprint) fault(409, 'IDEMPOTENCY_CONFLICT', '此查询编号已用于其他问题。')
        return { prior: publicRequest(prior), run: ws.runs.find(r => r.id === prior.runId) }
      }
      if (Object.values(ws.requests).some(r => r.status === 'running')) fault(409, 'MODEL_BUSY', '当前空间还有查询正在进行，请等待或停止后重试。')
      const state = stateOf(ws, matterId)
      const conv = body.conversationId ? conversationOf(ws, body.conversationId, matterId, role) : newConversation(ws, matterId, role)
      if (body.parentVersionId && !state.planVersions?.some(p => p.id === body.parentVersionId)) fault(422, 'PLAN_NOT_FOUND', '原方案版本不存在，请刷新后重新选择。')
      const quota = ws.modelQuota?.day === day() ? ws.modelQuota : { day: day(), count: 0 }
      if (mode === 'live' && quota.count >= workspaceDailyLimit) fault(429, 'WORKSPACE_DAILY_LIMIT', '当前演示空间今日查询额度已用完。')
      if (mode === 'live') quota.count++
      ws.modelQuota = quota
      if (!conv.messageIds.length) conv.title = body.question.trim().slice(0, 36)
      conv.updatedAt = now()
      const history = conv.messageIds.map(id => ws.runs.find(r => r.id === id)).filter(r => r?.status === 'completed').slice(-8)
      const conversationMessages = history.flatMap(r => [{ role: 'user', content: r.question }, { role: 'assistant', content: r.answer }])
      const input = { state: structuredClone(state), conversationMessages, feedback: typeof body.feedback === 'string' ? body.feedback.slice(0, 2000) : '', parentVersionId: body.parentVersionId, queryType:body.queryType }
      const request = { id: requestId, conversationId: conv.id, matterId, role, status: 'running', question: body.question.trim(), mode, revision: state.revision, startedAt: now(), leaseUntil: Date.now() + requestLeaseMs, fingerprint, input: { facts: { state: structuredClone(state), analysis: analyze(state) } } }
      ws.requests[requestId] = request
      return { request, input }
    })
    if (registered.prior) return { status: registered.run ? 200 : 202, body: registered.run ? { run: publicDemo ? publicRun(registered.run) : registered.run } : { request: registered.prior } }
    const r = registered.request
    const controller = new AbortController()
    controllers.set(`${digest(token)}:${requestId}`, controller)
    let quotaKey
    try {
      if (mode === 'live') quotaKey = await reserve(token, requestId)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(modelTimeoutMs)])
      let run
      try {
        run = await chatRunner({ ...registered.input, question: r.question, role, provider, mode, variant: 'ontology', signal })
      } catch {
        run = { id: randomUUID(), status: 'failed', question: r.question, answer: '', sources: [], toolCalls: [], mode, role, variant: 'ontology', revision: r.revision, createdAt: now(), error: { code: signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_CONNECTION_FAILED', message: '本次查询未完成，请重试。业务数据未修改。' } }
      }
      const saved = await transact(token, ws => {
        const current = requestOf(ws, requestId, matterId, role)
        if (current.status !== 'running') return { request: publicRequest(current), run: ws.runs.find(r => r.id === current.runId) }
        const state = stateOf(ws, matterId)
        if (run.status === 'completed') {
          state.firstAnalyzedAt ||= now()
          if (run.planVersions?.length) {
            state.planVersions ||= []
            for (const p of run.planVersions) if (!state.planVersions.some(v => v.id === p.id)) state.planVersions.push({ ...p, matterId, revision: r.revision })
          }
        }
        appendRun(ws, current, run)
        return { request: publicRequest(current), run }
      })
      return { status: saved.run ? 200 : 202, body: { ...saved, ...(saved.run && publicDemo ? { run: publicRun(saved.run) } : {}) } }
    } catch (error) {
      await transact(token, ws => { const current = ws.requests[requestId]; failRun(ws, current, error.code || 'MODEL_FAILED', error.status ? error.message : '查询未完成，请稍后重试。') })
      throw error
    } finally {
      controllers.delete(`${digest(token)}:${requestId}`)
      try { await release(quotaKey) } catch { /* Lease expires automatically; never repeat a paid model call. */ }
    }
  }
  return {
    async handle({ token, method, path, query = {}, body = {}, role = 'lead' }) {
      if (!roles.some(r => r.id === role)) fault(403, 'INVALID_ROLE', '未知演示岗位。')
      const matterId = body.matterId || query.matterId || 'SUP-001'
      if (typeof matterId !== 'string' || !/^SUP-\d{3}$/.test(matterId)) fault(422, 'INVALID_MATTER', '事项编号不正确。')
      if (body.matterId && query.matterId && body.matterId !== query.matterId) fault(422, 'MATTER_CONFLICT', '事项编号不一致。')
      if (method === 'POST' && path === '/chat') return chat(token, body, matterId, role)
      const value = await transact(token, (ws, workspaceId) => {
        const state = stateOf(ws, matterId)
        if (method === 'GET' && path === '/snapshot' || method === 'POST' && path === '/session') return snapshot(ws, matterId, role, workspaceId)
        if (method === 'GET' && path === '/matters') return { matters: Object.keys(ws.matters).map(id => snapshot(ws, id, role, workspaceId, false)) }
        if (method === 'GET' && path === '/graph') return projectOffice(state, workspaceId)
        if (method === 'GET' && path === '/objects') return queryOfficeObjects(state, query)
        if (method === 'GET' && path === '/order-chain') return queryOrderChain(state, query)
        if (method === 'GET' && path === '/supply-orders') {
          const { matterId: ignored, ...filters } = query
          if (filters.atRisk === 'true') filters.atRisk = true
          if (filters.atRisk === 'false') filters.atRisk = false
          for (const key of ['minLateDays', 'maxRequiredDay']) if (/^\d+$/.test(filters[key] ?? '')) filters[key] = Number(filters[key])
          return querySupplyOrders(state, filters)
        }
        if (method === 'GET' && path === '/relations') return queryOfficeRelations(state, { ...query, depth: query.depth === undefined ? 1 : Number(query.depth) })
        if (method === 'GET' && path === '/documents') return { documents: getDocuments(state) }
        if (method === 'GET' && path === '/model') return { mode: defaultMode, keyConfigured: Boolean(provider.apiKey), maxRounds: 4 }
        if (method === 'GET' && path === '/runs') return { runs: ws.runs.filter(r => r.matterId === matterId && r.role === role).slice().reverse().map(r => publicDemo ? publicRun(r) : r), comparisons: [] }
        if (path === '/conversations') {
          if (method === 'GET') return { conversations: ws.conversations.filter(c => c.matterId === matterId && c.role === role).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) }
          if (method === 'POST') return { conversation: newConversation(ws, matterId, role) }
        }
        if (method === 'GET' && path.startsWith('/conversations/')) {
          const conv = conversationOf(ws, path.split('/')[2], matterId, role)
          return { conversation: conv, runs: conv.messageIds.map(id => ws.runs.find(r => r.id === id)).filter(Boolean).map(r => publicDemo ? publicRun(r) : r), requests: Object.values(ws.requests).filter(r => r.conversationId === conv.id && r.status === 'running').map(publicRequest) }
        }
        if (path.startsWith('/requests/')) {
          const requestId=path.split('/')[2]
          if(method==='POST'&&path.endsWith('/cancel')&&!ws.requests[requestId]){
            if(typeof requestId!=='string'||requestId.length<8||requestId.length>160)fault(422,'INVALID_REQUEST','查询编号不正确。')
            const conv=conversationOf(ws,body.conversationId,matterId,role)
            ws.requests[requestId]={id:requestId,conversationId:conv.id,matterId,role,status:'cancelled',question:typeof body.question==='string'?body.question.slice(0,4000):'',startedAt:now(),finishedAt:now()}
          }
          const r = requestOf(ws, requestId, matterId, role)
          if (method === 'POST' && path.endsWith('/cancel')) {
            if (r.status === 'running') { r.status = 'cancelled'; r.finishedAt = now(); delete r.input }
          } else if (method !== 'GET') fault(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。')
          const run = ws.runs.find(run => run.id === r.runId)
          return { request: publicRequest(r), ...(run ? { run: publicDemo ? publicRun(run) : run } : {}) }
        }
        if (method === 'POST' && path === '/preview') {
          if (!body.action || typeof body.action.type !== 'string') fault(422, 'INVALID_ACTION', '请选择操作。')
          if (publicDemo && debugActions.has(body.action.type)) fault(403, 'PUBLIC_ACTION_DENIED', '此操作仅供内部测试。')
          if (body.expectedVersion !== undefined && !Number.isInteger(body.expectedVersion)) fault(422, 'INVALID_VERSION', '请提供有效的数据版本。')
          if (body.expectedVersion !== undefined && body.expectedVersion !== state.revision) fault(409, 'STALE_VERSION', '事项已更新，请重新核对后操作。')
          const planVersionId = body.action.planVersionId || body.planVersionId || (body.action.type==='select_plan'?`${matterId}-${body.action.supplierId}-v1`:state.matter.planSelection?.planVersionId)
          if (planVersionId && !state.planVersions?.some(p => p.id === planVersionId)) fault(422, 'PLAN_NOT_FOUND', '方案不属于当前事项。')
          const action = { ...body.action, ...(body.action.type === 'select_plan' && planVersionId ? { planVersionId } : {}) }
          const preview = { ...previewAction(state, action, role), id: randomUUID(), role, matterId, planVersionId }
          ws.previews[preview.id] = { ...preview, expires: Date.now() + 600000, used: false }
          for (const [key, p] of Object.entries(ws.previews)) if (p.expires < Date.now()) delete ws.previews[key]
          return { preview }
        }
        if (method === 'POST' && path === '/confirm') {
          const { previewId, expectedVersion, idempotencyKey } = body
          if (typeof previewId !== 'string' || !Number.isInteger(expectedVersion) || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 160) fault(422, 'INVALID_CONFIRM', '缺少有效确认编号或数据版本。')
          const fingerprint = digest(JSON.stringify({ matterId, role, previewId, expectedVersion, planVersionId: body.planVersionId }))
          const prior = ws.idempotency[idempotencyKey]
          if (prior) { if (prior.fingerprint !== fingerprint) fault(409, 'IDEMPOTENCY_CONFLICT', '此确认编号已用于其他操作。'); return snapshot({matters:{[matterId]:prior.state}},matterId,role,workspaceId,false) }
          const p = ws.previews[previewId]
          if (!p || p.expires < Date.now()) fault(409, 'PREVIEW_EXPIRED', '操作预览已过期，请重新预览。')
          if (p.matterId !== matterId) fault(403, 'MATTER_MISMATCH', '预览不属于当前事项。')
          if (p.role !== role) fault(403, 'ROLE_CHANGED', '岗位已变更，请以当前岗位重新预览。')
          if (p.used) fault(409, 'PREVIEW_USED', '该预览已确认，请刷新查看结果。')
          if (expectedVersion !== state.revision || p.revision !== state.revision) fault(409, 'STALE_VERSION', '事项已更新，请重新核对后操作。')
          if (body.planVersionId && body.planVersionId !== p.planVersionId) fault(409, 'PLAN_CHANGED', '方案版本已变更，请重新预览。')
          if (publicDemo && debugActions.has(p.action.type)) fault(403, 'PUBLIC_ACTION_DENIED', '此操作仅供内部测试。')
          const next = applyAction(state, p.action, role)
          ws.matters[matterId] = next; p.used = true
          if (p.action.type === 'reset') { ws.previews = {}; ws.idempotency = {} }
          const response = snapshot(ws, matterId, role, workspaceId, false)
          ws.idempotency[idempotencyKey] = { fingerprint, state:next }
          return response
        }
        if (path.startsWith('/model') || path === '/compare') fault(403, 'INTERNAL_ONLY', '模型配置及对比仅通过内部环境维护。')
        fault(404, 'NOT_FOUND', '接口不存在。')
      })
      if(method==='POST'&&path.endsWith('/cancel')&&value.request?.status==='cancelled')controllers.get(`${digest(token)}:${value.request.id}`)?.abort()
      return { status: 200, body: value }
    },
  }
}

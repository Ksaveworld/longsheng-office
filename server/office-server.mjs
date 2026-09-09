import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createState, analyze, getDocuments, previewAction, applyAction, migrateState, getWorkflow, completeGuidedAnalysis } from './office-domain.mjs'
import { runOfficeChat, testProvider } from './office-model.mjs'
import { projectOffice, queryOfficeObjects, queryOfficeRelations } from './office-ontology.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roles = [{ id: 'procurement', label: '采购经办' }, { id: 'quality', label: '质量负责人' }, { id: 'sales', label: '销售经办' }, { id: 'lead', label: '业务负责人' }]
const hash = value => createHash('sha256').update(value).digest('hex')
function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }) }
function questionFrom(body) {
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000) fail(422, 'INVALID_QUESTION', '请填写 1 至 4000 字的问题。')
  return body.question.trim()
}
function validateBase(value) {
  let url
  try { url = new URL(value) } catch { fail(422, 'INVALID_PROVIDER', '模型地址格式不正确。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(422, 'INVALID_PROVIDER', '模型地址须使用 HTTPS，且不能包含账号或查询参数。')
  return url.toString().replace(/\/$/, '')
}

export function createOfficeServer({ dbPath = resolve(root, '.office-data/office.sqlite'), provider = {}, distPath = resolve(root, 'dist'), publicOrigin = '', basePath = '/', accessCode = '' } = {}) {
  const origin = publicOrigin ? new URL(publicOrigin) : null
  if (origin && (origin.protocol !== 'https:' || !accessCode)) throw new Error('Public deployment requires HTTPS and an access code.')
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('Invalid deployment base path.')
  mkdirSync(dirname(dbPath), { recursive: true })
  const keyPath = resolve(dirname(dbPath), 'config.key')
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 })
  const master = readFileSync(keyPath)
  const seal = value => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', master, iv); const body = Buffer.concat([c.update(value, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64') }
  const unseal = value => { const bytes = Buffer.from(value, 'base64'); const c = createDecipheriv('aes-256-gcm', master, bytes.subarray(0, 12)); c.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([c.update(bytes.subarray(28)), c.final()]).toString('utf8') }
  const defaults = { baseUrl: provider.baseUrl || 'https://api.deepseek.com', model: provider.model || 'deepseek-v4-flash', apiKey: provider.apiKey || '' }
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, state TEXT NOT NULL, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY, space TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS idempotency(space TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(space,key));
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, space TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL);`)
  const busy = new Set()
  const loginAttempts = new Map()
  const getSpace = id => {
    const row = db.prepare('SELECT * FROM spaces WHERE id=?').get(id)
    const state = migrateState(JSON.parse(row.state))
    const serialized = JSON.stringify(state)
    if (serialized !== row.state) db.prepare('UPDATE spaces SET state=? WHERE id=?').run(serialized, id)
    return { ...row, state, settings: JSON.parse(row.settings) }
  }
  const saveSettings = (id, settings) => db.prepare('UPDATE spaces SET settings=? WHERE id=?').run(JSON.stringify(settings), id)
  const activeProvider = settings => ({ baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.encryptedKey ? unseal(settings.encryptedKey) : settings.baseUrl === defaults.baseUrl && !settings.keyRemoved ? defaults.apiKey : '' })
  const safeSettings = settings => ({ baseUrl: settings.baseUrl, model: settings.model, mode: settings.mode, keyConfigured: Boolean(activeProvider(settings).apiKey), connection: settings.connection, maxRounds: 4 })
  const snapshot = (space, role) => ({ state: { ...space.state, documents: getDocuments(space.state) }, analysis: analyze(space.state), workflow: getWorkflow(space.state), graph: projectOffice(space.state, space.id), role, roles, workspaceId: space.id })
  const record = (space, kind, value) => db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(value.id, space, kind, JSON.stringify(value), value.createdAt || new Date().toISOString())
  const safeResult = (value, secret) => secret ? JSON.parse(JSON.stringify(value).split(secret).join('[已隐藏凭据]')) : value
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)) }
  async function readBody(req) {
    let length = 0; const chunks = []
    for await (const chunk of req) { length += chunk.length; if (length > 262144) fail(413, 'BODY_TOO_LARGE', '请求内容过大。'); chunks.push(chunk) }
    if (!length) return {}
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail(400, 'INVALID_JSON', '请求格式不正确。') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_JSON', '请求须为对象。')
    return body
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || ''
      const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
      if (!localHost && host !== origin?.host) fail(403, 'HOST_DENIED', '不允许此访问地址。')
      const expectedOrigin = host === origin?.host ? origin.origin : `http://${host}`
      if (req.headers.origin && req.headers.origin !== expectedOrigin) fail(403, 'ORIGIN_DENIED', '不允许跨站请求。')
      const path = new URL(req.url, `http://${host}`).pathname
      if (path === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true, service: 'longsheng-office', database: db.prepare('SELECT 1 AS ok').get().ok === 1 })
      if (!path.startsWith('/api/office/')) {
        if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。')
        const relative = decodeURIComponent(path)
        let file = resolve(distPath, `.${relative}`)
        if (!file.startsWith(resolve(distPath) + sep)) file = resolve(distPath, 'index.html')
        if (!existsSync(file) || !statSync(file).isFile()) {
          if (extname(relative)) fail(404, 'NOT_FOUND', '文件不存在。')
          file = resolve(distPath, 'index.html')
        }
        if (!existsSync(file)) fail(503, 'BUILD_REQUIRED', '请先构建演示页面。')
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' })
        return res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
      }
      const role = req.headers['x-demo-role'] || 'lead'
      if (!roles.some(item => item.id === role)) fail(403, 'INVALID_ROLE', '未知演示角色。')
      const body = req.method === 'POST' ? await readBody(req) : {}
      const route = `${req.method} ${path.slice('/api/office'.length)}`
      const token = /(?:^|;\s*)office_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
      let row = token && db.prepare('SELECT id FROM spaces WHERE token_hash=?').get(hash(token))
      if (route === 'POST /session' && accessCode) {
        const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress)
        const now = Date.now()
        for (const [key, value] of loginAttempts) if (value.until < now) loginAttempts.delete(key)
        const attempts = loginAttempts.get(ip) || { count: 0, until: now + 60000 }
        if (attempts.count >= 10) fail(429, 'LOGIN_LIMIT', '尝试次数过多，请一分钟后重试。')
        if (typeof body.accessCode !== 'string' || !timingSafeEqual(Buffer.from(hash(body.accessCode)), Buffer.from(hash(accessCode)))) {
          attempts.count++; loginAttempts.set(ip, attempts)
          fail(401, 'ACCESS_INVALID', '访问码不正确。')
        }
        loginAttempts.delete(ip)
      } else if (!row && accessCode) fail(401, 'ACCESS_REQUIRED', '请输入演示访问码。')
      if (!row) {
        const nextToken = randomBytes(32).toString('hex'); const id = randomUUID()
        db.prepare('INSERT INTO spaces VALUES(?,?,?,?)').run(id, hash(nextToken), JSON.stringify(createState()), JSON.stringify({ baseUrl: defaults.baseUrl, model: defaults.model, mode: 'live' }))
        row = { id }; res.setHeader('Set-Cookie', `office_session=${nextToken}; HttpOnly; SameSite=Strict; Path=${basePath}; Max-Age=2592000${origin ? '; Secure' : ''}`)
      }
      const space = getSpace(row.id)
      if (route === 'POST /session') return json(res, 200, snapshot(space, role))
      if (route === 'GET /snapshot') return json(res, 200, snapshot(space, role))
      if (route === 'GET /graph') return json(res, 200, projectOffice(space.state, space.id))
      if (route === 'GET /objects') return json(res, 200, queryOfficeObjects(space.state, Object.fromEntries(new URL(req.url, `http://${host}`).searchParams)))
      if (route === 'GET /relations') {
        const args = Object.fromEntries(new URL(req.url, `http://${host}`).searchParams)
        return json(res, 200, queryOfficeRelations(space.state, { ...args, depth: args.depth === undefined ? 1 : Number(args.depth) }))
      }
      if (route === 'GET /documents') return json(res, 200, { documents: getDocuments(space.state) })
      if (route === 'GET /model') return json(res, 200, safeSettings(space.settings))
      if (route === 'GET /runs') {
        const rows = db.prepare('SELECT kind,body FROM records WHERE space=? ORDER BY created DESC LIMIT 200').all(space.id)
        return json(res, 200, { runs: rows.filter(x => x.kind === 'run').map(x => JSON.parse(x.body)), comparisons: rows.filter(x => x.kind === 'comparison').map(x => JSON.parse(x.body)) })
      }
      if (route === 'POST /preview') {
        if (!body.action || typeof body.action.type !== 'string') fail(422, 'INVALID_ACTION', '请选择操作。')
        const preview = { ...previewAction(space.state, body.action, role), id: randomUUID(), role }
        db.prepare('DELETE FROM previews WHERE expires<?').run(Date.now())
        db.prepare('INSERT INTO previews(id,space,body,expires) VALUES(?,?,?,?)').run(preview.id, space.id, JSON.stringify(preview), Date.now() + 600000)
        return json(res, 200, { preview })
      }
      if (route === 'POST /confirm') {
        if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 160 || typeof body.previewId !== 'string' || !Number.isInteger(body.expectedVersion)) fail(422, 'INVALID_CONFIRM', '缺少有效的确认编号或数据版本。')
        const requestHash = hash(JSON.stringify({ role, previewId: body.previewId, expectedVersion: body.expectedVersion }))
        db.exec('BEGIN IMMEDIATE')
        try {
          const prior = db.prepare('SELECT * FROM idempotency WHERE space=? AND key=?').get(space.id, body.idempotencyKey)
          if (prior) {
            if (prior.hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '此确认编号已用于其他操作。')
            const savedResponse = JSON.parse(prior.response)
            savedResponse.state = migrateState(savedResponse.state)
            savedResponse.workflow ??= getWorkflow(savedResponse.state)
            savedResponse.graph ??= projectOffice(savedResponse.state, savedResponse.workspaceId)
            db.exec('COMMIT'); return json(res, 200, savedResponse)
          }
          const saved = db.prepare('SELECT * FROM previews WHERE id=? AND space=?').get(body.previewId, space.id)
          if (!saved || saved.expires < Date.now()) fail(409, 'PREVIEW_EXPIRED', '操作预览已过期，请重新预览。')
          if (saved.used) fail(409, 'PREVIEW_USED', '该预览已确认，请刷新查看结果。')
          const preview = JSON.parse(saved.body)
          if (preview.role !== role) fail(403, 'ROLE_CHANGED', '角色已变更，请以当前角色重新预览。')
          const current = getSpace(space.id)
          if (body.expectedVersion !== current.state.revision || preview.revision !== current.state.revision) fail(409, 'STALE_VERSION', '数据已更新，请刷新后重新确认。')
          const state = applyAction(current.state, preview.action, role)
          db.prepare('UPDATE spaces SET state=? WHERE id=?').run(JSON.stringify(state), space.id)
          if (preview.action.type === 'reset') {
            db.prepare('DELETE FROM previews WHERE space=?').run(space.id)
            db.prepare('DELETE FROM idempotency WHERE space=?').run(space.id)
          } else db.prepare('UPDATE previews SET used=1 WHERE id=?').run(preview.id)
          const response = snapshot({ ...current, state }, role)
          db.prepare('INSERT INTO idempotency VALUES(?,?,?,?)').run(space.id, body.idempotencyKey, requestHash, JSON.stringify(response))
          db.exec('COMMIT'); return json(res, 200, response)
        } catch (error) { db.exec('ROLLBACK'); throw error }
      }
      if (route === 'POST /model') {
        if (role !== 'lead') fail(403, 'FORBIDDEN', '仅业务负责人可调整模型连接。')
        if (busy.has(space.id)) fail(409, 'MODEL_BUSY', '模型正在运行，请结束后再调整连接。')
        const settings = { ...space.settings }
        if (body.baseUrl !== undefined) {
          if (typeof body.baseUrl !== 'string') fail(422, 'INVALID_PROVIDER', '请填写模型地址。')
          const next = validateBase(body.baseUrl)
          if (next !== settings.baseUrl) { delete settings.encryptedKey; settings.keyRemoved = true }
          settings.baseUrl = next
        }
        if (body.model !== undefined) {
          if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 160) fail(422, 'INVALID_MODEL', '请填写有效模型名称。')
          settings.model = body.model.trim()
        }
        if (body.mode !== undefined) {
          if (!['live', 'rules'].includes(body.mode)) fail(422, 'INVALID_MODE', '请选择真实模型或规则模式。')
          settings.mode = body.mode
        }
        if (body.apiKey !== undefined && body.apiKey !== '') {
          if (typeof body.apiKey !== 'string' || body.apiKey.length > 8192) fail(422, 'INVALID_KEY', '密钥格式不正确。')
          settings.encryptedKey = seal(body.apiKey.trim()); settings.keyRemoved = false
        }
        delete settings.connection
        saveSettings(space.id, settings)
        return json(res, 200, safeSettings(settings))
      }
      if (route === 'POST /guided') {
        if (!['lead', 'procurement'].includes(role)) fail(403, 'FORBIDDEN', '请由业务负责人或采购经办进行影响研判。')
        const stepNumber = { impact: 1, decisions: 2, paths: 3 }[body.step]
        if (!stepNumber || !['live', 'rules'].includes(body.mode) || !Number.isInteger(body.expectedVersion) || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 160) fail(422, 'INVALID_GUIDED', '缺少有效的分析步骤、运行方式、版本或请求编号。')
        const requestHash = hash(JSON.stringify({ route: 'guided', role, step: body.step, mode: body.mode, expectedVersion: body.expectedVersion }))
        const prior = db.prepare('SELECT * FROM idempotency WHERE space=? AND key=?').get(space.id, body.idempotencyKey)
        if (prior) {
          if (prior.hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求编号已用于其他操作。')
          return json(res, 200, JSON.parse(prior.response))
        }
        if (body.expectedVersion !== space.state.revision) fail(409, 'STALE_VERSION', '当前数据版本已更新，请重新分析后再确认。')
        if (getWorkflow(space.state).analysisStep + 1 !== stepNumber || space.state.matter.status === 'closed') fail(409, 'GUIDED_ORDER', '请按当前处理进度继续分析。')
        if (busy.has(space.id)) fail(409, 'MODEL_BUSY', '当前分析尚未结束，请稍候。')
        if (busy.size >= 4) fail(429, 'MODEL_CAPACITY', '当前模型调用较多，请稍后重试。')
        const questions = { impact: '供应商 A 延期会影响哪些订单？有几条需要处理？', decisions: '追溯两份会议决定：当前有效决定是什么，较新的候选方案是否已生效？', paths: '检查到料处置路径：继续由 A 供应与满足条件后切换 B，分别有哪些影响和尚缺条件？' }
        const modelProvider = activeProvider(space.settings)
        busy.add(space.id)
        try {
          const run = safeResult(await runOfficeChat({ state: structuredClone(space.state), question: questions[body.step], role, provider: modelProvider, variant: 'ontology', mode: body.mode, guidedStep: body.step, signal: AbortSignal.timeout(120000) }), modelProvider.apiKey)
          db.exec('BEGIN IMMEDIATE')
          try {
            const current = getSpace(space.id)
            if (current.state.revision !== body.expectedVersion) {
              run.status = 'failed'; run.answer = ''; delete run.proposal
              run.error = { code: 'STALE_VERSION', message: '分析期间数据已更新，本轮结果未采纳，请重新分析。' }
            }
            if (run.status === 'completed') {
              current.state = completeGuidedAnalysis(current.state, body.step, run, role)
              run.resultRevision = current.state.revision
              db.prepare('UPDATE spaces SET state=? WHERE id=?').run(JSON.stringify(current.state), space.id)
            }
            record(space.id, 'run', run)
            const response = { ...snapshot(current, role), run }
            db.prepare('INSERT INTO idempotency VALUES(?,?,?,?)').run(space.id, body.idempotencyKey, requestHash, JSON.stringify(response))
            db.exec('COMMIT')
            return json(res, 200, response)
          } catch (error) { db.exec('ROLLBACK'); throw error }
        } finally { busy.delete(space.id) }
      }
      if (['POST /model/test', 'POST /chat', 'POST /compare'].includes(route)) {
        if (route === 'POST /model/test' && role !== 'lead') fail(403, 'FORBIDDEN', '仅业务负责人可测试连接。')
        if (busy.has(space.id)) fail(409, 'MODEL_BUSY', '当前演示正在调用模型，请等待本次结束。')
        if (busy.size >= 4) fail(429, 'MODEL_CAPACITY', '当前模型调用较多，请稍后重试。')
        const question = route === 'POST /model/test' ? null : questionFrom(body)
        const selectedMode = body.mode ?? space.settings.mode
        if (!['live', 'rules'].includes(selectedMode)) fail(422, 'INVALID_MODE', '模型运行方式不正确。')
        const modelProvider = activeProvider(space.settings)
        busy.add(space.id)
        try {
          if (route === 'POST /model/test') {
            const connection = safeResult(await testProvider(modelProvider), modelProvider.apiKey)
            saveSettings(space.id, { ...space.settings, connection: { ...connection, testedAt: new Date().toISOString() } })
            return json(res, 200, connection)
          }
          const run = async variant => safeResult(await runOfficeChat({ state: structuredClone(space.state), question, role, provider: { ...modelProvider }, variant, mode: route === 'POST /compare' ? 'live' : selectedMode, signal: AbortSignal.timeout(120000) }), modelProvider.apiKey)
          if (route === 'POST /chat') {
            const result = await run('ontology'); record(space.id, 'run', result)
            return json(res, 200, { run: result })
          }
          const [baseline, ontology] = await Promise.all([run('baseline'), run('ontology')])
          const comparison = { id: randomUUID(), question, revision: space.state.revision, model: modelProvider.model, role, createdAt: new Date().toISOString(), baseline, ontology }
          record(space.id, 'comparison', comparison)
          return json(res, 200, { comparison })
        } finally { busy.delete(space.id) }
      }
      fail(404, 'NOT_FOUND', '接口不存在。')
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: { code: error.code || 'SERVER_ERROR', message: error.status ? error.message : '服务暂时无法完成请求，请重试。' } })
      else res.end()
    }
  })
  server.requestTimeout = 150000
  server.on('close', () => db.close())
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envPath = resolve(root, '../platform-demo/.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)
  const server = createOfficeServer({ dbPath: process.env.OFFICE_DATA_PATH || resolve(root, '.office-data/office.sqlite'), publicOrigin: process.env.OFFICE_PUBLIC_ORIGIN || '', basePath: process.env.OFFICE_BASE_PATH || '/', accessCode: process.env.OFFICE_ACCESS_CODE || '', provider: { baseUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME, apiKey: process.env.MODEL_API_KEY } })
  const port = Number(process.env.OFFICE_PORT || 5194)
  server.listen(port, process.env.OFFICE_BIND || '127.0.0.1', () => console.log(`办公协同服务已启动，端口 ${port}；模型凭据：${process.env.MODEL_API_KEY ? '已配置' : '未配置'}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
}

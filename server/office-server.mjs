import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalStore, digest, fault } from './office-store.mjs'
import { createOfficeService } from './office-service.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)) }
export async function readOfficeBody(req) {
  if (req.body !== undefined) {
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    if (Buffer.byteLength(text) > 262144) fault(413, 'BODY_TOO_LARGE', '请求内容过大。')
    try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value } catch { fault(400, 'INVALID_JSON', '请求格式不正确。') }
  }
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > 262144) fault(413, 'BODY_TOO_LARGE', '请求内容过大。'); chunks.push(Buffer.from(chunk)) }
  if (!size) return {}
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value } catch { fault(400, 'INVALID_JSON', '请求格式不正确。') }
}
export function createOfficeServer({ dbPath = resolve(root, '.office-data/office.sqlite'), provider = {}, distPath = resolve(root, 'dist'), publicOrigin = '', basePath = '/', accessCode = '', defaultMode = 'live', allowAnonymous = false, publicDemo = false, ...options } = {}) {
  if (!['live','rules'].includes(defaultMode)) throw new Error('Invalid default model mode.')
  const origin = publicOrigin ? new URL(publicOrigin) : null
  if (origin && (origin.protocol !== 'https:' || (!accessCode && !allowAnonymous))) throw new Error('Public deployment requires HTTPS and an access code.')
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('Invalid deployment base path.')
  const store = createLocalStore(dbPath)
  const service = createOfficeService({ store, provider, defaultMode, publicDemo, ...options })
  const loginAttempts = new Map()
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || ''
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && host !== origin?.host) fault(403, 'HOST_DENIED', '不允许此访问地址。')
      const expectedOrigin = host === origin?.host ? origin.origin : `http://${host}`
      if (req.headers.origin && req.headers.origin !== expectedOrigin) fault(403, 'ORIGIN_DENIED', '不允许跨站请求。')
      const url = new URL(req.url, `http://${host}`)
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, service: 'longsheng-office', database: true, version: 'office-complete-v3' })
      if (!url.pathname.startsWith('/api/office/')) {
        if (!['GET', 'HEAD'].includes(req.method)) fault(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。')
        const relative = decodeURIComponent(url.pathname)
        let file = resolve(distPath, `.${relative}`)
        if (!file.startsWith(resolve(distPath) + sep)) file = resolve(distPath, 'index.html')
        if (!existsSync(file) || !statSync(file).isFile()) { if (extname(relative)) fault(404, 'NOT_FOUND', '文件不存在。'); file = resolve(distPath, 'index.html') }
        if (!existsSync(file)) fault(503, 'BUILD_REQUIRED', '请先构建演示页面。')
        const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2' }
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' }); return res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
      }
      const path = url.pathname.slice('/api/office'.length)
      const body = req.method === 'POST' ? await readOfficeBody(req) : {}
      let token = /(?:^|;\s*)office_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
      if (accessCode && token && !store.hasSession(token)) token = undefined
      if (accessCode && path === '/session' && req.method === 'POST') {
        const ip = req.socket.remoteAddress
        const entry = loginAttempts.get(ip)
        const attempts = entry?.until > Date.now() ? entry : { count: 0, until: Date.now()+60000 }
        if (attempts.count >= 10) fault(429, 'LOGIN_LIMIT', '尝试次数过多，请一分钟后重试。')
        if (typeof body.accessCode !== 'string' || !timingSafeEqual(Buffer.from(digest(body.accessCode)), Buffer.from(digest(accessCode)))) { attempts.count++; loginAttempts.set(ip, attempts); fault(401, 'ACCESS_INVALID', '访问码不正确。') }
        loginAttempts.delete(ip)
      } else if (!token && accessCode) fault(401, 'ACCESS_REQUIRED', '请输入演示访问码。')
      if (!token) { token = randomBytes(32).toString('hex'); res.setHeader('Set-Cookie', `office_session=${token}; HttpOnly; SameSite=Strict; Path=${basePath}; Max-Age=2592000${origin ? '; Secure' : ''}`) }
      const result = await service.handle({ token, method: req.method, path, body, query: Object.fromEntries(url.searchParams), role: req.headers['x-demo-role'] || 'lead' })
      return json(res, result.status, result.body)
    } catch (error) { return json(res, error.status || 500, { error: { code: error.code || 'SERVER_ERROR', message: error.status ? error.message : '服务暂时无法完成请求，请重试。' } }) }
  })
  server.requestTimeout = 60000
  server.on('close', () => store.close())
  return server
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createOfficeServer({ dbPath: process.env.OFFICE_DATA_PATH || resolve(root,'.office-data/office.sqlite'), publicDemo: process.env.OFFICE_PUBLIC_DEMO === '1', defaultMode: process.env.OFFICE_MODEL_MODE || 'live', provider: { baseUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME, apiKey: process.env.MODEL_API_KEY } })
  server.listen(Number(process.env.OFFICE_PORT || 5194), process.env.OFFICE_BIND || '127.0.0.1', () => console.log('办公协同服务已启动。'))
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
}

import { randomBytes } from 'node:crypto'
import { createBlobStore } from '../server/office-store.mjs'
import { createOfficeService } from '../server/office-service.mjs'
import { readOfficeBody } from '../server/office-server.mjs'
const store = createBlobStore({prefix:'sessions-v3',legacyPrefix:'sessions'})
const service = createOfficeService({ store, publicDemo: true, defaultMode: 'live', provider: { baseUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME, apiKey: process.env.MODEL_API_KEY } })
export default async function handler(req, res) {
  const respond = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)) }
  try {
    const host = req.headers.host || ''
    if (!host.endsWith('.vercel.app') || req.headers.origin && req.headers.origin !== `https://${host}`) return respond(403, { error: { code: 'ORIGIN_DENIED', message: '不允许此来源。' } })
    const url = new URL(req.url, `https://${host}`)
    const route = url.searchParams.get('route') || url.pathname
    if (!route.startsWith('/api/office/')) return respond(404, { error: { code:'NOT_FOUND',message:'接口不存在。' } })
    const body = req.method === 'POST' ? await readOfficeBody(req) : {}
    let token = /(?:^|;\s*)office_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
    if (!token) { token = randomBytes(32).toString('hex'); res.setHeader('Set-Cookie', `office_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`) }
    url.searchParams.delete('route')
    const result = await service.handle({ token, method: req.method, path: route.slice('/api/office'.length), query: Object.fromEntries(url.searchParams), body, role: req.headers['x-demo-role'] || 'lead' })
    return respond(result.status, result.body)
  } catch (error) {
    console.error('office_request_failed', error.code || error.name || 'UNKNOWN')
    return respond(error.status || 503, { error: { code: error.code || 'SERVICE_UNAVAILABLE', message: error.status ? error.message : '演示服务暂时不可用，请稍后重试。' } })
  }
}

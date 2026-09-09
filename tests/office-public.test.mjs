import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOfficeServer } from '../server/office-server.mjs'
import { request } from 'node:http'

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: key => Array.isArray(res.headers[key]) ? res.headers[key][0] : res.headers[key] }, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject); req.end(options.body)
  })
}

test('public deployment requires access, scopes secure cookies and preserves origin guard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-public-test-'))
  const server = createOfficeServer({ dbPath: join(dir, 'office.sqlite'), publicOrigin: 'https://preview.aihuashen.com', basePath: '/longsheng-office/', accessCode: 'test-office-access' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { Host: 'preview.aihuashen.com', Origin: 'https://preview.aihuashen.com', 'Content-Type': 'application/json' }
  try {
    assert.equal((await fetch(base + '/healthz', { headers })).status, 200)
    const unauth = await fetch(base + '/api/office/snapshot', { headers })
    assert.equal(unauth.status, 401); assert.equal((await unauth.json()).error.code, 'ACCESS_REQUIRED')
    assert.equal((await fetch(base + '/api/office/session', { method: 'POST', headers, body: JSON.stringify({ accessCode: 'wrong' }) })).status, 401)
    const login = await fetch(base + '/api/office/session', { method: 'POST', headers, body: JSON.stringify({ accessCode: 'test-office-access' }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\/longsheng-office\//)
    const loginState = await login.json()
    const next = await fetch(base + '/api/office/snapshot', { headers: { ...headers, Cookie: cookie.split(';')[0] } })
    assert.equal((await next.json()).workspaceId, loginState.workspaceId)
    assert.equal((await fetch(base + '/api/office/model', { headers: { ...headers, Origin: 'https://evil.example', Cookie: cookie.split(';')[0] } })).status, 403)
    assert.equal((await fetch(base + '/api/office/snapshot', { headers: { ...headers, Host: 'evil.example' } })).status, 403)
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})

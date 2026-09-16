import test from 'node:test'
import assert from 'node:assert/strict'
import { createDataOSReadClient } from '../server/dataos-read-client.mjs'

const config = { baseUrl: 'https://dataos.example.test', accessToken: 'test-private-token', tenantId: 'tenant-a', projectId: 'project-a' }
const type = { id: 'type-1', objectTypeCode: 'supplier', objectTypeName: '供应商', associatedProject: 'project-a', status: 'PUBLISHED', softDelete: false }
const properties = [{ propertyCode: 'code', dataType: 'string', isSensitive: false }, { propertyCode: 'name', dataType: 'string', isSensitive: false }, { propertyCode: 'phone', isSensitive: true }]
const row = { objectId: 'S1', objectTypeCode: 'supplier', properties: { code: 'A', name: '样例供应商', phone: 'private-contact', internal: 'private-value' } }
const query = { objectTypeCode: 'supplier', fields: ['code', 'name'], size: 1 }
const envelope = data => new Response(JSON.stringify({ code: 200, data }), { headers: { 'Content-Type': 'application/json' } })
function harness(overrides = {}) {
  const calls = []
  const client = createDataOSReadClient({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (overrides.fetch) return overrides.fetch(url, options)
    if (url.pathname.endsWith('/properties')) return envelope(overrides.properties || properties)
    const page = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('size'))
    if (url.pathname.endsWith('/instances')) return envelope(overrides.instances || { content: [row], totalElements: 2, totalPages: 2, page, size })
    return envelope(overrides.catalog || { content: [type], totalElements: 1, totalPages: 1, page, size })
  } })
  return { client, calls }
}

test('真实接口格式：只发 GET，携带租户，投影显式字段并保留分页与来源', async () => {
  const { client, calls } = harness()
  const result = await client.readObjectPage(query)
  assert.deepEqual(result.rows, [{ id: 'S1', values: { code: 'A', name: '样例供应商' } }])
  assert.equal(result.hasMore, true)
  assert.equal(result.totalElements, 2)
  assert.equal(result.projectId, config.projectId)
  assert.equal(result.source, 'dataos')
  assert.equal(calls.length, 3)
  for (const { url, options } of calls) {
    assert.equal(url.origin, config.baseUrl)
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers['X-Tenant-Id'], 'tenant-a')
    assert.equal(options.headers.Authorization, 'Bearer test-private-token')
  }
  assert.equal(JSON.stringify(result).includes('private'), false)
})

test('缺少租户、项目或令牌时拒绝初始化；不使用隐式默认值', () => {
  for (const field of ['tenantId', 'projectId', 'accessToken']) assert.throws(() => createDataOSReadClient({ ...config, [field]: '' }), { code: 'CONFIG_INVALID' })
  for (const baseUrl of ['http://dataos.example.test', 'https://user:pass@dataos.example.test', 'https://dataos.example.test/api', 'https://dataos.example.test?token=secret']) assert.throws(() => createDataOSReadClient({ ...config, baseUrl }), { code: 'CONFIG_INVALID' })
})

test('项目筛选被上游忽略时拒绝跨项目读取', async () => {
  const { client, calls } = harness({ catalog: { content: [{ ...type, associatedProject: 'another-project' }], totalElements: 1, totalPages: 1, page: 1, size: 100 } })
  await assert.rejects(client.readObjectPage(query), { code: 'PROJECT_MISMATCH' })
  assert.equal(calls.length, 1)
})

test('未发布、找不到或重复对象时不查询实例', async () => {
  for (const [content, code] of [[[], 'OBJECT_NOT_FOUND'], [[type, type], 'OBJECT_NOT_FOUND'], [[{ ...type, status: 'UNPUBLISHED' }], 'OBJECT_UNAVAILABLE']]) {
    const { client, calls } = harness({ catalog: { content, totalElements: content.length, totalPages: content.length ? 1 : 0, page: 1, size: 100 } })
    await assert.rejects(client.readObjectPage(query), { code })
    assert.equal(calls.length, 1)
  }
})

test('敏感字段和未声明字段不进入模型或调用结果', async () => {
  for (const fields of [['phone'], ['internal']]) {
    const { client, calls } = harness()
    await assert.rejects(client.readObjectPage({ ...query, fields }), { code: 'FIELD_UNAVAILABLE' })
    assert.equal(calls.length, 2)
  }
})

test('实例类型错配、字段缺失或页码错配不冒充有效结果', async () => {
  for (const content of [[{ ...row, objectTypeCode: 'employee' }], [{ ...row, properties: { code: 'A' } }]]) {
    const { client } = harness({ instances: { content, totalElements: 1, totalPages: 1, page: 1, size: 1 } })
    await assert.rejects(client.readObjectPage(query), { code: 'RESPONSE_INVALID' })
  }
  const { client } = harness({ instances: { content: [row], totalElements: 1, totalPages: 1, page: 2, size: 1 } })
  await assert.rejects(client.readObjectPage(query), { code: 'RESPONSE_INVALID' })
})

test('HTTP 错误和业务错误只返回安全错误，不降级为样例成功', async () => {
  for (const [response, code] of [[new Response('test-private-token', { status: 401 }), 'AUTH_FAILED'], [new Response('private', { status: 503 }), 'HTTP_FAILED'], [new Response(JSON.stringify({ code: 500, message: 'test-private-token' })), 'API_FAILED']]) {
    const { client } = harness({ fetch: async () => response })
    await assert.rejects(client.readObjectPage(query), error => error.code === code && !error.message.includes('private'))
  }
})

test('连接异常或取消不会泄露请求信息', async () => {
  for (const [name, code] of [['Error', 'CONNECTION_FAILED'], ['TimeoutError', 'REQUEST_CANCELLED'], ['AbortError', 'REQUEST_CANCELLED']]) {
    const { client } = harness({ fetch: async () => { const error = new Error('test-private-token'); error.name = name; throw error } })
    await assert.rejects(client.readObjectPage(query), error => error.code === code && !error.message.includes('private'))
  }
})

test('对象目录分页读取，不能只看首页误报不存在', async () => {
  const { client, calls } = harness({ fetch: async url => {
    if (url.pathname.endsWith('/properties')) return envelope(properties)
    const page = Number(url.searchParams.get('page'))
    return envelope({ content: page === 1 ? Array.from({ length: 100 }, (_, n) => ({ ...type, objectTypeCode: `other-${n}` })) : [type], totalElements: 101, totalPages: 2, page, size: 100 })
  } })
  assert.equal((await client.describeObject('supplier')).code, 'supplier')
  assert.equal(calls.length, 3)
})

test('无效参数不发请求', async () => {
  for (const values of [{ objectTypeCode: '../employee' }, { size: 1000 }, { fields: [] }, { fields: ['name', 'name'] }]) {
    const { client, calls } = harness()
    await assert.rejects(client.readObjectPage({ ...query, ...values }), { code: 'QUERY_INVALID' })
    assert.equal(calls.length, 0)
  }
})

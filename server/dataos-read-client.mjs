// Read-only adapter for the observed DataOS console API. No login or write endpoints.
export class DataOSError extends Error {
  constructor(code, message) { super(message); this.name = 'DataOSError'; this.code = code }
}
const fail = (code, message) => { throw new DataOSError(code, message) }
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max

export function createDataOSReadClient({ baseUrl, accessToken, tenantId, projectId, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  let origin
  try { origin = new URL(baseUrl) } catch { fail('CONFIG_INVALID', 'DataOS 服务地址无效。') }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') fail('CONFIG_INVALID', 'DataOS 须使用无路径、凭据或参数的 HTTPS 服务地址。')
  if (typeof accessToken !== 'string' || !accessToken.trim() || /\s/.test(accessToken) || !identifier(tenantId) || !identifier(projectId)) fail('CONFIG_INVALID', '须明确配置访问令牌、租户和项目；禁止使用默认租户。')
  if (!integer(timeoutMs, 100, 30000)) fail('CONFIG_INVALID', 'DataOS 超时设置无效。')
  async function get(path, params, signal) {
    const url = new URL('/api/v1/ontology/' + path, origin)
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value))
    try {
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'X-Tenant-Id': tenantId },
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      })
      if (!response.ok) {
        await response.body?.cancel()
        fail(response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : 'HTTP_FAILED', `DataOS 返回 HTTP ${response.status}。`)
      }
      const body = await response.json()
      if (!record(body) || body.code !== 200) fail('API_FAILED', 'DataOS 业务接口未成功；未采用其他数据替代。')
      return body.data
    } catch (error) {
      if (error instanceof DataOSError) throw error
      // Never expose upstream bodies, token, headers or low-level diagnostics.
      fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'REQUEST_CANCELLED' : 'CONNECTION_FAILED', 'DataOS 查询未完成，请检查连接或认证。')
    }
  }
  function pageData(data, page, size) {
    if (!record(data) || !Array.isArray(data.content) || !integer(data.totalElements, 0, Number.MAX_SAFE_INTEGER) || !integer(data.totalPages, 0, 1000000) || data.page !== page || data.size !== size || data.content.length > size || data.content.length > data.totalElements || data.totalPages !== Math.ceil(data.totalElements / size)) fail('RESPONSE_INVALID', 'DataOS 分页结果不完整或格式已变化。')
    return data
  }
  async function describeObject(objectTypeCode, { signal } = {}) {
    if (!identifier(objectTypeCode)) fail('QUERY_INVALID', '对象编码无效。')
    let matches = []
    // A bounded metadata scan avoids silently missing objects beyond the first page.
    for (let page = 1; page <= 10; page++) {
      const data = pageData(await get('object-types', { page, size: 100, associatedProject: projectId }, signal), page, 100)
      if (data.totalPages > 10) fail('CATALOG_TOO_LARGE', '项目对象目录超过本次读取上限。')
      if (data.content.some(item => !record(item) || String(item.associatedProject) !== projectId)) fail('PROJECT_MISMATCH', '接口返回了其他项目的对象，已停止查询。')
      matches.push(...data.content.filter(item => item.objectTypeCode === objectTypeCode))
      if (page >= data.totalPages) break
    }
    if (matches.length !== 1) fail('OBJECT_NOT_FOUND', '项目内未找到唯一匹配的对象类型。')
    const type = matches[0]
    if (!identifier(String(type.id)) || type.status !== 'PUBLISHED' || type.softDelete === true) fail('OBJECT_UNAVAILABLE', '对象尚未发布或已删除。')
    const properties = await get(`object-types/${encodeURIComponent(type.id)}/properties`, {}, signal)
    if (!Array.isArray(properties) || properties.some(p => !record(p) || typeof p.propertyCode !== 'string') || new Set(properties.map(p => p.propertyCode)).size !== properties.length) fail('RESPONSE_INVALID', 'DataOS 属性定义无效。')
    return { id: String(type.id), code: type.objectTypeCode, name: type.objectTypeName, projectId, properties: properties.map(p => ({ code: p.propertyCode, type: p.dataType, sensitive: p.isSensitive === true })) }
  }
  async function readObjectPage({ objectTypeCode, fields, page = 1, size = 20, signal } = {}) {
    if (!Array.isArray(fields) || !fields.length || fields.length > 30 || fields.some(f => !identifier(f)) || new Set(fields).size !== fields.length || !integer(page, 1, 10000) || !integer(size, 1, 100)) fail('QUERY_INVALID', '须指定有效字段与分页范围。')
    const object = await describeObject(objectTypeCode, { signal })
    if (fields.some(f => !object.properties.some(p => p.code === f && !p.sensitive))) fail('FIELD_UNAVAILABLE', '指定字段不存在或已标记敏感，已停止查询。')
    const data = pageData(await get(`object-types/${encodeURIComponent(objectTypeCode)}/instances`, { page, size }, signal), page, size)
    const rows = data.content.map(row => {
      if (!record(row) || row.objectTypeCode !== objectTypeCode || !record(row.properties) || !['string', 'number'].includes(typeof row.objectId) || (typeof row.objectId === 'number' && !Number.isSafeInteger(row.objectId)) || fields.some(f => !Object.hasOwn(row.properties, f) || (row.properties[f] !== null && !['string', 'number', 'boolean'].includes(typeof row.properties[f])))) fail('RESPONSE_INVALID', '对象实例类型或必需字段不匹配，已停止查询。')
      return { id: String(row.objectId), values: Object.fromEntries(fields.map(f => [f, row.properties[f]])) }
    })
    return { source: 'dataos', baseUrl: origin.origin, tenantId, projectId, objectTypeCode, objectTypeId: object.id, fields, page, size, totalElements: data.totalElements, totalPages: data.totalPages, hasMore: page < data.totalPages, fetchedAt: new Date().toISOString(), rows }
  }
  return Object.freeze({ describeObject, readObjectPage })
}

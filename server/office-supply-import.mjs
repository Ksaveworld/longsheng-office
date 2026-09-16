import { createHash } from 'node:crypto'

const reject = message => { throw Object.assign(new Error(message), { status: 422, code: 'SUPPLY_IMPORT_INVALID' }) }

// Bounded CSV reader: quoted commas/newlines and escaped quotes, with physical row provenance.
export function parseSupplyCsv(text) {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 60000 || text.includes('\0') || text.includes('\uFFFD')) reject('请提供不超过 60 KB 的 UTF-8 CSV 文件。')
  const input = text.replace(/^\uFEFF/, '')
  const rows = []; let cells = [], value = '', quoted = false, closed = false, start = 0, line = 1, rowLine = 1
  for (let i = 0; i <= input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === undefined) reject(`第 ${rowLine} 行引号未闭合。`)
      if (c === '"') { if (input[i + 1] === '"') { value += '"'; i++ } else { quoted = false; closed = true } }
      else { value += c; if (c === '\n') line++ }
    } else if (c === '"' && !value && !closed) quoted = true
    else if (c === ',' || c === '\r' || c === '\n' || c === undefined) {
      cells.push(value); value = ''; closed = false
      if (c === ',') continue
      if (cells.some(cell => cell !== '')) rows.push({ cells, line: rowLine, raw: input.slice(start, i) })
      cells = []
      if (c === '\r' && input[i + 1] === '\n') i++
      start = i + 1; rowLine = ++line
    } else {
      if (closed || c === '"') reject(`第 ${rowLine} 行 CSV 引号格式不正确。`)
      value += c
    }
  }
  if (rows.length < 2 || rows.length > 101) reject('每份表需要 1 至 100 条记录。')
  const header = rows.shift()
  if (new Set(header.cells).size !== header.cells.length || header.cells.some(key => !key)) reject('表头包含空字段或重复字段。')
  return { header: header.raw, rows: rows.map(row => {
    if (row.cells.length !== header.cells.length) reject(`第 ${row.line} 行列数与表头不一致。`)
    return { ...row, fields: Object.fromEntries(header.cells.map((key, index) => [key, row.cells[index]])) }
  }) }
}

export function prepareSupplyImport(state, action) {
  if (state.scenario || state.matter.id !== 'SUP-001') reject('首轮仅支持 SUP-001 供应延期事项的样例表。')
  if (state.matter.planSelection || state.tasks.length || state.matter.executionApproval || state.matter.status !== 'open') reject('事项已进入办理流程，不能导入覆盖其依据。请在未办理的演示空间验证。')
  if (action.dataKind !== 'synthetic') reject('此入口仅用于已明确标注的合成样例，不接入客户生产数据。')
  if (!Array.isArray(action.files) || action.files.length !== 2 || new Set(action.files.map(file => file?.type)).size !== 2) reject('请同时提供一份供应商表和一份订单表。')
  const result = { suppliers: structuredClone(state.suppliers), orders: structuredClone(state.orders), records: [], details: [] }
  let snapshotId
  for (const file of action.files) {
    if (!['Supplier', 'Order'].includes(file?.type) || typeof file.name !== 'string' || !/^[^\\/\r\n\x00-\x1f]{1,100}\.csv$/i.test(file.name)) reject('文件类型或文件名无效，请选择 CSV 样例表。')
    const parsed = parseSupplyCsv(file.text)
    const digest = createHash('sha256').update(file.text).digest('hex')
    const collection = file.type === 'Supplier' ? result.suppliers : result.orders
    const seen = new Set()
    for (const row of parsed.rows) {
      const f = row.fields, id = f.p_id
      const record = collection.find(item => item.id === id)
      if (!record || seen.has(id)) reject(`${file.name} 第 ${row.line} 行：编号不属于当前事项或重复。`)
      seen.add(id)
      if (!f.snapshot_id || !/^[a-z][a-z0-9_-]{0,39}$/.test(f.snapshot_id)) reject('缺少有效 snapshot_id，请使用现有导出表格式。')
      snapshotId ??= f.snapshot_id
      if (snapshotId !== f.snapshot_id) reject('两份表必须来自同一个样例快照，不能混合不同状态。')
      if (f.object_id !== `${file.type}:${id}` || f.row_key !== `${snapshotId}/${file.type}:${id}`) reject(`${file.name} 第 ${row.line} 行：对象编号与行主键不一致。`)
      const key = file.type === 'Supplier' ? 'arrivalDay' : 'requiredDay'
      const raw = f[`p_${key}`]
      if (!/^(?:[1-9]|[12][0-9]|30)$/.test(raw || '')) reject(`${file.name} 第 ${row.line} 行：日期须为 D1 至 D30 对应的整数，不可为空。`)
      if (file.type === 'Order' && (f.p_materialId !== record.materialId || record.materialId !== state.matter.materialId)) reject(`${file.name} 第 ${row.line} 行：物料关联不匹配。`)
      if (file.type === 'Supplier' && (f.p_name !== record.name || f.p_quality !== record.quality || (f.p_originalDay || '') !== String(record.originalDay ?? ''))) reject(`${file.name} 第 ${row.line} 行：名称、原到料日及历史质量字段须与当前样例一致。`)
      if (file.type === 'Supplier' && id === 'B' && Number(raw) !== record.arrivalDay) reject('首轮仅更新供应商 A 的到料通知；B 的到料条件须与既有会议样例一致。')
      result.details.push(`${file.type === 'Supplier' ? '供应商' : '订单'} ${id}：${file.type === 'Supplier' ? '预计到料' : '最晚到料'} D${record[key]} → D${raw}。`)
      record[key] = Number(raw)
      result.records.push({ id: `DOC-IMPORT-${file.type.toUpperCase()}-${file.type === 'Order' ? `R${row.line}` : id}-${digest.slice(0, 12).toUpperCase()}`, objectId: `${file.type}:${id}`, field: key, value: Number(raw), title: `${file.name} · 第 ${row.line} 行 · ${id}`, source: '用户导入的合成样例 · 非客户生产数据', text: `合成样例；文件 ${file.name}；第 ${row.line} 行；快照 ${snapshotId}；SHA-256 ${digest}。\n仅映射 ${file.type === 'Supplier' ? '供应商编号、预计到料日' : '订单编号、物料编号、最晚到料日'}。风险、延误天数、当前采用、审批和版本字段均不导入，由当前业务状态重新计算。\n原始表头：\n${parsed.header}\n原始记录：\n${row.raw}` })
    }
    if (seen.size !== collection.length) reject(`${file.name} 必须包含当前事项全部 ${collection.length} 条记录，缺失时不填默认值。`)
  }
  return result
}

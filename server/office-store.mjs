import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { get, put, BlobPreconditionFailedError } from '@vercel/blob'
import { createSeedMatters } from './office-seeds.mjs'
import { createEventStates } from './office-events.mjs'
import { migrateState } from './office-domain.mjs'

export const digest = value => createHash('sha256').update(value).digest('hex')
export function fault(status, code, message) { throw Object.assign(new Error(message), { status, code }) }
const isWriteConflict=(error,saved)=>error instanceof BlobPreconditionFailedError||(!saved&&error?.message?.startsWith('Vercel Blob: This blob already exists,'))
const fresh = () => ({ schemaVersion: 3, eventCatalogVersion:1, matters: Object.fromEntries(createSeedMatters().map(s => [s.matter.id, s])), conversations: [], runs: [], requests: {}, previews: {}, idempotency: {} })
function open(path) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, state TEXT NOT NULL, settings TEXT NOT NULL); CREATE TABLE IF NOT EXISTS office_meta(id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  return db
}
function migrate(db, row) {
  const raw = JSON.parse(row.state)
  if (raw.schemaVersion === 3) {
    if (!raw.eventCatalogVersion) {
      for (const state of Object.values(raw.matters)) {
        const m=state.matter,createdAt=m.createdAt||state.events?.[0]?.at||new Date().toISOString()
        m.eventType ||= '供应商交期变更';m.urgency ||= '高';m.businessObject ||= m.materialId
        m.createdAt ||= createdAt;m.updatedAt ||= state.events?.at(-1)?.at||createdAt
        m.dueAt ||= new Date(Date.parse(createdAt)+2*86400000).toISOString()
      }
      for (const s of createEventStates()) if (!raw.matters[s.matter.id]) raw.matters[s.matter.id] = s
      raw.eventCatalogVersion = 1
    }
    return raw
  }
  const next = fresh()
  next.matters[raw.matter.id] = migrateState(raw)
  // Old single-run history remains immutable, grouped by role for retrieval.
  const hasRecords = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'").get()
  if (hasRecords) for (const saved of db.prepare("SELECT body FROM records WHERE space=? AND kind='run' ORDER BY created").all(row.id)) {
    const run = JSON.parse(saved.body);run.role ||= 'lead';run.createdAt ||= '2026-09-09T00:00:00Z'
    let conv = next.conversations.find(c => c.role === run.role)
    if (!conv) { conv = { id: randomUUID(), matterId: raw.matter.id, role: run.role, title: '原版历史问答', createdAt: run.createdAt, updatedAt: run.createdAt, messageIds: [] }; next.conversations.push(conv) }
    next.runs.push({ ...run, conversationId: conv.id, matterId: raw.matter.id })
    conv.messageIds.push(run.id); conv.updatedAt = run.createdAt
  }
  return next
}
function transaction(db, token, callback) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const hash = digest(token)
    let row = db.prepare('SELECT * FROM spaces WHERE token_hash=?').get(hash)
    const created = !row
    if (!row) { row = { id: randomUUID(), token_hash: hash, state: JSON.stringify(fresh()), settings: '{}' }; db.prepare('INSERT INTO spaces VALUES(?,?,?,?)').run(row.id, hash, row.state, row.settings) }
    const workspace = migrate(db, row)
    if(row.settings!=='{}')db.prepare('UPDATE spaces SET settings=? WHERE id=?').run('{}',row.id)
    const output = callback(workspace, row.id)
    if (output?.then) throw new Error('Storage transactions must be synchronous')
    const serialized = JSON.stringify(workspace)
    const changed = serialized !== row.state || created || row.settings!=='{}'
    if (serialized !== row.state) db.prepare('UPDATE spaces SET state=? WHERE id=?').run(serialized, row.id)
    db.exec('COMMIT')
    return { value: structuredClone(output), changed }
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
function quotaTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare("SELECT value FROM office_meta WHERE id='model-quota'").get()
    const quota = row ? JSON.parse(row.value) : { day: '', count: 0, leases: {} }
    const value = callback(quota)
    db.prepare("INSERT OR REPLACE INTO office_meta VALUES('model-quota',?)").run(JSON.stringify(quota))
    db.exec('COMMIT'); return structuredClone(value)
  } catch (e) { db.exec('ROLLBACK'); throw e }
}
export function createLocalStore(dbPath) {
  const db = open(dbPath)
  return { transact: async (token, fn) => transaction(db, token, fn).value, quota: async fn => quotaTransaction(db, fn), hasSession: token => Boolean(db.prepare('SELECT id FROM spaces WHERE token_hash=?').get(digest(token))), close: () => db.close() }
}
export function createBlobStore({ prefix = 'sessions', legacyPrefix, control = 'control/model-quota-v3.json', blobGet=get, blobPut=put } = {}) {
  return {
    async transact(token, callback) {
      const path = `${prefix}/${digest(token)}.json`
      for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await blobGet(path, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } })
        const legacy = !saved && legacyPrefix ? await blobGet(`${legacyPrefix}/${digest(token)}.json`,{access:'private',useCache:false,headers:{'Accept-Encoding':'identity'}}) : null
        const directory = mkdtempSync(join(tmpdir(), 'office-v3-'))
        let db
        try {
          let bundle = {}
          const filename = join(directory, 'office.sqlite')
          const source=saved||legacy
          if (source) { bundle = await new Response(source.stream).json(); writeFileSync(filename, Buffer.from(bundle.database, 'base64')) }
          db = open(filename)
          const result = transaction(db, token, callback)
          db.close(); db = null
          if (result.changed || !saved) await blobPut(path, JSON.stringify({ database: readFileSync(filename).toString('base64') }), {
            access: 'private', addRandomSuffix: false, contentType: 'application/json',
            ...(saved ? { ifMatch: saved.blob.etag } : { allowOverwrite: false }),
          })
          return result.value
        } catch (error) {
          if (!isWriteConflict(error,saved)) throw error
          if (attempt === 2) fault(409, 'STORAGE_CONFLICT', '数据正在更新，请稍后重试原操作。')
        } finally { db?.close(); rmSync(directory, { recursive: true, force: true }) }
      }
    },
    async quota(callback) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await blobGet(control, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } })
        const quota = saved ? await new Response(saved.stream).json() : { day: '', count: 0, leases: {} }
        const value = callback(quota)
        try {
          await blobPut(control, JSON.stringify(quota), { access: 'private', addRandomSuffix: false, contentType: 'application/json', ...(saved ? { ifMatch: saved.blob.etag } : { allowOverwrite: false }) })
          return value
        } catch (error) { if (!isWriteConflict(error,saved)) throw error; if (attempt === 2) fault(429, 'MODEL_CAPACITY', '当前请求较多，请稍后再试。') }
      }
    },
    close() {},
  }
}

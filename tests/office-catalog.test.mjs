import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSeedMatters } from '../server/office-seeds.mjs'
import { createLocalStore } from '../server/office-store.mjs'
import { createOfficeService } from '../server/office-service.mjs'
import { applyAction, getDocuments, analyze } from '../server/office-domain.mjs'

test('new and existing spaces expose one representative per type without changing child records or archived history', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'office-catalog-'))
  const store = createLocalStore(join(dir, 'office.sqlite'))
  t.after(() => { store.close(); rmSync(dir, { recursive:true, force:true }) })
  const service = createOfficeService({ store, defaultMode:'rules' })
  const call = async (token, path='/snapshot', matterId='SUP-001', body) => (await service.handle({ token, path, query:{matterId}, role:'lead', method:body ? 'POST':'GET', body:body || {} })).body
  const expected=['SUP-001','SUP-007','SUP-008','SUP-009']
  const fresh=await call('fresh')
  assert.deepEqual(fresh.matters.map(s=>s.state.matter.id), expected)
  assert.equal(new Set(fresh.matters.map(s=>s.state.matter.eventType)).size,4)
  const original=createSeedMatters({includeArchived:true})
  let selected=original[0]
  selected=applyAction(selected,{type:'select_plan',supplierId:'B',planVersionId:'SUP-001-B-v1'},'lead')
  selected=applyAction(selected,{type:'request_quality'},'lead')
  original[0]=selected
  const oldHistory={id:'old-history',matterId:'SUP-002',role:'lead',title:'M-02 延期',messageIds:[]}
  await store.transact('existing',ws=>{ws.matters=Object.fromEntries(original.map(s=>[s.matter.id,s]));ws.conversations.push(oldHistory)})
  const before=await store.transact('existing',ws=>ws)
  const current=await call('existing')
  assert.deepEqual(current.matters.map(s=>s.state.matter.id),expected)
  assert.deepEqual((await call('existing','/matters')).matters.map(s=>s.state.matter.id),expected)
  const {documents,...state}=current.state
  const {documents: originalDocuments, ...originalState}=selected
  assert.deepEqual(state,originalState)
  assert.deepEqual(documents,getDocuments(selected))
  assert.deepEqual(current.state.orders.map(o=>o.id),['ORD-001-01','ORD-001-02'])
  assert.deepEqual(current.state.suppliers.map(s=>s.id),['A','B'])
  assert.equal(analyze(current.state).riskCount,1)
  assert.equal((await call('existing','/conversations')).conversations.length,0)
  for(const id of ['SUP-002','SUP-003','SUP-004','SUP-005','SUP-006','SUP-010']) {
    for(const path of ['/snapshot','/runs','/conversations','/documents']) await assert.rejects(()=>call('existing',path,id),{code:'MATTER_RETIRED',status:410})
    await assert.rejects(()=>call('existing','/chat',id,{question:'继续办理'}),{code:'MATTER_RETIRED'})
    await assert.rejects(()=>call('existing','/preview',id,{action:{type:'request_quality'}}),{code:'MATTER_RETIRED'})
  }
  assert.deepEqual(await store.transact('existing',ws=>ws),before,'catalog filtering preserves all saved work and history')
})

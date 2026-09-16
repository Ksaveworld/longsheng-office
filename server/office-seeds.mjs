import { createState, applyAction } from './office-domain.mjs'
import { createEventStates } from './office-events.mjs'
// Archived stage fixtures are retained only for migration/regression tests.
export function createSeedMatters({includeArchived=false}={}){
 return Array.from({length:includeArchived?6:1},(_,i)=>{
  const n=i+1,suffix=String(n).padStart(3,'0'),materialId=`M-${String(n).padStart(2,'0')}`
  let state=createState({matterId:`SUP-${suffix}`,materialId,title:`供应商交期变更 · ${materialId}`,arrivalDay:6+i,alternativeDay:4+i,orders:[{id:`ORD-${suffix}-01`,requiredDay:5+i,materialId},{id:`ORD-${suffix}-02`,requiredDay:8+i,materialId}]})
  const act=(type,role='lead',rest={})=>{state=applyAction(state,{type,...rest},role)}
  if(i>0){
   const supplierId=i%2?'B':'A'
   act('select_plan','lead',{supplierId,planVersionId:state.planVersions.find(p=>p.supplierId===supplierId).id})
   act('request_quality')
   if(i>1){
    act('accept_task','quality',{taskId:'T-QA'});act('start_task','quality',{taskId:'T-QA'})
    act('submit_quality','quality',{taskId:'T-QA',result:'approved',evidence:`合成样例 ${state.matter.id}：质量岗位已核对当前方案版本、订单影响与实施条件。`})
    if(i>2){
     act(supplierId==='A'?'approve_keep_a':'approve_switch')
     if(i>3){
      act('send_tasks')
      act('accept_task','procurement',{taskId:'T-PUR'});act('start_task','procurement',{taskId:'T-PUR'})
      if(i>4){
       act('submit_receipt','procurement',{taskId:'T-PUR',evidence:'合成回执：采购跟进安排已确认。'})
       act('accept_task','sales',{taskId:'T-SALES'});act('start_task','sales',{taskId:'T-SALES'})
       act('submit_receipt','sales',{taskId:'T-SALES',evidence:'合成回执：销售交期信息已同步。'})
       act('close_matter')
      }
     }
    }
   }
  }
  const at = new Date().toISOString()
  Object.assign(state.matter,{eventType:"供应商交期变更",urgency:i%2?"高":"紧急",businessObject:materialId,createdAt:at,updatedAt:at,dueAt:new Date(Date.now()+(i-1)*86400000).toISOString(),ownerRole:"lead"})
  return state
 }).concat(createEventStates({includeArchived}))
}

import { randomUUID } from 'node:crypto'

export const eventRoles = { lead:'业务负责人', procurement:'采购经办', quality:'质量负责人', sales:'销售经办', production:'生产计划', maintenance:'设备维护' }
export const isBusinessEvent = state => Boolean(state.scenario)
const sourceId = (s, name) => `${name}-${s.matter.id}`
const selectedPlan = s => s.planVersions.find(p => p.id === s.matter.planSelection?.planVersionId)
const reviewTask = s => s.tasks.find(t => t.id === 'T-QA')
const executionTasks = s => s.tasks.filter(t => t.id !== 'T-QA')
const receiptDone = t => ['awaiting_review','completed'].includes(t?.status) && Boolean(t.receipt?.evidence?.trim())
const definitions = [
  { id:'SUP-007', eventType:'质量批次异常', title:'染料批次色差复检异常', businessObject:'批次 LOT-DY-0911 / 订单 ORD-Q-01', reviewer:'quality', urgency:'紧急', dueDays:0,
    trigger:'合成检验记录显示待发染料批次色差超出样例放行限值，需要冻结该批次并确认处置。', impact:'关联订单暂不能使用该批次放行；需协调复检或替换，并向客户确认发运安排。', risk:'批次最终放行及客户认可仍需独立业务凭证。',
    plans:[
      {title:'隔离复检并确认调整发运',summary:'质量岗位隔离与复检，销售与客户确认复检后的发运窗口。',advantages:['保留原批次追溯'],risks:['复检结论及客户等待窗口尚待确认'],tasks:[['T-QUALITY','quality','记录隔离范围和复检结果'],['T-CUSTOMER','sales','确认客户等待窗口与发运沟通结果']]},
      {title:'合格库存替换并重新核对',summary:'生产计划核对可替换库存，质量岗位核对替换批次记录，销售确认客户接受条件。',advantages:['可并行核对替换资源'],risks:['替换库存及客户接受条件尚待确认'],tasks:[['T-QUALITY','quality','提交替换批次质量凭据'],['T-PRODUCTION','production','确认替换库存及重配安排'],['T-CUSTOMER','sales','确认替换批次的客户沟通结果']]},
    ] },
  { id:'SUP-008', eventType:'客户订单需求变更', title:'客户追加订单数量并提前需求日', businessObject:'订单 ORD-C-0911 / 客户样例 C', reviewer:'production', urgency:'高', dueDays:2,
    trigger:'客户样例 C 提出将订单需求由 20 吨增至 25 吨，并将需求日提前两天；原计划尚未变更。', impact:'需重新核对产能、物料及可承诺数量，未经确认不能直接承诺新交期。', risk:'客户最终确认与实际产出仍需后续凭证。',
    plans:[
      {title:'分批满足追加需求',summary:'生产计划核对首批与追加批次，销售确认客户分批接收条件。',advantages:['保留原订单可交付部分'],risks:['客户可能不接受分批'],tasks:[['T-PRODUCTION','production','提交分批生产与数量安排'],['T-CUSTOMER','sales','记录客户分批接收确认']]},
      {title:'协商统一调整交期',summary:'生产计划核对新增数量的排产窗口，采购确认追加物料，销售协商整单交期。',advantages:['统一整单交付安排'],risks:['追加物料与新交期均待确认'],tasks:[['T-PRODUCTION','production','核对整单排产窗口'],['T-PURCHASE','procurement','确认追加物料可用条件'],['T-CUSTOMER','sales','提交客户对新交期的反馈']]},
    ] },
  { id:'SUP-009', eventType:'设备检修影响排产', title:'反应釜检修窗口与生产任务冲突', businessObject:'设备 R-02 / 生产任务 MO-0911', reviewer:'maintenance', urgency:'紧急', dueDays:1,
    trigger:'合成设备检修计划与 MO-0911 的反应釜占用窗口重叠；需要确认检修边界及排产调整。', impact:'生产任务按原窗口执行存在冲突；需设备、生产和销售共同确认恢复或调整安排。', risk:'检修放行与实际复产均须现场负责人确认，本 Demo 不控制设备。',
    plans:[
      {title:'保留检修窗口并调整排产',summary:'设备维护确认检修条件，生产计划重排任务，销售同步可能受影响的订单窗口。',advantages:['保留既定检修窗口'],risks:['新生产窗口及客户影响待确认'],tasks:[['T-MAINT','maintenance','提交检修范围及恢复条件'],['T-PRODUCTION','production','提交调整后的排产窗口'],['T-CUSTOMER','sales','确认相关订单沟通结果']]},
      {title:'核对备用设备承接条件',summary:'设备维护核对备用设备状态，生产计划核对工艺与排产适配；条件不满足则不得转产。',advantages:['可并行评估承接能力'],risks:['备用设备工艺适配尚待核实'],tasks:[['T-MAINT','maintenance','核对备用设备状态和安全条件'],['T-PRODUCTION','production','提交工艺适配及承接排产结论']]},
    ] },
]

export function createEventStates({staged=true,includeArchived=false}={}) {
  return (includeArchived ? [...definitions,{...definitions[0],id:'SUP-010',title:'染料批次复检协同已办结样例'}] : definitions).map((d,index) => {
    const createdAt = new Date().toISOString(), dueAt = new Date(Date.now()+d.dueDays*86400000).toISOString()
    const state = { revision:1, workflowVersion:3, scenario:structuredClone(d), matter:{id:d.id,title:d.title,status:'open',supplierId:'',materialId:'',eventType:d.eventType,businessObject:d.businessObject,urgency:d.urgency,createdAt,updatedAt:createdAt,dueAt,ownerRole:'lead',participants:[...new Set(['lead',d.reviewer,...d.plans.flatMap(p=>p.tasks.map(t=>t[1]))])]}, suppliers:[],orders:[],decisions:[],documents:[],tasks:[],events:[],planReviews:[],failNextDelivery:false }
    state.planVersions=d.plans.map((p,i)=>({id:`${d.id}-${i?'B':'A'}-v1`,supplierId:i?'B':'A',title:p.title,summary:p.summary,advantages:p.advantages,risks:p.risks,constraints:[`${eventRoles[d.reviewer]}核验当前方案版本`,'负责人批准后单独确认发送任务'],sourceIds:[sourceId(state,'DOC-NOTICE'),sourceId(state,'DOC-RULES')],tasks:p.tasks.map(([id,assignee,title])=>({id,assignee,title})),createdAt,revision:1,origin:'baseline'}))
    let result=state
    const act=(type,role='lead',rest={})=>{result=applyEvent(result,{type,...rest},role)}
    if(staged && index>0){
      act('select_event_plan','lead',{planVersionId:state.planVersions[0].id});act('request_event_review')
      if(index!==2){
        act('accept_task',d.reviewer,{taskId:'T-QA'});act('start_task',d.reviewer,{taskId:'T-QA'});act('submit_quality',d.reviewer,{taskId:'T-QA',result:'approved',evidence:'预置合成核验记录：已核对本方案条件。'});act('approve_event');act('send_tasks')
        if(index===3){
          for(const t of result.tasks.filter(t=>t.id!=='T-QA')){act('accept_task',t.assignee,{taskId:t.id});act('start_task',t.assignee,{taskId:t.id});act('submit_receipt',t.assignee,{taskId:t.id,evidence:'预置合成回执：'+t.title+'的协同记录已确认，实际业务结果另凭证核实。'})}
          act('close_matter')
        }
      }
    }
    return result
  })
}

export function eventClosing(s) {
  const p=selectedPlan(s), qa=reviewTask(s)
  const executionApproved=Boolean(p && qa?.planVersionId===p.id && qa.status==='completed' && qa.qualityResult==='approved' && qa.receipt?.evidence && s.matter.executionApproval?.planVersionId===p.id)
  const missingReceipts=(p?.tasks||[]).filter(t=>!receiptDone(s.tasks.find(x=>x.id===t.id))).map(t=>t.id)
  const canClose=s.matter.status!=='closed' && executionApproved && missingReceipts.length===0
  return {executionApproved,missingReceipts,canClose,pendingActionCount:s.matter.status==='closed'?0:executionApproved?missingReceipts.length+(canClose?1:0):1}
}
export function eventAnalysis(s) {
  const c=eventClosing(s), qa=reviewTask(s)
  const nextStep=s.matter.status==='closed'?'事项已办结，协同凭据已留档。':c.canClose?'所有必要回执已齐，等待负责人复核关闭。':c.executionApproved?executionTasks(s).some(t=>t.status==='pending_delivery')?'负责人另行确认发送部门任务。':'等待各责任岗位接收、处理并提交回执。':!selectedPlan(s)?'比较并选择处理方案。':qa?.status==='completed'&&qa.qualityResult==='approved'?'核验已通过，等待负责人批准。':qa&&qa.status!=='completed'?`等待${eventRoles[s.scenario.reviewer]}办理核验。`:'请发起当前方案版本核验。'
  return {...c,linkedCount:0,riskCount:0,orders:[],options:[],effectiveDecisionId:s.decisions.find(d=>d.status==='effective')?.id||'',nextStep}
}
function reject(message,code='INVALID_ACTION',status=409){throw Object.assign(new Error(message),{code,status})}
function checkEvent(s,a,role) {
  if(s.matter.status==='closed')reject('事项已办结。')
  if(!eventRoles[role])reject('未知岗位。','ROLE_DENIED',403)
  const only=(...roles)=>{if(!roles.includes(role))reject('当前岗位无权执行此操作。','ROLE_DENIED',403)}
  const p=selectedPlan(s), qa=reviewTask(s), c=eventClosing(s)
  const evidence=()=>{if(typeof a.evidence!=='string'||!a.evidence.trim()||a.evidence.length>4000)reject('请填写不超过 4000 字的处理说明和凭据。','EVIDENCE_REQUIRED',422);if(a.sourceIds!==undefined&&(!Array.isArray(a.sourceIds)||a.sourceIds.length>12||a.sourceIds.some(id=>!eventDocuments(s).some(d=>d.id===id))))reject('凭据来源不属于本事项。','SOURCE_INVALID',422)}
  switch(a.type){
    case 'select_event_plan': only('lead'); if(s.matter.executionApproval)reject('已批准的方案不能改选。'); if(!s.planVersions.some(p=>p.id===a.planVersionId))reject('方案不存在。');if(p?.id===a.planVersionId)reject('已选择此版本。');return ['确认选择方案',['选择仅记录意向，须核验及负责人批准后才能发送任务。']]
    case 'request_event_review':only('lead');if(!p)reject('请先选择方案。');if(c.executionApproved||qa&&!(qa.status==='completed'&&qa.qualityResult==='rejected'))reject('请办理或重试现有核验任务。');return ['发起方案核验',[`核验方案：${p.title}`,`接收岗位：${eventRoles[s.scenario.reviewer]}`]]
    case 'approve_event':only('lead');if(c.executionApproved)reject('方案已批准。');if(!p||qa?.planVersionId!==p.id||qa.status!=='completed'||qa.qualityResult!=='approved'||!qa.receipt?.evidence)reject('当前版本尚未通过核验。');return ['负责人确认方案',[p.title,...p.tasks.map(t=>`${eventRoles[t.assignee]}：${t.title}`),'仅创建待发送任务，发送需另行确认。']]
    case 'send_tasks':only('lead');if(!c.executionApproved||!executionTasks(s).some(t=>t.status==='pending_delivery'))reject('没有已批准的待发送任务。');return ['确认并发送部门任务',executionTasks(s).filter(t=>t.status==='pending_delivery').map(t=>`${eventRoles[t.assignee]}：${t.title}`)]
    case 'accept_task':case 'start_task':case 'submit_quality':case 'submit_receipt':case 'retry_delivery':{
      const t=s.tasks.find(t=>t.id===a.taskId);if(!t)reject('任务不存在。');only(...(a.type==='retry_delivery'?['lead',t.assignee]:[t.assignee]));if(t.id!=='T-QA'&&!c.executionApproved)reject('部门办理须基于已批准方案。')
      if(a.type==='retry_delivery'){if(t.status!=='delivery_failed'||t.attempts>=3)reject('仅失败任务可重试，本轮最多三次。');return ['重试发送任务',[t.title,'沿用原任务编号。']]}
      const required={accept_task:'delivered',start_task:'accepted',submit_quality:'in_progress',submit_receipt:'in_progress'}[a.type];if(t.status!==required)reject('任务状态已变化，请按接收、处理、提交顺序办理。')
      if(a.type==='submit_quality'||a.type==='submit_receipt'){if((a.type==='submit_quality')!==(t.id==='T-QA'))reject('请使用对应任务的提交操作。');evidence();if(t.id==='T-QA'&&!['approved','rejected'].includes(a.result))reject('请选择通过或不通过。');return [t.id==='T-QA'?'提交方案核验结论':'提交处理回执',[t.title,a.evidence]]}
      return [a.type==='accept_task'?'确认接收任务':'开始处理任务',[t.title]]
    }
    case 'close_matter':only('lead');if(!c.canClose)reject('必要部门回执尚未齐全，不能关闭。','CLOSE_CONDITIONS_UNMET');return ['复核并关闭办公事项',[p.title,...executionTasks(s).map(t=>`${eventRoles[t.assignee]}：${t.receipt.evidence}`),s.scenario.risk]]
    case 'arm_delivery_failure':only('lead');return ['模拟一次发送失败',[]]
    default:reject('不支持的业务操作。','UNKNOWN_ACTION',422)
  }
}
export function eventPreview(s,a,role){try{const [title,details]=checkEvent(s,a,role);return {allowed:true,title,details,reason:'',action:structuredClone(a),revision:s.revision}}catch(e){if(!e.code)throw e;return {allowed:false,title:'当前无法执行',reason:e.message,details:[],action:structuredClone(a),revision:s.revision}}}
export function applyEvent(s,a,role){
  const [title]=checkEvent(s,a,role), n=structuredClone(s), at=new Date().toISOString();n.revision++;n.matter.updatedAt=at
  const deliver=t=>{t.attempts++;t.status=n.failNextDelivery?'delivery_failed':'delivered';t.sentAt=at;if(n.failNextDelivery){t.deliveryError='演示收件箱发送失败，可重试。';n.failNextDelivery=false}else{t.deliveredAt=at;delete t.deliveryError}}
  const task=()=>n.tasks.find(t=>t.id===a.taskId)
  switch(a.type){
    case 'select_event_plan':{const p=n.planVersions.find(p=>p.id===a.planVersionId);n.matter.planSelection={planVersionId:p.id,supplierId:p.supplierId,reason:p.summary,selectedBy:role,selectedAt:at,revision:n.revision};if(n.tasks.length){n.reviewHistory=[...(n.reviewHistory||[]),...n.tasks];n.tasks=[]}break}
    case 'request_event_review':{const prior=reviewTask(n);if(prior)n.reviewHistory=[...(n.reviewHistory||[]),prior];const t={id:'T-QA',title:`核验：${selectedPlan(n).title}`,assignee:n.scenario.reviewer,planVersionId:selectedPlan(n).id,status:'pending_delivery',attempts:0,createdAt:at};n.tasks=n.tasks.filter(t=>t.id!=='T-QA');n.tasks.push(t);deliver(t);break}
    case 'approve_event':n.matter.executionApproval={planVersionId:selectedPlan(n).id,approvedBy:role,approvedAt:at};n.tasks.push(...selectedPlan(n).tasks.map(t=>({...t,planVersionId:selectedPlan(n).id,status:'pending_delivery',attempts:0,createdAt:at})));n.decisions.push({id:'DEC-EVENT',status:'effective',text:`负责人批准：${selectedPlan(n).title}`,sourceId:sourceId(n,'DOC-STATE'),approvedBy:role});break
    case 'send_tasks':executionTasks(n).filter(t=>t.status==='pending_delivery').forEach(deliver);break
    case 'accept_task':task().status='accepted';task().acceptedAt=at;break
    case 'start_task':task().status='in_progress';task().startedAt=at;break
    case 'submit_quality':case 'submit_receipt':{const t=task();t.status=a.type==='submit_quality'?'completed':'awaiting_review';t.receipt={evidence:a.evidence.trim(),actor:role,at,sourceIds:a.sourceIds||[]};if(a.type==='submit_quality'){t.qualityResult=a.result;n.planReviews.push({id:randomUUID(),planVersionId:t.planVersionId,result:a.result,evidence:a.evidence.trim(),reviewedBy:role,reviewedAt:at})}break}
    case 'retry_delivery':deliver(task());break
    case 'arm_delivery_failure':n.failNextDelivery=true;break
    case 'close_matter':n.matter.status='closed';n.matter.closedAt=at;n.matter.review={reviewedBy:role,reviewedAt:at,receiptTaskIds:executionTasks(n).map(t=>t.id),decisionId:'DEC-EVENT',supplierId:'',riskCount:0};executionTasks(n).forEach(t=>{t.status='completed';t.completedAt=at});break
  }
  n.events.push({id:randomUUID(),type:a.type,actor:role,at,message:title});return n
}
export function eventDocuments(s){return [
  ['DOC-NOTICE',s.scenario.eventType+'通知',s.scenario.trigger+' '+s.scenario.impact+' 对象：'+s.matter.businessObject],
  ['DOC-RULES','办理规则',`选择方案后由${eventRoles[s.scenario.reviewer]}核验具体版本，负责人批准后另行确认发送。各任务须接收、开始处理、提交凭据；所有必要回执齐全后负责人复核关闭。${s.scenario.risk}`],
  ['DOC-PLANS','候选处理方案',JSON.stringify(s.planVersions)],
  ['DOC-STATE','事项状态与处理凭据',JSON.stringify({matter:s.matter,tasks:s.tasks,reviewHistory:s.reviewHistory,planReviews:s.planReviews,nextStep:eventAnalysis(s).nextStep})],
].map(([id,title,text])=>({id:sourceId(s,id),title,text,source:'合成业务样例 · 非真实业务接入'}))}
export function eventPresentation(s,role){
  const a=eventAnalysis(s), p=selectedPlan(s), qa=reviewTask(s), actions=[]
  const add=(action,label)=>{if(eventPreview(s,action,role).allowed)actions.push({...action,label})}
  for(const t of s.tasks)add({type:'retry_delivery',taskId:t.id},`重试发送：${eventRoles[t.assignee]}`)
  add({type:'request_event_review'},'发起方案核验');add({type:'approve_event'},'负责人确认方案');add({type:'send_tasks'},'确认并发送部门任务')
  for(const t of s.tasks){add({type:'accept_task',taskId:t.id},'确认接收任务');add({type:'start_task',taskId:t.id},'开始处理任务');const action={type:t.id==='T-QA'?'submit_quality':'submit_receipt',taskId:t.id,evidence:'仅检查权限',result:'approved'};if(eventPreview(s,action,role).allowed)actions.push({type:action.type,taskId:t.id,label:t.id==='T-QA'?'提交方案核验结论':'提交处理回执'})}
  add({type:'close_matter'},'复核回执并关闭事项')
  if(s.matter.status!=='closed'&&!s.matter.executionApproval&&role==='lead')actions.push({type:'choose_plan',label:p?'调整方案选择':'比较并选择方案'})
  const waitingRoles=s.matter.status==='closed'?[]:a.canClose||!p||!qa||qa.status==='completed'&&!a.executionApproved||executionTasks(s).some(t=>t.status==='pending_delivery')?['lead']:a.executionApproved?[...new Set(executionTasks(s).filter(t=>!receiptDone(t)).map(t=>t.assignee))]:[s.scenario.reviewer]
  const stage=s.matter.status==='closed'?'已办结':a.canClose?'待复核':a.executionApproved?executionTasks(s).some(t=>t.status==='pending_delivery')?'待发送':'部门执行':!p?'待选择':qa?.status==='completed'?(qa.qualityResult==='approved'?'待批准':'核验不通过'):qa?'核验中':'待发起核验'
  return {revision:s.revision,title:s.matter.title,category:s.matter.status==='closed'?'closed':p||s.firstAnalyzedAt?'processing':'warning',stage,conclusion:a.nextStep,blockers:s.matter.status==='closed'?[]:[a.nextStep],waitingRoles,actions,priority:s.matter.urgency==='紧急'?0:1,earliestRequiredDay:0,delayDays:0,originalDay:0,noticeArrivalDay:0,effectiveSupplierId:'',options:[],delta:{arrivalDaysEarlier:0,riskOrdersFewer:0},sourceIds:eventDocuments(s).map(d=>d.id),events:s.events.map(e=>({id:e.id,summary:`${eventRoles[e.actor]}：${e.message}`}))}
}

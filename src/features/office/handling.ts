import { roleNames, type Presentation, type Role, type Snapshot } from './types'

export function handlingActionLabel(action: Presentation['actions'][number]) {
  if (['request_quality', 'request_event_review'].includes(action.type)) return '准备核验申请'
  if (action.taskId === 'T-QA' && action.type === 'accept_task') return '接收核验申请'
  if (action.taskId === 'T-QA' && action.type === 'start_task') return '开始核验'
  return action.label
}

/** All entry points describe the same saved revision and current role. */
export function matterHandling(snapshot: Snapshot, role: Role = snapshot.role) {
  const { state, analysis, presentation: p } = snapshot
  const closed = state.matter.status === 'closed'
  const qa = state.tasks.find(t => t.id === 'T-QA' && t.planVersionId === state.matter.planSelection?.planVersionId && !t.selectionInvalidated)
  const waitingForReview = !closed && !analysis.executionApproved && p.stage === '核验中' && qa && ['delivered', 'accepted', 'in_progress'].includes(qa.status) ? qa : undefined
  const current = waitingForReview
    ? qa!.status === 'delivered' ? `等待${roleNames[qa!.assignee]}接收` : qa!.status === 'accepted' ? `等待${roleNames[qa!.assignee]}开始核验` : `${roleNames[qa!.assignee]}核验中`
    : p.stage
  const ownActions = p.actions.filter(a => a.type !== 'choose_plan' || p.waitingRoles.includes(role))
  const primary = ownActions[0]
  return {
    closed, qa, waitingForReview, current, ownActions, primary,
    myTask: primary ? handlingActionLabel(primary) : '你当前无需操作',
    nextRoles: p.waitingRoles.map(r => roleNames[r]).join('、'),
    reviewSubmitted: Boolean(waitingForReview && role !== qa!.assignee && qa!.status === 'delivered'),
  }
}

import type { OfficeGraphData } from './graph'

export type Role = 'procurement' | 'quality' | 'sales' | 'lead' | 'production' | 'maintenance'
export type Page = 'home' | 'assistant' | 'matter' | 'matter-detail' | 'knowledge'
export type Action = { type: string; [key: string]: unknown }
export type Source = {
  id: string
  title: string
  text?: string
  source?: string
}
export type ReceiptRecord = {
  arrangement?: string
  pending?: string
  orderIds?: string[]
  communication?: string
  result?: string
}
export type Presentation = {
  revision: number
  title: string
  category: 'warning' | 'processing' | 'closed'
  stage: string
  conclusion: string
  blockers: string[]
  waitingRoles: Role[]
  actions: {
    type: string
    label: string
    taskId?: string
    supplierId?: string
  }[]
  priority: number
  earliestRequiredDay: number
  delayDays: number
  originalDay: number
  noticeArrivalDay: number
  effectiveSupplierId: string
  selectedVersionId?: string
  approvedVersionId?: string
  options: {
    supplierId: string
    arrivalDay: number
    riskCount: number
    riskOrderIds: string[]
    arrangement: string
    conditions: string[]
  }[]
  delta: { arrivalDaysEarlier: number; riskOrdersFewer: number }
  sourceIds: string[]
  events: { id: string; summary: string }[]
}
export type FollowupApproval = {
  approvedBy: Role
  approvedAt: string
  riskCount: number
  sourceId: string
  reason: string
}
export type ExecutionApproval = {
  planVersionId: string
  approvedBy: Role
  approvedAt: string
  qualityReviewId?: string
  history?: (Omit<ExecutionApproval, 'history'> & {
    decision?: Decision
    followupApproval?: FollowupApproval
  })[]
}
export type Outcome = {
  revision: number
  capturedAt: string
  plan?: PlanVersion
  selection?: { planVersionId: string; supplierId: string; reason: string }
  approval?: ExecutionApproval
  decision?: Decision
  analysis: Analysis
  qualityReview?: {
    result: string
    evidence: string
    reviewedBy: Role
    reviewedAt: string
    sourceIds?: string[]
  }
  review: { reviewedBy: Role; reviewedAt: string; riskCount: number }
  receipts: {
    taskId: string
    title: string
    evidence: string
    actor: Role
    at: string
    sourceIds?: string[]
    record?: ReceiptRecord
  }[]
}
export type Task = {
  id: string
  title: string
  assignee: Role
  status: string
  attempts: number
  planVersionId?: string
  workStatus?: 'pending' | 'in_progress' | 'awaiting_review' | 'completed'
  delivery?: {
    status: 'pending' | 'sent' | 'failed'
    attempts: number
    error?: string
  }
  acceptedAt?: string
  startedAt?: string
  receipt?: unknown
  selectionInvalidated?: boolean
  selectionRevision?: number
  qualityResult?: string
}
export type Decision = {
  id: string
  sourceId: string
  status: string
  supplierId: string
  text: string
  [key: string]: unknown
}
export type PlanVersion = {
  id: string
  supplierId: string
  title: string
  summary: string
  advantages: string[]
  risks: string[]
  constraints: string[]
  sourceIds: string[]
  feedback?: string
  parentVersionId?: string
  createdAt: string
  revision: number
  suggestions?: string[]
  gaps?: string[]
}
export type Conversation = {
  id: string
  matterId: string
  role: Role
  title: string
  createdAt: string
  updatedAt: string
  messageIds: string[]
}
export type ModelRequest = {
  id: string
  conversationId: string
  matterId: string
  role: Role
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  question: string
  runId?: string
}
export type OfficeState = {
  scenario?: {eventType:string; trigger:string; impact:string; risk:string; reviewer:Role}

  firstAnalyzedAt?: string
  planVersions: PlanVersion[]
  planReviews: {
    id: string
    planVersionId: string
    result: string
    sourceIds?: string[]
    evidence: string
    reviewedBy: Role
    reviewedAt: string
  }[]
  revision: number
  matter: {
    id: string
    title: string
    status: string
    supplierId: string
    materialId: string
    eventType?: string
    urgency?: string
    businessObject?: string
    createdAt?: string
    updatedAt?: string
    dueAt?: string
    closedAt?: string
    outcome?: Outcome
    executionApproval?: ExecutionApproval
    planSelection?: {
      planVersionId: string
      supplierId: 'A' | 'B'
      selectedBy: Role
      selectedAt: string
      revision: number
      reason: string
    }
    followupApproval?: FollowupApproval
    review?: {
      reviewedBy: Role
      reviewedAt: string
      receiptTaskIds: string[]
      decisionId: string
      supplierId: string
      riskCount: number
    }
  }
  suppliers: {
    id: string
    name: string
    arrivalDay: number
    originalDay?: number
    quality: string
  }[]
  orders: { id: string; requiredDay: number; materialId: string }[]
  decisions: Decision[]
  documents: Source[]
  tasks: Task[]
  events: {
    id: string
    at: string
    type: string
    actor: string
    message: string
  }[]
  failNextDelivery: boolean
}
export type Analysis = {
  executionApproved: boolean
  executionSupplierId?: string
  pendingActionCount: number
  missingReceipts: string[]
  canClose: boolean
  linkedCount: number
  riskCount: number
  nextStep: string
  effectiveDecisionId: string
  conditionalDecisionId?: string
  orders: {
    id: string
    requiredDay: number
    arrivalDay: number
    lateDays: number
    atRisk: boolean
  }[]
  options: {
    supplierId: string
    name: string
    arrivalDay: number
    quality: string
    riskCount: number
    eligible: boolean
  }[]
}
export type Snapshot = {
  orderChains?: OrderChain[]
  presentation: Presentation
  matters?: Snapshot[]
  graph: OfficeGraphData
  state: OfficeState
  analysis: Analysis
  role: Role
  roles: { id: Role; label: string }[]
  workspaceId: string
}
export type OrderChain = {
  orderId: string
  matterId: string
  revision: number
  sourceIds: string[]
  steps: { id: string; title: string; lines: string[]; objectIds: string[]; sourceIds: string[] }[]
}
export type Preview = {
  id: string
  allowed: boolean
  reason?: string
  title: string
  details: string[]
  action: Action
  revision: number
  role: Role
}
export type ModelConfig = {
  baseUrl?: string
  model?: string
  keyConfigured: boolean
  mode: 'live' | 'rules'
  connection?: unknown
  maxRounds: number
}
export type Run = {
  supplyQuery?: SupplyQuery
  feedback?: string
  parentVersionId?: string
  conversationId?: string
  requestId?: string
  matterId?: string
  intent?: 'impact' | 'decisions' | 'plans' | 'progress' | 'briefing'
  queryType?: 'briefing'
  planVersions?: PlanVersion[]
  facts?: Pick<Snapshot, 'state' | 'analysis'> & { presentation?: Presentation }
  id: string
  question: string
  mode: 'live' | 'rules'
  variant: 'baseline' | 'ontology'
  status: 'completed' | 'failed'
  answer: string
  sources: Source[]
  toolCalls: {
    name: string
    args: unknown
    result: unknown
    startedAt?: string
    completedAt?: string
    latencyMs?: number
  }[]
  proposal?: Action
  model: string
  revision: number
  role: Role
  latencyMs: number
  usage?: unknown
  error?: unknown
  createdAt: string
}
export type SupplyQuery = {
  revision: number
  totalCount: number
  matchedCount: number
  supplierId: string
  formula: string
  message: string
  conditions: { key: string; label: string }[]
  evaluations: {
    id: string
    requiredDay: number
    arrivalDay: number
    lateDays: number
    matched: boolean
    sourceIds: string[]
    checks: { key: string; label: string; actual: string; passed: boolean }[]
  }[]
  sources: Source[]
}
export type Comparison = {
  id: string
  question: string
  revision: number
  model: string
  role: Role
  createdAt: string
  baseline: Run
  ontology: Run
}
export type History = { runs: Run[]; comparisons: Comparison[] }
export type AssistantSession = {
  messageIds?: string[]
  showPlans?: boolean
  question: string
  planReason: string
  run: Run | null
  historical: boolean
  busy: boolean
  error: string
  failedQuestion: string
  snapshotReady: boolean
}
export const roleNames: Record<Role, string> = {
  procurement: '采购经办',
  quality: '质量负责人',
  sales: '销售经办',
  lead: '业务负责人',
  production: '生产计划',
  maintenance: '设备维护',
}
export const statusNames: Record<string, string> = {
  open: '处理中',
  closed: '已办结',
  pending: '待核验',
  approved: '已通过',
  rejected: '未通过',
  effective: '当前有效',
  conditional: '有条件备选',
  fulfilled: '条件已落实',
  superseded: '已被替代',
  pending_confirmation: '待确认',
  pending_delivery: '待发送',
  delivered: '已送达，待接收',
  accepted: '已接收',
  in_progress: '处理中',
  awaiting_review: '待复核',
  completed: '已完成',
  delivery_failed: '发送失败',
}
export function showValue(value: unknown): string {
  if (value == null) return '—'
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

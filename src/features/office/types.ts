import type { OfficeGraphData } from './graph'
export type Role = 'procurement' | 'quality' | 'sales' | 'lead'
export type Page = 'home' | 'assistant' | 'matter' | 'settings'
export type Action = { type: string; [key: string]: unknown }
export type Source = {
  id: string
  title: string
  text?: string
  source?: string
}
export type Task = {
  id: string
  title: string
  assignee: Role
  status: string
  attempts: number
  workStatus?: 'pending' | 'in_progress' | 'awaiting_review' | 'completed'
  delivery?: { status: 'pending' | 'sent' | 'failed'; attempts: number; error?: string }
  receipt?: unknown
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
export type OfficeState = {
  revision: number
  matter: {
    id: string
    title: string
    status: string
    supplierId: string
    materialId: string
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
  graph: OfficeGraphData
  state: OfficeState
  analysis: Analysis
  role: Role
  roles: { id: Role; label: string }[]
  workspaceId: string
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
  baseUrl: string
  model: string
  keyConfigured: boolean
  mode: 'live' | 'rules'
  connection?: unknown
  maxRounds: number
}
export type Run = {
  id: string
  question: string
  mode: 'live' | 'rules'
  variant: 'baseline' | 'ontology'
  status: 'completed' | 'failed'
  answer: string
  sources: Source[]
  toolCalls: { name: string; args: unknown; result: unknown; startedAt?: string; completedAt?: string; latencyMs?: number }[]
  proposal?: Action
  model: string
  revision: number
  role: Role
  latencyMs: number
  usage?: unknown
  error?: unknown
  createdAt: string
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
export const roleNames: Record<Role, string> = {
  procurement: '采购经办',
  quality: '质量负责人',
  sales: '销售经办',
  lead: '业务负责人',
}
export const statusNames: Record<string, string> = {
  open: '处理中',
  closed: '已关闭',
  pending: '待核验',
  approved: '已通过',
  rejected: '未通过',
  effective: '当前有效',
  conditional: '有条件备选',
  fulfilled: '条件已落实',
  superseded: '已被替代',
  pending_confirmation: '待确认',
  pending_delivery: '待发送',
  delivered: '已送达',
  in_progress: '处理中',
  awaiting_review: '待复核',
  completed: '已完成',
  delivery_failed: '发送失败',
}
export function showValue(value: unknown): string {
  if (value == null) return '—'
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

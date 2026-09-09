export type GraphProperty = { id: string; label: string }
export type GraphType = { id: string; label: string; properties: GraphProperty[] }
export type GraphRelationType = { id: string; from: string; to: string; label: string }
export type GraphObject = {
  id: string
  type: string
  label: string
  properties: Record<string, unknown>
  sourceIds: string[]
}
export type GraphRelation = GraphRelationType & { type: string }
export type GraphSource = { id: string; title: string; text?: string; source?: string }
export type OfficeGraphData = {
  revision: number
  workspaceId: string
  model: { version: number; types: GraphType[]; relations: GraphRelationType[] }
  objects: GraphObject[]
  relations: GraphRelation[]
  sources: GraphSource[]
  projection: { status: 'ready'; revision: number }
}

import type { ComponentType } from 'react'

export type CanvasNode = {
  id: string
  title: string
  subtitle?: string
  typeLabel?: string
  type: string
  kind?: string
  x?: number
  y?: number
  width?: number
  height?: number
}
export type CanvasEdge = { id: string; source: string; target: string; relationship: string }
export const RelationshipGraph: ComponentType<{
  nodes: CanvasNode[]
  relationships: CanvasEdge[]
  selectedNodeId?: string | null
  selectedRelationshipId?: string | null
  onSelectNode?: (id: string) => void
  onSelectRelationship?: (id: string) => void
  layoutKey?: string
}>
export default RelationshipGraph

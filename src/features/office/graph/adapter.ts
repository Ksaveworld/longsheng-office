// Adapted from platform-demo/web/src/graph/relationshipAdapter.mjs, originally
// the DataOS / Mercedes relationship workbench. Layout and neighborhood logic
// are retained; only the old production/order fields are replaced by office data.
import { statusNames, roleNames, type Role } from '../types'
import type { CanvasNode, CanvasEdge } from './RelationshipGraph'
import type { OfficeGraphData } from './types'

export function propertyValue(value: unknown, key = ''): string {
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string') {
    if (['status', 'quality', 'qualityResult', 'result'].includes(key)) return statusNames[value] || value
    if (['assignee', 'actor', 'role'].includes(key)) return roleNames[value as Role] || value
    return value
  }
  if (Array.isArray(value)) return value.map(item => propertyValue(item, key)).join('、') || '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function adaptGraph(graph: OfficeGraphData, mode: 'instance' | 'model') {
  if (mode === 'model') return {
    nodes: graph.model.types.map(type => ({ id: type.id, title: type.label, subtitle: `${type.properties.length} 个字段`, typeLabel: '对象定义', type: type.id, kind: 'related' })),
    relationships: graph.model.relations.map(edge => ({ id: edge.id, source: edge.from, target: edge.to, relationship: edge.label })),
  }
  return {
    nodes: graph.objects.map(object => {
      const p = object.properties
      const subtitle = p.status ? propertyValue(p.status, 'status') : p.quality ? propertyValue(p.quality, 'quality') : p.arrivalDay !== undefined ? `预计 D${p.arrivalDay} 到料` : p.requiredDay !== undefined ? `最晚 D${p.requiredDay}` : object.id.replace(/^\w+:/, '')
      return { id: object.id, title: object.label, subtitle, typeLabel: graph.model.types.find(type => type.id === object.type)?.label || object.type, type: object.type, kind: ['Document', 'Role'].includes(object.type) ? 'reference' : 'related' }
    }),
    relationships: graph.relations.map(edge => ({ id: edge.id, source: edge.from, target: edge.to, relationship: edge.label })),
  }
}

export function neighborhood(nodes: CanvasNode[], relationships: CanvasEdge[], centerId: string, depth: string) {
  if (depth === 'all') return { nodes, relationships }
  const ids = new Set(centerId ? [centerId] : [])
  for (let i = 0; i < Number(depth); i++) {
    const previous = new Set(ids)
    for (const edge of relationships) {
      if (previous.has(edge.source)) ids.add(edge.target)
      if (previous.has(edge.target)) ids.add(edge.source)
    }
  }
  return { nodes: nodes.filter(node => ids.has(node.id)), relationships: relationships.filter(edge => ids.has(edge.source) && ids.has(edge.target)) }
}

export function layoutGraph(nodes: CanvasNode[], centerId: string, full = false, narrow = false): CanvasNode[] {
  if (!nodes.length) return []
  if (narrow) {
    const ordered = [...nodes].sort((a, b) => Number(b.id === centerId) - Number(a.id === centerId))
    return ordered.map((node, index) => ({ ...node, x: 20 + index % 2 * 224, y: 25 + Math.floor(index / 2) * 144, width: 180, height: 82, kind: node.id === centerId ? 'top-level' : node.kind }))
  }
  if (full || nodes.length > 13) {
    const columns = Math.max(2, Math.ceil(Math.sqrt(nodes.length * .72)))
    const centerSlot = Math.min(nodes.length - 1, columns + Math.floor(columns / 2))
    const centerNode = nodes.find(node => node.id === centerId)
    const ordered = nodes.filter(node => node.id !== centerId)
    if (centerNode) ordered.splice(centerSlot, 0, centerNode)
    return ordered.map((node, index) => ({ ...node, x: 35 + index % columns * 250, y: 35 + Math.floor(index / columns) * 156, width: 180, height: 82, kind: node.id === centerId ? 'top-level' : node.kind }))
  }
  const center = nodes.find(node => node.id === centerId) || nodes[0]
  const others = nodes.filter(node => node.id !== center.id)
  const rows = Math.ceil(others.length / 2)
  const height = Math.max(310, rows * 128)
  return [{ ...center, x: 310, y: height / 2 + 12, width: 180, height: 82, kind: 'top-level' }, ...others.map((node, i) => {
    const left = i % 2 === 0, count = left ? Math.ceil(others.length / 2) : Math.floor(others.length / 2)
    return { ...node, x: left ? 28 : 592, y: 54 + (Math.floor(i / 2) + .5) * height / Math.max(1, count) - 41, width: 180, height: 82 }
  })]
}

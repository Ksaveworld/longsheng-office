import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, FileText, Focus, Maximize2, Minimize2, Network, Search, Shapes } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { RelationshipGraph } from './RelationshipGraph'
import { adaptGraph, layoutGraph, neighborhood, propertyValue } from './adapter'
import type { GraphSource, OfficeGraphData } from './types'
import './office-graph.css'

export type { GraphObject, GraphRelation, GraphSource, OfficeGraphData } from './types'

const propertyLabels: Record<string, string> = {
  id: '编号', title: '标题', status: '状态', name: '名称', text: '决定内容',
  supplierId: '供应商', materialId: '物料', sourceId: '来源编号', taskId: '任务编号',
  arrivalDay: '预计到货日', originalDay: '原定到货日', requiredDay: '最晚到货日',
  quality: '质量结论', result: '核验结果', evidence: '回执内容', receipt: '回执',
  assignee: '负责人', attempts: '发送次数', qualityResult: '质量结论',
  createdAt: '创建时间', completedAt: '完成时间', at: '记录时间', actor: '操作角色',
  conditions: '生效条件', sequence: '先后顺序', lateDays: '延期天数', atRisk: '存在延期风险',
  effectiveDecisionId: '当前有效决定', conditionalDecisionId: '有条件备选决定',
}

export function OfficeGraph({ graph, openSource }: {
  graph: OfficeGraphData
  openSource: (source: GraphSource) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'instance' | 'model'>('instance')
  const [selected, setSelected] = useState('Matter:SUP-001')
  const [edgeId, setEdgeId] = useState('')
  const [center, setCenter] = useState('Matter:SUP-001')
  const [depth, setDepth] = useState('1')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width:650px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(max-width:650px)')
    const resize = () => setNarrow(media.matches)
    const change = () => setFullscreen(document.fullscreenElement === root.current)
    media.addEventListener('change', resize)
    document.addEventListener('fullscreenchange', change)
    return () => {
      media.removeEventListener('change', resize)
      document.removeEventListener('fullscreenchange', change)
    }
  }, [])

  const data = useMemo(() => adaptGraph(graph, mode), [graph, mode])
  const centerId = data.nodes.some(node => node.id === center) ? center : data.nodes[0]?.id || ''
  const selectedId = data.nodes.some(node => node.id === selected) ? selected : centerId
  const visible = useMemo(() => neighborhood(data.nodes, data.relationships, centerId, depth), [data, centerId, depth])
  const positions = useMemo(() => layoutGraph(visible.nodes, centerId, depth === 'all', narrow), [visible.nodes, centerId, depth, narrow])
  const activeEdge = data.relationships.find(edge => edge.id === edgeId)
  const activeNode = activeEdge ? undefined : data.nodes.find(node => node.id === selectedId)
  const activeObject = graph.objects.find(object => object.id === activeNode?.id)
  const definition = graph.model.types.find(type => type.id === activeNode?.type)
  const relationDefinition = mode === 'model'
    ? graph.model.relations.find(edge => edge.id === activeEdge?.id)
    : graph.model.relations.find(type => type.id === graph.relations.find(edge => edge.id === activeEdge?.id)?.type)
  const related = data.relationships.filter(edge => edge.source === activeNode?.id || edge.target === activeNode?.id)
  const sourceIds = activeObject?.sourceIds || []
  const sources = graph.sources.filter(source => sourceIds.includes(source.id))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const catalog = data.nodes.filter(node => (!typeFilter || node.type === typeFilter) && (
    !normalizedQuery || [node.id, node.title, node.subtitle, node.typeLabel,
      JSON.stringify(graph.objects.find(object => object.id === node.id)?.properties || {})]
      .join(' ').toLocaleLowerCase().includes(normalizedQuery)
  ))

  function selectNode(id: string, focus = false) {
    setSelected(id)
    setEdgeId('')
    if (focus || !visible.nodes.some(node => node.id === id)) {
      setCenter(id)
      setDepth('1')
    }
  }
  function selectEdge(id: string) {
    const edge = data.relationships.find(item => item.id === id)
    setEdgeId(id)
    if (edge && (!visible.nodes.some(node => node.id === edge.source) || !visible.nodes.some(node => node.id === edge.target))) {
      setCenter(edge.source)
      setDepth('1')
    }
  }
  function changeMode(next: 'instance' | 'model') {
    setMode(next)
    const initial = next === 'model' ? 'Matter' : 'Matter:SUP-001'
    setSelected(initial)
    setCenter(initial)
    setEdgeId('')
    setDepth(next === 'model' ? 'all' : '1')
    setQuery('')
    setTypeFilter('')
  }
  async function toggleFullscreen() {
    setFullscreenError('')
    try {
      if (fullscreen) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
    } catch {
      setFullscreenError('浏览器未能打开全屏，可继续在当前画布查看。')
    }
  }

  const current = graph.projection.status === 'ready' && graph.projection.revision === graph.revision
  return <div ref={root} className='office-graph-workbench space-y-4' data-testid='office-graph'>
    <div className='flex flex-wrap items-start justify-between gap-3'>
      <div className='space-y-1'>
        <h3 className='text-base font-semibold'>业务关系</h3>
        <p className='text-muted-foreground text-sm'>从延期事项查看订单、会议决定和执行进展。</p>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge variant='outline'>数据 v{graph.revision}</Badge>
        <Badge variant='secondary'>模型 v{graph.model.version} · 只读</Badge>
        {document.fullscreenEnabled && <Button size='sm' variant='outline' onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 /> : <Maximize2 />}{fullscreen ? '退出全屏' : '全屏查看'}
        </Button>}
      </div>
    </div>
    {fullscreenError && <p role='status' className='text-sm text-amber-700'>{fullscreenError}</p>}
    {!current ? <Card className='px-5 text-sm'>关系数据版本尚未对齐，请刷新后查看。</Card> : <>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='inline-flex rounded-lg border p-1' aria-label='关系图视图'>
          <Button size='sm' variant={mode === 'instance' ? 'secondary' : 'ghost'} aria-pressed={mode === 'instance'} onClick={() => changeMode('instance')}><Network />业务对象</Button>
          <Button size='sm' variant={mode === 'model' ? 'secondary' : 'ghost'} aria-pressed={mode === 'model'} onClick={() => changeMode('model')}><Shapes />模型结构</Button>
        </div>
        <label className='text-muted-foreground flex items-center gap-2 text-xs'>展开范围
          <select aria-label='图谱展开范围' className='bg-background text-foreground h-9 rounded-md border px-2 text-sm' value={depth} onChange={event => setDepth(event.target.value)}>
            <option value='1'>关联一层</option><option value='2'>关联两层</option><option value='all'>全部对象</option>
          </select>
        </label>
      </div>
      <div className='office-graph-layout'>
        <Card className='office-graph-directory min-w-0 gap-3 rounded-lg py-4 shadow-none'>
          <div className='space-y-3 px-3'>
            <div className='flex items-center justify-between'><h4 className='text-sm font-medium'>对象目录</h4><span className='text-muted-foreground text-xs'>{catalog.length} / {data.nodes.length}</span></div>
            <div className='relative'><Search className='text-muted-foreground absolute top-2.5 left-2.5 size-4' /><Input aria-label='搜索关系对象' placeholder='搜索名称或编号' value={query} onChange={event => setQuery(event.target.value)} className='h-9 pl-8 text-xs' /></div>
            <select aria-label='筛选对象类型' className='bg-background h-9 w-full rounded-md border px-2 text-xs' value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
              <option value=''>全部类型</option>{graph.model.types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </div>
          <div className='office-graph-catalog space-y-1 px-2' aria-label='关系对象目录'>
            {catalog.map(node => <button key={node.id} type='button' aria-pressed={!activeEdge && selectedId === node.id} onClick={() => selectNode(node.id, true)} className={cn('hover:bg-accent w-full rounded-md px-2.5 py-2 text-left transition-colors', !activeEdge && selectedId === node.id && 'bg-secondary')}>
              <span className='block truncate text-sm font-medium'>{node.title}</span>
              <span className='text-muted-foreground mt-1 block truncate text-[11px]'>{mode === 'model' ? node.subtitle : `${node.typeLabel} · ${node.id.replace(/^\w+:/, '')}`}</span>
            </button>)}
            {!catalog.length && <p className='text-muted-foreground px-2 py-6 text-center text-xs'>没有匹配的对象</p>}
          </div>
        </Card>
        <div className='office-graph-stage min-w-0'>
          <RelationshipGraph nodes={positions} relationships={visible.relationships} selectedNodeId={activeEdge ? null : selectedId} selectedRelationshipId={activeEdge?.id || null} onSelectNode={selectNode} onSelectRelationship={selectEdge} layoutKey={`${mode}:${centerId}:${depth}:${graph.workspaceId}`} />
        </div>
        <Card className='office-graph-detail min-w-0 gap-4 rounded-lg px-4 py-4 shadow-none' aria-label='关系对象详情'>
          {activeEdge ? <>
            <div className='space-y-2'><Badge variant='outline'>关系</Badge><h4 className='text-sm font-semibold'>{activeEdge.relationship}</h4><p className='text-muted-foreground break-all text-xs'>{activeEdge.id}</p></div>
            <div className='space-y-2'>
              {[{ id: activeEdge.source, label: '起点' }, { id: activeEdge.target, label: '终点' }].map(endpoint => <div key={endpoint.label}>
                <span className='text-muted-foreground text-xs'>{endpoint.label}</span>
                <Button variant='outline' size='sm' className='mt-1 h-auto w-full justify-between py-2 text-left whitespace-normal' onClick={() => selectNode(endpoint.id)}>{data.nodes.find(node => node.id === endpoint.id)?.title || endpoint.id}<ArrowRight className='shrink-0' /></Button>
              </div>)}
            </div>
            {relationDefinition && <p className='text-muted-foreground text-xs leading-5'>模型定义：{graph.model.types.find(type => type.id === relationDefinition.from)?.label || relationDefinition.from} → {graph.model.types.find(type => type.id === relationDefinition.to)?.label || relationDefinition.to}</p>}
            <p className='text-muted-foreground text-xs leading-5'>选择两端对象，可查看属性及对应来源。</p>
          </> : activeNode ? <>
            <div className='space-y-2'><Badge variant='outline'>{mode === 'model' ? '对象定义' : definition?.label || activeNode.type}</Badge><h4 className='text-sm leading-5 font-semibold'>{activeNode.title}</h4><p className='text-muted-foreground break-all text-xs'>{activeNode.id}</p></div>
            <Button size='sm' variant='outline' className='w-full' onClick={() => selectNode(activeNode.id, true)}><Focus />以此对象展开</Button>
            <div className='space-y-3'>
              <h5 className='text-xs font-medium'>{mode === 'model' ? '字段定义' : '对象属性'}</h5>
              <dl className='space-y-3 text-xs'>
                {mode === 'model' ? definition?.properties.map(property => <div key={property.id} className='space-y-1'><dt>{property.label}</dt><dd className='text-muted-foreground break-all'>{property.id}</dd></div>)
                  : Object.entries(activeObject?.properties || {}).map(([key, value]) => <div key={key} className='space-y-1'><dt className='text-muted-foreground'>{definition?.properties.find(property => property.id === key)?.label || propertyLabels[key] || key}</dt><dd className='leading-5 break-words whitespace-pre-wrap'>{['arrivalDay', 'originalDay', 'requiredDay'].includes(key) && typeof value === 'number' ? `D${value}` : propertyValue(value, key)}</dd></div>)}
              </dl>
            </div>
            {mode === 'instance' && <div className='space-y-2 border-t pt-3'>
              <h5 className='text-xs font-medium'>来源依据</h5>
              {sources.map(source => <Button key={source.id} variant='ghost' size='sm' className='h-auto w-full justify-start px-0 py-1.5 text-left text-xs whitespace-normal' onClick={() => openSource(source)}><FileText className='shrink-0' /><span className='min-w-0 break-words'>{source.title}</span></Button>)}
              {!sources.length && <p className='text-muted-foreground text-xs leading-5'>暂无独立原文，可沿关联关系查看事项或会议材料。</p>}
            </div>}
            {!!related.length && <div className='space-y-2 border-t pt-3'><h5 className='text-xs font-medium'>关联关系 · {related.length}</h5>{related.map(edge => <button key={edge.id} type='button' className='text-muted-foreground hover:text-foreground w-full text-left text-xs leading-5' onClick={() => selectEdge(edge.id)}>{edge.relationship}<span className='ml-1'>→ {data.nodes.find(node => node.id === (edge.source === activeNode.id ? edge.target : edge.source))?.title}</span></button>)}</div>}
          </> : <p className='text-muted-foreground text-sm'>选择对象或关系，查看详情。</p>}
        </Card>
      </div>
    </>}
  </div>
}

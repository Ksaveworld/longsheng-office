import type { ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, FileText } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { statusNames, showValue, type Source, type Run } from './types'
import { ExecutionTrace } from './execution-trace'

export function Status({ value }: { value: string }) {
  return (
    <Badge
      variant={
        ['delivery_failed', 'rejected'].includes(value)
          ? 'destructive'
          : ['effective', 'completed', 'approved', 'closed'].includes(value)
            ? 'default'
            : 'secondary'
      }
      className='whitespace-nowrap'
    >
      {statusNames[value] || value}
    </Badge>
  )
}
export function ErrorNotice({ message }: { message: string }) {
  if (!message) return null
  return (
    <Alert variant='destructive'>
      <AlertCircle />
      <AlertTitle>暂时无法完成</AlertTitle>
      <AlertDescription className='break-words whitespace-pre-wrap'>
        {message}
      </AlertDescription>
    </Alert>
  )
}
export function Section({
  title,
  children,
  aside,
}: {
  title: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <Card className='min-w-0 shadow-none'>
      <CardHeader className='flex flex-row items-center justify-between gap-3'>
        <CardTitle className='text-base'>{title}</CardTitle>
        {aside}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
export function Sources({
  sources,
  open,
}: {
  sources: Source[]
  open: (source: Source) => void
}) {
  return (
    <div className='flex flex-wrap gap-2'>
      {sources.map((source) => (
        <Button
          key={source.id}
          variant='outline'
          size='sm'
          onClick={() => open(source)}
        >
          <FileText className='size-3.5' />
          {source.title || source.id}
          <ArrowUpRight className='size-3.5 text-muted-foreground' />
        </Button>
      ))}
    </div>
  )
}
export function RunContent({
  run,
  openSource,
  propose,
}: {
  run: Run
  openSource: (source: Source) => void
  propose?: (action: NonNullable<Run['proposal']>) => void
}) {
  return (
    <div className='space-y-4 text-sm'>
      <div className='flex flex-wrap items-center gap-2 text-muted-foreground'>
        <Badge variant='outline'>
          {run.mode === 'live' ? '模型实际调用' : '规则演示'}
        </Badge>
        <span>{run.status === 'failed' ? '运行失败' : '已完成'}</span>
      </div>
      {run.status === 'failed' && (
        <ErrorNotice message={showValue(run.error) || '模型运行失败。'} />
      )}
      {run.answer && (
        <div className='leading-7 break-words whitespace-pre-wrap'>
          {run.answer.split(/(\*\*[^*]+\*\*|\[(?:DOC|DEMO)-[A-Z0-9-]+\])/g).map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className='font-semibold'>{part.slice(2, -2)}</strong>
            const source = part.startsWith('[') ? run.sources.find(item => item.id === part.slice(1, -1)) : undefined
            return source ? <button key={index} className='mx-0.5 rounded bg-muted px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2' onClick={() => openSource(source)} title={source.title}>{part}</button> : part
          })}
        </div>
      )}
      {!!run.sources?.length && (
        <Sources sources={run.sources} open={openSource} />
      )}
      {run.proposal && propose && (
        <Button variant='outline' onClick={() => propose(run.proposal!)}>
          检查待执行操作
        </Button>
      )}
      <a href={`${import.meta.env.BASE_URL}office#matter`} className='inline-flex text-sm underline underline-offset-4'>查看当前事项关系与回执</a>
      <details className='rounded-md border p-3'>
        <summary className='cursor-pointer text-sm text-muted-foreground'>查看技术详情</summary>
        <p className='my-3 text-xs text-muted-foreground'>数据 v{run.revision} · {run.mode === 'live' ? run.model : '规则演示'} · {(run.latencyMs / 1000).toFixed(1)} 秒</p>
        <ExecutionTrace run={run} />
      </details>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Columns2, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { officeApi, errorText } from './api'
import { ErrorNotice, RunContent, Section } from './shared'
import type {
  Comparison,
  History,
  ModelConfig,
  Role,
  Run,
  Source,
} from './types'

type Props = {
  role: Role
  config: ModelConfig | null
  history: History
  refresh: () => Promise<void>
  openSource: (source: Source) => void
}
export function ReviewPanel({
  role,
  config,
  history,
  refresh,
  openSource,
}: Props) {
  const [question, setQuestion] = useState(
    '供应商 A 延期后，是否可以直接切换供应商 B？'
  )
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [historical, setHistorical] = useState(false)
  async function compare() {
    if (lock.current || !question.trim()) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await officeApi<{ comparison: Comparison }>(
        '/compare',
        role,
        { question: question.trim() }
      )
      setComparison(result.comparison)
      setRun(null)
      setHistorical(false)
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <div className='space-y-5'>
      <Section title='同题对比'>
        <div className='space-y-4'>
          <p className='text-sm leading-7 text-muted-foreground'>
            使用同一问题、模型、数据版本、角色与运行预算，对比材料检索和加入对象关系、业务规则后的实际回答。
          </p>
          <label htmlFor='office-comparison' className='sr-only'>
            对比问题
          </label>
          <Textarea
            id='office-comparison'
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={busy}
            className='min-h-24 text-sm leading-7'
          />
          <Button
            disabled={busy || !question.trim() || !config?.keyConfigured}
            onClick={() => void compare()}
          >
            {busy ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Columns2 className='size-4' />
            )}
            {busy ? '正在对比…' : '运行同题对比'}
          </Button>
          {!config?.keyConfigured && (
            <p className='text-sm text-muted-foreground'>请先配置模型连接。</p>
          )}
        </div>
      </Section>
      <ErrorNotice message={error} />
      {comparison && (
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <Badge variant='outline'>
              {historical ? '历史对比 · 只读' : '本次对比'}
            </Badge>
            <span>数据 v{comparison.revision}</span>
          </div>
          <p className='text-sm'>{comparison.question}</p>
          <div className='grid items-start gap-4 xl:grid-cols-2'>
            <Section title='普通材料检索'>
              <RunContent run={comparison.baseline} openSource={openSource} />
            </Section>
            <Section title='材料、对象关系与业务规则'>
              <RunContent run={comparison.ontology} openSource={openSource} />
            </Section>
          </div>
        </div>
      )}
      {run && (
        <Section title='历史运行 · 只读'>
          <p className='mb-4 border-b pb-4 text-sm'>{run.question}</p>
          <RunContent run={run} openSource={openSource} />
        </Section>
      )}
      <details className='rounded-lg border p-4'>
        <summary className='cursor-pointer text-sm font-medium'>
          运行留档
        </summary>
        <div className='mt-4 grid gap-3 md:grid-cols-2'>
          {!history.runs.length && !history.comparisons.length && (
            <p className='text-sm text-muted-foreground'>暂无记录。</p>
          )}
          {history.comparisons.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              className='rounded-md border p-3 text-left hover:bg-muted/40'
              onClick={() => {
                setComparison(item)
                setRun(null)
                setHistorical(true)
                setError('')
              }}
            >
              <Badge variant='outline'>同题对比</Badge>
              <p className='mt-2 line-clamp-2 text-sm leading-6'>
                {item.question}
              </p>
              <p className='mt-2 text-xs text-muted-foreground'>
                数据 v{item.revision} ·{' '}
                {new Date(item.createdAt).toLocaleString('zh-CN')}
              </p>
            </button>
          ))}
          {history.runs.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              className='rounded-md border p-3 text-left hover:bg-muted/40'
              onClick={() => {
                setRun(item)
                setComparison(null)
                setHistorical(true)
                setError('')
              }}
            >
              <p className='line-clamp-2 text-sm leading-6'>{item.question}</p>
              <p className='mt-2 text-xs text-muted-foreground'>
                {item.mode === 'live' ? '真实模型' : '规则演示'} · v
                {item.revision} · {item.status === 'failed' ? '失败' : '完成'}
              </p>
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

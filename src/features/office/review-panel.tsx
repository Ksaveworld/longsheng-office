import { useState } from 'react'
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
  const [error, setError] = useState('')
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [historical, setHistorical] = useState(false)
  async function compare() {
    if (busy || !question.trim()) return
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
      setBusy(false)
    }
  }
  return (
    <div className='space-y-5'>
      <Section title='同题对比'>
        <div className='space-y-4'>
          <p className='text-sm leading-7 text-muted-foreground'>
            对比普通材料检索与材料、对象关系及业务规则两种方式。使用同一模型、问题、角色、数据版本和运行预算，按实际记录核对结论，不预设结果。
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
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <p className='text-xs text-muted-foreground'>
              同题对比始终实际调用模型，结果留在当前演示空间。
            </p>
            <Button
              onClick={() => void compare()}
              disabled={busy || !question.trim() || !config?.keyConfigured}
            >
              {busy ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Columns2 className='size-4' />
              )}
              {busy ? '正在对比…' : '运行同题对比'}
            </Button>
          </div>
          {!config?.keyConfigured && (
            <p className='text-sm text-amber-700'>
              请先在模型运行中配置并检测模型连接。
            </p>
          )}
        </div>
      </Section>
      <ErrorNotice message={error} />
      {comparison && (
        <div className='space-y-4'>
          <div className='flex flex-wrap gap-2 text-sm'>
            <Badge variant='outline'>
              {historical ? '历史对比 · 只读' : '本次对比'}
            </Badge>
            <span>
              数据 v{comparison.revision} · {comparison.model}
            </span>
          </div>
          <p className='text-sm'>{comparison.question}</p>
          <div className='grid items-start gap-4 xl:grid-cols-2'>
            <Section title='普通材料检索'>
              <RunContent run={comparison.baseline} openSource={openSource} />
            </Section>
            <Section title='材料 + 对象关系 + 业务规则'>
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
      <Section title='运行留档'>
        <div className='grid gap-3 md:grid-cols-2'>
          {!history.runs.length && !history.comparisons.length && (
            <p className='text-sm text-muted-foreground'>尚无运行记录。</p>
          )}
          {history.comparisons.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              className='rounded-md border p-4 text-left hover:bg-muted/40'
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
              className='rounded-md border p-4 text-left hover:bg-muted/40'
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
                {item.revision} · {item.status === 'failed' ? '失败' : '完成'} ·{' '}
                {new Date(item.createdAt).toLocaleString('zh-CN')}
              </p>
            </button>
          ))}
        </div>
        <p className='mt-4 text-xs text-muted-foreground'>
          历史结果保留当时的数据版本。留档中的建议仅供复盘，不触发业务操作。
        </p>
      </Section>
    </div>
  )
}

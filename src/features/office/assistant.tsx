import { useRef, useState } from 'react'
import { ArrowUp, Loader2, MessageSquare, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { officeApi, errorText } from './api'
import { ErrorNotice, RunContent, Section, Status } from './shared'
import type {
  Action,
  History,
  ModelConfig,
  Role,
  Run,
  Snapshot,
  Source,
} from './types'

const prompts = [
  ['查询到料影响', '供应商 A 延期会影响哪些订单？有几条需要处理？'],
  ['核对会议决定', '这件事之前怎么决定的？现在应以哪条决定为准？'],
  ['查询切换条件', '能否改用 B？还缺什么条件，应该找谁？'],
  ['查询处理进度', '这件事现在处理到哪里了？'],
]
type Props = {
  role: Role
  config: ModelConfig | null
  history: History
  snapshot: Snapshot
  question: string
  setQuestion: (question: string) => void
  refresh: () => Promise<void>
  openSource: (source: Source) => void
  propose: (action: Action) => void
  openSettings: () => void
}
export function Assistant({
  role,
  config,
  history,
  snapshot,
  question,
  setQuestion,
  refresh,
  openSource,
  propose,
  openSettings,
}: Props) {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [historical, setHistorical] = useState(false)
  const [failedQuestion, setFailedQuestion] = useState('')
  const { state, analysis } = snapshot
  const stale = !!run && run.revision !== state.revision

  async function submit(input = question) {
    const requested = input.trim()
    if (!requested || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setFailedQuestion('')
    setRun(null)
    setHistorical(false)
    try {
      const result = await officeApi<{ run: Run }>('/chat', role, {
        question: requested,
        mode: config?.mode || 'rules',
      })
      setRun(result.run)
      if (result.run.status === 'failed') setFailedQuestion(requested)
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
      setFailedQuestion(requested)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(250px,1fr)]'>
      <div className='min-w-0 space-y-5'>
        <Section
          title='围绕当前事项提问'
          aside={<Badge variant='outline'>{state.matter.id}</Badge>}
        >
          <div className='space-y-4'>
            <div className='flex flex-wrap gap-2'>
              {prompts.map(([label, text]) => (
                <Button
                  key={label}
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => setQuestion(text)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <label htmlFor='office-question' className='sr-only'>
              业务问题
            </label>
            <Textarea
              id='office-question'
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder='哪些订单受影响，现在以哪条决定为准，还需要谁处理？'
              className='min-h-28 resize-y text-sm leading-7'
              disabled={busy}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <a
                href={`${import.meta.env.BASE_URL}office#matter`}
                className='text-sm text-muted-foreground underline underline-offset-4'
              >
                查看事项与处理记录
              </a>
              <Button
                disabled={busy || !question.trim()}
                onClick={() => void submit()}
              >
                {busy ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <ArrowUp className='size-4' />
                )}
                发送问题
              </Button>
            </div>
          </div>
        </Section>
        {busy && (
          <div
            role='status'
            className='flex items-center gap-3 rounded-lg border p-5 text-sm'
          >
            <Loader2 className='size-4 animate-spin' />
            正在查询事项资料…
          </div>
        )}
        <ErrorNotice message={error} />
        {run && (
          <Section
            title={historical ? '历史回答' : '查询结果'}
            aside={
              historical ? <Badge variant='outline'>历史记录</Badge> : undefined
            }
          >
            <p className='mb-4 border-b pb-4 text-sm text-muted-foreground'>
              {run.question}
            </p>
            {stale && (
              <p className='mb-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground'>
                此回答基于数据 v{run.revision}；当前事项已更新为 v
                {state.revision}。右侧显示最新情况，可重新提问核对。
              </p>
            )}
            <RunContent
              run={run}
              openSource={openSource}
              propose={
                !historical &&
                !stale &&
                run.role === role &&
                run.status === 'completed' &&
                !busy
                  ? propose
                  : undefined
              }
            />
          </Section>
        )}
        {failedQuestion && !busy && (
          <div className='flex flex-wrap items-center gap-3'>
            <Button
              variant='outline'
              onClick={() => void submit(failedQuestion)}
            >
              <RotateCcw className='size-4' />
              重试原问题
            </Button>
            <Button variant='link' onClick={openSettings}>
              检查运行设置
            </Button>
          </div>
        )}
        {!run && !busy && !error && (
          <div className='flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center'>
            <MessageSquare className='mb-3 size-5 text-muted-foreground' />
            <p className='text-sm font-medium'>查询影响、决定与处理进度</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              选择上方问题或直接输入，回答中的来源可打开核对。
            </p>
          </div>
        )}
      </div>
      <div className='min-w-0 space-y-5'>
        <Section
          title='当前事项'
          aside={<Status value={state.matter.status} />}
        >
          <dl className='space-y-4 text-sm'>
            {[
              ['事项', state.matter.id],
              ['当前供应商', `供应商 ${state.matter.supplierId}`],
              ['有效决定', analysis.effectiveDecisionId],
              ['关联订单', `${analysis.linkedCount} 条`],
              ['当前到料风险', `${analysis.riskCount} 条`],
            ].map(([label, value]) => (
              <div className='flex justify-between gap-4' key={label}>
                <dt className='text-muted-foreground'>{label}</dt>
                <dd className='text-right font-medium'>{value}</dd>
              </div>
            ))}
          </dl>
          <p className='mt-5 border-t pt-4 text-sm leading-7'>
            {analysis.nextStep}
          </p>
        </Section>
        <details className='rounded-lg border p-4'>
          <summary className='cursor-pointer text-sm font-medium'>
            历史问答{' '}
            <span className='ml-1 text-muted-foreground'>
              {history.runs.length}
            </span>
          </summary>
          <div className='mt-4 space-y-2'>
            {!history.runs.length && (
              <p className='text-sm text-muted-foreground'>暂无历史问答。</p>
            )}
            {history.runs.slice(0, 20).map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className='block w-full rounded-md border p-3 text-start hover:bg-muted/40'
                onClick={() => {
                  setRun(item)
                  setHistorical(true)
                  setError('')
                  setFailedQuestion(
                    item.status === 'failed' ? item.question : ''
                  )
                }}
              >
                <p className='line-clamp-2 text-sm leading-6'>
                  {item.question}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  {new Date(item.createdAt).toLocaleString('zh-CN')} · v
                  {item.revision} ·{' '}
                  {item.status === 'failed' ? '查询失败' : '已回答'}
                </p>
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}

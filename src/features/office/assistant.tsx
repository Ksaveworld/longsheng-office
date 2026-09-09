import { useState } from 'react'
import { ArrowUp, Columns2, Loader2, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { officeApi, errorText } from './api'
import { ErrorNotice, RunContent, Section } from './shared'
import type {
  Action,
  Comparison,
  History,
  ModelConfig,
  Role,
  Run,
  Source,
} from './types'

const prompts = [
  '供应商 A 延期会影响哪些订单？有几条需要处理？',
  '这件事之前怎么决定的？现在应以哪条决定为准？',
  '能否改用 B？还缺什么条件，应该找谁？',
  '质量核验完成后，帮我准备切换方案和后续任务，先不要执行。',
]
type Props = {
  role: Role
  config: ModelConfig | null
  history: History
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
  question,
  setQuestion,
  refresh,
  openSource,
  propose,
  openSettings,
}: Props) {
  const [mode, setMode] = useState<'live' | 'rules'>(config?.mode || 'rules')
  const [busy, setBusy] = useState<'chat' | 'compare' | null>(null)
  const [error, setError] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [historical, setHistorical] = useState(false)
  async function submit(kind: 'chat' | 'compare') {
    if (!question.trim() || busy) return
    setError('')
    setBusy(kind)
    setRun(null)
    setComparison(null)
    setHistorical(false)
    try {
      if (kind === 'compare') {
        const result = await officeApi<{ comparison: Comparison }>(
          '/compare',
          role,
          { question: question.trim() }
        )
        setComparison(result.comparison)
      } else {
        const result = await officeApi<{ run: Run }>('/chat', role, {
          question: question.trim(),
          mode,
        })
        setRun(result.run)
      }
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className='grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_280px]'>
      <div className='min-w-0 space-y-5'>
        <Section
          title='围绕当前事项提问'
          aside={<Badge variant='outline'>SUP-001</Badge>}
        >
          <div className='space-y-4'>
            <div className='flex flex-wrap gap-2'>
              {prompts.map((prompt, index) => (
                <Button
                  variant='outline'
                  size='sm'
                  key={prompt}
                  onClick={() => setQuestion(prompt)}
                  disabled={!!busy}
                >
                  {
                    [
                      '分析到料影响',
                      '追溯会议决定',
                      '检查切换条件',
                      '准备后续任务',
                    ][index]
                  }
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
              placeholder='影响了哪些订单，上次会怎么定的，现在该找谁处理？'
              className='min-h-28 resize-y text-sm leading-7'
              disabled={!!busy}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit('chat')
                }
              }}
            />
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as 'live' | 'rules')}
                disabled={!!busy}
              >
                <SelectTrigger className='w-40' aria-label='助手运行模式'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='rules'>规则演示</SelectItem>
                  <SelectItem value='live'>真实模型</SelectItem>
                </SelectContent>
              </Select>
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  disabled={!!busy || !question.trim()}
                  onClick={() => void submit('compare')}
                >
                  <Columns2 className='size-4' />
                  同题真实对比
                </Button>
                <Button
                  disabled={!!busy || !question.trim()}
                  onClick={() => void submit('chat')}
                >
                  {busy === 'chat' ? (
                    <Loader2 className='size-4 animate-spin' />
                  ) : (
                    <ArrowUp className='size-4' />
                  )}
                  发送问题
                </Button>
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
              <span>
                {mode === 'rules'
                  ? '规则演示使用后台数据与规则，不计入真实助手验收。'
                  : '将调用已配置模型；运行失败会保留失败记录。'}
              </span>
              {!config?.keyConfigured && (
                <Button
                  variant='link'
                  className='h-auto p-0'
                  onClick={openSettings}
                >
                  尚未配置模型密钥
                </Button>
              )}
            </div>
            <p className='text-xs text-muted-foreground'>
              同题对比始终使用真实模型：同一问题、数据版本、角色与 4
              轮运行预算。不预设优劣。
            </p>
          </div>
        </Section>
        {busy && (
          <div
            role='status'
            className='flex items-center gap-3 rounded-lg border p-5 text-sm'
          >
            <Loader2 className='size-4 animate-spin' />
            <span>
              {busy === 'compare'
                ? '正在运行材料检索与本体增强两个分支…'
                : mode === 'live'
                  ? '模型正在读取资料并调用工具…'
                  : '正在读取演示后台并计算结果…'}
            </span>
          </div>
        )}
        <ErrorNotice message={error} />
        {run && (
          <Section
            title={historical ? '历史运行记录' : '处理建议'}
            aside={historical && <Badge variant='outline'>历史回放</Badge>}
          >
            <p className='mb-4 border-b pb-4 text-sm text-muted-foreground'>
              {run.question}
            </p>
            <RunContent run={run} openSource={openSource} propose={propose} />
          </Section>
        )}
        {comparison && (
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <Badge variant='outline'>
                {historical ? '历史回放' : '同题真实对比'}
              </Badge>
              <span>数据 v{comparison.revision}</span>
              <span className='text-muted-foreground'>{comparison.model}</span>
            </div>
            <p className='text-sm'>{comparison.question}</p>
            <div className='grid items-start gap-4 xl:grid-cols-2'>
              <Section title='材料检索'>
                <RunContent
                  run={comparison.baseline}
                  openSource={openSource}
                  propose={propose}
                />
              </Section>
              <Section title='本体增强'>
                <RunContent
                  run={comparison.ontology}
                  openSource={openSource}
                  propose={propose}
                />
              </Section>
            </div>
            <p className='text-sm text-muted-foreground'>
              材料检索按原始文档查询；本体增强增加对象关系和业务规则。工具调用与准备信息见各自记录，耗时不等同于整体交付成本。
            </p>
          </div>
        )}
        {!run && !comparison && !busy && !error && (
          <div className='flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center'>
            <MessageSquare className='mb-3 size-6 text-muted-foreground' />
            <p className='text-sm font-medium'>从一个具体问题开始</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              答案中的来源可以打开核对，业务操作仍需你检查并确认。
            </p>
          </div>
        )}
      </div>
      <Section title='当前空间的运行记录'>
        <div className='space-y-4'>
          {!history.runs.length && !history.comparisons.length && (
            <p className='text-sm text-muted-foreground'>暂无运行记录。</p>
          )}
          {history.runs
            .slice(0, 12)
            .map((item) => (
              <button
                key={item.id}
                className='block w-full rounded-md border p-3 text-start hover:bg-muted/40'
                disabled={!!busy}
                onClick={() => {
                  setRun(item)
                  setComparison(null)
                  setHistorical(true)
                  setError('')
                }}
              >
                <p className='line-clamp-2 text-sm leading-6'>
                  {item.question}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  {item.mode === 'live' ? '真实模型' : '规则演示'} · v
                  {item.revision} · {item.status === 'failed' ? '失败' : '完成'}
                </p>
              </button>
            ))}
          {history.comparisons
            .slice(0, 5)
            .map((item) => (
              <button
                key={item.id}
                className='block w-full rounded-md border p-3 text-start hover:bg-muted/40'
                disabled={!!busy}
                onClick={() => {
                  setComparison(item)
                  setRun(null)
                  setHistorical(true)
                  setError('')
                }}
              >
                <Badge variant='outline' className='mb-2'>
                  同题对比
                </Badge>
                <p className='line-clamp-2 text-sm leading-6'>
                  {item.question}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  数据 v{item.revision}
                </p>
              </button>
            ))}
        </div>
      </Section>
    </div>
  )
}

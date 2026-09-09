import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUp, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { officeApi, errorText } from './api'
import { ErrorNotice, RunContent, Section, Sources } from './shared'
import type {
  Action,
  History,
  ModelConfig,
  Role,
  Run,
  Snapshot,
  Source,
} from './types'

type Step = 'impact' | 'decisions' | 'paths'
const steps: { id: Step; title: string }[] = [
  { id: 'impact', title: '分析到料影响' },
  { id: 'decisions', title: '追溯会议决定' },
  { id: 'paths', title: '检查到料处置路径' },
]
type Props = {
  role: Role
  config: ModelConfig | null
  history: History
  snapshot: Snapshot
  autoStart: number
  onAutoStartHandled: () => void
  question: string
  setQuestion: (question: string) => void
  refresh: () => Promise<void>
  openSource: (source: Source) => void
  propose: (action: Action) => void
  openSettings: () => void
}
const source = (id: string, title: string): Source => ({ id, title })
const impactSources = [
  source('DOC-NOTICE', '采购延期通知样例'),
  source('DOC-LEDGER', '采购与订单台账样例'),
]
const meetingSources = [
  source('DOC-MEETING-01', '第一次会议记录 · DEC-01'),
  source('DOC-MEETING-02', '第二次会议记录 · DEC-02'),
]
const ruleSources = [
  source('DOC-LEDGER', '采购与订单台账样例'),
  source('DOC-RULES', '供应商切换与关闭规则'),
]

export function Assistant({
  role,
  config,
  history,
  snapshot,
  autoStart,
  onAutoStartHandled,
  question,
  setQuestion,
  refresh,
  openSource,
  propose,
  openSettings,
}: Props) {
  const [busy, setBusy] = useState<Step | 'chat' | null>(null)
  const busyRef = useRef(false)
  const consumedAutoStart = useRef(0)
  const [error, setError] = useState('')
  const [failedStep, setFailedStep] = useState<Step | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const { state, analysis, workflow } = snapshot
  const mode = config?.mode || 'rules'
  const progress = workflow.analysisStep
  const currentSupplier = state.suppliers.find(
    (item) => item.id === state.matter.supplierId
  )
  const supplierB = state.suppliers.find((item) => item.id === 'B')
  const qa = state.tasks.find((item) => item.id === 'T-QA')
  const closed = state.matter.status === 'closed'
  const latestStepRun = (step: Step) =>
    [run, ...history.runs].find(
      (item) => item?.step === step && item.status === 'completed'
    )

  async function guided(step: Step) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(step)
    setError('')
    setFailedStep(null)
    try {
      const result = await officeApi<{ run: Run }>('/guided', role, {
        step,
        mode,
        expectedVersion: state.revision,
        idempotencyKey: crypto.randomUUID(),
      })
      setRun(result.run)
      await refresh()
      if (result.run.status === 'failed') {
        setFailedStep(step)
        setError('本轮分析未完成，请重试，或在演示设置中切换运行模式。')
      }
    } catch (failure) {
      setError(errorText(failure))
      setFailedStep(step)
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  // Consume the navigation intent before starting: rerenders and StrictMode
  // effect replay must never submit the automatic analysis twice.
  useEffect(() => {
    if (
      !autoStart ||
      consumedAutoStart.current === autoStart ||
      busyRef.current
    )
      return
    consumedAutoStart.current = autoStart
    queueMicrotask(() => {
      onAutoStartHandled()
      if (progress === 0) void guided('impact')
    })
    // This effect handles a navigation intent, not snapshot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  async function submit() {
    if (!question.trim() || busyRef.current) return
    busyRef.current = true
    setBusy('chat')
    setError('')
    try {
      const result = await officeApi<{ run: Run }>('/chat', role, {
        question: question.trim(),
        mode,
      })
      setRun(result.run)
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  function evidence(step: Step, sources: Source[]) {
    const recorded = latestStepRun(step)
    return (
      <div className='space-y-3 border-t pt-4'>
        <Sources sources={sources} open={openSource} />
        {recorded && (
          <>
            {(recorded.resultRevision ?? recorded.revision) !==
              state.revision && (
              <p className='text-xs text-muted-foreground'>
                本轮解释基于历史数据；上方业务事实和右侧上下文已按当前状态更新。
              </p>
            )}
            <details className='text-sm'>
              <summary className='cursor-pointer text-muted-foreground'>
                查看本轮{recorded.mode === 'live' ? '模型解释' : '规则演示记录'}
              </summary>
              <div className='mt-4'>
                <RunContent run={recorded} openSource={openSource} />
              </div>
            </details>
          </>
        )}
      </div>
    )
  }

  return (
    <div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(260px,1fr)]'>
      <div className='min-w-0 space-y-5'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <p className='text-sm font-medium'>供应商延期处置</p>
            <p className='mt-1 text-xs text-muted-foreground'>
              按影响、依据和处置条件逐步核对
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>
              {mode === 'live' ? '真实模型' : '规则演示'}
            </Badge>
            <Button variant='link' size='sm' onClick={openSettings}>
              运行设置
            </Button>
          </div>
        </div>
        {progress === 0 && (
          <Section title='先核对延期影响'>
            <p className='text-sm leading-7'>
              供应商 A 原定 D
              {state.suppliers.find((item) => item.id === 'A')?.originalDay ??
                3}{' '}
              到料，最新通知为 D
              {state.suppliers.find((item) => item.id === 'A')?.arrivalDay}
              。完成分析后，再逐步核对关联订单与处理依据。
            </p>
            {!busy && !failedStep && (
              <a
                className='mt-4 inline-block text-sm underline underline-offset-4'
                href={`${import.meta.env.BASE_URL}office#home`}
              >
                返回办公协同，开始分析影响
              </a>
            )}
          </Section>
        )}
        {progress >= 1 && (
          <Section
            title='01 · 到料影响'
            aside={<Badge variant='outline'>当前业务事实</Badge>}
          >
            <div className='space-y-4'>
              <p className='text-base leading-7 font-semibold'>
                关联 {analysis.linkedCount} 条订单，其中 {analysis.riskCount}{' '}
                条存在当前方案到料风险。
              </p>
              <div className='overflow-x-auto'>
                <table className='w-full text-left text-sm'>
                  <thead className='border-b text-muted-foreground'>
                    <tr>
                      {['订单', '最迟到料', '当前方案到料', '判断'].map(
                        (label) => (
                          <th
                            className='px-2 py-3 font-normal whitespace-nowrap'
                            key={label}
                          >
                            {label}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.orders.map((order) => (
                      <tr className='border-b last:border-0' key={order.id}>
                        <td className='px-2 py-3 font-medium'>{order.id}</td>
                        <td className='px-2 py-3'>D{order.requiredDay}</td>
                        <td className='px-2 py-3'>D{order.arrivalDay}</td>
                        <td
                          className={`px-2 py-3 whitespace-nowrap ${order.atRisk ? 'text-destructive' : 'text-emerald-700'}`}
                        >
                          {order.atRisk
                            ? `晚 ${order.lateDays} 天`
                            : '满足要求'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className='text-sm leading-7 text-muted-foreground'>
                当前由供应商 {state.matter.supplierId} 供应，预计 D
                {currentSupplier?.arrivalDay}{' '}
                到料；逐条与订单最迟到料日比较。到料时间为当前预计，实际履约结果仍需后续跟进。
              </p>
              {evidence('impact', impactSources)}
            </div>
          </Section>
        )}
        {progress >= 2 && (
          <Section
            title='02 · 会议决定'
            aside={<Badge variant='outline'>当前业务事实</Badge>}
          >
            <div className='space-y-4'>
              {state.decisions.map((decision) => (
                <div className='rounded-lg border p-4' key={decision.id}>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm font-semibold'>{decision.id}</span>
                    <Badge variant='outline'>
                      {decision.id === 'DEC-02'
                        ? state.matter.supplierId === 'B'
                          ? '附条件候选方案 · 条件已落实'
                          : '附条件候选方案 · 未生效'
                        : decision.status === 'effective'
                          ? '当前有效决定'
                          : '已替代'}
                    </Badge>
                  </div>
                  <p className='mt-3 text-sm leading-7'>{decision.text}</p>
                </div>
              ))}
              <p className='text-sm leading-7'>
                {state.matter.supplierId === 'B'
                  ? `负责人已确认切换，当前以 ${analysis.effectiveDecisionId} 为准；较早会议记录保留。`
                  : 'DEC-02 记录时间较新，但没有获得切换批准，不能自动替代当前有效决定 DEC-01。'}
              </p>
              {evidence('decisions', meetingSources)}
            </div>
          </Section>
        )}
        {progress >= 3 && (
          <Section
            title='03 · 到料处置路径比较'
            aside={<Badge variant='outline'>当前业务事实</Badge>}
          >
            <div className='space-y-4'>
              <div className='grid gap-3 md:grid-cols-2'>
                {analysis.options.map((option) => (
                  <div
                    className='space-y-3 rounded-lg border p-4'
                    key={option.supplierId}
                  >
                    <h3 className='text-sm font-semibold'>
                      {option.supplierId === 'A'
                        ? '路径 A · 继续由 A 供应'
                        : '路径 B · 满足条件后切换 B'}
                    </h3>
                    <p className='text-sm'>
                      预计 D{option.arrivalDay} 到料 · {option.riskCount}{' '}
                      条到料风险
                    </p>
                    <p className='text-sm text-muted-foreground'>
                      {option.supplierId === 'A'
                        ? '供应资格有效'
                        : option.quality === 'approved'
                          ? '质量核验已通过'
                          : option.quality === 'rejected'
                            ? '质量核验未通过，本轮 B 路径不可执行'
                            : '质量资格待核验'}
                    </p>
                    <p className='text-sm text-muted-foreground'>
                      {state.matter.supplierId === option.supplierId
                        ? '当前执行路径'
                        : option.supplierId === 'B'
                          ? '负责人尚未批准 · 当前不能执行'
                          : '原路径已替代'}
                    </p>
                  </div>
                ))}
              </div>
              <p className='text-sm leading-7'>
                {supplierB?.quality === 'rejected'
                  ? 'B 质量核验未通过，当前继续执行 A。需补充依据并重新核验，不能批准切换。'
                  : state.matter.supplierId === 'B'
                    ? '质量核验与负责人批准均已完成，当前按 B 路径跟进采购与销售回执。'
                    : supplierB?.quality === 'approved'
                      ? 'B 质量核验已通过，下一步由业务负责人在办公协同首页确认切换。'
                      : `B 的预计到料日为 D${supplierB?.arrivalDay}，当前仍缺质量核验和负责人批准。`}
              </p>
              {evidence('paths', ruleSources)}
            </div>
          </Section>
        )}
        {closed && (
          <Section title='事项处理结果'>
            <div className='space-y-3 text-sm'>
              <p className='font-semibold'>
                {state.matter.id} 已完成 · 当前有效决定{' '}
                {analysis.effectiveDecisionId}
              </p>
              <p>
                当前供应商 {state.matter.supplierId}，预计 D
                {currentSupplier?.arrivalDay} 到料，{analysis.riskCount}{' '}
                条当前方案到料风险。
              </p>
              {state.tasks.map((task) => (
                <p key={task.id}>
                  {task.id} · {task.title} ·{' '}
                  {task.status === 'completed' ? '已完成' : '待处理'}
                  {task.receipt ? ' · 已有回执' : ''}
                </p>
              ))}
              <Sources
                sources={[
                  source('DOC-STATE', '事项状态与全部回执'),
                  source('DOC-DECISION-03', '负责人批准记录'),
                ]}
                open={openSource}
              />
              <p className='border-t pt-3 text-muted-foreground'>
                关闭表示办公协同事项处理完成，不代表实际采购到货、生产完成或订单交付。
              </p>
            </div>
          </Section>
        )}
        {busy && (
          <div
            role='status'
            className='flex items-center gap-3 rounded-lg border p-5 text-sm'
          >
            <Loader2 className='size-4 animate-spin' />
            {busy === 'chat'
              ? '正在查询当前事项…'
              : `正在${steps.find((item) => item.id === busy)?.title}…`}
          </div>
        )}
        <ErrorNotice message={error} />
        {run?.status === 'failed' && (
          <Section title='本次运行未完成'>
            <RunContent run={run} openSource={openSource} />
          </Section>
        )}
        {!closed && (
          <div className='flex flex-wrap items-center gap-3'>
            {failedStep ? (
              <Button disabled={!!busy} onClick={() => void guided(failedStep)}>
                重试{steps.find((item) => item.id === failedStep)?.title}
              </Button>
            ) : progress > 0 && progress < 3 ? (
              <Button
                disabled={!!busy}
                onClick={() => void guided(steps[progress].id)}
              >
                {steps[progress].title}
                <ArrowRight className='size-4' />
              </Button>
            ) : progress >= 3 &&
              (!qa || supplierB?.quality === 'rejected') &&
              ['lead', 'procurement'].includes(role) ? (
              <Button
                disabled={!!busy}
                onClick={() => propose({ type: 'request_quality' })}
              >
                {supplierB?.quality === 'rejected'
                  ? '重新发起质量核验'
                  : '发起质量核验'}
                <ArrowRight className='size-4' />
              </Button>
            ) : progress >= 3 ? (
              <a
                href={`${import.meta.env.BASE_URL}office#home`}
                className='text-sm underline underline-offset-4'
              >
                返回办公协同，查看当前待办
              </a>
            ) : null}
          </div>
        )}
        <Section title='继续问当前事项'>
          <div className='space-y-3'>
            <label htmlFor='office-question' className='sr-only'>
              业务问题
            </label>
            <Textarea
              id='office-question'
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder='例如：这件事现在处理到哪里了？'
              className='min-h-24 resize-y text-sm leading-7'
              disabled={!!busy}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p className='text-xs text-muted-foreground'>
                回答可追溯来源，业务操作需人工确认。
              </p>
              <Button
                size='sm'
                variant='outline'
                disabled={!!busy || !question.trim()}
                onClick={() => void submit()}
              >
                <ArrowUp className='size-4' />
                发送问题
              </Button>
            </div>
          </div>
        </Section>
        {run && !run.step && run.status !== 'failed' && (
          <Section title='查询结果'>
            {run.revision !== state.revision && (
              <p className='mb-4 text-xs text-muted-foreground'>
                此回答对应历史状态，当前事实请以右侧上下文为准。
              </p>
            )}
            <RunContent run={run} openSource={openSource} />
          </Section>
        )}
      </div>
      <div className='min-w-0 space-y-5 xl:sticky xl:top-6'>
        <Section
          title='当前事项上下文'
          aside={<Badge variant='outline'>{state.matter.id}</Badge>}
        >
          <dl className='space-y-4 text-sm'>
            {[
              ['事项状态', workflow.label],
              ['当前供应商', `供应商 ${state.matter.supplierId}`],
              [
                '当前有效决定',
                progress >= 2 ? analysis.effectiveDecisionId : '待核对',
              ],
              [
                '关联订单',
                progress >= 1 ? `${analysis.linkedCount} 条` : '待分析',
              ],
              [
                '当前到料风险',
                progress >= 1 ? `${analysis.riskCount} 条` : '待分析',
              ],
              ['待处理动作', `${workflow.pendingActionCount} 项`],
            ].map(([label, value]) => (
              <div
                className='flex items-start justify-between gap-4'
                key={label}
              >
                <dt className='text-muted-foreground'>{label}</dt>
                <dd className='text-right font-medium'>{value}</dd>
              </div>
            ))}
          </dl>
          <p className='mt-5 border-t pt-4 text-xs leading-6 text-muted-foreground'>
            当前上下文与办公协同、事项详情同步。
          </p>
        </Section>
        {progress >= 3 && (
          <Section title='当前条件'>
            <div className='space-y-3 text-sm'>
              <p>
                质量核验：
                {supplierB?.quality === 'approved'
                  ? '已通过'
                  : supplierB?.quality === 'rejected'
                    ? '未通过'
                    : '待核验'}
              </p>
              <p>
                负责人批准：
                {state.matter.supplierId === 'B' ? '已批准' : '尚未批准'}
              </p>
              <p className='leading-7 text-muted-foreground'>
                {analysis.nextStep}
              </p>
              {workflow.missingReceipts.length > 0 &&
                state.matter.supplierId === 'B' && (
                  <p className='text-amber-700'>
                    待补回执：{workflow.missingReceipts.join('、')}
                  </p>
                )}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

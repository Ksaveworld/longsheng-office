import { useRef } from 'react'
import { ArrowUp, Loader2, MessageSquare, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { officeApi, errorText } from './api'
import { Orders, Paths, RoleAction, Tasks } from './business'
import { ErrorNotice, RunContent, Section, Sources, Status } from './shared'
import {
  roleNames,
  type Action,
  type AssistantSession,
  type History,
  type ModelConfig,
  type Role,
  type Run,
  type Snapshot,
  type Source,
  type Task,
} from './types'
import { ReviewSummary, WorkflowProgress } from './workflow-overview'

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
  session: AssistantSession
  updateSession: (patch: Partial<AssistantSession>) => void
  sources: Source[]
  refresh: () => Promise<void>
  openSource: (source: Source) => void
  propose: (action: Action, expectedVersion?: number) => void
  openSettings: () => void
  giveReceipt: (task: Task) => void
  viewMatter: () => void
  actionBusy: boolean
}
export function Assistant({
  role,
  config,
  history,
  snapshot,
  session,
  updateSession,
  sources,
  refresh,
  openSource,
  propose,
  openSettings,
  giveReceipt,
  viewMatter,
  actionBusy,
}: Props) {
  const lock = useRef(false)
  const {
    busy,
    error,
    run,
    historical,
    failedQuestion,
    snapshotReady,
    question,
    planReason,
  } = session
  const setBusy = (busy: boolean) => updateSession({ busy })
  const setError = (error: string) => updateSession({ error })
  const setRun = (run: Run | null) => updateSession({ run })
  const setHistorical = (historical: boolean) => updateSession({ historical })
  const setFailedQuestion = (failedQuestion: string) =>
    updateSession({ failedQuestion })
  const setSnapshotReady = (snapshotReady: boolean) =>
    updateSession({ snapshotReady })
  const setQuestion = (question: string) => updateSession({ question })
  const { state, analysis } = snapshot
  const act = (action: Action) => propose(action, state.revision)
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const plan =
    state.matter.planSelection?.supplierId ??
    (qa || state.matter.supplierId === 'B' ? 'B' : undefined)
  const planLocked =
    state.matter.status === 'closed' || analysis.executionApproved
  const canSelect = ['lead', 'procurement'].includes(role) && !planLocked
  const qaActive = !!qa && qa.status !== 'completed'
  const ownHistory = history.runs.filter(
    (item) =>
      item.role === role &&
      item.mode === config?.mode &&
      item.variant === 'ontology'
  )
  const stale = !!run && run.revision !== state.revision
  const canContinue =
    !!run &&
    run.status === 'completed' &&
    run.role === role &&
    !historical &&
    !stale &&
    snapshotReady &&
    !error
  const prepare = (action: Action) => propose(action, run?.revision)

  async function submit(input = question) {
    const requested = input.trim()
    if (!requested || busy || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setFailedQuestion('')
    setSnapshotReady(false)
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
      setSnapshotReady(true)
    } catch (failure) {
      setError(errorText(failure))
      setFailedQuestion(requested)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <div className='space-y-6'>
      <WorkflowProgress snapshot={snapshot} />
      <div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,1fr)]'>
        <div className='min-w-0 space-y-5'>
          <div id='workflow-notice' className='scroll-mt-24'>
            <Section title='延期通知与当前事项'>
              <p className='text-sm leading-7'>
                原料 {state.matter.materialId} · 供应商 A 原定 D
                {state.suppliers.find((s) => s.id === 'A')?.originalDay}
                ，当前预计 D
                {state.suppliers.find((s) => s.id === 'A')?.arrivalDay} 到料。
              </p>
              <div className='mt-3'>
                <Sources
                  sources={sources.filter((s) => s.id === 'DOC-NOTICE')}
                  open={openSource}
                />
              </div>
            </Section>
          </div>
          <Section
            title='围绕当前事项提问'
            aside={<Badge variant='outline'>{state.matter.id}</Badge>}
          >
            <div className='space-y-4'>
              <p className='text-sm leading-6 text-muted-foreground'>
                {state.matter.title} · {roleNames[role]} · 数据 v
                {state.revision}
                <br />
                {analysis.nextStep}
              </p>
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
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === 'Enter'
                  ) {
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
            <div role='region' aria-label='当前分析结果'>
              <Section
                title={historical ? '历史回答' : '查询结果'}
                aside={
                  historical ? (
                    <Badge variant='outline'>历史记录</Badge>
                  ) : undefined
                }
              >
                <p className='mb-4 border-b pb-4 text-sm text-muted-foreground'>
                  {run.question}
                </p>
                {stale && (
                  <p className='mb-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground'>
                    此回答基于数据 v{run.revision}；当前事项已更新为 v
                    {state.revision}
                    。原回答保留，旧模型建议不可执行；办理区按最新业务事实更新，无需为每个操作重复提问。
                  </p>
                )}
                <RunContent
                  run={run}
                  openSource={openSource}
                  propose={
                    canContinue && !busy && !actionBusy ? prepare : undefined
                  }
                />
              </Section>
            </div>
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
          <div id='workflow-impact' className='scroll-mt-24'>
            <Section
              title='到料影响'
              aside={<Badge variant='outline'>按当前方案计算</Badge>}
            >
              <Orders snapshot={snapshot} />
              <div className='mt-4'>
                <Sources
                  sources={sources.filter((s) => s.id === 'DOC-LEDGER')}
                  open={openSource}
                />
              </div>
            </Section>
          </div>
          <div id='workflow-decisions' className='scroll-mt-24'>
            <Section title='会议决定与依据'>
              <div className='divide-y'>
                {state.decisions.map((decision) => (
                  <div
                    key={decision.id}
                    className='space-y-3 py-4 first:pt-0 last:pb-0'
                  >
                    <div className='flex flex-wrap gap-2 text-sm font-medium'>
                      {decision.id}
                      <Status value={decision.status} />
                    </div>
                    <p className='text-sm leading-7'>{decision.text}</p>
                    <Sources
                      sources={sources.filter(
                        (s) => s.id === decision.sourceId
                      )}
                      open={openSource}
                    />
                  </div>
                ))}
              </div>
            </Section>
          </div>
          <div id='workflow-plans' className='scroll-mt-24 space-y-4'>
            <Paths snapshot={snapshot} />
            <Section
              title='选择处理方案'
              aside={
                <Badge variant='outline'>
                  {plan ? `已选 ${plan}` : '待选择'}
                </Badge>
              }
            >
              {state.matter.planSelection && (
                <p className='mb-4 text-sm leading-7'>
                  选择原因：{state.matter.planSelection.reason}
                </p>
              )}
              {canSelect ? (
                <div className='space-y-4'>
                  <label
                    htmlFor='office-plan-reason'
                    className='text-sm font-medium'
                  >
                    本次选择或改选的原因（必填）
                  </label>
                  <Textarea
                    id='office-plan-reason'
                    value={planReason}
                    maxLength={4000}
                    onChange={(e) =>
                      updateSession({ planReason: e.target.value })
                    }
                    placeholder='说明选择依据、待确认条件或保留的到料风险'
                  />
                  <div className='flex flex-wrap gap-3'>
                    <Button
                      variant='outline'
                      disabled={
                        actionBusy ||
                        !planReason.trim() ||
                        plan === 'A' ||
                        qaActive
                      }
                      onClick={() =>
                        act({
                          type: 'select_plan',
                          supplierId: 'A',
                          evidence: planReason,
                        })
                      }
                    >
                      选择 A · 沿用并跟进
                    </Button>
                    <Button
                      disabled={
                        actionBusy || !planReason.trim() || plan === 'B'
                      }
                      onClick={() =>
                        act({
                          type: 'select_plan',
                          supplierId: 'B',
                          evidence: planReason,
                        })
                      }
                    >
                      选择 B · 准备切换
                    </Button>
                  </div>
                  <p className='text-xs leading-6 text-muted-foreground'>
                    {qaActive
                      ? '质量核验正在办理，暂不能改选 A；须先形成核验结果。'
                      : '选择只记录处理意向；B 仍需核验与批准，A 仍需负责人确认跟进安排。'}
                  </p>
                </div>
              ) : (
                <p className='text-sm leading-7 text-muted-foreground'>
                  {planLocked
                    ? '执行方案已确认，选择记录已留档。'
                    : '由采购经办或业务负责人选择方案，当前岗位可核对比较依据。'}
                </p>
              )}
            </Section>
          </div>
          <div id='workflow-tasks' className='scroll-mt-24'>
            <Section title='采购、销售任务与处理回执'>
              <Tasks
                snapshot={snapshot}
                role={role}
                busy={actionBusy}
                propose={act}
                giveReceipt={giveReceipt}
                readOnly
              />
            </Section>
          </div>
          <div id='workflow-review' className='scroll-mt-24'>
            <ReviewSummary
              snapshot={snapshot}
              sources={sources}
              openSource={openSource}
            />
          </div>
        </div>
        <div className='min-w-0 space-y-5 xl:sticky xl:top-20'>
          <div role='region' aria-label='下一步处理'>
            <RoleAction
              title='下一步处理'
              snapshot={snapshot}
              role={role}
              busy={actionBusy}
              propose={act}
              giveReceipt={giveReceipt}
            />
          </div>
          <div id='workflow-quality' className='scroll-mt-24'>
            <Section title='质量条件'>
              <p className='text-sm leading-7'>
                {plan === 'A'
                  ? '沿用 A 已批准的质量资格，无需为保留 A 伪造 B 核验。'
                  : qa
                    ? `B 核验任务 ${qa.id}，当前${qa.qualityResult === 'approved' ? '已通过' : qa.qualityResult === 'rejected' ? '未通过' : '等待处理'}。`
                    : '尚未形成 B 核验任务；选择 B 后发起核验。'}
              </p>
              <div className='mt-3'>
                <Sources
                  sources={sources.filter((s) => s.id === 'QA-B-001')}
                  open={openSource}
                />
              </div>
            </Section>
          </div>
          <div id='workflow-approval' className='scroll-mt-24'>
            <Section title='负责人确认'>
              <p className='text-sm leading-7'>
                {analysis.executionApproved
                  ? `已确认按供应商 ${state.matter.supplierId} 的方案跟进。`
                  : '选择方案尚不构成批准，完成前置条件后由业务负责人明确确认。'}
              </p>
              <div className='mt-3'>
                <Sources
                  sources={sources.filter((s) =>
                    ['DOC-KEEP-A', 'DOC-DECISION-03'].includes(s.id)
                  )}
                  open={openSource}
                />
              </div>
            </Section>
          </div>
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
            <Button className='mt-4' variant='outline' onClick={viewMatter}>
              查看事项全过程
            </Button>
          </Section>
          <details className='rounded-lg border p-4'>
            <summary className='cursor-pointer text-sm font-medium'>
              历史问答{' '}
              <span className='ml-1 text-muted-foreground'>
                {ownHistory.length}
              </span>
            </summary>
            <div className='mt-4 space-y-2'>
              {!ownHistory.length && (
                <p className='text-sm text-muted-foreground'>暂无历史问答。</p>
              )}
              {ownHistory.slice(0, 20).map((item) => (
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
    </div>
  )
}

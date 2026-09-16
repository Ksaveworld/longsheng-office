import { useEffect } from 'react'
import { ArrowRight, Clock3, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EventDetail } from './event-view'
import { OfficeGraph } from './graph'
import { Section, Sources, Status } from './shared'
import {
  roleNames,
  showValue,
  type Action,
  type Role,
  type Snapshot,
  type Source,
  type Task,
} from './types'

export type BusinessProps = {
  snapshot: Snapshot
  role: Role
  busy: boolean
  sources: Source[]
  propose: (action: Action) => void
  openSource: (source: Source) => void
  giveReceipt: (task: Task) => void
  ask: (question: string) => void
  viewMatter: (id?: string, eventId?: string) => void
}

function receiptText(receipt: unknown) {
  return showValue(
    receipt && typeof receipt === 'object' && 'evidence' in receipt
      ? receipt.evidence
      : receipt
  )
}
function taskLabel(task: Task, closed: boolean) {
  if (task.selectionInvalidated) return '历史任务 · 方案已改选'
  if (task.id !== 'T-QA' && task.receipt && !closed) return '已提交，待复核'
  if (task.status === 'delivery_failed') return '待处理 · 通知发送失败'
  if (task.status === 'delivered') return '待接收'
  if (task.status === 'accepted') return '已接收，待开始'
  if (task.status === 'in_progress') return '处理中'
  if (task.qualityResult === 'rejected') return '核验不通过'
  if (task.status === 'completed')
    return task.id === 'T-QA' ? '核验通过' : '已完成'
  if (task.status === 'awaiting_review') return '已提交，待复核'
  return '待发送'
}
function Receipt({ task }: { task: Task }) {
  const history =
    (
      task as Task & {
        history?: {
          receipt?: unknown
          qualityResult?: string
          status?: string
          archivedAt?: string
          archiveReason?: string
          completedAt?: string
        }[]
      }
    ).history ?? []
  return (
    <div className='space-y-3 text-sm'>
      {!!task.receipt && (
        <details>
          <summary className='cursor-pointer underline decoration-border underline-offset-4'>
            查看回执
          </summary>
          {!!task.receipt && typeof task.receipt === 'object' && (
            <p className='mt-2 text-muted-foreground'>
              {roleNames[(task.receipt as { actor: Role }).actor]} ·{' '}
              {new Date((task.receipt as { at: string }).at).toLocaleString(
                'zh-CN'
              )}
            </p>
          )}
          {task.qualityResult && (
            <p className='mt-3 font-medium'>
              核验结论：{task.qualityResult === 'approved' ? '通过' : '不通过'}
            </p>
          )}
          <p className='mt-2 break-words whitespace-pre-wrap text-muted-foreground'>
            {receiptText(task.receipt)}
          </p>
        </details>
      )}
      {history.length > 0 && (
        <details>
          <summary className='cursor-pointer text-muted-foreground'>
            {task.id === 'T-QA' ? '历史核验' : '历史处理记录'} · {history.length} 次
          </summary>
          <div className='mt-3 space-y-3'>
            {history.map((item, index) => (
              <div key={index} className='border-l-2 pl-3'>
                <p>
                  第 {index + 1} 次 ·{' '}
                  {task.id !== 'T-QA' ? (item.receipt ? '已留存处理回执' : '原任务状态已留存') : item.qualityResult === 'approved'
                    ? '通过'
                    : item.qualityResult === 'rejected'
                      ? '不通过'
                      : '未记录结论'}
                </p>
                {item.archiveReason && <p className='mt-1 text-muted-foreground'>{item.archiveReason}</p>}
                <p className='mt-1 break-words whitespace-pre-wrap text-muted-foreground'>
                  {receiptText(item.receipt)}
                </p>
                {(item.completedAt || item.archivedAt) && (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {new Date(item.completedAt || item.archivedAt!).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
function TaskAction({
  task,
  snapshot,
  propose,
  giveReceipt,
  busy,
}: Pick<
  BusinessProps,
  'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
> & { task: Task }) {
  const action = snapshot.presentation.actions.find((a) => a.taskId === task.id)
  if (!action) return null
  return (
    <Button
      disabled={busy}
      onClick={() =>
        ['submit_quality', 'submit_receipt'].includes(action.type)
          ? giveReceipt(task)
          : propose({ type: action.type, taskId: task.id })
      }
    >
      {action.label}
    </Button>
  )
}
export function Orders({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>关联订单</TableHead>
            <TableHead>最迟到料</TableHead>
            <TableHead>当前方案预计到料</TableHead>
            <TableHead>判断</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.analysis.orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell className='font-medium'>{order.id}</TableCell>
              <TableCell>D{order.requiredDay}</TableCell>
              <TableCell>D{order.arrivalDay}</TableCell>
              <TableCell>
                {order.atRisk ? (
                  <Badge variant='destructive'>晚 {order.lateDays} 天</Badge>
                ) : (
                  <span className='text-sm text-muted-foreground'>
                    满足到料要求
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
export function Tasks(
  props: Pick<
    BusinessProps,
    'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
  > & { readOnly?: boolean }
) {
  const { snapshot, readOnly } = props
  const closed = snapshot.state.matter.status === 'closed'
  if (!snapshot.state.tasks.length)
    return <p className='text-sm text-muted-foreground'>尚未发起任务。</p>
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务</TableHead>
            <TableHead>负责岗位</TableHead>
            <TableHead>处理状态</TableHead>
            <TableHead>通知状态</TableHead>
            {!readOnly && <TableHead className='text-right'>操作</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.state.tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className='min-w-48'>
                <p className='font-medium'>{task.title}</p>
                <p className='mt-1 mb-2 text-xs text-muted-foreground'>
                  {task.id}
                </p>
                <Receipt task={task} />
              </TableCell>
              <TableCell className='whitespace-nowrap'>
                {roleNames[task.assignee]}
              </TableCell>
              <TableCell className='whitespace-nowrap'>
                <Badge
                  variant={
                    task.status === 'delivery_failed' ||
                    task.qualityResult === 'rejected'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {!closed && task.id !== 'T-QA' && snapshot.state.matter.executionApproval && !snapshot.analysis.executionApproved
                    ? '历史执行记录 · 待重新批准'
                    : snapshot.graph.objects.find(object => object.id === `Task:${task.id}`)?.properties.selectionInvalidated
                      ? '历史任务 · 方案已改选'
                      : taskLabel(task, closed)}
                </Badge>
              </TableCell>
              <TableCell className='text-sm text-muted-foreground'>
                {task.status === 'delivery_failed' ? (
                  <span className='text-destructive'>
                    发送失败 · {task.attempts} 次
                  </span>
                ) : task.status === 'pending_delivery' ? (
                  '待发送'
                ) : (
                  '已送达'
                )}
              </TableCell>
              {!readOnly && (
                <TableCell>
                  <div className='flex justify-end'>
                    <TaskAction {...props} task={task} />
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
export function Paths({ snapshot }: { snapshot: Snapshot }) {
  const { state, analysis } = snapshot
  return (
    <Section title='方案预期对比'>
      <p className='mb-4 text-sm leading-6 text-muted-foreground'>
        A/B 同按数据 v{state.revision}{' '}
        计算。预计日期及风险差异不代表已到货或实际避免损失。
      </p>
      <div className='grid gap-4 md:grid-cols-2'>
        {analysis.options.map((option) => {
          const selected = state.matter.supplierId === option.supplierId
          return (
            <div
              key={option.supplierId}
              className={
                'rounded-lg border p-4 ' +
                (selected ? 'border-foreground/25 bg-muted/20' : '')
              }
            >
              <div className='flex items-center justify-between gap-3'>
                <h3 className='text-sm font-semibold'>{option.name}</h3>
                <Badge variant={selected ? 'default' : 'outline'}>
                  {selected
                    ? '当前生效'
                    : option.supplierId === 'B'
                      ? '候选方案'
                      : '原方案'}
                </Badge>
              </div>
              {state.matter.planSelection?.supplierId === option.supplierId && (
                <p className='mt-2 text-xs font-medium'>
                  已选择此处理方案
                  {!analysis.executionApproved
                    ? ' · 待完成前置条件与负责人确认'
                    : ''}
                </p>
              )}
              <p className='mt-4 text-sm'>
                预计{' '}
                <strong className='text-xl tabular-nums'>
                  D{option.arrivalDay}
                </strong>{' '}
                到料{' '}
                <span className='ml-3 text-muted-foreground'>
                  {option.riskCount} 条风险订单
                </span>
              </p>
              <div className='mt-4 space-y-2 border-t pt-4'>
                {analysis.orders.map((order) => (
                  <div
                    key={order.id}
                    className='flex flex-wrap justify-between gap-2 text-sm'
                  >
                    <span>
                      {order.id} · 最迟 D{order.requiredDay}
                    </span>
                    <span
                      className={
                        option.arrivalDay > order.requiredDay
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      {option.arrivalDay > order.requiredDay
                        ? '晚 ' +
                          (option.arrivalDay - order.requiredDay) +
                          ' 天'
                        : '满足到料要求'}
                    </span>
                  </div>
                ))}
              </div>
              <div className='mt-4 space-y-2 border-t pt-4 text-sm'>
                <p>方案核验条件：所有版本均需质量岗位人工核验。</p>
                <p className='text-muted-foreground'>
                  选择意向、方案核验和负责人批准分别记录。
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <p className='mt-4 text-xs leading-5 text-muted-foreground'>
        比较范围：到料时间、方案核验条件、批准条件；未包含价格、产能及运输条件。
      </p>
    </Section>
  )
}
export function Matter(props: BusinessProps) {
  return props.snapshot.state.scenario ? <EventDetail {...props}/> : <SupplyMatter {...props}/>
}
function SupplyMatter(props: BusinessProps) {
  const { snapshot, sources, openSource, ask } = props
  const { state, analysis, presentation: p } = snapshot
  const closed = state.matter.status === 'closed',
    outcome = state.matter.outcome
  const effective = state.decisions.find((d) => d.status === 'effective')
  const archived = outcome?.analysis || analysis
  const approvedPlan = outcome?.plan || state.planVersions.find(v => v.id === state.matter.executionApproval?.planVersionId)
  const approvedPlanNumber = approvedPlan ? state.planVersions.filter(v => v.supplierId === approvedPlan.supplierId).findIndex(v => v.id === approvedPlan.id) + 1 : 0
  const approval = outcome?.approval || state.matter.executionApproval
  const evidenceSources = (ids: string[] | undefined) => (
    <Sources
      sources={sources.filter((s) => ids?.includes(s.id))}
      open={openSource}
    />
  )
  useEffect(() => {
    const id = new URLSearchParams(location.hash.split('?')[1] || '').get(
      'event'
    )
    if (!id) return
    const entry = document.getElementById('event-' + id)
    const details = entry?.closest('details')
    if (details) details.open = true
    entry?.scrollIntoView({ block: 'center' })
  }, [state.matter.id])
  return (
    <div className='office-matter min-w-0 space-y-6'>
      <div className='rounded-xl border bg-card p-5 sm:p-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-semibold'>
              {closed ? '办公协同处理结果' : p.title}
            </h2>
            <p className='mt-2 text-sm text-muted-foreground'>
              {state.matter.id} · 原料 {state.matter.materialId} ·
              供应商交期变更
            </p>
          </div>
          <Badge variant='outline'>{p.stage}</Badge>
        </div>
        <p className='mt-5 text-base leading-7'>{p.conclusion}</p>
        {closed ? (
          <div className='mt-5 grid gap-4 border-t pt-5 sm:grid-cols-3'>
            <div>
              <p className='text-sm text-muted-foreground'>已批准方案</p>
              <p className='mt-1 text-lg font-semibold'>
                {approvedPlan?.title || '历史批准记录'}
              </p>
              {approvedPlanNumber > 0 && <p className='mt-1 text-sm text-muted-foreground'>该路径第 {approvedPlanNumber} 版</p>}
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>关闭时到料风险</p>
              <p className='mt-1 text-lg font-semibold'>
                {outcome?.review.riskCount ??
                  state.matter.review?.riskCount ??
                  '历史记录未提供'}{' '}
                条
              </p>
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>最终复核</p>
              <p className='mt-1 text-lg font-semibold'>
                {state.matter.review
                  ? roleNames[state.matter.review.reviewedBy]
                  : '历史记录未提供'}
              </p>
            </div>
          </div>
        ) : (
          <div className='mt-4 rounded-lg bg-muted/50 p-4 text-sm leading-6'>
            <strong>
              当前等待：
              {p.waitingRoles.map((r) => roleNames[r]).join('、') ||
                '查看处理记录'}
            </strong>
            {p.blockers.map((b, i) => (
              <p key={i} className='mt-2'>
                {b}
              </p>
            ))}
          </div>
        )}
        {closed && (
          <p className='mt-4 text-sm text-muted-foreground'>
            {outcome
              ? '结果保留关闭当时的数据版本 v' + outcome.revision + '。'
              : '此事项沿用已有历史记录，未补造结果快照。'}{' '}
            协同办结不代表原料到货、风险已消除或订单交付。
          </p>
        )}
      </div>
      {closed && (
        <Section title='已收到的处理证据'>
          <div className='grid gap-4 md:grid-cols-2'>
            {(
              outcome?.receipts ||
              state.tasks
                .filter((t) => ['T-PUR', 'T-SALES'].includes(t.id) && t.receipt)
                .map((t) => ({
                  taskId: t.id,
                  title: t.title,
                  ...(t.receipt as {
                    evidence: string
                    actor: Role
                    at: string
                    sourceIds?: string[]
                  }),
                }))
            ).map((r) => (
              <article key={r.taskId} className='min-w-0 rounded-lg border p-4'>
                <div className='flex items-center gap-2'>
                  <CheckCircle2 className='size-4 text-emerald-700' />
                  <h3 className='font-semibold'>
                    {r.taskId === 'T-PUR' ? '采购跟进安排' : '销售同步结果'}
                  </h3>
                </div>
                <p className='mt-3 text-sm leading-7 break-words whitespace-pre-wrap'>
                  {r.evidence}
                </p>
                <p className='mt-3 text-sm text-muted-foreground'>
                  {roleNames[r.actor]} ·{' '}
                  {new Date(r.at).toLocaleString('zh-CN')}
                </p>
                <div className='mt-3'>{evidenceSources(r.sourceIds)}</div>
              </article>
            ))}
          </div>
          {state.matter.review && (
            <p className='mt-4 text-sm leading-7'>
              负责人于{' '}
              {new Date(state.matter.review.reviewedAt).toLocaleString('zh-CN')}{' '}
              复核两份回执。
              {(outcome?.review.riskCount ?? state.matter.review.riskCount) > 0
                ? '当前档案仍保留到料风险，应继续跟进实际到货。'
                : '按关闭时台账未发现预计到料超期，实际收货及订单履约需另行核实。'}
            </p>
          )}
        </Section>
      )}
      <Section title='起因与影响'>
        <p className='mb-4 text-base leading-7'>
          供应商 A 通知预计到料由 D{p.originalDay} 变为 D{p.noticeArrivalDay}。
          {closed ? '关闭时' : '当前'}生效方案{' '}
          {outcome?.selection?.supplierId || state.matter.supplierId} 关联{' '}
          {archived.linkedCount} 条订单，{archived.riskCount} 条存在到料风险。
        </p>
        <Orders snapshot={{ ...snapshot, analysis: archived }} />
        <p className='mt-3 text-sm text-muted-foreground'>
          D 为相对演示日期。到料超期不等同于成品交付延期。
        </p>
        <div className='mt-4'>
          {evidenceSources(
            sources
              .filter((s) =>
                ['DOC-NOTICE', 'DOC-LEDGER'].some(
                  (id) => s.id === id || s.id === id + '-' + state.matter.id
                )
              )
              .map((s) => s.id)
          )}
        </div>
      </Section>
      <Section title='方案与决定'>
        <div className='grid gap-5 sm:grid-cols-3'>
          {[
            ['当前生效', state.matter.supplierId],
            ['选择意向', state.matter.planSelection?.supplierId || '尚未选择'],
            [
              '本次批准',
              analysis.executionApproved ? state.matter.supplierId : '尚未批准',
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <p className='text-sm text-muted-foreground'>{label}</p>
              <p className='mt-2 text-lg font-semibold'>{value}</p>
            </div>
          ))}
        </div>
        <p className='mt-5 border-t pt-4 text-base leading-7'>
          {(outcome?.decision || effective)?.text}
        </p>
        {state.matter.planSelection && (
          <p className='mt-3 text-sm leading-7'>
            选择依据：
            {outcome?.selection?.reason || state.matter.planSelection.reason}
          </p>
        )}
        {approval && <p className='mt-3 text-sm leading-7'>
          批准记录：{roleNames[approval.approvedBy]}于 {new Date(approval.approvedAt).toLocaleString('zh-CN')} 批准该版本。
          {outcome?.qualityReview ? `质量核验依据：${outcome.qualityReview.evidence}` : '方案核验依据可在下方记录中复核。'}
        </p>}
        <div className='mt-4'>
          {evidenceSources(
            sources
              .filter((s) =>
                [
                  effective?.sourceId,
                  'DOC-PLAN-SELECTION',
                  'DOC-KEEP-A',
                  'QA-B-001',
                  'DOC-DECISION-03',
                ].some(
                  (id) =>
                    id && (s.id === id || s.id === id + '-' + state.matter.id)
                )
              )
              .map((s) => s.id)
          )}
        </div>
        <details className='mt-5 border-t pt-4'>
          <summary className='cursor-pointer font-medium'>
            方案核验依据 · {state.planReviews.length} 次
          </summary>
          <div className='mt-4 space-y-4'>
            {state.planReviews.map((r, i) => (
              <article
                key={r.id}
                className='rounded-lg border p-4 text-sm leading-7'
              >
                <strong>
                  第 {i + 1} 次 · {r.result === 'approved' ? '通过' : '不通过'}{' '}
                  ·{' '}
                  {r.planVersionId === state.matter.planSelection?.planVersionId
                    ? '当前选择版本'
                    : '历史版本'}
                </strong>
                <p>
                  {
                    state.planVersions.find((v) => v.id === r.planVersionId)
                      ?.title
                  }
                </p>
                <p className='whitespace-pre-wrap'>{r.evidence}</p>
                <p className='text-muted-foreground'>
                  {roleNames[r.reviewedBy]} ·{' '}
                  {new Date(r.reviewedAt).toLocaleString('zh-CN')}
                </p>
                {evidenceSources(r.sourceIds)}
              </article>
            ))}
            {!state.planReviews.length && (
              <p className='text-sm text-muted-foreground'>
                尚无方案核验记录。
              </p>
            )}
          </div>
        </details>
        <details className='mt-5 border-t pt-4'>
          <summary className='cursor-pointer font-medium'>
            查看方案预期差异与历史决定
          </summary>
          <div className='mt-4 space-y-4'>
            <Paths snapshot={snapshot} />
            {state.decisions
              .filter((d) => d.id !== effective?.id)
              .map((d) => (
                <article key={d.id} className='rounded-lg border p-4'>
                  <p className='flex items-center gap-3'>
                    {d.id}
                    <Status value={d.status} />
                  </p>
                  <p className='my-3 text-sm leading-7'>{d.text}</p>
                  {evidenceSources(
                    sources
                      .filter(
                        (s) =>
                          s.id === d.sourceId ||
                          s.id === d.sourceId + '-' + state.matter.id
                      )
                      .map((s) => s.id)
                  )}
                </article>
              ))}
          </div>
        </details>
      </Section>
      <Section title='执行与证据'>
        <p className='mb-4 text-base leading-7'>
          {closed ? '已完成岗位办理及负责人复核。' : p.blockers.join(' ')}
        </p>
        <Tasks {...props} readOnly />
      </Section>
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-base font-semibold'>
          来源与处理记录 · {state.events.length} 条
        </summary>
        <div className='mt-5 space-y-5'>
          <Sources sources={sources} open={openSource} />
          <ol className='space-y-5'>
            {[...state.events].reverse().map((event) => (
              <li
                id={'event-' + event.id}
                key={event.id}
                className='flex scroll-mt-8 gap-3 rounded-lg p-3 target:bg-muted'
              >
                <Clock3 className='mt-1 size-4 shrink-0 text-muted-foreground' />
                <div className='min-w-0'>
                  <p className='font-medium'>
                    {p.events.find((e) => e.id === event.id)?.summary}
                  </p>
                  <p className='mt-2 text-sm leading-7 break-words'>
                    {event.message}
                  </p>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {roleNames[event.actor as Role]} ·{' '}
                    {new Date(event.at).toLocaleString('zh-CN')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </details>
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-base font-semibold'>
          高级视图 · 业务关系 / 业务对象 / 模型结构
        </summary>
        <p className='mt-4 text-sm leading-7'>
          从延期通知关联物料与订单，核对会议决定，再追踪责任岗位与回执。
        </p>
        <div className='mt-5'>
          <OfficeGraph graph={snapshot.graph} openSource={openSource} />
        </div>
      </details>
      <Button className='h-12 w-full text-base' onClick={() => ask('')}>
        向业务助手询问影响与依据
        <ArrowRight className='size-4' />
      </Button>
    </div>
  )
}

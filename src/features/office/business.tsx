import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react'
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
import { ReviewSummary } from './workflow-overview'

export type BusinessProps = {
  snapshot: Snapshot
  role: Role
  busy: boolean
  sources: Source[]
  propose: (action: Action) => void
  openSource: (source: Source) => void
  giveReceipt: (task: Task) => void
  ask: (question: string) => void
  viewMatter: () => void
}

function receiptText(receipt: unknown) {
  return showValue(
    receipt && typeof receipt === 'object' && 'evidence' in receipt
      ? receipt.evidence
      : receipt
  )
}
function taskLabel(task: Task, closed: boolean) {
  if (task.id !== 'T-QA' && task.receipt && !closed) return '已提交，待复核'
  if (task.status === 'delivery_failed') return '待处理 · 通知发送失败'
  if (task.status === 'delivered') return '待处理'
  if (task.status === 'in_progress') return '处理中'
  if (task.qualityResult === 'rejected') return '核验不通过'
  if (task.status === 'completed')
    return task.id === 'T-QA' ? '核验通过' : '已完成'
  if (task.status === 'awaiting_review') return '已提交，待复核'
  return '待发送'
}
function situation({ state, analysis }: Snapshot) {
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const quality = state.suppliers.find(
    (supplier) => supplier.id === 'B'
  )?.quality
  if (state.matter.status === 'closed')
    return {
      label: '已关闭',
      waiting: '各岗位处理完成，负责人已复核',
      detail: '本次办公事项已关闭，决定、核验凭据和部门回执已留档。',
    }
  if (analysis.executionApproved) {
    if (analysis.canClose)
      return {
        label: '待负责人复核',
        waiting: '业务负责人 · 复核两份回执',
        detail: '采购、销售均已提交回执，等待最终复核。',
      }
    const missing = analysis.missingReceipts.map((id) =>
      id === 'T-PUR' ? '采购经办' : id === 'T-SALES' ? '销售经办' : id
    )
    return {
      label: '部门执行中',
      waiting: missing.join('、') + ' · 提交处理回执',
      detail:
        '负责人已确认执行方案，部门回执 ' +
        (2 - analysis.missingReceipts.length) +
        '/2。',
    }
  }
  if (state.matter.planSelection?.supplierId === 'A')
    return {
      label: '待确认沿用 A',
      waiting: '业务负责人 · 确认到料风险与跟进安排',
      detail: analysis.nextStep,
    }
  if (!state.matter.planSelection && !qa)
    return {
      label: '待选择方案',
      waiting: '采购经办或业务负责人 · 比较并选择 A/B',
      detail: analysis.nextStep,
    }
  if (quality === 'rejected')
    return {
      label: '质量核验不通过',
      waiting: '采购经办或业务负责人 · 重新发起核验',
      detail: '本轮 B 路径不可执行，当前继续由 A 供货。',
    }
  if (
    qa?.status === 'completed' &&
    qa.qualityResult === 'approved' &&
    quality === 'approved'
  )
    return {
      label: '待负责人确认',
      waiting: '业务负责人 · 决定是否切换',
      detail: 'B 已通过质量核验，供应方案切换仍待批准。',
    }
  if (qa?.status === 'delivery_failed')
    return {
      label: '核验通知发送失败',
      waiting: '质量负责人、采购经办或业务负责人 · 重试发送',
      detail: '核验任务已创建，通知尚未送达。',
    }
  if (qa)
    return {
      label: '待质量核验',
      waiting: '质量负责人 · 提交核验结果',
      detail: '供应商 B 资格待核验，当前有效方案仍为 A。',
    }
  return {
    label: '待方案核对',
    waiting: '业务负责人或采购经办 · 核对方案并发起核验',
    detail: '已关联订单与到料要求；切换 B 前还需质量核验与负责人批准。',
  }
}
function Receipt({ task }: { task: Task }) {
  const history =
    (
      task as Task & {
        history?: {
          receipt?: unknown
          qualityResult?: string
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
            历史核验 · {history.length} 次
          </summary>
          <div className='mt-3 space-y-3'>
            {history.map((item, index) => (
              <div key={index} className='border-l-2 pl-3'>
                <p>
                  第 {index + 1} 次 ·{' '}
                  {item.qualityResult === 'approved'
                    ? '通过'
                    : item.qualityResult === 'rejected'
                      ? '不通过'
                      : '未记录结论'}
                </p>
                <p className='mt-1 break-words whitespace-pre-wrap text-muted-foreground'>
                  {receiptText(item.receipt)}
                </p>
                {item.completedAt && (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {new Date(item.completedAt).toLocaleString('zh-CN')}
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
  role,
  propose,
  giveReceipt,
  busy,
}: Pick<
  BusinessProps,
  'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
> & { task: Task }) {
  if (snapshot.state.matter.status === 'closed') return null
  if (
    task.status === 'delivery_failed' &&
    (task.assignee === role || ['lead', 'procurement'].includes(role))
  )
    return (
      <Button
        disabled={busy || task.attempts >= 3}
        onClick={() => propose({ type: 'retry_delivery', taskId: task.id })}
      >
        {task.attempts >= 3 ? '已到重试上限' : '重试发送'}
      </Button>
    )
  if (task.assignee !== role || task.receipt) return null
  if (task.status === 'delivered')
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'start_task', taskId: task.id })}
      >
        开始处理
      </Button>
    )
  if (task.status === 'in_progress')
    return (
      <Button disabled={busy} onClick={() => giveReceipt(task)}>
        {task.id === 'T-QA'
          ? '提交核验结果'
          : task.id === 'T-PUR'
            ? '提交采购回执'
            : '提交销售回执'}
      </Button>
    )
  return null
}
export function BusinessActions({
  snapshot,
  role,
  propose,
  busy,
}: Pick<BusinessProps, 'snapshot' | 'role' | 'propose' | 'busy'>) {
  const { state, analysis } = snapshot
  if (state.matter.status === 'closed') return null
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const quality = state.suppliers.find(
    (supplier) => supplier.id === 'B'
  )?.quality
  const selectedPlan =
    state.matter.planSelection?.supplierId ??
    (qa || state.matter.supplierId === 'B' ? 'B' : undefined)
  if (analysis.canClose)
    return role === 'lead' ? (
      <Button disabled={busy} onClick={() => propose({ type: 'close_matter' })}>
        复核并关闭事项
      </Button>
    ) : null
  if (analysis.executionApproved) return null
  if (!selectedPlan)
    return (
      <p className='text-sm text-muted-foreground'>
        请先在方案比较中选择处理方案并说明原因。
      </p>
    )
  if (selectedPlan === 'A')
    return role === 'lead' ? (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'approve_keep_a' })}
      >
        确认沿用 A 并安排跟进
      </Button>
    ) : (
      <p className='text-sm text-muted-foreground'>
        等待业务负责人确认沿用 A 及跟进安排。
      </p>
    )
  if (
    state.matter.supplierId === 'A' &&
    (!qa || (qa.status === 'completed' && quality === 'rejected')) &&
    ['lead', 'procurement'].includes(role)
  )
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'request_quality' })}
      >
        {qa ? '重新发起质量核验' : '准备质量核验'}
      </Button>
    )
  if (role !== 'lead') return null
  if (
    state.matter.supplierId === 'A' &&
    quality === 'approved' &&
    qa?.status === 'completed' &&
    qa.qualityResult === 'approved'
  )
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'approve_switch' })}
      >
        批准切换供应商 B
      </Button>
    )
  if (analysis.canClose)
    return (
      <Button disabled={busy} onClick={() => propose({ type: 'close_matter' })}>
        复核并关闭事项
      </Button>
    )
  return null
}
export function RoleAction(
  props: Pick<
    BusinessProps,
    'snapshot' | 'role' | 'busy' | 'propose' | 'giveReceipt'
  > & { title?: string; viewMatter?: () => void }
) {
  const { state, analysis } = props.snapshot
  const current = situation(props.snapshot)
  const closed = state.matter.status === 'closed'
  const own = state.tasks.find((task) => task.assignee === props.role)
  const failed = state.tasks.find(
    (task) =>
      task.status === 'delivery_failed' &&
      (task.assignee === props.role ||
        ['lead', 'procurement'].includes(props.role))
  )
  const actionTask = own && !own.receipt ? own : failed
  return (
    <Section
      title={props.title || '我的下一步'}
      aside={<Badge variant='outline'>{roleNames[props.role]}</Badge>}
    >
      <div className='space-y-4'>
        {closed ? (
          <div className='flex items-start gap-2 text-sm'>
            <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-emerald-600' />
            <p>事项已关闭，可查看处理结果和凭据。</p>
          </div>
        ) : actionTask ? (
          <>
            <p className='font-medium'>{actionTask.title}</p>
            <p className='text-sm text-muted-foreground'>
              {actionTask.id} · {taskLabel(actionTask, closed)}
            </p>
            {actionTask.status === 'delivery_failed' ? (
              <p className='text-sm leading-6 text-destructive'>
                通知发送失败，任务尚未开始。已尝试 {actionTask.attempts} 次
                {actionTask.attempts >= 3 ? '，请检查失败原因。' : '。'}
              </p>
            ) : (
              <p className='text-sm leading-6 text-muted-foreground'>
                {actionTask.id === 'T-QA'
                  ? '核验供应商 B 的质量资格，并提交结论与凭据。'
                  : actionTask.id === 'T-PUR'
                    ? '依据生效决定确认采购安排，提交处理说明与凭据。'
                    : '依据生效决定同步关联订单交期信息，提交处理说明与凭据。'}
              </p>
            )}
            <TaskAction {...props} task={actionTask} />
          </>
        ) : (
          <>
            <p className='text-sm leading-6'>
              {own?.receipt
                ? '你的' +
                  (own.id === 'T-QA' ? '核验结果' : '处理回执') +
                  '已提交。'
                : current.detail}
            </p>
            <p className='text-sm leading-6 text-muted-foreground'>
              {current.waiting}
            </p>
            <BusinessActions {...props} />
          </>
        )}
        {props.viewMatter && (
          <div>
            <Button
              variant='outline'
              disabled={props.busy}
              onClick={props.viewMatter}
            >
              {closed
                ? '查看处理记录'
                : state.tasks.some((task) => task.id === 'T-QA') &&
                    state.matter.supplierId === 'A'
                  ? '查看核验任务'
                  : '查看事项与任务'}
              <ArrowRight className='size-4' />
            </Button>
          </div>
        )}
        {own && <Receipt task={own} />}
        {!closed &&
          props.role === 'lead' &&
          analysis.executionApproved &&
          !analysis.canClose && (
            <details className='border-t pt-4 text-sm'>
              <summary className='cursor-pointer font-medium'>
                查看关闭条件
              </summary>
              <ul className='mt-3 space-y-2 text-muted-foreground'>
                <li>有效决定：{analysis.effectiveDecisionId}</li>
                <li>
                  质量资格：
                  {state.matter.supplierId === 'A'
                    ? '沿用 A 已批准资格'
                    : state.suppliers.find((supplier) => supplier.id === 'B')
                          ?.quality === 'approved'
                      ? '已通过'
                      : '未通过'}
                </li>
                {['T-PUR', 'T-SALES'].map((id) => (
                  <li key={id}>
                    {id === 'T-PUR' ? '采购回执' : '销售回执'}：
                    {analysis.missingReceipts.includes(id)
                      ? '待提交'
                      : '已提交'}
                  </li>
                ))}
              </ul>
            </details>
          )}
      </div>
    </Section>
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
            <TableHead>当前方案到料</TableHead>
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
                  {taskLabel(task, closed)}
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
export function Home(props: BusinessProps) {
  const { snapshot, viewMatter, ask, role } = props
  const { state, analysis } = snapshot
  const supplier = state.suppliers.find((item) => item.id === 'A')
  const current = situation(snapshot)
  const closed = state.matter.status === 'closed'
  const own = state.tasks.find((task) => task.assignee === role)
  return (
    <div className='space-y-6'>
      {!closed && (
        <div className='flex items-start gap-3 rounded-lg border bg-muted/25 px-5 py-4 text-sm'>
          <AlertCircle className='mt-0.5 size-4 shrink-0' />
          <div>
            <p className='font-medium'>供应商 A 更新了到料日</p>
            <p className='mt-1 text-muted-foreground'>
              原料 {state.matter.materialId} · 原定 D{supplier?.originalDay} →
              最新 D{supplier?.arrivalDay}
            </p>
          </div>
        </div>
      )}
      <Section
        title='供应商交期变更'
        aside={<Badge variant='outline'>{current.label}</Badge>}
      >
        <div className='space-y-5'>
          <p className='text-sm text-muted-foreground'>
            {state.matter.id} · {state.matter.materialId} · 当前由供应商{' '}
            {state.matter.supplierId} 供货
          </p>
          <div className='grid grid-cols-3 gap-4 border-y py-5'>
            {[
              [analysis.linkedCount, '关联订单'],
              [analysis.riskCount, '当前方案到料风险'],
              [analysis.pendingActionCount, '待处理动作'],
            ].map(([count, label]) => (
              <div key={label}>
                <p className='text-2xl font-semibold tabular-nums'>{count}</p>
                <p className='mt-1 text-xs leading-5 text-muted-foreground'>
                  {label}
                </p>
              </div>
            ))}
          </div>
          <div className='text-sm'>
            <p>{current.detail}</p>
            <p className='mt-2 text-muted-foreground'>{current.waiting}</p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button
              onClick={() =>
                ask(
                  closed
                    ? '这件事现在处理到哪里了？'
                    : '供应商 A 延期会影响哪些订单？有几条需要处理？'
                )
              }
            >
              {closed ? '查询处理结果' : '继续处理'}
              <ArrowRight className='size-4' />
            </Button>
            <Button variant='outline' onClick={viewMatter}>
              {closed ? '查看事项记录' : '查看事项详情'}
            </Button>
          </div>
        </div>
      </Section>
      <Section
        title='我的待办'
        aside={
          <span className='text-sm text-muted-foreground'>
            {roleNames[role]}
          </span>
        }
      >
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div className='min-w-0 space-y-2'>
            <p className='text-sm font-medium'>
              {closed
                ? '本事项已完成'
                : own
                  ? own.title
                  : role === 'lead' || role === 'procurement'
                    ? current.label
                    : '当前暂无待办'}
            </p>
            <p className='text-sm text-muted-foreground'>
              {own ? taskLabel(own, closed) : current.waiting}
            </p>
          </div>
          <Button variant='outline' onClick={viewMatter}>
            查看事项
            <ArrowRight className='size-4' />
          </Button>
        </div>
      </Section>
    </div>
  )
}
export function Paths({ snapshot }: { snapshot: Snapshot }) {
  const { state, analysis } = snapshot
  return (
    <Section title='到料方案比较'>
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
                    ? '当前执行'
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
                <p>
                  质量资格：
                  {option.quality === 'approved'
                    ? '已通过'
                    : option.quality === 'rejected'
                      ? '未通过'
                      : '待核验'}
                </p>
                <p className='text-muted-foreground'>
                  {selected
                    ? '当前依据 ' + analysis.effectiveDecisionId + ' 执行'
                    : option.supplierId === 'B'
                      ? option.quality === 'rejected'
                        ? '本轮质量条件不满足，不能切换。'
                        : option.quality === 'approved'
                          ? '质量条件已满足，仍需负责人批准。'
                          : '质量核验通过并经负责人批准后才可切换。'
                      : '原有效决定已被替代。'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <p className='mt-4 text-xs leading-5 text-muted-foreground'>
        比较范围：到料时间、质量资格、批准条件；未包含价格、产能及运输条件。
      </p>
    </Section>
  )
}
export function Matter(props: BusinessProps) {
  const { snapshot, sources, openSource, ask } = props
  const { state, analysis } = snapshot
  const current = situation(snapshot)
  const supplierA = state.suppliers.find((s) => s.id === 'A')
  const active = state.suppliers.find((s) => s.id === state.matter.supplierId)
  const supplierB = state.suppliers.find((s) => s.id === 'B')
  const sourceFor = (id: string): Source =>
    sources.find((s) => s.id === id) ?? { id, title: '来源原文' }
  const decisions = [...state.decisions].sort(
    (a, b) =>
      Number(b.status === 'effective') - Number(a.status === 'effective')
  )
  return (
    <div className='space-y-5'>
      <Button
        variant='ghost'
        className='h-auto p-0 text-muted-foreground'
        onClick={() => ask('')}
      >
        返回业务助手
      </Button>
      <div className='flex flex-wrap items-start justify-between gap-4 pb-2'>
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-3'>
            <h2 className='text-2xl font-semibold'>
              物料 {state.matter.materialId} 供应商延期协同
            </h2>
            <Badge variant='secondary'>{current.label}</Badge>
          </div>
          <p className='max-w-3xl text-sm leading-7 text-muted-foreground'>
            供应商 A 从 D{supplierA?.originalDay} 延至 D{supplierA?.arrivalDay}
            ；{current.waiting}。
          </p>
        </div>
        <div className='rounded-xl border bg-card px-5 py-3'>
          <p className='text-xs text-muted-foreground'>当前方案到料风险</p>
          <p
            className={
              'mt-1 text-2xl font-semibold ' +
              (analysis.riskCount ? 'text-destructive' : 'text-emerald-600')
            }
          >
            {analysis.riskCount} <span className='text-sm'>条</span>
          </p>
        </div>
      </div>
      <Section
        title='发生了什么'
        aside={<span className='text-xs text-muted-foreground'>当前情况</span>}
      >
        <div className='office-facts'>
          <div className='office-fact'>
            <p>原供应计划</p>
            <strong>A · D{supplierA?.originalDay}</strong>
          </div>
          <div className='office-fact'>
            <p>当前方案预计到料</p>
            <strong>
              {active?.id} · D{active?.arrivalDay}
            </strong>
          </div>
          <div className='office-fact'>
            <p>{state.matter.supplierId === 'B' ? '已执行方案' : '备选方案'}</p>
            <strong>B · D{supplierB?.arrivalDay}</strong>
            <p className='mt-2'>
              质量：
              {supplierB?.quality === 'approved'
                ? '已通过'
                : supplierB?.quality === 'rejected'
                  ? '未通过'
                  : '待核验'}
            </p>
          </div>
          <div className='office-fact'>
            <p>风险订单 / 关联订单</p>
            <strong>
              {analysis.riskCount} / {analysis.linkedCount}
            </strong>
            <p className='mt-2'>
              {analysis.orders
                .map((o) => `${o.id} D${o.requiredDay}`)
                .join('；')}
            </p>
          </div>
        </div>
      </Section>
      <div className='grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]'>
        <Section
          title='为什么现在这样处理'
          aside={
            <span className='text-xs text-muted-foreground'>决定与依据</span>
          }
        >
          <div className='space-y-3'>
            {decisions.map((decision) => (
              <div
                key={decision.id}
                className='office-decision'
                data-effective={decision.status === 'effective'}
              >
                <div className='flex flex-wrap items-center gap-3'>
                  <Status value={decision.status} />
                  <strong>{decision.id}</strong>
                  <Button
                    variant='link'
                    className='ml-auto h-auto p-0 text-xs'
                    onClick={() => openSource(sourceFor(decision.sourceId))}
                  >
                    查看来源原文
                  </Button>
                </div>
                <p className='mt-3 text-sm leading-7'>{decision.text}</p>
              </div>
            ))}
            <p className='text-xs leading-6 text-muted-foreground'>
              新的条件建议不会自动替代当前有效决定；方案选择与负责人批准分别留档。
            </p>
          </div>
        </Section>
        <Section
          title={
            state.matter.status === 'closed'
              ? '本事项已完成复核'
              : current.label
          }
          aside={<span className='text-xs text-muted-foreground'>下一步</span>}
        >
          <p className='text-sm leading-7'>{current.detail}</p>
          <p className='mt-3 text-sm leading-7 text-muted-foreground'>
            {current.waiting}
          </p>
          {analysis.executionApproved && (
            <div className='mt-5 divide-y border-y'>
              {['T-PUR', 'T-SALES'].map((id) => {
                const task = state.tasks.find((t) => t.id === id)
                return (
                  <div
                    key={id}
                    className='flex justify-between gap-3 py-3 text-sm'
                  >
                    <span>{id === 'T-PUR' ? '采购任务' : '销售任务'}</span>
                    <span className='text-muted-foreground'>
                      {task
                        ? taskLabel(task, state.matter.status === 'closed')
                        : '待创建'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <Button className='mt-5 w-full' onClick={() => ask('')}>
            返回助手继续办理
            <ArrowRight className='size-4' />
          </Button>
          <p className='mt-3 text-xs leading-6 text-muted-foreground'>
            此页回顾全过程；选择、核验、回执及最终确认在助手中完成。
          </p>
        </Section>
      </div>
      <Section
        title='处理记录'
        aside={<span className='text-xs text-muted-foreground'>历史轨迹</span>}
      >
        <ol className='office-timeline text-sm leading-6'>
          <li>
            供应商 A 到料从 D{supplierA?.originalDay} 延至 D
            {supplierA?.arrivalDay}
          </li>
          <li>DEC-01：原供应商 A 方案生效</li>
          <li>DEC-02：提出 B 备选方案，需质量核验及负责人批准</li>
          {state.events.map((event) => (
            <li key={event.id}>
              <p>{event.message}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {roleNames[event.actor as Role] || event.actor} ·{' '}
                {new Date(event.at).toLocaleString('zh-CN')}
              </p>
            </li>
          ))}
        </ol>
      </Section>
      <ReviewSummary
        snapshot={snapshot}
        sources={sources}
        openSource={openSource}
      />
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-sm font-semibold'>
          到料方案与部门任务明细
        </summary>
        <div className='mt-5 space-y-5'>
          <Paths snapshot={snapshot} />
          <Section title='部门任务'>
            <Tasks {...props} readOnly />
          </Section>
          <Orders snapshot={snapshot} />
        </div>
      </details>
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-sm font-semibold'>
          原始资料与会议依据
        </summary>
        <div className='mt-5'>
          <Sources
            sources={sources.filter((s) => s.id !== 'DEMO-STATE')}
            open={openSource}
          />
        </div>
      </details>
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-sm font-semibold'>
          高级视图 · 业务关系
        </summary>
        <div className='mt-5'>
          <OfficeGraph graph={snapshot.graph} openSource={openSource} />
        </div>
      </details>
    </div>
  )
}

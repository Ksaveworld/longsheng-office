import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Link2,
} from 'lucide-react'
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
  if (state.matter.supplierId === 'B') {
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
        '切换决定已生效，部门回执 ' +
        (2 - analysis.missingReceipts.length) +
        '/2。',
    }
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
          state.matter.supplierId === 'B' &&
          !analysis.canClose && (
            <details className='border-t pt-4 text-sm'>
              <summary className='cursor-pointer font-medium'>
                查看关闭条件
              </summary>
              <ul className='mt-3 space-y-2 text-muted-foreground'>
                <li>有效决定：{analysis.effectiveDecisionId}</li>
                <li>
                  质量核验：
                  {state.suppliers.find((supplier) => supplier.id === 'B')
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
              {closed ? '查看事项记录' : '进入事项处理'}
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
function Paths({ snapshot }: { snapshot: Snapshot }) {
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
  const supplierA = state.suppliers.find((supplier) => supplier.id === 'A')
  const effective = state.decisions.find(
    (decision) => decision.id === analysis.effectiveDecisionId
  )
  const sourceFor = (id: string, title: string): Source =>
    sources.find((source) => source.id === id) ?? { id, title }
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b pb-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <h2 className='text-xl font-semibold tracking-tight'>
            供应商交期变更
          </h2>
          <span className='font-mono text-sm text-muted-foreground'>
            {state.matter.id}
          </span>
          <Badge variant='outline'>{current.label}</Badge>
          <span className='text-sm text-muted-foreground'>
            原料 {state.matter.materialId}
          </span>
        </div>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => ask('这件事当前的有效决定是什么，还需要谁做什么？')}
        >
          询问业务助手
          <ArrowRight className='size-4' />
        </Button>
      </div>
      <div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]'>
        <Section title='当前情况'>
          <div className='space-y-5 text-sm'>
            <p className='text-base leading-7'>
              供应商 A 到料日从 D{supplierA?.originalDay} 延至 D
              {supplierA?.arrivalDay}
            </p>
            <div className='flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground'>
              <span>
                关联{' '}
                <strong className='text-foreground'>
                  {analysis.linkedCount}
                </strong>{' '}
                条订单
              </span>
              <span>
                当前方案{' '}
                <strong
                  className={
                    analysis.riskCount ? 'text-destructive' : 'text-foreground'
                  }
                >
                  {analysis.riskCount}
                </strong>{' '}
                条到料风险
              </span>
            </div>
            <div className='border-t pt-4'>
              <p className='text-xs text-muted-foreground'>当前有效决定</p>
              <p className='mt-2 font-medium'>
                {analysis.effectiveDecisionId} · 由供应商{' '}
                {state.matter.supplierId} 供货
              </p>
              <p className='mt-2 leading-6 text-muted-foreground'>
                {effective?.text}
              </p>
              {effective && (
                <Button
                  variant='link'
                  className='mt-2 h-auto p-0 text-sm'
                  onClick={() =>
                    openSource(sourceFor(effective.sourceId, '有效决定原文'))
                  }
                >
                  查看决定依据
                </Button>
              )}
            </div>
            <div className='border-t pt-4'>
              <p className='text-xs text-muted-foreground'>当前责任</p>
              <p className='mt-2 leading-6'>{current.waiting}</p>
            </div>
          </div>
        </Section>
        <RoleAction {...props} viewMatter={undefined} />
      </div>
      <Section
        title='任务与回执'
        aside={
          <span className='text-xs text-muted-foreground'>
            {analysis.pendingActionCount} 项待处理动作
          </span>
        }
      >
        <Tasks {...props} readOnly />
      </Section>
      <Paths snapshot={snapshot} />
      <Section title='决定与来源'>
        <div className='divide-y'>
          {state.decisions.map((decision) => (
            <div
              key={decision.id}
              className='space-y-3 py-4 first:pt-0 last:pb-0'
            >
              <div className='flex flex-wrap items-center gap-3'>
                <span className='font-mono text-sm'>{decision.id}</span>
                <Status value={decision.status} />
                <span className='text-xs text-muted-foreground'>
                  {decision.id === 'DEC-01'
                    ? '第一次会议'
                    : decision.id === 'DEC-02'
                      ? '第二次会议'
                      : '负责人批准记录'}
                </span>
              </div>
              <p className='text-sm leading-7'>{decision.text}</p>
              <Button
                variant='link'
                className='h-auto p-0 text-sm'
                onClick={() =>
                  openSource(
                    sourceFor(decision.sourceId, decision.id + ' 来源原文')
                  )
                }
              >
                查看来源原文
              </Button>
            </div>
          ))}
        </div>
      </Section>
      <details className='rounded-lg border p-5'>
        <summary className='cursor-pointer text-sm font-semibold'>
          关联订单与影响依据
        </summary>
        <div className='mt-5 space-y-5'>
          <Orders snapshot={snapshot} />
          <div className='space-y-2'>
            {analysis.orders.map((order) => (
              <div
                key={order.id}
                className='flex items-start gap-2 rounded-md bg-muted/30 p-3 text-sm leading-6'
              >
                <Link2 className='mt-1 size-4 shrink-0 text-muted-foreground' />
                <span>
                  延期通知 → 供应商 A → {state.matter.materialId} → {order.id} →
                  最迟 D{order.requiredDay} 到料
                </span>
              </div>
            ))}
          </div>
          <Sources
            sources={sources.filter((source) =>
              ['DOC-NOTICE', 'DOC-LEDGER', 'DOC-RULES'].includes(source.id)
            )}
            open={openSource}
          />
        </div>
      </details>
      <details className='rounded-lg border p-5'>
        <summary className='cursor-pointer text-sm font-semibold'>
          处理记录与全部资料
        </summary>
        <div className='mt-5 space-y-6'>
          <Sources
            sources={sources.filter((source) => source.id !== 'DEMO-STATE')}
            open={openSource}
          />
          {state.events.length ? (
            <ol className='space-y-5'>
              {[...state.events].reverse().map((event) => (
                <li key={event.id} className='flex gap-3'>
                  <Clock3 className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                  <div>
                    <p className='text-sm leading-6'>{event.message}</p>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      {roleNames[event.actor as Role] || event.actor} ·{' '}
                      {new Date(event.at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className='text-sm text-muted-foreground'>尚无处理记录。</p>
          )}
          <p className='text-xs text-muted-foreground'>
            数据版本 {state.revision}
          </p>
        </div>
      </details>
      <details className='rounded-lg border p-5'>
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

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
import { Section, Sources, Status } from './shared'
import { OfficeGraph } from './graph'
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
export function BusinessActions({
  snapshot,
  role,
  propose,
  busy,
}: Pick<BusinessProps, 'snapshot' | 'role' | 'propose' | 'busy'>) {
  const { state } = snapshot
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const rejected =
    state.suppliers.find((s) => s.id === 'B')?.quality === 'rejected'
  if (state.matter.status === 'closed')
    return (
      <Badge variant='outline'>
        <CheckCircle2 className='size-3.5' />
        办公事项已关闭
      </Badge>
    )
  return (
    <div className='flex flex-wrap gap-2'>
      {(!qa || rejected) && ['lead', 'procurement'].includes(role) && (
        <Button
          disabled={busy}
          onClick={() => propose({ type: 'request_quality' })}
        >
          {rejected ? '重新发起质量核验' : '发起质量核验'}
        </Button>
      )}
      {role === 'lead' && state.matter.supplierId !== 'B' && (
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => propose({ type: 'approve_switch' })}
        >
          检查并确认切换
        </Button>
      )}
      {role === 'lead' && state.matter.supplierId === 'B' && (
        <Button
          disabled={busy}
          onClick={() => propose({ type: 'close_matter' })}
        >
          复核并关闭事项
        </Button>
      )}
    </div>
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
            <TableHead>方案到料</TableHead>
            <TableHead>判断</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.analysis.orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell className='font-medium'>{order.id}</TableCell>
              <TableCell className='tabular-nums'>
                D{order.requiredDay}
              </TableCell>
              <TableCell className='tabular-nums'>
                D{order.arrivalDay}
              </TableCell>
              <TableCell>
                {order.atRisk ? (
                  <Badge variant='destructive'>晚 {order.lateDays} 天</Badge>
                ) : (
                  <Badge variant='secondary'>满足到料要求</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
export function Tasks({
  snapshot,
  role,
  propose,
  giveReceipt,
  busy,
}: Pick<
  BusinessProps,
  'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
>) {
  if (!snapshot.state.tasks.length)
    return (
      <div className='flex items-center gap-3 rounded-md border border-dashed p-5 text-sm text-muted-foreground'>
        <Clock3 className='size-5 shrink-0' />
        <p>尚未发起任务。核对任务内容与接收人后，确认发起质量核验。</p>
      </div>
    )
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务</TableHead>
            <TableHead>模拟收件人</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className='text-right'>处理</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.state.tasks.map((task) => {
            const own = task.assignee === role
            const active = ['delivered', 'in_progress'].includes(task.status)
            const retry =
              task.status === 'delivery_failed' &&
              (own || ['lead', 'procurement'].includes(role))
            return (
              <TableRow key={task.id}>
                <TableCell className='min-w-52'>
                  <div className='font-medium'>{task.title}</div>
                  <div className='mt-1 text-xs text-muted-foreground'>
                    {task.id}
                  </div>
                  {!!task.receipt && (
                    <details className='mt-2 text-sm text-muted-foreground'>
                      <summary className='cursor-pointer'>查看回执</summary>
                      <p className='mt-2 max-w-md break-words whitespace-pre-wrap'>
                        {showValue(
                          typeof task.receipt === 'object' &&
                            task.receipt &&
                            'evidence' in task.receipt
                            ? task.receipt.evidence
                            : task.receipt
                        )}
                      </p>
                    </details>
                  )}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {roleNames[task.assignee] || task.assignee}
                </TableCell>
                <TableCell>
                  <Status value={task.status} />
                  {task.status === 'delivery_failed' && (
                    <p className='mt-2 max-w-40 text-xs text-destructive'>
                      模拟送达失败 · 已尝试 {task.attempts} 次
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className='flex justify-end gap-2'>
                    {retry && (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy || task.attempts >= 3}
                        onClick={() =>
                          propose({ type: 'retry_delivery', taskId: task.id })
                        }
                      >
                        {task.attempts >= 3 ? '已到重试上限' : '重试发送'}
                      </Button>
                    )}
                    {own && task.status === 'delivered' && (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() =>
                          propose({ type: 'start_task', taskId: task.id })
                        }
                      >
                        开始处理
                      </Button>
                    )}
                    {own && active && (
                      <Button
                        size='sm'
                        disabled={busy}
                        onClick={() => giveReceipt(task)}
                      >
                        {task.id === 'T-QA' ? '提交核验结果' : '提交处理回执'}
                      </Button>
                    )}
                    {!own && active && (
                      <span className='text-xs text-muted-foreground'>
                        等待{roleNames[task.assignee] || task.assignee}
                      </span>
                    )}
                    {task.status === 'awaiting_review' && (
                      <span className='text-xs text-muted-foreground'>
                        等待负责人复核
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
export function Home(props: BusinessProps) {
  const { snapshot, viewMatter, ask } = props
  const { state, analysis } = snapshot
  const supplier = state.suppliers.find((s) => s.id === 'A')
  return (
    <div className='space-y-6'>
      {state.matter.status !== 'closed' && (
        <button
          className='flex w-full items-start gap-3 rounded-lg border bg-muted/30 p-4 text-start text-sm hover:bg-muted/60'
          onClick={viewMatter}
        >
          <AlertCircle className='mt-0.5 size-4 shrink-0' />
          <div className='flex-1'>
            <p className='font-medium'>供应商 A 更新了到料日</p>
            <p className='mt-1 text-muted-foreground'>
              原定 D{supplier?.originalDay ?? 3} → D{supplier?.arrivalDay}
              。点击查看 SUP-001 的影响与处理条件。
            </p>
          </div>
          <ArrowRight className='size-4 shrink-0' />
        </button>
      )}
      <div className='grid gap-6 xl:grid-cols-[1.3fr_1fr]'>
        <Section
          title={state.matter.title}
          aside={<Status value={state.matter.status} />}
        >
          <div className='space-y-5'>
            <p className='text-sm text-muted-foreground'>
              SUP-001 <span className='mx-2'>·</span> 原料 M-01{' '}
              <span className='mx-2'>·</span> 当前供货方案{' '}
              {state.matter.supplierId}
            </p>
            <div className='flex gap-8'>
              <div>
                <p className='text-3xl font-semibold tabular-nums'>
                  {analysis.linkedCount}
                </p>
                <p className='mt-1 text-sm text-muted-foreground'>关联订单</p>
              </div>
              <div>
                <p className='text-3xl font-semibold tabular-nums'>
                  {analysis.riskCount}
                </p>
                <p className='mt-1 text-sm text-muted-foreground'>到料风险</p>
              </div>
              <div>
                <p className='text-3xl font-semibold tabular-nums'>
                  {state.tasks.filter((t) => t.status !== 'completed').length}
                </p>
                <p className='mt-1 text-sm text-muted-foreground'>未完成任务</p>
              </div>
            </div>
            <p className='text-sm leading-6'>{analysis.nextStep}</p>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                onClick={() =>
                  ask('供应商 A 延期会影响哪些订单？有几条需要处理？')
                }
              >
                分析影响
              </Button>
              <Button variant='ghost' onClick={viewMatter}>
                查看完整事项
                <ArrowRight className='size-4' />
              </Button>
            </div>
          </div>
        </Section>
        <Section title='现在需要谁处理'>
          <div className='space-y-4 text-sm'>
            <p className='leading-7 text-muted-foreground'>
              {state.matter.status === 'closed'
                ? '办公协同事项已完成复核，原始决定、核验结果和部门回执仍可追溯。'
                : analysis.nextStep}
            </p>
            <BusinessActions {...props} />
            <div className='border-t pt-4'>
              <p className='font-medium'>当前有效决定</p>
              <p className='mt-2 text-muted-foreground'>
                {analysis.effectiveDecisionId} ·{' '}
                {
                  state.decisions.find(
                    (d) => d.id === analysis.effectiveDecisionId
                  )?.text
                }
              </p>
            </div>
          </div>
        </Section>
      </div>
      <Section
        title='到料影响'
        aside={<Badge variant='outline'>按当前供货方案计算</Badge>}
      >
        <Orders snapshot={snapshot} />
      </Section>
      <Section
        title='模拟收件箱'
        aside={<Badge variant='outline'>{roleNames[props.role]}</Badge>}
      >
        <Tasks {...props} />
      </Section>
    </div>
  )
}
export function Matter(props: BusinessProps) {
  const { snapshot, sources, openSource } = props
  const { state, analysis } = snapshot
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Badge variant='outline'>SUP-001</Badge>
          <Status value={state.matter.status} />
          <span className='text-sm text-muted-foreground'>
            数据 v{state.revision}
          </span>
        </div>
        <BusinessActions {...props} />
      </div>
      <OfficeGraph graph={snapshot.graph} openSource={openSource} />
      <Section title='供货方案与前置条件'>
        <div className='grid gap-4 md:grid-cols-2'>
          {analysis.options.map((option) => (
            <div
              key={option.supplierId}
              className='space-y-4 rounded-lg border p-5'
            >
              <div className='flex items-center justify-between gap-3'>
                <h3 className='font-semibold'>{option.name}</h3>
                {state.matter.supplierId === option.supplierId && (
                  <Badge>当前方案</Badge>
                )}
              </div>
              <div className='flex items-center gap-6 text-sm'>
                <span>
                  到料{' '}
                  <strong className='tabular-nums'>D{option.arrivalDay}</strong>
                </span>
                <span>
                  风险订单 <strong>{option.riskCount}</strong>
                </span>
              </div>
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <Status value={option.quality} />
                <span className='text-muted-foreground'>
                  {option.supplierId === 'B'
                    ? state.matter.supplierId === 'B'
                      ? '负责人已确认切换'
                      : '切换还需负责人确认'
                    : state.matter.supplierId === 'A'
                      ? '已批准的原供货方案'
                      : '原方案已被替代，保留历史依据'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className='mt-4 text-sm text-muted-foreground'>
          比较到料要求与资格条件；不推算生产排程，不将送达任务视为订单交付。
        </p>
      </Section>
      <Section title='会议决定与历史'>
        <div className='divide-y'>
          {state.decisions.map((decision) => (
            <div
              key={decision.id}
              className='space-y-3 py-4 first:pt-0 last:pb-0'
            >
              <div className='flex flex-wrap items-center gap-3'>
                <span className='font-mono text-sm'>{decision.id}</span>
                <Status value={decision.status} />
                <span className='text-sm text-muted-foreground'>
                  供应商 {decision.supplierId}
                </span>
              </div>
              <p className='text-sm leading-7'>{decision.text}</p>
              <Button
                variant='link'
                className='h-auto p-0 text-sm'
                onClick={() =>
                  openSource(
                    sources.find((source) => source.id === decision.sourceId) || {
                      id: decision.sourceId,
                      title: `${decision.id} 来源原文`,
                      source: '会议记录样例',
                    }
                  )
                }
              >
                查看决定原文
              </Button>
            </div>
          ))}
        </div>
      </Section>
      <div className='grid gap-6 xl:grid-cols-[1.25fr_1fr]'>
        <Section title='关联订单'>
          <Orders snapshot={snapshot} />
        </Section>
        <Section title='对象关系'>
          <div className='space-y-3 text-sm'>
            {[
              'SUP-001 → 原料 M-01',
              `原料 M-01 → ${state.orders.map((o) => o.id).join('、')}`,
              `SUP-001 → 当前方案供应商 ${state.matter.supplierId}`,
              `当前有效决定 → ${analysis.effectiveDecisionId}`,
            ].map((text) => (
              <div
                key={text}
                className='flex items-center gap-3 rounded-md bg-muted/40 p-3'
              >
                <Link2 className='size-4 text-muted-foreground' />
                {text}
              </div>
            ))}
          </div>
        </Section>
      </div>
      <Section title='任务与处理回执'>
        <Tasks {...props} />
      </Section>
      <Section title='来源资料'>
        <Sources sources={sources} open={openSource} />
        <p className='mt-3 text-sm text-muted-foreground'>
          采购台账、会议记录与职责表均为合成样例，未连接龙盛 OA、ERP 或真实
          DataOS。
        </p>
      </Section>
      <Section title='处理记录'>
        {!state.events.length ? (
          <p className='text-sm text-muted-foreground'>尚无处理记录。</p>
        ) : (
          <ol className='space-y-5'>
            {[...state.events].reverse().map((event) => (
              <li key={event.id} className='flex gap-3'>
                <div className='mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50' />
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
        )}
      </Section>
    </div>
  )
}

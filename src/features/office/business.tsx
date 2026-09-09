import { useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  startAnalysis: () => void
  viewMatter: () => void
}
function workStatus(task: Task) {
  return (
    task.workStatus ||
    (['completed', 'awaiting_review', 'in_progress'].includes(task.status)
      ? task.status
      : 'pending')
  )
}
function deliveryStatus(task: Task) {
  return (
    task.delivery?.status ||
    (task.status === 'delivery_failed'
      ? 'failed'
      : task.status === 'pending_delivery'
        ? 'pending'
        : 'sent')
  )
}
function receiptText(task: Task) {
  const receipt = task.receipt
  if (receipt && typeof receipt === 'object' && 'evidence' in receipt) {
    return `${task.qualityResult ? `核验结果：${task.qualityResult === 'approved' ? '通过' : '不通过'}\n` : ''}${showValue(receipt.evidence)}`
  }
  return showValue(receipt)
}
const workLabels: Record<string, string> = {
  pending: '待处理',
  in_progress: '处理中',
  awaiting_review: '待复核',
  completed: '已完成',
}
const deliveryLabels: Record<string, string> = {
  pending: '待发送',
  sent: '发送成功',
  failed: '发送失败',
}
const boundary =
  '本事项表示供应商延期的办公协同处理完成，不代表采购已经到货、生产完成或订单已经交付。'

export function BusinessActions({
  snapshot,
  role,
  propose,
  busy,
}: Pick<BusinessProps, 'snapshot' | 'role' | 'propose' | 'busy'>) {
  if (role !== 'lead') return null
  if (snapshot.workflow.stage === 'S3')
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'approve_switch' })}
      >
        批准切换
      </Button>
    )
  if (snapshot.workflow.stage === 'S5' && snapshot.workflow.canClose)
    return (
      <Button disabled={busy} onClick={() => propose({ type: 'close_matter' })}>
        复核并关闭事项
      </Button>
    )
  return null
}
export function Orders({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.workflow.analysisStep < 1)
    return (
      <p className='text-sm text-muted-foreground'>
        尚未分析到料影响。请从办公协同首页开始分析。
      </p>
    )
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
  readOnly = false,
}: Pick<
  BusinessProps,
  'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
> & { readOnly?: boolean }) {
  const tasks =
    readOnly || role === 'lead'
      ? snapshot.state.tasks
      : snapshot.state.tasks.filter((task) => task.assignee === role)
  if (!tasks.length)
    return (
      <div className='flex items-center gap-3 rounded-md border border-dashed p-5 text-sm text-muted-foreground'>
        <Clock3 className='size-5 shrink-0' />
        <p>{readOnly ? '尚无任务记录。' : '当前岗位暂无待办。'}</p>
      </div>
    )
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务</TableHead>
            <TableHead>接收岗位</TableHead>
            <TableHead>任务状态</TableHead>
            <TableHead>消息状态</TableHead>
            <TableHead className='text-right'>
              {readOnly ? '回执' : '处理'}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const own = task.assignee === role
            const work = workStatus(task)
            const delivery = deliveryStatus(task)
            const attempts = task.delivery?.attempts ?? task.attempts
            const retry =
              !readOnly &&
              delivery === 'failed' &&
              (own || ['lead', 'procurement'].includes(role))
            return (
              <TableRow key={task.id}>
                <TableCell className='min-w-48'>
                  <div className='font-medium'>{task.title}</div>
                  <div className='mt-1 text-xs text-muted-foreground'>
                    {task.id}
                  </div>
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {roleNames[task.assignee]}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={work === 'completed' ? 'default' : 'secondary'}
                  >
                    {workLabels[work]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={delivery === 'failed' ? 'destructive' : 'outline'}
                  >
                    {deliveryLabels[delivery]}
                  </Badge>
                  {delivery === 'failed' && (
                    <p className='mt-2 max-w-44 text-xs text-destructive'>
                      任务已创建 · 已尝试 {attempts} 次
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className='flex justify-end gap-2'>
                    {retry && (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy || attempts >= 3}
                        onClick={() =>
                          propose({ type: 'retry_delivery', taskId: task.id })
                        }
                      >
                        {attempts >= 3 ? '已到重试上限' : '重试发送'}
                      </Button>
                    )}
                    {!readOnly &&
                      own &&
                      delivery === 'sent' &&
                      work === 'pending' && (
                        <Button
                          size='sm'
                          disabled={busy}
                          onClick={() =>
                            propose({ type: 'start_task', taskId: task.id })
                          }
                        >
                          开始处理
                        </Button>
                      )}
                    {!readOnly &&
                      own &&
                      delivery === 'sent' &&
                      work === 'in_progress' && (
                        <Button
                          size='sm'
                          disabled={busy}
                          onClick={() => giveReceipt(task)}
                        >
                          提交结果
                        </Button>
                      )}
                    {!readOnly &&
                      !own &&
                      ['pending', 'in_progress'].includes(work) &&
                      delivery !== 'failed' && (
                        <span className='text-xs text-muted-foreground'>
                          等待{roleNames[task.assignee]}
                        </span>
                      )}
                    {Boolean(task.receipt) && (
                      <details className='max-w-sm text-sm text-muted-foreground'>
                        <summary className='cursor-pointer whitespace-nowrap'>
                          查看回执
                        </summary>
                        <p className='mt-2 break-words whitespace-pre-wrap'>
                          {receiptText(task)}
                        </p>
                      </details>
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
function stageSummary(snapshot: Snapshot) {
  const { workflow, analysis, state } = snapshot
  const rejected =
    state.suppliers.find((supplier) => supplier.id === 'B')?.quality ===
    'rejected'
  switch (workflow.stage) {
    case 'S0':
      return '到料日发生变化，影响范围尚待分析。'
    case 'S1':
      return rejected
        ? '供应商 B 质量核验未通过，当前继续由 A 供应。补齐依据后再处理候选路径。'
        : workflow.analysisStep < 1
          ? '正在分析到料影响。'
          : `已关联 ${analysis.linkedCount} 条订单，其中 ${analysis.riskCount} 条存在当前方案到料风险。`
    case 'S2':
      return '当前由质量负责人处理供应商 B 的质量资格核验。'
    case 'S3':
      return '供应商 B 质量核验已通过，等待业务负责人批准。'
    case 'S4':
      return '负责人已批准切换供应商 B，采购与销售分别处理后续任务。'
    case 'S5':
      return workflow.canClose
        ? '采购、销售回执已齐，等待业务负责人复核。'
        : `已有部门提交回执，还差 ${workflow.missingReceipts.length} 项必要回执。`
    case 'S6':
      return '办公协同事项已完成，决定、质量凭据和部门回执均已留档。'
  }
}
export function Home(props: BusinessProps) {
  const { snapshot, viewMatter, ask, role, busy, startAnalysis } = props
  const { state, analysis, workflow } = snapshot
  const [showConditions, setShowConditions] = useState(false)
  const supplierA = state.suppliers.find((supplier) => supplier.id === 'A')
  const supplierB = state.suppliers.find((supplier) => supplier.id === 'B')
  const analyzed = workflow.analysisStep >= 1
  const decisionsKnown = workflow.analysisStep >= 2
  const own = state.tasks.find(
    (task) => task.assignee === role && workStatus(task) !== 'completed'
  )
  return (
    <div className='space-y-6'>
      <div className='flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm'>
        <AlertCircle className='mt-0.5 size-4 shrink-0' />
        <div>
          <p className='font-medium'>供应商 A 更新了到料日</p>
          <p className='mt-1 text-muted-foreground'>
            原定 D{supplierA?.originalDay ?? 3} → 最新 D{supplierA?.arrivalDay}{' '}
            · SUP-001 · 原料 M-01
          </p>
        </div>
      </div>
      <div className='grid gap-6 xl:grid-cols-[1.3fr_1fr]'>
        <Section
          title='供应商交期变更'
          aside={<Badge variant='outline'>{workflow.label}</Badge>}
        >
          <div className='space-y-5'>
            <p className='text-sm text-muted-foreground'>
              SUP-001 · 原料 M-01 · 当前供应商 {state.matter.supplierId}
            </p>
            <p className='text-base leading-7'>{stageSummary(snapshot)}</p>
            <div className='grid grid-cols-3 gap-3'>
              {[
                [analyzed ? analysis.linkedCount : '待分析', '关联订单'],
                [analyzed ? analysis.riskCount : '待分析', '当前方案到料风险'],
                [workflow.pendingActionCount, '待处理动作'],
              ].map(([value, label]) => (
                <div key={label}>
                  <p
                    className={`${analyzed || label === '待处理动作' ? 'text-3xl' : 'text-xl'} font-semibold tabular-nums`}
                  >
                    {value}
                  </p>
                  <p className='mt-2 text-xs leading-5 text-muted-foreground'>
                    {label}
                  </p>
                </div>
              ))}
            </div>
            {decisionsKnown && (
              <p className='border-t pt-4 text-sm'>
                当前有效决定{' '}
                <strong className='ml-2'>{analysis.effectiveDecisionId}</strong>
              </p>
            )}
            {workflow.stage === 'S6' && (
              <p className='text-sm'>
                已完成任务：
                {
                  state.tasks.filter((task) => workStatus(task) === 'completed')
                    .length
                }
              </p>
            )}
            <Button variant='ghost' className='px-0' onClick={viewMatter}>
              {workflow.stage === 'S6' ? '查看处理记录' : '查看完整事项'}
              <ArrowRight className='size-4' />
            </Button>
          </div>
        </Section>
        <Section
          title='当前行动'
          aside={<Badge variant='outline'>{roleNames[role]}</Badge>}
        >
          <div className='space-y-4 text-sm'>
            {role === 'lead' ? (
              <>
                {workflow.stage === 'S0' && (
                  <>
                    <p className='leading-7 text-muted-foreground'>
                      先关联到料要求，确认这次延期影响哪些订单。
                    </p>
                    <Button disabled={busy} onClick={startAnalysis}>
                      分析影响
                    </Button>
                  </>
                )}
                {workflow.stage === 'S1' && (
                  <>
                    <p className='leading-7 text-muted-foreground'>
                      {workflow.analysisStep < 2
                        ? '继续核对会议决定，确认当前有效方案。'
                        : '继续检查到料处置路径与供应商 B 的切换条件。'}
                    </p>
                    <Button disabled={busy} onClick={() => ask('')}>
                      继续处理
                    </Button>
                  </>
                )}
                {workflow.stage === 'S2' && (
                  <p className='leading-7 text-muted-foreground'>
                    T-QA · 供应商 B
                    质量资格核验。请切换质量负责人，在下方待办中处理；消息发送失败时先重试。
                  </p>
                )}
                {workflow.stage === 'S3' && (
                  <>
                    <p className='leading-7 text-muted-foreground'>
                      B 预计 D{supplierB?.arrivalDay} 到料；
                      {analysis.options.find(
                        (option) => option.supplierId === 'B'
                      )?.riskCount === 0
                        ? `${analysis.linkedCount} 条订单时间条件满足`
                        : '仍有订单时间条件不满足'}
                      ，质量核验已通过。批准前仍执行{' '}
                      {analysis.effectiveDecisionId}。
                    </p>
                    <BusinessActions {...props} />
                  </>
                )}
                {['S4', 'S5'].includes(workflow.stage) && (
                  <>
                    <p className='leading-7 text-muted-foreground'>
                      {workflow.canClose
                        ? '核对质量凭据、当前决定及两份部门回执后关闭事项。'
                        : `还差 ${workflow.missingReceipts.length} 项必要回执，等待对应岗位完成。`}
                    </p>
                    {workflow.canClose ? (
                      <BusinessActions {...props} />
                    ) : (
                      <Button
                        variant='outline'
                        onClick={() => setShowConditions((value) => !value)}
                      >
                        查看关闭条件
                      </Button>
                    )}
                    {!workflow.canClose && (
                      <ul className='space-y-2 text-muted-foreground'>
                        {workflow.missingReceipts.map((item) => (
                          <li key={item}>
                            待补齐：
                            {item === 'T-PUR'
                              ? '采购回执'
                              : item === 'T-SALES'
                                ? '销售回执'
                                : item}
                          </li>
                        ))}
                      </ul>
                    )}
                    {showConditions && (
                      <div className='rounded-md bg-muted/40 p-3 leading-7'>
                        质量核验通过；负责人批准产生有效决定；采购、销售均提交必要回执；最后由业务负责人复核。
                      </div>
                    )}
                  </>
                )}
                {workflow.stage === 'S6' && (
                  <div className='flex items-start gap-2 text-muted-foreground'>
                    <CheckCircle2 className='mt-1 size-4 shrink-0' />
                    <p className='leading-7'>
                      已完成最终复核，可到业务助手查询最新处理结果。
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className='leading-7 text-muted-foreground'>
                {own
                  ? `当前任务：${own.id} · ${own.title}。请在下方完成当前步骤。`
                  : '当前岗位暂无待处理任务。事项进展会随其他岗位的处理自动更新。'}
              </p>
            )}
          </div>
        </Section>
      </div>
      {state.tasks.length > 0 && (
        <Section
          title={role === 'lead' ? '事项推进' : '我的待办'}
          aside={<Badge variant='outline'>模拟收件箱</Badge>}
        >
          <Tasks {...props} />
        </Section>
      )}
      {workflow.stage === 'S6' && (
        <p className='rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground'>
          {boundary}
        </p>
      )}
    </div>
  )
}
function Paths({ snapshot }: { snapshot: Snapshot }) {
  const { state, analysis } = snapshot
  return (
    <Section title='到料处置路径比较'>
      <div className='grid gap-4 md:grid-cols-2'>
        {analysis.options.map((option) => (
          <div
            key={option.supplierId}
            className='space-y-4 rounded-lg border p-5'
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3 className='font-semibold'>
                {option.supplierId === 'A'
                  ? '继续由 A 供应'
                  : '满足条件后切换 B'}
              </h3>
              <Badge variant='outline'>
                {state.matter.supplierId === option.supplierId
                  ? '当前路径'
                  : '候选路径'}
              </Badge>
            </div>
            <p className='text-sm'>
              预计到料 D{option.arrivalDay} · 风险订单 {option.riskCount}
            </p>
            <p className='text-sm'>
              {option.supplierId === 'A'
                ? '供应资格有效'
                : `质量资格${option.quality === 'approved' ? '已通过' : option.quality === 'rejected' ? '未通过' : '待核验'}`}
            </p>
            <p className='text-sm leading-6 text-muted-foreground'>
              {option.supplierId === 'A'
                ? state.matter.supplierId === 'A'
                  ? '当前可以继续执行。'
                  : '原路径已被替代，历史依据保留。'
                : state.matter.supplierId === 'B'
                  ? '负责人已批准，当前执行 B 路径。'
                  : option.quality === 'rejected'
                    ? '质量条件未满足，当前不能切换。'
                    : option.quality === 'approved'
                      ? '质量条件满足，仍待业务负责人批准。'
                      : '尚缺质量核验与业务负责人批准，当前不能执行。'}
            </p>
          </div>
        ))}
      </div>
      <p className='mt-4 text-sm leading-6 text-muted-foreground'>
        比较到料时间、质量资格与批准条件；未包含价格、产能、运输或商务条款。
      </p>
    </Section>
  )
}
function Decisions({
  snapshot,
  sources,
  openSource,
}: Pick<BusinessProps, 'snapshot' | 'sources' | 'openSource'>) {
  return (
    <Section title='决定沿革'>
      <div className='divide-y'>
        {snapshot.state.decisions.map((decision) => (
          <div
            key={decision.id}
            className='space-y-3 py-4 first:pt-0 last:pb-0'
          >
            <div className='flex flex-wrap items-center gap-3'>
              <span className='font-mono text-sm'>{decision.id}</span>
              {decision.id === 'DEC-02' ? (
                <Badge variant='secondary'>
                  {snapshot.state.matter.supplierId === 'B'
                    ? '附条件候选方案 · 条件已落实'
                    : '附条件候选方案｜未生效'}
                </Badge>
              ) : (
                <Status value={decision.status} />
              )}
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
  )
}
function BusinessRelations({ snapshot }: { snapshot: Snapshot }) {
  const { state, analysis, workflow } = snapshot
  const groups = [
    {
      title: '延期事件',
      items: [
        `供应商 A · D${state.suppliers.find((supplier) => supplier.id === 'A')?.arrivalDay}`,
        'SUP-001 · 原料 M-01',
      ],
    },
    ...(workflow.analysisStep >= 1
      ? [
          {
            title: '影响对象',
            items: analysis.orders.map(
              (order) =>
                `${order.id} · ${order.atRisk ? `晚 ${order.lateDays} 天` : '满足到料要求'}`
            ),
          },
        ]
      : []),
    ...(workflow.analysisStep >= 2
      ? [
          {
            title: '判断依据',
            items: [
              `${analysis.effectiveDecisionId} · 当前有效`,
              state.matter.supplierId === 'B'
                ? 'DEC-02 · 条件已落实'
                : 'DEC-02 · 附条件候选方案，未生效',
            ],
          },
        ]
      : []),
    ...(workflow.analysisStep >= 3
      ? [
          {
            title: '切换条件',
            items: [
              `供应商 B · 质量${state.suppliers.find((supplier) => supplier.id === 'B')?.quality === 'approved' ? '已通过' : state.suppliers.find((supplier) => supplier.id === 'B')?.quality === 'rejected' ? '未通过' : '待核验'}`,
              state.matter.supplierId === 'B'
                ? '业务负责人 · 已批准'
                : '业务负责人 · 待批准',
            ],
          },
        ]
      : []),
    ...(state.tasks.length
      ? [
          {
            title: '当前相关任务',
            items: state.tasks.map(
              (task) =>
                `${task.id} · ${roleNames[task.assignee]} · ${workLabels[workStatus(task)]}`
            ),
          },
        ]
      : []),
  ]
  return (
    <Section title='业务关系'>
      <div className='space-y-4'>
        {groups.map((group, index) => (
          <div key={group.title}>
            {index > 0 && (
              <div
                aria-hidden='true'
                className='mb-4 ml-5 h-5 border-l border-dashed'
              />
            )}
            <div className='rounded-lg border p-4'>
              <p className='mb-3 flex items-center gap-2 text-sm font-medium'>
                <Link2 className='size-4 text-muted-foreground' />
                {group.title}
              </p>
              <div className='flex flex-wrap gap-2'>
                {group.items.map((item) => (
                  <span
                    key={item}
                    className='rounded-md bg-muted/50 px-3 py-2 text-sm'
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className='mt-5 text-sm text-muted-foreground'>
        当前进展：{workflow.label}。
        {workflow.analysisStep < 1
          ? '完成分析后显示影响对象与判断依据。'
          : stageSummary(snapshot)}
      </p>
    </Section>
  )
}
export function Matter(props: BusinessProps) {
  const { snapshot, sources, openSource } = props
  const { state, workflow } = snapshot
  const visibleSources = sources.filter((source) => {
    if (source.id === 'DEMO-STATE') return false
    if (workflow.analysisStep < 1) return source.id === 'DOC-NOTICE'
    if (workflow.analysisStep < 2)
      return ['DOC-NOTICE', 'DOC-LEDGER'].includes(source.id)
    if (workflow.analysisStep < 3)
      return [
        'DOC-NOTICE',
        'DOC-LEDGER',
        'DOC-MEETING-01',
        'DOC-MEETING-02',
      ].includes(source.id)
    return true
  })
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-3'>
          <Badge variant='outline'>SUP-001</Badge>
          <Badge variant='secondary'>{workflow.label}</Badge>
        </div>
        <Button
          variant='outline'
          onClick={() => {
            window.location.hash = 'home'
          }}
        >
          返回办公协同
        </Button>
      </div>
      <Tabs defaultValue='progress' className='min-w-0 gap-5'>
        <div className='overflow-x-auto'>
          <TabsList>
            {[
              ['progress', '处理进展'],
              ['impact', '影响与条件'],
              ['decisions', '决定沿革'],
              ['sources', '来源资料'],
              ['relations', '业务关系'],
            ].map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value='progress' className='space-y-6'>
          <Section title='处理进展'>
            <p className='mb-6 text-sm leading-7'>{stageSummary(snapshot)}</p>
            <ol className='space-y-5'>
              <li className='flex gap-3'>
                <div className='mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50' />
                <div>
                  <p className='text-sm leading-6'>
                    延期事件：供应商 A 原定 D
                    {state.suppliers.find((supplier) => supplier.id === 'A')
                      ?.originalDay ?? 3}{' '}
                    → 最新 D
                    {
                      state.suppliers.find((supplier) => supplier.id === 'A')
                        ?.arrivalDay
                    }
                  </p>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    采购延期通知 · 演示起点
                  </p>
                  <Button
                    variant='link'
                    className='mt-2 h-auto p-0 text-sm'
                    onClick={() =>
                      openSource(
                        sources.find(
                          (source) => source.id === 'DOC-NOTICE'
                        ) || { id: 'DOC-NOTICE', title: '采购延期通知样例' }
                      )
                    }
                  >
                    查看来源
                  </Button>
                </div>
              </li>
              {state.events.map((event) => (
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
          </Section>
          {state.tasks.length > 0 && (
            <Section title='任务与处理回执'>
              <Tasks {...props} readOnly />
            </Section>
          )}
        </TabsContent>
        <TabsContent value='impact' className='space-y-6'>
          <Section title='当前方案到料影响'>
            <Orders snapshot={snapshot} />
          </Section>
          {workflow.analysisStep >= 3 ? (
            <Paths snapshot={snapshot} />
          ) : (
            <p className='text-sm text-muted-foreground'>
              完成历史决定追溯与路径检查后，将在这里保存到料处置条件。
            </p>
          )}
        </TabsContent>
        <TabsContent value='decisions'>
          {workflow.analysisStep >= 2 ? (
            <Decisions {...props} />
          ) : (
            <Section title='决定沿革'>
              <p className='text-sm text-muted-foreground'>
                尚未追溯会议决定。请先在业务助手中完成影响研判。
              </p>
            </Section>
          )}
        </TabsContent>
        <TabsContent value='sources'>
          <Section title='来源资料'>
            <Sources sources={visibleSources} open={openSource} />
            <p className='mt-4 text-sm leading-6 text-muted-foreground'>
              已读取的资料随处理进展归档。数据均为合成样例，未连接龙盛 OA、ERP
              或真实 DataOS。
            </p>
            {state.tasks.some((task) => task.receipt) && (
              <div className='mt-5 space-y-4 border-t pt-4'>
                {state.tasks
                  .filter((task) => task.receipt)
                  .map((task) => (
                    <details key={task.id}>
                      <summary className='cursor-pointer text-sm'>
                        {task.id} ·{' '}
                        {task.id === 'T-QA' ? '质量核验凭据' : '处理回执'}
                      </summary>
                      <p className='mt-3 text-sm leading-6 break-words whitespace-pre-wrap'>
                        {receiptText(task)}
                      </p>
                    </details>
                  ))}
              </div>
            )}
          </Section>
        </TabsContent>
        <TabsContent value='relations'>
          <BusinessRelations snapshot={snapshot} />
        </TabsContent>
      </Tabs>
      {workflow.stage === 'S6' && (
        <p className='text-sm leading-6 text-muted-foreground'>{boundary}</p>
      )}
    </div>
  )
}

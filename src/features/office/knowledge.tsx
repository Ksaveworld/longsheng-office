import { HandlingSummary } from './handling-summary'
import { ArrowRight, FileSearch, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { OfficeGraph } from './graph'
import { OrderChainPanel } from './order-chain'
import { SupplyImport } from './supply-import'
import { Sources, Status } from './shared'
import { roleNames, type Snapshot, type Source } from './types'

type Props = {
  snapshot: Snapshot
  sources: Source[]
  openSource: (source: Source) => void
}

export function SupplyEntry({
  snapshot,
  ask,
  viewMatter,
}: {
  snapshot: Snapshot
  ask: (question: string, id?: string) => void
  viewMatter: (id?: string) => void
}) {
  const { state, presentation, analysis } = snapshot
  return (
    <section
      aria-label='供应延期协同'
      className='rounded-xl border bg-card p-5'
    >
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex min-w-0 items-start gap-3'>
          <Truck className='mt-1 size-5 shrink-0 text-primary' />
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h2 className='text-lg font-semibold'>
                供应延期，从影响到处理结果
              </h2>
              <Badge variant='outline'>{presentation.stage}</Badge>
            </div>
            <p className='mt-2 text-sm leading-6 text-muted-foreground'>
              {state.matter.id} · {analysis.linkedCount} 条关联订单 ·{' '}
              {analysis.riskCount} 条到料风险
            </p>
          </div>
        </div>
        <Button
          onClick={() =>
            ask('这次延期影响什么，我现在需要作什么决定？', state.matter.id)
          }
        >
          查影响与决定 <ArrowRight className='size-4' />
        </Button>
      </div>
      <p className='mt-4 text-sm leading-7'>{presentation.conclusion}</p>
      <div className='mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4'>
        <p className='text-xs leading-6 text-muted-foreground'>
          查影响与决定 → 比较方案 → 人工核验与确认 → 跟进任务与回执
        </p>
        <div className='flex flex-wrap gap-2'>
          <Button asChild variant='outline' size='sm'>
            <a href={`#knowledge?id=${encodeURIComponent(state.matter.id)}`}>
              <FileSearch className='size-4' /> 核对业务依据
            </a>
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => viewMatter(state.matter.id)}
          >
            查看办理进度 <ArrowRight className='size-4' />
          </Button>
        </div>
      </div>
    </section>
  )
}

function MatterEvidence({ snapshot, sources, openSource }: Props) {
  const { state, analysis, presentation, graph } = snapshot
  const selectedPlan = state.planVersions.find(
    (item) => item.id === state.matter.planSelection?.planVersionId
  )
  const approvedPlan = state.planVersions.find(
    (item) => item.id === state.matter.executionApproval?.planVersionId
  )
  const objectSources = (type: string, id?: string) => {
    const ids = new Set(
      graph.objects
        .filter(
          (object) =>
            object.type === type && (!id || object.properties.id === id)
        )
        .flatMap((object) => object.sourceIds)
    )
    return sources.filter((source) => ids.has(source.id))
  }
  const impactIds = new Set([
    ...objectSources('Order').map((item) => item.id),
    ...objectSources('Supplier', state.matter.supplierId).map(
      (item) => item.id
    ),
  ])
  const evidence = (items: Source[]) =>
    items.length ? (
      <Sources sources={items} open={openSource} />
    ) : (
      <p className='text-xs text-muted-foreground'>
        当前未返回可查看的关联来源。
      </p>
    )
  return (
    <div className='grid min-w-0 gap-4 lg:grid-cols-2'>
      <section
        aria-label='影响依据'
        className='min-w-0 rounded-xl border bg-card p-5'
      >
        <h3 className='font-semibold'>
          {state.scenario ? '影响哪些业务' : '影响哪些订单'}
        </h3>
        {state.scenario ? (
          <div className='mt-3 space-y-3 text-sm leading-7'>
            <p>{state.scenario.trigger}</p>
            <p>{state.scenario.impact}</p>
            <p className='text-muted-foreground'>{state.scenario.risk}</p>
          </div>
        ) : (
          <>
            <p className='mt-2 text-sm leading-7'>
              按当前采用的供应商 {state.matter.supplierId} 计算，
              {analysis.linkedCount} 条关联订单中，{analysis.riskCount}{' '}
              条存在到料风险。
            </p>
            <div className='mt-3 space-y-2'>
              {analysis.orders.map((order) => (
                <div key={order.id} className='rounded-lg bg-muted/50 p-3'>
                  <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
                    <strong className='font-medium'>{order.id}</strong>
                    <span
                      className={
                        order.atRisk
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      {order.atRisk
                        ? `预计晚 ${order.lateDays} 天`
                        : '预计满足到料窗口'}
                    </span>
                  </div>
                  <p className='mt-1 text-xs leading-6 text-muted-foreground'>
                    最晚 D{order.requiredDay} 到料 · 当前预计 D
                    {order.arrivalDay} 到料
                  </p>
                </div>
              ))}
            </div>
            <p className='mt-3 text-xs leading-6 text-muted-foreground'>
              预计到料日超过最晚到料日，才计入风险；这不等同于成品交付延期或合同违约。
            </p>
          </>
        )}
        <div className='mt-4'>
          {evidence(
            state.scenario
              ? objectSources('BusinessObject')
              : sources.filter((source) => impactIds.has(source.id))
          )}
        </div>
      </section>

      <section
        aria-label='决定依据'
        className='min-w-0 rounded-xl border bg-card p-5'
      >
        <h3 className='font-semibold'>哪条决定有效</h3>
        <p className='mt-2 text-xs leading-6 text-muted-foreground'>
          按批准与生效条件判断，不能只看哪份记录更新。
        </p>
        <div className='mt-3 space-y-4'>
          {state.decisions.map((decision) => (
            <article key={decision.id} className='rounded-lg bg-muted/50 p-3'>
              <div className='flex flex-wrap items-center gap-2'>
                <Status value={decision.status} />
                <span className='text-xs text-muted-foreground'>
                  {decision.id}
                </span>
              </div>
              <p className='my-3 text-sm leading-7'>{decision.text}</p>
              {evidence(
                sources.filter((source) => source.id === decision.sourceId)
              )}
            </article>
          ))}
          {!state.decisions.length && (
            <p className='text-sm text-muted-foreground'>尚未记录决定。</p>
          )}
        </div>
      </section>

      <section
        aria-label='方案条件'
        className='min-w-0 rounded-xl border bg-card p-5'
      >
        <h3 className='font-semibold'>方案还缺什么条件</h3>
        <dl className='mt-3 space-y-2 text-sm leading-7'>
          <div>
            <dt className='inline text-muted-foreground'>已选意向：</dt>
            <dd className='inline'>{selectedPlan?.title || '尚未选择'}</dd>
          </div>
          <div>
            <dt className='inline text-muted-foreground'>已批方案：</dt>
            <dd className='inline'>{approvedPlan?.title || '尚未批准'}</dd>
          </div>
        </dl>
        <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-7'>
          {presentation.blockers.map((blocker, index) => (
            <li key={index}>{blocker}</li>
          ))}
        </ul>
        {!presentation.blockers.length && (
          <p className='mt-3 text-sm leading-7'>
            {state.matter.status === 'closed'
              ? '回执已完成复核，办公事项已关闭。'
              : '当前未列出阻塞条件，请核对办理进度。'}
          </p>
        )}
        <div className='mt-4'>
          {evidence(
            sources.filter(
              (source) =>
                selectedPlan?.sourceIds.includes(source.id) ||
                source.id ===
                  (state.matter.id === 'SUP-001'
                    ? 'DOC-RULES'
                    : `DOC-RULES-${state.matter.id}`)
            )
          )}
        </div>
      </section>

      <section
        aria-label='办理依据'
        className='min-w-0 rounded-xl border bg-card p-5'
      >
        <h3 className='font-semibold'>下一步由谁处理</h3>
        <p className='mt-3 text-sm leading-7'>{presentation.conclusion}</p>
        <p className='mt-2 text-sm leading-7 text-muted-foreground'>
          待处理岗位：
          {presentation.waitingRoles
            .map((role) => roleNames[role])
            .join('、') || '无待处理岗位'}
        </p>
        <p className='mt-2 text-sm leading-7 text-muted-foreground'>
          {state.matter.status === 'closed'
            ? '已完成回执复核。'
            : `仍缺 ${analysis.missingReceipts.length} 份处理回执；最终办结须负责人复核。`}
        </p>
        <div className='mt-4'>{evidence(objectSources('Matter'))}</div>
        <Button asChild variant='outline' size='sm' className='mt-4'>
          <a href={`#matter-detail?id=${encodeURIComponent(state.matter.id)}`}>
            查看任务与回执 <ArrowRight className='size-4' />
          </a>
        </Button>
      </section>
    </div>
  )
}

export function SemanticBasis(props: Props) {
  return (
    <details className='min-w-0 rounded-xl border p-4'>
      <summary className='cursor-pointer text-sm font-medium'>
        查看当前事项依据 · 影响、决定与办理条件
      </summary>
      <div className='mt-4 space-y-4'>
        <p className='text-xs leading-6 text-muted-foreground'>
          {props.snapshot.state.matter.id} · 当前数据版本{' '}
          {props.snapshot.state.revision}。历史回答的依据请在对应回答中查看。
        </p>
        <MatterEvidence {...props} />
        <a
          href={`#knowledge?id=${encodeURIComponent(props.snapshot.state.matter.id)}`}
          className='inline-flex items-center gap-1 text-sm text-primary'
        >
          打开业务依据工作台 <ArrowRight className='size-4' />
        </a>
      </div>
    </details>
  )
}

export function Knowledge(props: Props & { refresh: () => Promise<void> }) {
  const { snapshot, openSource } = props
  const { state, presentation } = snapshot
  return (
    <div className='min-w-0 space-y-5'>
      <HandlingSummary snapshot={snapshot} />
      <section className='rounded-xl border bg-card p-5'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div className='min-w-0'>
            <div className='mb-2 flex flex-wrap items-center gap-2'>
              <span className='text-sm text-muted-foreground'>
                {state.matter.id}
              </span>
              <Badge variant='outline'>{presentation.stage}</Badge>
            </div>
            <h2 className='text-xl leading-8 font-semibold'>
              {state.matter.title}
            </h2>
            <p className='mt-2 text-sm leading-7 text-muted-foreground'>
              核对影响、决定与办理条件，每条依据都能打开原始资料。
            </p>
          </div>
          <Button asChild variant='outline'>
            <a href={`#matter-detail?id=${encodeURIComponent(state.matter.id)}`}>
              查看事项办理进度 <ArrowRight className='size-4' />
            </a>
          </Button>
        </div>
      </section>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <label className='flex min-w-0 flex-wrap items-center gap-3 text-sm'>
          当前业务事项
          <select
            aria-label='选择知识事项'
            className='min-h-10 max-w-full rounded-md border bg-card px-3 py-2'
            value={state.matter.id}
            onChange={(event) => {
              window.location.hash = `knowledge?id=${encodeURIComponent(event.target.value)}`
            }}
          >
            {(snapshot.matters || [snapshot]).map((item) => (
              <option key={item.state.matter.id} value={item.state.matter.id}>
                {item.state.matter.id} · {item.state.matter.title}
              </option>
            ))}
          </select>
        </label>
        <span className='text-xs text-muted-foreground'>
          当前数据版本 {state.revision}
        </span>
      </div>
      <SupplyImport key={`${state.matter.id}-${snapshot.role}`} snapshot={snapshot} refresh={props.refresh} />
      <OrderChainPanel key={state.matter.id} chains={snapshot.orderChains || []} sources={props.sources} openSource={openSource} />
      <MatterEvidence {...props} />
      <details className='min-w-0 rounded-xl border p-5'>
        <summary className='cursor-pointer text-sm font-medium'>
          展开对象关系，追溯关联资料
        </summary>
        <div className='mt-5'>
          <OfficeGraph
            key={state.matter.id}
            graph={snapshot.graph}
            openSource={openSource}
          />
        </div>
      </details>
      <p className='text-xs leading-6 text-muted-foreground'>
        合成业务样例 · 当前由独立演示后台提供数据，尚未接入产研产品或企业 OA。
        办结表示办公协同完成，不代表实物到货或订单交付。
      </p>
    </div>
  )
}

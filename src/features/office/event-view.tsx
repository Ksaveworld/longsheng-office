import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Section, Sources, Status } from './shared'
import {
  roleNames,
  type Action,
  type Snapshot,
  type Source,
  type Role,
} from './types'

type Props = {
  snapshot: Snapshot
  sources: Source[]
  openSource: (source: Source) => void
}
export function EventContext({ snapshot, sources, openSource }: Props) {
  const { matter, scenario } = snapshot.state
  if (!scenario) return null
  return (
    <Section title={scenario.eventType}>
      <div className='space-y-3 text-sm leading-7'>
        <p>
          <strong>业务对象：</strong>
          {matter.businessObject}
        </p>
        <p>
          {matter.urgency} · 处理期限：
          {matter.dueAt
            ? new Date(matter.dueAt).toLocaleDateString('zh-CN')
            : '待确认'}{' '}
          · {snapshot.presentation.stage}
        </p>
        <p>
          <strong>触发原因：</strong>
          {scenario.trigger}
        </p>
        <p>
          <strong>业务影响：</strong>
          {scenario.impact}
        </p>
        <p>
          <strong>方案核验岗位：</strong>
          {roleNames[scenario.reviewer]}
        </p>
        <Sources
          sources={sources.filter((s) => s.id.includes('DOC-NOTICE'))}
          open={openSource}
        />
      </div>
    </Section>
  )
}
export function EventPlans({
  snapshot,
  propose,
  busy,
  role,
}: {
  snapshot: Snapshot
  propose: (a: Action, v?: number) => void
  busy: boolean
  role: Role
}) {
  const { state } = snapshot
  return (
    <Section title='选择处理方案'>
      <div className='grid min-w-0 gap-4 lg:grid-cols-2'>
        {state.planVersions.map((p) => (
          <article
            key={p.id}
            className='min-w-0 space-y-3 rounded-lg border p-4 text-sm leading-7'
          >
            <h3 className='text-base font-semibold'>{p.title}</h3>
            <p>{p.summary}</p>
            <p>优势：{p.advantages.join('；')}</p>
            <p>待确认：{p.risks.join('；')}</p>
            <p>{p.constraints.join('；')}</p>
            {role === 'lead' &&
              !state.matter.executionApproval &&
              state.matter.status !== 'closed' && (
                <Button
                  disabled={
                    busy || state.matter.planSelection?.planVersionId === p.id
                  }
                  onClick={() =>
                    propose(
                      { type: 'select_event_plan', planVersionId: p.id },
                      state.revision
                    )
                  }
                >
                  {state.matter.planSelection?.planVersionId === p.id
                    ? '已选择此方案'
                    : '选择：' + p.title}
                </Button>
              )}
          </article>
        ))}
      </div>
    </Section>
  )
}
export function ExecutionCards({ snapshot, sources, openSource }: Props) {
  const { state, analysis } = snapshot
  const tasks = state.tasks.filter((t) => t.id !== 'T-QA')
  const plan = state.planVersions.find(
    (p) => p.id === state.matter.planSelection?.planVersionId
  )
  const complete =
    analysis.executionApproved &&
    tasks.length > 0 &&
    analysis.missingReceipts.length === 0
  return (
    <div className='space-y-4'>
      {tasks.length > 0 && (
        <Section title='部门任务与回执'>
          <p className='mb-4 text-sm leading-7'>
            已确认方案：{plan?.title || state.matter.planSelection?.supplierId}
            。任务在 Demo 收件箱中流转。
          </p>
          <div className='space-y-3'>
            {tasks.map((t) => (
              <article
                key={t.id}
                className='rounded-lg border p-4 text-sm leading-7'
              >
                <div className='flex flex-wrap justify-between gap-2'>
                  <strong>
                    {roleNames[t.assignee]} · {t.title}
                  </strong>
                  <Status value={t.status} />
                </div>
                <p className='text-muted-foreground'>
                  任务 {t.id} · 已尝试发送 {t.attempts} 次
                </p>
                <p>
                  {t.status === 'pending_delivery'
                    ? '等待负责人确认发送。'
                    : t.status === 'delivery_failed'
                      ? '发送失败，请重试原任务。'
                      : t.status === 'delivered'
                        ? '已发送并送达，等待本岗位确认接收。'
                        : t.status === 'accepted'
                          ? '本岗位已确认收到，等待开始处理。'
                          : t.status === 'in_progress'
                            ? '本岗位正在处理，尚未提交回执。'
                            : '本岗位已提交回执。'}
                </p>
                {!!t.receipt &&
                  typeof t.receipt === 'object' &&
                  'evidence' in t.receipt && (
                    <p className='break-words whitespace-pre-wrap'>
                      回执：{String(t.receipt.evidence)}
                    </p>
                  )}
              </article>
            ))}
          </div>
          {!complete && analysis.executionApproved && (
            <p className='mt-4 text-sm'>
              等待
              {tasks
                .filter((t) => analysis.missingReceipts.includes(t.id))
                .map((t) => roleNames[t.assignee])
                .join('、')}
              提交回执；收齐后生成事件总结。
            </p>
          )}
        </Section>
      )}
      {complete && (
        <Section
          title='事件总结'
          aside={
            <Badge variant='outline'>
              {state.matter.status === 'closed' ? '已复核办结' : '等待最终复核'}
            </Badge>
          }
        >
          <div className='space-y-3 text-sm leading-7'>
            <p>
              <strong>起因与影响：</strong>
              {state.scenario
                ? state.scenario.trigger + ' ' + state.scenario.impact
                : `${snapshot.presentation.title}；关联 ${analysis.linkedCount} 条订单，当前 ${analysis.riskCount} 条到料风险。`}
            </p>
            <p>
              <strong>采用方案：</strong>
              {plan?.title}；确认人：
              {roleNames[state.matter.executionApproval?.approvedBy || 'lead']}
            </p>
            {tasks.map((t) => {
              const r = t.receipt as
                | {
                    evidence?: string
                    actor?: Role
                    at?: string
                    sourceIds?: string[]
                  }
                | undefined
              return (
                <div key={t.id}>
                  <p>
                    <strong>{roleNames[t.assignee]}：</strong>
                    {r?.evidence}
                  </p>
                  <p className='text-muted-foreground'>
                    提交人：{r?.actor ? roleNames[r.actor] : '未记录'} ·{' '}
                    {r?.at ? new Date(r.at).toLocaleString('zh-CN') : '未记录'}
                  </p>
                  <Sources
                    sources={sources.filter((s) =>
                      r?.sourceIds?.includes(s.id)
                    )}
                    open={openSource}
                  />
                </div>
              )
            })}
            <p>
              <strong>遗留风险：</strong>
              {state.scenario?.risk ||
                `当前仍有 ${analysis.riskCount} 条到料风险，协同完成不代表实际到货或订单交付。`}
            </p>
            <p>
              {state.matter.status === 'closed'
                ? '业务负责人已复核关闭，处理记录已保留。'
                : analysis.canClose
                  ? '必要任务回执齐全，可由负责人核对后关闭。'
                  : '当前关闭条件尚未满足。'}
            </p>
          </div>
        </Section>
      )}
    </div>
  )
}
export function EventDetail(props: Props & { ask: (q: string) => void }) {
  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-xl font-semibold'>
          {props.snapshot.state.matter.title}
        </h2>
        <Status value={props.snapshot.state.matter.status} />
      </div>
      <EventContext {...props} />
      <EventPlans
        snapshot={props.snapshot}
        propose={() => {}}
        busy
        role={props.snapshot.role}
      />
      <Section title='当前办理进度'>
        <p>{props.snapshot.presentation.conclusion}</p>
        <Button
          className='mt-4'
          onClick={() => props.ask('这件事目前处理到哪里，还需要谁办理？')}
        >
          向业务助手询问影响与依据
        </Button>
      </Section>
      <ExecutionCards {...props} />
      <Section title='处理记录'>
        <div className='space-y-3 text-sm'>
          {props.snapshot.state.events.map((e) => (
            <p id={'event-' + e.id} key={e.id}>
              {roleNames[e.actor as Role]} · {e.message} ·{' '}
              {new Date(e.at).toLocaleString('zh-CN')}
            </p>
          ))}
        </div>
      </Section>
      <Sources sources={props.sources} open={props.openSource} />
    </div>
  )
}

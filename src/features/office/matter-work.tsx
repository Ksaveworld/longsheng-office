import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { BusinessProps } from './business'
import { EventPlans } from './event-view'
import { Sources } from './shared'
import { roleNames, type Presentation, type Role } from './types'

export function MatterWork({
  snapshot,
  role,
  busy,
  propose,
  giveReceipt,
  sources,
  openSource,
  ask,
  switchRole,
}: BusinessProps & { switchRole?: (role: Role) => void }) {
  const { state, presentation: p, analysis } = snapshot
  const [showPlans, setShowPlans] = useState(false)
  const selection = state.matter.planSelection
  const qa = state.tasks.find(
    (t) =>
      t.id === 'T-QA' &&
      t.planVersionId === selection?.planVersionId &&
      !t.selectionInvalidated
  )
  const closed = state.matter.status === 'closed'
  const waitingForReview =
    !closed &&
    !analysis.executionApproved &&
    p.stage === '核验中' &&
    qa &&
    ['delivered', 'accepted', 'in_progress'].includes(qa.status)
  const current = waitingForReview
    ? qa.status === 'delivered'
      ? `等待${roleNames[qa.assignee]}接收`
      : qa.status === 'accepted'
        ? `等待${roleNames[qa.assignee]}开始核验`
        : `${roleNames[qa.assignee]}核验中`
    : p.stage
  const ownActions = p.actions.filter(
    (a) => a.type !== 'choose_plan' || p.waitingRoles.includes(role)
  )
  const primary = ownActions[0]
  const nextRoles = p.waitingRoles.map((r) => roleNames[r]).join('、')
  const reviewSubmitted =
    waitingForReview && role !== qa.assignee && qa.status === 'delivered'
  function act(action: Presentation['actions'][number]) {
    if (action.type === 'choose_plan') {
      setShowPlans(true)
      return
    }
    if (['submit_quality', 'submit_receipt'].includes(action.type)) {
      const task = state.tasks.find(
        (t) => t.id === action.taskId && t.assignee === role
      )
      if (task) giveReceipt(task)
    } else {
      const { label: _label, ...payload } = action
      propose(payload)
    }
  }
  const label = (action: Presentation['actions'][number]) => {
    if (['request_quality', 'request_event_review'].includes(action.type))
      return '准备核验申请'
    if (action.taskId === 'T-QA' && action.type === 'accept_task')
      return '接收核验申请'
    if (action.taskId === 'T-QA' && action.type === 'start_task')
      return '开始核验'
    return action.label
  }
  return (
    <section
      aria-label='当前办理'
      className='space-y-4 rounded-xl border bg-card p-5 sm:p-6'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-xl font-semibold'>
          {reviewSubmitted
            ? '核验申请已提交'
            : closed
              ? '办公协同已办结'
              : '当前办理'}
        </h2>
        <Badge variant='outline'>演示岗位 · {roleNames[role]}</Badge>
      </div>
      <p className='text-sm break-words text-muted-foreground'>
        {state.matter.id} ·{' '}
        {state.matter.materialId || state.matter.businessObject}
        {selection && <> · 方案版本 {selection.planVersionId}</>}
      </p>
      <dl className='grid gap-4 sm:grid-cols-3'>
        <div>
          <dt className='text-sm text-muted-foreground'>当前状态</dt>
          <dd className='mt-1 font-semibold'>{current}</dd>
        </div>
        <div>
          <dt className='text-sm text-muted-foreground'>我的任务</dt>
          <dd className='mt-1 font-semibold'>
            {primary ? label(primary) : '你当前无需操作'}
          </dd>
        </div>
        <div>
          <dt className='text-sm text-muted-foreground'>当前责任岗位</dt>
          <dd className='mt-1 font-semibold'>
            {nextRoles || (closed ? '已完成协同' : '查看处理记录')}
          </dd>
        </div>
      </dl>
      <p className='text-sm leading-7'>{p.blockers[0] || p.conclusion}</p>
      {waitingForReview && (
        <p className='text-sm leading-7'>
          核验通过后，由业务负责人决定是否批准。
          {!state.scenario && `当前仍采用 ${state.matter.supplierId}。`}
        </p>
      )}
      {!waitingForReview && !state.scenario && (
        <p className='text-sm'>
          当前采用 {state.matter.supplierId}；
          {closed
            ? '协同办结不代表原料到货或订单交付。'
            : '方案选择、核验、批准与发送分别记录。'}
        </p>
      )}
      <div className='flex flex-wrap gap-3'>
        {primary && (
          <Button disabled={busy} onClick={() => act(primary)}>
            {label(primary)}
          </Button>
        )}
        <Button
          variant='outline'
          disabled={busy}
          onClick={() =>
            ask(
              state.scenario
                ? '这件事的影响和依据是什么？'
                : '这次延期影响哪些订单，当前决定是什么？'
            )
          }
        >
          询问影响与依据
        </Button>
      </div>
      {ownActions.length > 1 && (
        <details>
          <summary className='cursor-pointer text-sm'>其他可办动作</summary>
          <div className='mt-3 flex flex-wrap gap-2'>
            {ownActions.slice(1).map((a) => (
              <Button
                key={a.type + (a.taskId || '')}
                variant='outline'
                disabled={busy}
                onClick={() => act(a)}
              >
                {label(a)}
              </Button>
            ))}
          </div>
        </details>
      )}
      {waitingForReview && (
        <details className='border-t pt-3'>
          <summary className='cursor-pointer text-sm'>
            展开申请内容与依据
          </summary>
          <div className='mt-3 space-y-2 text-sm leading-7'>
            <p>
              核验任务：{qa.id} · 接收岗位：{roleNames[qa.assignee]}
            </p>
            <p>
              申请记录：
              {
                [...state.events]
                  .reverse()
                  .find((e) =>
                    ['request_quality', 'request_event_review'].includes(e.type)
                  )?.message
              }
            </p>
            <p>
              提交时间：
              {(() => {
                const at = [...state.events]
                  .reverse()
                  .find((e) =>
                    ['request_quality', 'request_event_review'].includes(e.type)
                  )?.at
                return at
                  ? new Date(at).toLocaleString('zh-CN')
                  : '历史记录未提供'
              })()}
            </p>
            <p>核对所选方案版本、关联影响与实施条件，提交结论及凭据。</p>
            <Sources
              sources={sources.filter((s) =>
                state.planVersions
                  .find((v) => v.id === selection?.planVersionId)
                  ?.sourceIds.includes(s.id)
              )}
              open={openSource}
            />
          </div>
        </details>
      )}
      {!primary &&
        !closed &&
        switchRole &&
        p.waitingRoles.filter((r) => r !== role).length > 0 && (
          <div className='border-t pt-3'>
            <p className='mb-2 text-xs text-muted-foreground'>
              演示下一岗位（切换后才可代入该岗位操作）
            </p>
            <div className='flex flex-wrap gap-2'>
              {p.waitingRoles
                .filter((r) => r !== role)
                .map((r) => (
                  <Button
                    key={r}
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={() => switchRole(r)}
                  >
                    切换至{roleNames[r]}体验下一步
                  </Button>
                ))}
            </div>
          </div>
        )}
      {ownActions.some(a => a.type === 'choose_plan') && (showPlans || primary?.type === 'choose_plan') &&
        (state.scenario ? (
          <EventPlans
            snapshot={snapshot}
            role={role}
            busy={busy}
            propose={propose}
          />
        ) : (
          <div className='grid gap-4 border-t pt-4 md:grid-cols-2'>
            {state.planVersions.map((v) => (
              <article
                key={v.id}
                className='min-w-0 space-y-3 rounded-lg border p-4 text-sm leading-7'
              >
                <h3 className='font-semibold'>{v.title}</h3>
                <p>{v.summary}</p>
                <p>版本：{v.id}</p>
                <p>{v.constraints.join('；')}</p>
                <Sources
                  sources={sources.filter((s) => v.sourceIds.includes(s.id))}
                  open={openSource}
                />
                <Button
                  variant='outline'
                  disabled={
                    busy ||
                    selection?.planVersionId === v.id ||
                    analysis.executionApproved ||
                    closed
                  }
                  onClick={() =>
                    propose({
                      type: 'select_plan',
                      supplierId: v.supplierId,
                      planVersionId: v.id,
                    })
                  }
                >
                  {selection?.planVersionId === v.id
                    ? '已选择此版本'
                    : `选择 ${v.supplierId} 此版本`}
                </Button>
              </article>
            ))}
          </div>
        ))}
    </section>
  )
}

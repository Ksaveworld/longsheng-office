import { useState } from 'react'
import { ArrowRight, Clock3, FileCheck2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BusinessProps } from './business'
import { Section } from './shared'
import { type Snapshot, roleNames } from './types'
const ordered = (all: Snapshot[]) =>
  [...all].sort(
    (a, b) =>
      a.presentation.priority - b.presentation.priority ||
      a.presentation.earliestRequiredDay - b.presentation.earliestRequiredDay ||
      a.state.matter.id.localeCompare(b.state.matter.id)
  )

export function Home(
  props: BusinessProps & {
    viewMatter: (id?: string, eventId?: string) => void
    ask: (q: string, id?: string) => void
  }
) {
  const all = ordered(props.snapshot.matters || [props.snapshot])
  const [filter, setFilter] = useState('all')
  const shown = all.filter((s) =>
    filter === 'all'
      ? true
      : s.presentation.category === filter
  )
  const own = shown.filter(
    (s) =>
      s.presentation.actions.length &&
      (s.presentation.waitingRoles.includes(props.role) ||
        s.presentation.actions.some((a) => a.type !== 'choose_plan'))
  )
  const follow = shown.filter((s) => !own.includes(s))
  const events = all
    .flatMap((s) =>
      s.state.events.map((e, sequence) => ({
        ...e,
        sequence,
        matterId: s.state.matter.id,
        summary:
          s.presentation.events.find((item) => item.id === e.id)?.summary ||
          e.message.split('。')[0],
      }))
    )
    .sort(
      (a, b) =>
        b.at.localeCompare(a.at) ||
        b.sequence - a.sequence ||
        a.matterId.localeCompare(b.matterId)
    )
    .slice(0, 4)
  const card = (s: Snapshot, compact = false) => {
    const p = s.presentation,
      closed = p.category === 'closed'
    return (
      <article
        key={s.state.matter.id}
        className='office-home-matter min-w-0 rounded-xl border bg-card p-4'
      >
        <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-2'>
          <button
            className='text-left'
            onClick={() => props.viewMatter(s.state.matter.id)}
          >
            <h3
              className={
                compact ? 'text-base font-semibold' : 'text-lg font-semibold'
              }
            >
              {p.title}
            </h3>
            <p className='mt-1 text-sm text-muted-foreground'>
              {s.state.matter.id} ·{' '}
              {s.state.matter.eventType || '供应商交期变更'}
            </p>
          </button>
          <Badge variant={p.priority === 0 ? 'destructive' : 'outline'}>
            {p.stage}
          </Badge>
        </div>
        <p className='mt-2 text-sm text-muted-foreground'>
          {s.state.matter.urgency || '高'} ·{' '}
          {s.state.matter.dueAt
            ? '处理期限 ' +
              new Date(s.state.matter.dueAt).toLocaleDateString('zh-CN')
            : '期限待确认'}
        </p>
        {s.state.scenario ? (
          <p className='my-3 text-sm leading-6'>
            {s.state.matter.businessObject} · {s.state.scenario.impact}
          </p>
        ) : (
          <div className='my-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
            <span>
              通知到料{' '}
              <strong>
                D{p.originalDay} → D{p.noticeArrivalDay}
              </strong>
            </span>
            <span>
              当前生效 {p.effectiveSupplierId} ·{' '}
              <strong
                className={s.analysis.riskCount ? 'text-destructive' : ''}
              >
                {s.analysis.riskCount} 条到料风险
              </strong>{' '}
              / {s.analysis.linkedCount} 条订单
            </span>
          </div>
        )}
        <p className='text-sm leading-6'>
          {closed ? p.conclusion : p.blockers[0] || p.conclusion}
        </p>
        {!compact && s.analysis.orders.some((o) => o.atRisk) && (
          <p className='mt-2 text-sm text-muted-foreground'>
            重点关注：
            {s.analysis.orders
              .filter((o) => o.atRisk)
              .map((o) => o.id + '（最迟 D' + o.requiredDay + ' 到料）')
              .join('、')}
          </p>
        )}
        <div className='mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3'>
          <span className='text-sm text-muted-foreground'>
            {closed
              ? '已保留决定、回执与复核记录'
              : p.waitingRoles.length
                ? '当前等待：' +
                  p.waitingRoles.map((r) => roleNames[r]).join('、')
                : '查看当前处理结果'}
          </span>
          <Button
            size='sm'
            variant={compact ? 'outline' : 'default'}
            onClick={() => props.viewMatter(s.state.matter.id)}
          >
            {closed
              ? '查看结果档案'
              : compact
                ? '查看进度'
                : '进入事项办理'}
            <ArrowRight className='size-4' />
          </Button>
        </div>
      </article>
    )
  }
  return (
    <div className='office-home min-w-0 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
        <p className='text-base text-muted-foreground'>
          查清订单影响，作出有依据的决定，跟进每份处理结果。
        </p>
        <span className='text-sm text-muted-foreground'>
          合成业务样例 · 岗位为演示身份
        </span>
      </div>
      <div className='rounded-xl border bg-card px-4 py-3'>
        <p className='font-medium'>{new Set(all.map(s => s.state.matter.eventType)).size} 种业务类型 · {all.length} 个代表事项</p>
        <p className='mt-1 text-sm text-muted-foreground'>每种类型展示一个案例。供应延期的完整流程集中在 M-01，从查询影响到部门回执与关闭。</p>
      </div>
      <div className='grid grid-cols-3 gap-3'>
        {[
          ['warning', '预警'],
          ['processing', '处理中'],
          ['closed', '已办结'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(filter === id ? 'all' : id)}
            aria-pressed={filter === id}
            className={
              'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-left ' +
              (filter === id ? 'border-primary ring-1 ring-primary' : '')
            }
          >
            <strong className='text-2xl tabular-nums'>
              {all.filter((s) => s.presentation.category === id).length}
            </strong>
            <span className='text-sm'>{label}</span>
          </button>
        ))}
      </div>
      {filter === 'closed' ? (
        <Section title='已办结 · 结果档案'>
          <div className='space-y-4'>
            {shown.map((s) => card(s))}
            {!shown.length && (
              <p className='py-6 text-muted-foreground'>暂无已办结事项。</p>
            )}
          </div>
        </Section>
      ) : (
        <div className='office-home-columns grid min-w-0 items-start gap-5'>
          <Section
            title='待我处理'
            aside={
              <Badge variant='outline'>
                {roleNames[props.role]} · {own.length}
              </Badge>
            }
          >
            <div className='space-y-3'>
              {own.map((s) => card(s))}
              {!own.length && (
                <div className='py-8 text-center text-muted-foreground'>
                  <FileCheck2 className='mx-auto mb-3 size-7' />
                  <p>当前岗位暂无待办</p>
                  <p className='mt-2 text-sm'>可查看执行跟进或已办结结果。</p>
                </div>
              )}
            </div>
          </Section>
          <div className='min-w-0 space-y-5'>
            <Section
              title='执行跟进'
              aside={
                <span className='text-sm text-muted-foreground'>
                  {follow.length} 件
                </span>
              }
            >
              <div className='space-y-3'>
                {follow.map((s) => card(s, true))}
                {!follow.length && (
                  <p className='py-4 text-sm text-muted-foreground'>
                    此分类暂无等待其他岗位的事项。
                  </p>
                )}
              </div>
            </Section>
            <Section title='最近处理记录'>
              <div className='space-y-4'>
                {events.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => props.viewMatter(e.matterId, e.id)}
                    className='flex w-full gap-3 text-left text-sm'
                  >
                    <Clock3 className='mt-1 size-4 shrink-0 text-muted-foreground' />
                    <span className='min-w-0'>
                      <span className='block leading-6'>{e.summary}</span>
                      <span className='mt-1 block text-muted-foreground'>
                        {e.matterId} ·{' '}
                        {roleNames[e.actor as keyof typeof roleNames]} ·{' '}
                        {new Date(e.at).toLocaleTimeString('zh-CN')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          </div>
        </div>
      )}
      <p className='text-sm text-muted-foreground'>
        到料风险按预计日期计算。办结表示协同完成，不表示实物到货、生产完成或订单交付。
      </p>
    </div>
  )
}

export function MatterList({
  snapshot,
  viewMatter,
}: {
  snapshot: Snapshot
  viewMatter: (id?: string) => void
}) {
  const defaults = {
    query: '',
    status: 'all',
    type: 'all',
    urgency: 'all',
    due: 'all',
    sort: 'new',
  }
  const [filters, setFilters] = useState(() => {
    try {
      return {
        ...defaults,
        ...JSON.parse(sessionStorage.getItem('office-matter-filters') || '{}'),
      }
    } catch {
      return defaults
    }
  })
  const update = (key: string, value: string) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    sessionStorage.setItem('office-matter-filters', JSON.stringify(next))
  }
  const reset = () => {
    setFilters(defaults)
    sessionStorage.removeItem('office-matter-filters')
  }
  const all = snapshot.matters || [snapshot]
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = (s: Snapshot) =>
    s.state.matter.dueAt
      ? Math.floor(
          (Date.parse(s.state.matter.dueAt) - today.getTime()) / 86400000
        )
      : Infinity
  const shown = all
    .filter((s) => {
      const m = s.state.matter
      return (
        (filters.status === 'all' ||
          s.presentation.category === filters.status) &&
        (filters.type === 'all' ||
          (m.eventType || '供应商交期变更') === filters.type) &&
        (filters.urgency === 'all' ||
          (m.urgency || '高') === filters.urgency) &&
        (filters.due === 'all' ||
          (filters.due === 'overdue' && days(s) < 0) ||
          (filters.due === 'today' && days(s) === 0) ||
          (filters.due === '3' && days(s) >= 0 && days(s) <= 3)) &&
        `${m.id} ${m.title} ${m.materialId} ${m.businessObject || ''} ${s.presentation.title}`
          .toLowerCase()
          .includes(filters.query.toLowerCase())
      )
    })
    .sort((a, b) => {
      const delta = (a.state.matter.createdAt || '').localeCompare(
        b.state.matter.createdAt || ''
      )
      return (
        (filters.sort === 'new' ? -delta : delta) ||
        a.state.matter.id.localeCompare(b.state.matter.id)
      )
    })
  const select = (key: string, label: string, options: string[][]) => (
    <label className='min-w-0 space-y-2 text-sm' key={key}>
      <span className='block font-medium'>{label}</span>
      <select
        className='h-11 w-full min-w-0 rounded-md border bg-card px-3 text-sm'
        aria-label={label}
        value={filters[key as keyof typeof filters]}
        onChange={(e) => update(key, e.target.value)}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <Section title='事项列表'>
      <div className='mb-5 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        <label className='min-w-0 space-y-2 text-sm'>
          <span className='block font-medium'>搜索事项</span>
          <Input
            className='h-11'
            aria-label='搜索事项'
            placeholder='事项、编号或业务对象'
            value={filters.query}
            onChange={(e) => update('query', e.target.value)}
          />
        </label>
        {select('type', '事件类型', [
          ['all', '全部类型'],
          ...[
            ...new Set(
              all.map((s) => s.state.matter.eventType || '供应商交期变更')
            ),
          ].map((t) => [t, t]),
        ])}
        {select('urgency', '紧急度', [
          ['all', '全部紧急度'],
          ['紧急', '紧急'],
          ['高', '高'],
          ['普通', '普通'],
        ])}
        {select('due', '处理期限', [
          ['all', '全部期限'],
          ['overdue', '已逾期'],
          ['today', '今日到期'],
          ['3', '未来三天内'],
        ])}
        {select('status', '事项状态', [
          ['all', '全部状态'],
          ['warning', '预警'],
          ['processing', '处理中'],
          ['closed', '已办结'],
        ])}
        {select('sort', '创建日期排序', [
          ['new', '从新到旧'],
          ['old', '从旧到新'],
        ])}
      </div>
      <div className='mb-3 flex items-center justify-between gap-3 text-sm'>
        <span>共 {shown.length} 条</span>
        <Button variant='outline' onClick={reset}>
          清除筛选
        </Button>
      </div>
      <div className='divide-y'>
        {shown.map((s) => (
          <button
            key={s.state.matter.id}
            className='flex w-full flex-wrap items-center justify-between gap-4 py-5 text-left hover:bg-muted/40'
            onClick={() => viewMatter(s.state.matter.id)}
          >
            <span className='min-w-0'>
              <strong>{s.presentation.title}</strong>
              <span className='mt-2 block text-sm text-muted-foreground'>
                {s.state.matter.id} ·{' '}
                {s.state.matter.eventType || '供应商交期变更'} ·{' '}
                {s.state.matter.urgency || '高'} ·{' '}
                {s.state.matter.businessObject || s.state.matter.materialId}
              </span>
              <span className='mt-1 block text-sm'>
                处理期限：
                {s.state.matter.dueAt
                  ? new Date(s.state.matter.dueAt).toLocaleDateString('zh-CN')
                  : '待确认'}
              </span>
              <span className='mt-1 block text-sm'>
                {s.presentation.conclusion}
              </span>
            </span>
            <Badge variant='outline'>{s.presentation.stage}</Badge>
          </button>
        ))}
      </div>
      {!shown.length && (
        <div className='py-10 text-center text-muted-foreground'>
          <p>没有符合条件的事项</p>
          <Button className='mt-3' variant='outline' onClick={reset}>
            恢复全部事项
          </Button>
        </div>
      )}
    </Section>
  )
}

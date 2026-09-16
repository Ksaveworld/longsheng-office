import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowUp,
  Loader2,
  Plus,
  Square,
  RotateCcw,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { officeApi, errorText } from './api'
import { Orders } from './business'
import { EventContext, EventPlans, ExecutionCards } from './event-view'
import { ErrorNotice, RunContent, Section, Sources } from './shared'
import {
  roleNames,
  type Action,
  type AssistantSession,
  type Conversation,
  type History,
  type ModelConfig,
  type ModelRequest,
  type PlanVersion,
  type Role,
  type Run,
  type Snapshot,
  type Source,
  type Task,
} from './types'
import { useHistoryLayout } from './use-history-layout'
import { SemanticBasis } from './knowledge'

const briefingQuestion = '这次延期影响什么，我现在需要作什么决定？'
const prompts = [
  {
    label: '影响与待决事项',
    question: briefingQuestion,
    queryType: 'briefing',
  },
  { label: '查询到料影响', question: '当前延期影响哪些订单？' },
  { label: '核对会议决定', question: '之前会议如何决定？现在以哪条为准？' },
  {
    label: '比较供应方案',
    question: '请比较 A 和 B 方案，给出可核对的候选方案。',
  },
  { label: '查询处理进度', question: '现在处理到哪里了？我可以办理什么？' },
] as const
type ResultFacts = {
  state: Snapshot['state']
  analysis: Snapshot['analysis']
  presentation?: Snapshot['presentation']
}
type Props = {
  role: Role
  config: ModelConfig | null
  history: History
  snapshot: Snapshot
  session: AssistantSession
  updateSession: (p: Partial<AssistantSession>) => void
  sources: Source[]
  refresh: () => Promise<void>
  openSource: (s: Source) => void
  propose: (a: Action, version?: number) => void
  giveReceipt: (t: Task) => void
  viewMatter: () => void
  actionBusy: boolean
}
export function Assistant(props: Props) {
  const { snapshot, role, openSource, propose } = props,
    { state, analysis } = snapshot
  const {
    containerRef: historyContainerRef,
    toggleRef: historyToggleRef,
    ...historyLayout
  } = useHistoryLayout()
  const key = `office-conversation-${snapshot.workspaceId}-${state.matter.id}-${role}`
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [conversationId, setConversationId] = useState(
      () => sessionStorage.getItem(key) || ''
    ),
    [messages, setMessages] = useState<Run[]>([])
  const [question, setQuestion] = useState(() => {
    const p = sessionStorage.getItem('office-prefill-' + state.matter.id)
    const id = sessionStorage.getItem(key)
    return p || (id ? sessionStorage.getItem('office-draft-' + id) : null) || ''
  })
  const [busy, setBusy] = useState(false),
    [restoring, setRestoring] = useState(true),
    [error, setError] = useState(''),
    [pending, setPending] = useState<ModelRequest | null>(null),
    [showPlans, setShowPlans] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    [feedback, setFeedback] = useState(''),
    [reason, setReason] = useState('')
  const abort = useRef<AbortController | null>(null),
    lock = useRef(false),
    scroll = useRef<HTMLDivElement>(null),
    mounted = useRef(true),
    loadSequence = useRef(0)
  const selected = state.matter.planSelection
  const lastRevision = useRef(state.revision)
  useEffect(() => {
    if (lastRevision.current !== state.revision && selected) {
      requestAnimationFrame(() =>
        document
          .getElementById('current-work')
          ?.scrollIntoView({ block: 'nearest' })
      )
    }
    lastRevision.current = state.revision
  }, [state.revision, selected])
  const activePrompts = state.scenario
    ? [
        {
          label: '查询事件影响',
          question: '当前事件的起因、影响和待决事项是什么？',
        },
        {
          label: '比较处理方案',
          question: '请比较当前事件的处理方案、条件和涉及岗位。',
        },
        { label: '查询处理进度', question: '这件事处理到哪里，还需要谁办理？' },
      ]
    : prompts
  const lastDraft = messages
    .filter((r) => r.status === 'completed' && r.planVersions?.length)
    .slice(-1)[0]
  const drafts =
    lastDraft?.planVersions ||
    state.planVersions.filter((p) => p.id.endsWith('-v1'))
  async function list() {
    const r = await officeApi<{ conversations: Conversation[] }>(
      '/conversations',
      role
    )
    if (mounted.current) setConversations(r.conversations)
    return r.conversations
  }
  async function load(id: string, restoreDraft = true) {
    const sequence = ++loadSequence.current
    setRestoring(true)
    try {
      const r = await officeApi<{
        conversation: Conversation
        runs: Run[]
        requests?: ModelRequest[]
      }>('/conversations/' + id, role)
      if (!mounted.current || sequence !== loadSequence.current) return
      setConversationId(id)
      sessionStorage.setItem(key, id)
      setMessages(r.runs)
      setShowPlans(false)

      if (restoreDraft)
        setQuestion(sessionStorage.getItem('office-draft-' + id) || '')
      const running = r.requests?.[0]
      setPending(running || null)
      setBusy(!!running || lock.current)
      requestAnimationFrame(() => {
        if (scroll.current)
          scroll.current.scrollTop = Number(
            sessionStorage.getItem('office-scroll-' + id) || 0
          )
      })
    } finally {
      if (mounted.current && sequence === loadSequence.current)
        setRestoring(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    const sequenceRef = loadSequence
    const sequence = ++sequenceRef.current
    sessionStorage.removeItem('office-prefill-' + state.matter.id)
    void list()
      .then((cs) => {
        if (!mounted.current || sequence !== loadSequence.current) return
        const id = sessionStorage.getItem(key)
        if (id && cs.some((c) => c.id === id)) return load(id, false)
        if (cs[0]) return load(cs[0].id, false)
        setRestoring(false)
      })
      .catch((e) => {
        if (mounted.current) {
          setError(errorText(e))
          setRestoring(false)
        }
      })
    return () => {
      mounted.current = false
      sequenceRef.current++
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (conversationId)
      sessionStorage.setItem('office-draft-' + conversationId, question)
    props.updateSession({ question })
  }, [question, conversationId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pending || pending.status !== 'running') return
    let active = true
    const timer = setInterval(() => {
      void officeApi<{ request: ModelRequest; run?: Run }>(
        '/requests/' + pending.id,
        role
      )
        .then(async (r) => {
          if (!active || r.request.status === 'running' || abort.current) return
          setPending(null)
          setBusy(false)
          lock.current = false
          await load(r.request.conversationId, false)
          await props.refresh()
          await list()
        })
        .catch((e) => {
          if (active) setError(errorText(e))
        })
    }, 1500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [pending?.id, role]) // eslint-disable-line react-hooks/exhaustive-deps
  async function newChat() {
    if (busy || restoring || lock.current) return
    loadSequence.current++
    setRestoring(true)
    try {
      const r = await officeApi<{ conversation: Conversation }>(
        '/conversations',
        role,
        {}
      )
      setError('')
      await list()
      await load(r.conversation.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      if (mounted.current) setRestoring(false)
    }
  }
  async function submit(
    input = question,
    adjustment = '',
    parentOverride?: string,
    queryType?: 'briefing'
  ) {
    const text = input.trim()
    if (!text || busy || restoring || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setShowPlans(false)

    let id = conversationId
    try {
      if (!id) {
        id = (
          await officeApi<{ conversation: Conversation }>(
            '/conversations',
            role,
            {}
          )
        ).conversation.id
        setConversationId(id)
        sessionStorage.setItem(key, id)
      }
      const requestId = crypto.randomUUID()
      const parentVersionId =
        parentOverride || selected?.planVersionId || drafts[0]?.id
      const current: ModelRequest = {
        id: requestId,
        conversationId: id,
        matterId: state.matter.id,
        role,
        status: 'running',
        question: text,
      }
      setPending(current)
      setQuestion('')
      abort.current = new AbortController()
      const result = await officeApi<{ run?: Run; request?: ModelRequest }>(
        '/chat',
        role,
        {
          question: text,
          conversationId: id,
          requestId,
          ...(queryType || text === briefingQuestion
            ? { queryType: 'briefing' }
            : {}),
          ...(adjustment ? { feedback: adjustment, parentVersionId } : {}),
        },
        abort.current.signal
      )
      if (!mounted.current) return
      if (result.run) {
        await load(id, false)
        setShowPlans(
          result.run.status === 'completed' && result.run.intent === 'plans'
        )
        if (result.run.status === 'failed') setQuestion(text)
      } else if (result.request?.status === 'cancelled')
        setError('已停止本次查询，业务状态未修改。')
      await props.refresh()
      await list()
    } catch (e) {
      if (mounted.current) {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setError(errorText(e))
        setQuestion(text)
      }
    } finally {
      if (mounted.current) {
        setBusy(false)
        setPending(null)
      }
      lock.current = false
      abort.current = null
    }
  }
  async function stop() {
    if (!pending) return
    try {
      await officeApi('/requests/' + pending.id + '/cancel', role, {
        conversationId: pending.conversationId,
        question: pending.question,
      })
      abort.current?.abort()
      setError('已停止本次查询，业务状态未修改。')
      setQuestion(pending.question)
      setBusy(false)
      setPending(null)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const historical = (run: Run) => run.revision !== state.revision
  const decisionCards = (facts: ResultFacts, sources: Source[]) => (
    <div className='space-y-3'>
      {facts.state.decisions.map((decision) => (
        <article key={decision.id} className='rounded-lg border p-3 text-sm'>
          <p className='font-medium'>
            {decision.id} ·{' '}
            {decision.status === 'effective'
              ? '当前有效'
              : decision.status === 'conditional'
                ? '有条件建议'
                : decision.status === 'superseded'
                  ? '历史已替代'
                  : '条件已落实'}
          </p>
          <p className='mt-2 leading-6'>{decision.text}</p>
          <div className='mt-3'>
            <Sources
              sources={sources.filter(
                (source) => source.id === decision.sourceId
              )}
              open={openSource}
            />
          </div>
        </article>
      ))}
    </div>
  )
  const comparison = (facts: ResultFacts, revision: number) => {
    const presented = facts.presentation
    const options = ['A', 'B'].map((id) => {
      const source = presented?.options.find(
        (option) => option.supplierId === id
      )
      const analyzed = facts.analysis.options.find(
        (option) => option.supplierId === id
      )
      return (
        source ||
        (analyzed
          ? {
              ...analyzed,
              riskOrderIds: facts.state.orders
                .filter(
                  (order) =>
                    order.materialId === facts.state.matter.materialId &&
                    order.requiredDay < analyzed.arrivalDay
                )
                .map((order) => order.id),
              arrangement: '',
              conditions: [] as string[],
            }
          : undefined)
      )
    })
    const approvedId = presented
      ? presented.approvedVersionId
      : facts.analysis.executionApproved
        ? facts.state.matter.executionApproval?.planVersionId
        : undefined
    const approved = (facts.state.planVersions || []).find(
      (plan) => plan.id === approvedId
    )
    return (
      <div className='min-w-0 space-y-3' aria-label='A/B 同版本预期对比'>
        <p className='text-sm leading-6 text-muted-foreground'>
          A/B 均按数据 v{revision}{' '}
          比较。以下为预计到料及对应风险，方案选择不改变当前生效安排。
        </p>
        <div className='flex flex-wrap gap-2 text-sm'>
          <Badge variant='outline'>
            当前生效：{facts.state.matter.supplierId}
          </Badge>
          <Badge variant='outline'>
            选择意向：
            {facts.state.matter.planSelection?.supplierId || '尚未选择'}
          </Badge>
          <Badge variant='outline'>
            已批准：
            {approved?.supplierId || (approvedId ? '已记录版本' : '尚未批准')}
          </Badge>
        </div>
        <div className='min-w-0 overflow-x-auto rounded-lg border'>
          <table className='w-full min-w-[440px] text-left text-sm'>
            <thead className='bg-muted/50'>
              <tr>
                <th className='p-3 font-medium'>比较维度</th>
                {['A', 'B'].map((id) => (
                  <th key={id} className='p-3 font-medium'>
                    {id} 方案
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className='align-top'>
              <tr className='border-t'>
                <th className='p-3 font-medium'>预计到料</th>
                {options.map((option, i) => (
                  <td key={i} className='p-3'>
                    {option ? `D${option.arrivalDay}` : '未记录'}
                  </td>
                ))}
              </tr>
              <tr className='border-t'>
                <th className='p-3 font-medium'>到料风险订单</th>
                {options.map((option, i) => (
                  <td key={i} className='p-3 leading-6'>
                    {option ? (
                      <>
                        {option.riskCount} 条
                        {option.riskOrderIds.length > 0 && (
                          <p className='break-words text-muted-foreground'>
                            {option.riskOrderIds.join('、')}
                          </p>
                        )}
                      </>
                    ) : (
                      '未记录'
                    )}
                  </td>
                ))}
              </tr>
              {presented && (
                <>
                  <tr className='border-t'>
                    <th className='p-3 font-medium'>后续安排</th>
                    {options.map((option, i) => (
                      <td key={i} className='p-3 leading-6'>
                        {option?.arrangement || '当前资料未说明'}
                      </td>
                    ))}
                  </tr>
                  <tr className='border-t'>
                    <th className='p-3 font-medium'>执行条件</th>
                    {options.map((option, i) => (
                      <td key={i} className='p-3 leading-6'>
                        {option?.conditions.length ? (
                          <ul className='space-y-1'>
                            {option.conditions.map((condition) => (
                              <li key={condition}>{condition}</li>
                            ))}
                          </ul>
                        ) : (
                          '请核对所选版本的条件'
                        )}
                      </td>
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {presented && (
          <p className='rounded-lg bg-primary/5 p-3 text-sm leading-6'>
            相对 A，B{' '}
            {presented.delta.arrivalDaysEarlier === 0
              ? '预计到料日相同'
              : `预计${presented.delta.arrivalDaysEarlier > 0 ? '提前' : '晚'} ${Math.abs(presented.delta.arrivalDaysEarlier)} 天到料`}
            ，
            {presented.delta.riskOrdersFewer === 0
              ? '到料风险订单数相同'
              : `到料风险订单${presented.delta.riskOrdersFewer > 0 ? '减少' : '增加'} ${Math.abs(presented.delta.riskOrdersFewer)} 条`}
            。 这些差异不代表方案已获批准或实物已到货。
          </p>
        )}
      </div>
    )
  }
  const planCard = (
    p: PlanVersion,
    canChoose: boolean,
    facts: ResultFacts = snapshot,
    sources: Source[] = props.sources,
    parentVersions = facts.state.planVersions || []
  ) => {
    const option = facts.analysis.options.find(
      (o) => o.supplierId === p.supplierId
    )
    const selection = facts.state.matter.planSelection
    const approvedId = facts.presentation
      ? facts.presentation.approvedVersionId
      : facts.analysis.executionApproved
        ? facts.state.matter.executionApproval?.planVersionId
        : undefined
    const parent = parentVersions.find(
      (version) => version.id === p.parentVersionId
    )
    const differences = parent
      ? [
          {
            label: '依据与优点',
            before: parent.advantages,
            after: p.advantages,
          },
          { label: '风险', before: parent.risks, after: p.risks },
          {
            label: '前置条件',
            before: parent.constraints,
            after: p.constraints,
          },
        ]
          .map((part) => ({
            label: part.label,
            added: part.after.filter((text) => !part.before.includes(text)),
            removed: part.before.filter((text) => !part.after.includes(text)),
          }))
          .filter((part) => part.added.length || part.removed.length)
      : []
    return (
      <article key={p.id} className='min-w-0 rounded-lg border p-4'>
        <div className='flex flex-wrap justify-between gap-2'>
          <h3 className='font-semibold'>{p.title}</h3>
          <div className='flex flex-wrap gap-2'>
            {selection?.planVersionId === p.id && (
              <Badge variant='outline'>已选意向</Badge>
            )}
            {approvedId === p.id && <Badge>已批准此版本</Badge>}
          </div>
        </div>
        <p className='mt-3 text-sm leading-6'>{p.summary}</p>
        <p className='mt-3 text-sm'>
          {canChoose ? '当前台账' : '回答时台账'} v{facts.state.revision}：
          {option
            ? `预计 D${option.arrivalDay} 到料 · ${option.riskCount} 条到料风险`
            : '未记录对应到料依据'}
        </p>
        {[
          ['依据与优点', p.advantages],
          ['风险', p.risks],
          ['前置条件', p.constraints],
          ['仍待满足或核实', p.gaps],
          ['待核实建议', p.suggestions],
        ].map(
          ([label, items]) =>
            Array.isArray(items) &&
            items.length > 0 && (
              <div key={label as string} className='mt-3'>
                <h4 className='text-sm font-medium text-muted-foreground'>
                  {label as string}
                </h4>
                <ul className='mt-1 space-y-1 text-sm leading-6'>
                  {items.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )
        )}
        {p.feedback && (
          <p className='mt-3 rounded-md bg-muted/50 p-3 text-sm leading-6'>
            调整反馈：{p.feedback}
          </p>
        )}
        {p.parentVersionId && (
          <details className='mt-3 border-t pt-3' open>
            <summary className='cursor-pointer text-sm font-medium'>
              相对原版本的调整
            </summary>
            {parent ? (
              <div className='mt-3 space-y-3 text-sm leading-6'>
                <p className='text-muted-foreground'>
                  对照原方案：{parent.title}
                </p>
                {parent.summary !== p.summary && (
                  <div>
                    <p className='font-medium'>方案说明已调整</p>
                    <p className='mt-1 text-muted-foreground'>
                      原：{parent.summary}
                    </p>
                    <p className='mt-1'>现：{p.summary}</p>
                  </div>
                )}
                {differences.map((part) => (
                  <div key={part.label}>
                    <p className='font-medium'>{part.label}</p>
                    {part.added.map((text) => (
                      <p key={'added-' + text} className='mt-1'>
                        新增：{text}
                      </p>
                    ))}
                    {part.removed.map((text) => (
                      <p
                        key={'removed-' + text}
                        className='mt-1 text-muted-foreground'
                      >
                        不再列出：{text}
                      </p>
                    ))}
                  </div>
                ))}
                {parent.summary === p.summary && differences.length === 0 && (
                  <p>方案说明、依据、风险和前置条件未出现变化。</p>
                )}
                <p className='text-muted-foreground'>
                  此处仅说明方案文本的变化；未列出某项风险或条件，不等于已消除或已满足。
                </p>
              </div>
            ) : (
              <p className='mt-3 text-sm leading-6 text-muted-foreground'>
                本条回答未保存原版本内容，暂不能比较调整差异。
              </p>
            )}
          </details>
        )}
        <div className='mt-3'>
          <Sources
            sources={sources.filter((s) => p.sourceIds.includes(s.id))}
            open={openSource}
          />
        </div>
        {canChoose &&
          !analysis.executionApproved &&
          state.matter.status !== 'closed' &&
          ['lead', 'procurement'].includes(role) && (
            <Button
              className='mt-4'
              size='sm'
              disabled={
                busy ||
                props.actionBusy ||
                restoring ||
                selected?.planVersionId === p.id
              }
              onClick={() =>
                propose(
                  {
                    type: 'select_plan',
                    supplierId: p.supplierId,
                    planVersionId: p.id,
                    ...(reason.trim() ? { evidence: reason.trim() } : {}),
                  },
                  state.revision
                )
              }
            >
              选择 {p.supplierId} 此版本
            </Button>
          )}
      </article>
    )
  }
  const briefingCard = (run: Run) => {
    const facts = run.facts
    const presented = facts?.presentation
    if (!facts || !presented) return null
    const effective = facts.state.decisions.find(
      (decision) => decision.status === 'effective'
    )
    const affected = presented.options.find(
      (option) => option.supplierId === presented.effectiveSupplierId
    )
    const sources = Array.from(
      new Map(
        [...run.sources, ...facts.state.documents].map((source) => [
          source.id,
          source,
        ])
      ).values()
    )
    return (
      <Section
        title='影响与待决事项'
        aside={<Badge variant='outline'>数据 v{run.revision}</Badge>}
      >
        <p className='text-base leading-7 font-medium'>
          {presented.conclusion}
        </p>
        <dl className='mt-4 grid gap-3 sm:grid-cols-3'>
          <div className='rounded-lg bg-muted/50 p-3'>
            <dt className='text-sm text-muted-foreground'>本次到料变更</dt>
            <dd className='mt-1 text-base font-semibold'>
              D{presented.originalDay} → D{presented.noticeArrivalDay}
            </dd>
            <p className='mt-1 text-sm'>
              {presented.noticeArrivalDay > presented.originalDay
                ? `较原计划晚 ${presented.delayDays} 天`
                : presented.noticeArrivalDay === presented.originalDay
                  ? '与原计划相同'
                  : `较原计划提前 ${presented.originalDay - presented.noticeArrivalDay} 天`}
            </p>
          </div>
          <div className='rounded-lg bg-muted/50 p-3'>
            <dt className='text-sm text-muted-foreground'>当前方案到料风险</dt>
            <dd className='mt-1 text-base font-semibold'>
              {facts.analysis.riskCount} 条订单
            </dd>
            <p className='mt-1 text-sm break-words'>
              {affected?.riskOrderIds.join('、') ||
                (facts.analysis.riskCount
                  ? '展开订单核对'
                  : '当前预计到料满足要求')}
            </p>
          </div>
          <div className='rounded-lg bg-muted/50 p-3'>
            <dt className='text-sm text-muted-foreground'>当前有效决定</dt>
            <dd className='mt-1 text-base font-semibold'>
              {effective?.id || '未记录'}
            </dd>
            <p className='mt-1 text-sm'>
              {presented.effectiveSupplierId} 方案生效
            </p>
          </div>
        </dl>
        <div className='mt-4 space-y-3 text-sm leading-6'>
          {presented.blockers.length > 0 && (
            <div>
              <p className='font-medium'>继续办理的条件</p>
              <ul className='mt-1 space-y-1 text-muted-foreground'>
                {presented.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          <div className='rounded-lg border p-3'>
            <p className='font-medium'>本岗位下一步</p>
            <p className='mt-1'>
              {presented.actions[0]?.label ||
                (presented.waitingRoles.length
                  ? `等待${presented.waitingRoles.map((waitingRole) => roleNames[waitingRole]).join('、')}处理`
                  : facts.state.matter.status === 'closed'
                    ? '事项已办结，可回顾处理记录。'
                    : '当前没有待办动作，可查看事项详情。')}
            </p>
          </div>
          <p className='text-muted-foreground'>
            到料风险不等于订单已违约；事项办结不代表实物到货、生产完成或订单交付。
          </p>
        </div>
        <div className='mt-4 space-y-3'>
          <details className='rounded-lg border p-3'>
            <summary className='cursor-pointer text-sm font-medium'>
              展开受影响订单
            </summary>
            <div className='mt-3 min-w-0 overflow-x-auto'>
              <Orders
                snapshot={
                  {
                    ...snapshot,
                    ...facts,
                    presentation: facts.presentation,
                  } as Snapshot
                }
              />
            </div>
          </details>
          <details className='rounded-lg border p-3'>
            <summary className='cursor-pointer text-sm font-medium'>
              核对有效决定与历史依据
            </summary>
            <div className='mt-3'>{decisionCards(facts, sources)}</div>
          </details>
          <details className='rounded-lg border p-3'>
            <summary className='cursor-pointer text-sm font-medium'>
              展开 A/B 预期对比
            </summary>
            <div className='mt-3'>{comparison(facts, run.revision)}</div>
          </details>
        </div>
        <details className='mt-4'>
          <summary className='cursor-pointer text-sm text-muted-foreground'>
            查看本次简报来源
          </summary>
          <div className='mt-3'>
            <Sources
              sources={sources.filter((source) =>
                presented.sourceIds.includes(source.id)
              )}
              open={openSource}
            />
          </div>
        </details>
      </Section>
    )
  }
  const historyContent = (
    <>
      <div className='office-history-title mb-4 flex items-center justify-between gap-2'>
        <h2 className='font-semibold'>历史会话</h2>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || restoring}
          onClick={() => void newChat().then(historyLayout.closeOverlay)}
        >
          <Plus className='size-4' />
          新建
        </Button>
      </div>
      <p className='mb-3 text-xs text-muted-foreground'>
        {roleNames[role]} · {state.matter.id}
      </p>
      {!conversations.length && (
        <p className='text-sm text-muted-foreground'>
          暂无会话，从一个问题开始。
        </p>
      )}
      {conversations.map((c) => (
        <button
          key={c.id}
          disabled={busy || restoring}
          onClick={() =>
            void load(c.id)
              .then(historyLayout.closeOverlay)
              .catch((e) => setError(errorText(e)))
          }
          className={
            'mb-2 block w-full rounded-lg border p-3 text-left text-sm ' +
            (c.id === conversationId
              ? 'border-primary bg-card'
              : 'hover:bg-card')
          }
        >
          <span className='line-clamp-2 leading-6'>{c.title}</span>
          <span className='mt-2 block text-xs text-muted-foreground'>
            {c.messageIds.length} 次问答 ·{' '}
            {new Date(c.updatedAt).toLocaleDateString('zh-CN')}
          </span>
        </button>
      ))}
    </>
  )
  return (
    <div
      ref={historyContainerRef}
      className='office-chat'
      data-history-open={!historyLayout.overlay && historyLayout.open}
      data-resizing={historyLayout.resizing}
      style={{ '--history-width': historyLayout.width + 'px' } as CSSProperties}
    >
      {!historyLayout.overlay && historyLayout.open && (
        <>
          <aside
            id='office-history'
            className='office-chat-history'
            aria-label='历史会话'
          >
            {historyContent}
          </aside>
          <div
            className='office-history-resize'
            role='separator'
            tabIndex={0}
            aria-label='调整历史会话宽度'
            aria-orientation='vertical'
            aria-controls='office-history'
            aria-valuemin={200}
            aria-valuemax={historyLayout.maxWidth}
            aria-valuenow={historyLayout.width}
            title='拖动调整宽度；双击恢复默认宽度'
            {...historyLayout.resizeProps}
          />
        </>
      )}
      <div className='office-chat-main'>
        <div className='office-chat-heading'>
          <Button
            ref={historyToggleRef}
            variant='ghost'
            size='icon'
            className='shrink-0'
            onClick={historyLayout.toggle}
            aria-label={historyLayout.open ? '收起历史会话' : '展开历史会话'}
            title={historyLayout.open ? '收起历史会话' : '展开历史会话'}
            aria-expanded={historyLayout.open}
            aria-controls='office-history'
          >
            {historyLayout.open ? (
              <PanelLeftClose className='size-5' />
            ) : (
              <PanelLeftOpen className='size-5' />
            )}
          </Button>
          <div className='min-w-0 flex-1'>
            <h2
              className='line-clamp-2 font-semibold'
              title={state.matter.title}
            >
              {state.matter.title}
            </h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              {state.matter.id} · {roleNames[role]}
            </p>
          </div>
          <Button size='sm' variant='outline' onClick={props.viewMatter}>
            查看事项详情
          </Button>
        </div>
        <div
          className='office-chat-messages'
          ref={scroll}
          onScroll={() => {
            if (conversationId && scroll.current)
              sessionStorage.setItem(
                'office-scroll-' + conversationId,
                String(scroll.current.scrollTop)
              )
          }}
        >
          {!messages.length && (
            <div className='py-6'>
              <h3 className='text-xl font-semibold'>从一个问题开始办理</h3>
              <p className='mt-3 text-sm leading-7 text-muted-foreground'>
                {state.scenario
                  ? state.scenario.trigger
                  : `供应商 A 当前预计 D${state.suppliers[0].arrivalDay} 到料，可先查询关联订单影响或核对会议依据。`}
              </p>
            </div>
          )}
          <div className='mb-5 flex flex-wrap gap-2'>
            {activePrompts.map((prompt) => (
              <Button
                key={prompt.label}
                size='sm'
                variant={'queryType' in prompt ? 'secondary' : 'outline'}
                className='h-auto min-h-9 max-w-full text-sm whitespace-normal'
                disabled={busy || restoring}
                onClick={() =>
                  void submit(
                    prompt.question,
                    '',
                    undefined,
                    'queryType' in prompt ? prompt.queryType : undefined
                  )
                }
              >
                {prompt.label}
              </Button>
            ))}
          </div>
          {state.scenario && (
            <EventContext
              snapshot={snapshot}
              sources={props.sources}
              openSource={openSource}
            />
          )}
          {messages.map((run) => (
            <div key={run.id} className='mb-6 space-y-4'>
              <div className='ml-auto max-w-[90%] rounded-xl bg-primary/10 px-4 py-3 text-sm leading-6 break-words'>
                {run.question}
              </div>
              <div className='rounded-xl border p-4'>
                <div className='mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                  <span>业务助手</span>
                  <span>回答时数据 v{run.revision}</span>
                  {historical(run) && (
                    <span>历史回答 · 当前已为 v{state.revision}</span>
                  )}
                </div>
                {run.status === 'completed' &&
                (run.intent === 'briefing' || run.queryType === 'briefing') &&
                run.facts?.presentation ? (
                  <>
                    <RunContent
                      run={run}
                      openSource={openSource}
                      showReferences={false}
                      compactAnswer
                    />
                    <div className='mt-4'>{briefingCard(run)}</div>
                  </>
                ) : (
                  <RunContent
                    run={run}
                    openSource={openSource}
                    propose={
                      !historical(run)
                        ? (action) => propose(action, run.revision)
                        : undefined
                    }
                  />
                )}
                {run.status === 'completed' &&
                  run.intent === 'impact' &&
                  !run.supplyQuery &&
                  run.facts && (
                    <div className='mt-4'>
                      <Orders
                        snapshot={
                          {
                            ...snapshot,
                            ...run.facts,
                            presentation: run.facts.presentation,
                          } as Snapshot
                        }
                      />
                    </div>
                  )}
                {run.status === 'completed' &&
                  run.intent === 'decisions' &&
                  run.facts && (
                    <div className='mt-4'>
                      {decisionCards(run.facts, run.sources)}
                    </div>
                  )}
                {run.status === 'completed' &&
                  run.intent === 'plans' &&
                  run.facts && (
                    <div className='mt-4'>
                      {comparison(run.facts, run.revision)}
                    </div>
                  )}
                {run.status === 'completed' &&
                  run.intent === 'progress' &&
                  run.facts?.presentation && (
                    <div className='mt-4 rounded-lg border p-4 text-sm leading-6'>
                      <p className='font-medium'>
                        {run.facts.presentation.conclusion}
                      </p>
                      {run.facts.presentation.blockers.length > 0 && (
                        <ul className='mt-3 space-y-1 text-muted-foreground'>
                          {run.facts.presentation.blockers.map((blocker) => (
                            <li key={blocker}>{blocker}</li>
                          ))}
                        </ul>
                      )}
                      {run.facts.presentation.waitingRoles.length > 0 && (
                        <p className='mt-3'>
                          待处理岗位：
                          {run.facts.presentation.waitingRoles
                            .map((waitingRole) => roleNames[waitingRole])
                            .join('、')}
                        </p>
                      )}
                    </div>
                  )}
                {run.status === 'completed' &&
                  run.planVersions?.length &&
                  run.facts && (
                    <details className='mt-4'>
                      <summary className='cursor-pointer text-sm'>
                        查看本次方案草稿 · {run.planVersions.length} 个版本
                      </summary>
                      <div className='mt-3 grid min-w-0 gap-3 lg:grid-cols-2'>
                        {run.planVersions.map((p) =>
                          planCard(p, false, run.facts!, run.sources)
                        )}
                      </div>
                    </details>
                  )}
                {run.status === 'failed' && (
                  <Button
                    size='sm'
                    variant='outline'
                    className='mt-3'
                    disabled={busy || restoring}
                    onClick={() =>
                      void submit(
                        run.question,
                        run.feedback || '',
                        run.parentVersionId,
                        run.queryType
                      )
                    }
                  >
                    <RotateCcw className='size-4' />
                    重试原问题
                  </Button>
                )}
              </div>
            </div>
          ))}
          {pending && (
            <div className='mb-5 rounded-lg border p-4 text-sm'>
              <p className='mb-3'>{pending.question}</p>
              <span className='inline-flex items-center gap-2 text-muted-foreground'>
                <Loader2 className='size-4 animate-spin' />
                正在查阅资料并组织回答…
              </span>
            </div>
          )}
          <ErrorNotice message={error} />
          {!busy && (
            <div className='my-5 flex flex-wrap gap-3'>
              <Button
                variant='outline'
                disabled={restoring}
                onClick={props.viewMatter}
              >
                比较并选择方案
              </Button>
              <Button
                variant='outline'
                disabled={restoring}
                onClick={props.viewMatter}
              >
                查看办理进度
              </Button>
            </div>
          )}
          {showPlans && !busy && !state.scenario && (
            <Section
              title={
                !analysis.executionApproved &&
                state.matter.status !== 'closed' &&
                ['lead', 'procurement'].includes(role)
                  ? '选择处理方案'
                  : '方案预期对比'
              }
            >
              <p className='mb-4 text-sm text-muted-foreground'>
                方案意向、质量核验和负责人批准分别记录；当前选择不会自动发送任务。
              </p>
              {comparison(snapshot, state.revision)}
              <div className='mt-4 grid min-w-0 gap-4 lg:grid-cols-2'>
                {drafts.map((p) =>
                  planCard(
                    p,
                    true,
                    snapshot,
                    lastDraft?.sources || props.sources,
                    lastDraft?.facts?.state.planVersions || state.planVersions
                  )
                )}
              </div>
              {!analysis.executionApproved &&
                state.matter.status !== 'closed' &&
                ['lead', 'procurement'].includes(role) && (
                  <>
                    <Textarea
                      className='mt-4'
                      aria-label='补充选择理由（可选）'
                      value={reason}
                      maxLength={4000}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder='补充选择理由（可选），系统会带出已有依据'
                    />
                    <Button
                      variant='outline'
                      className='mt-4'
                      disabled={busy || restoring || props.actionBusy}
                      onClick={() => setFeedbackOpen(true)}
                    >
                      都不满意 / 调整方案
                    </Button>
                  </>
                )}
            </Section>
          )}
          {showPlans && !busy && state.scenario && (
            <EventPlans
              snapshot={snapshot}
              propose={propose}
              busy={props.actionBusy || restoring}
              role={role}
            />
          )}
          {
            <div
              id='current-work'
              className='mt-5 space-y-4'
              role='region'
              aria-label='当前办理'
            >
              <SemanticBasis snapshot={snapshot} sources={props.sources} openSource={props.openSource} />
              <Section
                title='当前办理'
                aside={<Badge variant='outline'>{roleNames[role]}</Badge>}
              >
                <p className='text-base leading-7 font-medium'>
                  {snapshot.presentation?.conclusion || analysis.nextStep}
                </p>
                {snapshot.presentation?.blockers[0] && (
                  <p className='mt-3 text-sm leading-6 text-muted-foreground'>
                    {snapshot.presentation.blockers[0]}
                  </p>
                )}
                <p className='mt-3 text-sm'>
                  {snapshot.presentation.waitingRoles.includes(role)
                    ? '请进入事项详情核对并完成当前岗位操作。'
                    : '你当前无需操作，可查看办理进度。'}
                </p>
                <Button
                  className='mt-4'
                  variant='outline'
                  size='sm'
                  onClick={props.viewMatter}
                >
                  打开事项办理中心
                </Button>
              </Section>
              <ExecutionCards
                snapshot={snapshot}
                sources={props.sources}
                openSource={openSource}
              />
            </div>
          }
        </div>
        <form
          className='office-chat-composer'
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className='sr-only' htmlFor='office-question'>
            业务问题
          </label>
          <Textarea
            id='office-question'
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy || restoring}
            maxLength={4000}
            placeholder='输入问题，或继续追问…'
            className='office-chat-input resize-none'
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className='mt-2 flex items-center justify-between gap-3'>
            <span className='text-xs text-muted-foreground'>
              {props.config?.mode === 'rules' ? '规则演示' : '模型辅助'} ·
              合成数据 · 操作需人工确认
            </span>
            {busy ? (
              <Button
                type='button'
                variant='outline'
                onClick={() => void stop()}
              >
                <Square className='size-4' />
                停止
              </Button>
            ) : (
              <Button type='submit' disabled={!question.trim() || restoring}>
                <ArrowUp className='size-4' />
                {restoring ? '恢复会话…' : '发送问题'}
              </Button>
            )}
          </div>
        </form>
      </div>
      <Sheet
        open={historyLayout.overlay && historyLayout.overlayOpen}
        onOpenChange={historyLayout.setOverlayOpen}
      >
        <SheetContent
          side='left'
          id='office-history'
          className='office-history-drawer'
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            historyToggleRef.current?.focus()
          }}
        >
          <SheetHeader className='sr-only'>
            <SheetTitle>历史会话</SheetTitle>
            <SheetDescription>选择或新建当前事项的对话。</SheetDescription>
          </SheetHeader>
          <div className='office-chat-history'>{historyContent}</div>
        </SheetContent>
      </Sheet>
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调整方案</DialogTitle>
            <DialogDescription>
              填写约束或不满意的原因。新草稿保留原方案依据，仍需重新选择、核验及批准。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label='方案修改反馈'
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={2000}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setFeedbackOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                !feedback.trim() || busy || restoring || props.actionBusy
              }
              onClick={() => {
                setFeedbackOpen(false)
                void submit('请根据反馈调整 A/B 方案：' + feedback, feedback)
                setFeedback('')
              }}
            >
              根据反馈重新分析
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

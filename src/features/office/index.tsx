import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Home as HomeIcon,
  ListTodo,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ActionSheet } from './action-sheet'
import { officeApi, errorText, getOfficeSnapshot, OfficeError } from './api'
import { Assistant } from './assistant'
import { Matter } from './business'
import { MatterWork } from './matter-work'
import { matterHandling } from './handling'
import './office.css'
import { Home, MatterList } from './overview'
import { Knowledge } from './knowledge'
import { ErrorNotice } from './shared'
import {
  roleNames,
  type Action,
  type History,
  type ModelConfig,
  type Page,
  type Preview,
  type Role,
  type Snapshot,
  type Source,
  type Task,
  type AssistantSession,
  type ReceiptRecord,
} from './types'

const pages = [
  {
    id: 'home',
    label: '办公协同',
    icon: HomeIcon,
    description: '跟进业务异常、处理决定与部门任务。',
  },
  {
    id: 'assistant',
    label: '业务助手',
    icon: MessageSquare,
    description: '查依据、看条件、准备操作，由你确认执行。',
  },
  {
    id: 'matter',
    label: '事项详情',
    icon: ListTodo,
    description: '业务事项 · 来源、方案与处理记录。',
  },
  { id: 'knowledge', label: '业务依据', icon: Network, description: '核对订单影响、会议决定、办理条件与原始资料。' },
] as const
function readPage(): Page {
  const value = window.location.hash.slice(1).split('?')[0]
  if (value === 'matter-detail') {
    const id = new URLSearchParams(window.location.hash.split('?')[1]).get('id')
    return !id || /^SUP-\d{3}$/.test(id) ? 'matter-detail' : 'matter'
  }
  return pages.some((page) => page.id === value) ? (value as Page) : 'home'
}

export function OfficeApp() {
  const [page, setPage] = useState<Page>(readPage)
  const [matterId, setMatterId] = useState(
    () =>
      new URLSearchParams(location.hash.split('?')[1] || '').get('id') ||
      sessionStorage.getItem('office-current-matter') ||
      'SUP-001'
  )
  const [role, setRole] = useState<Role>(() => {
    const saved = sessionStorage.getItem('office-role')
    return saved && saved in roleNames ? (saved as Role) : 'lead'
  })
  const roleRef = useRef(role)
  const matterRef = useRef(matterId)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [retiredMatter, setRetiredMatter] = useState(false)
  const [dataFresh, setDataFresh] = useState(false)
  const [confirmUncertain, setConfirmUncertain] = useState(false)
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [history, setHistory] = useState<History>({ runs: [], comparisons: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accessRequired, setAccessRequired] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [notice, setNotice] = useState('')
  const [assistantSessions, setAssistantSessions] = useState<
    Record<string, AssistantSession>
  >(() => {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem('office-assistant-sessions') || '{}'
      ) as Record<string, AssistantSession>
      return Object.fromEntries(
        Object.entries(stored)
          .filter(([, value]) => value && typeof value.question === 'string')
          .map(([key, value]) => [
            key,
            value.busy
              ? {
                  ...value,
                  busy: false,
                  error: '上次查询被页面刷新中断，请重试原问题。',
                  failedQuestion: value.failedQuestion || value.question,
                  snapshotReady: false,
                }
              : { ...value, historical: !!value.run, snapshotReady: false },
          ])
      )
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(
        'office-assistant-sessions',
        JSON.stringify(assistantSessions)
      )
    } catch {
      /* Storage may be unavailable; in-page sessions still work. */
    }
  }, [assistantSessions])
  const [source, setSource] = useState<Source | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [receiptTask, setReceiptTask] = useState<Task | null>(null)
  const [evidence, setEvidence] = useState('')
  const [qualityResult, setQualityResult] = useState('approved')
  const [receiptRecord, setReceiptRecord] = useState<ReceiptRecord>({})
  const [receiptSources, setReceiptSources] = useState<string[]>([])
  const confirmKey = useRef('')
  const operationLock = useRef(false)
  const receiptVersion = useRef<number | undefined>(undefined)
  const [receiptContext, setReceiptContext] = useState('')
  const [previewReceiptContext, setPreviewReceiptContext] = useState('')
  const receiptDrafts = useRef(
    new Map<
      string,
      {
        task: Task
        evidence: string
        result: string
        record: ReceiptRecord
        sourceIds: string[]
      }
    >()
  )
  const sessionKey = `${snapshot?.workspaceId}:${snapshot?.state.matter.id}:${role}:${config?.mode}`
  const priorRun =
    history.runs.find(
      (item) =>
        item.role === role &&
        item.mode === config?.mode &&
        item.variant === 'ontology'
    ) ?? null
  const assistantSession = assistantSessions[sessionKey] ?? {
    question: priorRun?.question ?? '',
    planReason: '',
    run: priorRun,
    historical: !!priorRun,
    busy: false,
    error: '',
    failedQuestion: '',
    snapshotReady: false,
  }
  function updateAssistantSession(patch: Partial<AssistantSession>) {
    setAssistantSessions((previous) => ({
      ...previous,
      [sessionKey]: { ...(previous[sessionKey] ?? assistantSession), ...patch },
    }))
  }

  useEffect(() => {
    // The key belongs to this render's form fields, so an older effect cannot
    // save the previous form under the context of a newly opened dialog.
    if (receiptTask && receiptContext)
      receiptDrafts.current.set(receiptContext, {
        task: receiptTask,
        evidence,
        result: qualityResult,
        record: receiptRecord,
        sourceIds: receiptSources,
      })
  }, [
    receiptTask,
    receiptContext,
    evidence,
    qualityResult,
    receiptRecord,
    receiptSources,
  ])

  const refresh = useCallback(async () => {
    let next: Snapshot
    try {
      next = await getOfficeSnapshot(role)
    } catch (failure) {
      if (roleRef.current !== role || matterRef.current !== matterId) throw failure
      setDataFresh(false)
      if (failure instanceof OfficeError && failure.code === 'MATTER_RETIRED') {
        setRetiredMatter(true)
        setSnapshot(null)
      }
      if (
        failure instanceof OfficeError &&
        failure.code === 'ACCESS_REQUIRED'
      ) {
        setAccessRequired(true)
        setSnapshot(null)
      }
      throw failure
    }
    const [documents, model, runs] = await Promise.all([
      officeApi<{ documents: Source[] }>('/documents', role),
      officeApi<ModelConfig>('/model', role),
      officeApi<History>('/runs', role),
    ]).catch((failure: unknown) => {
      if (roleRef.current === role && matterRef.current === matterId) setDataFresh(false)
      throw failure
    })
    if (
      roleRef.current !== role ||
      next.state.matter.id !== matterId ||
      next.state.matter.id !== matterRef.current
    )
      return
    setSnapshot(next)
    setDataFresh(true)
    setRetiredMatter(false)
    setSources(documents.documents)
    setConfig(model)
    setHistory(runs)
    setAccessRequired(false)
  }, [role, matterId])
  useEffect(() => {
    let active = true
    // refresh only updates state after awaiting the network response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
      .catch((failure) => {
        if (active) setError(errorText(failure))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [role, refresh])
  useEffect(() => {
    const changed = () => {
      setPage(readPage())
      const id =
        new URLSearchParams(location.hash.split('?')[1] || '').get('id') ||
        sessionStorage.getItem('office-current-matter') ||
        'SUP-001'
      sessionStorage.setItem('office-current-matter', id)
      if (id !== matterRef.current) {
        setLoading(true)
        setNotice('')
        setError('')
        setConfirmError('')
      }
      matterRef.current = id
      setMatterId(id)
      setPreview(null)
      setReceiptTask(null)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  function navigate(next: Page, id = matterId) {
    if (id !== matterId) {
      setLoading(true)
      setNotice('')
      setError('')
      setConfirmError('')
    }
    sessionStorage.setItem('office-current-matter', id)
    window.location.hash = next + '?id=' + encodeURIComponent(id)
    setPage(next)
    matterRef.current = id
    setMatterId(id)
  }
  function ask(value: string, id = matterId) {
    if (value) sessionStorage.setItem('office-prefill-' + id, value)
    navigate('assistant', id)
  }
  function switchRole(value: Role) {
    roleRef.current = value
    setLoading(true)
    setError('')
    setPreview(null)
    setReceiptTask(null)
    setPreviewReceiptContext('')
    setNotice('')
    sessionStorage.setItem('office-role', value)
    setRole(value)
  }
  function openSource(value: Source) {
    const current = sources.find((doc) => doc.id === value.id)
    setSource(value.text ? value : current || value)
  }
  async function reload() {
    setLoading(true)
    setError('')
    try {
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setLoading(false)
    }
  }
  async function enterDemo() {
    if (loading || !accessCode.trim()) return
    setLoading(true)
    setError('')
    try {
      await officeApi<Snapshot>('/session', role, { accessCode })
      setAccessCode('')
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setLoading(false)
    }
  }
  async function propose(
    action: Action,
    expectedVersion?: number,
    receiptKey = ''
  ) {
    if (operationLock.current || !dataFresh) return
    operationLock.current = true
    setActionBusy(true)
    setError('')
    setConfirmError('')
    setConfirmUncertain(false)
    setNotice('')
    try {
      const response = await officeApi<{ preview: Preview }>('/preview', role, {
        action,
        expectedVersion,
      })
      confirmKey.current = crypto.randomUUID()
      if (roleRef.current !== role || matterRef.current !== matterId) return
      if (action.type === 'start_task' && response.preview.allowed) {
        const next = await officeApi<Snapshot>('/confirm', role, {
          previewId: response.preview.id,
          expectedVersion: response.preview.revision,
          idempotencyKey: confirmKey.current,
        })
        if (roleRef.current !== role || matterRef.current !== matterId) return
        setSnapshot(next)
        setNotice('已开始处理。')
        try { await refresh() } catch (failure) { setError(`操作已保存，但暂时无法刷新最新进度：${errorText(failure)}`) }
      } else {
        setPreviewReceiptContext(receiptKey)
        setPreview(response.preview)
      }
    } catch (failure) {
      setError(errorText(failure))
      if (failure instanceof OfficeError && failure.code === 'STALE_VERSION') {
        try {
          await refresh()
        } catch {
          /* Preserve the original conflict. */
        }
      }
      const draft = receiptDrafts.current.get(receiptKey)
      if (
        ['submit_quality', 'submit_receipt'].includes(action.type) &&
        draft &&
        roleRef.current === role &&
        matterRef.current === matterId
      ) {
        setReceiptContext(receiptKey)
        setReceiptTask(draft.task)
        setEvidence(draft.evidence)
        setQualityResult(draft.result)
        setReceiptRecord(draft.record)
        setReceiptSources(draft.sourceIds)
      }
    } finally {
      operationLock.current = false
      setActionBusy(false)
    }
  }
  async function confirm() {
    if (!preview?.allowed || operationLock.current) return
    operationLock.current = true
    setActionBusy(true)
    setConfirmError('')
    try {
      const next = await officeApi<Snapshot>('/confirm', role, {
        previewId: preview.id,
        expectedVersion: preview.revision,
        idempotencyKey: confirmKey.current,
      })
      if (previewReceiptContext && ['submit_quality', 'submit_receipt'].includes(preview.action.type)) {
        receiptDrafts.current.delete(previewReceiptContext)
      }
      if (roleRef.current !== role || matterRef.current !== matterId) return
      setSnapshot(next)
      setPreview(null)
      setConfirmUncertain(false)
      setReceiptTask(null)
      setPreviewReceiptContext('')
      const handling = matterHandling(next, role)
      setNotice(['request_quality', 'request_event_review'].includes(preview.action.type) && handling.waitingForReview
        ? `核验申请已提交。${handling.current}，你当前无需操作。`
        : `已保存。${next.analysis.nextStep}`)
      try { await refresh() } catch (failure) { setError(`操作已保存，但暂时无法刷新最新进度：${errorText(failure)}`) }
    } catch (failure) {
      const uncertain = !(failure instanceof OfficeError) || failure.status >= 500
      setConfirmUncertain(uncertain)
      setConfirmError(uncertain ? '暂时无法确认提交结果。请核对提交结果，系统会使用同一提交编号，不会重复办理。' : errorText(failure))
      try {
        await refresh()
      } catch {
        /* Keep the original confirmation error visible. */
      }
    } finally {
      operationLock.current = false
      setActionBusy(false)
    }
  }
  const giveReceipt = useCallback(
    (task: Task) => {
      receiptVersion.current = snapshot?.state.revision
      setReceiptTask(task)
      const key = [
        snapshot?.workspaceId,
        snapshot?.state.matter.id,
        role,
        task.id,
        task.planVersionId || '',
      ].join(':')
      setReceiptContext(key)
      const draft = receiptDrafts.current.get(key)
      setEvidence(draft?.evidence || '')
      setQualityResult(draft?.result || 'approved')
      setReceiptRecord(draft?.record || {})
      setReceiptSources(draft?.sourceIds || [])
    },
    [
      snapshot?.state.revision,
      snapshot?.workspaceId,
      snapshot?.state.matter,
      role,
    ]
  )
  const receiptEvidence =
    snapshot?.state.scenario || receiptTask?.id === 'T-QA'
      ? evidence.trim()
      : [
          receiptRecord.arrangement
            ? '采购跟进安排：' + receiptRecord.arrangement
            : '',
          receiptRecord.pending ? '仍待确认：' + receiptRecord.pending : '',
          receiptRecord.orderIds?.length
            ? '涉及订单：' + receiptRecord.orderIds.join('、')
            : '',
          receiptRecord.communication
            ? '同步内容：' + receiptRecord.communication
            : '',
          receiptRecord.result ? '同步结果：' + receiptRecord.result : '',
          evidence.trim() ? '补充说明：' + evidence.trim() : '',
        ]
          .filter(Boolean)
          .join('；')
  const receiptReady =
    snapshot?.state.scenario || receiptTask?.id === 'T-QA'
      ? !!evidence.trim()
      : receiptTask?.id === 'T-PUR'
        ? !!receiptRecord.arrangement?.trim() && !!receiptRecord.pending?.trim()
        : !!receiptRecord.orderIds?.length &&
          !!receiptRecord.communication?.trim() &&
          !!receiptRecord.result?.trim()
  function receiptPreview() {
    if (!receiptTask || !receiptReady) return
    const action: Action =
      receiptTask.id === 'T-QA'
        ? {
            type: 'submit_quality',
            taskId: receiptTask.id,
            result: qualityResult,
            evidence: receiptEvidence,
            sourceIds: receiptSources,
          }
        : {
            type: 'submit_receipt',
            taskId: receiptTask.id,
            record: receiptRecord,
            evidence: receiptEvidence,
            sourceIds: receiptSources,
          }
    setReceiptTask(null)
    void propose(action, receiptVersion.current, receiptContext)
  }
  const currentPage = pages.find(
    (item) => item.id === (page === 'matter-detail' ? 'matter' : page)
  )!
  const businessProps = {
    role,
    busy: actionBusy || loading || !dataFresh,
    sources,
    propose: (action: Action) => void propose(action, snapshot?.state.revision),
    openSource,
    giveReceipt,
    ask,
    viewMatter: (id?: string, eventId?: string) => {
      navigate('matter-detail', id || matterId)
      if (eventId)
        window.location.hash += '&event=' + encodeURIComponent(eventId)
    },
  }

  if (accessRequired) {
    return (
      <main className='flex min-h-svh flex-1 items-center justify-center bg-background px-6 py-12'>
        <div className='w-full max-w-sm space-y-8'>
          <div className='space-y-6'>
            <div className='flex items-center gap-3'>
              <img
                src={`${import.meta.env.BASE_URL}brand/logo-mark-aihuashen.svg`}
                alt='爱化身标识'
                width={36}
                height={36}
                className='size-9 dark:invert'
              />
              <img
                src={`${import.meta.env.BASE_URL}brand/logo-wordmark-aihuashen.svg`}
                alt='AiHuaShen'
                width={142}
                height={19}
                className='w-[142px] dark:invert'
              />
            </div>
            <div>
              <h1 className='text-2xl font-semibold tracking-tight'>
                龙盛办公协同
              </h1>
              <p className='mt-3 text-sm leading-6 text-muted-foreground'>
                输入访问码，进入办公协同。
              </p>
            </div>
          </div>
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault()
              void enterDemo()
            }}
          >
            <div className='space-y-2'>
              <Label htmlFor='office-access-code'>访问码</Label>
              <Input
                id='office-access-code'
                type='password'
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder='请输入访问码'
                autoComplete='off'
                autoFocus
                disabled={loading}
                required
              />
            </div>
            <ErrorNotice
              message={error.includes('ACCESS_REQUIRED') ? '' : error}
            />
            <Button
              className='w-full'
              type='submit'
              disabled={loading || !accessCode.trim()}
            >
              {loading && <Loader2 className='size-4 animate-spin' />}
              进入工作台
            </Button>
          </form>
          <p className='text-xs leading-5 text-muted-foreground'>
            本演示使用合成业务样例。
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className='office-app flex min-w-0 flex-1 flex-col'>
      <Header fixed>
        <div className='me-auto hidden text-sm text-muted-foreground sm:block'>
          龙盛办公协同
        </div>
        <div className='flex items-center gap-2'>
          <Label className='hidden text-xs text-muted-foreground lg:inline'>
            当前岗位
          </Label>
          <Select
            value={role}
            onValueChange={(value) => switchRole(value as Role)}
            disabled={actionBusy || loading}
          >
            <SelectTrigger aria-label='当前岗位' className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(roleNames).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ThemeSwitch />
      </Header>
      <Main fixed={page === 'assistant'} className='flex min-w-0 flex-1 flex-col gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div>
            <h1
              className={
                page === 'matter'
                  ? 'text-sm text-muted-foreground'
                  : 'text-2xl font-semibold tracking-tight'
              }
            >
              {currentPage.label}
            </h1>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void reload()}
            disabled={loading || actionBusy}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </Button>
        </div>
        <ErrorNotice message={error} />
        {snapshot && !dataFresh && !loading && <p role='alert' className='rounded-lg border p-3 text-sm'>暂时无法确认最新进度，已暂停办理。请点击“刷新数据”后继续；下方为上次读取的记录。</p>}
        {retiredMatter && <div className='space-y-3 rounded-xl border bg-card p-5'><p>演示已调整为每种业务类型一个代表事项。此旧入口不再参与办理，原记录保留。</p><Button onClick={() => { setError(''); setRetiredMatter(false); navigate('matter-detail', matterId === 'SUP-010' ? 'SUP-007' : 'SUP-001') }}>打开代表事项</Button></div>}
        {notice && (
          <div
            role='status'
            className='flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm'
          >
            <CheckCircle2 className='size-4 shrink-0' />
            <span>{notice}</span>
            <Button
              variant='ghost'
              size='sm'
              className='ms-auto'
              onClick={() => setNotice('')}
            >
              收起
            </Button>
          </div>
        )}
        {(!snapshot || snapshot.state.matter.id !== matterId) && loading && (
          <div className='flex items-center gap-3 p-8 text-sm text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' />
            正在加载…
          </div>
        )}
        {snapshot && snapshot.state.matter.id === matterId && (
          <div className={loading ? 'pointer-events-none opacity-60' : ''}>
            {page === 'home' && <Home snapshot={snapshot} {...businessProps} />}
            {page === 'knowledge' && <Knowledge key={matterId} snapshot={snapshot} sources={sources} openSource={openSource} refresh={refresh} />}
            {page === 'matter' && (
              <MatterList
                snapshot={snapshot}
                viewMatter={businessProps.viewMatter}
              />
            )}
            {page === 'matter-detail' && (
              <div className='space-y-4'>
                <Button variant='ghost' onClick={() => navigate('matter')}>
                  返回事项列表
                </Button>
                <MatterWork key={`${matterId}:${role}`} snapshot={snapshot} {...businessProps} switchRole={switchRole} />
                <details className='rounded-xl border p-5'><summary className='cursor-pointer font-medium'>查看完整事项、讨论与依据</summary><div className='mt-4'><Matter snapshot={snapshot} {...businessProps} /></div></details>
              </div>
            )}
            {page === 'assistant' && (
              <Assistant
                key={`${snapshot.workspaceId}:${snapshot.state.matter.id}:${role}:${config?.mode}`}
                role={role}
                snapshot={snapshot}
                config={config}
                history={history}
                session={assistantSession}
                updateSession={updateAssistantSession}
                refresh={refresh}
                openSource={openSource}
                sources={sources}
                propose={(action, expectedVersion) => {
                  navigate('matter-detail')
                  void propose(action, expectedVersion)
                }}
                giveReceipt={giveReceipt}
                viewMatter={() => navigate('matter-detail')}
                actionBusy={actionBusy || loading || !dataFresh}
              />
            )}
          </div>
        )}
      </Main>
      <Sheet
        open={!!source}
        onOpenChange={(open) => {
          if (!open) setSource(null)
        }}
      >
        <SheetContent className='z-[60] flex w-full flex-col sm:max-w-2xl'>
          <SheetHeader>
            <SheetTitle>{source?.title || '来源原文'}</SheetTitle>
            <SheetDescription>
              {source?.source || '合成样例来源'} · {source?.id}
            </SheetDescription>
          </SheetHeader>
          <div className='flex-1 overflow-auto px-4 pb-6'>
            <div className='text-sm leading-8 break-words whitespace-pre-wrap'>
              {source?.text ||
                '当前引用未附原文，也未在当前资料中找到对应内容。请刷新来源或核对引用标识。'}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ActionSheet
        preview={preview}
        snapshot={snapshot}
        busy={actionBusy}
        error={confirmError}
        uncertain={confirmUncertain}
        sources={sources}
        openSource={openSource}
        close={() => {
          setPreview(null)
          setPreviewReceiptContext('')
          setConfirmError('')
        }}
        confirm={() => void confirm()}
        recheck={() => {
          if (preview)
            void propose(preview.action, undefined, previewReceiptContext)
        }}
        viewMatter={() => navigate('matter-detail')}
      />
      <Sheet
        open={!!receiptTask}
        onOpenChange={(open) => {
          if (!open) setReceiptTask(null)
        }}
      >
        <SheetContent className='flex w-full flex-col overflow-y-auto sm:max-w-xl'>
          <SheetHeader>
            <SheetTitle>
              {receiptTask?.id === 'T-QA'
                ? (snapshot?.state.scenario ? '当前方案版本核验' : '当前方案版本质量核验')
                : '提交部门处理回执'}
            </SheetTitle>
            <SheetDescription>
              {snapshot?.state.matter.id} · {snapshot?.state.matter.materialId}{' '}
              ·{' '}
              {receiptTask?.id === 'T-QA'
                ? snapshot?.state.planVersions.find(
                    (p) => p.id === receiptTask.planVersionId
                  )?.title
                : receiptTask?.title}
            </SheetDescription>
          </SheetHeader>
          <div className='flex-1 space-y-4 px-4'>
            <ErrorNotice message={error} />
            {receiptTask?.id === 'T-QA' && (
              <div className='rounded-lg border bg-muted/30 p-4 text-sm leading-7'>
                <strong>本次核验对象</strong>
                <p>
                  {
                    snapshot?.state.planVersions.find(
                      (p) => p.id === receiptTask.planVersionId
                    )?.title
                  }
                </p>
                {snapshot?.presentation.options
                  .filter(
                    (o) =>
                      o.supplierId ===
                      snapshot.state.matter.planSelection?.supplierId
                  )
                  .map((o) => (
                    <div key={o.supplierId}>
                      <p>
                        预计 D{o.arrivalDay} 到料 · {o.riskCount} 条到料风险
                      </p>
                      <p>
                        涉及订单：
                        {snapshot.analysis.orders.map((o) => o.id).join('、')}
                      </p>
                      <p>
                        {snapshot.state.planVersions
                          .find((p) => p.id === receiptTask.planVersionId)
                          ?.constraints.join('；')}
                      </p>
                    </div>
                  ))}
                <p className='mt-2 text-muted-foreground'>
                  请核对所选版本、订单影响及已有条件，人工填写结论和依据。
                </p>
              </div>
            )}
            {receiptTask?.id === 'T-PUR' && (
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label htmlFor='receipt-arrangement'>
                    采购跟进安排（必填）
                  </Label>
                  <Textarea
                    id='receipt-arrangement'
                    value={receiptRecord.arrangement || ''}
                    onChange={(e) =>
                      setReceiptRecord({
                        ...receiptRecord,
                        arrangement: e.target.value,
                      })
                    }
                    placeholder='说明已经确认的安排、对象及处理结果'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='receipt-pending'>仍待确认事项（必填）</Label>
                  <Textarea
                    id='receipt-pending'
                    value={receiptRecord.pending || ''}
                    onChange={(e) =>
                      setReceiptRecord({
                        ...receiptRecord,
                        pending: e.target.value,
                      })
                    }
                    placeholder='说明还需跟进什么；无待确认项请明确填写'
                  />
                </div>
              </div>
            )}
            {receiptTask?.id === 'T-SALES' && (
              <div className='space-y-4'>
                <fieldset>
                  <legend className='mb-2 text-sm font-medium'>
                    涉及订单（必选）
                  </legend>
                  <div className='flex flex-wrap gap-3'>
                    {snapshot?.analysis.orders.map((o) => (
                      <label
                        key={o.id}
                        className='flex items-center gap-2 text-sm'
                      >
                        <input
                          type='checkbox'
                          checked={
                            receiptRecord.orderIds?.includes(o.id) || false
                          }
                          onChange={(e) =>
                            setReceiptRecord({
                              ...receiptRecord,
                              orderIds: e.target.checked
                                ? [...(receiptRecord.orderIds || []), o.id]
                                : (receiptRecord.orderIds || []).filter(
                                    (id) => id !== o.id
                                  ),
                            })
                          }
                        />
                        {o.id}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className='space-y-2'>
                  <Label htmlFor='receipt-communication'>
                    销售同步内容（必填）
                  </Label>
                  <Textarea
                    id='receipt-communication'
                    value={receiptRecord.communication || ''}
                    onChange={(e) =>
                      setReceiptRecord({
                        ...receiptRecord,
                        communication: e.target.value,
                      })
                    }
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='receipt-result'>同步结果（必填）</Label>
                  <Textarea
                    id='receipt-result'
                    value={receiptRecord.result || ''}
                    onChange={(e) =>
                      setReceiptRecord({
                        ...receiptRecord,
                        result: e.target.value,
                      })
                    }
                    placeholder='说明同步结果及需要继续跟进的事项'
                  />
                </div>
              </div>
            )}
            {receiptTask?.id === 'T-QA' && (
              <div className='space-y-2'>
                <Label>核验结果</Label>
                <Select value={qualityResult} onValueChange={setQualityResult}>
                  <SelectTrigger aria-label='核验结果'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='approved'>通过</SelectItem>
                    <SelectItem value='rejected'>不通过</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className='space-y-2'>
              <Label htmlFor='office-evidence'>
                {receiptTask?.id === 'T-QA'
                  ? '核验凭据与处理说明'
                  : snapshot?.state.scenario ? '处理说明与凭据（必填）' : '补充说明与凭据（可选）'}
              </Label>
              <Textarea
                id='office-evidence'
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                placeholder={
                  receiptTask?.id === 'T-QA'
                    ? '填写核验结论的依据与记录编号'
                    : '可补充记录编号或其他说明'
                }
                className='min-h-32'
              />
            </div>
            <fieldset className='rounded-lg border p-4'>
              <legend className='px-1 text-sm font-medium'>
                关联当前事项来源（可选）
              </legend>
              <div className='space-y-3'>
                {sources
                  .filter((s) => !s.id.includes('PLAN-VERSIONS'))
                  .map((s) => (
                    <label
                      key={s.id}
                      className='flex items-start gap-2 text-sm leading-6'
                    >
                      <input
                        className='mt-1'
                        type='checkbox'
                        checked={receiptSources.includes(s.id)}
                        onChange={(e) =>
                          setReceiptSources(
                            e.target.checked
                              ? [...receiptSources, s.id]
                              : receiptSources.filter((id) => id !== s.id)
                          )
                        }
                      />
                      <span>{s.title}</span>
                    </label>
                  ))}
              </div>
            </fieldset>
          </div>
          <SheetFooter>
            <Button variant='outline' onClick={() => setReceiptTask(null)}>
              取消
            </Button>
            <Button
              disabled={!receiptReady || actionBusy}
              onClick={receiptPreview}
            >
              检查提交内容
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

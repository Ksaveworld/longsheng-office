import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Home as HomeIcon,
  ListTodo,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings2,
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
import { Home, Matter } from './business'
import { Settings } from './settings'
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
} from './types'

const pages = [
  {
    id: 'home',
    label: '办公协同',
    icon: HomeIcon,
    description: '从延期通知出发，跟进影响、决定与部门任务。',
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
    description: '供应商交期变更 · 来源、方案与处理记录。',
  },
  {
    id: 'settings',
    label: '演示设置',
    icon: Settings2,
    description: '调整样例数据、检查模型连接与失败恢复。',
  },
] as const
function readPage(): Page {
  const value = window.location.hash.slice(1)
  return pages.some((page) => page.id === value) ? (value as Page) : 'home'
}

export function OfficeApp() {
  const [page, setPage] = useState<Page>(readPage)
  const [role, setRole] = useState<Role>('lead')
  const roleRef = useRef(role)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
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
  >({})
  const [source, setSource] = useState<Source | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [receiptTask, setReceiptTask] = useState<Task | null>(null)
  const [evidence, setEvidence] = useState('')
  const [qualityResult, setQualityResult] = useState('approved')
  const confirmKey = useRef('')
  const operationLock = useRef(false)
  const receiptVersion = useRef<number | undefined>(undefined)
  const receiptDraft = useRef<{
    task: Task
    evidence: string
    result: string
  } | null>(null)
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
    if (receiptTask)
      receiptDraft.current = {
        task: receiptTask,
        evidence,
        result: qualityResult,
      }
  }, [receiptTask, evidence, qualityResult])

  const refresh = useCallback(async () => {
    let next: Snapshot
    try {
      next = await getOfficeSnapshot(role)
    } catch (failure) {
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
    ])
    if (roleRef.current !== role) return
    setSnapshot(next)
    setSources(documents.documents)
    setConfig(model)
    setHistory(runs)
    setAccessRequired(false)
  }, [role])
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
    const changed = () => setPage(readPage())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  function navigate(next: Page) {
    window.location.assign('#' + next)
    setPage(next)
  }
  function ask(value: string) {
    if (value) updateAssistantSession({ question: value })
    navigate('assistant')
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
  async function propose(action: Action, expectedVersion?: number) {
    if (operationLock.current) return
    operationLock.current = true
    setActionBusy(true)
    setError('')
    setConfirmError('')
    setNotice('')
    try {
      const response = await officeApi<{ preview: Preview }>('/preview', role, {
        action,
        expectedVersion,
      })
      confirmKey.current = crypto.randomUUID()
      if (roleRef.current !== role) return
      if (action.type === 'start_task' && response.preview.allowed) {
        const next = await officeApi<Snapshot>('/confirm', role, {
          previewId: response.preview.id,
          expectedVersion: response.preview.revision,
          idempotencyKey: confirmKey.current,
        })
        setSnapshot(next)
        setNotice('已开始处理。')
        await refresh()
      } else {
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
      if (
        ['submit_quality', 'submit_receipt'].includes(action.type) &&
        receiptDraft.current
      ) {
        setReceiptTask(receiptDraft.current.task)
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
      setSnapshot(next)
      setPreview(null)
      setReceiptTask(null)
      receiptDraft.current = null
      setNotice(`已保存。${next.analysis.nextStep}`)
      await refresh()
    } catch (failure) {
      setConfirmError(errorText(failure))
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
      const draft =
        receiptDraft.current?.task.id === task.id ? receiptDraft.current : null
      setEvidence(draft?.evidence || '')
      setQualityResult(draft?.result || 'approved')
    },
    [snapshot?.state.revision]
  )
  function receiptPreview() {
    if (!receiptTask || !evidence.trim()) return
    const action: Action =
      receiptTask.id === 'T-QA'
        ? {
            type: 'submit_quality',
            taskId: receiptTask.id,
            result: qualityResult,
            evidence: evidence.trim(),
          }
        : {
            type: 'submit_receipt',
            taskId: receiptTask.id,
            evidence: evidence.trim(),
          }
    setReceiptTask(null)
    void propose(action, receiptVersion.current)
  }
  const currentPage = pages.find((item) => item.id === page)!
  const businessProps = {
    role,
    busy: actionBusy || loading,
    sources,
    propose: (action: Action) => void propose(action),
    openSource,
    giveReceipt,
    ask,
    viewMatter: () => navigate('matter'),
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
    <>
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
            onValueChange={(value) => {
              roleRef.current = value as Role
              setLoading(true)
              setError('')
              setPreview(null)
              setReceiptTask(null)
              receiptDraft.current = null
              setNotice('')
              setRole(value as Role)
            }}
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
      <Main className='flex flex-1 flex-col gap-6'>
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
        {!snapshot && loading && (
          <div className='flex items-center gap-3 p-8 text-sm text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' />
            正在加载…
          </div>
        )}
        {snapshot && (
          <div className={loading ? 'pointer-events-none opacity-60' : ''}>
            {page === 'home' && <Home snapshot={snapshot} {...businessProps} />}
            {page === 'matter' && (
              <Matter snapshot={snapshot} {...businessProps} />
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
                propose={(action, expectedVersion) =>
                  void propose(action, expectedVersion)
                }
                openSettings={() => navigate('settings')}
                giveReceipt={giveReceipt}
                viewMatter={() => navigate('matter')}
                actionBusy={actionBusy || loading}
              />
            )}
            {page === 'settings' && (
              <Settings
                key={`${role}:${config?.model}:${config?.mode}:${snapshot.state.suppliers.find((s) => s.id === 'A')?.arrivalDay}`}
                snapshot={snapshot}
                role={role}
                config={config}
                history={history}
                openSource={openSource}
                busy={actionBusy}
                propose={(action) => void propose(action)}
                refresh={refresh}
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
        sources={sources}
        openSource={openSource}
        close={() => {
          setPreview(null)
          setConfirmError('')
        }}
        confirm={() => void confirm()}
        recheck={() => {
          if (preview) void propose(preview.action)
        }}
        viewMatter={() => navigate('matter')}
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
                ? '供应商 B 质量资格核验'
                : '提交部门处理回执'}
            </SheetTitle>
            <SheetDescription>
              SUP-001 · M-01 ·{' '}
              {receiptTask?.id === 'T-QA'
                ? '供应商 B · 发起依据 DEC-02'
                : receiptTask?.title}
            </SheetDescription>
          </SheetHeader>
          <div className='flex-1 space-y-4 px-4'>
            <ErrorNotice message={error} />
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
                  : '处理说明与凭据（必填）'}
              </Label>
              <Textarea
                id='office-evidence'
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                placeholder={
                  receiptTask?.id === 'T-QA'
                    ? '填写核验结论的依据与记录编号'
                    : '填写已完成的安排、同步结果及相关记录'
                }
                className='min-h-32'
              />
            </div>
          </div>
          <SheetFooter>
            <Button variant='outline' onClick={() => setReceiptTask(null)}>
              取消
            </Button>
            <Button
              disabled={!evidence.trim() || actionBusy}
              onClick={receiptPreview}
            >
              检查提交内容
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

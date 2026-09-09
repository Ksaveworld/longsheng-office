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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
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
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
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
  const [role, setRole] = useState<Role>('procurement')
  const roleRef = useRef(role)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [history, setHistory] = useState<History>({ runs: [], comparisons: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accessRequired, setAccessRequired] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [source, setSource] = useState<Source | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [receiptTask, setReceiptTask] = useState<Task | null>(null)
  const [evidence, setEvidence] = useState('')
  const [qualityResult, setQualityResult] = useState('approved')
  const confirmKey = useRef('')

  const refresh = useCallback(async () => {
    let next: Snapshot
    try {
      next = await getOfficeSnapshot(role)
    } catch (failure) {
      if (failure instanceof OfficeError && failure.code === 'ACCESS_REQUIRED') {
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
    roleRef.current = role
    let active = true
    setLoading(true)
    setError('')
    setPreview(null)
    setReceiptTask(null)
    setNotice('')
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
    window.location.hash = next
    setPage(next)
  }
  function ask(value: string) {
    setQuestion(value)
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
  async function propose(action: Action) {
    if (actionBusy) return
    setActionBusy(true)
    setError('')
    setConfirmError('')
    setNotice('')
    try {
      const response = await officeApi<{ preview: Preview }>('/preview', role, {
        action,
      })
      confirmKey.current = crypto.randomUUID()
      setPreview(response.preview)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setActionBusy(false)
    }
  }
  async function confirm() {
    if (!preview?.allowed || actionBusy) return
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
      setNotice('操作已由演示后台保存。任务送达与完成状态请见下方记录。')
      await refresh()
    } catch (failure) {
      setConfirmError(errorText(failure))
      try {
        await refresh()
      } catch {
        /* Keep the original confirmation error visible. */
      }
    } finally {
      setActionBusy(false)
    }
  }
  function giveReceipt(task: Task) {
    setReceiptTask(task)
    setEvidence('')
    setQualityResult('approved')
  }
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
    void propose(action)
  }
  const currentPage = pages.find((item) => item.id === page)!
  const businessProps = snapshot && {
    snapshot,
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
              <img src={`${import.meta.env.BASE_URL}brand/logo-mark-aihuashen.svg`} alt='爱化身标识' width={36} height={36} className='size-9 dark:invert' />
              <img src={`${import.meta.env.BASE_URL}brand/logo-wordmark-aihuashen.svg`} alt='AiHuaShen' width={142} height={19} className='w-[142px] dark:invert' />
            </div>
            <div>
              <h1 className='text-2xl font-semibold tracking-tight'>龙盛办公协同</h1>
              <p className='mt-3 text-sm leading-6 text-muted-foreground'>输入访问码，进入你的独立演示空间。</p>
            </div>
          </div>
          <form className='space-y-4' onSubmit={(event) => { event.preventDefault(); void enterDemo() }}>
            <div className='space-y-2'>
              <Label htmlFor='office-access-code'>演示访问码</Label>
              <Input id='office-access-code' type='password' value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder='请输入访问码' autoComplete='off' autoFocus disabled={loading} required />
            </div>
            <ErrorNotice message={error.includes('ACCESS_REQUIRED') ? '' : error} />
            <Button className='w-full' type='submit' disabled={loading || !accessCode.trim()}>
              {loading && <Loader2 className='size-4 animate-spin' />}
              进入演示
            </Button>
          </form>
          <p className='text-xs leading-5 text-muted-foreground'>本演示使用合成业务样例。</p>
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
        <Badge variant='outline' className='hidden md:inline-flex'>
          合成样例
        </Badge>
        <div className='flex items-center gap-2'>
          <Label className='hidden text-xs text-muted-foreground lg:inline'>
            演示角色
          </Label>
          <Select
            value={role}
            onValueChange={(value) => {
              roleRef.current = value as Role
              setRole(value as Role)
            }}
            disabled={actionBusy || loading}
          >
            <SelectTrigger aria-label='演示角色' className='w-36'>
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
            <h1 className='text-2xl font-bold tracking-tight'>
              {currentPage.label}
            </h1>
            <p className='mt-2 text-sm text-muted-foreground'>
              {currentPage.description}
            </p>
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
        <Tabs value={page} onValueChange={(value) => navigate(value as Page)}>
          <TabsList className='max-w-full overflow-x-auto'>
            {pages.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className='px-3 sm:px-4'
              >
                <item.icon className='hidden size-4 sm:inline' />
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
            正在读取演示空间…
          </div>
        )}
        {snapshot && businessProps && (
          <div className={loading ? 'pointer-events-none opacity-60' : ''}>
            {page === 'home' && <Home {...businessProps} />}
            {page === 'matter' && <Matter {...businessProps} />}
            {page === 'assistant' && (
              <Assistant
                key={`${role}:${config?.mode}`}
                role={role}
                config={config}
                history={history}
                question={question}
                setQuestion={setQuestion}
                refresh={refresh}
                openSource={openSource}
                propose={(action) => void propose(action)}
                openSettings={() => navigate('settings')}
              />
            )}
            {page === 'settings' && (
              <Settings
                key={`${role}:${config?.model}:${config?.mode}:${snapshot.state.suppliers.find((s) => s.id === 'A')?.arrivalDay}`}
                snapshot={snapshot}
                role={role}
                config={config}
                busy={actionBusy}
                propose={(action) => void propose(action)}
                refresh={refresh}
              />
            )}
          </div>
        )}
        <p className='mt-auto pt-3 text-xs leading-5 text-muted-foreground'>
          独立演示空间 · 后台实际保存样例数据 · 角色与外部收件箱为模拟 ·
          事项关闭不代表采购到货、生产完成或订单交付
        </p>
      </Main>
      <Sheet
        open={!!source}
        onOpenChange={(open) => {
          if (!open) setSource(null)
        }}
      >
        <SheetContent className='flex w-full flex-col sm:max-w-2xl'>
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
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !actionBusy) {
            setPreview(null)
            setConfirmError('')
          }
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{preview?.title || '检查待执行操作'}</DialogTitle>
            <DialogDescription>
              请核对内容、接收岗位与处理条件。取消不会执行任何操作。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 text-sm'>
            <div className='flex flex-wrap gap-2'>
              <Badge variant='outline'>数据 v{preview?.revision}</Badge>
              <Badge variant='secondary'>
                {preview ? roleNames[preview.role] : ''}
              </Badge>
              <Badge variant={preview?.allowed ? 'outline' : 'destructive'}>
                {preview?.allowed ? '等待人工确认' : '当前不允许执行'}
              </Badge>
            </div>
            <ul className='list-disc space-y-2 ps-5 leading-7'>
              {preview?.details.map((detail, index) => (
                <li key={index}>{detail}</li>
              ))}
            </ul>
            {preview?.reason && (
              <p className='rounded-md bg-muted p-3 leading-6'>
                {preview.reason}
              </p>
            )}
            <ErrorNotice message={confirmError} />
            {preview &&
              snapshot &&
              preview.revision !== snapshot.state.revision && (
                <p className='text-destructive'>
                  数据已更新为 v{snapshot.state.revision}
                  。请重新检查操作，不能使用旧预览确认。
                </p>
              )}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              disabled={actionBusy}
              onClick={() => {
                setPreview(null)
                setConfirmError('')
              }}
            >
              取消
            </Button>
            {preview &&
              (!preview.allowed ||
                !!confirmError ||
                preview.revision !== snapshot?.state.revision) && (
                <Button
                  variant='outline'
                  disabled={actionBusy}
                  onClick={() => void propose(preview.action)}
                >
                  重新检查
                </Button>
              )}
            <Button
              disabled={
                actionBusy ||
                !preview?.allowed ||
                preview.revision !== snapshot?.state.revision
              }
              onClick={() => void confirm()}
            >
              {actionBusy && <Loader2 className='size-4 animate-spin' />}
              确认执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!receiptTask}
        onOpenChange={(open) => {
          if (!open) setReceiptTask(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {receiptTask?.id === 'T-QA'
                ? '提交质量核验结果'
                : '提交部门处理回执'}
            </DialogTitle>
            <DialogDescription>
              {receiptTask?.title} · 先填写结果，再检查并确认提交。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
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
                处理说明与演示凭据（必填）
              </Label>
              <Textarea
                id='office-evidence'
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                placeholder={
                  receiptTask?.id === 'T-QA'
                    ? '说明核验依据、结果及对应演示凭据…'
                    : '说明已完成的安排或信息同步，并提供演示凭据…'
                }
                className='min-h-32'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setReceiptTask(null)}>
              取消
            </Button>
            <Button
              disabled={!evidence.trim() || actionBusy}
              onClick={receiptPreview}
            >
              检查提交内容
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

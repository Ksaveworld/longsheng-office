import { useState } from 'react'
import { FlaskConical, Loader2, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { officeApi, errorText } from './api'
import { OfficeGraph } from './graph'
import { ReviewPanel } from './review-panel'
import { Section, ErrorNotice } from './shared'
import type {
  Action,
  History,
  ModelConfig,
  Role,
  Snapshot,
  Source,
} from './types'

type Props = {
  snapshot: Snapshot
  config: ModelConfig | null
  role: Role
  busy: boolean
  propose: (action: Action) => void
  refresh: () => Promise<void>
  history: History
  openSource: (source: Source) => void
}
export function Settings({
  snapshot,
  config,
  role,
  busy,
  propose,
  refresh,
  history,
  openSource,
}: Props) {
  const [day, setDay] = useState(
    String(
      snapshot.state.suppliers.find((supplier) => supplier.id === 'A')
        ?.arrivalDay ?? 6
    )
  )
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || '')
  const [model, setModel] = useState(config?.model || '')
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<'live' | 'rules'>(config?.mode || 'rules')
  const [pending, setPending] = useState<'save' | 'test' | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const canEdit = role === 'lead'
  const connection =
    config?.connection && typeof config.connection === 'object'
      ? (config.connection as { ok?: boolean; testedAt?: string })
      : null
  const endpointChanged =
    baseUrl.trim().replace(/\/+$/, '') !==
    (config?.baseUrl || '').trim().replace(/\/+$/, '')
  async function save() {
    setPending('save')
    setError('')
    setResult('')
    try {
      await officeApi<ModelConfig>('/model', role, {
        baseUrl,
        model,
        mode,
        ...(apiKey ? { apiKey } : {}),
      })
      setApiKey('')
      setResult('模型配置已保存。')
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setPending(null)
    }
  }
  async function test() {
    setPending('test')
    setError('')
    setResult('')
    try {
      const response = await officeApi<{
        ok: boolean
        model: string
        reply?: string
        latencyMs?: number
        error?: { code?: string; message?: string }
      }>('/model/test', role, {})
      if (!response.ok) {
        setError(
          `${response.error?.message || '模型连接未通过。'}${response.error?.code ? ` · ${response.error.code}` : ''}`
        )
        await refresh()
        return
      }
      const latency =
        typeof response.latencyMs === 'number' &&
        Number.isFinite(response.latencyMs)
          ? ` · ${(response.latencyMs / 1000).toFixed(1)} 秒`
          : ''
      setResult(
        `连接成功 · ${response.model || model}${latency}${response.reply ? `\n${response.reply}` : ''}`
      )
      await refresh()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setPending(null)
    }
  }
  return (
    <div className='grid items-start gap-6 xl:grid-cols-2'>
      <div className='space-y-6'>
        <Section title='场景变量'>
          <div className='space-y-5 text-sm'>
            <p className='leading-6 text-muted-foreground'>
              D0
              为演示起点。调整到料日期后，首页、助手及事项详情使用同一数据版本重新计算。
            </p>
            {!canEdit && (
              <p className='rounded-md bg-muted p-3'>
                请在页头切换为“业务负责人”后修改演示设置。
              </p>
            )}
            <div className='space-y-2'>
              <Label htmlFor='office-arrival'>供应商 A 到料日（D1–D30）</Label>
              <div className='flex gap-2'>
                <Input
                  id='office-arrival'
                  type='number'
                  min={1}
                  max={30}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  className='w-28'
                  disabled={!canEdit || busy}
                />
                <Button
                  variant='outline'
                  disabled={
                    !canEdit ||
                    busy ||
                    !Number.isInteger(Number(day)) ||
                    Number(day) < 1 ||
                    Number(day) > 30
                  }
                  onClick={() =>
                    propose({
                      type: 'set_arrival',
                      supplierId: 'A',
                      day: Number(day),
                    })
                  }
                >
                  预览日期调整
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                初始 D6：1 条风险；调至 D9：2 条风险（切换 B 前）。
              </p>
            </div>
            <div className='space-y-3 border-t pt-5'>
              <p className='font-medium'>模拟一次发送失败</p>
              <p className='leading-6 text-muted-foreground'>
                下一次任务创建或重试将失败一次，随后可检查失败状态并人工重试。仅演示空间内发送。
              </p>
              <div className='flex flex-wrap items-center gap-3'>
                <Button
                  variant='outline'
                  disabled={!canEdit || busy || snapshot.state.failNextDelivery}
                  onClick={() => propose({ type: 'arm_delivery_failure' })}
                >
                  <FlaskConical className='size-4' />
                  设置下一次发送失败
                </Button>
                <Badge variant='outline'>
                  {snapshot.state.failNextDelivery
                    ? '等待下一次发送触发'
                    : '未设置'}
                </Badge>
              </div>
            </div>
            <div className='space-y-3 border-t pt-5'>
              <p className='font-medium'>重置当前演示</p>
              <p className='leading-6 text-muted-foreground'>
                恢复本空间的初始样例，清除当前任务、决定与旧操作预览。不会修改其他空间或旧产销
                Demo。
              </p>
              <Button
                variant='outline'
                disabled={!canEdit || busy}
                onClick={() => propose({ type: 'reset' })}
              >
                <RotateCcw className='size-4' />
                预览重置
              </Button>
            </div>
          </div>
        </Section>
        <Section title='接入范围'>
          <dl className='space-y-4 text-sm'>
            <div className='flex justify-between gap-4'>
              <dt className='text-muted-foreground'>数据与任务</dt>
              <dd>演示后台实际执行</dd>
            </div>
            <div className='flex justify-between gap-4'>
              <dt className='text-muted-foreground'>任务送达</dt>
              <dd>模拟收件箱</dd>
            </div>
            <div className='flex justify-between gap-4'>
              <dt className='text-muted-foreground'>OA / ERP / DataOS</dt>
              <dd>未接入外部系统</dd>
            </div>
            <div className='border-t pt-4'>
              <dt className='text-muted-foreground'>当前演示空间</dt>
              <dd className='mt-2 font-mono text-xs break-all'>
                {snapshot.workspaceId}
              </dd>
            </div>
          </dl>
        </Section>
      </div>
      <Section
        title='模型运行'
        aside={
          <Badge variant='outline'>
            {connection?.ok ? '已连接' : '未连接'}
          </Badge>
        }
      >
        <dl className='mb-5 space-y-4 text-sm'>
          <div className='flex justify-between gap-4'>
            <dt className='text-muted-foreground'>模型状态</dt>
            <dd>
              {connection?.ok
                ? '已连接'
                : config?.keyConfigured
                  ? '已配置，待检测连接'
                  : '未连接'}
            </dd>
          </div>
          <div className='flex justify-between gap-4'>
            <dt className='text-muted-foreground'>当前模式</dt>
            <dd>{config?.mode === 'live' ? '真实模型' : '规则演示'}</dd>
          </div>
          <div className='flex justify-between gap-4'>
            <dt className='text-muted-foreground'>业务工具</dt>
            <dd>按岗位权限执行</dd>
          </div>
          <div className='flex justify-between gap-4'>
            <dt className='text-muted-foreground'>最近检测</dt>
            <dd>
              {connection?.testedAt
                ? new Date(connection.testedAt).toLocaleString('zh-CN')
                : '尚未检测'}
            </dd>
          </div>
        </dl>
        <details className='rounded-lg border p-4'>
          <summary className='cursor-pointer text-sm font-medium'>
            高级配置
          </summary>
          <form
            className='mt-5 space-y-5'
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <p className='text-sm leading-6 text-muted-foreground'>
              使用 OpenAI
              兼容接口。密钥只用于服务端连接，保存后不会回显或写入浏览器本地存储。
            </p>
            <div className='space-y-2'>
              <Label htmlFor='office-baseurl'>API 地址</Label>
              <Input
                id='office-baseurl'
                type='url'
                value={baseUrl}
                placeholder='https://api.example.com/v1'
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={!canEdit || !!pending}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='office-model'>模型名称</Label>
              <Input
                id='office-model'
                value={model}
                placeholder='供应商提供的模型标识'
                onChange={(event) => setModel(event.target.value)}
                disabled={!canEdit || !!pending}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='office-key'>API 密钥</Label>
              <Input
                id='office-key'
                type='password'
                autoComplete='new-password'
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  endpointChanged
                    ? '接口地址已变更，请重新填写密钥'
                    : config?.keyConfigured
                      ? '已保存，留空保持原密钥'
                      : '输入密钥'
                }
                disabled={!canEdit || !!pending}
              />
              {endpointChanged && (
                <p className='text-sm leading-6 text-muted-foreground'>
                  API
                  地址已变更。旧密钥不会转发到新地址，请重新输入该地址的密钥；留空保存后需要补充密钥才能真实调用。
                </p>
              )}
            </div>
            <div className='space-y-2'>
              <Label>默认运行模式</Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as 'live' | 'rules')}
                disabled={!canEdit || !!pending}
              >
                <SelectTrigger aria-label='默认运行模式'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='rules'>规则演示</SelectItem>
                  <SelectItem value='live'>真实模型调用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ErrorNotice message={error} />
            {result && (
              <p
                role='status'
                className='rounded-md bg-muted p-3 text-sm leading-6 break-words whitespace-pre-wrap'
              >
                {result}
              </p>
            )}
            <div className='flex flex-wrap gap-2'>
              <Button type='submit' disabled={!canEdit || !!pending}>
                {pending === 'save' ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <Save className='size-4' />
                )}
                保存模型配置
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={!canEdit || !!pending || !config?.keyConfigured}
                onClick={() => void test()}
              >
                {pending === 'test' && (
                  <Loader2 className='size-4 animate-spin' />
                )}
                测试已保存的连接
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              保存后再测试。真实调用失败会直接显示错误，不自动伪装为规则答案。
            </p>
          </form>
        </details>
      </Section>
      <div className='xl:col-span-2'>
        <Section title='技术视图'>
          <p className='mb-4 text-sm leading-6 text-muted-foreground'>
            查看同一事项对应的对象目录、完整关系和模型结构，供技术交流使用。
          </p>
          <details className='rounded-lg border p-4'>
            <summary className='cursor-pointer text-sm font-medium'>
              展开完整本体图
            </summary>
            <div className='mt-5'>
              <OfficeGraph graph={snapshot.graph} openSource={openSource} />
            </div>
          </details>
        </Section>
      </div>
      <div className='xl:col-span-2'>
        <Section title='演示复盘'>
          <p className='mb-4 text-sm text-muted-foreground'>主演示结束后，按需比较模型回答、核对工具调用和历史运行。</p>
          <details className='rounded-lg border p-4'>
            <summary className='cursor-pointer text-sm font-medium'>展开演示复盘</summary>
            <div className='mt-5'><ReviewPanel role={role} config={config} history={history} refresh={refresh} openSource={openSource} /></div>
          </details>
        </Section>
      </div>
    </div>
  )
}

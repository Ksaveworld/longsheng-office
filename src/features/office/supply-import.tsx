import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { officeApi, errorText } from './api'
import type { Preview, Snapshot } from './types'

type CsvFile = { type: 'Supplier' | 'Order'; name: string; text: string }

export function SupplyImport({ snapshot, refresh }: { snapshot: Snapshot; refresh: () => Promise<void> }) {
  const [files, setFiles] = useState<Partial<Record<CsvFile['type'], CsvFile>>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmationId, setConfirmationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const { state, role } = snapshot
  if (state.matter.id !== 'SUP-001') return null
  const locked = Boolean(state.matter.planSelection || state.tasks.length || state.matter.status !== 'open')
  const authorized = role === 'lead' || role === 'procurement'
  const stale = preview && preview.revision !== state.revision
  async function choose(type: CsvFile['type'], file?: File) {
    setPreview(null); setError(''); setMessage('')
    setFiles(current => ({ ...current, [type]: undefined }))
    if (!file) return
    if (file.size > 60000) { setError('每份样例表不得超过 60 KB。'); return }
    setBusy(true)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      setFiles(current => ({ ...current, [type]: { type, name: file.name, text } }))
    } catch { setError('无法读取文件，请选择 UTF-8 编码的 CSV。') }
    finally { setBusy(false) }
  }
  async function inspect() {
    setBusy(true); setError(''); setPreview(null); setMessage('')
    try {
      const result = await officeApi<{ preview: Preview }>('/preview', role, {
        expectedVersion: state.revision,
        action: { type: 'import_supply', dataKind: 'synthetic', files: [files.Supplier, files.Order] },
      })
      if (!result.preview.allowed) setError(result.preview.reason || '样例表未通过校验。')
      else { setPreview(result.preview); setConfirmationId(crypto.randomUUID()) }
    } catch (failure) { setError(errorText(failure)) }
    finally { setBusy(false) }
  }
  async function confirm() {
    if (!preview) return
    setBusy(true); setError('')
    try {
      await officeApi('/confirm', role, { previewId: preview.id, expectedVersion: preview.revision, idempotencyKey: confirmationId })
      setPreview(null)
      setMessage('合成样例已导入，订单影响与原始行依据已更新。')
      await refresh()
    } catch (failure) { setError(errorText(failure)) }
    finally { setBusy(false) }
  }
  return (
    <section aria-label='导入供应样例' className='min-w-0 rounded-xl border bg-card p-5'>
      <h3 className='flex items-center gap-2 font-semibold'><Upload className='size-4' />导入供应样例</h3>
      <p className='mt-2 text-sm leading-7 text-muted-foreground'>
        将供应商和订单 CSV 整理为当前事项的业务对象，先核对再导入。仅支持现有合成样例字段；不接入客户生产数据。
      </p>
      <div className='mt-3 flex flex-wrap gap-3 text-sm'>
        <a className='underline underline-offset-4' href={`${import.meta.env.BASE_URL}supply-samples/Supplier.csv`} download>下载 D9 供应商样例</a>
        <a className='underline underline-offset-4' href={`${import.meta.env.BASE_URL}supply-samples/Order.csv`} download>下载配套订单样例</a>
      </div>
      <p className='mt-2 text-xs leading-6 text-muted-foreground'>
        两表须来自同一快照，并包含当前全部 2 家供应商及 2 条订单。仅更新 A 的预计到料日及订单最晚到料日；B 沿用既有条件。相对日期 D1–D30，风险、审批及计算结果不从文件导入。
      </p>
      {locked || !authorized ? <p className='mt-3 text-sm'>{locked ? '事项已进入办理流程，不能覆盖当前依据。' : '请由采购经办或业务负责人导入样例。'}</p> : (
        <>
          <div className='mt-4 grid min-w-0 gap-4 md:grid-cols-2'>
            {(['Supplier', 'Order'] as const).map(type => (
              <label key={type} className='min-w-0 text-sm'>
                {type === 'Supplier' ? '供应商 CSV' : '订单 CSV'}
                <input className='mt-2 block w-full min-w-0 rounded-md border p-2 text-xs' type='file' accept='.csv,text/csv' disabled={busy} onChange={event => void choose(type, event.target.files?.[0])} />
              </label>
            ))}
          </div>
          <Button className='mt-4' variant='outline' disabled={busy || !files.Supplier || !files.Order} onClick={() => void inspect()}>校验并预览导入</Button>
          {preview && (
            <div className='mt-4 rounded-lg bg-muted/50 p-4'>
              <p className='font-medium'>{preview.title}</p>
              <ul className='mt-2 space-y-1 text-sm leading-6'>{preview.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
              {stale && <p role='alert' className='mt-2 text-sm text-destructive'>数据已更新，请重新校验后确认。</p>}
              <Button className='mt-3' disabled={busy || Boolean(stale)} onClick={() => void confirm()}>确认导入合成样例</Button>
            </div>
          )}
        </>
      )}
      {error && <p role='alert' className='mt-3 text-sm text-destructive'>{error}</p>}
      {message && <p role='status' className='mt-3 text-sm'>{message} <a className='underline' href='#assistant?id=SUP-001'>向助手查询</a></p>}
    </section>
  )
}

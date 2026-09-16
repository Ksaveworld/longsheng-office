import { useState } from 'react'
import { Sources } from './shared'
import type { OrderChain, Source } from './types'

export function OrderChainPanel({ chains, sources, openSource }: {
  chains: OrderChain[]
  sources: Source[]
  openSource: (source: Source) => void
}) {
  const [selected, setSelected] = useState('')
  const chain = chains.find(item => item.orderId === selected) || chains[0]
  if (!chain) return null
  return (
    <section aria-label='按订单追溯' className='min-w-0 rounded-xl border bg-card p-5'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h3 className='font-semibold'>按订单追溯</h3>
          <p className='mt-2 text-sm leading-6 text-muted-foreground'>
            从订单要求查到供货影响、决定和办理进度。
          </p>
        </div>
        <label className='flex flex-wrap items-center gap-2 text-sm'>
          关联订单
          <select aria-label='选择追溯订单' value={chain.orderId}
            onChange={event => setSelected(event.target.value)}
            className='min-h-10 max-w-full rounded-md border bg-card px-3 py-2'>
            {chains.map(item => <option key={item.orderId} value={item.orderId}>{item.orderId}</option>)}
          </select>
        </label>
      </div>
      <ol className='mt-5 space-y-4'>
        {chain.steps.map((step, index) => (
          <li key={step.id} className='flex min-w-0 gap-3'>
            <span aria-hidden='true' className='flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium'>{index + 1}</span>
            <div className='min-w-0 flex-1 border-b pb-4'>
              <h4 className='text-sm font-medium'>{step.title}</h4>
              <div className='my-2 space-y-1 text-sm leading-7'>
                {step.lines.map((line, i) => <p key={i}>{line}</p>)}
              </div>
              <Sources sources={sources.filter(source => step.sourceIds.includes(source.id))} open={openSource} />
            </div>
          </li>
        ))}
      </ol>
      <p className='mt-3 text-xs leading-6 text-muted-foreground'>
        各步骤使用同一份当前数据（版本 {chain.revision}）。也可在助手中输入“追溯 {chain.orderId}”。
      </p>
    </section>
  )
}

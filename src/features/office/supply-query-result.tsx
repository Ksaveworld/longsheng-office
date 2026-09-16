import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Source, SupplyQuery } from './types'

export function SupplyQueryResult({ result, openSource }: { result: SupplyQuery; openSource: (source: Source) => void }) {
  return (
    <section aria-label='订单条件核对' className='min-w-0 space-y-3 rounded-lg border bg-muted/20 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-semibold'>订单筛选结果</h3>
        <Badge variant='outline'>命中 {result.matchedCount} / {result.totalCount} 条</Badge>
      </div>
      <p className='text-xs leading-6 text-muted-foreground'>
        当前事项 · 当前采用供应商 {result.supplierId} · 回答时数据 v{result.revision} · 合成样例
      </p>
      <div className='flex flex-wrap gap-2'>
        {result.conditions.length ? result.conditions.map(condition => <Badge key={condition.key} variant='secondary' className='max-w-full whitespace-normal'>{condition.label}</Badge>) : <span className='text-xs'>查询当前事项全部关联订单</span>}
      </div>
      {result.matchedCount === 0 && <p className='rounded-md border border-dashed p-3 text-sm'>{result.message}</p>}
      <div className='space-y-3'>
        {result.evaluations.map(record => (
          <article key={record.id} className='min-w-0 rounded-md border bg-background p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <strong className='text-sm'>{record.id}</strong>
              <Badge variant={record.matched ? 'default' : 'outline'}>{record.matched ? '符合全部条件' : '未纳入结果'}</Badge>
            </div>
            <p className='mt-2 text-xs leading-6'>最晚 D{record.requiredDay} 到料 · 预计 D{record.arrivalDay} 到料 · 预计晚 {record.lateDays} 天</p>
            <ul className='mt-2 space-y-1 text-xs leading-6'>
              {record.checks.map(check => <li key={check.key} className={check.passed ? 'text-muted-foreground' : 'text-destructive'}>{check.passed ? '满足' : '不满足'}：{check.label}；实际{check.actual}。</li>)}
            </ul>
            <details className='mt-2'>
              <summary className='cursor-pointer text-xs text-muted-foreground'>查看这条订单的来源</summary>
              <div className='mt-2 flex flex-wrap gap-2'>
                {result.sources.filter(source => record.sourceIds.includes(source.id)).map(source => <Button key={source.id} size='sm' variant='outline' className='h-auto max-w-full whitespace-normal text-start' onClick={() => openSource(source)}>{source.title}</Button>)}
              </div>
            </details>
          </article>
        ))}
      </div>
      <details className='text-xs text-muted-foreground'>
        <summary className='cursor-pointer'>查看计算口径</summary>
        <p className='mt-2 leading-6'>{result.formula} 多个筛选条件须同时满足。到料风险不等同于成品交付延期或合同违约。</p>
      </details>
    </section>
  )
}

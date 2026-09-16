import { matterHandling } from './handling'
import { roleNames, type Snapshot } from './types'

export function HandlingSummary({ snapshot }: { snapshot: Snapshot }) {
  const h = matterHandling(snapshot)
  return <section aria-label='当前事项摘要' className='min-w-0 rounded-lg border bg-card p-3 text-sm leading-6'>
    <p className='text-xs text-muted-foreground'>当前进度 · {snapshot.state.matter.id} · 演示岗位：{roleNames[snapshot.role]}</p>
    <p><strong>当前：</strong>{h.current}</p>
    <p><strong>我的任务：</strong>{h.myTask}<span className='mx-2'>·</span><strong>责任岗位：</strong>{h.nextRoles || '协同已完成'}</p>
    {!snapshot.state.scenario && <p>当前采用 {snapshot.state.matter.supplierId}。{h.waitingForReview ? '核验通过后仍需负责人批准。' : h.closed ? '办结不代表实物到货或订单交付。' : '关键操作在事项详情中确认。'}</p>}
  </section>
}

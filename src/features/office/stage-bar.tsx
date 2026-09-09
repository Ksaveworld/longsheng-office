import { Check } from 'lucide-react'
import type { Workflow } from './types'

const stages = ['事件发现', '影响研判', '质量核验', '负责人批准', '部门执行', '复核关闭']
export function StageBar({ workflow }: { workflow: Workflow }) {
  const current = Number(workflow.stage.slice(1))
  return <nav aria-label='事项处理阶段' className='rounded-lg border bg-muted/15 px-3 py-4'>
    <ol className='grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-6'>
      {stages.map((label, index) => <li key={label} aria-current={current === index ? 'step' : undefined} className={`flex min-w-0 items-center gap-2 text-xs ${current === index || current === 6 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${current === index ? 'border-foreground bg-foreground text-background' : index < current ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'bg-background'}`}>
          {index < current ? <Check className='size-3.5' /> : index + 1}
        </span>
        <span>{label}</span>
      </li>)}
    </ol>
  </nav>
}

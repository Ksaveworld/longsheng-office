import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { statuses } from '../data/data'
import { type Task } from '../data/schema'
export function TasksMutateDrawer({ open, onOpenChange, currentRow }: { open: boolean; onOpenChange: (open: boolean) => void; currentRow?: Task }) {
 const isMatter = currentRow?.id === 'SUP-001'
 return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className='flex flex-col sm:max-w-lg'>
  <SheetHeader className='text-start'><SheetTitle>{currentRow?.title ?? '事项详情'}</SheetTitle><SheetDescription>界面样张 · 示例数据 · 未真实派发任务</SheetDescription></SheetHeader>
  <div className='flex-1 space-y-7 overflow-y-auto px-4 text-sm'>
   <div className='flex items-center gap-3'><span className='font-mono text-muted-foreground'>{currentRow?.id}</span><Badge variant='secondary'>{statuses.find(s => s.value === currentRow?.status)?.label}</Badge></div>
   <div className='space-y-2'><p className='font-medium'>所属事项</p><p className='text-muted-foreground'>SUP-001 · 供应商交期变更</p></div>
   <div className='space-y-2'><p className='font-medium'>当前处理条件</p><p className='leading-7 text-muted-foreground'>{isMatter ? '待质量核验。供应商 B 的资质通过核验后，才可提交负责人确认切换。' : currentRow?.id === 'SUB-001' ? '核验供应商 B 的资质，给出核验结果后进入负责人确认环节。' : '等待供应商 B 资质核验通过。当前尚不满足确认切换的前置条件。'}</p></div>
   {isMatter && <div className='space-y-3'><p className='font-medium'>关联子任务</p><div className='rounded-md border divide-y'><div className='flex items-center justify-between gap-3 p-4'><span>核验供应商 B 资质</span><Badge variant='outline'>待处理</Badge></div><div className='flex items-center justify-between gap-3 p-4'><span>负责人确认切换</span><Badge variant='outline'>待前置条件</Badge></div></div></div>}
  </div>
  <SheetFooter className='gap-2'><SheetClose asChild><Button variant='outline'>关闭详情</Button></SheetClose></SheetFooter>
 </SheetContent></Sheet>
}

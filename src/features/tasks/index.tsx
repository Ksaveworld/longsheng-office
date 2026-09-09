import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { TasksDialogs } from './components/tasks-dialogs'
import { TasksProvider, useTasks } from './components/tasks-provider'
import { TasksTable } from './components/tasks-table'
import { tasks } from './data/tasks'
function PreviewActions() {
 const { setOpen, setCurrentRow } = useTasks()
 return <Button onClick={() => { setCurrentRow(tasks[0]); setOpen('update') }}>查看事项</Button>
}
export function Tasks() {
 return <TasksProvider>
  <Header fixed><div className='me-auto text-sm text-muted-foreground'>工作空间 <span className='mx-3'>/</span> <span className='text-foreground'>协同事项</span></div><Badge variant='outline'>界面样张 · 示例数据</Badge><ThemeSwitch /></Header>
  <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
   <div className='flex flex-wrap items-end justify-between gap-4'>
    <div><h2 className='text-2xl font-bold tracking-tight'>协同事项</h2><p className='mt-2 text-sm text-muted-foreground'>查看事项进展、关联任务与下一步处理条件。</p></div>
    <PreviewActions />
   </div>
   <div className='flex flex-wrap items-center gap-3 text-sm'><Badge variant='secondary'>1 个事项</Badge><span className='text-muted-foreground'>2 个关联子任务</span><span className='text-muted-foreground'>·</span><span>当前环节：待质量核验</span></div>
   <TasksTable data={tasks} />
   <p className='text-sm text-muted-foreground'>本页仅供确认界面风格。任务与状态均为示例，未真实派发。</p>
  </Main>
  <TasksDialogs />
 </TasksProvider>
}

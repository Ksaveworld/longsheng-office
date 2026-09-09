import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { type Row } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { taskSchema } from '../data/schema'
import { useTasks } from './tasks-provider'
export function DataTableRowActions<TData>({ row }: { row: Row<TData> }) {
 const task = taskSchema.parse(row.original)
 const { setOpen, setCurrentRow } = useTasks()
 return <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant='ghost' className='flex h-8 w-8 p-0 data-[state=open]:bg-muted'><DotsHorizontalIcon className='h-4 w-4'/><span className='sr-only'>事项菜单</span></Button></DropdownMenuTrigger><DropdownMenuContent align='end' className='w-40'><DropdownMenuItem onClick={() => { setCurrentRow(task); setOpen('update') }}>查看详情</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}

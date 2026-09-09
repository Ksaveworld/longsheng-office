import { Circle, CheckCircle, Timer, HelpCircle, CircleOff, ArrowRight } from 'lucide-react'
export const labels = [{ value: 'matter', label: '事项' }, { value: 'subtask', label: '子任务' }]
export const statuses = [
 { label: '待前置条件', value: 'backlog' as const, icon: HelpCircle },
 { label: '待处理', value: 'todo' as const, icon: Circle },
 { label: '处理中', value: 'in progress' as const, icon: Timer },
 { label: '已完成', value: 'done' as const, icon: CheckCircle },
 { label: '已取消', value: 'canceled' as const, icon: CircleOff },
]
export const priorities = [{ label: '未设置', value: 'medium' as const, icon: ArrowRight }]

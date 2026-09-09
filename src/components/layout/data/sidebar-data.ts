import { Command, ListTodo } from 'lucide-react'
import { type SidebarData } from '../types'
export const sidebarData: SidebarData = {
  user: { name: '独立演示空间', email: '合成业务样例 · 页内切换角色', avatar: '' },
  teams: [{ name: '龙盛办公协同', logo: Command, plan: '协同工作空间' }],
  navGroups: [{ title: '工作空间', items: [{ title: '协同事项', url: '/tasks', icon: ListTodo }] }],
}

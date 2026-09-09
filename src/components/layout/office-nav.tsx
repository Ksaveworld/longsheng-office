import { useEffect, useState } from 'react'
import { Home, MessageSquare, ListTodo, Settings2 } from 'lucide-react'
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar'

const items = [
  { id: 'home', label: '办公协同', icon: Home },
  { id: 'assistant', label: '业务助手', icon: MessageSquare },
  { id: 'matter', label: '事项详情', icon: ListTodo },
  { id: 'settings', label: '演示设置', icon: Settings2 },
]
export function OfficeNav() {
  const [page, setPage] = useState(window.location.hash.slice(1) || 'home')
  useEffect(() => { const changed = () => setPage(window.location.hash.slice(1) || 'home'); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed) }, [])
  return <SidebarGroup><SidebarGroupLabel>工作空间</SidebarGroupLabel><SidebarMenu>{items.map(item => <SidebarMenuItem key={item.id}><SidebarMenuButton asChild tooltip={item.label} isActive={page === item.id}><a href={`${import.meta.env.BASE_URL}office#${item.id}`}><item.icon /><span>{item.label}</span></a></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>
}

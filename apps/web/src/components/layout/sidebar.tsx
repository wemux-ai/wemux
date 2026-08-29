import { useState, useCallback, useEffect, useRef } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import {
  Cpu,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  Settings,
  Users,
  Workflow,
} from 'lucide-react'
import { cn } from '../../lib/utils'

const matchesSearch = (expected: Record<string, string | undefined>, currentSearchParams: URLSearchParams) => (
  Object.entries(expected).every(([key, value]) => currentSearchParams.get(key) === value)
)

const navItems = [
  { label: '仪表盘', icon: <LayoutDashboard size={18} />, path: '/dashboard' },
  { label: '节点管理', icon: <Workflow size={18} />, path: '/execution' },
  { label: '看板', icon: <LayoutGrid size={18} />, path: '/kanban' },
  { label: '组织管理', icon: <Users size={18} />, path: '/settings', search: { section: 'workspace', checkout: undefined, billingRequestId: undefined, workspaceId: undefined, billingDebug: undefined } },
  { label: 'Agent 体系', icon: <MessageCircle size={18} />, path: '/chat' },
  { label: 'Agents', icon: <Cpu size={18} />, path: '/agents' },
  { label: '设置', icon: <Settings size={18} />, path: '/settings' },
]

const MIN_WIDTH = 160
const MAX_WIDTH = 320
const DEFAULT_WIDTH = 176 // 20% smaller than 220

export const Sidebar = () => {
  const location = useLocation()
  const currentPath = location.pathname
  const currentSearchParams = new URLSearchParams(location.search)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  return (
    <aside
      ref={sidebarRef}
      className="relative flex h-screen flex-col border-r bg-card text-card-foreground"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      <div
        className={cn(
          "absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors",
          isResizing ? "bg-primary/50" : "hover:bg-primary/30"
        )}
        onMouseDown={handleMouseDown}
      />
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <img src="/logo.png" alt="" className="h-8 w-8 rounded-md" />
        <span className="font-semibold">Wemux</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <Link
            key={`${item.path}:${item.search?.section ?? ''}`}
            to={item.path as never}
            search={(item.search ?? {}) as never}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              (
                (item.path === '/dashboard' && currentPath === '/')
                || (
                  currentPath === item.path
                  && (
                    item.path !== '/settings'
                    || (
                      item.search
                        ? matchesSearch(item.search, currentSearchParams)
                        : !currentSearchParams.get('section')
                    )
                  )
                )
              )
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground'
            )}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">Wemux Console v1.0</p>
      </div>
    </aside>
  )
}

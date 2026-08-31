// [INPUT]: 管理请求
// [OUTPUT]: 管理页
// [POS]: 管理员页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, Outlet, Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  BarChart3,
  Cpu,
  
  Workflow,
  Network,
  
  ReceiptText,
  Settings,
  Users,
  Shield,
  Menu,
  X,
  ArrowLeft,
  Moon,
  Sun,
  
  
  
  
  Activity,
  HardDrive,
  Database,
  Bell,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui-admin/button'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { api } from '@/lib/api'
import { buildNoIndexHead } from '@/lib/marketing-site'
import { useTranslation } from '@/lib/i18n/react'
import { LanguageSwitcher } from '@/components/language-switcher'

export const Route = createFileRoute('/admin')({
  head: () => buildNoIndexHead({
    title: 'Wemux Admin',
    description: 'Internal Wemux admin console.',
  }),
  component: AdminLayout,
})

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  badgeCount?: number
}

type AdminTheme = 'dark' | 'light'

const ADMIN_THEME_STORAGE_KEY = 'vibemux-admin-theme'

/** Admin 独立深浅主题：默认深色（与产品整体一致），localStorage 记忆，与全局主题解耦。 */
function useAdminTheme(): [AdminTheme, () => void] {
  const [theme, setTheme] = useState<AdminTheme>(() => {
    if (typeof window === 'undefined') {
      return 'dark'
    }
    try {
      const saved = window.localStorage?.getItem(ADMIN_THEME_STORAGE_KEY)
      if (saved === 'dark' || saved === 'light') {
        return saved
      }
    } catch {
      // fall through to default
    }
    return 'dark'
  })

  useEffect(() => {
    try {
      window.localStorage?.setItem(ADMIN_THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore storage failures so theme toggling still works.
    }
  }, [theme])

  // Admin 深色时同步 body 背景，避免内容滚动时露出浅色 overscroll 区域；退出时恢复。
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const previous = document.body.style.background
    document.body.style.background = theme === 'dark' ? 'oklch(0.145 0 0)' : ''
    return () => {
      document.body.style.background = previous
    }
  }, [theme])

  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  return [theme, toggleTheme]
}

const adminThemeClass = (theme: AdminTheme) => (theme === 'dark' ? 'vibemux-admin-dark' : 'vibemux-admin-light')

const adminNavGroups: { label: string; items: NavItem[] }[] = []

function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  const currentPath = location.pathname
  const { t } = useTranslation()
  const { user } = useAuth()
  const [feedbackAttentionCount, setFeedbackAttentionCount] = useState(0)

  useEffect(() => {
    if (!user) {
      setFeedbackAttentionCount(0)
      return
    }

    let cancelled = false
    const refresh = async () => {
      try {
        const response = await api.getAdminFeedbackAttentionCount()
        if (!cancelled) {
          setFeedbackAttentionCount(response.count)
        }
      } catch {
        if (!cancelled) {
          setFeedbackAttentionCount(0)
        }
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [user?.id])

  const adminNavGroups: { label: string; items: NavItem[] }[] = [
    {
      label: t('admin.nav.overview'),
      items: [
        { title: t('admin.nav.dashboard'), href: '/admin', icon: LayoutDashboard, description: 'System overview and metrics' },
      ],
    },
    {
      label: t('admin.nav.infrastructure'),
      items: [
        { title: t('admin.nav.nodes'), href: '/admin/nodes', icon: Network, description: t('admin.nav.nodesDesc') },
        { title: t('admin.nav.executors'), href: '/admin/executors', icon: Cpu, description: 'Worker and executor management' },
      ],
    },
    {
      label: '运维 Ops（Admin）',
      items: [
        { title: '健康度', href: '/admin/ops/health', icon: Activity, description: 'DB / R2 / 对外接口 / 节点健康' },
        { title: 'R2 存储', href: '/admin/ops/storage', icon: HardDrive, description: 'R2 用量与文件浏览' },
        { title: '数据库', href: '/admin/ops/database', icon: Database, description: '备份 / 策略 / 快速切换' },
        { title: '告警', href: '/admin/ops/alerts', icon: Bell, description: '飞书 + Telegram 告警配置' },
      ],
    },
    {
      label: t('admin.nav.operations'),
      items: [
        { title: t('admin.nav.tasks'), href: '/admin/tasks', icon: Workflow, description: 'Distributed task monitoring' },
        { title: t('admin.nav.workspaces'), href: '/admin/workspaces', icon: Users, description: 'Workspace session management' },
        { title: t('admin.nav.users'), href: '/admin/users', icon: Users, description: 'User account management' },
      ],
    },
    {
      label: t('admin.nav.business'),
      items: [
        { title: t('admin.nav.analytics'), href: '/admin/analytics', icon: BarChart3, description: 'First-party product analytics' },
        { title: t('admin.nav.communityUsage'), href: '/admin/community', icon: Globe, description: 'Community edition usage reporting' },
        {
          title: t('admin.nav.feedback'),
          href: '/admin/feedback',
          icon: ReceiptText,
          description: 'User feedback triage',
          badgeCount: feedbackAttentionCount,
        },
        { title: t('admin.nav.audit'), href: '/admin/audit', icon: ReceiptText, description: 'Audit logs and approvals' },
      ],
    },
    {
      label: t('admin.nav.system'),
      items: [
        { title: t('admin.nav.settings'), href: '/admin/settings', icon: Shield, description: 'Admin accounts and system switches' },
      ],
    },
  ]

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-background">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <Link to="/admin" search={{}} onClick={onNavigate} className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Settings className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Wemux</span>
            <span className="text-[11px] text-muted-foreground">{t('admin.console')}</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {adminNavGroups.map((group) => (
          <div key={group.label}>
            <h4 className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </h4>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = item.href === '/admin'
                  ? currentPath === '/admin'
                  : currentPath.startsWith(item.href)

                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    params={(current: never) => current}
                    search={(current: never) => current}
                    onClick={onNavigate}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors',
                      isActive
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.badgeCount && item.badgeCount > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {item.badgeCount > 99 ? '99+' : item.badgeCount}
                      </span>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t p-3">
        <Button render={<Link to="/dashboard" search={{}} onClick={onNavigate} />} variant="ghost" size="sm" className="w-full justify-start text-[13px]">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {t('admin.backToDashboard')}
        </Button>
      </div>
    </aside>
  )
}

function AdminBreadcrumbs() {
  const location = useLocation()
  const pathSegments = location.pathname.split('/').filter(Boolean)

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {pathSegments.map((segment, index) => {
        const href = '/' + pathSegments.slice(0, index + 1).join('/')
        const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
        const isLast = index === pathSegments.length - 1
        return (
          <div key={href} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-muted-foreground/50">/</span>}
            <Link
              to={href}
              params={(current: never) => current}
              search={(current: never) => current}
              className={cn(
                'transition-colors',
                isLast ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </Link>
          </div>
        )
      })}
    </nav>
  )
}

function AdminAccessDenied({ reason }: { reason: 'unauthenticated' | 'not-internal' }) {
  const { t } = useTranslation()
  const [adminTheme] = useAdminTheme()
  return (
    <div className={cn('flex min-h-screen items-center justify-center bg-background', adminThemeClass(adminTheme))}>
      <div className="mx-auto max-w-md px-4 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <X className="h-5 w-5 text-destructive" />
        </div>
        <h1 className="mb-1.5 text-xl font-semibold tracking-tight">{t('admin.accessDenied')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {reason === 'unauthenticated'
            ? t('admin.pleaseSignIn')
            : t('admin.accessDeniedDesc')}
        </p>
        <Button render={<Link to={reason === 'unauthenticated' ? '/login' : '/dashboard'} search={{}} />}>
          {reason === 'unauthenticated' ? t('admin.signIn') : t('admin.goToDashboard')}
        </Button>
      </div>
    </div>
  )
}

function AdminLayout() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [adminTheme, toggleAdminTheme] = useAdminTheme()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // 服务器侧 /api/admin/* 以 user.isInternal / user.role 为权威，这里保持一致。
  // 兼容窗口：同时接受新老域名邮箱，后续可移除 @wemux.ai / @vibemux.com
  const isAdmin = Boolean(user?.isInternal)
    || user?.role === 'admin'
    || user?.role === 'owner'
    || user?.email?.endsWith('@wemux.ai')
    || user?.email?.endsWith('@wemux.com')

  if (!user) {
    return <AdminAccessDenied reason="unauthenticated" />
  }

  if (!isAdmin) {
    return <AdminAccessDenied reason="not-internal" />
  }

  return (
    <div className={cn('flex min-h-screen bg-background text-foreground', adminThemeClass(adminTheme))}>
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <AdminSidebar />
      </div>

      {/* Mobile sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <AdminSidebar onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <AdminBreadcrumbs />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleAdminTheme}
              title={adminTheme === 'dark' ? t('theme.toggle') : t('theme.toggle')}
            >
              {adminTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <LanguageSwitcher />
            <Button render={<Link to="/dashboard" search={{}} />} variant="ghost" size="sm">
              {t('admin.exitAdmin')}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

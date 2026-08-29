// [INPUT]: 根路由输入
// [OUTPUT]: 根布局
// [POS]: 根路由
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/// <reference types="vite/client" />
import { isIndexedMarketingPath } from '@shared/site-seo'
import { isDocsPath } from '@shared/docs-content'
import { Navigate, Outlet, createRootRoute, useLocation } from '@tanstack/react-router'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import appCss from '../index.css?url'
import { DefaultCatchBoundary } from '../components/default-catch-boundary'
import { NotFound } from '../components/not-found'
import { MobileBottomNav } from '../components/mobile-bottom-nav'
import { AppDialogProvider } from '../components/ui/app-dialog-provider'
import { AppProvider, useApp } from '../lib/app-provider'
import { AuthProvider, useAuth, type User } from '../lib/auth-context'
import { trackGoogleAnalyticsPageView } from '../lib/analytics'
import { useRealtimeNotifier, useAutoPushSubscription } from '../lib/notifications/notifier'
import { useUserNotificationSettings } from '../lib/use-user-notification-settings'
import { withDevDocumentTitlePrefix } from '../lib/document-title'
import i18n from '../lib/i18n'
import { useTranslation } from '../lib/i18n/react'
import { InboxProvider } from '../lib/inbox-provider'
import { MOBILE_BOTTOM_NAV_VISIBILITY_EVENT } from '../lib/mobile-bottom-nav'
import { isMacNativeClient } from '../lib/native-client'
import { cn } from '../lib/utils'
import { Card } from '../components/ui/card'
import { SidebarInset, SidebarPanel, SidebarProvider, useSidebar } from '../components/ui/sidebar'
import { AppSidebar } from '../components/app-sidebar'
import { SiteHeader } from '../components/site-header'
import { ThemeProvider, useTheme } from '../components/theme-provider'
import { PersistentWorkspaceTerminalProvider } from '../components/workspaces/persistent-workspace-terminal'
import { FloatingAgentChat } from '../components/floating-agent-chat/floating-agent-chat'
import { GlobalSearchPalette } from '../components/global-search/global-search-palette'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#09090b' },
      { name: 'description', content: i18n.t('app.tagline') },
      { title: withDevDocumentTitlePrefix(i18n.t('app.title')) },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.png', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: NotFound,
  component: RootComponent,
})

function RootComponent() {
  return (
    <ThemeProvider>
      <ThemeAwareRoot />
    </ThemeProvider>
  )
}

function ThemeAwareRoot() {
  const { resolvedTheme } = useTheme()
  return (
      <AuthProvider>
        <AppProvider>
          <AppDialogProvider>
            <Toaster
              position="top-center"
              theme={resolvedTheme}
              richColors={false}
              expand={false}
              visibleToasts={4}
              offset={{ top: 64, left: 16, right: 16 }}
              mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 3.75rem)', left: 12, right: 12 }}
              toastOptions={{
                duration: 2600,
                classNames: {
                  toast:
                    'rounded-lg border border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/50',
                  title: 'text-sm font-medium text-zinc-100',
                  description: 'text-xs leading-5 text-zinc-500',
                  closeButton:
                    'border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100',
                  actionButton:
                    'h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200',
                  cancelButton:
                    'h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                },
              }}
            />
            <AppShell />
          </AppDialogProvider>
        </AppProvider>
      </AuthProvider>
  )
}

function AppShell() {
  const { t } = useTranslation()
  const location = useLocation()
  const { loading: authLoading, user } = useAuth()
  const appContext = useApp()
  const pathname = location.pathname
  const isPublicMarketingPage = isIndexedMarketingPath(pathname) || isDocsPath(pathname)
  const isLoginPage = pathname === '/login'
  const isOnboardingPage = pathname === '/onboarding'
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/')
  const isEmbedPage = pathname.startsWith('/embed/')

  useEffect(() => {
    trackGoogleAnalyticsPageView(`${location.pathname}${location.searchStr || ''}`, document.title)
  }, [location.pathname, location.searchStr])

  if (isEmbedPage) {
    return <Outlet />
  }

  if (isPublicMarketingPage || isLoginPage || isOnboardingPage) {
    if (!authLoading && user && (isLoginPage || pathname === '/')) {
      return <Navigate to={resolveAuthenticatedPath(user)} replace />
    }

    return <Outlet />
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="flex items-center gap-3 px-5 py-4">
          <LoaderCircle className="animate-spin" size={20} />
          {t('common.loading')}
        </Card>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user && appContext.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="flex items-center gap-3 px-5 py-4">
          <LoaderCircle className="animate-spin" size={20} />
          {t('app.connecting')}
        </Card>
      </div>
    )
  }

  if (isAdminPage) {
    // Admin 深浅主题由 AdminLayout 内部自管（vibemux-admin-dark/light，默认深色），
    // 与全局 ThemeProvider 解耦，避免 documentElement 的 .dark 串扰。
    return <Outlet />
  }

  return (
    <SidebarProvider>
      <InboxProvider>
        <PersistentWorkspaceTerminalProvider>
          <AppShellFrame />
        </PersistentWorkspaceTerminalProvider>
      </InboxProvider>
    </SidebarProvider>
  )
}

function resolveAuthenticatedPath(user: User) {
  if (user.onboardingCompletedAt || user.onboardingDismissedAt) {
    return '/dashboard'
  }

  return '/onboarding'
}

function AppShellFrame() {
  const location = useLocation()
  const { isMobile } = useSidebar()
  const isMacNative = !isMobile && isMacNativeClient()
  const isDesktopShell = !isMobile
  const [mobileBottomNavHidden, setMobileBottomNavHidden] = useState(false)
  const routeName = location.pathname.split('/').filter(Boolean)[0] || 'home'

  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      const detail = (event as CustomEvent<{ hidden?: boolean }>).detail
      setMobileBottomNavHidden(Boolean(detail?.hidden))
    }

    window.addEventListener(MOBILE_BOTTOM_NAV_VISIBILITY_EVENT, handleVisibilityChange)
    return () => {
      window.removeEventListener(MOBILE_BOTTOM_NAV_VISIBILITY_EVENT, handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (location.pathname !== '/chat') {
      setMobileBottomNavHidden(false)
    }
  }, [location.pathname])

  return (
    <>
      <SidebarPanel>
        <AppSidebar />
      </SidebarPanel>
      <SidebarInset>
        <div
          data-route={routeName}
          className={cn(
            "wemux-app-frame flex h-full min-h-0 w-full flex-col text-zinc-100",
            isMacNative ? "bg-transparent" : "bg-black",
            isMobile && "pt-[env(safe-area-inset-top)]",
          )}
        >
          <SiteHeader />
          <div
            className={cn(
              "wemux-app-content flex flex-1 min-h-0 flex-col",
              isDesktopShell
                ? "overflow-hidden"
                : "bg-black",
              isMobile && !mobileBottomNavHidden && "pb-[var(--mobile-bottom-nav-offset)]",
            )}
          >
            <div className="flex flex-1 min-h-0 flex-col overflow-auto">
              <Outlet />
            </div>
          </div>
        </div>
      </SidebarInset>
      {isMobile ? <MobileBottomNav /> : null}
      <RealtimeNotifierBridge />
      <FloatingAgentChat />
      <GlobalSearchPalette />
    </>
  )
}

/** 全局统一通知矩阵：独立组件避免整个 app shell 随 app state 更新重渲染。 */
function RealtimeNotifierBridge() {
  const { state } = useApp()
  const userNotificationSettings = useUserNotificationSettings()
  useRealtimeNotifier({
    settings: userNotificationSettings,
    tasks: state.tasks,
    workspaceSessions: state.workspaceSessions,
  })
  // feature P3：设置任一浏览器通知开启 + 权限 granted → 自动订阅 Web Push（页面关闭也能收）。
  useAutoPushSubscription(userNotificationSettings)
  return null
}

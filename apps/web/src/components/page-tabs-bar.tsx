import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Circle, GitPullRequest, Inbox, LayoutGrid, MessageCircle, MessageSquare, Workflow, X } from 'lucide-react'
import { Button } from './ui/button'
import { useTranslation } from '../lib/i18n/react'
import { buildWorkspacePageTabId, closePageTab, openPageTab, usePageTabsStore, type PageTab } from '../lib/page-tabs-store'
import { isReviewCenterEnabled } from '../lib/runtime-config'
import { cn } from '../lib/utils'

type PageTabsBarProps = {
  title: string
  nativeTitlebar?: boolean
  /** 落地页预览模式：不写入 store、不导航，由父组件提供标签列表与回调。 */
  previewMode?: boolean
  previewTabs?: PageTab[]
  previewActiveTabId?: string
  onPreviewSelectTab?: (tab: PageTab) => void
  onPreviewCloseTab?: (tab: PageTab) => void
}

const routeIconByPath: Record<string, typeof LayoutGrid> = {
  '/actions': Workflow,
  '/chat': MessageCircle,
  '/inbox': Inbox,
  '/review': GitPullRequest,
  '/workspace': LayoutGrid,
  '/workspaces': LayoutGrid,
}

const isReviewCenterPath = (pathname: string) => pathname === '/review' || pathname === '/actions'

const getTabId = (pathname: string, searchParams: URLSearchParams) => {
  if (pathname === '/workspace' || pathname === '/workspaces') {
    return buildWorkspacePageTabId({
      pathname,
      workspaceId: searchParams.get('workspaceId')?.trim() || undefined,
      taskId: searchParams.get('taskId')?.trim() || undefined,
      workspaceSessionId: searchParams.get('workspaceSessionId')?.trim() || undefined,
      launchId: searchParams.get('launchId')?.trim() || undefined,
    })
  }

  return pathname
}

const buildHref = (pathname: string, searchStr: string) => {
  const normalizedSearch = searchStr.trim()
  return `${pathname}${normalizedSearch.startsWith('?') ? normalizedSearch : normalizedSearch ? `?${normalizedSearch}` : ''}`
}

const getNextTabAfterClose = (tabs: PageTab[], activeTabId: string, closedTabId: string) => {
  if (closedTabId !== activeTabId) {
    return null
  }

  const closedIndex = tabs.findIndex((tab) => tab.id === closedTabId)
  return tabs[closedIndex + 1] ?? tabs[closedIndex - 1] ?? null
}

export function PageTabsBar({
  title,
  nativeTitlebar = false,
  previewMode = false,
  previewTabs,
  previewActiveTabId,
  onPreviewSelectTab,
  onPreviewCloseTab,
}: PageTabsBarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const reviewCenterEnabled = isReviewCenterEnabled()
  const tabs = usePageTabsStore((uiState) => uiState.tabs)
  const searchParams = useMemo(() => new URLSearchParams(location.searchStr || ''), [location.searchStr])
  const activeTabId = previewMode ? (previewActiveTabId ?? '') : getTabId(location.pathname, searchParams)
  const activeHref = buildHref(location.pathname, location.searchStr || '')
  const isWorkspaceScopedPage = location.pathname === '/workspace' || location.pathname === '/workspaces'
  const activeTitle = title

  useEffect(() => {
    if (previewMode) {
      return
    }

    if (isReviewCenterPath(location.pathname) && !reviewCenterEnabled) {
      return
    }

    if (isWorkspaceScopedPage) {
      return
    }

    openPageTab({
      id: activeTabId,
      scope: 'main',
      pathname: location.pathname,
      href: activeHref,
      title: activeTitle,
      subtitle: undefined,
    })
  }, [activeHref, activeTabId, activeTitle, isWorkspaceScopedPage, location.pathname, reviewCenterEnabled])

  const currentTab: PageTab = {
    id: activeTabId,
    scope: isWorkspaceScopedPage ? 'workspace' : 'main',
    pathname: location.pathname,
    href: activeHref,
    title: activeTitle,
    openedAt: Date.now(),
    lastActiveAt: Date.now(),
  }
  const environmentVisibleTabs = reviewCenterEnabled
    ? tabs
    : tabs.filter((tab) => !isReviewCenterPath(tab.pathname))
  const visibleTabs = environmentVisibleTabs.some((tab) => tab.id === activeTabId)
    ? environmentVisibleTabs
    : isReviewCenterPath(location.pathname) && !reviewCenterEnabled
      ? environmentVisibleTabs
      : [...environmentVisibleTabs, currentTab]
  const currentVisibleTabs = previewMode
    ? (previewTabs ?? [])
    : visibleTabs.length > 0
      ? visibleTabs
      : isReviewCenterPath(location.pathname) && !reviewCenterEnabled
        ? []
        : [currentTab]

  const handleSelectTab = (tab: PageTab) => {
    if (tab.id === activeTabId || tab.href === activeHref) {
      return
    }

    if (previewMode) {
      onPreviewSelectTab?.(tab)
      return
    }

    void navigate({ href: tab.href })
  }

  const handleCloseTab = (tab: PageTab) => {
    if (previewMode) {
      onPreviewCloseTab?.(tab)
      return
    }

    const nextTab = getNextTabAfterClose(currentVisibleTabs, activeTabId, tab.id)
    closePageTab(tab.id)

    if (nextTab) {
      void navigate({ href: nextTab.href })
      return
    }

    if (tab.id === activeTabId) {
      void navigate({ to: '/dashboard' })
    }
  }

  return (
    <div
      data-native-drag-region={nativeTitlebar ? 'deep' : undefined}
      className={cn(
        'wemux-page-tabs-scroll flex min-w-0 flex-1 items-center overflow-x-hidden',
        nativeTitlebar || previewMode ? 'gap-0.5 px-0 py-1' : 'gap-1 px-1 py-1',
      )}
      data-tab-count={currentVisibleTabs.length}
      data-tab-density={currentVisibleTabs.length > 4 ? 'crowded' : 'comfortable'}
    >
      {currentVisibleTabs.map((tab) => {
        const selected = tab.id === activeTabId
        const Icon = tab.pathname === '/review' && tab.href.includes('mode=issues')
          ? MessageSquare
          : routeIconByPath[tab.pathname] ?? Circle
        const closable = currentVisibleTabs.length > 1

        return (
          <div
            key={tab.id}
            data-active={selected ? 'true' : 'false'}
            className={cn(
              'wemux-page-tab group flex items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150',
              'h-7',
              selected
                ? 'border-white/[0.08] bg-white/[0.09] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'border-transparent bg-transparent text-zinc-500 hover:border-white/[0.06] hover:bg-white/[0.05] hover:text-zinc-200',
            )}
            title={tab.subtitle ? `${tab.title} · ${tab.subtitle}` : tab.title}
          >
            <button
              type="button"
              onClick={() => handleSelectTab(tab)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              aria-current={selected ? 'page' : undefined}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="wemux-page-tab-title min-w-0 truncate">{tab.title}</span>
            </button>
            {closable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleCloseTab(tab)}
                data-tab-close
                className={cn(
                  'wemux-page-tab-close h-5 w-5 rounded text-zinc-600 hover:bg-zinc-800 hover:text-zinc-100',
                  selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

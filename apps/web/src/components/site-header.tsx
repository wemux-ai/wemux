/**
 * [INPUT]: Current route, application state, mobile actions, and notification inbox.
 * [OUTPUT]: Persistent application header with route title, tabs, and global actions.
 * [POS]: Top-level authenticated shell header.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useState } from "react"
import { useLocation } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { useApp } from "../lib/app-provider"
import { useTranslation } from "../lib/i18n/react"
import { MOBILE_SITE_HEADER_VISIBILITY_EVENT } from "../lib/mobile-bottom-nav"
import { isMacNativeClient } from "../lib/native-client"
import { cn } from "../lib/utils"
import { PageTabsBar } from "./page-tabs-bar"
import { Button } from "./ui/button"
import { useSidebar } from "./ui/sidebar"

export function SiteHeader() {
  const location = useLocation()
  const { t } = useTranslation()
  const { state, selectedProjectId, mobileHeaderActions } = useApp()
  const { isMobile, toggleMobile } = useSidebar()
  const [hidden, setHidden] = useState(false)
  const isMacNative = !isMobile && isMacNativeClient()
  const isDesktopShell = !isMobile
  const path = location.pathname
  const searchParams = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
  const kanbanProjectId = searchParams?.get('projectId')?.trim() || selectedProjectId
  const kanbanProjectName = path === '/kanban'
    ? state.projects.find((project) => project.id === kanbanProjectId)?.name?.trim()
    : ''
  const reviewMode = searchParams?.get('mode')?.trim()
  const isIssuesReviewPage = path === '/review' && (reviewMode === 'issues' || Boolean(searchParams?.get('issueId')))

  const routeTitles: Record<string, string> = {
    "/dashboard": t("nav.dashboard"),
    "/automations": t("nav.automations"),
    "/changelog": t("nav.changelog"),
    "/execution": t("nav.workstationManagement"),
    "/inbox": t("nav.inbox"),
    "/kanban": t("nav.kanban"),
    "/models": t("nav.models"),
    "/mcp": t("nav.mcp"),
    "/skills": t("nav.skills"),
    "/workspaces": t("nav.workspaces"),
    "/workspace": t("nav.workspace"),
    "/teams": t("nav.teams"),
    "/chat": t("nav.projectManagerAgent"),
    "/settings": t("nav.settings"),
    "/agents": t("nav.agents"),
  }

  const title = kanbanProjectName
    || (isIssuesReviewPage ? t("nav.issues") : routeTitles[path])
    || t("app.title")

  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      const detail = (event as CustomEvent<{ hidden?: boolean }>).detail
      setHidden(Boolean(detail?.hidden))
    }

    window.addEventListener(MOBILE_SITE_HEADER_VISIBILITY_EVENT, handleVisibilityChange)
    return () => {
      window.removeEventListener(MOBILE_SITE_HEADER_VISIBILITY_EVENT, handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (path !== '/chat') {
      setHidden(false)
    }
  }, [path])

  if (isMobile && hidden) {
    return null
  }

  return (
    <header
      data-native-drag-region={isMacNative ? 'deep' : undefined}
      className={cn("wemux-shell-header", isMacNative
        ? "sticky top-0 z-20 border-b border-transparent bg-transparent"
        : isDesktopShell
          ? "sticky top-0 z-20 border-b border-transparent bg-transparent"
          : "sticky top-0 z-20 border-b border-transparent bg-transparent")}
    >
      <div
        data-native-drag-region={isMacNative ? 'deep' : undefined}
        className={isDesktopShell ? "flex h-10 items-center gap-2 px-2" : "flex h-12 items-center gap-2 px-3 sm:px-4"}
      >
        {isMobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleMobile}
            className="h-8 w-8 shrink-0 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            aria-label={t("sidebar.openSidebar")}
          >
            <Menu size={15} />
          </Button>
        ) : null}
        {isMobile ? (
          <div className="min-w-0 shrink-0 border-r border-white/[0.08] pr-3">
            <p className="truncate text-sm font-medium text-zinc-100 sm:text-[15px]">
              {title}
            </p>
          </div>
        ) : null}
        {!isMobile ? <PageTabsBar title={title} nativeTitlebar={isMacNative} /> : null}
        {isMobile && mobileHeaderActions ? (
          <div className="ml-2 flex shrink-0 items-center gap-2">
            {mobileHeaderActions}
          </div>
        ) : null}
      </div>
    </header>
  )
}

import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import {
  FolderGit2,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  PlusSquare,
  Settings,
  type LucideIcon,
} from "lucide-react"
import { useApp } from "../lib/app-provider"
import { useTranslation } from "../lib/i18n/react"
import { MOBILE_BOTTOM_NAV_VISIBILITY_EVENT } from "../lib/mobile-bottom-nav"
import { cn } from "../lib/utils"
import { useEffect, useState } from "react"

type MobileNavLinkItem = {
  type: "link"
  icon: LucideIcon
  label: string
  path: string
  search?: Record<string, string | undefined>
}

type MobileNavActionItem = {
  type: "action"
  icon: LucideIcon
  label: string
  onClick: () => void
  active: boolean
}

type MobileNavItem = MobileNavLinkItem | MobileNavActionItem

function isActivePath(currentPath: string, targetPath: string) {
  if (targetPath === "/dashboard") {
    return currentPath === "/dashboard"
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

export function MobileBottomNav() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { selectedProjectId } = useApp()
  const [hidden, setHidden] = useState(false)
  const isCreateTaskOpen =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("createTask") === "1"

  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      const detail = (event as CustomEvent<{ hidden?: boolean }>).detail
      setHidden(Boolean(detail?.hidden))
    }

    window.addEventListener(MOBILE_BOTTOM_NAV_VISIBILITY_EVENT, handleVisibilityChange)
    return () => {
      window.removeEventListener(MOBILE_BOTTOM_NAV_VISIBILITY_EVENT, handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (location.pathname !== "/chat") {
      setHidden(false)
    }
  }, [location.pathname])

  if (hidden) {
    return null
  }

  const items: MobileNavItem[] = [
    { type: "link", icon: LayoutDashboard, label: t('nav.dashboard'), path: "/dashboard" },
    {
      type: "link",
      icon: LayoutGrid,
      label: t('nav.kanban'),
      path: "/kanban",
      search: {
        projectId: selectedProjectId || undefined,
        taskId: undefined,
        createTask: undefined,
      },
    },
    { type: "link", icon: FolderGit2, label: t('nav.workspaces'), path: "/workspaces" },
    { type: "link", icon: MessageCircle, label: t('nav.projectManagerAgent'), path: "/chat" },
    {
      type: "action",
      icon: PlusSquare,
      label: t('sidebar.newTask'),
      active: location.pathname === "/kanban" && isCreateTaskOpen,
      onClick: () =>
        void navigate({
          to: "/kanban",
          search: {
            projectId: selectedProjectId || undefined,
            taskId: undefined,
            createTask: "1",
          },
        }),
    },
    { type: "link", icon: Settings, label: t('nav.settings'), path: "/settings" },
  ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#09090b]/80 px-2 pb-[var(--mobile-bottom-nav-safe-area)] shadow-[0_-12px_32px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-2xl backdrop-saturate-150 md:hidden"
      aria-label={t('mobile.navigation')}
    >
      <div className="grid h-[var(--mobile-bottom-nav-height)] grid-cols-6 gap-1">
        {items.map((item) => {
          if (item.type === "action") {
            const Icon = item.icon

            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium leading-none transition-colors duration-200",
                  item.active
                    ? "bg-emerald-500/18 text-emerald-300"
                    : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          }

          const Icon = item.icon
          const active = isActivePath(location.pathname, item.path)

          return (
            <Link
              key={item.label}
              to={item.path as never}
              search={(item.search ?? {}) as never}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-medium leading-none transition-colors duration-200",
                active
                  ? "bg-white/12 text-zinc-50"
                  : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100",
              )}
            >
              <Icon className={cn("h-4 w-4", active && "stroke-[2.3]")} />
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

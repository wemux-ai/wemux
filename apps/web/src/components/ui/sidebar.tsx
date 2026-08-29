import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { isMacNativeClient } from "../../lib/native-client"
import { cn } from "../../lib/utils"

interface SidebarContextValue {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  isMobile: boolean
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  toggleMobile: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)
const MOBILE_BREAKPOINT = 768
const SIDEBAR_COLLAPSED_STORAGE_KEY = "vibemux.sidebar.collapsed"

function getIsMobile() {
  if (typeof window === "undefined") {
    return false
  }

  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

interface SidebarProviderProps {
  children: React.ReactNode
  defaultCollapsed?: boolean
}

export function SidebarProvider({ children, defaultCollapsed = false }: SidebarProviderProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [isMobile, setIsMobile] = useState(getIsMobile)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isMacNative = !isMobile && isMacNativeClient()

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const storedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
    if (storedCollapsed === null) {
      return
    }

    setCollapsed(storedCollapsed === "1")
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)

      if (!event.matches) {
        setMobileOpen(false)
      }
    }

    setIsMobile(mediaQuery.matches)
    mediaQuery.addEventListener("change", handleChange)

    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0")
  }, [collapsed])

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      isMobile,
      mobileOpen,
      setMobileOpen,
      toggleMobile: () => setMobileOpen((open) => !open),
    }),
    [collapsed, isMobile, mobileOpen],
  )

  return (
    <SidebarContext.Provider value={value}>
      <div className={cn(
        "flex h-screen overflow-hidden text-zinc-100",
        isMacNative
          ? "wemux-native-shell wemux-desktop-shell bg-transparent md:gap-0"
          : isMobile
            ? "wemux-shell-web bg-black"
            : "wemux-desktop-shell wemux-shell-web bg-black md:gap-0",
      )} data-sidebar-collapsed={collapsed}>
        <div className={cn(
          "flex min-h-0 min-w-0 flex-1 overflow-hidden",
          !isMobile && "wemux-desktop-frame",
        )}>
          {children}
        </div>
      </div>
    </SidebarContext.Provider>
  )
}

export function SidebarPanel({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  const isMacNative = isMacNativeClient()

  return (
    <div className={cn(
      "flex min-h-0 flex-1 overflow-hidden",
      isMacNative ? "md:bg-transparent" : "md:bg-black",
    )}>
      {children}
    </div>
  )
}

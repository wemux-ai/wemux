import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { WorkspaceTerminalCommandRequest } from './workspace-terminal-panel'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'

const DEFAULT_DOCK_TERMINAL_HEIGHT = 'min(34vh,420px)'
const DEFAULT_DOCK_TERMINAL_MAX_HEIGHT = 'min(72vh,calc(100vh-8rem))'
const MIN_DOCK_TERMINAL_HEIGHT = 220
const MIN_DOCK_MAIN_CONTENT_HEIGHT = 240

type DesktopWorkspaceTerminalRegistration = {
  registrationId: string
  collapsed: boolean
  cwd?: string
  executorId?: string
  executorName: string
  executorRealtimeBaseUrl?: string
  projectId?: string
  workspaceId?: string
  workspaceName?: string
  installCommand?: string
  startCommand?: string
  logsCommand?: string
  maximized?: boolean
  panelKey: string
  shouldLoadSessions?: boolean
  commandRequest?: WorkspaceTerminalCommandRequest | null
  onCollapsedChange: (collapsed: boolean) => void
  onMaximizedChange?: (maximized: boolean) => void
  onOpenStateChange?: (open: boolean) => void
  onOpenWorkspaceTarget: () => Promise<void>
}

type PersistentWorkspaceTerminalContextValue = {
  activeRegistration: DesktopWorkspaceTerminalRegistration | null
  openPanelKeys: Record<string, boolean>
  registerDesktopWorkspaceTerminal: (registration: DesktopWorkspaceTerminalRegistration) => void
  unregisterDesktopWorkspaceTerminal: (registrationId: string) => void
  isWorkspaceTerminalOpen: (panelKey?: string) => boolean
  setWorkspaceTerminalOpen: (panelKey: string, open: boolean) => void
}

const PersistentWorkspaceTerminalContext = createContext<PersistentWorkspaceTerminalContextValue | null>(null)

const areDesktopWorkspaceTerminalRegistrationsEqual = (
  left: DesktopWorkspaceTerminalRegistration | null,
  right: DesktopWorkspaceTerminalRegistration,
) => {
  return Boolean(
    left
    && left.registrationId === right.registrationId
    && left.collapsed === right.collapsed
    && left.cwd === right.cwd
    && left.executorId === right.executorId
    && left.executorName === right.executorName
    && left.executorRealtimeBaseUrl === right.executorRealtimeBaseUrl
    && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId
    && left.workspaceName === right.workspaceName
    && left.installCommand === right.installCommand
    && left.startCommand === right.startCommand
    && left.logsCommand === right.logsCommand
    && left.maximized === right.maximized
    && left.panelKey === right.panelKey
    && left.shouldLoadSessions === right.shouldLoadSessions
    && left.commandRequest === right.commandRequest
  )
}

export function PersistentWorkspaceTerminalProvider({ children }: { children: ReactNode }) {
  const [activeRegistration, setActiveRegistration] = useState<DesktopWorkspaceTerminalRegistration | null>(null)
  const [openPanelKeys, setOpenPanelKeys] = useState<Record<string, boolean>>({})
  const pendingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pendingClearTimerRef.current) {
        clearTimeout(pendingClearTimerRef.current)
      }
    }
  }, [])

  const registerDesktopWorkspaceTerminal = useCallback((registration: DesktopWorkspaceTerminalRegistration) => {
    if (pendingClearTimerRef.current) {
      clearTimeout(pendingClearTimerRef.current)
      pendingClearTimerRef.current = null
    }

    setActiveRegistration((current) => (
      areDesktopWorkspaceTerminalRegistrationsEqual(current, registration)
        ? current
        : registration
    ))
    if (!registration.collapsed) {
      setOpenPanelKeys((current) => (
        current[registration.panelKey]
          ? current
          : {
              ...current,
              [registration.panelKey]: true,
            }
      ))
    }
  }, [])

  const unregisterDesktopWorkspaceTerminal = useCallback((registrationId: string) => {
    if (pendingClearTimerRef.current) {
      clearTimeout(pendingClearTimerRef.current)
    }

    pendingClearTimerRef.current = setTimeout(() => {
      setActiveRegistration((current) => {
        if (!current || current.registrationId !== registrationId) {
          return current
        }

        return null
      })
      pendingClearTimerRef.current = null
    }, 0)
  }, [])

  const isWorkspaceTerminalOpen = useCallback((panelKey?: string) => {
    return panelKey ? Boolean(openPanelKeys[panelKey]) : false
  }, [openPanelKeys])

  const setWorkspaceTerminalOpen = useCallback((panelKey: string, open: boolean) => {
    setOpenPanelKeys((current) => {
      if (current[panelKey] === open) {
        return current
      }

      return {
        ...current,
        [panelKey]: open,
      }
    })
  }, [])

  const value = useMemo<PersistentWorkspaceTerminalContextValue>(() => ({
    activeRegistration,
    openPanelKeys,
    registerDesktopWorkspaceTerminal,
    unregisterDesktopWorkspaceTerminal,
    isWorkspaceTerminalOpen,
    setWorkspaceTerminalOpen,
  }), [activeRegistration, isWorkspaceTerminalOpen, openPanelKeys, registerDesktopWorkspaceTerminal, setWorkspaceTerminalOpen, unregisterDesktopWorkspaceTerminal])

  return (
    <PersistentWorkspaceTerminalContext.Provider value={value}>
      {children}
    </PersistentWorkspaceTerminalContext.Provider>
  )
}

type DesktopPersistentWorkspaceTerminalOptions = Omit<DesktopWorkspaceTerminalRegistration, 'registrationId'>

export function useDesktopPersistentWorkspaceTerminal(options: DesktopPersistentWorkspaceTerminalOptions | null) {
  const {
    registerDesktopWorkspaceTerminal,
    unregisterDesktopWorkspaceTerminal,
  } = usePersistentWorkspaceTerminalContext()
  const registrationId = useId()

  useEffect(() => {
    if (!options) {
      unregisterDesktopWorkspaceTerminal(registrationId)
      return
    }

    registerDesktopWorkspaceTerminal({
      registrationId,
      ...options,
    })

    return () => {
      unregisterDesktopWorkspaceTerminal(registrationId)
    }
  }, [options, registerDesktopWorkspaceTerminal, registrationId, unregisterDesktopWorkspaceTerminal])
}

export function usePersistentWorkspaceTerminalOpen(panelKey?: string) {
  const context = usePersistentWorkspaceTerminalContext()

  return context.isWorkspaceTerminalOpen(panelKey)
}

export function usePersistentWorkspaceTerminalOpenPanelKeys() {
  const context = usePersistentWorkspaceTerminalContext()

  return context.openPanelKeys
}

export function usePersistentWorkspaceTerminalControl() {
  const context = usePersistentWorkspaceTerminalContext()

  return {
    setWorkspaceTerminalOpen: context.setWorkspaceTerminalOpen,
  }
}

export function PersistentWorkspaceTerminalDock() {
  const { t } = useTranslation()
  const context = usePersistentWorkspaceTerminalContext()
  const registration = context.activeRegistration
  const registrationRef = useRef<DesktopWorkspaceTerminalRegistration | null>(registration)
  const terminalOpen = registration ? context.isWorkspaceTerminalOpen(registration.panelKey) : false
  const dockRootRef = useRef<HTMLDivElement | null>(null)
  const [terminalHeightPx, setTerminalHeightPx] = useState<number | null>(null)
  const [workspaceTerminalPanelComponent, setWorkspaceTerminalPanelComponent] = useState<null | typeof import('./workspace-terminal-panel').WorkspaceTerminalPanel>(null)
  const shouldRenderTerminalPanel = Boolean(registration && (!registration.collapsed || terminalOpen))

  registrationRef.current = registration

  useEffect(() => {
    if (!shouldRenderTerminalPanel || workspaceTerminalPanelComponent) {
      return
    }

    let cancelled = false

    void import('./workspace-terminal-panel').then((mod) => {
      if (!cancelled) {
        setWorkspaceTerminalPanelComponent(() => mod.WorkspaceTerminalPanel)
      }
    })

    return () => {
      cancelled = true
    }
  }, [shouldRenderTerminalPanel, workspaceTerminalPanelComponent])

  const clampTerminalHeight = useCallback((height: number, containerHeight: number) => {
    const maxTerminalHeight = Math.max(
      MIN_DOCK_TERMINAL_HEIGHT,
      Math.min(Math.floor(containerHeight * 0.82), containerHeight - MIN_DOCK_MAIN_CONTENT_HEIGHT),
    )
    return Math.min(Math.max(height, MIN_DOCK_TERMINAL_HEIGHT), maxTerminalHeight)
  }, [])

  useEffect(() => {
    if (registration?.collapsed || registration?.maximized || terminalHeightPx == null) {
      return
    }

    const handleWindowResize = () => {
      const containerHeight = dockRootRef.current?.parentElement?.getBoundingClientRect().height
      if (!containerHeight) {
        return
      }

      setTerminalHeightPx((current) => (
        current == null ? current : clampTerminalHeight(current, containerHeight)
      ))
    }

    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [clampTerminalHeight, registration?.collapsed, registration?.maximized, terminalHeightPx])

  const handleTerminalResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (registration?.collapsed || registration?.maximized) {
      return
    }

    const dockRoot = dockRootRef.current
    const terminalRoot = dockRoot?.querySelector<HTMLElement>('[data-workspace-terminal-root]')
    const containerHeight = dockRoot?.parentElement?.getBoundingClientRect().height
    if (!dockRoot || !terminalRoot || !containerHeight) {
      return
    }

    event.preventDefault()
    const startHeight = terminalRoot.getBoundingClientRect().height
    const startY = event.clientY
    const originalUserSelect = document.body.style.userSelect
    const originalCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight + startY - moveEvent.clientY
      setTerminalHeightPx(clampTerminalHeight(nextHeight, containerHeight))
    }

    const handlePointerUp = () => {
      document.body.style.userSelect = originalUserSelect
      document.body.style.cursor = originalCursor
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [clampTerminalHeight, registration?.collapsed, registration?.maximized])

  const handleCollapsedChange = useCallback((collapsed: boolean) => {
    const current = registrationRef.current
    if (!current) {
      return
    }

    current.onCollapsedChange(collapsed)
  }, [])

  const handleMaximizedChange = useCallback((maximized: boolean) => {
    const current = registrationRef.current
    if (!current) {
      return
    }

    current.onMaximizedChange?.(maximized)
  }, [])

  const handleOpenStateChange = useCallback((open: boolean) => {
    const current = registrationRef.current
    if (!current) {
      return
    }

    context.setWorkspaceTerminalOpen(current.panelKey, open)
    current.onOpenStateChange?.(open)
  }, [context.setWorkspaceTerminalOpen])

  if (!registration) {
    return null
  }

  if (!shouldRenderTerminalPanel) {
    return null
  }

  if (!workspaceTerminalPanelComponent) {
    return null
  }

  const WorkspaceTerminalPanelComponent = workspaceTerminalPanelComponent

  const dockTerminalHeight = registration.collapsed
    ? undefined
    : registration.maximized
      ? DEFAULT_DOCK_TERMINAL_MAX_HEIGHT
      : terminalHeightPx == null
        ? DEFAULT_DOCK_TERMINAL_HEIGHT
        : `${terminalHeightPx}px`

  return (
    <div ref={dockRootRef} className="border-t border-zinc-900/80 bg-[#050506]">
      <div
        className={cn(
          'relative w-full',
          registration.collapsed
            ? 'h-auto'
            : registration.maximized
              ? 'min-h-[320px]'
              : 'min-h-[220px]',
        )}
        style={registration.collapsed ? undefined : { height: dockTerminalHeight }}
      >
        {!registration.collapsed && !registration.maximized ? (
          <button
            type="button"
            aria-label={t('workspace.terminal.resizeHeight', { defaultValue: '调整终端高度' })}
            title={t('workspace.terminal.resizeHeight', { defaultValue: '调整终端高度' })}
            onPointerDown={handleTerminalResizePointerDown}
            onDoubleClick={() => setTerminalHeightPx(null)}
            className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize items-start justify-center bg-transparent focus:outline-none"
          >
            <span className="mt-0 block h-px w-full bg-transparent transition-colors group-hover:bg-cyan-400/70 group-focus-visible:bg-cyan-400" />
          </button>
        ) : null}
        <WorkspaceTerminalPanelComponent
          collapsed={registration.collapsed}
          cwd={registration.cwd}
          executorId={registration.executorId}
          executorName={registration.executorName}
          executorRealtimeBaseUrl={registration.executorRealtimeBaseUrl}
          projectId={registration.projectId}
          workspaceId={registration.workspaceId}
          workspaceName={registration.workspaceName}
          installCommand={registration.installCommand}
          startCommand={registration.startCommand}
          logsCommand={registration.logsCommand}
          maximized={registration.maximized}
          isMobile={false}
          panelKey={registration.panelKey}
          shouldLoadSessions={registration.shouldLoadSessions}
          commandRequest={registration.commandRequest}
          onCollapsedChange={handleCollapsedChange}
          onMaximizedChange={handleMaximizedChange}
          onOpenStateChange={handleOpenStateChange}
          onOpenWorkspaceTarget={registration.onOpenWorkspaceTarget}
        />
      </div>
    </div>
  )
}

function usePersistentWorkspaceTerminalContext() {
  const context = useContext(PersistentWorkspaceTerminalContext)
  if (!context) {
    throw new Error('Persistent workspace terminal hooks must be used within PersistentWorkspaceTerminalProvider')
  }

  return context
}

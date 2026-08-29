/**
 * [INPUT]: Authenticated bootstrap/state-stream snapshots, route scope, and local AppState mutations.
 * [OUTPUT]: Shared application state context with entity reconciliation, resource invalidations, and main-chat histories that survive summarized snapshots (kept lazy when still incomplete).
 * [POS]: Web application state boundary; reconciles partial server snapshots without owning chat execution.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { toast } from 'sonner'
import { hashStatePayload } from '@shared/state-payload-hash'
import { api, getAuthHeaders, resolveApiUrl } from './api'
import { useAuth } from './auth-context'
import { applyWorkspaceSessionUnreadBootstrapSnapshot } from './use-workspace-session-unread-state'
import { initialState } from '../data/mock'
import type { AgentConfig, AppState } from '@shared/types'
import { AppEntityStore } from './app-entity-store'

type AppStateScope = 'default' | 'workspaces' | 'kanban'
type AppStateFocus = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

interface AppContextValue {
  state: AppState
  projectWorkspacesRevision: number
  setState: Dispatch<SetStateAction<AppState>>
  selectedProjectId: string
  setSelectedProjectId: (id: string) => void
  selectedTaskId: string
  setSelectedTaskId: (id: string) => void
  settingsDraft: AgentConfig
  setSettingsDraft: (config: AgentConfig) => void
  loading: boolean
  busy: boolean
  setBusy: (busy: boolean) => void
  mobileHeaderActions: ReactNode | null
  setMobileHeaderActions: Dispatch<SetStateAction<ReactNode | null>>
  runMutation: <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => Promise<T | undefined>
}

const AppContext = createContext<AppContextValue | null>(null)
const RECENT_WORKSPACE_SESSION_TTL_MS = 30_000

const resolveCurrentAppStateScope = (): AppStateScope => {
  if (typeof window === 'undefined') {
    return 'default'
  }

  if (window.location.pathname === '/kanban') {
    return 'kanban'
  }

  return window.location.pathname === '/workspaces' ? 'workspaces' : 'default'
}

const resolveCurrentAppStateFocus = (): AppStateFocus => {
  if (typeof window === 'undefined' || window.location.pathname !== '/workspaces') {
    return {}
  }

  const search = new URLSearchParams(window.location.search)
  const taskId = search.get('taskId')?.trim() || undefined
  const workspaceSessionId = search.get('workspaceSessionId')?.trim() || undefined
  const isWorkspacesRoute = window.location.pathname === '/workspaces'
  return {
    // Session-only runtime IDs may travel through task-addressed chat APIs,
    // but they must never become AppState bootstrap task focus.
    taskId: isWorkspacesRoute || taskId === workspaceSessionId ? undefined : taskId,
    workspaceId: search.get('workspaceId')?.trim() || undefined,
    workspaceSessionId,
  }
}

const buildAppStateFocusKey = (focus: AppStateFocus) => [
  focus.taskId ?? '',
  focus.workspaceId ?? '',
  focus.workspaceSessionId ?? '',
].join('|')

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const existingContext = useContext(AppContext)

  if (existingContext) {
    return <>{children}</>
  }

  return <AppProviderInner>{children}</AppProviderInner>
}

const AppProviderInner = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id
  const appEntityStoreRef = useRef<AppEntityStore | null>(null)
  if (!appEntityStoreRef.current) {
    appEntityStoreRef.current = new AppEntityStore(initialState)
  }
  const [state, setAppState] = useState<AppState>(() => appEntityStoreRef.current!.reconcile(initialState))
  const [projectWorkspacesRevision, setProjectWorkspacesRevision] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState(initialState.selectedProjectId)
  const [selectedTaskId, setSelectedTaskId] = useState(initialState.selectedTaskId)
  const [settingsDraft, setSettingsDraft] = useState<AgentConfig>(initialState.config)
  const [loading, setLoading] = useState(true)
  const [initialBootstrapLoaded, setInitialBootstrapLoaded] = useState(false)
  const [stateScope, setStateScope] = useState<AppStateScope>(() => resolveCurrentAppStateScope())
  const [stateFocus, setStateFocus] = useState<AppStateFocus>(() => resolveCurrentAppStateFocus())
  const [busy, setBusy] = useState(false)
  const [mobileHeaderActions, setMobileHeaderActions] = useState<ReactNode | null>(null)
  const recentLocalWorkspaceSessionIdsRef = useRef<Map<string, number>>(new Map())
  const lastAppliedStateHashRef = useRef('')
  const bootstrapGenerationRef = useRef(0)

  const pruneRecentLocalWorkspaceSessions = (now = Date.now()) => {
    for (const [sessionId, createdAt] of recentLocalWorkspaceSessionIdsRef.current.entries()) {
      if (now - createdAt > RECENT_WORKSPACE_SESSION_TTL_MS) {
        recentLocalWorkspaceSessionIdsRef.current.delete(sessionId)
      }
    }
  }

  const preserveRecentLocalWorkspaceSessions = (previous: AppState, nextState: AppState): AppState => {
    pruneRecentLocalWorkspaceSessions()
    const nextSessionIds = new Set(nextState.workspaceSessions.map((session) => session.id))
    const preservedSessions = previous.workspaceSessions.filter((session) => (
      !nextSessionIds.has(session.id)
      && recentLocalWorkspaceSessionIdsRef.current.has(session.id)
    ))

    if (preservedSessions.length === 0) {
      return nextState
    }

    return {
      ...nextState,
      workspaceSessions: [...preservedSessions, ...nextState.workspaceSessions],
    }
  }

  const preserveRenamedWorkspaceSessionTitles = (previous: AppState, nextState: AppState): AppState => {
    const previousSessionById = new Map(previous.workspaceSessions.map((session) => [session.id, session]))
    let changed = false
    const workspaceSessions = nextState.workspaceSessions.map((session) => {
      const previousSession = previousSessionById.get(session.id)
      if (!previousSession) {
        return session
      }

      const previousTitleOrigin = previousSession.titleOrigin ?? 'system'
      if (previousTitleOrigin !== 'ai' && previousTitleOrigin !== 'manual') {
        return session
      }

      const nextTitleOrigin = session.titleOrigin ?? 'system'
      if (nextTitleOrigin === 'ai' || nextTitleOrigin === 'manual') {
        return session
      }

      changed = true
      return {
        ...session,
        title: previousSession.title,
        titleOrigin: previousTitleOrigin,
      }
    })

    if (!changed) {
      return nextState
    }

    return { ...nextState, workspaceSessions }
  }

  const setState = useCallback<Dispatch<SetStateAction<AppState>>>((nextValue) => {
    setAppState((previous) => {
      const now = Date.now()
      for (const [sessionId, createdAt] of recentLocalWorkspaceSessionIdsRef.current.entries()) {
        if (now - createdAt > RECENT_WORKSPACE_SESSION_TTL_MS) {
          recentLocalWorkspaceSessionIdsRef.current.delete(sessionId)
        }
      }

      const nextState = typeof nextValue === 'function' ? nextValue(previous) : nextValue
      const previousSessionIds = new Set(previous.workspaceSessions.map((session) => session.id))
      const nextSessionIds = new Set(nextState.workspaceSessions.map((session) => session.id))

      for (const session of nextState.workspaceSessions) {
        if (!previousSessionIds.has(session.id)) {
          recentLocalWorkspaceSessionIdsRef.current.set(session.id, now)
        }
      }

      for (const sessionId of recentLocalWorkspaceSessionIdsRef.current.keys()) {
        if (!nextSessionIds.has(sessionId)) {
          recentLocalWorkspaceSessionIdsRef.current.delete(sessionId)
        }
      }

      return appEntityStoreRef.current!.reconcile(nextState)
    })
  }, [])

  const syncSelection = (nextState: AppState) => {
    setSelectedProjectId(
      nextState.projects.some((project) => project.id === nextState.selectedProjectId)
        ? nextState.selectedProjectId
        : nextState.projects[0]?.id ?? '',
    )
    setSelectedTaskId(
      nextState.tasks.some((task) => task.id === nextState.selectedTaskId)
        ? nextState.selectedTaskId
        : nextState.tasks[0]?.id ?? '',
    )
  }

  const applyStateSnapshot = (nextState: AppState, options?: { local?: boolean; stateHash?: string }) => {
    lastAppliedStateHashRef.current = options?.stateHash ?? hashStatePayload(JSON.stringify(nextState))
    if (options?.local) {
      setState(nextState)
    } else {
      setAppState((previous) => appEntityStoreRef.current!.reconcile(
        preserveRenamedWorkspaceSessionTitles(previous, preserveRecentLocalWorkspaceSessions(previous, nextState)),
      ))
    }
    syncSelection(nextState)
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncStateRoute = () => {
      setStateScope(resolveCurrentAppStateScope())
      setStateFocus(resolveCurrentAppStateFocus())
    }
    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState
    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args)
      syncStateRoute()
      return result
    }
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args)
      syncStateRoute()
      return result
    }

    window.addEventListener('popstate', syncStateRoute)
    syncStateRoute()

    return () => {
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.removeEventListener('popstate', syncStateRoute)
    }
  }, [])

  const stateFocusKey = buildAppStateFocusKey(stateFocus)

  useEffect(() => {
    if (authLoading) {
      return
    }

    const generation = ++bootstrapGenerationRef.current
    if (!userId) {
      setInitialBootstrapLoaded(false)
      setLoading(false)
      return
    }

    const abortController = new AbortController()
    const isCurrentRequest = () => (
      !abortController.signal.aborted
      && bootstrapGenerationRef.current === generation
    )

    const loadBootstrap = async () => {
      setInitialBootstrapLoaded(false)

      try {
        const response = await api.bootstrap({
          mainChat: 'summary',
          scope: stateScope,
          ...stateFocus,
          signal: abortController.signal,
        })
        if (!isCurrentRequest()) {
          return
        }
        if (response.workspaceSessionUnreadSnapshot) {
          applyWorkspaceSessionUnreadBootstrapSnapshot(response.workspaceSessionUnreadSnapshot)
        }
        applyStateSnapshot(response.state, { stateHash: response.stateHash })
        setInitialBootstrapLoaded(true)
      } catch (error) {
        if (isCurrentRequest()) {
          toast.error(error instanceof Error ? error.message : '加载数据失败')
        }
      } finally {
        if (isCurrentRequest()) {
          setLoading(false)
        }
      }
    }

    void loadBootstrap()

    return () => abortController.abort()
  }, [authLoading, stateFocusKey, stateScope, userId])

  useEffect(() => {
    if (!userId || !initialBootstrapLoaded) {
      return
    }

    let cancelled = false
    let reconnectTimer: number | null = null
    let abortController: AbortController | null = null

    const applyEvent = (rawEvent: string) => {
      if (cancelled) {
        return
      }

      const lines = rawEvent.split('\n')
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message'
      const data = lines
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')

      if (event === 'invalidate' && data) {
        try {
          const invalidation = JSON.parse(data) as { scope?: string }
          if (invalidation.scope === 'project-workspaces') {
            setProjectWorkspacesRevision((current) => current + 1)
          }
        } catch {}
        return
      }

      if (event !== 'state' || !data) {
        return
      }

      try {
        const nextState = JSON.parse(data) as AppState
        const nextStateHash = hashStatePayload(JSON.stringify(nextState))
        applyStateSnapshot(nextState, { stateHash: nextStateHash })
      } catch {}
    }

    const scheduleReconnect = () => {
      if (cancelled) {
        return
      }

      reconnectTimer = window.setTimeout(() => {
        void connect()
      }, 1500)
    }

    const connect = async () => {
      abortController = new AbortController()

      try {
        const streamUrl = new URL(resolveApiUrl('/api/state/stream'), window.location.origin)
        streamUrl.searchParams.set('mainChat', 'summary')
        if (stateScope !== 'default') {
          streamUrl.searchParams.set('scope', stateScope)
        }
        if (stateFocus.taskId) {
          streamUrl.searchParams.set('taskId', stateFocus.taskId)
        }
        if (stateFocus.workspaceId) {
          streamUrl.searchParams.set('workspaceId', stateFocus.workspaceId)
        }
        if (stateFocus.workspaceSessionId) {
          streamUrl.searchParams.set('workspaceSessionId', stateFocus.workspaceSessionId)
        }
        if (lastAppliedStateHashRef.current) {
          streamUrl.searchParams.set('lastStateHash', lastAppliedStateHashRef.current)
        }

        const response = await fetch(streamUrl.toString(), {
          headers: getAuthHeaders(),
          signal: abortController.signal,
        })

        if (!response.ok || !response.body) {
          throw new Error(`State stream failed: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) {
            buffer += decoder.decode()
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''

          for (const event of events) {
            applyEvent(event)
          }
        }

        if (buffer.trim()) {
          applyEvent(buffer)
        }
      } catch {
        if (!cancelled) {
          try {
            const response = await api.bootstrap({
              mainChat: 'summary',
              scope: stateScope,
              ...stateFocus,
              signal: abortController.signal,
            })
            if (cancelled) {
              return
            }
            if (response.workspaceSessionUnreadSnapshot) {
              applyWorkspaceSessionUnreadBootstrapSnapshot(response.workspaceSessionUnreadSnapshot)
            }
            applyStateSnapshot(response.state, { stateHash: response.stateHash })
          } catch {}
        }
      } finally {
        scheduleReconnect()
      }
    }

    void connect()

    return () => {
      cancelled = true
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }
      abortController?.abort()
    }
  }, [initialBootstrapLoaded, stateFocusKey, stateScope, userId])

  useEffect(() => {
    setSettingsDraft(state.config)
  }, [state.config])

  const applyResponse = (response: { state: AppState; message?: string }) => {
    const nextState = response.state
    applyStateSnapshot(nextState, { local: true })

    if (response.message) {
      toast.success(response.message)
    }
  }

  const runMutation = async <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => {
    setBusy(true)

    try {
      const response = await action()
      applyResponse(response)
      return response
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '请求失败')
      return undefined
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppContext.Provider
      value={{
        state,
        projectWorkspacesRevision,
        setState,
        selectedProjectId,
        setSelectedProjectId,
        selectedTaskId,
        setSelectedTaskId,
        settingsDraft,
        setSettingsDraft,
        loading,
        busy,
        setBusy,
        mobileHeaderActions,
        setMobileHeaderActions,
        runMutation,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const context = useContext(AppContext)

  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }

  return context
}

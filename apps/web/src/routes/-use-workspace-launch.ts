// [INPUT]: Workspace route search, launch state, real task bindings, and chat readiness callbacks.
// [OUTPUT]: Workspace launch restoration and task-bound route normalization effects.
// [POS]: /workspace launch coordinator; workspace session ids are never written as task ids.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AppState, Project, Task, WorkspaceSession, Workspace } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { WorkspaceSessionChatHandle } from '../components/workspaces/workspace-session-chat'
import { api } from '../lib/api'
import {
  WorkspaceLaunchRecord,
  WorkspaceLaunchStatus,
  WorkspaceRouteSearch,
  clearWorkspaceLaunch,
  loadWorkspaceLaunch,
} from './-workspace-route-shared'

type Translate = (key: string, options?: Record<string, unknown>) => string

type Navigate = (options: { to: '/workspace' | '/workspaces'; search: WorkspaceRouteSearch; replace?: boolean }) => Promise<void> | void

type UseWorkspaceLaunchParams = {
  currentWorkspace: Workspace | null
  matchedWorkspaceSession: WorkspaceSession | null
  navigate: Navigate
  project: Project | null
  route: '/workspace' | '/workspaces'
  search: WorkspaceRouteSearch
  selectedWorkspaceSessionId: string
  setState: Dispatch<SetStateAction<AppState>>
  state: AppState
  task: Task | null
  workspaceSession: WorkspaceSession | null
  workspaceSessions: WorkspaceSession[]
  workspaceTask: Task | null
  t: Translate
}

export const useWorkspaceLaunch = ({
  currentWorkspace,
  matchedWorkspaceSession,
  navigate,
  project,
  route,
  search,
  selectedWorkspaceSessionId,
  setState,
  state,
  task,
  workspaceSession,
  workspaceSessions,
  workspaceTask,
  t,
}: UseWorkspaceLaunchParams) => {
  const [launchStatus, setLaunchStatus] = useState<WorkspaceLaunchStatus>(search.launchId ? 'restoring' : 'idle')
  const [launchError, setLaunchError] = useState('')
  const [activeLaunch, setActiveLaunch] = useState<WorkspaceLaunchRecord | null>(null)
  const [launchPrefill, setLaunchPrefill] = useState('')
  const [chatReady, setChatReady] = useState(false)
  const chatRef = useRef<WorkspaceSessionChatHandle | null>(null)
  const chatReadyRef = useRef(false)
  const pendingChatReadyRef = useRef(false)
  const chatReadyUpdateTimerRef = useRef<number | null>(null)
  const sentLaunchIdRef = useRef('')
  const ensuredWorkspaceSessionRef = useRef('')
  const ensuredInitialWorkspaceSessionRef = useRef('')
  const launchProcessingRef = useRef('')

  const launchTask = useMemo(() => {
    if (!activeLaunch) {
      return task
    }

    return state.tasks.find((item) => item.id === activeLaunch.taskId) ?? task
  }, [activeLaunch, state.tasks, task])

  const workspacePreparing = Boolean(activeLaunch) && launchStatus !== 'failed' && launchStatus !== 'done'

  const setChatReadyIfChanged = useCallback((nextReady: boolean) => {
    pendingChatReadyRef.current = nextReady
    if (chatReadyUpdateTimerRef.current !== null) {
      return
    }

    chatReadyUpdateTimerRef.current = window.setTimeout(() => {
      chatReadyUpdateTimerRef.current = null
      const pendingReady = pendingChatReadyRef.current
      if (chatReadyRef.current === pendingReady) {
        return
      }

      chatReadyRef.current = pendingReady
      setChatReady(pendingReady)
    }, 0)
  }, [])

  const handleChatRef = useCallback((instance: WorkspaceSessionChatHandle | null) => {
    chatRef.current = instance
    setChatReadyIfChanged(Boolean(instance))
  }, [setChatReadyIfChanged])

  useEffect(() => {
    return () => {
      if (chatReadyUpdateTimerRef.current !== null) {
        window.clearTimeout(chatReadyUpdateTimerRef.current)
        chatReadyUpdateTimerRef.current = null
      }
    }
  }, [])

  const refreshWorkspaceSessionView = useCallback(async () => {
    await chatRef.current?.refreshSessionView({
      mode: 'replace-latest',
    })
  }, [])

  useEffect(() => {
    if (!search.launchId) {
      setActiveLaunch(null)
      setLaunchStatus('idle')
      setLaunchError('')
      setLaunchPrefill('')
      setChatReadyIfChanged(false)
      launchProcessingRef.current = ''
      return
    }

    const launch = loadWorkspaceLaunch(search.launchId)
    if (!launch) {
      setActiveLaunch(null)
      setLaunchStatus('failed')
      setLaunchError(t('workspace.launch.notFound', { defaultValue: '未找到待恢复的工作区启动事务。' }))
      return
    }

    setActiveLaunch(launch)
    setLaunchStatus('restoring')
    setLaunchError('')
  }, [search.launchId, setChatReadyIfChanged, t])

  useEffect(() => {
    if (!matchedWorkspaceSession || !currentWorkspace) {
      return
    }

    const nextTaskId = workspaceTask?.id || task?.id
    if (search.taskId === nextTaskId) {
      return
    }

    void navigate({
      to: route,
      search: {
        projectId: search.projectId || project?.id,
        taskId: nextTaskId,
        workspaceId: currentWorkspace.id,
        workspaceSessionId: matchedWorkspaceSession.id,
        launchId: search.launchId,
        autoEnvironmentInstall: search.autoEnvironmentInstall,
        panel: search.panel,
        terminal: search.terminal,
        mobileView: search.mobileView,
      },
      replace: true,
    })
  }, [currentWorkspace, matchedWorkspaceSession, navigate, project?.id, route, search.launchId, search.projectId, search.taskId, task?.id, workspaceTask?.id])

  useEffect(() => {
    if (!workspaceTask || !currentWorkspace || workspaceSessions.length > 0) {
      return
    }

    const sessionKey = `${workspaceTask.id}:${currentWorkspace.id}`
    if (ensuredInitialWorkspaceSessionRef.current === sessionKey) {
      return
    }

    ensuredInitialWorkspaceSessionRef.current = sessionKey
    let cancelled = false

    void api.bindTaskWorkspace(workspaceTask.id, currentWorkspace.id, {
      baseBranch: workspaceTask.baseBranch || workspaceTask.baseBranchHint,
    }).then((response) => {
      if (cancelled) {
        return
      }

      setState(response.state)
      const nextWorkspaceSessionId = response.workspaceSessionId ?? response.workspaceSession?.id
      if (!nextWorkspaceSessionId) {
        return
      }

      void navigate({
        to: route,
        search: {
          projectId: project?.id || search.projectId,
          taskId: workspaceTask.id,
          workspaceId: currentWorkspace.id,
          workspaceSessionId: nextWorkspaceSessionId,
          launchId: search.launchId,
          autoEnvironmentInstall: search.autoEnvironmentInstall,
          panel: search.panel,
          terminal: search.terminal,
          mobileView: search.mobileView,
        },
        replace: true,
      })
    }).catch(() => {
      if (!cancelled) {
        ensuredInitialWorkspaceSessionRef.current = ''
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    currentWorkspace,
    navigate,
    project?.id,
    route,
    search.launchId,
    search.projectId,
    setState,
    workspaceSessions.length,
    workspaceTask,
  ])

  useEffect(() => {
    if (!workspaceTask || !currentWorkspace || !workspaceSession) {
      return
    }

    if (workspaceSession.worktreeStatus !== 'planned') {
      return
    }

    const sessionKey = `${workspaceTask.id}:${currentWorkspace.id}:${workspaceSession.worktreeId}`
    if (ensuredWorkspaceSessionRef.current === sessionKey) {
      return
    }

    ensuredWorkspaceSessionRef.current = sessionKey
    let cancelled = false

    void api.ensureTaskWorktree(workspaceTask.id, currentWorkspace.id, workspaceSession.id)
      .then((response) => {
        if (!cancelled) {
          setState(response.state)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [currentWorkspace, setState, workspaceSession, workspaceTask])

  useEffect(() => {
    if (!activeLaunch || !launchTask || !currentWorkspace || currentWorkspace.id !== activeLaunch.workspaceId) {
      return
    }

    if (
      sentLaunchIdRef.current === activeLaunch.launchId
      || launchStatus === 'done'
      || launchStatus === 'sending'
      || launchProcessingRef.current === activeLaunch.launchId
    ) {
      return
    }

    let cancelled = false

    const runLaunch = async () => {
      try {
        const alreadyBound = state.taskWorkspaceBindings.some((binding) => (
          binding.taskId === launchTask.id
          && binding.workspaceId === activeLaunch.workspaceId
          && binding.status === 'active'
        ))
        if (!alreadyBound) {
          setLaunchStatus('binding')
          const response = await api.bindTaskWorkspace(launchTask.id, activeLaunch.workspaceId, {
            baseBranch: activeLaunch.baseBranch,
            workspaceSessionId: search.workspaceSessionId,
          })
          if (cancelled) {
            return
          }
          setState(response.state)
        }

        const existingSession = state.workspaceSessions.find((item) => (
          item.workspaceId === activeLaunch.workspaceId
          && item.status === 'active'
          && (!search.workspaceSessionId || item.id === search.workspaceSessionId)
        ))
        if (existingSession?.worktreeStatus !== 'created') {
          const ensured = await api.ensureTaskWorktree(launchTask.id, activeLaunch.workspaceId, existingSession?.id || search.workspaceSessionId)
          if (cancelled) {
            return
          }
          setState(ensured.state)
        }

        setLaunchStatus('waiting_chat')
      } catch (error) {
        if (cancelled) {
          return
        }
        setLaunchStatus('failed')
        setLaunchError(error instanceof Error ? error.message : t('workspace.launch.prepareFailed', { defaultValue: '工作区启动准备失败' }))
      } finally {
        if (launchProcessingRef.current === activeLaunch.launchId) {
          launchProcessingRef.current = ''
        }
      }
    }

    if (launchStatus === 'restoring' || launchStatus === 'binding') {
      launchProcessingRef.current = activeLaunch.launchId
      void runLaunch()
    }

    return () => {
      cancelled = true
    }
  }, [activeLaunch, currentWorkspace, launchStatus, launchTask, search.workspaceSessionId, setState, state.taskWorkspaceBindings, state.workspaceSessions, t])

  useEffect(() => {
    if (!activeLaunch || !launchTask || !currentWorkspace || currentWorkspace.id !== activeLaunch.workspaceId || launchStatus !== 'waiting_chat') {
      return
    }

    if (!chatReady && !chatRef.current) {
      return
    }

    if (sentLaunchIdRef.current === activeLaunch.launchId) {
      return
    }

    try {
      setLaunchStatus('sending')
      setLaunchPrefill(activeLaunch.initialPrompt)
      sentLaunchIdRef.current = activeLaunch.launchId
      setLaunchStatus('done')
      clearWorkspaceLaunch(activeLaunch.launchId)
      navigate({
        to: route,
        search: {
          projectId: search.projectId,
          taskId: search.taskId,
          workspaceId: search.workspaceId,
          workspaceSessionId: selectedWorkspaceSessionId || search.workspaceSessionId,
          launchId: undefined,
          autoEnvironmentInstall: search.autoEnvironmentInstall,
          panel: search.panel,
          terminal: search.terminal,
          mobileView: search.mobileView,
        },
        replace: true,
      })
    } catch (error) {
      setLaunchStatus('failed')
      setLaunchError(error instanceof Error ? error.message : t('workspace.launch.prefillFailed', { defaultValue: '首条消息预填失败' }))
    }
  }, [
    activeLaunch,
    chatReady,
    currentWorkspace,
    launchStatus,
    launchTask,
    navigate,
    route,
    search.projectId,
    search.taskId,
    search.workspaceId,
    search.workspaceSessionId,
    selectedWorkspaceSessionId,
    t,
  ])

  return {
    activeLaunch,
    chatRef,
    chatReady,
    handleChatRef,
    launchError,
    launchPrefill,
    launchStatus,
    refreshWorkspaceSessionView,
    workspacePreparing,
  }
}

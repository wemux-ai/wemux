import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { sortWorkspaceSessions } from '@shared/task-workspace'
import type { AppState, Project, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { api } from './api'
import { applyTaskPullRequestResult } from './task-pull-request'

const PR_REFRESH_TTL_MS = 90_000
const PR_REFRESH_PASS_COOLDOWN_MS = PR_REFRESH_TTL_MS
const MAX_REFRESH_PER_PASS = 8

type PullRequestRefreshStamp = {
  at: number
  fingerprint: string
}

export type PullRequestRefreshCandidate = {
  taskId: string
  projectId: string
  repoUrl: string
  workspaceId?: string
  workspaceSessionId?: string
  executorNodeId?: string
  fingerprint: string
}

type PullRequestRefreshCandidateParams = {
  projects: Project[]
  tasks: Task[]
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  workspaceSessions: WorkspaceSession[]
  enabledProjectIds?: Set<string>
  enabledTaskIds?: Set<string>
}

export const collectTaskPullRequestRefreshCandidates = (
  params: PullRequestRefreshCandidateParams,
) => {
  const projectById = new Map(params.projects.map((project) => [project.id, project]))
  const activeBindingByTaskId = new Map<string, TaskWorkspaceBinding[]>()
  const activeSessionByWorkspaceId = new Map<string, WorkspaceSession[]>()
  const workspaceSessionById = new Map(params.workspaceSessions.map((session) => [session.id, session]))

  for (const binding of params.taskWorkspaceBindings) {
    if (binding.status !== 'active') {
      continue
    }

    const current = activeBindingByTaskId.get(binding.taskId)
    if (current) {
      current.push(binding)
    } else {
      activeBindingByTaskId.set(binding.taskId, [binding])
    }
  }

  for (const session of params.workspaceSessions) {
    if (session.status !== 'active') {
      continue
    }

    const current = activeSessionByWorkspaceId.get(session.workspaceId)
    if (current) {
      current.push(session)
    } else {
      activeSessionByWorkspaceId.set(session.workspaceId, [session])
    }
  }

  return params.tasks.flatMap((task) => {
    const project = projectById.get(task.projectId)
    if (!project || project.versionControl !== 'git-remote' || !project.gitUrl.trim()) {
      return []
    }

    if (params.enabledProjectIds && !params.enabledProjectIds.has(project.id)) {
      return []
    }

    if (params.enabledTaskIds && !params.enabledTaskIds.has(task.id)) {
      return []
    }

    if (task.agentRunningStatus === 'thinking' || task.agentRunningStatus === 'executing' || task.agentRunningStatus === 'waiting') {
      return []
    }

    const storedWorkspaceSessionId = task.result?.workspaceSessionId?.trim()
    const storedWorkspaceSession = storedWorkspaceSessionId
      ? workspaceSessionById.get(storedWorkspaceSessionId)
      : undefined
    const activeBinding = activeBindingByTaskId.get(task.id)?.[0]
    const workspaceId = storedWorkspaceSession?.workspaceId
      || task.result?.workspaceId?.trim()
      || activeBinding?.workspaceId
    const orderedSessions = workspaceId
      ? sortWorkspaceSessions(activeSessionByWorkspaceId.get(workspaceId) ?? [])
      : []
    const fallbackSession = orderedSessions[0]
    const workspaceSession = storedWorkspaceSession ?? fallbackSession
    const pullRequest = task.result?.delivery?.pullRequest
    const compareBranch = pullRequest?.compareBranch?.trim() || workspaceSession?.branchName?.trim() || ''
    const baseBranch = pullRequest?.baseBranch?.trim() || workspaceSession?.baseBranch?.trim() || task.baseBranch?.trim() || task.baseBranchHint?.trim() || project.defaultBranch?.trim() || ''
    const hasLookupClue = Boolean(compareBranch || pullRequest?.number || pullRequest?.url)
    if (!hasLookupClue) {
      return []
    }

    return [{
      taskId: task.id,
      projectId: project.id,
      repoUrl: project.gitUrl.trim(),
      workspaceId,
      workspaceSessionId: workspaceSession?.id,
      executorNodeId: workspaceSession?.executorNodeId || task.result?.executorNodeId,
      fingerprint: [
        pullRequest?.number ?? '',
        pullRequest?.url ?? '',
        baseBranch,
        compareBranch,
        workspaceSession?.id ?? '',
      ].join('|'),
    }] satisfies PullRequestRefreshCandidate[]
  })
}

export const useAutoRefreshTaskPullRequests = (params: {
  projects: Project[]
  tasks: Task[]
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  workspaceSessions: WorkspaceSession[]
  enabledProjectIds?: Set<string>
  enabledTaskIds?: Set<string>
  setState: Dispatch<SetStateAction<AppState>>
}) => {
  const refreshStampByTaskIdRef = useRef<Map<string, PullRequestRefreshStamp>>(new Map())
  const refreshPassCooldownUntilRef = useRef(0)

  const candidates = useMemo(() => collectTaskPullRequestRefreshCandidates(params), [
    params.enabledProjectIds,
    params.enabledTaskIds,
    params.projects,
    params.taskWorkspaceBindings,
    params.workspaceSessions,
    params.tasks,
  ])

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    if (now < refreshPassCooldownUntilRef.current) {
      return
    }

    const candidateTaskIds = new Set(candidates.map((candidate) => candidate.taskId))
    for (const taskId of refreshStampByTaskIdRef.current.keys()) {
      if (!candidateTaskIds.has(taskId)) {
        refreshStampByTaskIdRef.current.delete(taskId)
      }
    }

    const dueCandidates = candidates
      .map((candidate) => ({
        candidate,
        stamp: refreshStampByTaskIdRef.current.get(candidate.taskId),
      }))
      .filter(({ candidate, stamp }) => (
        !stamp
        || stamp.fingerprint !== candidate.fingerprint
        || now - stamp.at >= PR_REFRESH_TTL_MS
      ))
      .sort((left, right) => (left.stamp?.at ?? 0) - (right.stamp?.at ?? 0))
      .slice(0, MAX_REFRESH_PER_PASS)
      .map(({ candidate }) => candidate)

    if (dueCandidates.length === 0) {
      return
    }

    refreshPassCooldownUntilRef.current = now + PR_REFRESH_PASS_COOLDOWN_MS

    const run = async () => {
      for (const candidate of dueCandidates) {
        refreshStampByTaskIdRef.current.set(candidate.taskId, {
          at: Date.now(),
          fingerprint: candidate.fingerprint,
        })

        try {
          const result = await api.refreshTaskPullRequestStatus(candidate.taskId, {
            workspaceId: candidate.workspaceId,
            workspaceSessionId: candidate.workspaceSessionId,
          })
          if (cancelled || !result.ok) {
            continue
          }

          params.setState((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (
              task.id === candidate.taskId
                ? applyTaskPullRequestResult({
                    task,
                    pullRequest: result,
                    repoUrl: candidate.repoUrl,
                    executorNodeId: candidate.executorNodeId,
                    workspaceId: candidate.workspaceId,
                    workspaceSessionId: candidate.workspaceSessionId,
                  })
                : task
            )),
          }))
        } catch {
          // Ignore background refresh failures and retry after TTL.
        } finally {
          if (!cancelled) {
            refreshStampByTaskIdRef.current.set(candidate.taskId, {
              at: Date.now(),
              fingerprint: candidate.fingerprint,
            })
          }
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [candidates, params.setState])
}

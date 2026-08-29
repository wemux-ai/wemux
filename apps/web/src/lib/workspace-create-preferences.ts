import { isAgentType } from '@shared/agent-type'
import type { Task, Workspace } from '@shared/types'

const WORKSPACE_CREATE_BASE_BRANCH_STORAGE_KEY = 'vibemux.workspaceCreate.lastBaseBranchByProject'
const WORKSPACE_CREATE_RUNTIME_STORAGE_KEY = 'vibemux.workspaceCreate.lastRuntimeByProject'

type WorkspaceCreateRuntimePreference = {
  agentType?: Task['agentType']
  workingDirectoryMode?: Workspace['workingDirectoryMode']
}

const readJsonRecord = (key: string): Record<string, unknown> => {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

const writeJsonRecord = (key: string, value: Record<string, unknown>) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, JSON.stringify(value))
}

export const readWorkspaceCreateBaseBranchPreferences = (): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(readJsonRecord(WORKSPACE_CREATE_BASE_BRANCH_STORAGE_KEY))
      .map(([projectId, branch]) => [projectId.trim(), typeof branch === 'string' ? branch.trim() : ''] as const)
      .filter(([projectId, branch]) => Boolean(projectId && branch)),
  )
}

export const readWorkspaceCreateBaseBranchPreference = (projectId: string) => {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return ''
  }

  return readWorkspaceCreateBaseBranchPreferences()[normalizedProjectId] ?? ''
}

export const writeWorkspaceCreateBaseBranchPreference = (projectId: string, branch: string) => {
  const normalizedProjectId = projectId.trim()
  const normalizedBranch = branch.trim()
  if (!normalizedProjectId || !normalizedBranch) {
    return
  }

  writeJsonRecord(WORKSPACE_CREATE_BASE_BRANCH_STORAGE_KEY, {
    ...readWorkspaceCreateBaseBranchPreferences(),
    [normalizedProjectId]: normalizedBranch,
  })
}

const normalizeRuntimePreference = (value: unknown): WorkspaceCreateRuntimePreference => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const record = value as Record<string, unknown>
  const normalizedAgentType = typeof record.agentType === 'string' ? record.agentType.trim() : undefined
  const agentType = isAgentType(normalizedAgentType)
    ? normalizedAgentType
    : undefined
  const workingDirectoryMode = record.workingDirectoryMode === 'original-dir' || record.workingDirectoryMode === 'worktree'
    ? record.workingDirectoryMode
    : undefined

  return {
    ...(agentType ? { agentType } : {}),
    ...(workingDirectoryMode ? { workingDirectoryMode } : {}),
  }
}

export const readWorkspaceCreateRuntimePreference = (projectId: string): WorkspaceCreateRuntimePreference => {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return {}
  }

  return normalizeRuntimePreference(readJsonRecord(WORKSPACE_CREATE_RUNTIME_STORAGE_KEY)[normalizedProjectId])
}

export const writeWorkspaceCreateRuntimePreference = (
  projectId: string,
  preference: WorkspaceCreateRuntimePreference,
) => {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return
  }

  const nextPreference = normalizeRuntimePreference(preference)
  if (!nextPreference.agentType && !nextPreference.workingDirectoryMode) {
    return
  }

  writeJsonRecord(WORKSPACE_CREATE_RUNTIME_STORAGE_KEY, {
    ...readJsonRecord(WORKSPACE_CREATE_RUNTIME_STORAGE_KEY),
    [normalizedProjectId]: nextPreference,
  })
}

// [INPUT]: 本地 worktree 记录
// [OUTPUT]: 存取
// [POS]: 工作区本地 worktree store
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkspaceSession, WorkspaceLocalWorktree, WorkspaceRecord } from '@shared/types'
import { resolveWorkspaceCodeBaseBranch, resolveWorkspaceCodeBranchName, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import {
  deleteWorkspaceLocalWorktrees,
  getWorkspaceLocalWorktree as getStoredWorkspaceLocalWorktree,
  listWorkspaceLocalWorktrees as listStoredWorkspaceLocalWorktrees,
  saveWorkspaceLocalWorktree as saveStoredWorkspaceLocalWorktree,
} from '../storage/distributed-task-store'

const normalizeOptionalString = (value?: string | null) => value?.trim() || undefined

const buildWorkspaceLocalWorktreeKey = (workspaceId: string, executorNodeId: string) => {
  return `${workspaceId.trim()}:${executorNodeId.trim()}`
}

export const getWorkspaceLocalWorktree = (
  workspaceId: string,
  executorNodeId: string,
) => {
  return getStoredWorkspaceLocalWorktree(workspaceId, executorNodeId)
}

export const listWorkspaceLocalWorktrees = (workspaceId?: string) => {
  return listStoredWorkspaceLocalWorktrees(workspaceId)
}

export const clearWorkspaceLocalWorktreeStore = () => {
  deleteWorkspaceLocalWorktrees()
}

export const saveWorkspaceLocalWorktree = (record: WorkspaceLocalWorktree) => {
  return saveStoredWorkspaceLocalWorktree(record)
}

export const buildWorkspaceLocalWorktreeSnapshot = (params: {
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode' | 'executorNodeId'>
  session: Pick<WorkspaceSession, 'id' | 'baseBranch' | 'branchName' | 'worktreeId' | 'worktreeUniqueId' | 'worktreeStatus' | 'workingDirectoryMode' | 'executorNodeId' | 'runtimeOwnerExecutorId'>
  localPath?: string
  updatedAt?: string
}) => {
  const executorNodeId = resolveWorkspaceWorkerId(params.workspace)
    || normalizeOptionalString(params.session.runtimeOwnerExecutorId)
    || normalizeOptionalString(params.session.executorNodeId)
    || ''
  const timestamp = params.updatedAt ?? new Date().toISOString()
  const codeBaseBranch = resolveWorkspaceCodeBaseBranch(params.workspace, params.session.baseBranch)
  const codeBranchName = resolveWorkspaceCodeBranchName({
    workspace: params.workspace,
    fallbackSession: params.session,
    fallbackBaseBranch: codeBaseBranch,
  })

  return {
    id: buildWorkspaceLocalWorktreeKey(params.workspace.id, executorNodeId),
    workspaceId: params.workspace.id,
    executorNodeId,
    codeBaseBranch,
    codeBranchName,
    workingDirectoryMode: params.workspace.workingDirectoryMode ?? params.session.workingDirectoryMode,
    localPath: normalizeOptionalString(params.localPath),
    worktreeId: params.session.worktreeId,
    worktreeUniqueId: params.session.worktreeUniqueId,
    status: params.session.worktreeStatus,
    sourceWorkspaceSessionId: params.session.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies WorkspaceLocalWorktree
}

export const upsertWorkspaceLocalWorktreeSnapshot = (params: {
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode' | 'executorNodeId'>
  session: Pick<WorkspaceSession, 'id' | 'baseBranch' | 'branchName' | 'worktreeId' | 'worktreeUniqueId' | 'worktreeStatus' | 'workingDirectoryMode' | 'executorNodeId' | 'runtimeOwnerExecutorId'>
  localPath?: string
  updatedAt?: string
}) => {
  const nextRecord = buildWorkspaceLocalWorktreeSnapshot(params)
  const existing = getWorkspaceLocalWorktree(nextRecord.workspaceId, nextRecord.executorNodeId)
  return saveWorkspaceLocalWorktree({
    ...nextRecord,
    createdAt: existing?.createdAt ?? nextRecord.createdAt,
  })
}

export const resolveWorkspaceLocalWorktreeSnapshot = (params: {
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode' | 'executorNodeId'>
  session: Pick<WorkspaceSession, 'id' | 'baseBranch' | 'branchName' | 'worktreeId' | 'worktreeUniqueId' | 'worktreeStatus' | 'workingDirectoryMode' | 'executorNodeId' | 'runtimeOwnerExecutorId'>
  localPath?: string
}) => {
  const executorNodeId = resolveWorkspaceWorkerId(params.workspace)
    || normalizeOptionalString(params.session.runtimeOwnerExecutorId)
    || normalizeOptionalString(params.session.executorNodeId)
    || ''
  return getWorkspaceLocalWorktree(params.workspace.id, executorNodeId)
    ?? buildWorkspaceLocalWorktreeSnapshot(params)
}

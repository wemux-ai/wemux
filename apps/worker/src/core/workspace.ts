// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Worker storage root plus task/workspace identity and an optional canonical session cwd.
// [OUTPUT]: Standard node/user/workspace directories and the execution worktree path.
// [POS]: Worker-local path boundary; workspace-session runs must reuse their canonical cwd.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { getWorkspaceNodeDir, getWorkspaceWorktreeBaseDir, normalizeWorkspaceRoot } from '@shared/workspace-paths'

export const ensureWorkspaceLayout = (workspaceRoot: string) => {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  const nodeDir = getWorkspaceNodeDir(root)
  const layout = {
    root,
    nodeDir,
    nodeRuntimeDir: path.join(nodeDir, 'runtime'),
    nodeCacheDir: path.join(nodeDir, 'cache'),
    usersDir: path.join(root, 'users'),
    workspacesDir: path.join(root, 'workspaces'),
  }

  for (const target of Object.values(layout)) {
    mkdirSync(target, { recursive: true })
  }

  return layout
}

export const getTaskWorktreePath = (
  workspaceRoot: string,
  taskId: string,
  workspaceId?: string,
  userId?: string,
  workspaceSessionPath?: string,
) => {
  if (workspaceId?.trim() && workspaceSessionPath?.trim()) {
    return path.resolve(workspaceSessionPath.trim())
  }

  return path.join(getWorkspaceWorktreeBaseDir(workspaceRoot, workspaceId?.trim() || undefined, userId), taskId)
}

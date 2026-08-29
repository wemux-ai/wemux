import os from 'node:os'
import path from 'node:path'
import type { AgentConfig, Project } from '@shared/types'
import { buildWorkspaceRepoPath, getConfiguredWorkspaceRoot } from '@shared/workspace-paths'

export const expandHomeDir = (rawPath: string) => {
  const trimmed = rawPath.trim()

  if (!trimmed) {
    return ''
  }

  if (trimmed === '~') {
    return os.homedir()
  }

  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }

  return trimmed
}

export const normalizeFilesystemPath = (rawPath: string) => path.resolve(expandHomeDir(rawPath))

export const resolveWorkspaceRootPath = (config?: Pick<AgentConfig, 'workspaceRoot'>) => {
  return normalizeFilesystemPath(getConfiguredWorkspaceRoot(config))
}

export const resolveWorkspaceRepoPath = (
  project: Pick<Project, 'name' | 'gitUrl' | 'createdById'>,
  config?: Pick<AgentConfig, 'workspaceRoot'>,
  workspaceId?: string | null,
  ownerUserId?: string | null,
) => normalizeFilesystemPath(buildWorkspaceRepoPath(
  getConfiguredWorkspaceRoot(config),
  project,
  workspaceId ?? undefined,
  ownerUserId ?? project.createdById,
))

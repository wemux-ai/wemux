// [INPUT]: Agent Home 目录请求
import { getEnv } from '@shared/env'
// [OUTPUT]: 工作目录管理
// [POS]: Agent 工作目录服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  AgentWorkdirStatus,
  ExecutorAgentWorkdirReadResult,
  ExecutorAgentWorkdirFileEntry,
  ExecutorAgentWorkdirSummary,
} from '@shared/types'
import {
  cleanupAgentWorkdirRuntime as cleanupLocalAgentWorkdirRuntime,
  ensureAgentWorkdir as ensureLocalAgentWorkdir,
  ensureAgentWorkdirLayout as ensureLocalAgentWorkdirLayout,
  getAgentWorkdirPaths as getLocalAgentWorkdirPaths,
  getAgentWorkdirSummary as getLocalAgentWorkdirSummary,
  listAgentWorkdirFiles as listLocalAgentWorkdirFiles,
  readAgentWorkdirFileContent as readLocalAgentWorkdirFileContent,
  removeAgentWorkdirFile as removeLocalAgentWorkdirFile,
  resolveAgentWorkdirFile as resolveLocalAgentWorkdirFile,
  touchAgentWorkdirSession as touchLocalAgentWorkdirSession,
} from '@shared/agent-workdir'

export type { AgentWorkdirStatus }
export type AgentWorkdirFileEntry = ExecutorAgentWorkdirFileEntry
export type AgentWorkdirSummary = ExecutorAgentWorkdirSummary
export type AgentWorkdirReadResult = ExecutorAgentWorkdirReadResult

const getAgentHome = () => getEnv('WEMUX_AGENT_HOME')?.trim()

const resolveWorkspaceScope = (workspaceId?: string) => workspaceId?.trim() || undefined

export const getAgentWorkdirPaths = (agentId: string, workspaceId?: string) => {
  return getLocalAgentWorkdirPaths(agentId, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const ensureAgentWorkdirLayout = (agentId: string, workspaceId?: string) => {
  return ensureLocalAgentWorkdirLayout(agentId, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const ensureAgentWorkdir = (agentId: string, workspaceId?: string) => {
  return ensureLocalAgentWorkdir(agentId, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const rescanAgentWorkdir = (agentId: string, workspaceId?: string) => {
  return listLocalAgentWorkdirFiles(agentId, true, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const getAgentWorkdirSummary = (agentId: string, workspaceId?: string) => {
  return getLocalAgentWorkdirSummary(agentId, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const listAgentWorkdirFiles = (agentId: string, refresh = false, workspaceId?: string) => {
  return listLocalAgentWorkdirFiles(agentId, refresh, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const touchAgentWorkdirSession = (agentId: string, sessionId: string, workspaceId?: string) => {
  return touchLocalAgentWorkdirSession(agentId, sessionId, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const cleanupAgentWorkdirRuntime = (agentId: string, workspaceId?: string) => {
  return cleanupLocalAgentWorkdirRuntime(agentId, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const resolveAgentWorkdirFile = (agentId: string, relativePath: string, workspaceId?: string) => {
  return resolveLocalAgentWorkdirFile(agentId, relativePath, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const removeAgentWorkdirFile = (agentId: string, relativePath: string, workspaceId?: string) => {
  return removeLocalAgentWorkdirFile(agentId, relativePath, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

export const readAgentWorkdirFileContent = (agentId: string, relativePath: string, workspaceId?: string) => {
  return readLocalAgentWorkdirFileContent(agentId, relativePath, getAgentHome(), resolveWorkspaceScope(workspaceId))
}

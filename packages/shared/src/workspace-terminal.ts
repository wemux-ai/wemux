// [INPUT]: 终端输入
// [OUTPUT]: 终端契约
// [POS]: 工作区终端类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WorkspaceTerminalSessionScope = 'workspace' | 'executor'

export interface WorkspaceTerminalSessionDescriptor {
  terminalId: string
  terminalKey: string
  scope: WorkspaceTerminalSessionScope
  executorId: string
  workspaceId?: string
  cwd: string
  title: string
  ownerUserId?: string
  createdAt: string
  lastActiveAt: string
  lastAttachAt?: string
  lastDetachAt?: string
  attachCount: number
  clientIds: string[]
  mode?: 'pty' | 'pipe'
  backend?: 'node-pty' | 'python-pty' | 'pipe' | 'zellij'
  persistent?: boolean
  exitedAt?: string
  exitCode?: number
}

export interface WorkspaceTerminalSnapshotChunk {
  stream: 'stdout' | 'stderr' | 'system'
  chunk: string
  at: string
}

export interface WorkspaceTerminalSessionSnapshot {
  session: WorkspaceTerminalSessionDescriptor
  chunks: WorkspaceTerminalSnapshotChunk[]
}

const normalizeKeyPart = (value?: string) => value?.trim() || ''

export const buildWorkspaceTerminalSessionKey = (input: {
  scope: WorkspaceTerminalSessionScope
  executorId: string
  workspaceId?: string
  terminalId: string
}) => {
  return [
    input.scope,
    normalizeKeyPart(input.executorId),
    normalizeKeyPart(input.workspaceId),
    normalizeKeyPart(input.terminalId),
  ].join('::')
}

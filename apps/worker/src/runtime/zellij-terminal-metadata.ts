// [INPUT]: zellij 终端元数据输入
// [OUTPUT]: 终端元数据
// [POS]: zellij 终端元数据
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WorkspaceTerminalSessionScope } from '@shared/types'
import { buildWorkspaceTerminalSessionKey } from '@shared/types'
import { getWorkspaceNodeDir, normalizeWorkspaceRoot } from '@shared/workspace-paths'
import { runCommand } from '../core/command-utils'
import { buildZellijSessionName, resolveZellijSocketDir } from './terminal-session'
import { ensureZellijBinary } from './zellij-binary-manager'

export type ZellijTerminalMetadataRecord = {
  executorId: string
  scope: WorkspaceTerminalSessionScope
  terminalId: string
  workspaceId?: string
  title: string
  cwd: string
  ownerUserId?: string
  createdAt: string
  updatedAt: string
}

const METADATA_FILE_NAME = 'terminal-sessions.json'

const resolveMetadataPath = (workspaceRoot?: string) => {
  return join(getWorkspaceNodeDir(normalizeWorkspaceRoot(workspaceRoot)), 'runtime', 'zellij', METADATA_FILE_NAME)
}

const getMetadataKey = (record: Pick<ZellijTerminalMetadataRecord, 'executorId' | 'scope' | 'workspaceId' | 'terminalId'>) => {
  return buildWorkspaceTerminalSessionKey({
    executorId: record.executorId,
    scope: record.scope,
    workspaceId: record.workspaceId,
    terminalId: record.terminalId,
  })
}

const readMetadata = (workspaceRoot?: string): ZellijTerminalMetadataRecord[] => {
  const metadataPath = resolveMetadataPath(workspaceRoot)
  if (!existsSync(metadataPath)) {
    return []
  }

  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as { sessions?: ZellijTerminalMetadataRecord[] }
    return Array.isArray(parsed.sessions)
      ? parsed.sessions.filter((record) => record && typeof record.executorId === 'string' && typeof record.terminalId === 'string')
      : []
  } catch (error) {
    console.warn('[worker] failed to read zellij terminal metadata', error instanceof Error ? error.message : 'unknown')
    return []
  }
}

const writeMetadata = (workspaceRoot: string | undefined, sessions: ZellijTerminalMetadataRecord[]) => {
  const metadataPath = resolveMetadataPath(workspaceRoot)
  const temporaryPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`
  mkdirSync(dirname(metadataPath), { recursive: true })
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ sessions }, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, metadataPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export const upsertZellijTerminalMetadata = (workspaceRoot: string | undefined, record: Omit<ZellijTerminalMetadataRecord, 'createdAt' | 'updatedAt'>) => {
  const sessions = readMetadata(workspaceRoot)
  const key = getMetadataKey(record)
  const now = new Date().toISOString()
  const existingIndex = sessions.findIndex((item) => getMetadataKey(item) === key)
  const nextRecord: ZellijTerminalMetadataRecord = {
    ...record,
    createdAt: existingIndex >= 0 ? sessions[existingIndex]!.createdAt : now,
    updatedAt: now,
  }
  if (existingIndex >= 0) {
    sessions[existingIndex] = nextRecord
  } else {
    sessions.push(nextRecord)
  }
  writeMetadata(workspaceRoot, sessions)
}

export const removeZellijTerminalMetadata = (
  workspaceRoot: string | undefined,
  record: Pick<ZellijTerminalMetadataRecord, 'executorId' | 'scope' | 'workspaceId' | 'terminalId'>,
) => {
  const key = getMetadataKey(record)
  writeMetadata(workspaceRoot, readMetadata(workspaceRoot).filter((item) => getMetadataKey(item) !== key))
}

export const clearZellijTerminalMetadata = (workspaceRoot: string | undefined, executorId?: string) => {
  const sessions = readMetadata(workspaceRoot)
  writeMetadata(workspaceRoot, executorId ? sessions.filter((item) => item.executorId !== executorId) : [])
}

type LoadRestorableZellijTerminalMetadataOptions = {
  listLiveSessionNames?: (workspaceRoot?: string) => Promise<Set<string>>
}

const listLiveZellijSessionNames = async (workspaceRoot?: string) => {
  const binary = await ensureZellijBinary({ workspaceRoot })
  // Must query the same socket dir the sessions were created in, otherwise
  // list-sessions inspects Zellij's default location, matches nothing, and every
  // persisted terminal gets pruned as unrestorable after a worker restart.
  const socketDir = resolveZellijSocketDir()
  const result = runCommand(binary.binaryPath, ['list-sessions'], {
    timeout: 10000,
    env: socketDir ? { ...process.env, ZELLIJ_SOCKET_DIR: socketDir } : undefined,
  })
  if (!result.ok) {
    throw new Error(result.stderr || result.error || 'Zellij session discovery failed.')
  }
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0] || '')
      .filter(Boolean),
  )
}

export const loadRestorableZellijTerminalMetadata = async (
  workspaceRoot: string | undefined,
  executorId: string,
  options: LoadRestorableZellijTerminalMetadataOptions = {},
) => {
  const records = readMetadata(workspaceRoot).filter((record) => record.executorId === executorId)
  if (records.length === 0) {
    return []
  }

  let liveSessions: Set<string>
  try {
    liveSessions = await (options.listLiveSessionNames ?? listLiveZellijSessionNames)(workspaceRoot)
  } catch (error) {
    console.warn('[worker] failed to discover restorable zellij terminal sessions', error instanceof Error ? error.message : 'unknown')
    return []
  }

  const restorable = records.filter((record) => {
    const terminalKey = getMetadataKey(record)
    return liveSessions.has(buildZellijSessionName(terminalKey, record.cwd))
  })
  if (restorable.length !== records.length) {
    const restorableKeys = new Set(restorable.map(getMetadataKey))
    writeMetadata(workspaceRoot, readMetadata(workspaceRoot).filter((record) => (
      record.executorId !== executorId || restorableKeys.has(getMetadataKey(record))
    )))
  }
  return restorable
}

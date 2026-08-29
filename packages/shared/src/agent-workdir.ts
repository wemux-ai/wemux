// [INPUT]: Agent 工作目录输入
// [OUTPUT]: 目录状态
// [POS]: Agent 工作目录契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import {
  accessSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getEnv } from './env'
import { resolveWemuxHomeDir } from './wemux-home'
import type {
  AgentWorkdirStatus,
  ExecutorAgentWorkdirReadResult,
  ExecutorAgentWorkdirFileEntry,
  ExecutorAgentWorkdirSummary,
} from './types'

type AgentWorkdirManifest = {
  version: number
  agentId: string
  rootPath: string
  workDirPath: string
  status: AgentWorkdirStatus
  storageVersion: number
  snapshotVersion: number
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  lastSessionId?: string
  lastScannedAt?: string
}

type AgentWorkdirSnapshot = {
  version: number
  agentId: string
  scannedAt: string
  files: ExecutorAgentWorkdirFileEntry[]
}

const MANIFEST_VERSION = 1
const SNAPSHOT_VERSION = 1
const MAX_HASH_BYTES = 64 * 1024 * 1024
const MAX_PREVIEW_BYTES = 200 * 1024

export const resolveAgentWorkdirHome = (baseHome?: string) => {
  const normalizedBase = baseHome?.trim()
  return normalizedBase || getEnv('WEMUX_AGENT_HOME')?.trim() || resolveWemuxHomeDir('production')
}

export const normalizePortablePath = (value: string) => {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((part) => part && part !== '.').join('/')
}

const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const sanitizeAgentWorkdirId = (agentId: string) => {
  const trimmed = agentId.trim()
  if (!trimmed) {
    throw new Error('Agent ID 不能为空。')
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

const ensureDir = (targetPath: string) => {
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true })
  }
}

const readJsonFile = <T>(filePath: string): T | null => {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

const writeJsonFile = (filePath: string, payload: unknown) => {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const toIso = (mtimeMs: number) => new Date(mtimeMs).toISOString()

const hashFileIfNeeded = (filePath: string, sizeBytes: number) => {
  if (sizeBytes > MAX_HASH_BYTES) {
    return undefined
  }

  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

const normalizeWorkspaceSegment = (workspaceId?: string) => {
  return workspaceId?.trim()
    ? workspaceId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    : ''
}

export const getAgentWorkdirPaths = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const sanitizedAgentId = sanitizeAgentWorkdirId(agentId)
  const workspaceSegment = normalizeWorkspaceSegment(workspaceId)
  const rootPath = workspaceSegment
    ? path.join(resolveAgentWorkdirHome(baseHome), 'agents', workspaceSegment, sanitizedAgentId)
    : path.join(resolveAgentWorkdirHome(baseHome), 'agents', sanitizedAgentId)
  const workDirPath = path.join(rootPath, 'workdir')
  const systemPath = path.join(rootPath, '.system')
  const manifestPath = path.join(systemPath, 'manifest.json')
  const snapshotsDir = path.join(systemPath, 'snapshots')
  const snapshotPath = path.join(snapshotsDir, 'current.json')
  const sessionsDir = path.join(systemPath, 'sessions')
  const runtimeDir = path.join(systemPath, 'runtime')
  const runtimeTempDir = path.join(runtimeDir, 'temp')
  const logsDir = path.join(systemPath, 'logs')

  return {
    rootPath,
    workDirPath,
    systemPath,
    manifestPath,
    snapshotsDir,
    snapshotPath,
    sessionsDir,
    runtimeDir,
    runtimeTempDir,
    logsDir,
  }
}

const createManifest = (
  agentId: string,
  paths: ReturnType<typeof getAgentWorkdirPaths>,
  current?: AgentWorkdirManifest | null,
): AgentWorkdirManifest => {
  const now = new Date().toISOString()
  return {
    version: MANIFEST_VERSION,
    agentId: agentId.trim(),
    rootPath: paths.rootPath,
    workDirPath: paths.workDirPath,
    status: 'ready',
    storageVersion: MANIFEST_VERSION,
    snapshotVersion: SNAPSHOT_VERSION,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    lastUsedAt: current?.lastUsedAt,
    lastSessionId: current?.lastSessionId,
    lastScannedAt: current?.lastScannedAt,
  }
}

const readManifest = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const paths = getAgentWorkdirPaths(agentId, baseHome, workspaceId)
  return {
    paths,
    manifest: readJsonFile<AgentWorkdirManifest>(paths.manifestPath),
  }
}

const writeManifest = (agentId: string, baseHome?: string, workspaceId?: string, patch?: Partial<AgentWorkdirManifest>) => {
  const { paths, manifest } = readManifest(agentId, baseHome, workspaceId)
  const nextManifest = {
    ...createManifest(agentId, paths, manifest),
    ...patch,
    updatedAt: new Date().toISOString(),
  } satisfies AgentWorkdirManifest
  writeJsonFile(paths.manifestPath, nextManifest)
  return nextManifest
}

const readSnapshot = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const { paths } = readManifest(agentId, baseHome, workspaceId)
  return readJsonFile<AgentWorkdirSnapshot>(paths.snapshotPath)
}

const buildSummary = (
  agentId: string,
  baseHome: string | undefined,
  status: AgentWorkdirStatus,
  manifest?: AgentWorkdirManifest | null,
  snapshot?: AgentWorkdirSnapshot | null,
  workspaceId?: string,
): ExecutorAgentWorkdirSummary => {
  const { paths } = readManifest(agentId, baseHome, workspaceId)
  const entries = snapshot?.files ?? []

  return {
    agentId: agentId.trim(),
    rootPath: paths.rootPath,
    workDirPath: paths.workDirPath,
    systemPath: paths.systemPath,
    status,
    totalFiles: entries.filter((item) => item.type === 'file').length,
    totalDirectories: entries.filter((item) => item.type === 'directory').length,
    totalSizeBytes: entries.filter((item) => item.type === 'file').reduce((sum, item) => sum + item.sizeBytes, 0),
    lastUsedAt: manifest?.lastUsedAt,
    lastSessionId: manifest?.lastSessionId,
    lastScannedAt: manifest?.lastScannedAt ?? snapshot?.scannedAt,
    manifestVersion: manifest?.storageVersion ?? MANIFEST_VERSION,
    snapshotVersion: manifest?.snapshotVersion ?? SNAPSHOT_VERSION,
  }
}

const assertWorkdirReady = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const { paths, manifest } = readManifest(agentId, baseHome, workspaceId)
  if (!existsSync(paths.workDirPath) || !existsSync(paths.systemPath)) {
    return {
      paths,
      manifest,
      summary: buildSummary(agentId, baseHome, 'missing', manifest, readSnapshot(agentId, baseHome, workspaceId), workspaceId),
    }
  }

  try {
    accessSync(paths.workDirPath)
    accessSync(paths.systemPath)
    return {
      paths,
      manifest,
      summary: buildSummary(agentId, baseHome, 'ready', manifest, readSnapshot(agentId, baseHome, workspaceId), workspaceId),
    }
  } catch {
    return {
      paths,
      manifest,
      summary: buildSummary(agentId, baseHome, 'error', manifest, readSnapshot(agentId, baseHome, workspaceId), workspaceId),
    }
  }
}

const walkWorkdir = (workDirPath: string, relativePath = ''): ExecutorAgentWorkdirFileEntry[] => {
  const currentPath = relativePath ? path.join(workDirPath, relativePath) : workDirPath
  const entries = readdirSync(currentPath, { withFileTypes: true })
  const results: ExecutorAgentWorkdirFileEntry[] = []

  for (const entry of entries) {
    const nextRelativePath = normalizePortablePath(path.join(relativePath, entry.name))
    const absolutePath = path.join(currentPath, entry.name)
    const stats = statSync(absolutePath)

    if (entry.isDirectory()) {
      results.push({
        path: nextRelativePath,
        type: 'directory',
        sizeBytes: 0,
        modifiedAt: toIso(stats.mtimeMs),
      })
      results.push(...walkWorkdir(workDirPath, nextRelativePath))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    results.push({
      path: nextRelativePath,
      type: 'file',
      sizeBytes: stats.size,
      modifiedAt: toIso(stats.mtimeMs),
      sha256: hashFileIfNeeded(absolutePath, stats.size),
    })
  }

  return results
}

export const ensureAgentWorkdirLayout = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const paths = getAgentWorkdirPaths(agentId, baseHome, workspaceId)
  ensureDir(paths.rootPath)
  ensureDir(paths.workDirPath)
  ensureDir(paths.systemPath)
  ensureDir(paths.snapshotsDir)
  ensureDir(path.join(paths.snapshotsDir, 'history'))
  ensureDir(paths.sessionsDir)
  ensureDir(paths.runtimeDir)
  ensureDir(paths.runtimeTempDir)
  ensureDir(path.join(paths.runtimeDir, 'locks'))
  ensureDir(paths.logsDir)
  const manifest = writeManifest(agentId, baseHome, workspaceId)
  return {
    summary: buildSummary(agentId, baseHome, 'ready', manifest, readSnapshot(agentId, baseHome, workspaceId), workspaceId),
    files: readSnapshot(agentId, baseHome, workspaceId)?.files ?? [],
  }
}

export const ensureAgentWorkdir = (agentId: string, baseHome?: string, workspaceId?: string) => {
  ensureAgentWorkdirLayout(agentId, baseHome, workspaceId)
  return rescanAgentWorkdir(agentId, baseHome, workspaceId)
}

export const rescanAgentWorkdir = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const { summary } = assertWorkdirReady(agentId, baseHome, workspaceId)
  if (summary.status !== 'ready') {
    return {
      summary,
      files: [] as ExecutorAgentWorkdirFileEntry[],
    }
  }

  const { paths } = readManifest(agentId, baseHome, workspaceId)
  const scannedAt = new Date().toISOString()
  const files = walkWorkdir(paths.workDirPath).sort((left, right) => left.path.localeCompare(right.path))
  writeJsonFile(paths.snapshotPath, {
    version: SNAPSHOT_VERSION,
    agentId: agentId.trim(),
    scannedAt,
    files,
  } satisfies AgentWorkdirSnapshot)
  const manifest = writeManifest(agentId, baseHome, workspaceId, { lastScannedAt: scannedAt, status: 'ready' })
  return {
    summary: buildSummary(agentId, baseHome, 'ready', manifest, { version: SNAPSHOT_VERSION, agentId: agentId.trim(), scannedAt, files }, workspaceId),
    files,
  }
}

export const getAgentWorkdirSummary = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const { manifest, summary } = assertWorkdirReady(agentId, baseHome, workspaceId)
  if (summary.status !== 'ready') {
    return summary
  }

  return buildSummary(agentId, baseHome, 'ready', manifest, readSnapshot(agentId, baseHome, workspaceId))
}

export const listAgentWorkdirFiles = (agentId: string, refresh = false, baseHome?: string, workspaceId?: string) => {
  if (refresh) {
    return rescanAgentWorkdir(agentId, baseHome, workspaceId)
  }

  const summary = getAgentWorkdirSummary(agentId, baseHome, workspaceId)
  return {
    summary,
    files: readSnapshot(agentId, baseHome, workspaceId)?.files ?? [],
  }
}

export const touchAgentWorkdirSession = (agentId: string, sessionId: string, baseHome?: string, workspaceId?: string) => {
  ensureAgentWorkdirLayout(agentId, baseHome, workspaceId)
  const { paths } = readManifest(agentId, baseHome, workspaceId)
  const now = new Date().toISOString()
  writeManifest(agentId, baseHome, workspaceId, {
    lastUsedAt: now,
    lastSessionId: sessionId.trim() || undefined,
  })
  writeJsonFile(path.join(paths.sessionsDir, `${sessionId.trim() || 'session'}.json`), {
    sessionId: sessionId.trim() || 'session',
    cwd: paths.workDirPath,
    lastUsedAt: now,
  })
}

export const cleanupAgentWorkdirRuntime = (agentId: string, baseHome?: string, workspaceId?: string) => {
  const { paths } = readManifest(agentId, baseHome, workspaceId)
  if (existsSync(paths.runtimeTempDir)) {
    for (const entry of readdirSync(paths.runtimeTempDir)) {
      rmSync(path.join(paths.runtimeTempDir, entry), { force: true, recursive: true })
    }
  }

  return getAgentWorkdirSummary(agentId, baseHome)
}

export const resolveAgentWorkdirFile = (agentId: string, relativePath: string, baseHome?: string, workspaceId?: string) => {
  const { summary } = assertWorkdirReady(agentId, baseHome, workspaceId)
  if (summary.status !== 'ready') {
    throw new Error('Agent 工作目录尚未初始化。')
  }

  const normalizedRelativePath = normalizePortablePath(relativePath)
  if (!normalizedRelativePath) {
    throw new Error('文件路径不能为空。')
  }

  const { paths } = readManifest(agentId, baseHome, workspaceId)
  const absolutePath = path.resolve(paths.workDirPath, normalizedRelativePath)
  if (!isPathInsideRoot(paths.workDirPath, absolutePath)) {
    throw new Error('文件路径越界。')
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error('文件不存在。')
  }

  return {
    absolutePath,
    relativePath: normalizedRelativePath,
  }
}

export const removeAgentWorkdirFile = (agentId: string, relativePath: string, baseHome?: string, workspaceId?: string) => {
  const resolved = resolveAgentWorkdirFile(agentId, relativePath, baseHome, workspaceId)
  unlinkSync(resolved.absolutePath)
  return rescanAgentWorkdir(agentId, baseHome, workspaceId)
}

export const readAgentWorkdirFileContent = (agentId: string, relativePath: string, baseHome?: string, workspaceId?: string): ExecutorAgentWorkdirReadResult => {
  try {
    const resolved = resolveAgentWorkdirFile(agentId, relativePath, baseHome, workspaceId)
    const stats = statSync(resolved.absolutePath)
    if (!stats.isFile()) {
      return {
        ok: false,
        relativePath: resolved.relativePath,
        message: '当前路径不是文件。',
      }
    }

    if (stats.size > MAX_PREVIEW_BYTES) {
      return {
        ok: false,
        relativePath: resolved.relativePath,
        sizeBytes: stats.size,
        message: '文件过大，暂不支持预览。',
      }
    }

    const content = readFileSync(resolved.absolutePath)
    if (content.includes(0)) {
      return {
        ok: false,
        relativePath: resolved.relativePath,
        sizeBytes: stats.size,
        message: '暂不支持预览二进制文件。',
      }
    }

    return {
      ok: true,
      relativePath: resolved.relativePath,
      content: content.toString('utf8'),
      sizeBytes: stats.size,
      truncated: false,
    }
  } catch (error) {
    return {
      ok: false,
      relativePath: normalizePortablePath(relativePath),
      message: error instanceof Error ? error.message : '读取文件失败。',
    }
  }
}

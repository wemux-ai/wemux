// [INPUT]: skill 请求（扫描/导入/CRUD）
// [OUTPUT]: 目录管理
// [POS]: skill 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { buildWorkspaceProjectRootPath, buildWorkspaceRepoPath } from '@shared/workspace-paths'
import {
  buildMessageWithSkillMentions,
  filterEnabledSkills,
  filterSkillsForProjectContext,
  isManagedSystemSkill,
  normalizeSkillApprovalMode,
  normalizeSkillScope,
  normalizeSkillSlug,
  type SkillFileContent,
  type SkillFileInventoryEntry,
  type SkillImportResult,
  type SkillRecord,
  type SkillSelectionPolicy,
  type SkillSourceType,
  type SkillTrustLevel,
} from '@shared/skill'
import type { ExecutorSkillPackage, Project } from '@shared/types'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsService } from '../control-plane/executor-ws-service'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG } from '../lib/system-skills'
import { getDefaultUserAgent } from '../repositories/agent'
import { getTeamMemberRole } from '../repositories/auth'
import { auditSkillFiles, type SkillAuditFinding } from '@shared/skill'
import { listSkills, readSkillFile, upsertSkillFromSource } from '../repositories/skill'
import { listProjectBindings, listWorkspaces } from '../storage/distributed-task-store'
import type { SkillScanResult, SkillScanSkipped } from './skill-service-types'

export type { SkillScanResult, SkillScanSkipped } from './skill-service-types'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const readTrimmed = (value: unknown) => {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

const parseSkillSelections = (config: Record<string, unknown> | null | undefined): SkillSelectionPolicy[] => {
  const rawSkills = Array.isArray(config?.skills) ? config.skills : []
  return rawSkills.flatMap<SkillSelectionPolicy>((item, index) => {
    if (typeof item === 'string') {
      const name = item.trim()
      if (!name) {
        return []
      }

      return [{
        id: `skill-${index + 1}`,
        slug: normalizeSkillSlug(name) ?? undefined,
        name,
        enabled: true,
        scope: 'agent',
        approvalMode: 'auto',
        tags: [],
      }]
    }

    if (!isRecord(item)) {
      return []
    }

    const name = readTrimmed(item.name)
    if (!name) {
      return []
    }

    return [{
      id: readTrimmed(item.id) || `skill-${index + 1}`,
      skillId: readTrimmed(item.skillId) || undefined,
      slug: normalizeSkillSlug(readTrimmed(item.slug) || name) ?? undefined,
      name,
      description: readTrimmed(item.description) || undefined,
      enabled: item.enabled !== false,
      scope: normalizeSkillScope(item.scope),
      approvalMode: normalizeSkillApprovalMode(item.approvalMode),
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
        : [],
    }]
  })
}

const matchesSkillSelection = (selection: SkillSelectionPolicy, skill: SkillRecord) => {
  if (selection.skillId && selection.skillId === skill.id) {
    return true
  }

  if (selection.slug && selection.slug === skill.slug) {
    return true
  }

  return normalizeSkillSlug(selection.name) === skill.slug
}

const scopeEnabledForContext = (scope: SkillSelectionPolicy['scope'], projectId?: string, workspaceId?: string) => {
  if (scope === 'workspace') {
    return Boolean(workspaceId)
  }

  if (scope === 'project') {
    return Boolean(projectId)
  }

  return true
}

const isSkillVisibleToUser = (skill: SkillRecord, userId?: string, projectId?: string) => {
  const normalizedUserId = userId?.trim()
  if (!normalizedUserId) {
    return true
  }

  if (skill.sourceType === 'project') {
    return Boolean(projectId && skill.sourceRef === projectId)
  }

  if (!skill.ownerUserId || skill.ownerUserId === normalizedUserId) {
    return true
  }

  const workspaceId = skill.workspaceId?.trim() || ''
  return skill.visibility === 'workspace'
    && Boolean(workspaceId)
    && getTeamMemberRole(workspaceId, normalizedUserId) !== null
}

export const resolveSkillSelections = (
  selections: SkillSelectionPolicy[],
  params?: { projectId?: string; workspaceId?: string; userId?: string },
) => {
  if (selections.length === 0) {
    return []
  }

  const visibleSkills = filterEnabledSkills(listSkills().filter((skill) => isSkillVisibleToUser(skill, params?.userId, params?.projectId)))
  const skills = dedupeRuntimeSkills(visibleSkills, params)
  const resolved: SkillRecord[] = []
  const seen = new Set<string>()
  for (const selection of selections) {
    if (!selection.enabled || !scopeEnabledForContext(selection.scope, params?.projectId, params?.workspaceId)) {
      continue
    }

    const exactSkill = selection.skillId
      ? visibleSkills.find((item) => item.id === selection.skillId) ?? null
      : null
    const skill = exactSkill ?? skills.find((item) => matchesSkillSelection(selection, item))
    if (!skill || seen.has(skill.id)) {
      continue
    }

    seen.add(skill.id)
    resolved.push(skill)
  }

  return resolved
}

const renderSkillMarkdown = (markdown: string) => {
  const compact = markdown.trim()
  if (!compact) {
    return ''
  }

  return compact.length > 3500 ? `${compact.slice(0, 3500)}\n...(已截断)` : compact
}

const IMPORT_SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'])

const IMPORT_TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sh',
  '.py',
  '.rb',
])

type SkillFrontmatter = {
  name?: string
  description?: string
}

type SkillRuntimeContext = {
  projectId?: string
  workspaceId?: string
  userId?: string
}

const normalizePortablePath = (value: string) => {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((part) => part && part !== '.').join('/')
}

const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const parseFrontmatter = (markdown: string): SkillFrontmatter => {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    return {}
  }

  const out: SkillFrontmatter = {}
  for (const line of match[1].split('\n')) {
    const [rawKey, ...rawValue] = line.split(':')
    const key = rawKey.trim().toLowerCase()
    const value = rawValue.join(':').trim().replace(/^"|"$/g, '')
    if (!value) {
      continue
    }

    if (key === 'name') out.name = value
    if (key === 'description') out.description = value
  }

  return out
}

const inferSkillName = (markdown: string, fallbackName: string) => {
  const frontmatter = parseFrontmatter(markdown)
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const name = frontmatter.name?.trim() || heading || fallbackName
  return {
    name,
    description: frontmatter.description?.trim() || null,
  }
}

const inferFileKind = (relativePath: string): SkillFileInventoryEntry['kind'] => {
  const normalized = normalizePortablePath(relativePath)
  if (normalized === 'SKILL.md') return 'skill'
  if (normalized.startsWith('references/')) return 'reference'
  if (normalized.startsWith('scripts/')) return 'script'
  if (normalized.startsWith('assets/')) return 'asset'
  return 'other'
}

const shouldReadSkillFile = (filename: string) => {
  if (filename === 'SKILL.md') {
    return true
  }

  return IMPORT_TEXT_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

const shouldReadBinaryAsset = (relativePath: string) => {
  return inferFileKind(relativePath) === 'asset'
}

const resolveSkillTrustLevel = (inventory: SkillFileInventoryEntry[]): SkillTrustLevel => {
  if (inventory.some((entry) => entry.kind === 'script')) {
    return 'scripts_executables'
  }

  if (inventory.some((entry) => entry.kind === 'asset')) {
    return 'assets'
  }

  return 'markdown_only'
}

const walkSkillDirectories = async (rootPath: string): Promise<string[]> => {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => [])
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    return [rootPath]
  }

  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || IMPORT_SCAN_SKIP_DIRS.has(entry.name)) {
      continue
    }

    found.push(...await walkSkillDirectories(path.join(rootPath, entry.name)))
  }

  return found
}

const readSkillPackageFiles = async (skillDir: string) => {
  const files: Record<string, SkillFileContent> = {}
  const inventory: SkillFileInventoryEntry[] = []

  const visit = async (directoryPath: string) => {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name)
      const relativePath = normalizePortablePath(path.relative(skillDir, absolutePath))

      if (entry.isDirectory()) {
        if (!IMPORT_SCAN_SKIP_DIRS.has(entry.name)) {
          await visit(absolutePath)
        }
        continue
      }

      inventory.push({ path: relativePath, kind: inferFileKind(relativePath) })
      if (shouldReadSkillFile(entry.name)) {
        const content = await readFile(absolutePath, 'utf8').catch(() => null)
        if (typeof content === 'string') {
          files[relativePath] = {
            encoding: 'utf8',
            content,
          }
        }
        continue
      }

      if (!shouldReadBinaryAsset(relativePath)) {
        continue
      }

      const content = await readFile(absolutePath).catch(() => null)
      if (content) {
        files[relativePath] = {
          encoding: 'base64',
          content: content.toString('base64'),
        }
      }
    }
  }

  await visit(skillDir)

  return {
    files,
    inventory: inventory.sort((left, right) => left.path.localeCompare(right.path)),
  }
}

const buildSkillPackage = async (skillDir: string): Promise<{ skill?: ExecutorSkillPackage; warning?: string }> => {
  const markdown = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8').catch(() => null)
  if (!markdown?.trim()) {
    return { warning: `跳过 ${skillDir}：SKILL.md 为空或无法读取。` }
  }

  const meta = inferSkillName(markdown, path.basename(skillDir))
  const { files, inventory } = await readSkillPackageFiles(skillDir)
  return {
    skill: {
      name: meta.name,
      slug: normalizeSkillSlug(meta.name) ?? path.basename(skillDir),
      description: meta.description,
      markdown,
      sourceLocator: skillDir,
      trustLevel: resolveSkillTrustLevel(inventory),
      fileInventory: inventory,
      files,
    },
  }
}

const scanImportedSkillPackages = async (rootPath: string) => {
  const exists = await stat(rootPath).then((value) => value.isDirectory()).catch(() => false)
  if (!exists) {
    throw new Error('导入目录不存在或不是目录。')
  }

  const packages: ExecutorSkillPackage[] = []
  const warnings: string[] = []
  for (const skillDir of await walkSkillDirectories(rootPath)) {
    const { skill, warning } = await buildSkillPackage(skillDir)
    if (warning) {
      warnings.push(warning)
      continue
    }

    if (skill) {
      packages.push(skill)
    }
  }

  packages.sort((left, right) => left.slug.localeCompare(right.slug) || left.sourceLocator.localeCompare(right.sourceLocator))
  return { packages, warnings }
}

const upsertImportedSkills = (params: {
  sourceType: Extract<SkillSourceType, 'git' | 'download'>
  sourceBase: string
  sourceRef?: string | null
  sourceRoot?: string
  packages: ExecutorSkillPackage[]
  warnings: string[]
}): SkillImportResult => {
  const imported: SkillRecord[] = []
  const updated: SkillRecord[] = []
  const auditFindings: SkillAuditFinding[] = []

  for (const skill of params.packages) {
    const findings = auditSkillFiles(skill.files)
    if (findings.some((f) => f.severity === 'error')) {
      params.warnings.push(`跳过 ${skill.name}：安全审计发现高风险问题。`)
      auditFindings.push(...findings)
      continue
    }
    if (findings.length > 0) {
      auditFindings.push(...findings)
    }

    const relativeSource = params.sourceRoot
      ? normalizePortablePath(path.relative(params.sourceRoot, skill.sourceLocator))
      : ''
    const sourceLocator = relativeSource ? `${params.sourceBase}::${relativeSource}` : params.sourceBase
    const upserted = upsertSkillFromSource({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      markdown: skill.markdown,
      sourceType: params.sourceType,
      sourceLocator,
      sourceRef: params.sourceRef ?? null,
      trustLevel: skill.trustLevel,
      compatibility: 'compatible',
      fileInventory: skill.fileInventory,
      files: skill.files,
    })

    if (upserted.action === 'created') {
      imported.push(upserted.skill)
      continue
    }

    updated.push(upserted.skill)
  }

  return {
    sourceType: params.sourceType,
    discovered: params.packages.length,
    imported,
    updated,
    warnings: params.warnings,
    auditFindings: auditFindings.length > 0 ? auditFindings : undefined,
  }
}

const validateGitRemote = (url: string) => {
  const remote = url.trim()
  if (!remote || remote.startsWith('-')) {
    throw new Error('Git 地址无效。')
  }

  if (/^(https?:\/\/|ssh:\/\/|git:\/\/|git@)[^\s]+$/i.test(remote)) {
    return remote
  }

  throw new Error('仅支持 http(s)、ssh、git@ 格式的 Git 地址。')
}

const validateDownloadUrl = (url: string) => {
  const parsed = new URL(url.trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('下载地址仅支持 http(s)。')
  }

  return parsed.toString()
}

const resolveGitImportTarget = (repoRoot: string, subdirectory?: string) => {
  const normalizedSubdirectory = normalizePortablePath(subdirectory ?? '')
  const targetPath = normalizedSubdirectory ? path.resolve(repoRoot, normalizedSubdirectory) : repoRoot
  if (!isPathInsideRoot(repoRoot, targetPath)) {
    throw new Error('Git 子目录不能跳出仓库。')
  }

  return targetPath
}

type ProjectScanTarget = {
  executorId: string
  rootPaths: string[]
}

type PlannedProjectSkillScan = {
  project: Project
  targets: ProjectScanTarget[]
}

const appendProjectScanTarget = (
  targetsByExecutorId: Map<string, Set<string>>,
  executorId: string | undefined,
  rootPaths: Array<string | undefined>,
) => {
  const normalizedExecutorId = executorId?.trim() || ''
  if (!normalizedExecutorId) {
    return
  }

  const bucket = targetsByExecutorId.get(normalizedExecutorId) ?? new Set<string>()
  for (const rootPath of rootPaths) {
    const normalizedRootPath = rootPath?.trim() || ''
    if (normalizedRootPath) {
      bucket.add(normalizedRootPath)
    }
  }
  targetsByExecutorId.set(normalizedExecutorId, bucket)
}

const resolveProjectScanFallbackPaths = (project: Project, workspaceRoot?: string, workspaceId?: string, ownerUserId?: string) => {
  const rootPath = project.rootPath?.trim() || ''
  const projectRootPath = workspaceRoot?.trim()
    ? buildWorkspaceProjectRootPath(workspaceRoot, project, workspaceId, ownerUserId)
    : ''
  const repoRootPath = workspaceRoot?.trim() && project.versionControl !== 'none'
    ? buildWorkspaceRepoPath(workspaceRoot, project, workspaceId, ownerUserId)
    : ''

  return Array.from(new Set([
    rootPath,
    projectRootPath,
    repoRootPath,
  ].filter(Boolean)))
}

const resolveExecutorBindingLocalPaths = (project: Project, executorId: string) => {
  const projectId = project.id.trim()
  const gitUrl = project.gitUrl.trim()

  return executorRegistry.getProjectBindings(executorId)
    .filter((binding) => {
      const bindingProjectId = binding.projectId?.trim() || ''
      const bindingRepoUrl = binding.repoUrl?.trim() || ''
      if (bindingProjectId && bindingProjectId === projectId) {
        return true
      }

      return Boolean(gitUrl && bindingRepoUrl && bindingRepoUrl === gitUrl)
    })
    .map((binding) => binding.localPath.trim())
    .filter(Boolean)
}

const collectProjectScanTargets = (
  project: Project,
  extraTargets?: Array<{ executorId?: string; rootPath?: string }>,
  userId?: string,
  preferredExecutorId?: string,
) => {
  const targetsByExecutorId = new Map<string, Set<string>>()
  const visibleExecutors = userId?.trim() ? listVisibleExecutorsForUser(userId.trim()) : executorRegistry.listExecutorsWithPresence()
  const executorById = new Map(visibleExecutors.map((executor) => [executor.executorId, executor]))
  const normalizedPreferredExecutorId = preferredExecutorId?.trim() || ''

  for (const binding of listProjectBindings().filter((item) => item.projectId === project.id && item.isActive)) {
    if (normalizedPreferredExecutorId && binding.nodeId !== normalizedPreferredExecutorId) {
      continue
    }
    const executor = executorById.get(binding.nodeId) ?? executorRegistry.getExecutor(binding.nodeId)
    appendProjectScanTarget(
      targetsByExecutorId,
      binding.nodeId,
      [...resolveExecutorBindingLocalPaths(project, binding.nodeId), binding.pathHint, ...resolveProjectScanFallbackPaths(project, executor?.workspaceRoot, undefined, userId)],
    )
  }

  for (const workspace of listWorkspaces().filter((item) => item.projectId === project.id)) {
    if (normalizedPreferredExecutorId && workspace.executorNodeId !== normalizedPreferredExecutorId) {
      continue
    }
    const executor = executorById.get(workspace.executorNodeId) ?? executorRegistry.getExecutor(workspace.executorNodeId)
    appendProjectScanTarget(
      targetsByExecutorId,
      workspace.executorNodeId,
      [...resolveExecutorBindingLocalPaths(project, workspace.executorNodeId), workspace.repoPath, ...resolveProjectScanFallbackPaths(project, executor?.workspaceRoot, workspace.id, workspace.ownerUserId ?? userId)],
    )
  }

  for (const target of extraTargets ?? []) {
    const normalizedExecutorId = target.executorId?.trim() || ''
    if (normalizedPreferredExecutorId && normalizedExecutorId && normalizedExecutorId !== normalizedPreferredExecutorId) {
      continue
    }
    const executor = normalizedExecutorId
      ? (executorById.get(normalizedExecutorId) ?? executorRegistry.getExecutor(normalizedExecutorId))
      : null
    appendProjectScanTarget(
      targetsByExecutorId,
      normalizedExecutorId,
      [...resolveExecutorBindingLocalPaths(project, normalizedExecutorId), target.rootPath, ...resolveProjectScanFallbackPaths(project, executor?.workspaceRoot, undefined, userId)],
    )
  }

  const fallbackExecutorId = normalizedPreferredExecutorId || project.preferredExecutorId?.trim() || ''
  if (fallbackExecutorId) {
    const executor = executorById.get(fallbackExecutorId) ?? executorRegistry.getExecutor(fallbackExecutorId)
    appendProjectScanTarget(
      targetsByExecutorId,
      fallbackExecutorId,
      [...resolveExecutorBindingLocalPaths(project, fallbackExecutorId), ...resolveProjectScanFallbackPaths(project, executor?.workspaceRoot, undefined, userId)],
    )
  }

  return Array.from(targetsByExecutorId.entries()).map(([executorId, rootPaths]) => ({
    executorId,
    rootPaths: Array.from(rootPaths),
  }))
}

const isRelativePathInsideRoot = (rootPath: string, targetPath: string) => {
  const relativePath = path.relative(rootPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const buildProjectScannedSkillSourceLocator = (projectId: string, rootPath: string, sourceLocator: string) => {
  const normalizedProjectId = projectId.trim()
  const normalizedRootPath = rootPath.trim()
  const normalizedSourceLocator = sourceLocator.trim()
  if (!normalizedProjectId || !normalizedRootPath || !normalizedSourceLocator) {
    return normalizedSourceLocator
  }

  const relativeSourceLocator = isRelativePathInsideRoot(normalizedRootPath, normalizedSourceLocator)
    ? normalizePortablePath(path.relative(normalizedRootPath, normalizedSourceLocator))
    : ''

  return relativeSourceLocator
    ? `project:${normalizedProjectId}:${relativeSourceLocator}`
    : normalizedSourceLocator
}

const buildGlobalSkillSourceLocator = (userId: string | undefined, executorId: string, sourceLocator: string) => {
  const normalizedUserId = userId?.trim() || 'anonymous'
  return `global:${normalizedUserId}:${executorId}:${sourceLocator}`
}

const upsertScannedSkill = (projectId: string, rootPath: string, skill: ExecutorSkillPackage) => {
  return upsertSkillFromSource({
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    markdown: skill.markdown,
    sourceType: 'project',
    sourceLocator: buildProjectScannedSkillSourceLocator(projectId, rootPath, skill.sourceLocator),
    sourceRef: projectId,
    trustLevel: skill.trustLevel,
    compatibility: 'compatible',
    fileInventory: skill.fileInventory,
    files: skill.files,
  })
}

const upsertGlobalScannedSkill = (userId: string | undefined, executorId: string, skill: ExecutorSkillPackage) => {
  return upsertSkillFromSource({
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    markdown: skill.markdown,
    sourceType: 'manual',
    visibility: 'private',
    ownerUserId: null,
    workspaceId: null,
    sourceLocator: buildGlobalSkillSourceLocator(userId, executorId, skill.sourceLocator),
    sourceRef: executorId,
    trustLevel: skill.trustLevel,
    compatibility: 'compatible',
    fileInventory: skill.fileInventory,
    files: skill.files,
  })
}

export const resolvePrimaryAgentSkills = (params?: { projectId?: string; workspaceId?: string; userId?: string }) => {
  const defaultAgent = params?.userId ? getDefaultUserAgent(params.userId) : null
  return resolveSkillSelections(parseSkillSelections(defaultAgent?.config), params)
}

const dedupeSkillsById = (skills: SkillRecord[]) => {
  const seen = new Set<string>()
  return skills.filter((skill) => {
    if (seen.has(skill.id)) {
      return false
    }

    seen.add(skill.id)
    return true
  })
}

const getSkillTimestamp = (value: string) => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

const buildRuntimeSkillPriority = (
  skill: SkillRecord,
  params?: {
    projectId?: string
    workspaceId?: string
    preferredSkillIds?: ReadonlySet<string>
  },
) => {
  let priority = 0
  if (params?.preferredSkillIds?.has(skill.id)) {
    priority += 1000
  }

  if (skill.sourceType === 'project' && params?.projectId && skill.sourceRef === params.projectId) {
    priority += 400
  } else if (skill.visibility === 'workspace' && params?.workspaceId && skill.workspaceId === params.workspaceId) {
    priority += 300
  } else if (isManagedSystemSkill(skill)) {
    priority += 100
  } else {
    priority += 200
  }

  return priority
}

const shouldReplaceRuntimeSkill = (
  current: SkillRecord,
  next: SkillRecord,
  params?: {
    projectId?: string
    workspaceId?: string
    preferredSkillIds?: ReadonlySet<string>
  },
) => {
  const currentIsRequiredAgentOps = isManagedSystemSkill(current)
    && normalizeSkillSlug(current.slug) === VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG
  const nextIsRequiredAgentOps = isManagedSystemSkill(next)
    && normalizeSkillSlug(next.slug) === VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG
  if (currentIsRequiredAgentOps !== nextIsRequiredAgentOps) {
    return nextIsRequiredAgentOps
  }

  const currentPriority = buildRuntimeSkillPriority(current, params)
  const nextPriority = buildRuntimeSkillPriority(next, params)
  if (nextPriority !== currentPriority) {
    return nextPriority > currentPriority
  }

  const currentUpdatedAt = getSkillTimestamp(current.updatedAt)
  const nextUpdatedAt = getSkillTimestamp(next.updatedAt)
  if (nextUpdatedAt !== currentUpdatedAt) {
    return nextUpdatedAt > currentUpdatedAt
  }

  return next.createdAt > current.createdAt
}

export const dedupeRuntimeSkills = (
  skills: SkillRecord[],
  params?: {
    projectId?: string
    workspaceId?: string
    preferredSkillIds?: ReadonlySet<string>
  },
) => {
  const deduped = new Map<string, { skill: SkillRecord; index: number }>()

  skills.forEach((skill, index) => {
    const key = normalizeSkillSlug(skill.slug) ?? skill.id
    const current = deduped.get(key)
    if (!current) {
      deduped.set(key, { skill, index })
      return
    }

    if (shouldReplaceRuntimeSkill(current.skill, skill, params)) {
      deduped.set(key, { skill, index })
    }
  })

  return Array.from(deduped.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.skill)
}

const dedupeRuntimeSkillsPreservingOrder = (skills: SkillRecord[]) => {
  const seen = new Set<string>()
  return skills.filter((skill) => {
    const key = normalizeSkillSlug(skill.slug) ?? skill.id
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export const resolveRuntimeSkills = (params?: SkillRuntimeContext) => {
  const visibleSkills = dedupeRuntimeSkills(
    filterEnabledSkills(listSkills().filter((skill) => isSkillVisibleToUser(skill, params?.userId, params?.projectId))),
    params,
  )
  const contextSkills = filterSkillsForProjectContext(visibleSkills, params?.projectId)
  const selectedSkills = resolvePrimaryAgentSkills(params)
  return dedupeRuntimeSkills(
    dedupeSkillsById([...selectedSkills, ...contextSkills]),
    {
      ...params,
      preferredSkillIds: new Set(selectedSkills.map((skill) => skill.id)),
    },
  )
}

export const resolveRuntimeSkillPackages = (params?: SkillRuntimeContext): ExecutorSkillPackage[] => {
  return buildRuntimeSkillPackagesFromSkills(resolveRuntimeSkills(params))
}

export const buildRuntimeSkillPackagesFromSkills = (skills: SkillRecord[]): ExecutorSkillPackage[] => {
  return dedupeRuntimeSkillsPreservingOrder(skills).map((skill) => {
    const files = skill.fileInventory.reduce<Record<string, SkillFileContent>>((result, entry) => {
      const file = readSkillFile(skill.id, entry.path)
      if (file) {
        result[file.path] = {
          encoding: file.encoding,
          content: file.content,
        }
      }

      return result
    }, {})

    files['SKILL.md'] = files['SKILL.md'] ?? {
      encoding: 'utf8',
      content: skill.markdown,
    }

    return {
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      markdown: skill.markdown,
      sourceLocator: skill.sourceLocator ?? `vibemux://skills/${skill.id}`,
      trustLevel: skill.trustLevel,
      fileInventory: skill.fileInventory,
      files,
    }
  })
}

export const prependRequiredAgentOpsSkillMention = (message: string, skills: SkillRecord[]) => {
  const normalizedMessage = message.trim()
  const requiredMention = `@${VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG}`
  const hasRequiredAgentOps = skills.some((skill) => (
    normalizeSkillSlug(skill.slug) === VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG
    && isManagedSystemSkill(skill)
  ))

  return hasRequiredAgentOps && !normalizedMessage.includes(requiredMention)
    ? `${requiredMention}\n${normalizedMessage}`
    : normalizedMessage
}

export const buildMessageWithRuntimeSkillMentions = (message: string, params?: SkillRuntimeContext) => {
  const skills = resolveRuntimeSkills(params)
  return prependRequiredAgentOpsSkillMention(buildMessageWithSkillMentions(message, skills), skills)
}

export const renderSkillInstructions = (skills: SkillRecord[], title = '已启用 Skills') => {
  if (skills.length === 0) {
    return ''
  }

  return [
    `${title}：以下是当前会话必须优先复用的技能说明，若与一般习惯冲突，优先遵守这些技能内容。`,
    ...skills.map((skill) => [
      '',
      `## ${skill.name} (${skill.slug})`,
      skill.description ? `简介：${skill.description}` : null,
      renderSkillMarkdown(skill.markdown),
    ].filter((item): item is string => Boolean(item)).join('\n')),
  ].join('\n')
}

export const renderSkillAvailability = (skills: SkillRecord[], title = '可用 Skills') => {
  if (skills.length === 0) {
    return ''
  }

  return [
    `${title}：以下 skills 当前可用。先快速判断当前任务是否与其中某个 skill 高度相关；若相关，请主动读取最相关的 1-2 个 SKILL.md 与附加文件并按其执行。若不相关，则不要展开 skill 内容。`,
    ...skills.map((skill) => {
      return `- ${skill.name} (@${skill.slug})${skill.description ? `：${skill.description}` : ''}`
    }),
  ].join('\n')
}

export const buildExecutionDescriptionWithSkills = (description: string, skills: SkillRecord[]) => {
  // Coding runtimes already receive mounted skill directories at execution time.
  // Avoid duplicating SKILL.md content inside the task prompt itself.
  return prependRequiredAgentOpsSkillMention(description, skills)
}

export const importSkillsFromGit = async (params: {
  url: string
  ref?: string
  subdirectory?: string
}): Promise<SkillImportResult> => {
  const remote = validateGitRemote(params.url)
  const ref = params.ref?.trim() || ''
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-skill-import-'))

  try {
    await simpleGit().clone(remote, tempDir, ref ? [] : ['--depth', '1'])
    if (ref) {
      await simpleGit(tempDir).checkout(ref)
    }

    const targetPath = resolveGitImportTarget(tempDir, params.subdirectory)
    const { packages, warnings } = await scanImportedSkillPackages(targetPath)
    if (packages.length === 0) {
      throw new Error('未发现 SKILL.md，请确认仓库或子目录里包含 skill 包。')
    }

    return upsertImportedSkills({
      sourceType: 'git',
      sourceBase: `${remote}${ref ? `#${ref}` : ''}`,
      sourceRef: ref || null,
      sourceRoot: targetPath,
      packages,
      warnings,
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export const importSkillFromDownload = async (params: {
  url: string
}): Promise<SkillImportResult> => {
  const url = validateDownloadUrl(params.url)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/') && !contentType.includes('markdown') && !url.toLowerCase().endsWith('.md')) {
    throw new Error('当前下载导入仅支持原始 SKILL.md / Markdown 文本地址。仓库型 skill 请使用 Git 导入。')
  }

  const markdown = await response.text()
  if (!markdown.trim()) {
    throw new Error('下载的 SKILL.md 为空。')
  }

  const fallbackName = path.basename(new URL(url).pathname, path.extname(new URL(url).pathname)) || 'downloaded-skill'
  const meta = inferSkillName(markdown, fallbackName)
  return upsertImportedSkills({
    sourceType: 'download',
    sourceBase: url,
    packages: [{
      name: meta.name,
      slug: normalizeSkillSlug(meta.name) ?? normalizeSkillSlug(fallbackName) ?? 'downloaded-skill',
      description: meta.description,
      markdown,
      sourceLocator: url,
      trustLevel: 'markdown_only',
      fileInventory: [{ path: 'SKILL.md', kind: 'skill' }],
      files: {
        'SKILL.md': {
          encoding: 'utf8',
          content: markdown,
        },
      },
    }],
    warnings: [],
  })
}

const scanPlannedProjectSkills = async (plans: PlannedProjectSkillScan[]): Promise<SkillScanResult> => {
  const imported: SkillRecord[] = []
  const updated: SkillRecord[] = []
  const skipped: SkillScanSkipped[] = []
  const warnings: string[] = []
  let discovered = 0

  for (const { project, targets: projectTargets } of plans) {
    if (projectTargets.length === 0) {
      skipped.push({
        subjectId: project.id,
        subjectName: project.name,
        subjectType: 'project',
        attemptedPaths: [],
        executorId: null,
        executorName: null,
        path: null,
        reason: '没有可扫描的执行节点仓库路径。',
      })
      continue
    }

    const onlineTargets = projectTargets.filter((target) => executorRegistry.getExecutor(target.executorId)?.status === 'online')
    if (onlineTargets.length === 0) {
      const firstTarget = projectTargets[0]
      skipped.push({
        subjectId: project.id,
        subjectName: project.name,
        subjectType: 'project',
        attemptedPaths: firstTarget?.rootPaths ?? [],
        executorId: firstTarget?.executorId ?? null,
        executorName: firstTarget ? (executorRegistry.getExecutor(firstTarget.executorId)?.name ?? firstTarget.executorId) : null,
        path: firstTarget?.rootPaths[0] ?? null,
        reason: '没有可用的在线执行节点可执行 skills 扫描。',
      })
      continue
    }

    let projectDiscovered = 0
    let projectHasReadableScan = false

    for (const target of onlineTargets) {
      const candidatePaths = target.rootPaths.filter((rootPath) => rootPath.trim())
      if (candidatePaths.length === 0) {
        skipped.push({
          subjectId: project.id,
          subjectName: project.name,
          subjectType: 'project',
          attemptedPaths: [],
          executorId: target.executorId,
          executorName: executorRegistry.getExecutor(target.executorId)?.name ?? target.executorId,
          path: null,
          reason: '执行节点缺少可扫描的仓库路径。',
        })
        continue
      }

      let matchedResult: Awaited<ReturnType<typeof executorWsService.requestSkillScan>> | null = null
      let readableEmptyResult: Awaited<ReturnType<typeof executorWsService.requestSkillScan>> | null = null
      let lastFailure: { path: string; reason: string } | null = null

      for (const rootPath of candidatePaths) {
        const result = await executorWsService.requestSkillScan(target.executorId, {
          scanMode: 'project',
          rootPath,
        }).catch((error) => {
          lastFailure = {
            path: rootPath,
            reason: error instanceof Error ? error.message : '执行节点扫描失败。',
          }
          return null
        })

        if (!result) {
          continue
        }

        if (!result.ok) {
          lastFailure = {
            path: rootPath,
            reason: result.message || '执行节点拒绝扫描该目录。',
          }
          continue
        }

        if (result.packages.length === 0) {
          readableEmptyResult = readableEmptyResult ?? result
          continue
        }

        matchedResult = result
        break
      }

      matchedResult = matchedResult ?? readableEmptyResult

      if (!matchedResult) {
        skipped.push({
          subjectId: project.id,
          subjectName: project.name,
          subjectType: 'project',
          attemptedPaths: candidatePaths,
          executorId: target.executorId,
          executorName: executorRegistry.getExecutor(target.executorId)?.name ?? target.executorId,
          path: lastFailure?.path ?? candidatePaths[0] ?? null,
          reason: lastFailure?.reason || '执行节点扫描失败。',
        })
        continue
      }

      warnings.push(...matchedResult.warnings.map((warning) => `[${project.name}] ${warning}`))
      projectHasReadableScan = true

      for (const skill of matchedResult.packages) {
        discovered += 1
        projectDiscovered += 1
        const upserted = upsertScannedSkill(project.id, matchedResult.rootPath, skill)
        if (upserted.action === 'created') {
          imported.push(upserted.skill)
          continue
        }

        updated.push(upserted.skill)
      }
    }

    if (projectDiscovered === 0 && projectHasReadableScan) {
      const firstOnlineTarget = onlineTargets[0]
      skipped.push({
        subjectId: project.id,
        subjectName: project.name,
        subjectType: 'project',
        attemptedPaths: firstOnlineTarget?.rootPaths ?? [],
        executorId: firstOnlineTarget?.executorId ?? null,
        executorName: firstOnlineTarget ? (executorRegistry.getExecutor(firstOnlineTarget.executorId)?.name ?? firstOnlineTarget.executorId) : null,
        path: firstOnlineTarget?.rootPaths[0] ?? null,
        reason: '未发现 SKILL.md。',
      })
    }
  }

  return {
    scope: 'project',
    scannedProjects: plans.length,
    scannedExecutors: 0,
    discovered,
    imported,
    updated,
    skipped,
    warnings,
  }
}

export const scanGlobalSkills = async (
  userId?: string,
  options?: { preferredExecutorId?: string },
): Promise<SkillScanResult> => {
  const imported: SkillRecord[] = []
  const updated: SkillRecord[] = []
  const skipped: SkillScanSkipped[] = []
  const warnings: string[] = []
  const visibleExecutors = userId?.trim() ? listVisibleExecutorsForUser(userId.trim()) : executorRegistry.listExecutorsWithPresence()
  const normalizedPreferredExecutorId = options?.preferredExecutorId?.trim() || ''
  const targets = visibleExecutors.filter((executor) => {
    return !normalizedPreferredExecutorId || executor.executorId === normalizedPreferredExecutorId
  })
  let discovered = 0

  if (targets.length === 0) {
    return {
      scope: 'global',
      scannedProjects: 0,
      scannedExecutors: 0,
      discovered: 0,
      imported: [],
      updated: [],
      skipped: normalizedPreferredExecutorId
        ? [{
            subjectId: normalizedPreferredExecutorId,
            subjectName: normalizedPreferredExecutorId,
            subjectType: 'executor',
            executorId: normalizedPreferredExecutorId,
            executorName: normalizedPreferredExecutorId,
            path: null,
            reason: '未找到可扫描的执行器。',
          }]
        : [],
      warnings: normalizedPreferredExecutorId ? [] : ['当前没有可见的执行器可执行全局 Skill 扫描。'],
    }
  }

  for (const executor of targets) {
    if (executor.status !== 'online') {
      skipped.push({
        subjectId: executor.executorId,
        subjectName: executor.name,
        subjectType: 'executor',
        executorId: executor.executorId,
        executorName: executor.name,
        path: null,
        reason: '执行器当前不在线，无法扫描全局 Skill 目录。',
      })
      continue
    }

    const result = await executorWsService.requestSkillScan(executor.executorId, {
      scanMode: 'global',
    }).catch((error) => {
      skipped.push({
        subjectId: executor.executorId,
        subjectName: executor.name,
        subjectType: 'executor',
        attemptedPaths: [],
        executorId: executor.executorId,
        executorName: executor.name,
        path: null,
        reason: error instanceof Error ? error.message : '执行器扫描失败。',
      })
      return null
    })

    if (!result) {
      continue
    }

    if (!result.ok) {
      skipped.push({
        subjectId: executor.executorId,
        subjectName: executor.name,
        subjectType: 'executor',
        attemptedPaths: result.scannedRoots,
        executorId: executor.executorId,
        executorName: executor.name,
        path: result.rootPath || result.scannedRoots[0] || null,
        reason: result.message || '执行器扫描失败。',
      })
      continue
    }

    warnings.push(...result.warnings.map((warning) => `[${executor.name}] ${warning}`))

    if (result.packages.length === 0) {
      skipped.push({
        subjectId: executor.executorId,
        subjectName: executor.name,
        subjectType: 'executor',
        attemptedPaths: result.scannedRoots,
        executorId: executor.executorId,
        executorName: executor.name,
        path: result.scannedRoots[0] ?? result.rootPath ?? null,
        reason: '未发现全局 SKILL.md。',
      })
      continue
    }

    for (const skill of result.packages) {
      discovered += 1
      const upserted = upsertGlobalScannedSkill(userId, executor.executorId, skill)
      if (upserted.action === 'created') {
        imported.push(upserted.skill)
        continue
      }

      updated.push(upserted.skill)
    }
  }

  return {
    scope: 'global',
    scannedProjects: 0,
    scannedExecutors: targets.length,
    discovered,
    imported,
    updated,
    skipped,
    warnings,
  }
}

export const scanProjectSkills = async (
  projects: Project[],
  userId?: string,
  options?: { preferredExecutorId?: string },
): Promise<SkillScanResult> => {
  return scanPlannedProjectSkills(projects.map((project) => ({
    project,
    targets: collectProjectScanTargets(project, undefined, userId, options?.preferredExecutorId),
  })))
}

import { desc, eq, inArray, max } from 'drizzle-orm'

import type {
  SkillCompatibility,
  SkillFileContent,
  SkillFileDetail,
  SkillFileEncoding,
  SkillFileInventoryEntry,
  SkillFileKind,
  SkillRecord,
  SkillSourceType,
  SkillTrustLevel,
} from '@shared/skill'
import type { WorkspaceResourceVisibility } from '@shared/workspace-scope'
import { normalizeSkillSlug } from '@shared/skill'
import { getSystemSkillDefinitions } from '../../lib/system-skills'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { skills, skillVersions } from './schema'

type StoredSkill = SkillRecord & {
  files: Record<string, SkillFileContent>
  categories: string[]
}

type SkillRow = typeof skills.$inferSelect

type SaveSkillInput = {
  name: string
  slug?: string | null
  description?: string | null
  markdown: string
  sourceType?: SkillSourceType
  enabled?: boolean
  visibility?: WorkspaceResourceVisibility
  ownerUserId?: string | null
  workspaceId?: string | null
  sourceLocator?: string | null
  sourceRef?: string | null
  trustLevel?: SkillTrustLevel
  compatibility?: SkillCompatibility
  fileInventory?: SkillFileInventoryEntry[]
  files?: Record<string, SkillFileContent | string>
  categories?: string[]
}

type CloneWorkspaceSkillsInput = {
  ownerUserId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
}

type CloneSkillToWorkspaceInput = {
  skillId: string
  ownerUserId: string
  targetWorkspaceId: string
}

export class SkillSlugConflictError extends Error {
  slug: string

  constructor(message: string, slug: string) {
    super(message)
    this.name = 'SkillSlugConflictError'
    this.slug = slug
  }
}

const cache = {
  skills: [] as StoredSkill[],
}

const normalizePortablePath = (value: string) => {
  const parts: string[] = []
  for (const segment of value.replace(/\\/g, '/').replace(/^\/+/, '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0) {
        parts.pop()
      }
      continue
    }
    parts.push(segment)
  }

  return parts.join('/')
}

const inferSkillFileKind = (filePath: string): SkillFileKind => {
  const normalized = normalizePortablePath(filePath).toLowerCase()
  if (normalized === 'skill.md') {
    return 'skill'
  }

  if (normalized.startsWith('references/')) {
    return 'reference'
  }

  if (normalized.startsWith('scripts/')) {
    return 'script'
  }

  if (normalized.startsWith('assets/')) {
    return 'asset'
  }

  return 'other'
}

const normalizeSkillFileContent = (value: SkillFileContent | string | null | undefined): SkillFileContent | null => {
  if (typeof value === 'string') {
    return {
      encoding: 'utf8',
      content: value,
    }
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const encoding = value.encoding === 'base64' ? 'base64' : 'utf8'
  if (typeof value.content !== 'string') {
    return null
  }

  return {
    encoding,
    content: value.content,
  }
}

const normalizeFileInventory = (files: Record<string, SkillFileContent>, inventory?: SkillFileInventoryEntry[]) => {
  const next = new Map<string, SkillFileInventoryEntry>()
  for (const entry of inventory ?? []) {
    const path = normalizePortablePath(entry.path)
    if (!path) {
      continue
    }

    next.set(path, {
      path,
      kind: entry.kind,
    })
  }

  for (const path of Object.keys(files)) {
    const normalized = normalizePortablePath(path)
    if (!normalized) {
      continue
    }

    next.set(normalized, {
      path: normalized,
      kind: inferSkillFileKind(normalized),
    })
  }

  if (!next.has('SKILL.md')) {
    next.set('SKILL.md', {
      path: 'SKILL.md',
      kind: 'skill',
    })
  }

  return [...next.values()].sort((left, right) => left.path.localeCompare(right.path))
}

const normalizeFiles = (markdown: string, files?: Record<string, SkillFileContent | string>) => {
  const next: Record<string, SkillFileContent> = {}
  for (const [rawPath, content] of Object.entries(files ?? {})) {
    const path = normalizePortablePath(rawPath)
    if (!path) {
      continue
    }

    const normalizedContent = normalizeSkillFileContent(content)
    if (!normalizedContent) {
      continue
    }

    next[path] = normalizedContent
  }

  next['SKILL.md'] = {
    encoding: 'utf8',
    content: markdown,
  }
  return next
}

const buildSkillScopeKey = (skill: Pick<StoredSkill, 'sourceType' | 'visibility' | 'workspaceId' | 'ownerUserId' | 'sourceRef'>) => {
  if (skill.sourceType === 'project') {
    return `project:${skill.sourceRef?.trim() || 'unknown'}`
  }

  if (skill.visibility === 'workspace') {
    return `workspace:${skill.workspaceId?.trim() || 'unknown'}`
  }

  return `global:${skill.ownerUserId?.trim() || 'shared'}`
}

const buildSkillScopeSlugKey = (skill: Pick<StoredSkill, 'sourceType' | 'visibility' | 'workspaceId' | 'ownerUserId' | 'sourceRef' | 'slug'>) => {
  return `${buildSkillScopeKey(skill)}:${skill.slug.trim().toLowerCase()}`
}

const findSkillByScopeSlug = (skill: Pick<StoredSkill, 'sourceType' | 'visibility' | 'workspaceId' | 'ownerUserId' | 'sourceRef' | 'slug'>, excludeId?: string | null) => {
  const scopeSlugKey = buildSkillScopeSlugKey(skill)
  return cache.skills.find((candidate) => {
    return candidate.id !== excludeId
      && buildSkillScopeSlugKey(candidate) === scopeSlugKey
  }) ?? null
}

const buildSkillSlugConflictMessage = (skill: Pick<StoredSkill, 'sourceType' | 'visibility' | 'slug'>) => {
  if (skill.sourceType === 'project') {
    return `当前项目已存在同名 Skill（slug: ${skill.slug}）。请调整 skill 名称，避免项目内重复。`
  }

  if (skill.visibility === 'workspace') {
    return `当前组织已存在同名 Skill（slug: ${skill.slug}）。请修改名称或 slug。`
  }

  return `当前范围内已存在同名 Skill（slug: ${skill.slug}）。请修改名称或 slug。`
}

const toStoredSkill = (row: SkillRow): StoredSkill => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  enabled: row.enabled !== false,
  markdown: row.markdown,
  sourceType: row.sourceType,
  visibility: row.visibility ?? 'private',
  ownerUserId: row.ownerUserId,
  workspaceId: row.workspaceId,
  sourceLocator: row.sourceLocator,
  sourceRef: row.sourceRef,
  trustLevel: row.trustLevel,
  compatibility: row.compatibility,
  fileInventory: cloneJson(row.fileInventoryJson ?? []),
  files: normalizeFiles(row.markdown, cloneJson(row.filesJson ?? {})),
  categories: Array.isArray(row.categoriesJson) ? row.categoriesJson : [],
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toPublicSkill = (skill: StoredSkill): SkillRecord => ({
  id: skill.id,
  slug: skill.slug,
  name: skill.name,
  description: skill.description,
  enabled: skill.enabled,
  markdown: skill.markdown,
  sourceType: skill.sourceType,
  visibility: skill.visibility,
  ownerUserId: skill.ownerUserId,
  workspaceId: skill.workspaceId,
  sourceLocator: skill.sourceLocator,
  sourceRef: skill.sourceRef,
  trustLevel: skill.trustLevel,
  compatibility: skill.compatibility,
  fileInventory: cloneJson(skill.fileInventory),
  categories: [...skill.categories],
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
})

const normalizeCategories = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 24)
}

const persistSkill = async (skill: StoredSkill) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(skills)
    .values({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      markdown: skill.markdown,
      sourceType: skill.sourceType,
      enabled: skill.enabled,
      visibility: skill.visibility,
      ownerUserId: skill.ownerUserId,
      workspaceId: skill.workspaceId,
      sourceLocator: skill.sourceLocator,
      sourceRef: skill.sourceRef,
      trustLevel: skill.trustLevel,
      compatibility: skill.compatibility,
      fileInventoryJson: skill.fileInventory,
      filesJson: skill.files,
      categoriesJson: skill.categories,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    })
    .onConflictDoUpdate({
      target: skills.id,
      set: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        markdown: skill.markdown,
        sourceType: skill.sourceType,
        enabled: skill.enabled,
        visibility: skill.visibility,
        ownerUserId: skill.ownerUserId,
        workspaceId: skill.workspaceId,
        sourceLocator: skill.sourceLocator,
        sourceRef: skill.sourceRef,
        trustLevel: skill.trustLevel,
        compatibility: skill.compatibility,
        fileInventoryJson: skill.fileInventory,
        filesJson: skill.files,
        categoriesJson: skill.categories,
        updatedAt: skill.updatedAt,
      },
    })
}

const PROJECT_SKILL_SOURCE_ROOTS = [
  '.agents/skills',
  '.codex/skills',
  '.claude/skills',
  '.cursor/skills',
  '.opencode/skills',
  '.pi/skills',
  'skills',
] as const

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const deriveProjectSkillSourceIdentity = (sourceRef: string, sourceLocator?: string | null) => {
  const normalizedSourceRef = sourceRef.trim()
  const normalizedSourceLocator = sourceLocator?.trim() || ''
  if (!normalizedSourceRef || !normalizedSourceLocator) {
    return ''
  }

  const stablePrefix = `project:${normalizedSourceRef}:`
  if (normalizedSourceLocator.startsWith(stablePrefix)) {
    return normalizedSourceLocator.slice(stablePrefix.length).trim()
  }

  const portableSourceLocator = normalizedSourceLocator.replace(/\\/g, '/')
  const rootPattern = PROJECT_SKILL_SOURCE_ROOTS
    .map((root) => escapeRegExp(root))
    .join('|')
  const match = portableSourceLocator.match(new RegExp(`(?:^|/)(${rootPattern})/(.+)$`))
  if (!match) {
    return ''
  }

  const normalizedRoot = match[1]?.trim()
  const normalizedRelativePath = normalizePortablePath(match[2] ?? '')
  return normalizedRoot && normalizedRelativePath
    ? `${normalizedRoot}/${normalizedRelativePath}`
    : ''
}

const buildProjectSkillDuplicateKey = (skill: Pick<StoredSkill, 'sourceType' | 'sourceRef' | 'slug' | 'name' | 'markdown' | 'sourceLocator'>) => {
  const sourceRef = skill.sourceRef?.trim() || ''
  if (skill.sourceType !== 'project' || !sourceRef) {
    return ''
  }

  const sourceIdentity = 'sourceLocator' in skill
    ? deriveProjectSkillSourceIdentity(sourceRef, skill.sourceLocator)
    : ''
  if (!sourceIdentity) {
    return ''
  }

  return [
    'project',
    sourceRef,
    sourceIdentity,
    skill.slug.trim().toLowerCase(),
    skill.name.trim().toLowerCase(),
    skill.markdown.trim(),
  ].join('\u0000')
}

const collectDuplicateProjectSkillIds = (skills: StoredSkill[]) => {
  const seen = new Set<string>()
  const uniqueSkills: StoredSkill[] = []
  const duplicateSkillIds: string[] = []

  for (const skill of skills) {
    const duplicateKey = buildProjectSkillDuplicateKey(skill)
    if (!duplicateKey || !seen.has(duplicateKey)) {
      if (duplicateKey) {
        seen.add(duplicateKey)
      }
      uniqueSkills.push(skill)
      continue
    }

    duplicateSkillIds.push(skill.id)
  }

  return {
    uniqueSkills,
    duplicateSkillIds,
  }
}

const dedupeProjectSkills = async () => {
  const { uniqueSkills, duplicateSkillIds } = collectDuplicateProjectSkillIds(cache.skills)
  if (duplicateSkillIds.length === 0) {
    return
  }

  cache.skills = uniqueSkills
  await getDrizzleDb().delete(skills).where(inArray(skills.id, duplicateSkillIds))
}

const dedupeSkillListForDisplay = (skills: StoredSkill[]) => {
  const keptByScopeSlug = new Map<string, StoredSkill>()
  for (const skill of skills) {
    const scopeSlugKey = buildSkillScopeSlugKey(skill)
    const current = keptByScopeSlug.get(scopeSlugKey)
    if (!current) {
      keptByScopeSlug.set(scopeSlugKey, skill)
      continue
    }

    const currentUpdatedAt = Date.parse(current.updatedAt)
    const nextUpdatedAt = Date.parse(skill.updatedAt)
    if (Number.isFinite(nextUpdatedAt) && (!Number.isFinite(currentUpdatedAt) || nextUpdatedAt > currentUpdatedAt)) {
      keptByScopeSlug.set(scopeSlugKey, skill)
      continue
    }

    if (nextUpdatedAt === currentUpdatedAt && skill.createdAt > current.createdAt) {
      keptByScopeSlug.set(scopeSlugKey, skill)
    }
  }

  const visibleIds = new Set(Array.from(keptByScopeSlug.values(), (skill) => skill.id))
  return skills.filter((skill) => visibleIds.has(skill.id))
}

const collectScopeSlugDuplicateSkillIds = (skills: StoredSkill[]) => {
  const keptByScopeSlug = new Map<string, StoredSkill>()
  const duplicateSkillIds: string[] = []

  for (const skill of skills) {
    const scopeSlugKey = buildSkillScopeSlugKey(skill)
    const current = keptByScopeSlug.get(scopeSlugKey)
    if (!current) {
      keptByScopeSlug.set(scopeSlugKey, skill)
      continue
    }

    const currentUpdatedAt = Date.parse(current.updatedAt)
    const nextUpdatedAt = Date.parse(skill.updatedAt)
    const shouldReplaceCurrent = Number.isFinite(nextUpdatedAt) && (!Number.isFinite(currentUpdatedAt) || nextUpdatedAt > currentUpdatedAt)
      || (nextUpdatedAt === currentUpdatedAt && skill.createdAt > current.createdAt)

    if (shouldReplaceCurrent) {
      duplicateSkillIds.push(current.id)
      keptByScopeSlug.set(scopeSlugKey, skill)
      continue
    }

    duplicateSkillIds.push(skill.id)
  }

  return {
    uniqueSkills: skills.filter((skill) => !duplicateSkillIds.includes(skill.id)),
    duplicateSkillIds,
  }
}

const dedupeSkillScopeSlugs = async () => {
  const { uniqueSkills, duplicateSkillIds } = collectScopeSlugDuplicateSkillIds(cache.skills)
  if (duplicateSkillIds.length === 0) {
    return
  }

  cache.skills = uniqueSkills
  await getDrizzleDb().delete(skills).where(inArray(skills.id, duplicateSkillIds))
}

const buildLanguage = (path: string) => {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.md')) return 'markdown'
  if (lowerPath.endsWith('.json')) return 'json'
  if (lowerPath.endsWith('.yml') || lowerPath.endsWith('.yaml')) return 'yaml'
  if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.tsx')) return 'typescript'
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx') || lowerPath.endsWith('.mjs')) return 'javascript'
  if (lowerPath.endsWith('.sh')) return 'bash'
  return null
}

const saveSkillVersion = async (skill: StoredSkill, createdBy?: string) => {
  await ensurePostgresReady()
  const versionRows = await getDrizzleDb()
    .select({ maxVersion: max(skillVersions.versionNumber) })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skill.id))
  const nextVersion = (versionRows[0]?.maxVersion ?? 0) + 1
  await getDrizzleDb()
    .insert(skillVersions)
    .values({
      id: crypto.randomUUID(),
      skillId: skill.id,
      versionNumber: nextVersion,
      markdown: skill.markdown,
      fileInventoryJson: skill.fileInventory,
      filesJson: skill.files,
      sourceLocator: skill.sourceLocator,
      sourceRef: skill.sourceRef,
      trustLevel: skill.trustLevel,
      createdAt: new Date().toISOString(),
      createdBy: createdBy ?? null,
    })
  return nextVersion
}

const saveSkill = (existingId: string | null, input: SaveSkillInput) => {
  const now = new Date().toISOString()
  const existing = existingId ? cache.skills.find((skill) => skill.id === existingId) ?? null : null
  const markdown = input.markdown.trim()
  const files = normalizeFiles(markdown, input.files ?? existing?.files)
  const fileInventory = normalizeFileInventory(files, input.fileInventory ?? existing?.fileInventory)
  const slug = normalizeSkillSlug(input.slug ?? input.name) ?? `skill-${cache.skills.length + 1}`
  const skill: StoredSkill = {
    id: existing?.id ?? crypto.randomUUID(),
    slug,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    markdown,
    sourceType: input.sourceType ?? existing?.sourceType ?? 'manual',
    enabled: input.enabled ?? existing?.enabled ?? true,
    visibility: input.visibility ?? existing?.visibility ?? 'private',
    ownerUserId: input.ownerUserId ?? existing?.ownerUserId ?? null,
    workspaceId: input.workspaceId ?? existing?.workspaceId ?? null,
    sourceLocator: input.sourceLocator ?? existing?.sourceLocator ?? null,
    sourceRef: input.sourceRef ?? existing?.sourceRef ?? null,
    trustLevel: input.trustLevel ?? existing?.trustLevel ?? 'markdown_only',
    compatibility: input.compatibility ?? existing?.compatibility ?? 'compatible',
    fileInventory,
    files,
    categories: normalizeCategories(input.categories ?? existing?.categories ?? []),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const conflict = findSkillByScopeSlug(skill, skill.id)
  if (conflict) {
    throw new SkillSlugConflictError(buildSkillSlugConflictMessage(skill), skill.slug)
  }

  cache.skills = existing
    ? cache.skills.map((item) => (item.id === skill.id ? skill : item))
    : [skill, ...cache.skills]

  if (existing && (existing.markdown !== skill.markdown || JSON.stringify(existing.files) !== JSON.stringify(skill.files))) {
    schedulePersistence('save-skill-version', saveSkillVersion(existing))
  }
  schedulePersistence(existing ? 'update-skill' : 'create-skill', persistSkill(skill))
  return toPublicSkill(skill)
}

const ensureSystemSkills = () => {
  for (const skill of getSystemSkillDefinitions()) {
    upsertSkillFromSource({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      markdown: skill.markdown,
      enabled: skill.enabled,
      sourceType: skill.sourceType,
      visibility: skill.visibility,
      ownerUserId: skill.ownerUserId,
      workspaceId: skill.workspaceId,
      sourceLocator: skill.sourceLocator,
      trustLevel: skill.trustLevel,
      compatibility: skill.compatibility,
      files: skill.files,
    })
  }
}

export const refreshSkillStore = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(skills)
    .orderBy(desc(skills.createdAt))
  cache.skills = rows.map(toStoredSkill)
}

export const initSkillStore = async () => {
  await refreshSkillStore()
  await dedupeProjectSkills()
  await dedupeSkillScopeSlugs()
  ensureSystemSkills()
}

export const listSkills = () => cloneJson(dedupeSkillListForDisplay(cache.skills).map(toPublicSkill))

export const getSkill = (id: string) => {
  const skill = cache.skills.find((item) => item.id === id)
  return skill ? cloneJson(toPublicSkill(skill)) : null
}

export const getSkillBySourceLocator = (sourceLocator: string) => {
  const skill = cache.skills.find((item) => item.sourceLocator === sourceLocator)
  return skill ? cloneJson(toPublicSkill(skill)) : null
}

export const createSkill = (input: Omit<SaveSkillInput, 'files'> & { files?: Record<string, SkillFileContent | string> }) => {
  return saveSkill(null, input)
}

export const cloneWorkspaceSkills = (input: CloneWorkspaceSkillsInput) => {
  const sourceWorkspaceId = input.sourceWorkspaceId.trim()
  const targetWorkspaceId = input.targetWorkspaceId.trim()
  if (!sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId) {
    return []
  }

  return cache.skills
    .filter((skill) => (
      skill.ownerUserId === input.ownerUserId
      && skill.visibility === 'workspace'
      && skill.workspaceId === sourceWorkspaceId
    ))
    .map((skill) => {
      const existingTargetSkill = findSkillByScopeSlug({
        sourceType: skill.sourceType,
        visibility: 'workspace',
        workspaceId: targetWorkspaceId,
        ownerUserId: input.ownerUserId,
        sourceRef: skill.sourceRef,
        slug: skill.slug,
      })
      return saveSkill(existingTargetSkill?.id ?? null, {
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        markdown: skill.markdown,
        sourceType: skill.sourceType,
        enabled: skill.enabled,
        visibility: 'workspace',
        ownerUserId: input.ownerUserId,
        workspaceId: targetWorkspaceId,
        sourceLocator: skill.sourceLocator,
        sourceRef: skill.sourceRef,
        trustLevel: skill.trustLevel,
        compatibility: skill.compatibility,
        fileInventory: skill.fileInventory,
        files: skill.files,
      })
    })
}

export const cloneSkillToWorkspace = (input: CloneSkillToWorkspaceInput) => {
  const targetWorkspaceId = input.targetWorkspaceId.trim()
  const skill = cache.skills.find((item) => (
    item.id === input.skillId
    && item.ownerUserId === input.ownerUserId
    && item.visibility === 'workspace'
  ))
  if (!skill || !targetWorkspaceId || skill.workspaceId === targetWorkspaceId) {
    return null
  }

  const existingTargetSkill = findSkillByScopeSlug({
    sourceType: skill.sourceType,
    visibility: 'workspace',
    workspaceId: targetWorkspaceId,
    ownerUserId: input.ownerUserId,
    sourceRef: skill.sourceRef,
    slug: skill.slug,
  })

  return saveSkill(existingTargetSkill?.id ?? null, {
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    markdown: skill.markdown,
    sourceType: skill.sourceType,
    enabled: skill.enabled,
    visibility: 'workspace',
    ownerUserId: input.ownerUserId,
    workspaceId: targetWorkspaceId,
    sourceLocator: skill.sourceLocator,
    sourceRef: skill.sourceRef,
    trustLevel: skill.trustLevel,
    compatibility: skill.compatibility,
    fileInventory: skill.fileInventory,
    files: skill.files,
  })
}

export const updateSkill = (id: string, input: Partial<SaveSkillInput>) => {
  const existing = cache.skills.find((item) => item.id === id)
  if (!existing) {
    return null
  }

  return saveSkill(id, {
    name: input.name ?? existing.name,
    slug: input.slug ?? existing.slug,
    description: input.description ?? existing.description,
    markdown: input.markdown ?? existing.markdown,
    sourceType: input.sourceType ?? existing.sourceType,
    enabled: input.enabled ?? existing.enabled,
    visibility: input.visibility ?? existing.visibility,
    ownerUserId: input.ownerUserId ?? existing.ownerUserId,
    workspaceId: input.workspaceId ?? existing.workspaceId,
    sourceLocator: input.sourceLocator ?? existing.sourceLocator,
    sourceRef: input.sourceRef ?? existing.sourceRef,
    trustLevel: input.trustLevel ?? existing.trustLevel,
    compatibility: input.compatibility ?? existing.compatibility,
    fileInventory: input.fileInventory ?? existing.fileInventory,
    files: input.files ?? existing.files,
  })
}

export const upsertSkillFromSource = (input: SaveSkillInput) => {
  const existing = input.sourceLocator
    ? cache.skills.find((item) => item.sourceLocator === input.sourceLocator) ?? null
    : null
  const finalSourceType = input.sourceType ?? 'manual'
  const finalVisibility = input.visibility ?? 'private'
  const finalSlug = normalizeSkillSlug(input.slug ?? input.name) ?? `skill-${cache.skills.length + 1}`
  const shouldReuseSameScopeSlug = finalSourceType === 'project' || finalVisibility === 'workspace'
  const sameScopeSlugSkill = !existing && shouldReuseSameScopeSlug
    ? findSkillByScopeSlug({
        sourceType: finalSourceType,
        visibility: finalVisibility,
        workspaceId: input.workspaceId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        sourceRef: input.sourceRef ?? null,
        slug: finalSlug,
      })
    : null
  const duplicateProjectSkill = !existing
    ? cache.skills.find((item) => {
        return buildProjectSkillDuplicateKey(item) !== ''
          && buildProjectSkillDuplicateKey(item) === buildProjectSkillDuplicateKey({
            sourceType: input.sourceType ?? 'manual',
            sourceRef: input.sourceRef ?? null,
            slug: input.slug ?? input.name,
            name: input.name,
            markdown: input.markdown,
            sourceLocator: input.sourceLocator ?? null,
          } as Pick<StoredSkill, 'sourceType' | 'sourceRef' | 'slug' | 'name' | 'markdown' | 'sourceLocator'>)
      }) ?? null
    : null

  return {
    action: existing || sameScopeSlugSkill || duplicateProjectSkill ? 'updated' : 'created',
    skill: saveSkill(existing?.id ?? sameScopeSlugSkill?.id ?? duplicateProjectSkill?.id ?? null, input),
  } as const
}

export const listSkillVersions = async (skillId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({
      id: skillVersions.id,
      versionNumber: skillVersions.versionNumber,
      markdown: skillVersions.markdown,
      trustLevel: skillVersions.trustLevel,
      createdAt: skillVersions.createdAt,
      createdBy: skillVersions.createdBy,
    })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.versionNumber))
  return rows.map((row) => ({
    id: row.id,
    skillId,
    versionNumber: row.versionNumber,
    markdown: row.markdown,
    trustLevel: row.trustLevel,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  }))
}

export const deleteSkill = (id: string) => {
  const existing = cache.skills.find((item) => item.id === id)
  if (!existing) {
    return false
  }

  cache.skills = cache.skills.filter((item) => item.id !== id)
  schedulePersistence(
    'delete-skill',
    (async () => {
      await ensurePostgresReady()
      await getDrizzleDb().delete(skills).where(eq(skills.id, id))
    })(),
  )
  return true
}

export const readSkillFile = (id: string, rawPath = 'SKILL.md'): SkillFileDetail | null => {
  const skill = cache.skills.find((item) => item.id === id)
  if (!skill) {
    return null
  }

  const path = normalizePortablePath(rawPath) || 'SKILL.md'
  const file = normalizeSkillFileContent(skill.files[path])
  if (!file) {
    return null
  }

  const kind = path === 'SKILL.md'
    ? 'skill'
    : skill.fileInventory.find((item) => item.path === path)?.kind ?? inferSkillFileKind(path)
  const markdown = file.encoding === 'utf8' && path.toLowerCase().endsWith('.md')
  const editable = file.encoding === 'utf8'

  return cloneJson({
    skillId: skill.id,
    path,
    kind,
    content: file.content,
    encoding: file.encoding,
    language: file.encoding === 'utf8' ? buildLanguage(path) : null,
    markdown,
    editable,
  })
}

export const updateSkillFile = (id: string, rawPath: string, content: string) => {
  const existing = cache.skills.find((item) => item.id === id)
  if (!existing) {
    return null
  }

  const path = normalizePortablePath(rawPath)
  if (!path) {
    return null
  }

  const files = {
    ...existing.files,
    [path]: {
      encoding: 'utf8' as SkillFileEncoding,
      content,
    },
  }
  const markdown = path === 'SKILL.md' ? content : existing.markdown
  const updated = updateSkill(id, {
    markdown,
    files,
    fileInventory: normalizeFileInventory(files, existing.fileInventory),
  })

  if (!updated) {
    return null
  }

  return readSkillFile(id, path)
}

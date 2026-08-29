// [INPUT]: 项目目录
// [OUTPUT]: SKILL.md 扫描结果
// [POS]: 本地技能扫描
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeSkillSlug, type SkillFileContent, type SkillFileInventoryEntry, type SkillTrustLevel } from '@shared/skill'
import type { ExecutorSkillPackage, ExecutorSkillScanMode, ExecutorSkillScanResult } from '@shared/types'

const PROJECT_SCAN_DIRECTORY_ROOTS = [
  'skills',
  '.agents/skills',
  '.codex/skills',
  '.claude/skills',
  '.cursor/skills',
  '.opencode/skills',
  '.pi/skills',
  '.kiro/skills',
  '.trae/skills',
  '.windsurf/skills',
  '.goose/skills',
  '.roo/skills',
] as const

const EXECUTOR_GLOBAL_SCAN_DIRECTORY_ROOTS = [
  '~/.claude/skills',
  '~/.agents/skills',
  '~/.codex/skills',
  '~/.config/opencode/skills',
  '~/.pi/skills',
  '~/.kiro/skills',
  '~/.trae/skills',
  '~/.windsurf/skills',
  '~/.goose/skills',
  '~/.roo/skills',
] as const

const TEXT_FILE_EXTENSIONS = new Set([
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

const expandHomeDir = (rawPath: string) => {
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

const normalizeFilesystemPath = (rawPath: string) => path.resolve(expandHomeDir(rawPath))

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

    if (key === 'name') {
      out.name = value
    }

    if (key === 'description') {
      out.description = value
    }
  }

  return out
}

const inferSkillName = (markdown: string, dirPath: string) => {
  const frontmatter = parseFrontmatter(markdown)
  if (frontmatter.name?.trim()) {
    return {
      name: frontmatter.name.trim(),
      description: frontmatter.description?.trim() || null,
    }
  }

  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) {
    return {
      name: heading,
      description: frontmatter.description?.trim() || null,
    }
  }

  return {
    name: path.basename(dirPath),
    description: frontmatter.description?.trim() || null,
  }
}

const inferFileKind = (relativePath: string): SkillFileInventoryEntry['kind'] => {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized === 'SKILL.md') {
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

const shouldReadTextFile = (filename: string) => {
  if (filename === 'SKILL.md') {
    return true
  }

  return TEXT_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase())
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
    if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') {
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
      const relativePath = path.relative(skillDir, absolutePath).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue
        }

        await visit(absolutePath)
        continue
      }

      inventory.push({
        path: relativePath,
        kind: inferFileKind(relativePath),
      })

      if (shouldReadTextFile(entry.name)) {
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
    return {
      warning: `跳过 ${skillDir}：SKILL.md 为空或无法读取。`,
    }
  }

  const meta = inferSkillName(markdown, skillDir)
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

const scanSkillRoots = async (candidateRoots: string[]) => {
  const scannedRoots: string[] = []
  const packages: ExecutorSkillPackage[] = []
  const warnings: string[] = []

  for (const candidateRoot of candidateRoots) {
    const resolvedRoot = normalizeFilesystemPath(candidateRoot)
    if (scannedRoots.includes(resolvedRoot)) {
      continue
    }

    scannedRoots.push(resolvedRoot)

    const exists = await stat(resolvedRoot).then((value) => value.isDirectory()).catch(() => false)
    if (!exists) {
      continue
    }

    for (const skillDir of await walkSkillDirectories(resolvedRoot)) {
      const { skill, warning } = await buildSkillPackage(skillDir)
      if (warning) {
        warnings.push(warning)
        continue
      }

      if (skill) {
        packages.push(skill)
      }
    }
  }

  packages.sort((left, right) => {
    return left.slug.localeCompare(right.slug) || left.sourceLocator.localeCompare(right.sourceLocator)
  })

  return {
    scannedRoots,
    packages,
    warnings,
  }
}

const scanProjectLocalSkills = async (workspaceRoot: string, rootPath: string): Promise<ExecutorSkillScanResult> => {
  const resolvedRootPath = normalizeFilesystemPath(rootPath)

  try {
    const stats = await stat(resolvedRootPath)
    if (!stats.isDirectory()) {
      return {
        ok: false,
        scanMode: 'project',
        rootPath: resolvedRootPath,
        scannedRoots: [resolvedRootPath],
        packages: [],
        warnings: [],
        message: '当前路径不是目录。',
      }
    }
  } catch {
    return {
      ok: false,
      scanMode: 'project',
      rootPath: resolvedRootPath,
      scannedRoots: [resolvedRootPath],
      packages: [],
      warnings: [],
      message: '目录不存在。',
    }
  }

  const { scannedRoots, packages, warnings } = await scanSkillRoots(
    PROJECT_SCAN_DIRECTORY_ROOTS.map((directoryRoot) => path.join(resolvedRootPath, directoryRoot)),
  )

  return {
    ok: true,
    scanMode: 'project',
    rootPath: resolvedRootPath,
    scannedRoots,
    packages,
    warnings,
    message: packages.length > 0 ? `共发现 ${packages.length} 个技能包。` : '未发现 SKILL.md。',
  }
}

const scanExecutorGlobalSkills = async (): Promise<ExecutorSkillScanResult> => {
  const resolvedHomeDir = normalizeFilesystemPath(os.homedir())
  const { scannedRoots, packages, warnings } = await scanSkillRoots([...EXECUTOR_GLOBAL_SCAN_DIRECTORY_ROOTS])

  return {
    ok: true,
    scanMode: 'global',
    rootPath: resolvedHomeDir,
    scannedRoots,
    packages,
    warnings,
    message: packages.length > 0 ? `共发现 ${packages.length} 个技能包。` : '未发现全局 SKILL.md。',
  }
}

export const scanLocalSkills = async (params: {
  workspaceRoot: string
  scanMode: ExecutorSkillScanMode
  rootPath?: string
}): Promise<ExecutorSkillScanResult> => {
  if (params.scanMode === 'global') {
    return scanExecutorGlobalSkills()
  }

  return scanProjectLocalSkills(params.workspaceRoot, params.rootPath || params.workspaceRoot)
}

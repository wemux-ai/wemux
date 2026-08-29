// [INPUT]: skill 输入
// [OUTPUT]: 规范化 skill 契约
// [POS]: Skill 契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkspaceResourceVisibility } from './workspace-scope'

export type SkillScope = 'agent' | 'project' | 'workspace'

export type SkillApprovalMode = 'auto' | 'approval'

export type SkillSourceType = 'manual' | 'project' | 'git' | 'download'

export type SkillTrustLevel = 'markdown_only' | 'assets' | 'scripts_executables'

export type SkillCompatibility = 'compatible' | 'unknown' | 'invalid'

export type SkillFileKind = 'skill' | 'reference' | 'script' | 'asset' | 'other'

export type SkillFileEncoding = 'utf8' | 'base64'

export interface SkillFileContent {
  encoding: SkillFileEncoding
  content: string
}

export interface SkillFileInventoryEntry {
  path: string
  kind: SkillFileKind
}

export interface SkillRecord {
  id: string
  slug: string
  name: string
  description: string | null
  enabled: boolean
  markdown: string
  sourceType: SkillSourceType
  visibility: WorkspaceResourceVisibility
  ownerUserId: string | null
  workspaceId: string | null
  sourceLocator: string | null
  sourceRef: string | null
  trustLevel: SkillTrustLevel
  compatibility: SkillCompatibility
  fileInventory: SkillFileInventoryEntry[]
  categories: string[]
  createdAt: string
  updatedAt: string
}

export interface SkillFileDetail {
  skillId: string
  path: string
  kind: SkillFileKind
  content: string
  encoding: SkillFileEncoding
  language: string | null
  markdown: boolean
  editable: boolean
}

export interface SkillSelectionPolicy {
  id: string
  skillId?: string
  slug?: string
  name: string
  description?: string
  enabled: boolean
  scope: SkillScope
  approvalMode: SkillApprovalMode
  tags: string[]
}

export interface SkillImportResult {
  sourceType: Extract<SkillSourceType, 'git' | 'download'>
  discovered: number
  imported: SkillRecord[]
  updated: SkillRecord[]
  warnings: string[]
  auditFindings?: SkillAuditFinding[]
}

export const MANAGED_SYSTEM_SKILL_SOURCE_PREFIX = 'builtin://'

export const normalizeSkillSlug = (value: string | null | undefined) => {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || null
}

export const buildManagedSystemSkillSourceLocator = (value: string) => {
  return `${MANAGED_SYSTEM_SKILL_SOURCE_PREFIX}${normalizeSkillSlug(value) ?? 'skill'}`
}

export const isManagedSystemSkill = (skill: Pick<SkillRecord, 'sourceLocator'>) => {
  return typeof skill.sourceLocator === 'string'
    && skill.sourceLocator.startsWith(MANAGED_SYSTEM_SKILL_SOURCE_PREFIX)
}

export const normalizeSkillScope = (value: unknown): SkillScope => {
  if (value === 'project' || value === 'workspace') {
    return value
  }

  return 'agent'
}

export const normalizeSkillApprovalMode = (value: unknown): SkillApprovalMode => {
  return value === 'approval' ? 'approval' : 'auto'
}

export const isSkillEnabled = (skill: { enabled?: boolean }) => {
  return skill.enabled !== false
}

export const filterEnabledSkills = <T extends { enabled?: boolean }>(skills: T[]) => {
  return skills.filter((skill) => isSkillEnabled(skill))
}

export const isGlobalSkill = (skill: Pick<SkillRecord, 'sourceType'>) => {
  return skill.sourceType !== 'project'
}

export const isProjectSkill = (skill: Pick<SkillRecord, 'sourceType'>) => {
  return skill.sourceType === 'project'
}

export const isSkillAvailableInProjectContext = (
  skill: Pick<SkillRecord, 'sourceType' | 'sourceRef'>,
  projectId?: string,
) => {
  if (isGlobalSkill(skill)) {
    return true
  }

  return Boolean(projectId && skill.sourceRef === projectId)
}

export const filterSkillsForProjectContext = <T extends Pick<SkillRecord, 'sourceType' | 'sourceRef'>>(
  skills: T[],
  projectId?: string,
) => {
  return skills.filter((skill) => isSkillAvailableInProjectContext(skill, projectId))
}

const SKILL_MENTION_PATTERN = /(^|\s)@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g

const resolveMentionedSkill = (value: string, skills: SkillRecord[]) => {
  const normalized = normalizeSkillSlug(value)
  if (!normalized) {
    return null
  }

  return skills.find((skill) => {
    return skill.slug === normalized || normalizeSkillSlug(skill.name) === normalized
  }) ?? null
}

export const getMentionedSkills = (value: string, skills: SkillRecord[]) => {
  const mentioned: SkillRecord[] = []
  const seen = new Set<string>()

  for (const match of value.matchAll(SKILL_MENTION_PATTERN)) {
    const skill = resolveMentionedSkill(match[2], skills)
    if (!skill || seen.has(skill.id)) {
      continue
    }

    seen.add(skill.id)
    mentioned.push(skill)
  }

  return mentioned
}

/**
 * Runtime agents discover mounted skill directories themselves,
 * so skill mentions are kept as-is in the user message.
 * Use `getMentionedSkills()` to resolve which skills were referenced.
 */
export const buildMessageWithSkillMentions = (value: string, _skills: SkillRecord[]) => {
  return value.trim()
}

export const SKILL_AUDIT_VERSION = 1

export type SkillAuditFinding = {
  severity: 'warning' | 'error'
  rule: string
  message: string
  path?: string
}

const DANGEROUS_SHELL_PATTERNS = [
  { pattern: /\brm\s+-rf\s+[\/~]/, rule: 'dangerous-rm-rf', message: 'Recursive delete of system paths detected.' },
  { pattern: /\bcurl\b.*\|\s*(?:bash|sh|python|node)/, rule: 'pipe-to-shell', message: 'Piping remote content to shell interpreter.' },
  { pattern: /\bwget\b.*\|\s*(?:bash|sh|python|node)/, rule: 'pipe-to-shell', message: 'Piping remote content to shell interpreter.' },
  { pattern: /\bchmod\s+777\b/, rule: 'chmod-777', message: 'Overly permissive file permissions (777).' },
  { pattern: /\b(?:\/etc\/passwd|\/etc\/shadow)\b/, rule: 'system-file-access', message: 'Accessing sensitive system files.' },
  { pattern: /\bENV\b.*(?:API_KEY|SECRET|TOKEN|PASSWORD)/i, rule: 'env-exfiltration', message: 'References to sensitive environment variables.' },
]

const DANGEROUS_SCRIPT_PATTERNS = [
  { pattern: /(?:require|import)\s*\(?\s*['"]child_process['"]\)?/, rule: 'child-process', message: 'Script uses child_process module.' },
  { pattern: /(?:require|import)\s*\(?\s*['"]fs['"]\)?/, rule: 'fs-access', message: 'Script uses filesystem module.' },
  { pattern: /exec\s*\(|spawn\s*\(|execSync\s*\(/, rule: 'exec-call', message: 'Script executes shell commands.' },
]

export const auditSkillFiles = (files: Record<string, { encoding: string; content: string }>): SkillAuditFinding[] => {
  const findings: SkillAuditFinding[] = []

  for (const [filePath, file] of Object.entries(files)) {
    if (file.encoding !== 'utf8') {
      continue
    }

    const content = file.content
    const isScript = /\.(?:sh|bash|zsh|py|rb|js|ts|mjs|cjs)$/i.test(filePath)
    const isMarkdown = /\.md$/i.test(filePath)

    if (isMarkdown || filePath === 'SKILL.md') {
      for (const { pattern, rule, message } of DANGEROUS_SHELL_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({ severity: 'warning', rule, message, path: filePath })
        }
      }
    }

    if (isScript) {
      for (const { pattern, rule, message } of DANGEROUS_SCRIPT_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({ severity: 'warning', rule, message, path: filePath })
        }
      }
      for (const { pattern, rule, message } of DANGEROUS_SHELL_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({ severity: 'error', rule, message, path: filePath })
        }
      }
    }

    if (content.length > 1_000_000) {
      findings.push({ severity: 'warning', rule: 'oversized-file', message: `File exceeds 1MB (${Math.round(content.length / 1024)}KB).`, path: filePath })
    }
  }

  return findings
}

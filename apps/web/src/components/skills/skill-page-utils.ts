import type { SkillFileInventoryEntry, SkillRecord } from '@shared/skill'
import type { PrimaryAgentDraft } from '../../lib/agent-config'
import type { SkillImportResult, SkillScanResult } from '../../lib/api'
import { getCurrentLanguage } from '../../lib/i18n'
import type { Language } from '../../lib/i18n'

const text = (language: Language, zh: string, en: string) => language === 'zh' ? zh : en

export const defaultMarkdown = (name: string, description: string, language: Language) => {
  return [
    `# ${name}`,
    '',
    description.trim() || text(language, '请补充这个 skill 的目标、步骤和边界。', 'Describe this skill’s goal, workflow, and boundaries.'),
    '',
    text(language, '## 场景', '## When To Use'),
    '',
    text(language, '- 什么时候应该使用它', '- When this skill should be used'),
    '',
    text(language, '## 步骤', '## Steps'),
    '',
    text(language, '1. 先读取上下文', '1. Read the context first'),
    text(language, '2. 再执行标准流程', '2. Follow the standard workflow'),
    text(language, '3. 最后说明边界和验证方式', '3. Explain boundaries and validation'),
  ].join('\n')
}

export const ensureFileInventory = (skill: SkillRecord): SkillFileInventoryEntry[] => {
  if (skill.fileInventory.some((entry) => entry.path === 'SKILL.md')) {
    return skill.fileInventory
  }

  return [{ path: 'SKILL.md', kind: 'skill' }, ...skill.fileInventory]
}

export const findDefaultPath = (skill: SkillRecord | null) => {
  if (!skill) {
    return 'SKILL.md'
  }

  return ensureFileInventory(skill).find((entry) => entry.path === 'SKILL.md')?.path ?? skill.fileInventory[0]?.path ?? 'SKILL.md'
}

export const sourceMeta = (sourceType: SkillRecord['sourceType'], language: Language = getCurrentLanguage()) => {
  if (sourceType === 'project') {
    return { label: text(language, '项目 Skill', 'Project Skill'), className: 'border-sky-500/20 bg-sky-500/10 text-sky-300' }
  }

  if (sourceType === 'git') {
    return { label: text(language, 'Git 全局', 'Global Git'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' }
  }

  if (sourceType === 'download') {
    return { label: text(language, '下载全局', 'Global Download'), className: 'border-amber-500/20 bg-amber-500/10 text-amber-300' }
  }

  return { label: text(language, '全局 Skill', 'Global Skill'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' }
}

export const trustMeta = (skill: SkillRecord, language: Language = getCurrentLanguage()) => {
  if (skill.trustLevel === 'scripts_executables') {
    return { label: text(language, '脚本', 'Scripts'), className: 'border-rose-500/20 bg-rose-500/10 text-rose-300' }
  }

  if (skill.trustLevel === 'assets') {
    return { label: text(language, '带资源', 'Assets'), className: 'border-violet-500/20 bg-violet-500/10 text-violet-300' }
  }

  return { label: 'Markdown', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' }
}

export const compatibilityMeta = (skill: SkillRecord, language: Language = getCurrentLanguage()) => {
  if (skill.compatibility === 'invalid') {
    return { label: text(language, '无效', 'Invalid'), className: 'border-rose-500/20 bg-rose-500/10 text-rose-300' }
  }

  if (skill.compatibility === 'unknown') {
    return { label: text(language, '待确认', 'Pending'), className: 'border-amber-500/20 bg-amber-500/10 text-amber-300' }
  }

  return { label: text(language, '兼容', 'Compatible'), className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' }
}

export const summarizeImportResult = (result: SkillImportResult, language: Language) => {
  return text(
    language,
    `发现 ${result.discovered} 个 skill，新增 ${result.imported.length}，更新 ${result.updated.length}`,
    `Found ${result.discovered} skills, imported ${result.imported.length}, updated ${result.updated.length}`,
  )
}

export const summarizeScanResult = (result: SkillScanResult, language: Language) => {
  const summary = result.scope === 'global'
    ? text(
        language,
        `扫描 ${result.scannedExecutors} 个执行器，发现 ${result.discovered} 个全局 skill，新增 ${result.imported.length}，更新 ${result.updated.length}`,
        `Scanned ${result.scannedExecutors} executors, found ${result.discovered} global skills, imported ${result.imported.length}, updated ${result.updated.length}`,
      )
    : text(
        language,
        `扫描 ${result.scannedProjects} 个项目，发现 ${result.discovered} 个 skill，新增 ${result.imported.length}，更新 ${result.updated.length}`,
        `Scanned ${result.scannedProjects} projects, found ${result.discovered} skills, imported ${result.imported.length}, updated ${result.updated.length}`,
      )

  const notes = [
    ...(result.skipped.length > 0
      ? result.skipped.slice(0, 2).map((item) => text(
          language,
          `${item.subjectName}：${item.reason}${item.path ? `（${item.path}）` : ''}`,
          `${item.subjectName}: ${item.reason}${item.path ? ` (${item.path})` : ''}`,
        ))
      : []),
    ...(result.warnings.length > 0 ? result.warnings.slice(0, 2) : []),
  ]

  if (notes.length === 0) {
    return summary
  }

  return `${summary} · ${notes.join(' · ')}`
}

export const createSkillPolicy = (skill: SkillRecord) => {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `skill-${skill.id}`,
    skillId: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description ?? undefined,
    enabled: true,
    scope: 'agent' as const,
    approvalMode: 'auto' as const,
    tags: [],
  }
}

export const isSkillAttached = (draft: PrimaryAgentDraft | null, skill: SkillRecord | null) => {
  if (!draft || !skill) {
    return false
  }

  return draft.skills.some((item) => {
    return item.skillId === skill.id
      || item.slug === skill.slug
      || item.name.trim().toLowerCase() === skill.name.trim().toLowerCase()
  })
}

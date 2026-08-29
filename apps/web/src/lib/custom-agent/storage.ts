import {
  createCustomAgentTemplatePackage,
  parseCustomAgentTemplatePackage,
  type CustomAgentTemplatePackage,
} from '@shared/custom-agent'

import { safeLocalStorageSetItem } from '../browser-storage'
import { buildCustomAgentConfig } from './draft'
import { CUSTOM_AGENT_TEMPLATE_LIBRARY_KEY, createId, formatTemplateModes, normalizeTemplateLibrary } from './helpers'
import type {
  CustomAgentDraft,
  CustomAgentTemplateDiffSummary,
  CustomAgentTemplateLibraryItem,
} from './types'

export const createTemplateLibraryItem = (
  templatePackage: CustomAgentTemplatePackage,
): CustomAgentTemplateLibraryItem => {
  const now = new Date().toISOString()
  return {
    id: createId('template'),
    package: templatePackage,
    savedAt: now,
    updatedAt: now,
    version: 1,
    history: [],
  }
}

export const readTemplateLibrary = (): CustomAgentTemplateLibraryItem[] => {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(CUSTOM_AGENT_TEMPLATE_LIBRARY_KEY)
    if (!raw) {
      return []
    }

    return normalizeTemplateLibrary(JSON.parse(raw), parseCustomAgentTemplatePackage)
  } catch {
    return []
  }
}

export const writeTemplateLibrary = (items: CustomAgentTemplateLibraryItem[]) => {
  if (typeof window === 'undefined') {
    return
  }

  safeLocalStorageSetItem(
    CUSTOM_AGENT_TEMPLATE_LIBRARY_KEY,
    JSON.stringify(items.slice(0, 64), null, 2),
    { clearRecoverableLocalStorageOnQuota: true },
  )
}

export const upsertTemplateLibraryItem = (
  items: CustomAgentTemplateLibraryItem[],
  nextItem: CustomAgentTemplateLibraryItem,
): CustomAgentTemplateLibraryItem[] => {
  const existing = items.find((item) => item.id === nextItem.id)
  if (!existing) {
    return [nextItem, ...items.filter((item) => item.id !== nextItem.id)].slice(0, 64)
  }

  const now = new Date().toISOString()
  const merged: CustomAgentTemplateLibraryItem = {
    ...nextItem,
    savedAt: existing.savedAt,
    updatedAt: now,
    version: existing.version + 1,
    history: [
      {
        version: existing.version,
        updatedAt: existing.updatedAt,
        templateName: existing.package.template.name,
        templateSummary: existing.package.template.summary,
        draftName: existing.package.draft.name,
      },
      ...existing.history,
    ].slice(0, 10),
  }

  return [merged, ...items.filter((item) => item.id !== nextItem.id)].slice(0, 64)
}

export const removeTemplateLibraryItem = (
  items: CustomAgentTemplateLibraryItem[],
  itemId: string,
): CustomAgentTemplateLibraryItem[] => {
  return items.filter((item) => item.id !== itemId)
}

export const buildTemplatePackageFromDraft = (
  draft: CustomAgentDraft,
  params?: {
    agentName?: string
    currentConfig?: Record<string, unknown>
    templateName?: string
    templateSummary?: string
    templateDescription?: string
    draftName?: string
  },
) => {
  return createCustomAgentTemplatePackage({
    name: params?.agentName?.trim() || draft.name.trim() || 'Agent',
    endpoint: draft.endpoint.trim() || null,
    config: buildCustomAgentConfig(draft, params?.currentConfig),
  }, {
    templateName: params?.templateName,
    templateSummary: params?.templateSummary,
    templateDescription: params?.templateDescription,
    draftName: params?.draftName,
  })
}

export const buildTemplatePackageDiffSummary = (
  previousPackage: CustomAgentTemplatePackage,
  nextPackage: CustomAgentTemplatePackage,
): CustomAgentTemplateDiffSummary => {
  const lines: string[] = []

  if (previousPackage.template.name !== nextPackage.template.name) {
    lines.push(`模板名称：${previousPackage.template.name} → ${nextPackage.template.name}`)
  }
  if (previousPackage.template.summary !== nextPackage.template.summary) {
    lines.push('模板摘要已变更')
  }
  if (previousPackage.template.description !== nextPackage.template.description) {
    lines.push('模板说明已变更')
  }
  if (previousPackage.template.category !== nextPackage.template.category) {
    lines.push(`模板分类：${previousPackage.template.category} → ${nextPackage.template.category}`)
  }
  if (previousPackage.template.tags.join('||') !== nextPackage.template.tags.join('||')) {
    lines.push('模板标签已变更')
  }
  if (previousPackage.draft.name !== nextPackage.draft.name) {
    lines.push(`默认草稿名：${previousPackage.draft.name} → ${nextPackage.draft.name}`)
  }
  if (formatTemplateModes(previousPackage.draft.config) !== formatTemplateModes(nextPackage.draft.config)) {
    lines.push(`调用模式：${formatTemplateModes(previousPackage.draft.config)} → ${formatTemplateModes(nextPackage.draft.config)}`)
  }
  if (previousPackage.draft.config.skills.filter((item) => item.enabled).length !== nextPackage.draft.config.skills.filter((item) => item.enabled).length) {
    lines.push(`Skills 数量：${previousPackage.draft.config.skills.filter((item) => item.enabled).length} → ${nextPackage.draft.config.skills.filter((item) => item.enabled).length}`)
  }
  if (previousPackage.draft.config.mcpServers.filter((item) => item.enabled).length !== nextPackage.draft.config.mcpServers.filter((item) => item.enabled).length) {
    lines.push(`MCP 数量：${previousPackage.draft.config.mcpServers.filter((item) => item.enabled).length} → ${nextPackage.draft.config.mcpServers.filter((item) => item.enabled).length}`)
  }
  if (previousPackage.draft.config.preferredRuntime !== nextPackage.draft.config.preferredRuntime) {
    lines.push(`偏好执行端：${previousPackage.draft.config.preferredRuntime} → ${nextPackage.draft.config.preferredRuntime}`)
  }
  if (previousPackage.draft.config.preferredModel !== nextPackage.draft.config.preferredModel) {
    lines.push('偏好模型已变更')
  }

  return {
    changed: lines.length > 0,
    lines,
  }
}

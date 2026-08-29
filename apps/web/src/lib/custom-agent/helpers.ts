import type { CustomAgentTemplatePackage } from '@shared/custom-agent'

import type { CustomAgentTemplateLibraryItem } from './types'
import {
  AGENT_SIDEBAR_REFRESH_EVENT,
  notifyAgentSidebarRefresh,
  SELECTED_AGENT_KEY,
} from '../agent-sidebar-store'

export const CUSTOM_AGENT_TEMPLATE_LIBRARY_KEY = 'vibemux.customAgentTemplateLibrary'
export { AGENT_SIDEBAR_REFRESH_EVENT, notifyAgentSidebarRefresh, SELECTED_AGENT_KEY }

export const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export const createId = (prefix: string) => {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export const normalizeLookupKey = (value: string) => value.trim().toLowerCase()

export const matchesTemplateQuery = (haystack: string[], query: string) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return haystack.some((item) => item.toLowerCase().includes(normalized))
}

export const includesAny = (text: string, patterns: string[]) => {
  return patterns.some((pattern) => text.includes(pattern))
}

export const formatTemplateModes = (config: CustomAgentTemplatePackage['draft']['config']) => {
  return [
    config.allowedModes.includes('mention') ? '@ 调用' : null,
    config.allowedModes.includes('delegate') ? '正式委派' : null,
  ].filter(Boolean).join(' / ') || '未启用'
}

export const normalizeTemplateLibrary = (value: unknown, parseTemplate: (value: unknown) => CustomAgentTemplatePackage): CustomAgentTemplateLibraryItem[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      const record = asRecord(item)
      const nextPackage = parseTemplate(record.package ?? record)
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createId('template')
      const savedAt = typeof record.savedAt === 'string' && record.savedAt.trim() ? record.savedAt.trim() : new Date().toISOString()
      const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt.trim() ? record.updatedAt.trim() : savedAt
      const version = typeof record.version === 'number' && Number.isFinite(record.version) && record.version > 0
        ? Math.floor(record.version)
        : 1
      const history = Array.isArray(record.history)
        ? record.history
          .map((entry) => {
            const nextEntry = asRecord(entry)
            return {
              version: typeof nextEntry.version === 'number' && Number.isFinite(nextEntry.version) && nextEntry.version > 0
                ? Math.floor(nextEntry.version)
                : 1,
              updatedAt: typeof nextEntry.updatedAt === 'string' && nextEntry.updatedAt.trim() ? nextEntry.updatedAt.trim() : updatedAt,
              templateName: typeof nextEntry.templateName === 'string' ? nextEntry.templateName.trim() : '',
              templateSummary: typeof nextEntry.templateSummary === 'string' ? nextEntry.templateSummary.trim() : '',
              draftName: typeof nextEntry.draftName === 'string' ? nextEntry.draftName.trim() : '',
            }
          })
          .slice(0, 10)
        : []

      return {
        id,
        package: nextPackage,
        savedAt,
        updatedAt,
        version,
        history,
      } satisfies CustomAgentTemplateLibraryItem
    })
    .slice(0, 64)
}

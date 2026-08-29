// [INPUT]: preview 来源输入
// [OUTPUT]: 来源契约
// [POS]: preview 来源类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { PreviewDomainBinding, ProjectEnvironmentPort } from './types/task-domain'

export type WorkspacePreviewSourceOption = {
  id: string
  appUrl: string
  accessUrl: string
  port?: number
  note?: string
  primary: boolean
}

type PreviewSourceBindingInput = {
  id?: string
  appUrl?: string
  iframeUrl?: string
  publicUrl?: string
  previewHost?: string
  port?: number
  note?: string
  primary?: boolean
}

type PreviewAdditionalSourceInput = {
  appUrl?: string
  iframeUrl?: string
  publicUrl?: string
  port?: number
  note?: string
}

const normalizePortNumber = (value: unknown) => {
  const port = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

const normalizePortExpression = (value?: string | null) => value?.trim() || ''

const normalizeNote = (value?: string | null) => value?.trim() || ''

export const buildWorkspacePreviewSourceOptions = (params: {
  preview: {
    sourceAppUrl?: string
    domainBindings?: PreviewSourceBindingInput[]
    additionalSourceAppUrls?: PreviewAdditionalSourceInput[]
  } | null
  fallbackSourceAppUrl?: string
}) => {
  const options: WorkspacePreviewSourceOption[] = []
  const seenAppUrls = new Set<string>()
  const primaryAppUrl = params.preview?.sourceAppUrl?.trim() || params.fallbackSourceAppUrl?.trim() || ''

  const pushOption = (option: WorkspacePreviewSourceOption | null) => {
    if (!option?.appUrl || seenAppUrls.has(option.appUrl)) {
      return
    }
    seenAppUrls.add(option.appUrl)
    options.push(option)
  }

  if (params.preview?.domainBindings?.length) {
    params.preview.domainBindings.forEach((binding, index) => {
      const appUrl = binding.appUrl?.trim() || ''
      const accessUrl = binding.iframeUrl?.trim() || binding.publicUrl?.trim() || appUrl
      pushOption(appUrl
        ? {
            id: binding.id?.trim() || `preview-source-${index + 1}`,
            appUrl,
            accessUrl,
            port: normalizePortNumber(binding.port),
            note: normalizeNote(binding.note) || undefined,
            primary: binding.primary ?? (appUrl === primaryAppUrl || index === 0),
          }
        : null)
    })
  }

  if (params.preview?.additionalSourceAppUrls?.length) {
    params.preview.additionalSourceAppUrls.forEach((source, index) => {
      const appUrl = source.appUrl?.trim() || ''
      const accessUrl = source.iframeUrl?.trim() || source.publicUrl?.trim() || appUrl
      pushOption(appUrl
        ? {
            id: `preview-source-additional-${index + 1}`,
            appUrl,
            accessUrl,
            port: normalizePortNumber(source.port),
            note: normalizeNote(source.note) || undefined,
            primary: appUrl === primaryAppUrl,
          }
        : null)
    })
  }

  if (options.length === 0 && primaryAppUrl) {
    pushOption({
      id: 'preview-source-primary',
      appUrl: primaryAppUrl,
      accessUrl: primaryAppUrl,
      primary: true,
    })
  }

  return options.sort((left, right) => Number(right.primary) - Number(left.primary))
}

export const resolvePreviewSourceLabel = (source: Pick<WorkspacePreviewSourceOption, 'note' | 'port' | 'primary'>) => {
  const normalizedNote = normalizeNote(source.note)
  if (normalizedNote && source.port) {
    return `${normalizedNote} · ${source.port}`
  }
  if (normalizedNote) {
    return normalizedNote
  }
  if (source.primary && source.port) {
    return `默认端口 · ${source.port}`
  }
  if (source.primary) {
    return '默认端口'
  }
  if (source.port) {
    return `Port ${source.port}`
  }
  return '额外端口'
}

export const validateProjectEnvironmentPreviewPorts = (params: {
  appPort?: string | null
  ports?: ProjectEnvironmentPort[] | null
  previewDomainBindings?: PreviewDomainBinding[] | null
}) => {
  const duplicates = new Map<string, number>()
  const addPort = (value?: string | number | null) => {
    const normalized = typeof value === 'number' ? String(value) : normalizePortExpression(value)
    if (!normalized) {
      return
    }
    duplicates.set(normalized, (duplicates.get(normalized) ?? 0) + 1)
  }

  addPort(params.appPort)
  params.ports?.forEach((port) => addPort(port.port))
  params.previewDomainBindings?.forEach((binding) => addPort(binding.port))

  return Array.from(duplicates.entries())
    .filter(([, count]) => count > 1)
    .map(([port]) => port)
}

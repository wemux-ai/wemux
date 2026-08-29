import type { PreviewDomainBinding, ProjectEnvironmentPort } from '@shared/types'

const normalizePort = (value: unknown) => {
  const port = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

export const normalizePreviewDomainBindingDrafts = (bindings: PreviewDomainBinding[]) => {
  const normalized: PreviewDomainBinding[] = []
  bindings.forEach((binding, index) => {
    const port = normalizePort(binding.port)
    if (!port) {
      return
    }
    normalized.push({
      id: binding.id?.trim() || crypto.randomUUID?.() || `preview-domain-${index + 1}`,
      domain: binding.domain?.trim() || undefined,
      port,
      note: binding.note?.trim() || undefined,
      type: binding.type === 'custom' ? 'custom' : 'generated',
    })
  })
  return normalized
}

export const normalizeEnvironmentPortDrafts = (bindings: ProjectEnvironmentPort[]) => {
  const normalized: ProjectEnvironmentPort[] = []
  bindings.forEach((binding, index) => {
    const port = binding.port?.trim()
    if (!port) {
      return
    }
    normalized.push({
      id: binding.id?.trim() || crypto.randomUUID?.() || `port-${index + 1}`,
      domain: binding.domain?.trim() || undefined,
      port,
      note: binding.note?.trim() || undefined,
      type: binding.type === 'custom' ? 'custom' : 'generated',
    })
  })
  return normalized
}

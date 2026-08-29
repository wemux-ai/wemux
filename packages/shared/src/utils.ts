// [INPUT]: 工具输入
// [OUTPUT]: 纯函数输出
// [POS]: shared 通用工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/**
 * Shared utility functions used across multiple shared modules.
 * Keep this file minimal — only truly generic helpers belong here.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const createStableId = (prefix: string, seed: string, index: number) => {
  const slug = seed.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `${prefix}-${index + 1}`
  return `${prefix}-${index + 1}-${slug}`
}

export const inferMcpTransport = (target: string): 'http' | 'sse' | 'stdio' | 'custom' => {
  if (target.startsWith('stdio://')) {
    return 'stdio'
  }

  if (target.startsWith('sse://')) {
    return 'sse'
  }

  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target.includes('/sse') ? 'sse' : 'http'
  }

  return 'custom'
}

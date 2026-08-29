// [INPUT]: 控制台工具输入
// [OUTPUT]: 工具函数
// [POS]: Worker Console 工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Locale } from './worker-console-types'

const SECRET_KEY_PATTERN = /(token|secret|api[_-]?key|authorization|cookie|password)/i

export const toLines = (value: string[]) => value.join('\n')

export const fromLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)

export const formatMessage = (template: string, values: Record<string, number>) => {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template)
}

export const maskMiddle = (value?: string, fallback = '—') => {
  if (!value) return fallback
  if (value.length <= 10) return '••••'
  return `${value.slice(0, 6)}••••${value.slice(-4)}`
}

export const formatTimestamp = (value: string | undefined, locale: Locale, fallback: string) => {
  if (!value) return fallback

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

const maskSensitiveString = (value: string) => {
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 3)}••••${value.slice(-3)}`
}

export const sanitizeDisplayJson = (value: unknown, key = ''): unknown => {
  if (value == null) return value

  if (typeof value === 'string') {
    if (key === 'opencodeConfigContent' || key === 'codexConfigContent' || key === 'codexAuthContent' || key === 'claudeCodeConfigContent') {
      return '[hidden config content]'
    }

    if (SECRET_KEY_PATTERN.test(key)) {
      return maskSensitiveString(value)
    }

    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayJson(item, key))
  }

  if (typeof value === 'object') {
    return Object.entries(value).reduce<Record<string, unknown>>((result, [entryKey, entryValue]) => {
      result[entryKey] = sanitizeDisplayJson(entryValue, entryKey)
      return result
    }, {})
  }

  return value
}

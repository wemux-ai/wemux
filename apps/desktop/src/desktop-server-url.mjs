// [INPUT]: User-selected control-plane URLs and Electron userData storage paths.
// [OUTPUT]: Validated server origins, page URLs, and persisted desktop connection state.
// [POS]: Desktop main-process policy for selecting a trusted Wemux control-plane origin.
// [PROTOCOL]: Update this header when URL validation or persistence contracts change, then check AGENTS.md.

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const DEFAULT_DESKTOP_SERVER_URL = 'https://wemux.ai'

export const normalizeDesktopServerUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export const buildDesktopServerPageUrl = (serverUrl, pathname = '/chat') => {
  const normalizedServerUrl = normalizeDesktopServerUrl(serverUrl)
  if (!normalizedServerUrl) throw new TypeError('invalid desktop server URL')
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`
  return new URL(normalizedPathname, `${normalizedServerUrl}/`).toString()
}

export const readDesktopServerUrl = (filePath) => {
  try {
    const config = JSON.parse(readFileSync(filePath, 'utf8'))
    return normalizeDesktopServerUrl(config.serverUrl) ?? DEFAULT_DESKTOP_SERVER_URL
  } catch {
    return DEFAULT_DESKTOP_SERVER_URL
  }
}

export const persistDesktopServerUrl = (filePath, serverUrl) => {
  const normalizedServerUrl = normalizeDesktopServerUrl(serverUrl)
  if (!normalizedServerUrl) throw new TypeError('invalid desktop server URL')

  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ serverUrl: normalizedServerUrl }, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, filePath)
  } catch (error) {
    try { unlinkSync(temporaryPath) } catch {}
    throw error
  }
  return normalizedServerUrl
}

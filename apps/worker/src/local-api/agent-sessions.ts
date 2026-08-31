// [INPUT]: Agent 会话请求
// [OUTPUT]: 会话列表/详情
// [POS]: Agent 会话本地 API
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isExecutorAgentSessionBoilerplatePrompt } from '@shared/executor-agent-session'
import type {
  ExecutorAgentSessionDetail,
  ExecutorAgentSessionEntry,
  ExecutorAgentSessionsResult,
  ExecutorAgentSessionSource,
  ExecutorAgentSessionSummary,
} from '@shared/types'
import { loadWorkerConfig } from '../core/config'

export type AgentSessionSource = ExecutorAgentSessionSource
export type AgentSessionSummary = ExecutorAgentSessionSummary
export type AgentSessionEntry = ExecutorAgentSessionEntry
export type AgentSessionDetail = ExecutorAgentSessionDetail
export type AgentSessionsPayload = ExecutorAgentSessionsResult

type JsonRecord = Record<string, unknown>

const HOME = os.homedir()
const MAX_HEAD_BYTES = 48 * 1024
const MAX_ENTRY_TEXT_LENGTH = 20_000
const CLAUDE_PROJECTS_ROOT = path.join(HOME, '.claude', 'projects')
const OPENCODE_MESSAGE_ROOT = path.join(HOME, '.local', 'share', 'opencode', 'storage', 'message')
const OPENCODE_PART_ROOT = path.join(HOME, '.local', 'share', 'opencode', 'storage', 'part')
const CODEX_SESSIONS_ROOT = path.join(HOME, '.codex', 'sessions')
const DEFAULT_PI_AGENT_ROOT = path.join(HOME, '.pi', 'agent')

const createEmptyCounts = (): Record<AgentSessionSource, number> => ({
  claude: 0,
  opencode: 0,
  codex: 0,
  pi: 0,
})

const isRecord = (value: unknown): value is JsonRecord => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const safeReadDir = (targetPath: string) => {
  try {
    return readdirSync(targetPath, { withFileTypes: true })
  } catch {
    return []
  }
}

const safeStat = (targetPath: string) => {
  try {
    return statSync(targetPath)
  } catch {
    return null
  }
}

const readFileHead = (filePath: string, maxBytes = MAX_HEAD_BYTES) => {
  const fileDescriptor = openSync(filePath, 'r')
  const buffer = Buffer.alloc(maxBytes)

  try {
    const size = readSync(fileDescriptor, buffer, 0, maxBytes, 0)
    return buffer.subarray(0, size).toString('utf8')
  } finally {
    closeSync(fileDescriptor)
  }
}

const readJsonFile = (filePath: string) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as JsonRecord
  } catch {
    return null
  }
}

const resolveHomeRelativePath = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === '~') return HOME
  if (trimmed.startsWith('~/')) return path.join(HOME, trimmed.slice(2))
  return trimmed
}

const getPiAgentDir = () => {
  const configured = loadWorkerConfig().piAgentDir?.trim()
  return path.resolve(resolveHomeRelativePath(configured || process.env.PI_AGENT_DIR?.trim() || DEFAULT_PI_AGENT_ROOT))
}

const getPiSessionRoots = () => {
  const agentDir = getPiAgentDir()
  const settings = readJsonFile(path.join(agentDir, 'settings.json'))
  const sessionDir = typeof settings?.sessionDir === 'string' ? resolveHomeRelativePath(settings.sessionDir) : ''
  const configuredRoot = !sessionDir
    ? path.join(agentDir, 'sessions')
    : path.isAbsolute(sessionDir)
      ? path.resolve(sessionDir)
      : path.resolve(agentDir, sessionDir)

  return Array.from(new Set([
    configuredRoot,
    path.join(agentDir, 'sessions'),
    path.join(agentDir, 'sessions-wemux'),
  ]))
}

const parseJsonLines = (content: string) => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonRecord]
      } catch {
        return []
      }
    })
}

const collectFiles = (root: string, extension: string) => {
  if (!existsSync(root)) return []

  const results: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of safeReadDir(current)) {
      const resolvedPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(resolvedPath)
        continue
      }

      if (entry.isFile() && resolvedPath.endsWith(extension)) {
        results.push(resolvedPath)
      }
    }
  }

  return results
}

const toIsoString = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return undefined
}

const clampText = (value: string, maxLength = 240) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

const truncateEntryText = (value: string, maxLength = MAX_ENTRY_TEXT_LENGTH) => {
  const normalized = value.trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}\n\n…（内容过长，已按安全上限截断）`
}

const pickText = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (!isRecord(item)) return []
      if (typeof item.text === 'string') return [item.text]
      if (typeof item.content === 'string') return [item.content]
      return []
    })
    .join('\n\n')
    .trim()
}

const buildSummary = (summary: AgentSessionSummary) => {
  return {
    ...summary,
    title: clampText(summary.title || '未命名会话', 96),
    cwd: summary.cwd || '—',
  }
}

const listClaudeSessions = () => {
  return collectFiles(CLAUDE_PROJECTS_ROOT, '.jsonl').flatMap((filePath) => {
    const stat = safeStat(filePath)
    if (!stat) return []

    const headRecords = parseJsonLines(readFileHead(filePath))
    const id = path.basename(filePath, '.jsonl')
    const startedAt = headRecords.map((item) => toIsoString(item.timestamp)).find(Boolean)
    const cwd = headRecords.map((item) => typeof item.cwd === 'string' ? item.cwd : '').find(Boolean) || ''
    const title = headRecords
      .flatMap((item) => {
        const message = isRecord(item.message) ? item.message : null
        if (!message || message.role !== 'user') return []
        const text = pickText(message.content)
        if (!text || isExecutorAgentSessionBoilerplatePrompt(text)) return []
        return [text]
      })
      .find(Boolean) || 'Claude Code 会话'

    return [buildSummary({
      id,
      source: 'claude',
      title,
      cwd,
      startedAt,
      lastUpdatedAt: stat.mtime.toISOString(),
      entryCount: 0,
    })]
  })
}

const extractClaudeEntries = (record: JsonRecord): AgentSessionEntry[] => {
  const message = isRecord(record.message) ? record.message : null
  if (!message || (record.isMeta === true)) return []

  const timestamp = toIsoString(record.timestamp)
  const role = typeof message.role === 'string' ? message.role : typeof record.type === 'string' ? record.type : 'system'
  const content = message.content

  if (role === 'user' || role === 'system') {
    const text = pickText(content)
    if (!text || isExecutorAgentSessionBoilerplatePrompt(text)) return []
    return [{ id: `${String(record.uuid || record.sessionId || timestamp || Math.random())}`, role: role === 'user' ? 'user' : 'system', text: truncateEntryText(text), timestamp } satisfies AgentSessionEntry]
  }

  if (role !== 'assistant' || !Array.isArray(content)) {
    return []
  }

  return content.flatMap<AgentSessionEntry>((item, index) => {
    if (!isRecord(item)) return []
    if (typeof item.text === 'string' && item.type === 'text') {
      return [{ id: `${String(record.uuid || record.sessionId || timestamp || index)}-${index}`, role: 'assistant', text: truncateEntryText(item.text), timestamp } satisfies AgentSessionEntry]
    }

    if (item.type === 'tool_use' && typeof item.name === 'string') {
      return [{ id: `${String(record.uuid || record.sessionId || timestamp || index)}-${index}`, role: 'tool', text: truncateEntryText(`调用工具：${item.name}`), timestamp } satisfies AgentSessionEntry]
    }

    return []
  })
}

const readClaudeSession = (sessionId: string) => {
  const matches = collectFiles(CLAUDE_PROJECTS_ROOT, '.jsonl').filter((filePath) => path.basename(filePath, '.jsonl') === sessionId)
  const filePath = matches[0]
  if (!filePath) return null

  const records = parseJsonLines(readFileSync(filePath, 'utf8'))
  const stat = safeStat(filePath)
  const cwd = records.map((item) => typeof item.cwd === 'string' ? item.cwd : '').find(Boolean) || ''
  const title = records
    .flatMap((item) => {
      const message = isRecord(item.message) ? item.message : null
      if (!message || message.role !== 'user') return []
      const text = pickText(message.content)
      if (!text || isExecutorAgentSessionBoilerplatePrompt(text)) return []
      return [text]
    })
    .find(Boolean) || 'Claude Code 会话'
  const startedAt = records.map((item) => toIsoString(item.timestamp)).find(Boolean)
  const entries = records.flatMap(extractClaudeEntries)

  return {
    ...buildSummary({
      id: sessionId,
      source: 'claude',
      title,
      cwd,
      startedAt,
      lastUpdatedAt: stat?.mtime.toISOString() || new Date().toISOString(),
      entryCount: entries.length,
    }),
    entries,
  } satisfies AgentSessionDetail
}

const listCodexSessions = () => {
  return collectFiles(CODEX_SESSIONS_ROOT, '.jsonl').flatMap((filePath) => {
    const stat = safeStat(filePath)
    if (!stat) return []

    const headRecords = parseJsonLines(readFileHead(filePath))
    const sessionMeta = headRecords.find((item) => item.type === 'session_meta')
    const payload = isRecord(sessionMeta?.payload) ? sessionMeta.payload : null
    const cwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
    const startedAt = toIsoString(payload?.timestamp) || headRecords.map((item) => toIsoString(item.timestamp)).find(Boolean)
    const title = headRecords
      .flatMap((item) => extractCodexEntries(item, true))
      .map((entry) => entry.text)
      .find((text) => !isExecutorAgentSessionBoilerplatePrompt(text)) || 'Codex 会话'

    return [buildSummary({
      id: path.basename(filePath, '.jsonl'),
      source: 'codex',
      title,
      cwd,
      startedAt,
      lastUpdatedAt: stat.mtime.toISOString(),
      entryCount: 0,
    })]
  })
}

const extractCodexEntries = (record: JsonRecord, userOnly = false): AgentSessionEntry[] => {
  if (record.type !== 'response_item') return []

  const payload = isRecord(record.payload) ? record.payload : null
  if (!payload) return []
  const timestamp = toIsoString(record.timestamp)

  if (payload.type === 'message') {
    const role = payload.role
    if (role !== 'user' && role !== 'assistant') return []

    const texts = Array.isArray(payload.content)
      ? payload.content
          .flatMap((item) => {
            if (!isRecord(item)) return []
            if (typeof item.text === 'string' && (item.type === 'input_text' || item.type === 'text' || item.type === 'output_text' || item.type === 'summary_text')) {
              return [item.text]
            }

            if (!userOnly && item.type === 'tool_use' && typeof item.name === 'string') {
              return [`调用工具：${item.name}`]
            }

            return []
          })
          .join('\n\n')
          .trim()
      : ''

    if (!texts) return []
    if (role === 'user' && isExecutorAgentSessionBoilerplatePrompt(texts)) return []
    if (userOnly && role !== 'user') return []
    return [{ id: `${String(record.timestamp || Math.random())}-${role}`, role, text: truncateEntryText(texts), timestamp } satisfies AgentSessionEntry]
  }

  if (userOnly || payload.type !== 'function_call') return []

  const name = typeof payload.name === 'string' ? payload.name : 'tool'
  const argumentsPreview = clampText(typeof payload.arguments === 'string' ? payload.arguments : '')
  return [{
    id: `${String(record.timestamp || Math.random())}-tool`,
    role: 'tool',
    text: truncateEntryText(argumentsPreview ? `调用 ${name}\n${argumentsPreview}` : `调用 ${name}`),
    timestamp,
  } satisfies AgentSessionEntry]
}

const readCodexSession = (sessionId: string) => {
  const matches = collectFiles(CODEX_SESSIONS_ROOT, '.jsonl').filter((filePath) => path.basename(filePath, '.jsonl') === sessionId)
  const filePath = matches[0]
  if (!filePath) return null

  const records = parseJsonLines(readFileSync(filePath, 'utf8'))
  const stat = safeStat(filePath)
  const sessionMeta = records.find((item) => item.type === 'session_meta')
  const payload = isRecord(sessionMeta?.payload) ? sessionMeta.payload : null
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
  const startedAt = toIsoString(payload?.timestamp) || records.map((item) => toIsoString(item.timestamp)).find(Boolean)
  const entries = records.flatMap((item) => extractCodexEntries(item))
  const title = entries.find((entry) => entry.role === 'user' && !isExecutorAgentSessionBoilerplatePrompt(entry.text))?.text || 'Codex 会话'

  return {
    ...buildSummary({
      id: sessionId,
      source: 'codex',
      title,
      cwd,
      startedAt,
      lastUpdatedAt: stat?.mtime.toISOString() || new Date().toISOString(),
      entryCount: entries.length,
    }),
    entries,
  } satisfies AgentSessionDetail
}

const readOpenCodeParts = (messageId: string) => {
  const directoryPath = path.join(OPENCODE_PART_ROOT, messageId)
  return safeReadDir(directoryPath)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJsonFile(path.join(directoryPath, entry.name)))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .sort((left, right) => {
      const leftTime = isRecord(left.time) && typeof left.time.start === 'number' ? left.time.start : 0
      const rightTime = isRecord(right.time) && typeof right.time.start === 'number' ? right.time.start : 0
      return leftTime - rightTime
    })
}

const extractOpenCodeText = (message: JsonRecord) => {
  const text = readOpenCodeParts(String(message.id))
    .flatMap((part) => part.type === 'text' && typeof part.text === 'string' ? [part.text.trim()] : [])
    .filter(Boolean)
    .join('\n\n')

  if (text) return text

  const summary = isRecord(message.summary) ? message.summary : null
  if (typeof summary?.title === 'string') {
    return summary.title.replace(/^Title:\s*/i, '').trim()
  }

  return ''
}

const serializeJsonValue = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return ''
  }
}

const hasMeaningfulStructuredText = (value: string) => {
  const normalized = value.trim()
  return Boolean(normalized && normalized !== '{}' && normalized !== '[]')
}

const getOpenCodeMessageTimestamp = (message: JsonRecord) => {
  const time = isRecord(message.time) ? message.time : null
  return toIsoString(time?.created) || toIsoString(time?.completed)
}

const getOpenCodePartTimestamp = (part: JsonRecord, fallback?: string) => {
  const time = isRecord(part.time) ? part.time : null
  return toIsoString(time?.start) || toIsoString(time?.end) || fallback
}

const buildOpenCodeToolText = (part: JsonRecord) => {
  const toolName = typeof part.tool === 'string' && part.tool.trim() ? part.tool.trim() : 'tool'
  const state = isRecord(part.state) ? part.state : null
  const rawInput = typeof state?.raw === 'string' ? state.raw.trim() : ''
  const serializedInput = serializeJsonValue(state?.input)
  const input = rawInput || (hasMeaningfulStructuredText(serializedInput) ? serializedInput : '')
  const output = typeof state?.output === 'string' ? state.output.trim() : ''
  const error = typeof state?.error === 'string' ? state.error.trim() : ''
  const status = typeof state?.status === 'string' ? state.status : ''
  const header = status === 'error'
    ? `工具报错：${toolName}`
    : status === 'completed'
      ? `工具结果：${toolName}`
      : `调用工具：${toolName}`

  return [header, input, status === 'error' ? error : output]
    .filter(Boolean)
    .join('\n')
}

const extractOpenCodeEntries = (message: JsonRecord): AgentSessionEntry[] => {
  const role = message.role
  const messageId = typeof message.id === 'string' || typeof message.id === 'number'
    ? String(message.id)
    : `opencode-${Math.random()}`
  const timestamp = getOpenCodeMessageTimestamp(message)

  if (role === 'user') {
    const text = extractOpenCodeText(message)
    if (!text || isExecutorAgentSessionBoilerplatePrompt(text)) {
      return []
    }

    return [{
      id: messageId,
      role: 'user',
      text: truncateEntryText(text),
      timestamp,
    } satisfies AgentSessionEntry]
  }

  if (role !== 'assistant') {
    return []
  }

  const partEntries = readOpenCodeParts(messageId).flatMap<AgentSessionEntry>((part, index) => {
    const partId = typeof part.id === 'string' || typeof part.id === 'number'
      ? String(part.id)
      : `${messageId}-part-${index}`
    const partTimestamp = getOpenCodePartTimestamp(part, timestamp)

    if (part.type === 'text' && typeof part.text === 'string') {
      const text = truncateEntryText(part.text)
      return text
        ? [{ id: partId, role: 'assistant', text, timestamp: partTimestamp } satisfies AgentSessionEntry]
        : []
    }

    if (part.type === 'reasoning' && typeof part.text === 'string') {
      const text = truncateEntryText(part.text)
      return text
        ? [{ id: partId, role: 'system', text, timestamp: partTimestamp } satisfies AgentSessionEntry]
        : []
    }

    if (part.type === 'tool') {
      const text = truncateEntryText(buildOpenCodeToolText(part))
      return text
        ? [{ id: partId, role: 'tool', text, timestamp: partTimestamp } satisfies AgentSessionEntry]
        : []
    }

    return []
  })

  if (partEntries.length > 0) {
    return partEntries
  }

  const text = extractOpenCodeText(message)
  if (!text) {
    return []
  }

  return [{
    id: messageId,
    role: 'assistant',
    text: truncateEntryText(text),
    timestamp,
  } satisfies AgentSessionEntry]
}

const extractPiTextBlocks = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .flatMap((item) => {
      if (!isRecord(item)) return []
      if (item.type === 'text' && typeof item.text === 'string') return [item.text]
      if (typeof item.text === 'string') return [item.text]
      return []
    })
    .join('\n\n')
    .trim()
}

const extractPiEntries = (record: JsonRecord): AgentSessionEntry[] => {
  if (record.type !== 'message') {
    return []
  }

  const message = isRecord(record.message) ? record.message : null
  if (!message) {
    return []
  }

  const role = typeof message.role === 'string' ? message.role : 'system'
  const timestamp = toIsoString(record.timestamp) || toIsoString(message.timestamp)
  const entryId = typeof record.id === 'string' ? record.id : String(record.timestamp || Math.random())

  if (role === 'user') {
    const text = extractPiTextBlocks(message.content)
    if (!text || isExecutorAgentSessionBoilerplatePrompt(text)) {
      return []
    }

    return [{ id: entryId, role: 'user', text: truncateEntryText(text), timestamp } satisfies AgentSessionEntry]
  }

  if (role === 'assistant') {
    const content = Array.isArray(message.content) ? message.content : []
    const text = content
      .flatMap((item) => {
        if (!isRecord(item)) return []
        return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
      })
      .join('\n\n')
      .trim()
    const toolEntries = content.flatMap<AgentSessionEntry>((item, index) => {
      if (!isRecord(item) || item.type !== 'toolCall' || typeof item.name !== 'string') {
        return []
      }

      const args = clampText(JSON.stringify(item.arguments ?? {}, null, 2), 600)
      return [{
        id: `${entryId}-tool-${index}`,
        role: 'tool',
        text: truncateEntryText(args && args !== '{}'
          ? `调用工具：${item.name}\n${args}`
          : `调用工具：${item.name}`),
        timestamp,
      } satisfies AgentSessionEntry]
    })

    return [
      ...(text ? [{ id: `${entryId}-assistant`, role: 'assistant', text: truncateEntryText(text), timestamp } satisfies AgentSessionEntry] : []),
      ...toolEntries,
    ]
  }

  if (role === 'toolResult') {
    const toolName = typeof message.toolName === 'string' ? message.toolName : 'tool'
    const text = extractPiTextBlocks(message.content)
    const prefix = message.isError === true ? `工具报错：${toolName}` : `工具结果：${toolName}`
    return [{
      id: `${entryId}-tool-result`,
      role: 'tool',
      text: truncateEntryText(text ? `${prefix}\n${text}` : prefix),
      timestamp,
    } satisfies AgentSessionEntry]
  }

  if (role === 'bashExecution') {
    const command = typeof message.command === 'string' ? message.command.trim() : ''
    const output = typeof message.output === 'string' ? message.output.trim() : ''
    const header = command ? `执行命令：${command}` : '执行命令'
    return [{
      id: `${entryId}-bash`,
      role: 'tool',
      text: truncateEntryText(output ? `${header}\n${output}` : header),
      timestamp,
    } satisfies AgentSessionEntry]
  }

  if (role === 'branchSummary' || role === 'compactionSummary') {
    const summary = typeof message.summary === 'string' ? message.summary.trim() : ''
    if (!summary) {
      return []
    }

    return [{
      id: `${entryId}-summary`,
      role: 'system',
      text: truncateEntryText(summary),
      timestamp,
    } satisfies AgentSessionEntry]
  }

  if (role === 'custom') {
    const text = extractPiTextBlocks(message.content)
    if (!text) {
      return []
    }

    return [{
      id: `${entryId}-custom`,
      role: 'system',
      text: truncateEntryText(text),
      timestamp,
    } satisfies AgentSessionEntry]
  }

  return []
}

const buildPiSummaryFromFile = (filePath: string) => {
  const stat = safeStat(filePath)
  if (!stat) return null

  const records = parseJsonLines(readFileSync(filePath, 'utf8'))
  const header = records.find((record) => record.type === 'session')
  const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
  const startedAt = toIsoString(header?.timestamp) || records.map((record) => toIsoString(record.timestamp)).find(Boolean)
  const entries = records.flatMap(extractPiEntries)
  const title = entries.find((entry) => entry.role === 'user' && !isExecutorAgentSessionBoilerplatePrompt(entry.text))?.text || 'Pi 会话'

  return buildSummary({
    id: path.basename(filePath, '.jsonl'),
    source: 'pi',
    title,
    cwd,
    startedAt,
    lastUpdatedAt: stat.mtime.toISOString(),
    entryCount: entries.length,
  })
}

const readOpenCodeMessages = (sessionId: string) => {
  const directoryPath = path.join(OPENCODE_MESSAGE_ROOT, sessionId)

  return safeReadDir(directoryPath)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJsonFile(path.join(directoryPath, entry.name)))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .sort((left, right) => {
      const leftTime = isRecord(left.time) && typeof left.time.created === 'number' ? left.time.created : 0
      const rightTime = isRecord(right.time) && typeof right.time.created === 'number' ? right.time.created : 0
      return leftTime - rightTime
    })
}

const buildOpenCodeSummary = (sessionId: string) => {
  const directoryPath = path.join(OPENCODE_MESSAGE_ROOT, sessionId)
  const stat = safeStat(directoryPath)
  const messages = readOpenCodeMessages(sessionId)
  if (messages.length === 0) return null

  const cwd = messages
    .flatMap((item) => {
      const pathInfo = isRecord(item.path) ? item.path : null
      return typeof pathInfo?.cwd === 'string' ? [pathInfo.cwd] : []
    })
    .find(Boolean) || ''
  const startedAt = messages.map((item) => toIsoString(isRecord(item.time) ? item.time.created : undefined)).find(Boolean)
  const lastUpdatedAt = messages
    .map((item) => {
      const time = isRecord(item.time) ? item.time : null
      return toIsoString(time?.completed) || toIsoString(time?.created)
    })
    .filter(Boolean)
    .pop() || stat?.mtime.toISOString() || new Date().toISOString()
  const title = messages
    .filter((item) => item.role === 'user')
    .map(extractOpenCodeText)
    .find((text) => Boolean(text) && !isExecutorAgentSessionBoilerplatePrompt(text)) || 'OpenCode 会话'

  return buildSummary({
    id: sessionId,
    source: 'opencode',
    title,
    cwd,
    startedAt,
    lastUpdatedAt,
    entryCount: messages.length,
  })
}

const listOpenCodeSessions = () => {
  if (!existsSync(OPENCODE_MESSAGE_ROOT)) return []

  return safeReadDir(OPENCODE_MESSAGE_ROOT)
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const summary = buildOpenCodeSummary(entry.name)
      return summary ? [summary] : []
    })
}

const listPiSessions = () => {
  const seenPaths = new Set<string>()
  const filePaths = getPiSessionRoots()
    .flatMap((root) => existsSync(root) ? collectFiles(root, '.jsonl') : [])
    .filter((filePath) => {
      if (seenPaths.has(filePath)) {
        return false
      }

      seenPaths.add(filePath)
      return true
    })

  return filePaths.flatMap((filePath) => {
    const summary = buildPiSummaryFromFile(filePath)
    return summary ? [summary] : []
  })
}

const readOpenCodeSession = (sessionId: string) => {
  const summary = buildOpenCodeSummary(sessionId)
  if (!summary) return null

  const entries = readOpenCodeMessages(sessionId).flatMap(extractOpenCodeEntries)

  return {
    ...summary,
    entryCount: entries.length,
    entries,
  } satisfies AgentSessionDetail
}

const readPiSession = (sessionId: string) => {
  const matches = getPiSessionRoots()
    .flatMap((root) => existsSync(root) ? collectFiles(root, '.jsonl') : [])
    .filter((filePath) => path.basename(filePath, '.jsonl') === sessionId)
  const filePath = matches[0]
  if (!filePath) return null

  const summary = buildPiSummaryFromFile(filePath)
  if (!summary) return null

  const records = parseJsonLines(readFileSync(filePath, 'utf8'))
  const entries = records.flatMap(extractPiEntries)

  return {
    ...summary,
    entryCount: entries.length,
    entries,
  } satisfies AgentSessionDetail
}

export const listLocalAgentSessions = (): AgentSessionsPayload => {
  const sessions = [
    ...listClaudeSessions(),
    ...listOpenCodeSessions(),
    ...listCodexSessions(),
    ...listPiSessions(),
  ].sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))

  const counts = sessions.reduce((result, session) => {
    result[session.source] += 1
    return result
  }, createEmptyCounts())

  return { ok: true, sessions, counts }
}

export const readLocalAgentSession = (source: AgentSessionSource, sessionId: string) => {
  if (source === 'claude') return readClaudeSession(sessionId)
  if (source === 'opencode') return readOpenCodeSession(sessionId)
  if (source === 'pi') return readPiSession(sessionId)
  return readCodexSession(sessionId)
}

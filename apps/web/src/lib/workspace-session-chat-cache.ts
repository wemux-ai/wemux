import { normalizeTaskChatAttachments, type TaskChatAttachment } from '@shared/task-chat-attachment'
import { normalizeTaskChatContextRefs, type TaskChatContextRef } from '@shared/task-chat-context'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  ConversationMessageRecord,
  ConversationRecord,
  TaskConversationPayload,
} from './api'

type CacheEntry<T> = {
  value: T
  updatedAt: number
}

export type TaskChatComposerCache = {
  input: string
  history: string[]
  images: TaskChatAttachment[]
  contextRefs: TaskChatContextRef[]
}

const MAX_CACHE_SIZE = 24
const MAX_COMPOSER_HISTORY_SIZE = 32
const MAX_PERSISTED_CONVERSATION_MESSAGES = 10
const MAX_PERSISTED_COMPOSER_INPUT_LENGTH = 16_000
const MAX_PERSISTED_COMPOSER_HISTORY_ENTRY_LENGTH = 4_000
const MAX_PERSISTED_COMPOSER_IMAGES = 12
const TASK_CHAT_CONVERSATION_STORAGE_KEY_PREFIX = 'vibemux-task-chat-conversation'
const TASK_CHAT_COMPOSER_STORAGE_KEY_PREFIX = 'vibemux-task-chat-composer'

const conversationCache = new Map<string, CacheEntry<TaskConversationPayload>>()
const sessionCache = new Map<string, CacheEntry<TaskChatSessionSnapshot>>()
const composerCache = new Map<string, CacheEntry<TaskChatComposerCache>>()

const normalizeScopePart = (value?: string) => value?.trim() || ''

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const buildTaskChatScopeKey = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  return [
    taskId.trim(),
    normalizeScopePart(workspaceId) || 'workspace',
    normalizeScopePart(workspaceSessionId) || 'latest',
  ].join('::')
}

const buildTaskChatConversationStorageKey = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  return `${TASK_CHAT_CONVERSATION_STORAGE_KEY_PREFIX}:${buildTaskChatScopeKey(taskId, workspaceId, workspaceSessionId)}`
}

const buildTaskChatComposerStorageKey = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  return `${TASK_CHAT_COMPOSER_STORAGE_KEY_PREFIX}:${buildTaskChatScopeKey(taskId, workspaceId, workspaceSessionId)}`
}

const trimCache = <T>(cache: Map<string, CacheEntry<T>>) => {
  while (cache.size > MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      return
    }
    cache.delete(oldestKey)
  }
}

const setCacheEntry = <T>(
  cache: Map<string, CacheEntry<T>>,
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  value: T,
) => {
  const key = buildTaskChatScopeKey(taskId, workspaceId, workspaceSessionId)
  cache.delete(key)
  cache.set(key, {
    value,
    updatedAt: Date.now(),
  })
  trimCache(cache)
}

const getCacheEntry = <T>(
  cache: Map<string, CacheEntry<T>>,
  taskId: string,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
  const key = buildTaskChatScopeKey(taskId, workspaceId, workspaceSessionId)
  return cache.get(key)?.value ?? null
}

const normalizeConversationRecord = (value: unknown): ConversationRecord | null => {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.kind !== 'string'
    || typeof value.chatMode !== 'string'
    || typeof value.status !== 'string'
    || typeof value.externalSyncMode !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
    workspaceSessionId: typeof value.workspaceSessionId === 'string' ? value.workspaceSessionId : undefined,
    projectId: typeof value.projectId === 'string' ? value.projectId : undefined,
    taskId: typeof value.taskId === 'string' ? value.taskId : undefined,
    title: value.title,
    kind: value.kind as ConversationRecord['kind'],
    chatMode: value.chatMode as ConversationRecord['chatMode'],
    status: value.status as ConversationRecord['status'],
    externalSyncMode: value.externalSyncMode as ConversationRecord['externalSyncMode'],
    orchestratorAgentId: typeof value.orchestratorAgentId === 'string' ? value.orchestratorAgentId : undefined,
    executorId: typeof value.executorId === 'string' ? value.executorId : undefined,
    createdBy: typeof value.createdBy === 'string' ? value.createdBy : undefined,
    visibility: value.visibility === 'private' ? 'private' : 'public',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

const normalizeConversationMessage = (value: unknown): ConversationMessageRecord | null => {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.id !== 'string'
    || typeof value.conversationId !== 'string'
    || typeof value.role !== 'string'
    || typeof value.content !== 'string'
    || typeof value.contentType !== 'string'
    || typeof value.createdAt !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    conversationId: value.conversationId,
    role: value.role as ConversationMessageRecord['role'],
    senderId: typeof value.senderId === 'string' ? value.senderId : undefined,
    content: value.content,
    contentType: value.contentType as ConversationMessageRecord['contentType'],
    replyToMessageId: typeof value.replyToMessageId === 'string' ? value.replyToMessageId : undefined,
    externalRef: isRecord(value.externalRef) ? value.externalRef : undefined,
    createdAt: value.createdAt,
  }
}

const normalizeConversationPayload = (value: unknown): TaskConversationPayload | null => {
  if (!isRecord(value)) {
    return null
  }

  const conversation = normalizeConversationRecord(value.conversation)
  if (!conversation || !Array.isArray(value.messages)) {
    return null
  }

  const messages = value.messages
    .map((message) => normalizeConversationMessage(message))
    .filter((message): message is ConversationMessageRecord => Boolean(message))

  const totalMessageCount = typeof value.totalMessageCount === 'number' && Number.isFinite(value.totalMessageCount)
    ? value.totalMessageCount
    : messages.length
  const windowMessages = messages.slice(-MAX_PERSISTED_CONVERSATION_MESSAGES)

  return {
    conversation,
    messages: windowMessages,
    totalMessageCount,
    returnedMessageCount: windowMessages.length,
    hasMoreBefore: Boolean(value.hasMoreBefore) || totalMessageCount > windowMessages.length || messages.length > windowMessages.length,
    recentTurns: typeof value.recentTurns === 'number' && Number.isFinite(value.recentTurns)
      ? value.recentTurns
      : undefined,
  }
}

const shrinkConversationPayloadForStorage = (value: TaskConversationPayload): TaskConversationPayload => {
  const messages = value.messages.slice(-MAX_PERSISTED_CONVERSATION_MESSAGES)
  return {
    ...value,
    messages,
    returnedMessageCount: messages.length,
    hasMoreBefore: value.hasMoreBefore || value.messages.length > messages.length || value.totalMessageCount > messages.length,
  }
}

export const getCachedTaskConversation = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  const memoryEntry = getCacheEntry(conversationCache, taskId, workspaceId, workspaceSessionId)
  if (memoryEntry) {
    return memoryEntry
  }

  if (typeof window === 'undefined') {
    return null
  }

  try {
    const storageKey = buildTaskChatConversationStorageKey(taskId, workspaceId, workspaceSessionId)
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return null
    }

    const normalized = normalizeConversationPayload(JSON.parse(raw))
    if (!normalized) {
      window.localStorage.removeItem(storageKey)
      return null
    }

    setCacheEntry(conversationCache, taskId, workspaceId, workspaceSessionId, normalized)
    return normalized
  } catch {
    return null
  }
}

export const setCachedTaskConversation = (
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  value: TaskConversationPayload,
) => {
  const persistedValue = shrinkConversationPayloadForStorage(value)
  setCacheEntry(conversationCache, taskId, workspaceId, workspaceSessionId, persistedValue)

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      buildTaskChatConversationStorageKey(taskId, workspaceId, workspaceSessionId),
      JSON.stringify(persistedValue),
    )
  } catch {
    // Ignore storage quota / private mode failures and keep the in-memory cache.
  }
}

export const getCachedTaskChatSession = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  return getCacheEntry(sessionCache, taskId, workspaceId, workspaceSessionId)
}

export const setCachedTaskChatSession = (
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  value: TaskChatSessionSnapshot,
) => {
  setCacheEntry(sessionCache, taskId, workspaceId, workspaceSessionId, value)
}

const normalizeComposerHistory = (history: unknown) => {
  if (!Array.isArray(history)) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []
  for (const entry of history) {
    if (typeof entry !== 'string') {
      continue
    }

    const value = entry.trim()
    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    normalized.push(value)
  }

  return normalized.slice(-MAX_COMPOSER_HISTORY_SIZE)
}

const truncatePersistedComposerText = (value: string, maxLength: number) => {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

const isPersistableComposerImage = (image: TaskChatAttachment) => {
  return !/^(blob:|data:)/i.test(image.url)
}

const normalizeComposerCache = (value: unknown): TaskChatComposerCache | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const parsed = value as Partial<TaskChatComposerCache>
  return {
    input: typeof parsed.input === 'string' ? parsed.input : '',
    history: normalizeComposerHistory(parsed.history),
    images: normalizeTaskChatAttachments(parsed.images),
    contextRefs: normalizeTaskChatContextRefs(parsed.contextRefs),
  }
}

const shrinkComposerCacheForStorage = (value: TaskChatComposerCache): TaskChatComposerCache => {
  return {
    input: truncatePersistedComposerText(value.input, MAX_PERSISTED_COMPOSER_INPUT_LENGTH),
    history: normalizeComposerHistory(value.history).map((entry) => {
      return truncatePersistedComposerText(entry, MAX_PERSISTED_COMPOSER_HISTORY_ENTRY_LENGTH)
    }),
    images: normalizeTaskChatAttachments(value.images)
      .filter(isPersistableComposerImage)
      .slice(-MAX_PERSISTED_COMPOSER_IMAGES),
    contextRefs: normalizeTaskChatContextRefs(value.contextRefs),
  }
}

export const getCachedTaskChatComposer = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  const memoryEntry = getCacheEntry(composerCache, taskId, workspaceId, workspaceSessionId)
  if (memoryEntry) {
    return memoryEntry
  }

  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(buildTaskChatComposerStorageKey(taskId, workspaceId, workspaceSessionId))
    if (!raw) {
      return null
    }

    const normalized = normalizeComposerCache(JSON.parse(raw))
    if (!normalized) {
      window.localStorage.removeItem(buildTaskChatComposerStorageKey(taskId, workspaceId, workspaceSessionId))
      return null
    }

    setCacheEntry(composerCache, taskId, workspaceId, workspaceSessionId, normalized)
    return normalized
  } catch {
    return null
  }
}

export const setCachedTaskChatComposer = (
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  value: TaskChatComposerCache,
) => {
  const normalized: TaskChatComposerCache = {
    input: value.input,
    history: normalizeComposerHistory(value.history),
    images: normalizeTaskChatAttachments(value.images),
    contextRefs: normalizeTaskChatContextRefs(value.contextRefs),
  }

  setCacheEntry(composerCache, taskId, workspaceId, workspaceSessionId, normalized)

  if (typeof window === 'undefined') {
    return
  }

  const storageKey = buildTaskChatComposerStorageKey(taskId, workspaceId, workspaceSessionId)
  if (!normalized.input && normalized.history.length === 0 && normalized.images.length === 0 && normalized.contextRefs.length === 0) {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Ignore storage failures and keep the in-memory cache.
    }
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(shrinkComposerCacheForStorage(normalized)))
  } catch {
    // Ignore storage quota / private mode failures and keep the in-memory cache.
  }
}

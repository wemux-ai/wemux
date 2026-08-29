import { and, eq } from 'drizzle-orm'

import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { schedulePersistence } from './helpers'
import { appMeta, telegramChats, telegramSessions } from './schema'

type TelegramConfig = {
  botToken: string
  mainChatId: string
  webhookUrl: string
}

type TelegramChat = {
  chat_id: string
  thread_id: string | null
  type: 'group' | 'main' | 'task'
  entity_id: string | null
}

const TELEGRAM_META_KEY = 'telegram_config'

const cache = {
  config: {
    botToken: '',
    mainChatId: '',
    webhookUrl: '',
  } satisfies TelegramConfig,
  chats: [] as TelegramChat[],
  sessions: new Map<string, Record<string, unknown>>(),
}

const mapChatRow = (row: typeof telegramChats.$inferSelect): TelegramChat => ({
  chat_id: row.chatId,
  thread_id: row.threadId,
  type: row.type,
  entity_id: row.entityId,
})

export const initTelegramStore = async () => {
  await ensurePostgresReady()
  const [metaRows, chatRows, sessionRows] = await Promise.all([
    getDrizzleDb()
      .select({ value: appMeta.value })
      .from(appMeta)
      .where(eq(appMeta.key, TELEGRAM_META_KEY))
      .limit(1),
    getDrizzleDb().select().from(telegramChats),
    getDrizzleDb().select({ id: telegramSessions.id, stateJson: telegramSessions.stateJson }).from(telegramSessions),
  ])

  if (metaRows[0]?.value) {
    cache.config = {
      ...cache.config,
      ...(metaRows[0].value as Partial<TelegramConfig>),
    }
  }

  cache.chats = chatRows.map(mapChatRow)
  cache.sessions = new Map(sessionRows.map((row) => [row.id, row.stateJson]))
}

export const getTelegramConfigRecord = () => cache.config

export const saveTelegramConfigRecord = (config: Partial<TelegramConfig>) => {
  cache.config = {
    ...cache.config,
    ...config,
  }
  schedulePersistence('save-telegram-config', (async () => {
    await ensurePostgresReady()
    await getDrizzleDb()
      .insert(appMeta)
      .values({ key: TELEGRAM_META_KEY, value: cache.config })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: cache.config },
      })
  })())
  return cache.config
}

export const saveTelegramChatRecord = (chat: TelegramChat) => {
  const now = new Date().toISOString()
  const index = cache.chats.findIndex((item) => item.chat_id === chat.chat_id && item.thread_id === chat.thread_id)
  if (index >= 0) {
    cache.chats[index] = chat
  } else {
    cache.chats.push(chat)
  }
  schedulePersistence('save-telegram-chat', (async () => {
    await ensurePostgresReady()
    await getDrizzleDb()
      .insert(telegramChats)
      .values({
        chatId: chat.chat_id,
        threadId: chat.thread_id,
        type: chat.type,
        entityId: chat.entity_id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramChats.chatId, telegramChats.threadId],
        set: {
          type: chat.type,
          entityId: chat.entity_id,
          updatedAt: now,
        },
      })
  })())
}

export const getTelegramChatRecord = (chatId: string, threadId?: string) => {
  return cache.chats.find((chat) => chat.chat_id === chatId && (chat.thread_id ?? null) === (threadId ?? null)) ?? null
}

export const getChatByEntityIdRecord = (entityId: string) => {
  return cache.chats.find((chat) => chat.entity_id === entityId) ?? null
}

export const saveTelegramSessionRecord = (id: string, chatId: string, threadId: string | null, userId: string | null, state: Record<string, unknown> = {}) => {
  const now = new Date().toISOString()
  cache.sessions.set(id, state)
  schedulePersistence('save-telegram-session', (async () => {
    await ensurePostgresReady()
    await getDrizzleDb()
      .insert(telegramSessions)
      .values({
        id,
        chatId,
        threadId,
        userId,
        stateJson: state,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: telegramSessions.id,
        set: {
          chatId,
          threadId,
          userId,
          stateJson: state,
          updatedAt: now,
        },
      })
  })())
}

export const getTelegramSessionRecord = (id: string) => cache.sessions.get(id) ?? null

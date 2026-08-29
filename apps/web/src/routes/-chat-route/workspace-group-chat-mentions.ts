/**
 * [INPUT]: Group-chat message mention payloads and the current user id.
 * [OUTPUT]: Whether a message @-mentioned that user, plus last-seen persistence helpers.
 * [POS]: Pure mention matching for the `/chat` Feishu-style「有人 @ 你」indicator.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

const MENTION_SEEN_KEY = 'vibemux.workspace-group-chat.mention-seen'

type MentionEntry = { targetType?: string; targetId?: string }

/** 判断一条群聊消息是否 @ 到了当前用户（@用户 或 @所有人）。自己发的不计。 */
export const messageMentionsUserId = (
  message: { senderId?: string; externalRef?: Record<string, unknown> },
  userId: string | undefined,
) => {
  if (!userId || message.senderId === userId) return false
  const mentions = message.externalRef?.mentions
  if (!Array.isArray(mentions)) return false
  return mentions.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const target = entry as MentionEntry
    return target.targetType === 'all' || (target.targetType === 'user' && target.targetId === userId)
  })
}

export const readGroupChatMentionSeen = (): Record<string, string> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(MENTION_SEEN_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => (
        Boolean(entry[0].trim()) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
      )),
    )
  } catch {
    return {}
  }
}

export const writeGroupChatMentionSeen = (value: Record<string, string>) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MENTION_SEEN_KEY, JSON.stringify(value))
  } catch {
    // Ignore storage failures so the mention pill stays interactive.
  }
}

/** 在已加载消息里挑出尚未确认的 @我 消息（按时间升序）。 */
export const collectUnackedMentionIds = (
  messages: ReadonlyArray<{ id: string; createdAt: string; senderId?: string; externalRef?: Record<string, unknown> }>,
  userId: string | undefined,
  seenUntil?: string,
) => messages
  .filter((message) => messageMentionsUserId(message, userId))
  .filter((message) => !seenUntil || message.createdAt > seenUntil)
  .map((message) => message.id)

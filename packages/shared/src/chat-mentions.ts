/**
 * [INPUT]: Chat text and the currently addressable member or Agent names.
 * [OUTPUT]: Stable, ordered target ids for complete `@name` tokens.
 * [POS]: Shared mention parser so group-chat UI feedback and server dispatch agree.
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */
export type ChatMentionTarget = {
  id: string
  name: string
}

/** 消息中 @ 引用的 Drive 文档（mentionedType='doc' / mentionScope='reference_doc'）。 */
export type ChatDocReference = {
  id: string
  name: string
  workspaceId: string | null
}

/** 单个 mention 命中区间（渲染与 dispatch 共用底层匹配结果）。 */
export type ChatMentionMatch = {
  targetId: string
  targetIndex: number
  start: number
  end: number
}

/** 消息内命中的 mention 区间（按 start 升序、重叠取最长、同区间按 target 顺序稳定）。 */
export type ChatMentionRange = {
  targetId: string
  start: number
  end: number
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isMentionStart = (message: string, start: number) => (
  start === 0 || /[\s([\{]/.test(message[start - 1] ?? '')
)

const isMentionEnd = (message: string, end: number) => (
  end >= message.length || /[\s.,!?，。！？:：;；)\]}]/.test(message[end] ?? '')
)

const collectChatMentionMatches = (
  message: string,
  targets: readonly ChatMentionTarget[],
): ChatMentionMatch[] => {
  const matches = targets.flatMap((target, targetIndex) => {
    const name = target.name.trim()
    if (!target.id.trim() || !name) {
      return []
    }

    const matcher = new RegExp(`@${escapeRegExp(name)}`, 'giu')
    const items: ChatMentionMatch[] = []
    let match = matcher.exec(message)
    while (match) {
      const start = match.index
      const end = start + match[0].length
      if (isMentionStart(message, start) && isMentionEnd(message, end)) {
        items.push({ targetId: target.id, start, end, targetIndex })
      }
      match = matcher.exec(message)
    }
    return items
  })

  return matches.sort((left, right) => (
    left.start - right.start
    || (right.end - right.start) - (left.end - left.start)
    || left.targetIndex - right.targetIndex
  ))
}

export const resolveChatMentionTargetIds = (
  message: string,
  targets: readonly ChatMentionTarget[],
) => {
  const seenTargetIds = new Set<string>()
  const orderedTargetIds: string[] = []
  let previousEnd = -1
  for (const match of collectChatMentionMatches(message, targets)) {
    if (match.start < previousEnd || seenTargetIds.has(match.targetId)) {
      continue
    }

    orderedTargetIds.push(match.targetId)
    seenTargetIds.add(match.targetId)
    previousEnd = match.end
  }

  return orderedTargetIds
}

/** @所有人/@all 的别名，与 UI mention 选项的 label 保持一致。 */
export const ALL_MENTION_ALIASES = ['所有人', 'all', 'everyone']

/** 消息内是否包含完整的 @所有人/@all 提及（与具体成员/Agent 匹配互斥判断）。 */
export const hasAllMention = (message: string) => {
  for (const alias of ALL_MENTION_ALIASES) {
    const matcher = new RegExp(`@${escapeRegExp(alias)}`, 'giu')
    let match = matcher.exec(message)
    while (match) {
      const start = match.index
      const end = start + match[0].length
      if (isMentionStart(message, start) && isMentionEnd(message, end)) {
        return true
      }
      match = matcher.exec(message)
    }
  }
  return false
}

/**
 * 解析消息内全部 mention 区间（不去重、去重叠），供渲染层把 `@name` 高亮为可悬停节点。
 * 与 `resolveChatMentionTargetIds` 共用同一套匹配规则，保证渲染高亮与 dispatch 目标一致。
 */
export const resolveChatMentionRanges = (
  message: string,
  targets: readonly ChatMentionTarget[],
): ChatMentionRange[] => {
  const ranges: ChatMentionRange[] = []
  let previousEnd = -1
  for (const match of collectChatMentionMatches(message, targets)) {
    if (match.start < previousEnd) {
      continue
    }

    ranges.push({ targetId: match.targetId, start: match.start, end: match.end })
    previousEnd = match.end
  }

  return ranges
}

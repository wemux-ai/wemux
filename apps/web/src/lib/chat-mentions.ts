import type { ChatMentionOption } from '../components/chat/chat-mention-list'
import type { ChatMentionTarget } from '../components/chat/mention-text'

export type ActiveMentionRange = {
  start: number
  end: number
  query: string
}

/** @ 候选可寻址的人（用户成员 / Agent），主聊天与私聊复用。 */
export type MentionablePerson = {
  id: string
  name: string
  avatarUrl?: string
  description?: string
  keywords?: string[]
  /** 候选类型：默认用户成员；主聊天当前 Agent 传 'agent'。 */
  kind?: 'member' | 'agent'
}

/** 把可寻址的人转成 composer 的 @ 候选（与群聊 member/agent 选项 id 前缀一致）。 */
export const buildPersonMentionOptions = (
  people: readonly MentionablePerson[],
  kindLabel: string,
): ChatMentionOption[] =>
  people
    .filter((person) => person.id.trim() && person.name.trim())
    .map((person) => {
      const kind = person.kind ?? 'member'
      return {
        id: `${kind}:${person.id}`,
        kind,
        label: person.name.trim(),
        description: person.description,
        avatarUrl: person.avatarUrl?.trim() || undefined,
        kindLabel,
        keywords: [person.name.trim(), ...(person.keywords ?? [])],
      }
    })

/** remark-mentions 渲染目标：只含真实用户（Agent 与群聊一致不参与正文高亮）。 */
export const buildPersonMentionTargets = (
  people: readonly MentionablePerson[],
): ChatMentionTarget[] =>
  people
    .filter((person) => person.kind !== 'agent' && person.id.trim() && person.name.trim())
    .map((person) => ({
      id: person.id,
      name: person.name.trim(),
      ...(person.avatarUrl?.trim() ? { avatarUrl: person.avatarUrl.trim() } : {}),
    }))

/** 可提及的会话（按标题匹配，无标题自动过滤）。 */
export type MentionableConversation = {
  id: string
  title?: string | null
}

/** 把会话列表转成 composer 的 @会话 候选（id 前缀 conversation:，与群聊一致）。 */
export const buildConversationMentionOptions = (
  conversations: readonly MentionableConversation[],
  kindLabel: string,
): ChatMentionOption[] =>
  conversations
    .filter((conversation) => conversation.id.trim() && conversation.title?.trim())
    .map((conversation) => ({
      id: `conversation:${conversation.id}`,
      kind: 'conversation' as const,
      label: conversation.title!.trim(),
      description: kindLabel,
      kindLabel,
      keywords: [conversation.title!.trim()],
    }))

/** 把工作区列表转成 composer 的 @工作区 候选（id 前缀 workspace:，与群聊一致）。 */
export const buildWorkspaceMentionOptions = (
  workspaces: ReadonlyArray<{ id: string; name?: string | null; avatarUrl?: string | null; description?: string | null }>,
  kindLabel: string,
): ChatMentionOption[] =>
  workspaces
    .filter((workspace) => workspace.id.trim() && workspace.name?.trim())
    .map((workspace) => ({
      id: `workspace:${workspace.id}`,
      kind: 'workspace' as const,
      label: workspace.name!.trim(),
      description: kindLabel,
      avatarUrl: workspace.avatarUrl?.trim() || undefined,
      kindLabel,
      keywords: [workspace.name!.trim(), workspace.description ?? ''],
    }))

const isWordChar = (value: string | undefined) => {
  return value ? /[A-Za-z0-9_]/.test(value) : false
}

export const findActiveMentionRange = (value: string, caret: number) => {
  if (!value || caret < 0 || caret > value.length) {
    return null
  }

  let tokenStart = caret - 1
  while (tokenStart >= 0) {
    if (value[tokenStart] === '@' && !isWordChar(value[tokenStart - 1])) {
      break
    }

    if (/\s/.test(value[tokenStart])) {
      break
    }

    tokenStart -= 1
  }
  if (tokenStart < 0 || value[tokenStart] !== '@') {
    return null
  }

  let tokenEnd = caret
  while (tokenEnd < value.length && !/\s/.test(value[tokenEnd])) {
    tokenEnd += 1
  }

  const query = value.slice(tokenStart + 1, tokenEnd)
  if (query.includes('@')) {
    return null
  }

  return {
    start: tokenStart,
    end: tokenEnd,
    query,
  } satisfies ActiveMentionRange
}

export const replaceMentionRange = (
  value: string,
  range: ActiveMentionRange,
  mention: string,
) => {
  const prefix = value.slice(0, range.start)
  const suffix = value.slice(range.end)
  const insertText = `@${mention}`
  const needsTrailingSpace = suffix.length === 0 || !/^[\s,.:;!?)]/.test(suffix)
  const spacer = needsTrailingSpace ? ' ' : ''
  const nextValue = `${prefix}${insertText}${spacer}${suffix}`

  return {
    caret: (prefix + insertText + spacer).length,
    value: nextValue,
  }
}

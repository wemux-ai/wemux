/**
 * [INPUT]: 消息（reactions / replyToMessageId / content / senderId）与交互回调。
 * [OUTPUT]: 消息级操作条（👍 点赞 / 😀 表情回复 / 💬 回复）、reactions 行、回复引用块。
 * [POS]: R8.1 消息交互共享组件 —— Agent 单聊与群聊统一使用，避免两套 UI 漂移。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { CornerDownLeft, Reply, Smile, ThumbsUp } from 'lucide-react'
import { hasMessageReaction } from '@shared/message-reactions'
import { cn } from '../../lib/utils'
import { EmojiPicker } from './emoji-picker'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

export type MessageReactionRow = { emoji: string; userIds: string[] }

export interface MessageChromeInput {
  id: string
  content?: string
  reactions?: MessageReactionRow[]
  replyToMessageId?: string
  senderId?: string
}

/** 引用式回复引用块（消息下方）：↩ 回复了 <label>：<preview> */
export function MessageReplyQuote(props: {
  replyLabel: string
  replyPreview: string
  replyText?: string
}) {
  const { replyLabel, replyPreview, replyText } = props
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border-l-2 border-zinc-600 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-500">
      <CornerDownLeft className="size-3 shrink-0" />
      <span className="min-w-0 truncate">
        <span className="font-medium text-zinc-400">{replyLabel}</span>
        <span className="mx-1 text-zinc-600">：</span>
        {replyText || replyPreview}
      </span>
    </div>
  )
}

/** reactions 行：自由 emoji 计数 + toggle。 */
export function MessageReactionsRow(props: {
  reactions: MessageReactionRow[]
  currentUserId: string
  onToggle: (emoji: string, active: boolean) => void
}) {
  const { reactions, currentUserId, onToggle } = props
  if (reactions.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const reacted = reaction.userIds.includes(currentUserId)
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onToggle(reaction.emoji, !reacted)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors',
              reacted
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            )}
            title={reaction.userIds.join(', ')}
          >
            <span>{reaction.emoji}</span>
            <span>{reaction.userIds.length}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 消息悬停操作条：👍 点赞 / 😀 表情回复（Popover）/ 💬 回复。align 控制跟随气泡左右。 */
export function MessageActionsBar(props: {
  liked: boolean
  onToggleLike: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  likeLabel?: string
  reactLabel?: string
  replyLabel?: string
  align?: 'start' | 'end'
}) {
  const { liked, onToggleLike, onReact, onReply, likeLabel = '点赞', reactLabel = '表情回复', replyLabel = '回复', align = 'start' } = props
  return (
    <div className={cn(
      'flex items-center gap-0.5 opacity-40 transition-opacity hover:opacity-100',
      align === 'end' ? 'justify-end' : 'justify-start',
    )}>
      <button
        type="button"
        onClick={onToggleLike}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200',
          liked && 'text-zinc-200',
        )}
        title={likeLabel}
      >
        <ThumbsUp size={13} />
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title={reactLabel}
          >
            <Smile size={13} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <EmojiPicker onSelect={onReact} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={onReply}
        className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        title={replyLabel}
      >
        <Reply size={13} />
      </button>
    </div>
  )
}

export interface MessageChromeResult {
  actions: React.ReactNode
  afterContent: React.ReactNode
}

/**
 * 组装消息交互 chrome（操作条 + 引用块 + reactions 行）。
 * 群聊与主聊天统一调用，保证两侧 UI 一致。
 */
export function buildMessageChrome(params: {
  message: MessageChromeInput
  messageById: Map<string, MessageChromeInput & { content?: string; senderId?: string }>
  currentUserId: string
  getSenderLabel: (message: MessageChromeInput) => string
  toggleReaction: (messageId: string, emoji: string, active: boolean) => void
  setReplyToMessageId: (messageId: string) => void
  /** 是否本人消息：操作条跟随右侧气泡（align=end）。 */
  isOwn?: boolean
}): MessageChromeResult {
  const { message, messageById, currentUserId, getSenderLabel, toggleReaction, setReplyToMessageId, isOwn = false } = params
  const reactions = message.reactions ?? []
  const replyTarget = message.replyToMessageId ? messageById.get(message.replyToMessageId) : undefined
  const replyLabel = replyTarget ? getSenderLabel(replyTarget) : ''
  const replyPreview = (replyTarget?.content ?? '').replace(/\s+/g, ' ').slice(0, 60)

  const afterContent = (
    <div className="flex flex-col gap-1 pt-1">
      {replyTarget ? (
        <MessageReplyQuote replyLabel={replyLabel} replyPreview={replyPreview} />
      ) : null}
      <MessageReactionsRow
        reactions={reactions}
        currentUserId={currentUserId}
        onToggle={(emoji, active) => toggleReaction(message.id, emoji, active)}
      />
    </div>
  )

  const actions = (
    <MessageActionsBar
      liked={hasMessageReaction(reactions, '👍', currentUserId)}
      onToggleLike={() => toggleReaction(message.id, '👍', !hasMessageReaction(reactions, '👍', currentUserId))}
      onReact={(emoji) => toggleReaction(message.id, emoji, !hasMessageReaction(reactions, emoji, currentUserId))}
      onReply={() => setReplyToMessageId(message.id)}
      align={isOwn ? 'end' : 'start'}
    />
  )

  return { actions, afterContent }
}

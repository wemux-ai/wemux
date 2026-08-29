import { ListTree } from 'lucide-react'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { cn } from '../../../lib/utils'
import type { TimelineTurnDisplay } from './workspace-session-chat-helpers'

const TASK_CHAT_OUTLINE_PREVIEW_LIMIT = 72

export interface TaskChatUserOutlineItem {
  anchorId: string
  messageId: string
  preview: string
  fullPreview: string
  createdAt?: string
  isCurrentTurn: boolean
}

const normalizeOutlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const truncateOutlineText = (value: string, limit = TASK_CHAT_OUTLINE_PREVIEW_LIMIT) => {
  if (value.length <= limit) {
    return value
  }

  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

const summarizeAttachmentPreview = (attachments: TaskChatAttachment[]) => {
  if (attachments.length === 0) {
    return ''
  }

  const firstAttachment = attachments[0]
  const attachmentKindLabel = firstAttachment?.contentType?.startsWith('image/') ? '图片' : '附件'
  const attachmentCountLabel = attachments.length > 1 ? `等 ${attachments.length} 个${attachmentKindLabel}` : attachmentKindLabel
  const filename = firstAttachment?.filename?.trim()

  if (!filename) {
    return attachmentCountLabel
  }

  return `${attachmentCountLabel} · ${filename}`
}

const summarizeOutlinePreview = (text: string, attachments: TaskChatAttachment[] = []) => {
  const normalizedText = normalizeOutlineText(text)
  if (normalizedText) {
    return {
      preview: truncateOutlineText(normalizedText),
      fullPreview: normalizedText,
    }
  }

  const attachmentPreview = summarizeAttachmentPreview(attachments)
  if (attachmentPreview) {
    return {
      preview: truncateOutlineText(attachmentPreview),
      fullPreview: attachmentPreview,
    }
  }

  return {
    preview: '未命名消息',
    fullPreview: '未命名消息',
  }
}

const formatOutlineTime = (value?: string) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export const getTaskChatUserMessageAnchorId = (messageId: string) => `workspace-task-chat-user-message-${messageId}`

export const buildTaskChatUserOutlineItems = (turns: TimelineTurnDisplay[]): TaskChatUserOutlineItem[] => {
  const seenMessageIds = new Set<string>()

  return turns.flatMap((turn) => {
    if (!turn.user || seenMessageIds.has(turn.user.messageId)) {
      return []
    }

    seenMessageIds.add(turn.user.messageId)
    const { preview, fullPreview } = summarizeOutlinePreview(turn.user.text, turn.user.attachments ?? [])

    return [{
      anchorId: getTaskChatUserMessageAnchorId(turn.user.messageId),
      messageId: turn.user.messageId,
      preview,
      fullPreview,
      createdAt: turn.user.ts,
      isCurrentTurn: turn.isCurrent,
    }]
  })
}

export function TaskChatUserOutline({
  items,
  bottomInset,
  onSelect,
}: {
  items: TaskChatUserOutlineItem[]
  bottomInset: number
  onSelect: (item: TaskChatUserOutlineItem) => void
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute right-5 top-5 z-20 hidden max-w-[20rem] lg:block"
      style={{ maxHeight: `calc(100% - ${Math.max(bottomInset + 84, 144)}px)` }}
    >
      <div className="group pointer-events-auto flex max-h-full justify-end">
        <div className="flex max-h-full w-11 overflow-hidden rounded-2xl border border-zinc-800/30 bg-zinc-950/25 text-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.16)] backdrop-blur-sm transition-[width,background-color,border-color,box-shadow] duration-200 ease-out group-hover:w-80 group-hover:border-zinc-700/80 group-hover:bg-zinc-950/88 group-hover:shadow-[0_20px_48px_rgba(0,0,0,0.42)] group-focus-within:w-80 group-focus-within:border-zinc-700/80 group-focus-within:bg-zinc-950/88 group-focus-within:shadow-[0_20px_48px_rgba(0,0,0,0.42)]">
          <button
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center self-start bg-transparent text-zinc-400 transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
            aria-label="展开用户消息提纲"
            title="用户消息提纲"
          >
            <ListTree className="h-4 w-4 opacity-80" />
          </button>

          <div className="flex min-w-0 flex-1 flex-col py-2 pr-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <div className="shrink-0 px-2 pb-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                用户提纲
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {items.length} 条用户消息
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 pb-1">
              {items.map((item) => (
                <button
                  key={item.messageId}
                  type="button"
                  onClick={() => onSelect(item)}
                  title={item.fullPreview}
                  className={cn(
                    'block w-full rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50',
                    item.isCurrentTurn
                      ? 'border-sky-500/30 bg-sky-500/10 text-sky-50'
                      : 'border-transparent bg-zinc-900/65 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900',
                  )}
                >
                  <span className="line-clamp-2 text-sm leading-5">
                    {item.preview}
                  </span>
                  {item.createdAt ? (
                    <span className={cn('mt-1 block text-[10px]', item.isCurrentTurn ? 'text-sky-200/75' : 'text-zinc-500')}>
                      {formatOutlineTime(item.createdAt)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

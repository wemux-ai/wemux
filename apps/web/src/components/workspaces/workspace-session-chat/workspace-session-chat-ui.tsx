/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Workspace task-chat messages, Agent lifecycle state, tool calls, and user interaction callbacks.
 * [OUTPUT]: Shared transcript, status, tool-call, and typing UI for workspace sessions and main Agent Chat.
 * [POS]: Presentation layer only; it renders canonical chat and Agent state without owning their persistence or dispatch.
 */
import { memo, useMemo, useState, type ReactNode } from 'react'
import { Bot, Brain, ChevronDown, ChevronUp, File, FileText, GitBranch, Globe, Loader2, MessageSquare, Pencil, Search, Sparkles, Terminal, Wrench } from 'lucide-react'
import { isTextUIPart } from 'ai'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatQueueEntry } from '@shared/task-chat-session'
import { getToolCallPersistenceDisplay } from '@shared/tool-call-persistence'
import type { AgentRunningStatus, AgentType, ExecutionLog, ToolCall } from '@shared/types'
import { CollapsibleMessageBody } from '../../chat/collapsible-message-body'
import { MentionNode, type ChatMentionTarget } from '../../chat/mention-text'
import { remarkMentions } from '../../chat/remark-mentions'
import { UserCardPopover } from '../../profiles/user-card-popover'
import { AgentCardPopover } from '../../profiles/agent-card-popover'
import { AgentActivityIndicator } from '../../agent-activity-indicator'
import { RuntimeIcon } from '../../runtime/runtime-icons'
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { AiLoader } from '../../ui/ai-loader'
import { PreviewableImage, type PreviewableImageGalleryItem } from '../../ui/previewable-image'
import { TaskCard } from '../../cards/task'
import { resolveMediaUrl } from '../../../lib/api'
import { getAgentAvatarAccent } from '../../../lib/agent-avatar'
import { isImeComposingKeyboardEvent } from '../../../lib/ime-keyboard'
import { cn } from '../../../lib/utils'
import { getMessageCreatedAt, getMessageParts, type TaskChatMessage } from '../../../lib/workspace-session-chat-ui'
import { resolveApiUrl } from '../../../lib/runtime-config'
import type { ChatTimelineEvent } from '@shared/timeline'
import type { TaskGitChangeSummary } from '@shared/task-git-ops'
import type { Task } from '@shared/types'
export type { ChatTimelineEvent }

export const statusLabel: Record<AgentRunningStatus, string> = {
  idle: '空闲',
  thinking: '思考中',
  executing: '执行中',
  waiting: '等待中',
  complete: '已完成',
  error: '出错',
}

const TASK_CHAT_TEXT_SELECTION_TONE = 'select-text selection:bg-sky-300 selection:text-slate-950'
const RUNTIME_AVATAR_ICON_SIZE = 24
const TASK_CHAT_MESSAGE_COLLAPSED_HEIGHT = 360
const TASK_CHAT_QUEUE_PREVIEW_MAX_HEIGHT = 92
const TASK_CHAT_COLLAPSE_TOGGLE_CLASSNAME =
  'rounded-full border-transparent px-1.5 py-0.5 text-[10px] font-normal text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-200'
const TASK_CHAT_REASONING_COLLAPSE_TOGGLE_CLASSNAME =
  'rounded-full border-transparent px-1.5 py-0.5 text-[10px] font-normal text-amber-200/70 hover:border-amber-500/15 hover:bg-amber-500/8 hover:text-amber-100'

const formatMessageTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const formatMessageTimeTitle = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export const parseExecutorSwitchSummary = (content: string) => {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const title = lines[0] ?? ''
  if (!title.startsWith('节点切换：')) {
    return null
  }

  const route = title.replace(/^节点切换：/, '').trim()
  const [fromExecutor, toExecutor] = route.split('→').map((item) => item.trim())
  const branchDetail = lines.slice(1).find((line) => line.startsWith('分支：')) ?? ''
  return {
    fromExecutor: fromExecutor || '原执行节点',
    toExecutor: toExecutor || '新执行节点',
    branchName: branchDetail.replace(/^分支：/, '').trim(),
  }
}

export function StatusBanner({ status, step }: { status: AgentRunningStatus; step: string }) {
  const tone =
    status === 'error'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
      : status === 'complete'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
        : status === 'waiting'
          ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
          : 'border-sky-500/20 bg-sky-500/10 text-sky-200'

  return (
    <div className={cn('rounded-lg border px-4 py-3', tone)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AgentActivityIndicator status={status} size="md" />
          {statusLabel[status]}
        </div>
        <span className="rounded-full border border-current/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] opacity-80">Live</span>
      </div>
      {step ? <p className="mt-1 text-xs opacity-85">{step}</p> : null}
    </div>
  )
}

export function EmptyState({
  title = '暂无对话记录',
  description = '发送一条消息，开始在任务上下文里继续协作。',
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900">
        <Bot className="h-6 w-6 text-zinc-500" />
      </div>
      <p className="text-sm font-medium text-zinc-100">{title}</p>
      <p className="mt-1 max-w-lg text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  )
}

export function ChatMessageItem({
  message,
  content,
  footer,
  footerEnd,
  onOpenLink,
  authorLabel,
  messageExecutionModel,
  messageAvatarUrl,
  messageAvatarFallback,
  assistantLabel = 'AI',
  assistantAvatarUrl,
  assistantAvatarFallback = 'AI',
  assistantAvatarRuntime,
  showFullExecutionModel = false,
  userAvatarUrl,
  userAvatarFallback = '你',
  userLabel = '你',
  mobileHeaderLayout = false,
  userCardUserId,
  agentCardUserId,
  mentionTargets,
}: {
  message: TaskChatMessage
  content?: string
  footer?: ReactNode
  footerEnd?: ReactNode
  onOpenLink?: (href: string) => boolean
  authorLabel?: string
  messageExecutionModel?: string
  messageAvatarUrl?: string
  messageAvatarFallback?: string
  assistantLabel?: string
  assistantAvatarUrl?: string
  assistantAvatarFallback?: string
  assistantAvatarRuntime?: AgentType
  showFullExecutionModel?: boolean
  userAvatarUrl?: string
  userAvatarFallback?: string
  userLabel?: string
  mobileHeaderLayout?: boolean
  /** 消息作者是「用户」时，头像包 UserCardPopover（hover）所需的 userId。 */
  userCardUserId?: string
  /** 消息作者是「Agent」时，头像包 AgentCardPopover 所需的 agentId。 */
  agentCardUserId?: string
  /** 正文里可悬停的成员 mention 目标（@成员名 → 用户卡片）。 */
  mentionTargets?: readonly ChatMentionTarget[]
}) {
  const parts = getMessageParts(message)
  const textParts = parts.filter(isTextUIPart)
  const body = content ?? textParts.map((part) => part.text).join('')
  const attachments = getMessageAttachments(message)
  const isUser = message.role === 'user'
  const bubbleTone = isUser
    ? 'rounded-tr-sm border border-zinc-700 bg-zinc-900 text-zinc-50'
    : 'rounded-tl-sm border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-[0_0_0_1px_rgba(14,165,233,0.04)]'
  const labelTone = isUser ? 'text-zinc-400' : 'text-sky-300'
  const avatarUrl = messageAvatarUrl ?? (isUser ? userAvatarUrl : assistantAvatarUrl)
  const avatarFallback = messageAvatarFallback ?? (isUser ? userAvatarFallback : assistantAvatarFallback)
  const resolvedLabel = authorLabel ?? (isUser ? userLabel : assistantLabel)
  const resolvedExecutionModel = !isUser && messageExecutionModel?.trim()
    ? resolveExecutionModelDisplayLabel(messageExecutionModel.trim(), assistantAvatarRuntime, showFullExecutionModel)
    : ''
  const showAssistantRuntimeIcon = !isUser && !avatarUrl && Boolean(assistantAvatarRuntime)
  const messageCreatedAt = getMessageCreatedAt(message)
  const messageTime = messageCreatedAt ? formatMessageTime(messageCreatedAt) : ''

  if (!body && attachments.length === 0) {
    return null
  }

  const avatarNode = showAssistantRuntimeIcon && assistantAvatarRuntime ? (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
      <RuntimeIcon
        runtime={assistantAvatarRuntime}
        size={RUNTIME_AVATAR_ICON_SIZE}
        className="rounded-[7px]"
      />
    </span>
  ) : (
    <Avatar className={cn(
      'h-7 w-7 flex-shrink-0 select-none border',
      isUser ? 'border-slate-700 bg-slate-900' : 'border-zinc-800 bg-zinc-900',
    )}>
      {avatarUrl ? <AvatarImage src={resolveMediaUrl(avatarUrl)} /> : null}
      <AvatarFallback
        className={cn(
          'text-[10px] font-semibold',
          isUser
            ? 'bg-slate-900 text-slate-50'
            : `bg-gradient-to-br font-black text-zinc-950 ${getAgentAvatarAccent(resolvedLabel || avatarFallback)}`,
        )}
      >
        {avatarFallback}
      </AvatarFallback>
    </Avatar>
  )

  const renderedAvatar = userCardUserId ? (
    <UserCardPopover
      userId={userCardUserId}
      name={resolvedLabel}
      avatarUrl={avatarUrl}
      triggerMode="hover"
    >
      {avatarNode}
    </UserCardPopover>
  ) : agentCardUserId ? (
    <AgentCardPopover
      agentId={agentCardUserId}
      name={resolvedLabel}
      avatarUrl={avatarUrl}
      triggerMode="hover"
    >
      {avatarNode}
    </AgentCardPopover>
  ) : avatarNode

  const headerNode = (
    <p className={cn(
      'flex min-w-0 max-w-full items-center gap-1.5 select-none text-[10px] font-medium uppercase tracking-wide',
      labelTone,
    )}>
      <span className="block truncate">{resolvedLabel}</span>
      {resolvedExecutionModel ? (
        <span className="truncate text-[10px] font-normal normal-case tracking-normal text-zinc-500">
          {resolvedExecutionModel}
        </span>
      ) : null}
    </p>
  )

  const bubbleNode = (
    <>
      <div className={cn('max-w-full rounded-lg px-3.5 py-3 text-sm shadow-sm', TASK_CHAT_TEXT_SELECTION_TONE, bubbleTone)}>
        {body ? (
          <MarkdownMessage content={body} isUser={isUser} onOpenLink={onOpenLink} mentionTargets={mentionTargets} />
        ) : null}
        {attachments.length > 0 ? <MessageAttachments attachments={attachments} /> : null}
      </div>

      <div className={cn('mt-0.5 flex items-center', isUser ? 'justify-end' : 'justify-start')}>
        {footer}
        {messageCreatedAt && messageTime ? (
          <time
            dateTime={messageCreatedAt}
            title={formatMessageTimeTitle(messageCreatedAt)}
            className="pl-2 select-none text-[10px] text-zinc-500"
          >
            {messageTime}
          </time>
        ) : null}
        {footerEnd ? <span className="ml-auto flex shrink-0 items-center">{footerEnd}</span> : null}
      </div>
    </>
  )

  if (mobileHeaderLayout) {
    return (
      <div className={cn('flex w-full min-w-0 flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
        <div className={cn('flex min-w-0 max-w-full items-center gap-2 px-1', isUser && 'flex-row-reverse')}>
          {renderedAvatar}
          {headerNode}
        </div>
        <div className={cn('flex w-full min-w-0 flex-col', isUser ? 'items-end' : 'items-start')}>
          {bubbleNode}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex items-start gap-2.5', isUser ? 'flex-row-reverse' : '')}>
      {renderedAvatar}
      <div className={cn('flex max-w-[88%] min-w-0 flex-col', isUser ? 'items-end' : 'items-start')}>
        <div className="mb-1.5 max-w-full px-1">
          {headerNode}
        </div>
        {bubbleNode}
      </div>
    </div>
  )
}

const FALLBACK_PROVIDER_BY_RUNTIME: Partial<Record<AgentType, string>> = {
  Codex: 'openai',
  ClaudeCode: 'anthropic',
}

const resolveExecutionModelDisplayLabel = (
  executionModel: string,
  runtime?: AgentType,
  showFullExecutionModel?: boolean,
) => {
  const normalizedModel = executionModel.trim()
  if (!normalizedModel) {
    return ''
  }

  if (showFullExecutionModel) {
    if (normalizedModel.includes('/')) {
      return normalizedModel
    }

    const fallbackProviderId = runtime ? FALLBACK_PROVIDER_BY_RUNTIME[runtime] : undefined
    return fallbackProviderId ? `${fallbackProviderId}/${normalizedModel}` : normalizedModel
  }

  const [providerId, ...rest] = normalizedModel.split('/')
  const modelId = rest.join('/')

  if (!providerId || !modelId) {
    return normalizedModel
  }

  return `${providerId}-${modelId}`
}

const getMessageAttachments = (message: TaskChatMessage) => {
  return (message.attachments ?? [])
    .filter((attachment) => attachment.url && attachment.filename)
}

const resolveAttachmentUrl = (url: string) => {
  if (/^(https?:|data:|blob:)/i.test(url)) {
    return url
  }

  return resolveApiUrl(url)
}

function MessageAttachments({
  attachments,
  containerClassName,
  imageClassName,
}: {
  attachments: TaskChatAttachment[]
  containerClassName?: string
  imageClassName?: string
}) {
  const imageAttachments = attachments.filter((attachment) => (attachment.contentType || '').startsWith('image/'))
  const galleryItems: PreviewableImageGalleryItem[] = imageAttachments.map((attachment) => ({
    src: resolveAttachmentUrl(attachment.url),
    alt: attachment.filename,
  }))

  return (
    <div className={cn('mt-3 flex flex-wrap gap-2 select-none', containerClassName)}>
      {attachments.map((attachment) => {
        const isImageAttachment = (attachment.contentType || '').startsWith('image/')
        if (isImageAttachment) {
          const galleryIndex = imageAttachments.findIndex((item) => item.id === attachment.id)
          return (
            <PreviewableImage
              key={attachment.id}
              src={resolveAttachmentUrl(attachment.url)}
              alt={attachment.filename}
              galleryItems={galleryItems}
              galleryIndex={galleryIndex}
              triggerClassName="group overflow-hidden rounded-xl border border-zinc-700/70 bg-black/20"
              imageClassName={cn('h-28 w-28 object-cover transition-transform group-hover:scale-[1.03]', imageClassName)}
            />
          )
        }

        return (
          <a
            key={attachment.id}
            href={resolveAttachmentUrl(attachment.url)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-14 min-w-0 max-w-[20rem] items-center gap-3 rounded-xl border border-zinc-700/70 bg-black/20 px-3 py-2 text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-900/70"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-400">
              <File className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{attachment.filename}</p>
              <p className="truncate text-[10px] text-zinc-500">{attachment.contentType || '附件'}</p>
            </div>
          </a>
        )
      })}
    </div>
  )
}

export function ReasoningItem({ content }: { content: string }) {
  if (!content.trim()) {
    return null
  }

  return (
    <div className="flex gap-2.5">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-[10px] font-semibold text-amber-200">
        <Brain className="h-3.5 w-3.5" />
      </div>
      <div className={cn(
        'max-w-[88%] rounded-lg rounded-tl-sm border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-sm text-zinc-200 shadow-sm',
        TASK_CHAT_TEXT_SELECTION_TONE,
      )}>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-300">思考</p>
        <CollapsibleMessageBody
          contentKey={content}
          maxHeight={TASK_CHAT_MESSAGE_COLLAPSED_HEIGHT}
          overlayClassName="from-[#141007] via-[#141007]/95 to-transparent"
          toggleAlignment="start"
          toggleClassName={TASK_CHAT_REASONING_COLLAPSE_TOGGLE_CLASSNAME}
        >
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">{content}</p>
        </CollapsibleMessageBody>
      </div>
    </div>
  )
}

export function CollapsedThinkingGroup({
  entries,
}: {
  entries: Array<{ id: string; content: string }>
}) {
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) {
    return null
  }

  return (
    <div className="flex gap-2.5">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-[10px] font-semibold text-amber-200">
        <Brain className="h-3.5 w-3.5" />
      </div>
      <div className={cn(
        'max-w-[88%] rounded-lg rounded-tl-sm border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-sm text-zinc-200 shadow-sm',
        TASK_CHAT_TEXT_SELECTION_TONE,
      )}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center gap-2 text-left"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-amber-300" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-300" />}
          <span className="text-[10px] font-medium uppercase tracking-wide text-amber-300">思考</span>
          <span className="text-[10px] text-zinc-500">{entries.length} 段</span>
        </button>
        {expanded ? (
          <div className="mt-3 space-y-3">
            {entries.map((entry) => (
              <CollapsibleMessageBody
                key={entry.id}
                contentKey={entry.content}
                maxHeight={TASK_CHAT_MESSAGE_COLLAPSED_HEIGHT}
                overlayClassName="from-[#141007] via-[#141007]/95 to-transparent"
                toggleAlignment="start"
                toggleClassName={TASK_CHAT_REASONING_COLLAPSE_TOGGLE_CLASSNAME}
              >
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">
                  {entry.content}
                </p>
              </CollapsibleMessageBody>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const splitChangeFilePath = (path: string) => {
  const normalizedPath = path.trim()
  const separatorIndex = normalizedPath.lastIndexOf('/')
  if (separatorIndex < 0) {
    return { name: normalizedPath, directory: '' }
  }

  return {
    name: normalizedPath.slice(separatorIndex + 1) || normalizedPath,
    directory: normalizedPath.slice(0, separatorIndex + 1),
  }
}

const findPatchForChangeFile = (patch: string | undefined, filePath: string) => {
  const normalizedPatch = patch?.trim()
  if (!normalizedPatch) {
    return ''
  }

  const sections = normalizedPatch.split(/\n(?=diff --git )/g)
  return sections.find((section) => {
    const firstLine = section.split('\n', 1)[0] ?? ''
    return firstLine.includes(` b/${filePath}`)
      || firstLine.includes(` a/${filePath}`)
      || firstLine.endsWith(filePath)
  })?.trim() ?? ''
}

function parseDiffHunks(rawPatch: string) {
  const lines = rawPatch.split('\n')
  const contentStart = lines.findIndex((line) => line.startsWith('@@'))
  if (contentStart === -1) {
    return { headerLines: lines.slice(0, Math.min(4, lines.length)), contentLines: lines.slice(Math.min(4, lines.length)) }
  }
  return { headerLines: lines.slice(0, contentStart), contentLines: lines.slice(contentStart) }
}

function DiffViewer({ patch }: { patch: string }) {
  const { contentLines } = useMemo(() => parseDiffHunks(patch), [patch])
  let oldLine = 0
  let newLine = 0

  const rows = contentLines.map((line, index) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[2])
      return { type: 'hunk' as const, text: line, oldNum: '', newNum: '' }
    }
    if (line.startsWith('+')) {
      const num = String(newLine++)
      return { type: 'add' as const, text: line, oldNum: '', newNum: num }
    }
    if (line.startsWith('-')) {
      const num = String(oldLine++)
      return { type: 'del' as const, text: line, oldNum: num, newNum: '' }
    }
    const oldN = String(oldLine++)
    const newN = String(newLine++)
    return { type: 'ctx' as const, text: line, oldNum: oldN, newNum: newN }
  })

  return (
    <div className="mt-0.5 max-h-[42vh] overflow-auto rounded-md border border-zinc-800/60 bg-[#09090b] font-mono text-[10px] leading-4">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row, i) => {
            const rowClass = row.type === 'add'
              ? 'bg-emerald-500/[0.06]'
              : row.type === 'del'
                ? 'bg-rose-500/[0.06]'
                : row.type === 'hunk'
                  ? 'bg-sky-500/[0.06]'
                  : ''
            const textClass = row.type === 'add'
              ? 'text-emerald-400'
              : row.type === 'del'
                ? 'text-rose-400'
                : row.type === 'hunk'
                  ? 'text-sky-400'
                  : 'text-zinc-500'
            const prefix = row.type === 'add' ? '+' : row.type === 'del' ? '-' : row.type === 'hunk' ? ' ' : ' '
            return (
              <tr key={i} className={cn(rowClass, 'group')}>
                <td className="w-[1px] select-none whitespace-nowrap px-2 py-0 text-right text-zinc-700">{row.oldNum}</td>
                <td className="w-[1px] select-none whitespace-nowrap px-2 py-0 text-right text-zinc-700">{row.newNum}</td>
                <td className="w-[1px] select-none px-1.5 py-0 text-zinc-600">{prefix}</td>
                <td className={cn('whitespace-pre py-0 pr-3', textClass)}>{row.text.slice(1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ChangeSummaryCard({ changeSummary, createdAt }: { changeSummary: TaskGitChangeSummary; createdAt?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null)
  const messageTime = createdAt ? formatMessageTime(createdAt) : ''

  return (
    <div className={cn('mx-auto w-full max-w-[1040px] rounded-lg border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-200 shadow-sm', TASK_CHAT_TEXT_SELECTION_TONE)}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0 rotate-90 text-zinc-500" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-100">
          {changeSummary.fileCount} 个文件已更改
        </span>
        <span className="shrink-0 font-mono text-[12px] text-emerald-400">+{changeSummary.additions}</span>
        <span className="shrink-0 font-mono text-[12px] text-rose-400">-{changeSummary.deletions}</span>
        {messageTime ? <span className="shrink-0 text-[10px] text-zinc-600">{messageTime}</span> : null}
      </button>
      {expanded ? (
        <div className="border-t border-zinc-800/60 px-3 py-1.5">
          <div className="space-y-0.5">
            {changeSummary.files.map((file) => {
              const filePath = splitChangeFilePath(file.path)
              const filePatch = findPatchForChangeFile(changeSummary.patch, file.path)
              const isFileExpanded = expandedFilePath === file.path
              return (
                <div key={`${file.path}:${file.status}`}>
                  <button
                    type="button"
                    onClick={() => filePatch && setExpandedFilePath((current) => current === file.path ? null : file.path)}
                    className={cn(
                      'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] leading-4 text-zinc-400',
                      filePatch ? 'hover:bg-zinc-800/50' : 'cursor-default',
                    )}
                    aria-expanded={filePatch ? isFileExpanded : undefined}
                  >
                    <File className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-zinc-200">{filePath.name}</span>
                      {filePath.directory ? <span className="ml-1.5 text-zinc-600">{filePath.directory}</span> : null}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                      <span className="text-emerald-400">+{file.additions}</span>
                      <span className="px-0.5 text-zinc-800">|</span>
                      <span className="text-rose-400">-{file.deletions}</span>
                    </span>
                    {filePatch ? (
                      isFileExpanded ? <ChevronUp className="h-3 w-3 shrink-0 text-zinc-700" /> : <ChevronDown className="h-3 w-3 shrink-0 text-zinc-700" />
                    ) : null}
                  </button>
                  {isFileExpanded && filePatch ? (
                    <DiffViewer patch={filePatch} />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const MarkdownMessage = memo(function MarkdownMessage({
  content,
  isUser,
  onOpenLink,
  mentionTargets,
}: {
  content: string
  isUser: boolean
  onOpenLink?: (href: string) => boolean
  mentionTargets?: readonly ChatMentionTarget[]
}) {
  return (
    <div
      className={cn(
        'markdown-body space-y-3 break-words leading-relaxed',
        TASK_CHAT_TEXT_SELECTION_TONE,
        isUser ? 'text-zinc-50' : 'text-zinc-100',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMentions(mentionTargets ?? [])]}
        components={{
          mention: MentionNode,
          p: ({ children }) => <p className="whitespace-pre-wrap break-words leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => <code className={cn('rounded px-1.5 py-0.5 font-mono text-[0.92em]', isUser ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-100')}>{children}</code>,
          pre: ({ children }) => (
            <pre className={cn('overflow-auto rounded-xl px-3 py-2 text-xs', isUser ? 'bg-black/30 text-zinc-100' : 'bg-[#09090b] text-zinc-100')}>
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline underline-offset-4"
              onClick={(event) => {
                if (href && onOpenLink?.(href)) {
                  event.preventDefault()
                }
              }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className={cn('border-l-2 pl-3 italic', isUser ? 'border-zinc-500 text-zinc-300' : 'border-zinc-700 text-zinc-400')}>
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium">{children}</h3>,
          hr: () => <hr className={cn('border-dashed', isUser ? 'border-zinc-600' : 'border-zinc-800')} />,
          table: ({ children }) => <div className="overflow-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
          th: ({ children }) => <th className={cn('border px-2 py-1 text-left font-medium', isUser ? 'border-zinc-600' : 'border-zinc-800')}>{children}</th>,
          td: ({ children }) => <td className={cn('border px-2 py-1 align-top', isUser ? 'border-zinc-600' : 'border-zinc-800')}>{children}</td>,
        } as Components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

const TOOL_SUMMARY_LABELS: Record<string, string> = {
  cmd: '命令',
  command: '命令',
  file: '文件',
  path: '路径',
  pattern: '模式',
  prompt: '提示',
  q: '查询',
  query: '查询',
  target: '目标',
  title: '标题',
  url: '链接',
}

const TOOL_SUMMARY_KEYS = ['command', 'cmd', 'query', 'q', 'pattern', 'path', 'file', 'url', 'target', 'prompt', 'title'] as const

const TOOL_SUMMARY_LIMIT = 96

const normalizeInlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const truncateInlineText = (value: string, limit = TOOL_SUMMARY_LIMIT) => {
  if (value.length <= limit) {
    return value
  }

  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

const formatToolName = (name: string) => {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()

  if (!spaced) {
    return 'Tool'
  }

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const parseToolPayload = (value: string): unknown | null => {
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const summarizePathLike = (value: string) => {
  const normalized = normalizeInlineText(value)
  if (!normalized) {
    return ''
  }

  return truncateInlineText(normalized, 120)
}

const formatToolValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return truncateInlineText(normalizeInlineText(value), 56)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const preview = value
      .map((item) => formatToolValue(item))
      .filter(Boolean)
      .slice(0, 2)
      .join(', ')

    return preview
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  for (const key of ['path', 'file', 'url', 'target', 'command', 'cmd', 'query', 'q', 'pattern']) {
    const nested = formatToolValue(record[key])
    if (nested) {
      return nested
    }
  }

  return ''
}

const findFirstValueByKeys = (
  value: unknown,
  keys: readonly string[],
  depth = 0,
): unknown => {
  if (depth > 3 || value == null) {
    return undefined
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValueByKeys(item, keys, depth + 1)
      if (found != null) {
        return found
      }
    }
    return undefined
  }

  if (!isRecord(value)) {
    return undefined
  }

  for (const key of keys) {
    const direct = value[key]
    if (direct != null && direct !== '') {
      return direct
    }
  }

  for (const nested of Object.values(value)) {
    const found = findFirstValueByKeys(nested, keys, depth + 1)
    if (found != null) {
      return found
    }
  }

  return undefined
}

const extractCommandPreview = (value: unknown): string => {
  const directCommand = findFirstValueByKeys(value, ['command', 'cmd', 'script', 'raw_command'])
  if (typeof directCommand === 'string') {
    return truncateInlineText(normalizeInlineText(directCommand), 120)
  }

  const argsValue = findFirstValueByKeys(value, ['args', 'argv', 'command_args'])
  if (Array.isArray(argsValue)) {
    const tokens = argsValue
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean)

    if (tokens.length === 0) {
      return ''
    }

    const shellFlagIndex = tokens.findIndex((token) => token === '-lc' || token === '-c')
    if (shellFlagIndex >= 0 && typeof tokens[shellFlagIndex + 1] === 'string') {
      return truncateInlineText(normalizeInlineText(tokens[shellFlagIndex + 1]), 120)
    }

    return truncateInlineText(normalizeInlineText(tokens.join(' ')), 120)
  }

  if (typeof argsValue === 'string') {
    return truncateInlineText(normalizeInlineText(argsValue), 120)
  }

  return ''
}

const extractPathPreview = (value: unknown): string => {
  const pathValue = findFirstValueByKeys(value, [
    'file_path',
    'filepath',
    'path',
    'paths',
    'file',
    'filename',
    'target_file',
    'target',
    'cwd',
  ])

  if (typeof pathValue === 'string') {
    return summarizePathLike(pathValue)
  }

  if (Array.isArray(pathValue)) {
    const firstPath = pathValue.find((item) => typeof item === 'string')
    if (typeof firstPath === 'string') {
      return summarizePathLike(firstPath)
    }
  }

  return ''
}

const summarizeToolPayload = (value?: string) => {
  const normalized = normalizeInlineText(value ?? '')
  if (!normalized) {
    return ''
  }

  const parsed = parseToolPayload(normalized)
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const keys = [
      ...TOOL_SUMMARY_KEYS.filter((key) => key in record),
      ...Object.keys(record).filter((key) => !TOOL_SUMMARY_KEYS.includes(key as typeof TOOL_SUMMARY_KEYS[number])),
    ]
    const parts: string[] = []

    for (const key of keys) {
      const nextValue = formatToolValue(record[key])
      if (!nextValue) {
        continue
      }

      parts.push(`${TOOL_SUMMARY_LABELS[key] ?? key}: ${nextValue}`)
      if (parts.length >= 2) {
        break
      }
    }

    if (parts.length > 0) {
      return truncateInlineText(parts.join(' · '))
    }

    return ''
  }

  const listPreview = Array.isArray(parsed) ? formatToolValue(parsed) : ''
  if (listPreview) {
    return truncateInlineText(listPreview)
  }

  if (normalized === '{}' || normalized === '[]') {
    return ''
  }

  return truncateInlineText(normalized)
}

const buildToolSummary = (tool: ToolCall) => {
  const display = getToolCallPersistenceDisplay(tool)
  const normalizedName = tool.name.toLowerCase()
  const parsedArgs = parseToolPayload(display.args ?? '')
  const parsedResult = parseToolPayload(display.result ?? '')

  if (normalizedName.includes('bash') || normalizedName.includes('shell') || normalizedName.includes('command')) {
    return extractCommandPreview(parsedArgs) || summarizeToolPayload(display.args) || summarizeToolPayload(display.result)
  }

  if (normalizedName.includes('read') || normalizedName.includes('open') || normalizedName.includes('notebookread')) {
    return extractPathPreview(parsedArgs) || summarizeToolPayload(display.args) || summarizeToolPayload(display.result)
  }

  if (normalizedName.includes('grep') || normalizedName.includes('search') || normalizedName.includes('find')) {
    const pattern = formatToolValue(findFirstValueByKeys(parsedArgs, ['pattern', 'query', 'q', 'term']))
    const path = extractPathPreview(parsedArgs)

    if (pattern && path) {
      return truncateInlineText(`${pattern} · ${path}`)
    }

    return pattern || path || summarizeToolPayload(display.args) || summarizeToolPayload(display.result)
  }

  if (normalizedName.includes('edit') || normalizedName.includes('write') || normalizedName.includes('patch')) {
    return extractPathPreview(parsedArgs) || summarizeToolPayload(display.args) || summarizeToolPayload(display.result)
  }

  return summarizeToolPayload(display.args) || extractPathPreview(parsedResult) || summarizeToolPayload(display.result)
}

type WorkspaceToolActionKind = 'search' | 'read' | 'edit' | 'run' | 'ask' | 'browse' | 'other'
type WorkspaceToolActionStatus = 'running' | 'completed' | 'failed' | 'interrupted' | 'waiting'

export type WorkspaceToolActionItem = {
  tool: ToolCall
  kind: WorkspaceToolActionKind
  status: WorkspaceToolActionStatus
  label: string
  title: string
  detail: string
  directory?: string
  diffStat?: string
  exitCode?: string
}

const toolActionLabels: Record<WorkspaceToolActionKind, string> = {
  search: '搜索',
  read: '读取',
  edit: '编辑',
  run: '执行',
  ask: '确认',
  browse: '浏览',
  other: '工具',
}

const toolActionDoneLabels: Record<WorkspaceToolActionKind, string> = {
  search: '已搜索',
  read: '已读取',
  edit: '已编辑',
  run: '已执行',
  ask: '待确认',
  browse: '已浏览',
  other: '已调用',
}

const resolveToolActionKind = (name: string): WorkspaceToolActionKind => {
  const normalized = name.toLowerCase()

  if (normalized.includes('question') || normalized.includes('ask')) {
    return 'ask'
  }

  if (normalized.includes('grep') || normalized.includes('search') || normalized.includes('find') || normalized.includes('glob')) {
    return 'search'
  }

  if (normalized.includes('read') || normalized.includes('open') || normalized.includes('cat') || normalized.includes('head') || normalized.includes('tail') || normalized.includes('notebookread')) {
    return 'read'
  }

  if (normalized.includes('edit') || normalized.includes('write') || normalized.includes('patch')) {
    return 'edit'
  }

  if (normalized.includes('exec') || normalized.includes('bash') || normalized.includes('shell') || normalized.includes('terminal') || normalized.includes('command')) {
    return 'run'
  }

  if (normalized.includes('browser') || normalized.includes('fetch') || normalized.includes('click') || normalized.includes('url') || normalized.includes('web')) {
    return 'browse'
  }

  return 'other'
}

const resolveToolActionStatus = (tool: ToolCall, forceSettled: boolean, result?: string): WorkspaceToolActionStatus => {
  const isQuestionTool = tool.name === 'question' || tool.name === 'AskUserQuestion'
  if (isQuestionTool) {
    return 'waiting'
  }

  if (!tool.finishedAt) {
    return forceSettled ? 'interrupted' : 'running'
  }

  if (typeof result === 'string' && /\b(error|failed|exception|exit code [1-9]\d*)\b/i.test(result)) {
    return 'failed'
  }

  return 'completed'
}

const splitPathPreview = (value: string) => {
  const normalized = value.trim()
  if (!normalized) {
    return { title: '', directory: '' }
  }

  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\\\'))
  if (separatorIndex < 0) {
    return { title: normalized, directory: '' }
  }

  return {
    title: normalized.slice(separatorIndex + 1) || normalized,
    directory: normalized.slice(0, separatorIndex + 1),
  }
}

const extractDiffStat = (value: string) => {
  const statMatch = value.match(/(\+\d+)\s+(-\d+)/)
  if (statMatch) {
    return `${statMatch[1]} ${statMatch[2]}`
  }

  const insertions = value.match(/(\d+)\s+(?:insertion|insertions|addition|additions)/i)?.[1]
  const deletions = value.match(/(\d+)\s+(?:deletion|deletions|removal|removals)/i)?.[1]
  if (!insertions && !deletions) {
    return ''
  }

  return `${insertions ? `+${insertions}` : '+0'} ${deletions ? `-${deletions}` : '-0'}`
}

const extractExitCode = (value: string) => {
  const match = value.match(/exit code\s+(-?\d+)/i) ?? value.match(/exited with\s+(-?\d+)/i)
  return match?.[1] ? `Exit code ${match[1]}` : ''
}

export const buildWorkspaceToolActionItems = (
  tools: ToolCall[],
  forceSettled = false,
  changeSummary?: TaskGitChangeSummary,
): WorkspaceToolActionItem[] => {
  const findChangeFileForPath = (pathPreview: string) => {
    if (!pathPreview || !changeSummary) {
      return undefined
    }

    return changeSummary.files.find((file) => {
      return file.path === pathPreview
        || pathPreview.endsWith(file.path)
        || file.path.endsWith(pathPreview)
    })
  }

  return tools.map((tool) => {
    const display = getToolCallPersistenceDisplay(tool)
    const kind = resolveToolActionKind(tool.name)
    const parsedArgs = parseToolPayload(display.args ?? '')
    const summary = buildToolSummary(tool)
    const pathPreview = extractPathPreview(parsedArgs)
    const pathParts = splitPathPreview(pathPreview)
    const resultText = display.result ?? ''
    const status = resolveToolActionStatus(tool, forceSettled, resultText)
    const changeFile = findChangeFileForPath(pathPreview)
    const commandPreview = kind === 'run' ? extractCommandPreview(parsedArgs) : ''
    const title = pathParts.title || commandPreview || summary || formatToolName(tool.name)
    const detail = pathParts.title
      ? summary.replace(pathPreview, '').replace(/^\s*[·:：-]\s*/, '').trim()
      : summary

    return {
      tool,
      kind,
      status,
      label: status === 'running'
        ? '运行中'
        : status === 'failed'
          ? '失败'
          : status === 'interrupted'
            ? '已停止'
            : toolActionDoneLabels[kind],
      title,
      detail,
      directory: pathParts.directory,
      diffStat: changeFile
        ? `+${changeFile.additions} -${changeFile.deletions}`
        : kind === 'edit'
          ? extractDiffStat(`${display.args ?? ''}\n${resultText}`)
          : '',
      exitCode: kind === 'run' ? extractExitCode(resultText) : '',
    }
  })
}

const buildWorkspaceToolActionSummary = (items: WorkspaceToolActionItem[]) => {
  const counts = items.reduce((next, item) => {
    next[item.kind] = (next[item.kind] ?? 0) + 1
    return next
  }, {} as Partial<Record<WorkspaceToolActionKind, number>>)
  const segments = [
    counts.search ? `${counts.search} 搜索` : '',
    counts.read ? `${counts.read} 文件` : '',
    counts.edit ? `${counts.edit} 编辑` : '',
    counts.run ? `${counts.run} 命令` : '',
    counts.browse ? `${counts.browse} 浏览` : '',
    counts.ask ? `${counts.ask} 确认` : '',
    counts.other ? `${counts.other} 工具` : '',
  ].filter(Boolean)

  return segments.join(', ')
}

const resolveWorkspaceToolActionTitle = (items: WorkspaceToolActionItem[]) => {
  const firstMeaningful = items.find((item) => item.kind !== 'read' && item.kind !== 'other') ?? items[0]
  return firstMeaningful ? toolActionLabels[firstMeaningful.kind] : '工具'
}

const resolveWorkspaceToolActionIcon = (kind: WorkspaceToolActionKind) => {
  switch (kind) {
    case 'search':
      return Search
    case 'read':
      return FileText
    case 'edit':
      return Pencil
    case 'run':
      return Terminal
    case 'browse':
      return Globe
    case 'ask':
      return MessageSquare
    case 'other':
      return Wrench
  }
}

export function WorkspaceToolActionRow({
  item,
  forceSettled = false,
  connectBefore = false,
  connectAfter = false,
}: {
  item: WorkspaceToolActionItem
  forceSettled?: boolean
  connectBefore?: boolean
  connectAfter?: boolean
}) {
  const { tool } = item
  const display = getToolCallPersistenceDisplay(tool)
  const [expanded, setExpanded] = useState(false)
  const hasContent = Boolean(display.args || display.result)
  const Icon = resolveWorkspaceToolActionIcon(item.kind)
  const isRunning = item.status === 'running'
  const isFailed = item.status === 'failed'
  const isWaiting = item.status === 'waiting'
  const dotTone = isFailed
    ? 'border-rose-400/60 shadow-[0_0_0_2px_rgba(244,63,94,0.10)]'
    : isRunning
      ? 'border-sky-400/60 shadow-[0_0_0_2px_rgba(14,165,233,0.10)]'
      : isWaiting
        ? 'border-amber-400/60 shadow-[0_0_0_2px_rgba(245,158,11,0.10)]'
        : 'border-zinc-600/80 shadow-[0_0_0_2px_rgba(39,39,42,0.75)]'
  const labelTone = isFailed
    ? 'text-rose-300/85'
    : isRunning
      ? 'text-sky-300/85'
      : isWaiting
        ? 'text-amber-300/85'
        : item.kind === 'edit'
          ? 'text-emerald-300/85'
          : 'text-zinc-500 group-hover:text-zinc-400'

  return (
    <div
      data-workspace-tool-action-row
      data-workspace-tool-action-kind={item.kind}
      className={cn('group relative flex items-start gap-2 py-0.5 pl-0.5 pr-2 text-[12px]', TASK_CHAT_TEXT_SELECTION_TONE)}
    >
      <span aria-hidden="true" className="relative flex w-4 shrink-0 self-stretch justify-center">
        <span className={cn(
          'absolute w-px bg-zinc-800/80',
          connectBefore ? '-top-1' : 'top-[0.7rem]',
          connectAfter ? '-bottom-1' : 'bottom-[calc(100%-0.7rem)]',
        )} />
        <span className={cn('relative mt-[0.5rem] flex h-1.5 w-1.5 items-center justify-center rounded-full border bg-[#09090b]', dotTone)} />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => hasContent && setExpanded((value) => !value)}
          className={cn(
            'flex w-full min-w-0 items-start gap-2 text-left leading-[18px]',
            hasContent && 'cursor-pointer',
            !hasContent && 'cursor-default',
          )}
          aria-expanded={hasContent ? expanded : undefined}
        >
          <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', isRunning ? 'animate-pulse text-sky-300' : 'text-zinc-500')} />
          <span className={cn('shrink-0 font-medium', labelTone)}>{item.label}</span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-zinc-200">{item.title}</span>
            {item.directory ? <span className="ml-2 text-zinc-600">{item.directory}</span> : null}
            {!item.directory && item.detail ? <span className="ml-2 text-zinc-500">{item.detail}</span> : null}
          </span>
          {item.diffStat ? <span className="shrink-0 font-mono text-[11px] text-emerald-300">{item.diffStat}</span> : null}
          {item.exitCode ? <span className={cn('shrink-0 font-mono text-[11px]', isFailed ? 'text-rose-300' : 'text-zinc-500')}>{item.exitCode}</span> : null}
          {hasContent ? (
            expanded ? <ChevronUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
          ) : null}
        </button>
        {expanded ? (
          <div className="mt-2 space-y-2 border-l border-zinc-800/80 pl-3">
            {display.args ? (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase text-zinc-600">Args</p>
                <pre className="max-h-[25vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[10px] leading-4 text-zinc-400">
                  {display.args}
                </pre>
              </div>
            ) : null}
            {display.result ? (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase text-zinc-600">Result</p>
                <pre className="max-h-[25vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[10px] leading-4 text-zinc-400">
                  {display.result}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ToolCallRow({
  tool,
  forceSettled = false,
  changeSummary,
}: {
  tool: ToolCall
  forceSettled?: boolean
  changeSummary?: TaskGitChangeSummary
}) {
  const [item] = buildWorkspaceToolActionItems([tool], forceSettled, changeSummary)
  if (!item) {
    return null
  }

  return <WorkspaceToolActionRow item={item} forceSettled={forceSettled} />
}

export function TaskCreatedResultCard({
  task,
  onOpenTask,
}: {
  task: Task
  onOpenTask?: (task: Task) => void
}) {
  const handleOpen = () => {
    onOpenTask?.(task)
  }

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 shadow-[0_0_0_1px_rgba(16,185,129,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-300">已创建任务</p>
          <p className="mt-1 text-xs text-zinc-400">任务已写入项目，可直接打开继续处理。</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
          onClick={handleOpen}
        >
          打开任务
        </Button>
      </div>
      <TaskCard task={task} selected={false} onClick={handleOpen} />
    </div>
  )
}

export function TaskCreatedToolResult({
  tool,
  task,
  onOpenTask,
}: {
  tool: ToolCall
  task?: Task
  onOpenTask?: (task: Task) => void
}) {
  const card = useMemo(() => {
    if (!task || tool.metadata?.resultPreviewKind !== 'task_created') {
      return null
    }

    return (
      <div className="mt-2">
        <TaskCreatedResultCard task={task} onOpenTask={onOpenTask} />
      </div>
    )
  }, [onOpenTask, task, tool.metadata?.resultPreviewKind])

  return (
    <div>
      <ToolCallRow tool={tool} />
      {card}
    </div>
  )
}

export function ToolCallGroup({
  tools,
  defaultExpanded = true,
  forceSettled = false,
  changeSummary,
}: {
  tools: ToolCall[]
  defaultExpanded?: boolean
  forceSettled?: boolean
  changeSummary?: TaskGitChangeSummary
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const items = useMemo(() => buildWorkspaceToolActionItems(tools, forceSettled, changeSummary), [changeSummary, forceSettled, tools])

  if (items.length === 0) {
    return null
  }

  const runningCount = items.filter((item) => item.status === 'running').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const interruptedCount = items.filter((item) => item.status === 'interrupted').length
  const groupTitle = resolveWorkspaceToolActionTitle(items)
  const summary = buildWorkspaceToolActionSummary(items)
  const Icon = resolveWorkspaceToolActionIcon((items.find((item) => item.kind !== 'read' && item.kind !== 'other') ?? items[0])?.kind ?? 'other')
  const statusText = runningCount > 0
    ? `${runningCount} 运行中`
    : failedCount > 0
      ? `${failedCount} 失败`
      : interruptedCount > 0
        ? `${interruptedCount} 已停止`
        : `${items.length} 已完成`
  const statusTone = runningCount > 0
    ? 'text-sky-300'
    : failedCount > 0
      ? 'text-rose-300'
      : interruptedCount > 0
        ? 'text-zinc-400'
        : 'text-emerald-300'

  return (
    <div data-workspace-tool-action-group className={cn('text-xs', TASK_CHAT_TEXT_SELECTION_TONE)}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mb-1 flex w-full min-w-0 items-center gap-2 py-0.5 text-left"
        aria-expanded={expanded}
      >
        <span className="flex w-4 shrink-0 justify-center">
          <Icon className={cn('h-3.5 w-3.5', runningCount > 0 ? 'animate-pulse text-sky-300' : 'text-zinc-500')} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-300">
          {groupTitle}
          {summary ? <span className="ml-2 font-normal text-zinc-600">· {summary}</span> : null}
        </span>
        <span className={cn('shrink-0 text-[11px] font-medium', statusTone)}>{statusText}</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-zinc-600" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-600" />}
      </button>
      {expanded ? (
        <div className="space-y-0">
          {items.map((item, index) => (
            <WorkspaceToolActionRow
              key={item.tool.id}
              item={item}
              forceSettled={forceSettled}
              connectBefore={index > 0}
              connectAfter={index < items.length - 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function TurnStatusMeta({
  status,
  children,
}: {
  status: AgentRunningStatus
  children?: ReactNode
}) {
  const tone =
    status === 'error'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
      : status === 'complete'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
      : status === 'waiting'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
        : 'border-sky-500/20 bg-sky-500/10 text-sky-200'

  return (
    <div className={cn('inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[11px]', tone)}>
      <span>{statusLabel[status]}</span>
      {children ? (
        <>
          <span aria-hidden="true" className="opacity-35">·</span>
          <span className="min-w-0 truncate">{children}</span>
        </>
      ) : null}
    </div>
  )
}

export function TypingBubble({
  step,
  assistantLabel = 'AI',
  assistantAvatarUrl,
  assistantAvatarFallback = 'AI',
  assistantAvatarRuntime,
  mobileHeaderLayout = false,
}: {
  step: string
  assistantLabel?: string
  assistantAvatarUrl?: string
  assistantAvatarFallback?: string
  assistantAvatarRuntime?: AgentType
  mobileHeaderLayout?: boolean
}) {
  const showAssistantRuntimeIcon = assistantAvatarRuntime && !assistantAvatarUrl

  const avatarNode = showAssistantRuntimeIcon && assistantAvatarRuntime ? (
    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
      <RuntimeIcon
        runtime={assistantAvatarRuntime}
        size={RUNTIME_AVATAR_ICON_SIZE}
        className="rounded-[7px]"
      />
    </span>
  ) : (
    <Avatar className="h-7 w-7 flex-shrink-0 border border-sky-500/30 bg-sky-500/15">
      {assistantAvatarUrl ? <AvatarImage src={resolveMediaUrl(assistantAvatarUrl)} /> : null}
      <AvatarFallback className="text-[10px] font-semibold bg-sky-500/15 text-sky-200">
        {assistantAvatarFallback}
      </AvatarFallback>
    </Avatar>
  )

  const labelNode = (
    <p className="flex min-w-0 max-w-full items-center gap-1.5 select-none text-[10px] font-medium uppercase tracking-wide text-sky-300">
      <span className="block truncate">{assistantLabel}</span>
    </p>
  )

  const bubbleNode = (
    <div className="max-w-full rounded-lg rounded-tl-sm border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-sm text-zinc-100 shadow-sm">
      <div className="flex items-center gap-2">
        <AiLoader size={20} variant="cubes" className="flex-shrink-0" />
        <span className="text-sweep">
          {step || '正在执行中...'}
        </span>
      </div>
    </div>
  )

  if (mobileHeaderLayout) {
    return (
      <div className="flex w-full min-w-0 flex-col items-start gap-1.5">
        <div className="flex min-w-0 max-w-full items-center gap-2 px-1">
          {avatarNode}
          {labelNode}
        </div>
        <div className="flex w-full min-w-0 flex-col items-start">
          {bubbleNode}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      {avatarNode}
      <div className="flex max-w-[88%] min-w-0 flex-col items-start">
        <div className="mb-1.5 max-w-full px-1">
          {labelNode}
        </div>
        {bubbleNode}
      </div>
    </div>
  )
}

export function SystemTimelineItem({
  content,
  tone = 'system',
  connectBefore = false,
  connectAfter = false,
  createdAt,
}: {
  content: string
  tone?: 'system' | 'review'
  connectBefore?: boolean
  connectAfter?: boolean
  createdAt?: string
}) {
  const isReview = tone === 'review'
  const pathMatch = content.match(/^(.+?[:：])\s*(\/.+)$/)
  const label = pathMatch ? pathMatch[1] : null
  const filePath = pathMatch ? pathMatch[2] : null
  const normalizedCreatedAt = createdAt?.trim() || ''
  const messageTime = normalizedCreatedAt ? formatMessageTime(normalizedCreatedAt) : ''

  return (
    <div
      aria-label={isReview ? '审查提示' : '系统提示'}
      data-system-timeline-item
      data-timeline-connect-before={connectBefore ? 'true' : undefined}
      data-timeline-connect-after={connectAfter ? 'true' : undefined}
      className={cn(
        'group relative flex items-start gap-2 py-0.5 pl-0.5 pr-2 text-[12px]',
        TASK_CHAT_TEXT_SELECTION_TONE,
        isReview
          ? 'text-amber-200/80'
          : 'text-zinc-500',
      )}
    >
      <span aria-hidden="true" className="relative flex w-4 shrink-0 self-stretch justify-center">
        <span className={cn(
          'absolute w-px',
          connectBefore ? '-top-1' : 'top-[0.7rem]',
          connectAfter ? '-bottom-1' : 'bottom-[calc(100%-0.7rem)]',
          isReview ? 'bg-amber-500/20' : 'bg-zinc-800/80',
        )} />
        <span className={cn(
          'relative mt-[0.5rem] h-1.5 w-1.5 rounded-full border bg-[#09090b]',
          isReview ? 'border-amber-400/45 shadow-[0_0_0_3px_rgba(245,158,11,0.08)]' : 'border-zinc-600/80 shadow-[0_0_0_2px_rgba(39,39,42,0.75)]',
        )} />
      </span>
      {filePath ? (
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-[18px]">
            <span className={cn(
              'inline text-[10px] font-medium uppercase tracking-wide',
              isReview ? 'text-amber-300/60' : 'text-zinc-600 group-hover:text-zinc-500',
            )}>
              {isReview ? '审查' : '系统'}
            </span>
            {messageTime ? (
              <time
                dateTime={normalizedCreatedAt}
                title={formatMessageTimeTitle(normalizedCreatedAt)}
                className="font-mono text-[10px] tabular-nums text-zinc-700 group-hover:text-zinc-600"
              >
                {messageTime}
              </time>
            ) : null}
          </div>
          <p className="min-w-0 break-words leading-[18px]">
            <span className={cn(isReview ? 'text-amber-200/70' : 'text-zinc-500 group-hover:text-zinc-400')}>{label} </span>
            <code className={cn('inline rounded px-1 py-0.5 font-mono text-[11px]', isReview ? 'bg-amber-500/10 text-amber-200/75' : 'bg-zinc-900/70 text-zinc-400')}>
              {filePath}
            </code>
          </p>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-[18px]">
            <span className={cn(
              'inline text-[10px] font-medium uppercase tracking-wide',
              isReview ? 'text-amber-300/60' : 'text-zinc-600 group-hover:text-zinc-500',
            )}>
              {isReview ? '审查' : '系统'}
            </span>
            {messageTime ? (
              <time
                dateTime={normalizedCreatedAt}
                title={formatMessageTimeTitle(normalizedCreatedAt)}
                className="font-mono text-[10px] tabular-nums text-zinc-700 group-hover:text-zinc-600"
              >
                {messageTime}
              </time>
            ) : null}
          </div>
          <CollapsibleMessageBody
            contentKey={content}
            maxHeight={TASK_CHAT_MESSAGE_COLLAPSED_HEIGHT}
            className="mt-0.5 text-zinc-500 group-hover:text-zinc-400"
            overlayClassName="from-[#09090b] via-[#09090b]/95 to-transparent"
            toggleAlignment="start"
            toggleClassName={cn(
              TASK_CHAT_COLLAPSE_TOGGLE_CLASSNAME,
              isReview && TASK_CHAT_REASONING_COLLAPSE_TOGGLE_CLASSNAME,
            )}
          >
            <p className="min-w-0 whitespace-pre-wrap break-words">{content}</p>
          </CollapsibleMessageBody>
        </div>
      )}
    </div>
  )
}

export function ExecutorSwitchTimelineItem({
  content,
}: {
  content: string
}) {
  const summary = parseExecutorSwitchSummary(content)
  if (!summary) {
    return null
  }

  return (
    <div
      aria-label="节点切换提示"
      className={cn(
        'group flex items-center gap-2 py-1 pl-0.5 pr-2 text-[12px] text-sky-200/80',
        TASK_CHAT_TEXT_SELECTION_TONE,
      )}
    >
      <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">
        <GitBranch className="mt-0.5 h-3.5 w-3.5 text-sky-400/70" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 leading-5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-sky-400/60">节点切换</span>
        <span className="font-medium text-sky-100/90">{summary.fromExecutor} → {summary.toExecutor}</span>
        {summary.branchName ? (
          <code className="max-w-full truncate rounded bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
            {summary.branchName}
          </code>
        ) : null}
        <span className="text-zinc-500">正在准备新节点工作目录</span>
      </div>
    </div>
  )
}

export function ExecutorSwitchEventCard({
  content,
  createdAt,
  connectBefore = false,
  connectAfter = false,
}: {
  content: string
  createdAt?: string
  connectBefore?: boolean
  connectAfter?: boolean
}) {
  const summary = parseExecutorSwitchSummary(content)
  if (!summary) {
    return null
  }
  const normalizedCreatedAt = createdAt?.trim() || ''
  const messageTime = normalizedCreatedAt ? formatMessageTime(normalizedCreatedAt) : ''

  return (
    <div
      aria-label="节点切换事件"
      data-system-timeline-item
      data-timeline-connect-before={connectBefore ? 'true' : undefined}
      data-timeline-connect-after={connectAfter ? 'true' : undefined}
      className={cn(
        'group relative flex items-start gap-2 py-0.5 pl-0.5 pr-2 text-[12px] text-zinc-500',
        TASK_CHAT_TEXT_SELECTION_TONE,
      )}
    >
      <span aria-hidden="true" className="relative flex w-4 shrink-0 self-stretch justify-center">
        <span className={cn(
          'absolute w-px',
          connectBefore ? '-top-1' : 'top-[0.7rem]',
          connectAfter ? '-bottom-1' : 'bottom-[calc(100%-0.7rem)]',
          'bg-zinc-800/80',
        )} />
        <span className="relative mt-[0.5rem] h-1.5 w-1.5 rounded-full border border-sky-400/55 bg-[#09090b] shadow-[0_0_0_2px_rgba(14,165,233,0.10)]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-[18px]">
        <span className="inline text-[10px] font-medium uppercase tracking-wide text-sky-500/80">切换</span>
        {messageTime ? (
          <time
            dateTime={normalizedCreatedAt}
            title={formatMessageTimeTitle(normalizedCreatedAt)}
            className="font-mono text-[10px] tabular-nums text-zinc-700 group-hover:text-zinc-600"
          >
            {messageTime}
          </time>
        ) : null}
        <p className="min-w-0 basis-full break-words">
          <span className="text-zinc-300">{summary.fromExecutor}</span>
          <span className="mx-1 text-zinc-600">{'->'}</span>
          <span className="text-zinc-200">{summary.toExecutor}</span>
          {summary.branchName ? (
            <>
              <span className="mx-1 text-zinc-700">·</span>
              <code className="inline rounded bg-zinc-900/70 px-1 py-0.5 font-mono text-[11px] text-zinc-400">
                {summary.branchName}
              </code>
            </>
          ) : null}
        </p>
      </div>
    </div>
  )
}

export function SystemLogItem({
  log,
  connectBefore = false,
  connectAfter = false,
}: {
  log: ExecutionLog
  connectBefore?: boolean
  connectAfter?: boolean
}) {
  return (
    <SystemTimelineItem
      content={log.content}
      tone={log.role === 'review' ? 'review' : 'system'}
      connectBefore={connectBefore}
      connectAfter={connectAfter}
      createdAt={log.createdAt}
    />
  )
}

export function QueuedMessages({
  queuedMessages,
  queueStatusMessage,
  onEdit,
  onRemove,
}: {
  queuedMessages: TaskChatQueueEntry[]
  queueStatusMessage?: string
  onEdit: (queueId: string, message: string, attachments: TaskChatAttachment[]) => void
  onRemove: (queueId: string) => void
}) {
  if (queuedMessages.length === 0) {
    return null
  }

  return (
    <div className="text-xs">
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-medium text-zinc-500">
        <span>消息队列</span>
        <Badge variant="secondary" className="border-zinc-800 bg-zinc-950 text-[11px] text-zinc-300">{queuedMessages.length} 条待发送</Badge>
      </div>
      {queueStatusMessage ? (
        <div className="mb-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-5 text-amber-100">
          {queueStatusMessage}
        </div>
      ) : null}
      <div className="divide-y divide-zinc-800/60">
        {queuedMessages.map((queuedMessage, index) => (
          <div key={queuedMessage.id} className="flex items-start gap-2 py-2 text-xs text-zinc-400 first:pt-1 last:pb-1">
            <div className={cn('min-w-0 flex-1 leading-5', TASK_CHAT_TEXT_SELECTION_TONE)}>
              <span className="mr-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">#{index + 1}</span>
              <span
                className="inline-block max-w-full overflow-hidden whitespace-pre-wrap break-words align-top"
                style={{ maxHeight: TASK_CHAT_QUEUE_PREVIEW_MAX_HEIGHT }}
                title={queuedMessage.message}
              >
                {queuedMessage.message}
              </span>
              {queuedMessage.attachments && queuedMessage.attachments.length > 0 ? (
                <MessageAttachments
                  attachments={queuedMessage.attachments}
                  containerClassName="mt-2"
                  imageClassName="h-20 w-20"
                />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="text-[10px] text-zinc-500 transition-colors hover:text-zinc-200"
                onClick={() => onEdit(queuedMessage.id, queuedMessage.message, queuedMessage.attachments ?? [])}
              >
                编辑
              </button>
              <button
                type="button"
                className="text-[10px] text-zinc-500 transition-colors hover:text-zinc-100"
                onClick={() => onRemove(queuedMessage.id)}
              >
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface AgentChatQueueEntry {
  id: string
  content: string
  attachments?: TaskChatAttachment[]
  createdAt: string
  editedAt?: string
}

export function AgentChatQueue({
  queue,
  onRemove,
  onEdit,
  onMoveToInput,
}: {
  queue: AgentChatQueueEntry[]
  onRemove: (id: string) => void
  onEdit: (id: string, content: string) => void
  onMoveToInput: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  if (queue.length === 0) {
    return null
  }

  const startEditing = (id: string, content: string) => {
    setEditingId(id)
    setEditingContent(content)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingContent('')
  }

  const saveEdit = (id: string) => {
    if (editingContent.trim()) {
      onEdit(id, editingContent.trim())
    }
    cancelEditing()
  }

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-zinc-500">
        <span>消息队列</span>
        <Badge variant="secondary" className="border-zinc-800 bg-zinc-950 text-[11px] text-zinc-300">{queue.length} 条待发送</Badge>
      </div>
      <div className="space-y-2">
        {queue.map((queuedMessage, index) => (
          <div className={cn('group rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs text-zinc-400', TASK_CHAT_TEXT_SELECTION_TONE)} key={queuedMessage.id}>
            <div className="flex items-start gap-2">
              <span className="mr-2 text-[10px] font-medium uppercase tracking-wide text-zinc-300">#{index + 1}</span>
              {editingId === queuedMessage.id ? (
                <div className="min-w-0 flex-1 space-y-1">
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
                    rows={2}
                    autoFocus
                    onKeyDown={(e) => {
                      if (isImeComposingKeyboardEvent(e)) {
                        return
                      }

                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        saveEdit(queuedMessage.id)
                      }
                      if (e.key === 'Escape') {
                        cancelEditing()
                      }
                    }}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => saveEdit(queuedMessage.id)}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-600"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <span
                    className="inline-block max-w-full overflow-hidden whitespace-pre-wrap break-words align-top"
                    style={{ maxHeight: TASK_CHAT_QUEUE_PREVIEW_MAX_HEIGHT }}
                    title={queuedMessage.content}
                  >
                    {queuedMessage.content}
                  </span>
                  {queuedMessage.editedAt ? (
                    <span className="ml-2 text-[10px] text-zinc-600">(已编辑)</span>
                  ) : null}
                  {queuedMessage.attachments && queuedMessage.attachments.length > 0 ? (
                    <MessageAttachments
                      attachments={queuedMessage.attachments}
                      containerClassName="mt-2"
                      imageClassName="h-20 w-20"
                    />
                  ) : null}
                </div>
              )}
            </div>
            {editingId !== queuedMessage.id && (
              <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => startEditing(queuedMessage.id, queuedMessage.content)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => onMoveToInput(queuedMessage.id)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  移回输入框
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(queuedMessage.id)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-rose-400"
                >
                  移除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

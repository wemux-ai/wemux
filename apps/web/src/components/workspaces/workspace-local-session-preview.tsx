import type { ExecutorAgentSessionDetail, ExecutorAgentSessionEntry, ExecutorAgentSessionSummary } from '@shared/types'
import { Download, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CollapsibleMessageBody } from '../chat/collapsible-message-body'
import { RuntimeIcon } from '../runtime/runtime-icons'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

type WorkspaceLocalSessionPreviewProps = {
  sessionSummary?: ExecutorAgentSessionSummary | null
  sessionDetail?: ExecutorAgentSessionDetail | null
  loading?: boolean
  importing?: boolean
  executorName?: string
  onImport?: () => void
}

const SOURCE_LABELS: Record<ExecutorAgentSessionSummary['source'], string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  pi: 'Pi',
}

const LOCAL_SESSION_RUNTIME_BY_SOURCE = {
  claude: 'ClaudeCode',
  opencode: 'OpenCode',
  codex: 'Codex',
  pi: 'Pi',
} as const

const RUNTIME_AVATAR_ICON_SIZE = 24

const formatTimestamp = (value?: string) => {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const getPreviewEntryLabel = (
  entry: ExecutorAgentSessionEntry,
  assistantLabel: string,
) => {
  if (entry.role === 'user') {
    return '你'
  }

  if (entry.role === 'tool') {
    return '工具'
  }

  if (entry.role === 'system') {
    return '思考'
  }

  return assistantLabel
}

const getPreviewEntryAvatar = (
  entry: ExecutorAgentSessionEntry,
  assistantRuntime: (typeof LOCAL_SESSION_RUNTIME_BY_SOURCE)[keyof typeof LOCAL_SESSION_RUNTIME_BY_SOURCE] | null,
) => {
  if (entry.role === 'user') {
    return '你'
  }

  if (entry.role === 'assistant' && assistantRuntime) {
    return (
      <RuntimeIcon
        runtime={assistantRuntime}
        size={RUNTIME_AVATAR_ICON_SIZE}
        className="rounded-[7px]"
      />
    )
  }

  if (entry.role === 'tool') {
    return '工'
  }

  if (entry.role === 'system') {
    return '思'
  }

  return 'AI'
}

const getPreviewEntryClasses = (entry: ExecutorAgentSessionEntry) => {
  if (entry.role === 'user') {
    return {
      row: 'flex-row-reverse',
      column: 'items-end',
      avatar: 'border-slate-700 bg-slate-900',
      avatarFallback: 'bg-slate-900 text-slate-50',
      label: 'text-zinc-400',
      bubble: 'rounded-tr-sm border border-zinc-700 bg-zinc-900 text-zinc-50',
    }
  }

  if (entry.role === 'tool') {
    return {
      row: '',
      column: 'items-start',
      avatar: 'border-amber-900/80 bg-amber-950/40',
      avatarFallback: 'bg-amber-950/60 text-amber-200',
      label: 'text-amber-300',
      bubble: 'rounded-tl-sm border border-amber-900/70 bg-amber-950/20 text-amber-50',
    }
  }

  if (entry.role === 'system') {
    return {
      row: '',
      column: 'items-start',
      avatar: 'border-emerald-900/80 bg-emerald-950/40',
      avatarFallback: 'bg-emerald-950/60 text-emerald-200',
      label: 'text-emerald-300',
      bubble: 'rounded-tl-sm border border-emerald-900/70 bg-emerald-950/20 text-emerald-50',
    }
  }

  return {
    row: '',
    column: 'items-start',
    avatar: 'border-zinc-800 bg-zinc-900',
    avatarFallback: 'bg-zinc-900 text-zinc-100',
    label: 'text-sky-300',
    bubble: 'rounded-tl-sm border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-[0_0_0_1px_rgba(14,165,233,0.04)]',
  }
}

function MarkdownPreviewMessage({ content, isUser }: { content: string; isUser: boolean }) {
  return (
    <div
      className={cn(
        'markdown-body space-y-3 break-words text-sm leading-relaxed',
        isUser ? 'text-zinc-50' : 'text-zinc-100',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap break-words leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className={cn('rounded px-1.5 py-0.5 font-mono text-[0.92em]', isUser ? 'bg-black/25 text-zinc-100' : 'bg-zinc-900 text-zinc-100')}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className={cn('overflow-auto rounded-2xl px-3 py-2 text-xs', isUser ? 'bg-black/25 text-zinc-100' : 'bg-[#09090b] text-zinc-100')}>
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-4">
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function WorkspaceLocalSessionPreview({
  sessionSummary,
  sessionDetail,
  loading = false,
  importing = false,
  executorName,
  onImport,
}: WorkspaceLocalSessionPreviewProps) {
  const previewEntries = sessionDetail?.entries ?? []
  const previewMessages = previewEntries.slice(0, 10)
  const remainingCount = Math.max(previewEntries.length - previewMessages.length, 0)
  const visibleEntryCount = sessionDetail?.entryCount ?? sessionSummary?.entryCount ?? 0
  const assistantLabel = sessionSummary ? SOURCE_LABELS[sessionSummary.source] : 'Assistant'
  const assistantRuntime = sessionSummary ? LOCAL_SESSION_RUNTIME_BY_SOURCE[sessionSummary.source] : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-zinc-100">
                {sessionSummary?.title || sessionDetail?.title || '节点本地会话预览'}
              </h2>
              {sessionSummary ? (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400">
                  {SOURCE_LABELS[sessionSummary.source]}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
              {executorName ? <span>{executorName}</span> : null}
              <span>{formatTimestamp(sessionSummary?.lastUpdatedAt || sessionDetail?.lastUpdatedAt)}</span>
              <span>{visibleEntryCount} 条记录</span>
            </div>
            <div className="mt-2 truncate text-xs text-zinc-600">
              {sessionSummary?.cwd || sessionDetail?.cwd || '—'}
            </div>
          </div>
          {onImport ? (
            <Button
              type="button"
              onClick={onImport}
              disabled={loading || importing || !sessionSummary}
              className="shrink-0 bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              导入为新会话
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex h-full min-h-40 items-center justify-center text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在读取节点本地会话预览…
          </div>
        ) : !sessionSummary ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center text-sm text-zinc-500">
            从左侧“节点本地会话”里选一个会话，这里先展示前 10 条本地会话记录。
          </div>
        ) : previewMessages.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center text-sm text-zinc-500">
            这个节点本地会话里暂时没有可预览记录。
          </div>
        ) : (
          <div className="space-y-4">
            {previewMessages.map((entry) => {
              const entryClasses = getPreviewEntryClasses(entry)
              const entryLabel = getPreviewEntryLabel(entry, assistantLabel)
              const showAssistantRuntimeAvatar = entry.role === 'assistant' && Boolean(assistantRuntime)

              return (
                <div key={entry.id} className={cn('flex items-start gap-2.5', entryClasses.row)}>
                  {showAssistantRuntimeAvatar ? (
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
                      {getPreviewEntryAvatar(entry, assistantRuntime)}
                    </span>
                  ) : (
                    <Avatar
                      className={cn(
                        'h-7 w-7 flex-shrink-0 select-none border',
                        entryClasses.avatar,
                      )}
                    >
                      <AvatarFallback
                        className={cn(
                          'text-[10px] font-semibold',
                          entryClasses.avatarFallback,
                        )}
                      >
                        {getPreviewEntryAvatar(entry, assistantRuntime)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className={cn('flex max-w-[88%] flex-col', entryClasses.column)}>
                    <p
                      className={cn(
                        'mb-1.5 max-w-full px-1 select-none text-[10px] font-medium uppercase tracking-wide',
                        entryClasses.label,
                      )}
                    >
                      <span className="block truncate">
                        {entryLabel}
                      </span>
                    </p>
                    <div
                      className={cn(
                        'max-w-full rounded-lg px-3.5 py-3 text-sm shadow-sm',
                        entryClasses.bubble,
                      )}
                    >
                      <CollapsibleMessageBody
                        enabled={entry.role === 'user'}
                        contentKey={entry.text}
                        overlayClassName="from-zinc-900 via-zinc-900/95 to-transparent"
                        toggleAlignment="end"
                        toggleClassName="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
                      >
                        <MarkdownPreviewMessage content={entry.text} isUser={entry.role === 'user'} />
                      </CollapsibleMessageBody>
                    </div>
                    <div className={cn('mt-0.5 flex items-center', entry.role === 'user' ? 'justify-end' : 'justify-start')}>
                      <span className="pl-2 select-none text-[10px] text-zinc-500">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
            {remainingCount > 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 px-3 py-3 text-center text-xs text-zinc-500">
                仅预览前 {previewMessages.length} 条记录，剩余 {remainingCount} 条不会在这里展开。
              </div>
            ) : null}
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 px-3 py-3 text-center text-xs text-zinc-500">
              预览会显示工具调用和思考记录；真正导入到新会话时，只会带入用户和助手消息。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

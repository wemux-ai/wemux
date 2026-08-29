// [INPUT]: 选中的反馈工单 id（可空=新建模式）、附件上传意图
// [OUTPUT]: 客服会话视图（消息气泡 + 图片附件 + 输入框发送），支撑「与创始人直接沟通」
// [POS]: 用户侧反馈会话展示层；无 feedbackId 时发首条消息自动创建 chat 工单
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquareText, Paperclip, Send } from 'lucide-react'
import type { FeedbackAttachment, FeedbackItem, FeedbackMessage } from '@shared/types'
import { api } from '@/lib/api'
import { downloadDriveFile, previewDriveFileUrl } from '@/lib/api/methods/drive'
import { useTranslation } from '@/lib/i18n/react'
import { Button } from '@/components/ui/button'
import { cn, formatDate } from '@/lib/utils'
import { FeedbackAttachmentPicker } from './feedback-attachment-picker'

const isImageAttachment = (attachment: FeedbackAttachment) =>
  !attachment.mimeType || attachment.mimeType.startsWith('image/')

function AttachmentImage({ attachment }: { attachment: FeedbackAttachment }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let objectUrl = ''
    let cancelled = false
    void previewDriveFileUrl(null, attachment.driveFileId).then((resolved) => {
      if (cancelled) {
        URL.revokeObjectURL(resolved)
        return
      }
      objectUrl = resolved
      setUrl(resolved)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.driveFileId])

  if (!url) {
    return <div className="h-28 w-40 animate-pulse rounded-md border border-zinc-800 bg-zinc-950" />
  }
  return (
    <img
      src={url}
      alt={attachment.name}
      className="max-h-48 max-w-full rounded-md border border-zinc-800 object-contain"
    />
  )
}

function MessageBubble({ message, language }: { message: FeedbackMessage; language: string }) {
  const isUser = message.role === 'user'
  const attachments = message.attachments ?? []
  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          isUser
            ? 'border-zinc-700 bg-zinc-800 text-zinc-100'
            : 'border-zinc-800 bg-zinc-950 text-zinc-200',
        )}
      >
        {!isUser && (
          <p className="mb-1 text-[11px] font-medium text-amber-400/90">
            {message.senderName || (language === 'zh' ? '创始人' : 'Founder')}
          </p>
        )}
        {attachments.length > 0 && (
          <div className={cn('mb-2 flex flex-wrap gap-2', isUser && 'justify-end')}>
            {attachments.map((attachment) =>
              isImageAttachment(attachment) ? (
                <AttachmentImage key={attachment.driveFileId} attachment={attachment} />
              ) : (
                <button
                  key={attachment.driveFileId}
                  type="button"
                  onClick={() => void downloadDriveFile(null, attachment.driveFileId, attachment.name)}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                >
                  <Paperclip className="size-3" />
                  <span className="max-w-[10rem] truncate">{attachment.name}</span>
                </button>
              ),
            )}
          </div>
        )}
        {message.content && <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.content}</p>}
        <p className="mt-1 text-right text-[10px] text-zinc-600">{formatDate(message.createdAt)}</p>
      </div>
    </div>
  )
}

export function FeedbackConversation({
  feedbackId,
  onBack,
  onFeedbackUpdated,
  onCreated,
}: {
  /** 会话 id；undefined 表示新建模式（发首条消息自动创建 chat 工单）。 */
  feedbackId?: string
  onBack?: () => void
  onFeedbackUpdated?: (feedback: FeedbackItem) => void
  onCreated?: (feedback: FeedbackItem) => void
}) {
  const { t, language } = useTranslation()
  const [feedback, setFeedback] = useState<FeedbackItem | null>(null)
  const [messages, setMessages] = useState<FeedbackMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(Boolean(feedbackId))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!feedbackId) {
      setFeedback(null)
      setMessages([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    const load = async () => {
      try {
        const detail = await api.getFeedbackDetail(feedbackId)
        if (!cancelled) {
          setFeedback(detail.feedback)
          setMessages(detail.messages)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('feedback.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [feedbackId, t])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !sending && !uploading

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError('')
    try {
      const content = draft.trim()
      const payloadAttachments = attachments
      if (!feedbackId) {
        // 新建模式：发首条消息 → 确保/创建「与创始人」单一 chat 会话
        const response = await api.sendChatMessage({ content, attachments: payloadAttachments })
        setDraft('')
        setAttachments([])
        onCreated?.(response.feedback)
        return
      }
      const response = await api.sendFeedbackMessage(feedbackId, { content, attachments: payloadAttachments })
      setMessages((prev) => [...prev, response.message])
      setFeedback(response.feedback)
      onFeedbackUpdated?.(response.feedback)
      setDraft('')
      setAttachments([])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('feedback.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-2 bg-[#09090b] text-zinc-600">
        <Loader2 className="size-5 animate-spin" />
        <p className="text-xs">{t('analytics.loading')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-3 py-1.5 sm:px-4">
        {onBack ? (
          <Button type="button" variant="ghost" size="icon" onClick={onBack} className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100" aria-label={t('feedback.back')}>
            ←
          </Button>
        ) : null}
        <MessageSquareText className="size-3.5 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-zinc-100">
            {feedback ? feedback.title : (language === 'zh' ? '与创始人直接沟通' : 'Chat with the founder')}
          </h2>
          <p className="text-[10px] text-zinc-600">
            {feedback
              ? (language === 'zh' ? '与创始人直接沟通' : 'Direct chat with the founder')
              : (language === 'zh' ? '发第一条消息，创始人会在这里回复你' : 'Send a message and the founder will reply here')}
          </p>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
        {messages.length === 0 && !feedback ? (
          <div className="flex flex-col items-center gap-2 pt-8 text-center">
            <MessageSquareText className="size-7 text-zinc-700" />
            <p className="text-xs text-zinc-600">{t('feedback.chatEmptyHint')}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-8 text-center">
            <MessageSquareText className="size-6 text-zinc-700" />
            <p className="text-xs text-zinc-600">{t('feedback.conversationEmpty')}</p>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} language={language} />)
        )}
      </div>

      {error ? <p className="shrink-0 px-4 pb-1 text-[11px] text-rose-400">{error}</p> : null}

      <div className="shrink-0 border-t border-zinc-900 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={t('feedback.messagePlaceholder')}
            rows={2}
            maxLength={8000}
            className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
          />
          <FeedbackAttachmentPicker attachments={attachments} onChange={setAttachments} compact />
          <Button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="h-9 shrink-0 rounded-lg bg-zinc-100 px-3 text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

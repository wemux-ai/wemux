// [INPUT]: /api/feedback 提交与 /api/feedback/mine 查询
// [OUTPUT]: 反馈提交表单（类型选择 / 标题 / 正文 / 提交 / 我的反馈列表）
// [POS]: 用户侧反馈表单；提交后走 server 权威存储，可追踪状态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useState } from 'react'
import { Bug, CheckCircle2, Lightbulb, Loader2 } from 'lucide-react'
import type { FeedbackAttachment, FeedbackItem, FeedbackSubmitPayload } from '@/lib/api'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useTranslation } from '@/lib/i18n/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FeedbackAttachmentPicker } from './feedback-attachment-picker'

type FeedbackType = FeedbackSubmitPayload['type']

const statusBadgeClassName: Record<FeedbackItem['status'], string> = {
  open: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  triaged: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  closed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
}

export function FeedbackForm({
  onCreated,
  onOpen,
}: {
  /** 提交成功后回调（创建了客服会话），用于直接进入会话视图。 */
  onCreated?: (item: FeedbackItem) => void
  /** 点击「我的反馈」条目，打开该工单的客服会话。 */
  onOpen?: (item: FeedbackItem) => void
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [type, setType] = useState<FeedbackType>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [mine, setMine] = useState<FeedbackItem[]>([])
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([])
  const [consentPublic, setConsentPublic] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const load = async () => {
      try {
        const response = await api.getMyFeedback()
        if (!cancelled) {
          setMine(response.feedback)
        }
      } catch (error) {
        console.error('Failed to load my feedback:', error)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user, submitted])

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const response = await api.submitFeedback({ type, title: title.trim(), body: body.trim(), attachments, consentPublic })
      void api.trackEvent({ eventType: 'feedback_submitted', payload: { type } }).catch(() => {})
      setMine((prev) => [response.feedback, ...prev])
      setTitle('')
      setBody('')
      setAttachments([])
      setConsentPublic(false)
      setSubmitted(true)
      onCreated?.(response.feedback)
    } catch (error) {
      console.error('Failed to submit feedback:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const typeOptions: Array<{
    value: FeedbackType
    label: string
    desc: string
    icon: React.ComponentType<{ className?: string }>
    iconClassName: string
  }> = [
    { value: 'bug', label: t('feedback.bug'), desc: t('feedback.bugDesc'), icon: Bug, iconClassName: 'text-rose-400' },
    { value: 'feature', label: t('feedback.feature'), desc: t('feedback.featureDesc'), icon: Lightbulb, iconClassName: 'text-sky-400' },
  ]

  return (
    <div className="space-y-4">
      {submitted ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-100">{t('feedback.success')}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {t('feedback.successHint')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSubmitted(false)}
            className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {t('feedback.submitAnother')}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {typeOptions.map((option) => {
              const selected = type === option.value
              const Icon = option.icon
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setType(option.value)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
                    selected
                      ? 'border-zinc-700 bg-zinc-900 text-zinc-100'
                      : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-zinc-200',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
                      selected ? 'border-zinc-700 bg-zinc-950' : 'border-zinc-800 bg-zinc-950/60',
                    )}
                  >
                    <Icon className={cn('size-4', selected ? option.iconClassName : 'text-zinc-500')} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">{option.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-title" className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {t('feedback.titleLabel')}
            </Label>
            <Input
              id="feedback-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('feedback.titlePlaceholder')}
              maxLength={200}
              className="h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-body" className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {t('feedback.bodyLabel')}
            </Label>
            <Textarea
              id="feedback-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t('feedback.bodyPlaceholder')}
              rows={5}
              maxLength={8000}
              className="resize-none rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
            />
          </div>

          <FeedbackAttachmentPicker attachments={attachments} onChange={setAttachments} />

          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
            <input
              type="checkbox"
              checked={consentPublic}
              onChange={(event) => setConsentPublic(event.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-zinc-600"
            />
            <span>{t('feedback.consentPublicHint')}</span>
          </label>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-zinc-600">
              {title.length}/200 · {body.length}/8000
            </span>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="h-8 rounded-md bg-zinc-100 px-3.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {submitting ? t('feedback.submitting') : t('feedback.submit')}
            </Button>
          </div>
        </>
      )}

      {mine.length > 0 && (
        <div className="border-t border-zinc-900 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{t('feedback.mine')}</p>
          <div className="max-h-56 space-y-1.5 overflow-auto pr-1">
            {mine.filter((item) => item.type !== 'chat').map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen?.(item)}
                className="block w-full rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {item.type === 'bug' ? (
                      <Bug className="size-3 shrink-0 text-rose-400" />
                    ) : (
                      <Lightbulb className="size-3 shrink-0 text-sky-400" />
                    )}
                    <span className="truncate text-[13px] font-medium text-zinc-200">{item.title}</span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium',
                      statusBadgeClassName[item.status],
                    )}
                  >
                    {t(`feedback.status.${item.status}`)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-500">{item.body}</p>
                {item.lastReplyAt ? (
                  <p className="mt-1 truncate border-t border-zinc-900 pt-1 text-[11px] text-amber-400/80">
                    {t('feedback.founderReply')}：{item.lastReplyPreview}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

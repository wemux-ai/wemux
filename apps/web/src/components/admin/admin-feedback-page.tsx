// [INPUT]: /api/admin/feedback 列表、会话详情、回复与状态/去向更新
// [OUTPUT]: 管理员反馈聊天工作台 UI（左：工单列表 / 右：会话窗格 + 回复框；含来源与分诊去向区分）
// [POS]: admin 反馈管理展示层；消息与回复由 server 权威管理，回复后自动提醒用户
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useState } from 'react'
import { Bug, Lightbulb, Loader2, MessageSquareText, Send } from 'lucide-react'
import type { FeedbackItem, FeedbackMessage } from '@/lib/api'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useTranslation } from '@/lib/i18n/react'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent } from '@/components/ui-admin/card'
import { cn } from '@/lib/utils'

function TypeBadge({ type }: { type: FeedbackItem['type'] }) {
  if (type === 'bug') {
    return (
      <Badge variant="destructive" className="text-[11px]">
        <Bug className="mr-1 size-3" /> Bug
      </Badge>
    )
  }
  if (type === 'chat') {
    return (
      <Badge variant="secondary" className="text-[11px]">
        <MessageSquareText className="mr-1 size-3" /> Chat
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[11px]">
      <Lightbulb className="mr-1 size-3" /> Feature
    </Badge>
  )
}

/** 来源徽标：产品内来源不打标减少噪音；多源收件箱里标记飞书/Discord/GitHub。 */
function SourceBadge({ source }: { source?: FeedbackItem['source'] }) {
  const { t } = useTranslation()
  if (!source || source === 'product') return null
  return (
    <Badge variant="outline" className="text-[11px]">
      {t(`feedback.source.${source}`)}
    </Badge>
  )
}

const ROUTING_BADGE_VARIANTS: Record<'none' | 'internal' | 'community', 'default' | 'secondary' | 'outline'> = {
  internal: 'default',
  community: 'secondary',
  none: 'outline',
}

/** 分诊去向徽标：internal=受限维护队列 / community=公开仓 / none=仅回复；未设置=待定。 */
function RoutingBadge({ routing }: { routing?: FeedbackItem['routing'] }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant={routing ? ROUTING_BADGE_VARIANTS[routing] : 'outline'}
      className={cn('text-[11px]', !routing && 'border-dashed text-muted-foreground')}
    >
      {t(routing ? `feedback.routing.${routing}` : 'feedback.routing.undecided')}
    </Badge>
  )
}

function AdminConversationPane({
  feedback,
  messages,
  onReply,
  onUpdateStatus,
  onUpdateRouting,
  onPromote,
  onNormalize,
  onDraft,
}: {
  feedback: FeedbackItem
  messages: FeedbackMessage[]
  onReply: (content: string) => Promise<void>
  onUpdateStatus: (status: FeedbackItem['status']) => Promise<void>
  onUpdateRouting: (routing: NonNullable<FeedbackItem['routing']>) => Promise<void>
  onPromote: (scope: 'internal' | 'community') => Promise<void>
  onNormalize: () => Promise<void>
  onDraft: () => Promise<string | null>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const canSend = draft.trim().length > 0 && !sending

  const routingOptions: Array<NonNullable<FeedbackItem['routing']>> = ['internal', 'community', 'none']
  const [promoting, setPromoting] = useState(false)
  const [normalizing, setNormalizing] = useState(false)
  const [drafting, setDrafting] = useState(false)

  const draftReply = async () => {
    if (drafting) return
    setDrafting(true)
    try {
      const draftText = await onDraft()
      if (draftText) setDraft(draftText)
    } finally {
      setDrafting(false)
    }
  }

  const normalize = async () => {
    if (normalizing) return
    setNormalizing(true)
    try {
      await onNormalize()
    } finally {
      setNormalizing(false)
    }
  }

  const promote = async () => {
    const scope = feedback.routing && feedback.routing !== 'none' ? feedback.routing : null
    if (!scope || feedback.githubRef || promoting) return
    setPromoting(true)
    try {
      await onPromote(scope)
    } finally {
      setPromoting(false)
    }
  }

  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      await onReply(draft.trim())
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-[30rem] flex-col border border-zinc-800 bg-zinc-950/40">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={feedback.type} />
            <Badge variant={feedback.status === 'open' ? 'default' : feedback.status === 'triaged' ? 'secondary' : 'outline'} className="text-[11px]">
              {t(`feedback.status.${feedback.status}`)}
            </Badge>
            <SourceBadge source={feedback.source} />
            <RoutingBadge routing={feedback.routing} />
            {feedback.normalized ? (
              <Badge
                variant={feedback.normalized.method === 'llm' ? 'secondary' : 'outline'}
                className="text-[11px]"
                title={feedback.normalized.method === 'llm' ? t('feedback.normalizedBy.llm') : t('feedback.normalizedBy.rule')}
              >
                {feedback.normalized.method === 'llm' ? 'AI' : '\u89c4\u5219'}
              </Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {feedback.userEmail ?? feedback.userId ?? '-'} · {new Date(feedback.createdAt).toLocaleString()}
            </span>
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold">{feedback.title}</h2>
          {feedback.normalized && (feedback.normalized.draft?.background || feedback.normalized.draft?.scenario || feedback.normalized.draft?.expectation) ? (
            <div className="mt-1.5 space-y-0.5 rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-400">
              {feedback.normalized.draft?.background ? (
                <p>
                  <span className="mr-1 text-zinc-600">\u80cc\u666f</span>
                  {feedback.normalized.draft.background}
                </p>
              ) : null}
              {feedback.normalized.draft?.scenario ? (
                <p>
                  <span className="mr-1 text-zinc-600">\u573a\u666f</span>
                  {feedback.normalized.draft.scenario}
                </p>
              ) : null}
              {feedback.normalized.draft?.expectation ? (
                <p>
                  <span className="mr-1 text-zinc-600">\u671f\u671b</span>
                  {feedback.normalized.draft.expectation}
                </p>
              ) : null}
              {feedback.normalized.duplicateOfId ? (
                <p className="text-amber-400/80">{t('feedback.normalizedDuplicate')}：{feedback.normalized.duplicateOfId}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {feedback.status !== 'open' && (
            <Button variant="outline" size="sm" onClick={() => void onUpdateStatus('open')}>
              {t('feedback.status.open')}
            </Button>
          )}
          {feedback.status !== 'triaged' && (
            <Button variant="outline" size="sm" onClick={() => void onUpdateStatus('triaged')}>
              {t('feedback.status.triaged')}
            </Button>
          )}
          {feedback.status !== 'closed' && (
            <Button variant="secondary" size="sm" onClick={() => void onUpdateStatus('closed')}>
              {t('feedback.status.closed')}
            </Button>
          )}
          <div className="flex shrink-0 items-center gap-1.5 border-l border-zinc-800 pl-1.5">
            {routingOptions.map((routing) => (
              <Button
                key={routing}
                variant={feedback.routing === routing ? 'default' : 'outline'}
                size="sm"
                title={t('feedback.routingHint')}
                onClick={() => void onUpdateRouting(routing)}
              >
                {t(`feedback.routing.${routing}`)}
              </Button>
            ))}
            {feedback.routing && feedback.routing !== 'none' && !feedback.githubRef ? (
              <Button variant="outline" size="sm" disabled={promoting} title={t('feedback.promoteHint')} onClick={() => void promote()}>
                {promoting && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                {t('feedback.promote')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={normalizing} title={t('feedback.normalizeHint')} onClick={() => void normalize()}>
              {normalizing && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {t('feedback.normalize')}
            </Button>
            {feedback.githubRef ? (
              <a
                href={feedback.githubRef.url}
                target="_blank"
                rel="noreferrer"
                title={t(`feedback.routing.${feedback.githubRef.scope}`)}
                className="text-[11px] text-sky-400 underline decoration-dotted underline-offset-2"
              >
                #{feedback.githubRef.number}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{t('feedback.conversationEmpty')}</p>
        ) : (
          messages.map((message) => {
            // 管理端视角：左侧是用户（客户）反馈，右侧是创始人（自己）的回复
            const isUser = message.role === 'user'
            return (
              <div key={message.id} className={cn('flex', isUser ? 'justify-start' : 'justify-end')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg border px-3 py-2 text-[13px]',
                    isUser
                      ? 'border-zinc-800 bg-zinc-950 text-zinc-200'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-100',
                  )}
                >
                  {isUser && (
                    <p className="mb-1 text-[11px] font-medium text-sky-400/90">
                      {message.senderName || '用户'}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  <p className="mt-1 text-right text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</p>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800 p-3">
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
            placeholder={t('feedback.replyPlaceholder')}
            rows={2}
            maxLength={8000}
            className="min-h-0 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button variant="outline" size="sm" disabled={drafting} title={t('feedback.draftReplyHint')} onClick={() => void draftReply()}>
              {drafting && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {t('feedback.draftReply')}
            </Button>
            <Button onClick={() => void send()} disabled={!canSend} size="sm" className="shrink-0">
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AdminFeedbackPage() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [filter, setFilter] = useState<FeedbackItem['status'] | 'all'>('all')
  const [routingFilter, setRoutingFilter] = useState<FeedbackItem['routing'] | 'undecided' | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ feedback: FeedbackItem; messages: FeedbackMessage[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const load = async () => {
      try {
        const response = await api.getAdminFeedback({ status: filter === 'all' ? undefined : filter })
        if (!cancelled) {
          setItems(response.feedback)
          setLoadError('')
        }
      } catch (error) {
        console.error('Failed to load feedback:', error)
        // 403/网络失败不能伪装成“没有反馈”——显式提示，避免误判为数据丢失
        if (!cancelled) {
          setItems([])
          setLoadError(error instanceof Error ? error.message : t('feedback.adminLoadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user, filter])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    const load = async () => {
      try {
        const response = await api.adminGetFeedbackDetail(selectedId)
        if (!cancelled) setDetail(response)
      } catch (error) {
        console.error('Failed to load feedback conversation:', error)
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const refreshDetail = async () => {
    if (!selectedId) return
    const response = await api.adminGetFeedbackDetail(selectedId)
    setDetail(response)
    setItems((prev) => prev.map((item) => (item.id === selectedId ? response.feedback : item)))
  }

  const updateStatus = async (id: string, status: FeedbackItem['status']) => {
    try {
      const response = await api.updateAdminFeedback(id, { status })
      setItems((prev) => prev.map((item) => (item.id === id ? response.feedback : item)))
      setDetail((prev) => (prev ? { ...prev, feedback: response.feedback } : prev))
    } catch (error) {
      console.error('Failed to update feedback:', error)
    }
  }

  const updateRouting = async (id: string, routing: NonNullable<FeedbackItem['routing']>) => {
    try {
      const response = await api.updateAdminFeedback(id, { routing })
      setItems((prev) => prev.map((item) => (item.id === id ? response.feedback : item)))
      setDetail((prev) => (prev ? { ...prev, feedback: response.feedback } : prev))
    } catch (error) {
      console.error('Failed to update feedback routing:', error)
    }
  }

  const reply = async (id: string, content: string) => {
    try {
      await api.adminReplyFeedback(id, { content })
      await refreshDetail()
    } catch (error) {
      // 发送前审查高风险拦截（409）：展示原因，二次确认后带 reviewed 重发
      const status = (error as Error & { status?: number }).status
      if (status === 409) {
        const confirmed = window.confirm(`${t('feedback.reviewHighRisk')}\n\n${error instanceof Error ? error.message : ''}\n\n${t('feedback.reviewForceSend')}`)
        if (confirmed) {
          await api.adminReplyFeedback(id, { content, reviewed: true })
          await refreshDetail()
          return
        }
      }
      console.error('Failed to reply feedback:', error)
      throw error
    }
  }

  const promote = async (id: string, scope: 'internal' | 'community') => {
    try {
      const response = await api.promoteAdminFeedback(id, { scope })
      setItems((prev) => prev.map((item) => (item.id === id ? response.feedback : item)))
      setDetail((prev) => (prev ? { ...prev, feedback: response.feedback } : prev))
    } catch (error) {
      console.error('Failed to promote feedback:', error)
      window.alert(error instanceof Error ? error.message : t('feedback.promoteFailed'))
    }
  }

  const normalize = async (id: string) => {
    try {
      const response = await api.normalizeAdminFeedback(id)
      setItems((prev) => prev.map((item) => (item.id === id ? response.feedback : item)))
      setDetail((prev) => (prev ? { ...prev, feedback: response.feedback } : prev))
    } catch (error) {
      console.error('Failed to normalize feedback:', error)
    }
  }

  const draftReply = async (id: string): Promise<string | null> => {
    try {
      const response = await api.draftAdminReply(id)
      if (!response.draft) {
        window.alert(t('feedback.draftReplyNoModel'))
        return null
      }
      return response.draft
    } catch (error) {
      console.error('Failed to draft reply:', error)
      window.alert(t('feedback.draftReplyFailed'))
      return null
    }
  }

  const statusFilters: Array<FeedbackItem['status'] | 'all'> = ['all', 'open', 'triaged', 'closed']
  const routingFilters: Array<FeedbackItem['routing'] | 'undecided' | 'all'> = ['all', 'undecided', 'internal', 'community', 'none']
  const visibleItems = routingFilter === 'all'
    ? items
    : items.filter((item) => item.routing === routingFilter)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('feedback.title')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('feedback.founderAdminSubtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusFilters.map((status) => (
          <Button
            key={status}
            variant={filter === status ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(status)}
          >
            {status === 'all' ? t('feedback.all') : t(`feedback.status.${status}`)}
            {status !== 'all' && (
              <span className="ml-1 text-xs opacity-70">
                {items.filter((item) => item.status === status).length}
              </span>
            )}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('feedback.routingLabel')}：</span>
        {routingFilters.map((routing) => (
          <Button
            key={routing}
            variant={routingFilter === routing ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRoutingFilter(routing)}
          >
            {routing === 'all' ? t('feedback.all') : routing === 'undecided' ? t('feedback.routing.undecided') : t(`feedback.routing.${routing}`)}
            {routing !== 'all' && (
              <span className="ml-1 text-xs opacity-70">
                {items.filter((item) => (routing === 'undecided' ? !item.routing : item.routing === routing)).length}
              </span>
            )}
          </Button>
        ))}
      </div>

      {loadError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          <span>{loadError}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('analytics.loading')}</p>
          ) : visibleItems.length === 0 ? (
            loadError ? null : (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <MessageSquareText className="size-8 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">{t('feedback.empty')}</p>
                </CardContent>
              </Card>
            )
          ) : (
            visibleItems.map((item) => (
              <Card
                key={item.id}
                className={cn('cursor-pointer transition-colors', selectedId === item.id && 'border-zinc-500')}
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="flex flex-row items-start justify-between gap-3 border-b px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <TypeBadge type={item.type} />
                        <Badge variant={item.status === 'open' ? 'default' : item.status === 'triaged' ? 'secondary' : 'outline'} className="text-[11px]">
                          {t(`feedback.status.${item.status}`)}
                        </Badge>
                        <SourceBadge source={item.source} />
                        <RoutingBadge routing={item.routing} />
                        <span className="text-xs text-muted-foreground">
                          {item.userEmail ?? item.userId ?? '-'} · {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold">{item.title}</p>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <p className="line-clamp-2 whitespace-pre-wrap text-[13px] text-muted-foreground">{item.body}</p>
                    {item.lastReplyAt ? (
                      <p className="mt-1.5 truncate border-t border-zinc-800 pt-1.5 text-[11px] text-amber-400/80">
                        {t('feedback.founderReply')}：{item.lastReplyPreview}
                      </p>
                    ) : null}
                  </div>
                </button>
              </Card>
            ))
          )}
        </div>

        <div className="min-h-[30rem]">
          {detailLoading ? (
            <div className="flex h-[30rem] items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : detail ? (
            <AdminConversationPane
              feedback={detail.feedback}
              messages={detail.messages}
              onReply={(content) => reply(detail.feedback.id, content)}
              onUpdateStatus={(status) => updateStatus(detail.feedback.id, status)}
              onUpdateRouting={(routing) => updateRouting(detail.feedback.id, routing)}
              onPromote={(scope) => promote(detail.feedback.id, scope)}
              onNormalize={() => normalize(detail.feedback.id)}
              onDraft={() => draftReply(detail.feedback.id)}
            />
          ) : (
            <div className="flex h-[30rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 text-center">
              <MessageSquareText className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t('feedback.selectAdminHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

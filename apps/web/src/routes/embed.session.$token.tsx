import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LoaderCircle, XCircle } from 'lucide-react'
import { api, type PublicSessionPayload } from '../lib/api'
import { buildNoIndexHead } from '../lib/marketing-site'

export const Route = createFileRoute('/embed/session/$token' as never)({
  head: () => buildNoIndexHead({
    title: 'Wemux Shared Session',
    description: 'A live, embeddable view of a shared Wemux session. Not meant to appear in search results.',
  }),
  component: EmbedSessionRoute,
})

type NormalizedMessage = {
  id: string
  authorLabel: string
  content: string
  createdAt: string
  isUser: boolean
}

const normalizeMessages = (payload: PublicSessionPayload): NormalizedMessage[] => {
  if (payload.sourceKind === 'main_chat') {
    return (payload.messages ?? []).map((message) => ({
      id: message.id,
      authorLabel: message.authorName || (message.role === 'user' ? '用户' : 'Agent'),
      content: message.content,
      createdAt: message.createdAt,
      isUser: message.role === 'user',
    }))
  }

  return payload.messages.map((message) => ({
    id: message.id,
    authorLabel: message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Agent' : '系统',
    content: message.content,
    createdAt: message.createdAt,
    isUser: message.role === 'user',
  }))
}

function EmbedSessionRoute() {
  const { token } = Route.useParams() as { token: string }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<PublicSessionPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void api.getPublicSession(token)
      .then((response) => {
        if (!cancelled) {
          setPayload(response)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '无法加载该会话')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    const interval = setInterval(() => {
      void api.getPublicSession(token)
        .then((response) => {
          if (!cancelled) {
            setPayload(response)
          }
        })
        .catch(() => {})
    }, 15000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [token])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        加载中…
      </div>
    )
  }

  if (error || !payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-rose-400">
        <XCircle className="mr-2 size-4" />
        {error || '该分享链接不可用'}
      </div>
    )
  }

  const title = payload.sourceKind === 'main_chat' ? payload.session.title : payload.conversation.title
  const messages = normalizeMessages(payload)

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <div className="shrink-0 border-b border-zinc-900 px-4 py-2.5">
        <p className="truncate text-sm font-medium text-zinc-200">{title || '共享会话'}</p>
        <p className="text-[11px] text-zinc-600">实时同步，非静态快照</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-600">暂无消息</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={message.isUser ? 'text-right' : 'text-left'}>
              <p className="text-[10px] text-zinc-600">{message.authorLabel}</p>
              <p
                className={
                  message.isUser
                    ? 'ml-auto inline-block max-w-[85%] rounded-lg bg-sky-600/20 px-3 py-1.5 text-sm text-zinc-100'
                    : 'inline-block max-w-[85%] rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200'
                }
              >
                {message.content}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

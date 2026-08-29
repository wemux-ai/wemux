// [INPUT]: 分享 token
// [OUTPUT]: 分享会话只读快照页（匿名或成员访问）
// [POS]: 会话分享访问页；服务端校验 token + 过期 + 范围（members 需登录成员）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2, Lock, MessageSquare } from 'lucide-react'
import type { ConversationShareRecord } from '@shared/types'
import { authFetch } from '../lib/api/client'

export const Route = createFileRoute('/shared/$token')({
  component: SharedConversationRoute,
})

function SharedConversationRoute() {
  const { token } = Route.useParams()
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: true })
  const [data, setData] = useState<{ share: ConversationShareRecord; conversation?: { conversation?: { title?: string }; messages?: Array<{ role?: string; content?: string; authorName?: string }> } } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await authFetch(`/api/shared/${token}`)
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          if (!cancelled) setState({ loading: false, error: body?.message ?? '无法访问该分享。' })
          return
        }
        const payload = await response.json()
        if (!cancelled) {
          setData(payload)
          setState({ loading: false })
        }
      } catch {
        if (!cancelled) setState({ loading: false, error: '无法访问该分享。' })
      }
    })()
    return () => { cancelled = true }
  }, [token])

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-500">
        <Loader2 className="mr-2 size-4 animate-spin" />加载分享…
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-400">
        <Lock className="size-8 opacity-50" />
        <p className="text-sm">{state.error}</p>
      </div>
    )
  }

  const title = data?.conversation?.conversation?.title ?? '分享的会话'
  const messages = data?.conversation?.messages ?? []

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2 border-b border-zinc-800 pb-3">
          <MessageSquare className="size-4 text-zinc-500" />
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <span className="ml-auto shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">只读分享</span>
        </div>
        <div className="space-y-3">
          {messages.length === 0 && <p className="py-10 text-center text-xs text-zinc-600">该会话暂无消息。</p>}
          {messages.map((message, index) => (
            <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
              <div className="mb-1 text-[10px] text-zinc-500">
                {message.authorName || (message.role === 'assistant' ? 'Agent' : message.role === 'user' ? '用户' : '系统')}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

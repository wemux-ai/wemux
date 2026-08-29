// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: 当前语言；POST `/docs/api/ask`（dev 由 Vite 中间件提供 SSE，生产静态站不可用——与旧站一致）
// OUTPUT: 右下角浮动 AI 助手：RAG 回答 + 来源链接，流式渲染
// POS: 文档站 AI 问答 UI（从 apps/docs port）。SSE 首事件为 sources，其余为 OpenAI 兼容 delta。

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import type { DocsLocale } from '@shared/docs-content'
import { cn } from '../utils'

const askUrl = '/docs/api/ask'

interface Source {
  title: string
  url: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  error?: boolean
}

const parseSseEvent = (
  raw: string,
): { type: 'sources'; sources: Source[] } | { type: 'delta'; content: string } | { type: 'done' } | null => {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('data:')) {
    return null
  }
  const data = trimmed.slice(5).trim()
  if (data === '[DONE]') {
    return { type: 'done' }
  }
  try {
    const json = JSON.parse(data) as Record<string, unknown>
    if (json.type === 'sources') {
      return { type: 'sources', sources: json.sources as Source[] }
    }
    const content = (json.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content
    if (typeof content === 'string' && content.length > 0) {
      return { type: 'delta', content }
    }
    return null
  } catch {
    return null
  }
}

const markdownComponents = {
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-violet-500 underline underline-offset-2 hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300"
    />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong {...props} className="font-semibold text-foreground" />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props} className="mt-1.5 first:mt-0" />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul {...props} className="mt-1.5 list-disc space-y-1 pl-5 first:mt-0" />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol {...props} className="mt-1.5 list-decimal space-y-1 pl-5 first:mt-0" />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => <li {...props} className="leading-relaxed" />,
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code {...props} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-violet-600 dark:text-violet-400" />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre {...props} className="mt-1.5 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-xs leading-relaxed first:mt-0" />
  ),
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 {...props} className="mt-3 text-base font-semibold text-foreground first:mt-0" />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props} className="mt-3 text-sm font-semibold text-foreground first:mt-0" />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 {...props} className="mt-2 text-sm font-medium text-foreground first:mt-0" />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote {...props} className="mt-1.5 border-l-2 border-border pl-3 text-muted-foreground first:mt-0" />
  ),
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="mt-1.5 overflow-x-auto first:mt-0">
      <table {...props} className="w-full border-collapse text-xs" />
    </div>
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th {...props} className="border border-border bg-muted px-2 py-1 text-left font-medium" />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props} className="border border-border px-2 py-1" />
  ),
}

/** 把回答中的 [n] 引用替换为指向来源页面的链接。 */
const linkCitations = (content: string, sources?: Source[]): string => {
  if (!sources || sources.length === 0) {
    return content
  }
  return content.replace(/\[(\d+)\]/g, (match, index: string) => {
    const source = sources[Number(index) - 1]
    return source ? `[${index}](${source.url})` : match
  })
}

export function DocsAiChat({ locale }: { locale: DocsLocale }) {
  const isZh = locale === 'zh'
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, loading, open])

  const submit = async (): Promise<void> => {
    const question = input.trim()
    if (!question || loading) {
      return
    }
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }])
    setLoading(true)

    try {
      const response = await fetch(askUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, locale: isZh ? 'zh' : 'en' }),
      })

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const applyDelta = (content: string): void => {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + content }
          }
          return next
        })
      }
      const applySources = (sources: Source[]): void => {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last.role === 'assistant' && last.sources === undefined) {
            next[next.length - 1] = { ...last, sources }
          }
          return next
        })
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const event = parseSseEvent(line)
          if (event === null) {
            continue
          }
          if (event.type === 'sources') {
            applySources(event.sources)
          } else if (event.type === 'delta') {
            applyDelta(event.content)
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: message || (isZh ? '请求失败，请稍后重试' : 'Request failed, please try again.'),
          error: true,
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-colors hover:bg-violet-500"
        aria-label="Ask AI"
      >
        {open ? <X className="size-4" /> : <Sparkles className="size-4" />}
        {isZh ? 'AI 助手' : 'Ask AI'}
      </button>

      {open ? (
        <div className="fixed bottom-20 right-5 z-50 flex h-[min(560px,70vh)] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Bot className="size-4 text-violet-500" />
            <span className="text-sm font-semibold text-foreground">{isZh ? '文档 AI 助手' : 'Docs AI Assistant'}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/60">
              {isZh ? '基于官方文档回答' : 'answers from official docs'}
            </span>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Sparkles className="size-6 text-violet-500" />
                <p className="max-w-[240px] text-xs leading-relaxed text-muted-foreground">
                  {isZh
                    ? '问任何关于 Wemux 的问题，例如「如何创建任务？」「Worker 怎么连接？」'
                    : 'Ask anything about Wemux, e.g. "How do I create a task?" or "How to connect a worker?"'}
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={`${index}-${message.role}`}
                  className={cn('flex flex-col', message.role === 'user' ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                      message.role === 'user'
                        ? 'bg-violet-600 text-white'
                        : message.error
                          ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                          : 'border border-border bg-muted/60 text-foreground',
                    )}
                  >
                    {message.role === 'user' || message.error ? (
                      <span className="whitespace-pre-wrap">{message.content}</span>
                    ) : message.content ? (
                      <ReactMarkdown components={markdownComponents}>
                        {linkCitations(message.content, message.sources)}
                      </ReactMarkdown>
                    ) : loading && index === messages.length - 1 ? (
                      <span>…</span>
                    ) : null}
                  </div>
                  {message.sources && message.sources.length > 0 ? (
                    <div className="mt-1.5 flex max-w-[85%] flex-wrap gap-1.5">
                      {message.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-violet-500/40 hover:text-violet-500"
                        >
                          <MessageCircle className="size-2.5 shrink-0" />
                          <span className="truncate">{source.title}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {isZh ? '正在回答…' : 'Thinking…'}
              </div>
            ) : null}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={isZh ? '输入你的问题…' : 'Ask a question…'}
              className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-violet-500/50"
            />
            <button
              type="submit"
              disabled={loading || input.trim() === ''}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      ) : null}
    </>
  )
}

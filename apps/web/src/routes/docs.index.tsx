// [INPUT]: GET /docs
// [OUTPUT]: 308 客户端跳转到默认语言文档首页（/docs/en/docs）
// [POS]: 文档站根路径兼容层，保持旧站 URL 不变。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/docs/')({
  head: () => ({
    meta: [
      { title: 'Wemux Docs' },
      { name: 'description', content: 'Wemux documentation: AI coding delivery platform docs.' },
      { name: 'robots', content: 'index, follow' },
    ],
  }),
  component: DocsIndexRedirect,
})

function DocsIndexRedirect() {
  useEffect(() => {
    window.location.replace('/docs/en/docs')
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-muted-foreground">Redirecting…</p>
      <a href="/docs/en/docs" className="text-sm font-medium text-violet-500 underline">
        Continue to English docs
      </a>
    </main>
  )
}

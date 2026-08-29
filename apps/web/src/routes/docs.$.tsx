// [INPUT]: GET /docs/{slug...}（无语言前缀的旧链接，如 /docs/getting-started/installation）
// [OUTPUT]: 跳转到 /docs/en/docs/{slug...}
// [POS]: 文档站旧链接兼容层，保持旧站 URL 不变。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { buildDocsLegacyRedirectUrl } from '@shared/docs-content'

export const Route = createFileRoute('/docs/$')({
  head: () => ({
    meta: [
      { title: 'Wemux Docs' },
      { name: 'robots', content: 'index, follow' },
    ],
  }),
  component: DocsLegacyRedirect,
})

function DocsLegacyRedirect() {
  const { _splat } = Route.useParams()
  const slugs = (_splat ?? '').split('/').filter(Boolean)
  const target = buildDocsLegacyRedirectUrl(slugs)

  useEffect(() => {
    window.location.replace(target)
  }, [target])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-muted-foreground">Redirecting…</p>
      <a href={target} className="text-sm font-medium text-violet-500 underline">
        Continue to docs
      </a>
    </main>
  )
}

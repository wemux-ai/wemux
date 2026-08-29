// [INPUT]: `/feedback` URL
// [OUTPUT]: 用户反馈页（提交 bug / 功能建议 + 查看我的反馈 + 与创始人直接沟通）
// [POS]: Route boundary for the user-facing feedback page
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { createFileRoute } from '@tanstack/react-router'
import { FeedbackPage } from '../components/feedback/feedback-page'

export const Route = createFileRoute('/feedback' as never)({
  validateSearch: (search: Record<string, unknown>) => ({
    open: typeof search.open === 'string' && search.open.trim() ? search.open.trim() : undefined,
  }),
  component: FeedbackRoute,
})

function FeedbackRoute() {
  const search = Route.useSearch() as { open?: string }
  return <FeedbackPage initialOpenId={search.open} />
}

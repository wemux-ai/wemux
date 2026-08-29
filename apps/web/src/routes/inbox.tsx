/**
 * [INPUT]: `/inbox` URL search for human Inbox section and selected group.
 * [OUTPUT]: The operational global Inbox frontend.
 * [POS]: Route boundary for the human/global Inbox; Agent-specific inbox is separate.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createFileRoute } from '@tanstack/react-router'
import { InboxPage } from '../components/inbox/inbox-page'
import { parseInboxPageSection } from '../components/inbox/inbox-model'

export const Route = createFileRoute('/inbox' as never)({
  validateSearch: (search: Record<string, unknown>) => ({
    section: parseInboxPageSection(search.section),
    groupKey: typeof search.groupKey === 'string' && search.groupKey.trim() ? search.groupKey.trim() : undefined,
  }),
  component: InboxRoute,
})

function InboxRoute() {
  const search = Route.useSearch() as { section: ReturnType<typeof parseInboxPageSection>; groupKey?: string }
  return <InboxPage section={search.section} groupKey={search.groupKey} />
}

/**
 * [INPUT]: Shared frontend Inbox provider and application navigation.
 * [OUTPUT]: Global header bell with actionable-group badge and Inbox shortcut.
 * [POS]: Compact global Inbox entry; realtime and list state live in InboxProvider.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useInbox } from '../lib/inbox-provider'
import { Button } from './ui/button'

export function MentionNotificationCenter() {
  const navigate = useNavigate()
  const { badgeCount } = useInbox()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => void navigate({ to: '/inbox' as never, search: { section: 'all' } as never })}
      className="relative h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
      aria-label={badgeCount > 0 ? `Inbox, ${badgeCount} actionable groups` : 'Inbox'}
      title="Inbox"
    >
      <Bell className="h-4 w-4" />
      {badgeCount > 0 ? (
        <span className="absolute right-0 top-0 flex min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold leading-3.5 text-white ring-2 ring-[#09090b]">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      ) : null}
    </Button>
  )
}

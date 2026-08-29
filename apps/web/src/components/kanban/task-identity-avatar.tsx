/**
 * [INPUT]: Persisted task actor identity and an optional resolved avatar URL.
 * [OUTPUT]: Stable task avatar that shows a neutral loading state before the real image and initials only on absence or failure.
 * [POS]: Shared task-detail avatar presentation for Timeline and Agent execution observability.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useState } from 'react'

import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { resolveMediaUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

type AvatarImageStatus = 'idle' | 'loading' | 'loaded' | 'error'

export function TaskIdentityAvatar({
  type,
  id,
  name,
  avatarUrl,
  className,
  fallbackClassName,
}: {
  type: 'user' | 'agent' | 'system'
  id?: string
  name: string
  avatarUrl?: string
  className?: string
  fallbackClassName?: string
}) {
  const resolvedAvatarUrl = resolveMediaUrl(avatarUrl)
  const [imageState, setImageState] = useState<{
    src: string
    status: AvatarImageStatus
  }>({
    src: resolvedAvatarUrl,
    status: resolvedAvatarUrl ? 'loading' : 'idle',
  })
  const imageStatus = imageState.src === resolvedAvatarUrl
    ? imageState.status
    : resolvedAvatarUrl
      ? 'loading'
      : 'idle'
  const showFallback = !resolvedAvatarUrl || imageStatus === 'error'
  const initial = name.trim().slice(0, 2).toUpperCase() || (type === 'agent' ? 'AI' : 'U')

  return (
    <Avatar className={cn('border border-zinc-800', className)}>
      {resolvedAvatarUrl ? (
        <AvatarImage
          src={resolvedAvatarUrl}
          className="object-cover"
          onLoadingStatusChange={(status) => setImageState({ src: resolvedAvatarUrl, status })}
        />
      ) : null}
      {resolvedAvatarUrl && imageStatus !== 'loaded' && imageStatus !== 'error' ? (
        <span aria-hidden className="absolute inset-0 bg-zinc-900" />
      ) : null}
      {showFallback ? (
        <AvatarFallback className={cn(
          type === 'agent'
            ? `bg-gradient-to-br text-zinc-950 ${getAgentAvatarAccent(id || name)}`
            : 'bg-zinc-800 text-zinc-200',
          fallbackClassName,
        )}>
          {initial}
        </AvatarFallback>
      ) : null}
    </Avatar>
  )
}

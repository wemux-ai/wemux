import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

export type LandingAgentAvatarId = 'developer' | 'tester' | 'reviewer' | 'lead'

export const LANDING_AGENT_AVATARS: Record<LandingAgentAvatarId, string> = {
  developer: '/agents/avatars/agent-01.png',
  tester: '/agents/avatars/agent-05.png',
  reviewer: '/agents/avatars/agent-08.png',
  lead: '/agents/avatars/agent-20.png',
}

export function LandingAgentAvatar({
  avatar = 'developer',
  className,
  fallback = 'AG',
}: {
  avatar?: LandingAgentAvatarId
  className?: string
  fallback?: string
}) {
  return (
    <Avatar className={className}>
      <AvatarImage alt="" src={LANDING_AGENT_AVATARS[avatar]} />
      <AvatarFallback className="bg-cyan-300 text-[10px] font-black text-zinc-950">
        {fallback}
      </AvatarFallback>
    </Avatar>
  )
}

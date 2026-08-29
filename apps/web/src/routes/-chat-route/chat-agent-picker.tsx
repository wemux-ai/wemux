import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { resolveMediaUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { getAgentInitials, text } from './chat-route-helpers'
import type { ChatRouteController } from './use-chat-route-controller'
import type { Language } from '../../lib/i18n'

type ChatAgentPickerProps = {
  controller: ChatRouteController
  language: Language
}

export function ChatAgentPicker({ controller, language }: ChatAgentPickerProps) {
  return (
    <div className="border-b border-zinc-800/50 px-3 py-3 md:px-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{text(language, 'Agent 对话', 'Agent Chat')}</p>
        </div>
        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-500">
          {text(language, `${controller.chatAgents.length} 个`, `${controller.chatAgents.length}`)}
        </span>
      </div>

      <div className="scrollbar-subtle mt-3 overflow-x-auto">
        <div className="flex min-w-max gap-2 pb-1">
          {controller.chatAgents.map((agent) => {
            const isSelected = agent.id === controller.selectedChatAgent?.id

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => void controller.handleSelectChatAgent(agent.id)}
                disabled={controller.busy || controller.isStreaming}
                className={cn(
                  'group flex w-[4.9rem] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-2 text-center transition-all',
                  isSelected
                    ? 'border-zinc-600 bg-zinc-900 text-zinc-100 shadow-lg shadow-black/20'
                    : 'border-zinc-800/50 bg-zinc-950/40 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900/70 hover:text-zinc-200',
                  (controller.busy || controller.isStreaming) && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="relative">
                  <Avatar className={cn(
                    'size-10 rounded-full ring-2 transition',
                    isSelected ? 'ring-zinc-200/70' : 'ring-zinc-800 group-hover:ring-zinc-600',
                    agent.kind === 'unavailable' && 'grayscale',
                  )}>
                    <AvatarImage src={resolveMediaUrl(agent.avatarUrl)} />
                    <AvatarFallback className={cn(
                      'rounded-full bg-gradient-to-br text-[11px] font-black text-zinc-950',
                      agent.avatarClassName,
                    )}>
                      {getAgentInitials(agent.name)}
                    </AvatarFallback>
                  </Avatar>
                </span>
                <span className="line-clamp-1 max-w-full text-[11px] font-medium">{agent.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

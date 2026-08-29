import { Loader2, Send } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { resolveMediaUrl } from '../../lib/api'
import type { Language } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import type { ChatRouteShareActions } from './use-chat-route-share-actions'
import { getAgentInitials, text } from './chat-route-helpers'

type SessionForwardDialogProps = {
  language: Language
  shareActions: ChatRouteShareActions
}

export function SessionForwardDialog({ language, shareActions }: SessionForwardDialogProps) {
  const {
    forwardDialogOpen,
    setForwardDialogOpen,
    forwardSourceSessionIds,
    forwardOptions,
    forwardOptionsLoading,
    forwardTargetUserIds,
    forwardTargetAgentIds,
    forwardBusy,
    toggleForwardTargetUser,
    toggleForwardTargetAgent,
    submitForward,
  } = shareActions

  const selectedTargetCount = forwardTargetUserIds.length + forwardTargetAgentIds.length

  return (
    <Dialog open={forwardDialogOpen} onOpenChange={setForwardDialogOpen}>
      <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle>
            {text(language, '转发会话', 'Forward Session')}
            {forwardSourceSessionIds.length > 1 ? (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                {text(language, `${forwardSourceSessionIds.length} 个会话`, `${forwardSourceSessionIds.length} sessions`)}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {forwardOptionsLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            {text(language, '加载中…', 'Loading…')}
          </div>
        ) : (
          <DialogBody className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '组织成员', 'Members')}</p>
                  <span className="text-[11px] text-zinc-600">{forwardTargetUserIds.length} {text(language, '已选', 'selected')}</span>
                </div>
                <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                  {forwardOptions.members.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-zinc-600">{text(language, '暂无成员', 'No members')}</p>
                  ) : forwardOptions.members.map((member) => {
                    const checked = forwardTargetUserIds.includes(member.id)
                    return (
                      <label
                        key={member.id}
                        className={cn(
                          'flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                          checked ? 'border-emerald-500/40 bg-emerald-500/10 text-zinc-100' : 'border-zinc-800 bg-zinc-950/70 text-zinc-300',
                        )}
                      >
                        <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                          <AvatarImage src={resolveMediaUrl(member.avatarUrl)} />
                          <AvatarFallback className="bg-zinc-900 text-[11px] font-semibold text-zinc-100">
                            {getAgentInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{member.name}</span>
                          <span className="block truncate text-xs text-zinc-500">{member.email}</span>
                        </span>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextValue) => toggleForwardTargetUser(member.id, Boolean(nextValue))}
                        />
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '协作 Agent', 'Agents')}</p>
                  <span className="text-[11px] text-zinc-600">{forwardTargetAgentIds.length} {text(language, '已选', 'selected')}</span>
                </div>
                <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                  {forwardOptions.agents.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-zinc-600">{text(language, '暂无可用 Agent', 'No agents available')}</p>
                  ) : forwardOptions.agents.map((agent) => {
                    const checked = forwardTargetAgentIds.includes(agent.id)
                    return (
                      <label
                        key={agent.id}
                        className={cn(
                          'flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                          checked ? 'border-sky-500/40 bg-sky-500/10 text-zinc-100' : 'border-zinc-800 bg-zinc-950/70 text-zinc-300',
                        )}
                      >
                        <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 via-sky-300 to-indigo-400 text-[11px] font-black text-zinc-950">
                          {getAgentInitials(agent.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{agent.name}</span>
                          <span className="block truncate text-xs text-zinc-500">{agent.role}</span>
                        </span>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextValue) => toggleForwardTargetAgent(agent.id, Boolean(nextValue))}
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>

            <DialogFooter className="px-0">
              <Button type="button" variant="ghost" onClick={() => setForwardDialogOpen(false)}>
                {text(language, '取消', 'Cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void submitForward()}
                disabled={forwardBusy || selectedTargetCount === 0}
              >
                {forwardBusy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {text(language, '转发', 'Forward')}
              </Button>
            </DialogFooter>
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  )
}

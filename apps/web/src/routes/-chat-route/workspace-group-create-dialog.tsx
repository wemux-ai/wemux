/**
 * [INPUT]: Group creation draft, workspace member/Agent catalogs, submit callback, and controlled open state.
 * [OUTPUT]: The "create workspace group" dialog (title, description, members, agents); trigger lives in the sidebar "new chat" dropdown.
 * [POS]: Group-chat creation form; task assignment and Squad concepts do not belong here.
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { cn } from '../../lib/utils'
import { resolveMediaUrl, type CollaborationWorkspace, type WorkspaceGroupWithMembers } from '../../lib/api'
import type { Language } from '../../lib/i18n'
import { getAgentInitials, text } from './chat-route-helpers'
import type { CreateGroupDraft, GroupOptions } from './workspace-group-chat-panel'

type WorkspaceGroupCreateDialogProps = {
  draft: CreateGroupDraft
  language: Language
  onDraftChange: (draft: CreateGroupDraft) => void
  onSubmit: () => Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
  options: GroupOptions
  workspace?: CollaborationWorkspace | null
  /** 空间内分组（P2）：成员选择器按组筛选。 */
  workspaceGroups?: WorkspaceGroupWithMembers[]
  busy: boolean
}

export function WorkspaceGroupCreateDialog(props: WorkspaceGroupCreateDialogProps) {
  const { draft, language, onDraftChange, onSubmit, open, onOpenChange, options, workspace, workspaceGroups = [], busy } = props
  const [filterGroupId, setFilterGroupId] = useState('')
  const filteredMemberIds = useMemo(() => {
    if (!filterGroupId) {
      return null
    }
    const group = workspaceGroups.find((item) => item.id === filterGroupId)
    if (!group) {
      return null
    }
    return new Set(group.members.filter((member) => member.memberType === 'user').map((member) => member.memberId))
  }, [filterGroupId, workspaceGroups])
  const toggleMember = (memberId: string, checked: boolean) => {
    onDraftChange({
      ...draft,
      userMemberIds: checked
        ? [...draft.userMemberIds, memberId]
        : draft.userMemberIds.filter((item) => item !== memberId),
    })
  }
  const toggleAgentMember = (agentId: string, checked: boolean) => {
    onDraftChange({
      ...draft,
      agentMemberIds: checked
        ? [...draft.agentMemberIds, agentId]
        : draft.agentMemberIds.filter((item) => item !== agentId),
    })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle>{text(language, '创建组织群聊', 'Create Workspace Group')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '群名称', 'Title')}</p>
            <Input
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              placeholder={text(language, '例如：版本发布群', 'For example: Release Group')}
              className="h-9 rounded-md border-zinc-800 bg-zinc-900"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '群简介', 'Description')}</p>
            <Textarea
              value={draft.description}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
              placeholder={text(language, '介绍一下这个群聊的用途（可选）…', 'Describe the purpose of this group (optional)...')}
              maxLength={500}
              rows={2}
              className="min-h-[56px] rounded-md border-zinc-800 bg-zinc-900 text-sm"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '成员', 'Members')}</p>
                <span className="text-[11px] text-zinc-600">{draft.userMemberIds.length} {text(language, '已选', 'selected')}</span>
              </div>
              {workspaceGroups.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setFilterGroupId('')}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                      !filterGroupId
                        ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
                    )}
                  >
                    {text(language, '全部', 'All')}
                  </button>
                  {workspaceGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setFilterGroupId(filterGroupId === group.id ? '' : group.id)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                        filterGroupId === group.id
                          ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
                      )}
                    >
                      {group.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                {options.members.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-zinc-600">{text(language, '暂无成员', 'No members')}</p>
                ) : options.members.filter((member) => (
                  !filteredMemberIds || filteredMemberIds.has(member.id)
                )).map((member) => {
                  const checked = draft.userMemberIds.includes(member.id)
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
                        <span className="block truncate text-xs text-zinc-500">{member.role}</span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextValue) => toggleMember(member.id, Boolean(nextValue))}
                      />
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '协作 Agent', 'Agent Members')}</p>
                <span className="text-[11px] text-zinc-600">{draft.agentMemberIds.length} {text(language, '已选', 'selected')}</span>
              </div>
              <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                {options.agents.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-zinc-600">{text(language, '暂无可用 Agent', 'No agents available')}</p>
                ) : options.agents.map((agent) => {
                  const checked = draft.agentMemberIds.includes(agent.id)
                  return (
                    <label
                      key={agent.id}
                      className={cn(
                        'flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                        checked ? 'border-sky-500/40 bg-sky-500/10 text-zinc-100' : 'border-zinc-800 bg-zinc-950/70 text-zinc-300',
                      )}
                    >
                      <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                        {agent.avatarUrl ? <AvatarImage src={resolveMediaUrl(agent.avatarUrl)} /> : null}
                        <AvatarFallback className="bg-gradient-to-br from-cyan-300 via-sky-300 to-indigo-400 text-[11px] font-black text-zinc-950">
                          {getAgentInitials(agent.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{agent.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{agent.role}</span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextValue) => toggleAgentMember(agent.id, Boolean(nextValue))}
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="px-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {text(language, '取消', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void onSubmit()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {text(language, '创建群聊', 'Create Group')}
            </Button>
          </DialogFooter>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

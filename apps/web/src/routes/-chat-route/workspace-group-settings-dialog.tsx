/**
 * [INPUT]: A workspace group detail, available workspace members/Agents, and group-setting mutations.
 * [OUTPUT]: View and owner-only editing UI for a `/chat` workspace group (profile, announcement, members).
 * [POS]: Group-chat presentation boundary; task assignment and Squad concepts do not belong here.
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, LogOut, Megaphone, MessageSquarePlus, Plus, Save, Search, Settings2, Trash2, UserPlus, Users, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { useAuth } from '../../lib/auth-context'
import { formatDate } from '../../lib/utils'
import { resolveMediaUrl, type TeamMember, type WorkspaceChatAgentOption, type WorkspaceChatGroupDetail } from '../../lib/api'
import type { Language } from '../../lib/i18n'
import { getAgentInitials, text } from './chat-route-helpers'
import { filterGroupMembersByQuery, getMemberLabel, memberKey } from './workspace-group-chat-members'
import type { GroupOptions } from './workspace-group-chat-panel'

type GroupMemberMutation = (memberType: 'user' | 'agent', memberId: string) => Promise<void>

type WorkspaceGroupSettingsDialogProps = {
  detail: WorkspaceChatGroupDetail | null
  language: Language
  options: GroupOptions
  open: boolean
  canManage: boolean
  busyKey?: string
  onOpenChange: (open: boolean) => void
  onUpdateTitle: (title: string) => Promise<void>
  onUpdateDescription: (description: string) => Promise<void>
  onUpdateAnnouncement: (announcement: string) => Promise<void>
  onAddMember: GroupMemberMutation
  onRemoveMember: GroupMemberMutation
  onLeaveGroup: () => Promise<void>
  onDeleteGroup: () => Promise<void>
  /** 群成员 → 发起私聊（飞书式）。 */
  onStartDm?: (userId: string) => Promise<string>
}

export function WorkspaceGroupSettingsDialog(props: WorkspaceGroupSettingsDialogProps) {
  const {
    detail,
    language,
    options,
    open,
    canManage,
    busyKey,
    onOpenChange,
    onUpdateTitle,
    onUpdateDescription,
    onUpdateAnnouncement,
    onAddMember,
    onRemoveMember,
    onLeaveGroup,
    onDeleteGroup,
    onStartDm,
  } = props
  const { user } = useAuth()
  const currentUserId = user?.id?.trim() || ''
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [addQuery, setAddQuery] = useState('')
  const [confirmRemoveKey, setConfirmRemoveKey] = useState('')
  const [confirmAction, setConfirmAction] = useState<'leave' | 'disband' | null>(null)
  const currentMemberKeys = useMemo(
    () => new Set(detail?.members.map((member) => memberKey(member.memberType, member.memberId))),
    [detail?.members],
  )

  const announcementAuthor = useMemo(() => {
    const updatedBy = detail?.conversation.announcementUpdatedBy
    if (!updatedBy) return ''
    return options.members.find((member) => member.id === updatedBy)?.name || ''
  }, [detail?.conversation.announcementUpdatedBy, options.members])

  const filteredMembers = useMemo(() => {
    const members = detail?.members ?? []
    return filterGroupMembersByQuery(members, memberQuery, options.members, options.agents)
  }, [detail?.members, memberQuery, options.members, options.agents])

  const availableUsers = useMemo(
    () => options.members.filter((member) => !currentMemberKeys.has(memberKey('user', member.id))),
    [currentMemberKeys, options.members],
  )
  const availableAgents = useMemo(
    () => options.agents.filter((agent) => !currentMemberKeys.has(memberKey('agent', agent.id))),
    [currentMemberKeys, options.agents],
  )

  const filteredAvailableUsers = useMemo(() => {
    const normalizedQuery = addQuery.trim().toLowerCase()
    if (!normalizedQuery) return availableUsers
    return availableUsers.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(normalizedQuery))
  }, [addQuery, availableUsers])

  const filteredAvailableAgents = useMemo(() => {
    const normalizedQuery = addQuery.trim().toLowerCase()
    if (!normalizedQuery) return availableAgents
    return availableAgents.filter((agent) => `${agent.name} ${agent.role}`.toLowerCase().includes(normalizedQuery))
  }, [addQuery, availableAgents])

  useEffect(() => {
    if (open) {
      setTitle(detail?.conversation.title || '')
      setDescription(detail?.conversation.description || '')
      setAnnouncement(detail?.conversation.announcement || '')
      setMemberQuery('')
      setAddQuery('')
      setConfirmRemoveKey('')
      setConfirmAction(null)
    }
    // 只在弹窗打开或切换群时重置草稿；保存单个字段时不应覆盖其他字段的未保存草稿。
  }, [open, detail?.conversation.id])

  const handleSaveTitle = async () => {
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle === detail?.conversation.title.trim()) {
      return
    }
    await onUpdateTitle(nextTitle)
  }

  const handleSaveDescription = async () => {
    const nextDescription = description.trim()
    if (nextDescription === (detail?.conversation.description || '').trim()) {
      return
    }
    await onUpdateDescription(nextDescription)
  }

  const handleSaveAnnouncement = async () => {
    const nextAnnouncement = announcement.trim()
    if (nextAnnouncement === (detail?.conversation.announcement || '').trim()) {
      return
    }
    await onUpdateAnnouncement(nextAnnouncement)
  }

  const handleAddMember = async (memberType: 'user' | 'agent', memberId: string) => {
    await onAddMember(memberType, memberId)
  }

  const handleConfirmRemove = async (memberType: 'user' | 'agent', memberId: string) => {
    await onRemoveMember(memberType, memberId)
    setConfirmRemoveKey('')
  }

  const ownerNote = canManage ? null : (
    <p className="text-[11px] text-zinc-600">{text(language, '只有群创建者可以修改', 'Only the group owner can edit')}</p>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] max-w-2xl overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader className="sticky top-0 z-10 bg-zinc-950">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4 text-zinc-400" />
            {text(language, '群设置', 'Group settings')}
          </DialogTitle>
        </DialogHeader>

        {!detail ? (
          <p className="py-8 text-center text-sm text-zinc-500">{text(language, '群聊详情加载中...', 'Loading group details...')}</p>
        ) : (
          <div className="space-y-5 px-5 pb-5 pt-4">
            {/* 群资料 */}
            <section className="space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{text(language, '群资料', 'Group profile')}</p>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-zinc-400">{text(language, '群名称', 'Group name')}</p>
                  {canManage ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleSaveTitle()}
                      disabled={!title.trim() || title.trim() === detail.conversation.title.trim() || busyKey === 'title'}
                      className="h-8 gap-1.5"
                    >
                      {busyKey === 'title' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                      {text(language, '保存', 'Save')}
                    </Button>
                  ) : null}
                </div>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={!canManage || busyKey === 'title'}
                  maxLength={80}
                  aria-label={text(language, '群名称', 'Group name')}
                  className="h-10 border-zinc-800 bg-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-zinc-400">{text(language, '群简介', 'Group description')}</p>
                  {canManage ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleSaveDescription()}
                      disabled={description.trim() === (detail.conversation.description || '').trim() || busyKey === 'description'}
                      className="h-8 gap-1.5"
                    >
                      {busyKey === 'description' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                      {text(language, '保存', 'Save')}
                    </Button>
                  ) : null}
                </div>
                {ownerNote}
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={!canManage || busyKey === 'description'}
                  maxLength={500}
                  rows={2}
                  aria-label={text(language, '群简介', 'Group description')}
                  placeholder={text(language, '介绍一下这个群聊的用途…', 'Describe the purpose of this group...')}
                  className="min-h-[64px] border-zinc-800 bg-zinc-900 text-sm"
                />
              </div>
            </section>

            {/* 群公告 */}
            <section className="space-y-2 border-t border-zinc-900 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Megaphone className="size-4 text-zinc-500" />
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{text(language, '群公告', 'Group announcement')}</p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveAnnouncement()}
                    disabled={announcement.trim() === (detail.conversation.announcement || '').trim() || busyKey === 'announcement'}
                    className="h-8 gap-1.5"
                  >
                    {busyKey === 'announcement' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    {text(language, '保存', 'Save')}
                  </Button>
                ) : null}
              </div>
              {ownerNote}
              <Textarea
                value={announcement}
                onChange={(event) => setAnnouncement(event.target.value)}
                disabled={!canManage || busyKey === 'announcement'}
                maxLength={2000}
                rows={3}
                aria-label={text(language, '群公告', 'Group announcement')}
                placeholder={text(language, '置顶公告，会展示在群聊顶部…', 'A pinned announcement shown at the top of the chat...')}
                className="min-h-[80px] border-zinc-800 bg-zinc-900 text-sm"
              />
              {detail.conversation.announcementUpdatedAt ? (
                <p className="text-[11px] text-zinc-600">
                  {text(language, '最后更新', 'Last updated')}
                  {announcementAuthor ? ` · ${announcementAuthor}` : ''}
                  {' · '}{formatDate(detail.conversation.announcementUpdatedAt)}
                </p>
              ) : null}
            </section>

            {/* 成员管理 */}
            <section className="space-y-3 border-t border-zinc-900 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-zinc-500" />
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{text(language, '群成员', 'Members')}</p>
                </div>
                <p className="text-[11px] text-zinc-600">{detail.members.filter((member) => !member.leftAt).length} {text(language, '位成员', 'members')}</p>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                <Input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  aria-label={text(language, '搜索成员', 'Search members')}
                  placeholder={text(language, '搜索成员…', 'Search members...')}
                  className="h-9 border-zinc-800 bg-zinc-900 pl-9 text-sm"
                />
              </div>

              <div className="grid gap-2">
                {filteredMembers.filter((member) => !member.leftAt).map((member) => {
                  const profile = getMemberLabel(member.memberType, member.memberId, options.members, options.agents)
                  const key = memberKey(member.memberType, member.memberId)
                  const removeBusy = busyKey === `remove:${key}`
                  const confirming = confirmRemoveKey === key
                  return (
                    <div key={key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                      <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                        {profile.avatarUrl ? <AvatarImage src={resolveMediaUrl(profile.avatarUrl)} /> : null}
                        <AvatarFallback className="bg-zinc-800 text-[10px] font-semibold text-zinc-100">{profile.fallback}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="block truncate text-sm text-zinc-200">{profile.name}</span>
                          {member.role === 'owner' ? (
                            <span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/5 px-1.5 py-0.5 text-[10px] text-amber-300">{text(language, '创建者', 'Owner')}</span>
                          ) : member.role === 'orchestrator' ? (
                            <span className="shrink-0 rounded-md border border-sky-500/20 bg-sky-500/5 px-1.5 py-0.5 text-[10px] text-sky-300">{text(language, '主持', 'Orchestrator')}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-1.5 truncate text-[11px] text-zinc-500">
                          <span>{member.memberType === 'agent' ? 'Agent' : text(language, '成员', 'Member')}</span>
                          <span className="text-zinc-700">·</span>
                          <span>{text(language, '入群', 'Joined')} {formatDate(member.joinedAt)}</span>
                        </span>
                      </span>
                      {member.role === 'owner' ? null : canManage ? (
                        confirming ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleConfirmRemove(member.memberType, member.memberId)}
                              disabled={Boolean(busyKey)}
                              className="h-7 px-2 text-[11px] text-red-300 hover:bg-red-500/10"
                            >
                              {text(language, '确认移除', 'Confirm')}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => setConfirmRemoveKey('')}
                              disabled={Boolean(busyKey)}
                              aria-label={text(language, '取消', 'Cancel')}
                              className="size-7 text-zinc-500"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </span>
                        ) : (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setConfirmRemoveKey(key)}
                            disabled={Boolean(busyKey)}
                            aria-label={text(language, '移除成员', 'Remove member')}
                            title={text(language, '移除成员', 'Remove member')}
                            className="size-7 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                          >
                            {removeBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </Button>
                        )
                      ) : null}
                      {member.memberType === 'user' && member.memberId !== currentUserId && onStartDm ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void onStartDm(member.memberId)}
                          disabled={Boolean(busyKey)}
                          aria-label={text(language, '发起私聊', 'Start a direct message')}
                          title={text(language, '发起私聊', 'Start a direct message')}
                          className="size-7 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          <MessageSquarePlus className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
                {filteredMembers.filter((member) => !member.leftAt).length === 0 ? (
                  <p className="py-3 text-center text-sm text-zinc-600">{text(language, '没有匹配的成员', 'No matching members')}</p>
                ) : null}
              </div>
            </section>

            {/* 添加成员 */}
            {canManage ? (
              <section className="space-y-2 border-t border-zinc-900 pt-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="size-4 text-zinc-500" />
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{text(language, '添加成员', 'Add member')}</p>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                  <Input
                    value={addQuery}
                    onChange={(event) => setAddQuery(event.target.value)}
                    aria-label={text(language, '搜索要添加的成员或 Agent', 'Search members or Agents to add')}
                    placeholder={text(language, '按姓名或邮箱搜索…', 'Search by name or email...')}
                    className="h-9 border-zinc-800 bg-zinc-900 pl-9 text-sm"
                  />
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {filteredAvailableUsers.length === 0 && filteredAvailableAgents.length === 0 ? (
                    <p className="py-3 text-center text-sm text-zinc-600">{text(language, '没有可添加的成员或 Agent', 'No members or Agents to add')}</p>
                  ) : null}
                  {filteredAvailableUsers.length > 0 ? (
                    <p className="text-[11px] text-zinc-600">{text(language, '组织成员', 'Organization members')}</p>
                  ) : null}
                  {filteredAvailableUsers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                      <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                        {member.avatarUrl ? <AvatarImage src={resolveMediaUrl(member.avatarUrl)} /> : null}
                        <AvatarFallback className="bg-zinc-800 text-[10px] font-semibold text-zinc-100">{getAgentInitials(member.name)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-200">{member.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{member.username ? `@${member.username}` : member.email}</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleAddMember('user', member.id)}
                        disabled={Boolean(busyKey)}
                        className="h-7 gap-1 px-2 text-zinc-400 hover:text-zinc-100"
                      >
                        {busyKey === `add:user:${member.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                        {text(language, '添加', 'Add')}
                      </Button>
                    </div>
                  ))}
                  {filteredAvailableAgents.length > 0 ? (
                    <p className="text-[11px] text-zinc-600">{text(language, 'Agent', 'Agents')}</p>
                  ) : null}
                  {filteredAvailableAgents.map((agent) => (
                    <div key={agent.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                      <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                        {agent.avatarUrl ? <AvatarImage src={resolveMediaUrl(agent.avatarUrl)} /> : null}
                        <AvatarFallback className="bg-gradient-to-br from-cyan-300 via-sky-300 to-indigo-400 text-[10px] font-black text-zinc-950">{getAgentInitials(agent.name)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-200">{agent.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{agent.role}</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleAddMember('agent', agent.id)}
                        disabled={Boolean(busyKey)}
                        className="h-7 gap-1 px-2 text-zinc-400 hover:text-zinc-100"
                      >
                        {busyKey === `add:agent:${agent.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                        {text(language, '添加', 'Add')}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-2 border-t border-zinc-900 pt-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{text(language, '危险操作', 'Danger zone')}</p>
              {canManage ? (
                confirmAction === 'disband' ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                    <p className="text-sm text-red-300">{text(language, '解散后所有会话与消息将被删除，且不可恢复。', 'Disbanding deletes all sessions and messages permanently.')}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void onDeleteGroup()}
                        disabled={Boolean(busyKey)}
                        className="h-7 px-2 text-[11px] text-red-300 hover:bg-red-500/10"
                      >
                        {busyKey === 'disband' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        {text(language, '确认解散', 'Confirm')}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmAction(null)}
                        disabled={Boolean(busyKey)}
                        aria-label={text(language, '取消', 'Cancel')}
                        className="size-7 text-zinc-500"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setConfirmAction('disband')}
                    disabled={Boolean(busyKey)}
                    className="h-9 w-full justify-start gap-2 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                  >
                    <Trash2 className="size-4" />
                    {text(language, '解散群聊', 'Disband group')}
                  </Button>
                )
              ) : confirmAction === 'leave' ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <p className="text-sm text-red-300">{text(language, '退出后将无法查看该群聊记录。', 'After leaving you will no longer see this group chat.')}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void onLeaveGroup()}
                      disabled={Boolean(busyKey)}
                      className="h-7 px-2 text-[11px] text-red-300 hover:bg-red-500/10"
                    >
                      {busyKey === 'leave' ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                      {text(language, '确认退出', 'Confirm')}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmAction(null)}
                      disabled={Boolean(busyKey)}
                      aria-label={text(language, '取消', 'Cancel')}
                      className="size-7 text-zinc-500"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmAction('leave')}
                  disabled={Boolean(busyKey)}
                  className="h-9 w-full justify-start gap-2 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                >
                  <LogOut className="size-4" />
                  {text(language, '退出群聊', 'Leave group')}
                </Button>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

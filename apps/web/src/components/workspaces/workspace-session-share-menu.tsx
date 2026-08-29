// [INPUT]: 当前工作区会话定位信息（project/task/workspace/session id 与标题）；Agent 目标列表复用群聊选择器可见性口径
// [OUTPUT]: 统一分享浮窗——复制链接 + 搜索/快速选择群聊·成员·Agent；
//           成员/Agent 两步交互：选目标 → 选发送会话 + 权限（查看/可编辑/可协助）→ 分享（授权+发链接消息）或协作（仅授权）
// [POS]: 工作区会话分享入口；分享=workspace_shares 授权（scope=session）+ 发链接消息；协作=仅授权（scope 可选），对方在工作区侧看到
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Check, Copy, Link2, Loader2, Search, Send, Share2, Users } from 'lucide-react'
import { api, resolveMediaUrl, type ProjectAssignee, type WorkspaceChatAgentOption } from '../../lib/api'
import { loadProjectAssignees } from '../../lib/project-collaboration-data'
import { resolveAppUrl } from '../../lib/runtime-config'
import { useTranslation } from '../../lib/i18n/react'
import type { Language } from '../../lib/i18n'
import type { WorkspaceSharePermission, WorkspaceShareScope } from '@shared/types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { cn } from '../../lib/utils'

const text = (language: Language, zh: string, en: string) => (language === 'zh' ? zh : en)

const getInitials = (name: string) => {
  const normalized = name.trim()
  if (!normalized) {
    return '?'
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

const stripAgentIdPrefix = (id: string) => (id.startsWith('agent:') ? id.slice('agent:'.length) : id)

const PERMISSION_OPTIONS: Array<{ value: WorkspaceSharePermission; labelZh: string; labelEn: string }> = [
  { value: 'read', labelZh: '查看', labelEn: 'View' },
  { value: 'edit', labelZh: '可编辑', labelEn: 'Can edit' },
  { value: 'collaborate', labelZh: '可协助', labelEn: 'Collaborate' },
]

const SCOPE_OPTIONS: Array<{ value: WorkspaceShareScope; labelZh: string; labelEn: string }> = [
  { value: 'workspace', labelZh: '整个工作区', labelEn: 'Whole workspace' },
  { value: 'all_sessions', labelZh: '所有会话', labelEn: 'All sessions' },
  { value: 'session', labelZh: '仅此会话', labelEn: 'This session' },
]

export type WorkspaceSessionShareInfo = {
  projectId?: string
  taskId?: string
  workspaceId: string
  workspaceSessionId: string
  workspaceSessionTitle: string
}

type GroupShareTarget = {
  kind: 'group'
  workspaceId: string
  groupId: string
  sessionId: string
  label: string
  memberCount: number
}

type MemberShareTarget = {
  kind: 'user' | 'agent'
  id: string
  label: string
  avatarUrl?: string
  subtitle?: string
}

type ShareTarget = GroupShareTarget | MemberShareTarget

/** 发送会话候选：与目标人的私聊（DM）/ 与目标 Agent 的主聊天会话 */
type ShareChannel = {
  id: string
  kind: 'dm' | 'main_chat' | 'new_dm'
  label: string
  subtitle?: string
}

export function useWorkspaceSessionShare({
  projectId,
  taskId,
  workspaceId,
  workspaceSessionId,
  workspaceSessionTitle,
}: WorkspaceSessionShareInfo) {
  const { language } = useTranslation()

  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyTargetId, setBusyTargetId] = useState('')
  const [members, setMembers] = useState<ProjectAssignee[]>([])
  const [agents, setAgents] = useState<WorkspaceChatAgentOption[]>([])
  const [groupTargets, setGroupTargets] = useState<GroupShareTarget[]>([])
  const [existingShares, setExistingShares] = useState<import('@shared/types').WorkspaceShareRecord[]>([])

  // Step 2 状态：选中的成员/Agent 目标 + 发送会话候选 + 权限/范围
  const [selectedTarget, setSelectedTarget] = useState<MemberShareTarget | null>(null)
  const [channels, setChannels] = useState<ShareChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [permission, setPermission] = useState<WorkspaceSharePermission>('read')
  const [collabScope, setCollabScope] = useState<WorkspaceShareScope>('session')

  const buildWorkspaceLink = useCallback(() => {
    const params = new URLSearchParams()
    if (projectId?.trim()) {
      params.set('projectId', projectId.trim())
    }
    if (taskId?.trim() && taskId.trim() !== workspaceSessionId) {
      params.set('taskId', taskId.trim())
    }
    params.set('workspaceId', workspaceId)
    params.set('workspaceSessionId', workspaceSessionId)
    const queryString = params.toString()
    return resolveAppUrl(`/workspace${queryString ? `?${queryString}` : ''}`)
  }, [projectId, taskId, workspaceId, workspaceSessionId])

  const shareText = useMemo(() => {
    const title = workspaceSessionTitle?.trim() || text(language, '工作区会话', 'Workspace session')
    return `${title}：${buildWorkspaceLink()}`
  }, [buildWorkspaceLink, language, workspaceSessionTitle])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildWorkspaceLink())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success(text(language, '已复制链接。', 'Link copied.'))
    } catch {
      toast.error(text(language, '复制失败，请手动复制。', 'Copy failed, please copy manually.'))
    }
  }, [buildWorkspaceLink, language])

  const loadTargets = useCallback(async () => {
    if (!open) {
      return
    }

    setLoading(true)
    const [assignees, workspacesRes, chatOptionsRes, sharesRes] = await Promise.all([
      (projectId?.trim() ? loadProjectAssignees(projectId) : Promise.resolve([] as ProjectAssignee[])).catch(() => [] as ProjectAssignee[]),
      api.listCollaborationWorkspaces().catch(() => ({ workspaces: [] })),
      (workspaceId?.trim() ? api.getWorkspaceChatGroupOptions(workspaceId) : Promise.resolve(null)).catch(() => null),
      (workspaceId?.trim() ? api.listWorkspaceShares(workspaceId).then((res) => res.shares) : Promise.resolve([] as import('@shared/types').WorkspaceShareRecord[])).catch(() => []),
    ])

    setMembers(assignees)
    setExistingShares(sharesRes)
    // Agent 目标复用群聊选择器可见性（自己的 Agent + 显式归属该组织的共享 Agent），
    // 避免把全库用户各自的默认 CEO Agent 全部涌进分享弹窗。
    setAgents(chatOptionsRes?.agents ?? [])

    const grouped = await Promise.all(workspacesRes.workspaces.map(async (workspace) => {
      const groupsRes = await api.listWorkspaceChatGroups(workspace.id).catch(() => ({ groups: [] }))
      return { workspaceId: workspace.id, groups: groupsRes.groups }
    }))

    const nextGroupTargets: GroupShareTarget[] = []
    await Promise.all(grouped.flatMap(({ workspaceId: groupWorkspaceId, groups }) => groups.map(async (group) => {
      const sessionsRes = await api.listWorkspaceChatGroupSessions(groupWorkspaceId, group.conversation.id).catch(() => ({ sessions: [] }))
      const session = sessionsRes.sessions[0]
      if (session) {
        nextGroupTargets.push({
          kind: 'group',
          workspaceId: groupWorkspaceId,
          groupId: group.conversation.id,
          sessionId: session.conversation.id,
          label: group.conversation.title || group.conversation.id,
          memberCount: group.members.length,
        })
      }
    })))

    setGroupTargets(nextGroupTargets)
    setLoading(false)
  }, [open, projectId, workspaceId])

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  const reset = () => {
    setQuery('')
    setBusyTargetId('')
    setCopied(false)
    setMembers([])
    setAgents([])
    setGroupTargets([])
    setExistingShares([])
    setSelectedTarget(null)
    setChannels([])
    setChannelsLoading(false)
    setSelectedChannelId('')
    setPermission('read')
    setCollabScope('session')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      reset()
    }
  }

  const openShareDialog = useCallback(() => {
    reset()
    setOpen(true)
  }, [])

  const normalizedQuery = query.trim().toLowerCase()

  const memberTargets = useMemo<MemberShareTarget[]>(() => {
    return members
      .filter((assignee) => assignee.kind === 'user')
      .map((assignee) => ({
        kind: 'user' as const,
        id: assignee.id,
        label: assignee.name,
        avatarUrl: assignee.avatarUrl,
        subtitle: assignee.email || undefined,
      }))
  }, [members])

  // Agent 目标：优先用群聊选择器口径（自己的 Agent + 显式归属该组织的共享 Agent）；
  // 接口不可用时兜底退回项目 assignees 中的 Agent，保证弹窗不空。
  const agentTargets = useMemo<MemberShareTarget[]>(() => {
    if (agents.length > 0) {
      return agents.map((agent) => ({
        kind: 'agent' as const,
        id: agent.id,
        label: agent.name,
        avatarUrl: agent.avatarUrl,
        subtitle: agent.role || text(language, 'Agent', 'Agent'),
      }))
    }
    return members
      .filter((assignee) => assignee.kind === 'agent')
      .map((assignee) => ({
        kind: 'agent' as const,
        id: stripAgentIdPrefix(assignee.id),
        label: assignee.name,
        avatarUrl: assignee.avatarUrl,
        subtitle: text(language, 'Agent', 'Agent'),
      }))
  }, [agents, members, language])

  const filteredTargets = useMemo(() => {
    const match = (label: string) => !normalizedQuery || label.toLowerCase().includes(normalizedQuery)
    return {
      groups: groupTargets.filter((target) => match(target.label)),
      members: memberTargets.filter((target) => match(target.label)),
      agents: agentTargets.filter((target) => match(target.label)),
    }
  }, [groupTargets, memberTargets, agentTargets, normalizedQuery])

  /** Step 2：加载与该目标的发送会话候选 */
  const loadChannelsForTarget = useCallback(async (target: MemberShareTarget) => {
    setChannelsLoading(true)
    setChannels([])
    setSelectedChannelId('')
    try {
      if (target.kind === 'user') {
        const res = await api.listDmConversations().catch(() => ({ conversations: [] }))
        const dms = res.conversations
          .filter((item) => item.peer?.userId === target.id)
          .map((item) => ({
            id: item.conversation.id,
            kind: 'dm' as const,
            label: item.conversation.title || target.label,
            subtitle: text(language, '私聊', 'Direct chat'),
          }))
        setChannels(dms.length > 0
          ? dms
          : [{ id: 'new-dm', kind: 'new_dm', label: text(language, '新建与 TA 的私聊', 'Start a new direct chat') }])
      } else {
        const res = await api.listMainChatSessionSummaries({ agentId: target.id }).catch(() => ({ sessions: [] }))
        setChannels(res.sessions.map((session) => ({
          id: session.id,
          kind: 'main_chat' as const,
          label: session.title || target.label,
          subtitle: text(language, '主聊天', 'Agent chat'),
        })))
      }
      setSelectedChannelId('')
    } finally {
      setChannelsLoading(false)
    }
  }, [language])

  const handleSelectMemberTarget = (target: MemberShareTarget) => {
    setSelectedTarget(target)
    void loadChannelsForTarget(target)
  }

  const backToTargets = () => {
    setSelectedTarget(null)
    setChannels([])
    setSelectedChannelId('')
  }

  /** 把链接消息发到指定 channel */
  const sendLinkToChannel = async (target: MemberShareTarget, channel: ShareChannel) => {
    if (channel.kind === 'new_dm' && target.kind === 'user') {
      const created = await api.ensureDmConversation(target.id)
      await api.sendConversationMessage(created.conversation.id, { content: shareText })
      return
    }
    if (channel.kind === 'dm') {
      await api.sendConversationMessage(channel.id, { content: shareText })
      return
    }
    await api.sendWorkspaceLinkToMainChat(channel.id, shareText)
  }

  /** 分享：授权（scope=session）+ 发链接消息到所选会话 */
  const shareToMember = async (target: MemberShareTarget) => {
    const channel = channels.find((item) => item.id === selectedChannelId)
    if (!channel) {
      toast.error(text(language, '请选择发送到哪个会话。', 'Choose a chat to send to.'))
      return
    }

    setBusyTargetId(`share:${target.kind}:${target.id}`)
    try {
      await api.grantWorkspaceShare(workspaceId, {
        scope: 'session',
        sessionId: workspaceSessionId,
        targetType: target.kind,
        targetId: target.id,
        permission,
      })
      await sendLinkToChannel(target, channel)
      toast.success(text(language, '已分享。', 'Shared.'))
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '分享失败', 'Failed to share'))
    } finally {
      setBusyTargetId('')
    }
  }

  /** 协作：仅授权（范围可选），对方在工作区侧看到，不发聊天消息 */
  const collaborateWithMember = async (target: MemberShareTarget) => {
    setBusyTargetId(`collab:${target.kind}:${target.id}`)
    try {
      await api.grantWorkspaceShare(workspaceId, {
        scope: collabScope,
        sessionId: collabScope === 'session' ? workspaceSessionId : undefined,
        targetType: target.kind,
        targetId: target.id,
        permission,
      })
      toast.success(text(language, '已协作。', 'Collaboration granted.'))
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '协作失败', 'Failed to collaborate'))
    } finally {
      setBusyTargetId('')
    }
  }

  /** 撤销授权（工作区成员可撤销） */
  const revokeShare = async (shareId: string) => {
    setBusyTargetId(`revoke:${shareId}`)
    try {
      await api.revokeWorkspaceShare(workspaceId, shareId)
      setExistingShares((current) => current.filter((share) => share.id !== shareId))
      toast.success(text(language, '已撤销。', 'Revoked.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '撤销失败', 'Failed to revoke'))
    } finally {
      setBusyTargetId('')
    }
  }

  const resolveShareTargetLabel = (share: import('@shared/types').WorkspaceShareRecord) => {
    if (share.targetType === 'user') {
      const member = memberTargets.find((item) => item.id === share.targetId)
      if (member) return member.label
      const assignee = members.find((item) => item.id === share.targetId)
      return assignee?.name || share.targetId.slice(0, 8)
    }
    const agent = agentTargets.find((item) => item.id === share.targetId)
    return agent?.label || share.targetId.slice(0, 8)
  }

  const shareScopeLabel = (share: import('@shared/types').WorkspaceShareRecord) => {
    switch (share.scope) {
      case 'workspace': return text(language, '整个工作区', 'Workspace')
      case 'all_sessions': return text(language, '所有会话', 'All sessions')
      default: return text(language, '会话', 'Session')
    }
  }

  const sharePermissionLabel = (permission: import('@shared/types').WorkspaceSharePermission) => {
    switch (permission) {
      case 'edit': return text(language, '可编辑', 'Edit')
      case 'collaborate': return text(language, '可协助', 'Collaborate')
      default: return text(language, '查看', 'View')
    }
  }

  const sendToGroup = async (target: GroupShareTarget) => {
    setBusyTargetId(`group:${target.groupId}`)
    try {
      await api.sendWorkspaceLinkToGroupChat(target.workspaceId, target.groupId, target.sessionId, shareText)
      toast.success(text(language, '已发送到群聊。', 'Sent to group.'))
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '发送失败', 'Failed to send'))
    } finally {
      setBusyTargetId('')
    }
  }

  const handleSelectTarget = (target: ShareTarget) => {
    if (target.kind === 'group') {
      void sendToGroup(target)
    } else {
      handleSelectMemberTarget(target)
    }
  }

  const renderTargetRow = (target: ShareTarget, icon: ReactNode, subtitle?: string) => {
    const busyKey = target.kind === 'group' ? `group:${target.groupId}` : `${target.kind}:${target.id}`
    const busy = busyTargetId === busyKey
    return (
      <button
        key={busyKey}
        type="button"
        onClick={() => handleSelectTarget(target)}
        disabled={Boolean(busyTargetId)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-900/40 disabled:opacity-60"
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-zinc-200">{target.label}</span>
          {subtitle ? <span className="block truncate text-[11px] text-zinc-500">{subtitle}</span> : null}
        </span>
        {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin text-zinc-500" /> : null}
      </button>
    )
  }

  const sectionLabel = (label: string) => (
    <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
  )

  const permissionSelector = (
    <div className="flex items-center gap-1.5">
      {PERMISSION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setPermission(option.value)}
          className={cn(
            'h-7 flex-1 rounded-md border px-2 text-xs font-medium transition-colors',
            permission === option.value
              ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
              : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900',
          )}
        >
          {text(language, option.labelZh, option.labelEn)}
        </button>
      ))}
    </div>
  )

  const collabScopeSelector = (
    <div className="flex items-center gap-1.5">
      {SCOPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setCollabScope(option.value)}
          className={cn(
            'h-7 flex-1 rounded-md border px-1 text-[11px] font-medium transition-colors',
            collabScope === option.value
              ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
              : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900',
          )}
        >
          {text(language, option.labelZh, option.labelEn)}
        </button>
      ))}
    </div>
  )

  const stepTwoPanel = selectedTarget ? (
    <div className="space-y-3 px-5">
      <button
        type="button"
        onClick={backToTargets}
        className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <ArrowLeft className="size-3.5" />
        {text(language, '返回选择', 'Back')}
        <span className="ml-2 truncate text-zinc-500">{selectedTarget.label}</span>
      </button>

      <div className="space-y-1">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {text(language, '发送到会话', 'Send to chat')}
        </p>
        {channelsLoading ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" />
            {text(language, '加载会话…', 'Loading chats…')}
          </div>
        ) : channels.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-800 px-2 py-2 text-[11px] text-zinc-500">
            {text(language, '暂无可用会话。', 'No available chats.')}
          </p>
        ) : (
          channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => setSelectedChannelId(channel.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                selectedChannelId === channel.id
                  ? 'border-zinc-600 bg-zinc-800/70'
                  : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-900',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-zinc-200">{channel.label}</span>
                {channel.subtitle ? <span className="block truncate text-[10px] text-zinc-500">{channel.subtitle}</span> : null}
              </span>
              {selectedChannelId === channel.id ? <Check className="size-3.5 shrink-0 text-zinc-300" /> : null}
            </button>
          ))
        )}
      </div>

      <div className="space-y-1">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {text(language, '权限', 'Permission')}
        </p>
        {permissionSelector}
      </div>

      <div className="space-y-1">
        <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {text(language, '协作范围', 'Collaboration scope')}
        </p>
        {collabScopeSelector}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="h-8 flex-1 text-xs"
          disabled={Boolean(busyTargetId) || !selectedChannelId}
          onClick={() => selectedTarget && void shareToMember(selectedTarget)}
        >
          {busyTargetId.startsWith('share:')
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Send className="size-3.5" />}
          {text(language, '分享', 'Share')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 flex-1 border-zinc-800 text-xs"
          disabled={Boolean(busyTargetId)}
          onClick={() => selectedTarget && void collaborateWithMember(selectedTarget)}
        >
          {busyTargetId.startsWith('collab:')
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Users className="size-3.5" />}
          {text(language, '协作', 'Collaborate')}
        </Button>
      </div>
    </div>
  ) : null

  const targetList = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      {existingShares.length > 0 ? (
        <div className="space-y-1">
          {sectionLabel(text(language, '已共享', 'Shared'))}
          {existingShares.map((share) => (
            <div
              key={share.id}
              className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-zinc-200">{resolveShareTargetLabel(share)}</span>
                <span className="block truncate text-[10px] text-zinc-500">
                  {shareScopeLabel(share)} · {sharePermissionLabel(share.permission)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void revokeShare(share.id)}
                disabled={Boolean(busyTargetId)}
                className="shrink-0 rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-400 disabled:opacity-50"
                title={text(language, '撤销', 'Revoke')}
              >
                {busyTargetId === `revoke:${share.id}` ? <Loader2 className="size-3 animate-spin" /> : text(language, '撤销', 'Revoke')}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {filteredTargets.groups.length > 0 ? (
        <div className="space-y-1">
          {sectionLabel(text(language, '群聊', 'Group chats'))}
          {filteredTargets.groups.map((target) => renderTargetRow(
            target,
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
              <Users className="size-3.5" />
            </span>,
            target.memberCount > 0
              ? text(language, `${target.memberCount} 位成员`, `${target.memberCount} members`)
              : undefined,
          ))}
        </div>
      ) : null}

      {filteredTargets.members.length > 0 ? (
        <div className="space-y-1">
          {sectionLabel(text(language, '成员', 'Members'))}
          {filteredTargets.members.map((target) => renderTargetRow(
            target,
            <Avatar className="size-7 shrink-0 border border-zinc-800 bg-zinc-900">
              <AvatarImage src={resolveMediaUrl(target.avatarUrl)} />
              <AvatarFallback className="bg-zinc-900 text-[10px] font-semibold text-zinc-100">
                {getInitials(target.label)}
              </AvatarFallback>
            </Avatar>,
            target.subtitle,
          ))}
        </div>
      ) : null}

      {filteredTargets.agents.length > 0 ? (
        <div className="space-y-1">
          {sectionLabel(text(language, 'Agent', 'Agents'))}
          {filteredTargets.agents.map((target) => renderTargetRow(
            target,
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 via-sky-300 to-indigo-400 text-[10px] font-black text-zinc-950">
              {getInitials(target.label)}
            </span>,
            target.subtitle,
          ))}
        </div>
      ) : null}

      {filteredTargets.groups.length === 0 && filteredTargets.members.length === 0 && filteredTargets.agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-6 text-center text-xs text-zinc-500">
          {loading
            ? text(language, '加载中…', 'Loading…')
            : text(language, '没有匹配的群聊或好友。', 'No matching chats or contacts.')}
        </div>
      ) : null}
    </div>
  )

  const shareDialog = (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[70vh] max-w-md flex-col gap-3 border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Share2 className="size-4 text-zinc-400" />
            {text(language, '分享工作区会话', 'Share Workspace Session')}
          </DialogTitle>
        </DialogHeader>

        {selectedTarget ? (
          stepTwoPanel
        ) : (
          <div className="min-h-0 flex-1 space-y-3 px-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text(language, '搜索群聊或好友…', 'Search chats or contacts…')}
                className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
            </div>

            {targetList}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-900 px-5 pt-3">
          <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2">
            <Link2 className="size-3.5 shrink-0 text-zinc-500" />
            <span className="truncate text-[11px] text-zinc-500">{buildWorkspaceLink()}</span>
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => void copyLink()}
            className={cn(
              'h-7 shrink-0 rounded-md px-2.5 text-xs font-medium',
              copied
                ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200',
            )}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied
              ? text(language, '已复制', 'Copied')
              : text(language, '复制链接', 'Copy link')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return {
    openShareDialog,
    shareDialog,
  }
}

/** 独立分享按钮（用于 /workspace 单工作区详情页头部）。 */
export function WorkspaceSessionShareMenu(props: WorkspaceSessionShareInfo) {
  const { language } = useTranslation()
  const share = useWorkspaceSessionShare(props)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={share.openShareDialog}
        className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        aria-label={text(language, '分享会话', 'Share Session')}
        title={text(language, '分享会话', 'Share Session')}
      >
        <Share2 className="h-3.5 w-3.5" />
      </Button>
      {share.shareDialog}
    </>
  )
}

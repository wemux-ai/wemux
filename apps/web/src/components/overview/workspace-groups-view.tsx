// [INPUT]: workspaceId + 概览成员/Agent 数据 + 空间内分组列表（/api/collab/workspaces/:id/groups）
// [OUTPUT]: 分组 tab：内嵌分组管理（建组/改名/删除/成员归类，复用 WorkspaceGroupManager）+ 分组 → 成员行视图（含在办/待跟进/最近动态）+ 未分组兜底
// [POS]: 组织概览「分组」tab；组织单元 = 空间内成员分组（人 + Agent 混合），组织保持平级
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Users2 } from 'lucide-react'
import type { TeamMember, WorkspaceChatAgentOption, WorkspaceGroupWithMembers } from '../../lib/api'
import { api } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import type { WorkspaceOverviewAgent, WorkspaceOverviewMember } from '../../lib/api/methods/overview'
import { WorkspaceGroupManager } from './workspace-group-manager'
import { PersonRow, type OverviewPerson } from './person-row'

type PersonSlot = { key: string; person: OverviewPerson; kind: 'member' | 'agent'; userId?: string; agentId?: string }

const rowTo = (slot: PersonSlot): { to: string; params: Record<string, string> } => (
  slot.kind === 'member'
    ? { to: '/profile/$userId', params: { userId: slot.userId ?? '' } }
    : { to: '/agent-profile/$agentId', params: { agentId: slot.agentId ?? '' } }
)

export function WorkspaceGroupsView({
  workspaceId,
  members,
  agents,
  inRange,
}: {
  workspaceId: string
  members: WorkspaceOverviewMember[]
  agents: WorkspaceOverviewAgent[]
  inRange: (iso: string) => boolean
}) {
  const { language } = useTranslation()
  const [groups, setGroups] = useState<WorkspaceGroupWithMembers[] | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [agentOptions, setAgentOptions] = useState<WorkspaceChatAgentOption[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [groupsRes, optionsRes] = await Promise.all([
        api.listWorkspaceGroups(workspaceId),
        api.getWorkspaceChatGroupOptions(workspaceId),
      ])
      setGroups(groupsRes.groups)
      setTeamMembers(optionsRes.members)
      setAgentOptions(optionsRes.agents)
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  const memberById = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members])
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.agentId, agent])), [agents])

  const slotsForGroup = (group: WorkspaceGroupWithMembers): PersonSlot[] => {
    const slots: PersonSlot[] = []
    for (const member of group.members) {
      if (member.memberType === 'user') {
        const person = memberById.get(member.memberId)
        if (person) slots.push({ key: `user:${member.memberId}`, person, kind: 'member', userId: member.memberId })
      } else {
        const person = agentById.get(member.memberId)
        if (person) slots.push({ key: `agent:${member.memberId}`, person, kind: 'agent', agentId: member.memberId })
      }
    }
    return slots
  }

  const groupedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const group of groups ?? []) {
      for (const member of group.members) keys.add(`${member.memberType}:${member.memberId}`)
    }
    return keys
  }, [groups])

  const ungroupedSlots = useMemo(() => {
    const slots: PersonSlot[] = []
    for (const member of members) {
      if (!groupedKeys.has(`user:${member.userId}`)) {
        slots.push({ key: `user:${member.userId}`, person: member, kind: 'member', userId: member.userId })
      }
    }
    for (const agent of agents) {
      if (!groupedKeys.has(`agent:${agent.agentId}`)) {
        slots.push({ key: `agent:${agent.agentId}`, person: agent, kind: 'agent', agentId: agent.agentId })
      }
    }
    return slots
  }, [members, agents, groupedKeys])

  const hasAnyMember = members.length > 0 || agents.length > 0

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载分组…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-2 py-2">
      {!hasAnyMember ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
            该组织暂无成员或 Agent 数据。
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <WorkspaceGroupManager
            workspaceId={workspaceId}
            members={teamMembers}
            agents={agentOptions}
            groups={groups ?? []}
            language={language}
            onReload={() => void load()}
          />
          {groups && groups.length > 0 && groups.map((group) => {
            const slots = slotsForGroup(group)
            return (
              <div key={group.id}>
                <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  <Users2 className="h-3 w-3 text-zinc-600" />
                  {group.name}
                  <span className="text-zinc-600">· {slots.length}</span>
                </div>
                <div>
                  {slots.length > 0 ? slots.map((slot) => (
                    <PersonRow key={slot.key} person={slot.person} kind={slot.kind} inRange={inRange} {...rowTo(slot)} />
                  )) : (
                    <div className="px-3 py-2 text-[11px] text-zinc-700">该分组暂无成员。</div>
                  )}
                </div>
              </div>
            )
          })}
          {ungroupedSlots.length > 0 && (
            <div>
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                未分组 · {ungroupedSlots.length}
              </div>
              <div>
                {ungroupedSlots.map((slot) => (
                  <PersonRow key={slot.key} person={slot.person} kind={slot.kind} inRange={inRange} {...rowTo(slot)} />
                ))}
              </div>
            </div>
          )}
          {groups && groups.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-6 text-center text-xs text-zinc-500">
              还没有分组。在上方输入分组名（如「市场营销组」「开发研发组」）创建，把成员归类后这里按组展示。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

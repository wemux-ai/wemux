/**
 * [INPUT]: Workspace group members and workspace member/Agent catalogs.
 * [OUTPUT]: Pure helpers for member labeling, search text, and query filtering used by the group settings dialog.
 * [POS]: Pure presentation helpers; no task-assignment or Squad semantics.
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */
import type { TeamMember, WorkspaceChatAgentOption, WorkspaceChatGroupMember } from '../../lib/api'
import { getAgentInitials } from './chat-route-helpers'

export type WorkspaceGroupMemberType = 'user' | 'agent'

export const memberKey = (memberType: WorkspaceGroupMemberType, memberId: string) => `${memberType}:${memberId}`

export const getMemberLabel = (
  memberType: WorkspaceGroupMemberType,
  memberId: string,
  members: readonly TeamMember[],
  agents: readonly WorkspaceChatAgentOption[],
) => {
  if (memberType === 'agent') {
    const agent = agents.find((item) => item.id === memberId)
    return {
      name: agent?.name || memberId,
      role: agent?.role || 'Agent',
      avatarUrl: agent?.avatarUrl,
      fallback: getAgentInitials(agent?.name || memberId),
    }
  }

  const member = members.find((item) => item.id === memberId)
  return {
    name: member?.name || memberId,
    role: member?.role || 'Member',
    avatarUrl: member?.avatarUrl,
    fallback: getAgentInitials(member?.name || memberId),
  }
}

export const getMemberSearchText = (
  member: WorkspaceChatGroupMember,
  members: readonly TeamMember[],
  agents: readonly WorkspaceChatAgentOption[],
) => {
  const profile = getMemberLabel(member.memberType, member.memberId, members, agents)
  const email = member.memberType === 'user'
    ? members.find((item) => item.id === member.memberId)?.email || ''
    : ''
  return `${profile.name} ${profile.role} ${email}`.toLowerCase()
}

export const filterGroupMembersByQuery = (
  members: readonly WorkspaceChatGroupMember[],
  query: string,
  teamMembers: readonly TeamMember[],
  agents: readonly WorkspaceChatAgentOption[],
) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return members
  return members.filter((member) => getMemberSearchText(member, teamMembers, agents).includes(normalizedQuery))
}

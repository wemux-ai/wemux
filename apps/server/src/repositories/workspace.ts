import { buildDefaultWorkspaceName } from '@shared/collaboration-workspace'
import type { CollaborationWorkspace, WorkspaceRole } from '@shared/types'
import { query } from '../storage/postgres/db'
import { createTeam, getTeamById, getTeamMemberRole, getTeamMembers, getTeamProjects, getUserById, getUserTeams, type Team, type User, updateTeam } from './auth'

type WorkspaceRow = {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  owner_user_id: string
  legacy_team_id: string | null
  brain_enabled: boolean | null
  brain_agent_id: string | null
  brain_instructions: string | null
  created_at: string
  updated_at: string
}

type WorkspaceMemberRow = {
  role: WorkspaceRole
}

type WorkspaceProjectRow = {
  project_id: string
}

type WorkspaceMemberListRow = {
  user_id: string
  role: WorkspaceRole
}

const mapWorkspaceRow = (row: WorkspaceRow): CollaborationWorkspace => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  avatarUrl: row.avatar_url ?? undefined,
  ownerUserId: row.owner_user_id,
  legacyTeamId: row.legacy_team_id ?? undefined,
  brainEnabled: row.brain_enabled ?? undefined,
  brainAgentId: row.brain_agent_id ?? undefined,
  brainInstructions: row.brain_instructions ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapLegacyTeamToWorkspace = (team: Team): CollaborationWorkspace => ({
  id: team.id,
  name: team.name,
  description: team.description,
  avatarUrl: team.avatarUrl,
  ownerUserId: getTeamMembers(team.id).find((member) => member.role === 'owner')?.id || getTeamMembers(team.id)[0]?.id || '',
  legacyTeamId: team.id,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
})

const ensureDefaultWorkspaceForUser = (userId: string): CollaborationWorkspace | null => {
  const user = getUserById(userId)
  if (!user) {
    return null
  }

  const team = createTeam(buildDefaultWorkspaceName(user.name, user.email), userId)
  const updated = updateTeam(team.id, {
    description: '个人默认工作区',
    avatarUrl: user.avatarUrl,
  }) ?? team

  return mapLegacyTeamToWorkspace(updated)
}

export const resolveWorkspaceIdFromLegacyTeamId = (teamId: string) => teamId.trim()

export const listUserWorkspaces = async (userId: string): Promise<CollaborationWorkspace[]> => {
  const result = await query<WorkspaceRow>(
    `SELECT workspace.*
       FROM collab_workspaces workspace
       INNER JOIN collab_workspace_members member
         ON member.workspace_id = workspace.id
      WHERE member.user_id = $1
      ORDER BY workspace.updated_at DESC`,
    [userId],
  )

  const merged = new Map<string, CollaborationWorkspace>()
  for (const row of result.rows) {
    const workspace = mapWorkspaceRow(row)
    merged.set(workspace.id, workspace)
  }

  for (const team of getUserTeams(userId)) {
    if (!merged.has(team.id)) {
      merged.set(team.id, mapLegacyTeamToWorkspace(team))
    }
  }

  const ownedWorkspaceCount = [...merged.values()].filter((workspace) => workspace.ownerUserId === userId).length
  if (ownedWorkspaceCount === 0) {
    const defaultWorkspace = ensureDefaultWorkspaceForUser(userId)
    if (defaultWorkspace) {
      merged.set(defaultWorkspace.id, defaultWorkspace)
    }
  }

  const workspaceIds = [...merged.keys()]
  if (workspaceIds.length > 0) {
    const executorResult = await query<{ workspace_id: string; executor_node_id: string }>(
      `SELECT DISTINCT ON (workspace_id) workspace_id, executor_node_id
         FROM workspace_sessions
        WHERE workspace_id = ANY($1)
          AND executor_node_id IS NOT NULL
          AND executor_node_id != ''
          AND status = 'active'
        ORDER BY workspace_id, updated_at DESC`,
      [workspaceIds],
    )
    for (const row of executorResult.rows) {
      const workspace = merged.get(row.workspace_id)
      if (workspace) {
        workspace.activeExecutorNodeId = row.executor_node_id
      }
    }
  }

  return [...merged.values()]
}

export const listOwnedUserWorkspaces = async (userId: string): Promise<CollaborationWorkspace[]> => {
  return (await listUserWorkspaces(userId)).filter((workspace) => workspace.ownerUserId === userId)
}

export const getWorkspaceById = async (workspaceId: string): Promise<CollaborationWorkspace | null> => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) {
    return null
  }

  const result = await query<WorkspaceRow>(
    `SELECT id, name, description, avatar_url, owner_user_id, legacy_team_id,
            brain_enabled, brain_agent_id, brain_instructions, created_at, updated_at
       FROM collab_workspaces
      WHERE id = $1`,
    [normalizedWorkspaceId],
  )

  if (result.rowCount && result.rows[0]) {
    return mapWorkspaceRow(result.rows[0])
  }

  const team = getTeamById(normalizedWorkspaceId)
  return team ? mapLegacyTeamToWorkspace(team) : null
}

export const getWorkspaceMemberRole = async (workspaceId: string, userId: string): Promise<WorkspaceRole | null> => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId || !userId.trim()) {
    return null
  }

  const result = await query<WorkspaceMemberRow>(
    `SELECT role
       FROM collab_workspace_members
      WHERE workspace_id = $1
        AND user_id = $2`,
    [normalizedWorkspaceId, userId],
  )

  if (result.rowCount && result.rows[0]) {
    return result.rows[0].role
  }

  return getTeamMemberRole(normalizedWorkspaceId, userId)
}

export const isWorkspaceMember = async (workspaceId: string, userId: string) => {
  return (await getWorkspaceMemberRole(workspaceId, userId)) !== null
}

/** 两人是否有共同协作组织（画像/工作记录隔离判定：team 可见性的边界） */
export const haveSharedWorkspace = async (userA: string, userB: string): Promise<boolean> => {
  if (!userA.trim() || !userB.trim()) return false
  if (userA === userB) return true
  const result = await query<{ workspace_id: string }>(
    `SELECT a.workspace_id
       FROM collab_workspace_members a
       JOIN collab_workspace_members b
         ON b.workspace_id = a.workspace_id
      WHERE a.user_id = $1 AND b.user_id = $2
      LIMIT 1`,
    [userA, userB],
  )
  return (result.rowCount ?? 0) > 0
}

/** 返回双方可用的一个共同协作空间，用于未携带 workspaceId 的旧连接入口兼容。 */
export const findSharedWorkspaceId = async (userA: string, userB: string): Promise<string | null> => {
  if (!userA.trim() || !userB.trim()) return null
  const result = await query<{ workspace_id: string }>(
    `SELECT a.workspace_id
       FROM collab_workspace_members a
       JOIN collab_workspace_members b
         ON b.workspace_id = a.workspace_id
      WHERE a.user_id = $1 AND b.user_id = $2
      ORDER BY a.workspace_id
      LIMIT 1`,
    [userA, userB],
  )
  return result.rows[0]?.workspace_id ?? null
}

export const listWorkspaceMembers = async (workspaceId: string) => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) {
    return []
  }

  const result = await query<WorkspaceMemberListRow>(
    `SELECT user_id, role
       FROM collab_workspace_members
      WHERE workspace_id = $1`,
    [normalizedWorkspaceId],
  )

  if (result.rowCount) {
    return result.rows
      .map((row) => {
        const user = getUserById(row.user_id)
        return user ? { ...user, role: row.role } : null
      })
      .filter(Boolean)
      .sort((left, right) => left!.name.localeCompare(right!.name)) as Array<User & { role: WorkspaceRole }>
  }

  return getTeamMembers(normalizedWorkspaceId)
}

export const listWorkspaceProjects = async (workspaceId: string): Promise<Array<{ projectId: string }>> => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) {
    return []
  }

  const result = await query<WorkspaceProjectRow>(
    `SELECT project_id
       FROM collab_workspace_projects
      WHERE workspace_id = $1`,
    [normalizedWorkspaceId],
  )

  if (result.rowCount) {
    return result.rows.map((row) => ({ projectId: row.project_id }))
  }

  return getTeamProjects(normalizedWorkspaceId)
}

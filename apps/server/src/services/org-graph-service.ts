// [INPUT]: 协作组织 id（按 workspace 过滤的轻量版图谱）
// [OUTPUT]: OrgGraph 节点/边（人/Agent/项目/会话/文档 + 归属/参与/产出边）
// [POS]: 关系图谱确定性装配层；零 LLM；鉴权由路由层 isWorkspaceMember 保证；边类型与 shared OrgGraphEdge 对齐
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { and, eq, inArray } from 'drizzle-orm'
import type { OrgGraph, OrgGraphEdge, OrgGraphNode } from '@shared/types'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { agents } from '../storage/postgres/schema'
import { collabWorkspaceProjects, conversations, driveFiles, users } from '../storage/postgres/schema-core'
import { listWorkspaceMembers } from '../repositories/workspace'


export const getOrgGraph = async (workspaceId: string): Promise<OrgGraph> => {
  const members = await listWorkspaceMembers(workspaceId)
  const memberIds = members.map((member) => member.id)
  const nodes: OrgGraphNode[] = []
  const edges: OrgGraphEdge[] = []
  const nodeKeys = new Set<string>()

  const addNode = (node: OrgGraphNode) => {
    const key = `${node.type}:${node.id}`
    if (nodeKeys.has(key)) return
    nodeKeys.add(key)
    nodes.push(node)
  }
  const addEdge = (source: string, target: string, type: OrgGraphEdge['type']) => {
    edges.push({ source, target, type })
  }

  // 批量获取用户头像
  const userRows = memberIds.length > 0
    ? await getDrizzleDb()
        .select({ id: users.id, avatar_url: users.avatarUrl })
        .from(users)
        .where(inArray(users.id, memberIds))
    : []
  const userAvatarMap = new Map(userRows.map((u) => [u.id, u.avatar_url]))

  for (const member of members) {
    const avatarUrl = userAvatarMap.get(member.id)
    addNode({
      id: `user:${member.id}`,
      type: 'user',
      label: member.name,
      metadata: { avatarUrl: avatarUrl ?? null },
    })
  }

  // Agent（owner 是成员）
  if (memberIds.length > 0) {
    const agentRows = await getDrizzleDb()
      .select({ id: agents.id, name: agents.name, owner_user_id: agents.ownerUserId, config_json: agents.configJson })
      .from(agents)
      .where(inArray(agents.ownerUserId, memberIds))
    for (const agent of agentRows) {
      const avatarUrl = (agent.config_json as any)?.avatarUrl ?? null
      addNode({
        id: `agent:${agent.id}`,
        type: 'agent',
        label: agent.name,
        metadata: { avatarUrl },
      })
      if (agent.owner_user_id) addEdge(`agent:${agent.id}`, `user:${agent.owner_user_id}`, 'owner')
    }
  }

  // 项目（成员归属）
  const projectRows = await getDrizzleDb()
    .select({ project_id: collabWorkspaceProjects.projectId })
    .from(collabWorkspaceProjects)
    .where(eq(collabWorkspaceProjects.workspaceId, workspaceId))
  for (const project of projectRows) {
    addNode({ id: `project:${project.project_id}`, type: 'project', label: project.project_id })
    for (const member of members) addEdge(`user:${member.id}`, `project:${project.project_id}`, 'member')
  }

  // 会话（members 参与）
  const convRows = await getDrizzleDb()
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(eq(conversations.workspaceId, workspaceId))
  for (const conv of convRows) {
    addNode({ id: `conversation:${conv.id}`, type: 'conversation', label: conv.title || '(未命名会话)' })
  }

  // 文档（createdBy 成员 → produces）
  const fileRows = await getDrizzleDb()
    .select({ id: driveFiles.id, name: driveFiles.name, created_by: driveFiles.createdBy })
    .from(driveFiles)
    .where(and(eq(driveFiles.workspaceId, workspaceId), eq(driveFiles.fileType, 'file')))
  for (const file of fileRows) {
    addNode({ id: `drive_file:${file.id}`, type: 'drive_file', label: file.name })
    if (file.created_by) addEdge(`drive_file:${file.id}`, `user:${file.created_by}`, 'produces')
  }

  return { workspaceId, nodes, edges }
}

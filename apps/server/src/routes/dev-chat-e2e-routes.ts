// [INPUT]: 已鉴权 Hono app（dev 环境）
// [OUTPUT]: dev 聊天 E2E 辅助路由：POST /api/dev/seed-chat-e2e、POST /api/dev/chat-send、POST /api/dev/reset-chat-e2e
// [POS]: 测试设施（dev-only）；seed 幂等建数据，chat-send 以 Agent 身份走真实 service 全链路，reset 清数据
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md 与 docs/TESTING-STRATEGY.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { isDevLoginEnabled } from '../services/dev-auth-service'
import { seedChatE2EData } from '../services/dev-chat-seed-service'
import { sendAgentChatMessage } from '../services/chat-send-service'
import { getUserIdFromHeader, jsonError } from './shared'
import { listUserWorkspaces } from '../repositories/workspace'
import { listWorkspaceGroupConversations } from '../storage/postgres/conversation-store'
import { deleteWorkspaceGroup } from '../control-plane/conversation-service'
import { getUserAgents, deleteAgent } from '../storage/postgres/agent-store'

export const registerDevChatE2ERoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const devOnly = (c: Parameters<MiddlewareHandler>[0], next: () => Promise<void>) => {
    if (!isDevLoginEnabled()) {
      return c.json({ message: '开发测试设施未启用。' }, 404)
    }
    return next()
  }

  // 幂等创建聊天 E2E 测试数据（dev 环境）。
  app.post('/api/dev/seed-chat-e2e', requireAuth, devOnly, async (c) => {
    const data = await seedChatE2EData()
    return c.json({ ok: true, ...data })
  })

  // 重置聊天 E2E seed 数据（dev-only）：删群/Agent，保证重新 seed 后数据干净（防测试间污染）。
  app.post('/api/dev/reset-chat-e2e', requireAuth, devOnly, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaces = await listUserWorkspaces(userId)
    const team = workspaces.find((w) => w.name === 'E2E 聊天组织')
    let groupsDeleted = 0
    let agentsDeleted = 0
    if (team) {
      const groups = await listWorkspaceGroupConversations(team.id)
      for (const g of groups) {
        if (g.title === 'E2E 发布群' || g.title === 'E2E 独立群') {
          deleteWorkspaceGroup(team.id, g.id)
          groupsDeleted += 1
        }
      }
    }
    for (const a of getUserAgents(userId)) {
      if (a.name === 'E2E Agent X' || a.name === 'E2E Agent Y') {
        deleteAgent(a.id)
        agentsDeleted += 1
      }
    }
    return c.json({ ok: true, groupsDeleted, agentsDeleted, message: '聊天 E2E 数据已重置，重新 seed 即可。' })
  })

  // 以 Agent 身份发消息，走真实 service 全链路。
  app.post('/api/dev/chat-send', requireAuth, devOnly, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      agentId: z.string().trim().min(1),
      target: z.enum(['group', 'user', 'agent']),
      workspaceId: z.string().trim().optional(),
      groupId: z.string().trim().optional(),
      sessionId: z.string().trim().optional(),
      userId: z.string().trim().optional(),
      targetAgentId: z.string().trim().optional(),
      message: z.string().trim().min(1).max(20000),
      attachments: z.array(z.object({
        id: z.string().optional(),
        url: z.string().min(1),
        filename: z.string().min(1),
        contentType: z.string().optional(),
        kind: z.enum(['file', 'drive']).optional(),
        driveFileId: z.string().optional(),
        driveWorkspaceId: z.string().nullable().optional(),
      })).optional(),
    }).parse(await c.req.json().catch(() => ({})))

    const result = await sendAgentChatMessage({
      userId,
      agentId: payload.agentId,
      target: payload.target,
      workspaceId: payload.workspaceId,
      groupId: payload.groupId,
      sessionId: payload.sessionId,
      targetUserId: payload.userId,
      targetAgentId: payload.targetAgentId,
      message: payload.message,
      attachments: payload.attachments?.map((attachment) => ({
        ...attachment,
        id: attachment.id?.trim() || `dev-chat-send-${crypto.randomUUID()}`,
      })),
    })
    if (!result.ok) {
      const status = (result.status === 400 || result.status === 403 || result.status === 404) ? result.status : 500
      return jsonError(c, result.message, status)
    }
    return c.json(result)
  })
}

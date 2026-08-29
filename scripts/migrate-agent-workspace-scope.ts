#!/usr/bin/env tsx
/**
 * 一次性迁移：老数据 → 组织归属
 *
 * 把 workspaceIds 为空的自定义 Agent 归属到 owner 的第一个 workspace，
 * 并把无 workspace 的 main 会话同步到 Agent 归属的 workspace。
 *
 * 用法：
 *   pnpm exec tsx scripts/migrate-agent-workspace-scope.ts          # dry-run 预览
 *   pnpm exec tsx scripts/migrate-agent-workspace-scope.ts --apply  # 写库
 *
 * 规则：
 * - owner 没有 workspace 的 Agent：跳过，保持全局（靠 UI 手动归属）。
 * - 系统 Agent（无 owner）与已归属的 Agent：不动。
 * - visibility 缺失/非法 → private。
 * - workdir 文件不迁移（旧目录保留，新执行落 agents/<workspaceId>/<agentId>）。
 *
 * 跑完后需要重启 server 让内存缓存重新加载。
 */
import pg from 'pg'

const { Client } = pg

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://vibemux:vibemux@127.0.0.1:5434/vibemux'
const apply = process.argv.includes('--apply')

const normalizeVisibility = (value: unknown) => (value === 'workspace' ? 'workspace' : 'private')

const main = async () => {
  const url = new URL(DATABASE_URL)
  const client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: url.username || undefined,
    password: url.password || undefined,
    database: url.pathname.replace(/^\//, ''),
    ssl: url.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  try {
    console.log(`模式：${apply ? '执行（--apply）' : '预览（dry-run）'}`)

    // 1. 每个 owner 的第一个 workspace（按 created_at 稳定排序）
    const ownedWorkspaces = (await client.query(
      `SELECT id, owner_user_id, name FROM workspaces WHERE owner_user_id IS NOT NULL ORDER BY created_at, id`,
    )).rows
    const firstWorkspaceByOwner = new Map<string, { id: string; name: string }>()
    for (const workspace of ownedWorkspaces) {
      if (!firstWorkspaceByOwner.has(workspace.owner_user_id)) {
        firstWorkspaceByOwner.set(workspace.owner_user_id, { id: workspace.id, name: workspace.name })
      }
    }

    // 2. 自定义 Agent 归属迁移
    const agents = (await client.query(
      `SELECT id, name, owner_user_id, config_json FROM agents WHERE type='custom'`,
    )).rows
    const agentWorkspaceMap = new Map<string, string>()
    let agentCount = 0
    for (const agent of agents) {
      const ownerUserId = agent.owner_user_id
      if (!ownerUserId) {
        console.log(`[agent 跳过] ${agent.name}：系统 Agent，保持全局`)
        continue
      }

      const configRoot = agent.config_json && typeof agent.config_json === 'object' ? agent.config_json : {}
      const customAgentConfig = configRoot.customAgent && typeof configRoot.customAgent === 'object'
        ? configRoot.customAgent
        : configRoot
      const workspaceIds = Array.isArray(customAgentConfig.workspaceIds) ? customAgentConfig.workspaceIds : []
      if (workspaceIds.length > 0) {
        console.log(`[agent 跳过] ${agent.name}：已归属 ${workspaceIds.join(', ')}`)
        continue
      }

      const defaultWorkspace = firstWorkspaceByOwner.get(ownerUserId)
      if (!defaultWorkspace) {
        console.log(`[agent 跳过] ${agent.name}：owner 无 workspace，保持全局（可在 agents 页手动归属）`)
        continue
      }

      agentCount += 1
      agentWorkspaceMap.set(agent.id, defaultWorkspace.id)
      console.log(`[agent 迁移] ${agent.name} -> ${defaultWorkspace.name} (${defaultWorkspace.id.slice(0, 8)})`)

      if (apply) {
        const nextCustomAgentConfig = {
          ...customAgentConfig,
          workspaceIds: [defaultWorkspace.id],
          visibility: normalizeVisibility(customAgentConfig.visibility),
        }
        const nextConfigRoot = configRoot.customAgent
          ? { ...configRoot, customAgent: nextCustomAgentConfig }
          : nextCustomAgentConfig
        await client.query(
          `UPDATE agents SET config_json = $1, updated_at = $2 WHERE id = $3`,
          [JSON.stringify(nextConfigRoot), new Date().toISOString(), agent.id],
        )
      }
    }

    // 3. main 会话跟随 Agent 归属
    const mainConversations = (await client.query(
      `SELECT id, title, orchestrator_agent_id FROM conversations WHERE kind = 'main' AND workspace_id IS NULL`,
    )).rows
    let conversationCount = 0
    for (const conversation of mainConversations) {
      const agentId = conversation.orchestrator_agent_id
      const targetWorkspaceId = agentId ? agentWorkspaceMap.get(agentId) : undefined
      if (!targetWorkspaceId) {
        console.log(`[会话跳过] ${conversation.title || conversation.id.slice(0, 8)}：Agent 未迁移，保持全局`)
        continue
      }

      conversationCount += 1
      console.log(`[会话迁移] ${conversation.title || conversation.id.slice(0, 8)} -> workspace ${targetWorkspaceId.slice(0, 8)}`)
      if (apply) {
        await client.query(
          `UPDATE conversations SET workspace_id = $1, updated_at = $2 WHERE id = $3`,
          [targetWorkspaceId, new Date().toISOString(), conversation.id],
        )
      }
    }

    console.log(`\n汇总：Agent ${agentCount} 个、会话 ${conversationCount} 个${apply ? ' 已迁移' : ' 待迁移（加 --apply 执行）'}`)
    if (!apply) {
      console.log('dry-run 未写库。确认无误后执行：pnpm exec tsx scripts/migrate-agent-workspace-scope.ts --apply')
    } else {
      console.log('迁移完成。请重启 server（内存缓存需要重新加载）。')
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

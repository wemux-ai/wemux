// [INPUT]: 无参数（表名白名单在模块内硬编码）
// [OUTPUT]: 社区版遥测用的本地聚合计数（users/teams/tasks/conversations/agent runs 总数）
// [POS]: reporter 侧计数 helper；白名单映射而非字符串拼接，满足 SQL 参数化红线
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { sql } from 'drizzle-orm'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'

/** 表名白名单：键即对外暴露的计数名，值是预构建的参数化查询，绝不接受外部传入表名。 */
const COUNT_QUERIES = {
  users: sql`SELECT COUNT(*)::int AS total FROM users`,
  teams: sql`SELECT COUNT(*)::int AS total FROM teams`,
  'distributed_tasks': sql`SELECT COUNT(*)::int AS total FROM distributed_tasks`,
  conversations: sql`SELECT COUNT(*)::int AS total FROM conversations`,
  'agent_task_runs': sql`SELECT COUNT(*)::int AS total FROM agent_task_runs`,
} as const

export type CommunityUsageCountKey = keyof typeof COUNT_QUERIES

export const countTableTotal = async (key: CommunityUsageCountKey): Promise<number> => {
  await ensurePostgresReady()
  const result = await getDrizzleDb().execute(COUNT_QUERIES[key])
  return Number((result.rows?.[0] as { total?: number } | undefined)?.total ?? 0)
}

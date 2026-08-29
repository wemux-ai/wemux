// [INPUT]: app_meta（installId 持久化）、本地 Postgres 计数表、环境变量开关
// [OUTPUT]: 社区版匿名使用上报（启动 45s 首报 + 每 24h 周期）；失败静默不拖垮主链路
// [POS]: 自托管实例 → wemux.ai collector 的唯一上报出口；与内部 telemetry（本地落库）严格分开
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import os from 'node:os'
import { getEnv } from '@shared/env'
import {
  COMMUNITY_USAGE_SCHEMA_VERSION,
  DEFAULT_COMMUNITY_USAGE_ENDPOINT,
  type CommunityUsageCounters,
} from '@shared/types/community-usage'
import { clusterConfig } from '../cluster/config'
import { getMeta, saveMeta } from '../storage/app-state-store'
import { countTableTotal } from '../storage/postgres/community-usage-counts'

const META_KEY = 'communityUsageReporter'
const INITIAL_DELAY_MS = 45_000
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

interface ReporterMetaState {
  installId?: string
  installedAt?: string
}

export interface CommunityUsageReportingConfig {
  enabled: boolean
  endpoint: string
}

/** 解析 reporter 配置：`WEMUX_USAGE_REPORTING_DISABLED=1/true` 关闭；endpoint 可用 env 覆盖。 */
export const resolveCommunityUsageReportingConfig = (
  env: NodeJS.ProcessEnv = process.env,
): CommunityUsageReportingConfig => {
  const rawDisabled = (env.WEMUX_USAGE_REPORTING_DISABLED ?? env.VIBEMUX_USAGE_REPORTING_DISABLED ?? '').trim().toLowerCase()
  const rawEndpoint = (env.WEMUX_USAGE_REPORTING_ENDPOINT ?? '').trim()
  return {
    enabled: rawDisabled !== '1' && rawDisabled !== 'true',
    endpoint: rawEndpoint || DEFAULT_COMMUNITY_USAGE_ENDPOINT,
  }
}

/** installId 惰性生成：首次上报时落 app_meta，此后所有实例共享同一身份。 */
export const getOrCreateCommunityInstallId = (): string => {
  const state = getMeta<ReporterMetaState>(META_KEY, {})
  if (state.installId) {
    return state.installId
  }
  const installId = crypto.randomUUID()
  saveMeta(META_KEY, { ...state, installId, installedAt: new Date().toISOString() })
  return installId
}

const buildOsLabel = (): string => `${os.platform()} ${os.arch()}`

/** 采集本地聚合计数；任何一张表失败都归零继续，不让单表故障阻断上报。 */
export const collectCommunityUsageCounters = async (): Promise<CommunityUsageCounters> => {
  const [usersTotal, teamsTotal, tasksTotal, conversationsTotal, agentRunsTotal] = await Promise.all([
    countTableTotal('users').catch(() => 0),
    countTableTotal('teams').catch(() => 0),
    countTableTotal('distributed_tasks').catch(() => 0),
    countTableTotal('conversations').catch(() => 0),
    countTableTotal('agent_task_runs').catch(() => 0),
  ])
  return { usersTotal, teamsTotal, tasksTotal, conversationsTotal, agentRunsTotal }
}

export const buildCommunityUsagePayload = async (installId: string) => ({
  schemaVersion: COMMUNITY_USAGE_SCHEMA_VERSION,
  installId,
  version: clusterConfig.version || 'unknown',
  os: buildOsLabel(),
  deploymentMode: (getEnv('WEMUX_DEPLOYMENT_MODE') ?? '').trim(),
  reportedAt: new Date().toISOString(),
  counters: await collectCommunityUsageCounters(),
})

/** 立即上报一次；返回是否成功（测试与日志用）。 */
export const reportCommunityUsageOnce = async (): Promise<boolean> => {
  const config = resolveCommunityUsageReportingConfig()
  if (!config.enabled) {
    return false
  }
  const payload = await buildCommunityUsagePayload(getOrCreateCommunityInstallId())
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn('[community-usage] collector responded', response.status)
      return false
    }
    return true
  } catch (error) {
    console.warn('[community-usage] report failed:', error instanceof Error ? error.message : error)
    return false
  }
}

let reportTimer: ReturnType<typeof setInterval> | null = null

export const startCommunityUsageReporter = () => {
  if (reportTimer) {
    return
  }
  // 延迟首报：避开启动风暴（DB 迁移、后台服务抢锁），也避免拖慢冷启动。
  setTimeout(() => {
    void reportCommunityUsageOnce()
  }, INITIAL_DELAY_MS).unref?.()
  reportTimer = setInterval(() => {
    void reportCommunityUsageOnce()
  }, REPORT_INTERVAL_MS)
  reportTimer.unref?.()
}

export const stopCommunityUsageReporter = () => {
  if (reportTimer) {
    clearInterval(reportTimer)
    reportTimer = null
  }
}

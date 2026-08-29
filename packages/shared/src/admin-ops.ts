// [INPUT]: server admin-ops 聚合数据
// [OUTPUT]: web admin 运维区（/admin/ops/*）的契约类型
// [POS]: 运维/Admin Ops 跨端共享类型：健康度 / R2 用量与文件浏览 / 备份 / 备份策略
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 数据库健康快照（含连接池与库/表大小） */
export type AdminOpsDbHealth = {
  ok: boolean
  connected: boolean
  ddl: string
  latencyMs?: number
  poolTotal?: number
  poolIdle?: number
  poolWaiting?: number
  databaseSizeBytes?: number
  tableSizes?: Array<{ table: string; sizeBytes: number }>
  /** 关键业务实体行数（n_live_tup 近似）：用户/任务/会话/工作区/消息等 */
  entityCounts?: Array<{ table: string; rows: number }>
  migrationCount?: number
  message?: string
}

/** R2 / 对象存储健康 */
export type AdminOpsStorageHealth = {
  configured: boolean
  driver: string
  bucket: string
  region: string
  ok: boolean
  message?: string
}

/** 对外接口探活结果 */
export type AdminOpsEndpointProbe = {
  name: string
  type: string
  url?: string
  ok: boolean
  latencyMs?: number
  message?: string
  checkedAt: string
}

/** server 集群节点信息（nodes 表） */
export type AdminOpsNodeInfo = {
  nodeId: string
  name: string
  region: string | null
  status: string
  lastHeartbeatAt: string | null
}

/** 执行器概要（在线/离线/mesh） */
export type AdminOpsExecutorSummary = {
  total: number
  online: number
  offline: number
  meshReady: number
}

/** /api/admin/ops/health 汇总 */
export type AdminOpsHealthDto = {
  ok: boolean
  checkedAt: string
  postgres: AdminOpsDbHealth
  r2: AdminOpsStorageHealth
  endpoints: AdminOpsEndpointProbe[]
  serverNodes: AdminOpsNodeInfo[]
  executors: AdminOpsExecutorSummary
}

/** R2 按前缀用量（目录明细） */
export type AdminOpsStoragePrefixUsage = {
  prefix: string
  sizeBytes: number
  objectCount?: number
  checkedAt: string
}

/** /api/admin/ops/storage/summary */
export type AdminOpsStorageSummaryDto = {
  totalBytes: number
  objectCount?: number
  prefixes: AdminOpsStoragePrefixUsage[]
  checkedAt: string
  source: 'local-list' | 'cloudflare-api'
}

/** R2 文件浏览条目（目录层 + 文件层） */
export type AdminOpsStorageEntry = {
  key: string
  name: string
  isDirectory: boolean
  sizeBytes?: number
  contentType?: string
  lastModified?: string
}

/** 备份策略（env 维度） */
export type AdminOpsBackupPolicy = {
  env: string
  enabled: boolean
  intervalHours: number
  retentionDays: number
  bucketPrefix: string
  updatedAt: string
}

/** 备份运行记录 */
export type AdminOpsBackupRun = {
  id: string
  env: string
  status: 'running' | 'success' | 'failed'
  startedAt: string
  finishedAt: string | null
  sizeBytes: number | null
  storageKey: string | null
  checksum: string | null
  error: string | null
  durationMs: number | null
}

/** 备份执行器状态（pg_dump 可用性） */
export type AdminOpsBackupRunnerStatus = {
  available: boolean
  pgDumpPath: string | null
  message: string
}

/** 告警通道配置（飞书 webhook / Telegram bot） */
export type AlertChannelConfig =
  | { type: 'feishu'; webhookUrl: string }
  | { type: 'telegram'; botToken: string; chatId: string }

/** 告警通道（含开关与配置） */
export type AdminOpsAlertChannel = {
  channel: 'feishu' | 'telegram'
  enabled: boolean
  configJson: AlertChannelConfig
  updatedAt: string
}

/** 告警事件（发送结果） */
export type AdminOpsAlertEvent = {
  id: string
  channel: string
  level: 'warn' | 'critical'
  title: string
  body: string | null
  status: 'sent' | 'failed'
  error: string | null
  createdAt: string
}

/** 数据库实例注册（切换目标；connectionUrl 仅服务端存储） */
export type AdminOpsDbInstance = {
  id: string
  name: string
  role: 'primary' | 'standby' | 'candidate' | 'replacement'
  syncKind: 'logical' | 'physical' | 'full'
  status: 'registered' | 'syncing' | 'ready' | 'error'
  lastHealthAt: string | null
  lagSeconds: number | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** 数据转移任务 */
export type AdminOpsTransfer = {
  id: string
  instanceId: string
  kind: 'logical' | 'physical' | 'full'
  status: 'init' | 'catchup' | 'ready' | 'failed'
  progressJson: Record<string, unknown>
  startedAt: string
  finishedAt: string | null
  error: string | null
}

/** 切换 / 回滚事件 */
export type AdminOpsSwitchEvent = {
  id: string
  kind: 'switch' | 'rollback'
  fromInstanceId: string | null
  toInstanceId: string | null
  status: 'running' | 'success' | 'failed'
  checksJson: Record<string, unknown>
  startedAt: string
  finishedAt: string | null
  error: string | null
}

/** 切换前检查清单结果 */
export type AdminOpsSwitchCheck = {
  lagZero: boolean
  schemaMatches: boolean
  rowSamplesMatch: boolean
  writable: boolean
  backupExists: boolean
  checks: Array<{ name: string; ok: boolean; detail?: string }>
}

/** 对接新库请求 */
export type AdminOpsAttachRequest = {
  name: string
  connectionUrl: string
  syncKind: 'logical' | 'physical' | 'full'
}

/** 模型网关余额快照（预警后台）。 */
export type GatewayBalanceSnapshot = {
  id: string
  providerId: string
  ok: boolean
  balanceUsd: number | null
  currency: string | null
  raw: string | null
  error: string | null
  collectedAt: string
}

/** 模型网关健康快照（连通性 + 延迟）。 */
export type GatewayHealthSnapshot = {
  id: string
  providerId: string
  modelId: string | null
  ok: boolean
  latencyMs: number | null
  error: string | null
  checkedAt: string
}

/** 网关监控状态汇总（admin 预警后台 + 用户端状态条）。 */
export type GatewayMonitorStatus = {
  providerId: string
  label: string
  health: 'green' | 'yellow' | 'red' | 'unknown'
  balanceUsd: number | null
  latencyMs: number | null
  lastCheckedOk: boolean | null
  lastCheckedAt: string | null
  lastBalanceCollectedAt: string | null
}

// ---- Admin Ops web API 方法契约（核心 gate 与 enterprise 实现共享；实现保留在 enterprise web）----

export type AdminOpsMethods = {
  getAdminOpsHealth: () => Promise<{ ok: boolean; health: AdminOpsHealthDto }>
  getAdminOpsStorageSummary: () => Promise<{ ok: boolean; summary: AdminOpsStorageSummaryDto }>
  getAdminOpsStorageList: (prefix: string) => Promise<{ ok: boolean; entries: AdminOpsStorageEntry[] }>
  /** 获取对象二进制（带 auth 头），用于预览/下载。 */
  getAdminOpsStorageBlob: (key: string, mode: 'preview' | 'download') => Promise<Blob>
  getAdminOpsBackups: (limit?: number) => Promise<{ ok: boolean; runs: AdminOpsBackupRun[]; runner: AdminOpsBackupRunnerStatus }>
  runAdminOpsBackup: () => Promise<{ ok: boolean; run: AdminOpsBackupRun }>
  getAdminOpsBackupPolicy: () => Promise<{ ok: boolean; policy: AdminOpsBackupPolicy }>
  saveAdminOpsBackupPolicy: (policy: { enabled: boolean; intervalHours: number; retentionDays: number }) => Promise<{ ok: boolean; policy: AdminOpsBackupPolicy }>
  getAdminOpsAlertsConfig: () => Promise<{ ok: boolean; channels: AdminOpsAlertChannel[] }>
  saveAdminOpsAlertsConfig: (channels: Record<string, { enabled: boolean; webhookUrl?: string; botToken?: string; chatId?: string }>) => Promise<{ ok: boolean; channels: AdminOpsAlertChannel[] }>
  testAdminOpsAlert: () => Promise<{ ok: boolean; results: Array<{ channel: string; ok: boolean; message: string }> }>
  getAdminOpsAlertEvents: (limit?: number) => Promise<{ ok: boolean; events: AdminOpsAlertEvent[] }>
  getAdminOpsDbInstances: () => Promise<{ ok: boolean; instances: AdminOpsDbInstance[] }>
  attachAdminOpsDbInstance: (request: AdminOpsAttachRequest) => Promise<{ ok: boolean; instance?: AdminOpsDbInstance; message?: string }>
  deleteAdminOpsDbInstance: (instanceId: string) => Promise<{ ok: boolean }>
  syncAdminOpsDbInstance: (instanceId: string) => Promise<{ ok: boolean; transfer?: AdminOpsTransfer; message?: string }>
  getAdminOpsDbTransfers: (instanceId: string) => Promise<{ ok: boolean; transfers: AdminOpsTransfer[] }>
  checkAdminOpsDbInstance: (instanceId: string) => Promise<{ ok: boolean; checks: AdminOpsSwitchCheck }>
  switchAdminOpsDbInstance: (instanceId: string) => Promise<{ ok: boolean; event?: AdminOpsSwitchEvent; message?: string }>
  getAdminOpsDbSwitchEvents: () => Promise<{ ok: boolean; events: AdminOpsSwitchEvent[] }>
}

// [INPUT]: Cluster, workspace, worktree, and distributed-task records.
// [OUTPUT]: Cached and durable cluster state, including workspace creator identity snapshots.
// [POS]: Server Postgres repository for worker-facing execution and workspace records.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'

import { getEnv } from '@shared/env'
import { normalizeOpenCodeExecutionConfig } from '@shared/opencode-execution-config'
import { sortWorkspacesByDisplayOrder } from '@shared/project-workspace-order'
import type {
  ClusterNode,
  DistributedTask,
  ProjectBinding,
  WorkspaceLocalWorktree,
  WorkspaceRecord,
} from '@shared/types'
import { clusterConfig } from '../../cluster/config'
import { sanitizeTaskGitIdentity } from '../../control-plane/task-git-identity'
import { coerceServerAgentType } from '../../services/server-agent'
import { ensurePostgresReady, isPostgresConfigured } from './db'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import {
  distributedTasks,
  nodeCapabilities,
  nodes,
  projectBindings,
  workspaceLocalWorktrees,
  workspaces,
} from './schema'

type DistributedCache = {
  nodes: ClusterNode[]
  projectBindings: ProjectBinding[]
  workspaces: WorkspaceRecord[]
  workspaceLocalWorktrees: WorkspaceLocalWorktree[]
  distributedTasks: DistributedTask[]
}

const cache: DistributedCache = {
  nodes: [],
  projectBindings: [],
  workspaces: [],
  workspaceLocalWorktrees: [],
  distributedTasks: [],
}

type NodeRow = typeof nodes.$inferSelect
type BindingRow = typeof projectBindings.$inferSelect
type WorkspaceRow = typeof workspaces.$inferSelect
type WorkspaceLocalWorktreeRow = typeof workspaceLocalWorktrees.$inferSelect
type DistributedTaskRow = typeof distributedTasks.$inferSelect

const mapNodeRow = (row: NodeRow, capabilities: string[]): ClusterNode => ({
  nodeId: row.id,
  name: row.name,
  url: row.url ?? undefined,
  relayUrl: row.relayUrl ?? undefined,
  status: row.status,
  capabilities,
  activeTasks: 0,
  maxConcurrentTasks: row.maxConcurrentTasks,
  region: row.region ?? undefined,
  hasProjectBinding: false,
  lastHeartbeatAt: row.lastHeartbeatAt ?? row.updatedAt,
  version: row.version ?? undefined,
})

const mapBindingRow = (row: BindingRow): ProjectBinding => ({
  projectId: row.projectId,
  nodeId: row.nodeId,
  repoUrl: row.repoUrl,
  defaultBranch: row.defaultBranch,
  pathHint: row.pathHint ?? undefined,
  mode: row.pathHint ? 'manual' : 'auto',
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapWorkspaceRow = (row: WorkspaceRow): WorkspaceRecord => ({
  id: row.id,
  projectId: row.projectId,
  createdBy: row.creatorJson ?? undefined,
  displayOrder: row.displayOrder ?? undefined,
  executorNodeId: row.executorNodeId,
  agentType: coerceServerAgentType(row.agentType),
  name: row.name,
  status: row.status,
  repoReady: row.repoReady,
  repoPath: row.repoPath ?? undefined,
  worktreeRootPath: row.worktreeRootPath ?? undefined,
  source: row.source,
  workingDirectoryMode: row.workingDirectoryMode === 'original-dir' ? 'original-dir' : 'worktree',
  autoCommitEnabled: typeof row.autoCommitEnabled === 'boolean' ? row.autoCommitEnabled : undefined,
  defaultBranch: row.defaultBranch ?? undefined,
  suggestedBaseBranch: row.suggestedBaseBranch ?? undefined,
  codeBaseBranch: row.codeBaseBranch ?? undefined,
  codeBranchName: row.codeBranchName ?? undefined,
  codeRemoteHeadSha: row.codeRemoteHeadSha ?? undefined,
  codeSyncedAt: row.codeSyncedAt ?? undefined,
  ownerUserId: row.ownerUserId ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapWorkspaceLocalWorktreeRow = (row: WorkspaceLocalWorktreeRow): WorkspaceLocalWorktree => ({
  id: row.id,
  workspaceId: row.workspaceId,
  executorNodeId: row.executorNodeId,
  codeBaseBranch: row.codeBaseBranch ?? undefined,
  codeBranchName: row.codeBranchName,
  workingDirectoryMode: row.workingDirectoryMode === 'original-dir' ? 'original-dir' : 'worktree',
  localPath: row.localPath ?? undefined,
  worktreeId: row.worktreeId ?? undefined,
  worktreeUniqueId: row.worktreeUniqueId ?? undefined,
  status: row.status === 'created' || row.status === 'cleaned' ? row.status : 'planned',
  sourceWorkspaceSessionId: row.sourceWorkspaceSessionId ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapTaskRow = (row: DistributedTaskRow): DistributedTask => ({
  id: row.id,
  originTaskId: row.originTaskId,
  originTaskRunId: row.originTaskRunId ?? undefined,
  workspaceId: row.workspaceId ?? undefined,
  workspaceSessionId: row.workspaceSessionId ?? undefined,
  workspaceBranchName: row.workspaceBranchName ?? undefined,
  projectId: row.projectId,
  rootPath: row.localPath ?? undefined,
  versionControl: row.versionControl ?? (row.repoUrl.trim() ? 'git-remote' : 'none'),
  requestedByUserId: row.requestedByUserId ?? undefined,
  requestedByAgentId: row.requestedByAgentId ?? undefined,
  sourceAgentEventId: row.sourceAgentEventId ?? undefined,
  agentType: coerceServerAgentType(row.agentType),
  executionModel: row.executionModel ?? undefined,
  mcpServers: row.mcpServersJson ?? undefined,
  runtimeSkillPackages: row.runtimeSkillPackagesJson ?? undefined,
  opencodeConfig: normalizeOpenCodeExecutionConfig(row.opencodeConfigJson, row.executionModel ?? undefined),
  runtimeEnv: row.runtimeEnvJson ?? undefined,
  workingDirectoryMode: row.workingDirectoryMode === 'original-dir' ? 'original-dir' : 'worktree',
  autoCommitEnabled: typeof row.autoCommitEnabled === 'boolean' ? row.autoCommitEnabled : undefined,
  repoUrl: row.repoUrl,
  defaultBranch: row.defaultBranch,
  baseCommit: row.baseCommit,
  description: row.description,
  commandPreset: row.commandPresetJson ?? undefined,
  status: row.status,
  priority: row.priority,
  timeoutSec: row.timeoutSec,
  originNodeId: row.originNodeId,
  executorNodeId: row.executorNodeId ?? undefined,
  returnMode: row.returnMode,
  syncBackStrategy: row.syncBackStrategy,
  gitIdentityMode: row.gitIdentityMode ?? undefined,
  publishPolicy: row.publishPolicy === 'none' || row.publishPolicy === 'push-branch' || row.publishPolicy === 'pull-request'
    ? row.publishPolicy
    : 'pull-request',
  gitAuthPreference: row.gitAuthPreference === 'github-app' || row.gitAuthPreference === 'credential'
    ? row.gitAuthPreference
    : 'project-default',
  gitIdentity: row.gitIdentityJson ?? undefined,
  idempotencyKey: row.idempotencyKey,
  workerEventSequence: row.workerEventSequence ?? undefined,
  retryCount: row.retryCount,
  leaseExpiresAt: row.leaseExpiresAt ?? undefined,
  startedAt: row.startedAt ?? undefined,
  completedAt: row.completedAt ?? undefined,
  errorMessage: row.errorMessage ?? undefined,
  result: row.resultJson
    ? {
        ...row.resultJson,
        agentSessionId: row.resultJson.agentSessionId ?? row.resultJson.opencodeSessionId,
        opencodeSessionId: row.resultJson.opencodeSessionId ?? row.resultJson.agentSessionId,
      }
    : undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const ensureCurrentNodeCached = () => {
  const existing = cache.nodes.find((node) => node.nodeId === clusterConfig.nodeId)
  if (existing) {
    existing.name = clusterConfig.nodeName
    existing.url = clusterConfig.nodeUrl || undefined
    existing.relayUrl = clusterConfig.nodeRelayUrl || clusterConfig.nodeUrl || undefined
    existing.status = 'online'
    existing.maxConcurrentTasks = clusterConfig.maxConcurrentTasks
    existing.region = clusterConfig.region || undefined
    existing.lastHeartbeatAt = new Date().toISOString()
    existing.version = clusterConfig.version
    return
  }

  cache.nodes.unshift({
    nodeId: clusterConfig.nodeId,
    name: clusterConfig.nodeName,
    url: clusterConfig.nodeUrl || undefined,
    relayUrl: clusterConfig.nodeRelayUrl || clusterConfig.nodeUrl || undefined,
    status: 'online',
    capabilities: clusterConfig.capabilities,
    activeTasks: 0,
    maxConcurrentTasks: clusterConfig.maxConcurrentTasks,
    region: clusterConfig.region || undefined,
    hasProjectBinding: false,
    lastHeartbeatAt: new Date().toISOString(),
    version: clusterConfig.version,
  })
}

const persistNode = async (node: ClusterNode) => {
  const now = new Date().toISOString()
  await withDrizzleTransaction(async (tx) => {
    await tx
      .insert(nodes)
      .values({
        id: node.nodeId,
        name: node.name,
        url: node.url ?? null,
        relayUrl: node.relayUrl ?? node.url ?? null,
        status: node.status,
        version: node.version ?? null,
        region: node.region ?? null,
        maxConcurrentTasks: node.maxConcurrentTasks,
        lastHeartbeatAt: node.lastHeartbeatAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: nodes.id,
        set: {
          name: node.name,
          url: node.url ?? null,
          relayUrl: node.relayUrl ?? node.url ?? null,
          status: node.status,
          version: node.version ?? null,
          region: node.region ?? null,
          maxConcurrentTasks: node.maxConcurrentTasks,
          lastHeartbeatAt: node.lastHeartbeatAt,
          updatedAt: now,
        },
      })

    // capabilities 只做差异更新：全删全插每次都会触发 storage_change 的
    // DELETE+INSERT 事件（nodes 高频写放大循环的一部分），先读现有再增删。
    const existingRows = await tx
      .select({ capability: nodeCapabilities.capability })
      .from(nodeCapabilities)
      .where(eq(nodeCapabilities.nodeId, node.nodeId))
    const existingCapabilities = new Set(existingRows.map((row) => row.capability))
    const desiredCapabilities = new Set(node.capabilities)
    const toInsert = node.capabilities.filter((capability) => !existingCapabilities.has(capability))
    const toDelete = existingRows
      .map((row) => row.capability)
      .filter((capability) => !desiredCapabilities.has(capability))

    if (toDelete.length > 0) {
      await tx
        .delete(nodeCapabilities)
        .where(
          and(
            eq(nodeCapabilities.nodeId, node.nodeId),
            inArray(nodeCapabilities.capability, toDelete),
          ),
        )
    }

    if (toInsert.length > 0) {
      await tx.insert(nodeCapabilities).values(
        toInsert.map((capability) => ({
          nodeId: node.nodeId,
          capability,
        })),
      ).onConflictDoNothing()
    }
  })
}

const persistBinding = async (binding: ProjectBinding) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(projectBindings)
    .values({
      projectId: binding.projectId,
      nodeId: binding.nodeId,
      repoUrl: binding.repoUrl,
      defaultBranch: binding.defaultBranch,
      pathHint: binding.pathHint ?? null,
      isActive: binding.isActive,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    })
    .onConflictDoUpdate({
      target: [projectBindings.projectId, projectBindings.nodeId],
      setWhere: sql`${projectBindings.updatedAt} <= excluded.updated_at`,
      set: {
        repoUrl: binding.repoUrl,
        defaultBranch: binding.defaultBranch,
        pathHint: binding.pathHint ?? null,
        isActive: binding.isActive,
        updatedAt: binding.updatedAt,
      },
    })
}

const persistWorkspace = async (workspace: WorkspaceRecord) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(workspaces)
    .values({
      id: workspace.id,
      projectId: workspace.projectId,
      creatorJson: workspace.createdBy ?? null,
      displayOrder: workspace.displayOrder ?? null,
      executorNodeId: workspace.executorNodeId,
      agentType: workspace.agentType,
      name: workspace.name,
      status: workspace.status,
      repoReady: workspace.repoReady,
      repoPath: workspace.repoPath ?? null,
      worktreeRootPath: workspace.worktreeRootPath ?? null,
      source: workspace.source,
      workingDirectoryMode: workspace.workingDirectoryMode,
      autoCommitEnabled: workspace.autoCommitEnabled ?? null,
      defaultBranch: workspace.defaultBranch ?? null,
      suggestedBaseBranch: workspace.suggestedBaseBranch ?? null,
      codeBaseBranch: workspace.codeBaseBranch ?? null,
      codeBranchName: workspace.codeBranchName ?? null,
      codeRemoteHeadSha: workspace.codeRemoteHeadSha ?? null,
      codeSyncedAt: workspace.codeSyncedAt ?? null,
      ownerUserId: workspace.ownerUserId ?? null,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })
    .onConflictDoUpdate({
      target: workspaces.id,
      setWhere: sql`${workspaces.updatedAt} <= excluded.updated_at`,
      set: {
        displayOrder: workspace.displayOrder ?? null,
        creatorJson: workspace.createdBy ?? null,
        executorNodeId: workspace.executorNodeId,
        agentType: workspace.agentType,
        name: workspace.name,
        status: workspace.status,
        repoReady: workspace.repoReady,
        repoPath: workspace.repoPath ?? null,
        worktreeRootPath: workspace.worktreeRootPath ?? null,
        source: workspace.source,
        workingDirectoryMode: workspace.workingDirectoryMode,
        autoCommitEnabled: workspace.autoCommitEnabled ?? null,
        defaultBranch: workspace.defaultBranch ?? null,
        suggestedBaseBranch: workspace.suggestedBaseBranch ?? null,
        codeBaseBranch: workspace.codeBaseBranch ?? null,
        codeBranchName: workspace.codeBranchName ?? null,
        codeRemoteHeadSha: workspace.codeRemoteHeadSha ?? null,
        codeSyncedAt: workspace.codeSyncedAt ?? null,
        ownerUserId: workspace.ownerUserId ?? null,
        updatedAt: workspace.updatedAt,
      },
    })
}

const persistWorkspaceLocalWorktree = async (record: WorkspaceLocalWorktree) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(workspaceLocalWorktrees)
    .values({
      id: record.id,
      workspaceId: record.workspaceId,
      executorNodeId: record.executorNodeId,
      codeBaseBranch: record.codeBaseBranch ?? null,
      codeBranchName: record.codeBranchName,
      workingDirectoryMode: record.workingDirectoryMode,
      localPath: record.localPath ?? null,
      worktreeId: record.worktreeId ?? null,
      worktreeUniqueId: record.worktreeUniqueId ?? null,
      status: record.status,
      sourceWorkspaceSessionId: record.sourceWorkspaceSessionId ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })
    .onConflictDoUpdate({
      target: [workspaceLocalWorktrees.workspaceId, workspaceLocalWorktrees.executorNodeId],
      setWhere: sql`${workspaceLocalWorktrees.updatedAt} <= excluded.updated_at`,
      set: {
        id: record.id,
        codeBaseBranch: record.codeBaseBranch ?? null,
        codeBranchName: record.codeBranchName,
        workingDirectoryMode: record.workingDirectoryMode,
        localPath: record.localPath ?? null,
        worktreeId: record.worktreeId ?? null,
        worktreeUniqueId: record.worktreeUniqueId ?? null,
        status: record.status,
        sourceWorkspaceSessionId: record.sourceWorkspaceSessionId ?? null,
        updatedAt: record.updatedAt,
      },
    })
}

const scheduleWorkspaceLocalWorktreePersistence = (label: string, action: () => Promise<unknown>) => {
  if (!isPostgresConfigured()) {
    return
  }

  schedulePersistence(label, action())
}

const persistDistributedTask = async (task: DistributedTask) => {
  const resultJson = task.result
    ? {
        ...task.result,
        agentSessionId: task.result.agentSessionId ?? task.result.opencodeSessionId,
        opencodeSessionId: task.result.opencodeSessionId ?? task.result.agentSessionId,
      }
    : null

  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(distributedTasks)
    .values({
      id: task.id,
      originTaskId: task.originTaskId,
      originTaskRunId: task.originTaskRunId ?? null,
      workspaceId: task.workspaceId ?? null,
      workspaceSessionId: task.workspaceSessionId ?? null,
      workspaceBranchName: task.workspaceBranchName ?? null,
      projectId: task.projectId,
      localPath: task.rootPath ?? null,
      versionControl: task.versionControl ?? (task.repoUrl.trim() ? 'git-remote' : 'none'),
      requestedByUserId: task.requestedByUserId ?? null,
      requestedByAgentId: task.requestedByAgentId ?? null,
      sourceAgentEventId: task.sourceAgentEventId ?? null,
      agentType: task.agentType,
      executionModel: task.executionModel ?? null,
      mcpServersJson: task.mcpServers ?? null,
      runtimeSkillPackagesJson: task.runtimeSkillPackages ?? null,
      opencodeConfigJson: task.opencodeConfig ?? null,
      runtimeEnvJson: task.runtimeEnv ?? null,
      workingDirectoryMode: task.workingDirectoryMode ?? 'worktree',
      autoCommitEnabled: task.autoCommitEnabled ?? null,
      repoUrl: task.repoUrl,
      defaultBranch: task.defaultBranch,
      baseCommit: task.baseCommit,
      description: task.description,
      commandPresetJson: task.commandPreset ?? null,
      status: task.status,
      priority: task.priority,
      timeoutSec: task.timeoutSec,
      originNodeId: task.originNodeId,
      executorNodeId: task.executorNodeId ?? null,
      returnMode: task.returnMode,
      syncBackStrategy: task.syncBackStrategy,
      gitIdentityMode: task.gitIdentityMode ?? null,
      publishPolicy: task.publishPolicy ?? 'pull-request',
      gitAuthPreference: task.gitAuthPreference ?? 'project-default',
      gitIdentityJson: task.gitIdentity ?? null,
      idempotencyKey: task.idempotencyKey,
      workerEventSequence: task.workerEventSequence ?? null,
      retryCount: task.retryCount,
      leaseExpiresAt: task.leaseExpiresAt ?? null,
      startedAt: task.startedAt ?? null,
      completedAt: task.completedAt ?? null,
      errorMessage: task.errorMessage ?? null,
      resultJson,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    .onConflictDoUpdate({
      target: distributedTasks.id,
      setWhere: sql`${distributedTasks.updatedAt} <= excluded.updated_at`,
      set: {
        originTaskRunId: task.originTaskRunId ?? null,
        workspaceId: task.workspaceId ?? null,
        workspaceSessionId: task.workspaceSessionId ?? null,
        workspaceBranchName: task.workspaceBranchName ?? null,
        localPath: task.rootPath ?? null,
        versionControl: task.versionControl ?? (task.repoUrl.trim() ? 'git-remote' : 'none'),
        requestedByUserId: task.requestedByUserId ?? null,
        requestedByAgentId: task.requestedByAgentId ?? null,
        sourceAgentEventId: task.sourceAgentEventId ?? null,
        agentType: task.agentType,
        executionModel: task.executionModel ?? null,
        mcpServersJson: task.mcpServers ?? null,
        runtimeSkillPackagesJson: task.runtimeSkillPackages ?? null,
        opencodeConfigJson: task.opencodeConfig ?? null,
        runtimeEnvJson: task.runtimeEnv ?? null,
        workingDirectoryMode: task.workingDirectoryMode ?? 'worktree',
        autoCommitEnabled: task.autoCommitEnabled ?? null,
        commandPresetJson: task.commandPreset ?? null,
        status: task.status,
        executorNodeId: task.executorNodeId ?? null,
        returnMode: task.returnMode,
        syncBackStrategy: task.syncBackStrategy,
        gitIdentityMode: task.gitIdentityMode ?? null,
        publishPolicy: task.publishPolicy ?? 'pull-request',
        gitAuthPreference: task.gitAuthPreference ?? 'project-default',
        gitIdentityJson: task.gitIdentity ?? null,
        idempotencyKey: task.idempotencyKey,
        workerEventSequence: task.workerEventSequence ?? null,
        retryCount: task.retryCount,
        leaseExpiresAt: task.leaseExpiresAt ?? null,
        startedAt: task.startedAt ?? null,
        completedAt: task.completedAt ?? null,
        errorMessage: task.errorMessage ?? null,
        resultJson,
        updatedAt: task.updatedAt,
      },
    })
}

export const refreshDistributedTaskStore = async () => {
  await ensurePostgresReady()
  const [
    nodeRows,
    capabilityRows,
    bindingRows,
    workspaceRows,
    workspaceLocalWorktreeRows,
    taskRows,
  ] = await Promise.all([
    getDrizzleDb().select().from(nodes).orderBy(desc(nodes.updatedAt)),
    getDrizzleDb().select().from(nodeCapabilities),
    getDrizzleDb()
      .select()
      .from(projectBindings)
      .where(eq(projectBindings.isActive, true))
      .orderBy(desc(projectBindings.updatedAt)),
    getDrizzleDb()
      .select()
      .from(workspaces)
      .orderBy(sql`${workspaces.displayOrder} ASC NULLS LAST`, desc(workspaces.updatedAt)),
    getDrizzleDb().select().from(workspaceLocalWorktrees).orderBy(desc(workspaceLocalWorktrees.updatedAt)),
    getDrizzleDb().select().from(distributedTasks).orderBy(desc(distributedTasks.updatedAt)),
  ])

  const capabilitiesByNode = new Map<string, string[]>()
  for (const row of capabilityRows) {
    capabilitiesByNode.set(row.nodeId, [...(capabilitiesByNode.get(row.nodeId) ?? []), row.capability])
  }

  cache.nodes = nodeRows.map((row) => mapNodeRow(row, capabilitiesByNode.get(row.id) ?? []))
  cache.projectBindings = bindingRows.map(mapBindingRow)
  cache.workspaces = sortWorkspacesByDisplayOrder(workspaceRows.map(mapWorkspaceRow))
  cache.workspaceLocalWorktrees = workspaceLocalWorktreeRows.map(mapWorkspaceLocalWorktreeRow)
  cache.distributedTasks = taskRows.map(mapTaskRow)
}

export const initDistributedTaskStore = async () => {
  await refreshDistributedTaskStore()
  ensureCurrentNodeCached()
  ensureCurrentNodeRecord()
}

export const ensureCurrentNodeRecord = () => {
  ensureCurrentNodeCached()
  const node = cache.nodes.find((item) => item.nodeId === clusterConfig.nodeId)
  if (!node) {
    return
  }

  // liveness 循环每 15s 调用一次，但节点心跳窗口是 120s：
  // 不需要每次循环都无条件写 nodes + 全删全插 node_capabilities。
  // 节流到 30s 一次即可保持节点在线状态新鲜，同时砍掉一半
  // storage_change 写入（nodes/capabilities 每 15s 一轮的来源）。
  const now = Date.now()
  if (now - lastCurrentNodePersistAt < NODE_PERSIST_THROTTLE_MS) {
    return
  }
  lastCurrentNodePersistAt = now
  schedulePersistence('ensure-current-node', persistNode(node))
}

export const listNodes = (): ClusterNode[] => {
  ensureCurrentNodeCached()
  const bindingCounts = new Map<string, number>()
  for (const binding of cache.projectBindings.filter((item) => item.isActive)) {
    bindingCounts.set(binding.nodeId, (bindingCounts.get(binding.nodeId) ?? 0) + 1)
  }

  const activeTaskCounts = new Map<string, number>()
  for (const task of cache.distributedTasks) {
    if (!task.executorNodeId) {
      continue
    }
    if (['assigned', 'preparing', 'executing', 'syncing_back'].includes(task.status)) {
      activeTaskCounts.set(task.executorNodeId, (activeTaskCounts.get(task.executorNodeId) ?? 0) + 1)
    }
  }

  return cloneJson(cache.nodes).map((node) => ({
    ...node,
    activeTasks: activeTaskCounts.get(node.nodeId) ?? 0,
    hasProjectBinding: Boolean(bindingCounts.get(node.nodeId)),
  }))
}

// 集群节点心跳窗口：每个节点每 15s 持久化一次自身心跳，存活节点的心跳不会超过该窗口。
// 生产默认 120s；E2E/故障演练可经 WEMUX_CLUSTER_NODE_STALE_TIMEOUT_MS 缩短以加速验证。
export const CLUSTER_NODE_STALE_TIMEOUT_MS = Number(getEnv('WEMUX_CLUSTER_NODE_STALE_TIMEOUT_MS') || 120_000)

// 本节点心跳落库节流：liveness 循环 15s 一次，120s 心跳窗口内
// 30s 落库一次即可维持节点在线状态，避免每轮循环无条件写库。
const NODE_PERSIST_THROTTLE_MS = 30_000
let lastCurrentNodePersistAt = 0

export const getNode = (nodeId: string) => cloneJson(cache.nodes.find((node) => node.nodeId === nodeId) ?? null)

export const getNodeFresh = async (nodeId: string) => {
  await ensurePostgresReady()
  const [nodeRows, capabilityRows] = await Promise.all([
    getDrizzleDb().select().from(nodes).where(eq(nodes.id, nodeId)).limit(1),
    getDrizzleDb()
      .select({ capability: nodeCapabilities.capability })
      .from(nodeCapabilities)
      .where(eq(nodeCapabilities.nodeId, nodeId)),
  ])
  const row = nodeRows[0]
  if (!row) {
    return null
  }

  const nextNode = mapNodeRow(row, capabilityRows.map((item) => item.capability))
  const index = cache.nodes.findIndex((item) => item.nodeId === nodeId)
  if (index >= 0) {
    cache.nodes[index] = nextNode
  } else {
    cache.nodes.unshift(nextNode)
  }

  return cloneJson(nextNode)
}

// 单语句幂等 reaper：把心跳过期的在线节点标记 offline。
// 每个节点每 15s 各执行一次，条件 UPDATE 只命中过期行，无需分布式锁；
// 命中后由语句级触发器产生 storage_change_events，各节点刷新 nodes 缓存。
// 节点恢复后会在自身心跳周期里重新 upsert 为 online。
export const markStaleClusterNodesOffline = async () => {
  if (!isPostgresConfigured()) {
    return 0
  }

  await ensurePostgresReady()
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - CLUSTER_NODE_STALE_TIMEOUT_MS).toISOString()
  const result = await getDrizzleDb().execute(sql`
    UPDATE nodes
    SET status = 'offline', updated_at = ${now}
    WHERE id <> ${clusterConfig.nodeId}
      AND status = 'online'
      AND (
        (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < ${cutoff})
        OR (last_heartbeat_at IS NULL AND updated_at < ${cutoff})
      )
  `)
  const changed = result.rowCount ?? 0
  if (changed > 0) {
    console.log(`[cluster-nodes] marked ${changed} stale node(s) offline`)
  }
  return changed
}

export const upsertNodePresence = (node: ClusterNode) => {
  const nextNode = cloneJson(node)
  const index = cache.nodes.findIndex((item) => item.nodeId === node.nodeId)
  if (index >= 0) {
    cache.nodes[index] = nextNode
  } else {
    cache.nodes.unshift(nextNode)
  }

  schedulePersistence(`upsert-node:${node.nodeId}`, persistNode(nextNode))
}

export const listProjectBindings = (): ProjectBinding[] => cloneJson(cache.projectBindings.filter((binding) => binding.isActive))

export const listWorkspaces = (): WorkspaceRecord[] => cloneJson(sortWorkspacesByDisplayOrder(cache.workspaces))

export const getWorkspace = (workspaceId: string): WorkspaceRecord | null => cloneJson(cache.workspaces.find((workspace) => workspace.id === workspaceId) ?? null)

export const listWorkspaceLocalWorktrees = (workspaceId?: string): WorkspaceLocalWorktree[] => {
  const normalizedWorkspaceId = workspaceId?.trim()
  return cloneJson(cache.workspaceLocalWorktrees.filter((record) => !normalizedWorkspaceId || record.workspaceId === normalizedWorkspaceId))
}

export const getWorkspaceLocalWorktree = (workspaceId: string, executorNodeId: string): WorkspaceLocalWorktree | null => {
  const normalizedWorkspaceId = workspaceId.trim()
  const normalizedExecutorNodeId = executorNodeId.trim()
  return cloneJson(cache.workspaceLocalWorktrees.find((record) => (
    record.workspaceId === normalizedWorkspaceId && record.executorNodeId === normalizedExecutorNodeId
  )) ?? null)
}

export const saveWorkspaceLocalWorktree = (record: WorkspaceLocalWorktree) => {
  const nextRecord = cloneJson(record)
  const index = cache.workspaceLocalWorktrees.findIndex((item) => (
    item.workspaceId === nextRecord.workspaceId && item.executorNodeId === nextRecord.executorNodeId
  ))
  if (index >= 0) {
    cache.workspaceLocalWorktrees[index] = nextRecord
  } else {
    cache.workspaceLocalWorktrees.unshift(nextRecord)
  }

  scheduleWorkspaceLocalWorktreePersistence(
    `save-workspace-local-worktree:${nextRecord.workspaceId}:${nextRecord.executorNodeId}`,
    () => persistWorkspaceLocalWorktree(nextRecord),
  )
  return cloneJson(nextRecord)
}

export const deleteWorkspaceLocalWorktrees = (workspaceIds?: string[]) => {
  if (!workspaceIds) {
    cache.workspaceLocalWorktrees = []
    scheduleWorkspaceLocalWorktreePersistence('delete-workspace-local-worktrees:all', async () => {
      await ensurePostgresReady()
      await getDrizzleDb().delete(workspaceLocalWorktrees)
    })
    return
  }

  const uniqueWorkspaceIds = Array.from(new Set(workspaceIds?.map((id) => id.trim()).filter(Boolean) ?? []))
  if (uniqueWorkspaceIds.length === 0) {
    return
  }

  const workspaceIdSet = new Set(uniqueWorkspaceIds)
  cache.workspaceLocalWorktrees = cache.workspaceLocalWorktrees.filter((record) => !workspaceIdSet.has(record.workspaceId))
  scheduleWorkspaceLocalWorktreePersistence(
    `delete-workspace-local-worktrees:${uniqueWorkspaceIds.join(':')}`,
    async () => {
      await ensurePostgresReady()
      await getDrizzleDb()
        .delete(workspaceLocalWorktrees)
        .where(inArray(workspaceLocalWorktrees.workspaceId, uniqueWorkspaceIds))
    },
  )
}

const updateWorkspaceCache = (workspace: WorkspaceRecord) => {
  const nextWorkspace = cloneJson(workspace)
  const index = cache.workspaces.findIndex((item) => item.id === workspace.id)
  if (index >= 0) {
    cache.workspaces[index] = nextWorkspace
  } else {
    cache.workspaces.unshift(nextWorkspace)
  }

  cache.workspaces = sortWorkspacesByDisplayOrder(cache.workspaces)

  return nextWorkspace
}

export const saveWorkspace = (workspace: WorkspaceRecord) => {
  const nextWorkspace = updateWorkspaceCache(workspace)

  schedulePersistence(`save-workspace:${workspace.id}`, persistWorkspace(nextWorkspace))
}

/**
 * Persist a workspace before returning from a lifecycle mutation.
 *
 * Workspace creation immediately creates its default session as well.  Those
 * two records must be durable before the response is used to navigate to the
 * workspace; otherwise a reload can observe the workspace without its first
 * session when the background write has not completed (or failed).
 */
export const saveWorkspaceAndWait = async (workspace: WorkspaceRecord) => {
  const nextWorkspace = cloneJson(workspace)
  await persistWorkspace(nextWorkspace)

  const currentWorkspace = cache.workspaces.find((item) => item.id === workspace.id) ?? null
  if (!currentWorkspace || currentWorkspace.updatedAt <= nextWorkspace.updatedAt) {
    updateWorkspaceCache(nextWorkspace)
  }

  return cloneJson(nextWorkspace)
}

export const deleteWorkspaces = (workspaceIds: string[]) => {
  const uniqueWorkspaceIds = Array.from(new Set(workspaceIds.filter(Boolean)))
  if (uniqueWorkspaceIds.length === 0) {
    return
  }

  const workspaceIdSet = new Set(uniqueWorkspaceIds)
  cache.workspaces = cache.workspaces.filter((workspace) => !workspaceIdSet.has(workspace.id))
  cache.workspaceLocalWorktrees = cache.workspaceLocalWorktrees.filter((record) => !workspaceIdSet.has(record.workspaceId))
  schedulePersistence(
    `delete-workspaces:${uniqueWorkspaceIds.join(':')}`,
    withDrizzleTransaction(async (tx) => {
      await tx
        .delete(workspaceLocalWorktrees)
        .where(inArray(workspaceLocalWorktrees.workspaceId, uniqueWorkspaceIds))
      await tx.delete(workspaces).where(inArray(workspaces.id, uniqueWorkspaceIds))
    }),
  )
}

export const getProjectBinding = (projectId: string, nodeId: string) => {
  return cloneJson(cache.projectBindings.find((binding) => binding.projectId === projectId && binding.nodeId === nodeId && binding.isActive) ?? null)
}

export const upsertProjectBinding = (binding: ProjectBinding) => {
  const nextBinding = cloneJson(binding)
  const index = cache.projectBindings.findIndex((item) => item.projectId === binding.projectId && item.nodeId === binding.nodeId)
  if (index >= 0) {
    cache.projectBindings[index] = nextBinding
  } else {
    cache.projectBindings.unshift(nextBinding)
  }

  schedulePersistence(`upsert-binding:${binding.projectId}:${binding.nodeId}`, persistBinding(nextBinding))
}

export const deactivateProjectBinding = (projectId: string, nodeId: string) => {
  const binding = cache.projectBindings.find((item) => item.projectId === projectId && item.nodeId === nodeId)
  if (!binding) {
    return
  }

  binding.isActive = false
  binding.updatedAt = new Date().toISOString()
  schedulePersistence(`deactivate-binding:${projectId}:${nodeId}`, persistBinding(binding))
}

export const listDistributedTasks = (): DistributedTask[] => cloneJson(cache.distributedTasks)

export const getDistributedTask = (taskId: string) => cloneJson(cache.distributedTasks.find((task) => task.id === taskId) ?? null)

const updateDistributedTaskCache = (task: DistributedTask) => {
  const index = cache.distributedTasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    cache.distributedTasks[index] = task
  } else {
    cache.distributedTasks.unshift(task)
  }
}

export const claimDistributedTaskForDispatch = async (params: {
  taskId: string
  executorId: string
  leaseExpiresAt: string
  updatedAt: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(distributedTasks)
    .set({
      executorNodeId: params.executorId,
      status: 'assigned',
      leaseExpiresAt: params.leaseExpiresAt,
      updatedAt: params.updatedAt,
    })
    .where(and(
      eq(distributedTasks.id, params.taskId),
      eq(distributedTasks.status, 'queued'),
    ))
    .returning()
  if (!rows[0]) {
    return null
  }

  const claimedTask = mapTaskRow(rows[0])
  updateDistributedTaskCache(claimedTask)
  return cloneJson(claimedTask)
}

export const reclaimExpiredDistributedTaskLeases = async (updatedAt: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(distributedTasks)
    .set({
      status: 'queued',
      leaseExpiresAt: null,
      updatedAt,
    })
    .where(and(
      inArray(distributedTasks.status, ['assigned', 'preparing']),
      lte(distributedTasks.leaseExpiresAt, updatedAt),
    ))
    .returning()

  const reclaimedTasks = rows.map(mapTaskRow)
  for (const task of reclaimedTasks) {
    updateDistributedTaskCache(task)
  }
  return cloneJson(reclaimedTasks)
}

export const listExecutorDistributedTasks = (nodeId: string): DistributedTask[] => {
  return cloneJson(cache.distributedTasks.filter((task) => task.executorNodeId === nodeId))
}

export const saveDistributedTask = (task: DistributedTask) => {
  const nextTask = cloneJson({
    ...task,
    gitIdentity: sanitizeTaskGitIdentity(task.gitIdentity),
  })
  updateDistributedTaskCache(nextTask)
  schedulePersistence(`save-distributed-task:${task.id}`, persistDistributedTask(nextTask))
}

export const saveDistributedTaskAndWait = async (task: DistributedTask) => {
  const nextTask = cloneJson({
    ...task,
    gitIdentity: sanitizeTaskGitIdentity(task.gitIdentity),
  })
  const previousTask = getDistributedTask(task.id)
  await persistDistributedTask(nextTask)

  const currentTask = getDistributedTask(nextTask.id)
  const currentSequence = currentTask?.workerEventSequence ?? 0
  const nextSequence = nextTask.workerEventSequence ?? 0
  if (
    !currentTask
    || currentSequence < nextSequence
    || (currentSequence === nextSequence && currentTask.updatedAt < nextTask.updatedAt)
    || (
      currentSequence === nextSequence
      && currentTask.updatedAt === nextTask.updatedAt
      && JSON.stringify(currentTask) === JSON.stringify(previousTask)
    )
  ) {
    updateDistributedTaskCache(nextTask)
  }

  return cloneJson(nextTask)
}

export const updateDistributedTask = (task: DistributedTask) => {
  saveDistributedTask(task)
}

export const updateDistributedTaskAndWait = (task: DistributedTask) => saveDistributedTaskAndWait(task)

export const resetClusterData = () => {
  cache.projectBindings = []
  cache.workspaces = []
  cache.workspaceLocalWorktrees = []
  cache.distributedTasks = []
  schedulePersistence(
    'reset-cluster-data',
    withDrizzleTransaction(async (tx) => {
      await tx.delete(projectBindings)
      await tx.delete(workspaceLocalWorktrees)
      await tx.delete(workspaces)
      await tx.delete(distributedTasks)
    }),
  )
  ensureCurrentNodeRecord()
}

/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 协作空间 id / 大脑配置读写请求 / 事件上下文。
 * [OUTPUT]: 工作区大脑配置（开关/Agent/行为提示词）+ 事件侧大脑定位 + 计费门控。
 * [POS]: feature 调度大脑——协作空间级配置唯一入口（高内聚）；
 *        事件监督/群聊分发/Agent prompt 只依赖本服务，不各自实现配置逻辑。
 */
import type { CollaborationWorkspace } from '@shared/types'
import { getWorkspaceById, getWorkspaceMemberRole } from '../repositories/workspace'
import { getDriveFileById, listWorkspaceBrainFiles as listWorkspaceBrainFilesFromStore, setWorkspaceBrainFile as setWorkspaceBrainFileStore, updateWorkspaceBrainFileDigest } from '../repositories/drive-store'
import { updateCollabWorkspaceBrainConfig } from '../storage/postgres/auth-store'
import { listWorkspaceGroupConversationDetails } from '../control-plane/conversation-service'
import { getCommercialGate } from './gate/commercial-gate'
import { resolveSchedulingBrainDeepSeekConfig } from './scheduling-brain/intent-classifier'
import { getMeta, saveMeta } from '../storage/app-state-store'
import { getAllAgents, getAgentTasks } from '../storage/postgres/agent-store'
import { getAgentTaskRun } from '../storage/postgres/agent-task-run-store'
import { getSessionParticipations } from './timeline-service'
import { listInboxGroups } from './inbox-service'
import { listAllDriveFiles } from '../repositories/drive-store'

export type WorkspaceBrainConfig = {
  enabled: boolean
  brainAgentId?: string
  brainInstructions?: string
}

export const DEFAULT_BRAIN_INSTRUCTIONS = [
  '你是该工作区的协作协调 Agent。你的职责：维护工作区上下文、审查事件、识别意图、把工作分发给最相关的 Agent；有主事件一律不碰。',
  '协作闭环（背后无声地主动协作）：',
  '- 群里/评论里发现需要落地的工作 → task.create 建任务（用户明确要求落地时）、task.assign 派给最相关的工作区 Agent（CTO/执行者按职责），等待结果；',
  '- 需要汇报/回复 → workspace.group_chat.send 把结论插回工作区群聊，或 task.comment.add 回复；',
  '- 简单问询/摘要 → 低成本直接处理，不要为小事唤醒大模型执行。',
  '红线：',
  '- 有负责人（人类/Agent/Squad）的任务或已被认领的会话 → 不碰，不覆盖人工指派。',
  '- 只派发给工作区内可见的 Agent 成员，绝不外派。',
  '- 不创建影子任务；不代替执行 Agent 调用 task.execute。',
  '本轮结束前用一句话给出结论：审查了什么、做了什么决定。',
].join('\n')

/** 工作区大脑是否可用：开关 + 有大脑 Agent。 */
export const resolveWorkspaceBrainAgentId = (
  workspaceId: string,
  assigneeAgentGroupId?: string,
): string | null => {
  const groups = listWorkspaceGroupConversationDetails(workspaceId)
  const groupId = assigneeAgentGroupId?.trim()
  if (groupId) {
    const group = groups.find((detail) => detail.conversation.id === groupId)
    const leader = group?.conversation.orchestratorAgentId?.trim()
    if (leader) return leader
  }
  for (const detail of groups) {
    const leader = detail.conversation.orchestratorAgentId?.trim()
    if (leader) return leader
  }
  return null
}

/** 读取工作区大脑配置（collab workspace 字段）。 */
export const getWorkspaceBrainConfig = async (workspaceId: string): Promise<WorkspaceBrainConfig | null> => {
  const workspace = await getWorkspaceById(workspaceId)
  if (!workspace) return null
  return {
    enabled: Boolean(workspace.brainEnabled),
    brainAgentId: workspace.brainAgentId?.trim() || undefined,
    brainInstructions: workspace.brainInstructions?.trim() || DEFAULT_BRAIN_INSTRUCTIONS,
  }
}

/** 保存工作区大脑配置（直接写 collab_workspaces）。 */
export const saveWorkspaceBrainConfig = async (
  workspaceId: string,
  config: { enabled?: boolean; brainAgentId?: string; brainInstructions?: string },
): Promise<boolean> => {
  return updateCollabWorkspaceBrainConfig(workspaceId, config)
}

/** 事件侧大脑定位：显式 brainAgentId 优先，否则回落群负责人；未开启或不存在返回 null。 */
export const resolveWorkspaceBrainAgentForEvent = async (
  workspaceId: string,
  assigneeAgentGroupId?: string,
): Promise<{ brainAgentId: string; instructions: string } | null> => {
  const config = await getWorkspaceBrainConfig(workspaceId)
  if (!config?.enabled) return null
  const explicitAgentId = config.brainAgentId?.trim()
  if (explicitAgentId) return { brainAgentId: explicitAgentId, instructions: config.brainInstructions ?? DEFAULT_BRAIN_INSTRUCTIONS }
  const fallbackAgentId = resolveWorkspaceBrainAgentId(workspaceId, assigneeAgentGroupId)
  if (!fallbackAgentId) return null
  return { brainAgentId: fallbackAgentId, instructions: config.brainInstructions ?? DEFAULT_BRAIN_INSTRUCTIONS }
}

/** 计费门控：workspace_brain 需要 pro（当前 enforcement 关闭时放行）。 */
export const resolveWorkspaceBrainBillingAccess = async (params: {
  userId: string
  teamId: string
}) => {
  const access = await getCommercialGate().resolveBillingFeatureAccess(params.userId, 'workspace_brain', { teamId: params.teamId })
  return {
    allowed: access.allowed,
    enforcementEnabled: access.enforcementEnabled,
    requiresPaid: access.requiresPaid,
    plan: access.plan,
    message: access.message,
  }
}

/** 工作区管理员判定（owner/admin 可改大脑配置）。 */
export const canManageWorkspaceBrain = async (workspaceId: string, userId: string): Promise<boolean> => {
  const role = await getWorkspaceMemberRole(workspaceId, userId)
  return role === 'owner' || role === 'admin'
}

/** 供 event-supervisor 读取：工作区 id 归一化（collab workspace）。 */
export type { CollaborationWorkspace }

// —— 工作区上下文管理（v3.5：大脑=上下文组织者，零模型成本闭环）——

const WORKSPACE_BRAIN_CONTEXT_META_PREFIX = 'workspace_brain_context:'
/** 池上限（滚动保留的事件条数）。 */
export const WORKSPACE_BRAIN_CONTEXT_MAX_ITEMS = 30
/** 压缩阈值：池满后触发小模型把旧条目压成摘要（P2）。 */
export const WORKSPACE_BRAIN_CONTEXT_COMPRESS_AT = 24
/** 每次保留的条目数（压掉最旧的，留最近的）。 */
export const WORKSPACE_BRAIN_CONTEXT_KEEP_AFTER_COMPRESS = 12

export type WorkspaceBrainContextItem = {
  at: string
  kind: 'group_chat' | 'event' | 'task' | 'session'
  /** 发送者名 / 事件类型 / 来源 */
  source?: string
  text: string
}

export type WorkspaceBrainContext = {
  updatedAt: string
  /** 持续摘要（P2-1：池满/心跳时小模型增量压缩） */
  summaryLines: string[]
  /** 最近讨论/事件（滚动，有上限） */
  recentItems: WorkspaceBrainContextItem[]
}

const buildWorkspaceBrainContextKey = (workspaceId: string) => `${WORKSPACE_BRAIN_CONTEXT_META_PREFIX}${workspaceId}`

export const readWorkspaceBrainContext = (workspaceId: string): WorkspaceBrainContext | null => {
  const key = buildWorkspaceBrainContextKey(workspaceId.trim())
  const value = getMeta<WorkspaceBrainContext | null>(key, null)
  return value && typeof value === 'object' ? value : null
}

/** 追加一条工作区上下文（零模型调用；旁路 void，不阻塞主流程）。 */
export const recordWorkspaceBrainContextItem = (
  workspaceId: string,
  item: Omit<WorkspaceBrainContextItem, 'at'>,
): void => {
  const key = buildWorkspaceBrainContextKey(workspaceId.trim())
  if (!workspaceId.trim()) return
  const current = readWorkspaceBrainContext(workspaceId) ?? {
    updatedAt: new Date().toISOString(),
    summaryLines: [],
    recentItems: [],
  }
  const next: WorkspaceBrainContext = {
    ...current,
    updatedAt: new Date().toISOString(),
    recentItems: [...current.recentItems, { ...item, at: new Date().toISOString() }].slice(-WORKSPACE_BRAIN_CONTEXT_MAX_ITEMS),
  }
  saveMeta(key, next)
  // P2-1：池接近上限时，异步把旧条目压成持续摘要（DeepSeek 小模型，失败静默）
  if (next.recentItems.length >= WORKSPACE_BRAIN_CONTEXT_COMPRESS_AT) {
    void compressWorkspaceBrainContext(workspaceId)
  }
}

/**
 * P2-1 增量摘要：把池里最旧的条目交给 DeepSeek 压成结论，合并进 summaryLines，并裁剪 recentItems。
 * 只在事件流积累到阈值后触发；失败静默（下次触发重试），不阻塞主流程。
 */
export const compressWorkspaceBrainContext = async (workspaceId: string): Promise<void> => {
  const context = readWorkspaceBrainContext(workspaceId)
  if (!context || context.recentItems.length < WORKSPACE_BRAIN_CONTEXT_COMPRESS_AT) return
  const { apiKey, model } = resolveSchedulingBrainDeepSeekConfig()
  if (!apiKey) return

  const compressible = context.recentItems.slice(0, context.recentItems.length - WORKSPACE_BRAIN_CONTEXT_KEEP_AFTER_COMPRESS)
  if (compressible.length === 0) return
  const newestAt = compressible[compressible.length - 1]!.at
  const inputLines = compressible.map((item) => `- [${item.at.slice(0, 16)}] ${item.kind}${item.source ? ` | ${item.source}` : ''}：${item.text.slice(0, 160)}`)
  const previousSummary = context.summaryLines.length > 0
    ? `\n历史摘要（作为背景，压缩时保持延续性）：\n${context.summaryLines.join('\n')}`
    : ''

  try {
    const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是工作区上下文整理器。把一段工作区事件流压成 3-5 条结论性要点（正在做什么/决定/约定/风险），每条不超过 80 字，中文，不要客套，不要复述细节。',
          },
          {
            role: 'user',
            content: `${previousSummary}\n待压缩事件：\n${inputLines.join('\n')}`,
          },
        ],
        temperature: 0,
        max_tokens: 400,
        stream: false,
      }),
    })
    if (!response.ok) return
    const body = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
    const digest = body?.choices?.[0]?.message?.content?.trim()
    if (!digest) return

    const nextSummary = [...context.summaryLines, ...digest.split('\n').map((line) => line.trim().replace(/^[-*•]\s*/, '')).filter(Boolean)].slice(-12)
    const next: WorkspaceBrainContext = {
      ...context,
      updatedAt: new Date().toISOString(),
      summaryLines: nextSummary,
      recentItems: context.recentItems.slice(compressible.length),
    }
    saveMeta(buildWorkspaceBrainContextKey(workspaceId.trim()), next)
  } catch {
    // 压缩失败静默，下次触发重试
  }
}

/** 构建工作区上下文快照文本（供 review payload / Agent prompt 注入）。 */
export const buildWorkspaceBrainContextSnapshot = (workspaceId: string): string => {
  const context = readWorkspaceBrainContext(workspaceId)
  if (!context) return ''
  const lines: string[] = []
  if (context.summaryLines.length > 0) {
    lines.push('--- 工作区持续摘要 ---', ...context.summaryLines)
  }
  if (context.recentItems.length > 0) {
    lines.push('--- 工作区最近讨论/事件 ---')
    for (const item of context.recentItems) {
      lines.push(`- ${item.at.slice(0, 16)} | ${item.kind}${item.source ? ` | ${item.source}` : ''} | ${truncateForContext(item.text)}`)
    }
  }
  return lines.join('\n')
}

const truncateForContext = (text: string, max = 120) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

// —— 云盘文件纳入大脑上下文（P0：设为 Wemux Brain 上下文）——

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'

/** 列出工作区大脑已纳入的云盘文件（含 digest）。 */
export const listWorkspaceBrainFiles = async (workspaceId: string) => {
  return listWorkspaceBrainFilesFromStore(workspaceId)
}

/** 纳入/移出云盘文件（仅 owner/admin）。纳入后异步整理 digest。 */
export const setWorkspaceBrainFile = async (params: {
  workspaceId: string
  fileId: string
  enabled: boolean
  userId: string
}): Promise<{ ok: boolean; message: string }> => {
  if (!(await canManageWorkspaceBrain(params.workspaceId, params.userId))) {
    return { ok: false, message: '只有组织 owner/admin 可以管理大脑上下文。' }
  }
  const file = await getDriveFileById(params.fileId)
  if (!file || file.deletedAt) {
    return { ok: false, message: '云盘文件不存在。' }
  }
  if (file.fileType === 'folder') {
    return { ok: false, message: '仅文件可纳入大脑上下文，文件夹不支持。' }
  }
  if (file.workspaceId !== params.workspaceId) {
    return { ok: false, message: '该文件不属于当前组织。' }
  }
  await setWorkspaceBrainFileStore(params.workspaceId, params.fileId, params.enabled)
  if (params.enabled) {
    void digestWorkspaceBrainFile(params.workspaceId, params.fileId)
  }
  return { ok: true, message: params.enabled ? '已纳入大脑上下文。' : '已移出大脑上下文。' }
}

/** 用 DeepSeek 小模型整理文件摘要（digest）。失败静默，digest 留空待重试。 */
export const digestWorkspaceBrainFile = async (workspaceId: string, fileId: string): Promise<void> => {
  const file = await getDriveFileById(fileId)
  if (!file) return
  const text = file.searchText?.trim()
  if (!text) return
  const { apiKey, model } = resolveSchedulingBrainDeepSeekConfig()
  if (!apiKey) return
  try {
    const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是工作区知识整理器。把文档提炼成要点摘要（约定/决策/结论/技术栈），中文，300 字内，不要客套。' },
          { role: 'user', content: text.slice(0, 8000) },
        ],
        temperature: 0,
        max_tokens: 500,
        stream: false,
      }),
    })
    if (!response.ok) return
    const body = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
    const digest = body?.choices?.[0]?.message?.content?.trim()
    if (digest) {
      await updateWorkspaceBrainFileDigest(workspaceId, fileId, digest)
    }
  } catch {
    // 整理失败静默，下次事件/心跳重试
  }
}

/**
 * P2-2 文件 digest 过期重整理：digestAt < file.updatedAt 的文件重新消化。
 * 由 review 事件/心跳触发（见 agent-event-runtime 注入前调用）；返回需要重试的项数。
 */
export const refreshStaleBrainFileDigests = async (workspaceId: string): Promise<number> => {
  const files = await listWorkspaceBrainFilesFromStore(workspaceId)
  let staleCount = 0
  for (const brainFile of files) {
    if (!brainFile.enabled) continue
    const file = await getDriveFileById(brainFile.fileId)
    if (!file || file.deletedAt) continue
    const fileUpdatedAt = file.updatedAt ? new Date(file.updatedAt).getTime() : 0
    const digestAt = brainFile.digestAt ? new Date(brainFile.digestAt).getTime() : 0
    if (fileUpdatedAt > digestAt) {
      staleCount += 1
      void digestWorkspaceBrainFile(workspaceId, brainFile.fileId)
    }
  }
  return staleCount
}

/**
 * P4 慢上下文注入：已纳入文件的 digest 摘要段（不进全文，按需检索控成本）。
 * 供 Agent 被唤醒时拼进 prompt（带 workspace 范围的事件）。
 */
export const buildBrainFileDigestContext = async (workspaceId: string, limit = 10): Promise<string> => {
  const files = await listWorkspaceBrainFilesFromStore(workspaceId)
  const enabled = files.filter((file) => file.enabled && file.digest?.trim()).slice(0, limit)
  if (enabled.length === 0) return ''
  const lines = enabled.map((file) => {
    const name = file.fileName?.trim() || file.fileId
    return `- ${name}：${(file.digest ?? '').trim().replace(/\s+/g, ' ')}`
  })
  return `--- 工作区云盘知识（已纳入大脑上下文，digest 摘要） ---\n${lines.join('\n')}`
}

// —— 大脑页面只读视图（P1：事件流 + 持续摘要 + 分发记录 + 已纳入文件）——

const BRAIN_DISPATCH_EVENT_TYPES = ['brain.event.review']

type BrainDispatchRecord = {
  id: string
  agentId: string
  agentName: string
  type: string
  status: string
  createdAt: string
  completedAt: string | null
  /** 触发来源：事件类型 + 简短描述 */
  triggerKind?: string
  sourceText?: string
  /** 会话 id（有 Agent 执行产物时） */
  sessionId?: string
}

/** 大脑分发记录：type=brain.event.review 的 Agent 任务（按 workspace scope 过滤）。 */
export const listBrainDispatchRecords = (workspaceId: string, limit = 30): BrainDispatchRecord[] => {
  const records: BrainDispatchRecord[] = []
  for (const agent of getAllAgents()) {
    for (const task of getAgentTasks(agent.id, Number.MAX_SAFE_INTEGER)) {
      if (!BRAIN_DISPATCH_EVENT_TYPES.includes(task.type)) continue
      const payload = asRecord(task.payload)
      const scope = asRecord(payload.scope)
      if (scope.workspaceId !== workspaceId) continue
      const eventPayload = asRecord(payload.payload)
      const run = getAgentTaskRun(task.id)
      records.push({
        id: task.id,
        agentId: agent.id,
        agentName: agent.name,
        type: task.type,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        triggerKind: typeof eventPayload.triggerKind === 'string' ? eventPayload.triggerKind : undefined,
        sourceText: typeof eventPayload.eventSummary === 'string'
          ? eventPayload.eventSummary
          : typeof eventPayload.comment === 'string'
            ? eventPayload.comment
            : undefined,
        sessionId: typeof task.result?.sessionId === 'string' ? task.result.sessionId : run?.conversationSessionId,
      })
    }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)

/** /brain 页面聚合：事件流 + 持续摘要 + 分发记录 + 已纳入文件。 */
export const buildWorkspaceBrainOverview = async (workspaceId: string) => {
  const context = readWorkspaceBrainContext(workspaceId)
  const config = await getWorkspaceBrainConfig(workspaceId)
  const [files, resolvedBrain] = await Promise.all([
    listWorkspaceBrainFiles(workspaceId),
    resolveWorkspaceBrainAgentForEvent(workspaceId).catch(() => null),
  ])
  return {
    enabled: Boolean(config?.enabled),
    brainAgentId: resolvedBrain?.brainAgentId ?? undefined,
    config: config
      ? {
          enabled: Boolean(config.enabled),
          brainAgentId: config.brainAgentId,
          ...(config.enabled && config.brainInstructions ? { brainInstructions: config.brainInstructions } : {}),
        }
      : null,
    context: context ?? { updatedAt: '', summaryLines: [], recentItems: [] },
    dispatchRecords: listBrainDispatchRecords(workspaceId),
    files,
  }
}

// —— 个人上下文（P3：我的云盘 + 我参与的时间线 + 我关心的待办）——

/** /brain 个人上下文聚合：个人云盘文件 + 会话参与时间线 + 待办/@ 我。 */
export const buildMyContextOverview = async (params: { userId: string; workspaceId: string }) => {
  const { userId, workspaceId } = params
  const [personalFiles, participations, inboxGroups, brainFiles] = await Promise.all([
    listAllDriveFiles({ workspaceId: null, userId }).catch(() => []),
    getSessionParticipations('user', userId, '7d').catch(() => []),
    listInboxGroups({ recipientId: userId, section: 'action', workspaceId, limit: 30 }).catch(() => ({ groups: [] })),
    listWorkspaceBrainFiles(workspaceId).catch(() => []),
  ])
  const todos = inboxGroups.groups.slice(0, 10).map((group) => ({
    id: group.groupKey,
    title: typeof group.latestItem?.title === 'string' ? group.latestItem.title : group.groupKey,
    unreadCount: group.unreadCount ?? 0,
  }))
  return {
    personalFiles: personalFiles.slice(0, 20).map((file) => ({ id: file.id, name: file.name, fileType: file.fileType, updatedAt: file.updatedAt })),
    participations,
    todos,
    brainFileCount: brainFiles.filter((file) => file.enabled).length,
  }
}

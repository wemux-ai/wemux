/**
 * [INPUT]: Main chat sessions from the app-state blob plus the previously mirrored fingerprint snapshot.
 * [OUTPUT]: Minimal thread/message upsert plans for dual-writing main chat into the relational Thread model; message fingerprints cover content, order and finish reason.
 * [POS]: Pure diff planner for the P1 dual-write bridge; performs no database or transport side effects.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { chatMessageToThreadMessage, projectPartsToPlainText, threadMessageToChatMessage } from './thread-message-codec'
import type { ChatMessageDecodeExtras } from './thread-message-codec'
import type { ThreadMessage, ThreadRuntimeState } from './thread-message'
import type { ChatMessage, MainChatSession } from './types'

/**
 * saveStateMeta 每次都带全量 state，若照搬会把「读改写整块」放大成「全量 upsert」。
 * 这里按会话与消息各自的指纹做差分，只输出真正变化的行。
 */

export type MirroredMessageFingerprint = {
  /** 覆盖流式增长：内容长度与 part 数量变化即视为需要重写。 */
  contentLength: number
  partCount: number
  createdAt: string
  /**
   * 前一条消息的 id（数组中紧邻的上一条），用于检测顺序变化。
   * 第一条消息的 previousMessageId 为 undefined。
   * 用相邻关系代替绝对下标：绝对下标在保留期裁剪后会因为内存数组重新编号
   * 而产生与 DB 中已有 seq 的冲突；相邻关系只在真正重排时才变化。
   */
  previousMessageId?: string
  /**
   * 含 finishReason，使「内容未变但收尾状态变了」也能触发重写。
   * 用户停止时最后一段增量常已落库，只有结束原因从 undefined 变成 'aborted'，
   * 不进指纹就会被差分判定为「无变化」，片段标记永远写不进关系表。
   */
  finishReason?: ChatMessage['finishReason']
}

export type MirroredSessionFingerprint = {
  updatedAt: string
  title: string
  messageCount: number
  messages: Record<string, MirroredMessageFingerprint>
}

export type ThreadMirrorSnapshot = Record<string, MirroredSessionFingerprint>

export type ThreadUpsertPlan = {
  threadId: string
  title: string
  /** 会话归属用户（R10.1）：落 conversations.createdBy。 */
  ownerUserId?: string
  customAgentId?: string
  executorId?: string
  workspaceId?: string
  executionModel?: string
  sourceChannel?: MainChatSession['sourceChannel']
  externalChatId?: string
  externalThreadId?: string
  externalConversationId?: string
  externalUserId?: string
  pinnedAt?: string
  runtime?: ThreadRuntimeState
  createdAt: string
  updatedAt: string
}

export type MessageUpsertPlan = {
  message: ThreadMessage
  /** parts 的纯文本投影，写入 messages.content 供搜索与预览。 */
  contentProjection: string
  authorName?: string
  /** 原 ChatMessage 的 externalRef（@文档 引用等），写入 messages.external_ref_json。 */
  externalRef?: Record<string, unknown>
  /** usage 与逐消息运行态：领域上属于 Run，runs 表落地前随消息落库。 */
  extras: ChatMessageDecodeExtras
  /**
   * 是否为新消息（该 message id 在上一次快照中不存在）。
   * true 时需要由数据库侧分配 seq（pg_advisory_xact_lock + MAX(seq)+1）；
   * false 时走 onConflictDoUpdate 更新内容，不重新分配 seq。
   * seq 不再从数组下标取值：下标在保留期裁剪后会因内存数组重新编号
   * 而与 DB 已有 seq 冲突，导致新消息插进历史中间或违反唯一约束。
   */
  isNew: boolean
}

export type ThreadMirrorPlan = {
  threads: ThreadUpsertPlan[]
  messages: MessageUpsertPlan[]
  deletedThreadIds: string[]
  deletedMessageIds: string[]
  snapshot: ThreadMirrorSnapshot
}

const fingerprintMessage = (
  message: ChatMessage,
  partCount: number,
  previousMessageId?: string,
): MirroredMessageFingerprint => ({
  contentLength: message.content.length,
  partCount,
  createdAt: message.createdAt,
  ...(previousMessageId === undefined ? {} : { previousMessageId }),
  ...(message.finishReason === undefined ? {} : { finishReason: message.finishReason }),
})

const isSameMessageFingerprint = (
  left: MirroredMessageFingerprint | undefined,
  right: MirroredMessageFingerprint,
) => {
  return left !== undefined
    && left.contentLength === right.contentLength
    && left.partCount === right.partCount
    && left.createdAt === right.createdAt
    && left.previousMessageId === right.previousMessageId
    && left.finishReason === right.finishReason
}

/** 运行态与续跑上下文全部为空时不写 runtime_json，保持「缺省即 undefined」的往返语义。 */
const buildThreadRuntimeState = (session: MainChatSession): ThreadRuntimeState | undefined => {
  const runtime: ThreadRuntimeState = {
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(session.agentRunningStatus === undefined ? {} : { agentRunningStatus: session.agentRunningStatus }),
    ...(session.currentStep === undefined ? {} : { currentStep: session.currentStep }),
    ...(session.runtimeSessionIds === undefined ? {} : { runtimeSessionIds: session.runtimeSessionIds }),
    ...(session.runtimeContinuations === undefined ? {} : { runtimeContinuations: session.runtimeContinuations }),
    ...(session.handoffSnapshot === undefined ? {} : { handoffSnapshot: session.handoffSnapshot }),
  }

  return Object.keys(runtime).length === 0 ? undefined : runtime
}

const buildThreadPlan = (session: MainChatSession): ThreadUpsertPlan => {
  const runtime = buildThreadRuntimeState(session)

  return {
    threadId: session.id,
    title: session.title,
    ...(session.ownerUserId === undefined ? {} : { ownerUserId: session.ownerUserId }),
    ...(session.customAgentId === undefined ? {} : { customAgentId: session.customAgentId }),
    ...(session.executorId === undefined ? {} : { executorId: session.executorId }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    ...(session.executionModel === undefined ? {} : { executionModel: session.executionModel }),
    ...(session.sourceChannel === undefined ? {} : { sourceChannel: session.sourceChannel }),
    ...(session.externalChatId === undefined ? {} : { externalChatId: session.externalChatId }),
    ...(session.externalThreadId === undefined ? {} : { externalThreadId: session.externalThreadId }),
    ...(session.externalConversationId === undefined ? {} : { externalConversationId: session.externalConversationId }),
    ...(session.externalUserId === undefined ? {} : { externalUserId: session.externalUserId }),
    ...(session.pinnedAt === undefined ? {} : { pinnedAt: session.pinnedAt }),
    ...(runtime === undefined ? {} : { runtime }),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

const isSameThreadIdentity = (
  session: MainChatSession,
  previous: MirroredSessionFingerprint,
) => {
  return previous.updatedAt === session.updatedAt
    && previous.title === session.title
    && previous.messageCount === (session.messages?.length ?? 0)
}

/**
 * 计算把主对话 blob 镜像进关系表所需的最小写入集。
 * 未加载消息的会话（messagesLoaded === false 且 messages 为空）只同步 Thread 本体，
 * 避免把「尚未拉取」误判成「已被删除」。
 */
export const planThreadMirror = (
  sessions: MainChatSession[],
  previousSnapshot: ThreadMirrorSnapshot = {},
): ThreadMirrorPlan => {
  const threads: ThreadUpsertPlan[] = []
  const messages: MessageUpsertPlan[] = []
  const deletedMessageIds: string[] = []
  const snapshot: ThreadMirrorSnapshot = {}

  for (const session of sessions) {
    const previous = previousSnapshot[session.id]
    const sessionMessages = session.messages ?? []
    const messagesUnloaded = sessionMessages.length === 0 && session.messagesLoaded === false

    if (previous === undefined || !isSameThreadIdentity(session, previous)) {
      threads.push(buildThreadPlan(session))
    }

    if (messagesUnloaded) {
      snapshot[session.id] = previous ?? {
        updatedAt: session.updatedAt,
        title: session.title,
        messageCount: sessionMessages.length,
        messages: {},
      }
      continue
    }

    const messageFingerprints: Record<string, MirroredMessageFingerprint> = {}

    /** 用于判断消息是否为"新增"（上一次快照中不存在该 id）。 */
    const previousMessageIds = new Set(Object.keys(previous?.messages ?? {}))
    /** 用于计算 previousMessageId 指纹字段。 */
    let priorId: string | undefined = undefined

    sessionMessages.forEach((chatMessage) => {
      const { message, extras } = chatMessageToThreadMessage(chatMessage, session.id)
      const fingerprint = fingerprintMessage(chatMessage, message.parts.length, priorId)
      messageFingerprints[chatMessage.id] = fingerprint

      if (!isSameMessageFingerprint(previous?.messages[chatMessage.id], fingerprint)) {
        messages.push({
          message,
          contentProjection: projectPartsToPlainText(message.parts),
          ...(chatMessage.authorName === undefined ? {} : { authorName: chatMessage.authorName }),
          ...(chatMessage.externalRef === undefined ? {} : { externalRef: chatMessage.externalRef }),
          extras,
          isNew: !previousMessageIds.has(chatMessage.id),
        })
      }

      priorId = chatMessage.id
    })

    for (const previousMessageId of Object.keys(previous?.messages ?? {})) {
      if (messageFingerprints[previousMessageId] === undefined) {
        deletedMessageIds.push(previousMessageId)
      }
    }

    snapshot[session.id] = {
      updatedAt: session.updatedAt,
      title: session.title,
      messageCount: sessionMessages.length,
      messages: messageFingerprints,
    }
  }

  const deletedThreadIds = Object.keys(previousSnapshot).filter((threadId) => snapshot[threadId] === undefined)

  return { threads, messages, deletedThreadIds, deletedMessageIds, snapshot }
}

export const isEmptyThreadMirrorPlan = (plan: ThreadMirrorPlan) => {
  return plan.threads.length === 0
    && plan.messages.length === 0
    && plan.deletedThreadIds.length === 0
    && plan.deletedMessageIds.length === 0
}

/** 关系表里一个 Thread 行的领域投影，字段与 conversations 的主对话相关列一一对应。 */
export type ThreadRow = {
  id: string
  title: string
  /** main thread 归属用户，读自 conversations.createdBy。 */
  ownerUserId?: string
  orchestratorAgentId?: string
  executorId?: string
  workspaceId?: string
  executionModel?: string
  pinnedAt?: string
  sourceChannel?: MainChatSession['sourceChannel']
  externalChatId?: string
  externalThreadId?: string
  externalConversationId?: string
  externalUserId?: string
  runtime?: ThreadRuntimeState
  createdAt: string
  updatedAt: string
}

export type ThreadMessageRowExtras = {
  usage?: ChatMessage['usage']
  agentRunningStatus?: ChatMessage['agentRunningStatus']
  currentStep?: string
  finishReason?: ChatMessage['finishReason']
  /** 线程内单调序号（P0 分配），游标分页读取更早历史的游标。 */
  seq?: number
}

/**
 * 从关系行重建 MainChatSession。
 * 目标是与 blob 逐字段等价，因此所有缺省值都还原为 undefined 而不是空串或空数组。
 */
export const buildMainChatSessionFromThread = (
  row: ThreadRow,
  threadMessages: ThreadMessage[],
  extrasByMessageId: Record<string, ThreadMessageRowExtras> = {},
): MainChatSession => {
  const messages = threadMessages.map((message) => threadMessageToChatMessage(
    message,
    extrasByMessageId[message.id] ?? {},
  ))

  return {
    id: row.id,
    title: row.title,
    ...(row.ownerUserId === undefined ? {} : { ownerUserId: row.ownerUserId }),
    ...(row.pinnedAt === undefined ? {} : { pinnedAt: row.pinnedAt }),
    ...(row.orchestratorAgentId === undefined ? {} : { customAgentId: row.orchestratorAgentId }),
    ...(row.executorId === undefined ? {} : { executorId: row.executorId }),
    ...(row.workspaceId === undefined ? {} : { workspaceId: row.workspaceId }),
    ...(row.runtime?.cwd === undefined ? {} : { cwd: row.runtime.cwd }),
    ...(row.executionModel === undefined ? {} : { executionModel: row.executionModel }),
    ...(row.runtime?.runtimeSessionIds === undefined ? {} : { runtimeSessionIds: row.runtime.runtimeSessionIds }),
    ...(row.runtime?.runtimeContinuations === undefined ? {} : { runtimeContinuations: row.runtime.runtimeContinuations }),
    ...(row.runtime?.handoffSnapshot === undefined ? {} : { handoffSnapshot: row.runtime.handoffSnapshot }),
    ...(row.sourceChannel === undefined ? {} : { sourceChannel: row.sourceChannel }),
    ...(row.externalConversationId === undefined ? {} : { externalConversationId: row.externalConversationId }),
    ...(row.externalUserId === undefined ? {} : { externalUserId: row.externalUserId }),
    ...(row.externalChatId === undefined ? {} : { externalChatId: row.externalChatId }),
    ...(row.externalThreadId === undefined ? {} : { externalThreadId: row.externalThreadId }),
    ...(row.runtime?.agentRunningStatus === undefined ? {} : { agentRunningStatus: row.runtime.agentRunningStatus }),
    ...(row.runtime?.currentStep === undefined ? {} : { currentStep: row.runtime.currentStep }),
    messages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

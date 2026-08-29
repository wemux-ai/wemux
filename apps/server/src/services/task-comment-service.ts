/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Authorized task, typed author actor, comment content/attachments, reply target, structured mentions, and historical Agent identities.
 * [OUTPUT]: Idempotent threaded comments, same-event delivery promotion, author-owned edits/soft deletion, user reactions, normalized historical authors, validated mentions, and durable Agent comment events.
 * [POS]: Shared task-comment mutation and routing used by HTTP and MCP surfaces.
 */
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { AgentRecord, Task, TaskComment, TaskCommentDispatchOutcome, TaskCommentMention } from '@shared/types'
import { listWorkspaceGroupConversationDetails } from '../control-plane/conversation-service'
import { getProjectAssignees, getUserById, isProjectAccessible } from '../repositories/auth'
import { getAgent, getAgentTasks } from '../repositories/agent'
import {
  findPendingAgentCommentTask,
  publishAgentEventWithOutcome,
  resolveAgentDispatchReadiness,
  type AgentEventActor,
} from './agent-event-runtime'
import { resolveCustomAgentProjectAccess } from './task-agent-assignment-service'
import { publishWorkspaceBrainReview } from './scheduling-brain/event-supervisor'
import { isSelfDelivery, publishInboxItem } from './inbox-service'
import { buildTaskCommentInboxItem } from './task-comment-inbox'
import { setTaskSubscriber } from './task-subscriber-service'

export type TaskCommentAuthor = AgentEventActor & { name?: string; avatarUrl?: string }

export type TaskCommentMutationResult = {
  task: Task
  comment?: TaskComment
  error?: 'not_found' | 'forbidden' | 'deleted' | 'empty'
}

type TaskCommentOptions = {
  parentCommentId?: string
  mentions?: TaskCommentMention[]
  attachments?: TaskChatAttachment[]
  idempotencyKey?: string
}

export const buildAgentEventCommentIdempotencyKey = (eventId: string) => `task-agent-event-comment:${eventId}`
export const buildTaskDeliveryCommentIdempotencyKey = (eventId: string) => `task-delivery:${eventId}`

const normalizeTaskCommentContent = (content: string) => content.replace(/\s+/g, ' ').trim()

const LEGACY_TASK_COMMENT_AUTHOR_NAMES = new Set(['agent 入口', '主 agent'])

export const normalizeLegacyTaskCommentAuthors = (params: {
  task: Task
  agents: AgentRecord[]
  projectOwnerUserId?: string
}): Task => {
  const customAgents = params.agents.filter((agent) => agent.type.trim().toLowerCase() !== 'main')
  const replacement = customAgents.find((agent) => agent.id === params.task.assigneeAgentId)
    ?? customAgents
      .filter((agent) => agent.ownerUserId === params.projectOwnerUserId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
  if (!replacement) return params.task

  let changed = false
  const comments = params.task.comments.map((comment) => {
    if (!LEGACY_TASK_COMMENT_AUTHOR_NAMES.has(comment.authorName?.trim().toLowerCase() ?? '')) {
      return comment
    }
    changed = true
    return {
      ...comment,
      authorType: 'agent' as const,
      authorId: replacement.id,
      authorName: replacement.name,
      authorAvatarUrl: readCustomAgentConfig(replacement.config).avatarUrl || undefined,
    }
  })

  return changed ? { ...params.task, comments } : params.task
}

export const appendTaskComment = (
  task: Task,
  author: TaskCommentAuthor,
  content: string,
  options: TaskCommentOptions = {},
): Task => {
  const idempotencyKey = options.idempotencyKey?.trim()
  if (idempotencyKey && task.comments.some((comment) => comment.idempotencyKey === idempotencyKey)) {
    return task
  }

  const timestamp = new Date().toISOString()
  const taskWithSubscriber = author.type === 'user' && author.id
    ? setTaskSubscriber({ task, userId: author.id, subscribed: true })
    : task
  return {
    ...taskWithSubscriber,
    comments: [
      ...taskWithSubscriber.comments,
      {
        id: crypto.randomUUID(),
        authorType: author.type,
        authorId: author.id,
        authorName: author.name,
        authorAvatarUrl: author.avatarUrl,
        parentCommentId: options.parentCommentId,
        mentions: options.mentions ?? [],
        attachments: options.attachments ?? [],
        idempotencyKey,
        content: content.trim(),
        createdAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  }
}

export const appendTaskDeliveryComment = (params: {
  task: Task
  author: TaskCommentAuthor
  content: string
  eventId?: string
  parentCommentId?: string
}) => {
  const deliveryIdempotencyKey = params.eventId
    ? buildTaskDeliveryCommentIdempotencyKey(params.eventId)
    : undefined
  const existingDeliveryComment = deliveryIdempotencyKey
    ? params.task.comments.find((comment) => comment.idempotencyKey === deliveryIdempotencyKey)
    : undefined
  if (existingDeliveryComment) {
    return {
      task: params.task,
      comment: existingDeliveryComment,
      created: false,
      promoted: false,
    }
  }

  const eventCommentIdempotencyKey = params.eventId
    ? buildAgentEventCommentIdempotencyKey(params.eventId)
    : undefined
  const normalizedContent = normalizeTaskCommentContent(params.content)
  const equivalentEventComment = eventCommentIdempotencyKey
    ? params.task.comments.find((comment) => (
        comment.idempotencyKey === eventCommentIdempotencyKey
        && comment.authorType === params.author.type
        && comment.authorId === params.author.id
        && normalizeTaskCommentContent(comment.content) === normalizedContent
      ))
    : undefined

  if (equivalentEventComment && deliveryIdempotencyKey) {
    const timestamp = new Date().toISOString()
    const promotedComment: TaskComment = {
      ...equivalentEventComment,
      content: params.content.trim(),
      parentCommentId: equivalentEventComment.parentCommentId ?? params.parentCommentId,
      idempotencyKey: deliveryIdempotencyKey,
    }
    return {
      task: {
        ...params.task,
        comments: params.task.comments.map((comment) => (
          comment.id === promotedComment.id ? promotedComment : comment
        )),
        updatedAt: timestamp,
      },
      comment: promotedComment,
      created: false,
      promoted: true,
    }
  }

  const nextTask = appendTaskComment(params.task, params.author, params.content, {
    idempotencyKey: deliveryIdempotencyKey,
    parentCommentId: params.parentCommentId,
  })
  const comment = deliveryIdempotencyKey
    ? nextTask.comments.find((item) => item.idempotencyKey === deliveryIdempotencyKey)
    : nextTask.comments.at(-1)
  return {
    task: nextTask,
    comment,
    created: true,
    promoted: false,
  }
}

const findOwnedTaskComment = (
  task: Task,
  commentId: string,
  authorId: string,
): TaskCommentMutationResult => {
  const comment = task.comments.find((item) => item.id === commentId)
  if (!comment) return { task, error: 'not_found' }
  if (comment.authorId !== authorId || (comment.authorType && comment.authorType !== 'user')) {
    return { task, comment, error: 'forbidden' }
  }
  return { task, comment }
}

export const editTaskComment = (params: {
  task: Task
  commentId: string
  authorId: string
  content: string
  mentions: TaskCommentMention[]
  attachments?: TaskChatAttachment[]
}): TaskCommentMutationResult => {
  const owned = findOwnedTaskComment(params.task, params.commentId, params.authorId)
  if (!owned.comment || owned.error) return owned
  if (owned.comment.deletedAt) return { ...owned, error: 'deleted' }

  const content = params.content.trim()
  const attachments = params.attachments ?? owned.comment.attachments ?? []
  if (!content && attachments.length === 0) return { ...owned, error: 'empty' }

  const timestamp = new Date().toISOString()
  const comment: TaskComment = {
    ...owned.comment,
    content,
    mentions: params.mentions,
    attachments,
    editedAt: timestamp,
  }
  return {
    task: {
      ...params.task,
      comments: params.task.comments.map((item) => (item.id === params.commentId ? comment : item)),
      updatedAt: timestamp,
    },
    comment,
  }
}

export const deleteTaskComment = (params: {
  task: Task
  commentId: string
  authorId: string
}): TaskCommentMutationResult => {
  const owned = findOwnedTaskComment(params.task, params.commentId, params.authorId)
  if (!owned.comment || owned.error) return owned
  if (owned.comment.deletedAt) return owned

  const timestamp = new Date().toISOString()
  const comment: TaskComment = {
    ...owned.comment,
    content: '',
    mentions: [],
    attachments: [],
    deletedAt: timestamp,
  }
  return {
    task: {
      ...params.task,
      comments: params.task.comments.map((item) => (item.id === params.commentId ? comment : item)),
      updatedAt: timestamp,
    },
    comment,
  }
}

export const setTaskCommentReaction = (params: {
  task: Task
  commentId: string
  userId: string
  emoji: NonNullable<TaskComment['reactions']>[number]['emoji']
  active: boolean
}): TaskCommentMutationResult => {
  const currentComment = params.task.comments.find((comment) => comment.id === params.commentId)
  if (!currentComment) return { task: params.task, error: 'not_found' }
  if (currentComment.deletedAt) return { task: params.task, comment: currentComment, error: 'deleted' }

  const reactions = currentComment.reactions ?? []
  const currentReaction = reactions.find((reaction) => reaction.emoji === params.emoji)
  const alreadyActive = currentReaction?.userIds.includes(params.userId) ?? false
  if (alreadyActive === params.active) return { task: params.task, comment: currentComment }

  const nextUserIds = params.active
    ? [...(currentReaction?.userIds ?? []), params.userId]
    : (currentReaction?.userIds ?? []).filter((userId) => userId !== params.userId)
  const nextReaction = nextUserIds.length > 0
    ? { emoji: params.emoji, userIds: nextUserIds }
    : null
  const nextReactions = currentReaction
    ? reactions.flatMap((reaction) => reaction.emoji === params.emoji
      ? nextReaction ? [nextReaction] : []
      : [reaction])
    : nextReaction ? [...reactions, nextReaction] : reactions
  const timestamp = new Date().toISOString()
  const comment: TaskComment = { ...currentComment, reactions: nextReactions }
  return {
    task: {
      ...params.task,
      comments: params.task.comments.map((item) => (item.id === params.commentId ? comment : item)),
      updatedAt: timestamp,
    },
    comment,
  }
}

export const setTaskCommentResolution = (params: {
  task: Task
  commentId: string
  userId: string
  resolved: boolean
}): TaskCommentMutationResult => {
  const requestedComment = params.task.comments.find((comment) => comment.id === params.commentId)
  if (!requestedComment) return { task: params.task, error: 'not_found' }
  const rootComment = requestedComment.parentCommentId
    ? params.task.comments.find((comment) => comment.id === requestedComment.parentCommentId)
    : requestedComment
  if (!rootComment) return { task: params.task, error: 'not_found' }
  if (rootComment.deletedAt) return { task: params.task, comment: rootComment, error: 'deleted' }

  const alreadyResolved = Boolean(rootComment.resolvedAt)
  if (alreadyResolved === params.resolved) return { task: params.task, comment: rootComment }

  const timestamp = new Date().toISOString()
  const comment: TaskComment = {
    ...rootComment,
    resolvedAt: params.resolved ? timestamp : undefined,
    resolvedByUserId: params.resolved ? params.userId : undefined,
  }
  return {
    task: {
      ...params.task,
      comments: params.task.comments.map((item) => (item.id === rootComment.id ? comment : item)),
      updatedAt: timestamp,
    },
    comment,
  }
}

type TaskCommentMentionCandidate = Pick<TaskCommentMention, 'targetType' | 'targetId'>

export const expandTaskCommentSpecialMentions = (
  candidates: TaskCommentMentionCandidate[],
  projectMemberIds: string[],
  agentGroups: Array<{ id: string; memberIds: string[] }>,
): TaskCommentMentionCandidate[] => candidates.flatMap((candidate) => {
  if (candidate.targetType === 'all') {
    return projectMemberIds.map((targetId) => ({ targetType: 'user' as const, targetId }))
  }
  if (candidate.targetType === 'agent_group') {
    const group = agentGroups.find((item) => item.id === candidate.targetId)
    return group
      ? group.memberIds.map((targetId) => ({ targetType: 'agent' as const, targetId }))
      : [candidate]
  }
  return [candidate]
})

export const resolveTaskCommentMentions = (params: {
  task: Task
  author: TaskCommentAuthor
  mentions: TaskCommentMentionCandidate[]
  projectWorkspaceId?: string
}) => {
  const mentions: TaskCommentMention[] = []
  const outcomes: TaskCommentDispatchOutcome[] = []
  const seen = new Set<string>()
  const accessibleGroups = params.projectWorkspaceId
    ? listWorkspaceGroupConversationDetails(params.projectWorkspaceId)
      .filter((detail) => params.author.type !== 'user' || detail.members.some((member) => (
        member.memberType === 'user' && member.memberId === params.author.id
      )))
      .map((detail) => ({
        id: detail.conversation.id,
        memberIds: detail.members
          .filter((member) => member.memberType === 'agent')
          .map((member) => member.memberId),
      }))
    : []
  const candidates = expandTaskCommentSpecialMentions(
    params.mentions,
    getProjectAssignees(params.task.projectId)
      .map((member) => member.id)
      .filter((memberId) => params.author.type !== 'user' || memberId !== params.author.id),
    accessibleGroups,
  )

  for (const candidate of candidates) {
    const key = `${candidate.targetType}:${candidate.targetId}`
    if (seen.has(key)) continue
    seen.add(key)

    if (candidate.targetType === 'user') {
      const user = getUserById(candidate.targetId)
      if (!user || !isProjectAccessible(candidate.targetId, params.task.projectId)) {
        outcomes.push({
          targetType: 'user',
          targetId: candidate.targetId,
          targetName: candidate.targetId,
          status: 'blocked',
          message: '被提及的成员不存在或无权访问该项目。',
        })
        continue
      }
      mentions.push({ targetType: 'user', targetId: user.id, targetName: user.name })
      continue
    }

    if (candidate.targetType !== 'agent') {
      outcomes.push({
        targetType: candidate.targetType,
        targetId: candidate.targetId,
        targetName: candidate.targetId,
        status: 'blocked',
        message: candidate.targetType === 'agent_group'
          ? 'Agent group 不存在或当前用户不是群成员。'
          : '@all 当前不可用。',
      })
      continue
    }

    const agent = getAgent(candidate.targetId)
    const access = agent
      ? resolveCustomAgentProjectAccess({
          agent,
          userId: params.author.type === 'user' ? params.author.id : undefined,
          projectId: params.task.projectId,
          collaborationWorkspaceId: params.projectWorkspaceId,
          mode: 'mention',
        })
      : null
    if (!agent || !access?.ok) {
      outcomes.push({
        targetType: 'agent',
        targetId: candidate.targetId,
        targetName: candidate.targetId,
        status: 'blocked',
        message: access?.message || '被提及的 Agent 不存在。',
      })
      continue
    }
    mentions.push({ targetType: 'agent', targetId: agent.id, targetName: agent.name })
  }

  return { mentions, outcomes }
}

export const resolveTaskCommentAgentRoute = (_task: Task, comment: TaskComment) => {
  const explicitAgentIds = (comment.mentions ?? [])
    .filter((mention) => mention.targetType === 'agent')
    .map((mention) => mention.targetId)
  if (explicitAgentIds.length > 0) return { ids: explicitAgentIds, triggerKind: 'mention' as const }
  if ((comment.mentions ?? []).some((mention) => mention.targetType === 'user')) {
    return { ids: [], triggerKind: 'human_mention' as const }
  }

  return { ids: [], triggerKind: 'none' as const }
}

export const previewTaskCommentEvent = (
  task: Task,
  author: TaskCommentAuthor,
  comment: TaskComment,
  initialOutcomes: TaskCommentDispatchOutcome[] = [],
) => {
  const outcomes = [...initialOutcomes]
  for (const mention of comment.mentions ?? []) {
    if (mention.targetType === 'user') outcomes.push({ ...mention, status: 'mentioned' })
  }

  const conversationKey = `task:${task.id}`
  const targets = resolveTaskCommentAgentRoute(task, comment)
  for (const agentId of [...new Set(targets.ids)]) {
    if (author.type === 'agent' && author.id === agentId) continue

    const agent = getAgent(agentId)
    const readiness = resolveAgentDispatchReadiness(agentId, author.type === 'user' ? author.id : undefined)
    if (!agent || !readiness.ok) {
      outcomes.push({
        targetType: 'agent',
        targetId: agentId,
        targetName: agent?.name ?? agentId,
        status: 'blocked',
        message: readiness.ok ? '目标 Agent 不存在。' : readiness.message,
      })
      continue
    }

    const pending = findPendingAgentCommentTask(
      getAgentTasks(agentId, Number.MAX_SAFE_INTEGER),
      task.id,
      conversationKey,
    )
    outcomes.push({
      targetType: 'agent',
      targetId: agentId,
      targetName: agent.name,
      status: pending ? 'coalesced' : 'queued',
      eventId: pending?.id,
    })
  }

  return outcomes
}

export const publishTaskCommentEvent = async (
  task: Task,
  author: TaskCommentAuthor,
  comment: TaskComment = task.comments.at(-1)!,
  initialOutcomes: TaskCommentDispatchOutcome[] = [],
) => {
  if (!comment) return initialOutcomes

  const outcomes = [...initialOutcomes]
  const notifiedUserIds = new Set<string>()
  for (const mention of comment.mentions ?? []) {
    if (mention.targetType === 'user') {
      await publishInboxItem(buildTaskCommentInboxItem({
        task,
        comment,
        author,
        targetUserId: mention.targetId,
        trigger: 'mentioned',
      }))
      notifiedUserIds.add(mention.targetId)
      outcomes.push({ ...mention, status: 'mentioned' })
    }
  }

  // 关注者收到的是 observe：进收件箱但不点亮 badge。
  for (const subscriberId of task.subscriberIds ?? []) {
    if (notifiedUserIds.has(subscriberId)) continue
    // 自己写的评论不进自己的关注收件箱。
    if (isSelfDelivery({ recipientType: 'user', recipientId: subscriberId, actor: author })) continue
    await publishInboxItem(buildTaskCommentInboxItem({
      task,
      comment,
      author,
      targetUserId: subscriberId,
      trigger: 'subscribed',
    }))
  }

  const targets = resolveTaskCommentAgentRoute(task, comment)
  for (const agentId of [...new Set(targets.ids)]) {
    // 负责人自己写的评论不再唤醒自己：同一 Agent 同一任务本就在同一会话里。
    if (author.type === 'agent' && author.id === agentId) {
      outcomes.push({
        targetType: 'agent',
        targetId: agentId,
        targetName: getAgent(agentId)?.name ?? agentId,
        status: 'blocked',
        message: '该 Agent 是本条评论的作者，无需再通知自己。',
      })
      continue
    }

    const agent = getAgent(agentId)
    const readiness = resolveAgentDispatchReadiness(agentId, author.type === 'user' ? author.id : undefined)
    if (!agent || !readiness.ok) {
      outcomes.push({
        targetType: 'agent',
        targetId: agentId,
        targetName: agent?.name ?? agentId,
        status: 'blocked',
        message: readiness.ok ? '目标 Agent 不存在。' : readiness.message,
      })
      continue
    }

    const [dispatch] = publishAgentEventWithOutcome({
      type: 'task.comment.mentioned',
      targetAgentId: agentId,
      actingUserId: author.type === 'user' ? author.id : undefined,
      actor: author,
      scope: { projectId: task.projectId, taskId: task.id, commentId: comment.id },
      payload: {
        taskTitle: task.title,
        comment: comment.content,
        attachments: comment.attachments ?? [],
        commentId: comment.id,
        parentCommentId: comment.parentCommentId,
        triggerKind: targets.triggerKind,
        assigneeAgentGroupId: task.assigneeAgentGroupId,
      },
      conversationKey: `task:${task.id}`,
      idempotencyKey: `task-comment:${comment.id}:agent:${agentId}`,
    })
    outcomes.push({
      targetType: 'agent',
      targetId: agentId,
      targetName: agent.name,
      status: dispatch?.status ?? 'deduplicated',
      eventId: dispatch?.task.id,
    })
  }

  // 调度大脑（feature）：无主任务 + 用户评论 → 旁路发布 review 事件（有主评论上方已路由给负责人）
  if (!task.assigneeId && !task.assigneeAgentId && !task.assigneeAgentGroupId && author.type === 'user' && comment.id) {
    void publishWorkspaceBrainReview({
      kind: 'task.comment.created',
      projectId: task.projectId,
      actingUserId: author.id,
      actor: author,
      eventKey: `task-comment:${task.id}:${comment.id}`,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        projectId: task.projectId,
        assigneeId: task.assigneeId,
        assigneeAgentId: task.assigneeAgentId,
        assigneeAgentGroupId: task.assigneeAgentGroupId,
      },
      comment: {
        id: comment.id,
        content: comment.content,
        authorType: author.type,
      },
    })
  }

  return outcomes
}

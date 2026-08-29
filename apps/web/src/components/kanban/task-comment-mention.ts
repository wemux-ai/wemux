/**
 * [INPUT]: Plain-text task comment content, caret positions, mention options, and persisted mention metadata.
 * [OUTPUT]: Deterministic mention-query detection, text insertion, edited-comment candidates, and server preview labels.
 * [POS]: Pure Textarea mention helper shared by task comment UI and focused tests.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { Task, TaskCommentDispatchOutcome, TaskCommentMention } from '@shared/types'
import type { ProjectAssignee } from '../../lib/api'

export const toTaskCommentMentionCandidate = (option: ProjectAssignee): Pick<TaskCommentMention, 'targetType' | 'targetId'> => ({
  targetType: option.kind === 'all'
    ? 'all'
    : option.kind === 'agent' || option.id.startsWith('agent:')
      ? 'agent'
      : 'user',
  targetId: option.id.startsWith('agent:')
      ? option.id.slice('agent:'.length)
      : option.id,
})

export const resolveTaskCommentReplyMentionOption = (
  comment: Task['comments'][number],
  mentionOptions: ProjectAssignee[],
) => {
  if (comment.deletedAt || !comment.authorId || comment.authorType === 'system') return undefined

  return mentionOptions.find((option) => {
    if (comment.authorType === 'agent') {
      return (option.kind === 'agent' || option.id.startsWith('agent:'))
        && (option.id === comment.authorId || option.id === `agent:${comment.authorId}`)
    }
    return option.kind !== 'agent'
      && !option.id.startsWith('agent:')
      && option.id === comment.authorId
  })
}

export const buildTaskCommentReplyDraft = (params: {
  comment: Task['comments'][number]
  value: string
  selectedMentions: ProjectAssignee[]
  mentionOptions: ProjectAssignee[]
}) => {
  const mentionOption = resolveTaskCommentReplyMentionOption(params.comment, params.mentionOptions)
  if (!mentionOption) {
    return {
      value: params.value,
      cursor: params.value.length,
      selectedMentions: params.selectedMentions,
      mentionAdded: false,
    }
  }

  const mentionToken = `@${mentionOption.name}`
  const inserted = params.value.includes(mentionToken)
    ? {
        value: params.value,
        cursor: Math.min(params.value.length, params.value.indexOf(mentionToken) + mentionToken.length + 1),
      }
    : insertTaskCommentMention({
        value: params.value,
        label: mentionOption.name,
        start: 0,
        cursor: 0,
      })

  return {
    ...inserted,
    selectedMentions: params.selectedMentions.some((item) => item.id === mentionOption.id)
      ? params.selectedMentions
      : [...params.selectedMentions, mentionOption],
    mentionAdded: true,
  }
}

export const resolveTaskCommentDispatchPreviewMeta = (outcome: TaskCommentDispatchOutcome) => {
  switch (outcome.status) {
    case 'mentioned': return { label: `将通知 ${outcome.targetName}`, tone: 'human' as const }
    case 'coalesced': return { label: `将合并到 ${outcome.targetName} 的待处理轮`, tone: 'agent' as const }
    case 'queued': return { label: `将启动 ${outcome.targetName}`, tone: 'agent' as const }
    case 'deduplicated': return { label: `${outcome.targetName} 已收到`, tone: 'neutral' as const }
    case 'blocked': return { label: `${outcome.targetName} 不会触发${outcome.message ? `：${outcome.message}` : ''}`, tone: 'blocked' as const }
  }
}

export const resolveEditedTaskCommentMentions = (
  comment: Task['comments'][number],
  content: string,
  mentionOptions: ProjectAssignee[],
) => {
  const candidates = [
    ...mentionOptions
      .filter((option) => content.includes(`@${option.name}`))
      .map(toTaskCommentMentionCandidate),
    ...(comment.mentions ?? [])
      .filter((mention) => content.includes(`@${mention.targetName}`))
      .map(({ targetType, targetId }) => ({ targetType, targetId })),
  ]
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.targetType}:${candidate.targetId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const resolveTaskCommentMentionQuery = (value: string, cursor: number) => {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null

  const query = match[1] ?? ''
  return {
    query,
    start: cursor - query.length - 1,
    cursor,
  }
}

export const insertTaskCommentMention = (params: {
  value: string
  label: string
  start: number
  cursor: number
}) => {
  const prefix = params.value.slice(0, params.start)
  const suffix = params.value.slice(params.cursor)
  const needsSpace = Boolean(prefix && !/\s$/.test(prefix))
  const token = `${needsSpace ? ' ' : ''}@${params.label}${suffix && /^\s/.test(suffix) ? '' : ' '}`

  return {
    value: `${prefix}${token}${suffix}`,
    cursor: prefix.length + token.length,
  }
}

/**
 * [INPUT]: Authorized task, project-visible user ID, and desired subscription state.
 * [OUTPUT]: Idempotently updated task subscriber IDs and collaboration timestamp.
 * [POS]: Pure task subscription mutation; authorization and persistence stay in route/storage layers.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { Task } from '@shared/types'

export const setTaskSubscriber = (params: {
  task: Task
  userId: string
  subscribed: boolean
}): Task => {
  const subscriberIds = [...new Set(params.task.subscriberIds ?? [])]
  const alreadySubscribed = subscriberIds.includes(params.userId)
  if (alreadySubscribed === params.subscribed) return params.task

  return {
    ...params.task,
    subscriberIds: params.subscribed
      ? [...subscriberIds, params.userId]
      : subscriberIds.filter((userId) => userId !== params.userId),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * [INPUT]: Task assignment changes with stable actor and assignee identity snapshots.
 * [OUTPUT]: Pure helpers that append structured assignment entries to the existing task history JSON.
 * [POS]: Shared task-audit primitive; presentation-specific Timeline projection stays in the web app.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Task, TaskHistoryIdentity } from './types'

export interface AppendTaskAssignmentHistoryInput {
  actor?: TaskHistoryIdentity
  assignee?: TaskHistoryIdentity
  at?: string
}

export const appendTaskAssignmentHistory = (
  task: Task,
  input: AppendTaskAssignmentHistoryInput,
): Task => {
  const at = input.at ?? new Date().toISOString()
  const label = input.assignee ? `指派给 ${input.assignee.name}` : '已清除负责人'

  return {
    ...task,
    history: [
      ...task.history,
      {
        id: crypto.randomUUID(),
        label,
        at,
        kind: 'assignment',
        actor: input.actor,
        assignee: input.assignee,
      },
    ],
  }
}

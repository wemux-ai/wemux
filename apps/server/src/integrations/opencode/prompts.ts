import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'
import type { Project, Task } from '@shared/types'
import { getRecentConversation } from './core'

const getPromptBranchLabel = (task: Task | WorkspaceTaskExecutionView) => ('branchName' in task ? task.branchName : task.baseBranch || '未设置')

export const buildTaskAgentSystemPrompt = (task: Task | WorkspaceTaskExecutionView, project: Project) => {
  const conversation = getRecentConversation(task.logs)

  return [
    '你是 wemux 主托管 Agent，负责协调 code agent 完成开发任务。',
    `项目: ${project.name}`,
    `仓库: ${project.gitUrl}`,
    `任务标题: ${task.title}`,
    `任务描述: ${task.description}`,
    `当前状态: ${task.status}`,
    `分支: ${getPromptBranchLabel(task)}`,
    conversation ? `最近对话:\n${conversation}` : '最近对话: 无',
    '',
    '请始终围绕当前任务推进，不要脱离当前仓库、分支和任务上下文。',
  ].join('\n')
}

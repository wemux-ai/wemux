import type { TaskChatContextRef } from '@shared/task-chat-context'
import type { Project, WorkspaceSession } from '@shared/types'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { getScopedWorkspaceForProject } from '../../routes/task-route-support'

const MAX_CONTEXT_FILE_CHARS = 12_000

const truncateContextContent = (content: string) => {
  if (content.length <= MAX_CONTEXT_FILE_CHARS) {
    return { content, truncated: false }
  }

  return {
    content: content.slice(0, MAX_CONTEXT_FILE_CHARS),
    truncated: true,
  }
}

const formatWorkspaceFileContextBlock = async (params: {
  executorId: string
  cwd: string
  ref: Extract<TaskChatContextRef, { kind: 'workspace_file' }>
}) => {
  try {
    const result = await executorWsService.requestFileRead(
      params.executorId,
      params.cwd,
      params.ref.path,
      12_000,
    )
    if (!result.ok || result.encoding !== 'utf8' || typeof result.content !== 'string') {
      return [
        `- ${params.ref.path}`,
        `  状态: 无法读取为 UTF-8 文本${result.message ? ` (${result.message})` : ''}`,
      ].join('\n')
    }

    const trimmed = truncateContextContent(result.content)
    return [
      `- ${result.path}`,
      '```',
      trimmed.content,
      '```',
      ...(trimmed.truncated || result.truncated ? ['[文件内容已截断]'] : []),
    ].join('\n')
  } catch (error) {
    return [
      `- ${params.ref.path}`,
      `  状态: 读取失败${error instanceof Error ? ` (${error.message})` : ''}`,
    ].join('\n')
  }
}

export const buildTaskChatContextPromptPrefix = async (params: {
  contextRefs?: TaskChatContextRef[]
  userId: string
  project: Project
  workspaceId: string
  workspaceSessionId?: string
  session: WorkspaceSession
  cwd: string
}) => {
  const refs = params.contextRefs ?? []
  if (refs.length === 0) {
    return ''
  }

  const workspace = getScopedWorkspaceForProject(params.userId, params.project, params.workspaceId)
  const executorId = params.session.executorNodeId?.trim() || workspace?.executorNodeId?.trim() || ''
  const sections: string[] = []

  const workspaceFileRefs = refs.filter((item): item is Extract<TaskChatContextRef, { kind: 'workspace_file' }> => {
    return item.kind === 'workspace_file'
      && item.workspaceId === params.workspaceId
      && item.workspaceSessionId === (params.workspaceSessionId ?? params.session.id)
  })

  if (workspaceFileRefs.length > 0) {
    const fileBlocks = executorId
      ? await Promise.all(workspaceFileRefs.map((ref) => formatWorkspaceFileContextBlock({
        executorId,
        cwd: params.cwd,
        ref,
      })))
      : workspaceFileRefs.map((ref) => `- ${ref.path}\n  状态: 当前工作区未绑定执行节点，无法读取文件内容`)

    sections.push([
      '[引用的工作区文件]',
      ...fileBlocks,
    ].join('\n'))
  }

  const projectRefs = refs.filter((item): item is Extract<TaskChatContextRef, { kind: 'project' }> => item.kind === 'project')
  if (projectRefs.length > 0) {
    sections.push([
      '[引用的项目]',
      ...projectRefs.map((ref) => {
        if (ref.projectId !== params.project.id) {
          return `- ${ref.projectId}`
        }

        return [
          `- ${params.project.name}`,
          `  projectId: ${params.project.id}`,
          ...(params.project.gitUrl?.trim() ? [`  gitUrl: ${params.project.gitUrl.trim()}`] : []),
          ...(params.project.defaultBranch?.trim() ? [`  defaultBranch: ${params.project.defaultBranch.trim()}`] : []),
          ...(params.cwd.trim() ? [`  workspacePath: ${params.cwd.trim()}`] : []),
        ].join('\n')
      }),
    ].join('\n'))
  }

  if (sections.length === 0) {
    return ''
  }

  return `${sections.join('\n\n')}\n\n[用户消息]\n`
}

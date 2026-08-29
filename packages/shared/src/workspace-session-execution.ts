// [INPUT]: A workspace session and its optional real task binding.
// [OUTPUT]: A stable execution identity for workspace-session APIs and worker requests.
// [POS]: Shared contract that keeps taskless workspace sessions out of task-shaped execution paths.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WorkspaceSessionExecutionIdentity = {
  projectId: string
  workspaceId: string
  workspaceSessionId: string
  taskId?: string
}

export const isTaskBoundWorkspaceSessionExecution = (
  identity: WorkspaceSessionExecutionIdentity,
) => Boolean(identity.taskId?.trim())

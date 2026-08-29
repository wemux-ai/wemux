export const buildWorkspaceGitScopeKey = (params: {
  taskId: string
  workspaceId: string
  workspaceSessionId?: string
  compareBranch: string
  worktreeStatus?: string
  baseBranch: string
}) => JSON.stringify([
  params.taskId,
  params.workspaceId,
  params.workspaceSessionId?.trim() || '',
  params.compareBranch,
  params.worktreeStatus || '',
  params.baseBranch,
])

export const workspaceQueryKeys = {
  projectWorkspaces: (projectId: string) => ['workspace', 'project-workspaces', projectId] as const,
  executors: () => ['workspace', 'executors'] as const,
  managedCloudRuntime: () => ['workspace', 'managed-cloud-runtime'] as const,
  gitWorkingTreeDiff: (
    taskId: string,
    workspaceId: string,
    workspaceSessionId: string | undefined,
    scopeKey: string,
  ) => ['workspace', 'git-working-tree-diff', taskId, workspaceId, workspaceSessionId?.trim() || 'workspace', scopeKey] as const,
  gitGraph: (
    taskId: string,
    workspaceId: string,
    workspaceSessionId: string | undefined,
    limit: number,
    scopeKey: string,
  ) => ['workspace', 'git-graph', taskId, workspaceId, workspaceSessionId?.trim() || 'workspace', limit, scopeKey] as const,
  gitCommitDiff: (
    taskId: string,
    workspaceId: string,
    workspaceSessionId: string | undefined,
    sha: string,
  ) => ['workspace', 'git-commit-diff', taskId, workspaceId, workspaceSessionId?.trim() || 'workspace', sha] as const,
  workspaceBranches: (workspaceId: string, scopeKey = 'default') =>
    ['workspace', 'branches', workspaceId, scopeKey || 'default'] as const,
  filesDirectoryExecutorScope: (executorId: string) =>
    ['workspace', 'files-directory', executorId] as const,
  filesDirectoryScope: (executorId: string, scopeKey = 'default') =>
    ['workspace', 'files-directory', executorId, scopeKey || 'default'] as const,
  filesDirectory: (executorId: string, directoryPath: string, scopeKey = 'default') =>
    [...workspaceQueryKeys.filesDirectoryScope(executorId, scopeKey), directoryPath] as const,
  filePreview: (executorId: string, filePath: string, scopeKey = 'default') =>
    ['workspace', 'file-preview', executorId, scopeKey || 'default', filePath] as const,
  conversation: (
    taskId: string,
    workspaceId: string | undefined,
    workspaceSessionId: string | undefined,
    optionsKey = 'latest',
  ) => ['workspace', 'conversation', taskId, workspaceId?.trim() || 'default', workspaceSessionId?.trim() || 'latest', optionsKey] as const,
  chatSession: (
    taskId: string,
    workspaceId: string | undefined,
    workspaceSessionId: string | undefined,
  ) => ['workspace', 'chat-session', taskId, workspaceId?.trim() || 'default', workspaceSessionId?.trim() || 'latest'] as const,
  historyEvents: (
    workspaceId: string,
    workspaceSessionId: string,
    optionsKey = 'latest',
  ) => ['workspace', 'history-events', workspaceId, workspaceSessionId, optionsKey] as const,
  historySnapshot: (
    workspaceId: string,
    workspaceSessionId: string,
    optionsKey = 'latest',
  ) => ['workspace', 'history-snapshot', workspaceId, workspaceSessionId, optionsKey] as const,
  historyEventsScope: (
    workspaceId: string,
    workspaceSessionId: string,
  ) => ['workspace', 'history-events', workspaceId, workspaceSessionId] as const,
  historyTurns: (
    workspaceId: string,
    workspaceSessionId: string,
  ) => ['workspace', 'history-turns', workspaceId, workspaceSessionId] as const,
  preview: (previewId: string) => ['workspace', 'preview', previewId] as const,
  previewScope: (scopeKey: string) => ['workspace', 'preview-scope', scopeKey] as const,
  taskPreview: (
    taskId: string,
    workspaceId: string | undefined,
    workspaceSessionId: string | undefined,
    executorId?: string,
  ) => ['workspace', 'task-preview', taskId, workspaceId?.trim() || 'default', workspaceSessionId?.trim() || 'latest', executorId?.trim() || 'executor-any'] as const,
  environmentStatus: (
    taskId: string,
    workspaceId: string,
    workspaceSessionId: string,
  ) => ['workspace', 'environment-status', taskId, workspaceId, workspaceSessionId] as const,
  terminalSessions: (
    executorId: string,
    workspaceId: string | undefined,
    scope: 'workspace' | 'executor',
  ) => ['workspace', 'terminal-sessions', executorId, workspaceId?.trim() || 'executor', scope] as const,
  importableAgentSessions: (
    taskId: string,
    workspaceId: string,
    workspaceSessionId: string | undefined,
    executorId: string,
  ) => ['workspace', 'importable-agent-sessions', taskId, workspaceId, workspaceSessionId?.trim() || 'latest', executorId] as const,
  importableAgentSession: (
    taskId: string,
    workspaceId: string,
    workspaceSessionId: string | undefined,
    executorId: string,
    source: string,
    sessionId: string,
  ) => ['workspace', 'importable-agent-session', taskId, workspaceId, workspaceSessionId?.trim() || 'latest', executorId, source, sessionId] as const,
  modelUsageSummary: (
    period: '7d' | '30d' | 'all',
    taskId: string | undefined,
    workspaceId: string | undefined,
    workspaceSessionId: string | undefined,
  ) => ['workspace', 'model-usage-summary', period, taskId?.trim() || 'all', workspaceId?.trim() || 'all', workspaceSessionId?.trim() || 'all'] as const,
  projectBranches: (projectId: string, executorId: string | undefined) =>
    ['workspace', 'project-branches', projectId, executorId?.trim() || 'default'] as const,
  workspaceEnvironmentTemplate: (workspaceId: string) =>
    ['workspace', 'environment-template', workspaceId] as const,
  workspaceRuntimeEnvironment: (workspaceId: string) =>
    ['workspace', 'runtime-environment', workspaceId] as const,
  agentModels: (agentType: string, executorId: string | undefined) =>
    ['workspace', 'agent-models', agentType, executorId?.trim() || 'local'] as const,
}

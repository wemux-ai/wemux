import type { AgentRuntimeSettings, Project, Task, Workspace } from '@shared/types'

export type CreateWorkspaceImage = {
  id: string
  url: string
  previewUrl?: string
  filename: string
  contentType?: string
  file: File
  uploadState?: 'uploading' | 'failed'
  uploadProgress?: number
  uploadError?: string
}

export type CreateWorkspaceState = {
  projectSource: 'existing' | 'github-app' | 'playground'
  projectId: string
  executorId: string
  agentType: Task['agentType']
  executionModel: string
  agentSettings?: AgentRuntimeSettings
  workingDirectoryMode: Workspace['workingDirectoryMode']
  autoCommitEnabled: boolean
  name: string
  initialPrompt: string
  images: CreateWorkspaceImage[]
  busy: boolean
  creatingStep: '' | 'workspace' | 'session'
  branchOptions: string[]
  branchSources?: Record<string, 'remote' | 'local-only'>
  branchLoading: boolean
  selectedBranch: string
  branchMessage: string
  defaultBranch: string
  branchVersionControl?: Project['versionControl']
  githubInstallationId: string
  githubRepositoryId: string
  githubRepositoryName: string
  githubRepositoryCloneUrl: string
  githubRepositoryDefaultBranch: string
}

export const createWorkspaceInitialState = (
  projectId = '',
  executorId = '',
): CreateWorkspaceState => ({
  projectSource: 'existing',
  projectId,
  executorId,
  agentType: 'OpenCode',
  executionModel: '',
  workingDirectoryMode: 'worktree',
  autoCommitEnabled: true,
  name: '',
  initialPrompt: '',
  images: [],
  busy: false,
  creatingStep: '',
  branchOptions: [],
  branchSources: undefined,
  branchLoading: false,
  selectedBranch: '',
  branchMessage: '',
  defaultBranch: '',
  branchVersionControl: undefined,
  githubInstallationId: '',
  githubRepositoryId: '',
  githubRepositoryName: '',
  githubRepositoryCloneUrl: '',
  githubRepositoryDefaultBranch: '',
})

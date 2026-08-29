import { useCallback } from 'react'
import type { AgentSettings, ExecutorRecord, Project } from '@shared/types'
import { WorkspacesCreatePanel } from './workspaces-create-panel'
import {
  useWorkspacesCreateController,
  type WorkspacesCreateControllerOptions,
} from './use-workspaces-create-controller'

type WorkspacesCreatePanelControllerProps = WorkspacesCreateControllerOptions & {
  agentSettings: AgentSettings
  busy: boolean
  executorOptions: ExecutorRecord[]
  projects: Project[]
  selectedWorkspaceId: string
  onBack?: () => void
}

export function WorkspacesCreatePanelController({
  busy,
  agentSettings,
  executorOptions,
  projects,
  selectedWorkspaceId,
  onBack,
  ...controllerOptions
}: WorkspacesCreatePanelControllerProps) {
  const {
    closeCreatePanel: closeCreatePanelFromHook,
    connectGitHubApp,
    createDefaultModel,
    githubAppConfigured,
    githubAppInstallations,
    githubRepositories,
    githubRepositoriesLoading,
    createModelError,
    createModelLoading,
    createModelOptions,
    createState,
    handleCreateWorkspace,
    handleUpdateCreateState,
  } = useWorkspacesCreateController({ ...controllerOptions, agentSettings })

  const closeCreatePanel = useCallback(() => {
    closeCreatePanelFromHook(selectedWorkspaceId)
  }, [closeCreatePanelFromHook, selectedWorkspaceId])

  return (
    <WorkspacesCreatePanel
      busy={busy}
      agentSettings={agentSettings}
      defaultModel={createDefaultModel}
      createState={createState}
      executorOptions={executorOptions}
      githubAppConfigured={githubAppConfigured}
      githubAppInstallations={githubAppInstallations}
      githubRepositories={githubRepositories}
      githubRepositoriesLoading={githubRepositoriesLoading}
      modelError={createModelError}
      modelLoading={createModelLoading}
      modelOptions={createModelOptions}
      projects={projects}
      onConnectGitHubApp={() => { void connectGitHubApp() }}
      onBack={onBack}
      onCancel={closeCreatePanel}
      onCreate={handleCreateWorkspace}
      onUpdate={handleUpdateCreateState}
    />
  )
}

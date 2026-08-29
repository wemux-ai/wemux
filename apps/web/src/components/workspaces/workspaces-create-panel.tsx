import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, GitBranch, Github, HardDrive, Loader2, Plus, Search } from 'lucide-react'
import { mergeAgentRuntimeSettings, normalizeAgentSettings } from '@shared/agent-config'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import { getProjectColor } from '@shared/project-color'
import { isPlaygroundProjectId, PLAYGROUND_PROJECT_ID } from '@shared/playground-workspace'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import type { AgentSettings, ExecutionModelOption, ExecutorRecord, Project, Workspace } from '@shared/types'
import type { GitHubAppInstallationSummary } from '../../lib/api'
import { buildTaskAgentOptions } from '../../lib/agent-runtime-options'
import { isExecutorEffectivelyOnline, isManagedCloudExecutorRecord } from '../../lib/managed-cloud-executor'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  readWorkspaceSessionModelMenuPreferences,
  recordWorkspaceSessionModelMenuSelection,
  writeWorkspaceSessionModelMenuPreferences,
} from '../../lib/workspace-session-model-menu-preferences'
import { Button } from '../ui/button'
import { ExecutorSelect } from '../ui/executor-select'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { SearchableSelect } from '../ui/searchable-select'
import { Switch } from '../ui/switch'
import { WorkspaceCreateComposer } from './workspace-create-composer'
import {
  buildWorkspaceSessionGroupedModelOptions,
  resolveTaskChatModelSummary,
} from './workspace-session-chat/workspace-session-chat-model-derived'
import {
  TaskChatAgentSelector,
  TaskChatModelSelector,
} from './workspace-session-chat/workspace-session-chat-selectors'
import { TaskChatExecutionPermissionControl } from './workspace-session-chat/workspace-session-chat-execution-permission'
import { TaskChatRuntimeSettingsControl } from './workspace-session-chat/workspace-session-chat-runtime-settings'
import { TaskChatWorkspaceBranchControl } from './workspace-session-chat/workspace-session-chat-workspace-branch'
import type { CreateWorkspaceState } from './workspaces-create-state'
import type { WorkspaceGitHubRepositoryOption } from './use-workspaces-create-controller'

export type { CreateWorkspaceState } from './workspaces-create-state'

interface WorkspacesCreatePanelProps {
  busy: boolean
  agentSettings: AgentSettings
  createState: CreateWorkspaceState
  defaultModel: string
  embedded?: boolean
  executorOptions: ExecutorRecord[]
  githubAppConfigured: boolean
  githubAppInstallations: GitHubAppInstallationSummary[]
  githubRepositories: WorkspaceGitHubRepositoryOption[]
  githubRepositoriesLoading: boolean
  modelLoading: boolean
  modelOptions: ExecutionModelOption[]
  modelError?: string
  promptSuggestions?: Array<{ label: string; prompt: string }>
  projects: Project[]
  onConnectGitHubApp?: () => void
  onBack?: () => void
  onCancel: () => void
  onCreate: (options?: { startAgent?: boolean }) => Promise<void>
  onSelectPromptSuggestion?: (prompt: string) => void
  onUpdate: (patch: Partial<CreateWorkspaceState>) => void
}

const resolveProjectCloneBlockReason = (
  project: Project | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  if (project?.repositoryCloneStatus === 'cloning') {
    return t('workspace.createPanel.cloneBlock.inProgress')
  }

  if (project?.repositoryCloneStatus === 'failed') {
    return project.repositoryCloneMessage?.trim()
      ? t('workspace.createPanel.cloneBlock.failedWithMessage', { message: project.repositoryCloneMessage })
      : t('workspace.createPanel.cloneBlock.failed')
  }

  return ''
}

export function WorkspacesCreatePanel({
  busy,
  agentSettings,
  createState,
  defaultModel,
  embedded = false,
  executorOptions,
  githubAppConfigured,
  githubAppInstallations,
  githubRepositories,
  githubRepositoriesLoading,
  modelLoading,
  modelOptions,
  modelError = '',
  promptSuggestions = [],
  projects,
  onConnectGitHubApp,
  onBack,
  onCancel,
  onCreate,
  onSelectPromptSuggestion,
  onUpdate,
}: WorkspacesCreatePanelProps) {
  const { t } = useTranslation()
  const requiresBranch = createState.workingDirectoryMode !== 'original-dir'
  const selectedProject = projects.find((project) => project.id === createState.projectId) ?? null
  const projectCloneBlockReason = resolveProjectCloneBlockReason(selectedProject, t)
  const hasCreateImages = createState.images.length > 0
  const useExistingProject = createState.projectSource !== 'github-app' && createState.projectSource !== 'playground'
  const isPlayground = createState.projectSource === 'playground'
  const githubSourceReady = useExistingProject
    ? true
    : Boolean(
      githubAppConfigured
      && createState.githubInstallationId
      && createState.githubRepositoryId
      && createState.githubRepositoryCloneUrl.trim(),
    )
  const canContinue = Boolean(
    (!useExistingProject || !projectCloneBlockReason)
      && (isPlayground ? true : useExistingProject ? createState.projectId : githubSourceReady)
      && createState.executorId
      && (!requiresBranch || (!createState.branchLoading && createState.selectedBranch)),
  )
  const canCreate = Boolean(canContinue && (createState.initialPrompt.trim() || hasCreateImages))
  const canCreateEmptyWorkspace = Boolean(canContinue && createState.images.length === 0)
  const creating = busy || createState.busy
  const handleCreateImageUpload = (files: File[]) => {
    if (files.length === 0 || creating) {
      return
    }

    const nextImages = files
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => {
        const previewUrl = URL.createObjectURL(file)
        return {
          id: crypto.randomUUID(),
          url: previewUrl,
          previewUrl,
          filename: file.name,
          contentType: file.type || undefined,
          file,
        }
      })
    if (nextImages.length === 0) {
      return
    }

    onUpdate({ images: [...createState.images, ...nextImages] })
  }
  const handleRemoveCreateImage = (id: string) => {
    const targetImage = createState.images.find((image) => image.id === id)
    if (targetImage?.previewUrl) {
      URL.revokeObjectURL(targetImage.previewUrl)
    }
    onUpdate({ images: createState.images.filter((image) => image.id !== id) })
  }

  return (
    <main className={embedded ? 'text-zinc-100' : 'flex h-full min-h-0 flex-col overflow-hidden bg-[#050505] text-zinc-100'}>
      <WorkspaceSuggestionMarqueeStyle />
      {embedded ? null : <CreatePanelHeader onBack={onBack} onCancel={onCancel} />}

      <div className={embedded ? '' : 'flex min-h-0 flex-1 overflow-y-auto'}>
        <div className={embedded ? 'mx-auto w-full max-w-4xl' : 'mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-5 py-6 sm:px-6 sm:py-8'}>
          <section className="mb-5 text-center">
            <h2 className="text-xl font-medium tracking-tight text-zinc-50 sm:text-[1.65rem]">
              {t('workspace.createPanel.heroTitle')}
            </h2>
          </section>

          {promptSuggestions.length > 0 ? (
            <div className="mb-3 flex justify-center">
              <div className="w-full max-w-[42rem] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
                <div className="flex w-max gap-2 animate-[workspace-suggestion-marquee_32s_linear_infinite] hover:[animation-play-state:paused]">
                  {[...promptSuggestions, ...promptSuggestions].map((suggestion, index) => (
                    <button
                      key={`${suggestion.prompt}-${index}`}
                      type="button"
                      onClick={() => onSelectPromptSuggestion?.(suggestion.prompt)}
                      disabled={creating}
                      className="shrink-0 rounded-full border border-zinc-800/90 bg-zinc-950/85 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <WorkspaceCreateComposer
            input={createState.initialPrompt}
            onInputChange={(value) => onUpdate({ initialPrompt: value })}
            onSubmit={() => onCreate({ startAgent: true })}
            onPasteImages={handleCreateImageUpload}
            onUploadImages={handleCreateImageUpload}
            isUploading={createState.images.some((image) => image.uploadState === 'uploading')}
            busy={creating}
            sendDisabled={!canCreate || creating}
            images={createState.images}
            imagesLocked={creating}
            onRemoveImage={handleRemoveCreateImage}
            footerControls={(
              <CreateComposerFooterControls
                createState={createState}
                agentSettings={agentSettings}
                canCreateEmptyWorkspace={canCreateEmptyWorkspace}
                creating={creating}
                defaultModel={defaultModel}
                executorOptions={executorOptions}
                githubAppConfigured={githubAppConfigured}
                githubAppInstallations={githubAppInstallations}
                githubRepositories={githubRepositories}
                githubRepositoriesLoading={githubRepositoriesLoading}
                modelLoading={modelLoading}
                modelOptions={modelOptions}
                modelError={modelError}
                projects={projects}
                projectCloneBlockReason={projectCloneBlockReason}
                onConnectGitHubApp={onConnectGitHubApp}
                onCreateEmptyWorkspace={() => onCreate({ startAgent: false })}
                onUpdate={onUpdate}
              />
            )}
          />
        </div>
      </div>
    </main>
  )
}

function WorkspaceSuggestionMarqueeStyle() {
  return (
    <style>{`
      @keyframes workspace-suggestion-marquee {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
    `}</style>
  )
}

function CreatePanelHeader({
  onBack,
  onCancel,
}: {
  onBack?: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 bg-[#060607] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
          {t('workspace.createPanel.badge')}
        </span>
        <span className="text-zinc-700">/</span>
        <h1 className="truncate text-sm font-semibold text-zinc-100">
          {t('workspace.createPanel.title')}
        </h1>
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        className="h-7 rounded-md px-2.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
      >
        {t('common.cancel')}
      </Button>
    </div>
  )
}

function CreateComposerFooterControls({
  createState,
  agentSettings,
  canCreateEmptyWorkspace,
  creating,
  defaultModel,
  executorOptions,
  githubAppConfigured,
  githubAppInstallations,
  githubRepositories,
  githubRepositoriesLoading,
  modelLoading,
  modelOptions,
  modelError = '',
  projectCloneBlockReason,
  projects,
  onConnectGitHubApp,
  onCreateEmptyWorkspace,
  onUpdate,
}: {
  createState: CreateWorkspaceState
  agentSettings: AgentSettings
  canCreateEmptyWorkspace: boolean
  creating: boolean
  defaultModel: string
  executorOptions: ExecutorRecord[]
  githubAppConfigured: boolean
  githubAppInstallations: GitHubAppInstallationSummary[]
  githubRepositories: WorkspaceGitHubRepositoryOption[]
  githubRepositoriesLoading: boolean
  modelLoading: boolean
  modelOptions: ExecutionModelOption[]
  modelError?: string
  projectCloneBlockReason: string
  projects: Project[]
  onConnectGitHubApp?: () => void
  onCreateEmptyWorkspace: () => Promise<void>
  onUpdate: (patch: Partial<CreateWorkspaceState>) => void
}) {
  const { t } = useTranslation()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelMenuPreferences, setModelMenuPreferences] = useState(() => readWorkspaceSessionModelMenuPreferences())
  const agentOptions = useMemo(() => buildTaskAgentOptions(), [])
  const requiresBranch = createState.workingDirectoryMode !== 'original-dir'
  const autoCommitSwitchId = 'workspace-create-auto-commit'
  const selectedProject = projects.find((project) => project.id === createState.projectId) ?? null
  const effectiveVersionControl = createState.branchVersionControl ?? selectedProject?.versionControl
  const worktreeDisabled = effectiveVersionControl === 'none'
  const useExistingProject = createState.projectSource !== 'github-app' && createState.projectSource !== 'playground'
  const isPlayground = createState.projectSource === 'playground'
  const selectedProjectExecutorId = selectedProject?.preferredExecutorId?.trim() || ''
  const selectedProjectExecutor = selectedProjectExecutorId
    ? executorOptions.find((executor) => executor.executorId === selectedProjectExecutorId)
    : null
  const selectedProjectOwnedByAnotherExecutor = Boolean(
    selectedProject
      && selectedProject.versionControl !== 'git-remote'
      && selectedProjectExecutorId
      && createState.executorId
      && selectedProjectExecutorId !== createState.executorId,
  )
  const autoCommitDisabled = effectiveVersionControl === 'none'
  const visibleSelectedModel = resolveMatchingAgentExecutionModelOptionId(
    createState.agentType,
    modelOptions,
    createState.executionModel,
  )
  const visibleDefaultModel = resolveMatchingAgentExecutionModelOptionId(
    createState.agentType,
    modelOptions,
    defaultModel,
  ) || defaultModel
  const groupedModelOptions = useMemo(() => buildWorkspaceSessionGroupedModelOptions({
    modelMenuPreferences,
    modelOptions,
    visibleDefaultModel,
    visibleSelectedModel,
  }), [modelMenuPreferences, modelOptions, visibleDefaultModel, visibleSelectedModel])
  const hasUnavailableSelectedModel = Boolean(createState.executionModel) && !visibleSelectedModel
  const modelSummary = resolveTaskChatModelSummary({
    modelOptions,
    visibleDefaultModel,
    visibleSelectedModel,
  })
  const selectedRuntimeSettings = useMemo(() => {
    const normalizedAgentSettings = normalizeAgentSettings(agentSettings)
    return mergeAgentRuntimeSettings(
      createState.agentType,
      normalizedAgentSettings[createState.agentType],
      createState.agentSettings,
    )
  }, [agentSettings, createState.agentSettings, createState.agentType])
  const contextTriggerClassName = 'h-7 w-auto max-w-[14rem] rounded-md border-0 bg-transparent px-2 text-xs text-zinc-400 shadow-none hover:bg-zinc-900 hover:text-zinc-100 focus:ring-0'

  const selectedGitHubInstallation = githubAppInstallations.find((installation) => String(installation.installationId) === createState.githubInstallationId) ?? null
  const selectedGitHubRepository = githubRepositories.find((repository) => String(repository.id) === createState.githubRepositoryId) ?? null
  const hasGitHubConnection = githubAppInstallations.length > 0
  const shouldShowConnectGitHubAction = !hasGitHubConnection
  const projectSelectEmptyText = shouldShowConnectGitHubAction
    ? t('workspace.createPanel.empty.noProjectsWithGitHubAction')
    : t('workspace.createPanel.empty.noProjects')
  const projectSelectOptions = useMemo(() => [
    {
      value: 'playground',
      label: t('workspace.createPanel.playgroundLabel', { defaultValue: '自由工作区' }),
      description: t('workspace.createPanel.playgroundDescription', { defaultValue: '不绑定项目，在临时目录中自由工作' }),
      keywords: ['自由工作区', '临时', 'playground', 'free'],
      source: 'playground' as const,
    },
    ...projects
      .filter((project) => !isPlaygroundProjectId(project.id))
      .map((project) => ({
        value: `project:${project.id}`,
        label: project.name,
        color: getProjectColor(project),
        description: project.repositoryCloneStatus === 'cloning'
          ? t('workspace.createPanel.cloneBlock.projectOptionCloning')
          : project.repositoryCloneStatus === 'failed'
            ? t('workspace.createPanel.cloneBlock.projectOptionFailed')
            : t('workspace.createPanel.projectDefaultBranch', { branch: project.defaultBranch || 'main' }),
        disabled: Boolean(project.repositoryCloneStatus),
        source: 'project' as const,
      })),
    ...githubRepositories.map((repository) => ({
      value: `github:${repository.installationId}:${repository.id}`,
      label: repository.fullName,
      icon: <Github className="h-3.5 w-3.5 text-zinc-500" />,
      description: `${repository.installationAccountLogin} · ${repository.defaultBranch ?? 'default branch'} · ${repository.private ? 'private' : 'public'}`,
      badgeLabel: 'GitHub',
      keywords: [repository.name, repository.ownerLogin, repository.defaultBranch, repository.cloneUrl, repository.installationAccountLogin],
      disabled: repository.disabled,
      source: 'github' as const,
      repository,
    })),
  ], [githubRepositories, projects, t])
  const selectedProjectSelectValue = isPlayground
    ? 'playground'
    : useExistingProject
      ? (createState.projectId ? `project:${createState.projectId}` : '')
      : (createState.githubRepositoryId && createState.githubInstallationId
          ? `github:${createState.githubInstallationId}:${createState.githubRepositoryId}`
          : '')

  return (
    <div className="border-t border-zinc-900 px-1.5 pb-0.5 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <TaskChatExecutionPermissionControl
          agentType={createState.agentType}
          settings={selectedRuntimeSettings}
          disabled={createState.busy || modelLoading}
          saving={createState.busy}
          onChange={(nextSettings) => onUpdate({ agentSettings: nextSettings })}
        />
        <TaskChatAgentSelector
          open={agentMenuOpen}
          onOpenChange={setAgentMenuOpen}
          saving={createState.busy}
          modelSaving={modelLoading}
          selectedAgentType={createState.agentType}
          agentOptions={agentOptions}
          onSelectAgent={(agentType) => {
            setAgentMenuOpen(false)
            onUpdate({ agentType, executionModel: '' })
          }}
        />
        <TaskChatModelSelector
          open={modelMenuOpen}
          onOpenChange={setModelMenuOpen}
          disabled={createState.busy || modelLoading}
          selectedModel={createState.executionModel}
          visibleSelectedModel={visibleSelectedModel}
          defaultModel={visibleDefaultModel}
          hasUnavailableSelectedModel={hasUnavailableSelectedModel}
          groupedModelOptions={groupedModelOptions}
          modelSummary={modelLoading ? '加载模型...' : modelSummary.modelSummary}
          modelSummaryTitle={modelSummary.modelSummaryTitle}
          modelSummaryHint=""
          modelMeta={modelLoading ? '加载中' : modelError ? '加载失败' : modelOptions.length > 0 ? `${modelOptions.length} 个模型` : '系统默认'}
          onSelectModel={(modelId) => {
            setModelMenuOpen(false)
            onUpdate({ executionModel: modelId })
            const matchedModel = modelOptions.find((model) => model.id === modelId)
            const nextPreferences = recordWorkspaceSessionModelMenuSelection(modelMenuPreferences, matchedModel)
            if (nextPreferences !== modelMenuPreferences) {
              setModelMenuPreferences(nextPreferences)
              writeWorkspaceSessionModelMenuPreferences(nextPreferences)
            }
          }}
        />
        <TaskChatRuntimeSettingsControl
          agentType={createState.agentType}
          settings={selectedRuntimeSettings}
          disabled={createState.busy || modelLoading}
          saving={createState.busy}
          onChange={(nextSettings) => onUpdate({ agentSettings: nextSettings })}
        />
      </div>

      <div className="mt-2 border-t border-zinc-900 px-1 py-1.5">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <ProjectSourceSelect
            value={selectedProjectSelectValue}
            options={projectSelectOptions}
            placeholder={t('workspace.createPanel.placeholders.selectProject')}
            searchPlaceholder={t('workspace.createPanel.placeholders.searchProject')}
            emptyText={projectSelectEmptyText}
            triggerClassName={contextTriggerClassName}
            contentClassName="w-72"
            loading={githubRepositoriesLoading}
            connectGitHubLabel={shouldShowConnectGitHubAction ? t('workspace.createPanel.connectGitHubApp') : undefined}
            onConnectGitHub={shouldShowConnectGitHubAction ? onConnectGitHubApp : undefined}
            onChange={(value) => {
              if (value === 'playground') {
                onUpdate({ projectSource: 'playground', projectId: PLAYGROUND_PROJECT_ID })
                return
              }

              if (value.startsWith('project:')) {
                const projectId = value.slice('project:'.length)
                onUpdate({ projectSource: 'existing', projectId })
                return
              }

              if (!value.startsWith('github:')) {
                return
              }

              const [, installationId, repositoryId] = value.split(':')
              const repository = githubRepositories.find((item) => (
                String(item.installationId) === installationId && String(item.id) === repositoryId
              )) ?? null
              onUpdate({
                projectSource: 'github-app',
                projectId: '',
                githubInstallationId: installationId || '',
                githubRepositoryId: repository ? String(repository.id) : '',
                githubRepositoryName: repository?.fullName ?? '',
                githubRepositoryCloneUrl: repository?.cloneUrl ?? '',
                githubRepositoryDefaultBranch: repository?.defaultBranch ?? '',
                branchOptions: repository?.defaultBranch ? [repository.defaultBranch] : [],
                selectedBranch: repository?.defaultBranch ?? '',
                defaultBranch: repository?.defaultBranch ?? '',
                branchMessage: repository?.defaultBranch ? '' : t('workspace.createPanel.githubRepositoryMissingDefaultBranch'),
                branchVersionControl: 'git-remote',
              })
            }}
          />

          <ExecutorSelect
            value={createState.executorId}
            options={executorOptions.map((executor) => ({
              value: executor.executorId,
              label: executor.name,
              description: isManagedCloudExecutorRecord(executor)
                ? t('workspace.createPanel.executorDescriptions.managedCloudHint')
                : selectedProject?.versionControl !== 'git-remote'
                  && selectedProjectExecutorId
                  && executor.executorId !== selectedProjectExecutorId
                  ? t('workspace.createPanel.executorDescriptions.localProjectBlocked', { owner: selectedProjectExecutor?.name || selectedProjectExecutorId })
                  : executor.machineName,
              disabled: selectedProject?.versionControl !== 'git-remote'
                && Boolean(selectedProjectExecutorId)
                && executor.executorId !== selectedProjectExecutorId,
              statusTone: isExecutorEffectivelyOnline(executor) ? 'online' : executor.status === 'paired' ? 'busy' : 'offline',
            }))}
            placeholder={t('workspace.createPanel.placeholders.selectExecutor')}
            searchPlaceholder={t('workspace.createPanel.placeholders.searchExecutor')}
            emptyText={t('workspace.createPanel.empty.noExecutors')}
            compact
            triggerClassName={contextTriggerClassName}
            contentClassName="w-72"
            onChange={(value) => onUpdate({ executorId: value })}
          />

          <SearchableSelect
            value={createState.workingDirectoryMode}
            options={[
              {
                value: 'worktree',
                label: t('workspace.labels.directory.worktree'),
                icon: <HardDrive className="h-3.5 w-3.5 text-zinc-500" />,
                description: worktreeDisabled
                  ? t('workspace.createPanel.branchMessages.originalDirDirect')
                  : t('workspace.createPanel.directoryDescriptions.worktree'),
                disabled: worktreeDisabled,
              },
              {
                value: 'original-dir',
                label: t('workspace.labels.directory.originalDir'),
                icon: <HardDrive className="h-3.5 w-3.5 text-zinc-500" />,
                description: t('workspace.createPanel.directoryDescriptions.originalDir'),
              },
            ]}
            placeholder={t('workspace.createPanel.placeholders.selectDirectoryMode')}
            searchPlaceholder={t('workspace.createPanel.placeholders.searchDirectoryMode')}
            emptyText={t('workspace.createPanel.empty.noDirectoryModes')}
            triggerClassName={contextTriggerClassName}
            contentClassName="w-72"
            onChange={(value) => onUpdate({ workingDirectoryMode: value as Workspace['workingDirectoryMode'] })}
          />

          {requiresBranch ? (
            <TaskChatWorkspaceBranchControl
              mode={createState.workingDirectoryMode}
              value={createState.selectedBranch}
              selectedBranch={createState.selectedBranch}
              options={createState.branchOptions}
              branchSources={createState.branchSources}
              remoteOnly={isManagedCloudAutoExecutorId(createState.executorId) || createState.executorId.startsWith('managed-cloud')}
              disabled={createState.branchLoading || createState.branchOptions.length === 0}
              loading={createState.branchLoading}
              message={createState.branchMessage || t('workspace.createPanel.directoryDescriptions.worktree')}
              triggerClassName={`${contextTriggerClassName} max-w-[11rem]`}
              onChange={(branchName) => onUpdate({ selectedBranch: branchName })}
            />
          ) : (
            <div
              className="flex h-7 max-w-[11rem] items-center gap-1.5 truncate rounded-lg px-2 text-xs text-zinc-500"
              title={worktreeDisabled ? t('workspace.createPanel.branchMessages.nonGitProject') : undefined}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {worktreeDisabled
                  ? t('workspace.createPanel.nonGitBranchHint')
                  : t('workspace.createPanel.originalDirBranchHint')}
              </span>
            </div>
          )}

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              disabled={!canCreateEmptyWorkspace || creating}
              onClick={() => { void onCreateEmptyWorkspace() }}
              className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? t('workspace.createPanel.creating') : t('workspace.createPanel.createEmptyWorkspace')}
            </Button>

            <label
              htmlFor={autoCommitSwitchId}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
              title={autoCommitDisabled ? t('workspace.createPanel.autoCommitDescriptions.noGit') : undefined}
            >
            <span className="min-w-0 truncate">
              {t('workspace.createPanel.autoCommitStates.shortLabel')}
            </span>
            <Switch
              id={autoCommitSwitchId}
              checked={autoCommitDisabled ? false : createState.autoCommitEnabled}
              disabled={autoCommitDisabled}
              onCheckedChange={(checked) => onUpdate({ autoCommitEnabled: checked })}
              className="scale-90 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700"
            />
            </label>
          </div>
        </div>
        <BranchHint createState={createState} />

        {projectCloneBlockReason || selectedProjectOwnedByAnotherExecutor || modelError || (!useExistingProject && (!githubAppConfigured || !selectedGitHubInstallation)) ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-400">
            {modelError ? (
              <span className="text-amber-300">{modelError}</span>
            ) : null}
            {projectCloneBlockReason ? (
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                {selectedProject?.repositoryCloneStatus === 'cloning'
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <AlertTriangle className="h-3 w-3" />}
                {projectCloneBlockReason}
              </span>
            ) : null}
            {selectedProjectOwnedByAnotherExecutor ? (
              <span className="text-amber-300">{t('workspace.createPanel.executorWarnings.localProjectOwner', { owner: selectedProjectExecutor?.name || selectedProjectExecutorId })}</span>
            ) : null}
            {!useExistingProject && !githubAppConfigured ? (
              <span className="text-amber-300">{t('workspace.createPanel.githubImportUnavailable')}</span>
            ) : null}
            {!useExistingProject && selectedGitHubInstallation && !selectedGitHubRepository ? (
              <span className="text-zinc-400">
                {t('workspace.createPanel.githubRepositoryHint', { account: selectedGitHubInstallation.accountLogin })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

type ProjectSourceOption = {
  value: string
  label: string
  description?: string
  badgeLabel?: string
  color?: string
  icon?: ReactNode
  keywords?: Array<string | undefined>
  disabled?: boolean
  source: 'project' | 'github' | 'playground'
}

function ProjectSourceSelect({
  value,
  options,
  placeholder,
  emptyText,
  searchPlaceholder,
  loading = false,
  triggerClassName,
  contentClassName,
  connectGitHubLabel,
  onConnectGitHub,
  onChange,
}: {
  value: string
  options: ProjectSourceOption[]
  placeholder: string
  emptyText: string
  searchPlaceholder?: string
  loading?: boolean
  triggerClassName?: string
  contentClassName?: string
  connectGitHubLabel?: string
  onConnectGitHub?: () => void
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return options.filter((option) => {
      if (!normalizedQuery) {
        return true
      }
      const haystack = [option.label, option.description, ...(option.keywords ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [options, query])

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        setQuery('')
      }
    }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 w-auto max-w-[18rem] items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2 text-left text-xs text-zinc-400 shadow-none outline-none hover:bg-zinc-900 hover:text-zinc-100 focus:ring-0',
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedOption?.color ? <span aria-hidden className="size-3.5 shrink-0 rounded-sm" style={{ backgroundColor: selectedOption.color }} /> : null}
            {!selectedOption?.color && selectedOption?.icon ? <span className="shrink-0">{selectedOption.icon}</span> : null}
            <span className={cn('min-w-0 truncate', selectedOption ? '' : 'text-zinc-500')}>
              {selectedOption?.label ?? placeholder}
            </span>
            {selectedOption?.badgeLabel ? (
              <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                {selectedOption.badgeLabel}
              </span>
            ) : null}
          </span>
          <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          // Portal to body so parent overflow does not clip the menu; sit above Dialog (z-50).
          'z-[100] flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),18rem)] max-w-[min(28rem,var(--radix-popover-content-available-width))] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#0b0b0d] p-0 text-zinc-100 shadow-2xl shadow-black/40',
          contentClassName,
        )}
      >
          <div className="border-b border-zinc-800 p-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/90 px-2.5">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder ?? placeholder}
                className="h-8 w-full bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>正在读取 GitHub 仓库...</span>
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const active = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) {
                        return
                      }
                      onChange(option.value)
                      setOpen(false)
                      setQuery('')
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-emerald-500/12 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50',
                      option.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {option.color ? <span aria-hidden className="size-3.5 shrink-0 rounded-sm" style={{ backgroundColor: option.color }} /> : null}
                      {!option.color && option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{option.label}</span>
                        {option.description ? (
                          <span className="mt-0.5 block text-[11px] text-zinc-500">{option.description}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {option.badgeLabel ? (
                        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                          {option.badgeLabel}
                        </span>
                      ) : null}
                      {active ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>
          {connectGitHubLabel && onConnectGitHub ? (
            <div className="border-t border-zinc-800 p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setQuery('')
                  onConnectGitHub()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-amber-300 transition-colors hover:bg-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{connectGitHubLabel}</span>
              </button>
            </div>
          ) : null}
        </PopoverContent>
    </Popover>
  )
}

function BranchHint({ createState }: { createState: CreateWorkspaceState }) {
  const { t } = useTranslation()
  if (createState.workingDirectoryMode === 'original-dir') {
    return null
  }

  if (createState.branchLoading) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('workspace.createPanel.branchHints.loading')}
      </p>
    )
  }

  if (createState.branchMessage) {
    return <p className="text-[11px] leading-5 text-zinc-400">{createState.branchMessage}</p>
  }

  if (createState.branchOptions.length === 0) {
    return <p className="text-[11px] leading-5 text-zinc-400">{t('workspace.createPanel.branchHints.waitForProjectAndExecutor')}</p>
  }

  return null
}

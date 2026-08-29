import type { ExecutorRecord, ExecutionModelOption, Task, Workspace } from '@shared/types'
import { ChevronRight, FolderGit2, GitBranch, HardDrive, X } from 'lucide-react'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import { buildTaskAgentOptions } from '../../lib/agent-runtime-options'
import { ExecutorSelect } from '../../components/ui/executor-select'
import { RuntimeIcon } from '../../components/runtime/runtime-icons'
import { SearchableSelect } from '../../components/ui/searchable-select'
import { WorkspaceCreateComposer } from '../workspaces/workspace-create-composer'
import { TaskChatWorkspaceBranchControl } from '../workspaces/workspace-session-chat/workspace-session-chat-workspace-branch'

interface ModelOption {
  id: string
  modelId: string
  providerId: string
  isDefault?: boolean
  source?: ExecutionModelOption['source']
}

interface TaskWorkspaceCreatePanelProps {
  task: Task
  projectName?: string
  executors: ExecutorRecord[]
  preferredExecutorName: string
  workspaceWorkingDirectoryMode: Workspace['workingDirectoryMode']
  workspaceExecutionModel: string
  workspaceAgentType: Task['agentType']
  activeExecutorId: string
  selectedBranch: string
  newWorkspaceName: string
  defaultModel: string
  modelMessage: string
  modelOptions: ModelOption[]
  modelLoading: boolean
  branchOptions: string[]
  branchSources?: Record<string, 'remote' | 'local-only'>
  branchLoading: boolean
  branchMessage: string
  createBlockedReason?: string
  workspaceConfigReady: boolean
  launchingWorkspace: boolean
  busy: boolean
  onBack: () => void
  onNameChange: (value: string) => void
  onWorkingDirectoryModeChange: (value: Workspace['workingDirectoryMode']) => void
  onAgentTypeChange: (value: Task['agentType']) => void
  onModelChange: (value: string) => void
  onBranchChange: (value: string) => void
  onExecutorChange: (value: string) => void
  onSubmit: () => void
}

export function TaskWorkspaceCreatePanel({
  task,
  projectName,
  executors,
  preferredExecutorName,
  workspaceWorkingDirectoryMode,
  workspaceExecutionModel,
  workspaceAgentType,
  activeExecutorId,
  selectedBranch,
  newWorkspaceName,
  defaultModel,
  modelMessage,
  modelOptions,
  modelLoading,
  branchOptions,
  branchSources,
  branchLoading,
  branchMessage,
  createBlockedReason = '',
  workspaceConfigReady,
  launchingWorkspace,
  busy,
  onBack,
  onNameChange,
  onWorkingDirectoryModeChange,
  onAgentTypeChange,
  onModelChange,
  onBranchChange,
  onExecutorChange,
  onSubmit,
}: TaskWorkspaceCreatePanelProps) {
  const requiresBranch = workspaceWorkingDirectoryMode !== 'original-dir'
  const canSubmit = Boolean(!createBlockedReason && workspaceConfigReady && (!requiresBranch || selectedBranch) && newWorkspaceName.trim())
  const creating = busy || launchingWorkspace

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050505]">
      <CreatePanelHeader taskTitle={task.title} onBack={onBack} />

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-6 sm:px-6 sm:py-8">
          <section className="mb-6 text-center">
            <h2 className="text-xl font-medium tracking-normal text-zinc-50 sm:text-2xl">
              创建这个任务的工作区
            </h2>
          </section>

          <WorkspaceCreateComposer
            input={newWorkspaceName}
            onInputChange={onNameChange}
            onSubmit={onSubmit}
            busy={creating}
            sendDisabled={!canSubmit || creating}
            showUpload={false}
            placeholder="工作区标题，或直接写这次要做什么"
            footerControls={(
              <TaskWorkspaceCreateFooterControls
                activeExecutorId={activeExecutorId}
                branchLoading={branchLoading}
                branchMessage={branchMessage}
                branchOptions={branchOptions}
                branchSources={branchSources}
                createBlockedReason={createBlockedReason}
                defaultModel={defaultModel}
                executors={executors}
                modelLoading={modelLoading}
                modelMessage={modelMessage}
                modelOptions={modelOptions}
                preferredExecutorName={preferredExecutorName}
                projectName={projectName || task.projectId}
                requiresBranch={requiresBranch}
                selectedBranch={selectedBranch}
                task={task}
                workspaceAgentType={workspaceAgentType}
                workspaceConfigReady={workspaceConfigReady}
                workspaceExecutionModel={workspaceExecutionModel}
                workspaceWorkingDirectoryMode={workspaceWorkingDirectoryMode}
                onAgentTypeChange={onAgentTypeChange}
                onBranchChange={onBranchChange}
                onExecutorChange={onExecutorChange}
                onModelChange={onModelChange}
                onWorkingDirectoryModeChange={onWorkingDirectoryModeChange}
              />
            )}
          />
        </div>
      </div>
    </div>
  )
}

function CreatePanelHeader({
  taskTitle,
  onBack,
}: {
  taskTitle: string
  onBack: () => void
}) {
  return (
    <div className="shrink-0 border-b border-zinc-900 px-4 py-2.5 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
            工作区
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-700" />
          <button
            type="button"
            onClick={onBack}
            className="min-w-0 truncate rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
          >
            {taskTitle || 'Task'}
          </button>
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-700" />
          <span className="min-w-0 truncate text-sm font-medium text-zinc-100">
            创建工作区
          </span>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function TaskWorkspaceCreateFooterControls({
  activeExecutorId,
  branchLoading,
  branchMessage,
  branchOptions,
  branchSources,
  createBlockedReason,
  defaultModel,
  executors,
  modelLoading,
  modelMessage,
  modelOptions,
  preferredExecutorName,
  projectName,
  requiresBranch,
  selectedBranch,
  task,
  workspaceAgentType,
  workspaceConfigReady,
  workspaceExecutionModel,
  workspaceWorkingDirectoryMode,
  onAgentTypeChange,
  onBranchChange,
  onExecutorChange,
  onModelChange,
  onWorkingDirectoryModeChange,
}: {
  activeExecutorId: string
  branchLoading: boolean
  branchMessage: string
  branchOptions: string[]
  branchSources?: Record<string, 'remote' | 'local-only'>
  createBlockedReason: string
  defaultModel: string
  executors: ExecutorRecord[]
  modelLoading: boolean
  modelMessage: string
  modelOptions: ModelOption[]
  preferredExecutorName: string
  projectName: string
  requiresBranch: boolean
  selectedBranch: string
  task: Task
  workspaceAgentType: Task['agentType']
  workspaceConfigReady: boolean
  workspaceExecutionModel: string
  workspaceWorkingDirectoryMode: Workspace['workingDirectoryMode']
  onAgentTypeChange: (value: Task['agentType']) => void
  onBranchChange: (value: string) => void
  onExecutorChange: (value: string) => void
  onModelChange: (value: string) => void
  onWorkingDirectoryModeChange: (value: Workspace['workingDirectoryMode']) => void
}) {
  const agentOptions = buildTaskAgentOptions()
  const contextTriggerClassName = 'h-7 w-auto max-w-[14rem] rounded-md border-0 bg-transparent px-2 text-xs text-zinc-400 shadow-none hover:bg-zinc-900 hover:text-zinc-100 focus:ring-0'

  return (
    <div className="border-t border-zinc-900 px-1.5 pb-0.5 pt-2">
      <div className="flex flex-wrap items-center gap-1">
        <SearchableSelect
          value={workspaceAgentType}
          options={agentOptions.map((option) => ({
            ...option,
            icon: <RuntimeIcon runtime={option.value} size={15} />,
          }))}
          placeholder="选择 Agent"
          searchPlaceholder="搜索 Agent"
          emptyText="没有匹配的 Agent"
          triggerClassName={contextTriggerClassName}
          contentClassName="w-72"
          onChange={(value) => onAgentTypeChange(value as Task['agentType'])}
        />

        <SearchableSelect
          value={workspaceExecutionModel}
          options={[
            { value: '', label: `默认模型${defaultModel ? `（${defaultModel}）` : ''}` },
            ...modelOptions.map((model) => ({
              value: model.id,
              label: `${model.providerId}/${model.modelId}`,
              description: model.isDefault ? '默认' : undefined,
              badgeLabel: model.source === 'hosted' ? '官方' : undefined,
              keywords: [model.providerId, model.modelId],
            })),
          ]}
          placeholder={modelLoading ? '读取中...' : `默认模型${defaultModel ? `（${defaultModel}）` : ''}`}
          searchPlaceholder="搜索模型"
          emptyText="没有匹配的模型"
          disabled={!workspaceConfigReady}
          triggerClassName={contextTriggerClassName}
          contentClassName="w-80"
          onChange={onModelChange}
        />
      </div>

      <div className="mt-2 border-t border-zinc-900 px-1 py-1.5">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="flex h-7 max-w-[10rem] items-center gap-1.5 truncate rounded-md px-2 text-xs text-zinc-500" title={projectName}>
            <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{projectName}</span>
          </span>

          <ExecutorSelect
            value={activeExecutorId}
            options={executors.map((executor) => ({
              value: executor.executorId,
              label: executor.name,
              description: executor.machineName,
              keywords: [executor.machineName],
              statusTone: executor.status === 'online' ? 'online' : 'offline',
            }))}
            placeholder={preferredExecutorName || '选择节点'}
            searchPlaceholder="搜索节点"
            emptyText="没有匹配的节点"
            compact
            triggerClassName={contextTriggerClassName}
            contentClassName="w-72"
            onChange={onExecutorChange}
          />

          <SearchableSelect
            value={workspaceWorkingDirectoryMode}
            options={[
              {
                value: 'worktree',
                label: '隔离目录（worktree）',
                icon: <HardDrive className="h-3.5 w-3.5 text-zinc-500" />,
                description: '适合并行会话与安全试验',
              },
              {
                value: 'original-dir',
                label: '原始目录',
                icon: <HardDrive className="h-3.5 w-3.5 text-zinc-500" />,
                description: '直接复用当前仓库目录',
              },
            ]}
            placeholder="选择目录模式"
            searchPlaceholder="搜索目录模式"
            emptyText="没有匹配的目录模式"
            triggerClassName={contextTriggerClassName}
            contentClassName="w-72"
            onChange={(value) => onWorkingDirectoryModeChange(value as Workspace['workingDirectoryMode'])}
          />

          {requiresBranch ? (
            <TaskChatWorkspaceBranchControl
              mode={workspaceWorkingDirectoryMode}
              value={selectedBranch}
              selectedBranch={selectedBranch}
              options={branchOptions}
              branchSources={branchSources}
              remoteOnly={isManagedCloudAutoExecutorId(activeExecutorId) || activeExecutorId.startsWith('managed-cloud')}
              disabled={branchLoading || branchOptions.length === 0}
              loading={branchLoading}
              message={branchMessage || modelMessage || (task.baseBranchHint ? `建议从 ${task.baseBranchHint} 开始。` : '优先选择本次任务的基线分支。')}
              triggerClassName={`${contextTriggerClassName} max-w-[11rem]`}
              onChange={onBranchChange}
            />
          ) : (
            <div className="flex h-7 max-w-[11rem] items-center gap-1.5 truncate rounded-md px-2 text-xs text-zinc-500">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">使用当前分支</span>
            </div>
          )}
        </div>

        {createBlockedReason || branchMessage || modelMessage ? (
          <p className="mt-1.5 truncate px-2 text-[11px] text-zinc-600">
            {createBlockedReason || branchMessage || modelMessage}
          </p>
        ) : null}
      </div>
    </div>
  )
}

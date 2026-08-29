// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: workspace-session composer settings, loading states, and selection callbacks
// OUTPUT: compact footer controls for execution, node, branch, skill, and MCP configuration
// POS: workspace session chat composer's settings toolbar

import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import type { McpServerPolicy } from '@shared/mcp'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import type { SkillRecord } from '@shared/skill'
import type { AgentRuntimeSettings, Project, Task, Workspace } from '@shared/types'
import type { TaskAgentOption } from '../../../lib/agent-runtime-options'
import { insertSkillMentionToken } from '../../../lib/skill-mentions'
import { SkillMentionPicker } from '../../chat/skill-mention-picker'
import { TaskChatExecutionPermissionControl } from './workspace-session-chat-execution-permission'
import { TaskChatMcpSettingsControl } from './workspace-session-chat-mcp-settings'
import { TaskChatRuntimeSettingsControl } from './workspace-session-chat-runtime-settings'
import { TaskChatWorkspaceBranchControl } from './workspace-session-chat-workspace-branch'
import {
  TaskChatAgentSelector,
  TaskChatExecutorSelector,
  TaskChatModelSelector,
  type ExecutorCardItem,
  type GroupedModelOptionGroup,
} from './workspace-session-chat-selectors'

interface TaskChatFooterControlsProps {
  activeExecutorName?: string
  agentMenuOpen: boolean
  agentOptions: TaskAgentOption[]
  agentSaving: boolean
  availableMcpServers: McpServerPolicy[]
  busy: boolean
  defaultModel: string
  effectiveExecutorId: string
  executorCards: ExecutorCardItem[]
  executorMenuOpen: boolean
  executorSaving: boolean
  groupedModelOptions: GroupedModelOptionGroup[]
  hasUnavailableSelectedModel: boolean
  input: string
  mentionSkills: SkillRecord[]
  mentionSkillsLoading: boolean
  mcpSettingsSaving: boolean
  modelDisabled: boolean
  modelMenuOpen: boolean
  modelMeta: string
  modelSaving: boolean
  modelSummary: string
  modelSummaryHint: string
  modelSummaryTitle: string
  runtimeSettingsDisabled: boolean
  runtimeSettingsSaving: boolean
  selectedAgentType: Task['agentType']
  selectedMcpServerIds: string[]
  selectedModel: string
  selectedRuntimeSettings: AgentRuntimeSettings
  visibleSelectedModel: string
  workspaceId?: string
  isSessionBusy: boolean
  workspaceWorkingDirectoryMode?: Workspace['workingDirectoryMode']
  workspaceVersionControl?: Project['versionControl']
  workspaceBranchName?: string
  workspaceBaseBranch?: string
  workspaceBranchLoading: boolean
  workspaceBranchSaving: boolean
  workspaceBranchOptions: string[]
  workspaceBranchSources?: Record<string, 'remote' | 'local-only'>
  workspaceBranchMessage: string
  onOpenDelegate: () => void
  onLoadMentionSkills: () => void
  onSelectSkillMention: (value: string) => void
  onExecutorMenuOpenChange: (open: boolean) => void
  onSelectExecutor: (executorId: string) => void
  onCreateExecutor: () => void
  onAgentMenuOpenChange: (open: boolean) => void
  onSelectAgent: (agentType: Task['agentType']) => void | Promise<void>
  onModelMenuOpenChange: (open: boolean) => void
  onSelectModel: (model: string) => void | Promise<void>
  onChangeMcpSettings: (nextIds: string[]) => void
  onChangeRuntimeSettings: (nextSettings: AgentRuntimeSettings) => void
  onSelectWorkspaceBranch: (branchName: string) => void | Promise<void>
}

export function TaskChatFooterControls({
  activeExecutorName,
  agentMenuOpen,
  agentOptions,
  agentSaving,
  availableMcpServers,
  busy,
  defaultModel,
  effectiveExecutorId,
  executorCards,
  executorMenuOpen,
  executorSaving,
  groupedModelOptions,
  hasUnavailableSelectedModel,
  input,
  mentionSkills,
  mentionSkillsLoading,
  mcpSettingsSaving,
  modelDisabled,
  modelMenuOpen,
  modelMeta,
  modelSaving,
  modelSummary,
  modelSummaryHint,
  modelSummaryTitle,
  runtimeSettingsDisabled,
  runtimeSettingsSaving,
  selectedAgentType,
  selectedMcpServerIds,
  selectedModel,
  selectedRuntimeSettings,
  visibleSelectedModel,
  workspaceId,
  isSessionBusy,
  workspaceWorkingDirectoryMode,
  workspaceVersionControl,
  workspaceBranchName,
  workspaceBaseBranch,
  workspaceBranchLoading,
  workspaceBranchSaving,
  workspaceBranchOptions,
  workspaceBranchSources,
  workspaceBranchMessage,
  onLoadMentionSkills,
  onSelectSkillMention,
  onExecutorMenuOpenChange,
  onSelectExecutor,
  onCreateExecutor,
  onAgentMenuOpenChange,
  onSelectAgent,
  onModelMenuOpenChange,
  onSelectModel,
  onChangeMcpSettings,
  onChangeRuntimeSettings,
  onSelectWorkspaceBranch,
}: TaskChatFooterControlsProps) {
  const selectedExecutor = useMemo(() => {
    return executorCards.find((item) => item.executor.executorId === effectiveExecutorId)?.executor
  }, [effectiveExecutorId, executorCards])
  const controlGroupClassName = 'flex min-w-max items-center gap-1.5 [&>*]:shrink-0 sm:min-w-0 sm:flex-wrap'

  const modelRelatedControls = (
    <div className={controlGroupClassName}>
      {workspaceId ? (
        <TaskChatExecutionPermissionControl
          agentType={selectedAgentType}
          settings={selectedRuntimeSettings}
          disabled={runtimeSettingsDisabled || executorSaving}
          saving={runtimeSettingsSaving}
          onChange={onChangeRuntimeSettings}
        />
      ) : null}

      <TaskChatAgentSelector
        open={agentMenuOpen}
        onOpenChange={onAgentMenuOpenChange}
        saving={agentSaving}
        modelSaving={modelSaving || executorSaving}
        selectedAgentType={selectedAgentType}
        agentOptions={agentOptions}
        onSelectAgent={onSelectAgent}
      />

      <TaskChatModelSelector
        open={modelMenuOpen}
        onOpenChange={onModelMenuOpenChange}
        disabled={modelDisabled || executorSaving}
        selectedModel={selectedModel}
        visibleSelectedModel={visibleSelectedModel}
        defaultModel={defaultModel}
        hasUnavailableSelectedModel={hasUnavailableSelectedModel}
        groupedModelOptions={groupedModelOptions}
        modelSummary={modelSummary}
        modelSummaryTitle={modelSummaryTitle}
        modelSummaryHint={modelSummaryHint}
        modelMeta={modelMeta}
        onSelectModel={onSelectModel}
      />

      {workspaceId ? (
        <TaskChatRuntimeSettingsControl
          agentType={selectedAgentType}
          settings={selectedRuntimeSettings}
          disabled={runtimeSettingsDisabled || executorSaving}
          saving={runtimeSettingsSaving}
          onChange={onChangeRuntimeSettings}
        />
      ) : null}
    </div>
  )

  return (
    <div className="scrollbar-subtle -mx-1 overflow-x-auto overflow-y-hidden px-1 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-2">
      <div className="flex w-max min-w-full flex-col gap-1.5 pr-1 sm:w-auto">
        {modelRelatedControls}
        <div className={controlGroupClassName}>
          <TaskChatExecutorSelector
            open={executorMenuOpen}
            onOpenChange={onExecutorMenuOpenChange}
            workspaceId={workspaceId}
            busy={executorSaving || agentSaving || modelSaving || runtimeSettingsSaving || mcpSettingsSaving || workspaceBranchSaving}
            switching={executorSaving}
            executorCards={executorCards}
            effectiveExecutorId={effectiveExecutorId}
            activeExecutorName={activeExecutorName || selectedExecutor?.name}
            onSelectExecutor={(executor) => onSelectExecutor(executor.executorId)}
            onCreateExecutor={onCreateExecutor}
          />

          {workspaceId && workspaceVersionControl === 'none' ? (
            <div
              title="当前项目未启用 Git"
              className="flex min-w-max max-w-none shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-500"
            >
              <GitBranch className="h-3 w-3 text-zinc-600" />
              <span className="whitespace-nowrap">未启用 Git</span>
            </div>
          ) : null}

          {workspaceId && workspaceWorkingDirectoryMode && workspaceVersionControl !== 'none' && workspaceBranchName ? (
            <TaskChatWorkspaceBranchControl
              mode={workspaceWorkingDirectoryMode}
              value={workspaceBranchName}
              selectedBranch={workspaceBranchName}
              options={workspaceBranchOptions}
              branchSources={workspaceBranchSources}
              remoteOnly={isManagedCloudAutoExecutorId(effectiveExecutorId) || effectiveExecutorId.startsWith('managed-cloud')}
              disabled={busy || executorSaving}
              loading={workspaceBranchLoading}
              saving={workspaceBranchSaving}
              message={workspaceBranchMessage}
              onChange={onSelectWorkspaceBranch}
            />
          ) : null}

          <SkillMentionPicker
            disabled={busy}
            loading={mentionSkillsLoading}
            onOpen={onLoadMentionSkills}
            skills={mentionSkills}
            value={input}
            onSelectSkill={(skill) => onSelectSkillMention(insertSkillMentionToken(input, skill))}
          />

          {workspaceId ? (
            <TaskChatMcpSettingsControl
              servers={availableMcpServers}
              selectedIds={selectedMcpServerIds}
              disabled={runtimeSettingsDisabled || executorSaving}
              saving={mcpSettingsSaving}
              onChange={onChangeMcpSettings}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

// [INPUT]: Model-center configuration draft, executor inventory, and discovered runtime models.
// [OUTPUT]: Editable workspace execution defaults and per-runtime default model settings.
// [POS]: Models-page "默认配置" tab; owns workspace defaults and runtime default models.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'
import { Save } from 'lucide-react'
import { VISIBLE_AGENT_TYPES } from '@shared/agent-type'
import type { AgentConfig, ExecutionModelOption, ExecutorRecord } from '@shared/types'
import { cn } from '../../lib/utils'
import { isExecutorEffectivelyOnline } from '../../lib/managed-cloud-executor'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { Button } from '../ui/button'
import { ExecutorSelect } from '../ui/executor-select'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { SearchableSelect } from '../ui/searchable-select'
import { Switch } from '../ui/switch'
import { codexReasoningEffortOptions } from '../settings/settings-page-shared'
import {
  buildModelOptionKeywords,
  buildModelOptionSelectDescription,
  buildModelOptionSelectLabel,
} from './model-center-runtime-utils'
import type { RuntimeTabId } from './use-model-center-runtime-state'

const surfaceClassName = 'rounded-lg border border-zinc-900 bg-[#09090b]'
const triggerClassName = 'h-8 rounded-lg px-2.5 text-xs'
const inputClassName = 'h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-zinc-700'

const runtimeTabs: Array<{ id: RuntimeTabId; label: string }> = [
  { id: 'OpenCode', label: 'OpenCode' },
  { id: 'Codex', label: 'Codex' },
  { id: 'ClaudeCode', label: 'Claude Code' },
  { id: 'Pi', label: 'Pi' },
]

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className={surfaceClassName}>
      <div className="border-b border-zinc-900 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <p className="mt-1 text-[11px] text-zinc-500">{description}</p>
      </div>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  )
}

const buildRuntimeModelOptions = (options: ExecutionModelOption[], includeAutoOption = false) => {
  const items = options.map((model) => ({
    value: model.id,
    label: buildModelOptionSelectLabel(model),
    description: buildModelOptionSelectDescription(model),
    keywords: buildModelOptionKeywords(model),
  }))

  return includeAutoOption
    ? [{ value: '', label: 'Auto', description: 'Use the runtime default resolution.' }, ...items]
    : items
}

export function ModelCenterRuntimePanel({
  activeRuntimeTab,
  busy,
  config,
  language,
  modelLoading,
  modelOptions,
  executors,
  onConfigChange,
  onRuntimeTabChange,
  onSave,
}: {
  activeRuntimeTab: RuntimeTabId
  busy: boolean
  config: AgentConfig
  language: string
  modelLoading: boolean
  modelOptions: Record<RuntimeTabId, ExecutionModelOption[]>
  executors: ExecutorRecord[]
  onConfigChange: (config: AgentConfig) => void
  onRuntimeTabChange: (runtime: RuntimeTabId) => void
  onSave: (config: AgentConfig) => void
}) {
  const workspaceDefaults = config.workspaceExecutionDefaults
  const workspaceDefaultAgentType = workspaceDefaults.agentType
  const workspaceDefaultModelOptions = workspaceDefaultAgentType ? modelOptions[workspaceDefaultAgentType] : []
  const activeCodexRuntime = activeRuntimeTab === 'Codex' ? 'Codex' : null
  const activeCodexSettings = activeRuntimeTab === 'Codex'
    ? config.agentSettings.Codex
    : null

  const updateActiveCodexSettings = (
    updater: (
      settings: AgentConfig['agentSettings']['Codex'],
    ) => AgentConfig['agentSettings']['Codex'],
  ) => {
    if (activeRuntimeTab === 'Codex') {
      onConfigChange({
        ...config,
        agentSettings: {
          ...config.agentSettings,
          Codex: updater(config.agentSettings.Codex),
        },
      })
      return
    }

  }

  return (
    <div className="space-y-4">
      <Section
        title={language === 'zh' ? '默认工作区执行配置' : 'Default Workspace Execution'}
        description={language === 'zh'
          ? '新工作区优先使用这里的节点、Coding Agent 和模型；已有工作区会优先沿用上一次成功执行的组合。'
          : 'New workspaces use this worker, coding agent, and model. Existing workspaces prefer their last successful combination.'}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={language === 'zh' ? '执行节点' : 'Worker'}>
            <ExecutorSelect
              value={workspaceDefaults.executorNodeId}
              options={[
                { value: '', label: language === 'zh' ? '未设置' : 'Not configured', statusTone: 'neutral' },
                ...executors.map((executor) => ({
                  value: executor.executorId,
                  label: executor.name,
                  description: executor.machineName,
                  badgeLabel: isExecutorEffectivelyOnline(executor) ? (language === 'zh' ? '在线' : 'Online') : (language === 'zh' ? '离线' : 'Offline'),
                  statusTone: isExecutorEffectivelyOnline(executor) ? ('online' as const) : ('offline' as const),
                })),
              ]}
              placeholder={language === 'zh' ? '选择执行节点' : 'Select a worker'}
              searchPlaceholder={language === 'zh' ? '搜索执行节点' : 'Search workers'}
              emptyText={language === 'zh' ? '没有匹配的执行节点' : 'No matching workers'}
              triggerClassName={triggerClassName}
              onChange={(value) => onConfigChange({
                ...config,
                workspaceExecutionDefaults: {
                  ...workspaceDefaults,
                  executorNodeId: value,
                  executionModel: '',
                },
              })}
            />
          </Field>
          <Field label="Coding Agent">
            <NativeSelect
              value={workspaceDefaultAgentType ?? ''}
              disabled={!workspaceDefaults.executorNodeId}
              className={triggerClassName}
              onChange={(event) => onConfigChange({
                ...config,
                workspaceExecutionDefaults: {
                  ...workspaceDefaults,
                  agentType: event.target.value ? event.target.value as typeof workspaceDefaultAgentType : undefined,
                  executionModel: '',
                },
              })}
            >
              <option value="">{language === 'zh' ? '未设置' : 'Not configured'}</option>
              {VISIBLE_AGENT_TYPES.map((agentType) => (
                <option key={agentType} value={agentType}>{agentType === 'ClaudeCode' ? 'Claude Code' : agentType}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={language === 'zh' ? '默认模型' : 'Default Model'}>
            <SearchableSelect
              value={workspaceDefaults.executionModel}
              options={buildRuntimeModelOptions(workspaceDefaultModelOptions)}
              placeholder={language === 'zh' ? '选择模型' : 'Select a model'}
              searchPlaceholder={language === 'zh' ? '搜索模型' : 'Search models'}
              emptyText={language === 'zh' ? '当前节点没有可用模型' : 'No available models on this worker'}
              disabled={modelLoading || !workspaceDefaults.executorNodeId || !workspaceDefaultAgentType}
              triggerClassName={triggerClassName}
              onChange={(value) => onConfigChange({
                ...config,
                workspaceExecutionDefaults: { ...workspaceDefaults, executionModel: value },
              })}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-900 pt-3">
          <p className="text-[11px] text-zinc-500">
            {workspaceDefaults.executorNodeId && workspaceDefaultAgentType && workspaceDefaults.executionModel
              ? (language === 'zh' ? '配置完整，保存后用于新建工作区。' : 'Ready to use for new workspaces after saving.')
              : (language === 'zh' ? '未配置完整时，首次执行会要求手动选择。' : 'Incomplete defaults require a manual selection before the first run.')}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => onSave(config)}
            disabled={busy}
            className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
          >
            <Save className="h-3.5 w-3.5" />
            {language === 'zh' ? '保存默认配置' : 'Save Defaults'}
          </Button>
        </div>
      </Section>

      <section className={surfaceClassName}>
        <div className="border-b border-zinc-900 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            {language === 'zh' ? 'Runtime 默认配置' : 'Runtime Defaults'}
          </h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {language === 'zh'
              ? '把执行端默认模型和运行参数统一收回到模型中心管理，避免 settings 与 models 两边分裂。'
              : 'Manage runtime default models and execution parameters here instead of splitting them across settings.'}
          </p>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-950/70 p-1">
            {runtimeTabs.map((tab) => {
              const active = tab.id === activeRuntimeTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onRuntimeTabChange(tab.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                    active
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                  )}
                >
                  <RuntimeLabel runtime={tab.id} size={14} labelClassName="block" />
                </button>
              )
            })}
          </div>

          {activeRuntimeTab === 'OpenCode' ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Default Model">
                <SearchableSelect
                  value={config.agentSettings.OpenCode.defaultModel}
                  options={buildRuntimeModelOptions(modelOptions.OpenCode, true)}
                  placeholder="Auto"
                  searchPlaceholder="Search models"
                  emptyText="No matching models"
                  disabled={modelLoading}
                  triggerClassName={triggerClassName}
                  onChange={(value) => onConfigChange({
                    ...config,
                    defaultModel: value,
                    agentSettings: {
                      ...config.agentSettings,
                      OpenCode: {
                        ...config.agentSettings.OpenCode,
                        defaultModel: value,
                      },
                    },
                  })}
                />
              </Field>
              <Field label="Agent">
                <Input
                  value={config.agentSettings.OpenCode.agent}
                  onChange={(event) => onConfigChange({
                    ...config,
                    agentSettings: {
                      ...config.agentSettings,
                      OpenCode: {
                        ...config.agentSettings.OpenCode,
                        agent: event.target.value,
                      },
                    },
                  })}
                  placeholder="build / plan / default"
                  className={inputClassName}
                />
              </Field>
              <Field label="Permission Policy">
                <Input
                  value={config.agentSettings.OpenCode.permissionPolicy}
                  onChange={(event) => onConfigChange({
                    ...config,
                    agentSettings: {
                      ...config.agentSettings,
                      OpenCode: {
                        ...config.agentSettings.OpenCode,
                        permissionPolicy: event.target.value,
                      },
                    },
                  })}
                  placeholder="default / ask / auto / deny"
                  className={inputClassName}
                />
              </Field>
            </div>
          ) : null}

          {activeCodexRuntime && activeCodexSettings ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Default Model">
                <SearchableSelect
                  value={activeCodexSettings.defaultModel}
                  options={buildRuntimeModelOptions(modelOptions[activeCodexRuntime])}
                  placeholder="Select a model"
                  searchPlaceholder="Search models"
                  emptyText="No matching models"
                  triggerClassName={triggerClassName}
                  onChange={(value) => updateActiveCodexSettings((settings) => ({
                    ...settings,
                    defaultModel: value,
                  }))}
                />
              </Field>
              <Field label="Sandbox">
                <NativeSelect
                  value={activeCodexSettings.sandbox}
                  onChange={(event) => updateActiveCodexSettings((settings) => ({
                    ...settings,
                    sandbox: event.target.value as typeof settings.sandbox,
                  }))}
                  className={triggerClassName}
                >
                  <option value="read-only">read-only</option>
                  <option value="workspace-write">workspace-write</option>
                  <option value="danger-full-access">danger-full-access</option>
                </NativeSelect>
              </Field>
              <Field label="Approval">
                <NativeSelect
                  value={activeCodexSettings.approval}
                  onChange={(event) => updateActiveCodexSettings((settings) => ({
                    ...settings,
                    approval: event.target.value as typeof settings.approval,
                  }))}
                  className={triggerClassName}
                >
                  <option value="untrusted">untrusted</option>
                  <option value="on-failure">on-failure</option>
                  <option value="on-request">on-request</option>
                  <option value="never">never</option>
                </NativeSelect>
              </Field>
              <Field label="Reasoning Effort">
                <NativeSelect
                  value={activeCodexSettings.reasoningEffort}
                  onChange={(event) => updateActiveCodexSettings((settings) => ({
                    ...settings,
                    reasoningEffort: event.target.value as typeof settings.reasoningEffort,
                  }))}
                  className={triggerClassName}
                >
                  {codexReasoningEffortOptions.map((effort) => (
                    <option key={effort} value={effort}>{effort}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Reasoning Summary">
                <NativeSelect
                  value={activeCodexSettings.reasoningSummary}
                  onChange={(event) => updateActiveCodexSettings((settings) => ({
                    ...settings,
                    reasoningSummary: event.target.value as typeof settings.reasoningSummary,
                  }))}
                  className={triggerClassName}
                >
                  <option value="auto">auto</option>
                  <option value="concise">concise</option>
                  <option value="detailed">detailed</option>
                  <option value="none">none</option>
                </NativeSelect>
              </Field>
            </div>
          ) : null}

          {activeRuntimeTab === 'ClaudeCode' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Default Model">
                <SearchableSelect
                  value={config.agentSettings.ClaudeCode.defaultModel}
                  options={buildRuntimeModelOptions(modelOptions.ClaudeCode)}
                  placeholder="Select a model"
                  searchPlaceholder="Search models"
                  emptyText="No matching models"
                  triggerClassName={triggerClassName}
                  onChange={(value) => onConfigChange({
                    ...config,
                    agentSettings: {
                      ...config.agentSettings,
                      ClaudeCode: {
                        ...config.agentSettings.ClaudeCode,
                        defaultModel: value,
                      },
                    },
                  })}
                />
              </Field>
              <Field label="Permission Mode">
                <NativeSelect
                  value={config.agentSettings.ClaudeCode.permissionMode}
                  onChange={(event) => onConfigChange({
                    ...config,
                    agentSettings: {
                      ...config.agentSettings,
                      ClaudeCode: {
                        ...config.agentSettings.ClaudeCode,
                        permissionMode: event.target.value as typeof config.agentSettings.ClaudeCode.permissionMode,
                      },
                    },
                  })}
                  className={triggerClassName}
                >
                  <option value="default">default</option>
                  <option value="acceptEdits">acceptEdits</option>
                  <option value="bypassPermissions">bypassPermissions</option>
                </NativeSelect>
              </Field>
              <Field label="Plan Mode" hint={language === 'zh' ? '默认把 Claude Code 以 plan 模式启动。' : 'Start Claude Code with plan mode enabled by default.'}>
                <div className="flex h-9 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200">
                  <span>{config.agentSettings.ClaudeCode.planMode ? 'Enabled' : 'Disabled'}</span>
                  <Switch
                    checked={config.agentSettings.ClaudeCode.planMode}
                    onCheckedChange={(checked) => onConfigChange({
                      ...config,
                      agentSettings: {
                        ...config.agentSettings,
                        ClaudeCode: {
                          ...config.agentSettings.ClaudeCode,
                          planMode: checked,
                        },
                      },
                    })}
                  />
                </div>
              </Field>
            </div>
          ) : null}

          {activeRuntimeTab === 'Pi' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Default Model">
                <SearchableSelect
                  value={config.agentSettings.Pi.defaultModel}
                  options={buildRuntimeModelOptions(modelOptions.Pi, true)}
                  placeholder="Auto"
                  searchPlaceholder="Search models"
                  emptyText="No matching models"
                  disabled={modelLoading}
                  triggerClassName={triggerClassName}
                  onChange={(value) => onConfigChange({
                    ...config,
                    agentSettings: {
                      ...config.agentSettings,
                      Pi: {
                        ...config.agentSettings.Pi,
                        defaultModel: value,
                      },
                    },
                  })}
                />
              </Field>
              <Field label="Agent Dir" hint={language === 'zh' ? 'Pi 侧 agent 目录，可选。' : 'Optional Pi-side agent directory.'}>
                <Input
                  value={config.agentSettings.Pi.agentDir || ''}
                  onChange={(event) => onConfigChange({
                    ...config,
                    agentSettings: {
                      ...config.agentSettings,
                      Pi: {
                        ...config.agentSettings.Pi,
                        agentDir: event.target.value,
                      },
                    },
                  })}
                  placeholder=".pi/agents/default"
                  className={inputClassName}
                />
              </Field>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onSave(config)}
              disabled={busy}
              className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              <Save className="h-3.5 w-3.5" />
              {language === 'zh' ? '保存 Runtime 默认值' : 'Save Runtime Defaults'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

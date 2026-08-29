import { useMemo, useState, type ReactNode } from 'react'
import { Settings2 } from 'lucide-react'
import { mergeAgentRuntimeSettings } from '@shared/agent-config'
import type { AgentRuntimeSettings, ClaudeCodeAgentSettings, CodexAgentSettings, Task } from '@shared/types'
import { cn } from '../../../lib/utils'
import { NativeSelect } from '../../ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { Switch } from '../../ui/switch'

interface TaskChatRuntimeSettingsFieldsProps {
  agentType: Task['agentType']
  settings: AgentRuntimeSettings
  disabled?: boolean
  onChange: (settings: AgentRuntimeSettings) => void
}

interface TaskChatRuntimeSettingsControlProps extends TaskChatRuntimeSettingsFieldsProps {
  saving?: boolean
}

const codexReasoningEffortOptions: CodexAgentSettings['reasoningEffort'][] = ['low', 'medium', 'high', 'xhigh']
const codexReasoningSummaryOptions: CodexAgentSettings['reasoningSummary'][] = ['auto', 'concise', 'detailed', 'none']
const codexApprovalOptions: CodexAgentSettings['approval'][] = ['untrusted', 'on-failure', 'on-request', 'never']

const buildRuntimeSummary = (agentType: Task['agentType'], settings: AgentRuntimeSettings) => {
  if (agentType === 'Codex') {
    const codexSettings = settings as CodexAgentSettings
    return `${codexSettings.reasoningEffort}`
  }

  if (agentType === 'ClaudeCode') {
    const claudeSettings = settings as ClaudeCodeAgentSettings
    return claudeSettings.planMode ? '计划模式' : '自动模式'
  }

  return ''
}

const buildRuntimeTitle = (agentType: Task['agentType'], settings: AgentRuntimeSettings) => {
  if (agentType === 'Codex') {
    const codexSettings = settings as CodexAgentSettings
    return `思考强度：${codexSettings.reasoningEffort}；摘要模式：${codexSettings.reasoningSummary}`
  }

  if (agentType === 'ClaudeCode') {
    const claudeSettings = settings as ClaudeCodeAgentSettings
    return `模式：${claudeSettings.planMode ? '计划模式' : '自动模式'}`
  }

  return '运行参数'
}

const FieldBlock = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-zinc-200">{label}</p>
        {hint ? <span className="text-[10px] text-zinc-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

export const TaskChatRuntimeSettingsFields = ({
  agentType,
  settings,
  disabled = false,
  onChange,
}: TaskChatRuntimeSettingsFieldsProps) => {
  const content = useMemo(() => {
    if (agentType === 'Codex') {
      const codexSettings = settings as CodexAgentSettings
      const updateSettings = (patch: Partial<CodexAgentSettings>) => {
        onChange(mergeAgentRuntimeSettings(agentType, codexSettings, patch))
      }

      return (
        <div className="space-y-3">
          <FieldBlock label="思考强度" hint="对应 reasoning effort">
            <NativeSelect
              value={codexSettings.reasoningEffort}
              disabled={disabled}
              className="h-9 rounded-lg text-xs"
              onChange={(event) => updateSettings({
                reasoningEffort: event.target.value as CodexAgentSettings['reasoningEffort'],
              })}
            >
              {codexReasoningEffortOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </NativeSelect>
          </FieldBlock>

          <FieldBlock label="摘要模式" hint="支持 auto">
            <NativeSelect
              value={codexSettings.reasoningSummary}
              disabled={disabled}
              className="h-9 rounded-lg text-xs"
              onChange={(event) => updateSettings({
                reasoningSummary: event.target.value as CodexAgentSettings['reasoningSummary'],
              })}
            >
              {codexReasoningSummaryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </NativeSelect>
          </FieldBlock>

          <FieldBlock label="审批模式">
            <NativeSelect
              value={codexSettings.approval}
              disabled={disabled}
              className="h-9 rounded-lg text-xs"
              onChange={(event) => updateSettings({
                approval: event.target.value as CodexAgentSettings['approval'],
              })}
            >
              {codexApprovalOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </NativeSelect>
          </FieldBlock>
        </div>
      )
    }

    if (agentType === 'ClaudeCode') {
      const claudeSettings = settings as ClaudeCodeAgentSettings
      const updateSettings = (patch: Partial<ClaudeCodeAgentSettings>) => {
        onChange(mergeAgentRuntimeSettings('ClaudeCode', claudeSettings, patch))
      }

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-zinc-200">Plan 模式</p>
              <p className="mt-1 text-[10px] text-zinc-500">开启后使用 Claude Code 的 plan / 审阅风格。</p>
            </div>
            <Switch
              checked={claudeSettings.planMode}
              disabled={disabled}
              className="data-[state=checked]:bg-emerald-500"
              onCheckedChange={(checked) => updateSettings({ planMode: checked })}
            />
          </div>
        </div>
      )
    }

    return null
  }, [agentType, disabled, onChange, settings])

  if (!content) {
    return null
  }

  return (
    <div className="space-y-3">
      {content}
      <p className="text-[10px] leading-5 text-zinc-500">
        这些参数只保存到当前工作区会话，不会覆盖全局设置页里的默认值。
      </p>
    </div>
  )
}

export function TaskChatRuntimeSettingsControl({
  agentType,
  settings,
  disabled = false,
  saving = false,
  onChange,
}: TaskChatRuntimeSettingsControlProps) {
  const [open, setOpen] = useState(false)
  const title = buildRuntimeTitle(agentType, settings)
  const summary = buildRuntimeSummary(agentType, settings)

  if (agentType === 'OpenCode' || agentType === 'Pi') {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={title}
          className={cn(
            'flex min-w-max max-w-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <Settings2 className="h-3 w-3 text-cyan-400/80" />
          {summary ? <span className="max-w-[7rem] truncate">{summary}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-80 rounded-xl border-zinc-800 bg-[#0f0f11] p-3 text-zinc-100 shadow-2xl shadow-black/40">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
              {agentType === 'Codex' ? 'Codex' : agentType === 'ClaudeCode' ? 'Claude Code' : 'Pi'} 运行参数
            </p>
            <p className="mt-1 text-xs text-zinc-400">{saving ? '保存中…' : '会话级配置，立即影响后续对话。'}</p>
          </div>
        </div>
        <TaskChatRuntimeSettingsFields
          agentType={agentType}
          settings={settings}
          disabled={disabled}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  )
}

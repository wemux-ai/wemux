import { useState } from 'react'
import { ChevronDown, Shield } from 'lucide-react'
import type { AgentRuntimeSettings, ClaudeCodeAgentSettings, CodexAgentSettings, Task } from '@shared/types'
import { mergeAgentRuntimeSettings } from '@shared/agent-config'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'

interface TaskChatExecutionPermissionControlProps {
  agentType: Task['agentType']
  settings: AgentRuntimeSettings
  disabled?: boolean
  saving?: boolean
  onChange: (settings: AgentRuntimeSettings) => void
}

type PermissionTone = 'readonly' | 'write' | 'full'

type PermissionOption = {
  value: string
  label: string
  hint: string
  tone: PermissionTone
}

const codexPermissionOptions: PermissionOption[] = [
  {
    value: 'read-only',
    label: '只读',
    hint: '只允许读取和分析当前工作区，不修改文件。',
    tone: 'readonly',
  },
  {
    value: 'workspace-write',
    label: '可写',
    hint: '允许修改当前工作区内容，但仍保持工作区边界。',
    tone: 'write',
  },
  {
    value: 'danger-full-access',
    label: '全权限',
    hint: '不给文件和命令访问额外限制，适合需要完全操作的会话。',
    tone: 'full',
  },
]

const claudePermissionOptions: PermissionOption[] = [
  {
    value: 'default',
    label: '只读',
    hint: '只允许读取、检索这类低风险工具。',
    tone: 'readonly',
  },
  {
    value: 'acceptEdits',
    label: '可写',
    hint: '允许编辑项目内容，但仍保留权限边界。',
    tone: 'write',
  },
  {
    value: 'bypassPermissions',
    label: '全权限',
    hint: '尽量跳过权限拦截，直接执行工具操作。',
    tone: 'full',
  },
]

const supportsExecutionPermission = (agentType: Task['agentType']) => {
  return agentType === 'Codex' || agentType === 'ClaudeCode'
}

const getPermissionOptions = (agentType: Task['agentType']) => {
  if (agentType === 'Codex') {
    return codexPermissionOptions
  }

  if (agentType === 'ClaudeCode') {
    return claudePermissionOptions
  }

  return []
}

const getPermissionValue = (agentType: Task['agentType'], settings: AgentRuntimeSettings) => {
  if (agentType === 'Codex') {
    return (settings as CodexAgentSettings).sandbox
  }

  if (agentType === 'ClaudeCode') {
    return (settings as ClaudeCodeAgentSettings).permissionMode
  }

  return ''
}

const getPermissionOption = (agentType: Task['agentType'], settings: AgentRuntimeSettings) => {
  const options = getPermissionOptions(agentType)
  const currentValue = getPermissionValue(agentType, settings)
  return options.find((option) => option.value === currentValue) ?? options[0] ?? null
}

const updatePermissionSettings = (
  agentType: Task['agentType'],
  settings: AgentRuntimeSettings,
  value: string,
) => {
  if (agentType === 'Codex') {
    return mergeAgentRuntimeSettings(agentType, settings as CodexAgentSettings, {
      sandbox: value as CodexAgentSettings['sandbox'],
    })
  }

  if (agentType === 'ClaudeCode') {
    return mergeAgentRuntimeSettings('ClaudeCode', settings as ClaudeCodeAgentSettings, {
      permissionMode: value as ClaudeCodeAgentSettings['permissionMode'],
    })
  }

  return settings
}

const triggerToneClassName = (tone: PermissionTone) => {
  if (tone === 'write') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/40 hover:bg-emerald-500/15'
  }

  if (tone === 'full') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-100 hover:border-rose-400/40 hover:bg-rose-500/15'
  }

  return 'border-sky-500/30 bg-sky-500/10 text-sky-100 hover:border-sky-400/40 hover:bg-sky-500/15'
}

const iconToneClassName = (tone: PermissionTone) => {
  if (tone === 'write') {
    return 'text-emerald-300'
  }

  if (tone === 'full') {
    return 'text-rose-300'
  }

  return 'text-sky-300'
}

const optionToneClassName = (active: boolean, tone: PermissionTone) => {
  if (!active) {
    return 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
  }

  if (tone === 'write') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
  }

  if (tone === 'full') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-100'
  }

  return 'border-sky-500/30 bg-sky-500/10 text-sky-100'
}

export function TaskChatExecutionPermissionControl({
  agentType,
  settings,
  disabled = false,
  saving = false,
  onChange,
}: TaskChatExecutionPermissionControlProps) {
  const [open, setOpen] = useState(false)

  if (!supportsExecutionPermission(agentType)) {
    return null
  }

  const currentOption = getPermissionOption(agentType, settings)
  if (!currentOption) {
    return null
  }

  const options = getPermissionOptions(agentType)
  const currentValue = getPermissionValue(agentType, settings)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`执行权限：${currentOption.label}`}
          className={cn(
            'flex min-w-max max-w-none items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs transition-all',
            triggerToneClassName(currentOption.tone),
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <Shield className={cn('h-3 w-3', iconToneClassName(currentOption.tone))} />
          <span className="whitespace-nowrap">{currentOption.label}</span>
          <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-80 rounded-xl border-zinc-800 bg-[#0f0f11] p-3 text-zinc-100 shadow-2xl shadow-black/40">
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">执行权限</p>
          <p className="mt-1 text-xs text-zinc-400">
            {saving ? '保存中…' : '会话级配置，立即影响后续对话。'}
          </p>
        </div>

        <div className="space-y-2">
          {options.map((option) => {
            const active = option.value === currentValue
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  optionToneClassName(active, option.tone),
                )}
                onClick={() => {
                  onChange(updatePermissionSettings(agentType, settings, option.value))
                  setOpen(false)
                }}
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium">{option.label}</p>
                  <p className={cn('mt-1 text-[10px] leading-5', active ? 'text-current/80' : 'text-zinc-500')}>
                    {option.hint}
                  </p>
                </div>
                <span className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
                  active ? 'bg-white/10 text-current' : 'bg-zinc-800 text-zinc-500',
                )}>
                  {active ? '当前' : '切换'}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

import { useMemo, useState } from 'react'
import { ChevronDown, PlugZap } from 'lucide-react'
import type { McpServerPolicy } from '@shared/mcp'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { Switch } from '../../ui/switch'

interface TaskChatMcpSettingsFieldsProps {
  servers: McpServerPolicy[]
  selectedIds: string[]
  disabled?: boolean
  onChange: (ids: string[]) => void
}

interface TaskChatMcpSettingsControlProps extends TaskChatMcpSettingsFieldsProps {
  saving?: boolean
}

const buildSelectedIdSet = (selectedIds: string[]) => {
  return new Set(selectedIds.map((item) => item.trim()).filter(Boolean))
}

const buildMcpSummary = (servers: McpServerPolicy[], selectedIds: string[]) => {
  if (servers.length === 0) {
    return 'MCP 未配置'
  }

  const serverIds = new Set(servers.map((server) => server.id))
  const selectedCount = selectedIds.filter((id) => serverIds.has(id)).length
  if (selectedCount === 0) {
    return `MCP 已关 ${selectedCount}/${servers.length}`
  }

  if (selectedCount === servers.length) {
    return `MCP 全开 ${selectedCount}/${servers.length}`
  }

  return `MCP 已开 ${selectedCount}/${servers.length}`
}

export const TaskChatMcpSettingsFields = ({
  servers,
  selectedIds,
  disabled = false,
  onChange,
}: TaskChatMcpSettingsFieldsProps) => {
  const selectedSet = useMemo(() => buildSelectedIdSet(selectedIds), [selectedIds])

  if (servers.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-xs text-zinc-500">
        当前没有可用的 MCP 配置。
      </div>
    )
  }

  const setAll = (enabled: boolean) => {
    onChange(enabled ? servers.map((server) => server.id) : [])
  }

  const toggleServer = (serverId: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds.filter((item) => item !== serverId), serverId]
      : selectedIds.filter((item) => item !== serverId)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500">会话级开关，仅影响当前工作区会话。</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            className="text-[10px] text-cyan-400 transition hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setAll(true)}
          >
            全开
          </button>
          <button
            type="button"
            disabled={disabled}
            className="text-[10px] text-zinc-500 transition hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setAll(false)}
          >
            全关
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {servers.map((server) => {
          const checked = selectedSet.has(server.id)
          return (
            <div key={server.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-zinc-200">{server.name}</p>
                <p className="mt-1 text-[10px] text-zinc-500">
                  {server.transport} · {server.capabilityMode === 'resources+tools' ? 'resources + tools' : 'resources'}
                  {server.managedBySystem ? ' · 系统内置' : ''}
                </p>
              </div>
              <Switch
                checked={checked}
                disabled={disabled}
                className="data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-zinc-600"
                onCheckedChange={(nextChecked) => toggleServer(server.id, nextChecked)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TaskChatMcpSettingsControl({
  servers,
  selectedIds,
  disabled = false,
  saving = false,
  onChange,
}: TaskChatMcpSettingsControlProps) {
  const [open, setOpen] = useState(false)
  const summary = buildMcpSummary(servers, selectedIds)
  const triggerLabel = 'MCP'
  const enabledCount = selectedIds.filter((id) => servers.some((server) => server.id === id)).length
  const hasMcpEnabled = enabledCount > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={summary}
          aria-label={summary}
          className={cn(
            'flex min-w-max max-w-none items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs transition-all',
            hasMcpEnabled
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100 hover:border-amber-400/40 hover:bg-amber-500/15'
              : 'border-zinc-800/60 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <PlugZap className={cn('h-3 w-3', hasMcpEnabled ? 'text-amber-300' : 'text-amber-400/90')} />
          <span className="whitespace-nowrap">{triggerLabel}</span>
          <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-80 rounded-xl border-zinc-800 bg-[#0f0f11] p-3 text-zinc-100 shadow-2xl shadow-black/40">
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">MCP 开关</p>
          <p className="mt-1 text-xs text-zinc-400">{saving ? '保存中…' : '可为当前工作区会话手动开启或关闭 MCP。'}</p>
        </div>
        <TaskChatMcpSettingsFields
          servers={servers}
          selectedIds={selectedIds}
          disabled={disabled}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  )
}

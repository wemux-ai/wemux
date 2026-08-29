import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  Cable,
  Cpu,
  Plus,
  Server,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { ScrollArea } from '../ui/scroll-area'
import { Switch } from '../ui/switch'
import { CapabilityCard } from '../capabilities/capability-card'
import { CapabilityEmptyState } from '../capabilities/capability-empty-state'
import { buildMcpUsageSummary } from '../capabilities/capability-usage'
import { useAuth } from '../../lib/auth-context'
import {
  COLLABORATION_WORKSPACE_CHANGE_EVENT,
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspace,
  resolveCollaborationWorkspaceId,
} from '../../lib/collaboration-workspace'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { api, type AgentRecord, type CollaborationWorkspace } from '../../lib/api'
import {
  buildMcpServerPolicies,
  parseMcpServerPolicies,
  type McpServerPolicy,
} from '../../lib/agent-config'

const MCP_PRESETS: Array<{
  name: string
  target: string
  transport: McpServerPolicy['transport']
}> = [
  { name: 'filesystem', target: 'http://127.0.0.1:7001/mcp', transport: 'http' },
  { name: 'github', target: 'stdio://gh-mcp', transport: 'stdio' },
  { name: 'fetch', target: 'http://127.0.0.1:7002/mcp', transport: 'http' },
]

const transportTone: Record<McpServerPolicy['transport'], string> = {
  http: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
  sse: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  stdio: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
  custom: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
}

const capabilityTone: Record<McpServerPolicy['capabilityMode'], string> = {
  resources: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  'resources+tools': 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
}

const createId = (prefix: string) => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2, 10)}`
const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const inferTransport = (target: string): McpServerPolicy['transport'] => {
  if (target.startsWith('stdio://')) {
    return 'stdio'
  }

  if (target.startsWith('sse://')) {
    return 'sse'
  }

  if (target.startsWith('http://') || target.startsWith('https://')) {
    return target.includes('/sse') ? 'sse' : 'http'
  }

  return 'custom'
}

function McpCreateDialog({
  busy,
  onCreate,
  onOpenChange,
  open,
}: {
  busy: boolean
  onCreate: (payload: {
    name: string
    target: string
    transport: McpServerPolicy['transport']
  }) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { language } = useTranslation()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [transport, setTransport] = useState<McpServerPolicy['transport']>('http')

  useEffect(() => {
    if (!open) {
      setName('')
      setTarget('')
      setTransport('http')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{tr(language, '新建 MCP', 'Create MCP')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{tr(language, '快速预设', 'Quick Presets')}</p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {MCP_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onCreate(preset)}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/80"
                >
                  <p className="text-xs font-medium text-zinc-200">{preset.name}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {tr(language, '名称', 'Name')}
              </Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={tr(language, 'MCP 名称', 'MCP name')}
                className="h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Target
              </Label>
              <Input
                value={target}
                onChange={(event) => {
                  const nextTarget = event.target.value
                  setTarget(nextTarget)
                  setTransport(inferTransport(nextTarget))
                }}
                placeholder={tr(language, '例如 http://127.0.0.1:7001/mcp', 'e.g. http://127.0.0.1:7001/mcp')}
                className="h-9 rounded-lg border-zinc-800 bg-zinc-950 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {tr(language, '传输方式', 'Transport')}
              </Label>
              <NativeSelect
                value={transport}
                onChange={(event) => setTransport(event.target.value as McpServerPolicy['transport'])}
              >
                <option value="http">http</option>
                <option value="sse">sse</option>
                <option value="stdio">stdio</option>
                <option value="custom">custom</option>
              </NativeSelect>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {tr(language, '取消', 'Cancel')}
            </Button>
            <Button
              disabled={busy || !name.trim() || !target.trim()}
              onClick={() => onCreate({
                name: name.trim(),
                target: target.trim(),
                transport,
              })}
              className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
            >
              {tr(language, '创建 MCP', 'Create MCP')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionCard({
  children,
  icon,
  title,
}: {
  children: ReactNode
  icon: ReactNode
  title: string
}) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-center gap-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400">
          {icon}
        </div>
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{title}</h4>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Field({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</Label>
      {children}
    </div>
  )
}

export function McpPage({
  busy,
  onChange,
  onSave,
  servers,
}: {
  busy: boolean
  onChange: (servers: McpServerPolicy[]) => void
  onSave: (servers?: McpServerPolicy[]) => void
  servers: McpServerPolicy[]
}) {
  const { language } = useTranslation()
  const { user } = useAuth()
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('')

  const normalizedServers = useMemo(() => parseMcpServerPolicies(servers), [servers])
  const usageByServerId = useMemo(() => {
    return new Map(normalizedServers.map((server) => [server.id, buildMcpUsageSummary({ agents, server })]))
  }, [agents, normalizedServers])
  const filteredServers = normalizedServers

  const selectedServer = useMemo(
    () => filteredServers.find((item) => item.id === selectedId) ?? filteredServers[0] ?? null,
    [filteredServers, selectedId],
  )
  const selectedServerUsage = useMemo(
    () => selectedServer ? (usageByServerId.get(selectedServer.id) ?? null) : null,
    [selectedServer, usageByServerId],
  )
  const canManageSelectedServer = selectedServer
    ? (!selectedServer.ownerUserId || selectedServer.ownerUserId === user?.id || selectedServer.managedBySystem)
    : false
  const selectedWorkspace = useMemo(
    () => resolveCollaborationWorkspace(workspaces, selectedServer?.workspaceId || defaultWorkspaceId),
    [defaultWorkspaceId, selectedServer?.workspaceId, workspaces],
  )

  const groupedServers = useMemo(() => {
    return {
      builtin: filteredServers.filter((server) => server.managedBySystem),
      workspace: filteredServers.filter((server) => !server.managedBySystem && (server.visibility === 'workspace' || server.visibility === 'team')),
      private: filteredServers.filter((server) => !server.managedBySystem && server.ownerUserId),
      global: filteredServers.filter((server) => !server.managedBySystem && !server.ownerUserId && server.visibility !== 'workspace' && server.visibility !== 'team'),
    }
  }, [filteredServers])

  useEffect(() => {
    if (selectedServer?.id && selectedServer.id !== selectedId) {
      setSelectedId(selectedServer.id)
    }
  }, [selectedId, selectedServer?.id])

  useEffect(() => {
    let cancelled = false

    void Promise.all([
      api.listCollaborationWorkspaces().catch(() => ({ workspaces: [] })),
      api.listAgents().catch(() => ({ agents: [] })),
    ])
      .then(([workspaceResponse, agentsResponse]) => {
        if (cancelled) {
          return
        }

        setWorkspaces(workspaceResponse.workspaces)
        setAgents(agentsResponse.agents)
        setDefaultWorkspaceId((current) => resolveCollaborationWorkspaceId(
          workspaceResponse.workspaces,
          current || getStoredCollaborationWorkspaceId(),
        ))
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaces([])
          setAgents([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      setDefaultWorkspaceId(resolveCollaborationWorkspaceId(workspaces, workspaceId || getStoredCollaborationWorkspaceId()))
    }

    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => {
      window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    }
  }, [workspaces])

  const updateServers = (next: McpServerPolicy[]) => {
    onChange(buildMcpServerPolicies(next))
  }

  const updateServer = (serverId: string, updater: (server: McpServerPolicy) => McpServerPolicy) => {
    updateServers(normalizedServers.map((item) => (item.id === serverId ? updater(item) : item)))
  }

  const visibilityMeta = (server: McpServerPolicy) => {
    if (server.visibility === 'workspace' || server.visibility === 'team') {
      return {
        label: tr(language, '组织共享', 'Organization shared'),
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      }
    }

    if (server.ownerUserId) {
      return {
        label: tr(language, '私有', 'Private'),
        className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
      }
    }

    return {
      label: tr(language, '全局可见', 'Global'),
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    }
  }

  const createServer = (payload: {
    name: string
    target: string
    transport: McpServerPolicy['transport']
  }) => {
    if (normalizedServers.some((item) => item.name.toLowerCase() === payload.name.toLowerCase())) {
      return
    }

    const nextServers = buildMcpServerPolicies([
      ...normalizedServers,
      {
        id: createId('mcp'),
        name: payload.name,
        target: payload.target,
        transport: payload.transport,
        enabled: true,
        capabilityMode: 'resources',
      },
    ])
    onChange(nextServers)
    onSave(nextServers)
    setCreateOpen(false)
  }

  const removeSelected = () => {
    if (!selectedServer || selectedServer.managedBySystem) {
      return
    }

    updateServers(normalizedServers.filter((item) => item.id !== selectedServer.id))
  }

  const renderServerSection = (title: string, items: McpServerPolicy[], emptyText: string) => {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 px-2.5 pt-3 pb-1 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          {title}
          <span className="text-[10px] tracking-normal text-zinc-600">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-zinc-600">{emptyText}</div>
        ) : (
          items.map((server) => {
            const active = selectedServer?.id === server.id
            const scopeMeta = visibilityMeta(server)
            const usage = usageByServerId.get(server.id)
            return (
              <CapabilityCard
                key={server.id}
                onClick={() => setSelectedId(server.id)}
                selected={active}
                title={server.name}
                description={server.target}
                meta={tr(language, `被 ${usage?.usedByCount ?? 0} 个 Agent 使用`, `Used by ${usage?.usedByCount ?? 0} agents`)}
                status={{
                  label: server.enabled ? tr(language, '已启用', 'Enabled') : tr(language, '已禁用', 'Disabled'),
                  className: active
                    ? 'border-zinc-700 bg-zinc-800 text-zinc-100'
                    : server.enabled
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-400',
                }}
                badges={[
                  { label: server.transport, className: active ? 'border-zinc-700 bg-zinc-800 text-zinc-100' : transportTone[server.transport] },
                  { label: scopeMeta.label, className: active ? 'border-zinc-700 bg-zinc-800 text-zinc-100' : scopeMeta.className },
                  { label: server.capabilityMode, className: active ? 'border-zinc-700 bg-zinc-800 text-zinc-100' : capabilityTone[server.capabilityMode] },
                ]}
              />
            )
          })
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <Group orientation="horizontal" className="min-h-0 flex-1">
          {/* Left sidebar */}
          <Panel defaultSize="22%" minSize="18%" maxSize="30%">
            <div className="flex h-full min-h-0 flex-col border-r border-zinc-900 bg-[#060607]">
              {/* Sidebar header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2.5">
                <span className="text-sm font-semibold text-zinc-200">
                  {tr(language, 'MCP 注册表', 'MCP Registry')}
                </span>
                <Button
                  onClick={() => setCreateOpen(true)}
                  size="icon"
                  className="h-7 w-7 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                >
                  <Plus size={14} />
                </Button>
              </div>

              {/* Server list */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-1.5 py-1.5">
                  {filteredServers.length === 0 ? (
                    <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-xs text-zinc-500">
                      {normalizedServers.length === 0
                        ? tr(language, '还没有 MCP，先创建一个。', 'No MCP yet. Create one first.')
                        : tr(language, '没有匹配的 MCP。', 'No matching MCP.')}
                    </div>
                  ) : null}
                  {renderServerSection(tr(language, '内建', 'Built-in'), groupedServers.builtin, tr(language, '无', 'None'))}
                  {renderServerSection(tr(language, '组织共享', 'Workspace'), groupedServers.workspace, tr(language, '无', 'None'))}
                  {renderServerSection(tr(language, '私有', 'Private'), groupedServers.private, tr(language, '无', 'None'))}
                  {renderServerSection(tr(language, '历史全局', 'Legacy'), groupedServers.global, tr(language, '无', 'None'))}
                </div>
              </ScrollArea>
            </div>
          </Panel>

          <Separator className="w-px bg-zinc-900" />

          {/* Right detail panel */}
          <Panel defaultSize="78%" minSize="50%">
            {!selectedServer ? (
              <div className="flex h-full items-center justify-center p-6">
                <CapabilityEmptyState
                  title={tr(language, '还没有 MCP', 'No MCP Yet')}
                  description={tr(language, '先在左侧创建一个 MCP，这里会显示连接信息、共享范围和能力策略。', 'Create an MCP on the left first. Connection info, visibility, and capability policies appear here.')}
                  icon={<Server size={20} />}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                {/* Detail header */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-900 px-4 py-2.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-zinc-100">{selectedServer.name}</h2>
                    <Badge className={cn('text-[10px]', transportTone[selectedServer.transport])}>
                      {selectedServer.transport}
                    </Badge>
                    <Badge className={cn('text-[10px]', visibilityMeta(selectedServer).className)}>
                      {visibilityMeta(selectedServer).label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canManageSelectedServer && !selectedServer.managedBySystem ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={removeSelected}
                        title={tr(language, '移除这个 MCP', 'Remove this MCP')}
                        className="h-7 w-7 rounded-md text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <Trash2 size={14} />
                      </Button>
                    ) : null}
                    <Switch
                      checked={selectedServer.enabled}
                      disabled={!canManageSelectedServer}
                      onCheckedChange={(checked) => updateServer(selectedServer.id, (current) => ({ ...current, enabled: checked }))}
                    />
                  </div>
                </div>

                {/* Detail content */}
                <div className="flex-1 min-h-0 overflow-auto">
                  <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-5">
                    {!canManageSelectedServer ? (
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs leading-5 text-zinc-500">
                        {tr(language, '这个 MCP 由其他成员维护，你当前只能查看，不能修改或删除。', 'This MCP is maintained by another member. You can view it but cannot edit or remove it.')}
                      </div>
                    ) : null}

                    {/* Connection section */}
                    <SectionCard
                      icon={<Cable className="h-3.5 w-3.5" />}
                      title={tr(language, '连接信息', 'Connection')}
                    >
                      <Field label={tr(language, '服务名称', 'Server name')}>
                        <Input
                          value={selectedServer.name}
                          disabled={selectedServer.managedBySystem || !canManageSelectedServer}
                          onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, name: event.target.value }))}
                          className="h-9 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100 focus:border-zinc-700"
                        />
                      </Field>
                      <Field label="Target">
                        <Input
                          value={selectedServer.target}
                          disabled={selectedServer.managedBySystem || !canManageSelectedServer}
                          onChange={(event) => {
                            const nextTarget = event.target.value
                            updateServer(selectedServer.id, (current) => ({
                              ...current,
                              target: nextTarget,
                              transport: current.managedBySystem ? current.transport : inferTransport(nextTarget),
                            }))
                          }}
                          className="h-9 rounded-lg border-zinc-800 bg-zinc-950 font-mono text-sm text-zinc-100 focus:border-zinc-700"
                        />
                      </Field>
                    </SectionCard>

                    {/* Capability Policy section */}
                    <SectionCard
                      icon={<Cpu className="h-3.5 w-3.5" />}
                      title={tr(language, '能力策略', 'Capability Policy')}
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label={tr(language, '传输方式', 'Transport')}>
                          <NativeSelect
                            value={selectedServer.transport}
                            disabled={selectedServer.managedBySystem || !canManageSelectedServer}
                            onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, transport: event.target.value as McpServerPolicy['transport'] }))}
                          >
                            <option value="http">http</option>
                            <option value="sse">sse</option>
                            <option value="stdio">stdio</option>
                            <option value="custom">custom</option>
                          </NativeSelect>
                        </Field>
                        <Field label={tr(language, '能力模式', 'Capability mode')}>
                          <NativeSelect
                            value={selectedServer.capabilityMode}
                            disabled={selectedServer.managedBySystem || !canManageSelectedServer}
                            onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, capabilityMode: event.target.value as McpServerPolicy['capabilityMode'] }))}
                          >
                            <option value="resources">resources</option>
                            <option value="resources+tools">resources+tools</option>
                          </NativeSelect>
                        </Field>
                        {!selectedServer.managedBySystem ? (
                          <Field label={tr(language, '共享范围', 'Visibility')}>
                            <NativeSelect
                              value={selectedServer.visibility === 'team' ? 'workspace' : (selectedServer.visibility ?? 'private')}
                              disabled={!canManageSelectedServer}
                              onChange={(event) => updateServer(selectedServer.id, (current) => ({
                                ...current,
                                visibility: event.target.value as McpServerPolicy['visibility'],
                                workspaceId: event.target.value === 'workspace'
                                  ? (current.workspaceId || defaultWorkspaceId)
                                  : undefined,
                              }))}
                            >
                              <option value="private">{tr(language, '仅自己可见', 'Private only')}</option>
                              <option value="workspace">{tr(language, '共享到当前组织', 'Share to organization')}</option>
                            </NativeSelect>
                          </Field>
                        ) : null}
                      </div>
                      {!selectedServer.managedBySystem && (selectedServer.visibility === 'workspace' || selectedServer.visibility === 'team') ? (
                        defaultWorkspaceId ? (
                          <p className="text-xs text-zinc-500">
                            {tr(language, '共享到', 'Shared to')} {selectedWorkspace?.name || tr(language, '当前组织', 'the current organization')}
                          </p>
                        ) : (
                          <Field label={tr(language, '组织', 'Organization')}>
                            <NativeSelect
                              value={selectedServer.workspaceId ?? ''}
                              disabled={!canManageSelectedServer}
                              onChange={(event) => updateServer(selectedServer.id, (current) => ({
                                ...current,
                                workspaceId: event.target.value || undefined,
                              }))}
                            >
                              <option value="">{tr(language, '选择组织', 'Select organization')}</option>
                              {workspaces.map((workspace) => (
                                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                              ))}
                            </NativeSelect>
                          </Field>
                        )
                      ) : null}
                    </SectionCard>

                    {/* Used by Agents */}
                    <SectionCard
                      icon={<Wrench className="h-3.5 w-3.5" />}
                      title={tr(language, 'Used by Agents', 'Used by Agents')}
                    >
                      <div className="space-y-2">
                        {selectedServerUsage && selectedServerUsage.items.length > 0 ? selectedServerUsage.items.map((item) => (
                          <div key={`${item.agentId}-${item.runtime}`} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-zinc-100">{item.agentName}</p>
                                <p className="mt-1 text-[11px] text-zinc-500">{item.runtime}</p>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <Badge className={item.enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300' : 'border-zinc-800 bg-zinc-950 text-[10px] text-zinc-400'}>
                                  {item.enabled ? tr(language, '已启用', 'Enabled') : tr(language, '已禁用', 'Disabled')}
                                </Badge>
                                {item.piToolReady ? (
                                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">
                                    {tr(language, 'Pi Tool Ready', 'Pi tool-ready')}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-4 text-center text-xs text-zinc-500">
                            {tr(language, '当前还没有 Agent 使用这个 MCP。', 'No agent is using this MCP yet.')}
                          </div>
                        )}
                      </div>
                    </SectionCard>
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </Group>
      </div>

      <McpCreateDialog
        busy={busy}
        open={createOpen}
        onCreate={createServer}
        onOpenChange={setCreateOpen}
      />
    </>
  )
}

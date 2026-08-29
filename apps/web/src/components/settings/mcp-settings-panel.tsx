import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Cable,
  ChevronRight,
  Cpu,
  FolderTree,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Switch } from '../ui/switch'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '../../lib/utils'
import {
  buildMcpServerPolicies,
  parseMcpServerPolicies,
  type McpServerPolicy,
} from '../../lib/agent-config'

const mcpPresets = [
  { name: 'filesystem', target: 'http://127.0.0.1:7001/mcp', transport: 'http' as const, summary: '本地文件读写与目录遍历' },
  { name: 'github', target: 'stdio://gh-mcp', transport: 'stdio' as const, summary: '仓库、Issue 与 PR 操作' },
  { name: 'vibemux', target: 'built-in://vibemux', transport: 'http' as const, summary: '系统内建控制面入口' },
]

const createId = (prefix: string) => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2, 10)}`

const transportTone: Record<McpServerPolicy['transport'], string> = {
  http: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
  sse: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
  stdio: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
  custom: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
}

const capabilityTone: Record<McpServerPolicy['capabilityMode'], string> = {
  resources: 'border-zinc-700 bg-zinc-900 text-zinc-200',
  'resources+tools': 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
}

type McpSettingsPanelProps = {
  busy: boolean
  servers: McpServerPolicy[]
  onChange: (servers: McpServerPolicy[]) => void
  onSave: () => void
}

export function McpSettingsPanel({
  busy,
  servers,
  onChange,
  onSave,
}: McpSettingsPanelProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState('')

  const normalizedServers = useMemo(() => parseMcpServerPolicies(servers), [servers])
  const enabledCount = normalizedServers.filter((item) => item.enabled).length
  const toolCount = normalizedServers.filter((item) => item.enabled && item.capabilityMode === 'resources+tools').length
  const systemCount = normalizedServers.filter((item) => item.managedBySystem).length

  const filteredServers = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return normalizedServers
    }

    return normalizedServers.filter((item) => {
      const haystack = [item.name, item.target, item.transport, item.capabilityMode].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [normalizedServers, query])

  const selectedServer = useMemo(
    () => filteredServers.find((item) => item.id === selectedId) ?? filteredServers[0] ?? null,
    [filteredServers, selectedId],
  )

  useEffect(() => {
    if (selectedServer?.id && selectedServer.id !== selectedId) {
      setSelectedId(selectedServer.id)
    }
  }, [selectedId, selectedServer?.id])

  const updateServer = (serverId: string, updater: (current: McpServerPolicy) => McpServerPolicy) => {
    onChange(buildMcpServerPolicies(
      normalizedServers.map((item) => (item.id === serverId ? updater(item) : item)),
    ))
  }

  const addServer = (name: string, target: string, transport: McpServerPolicy['transport']) => {
    const trimmedName = name.trim()
    const trimmedTarget = target.trim()
    if (!trimmedName || !trimmedTarget) {
      return
    }

    if (normalizedServers.some((item) => item.name.toLowerCase() === trimmedName.toLowerCase())) {
      return
    }

    onChange(buildMcpServerPolicies([
      ...normalizedServers,
      {
        id: createId('mcp'),
        name: trimmedName,
        target: trimmedTarget,
        transport,
        enabled: true,
        capabilityMode: 'resources',
      },
    ]))
    setNewName('')
    setNewTarget('')
    setCreateOpen(false)
  }

  return (
    <Card className="overflow-hidden rounded-[1.75rem] border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(24,24,27,0.96),rgba(9,9,11,0.98)_60%)] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <CardContent className="p-0">
        <div className="grid min-h-[calc(100vh-12rem)] xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside className="border-b border-zinc-800 xl:border-b-0 xl:border-r">
            <div className="border-b border-zinc-800 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-amber-200">
                    <Sparkles size={12} />
                    MCP Registry
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">系统 MCP</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    对齐 Skills 的布局：左边维护全局 registry，右边编辑单个 MCP 的能力策略与连接信息。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={busy}
                    onClick={() => void onSave()}
                    className="border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <Save size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCreateOpen((current) => !current)}
                    className="border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <Plus size={16} />
                  </Button>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">系统分发</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  这里保存的是系统级 MCP 配置。worker 与所有 Agent 都从这份 registry 获取默认 MCP。
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  总数 {normalizedServers.length} · 启用 {enabledCount} · tools {toolCount} · 内建 {systemCount}
                </p>
              </div>

              <div className="mt-4">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="按名称、target、transport 过滤"
                  className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
                />
              </div>
            </div>

            {createOpen ? (
              <div className="border-b border-zinc-800 bg-zinc-950/40 px-5 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">新建 MCP</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {mcpPresets.map((preset) => (
                    <Button
                      key={preset.name}
                      type="button"
                      variant="outline"
                      onClick={() => addServer(preset.name, preset.target, preset.transport)}
                      className="rounded-full border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
                    >
                      + {preset.name}
                    </Button>
                  ))}
                </div>
                <div className="mt-3 space-y-3">
                  <Input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="MCP 名称"
                    className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
                  />
                  <Input
                    value={newTarget}
                    onChange={(event) => setNewTarget(event.target.value)}
                    placeholder="Target，例如 http://127.0.0.1:7001/mcp"
                    className="border-zinc-800 bg-zinc-950/60 font-mono text-zinc-100 placeholder:text-zinc-500"
                  />
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-xs leading-5 text-zinc-500">
                    这里只登记 registry 条目。更细的 transport、capability mode 和启用状态，在右侧详情面板继续调整。
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setCreateOpen(false)}
                      className="text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    >
                      取消
                    </Button>
                    <Button
                      onClick={() => addServer(newName, newTarget, newTarget.startsWith('stdio://') ? 'stdio' : 'http')}
                      className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                    >
                      创建 MCP
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <ScrollArea className="h-[calc(100vh-20rem)] min-h-[28rem]">
              <div className="divide-y divide-zinc-800">
                {filteredServers.map((item) => {
                  const ready = item.managedBySystem || Boolean(item.target.trim())
                  const active = selectedServer?.id === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'w-full px-5 py-4 text-left transition-colors',
                        active ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/60',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-zinc-100">{item.name}</span>
                            {item.managedBySystem ? (
                              <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-200">Built-in</Badge>
                            ) : null}
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{item.target}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge className={transportTone[item.transport]}>{item.transport}</Badge>
                            <Badge className={capabilityTone[item.capabilityMode]}>{item.capabilityMode}</Badge>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge className={item.enabled ? (ready ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/20 bg-amber-500/10 text-amber-200') : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>
                            {item.enabled ? (ready ? 'Ready' : 'Incomplete') : 'Disabled'}
                          </Badge>
                          <ChevronRight size={14} className={cn('text-zinc-600 transition-transform', active && 'translate-x-0.5 text-zinc-300')} />
                        </div>
                      </div>
                    </button>
                  )
                })}
                {filteredServers.length === 0 ? (
                  <EmptyState
                    title="还没有匹配的 MCP"
                    description="试试更短的关键词，或者点右上角 + 创建一个新的全局 MCP registry 条目。"
                  />
                ) : null}
              </div>
            </ScrollArea>
          </aside>

          <section className="min-w-0">
            {selectedServer ? (
              <div className="flex h-full min-h-[32rem] flex-col">
                <div className="border-b border-zinc-800 px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                        <Wrench size={12} />
                        MCP Detail
                      </div>
                      <h3 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">{selectedServer.name}</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                        {selectedServer.managedBySystem
                          ? '系统内建 MCP，只能控制启用状态，不能删除。'
                          : '这里维护这个 MCP 在全局系统里的连接信息、transport 和能力暴露范围。'}
                      </p>
                    </div>
                    <label className="flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-950/70 px-4 py-2 text-sm text-zinc-300">
                      全局启用
                      <Switch
                        checked={selectedServer.enabled}
                        onCheckedChange={(checked) => updateServer(selectedServer.id, (current) => ({ ...current, enabled: checked }))}
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge className={transportTone[selectedServer.transport]}>{selectedServer.transport}</Badge>
                    <Badge className={capabilityTone[selectedServer.capabilityMode]}>{selectedServer.capabilityMode}</Badge>
                    <Badge className="border-zinc-700 bg-zinc-900 text-zinc-300">
                      {selectedServer.managedBySystem ? 'system' : 'custom'}
                    </Badge>
                  </div>
                </div>

                <div className="grid flex-1 gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-6">
                    <FieldSection
                      icon={<FolderTree className="h-4 w-4" />}
                      title="Connection"
                      description="这个 MCP 在系统 registry 中的名称与目标地址。"
                    >
                      <Field label="Server name">
                        <Input
                          value={selectedServer.name}
                          disabled={selectedServer.managedBySystem}
                          onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, name: event.target.value }))}
                          className="border-zinc-800 bg-zinc-950/60 text-zinc-100"
                        />
                      </Field>
                      <Field label="Target">
                        <Input
                          value={selectedServer.managedBySystem ? '系统自动注入 /mcp/executor' : selectedServer.target}
                          disabled={selectedServer.managedBySystem}
                          onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, target: event.target.value }))}
                          className="border-zinc-800 bg-zinc-950/60 font-mono text-zinc-100"
                        />
                      </Field>
                    </FieldSection>

                    <FieldSection
                      icon={<Cable className="h-4 w-4" />}
                      title="Capability Policy"
                      description="决定 worker 怎么连它，以及系统默认向模型暴露哪些能力。"
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Transport">
                          <NativeSelect
                            value={selectedServer.transport}
                            disabled={selectedServer.managedBySystem}
                            onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, transport: event.target.value as McpServerPolicy['transport'] }))}
                          >
                            <option value="http">http</option>
                            <option value="sse">sse</option>
                            <option value="stdio">stdio</option>
                            <option value="custom">custom</option>
                          </NativeSelect>
                        </Field>
                        <Field label="Capability mode">
                          <NativeSelect
                            value={selectedServer.capabilityMode}
                            disabled={selectedServer.managedBySystem}
                            onChange={(event) => updateServer(selectedServer.id, (current) => ({ ...current, capabilityMode: event.target.value as McpServerPolicy['capabilityMode'] }))}
                          >
                            <option value="resources">resources</option>
                            <option value="resources+tools">resources+tools</option>
                          </NativeSelect>
                        </Field>
                      </div>
                    </FieldSection>
                  </div>

                  <div className="space-y-4">
                    <FieldSection
                      icon={<Cpu className="h-4 w-4" />}
                      title="Rollout"
                      description="系统级 MCP 的行为提示。"
                    >
                      <InfoCard label="分发来源" value="系统设置" helper="worker 与全部 Agent 共用同一份配置" />
                      <InfoCard label="推荐暴露" value="resources" helper="默认更稳，只有需要工具调用时再放开 tools" />
                      <InfoCard label="内建入口" value={selectedServer.managedBySystem ? '是' : '否'} helper={selectedServer.managedBySystem ? '不能删除，只能启停' : '可自由编辑和移除'} />
                    </FieldSection>

                    <FieldSection
                      icon={<ShieldCheck className="h-4 w-4" />}
                      title="Danger Zone"
                      description="移除的是 registry 条目，不会删除外部 MCP 服务本体。"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={selectedServer.managedBySystem}
                        onClick={() => onChange(buildMcpServerPolicies(normalizedServers.filter((item) => item.id !== selectedServer.id)))}
                        className="w-full rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15 hover:text-rose-100"
                      >
                        移除这个 MCP
                      </Button>
                    </FieldSection>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[32rem] items-center justify-center px-6">
                <EmptyState
                  title="还没有可编辑的 MCP"
                  description="先在左侧创建或选择一个 MCP 条目，再到这里编辑 transport、target 和能力暴露策略。"
                />
              </div>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function FieldSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-300">
          {icon}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      {children}
    </div>
  )
}

function InfoCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{helper}</p>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
        <Wrench size={22} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-zinc-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  )
}

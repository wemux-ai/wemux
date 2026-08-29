// [INPUT]: GET /api/admin/nodes 返回的集群节点状态
// [OUTPUT]: 多后端节点状态页（节点列表 / 心跳 / /api/ready 探测 / 执行器归属 / 当前节点高亮）
// [POS]: Admin 节点状态视图（P1-4 可观测性）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useState } from 'react'
import { RefreshCw, Server, Wifi, WifiOff, Loader2, Cpu, Database, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import type { AdminNodeRecord, AdminNodesResponse } from '@/lib/api/methods/admin'
import { Button } from '@/components/ui-admin/button'
import { cn } from '@/lib/utils'

const heartbeatFreshMs = 120_000

const formatAge = (ageMs: number | null) => {
  if (ageMs === null) return '-'
  if (ageMs < 1000) return `${ageMs}ms`
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m`
  return `${(ageMs / 3_600_000).toFixed(1)}h`
}

export function AdminNodesPage() {
  const [data, setData] = useState<AdminNodesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    setRefreshing(true)
    try {
      const response = await api.getAdminNodes()
      setData(response)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (error) {
      console.error('Failed to load admin nodes:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载节点状态…
      </div>
    )
  }

  const nodes = data?.nodes ?? []
  const readyCount = nodes.filter((node) => node.probe?.ready === true).length
  const onlineCount = nodes.filter((node) => node.status === 'online').length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">多后端节点状态</h1>
          <p className="text-sm text-muted-foreground">
            集群共 {nodes.length} 节点 · {onlineCount} 在线 · {readyCount} /api/ready 可达
            {lastUpdated ? ` · 更新于 ${lastUpdated}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          刷新
        </Button>
      </div>

      <div className="grid gap-4">
        {nodes.map((node) => (
          <NodeCard key={node.nodeId} node={node} />
        ))}
      </div>
    </div>
  )
}

function NodeCard({ node }: { node: AdminNodeRecord }) {
  const fresh = node.heartbeatAgeMs !== null && node.heartbeatAgeMs <= heartbeatFreshMs
  const probeReady = node.probe?.ready
  const statusLabel = node.status === 'online' ? 'online' : node.status

  return (
    <div className={cn(
      'rounded-lg border bg-card p-4',
      node.isCurrent && 'ring-1 ring-primary/40',
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-md',
            node.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground',
          )}>
            <Server className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{node.nodeId}</span>
              {node.isCurrent && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">当前节点</span>
              )}
              {node.region && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{node.region}</span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {node.name}
              {node.version ? ` · v${node.version}` : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <StatusBadge label={statusLabel} tone={node.status === 'online' ? 'ok' : 'warn'} />
            <StatusBadge
              label={probeReady === true ? '/api/ready 200' : probeReady === null ? '未探测' : 'ready 不可达'}
              tone={probeReady === true ? 'ok' : probeReady === null ? 'muted' : 'danger'}
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            心跳 {formatAge(node.heartbeatAgeMs)}
            {!fresh && <span className="text-amber-500">（过期）</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={<Wifi className="h-3.5 w-3.5" />} label="执行器归属" value={String(node.executorCount)} />
        <Metric icon={<Cpu className="h-3.5 w-3.5" />} label="运行中任务" value={String(node.activeTasks)} />
        <Metric label="并发上限" value={String(node.maxConcurrentTasks)} />
        <Metric label="项目绑定" value={node.hasProjectBinding ? '是' : '否'} />
      </div>

      {node.probe?.error && (
        <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <WifiOff className="h-3.5 w-3.5" />
          {node.probe.error}
        </div>
      )}
      {node.url && (
        <div className="mt-3 truncate font-mono text-[11px] text-muted-foreground">
          <Database className="mr-1 inline h-3 w-3" />
          {node.url}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[11px] font-medium',
      tone === 'ok' && 'bg-emerald-500/10 text-emerald-600',
      tone === 'warn' && 'bg-amber-500/10 text-amber-600',
      tone === 'danger' && 'bg-red-500/10 text-red-600',
      tone === 'muted' && 'bg-muted text-muted-foreground',
    )}>
      {label}
    </span>
  )
}

function Metric({ icon, label, value }: { icon?: import('react').ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  )
}

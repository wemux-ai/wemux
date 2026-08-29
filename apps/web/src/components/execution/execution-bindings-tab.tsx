import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import type { ClusterNode, ExecutorRecord, Project, ProjectBinding } from '@shared/types'
import { useTranslation } from '../../lib/i18n/react'

const panelClassName = 'rounded-xl border border-zinc-800/80 bg-zinc-950/60 shadow-sm shadow-black/20'

export function BindingsTab({
  bindings,
  projects,
  executors,
  nodes,
}: {
  bindings: ProjectBinding[]
  projects: Project[]
  executors: ExecutorRecord[]
  nodes: ClusterNode[]
}) {
  const { t } = useTranslation()

  return (
    <Card className={panelClassName}>
      <CardContent className="p-5">
        <h3 className="text-lg font-medium text-zinc-50">{t('execution.bindings.title', { defaultValue: '项目绑定' })}</h3>
        <p className="mt-1 text-sm text-zinc-400">{t('execution.bindings.activeCount', { defaultValue: '{{count}} 个活跃绑定', count: bindings.length })}</p>

        {bindings.length === 0 ? (
          <p className="mt-8 text-center text-sm text-zinc-500">{t('execution.bindings.empty', { defaultValue: '暂无活跃绑定' })}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {bindings.map((binding) => {
              const project = projects.find((p) => p.id === binding.projectId)
              const executor = executors.find((e) => e.executorId === binding.nodeId)
              const node = nodes.find((n) => n.nodeId === binding.nodeId)

              return (
                <div key={`${binding.projectId}-${binding.nodeId}`} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">{project?.name || binding.projectId}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">{binding.repoUrl}</p>
                    </div>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">active</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-3 py-2">
                      <p className="text-zinc-500">{t('execution.bindings.target', { defaultValue: '绑定目标' })}</p>
                      <p className="mt-0.5 text-zinc-200">{executor?.name || node?.name || binding.nodeId}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-3 py-2">
                      <p className="text-zinc-500">{t('execution.bindings.defaultBranch', { defaultValue: '默认分支' })}</p>
                      <p className="mt-0.5 text-zinc-200">{binding.defaultBranch}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Bot, CircleDot, Inbox, Sparkles } from 'lucide-react'
import { useApp } from '../../lib/app-provider'
import { filterTasksForCollaborationWorkspace } from '../../lib/app-helpers'
import { useTranslation } from '../../lib/i18n/react'
import { CURRENT_APP_VERSION, isNodeVersionOutdated } from '../../lib/node-version'
import { useExecutorRuntimeData } from '../../lib/use-executor-runtime-data'
import { useInbox } from '../../lib/inbox-provider'
import { useAvailableAgents } from '../../lib/use-available-agents'
import { useAgentLiveStatuses } from '../../lib/agent-live-status'
import {
  getAgentBreakdown,
  getLastDays,
  getRecentActivity,
  getTaskActivityHeatmap,
  getTaskUpdateSeries,
  sortTasksByUpdatedAt,
} from './dashboard-data'
import {
  activityRowKeyframes,
  ActivityHeatmapCard,
  AgentBreakdownChart,
  AgentTeamPanel,
  ChartCard,
  CollapsibleHeatmap,
  EmptyPanel,
  HealthChart,
  InboxGroupRow,
  MetricCard,
  ProjectSnapshotSection,
  RecentTaskRow,
  SectionTitle,
} from './dashboard-sections'

type Metrics = {
  activeAgents: number
  total: number
  inProgressTasks: number
  pendingApprovals: number
  done: number
  retries: number
}

export function DashboardPage({ metrics, workspaceId }: { metrics: Metrics; workspaceId?: string }) {
  const { t } = useTranslation()
  const { state } = useApp()
  // 复用 useExecutorRuntimeData 的共享 react-query 缓存/轮询,
  // 避免和 execution 路由、workspaces 页面各自发起独立的 listExecutors 轮询。
  const { executors } = useExecutorRuntimeData()
  const inbox = useInbox()
  const { agents } = useAvailableAgents()
  const agentLiveStatuses = useAgentLiveStatuses()

  const allTasks = useMemo(() => filterTasksForCollaborationWorkspace(state, workspaceId), [state.tasks, workspaceId])
  const completionRate = metrics.total > 0 ? Math.round((metrics.done / metrics.total) * 100) : 0
  const pendingApprovals = metrics.pendingApprovals
  const recentTasks = useMemo(() => sortTasksByUpdatedAt(allTasks).slice(0, 10), [allTasks])
  const last14Days = useMemo(() => getLastDays(14), [])
  const taskUpdateSeries = useMemo(() => getTaskUpdateSeries(allTasks, last14Days), [allTasks, last14Days])
  const taskActivityHeatmap = useMemo(() => getTaskActivityHeatmap(allTasks, 16), [allTasks])
  const agentBreakdown = useMemo(() => getAgentBreakdown(allTasks), [allTasks])
  const retryDensity = metrics.total > 0 ? Math.min(100, Math.round((metrics.retries / metrics.total) * 100)) : 0
  const reviewLoad = metrics.total > 0 ? Math.round((pendingApprovals / metrics.total) * 100) : 0
  const outdatedNodes = useMemo(
    () => executors.filter((executor) => isNodeVersionOutdated(executor.version)),
    [executors],
  )

  const inboxBadgeCount = inbox.badgeCount
  const inboxActionGroups = inbox.groups.action?.entries ?? []

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <style>{activityRowKeyframes}</style>

      {/* 节点版本告警 */}
      {outdatedNodes.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(255,255,255,0.02))] px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-amber-50">{t('dashboard.page.nodeVersionAlertTitle', { count: outdatedNodes.length })}</p>
                <p className="text-xs text-amber-100/70">{t('dashboard.page.nodeVersionAlertDescription', { version: CURRENT_APP_VERSION })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {outdatedNodes.slice(0, 4).map((node) => (
                  <span key={node.executorId} className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                    {node.name} · v{node.version || '-'}
                  </span>
                ))}
                {outdatedNodes.length > 4 ? (
                  <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                    +{outdatedNodes.length - 4}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <Link
            to="/execution"
            search={{ createExecutor: undefined, editExecutorId: undefined, terminalExecutorId: undefined, workspaceId: undefined, teamId: undefined }}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-md border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 underline-offset-2 hover:bg-amber-500/15 sm:w-auto sm:bg-transparent sm:px-0 sm:py-0 sm:underline"
          >
            {t('dashboard.page.nodeVersionAlertAction')}
          </Link>
        </div>
      ) : null}

      {/* 4 个指标卡：第 4 位换为收件箱待办数 */}
      <section className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="grid grid-cols-2 gap-px xl:grid-cols-4">
          <MetricCard
            icon={Bot}
            value={metrics.activeAgents}
            label={t('dashboard.metrics.activeAgents')}
          />
          <MetricCard
            icon={CircleDot}
            value={metrics.inProgressTasks}
            label={t('dashboard.metrics.inProgress')}
          />
          <MetricCard
            icon={Sparkles}
            value={completionRate > 0 ? `${completionRate}%` : '0%'}
            label={t('dashboard.metrics.completionRate')}
          />
          <MetricCard
            icon={Inbox}
            value={inboxBadgeCount}
            label={t('dashboard.metrics.pending')}
          />
        </div>
      </section>

      {/* Agent 团队状态 */}
      <AgentTeamPanel
        agents={agents}
        liveStatuses={agentLiveStatuses}
        workspaceSessions={state.workspaceSessions}
        taskWorkspaceBindings={state.taskWorkspaceBindings}
        tasks={state.tasks}
        executors={executors}
      />

      {/* 项目快照：14 天趋势 + 状态分布 */}
      <ProjectSnapshotSection
        tasks={allTasks}
        trendPoints={last14Days}
        trendValues={taskUpdateSeries}
      />

      {/* 底部双栏：协作动态（inbox）+ 最近任务 */}
      <section className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="grid divide-y divide-zinc-800 md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="min-w-0">
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 sm:px-5">
              <SectionTitle title={t('dashboard.collab.sectionTitle')} />
              <Link to={'/inbox' as never} search={{} as never} className="text-[11px] text-zinc-500 hover:text-zinc-300">
                {t('dashboard.collab.viewAll')}
              </Link>
            </div>
            {inboxActionGroups.length === 0 ? (
              <div className="px-4 py-6 sm:px-5">
                <EmptyPanel message={t('dashboard.collab.empty')} />
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {inboxActionGroups.slice(0, 8).map((group) => (
                  <InboxGroupRow key={group.groupKey} group={group} />
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="border-b border-zinc-800/80 px-4 py-3 sm:px-5">
              <SectionTitle title={t('dashboard.sections.recentTasksTitle')} />
            </div>
            {recentTasks.length === 0 ? (
              <div className="px-4 py-6 sm:px-5">
                <EmptyPanel message={t('dashboard.sections.noTasks')} />
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {recentTasks.map((task) => (
                  <RecentTaskRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Agent 分布 + 健康度图表 */}
      <section className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="grid gap-px lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <ChartCard
            title={t('dashboard.charts.agentTitle')}
            subtitle={t('dashboard.charts.currentProject')}
            className="border-0 px-5 py-5"
          >
            <AgentBreakdownChart items={agentBreakdown} />
          </ChartCard>
          <ChartCard
            title={t('dashboard.charts.healthTitle')}
            subtitle={t('dashboard.charts.keyRatios')}
            className="border-0 px-5 py-5"
          >
            <HealthChart
              rows={[
                { label: t('dashboard.charts.completionRate'), value: completionRate, tone: 'emerald' },
                { label: t('dashboard.charts.reviewLoad'), value: reviewLoad, tone: 'violet' },
                { label: t('dashboard.charts.retryDensity'), value: retryDensity, tone: 'amber' },
              ]}
            />
          </ChartCard>
        </div>
      </section>

      {/* 热力图（默认折叠，按需展开） */}
      <CollapsibleHeatmap>
        <ActivityHeatmapCard days={taskActivityHeatmap} />
      </CollapsibleHeatmap>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import { Bot, Camera, CheckCircle2, Copy, RefreshCw, TerminalSquare, Wrench, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import type { ConversationMessageRecord } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { PreviewableImage } from '../ui/previewable-image'
import { useWorkspaceSidePanelHeaderActions } from './workspace-side-panel-header-actions'
import {
  buildReportCopyText,
  buildRuns,
  extractStructuredReport,
  getObservationFromMessage,
  getSubagentHandoffFromMessage,
  getTestReportSnapshotFromMessage,
  normalizeTextPreview,
  type SubagentHandoffRecord,
  type TestRecordViewMode,
  type TestReportSnapshotRecord,
} from './workspace-test-record-panel-helpers'

const observationToneClassName: Record<TaskSubagentObservation['level'], string> = {
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-100',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  error: 'border-rose-500/20 bg-rose-500/10 text-rose-100',
}

export function WorkspaceTestRecordPanel({
  messages,
  loading = false,
  refreshing = false,
  liveStatus = 'closed',
  repairingObservationId = null,
  onRefresh,
  onCreateRepairSession,
  onOpenSession,
}: {
  messages: ConversationMessageRecord[]
  loading?: boolean
  refreshing?: boolean
  liveStatus?: 'connecting' | 'open' | 'closed' | 'error'
  repairingObservationId?: string | null
  onRefresh?: () => void
  onCreateRepairSession?: (observation: TaskSubagentObservation) => void
  onOpenSession?: (workspaceSessionId: string) => void
}) {
  const { t } = useTranslation()
  const headerActions = useWorkspaceSidePanelHeaderActions()
  const [viewMode, setViewMode] = useState<TestRecordViewMode>('latest')
  const [focusedObservationId, setFocusedObservationId] = useState<string | null>(null)
  const [reportCopied, setReportCopied] = useState(false)
  const [snapshotBranchFilter, setSnapshotBranchFilter] = useState<string>('all')
  const [snapshotCommitFilter, setSnapshotCommitFilter] = useState<string>('all')
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const observationKindMeta = useMemo<Record<TaskSubagentObservation['kind'], { label: string; icon: typeof Bot }>>(() => ({
    action: { label: t('workspace.testing.observationKinds.action', { defaultValue: '动作' }), icon: Bot },
    terminal: { label: t('workspace.testing.observationKinds.terminal', { defaultValue: '终端' }), icon: TerminalSquare },
    'browser-console': { label: t('workspace.testing.observationKinds.browserConsoleShort', { defaultValue: 'Console' }), icon: Bot },
    network: { label: t('workspace.testing.observationKinds.networkShort', { defaultValue: 'Network' }), icon: Wifi },
    screenshot: { label: t('workspace.testing.observationKinds.screenshot', { defaultValue: '截图' }), icon: Camera },
  }), [t])
  const runStatusText = useCallback((status: 'failed' | 'completed' | 'running') => {
    if (status === 'failed') return t('workspace.records.status.failed', { defaultValue: '异常' })
    if (status === 'completed') return t('workspace.records.status.completed', { defaultValue: '完成' })
    return t('workspace.records.status.running', { defaultValue: '进行中' })
  }, [t])

  const runs = useMemo(() => buildRuns(messages), [messages])
  const latestRun = runs[0] ?? null
  const allObservations = useMemo(
    () => messages.map((message) => getObservationFromMessage(message)).filter(Boolean) as TaskSubagentObservation[],
    [messages],
  )
  const latestReport = useMemo(() => {
    return [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && !getObservationFromMessage(message) && !getSubagentHandoffFromMessage(message))
      ?? null
  }, [messages])
  const recentHandoffs = useMemo(() => {
    return [...messages]
      .map((message) => getSubagentHandoffFromMessage(message))
      .filter(Boolean) as SubagentHandoffRecord[]
  }, [messages])
  const reportSnapshots = useMemo(() => {
    return [...messages]
      .map((message) => getTestReportSnapshotFromMessage(message))
      .filter(Boolean)
      .reverse() as TestReportSnapshotRecord[]
  }, [messages])
  const latestSnapshot = reportSnapshots[0] ?? null
  const snapshotBranchOptions = useMemo(() => {
    return Array.from(new Set(reportSnapshots.map((item) => item.branchName?.trim()).filter(Boolean) as string[]))
  }, [reportSnapshots])
  const snapshotCommitOptions = useMemo(() => {
    return Array.from(new Map(
      reportSnapshots
        .filter((item) => snapshotBranchFilter === 'all' || item.branchName === snapshotBranchFilter)
        .filter((item) => item.commitSha && item.commitShortSha)
        .map((item) => [
          item.commitSha!,
          {
            sha: item.commitSha!,
            shortSha: item.commitShortSha!,
            title: item.commitTitle || '',
          },
        ]),
    ).values())
  }, [reportSnapshots, snapshotBranchFilter])
  const filteredSnapshots = useMemo(() => {
    return reportSnapshots.filter((item) => {
      if (snapshotBranchFilter !== 'all' && item.branchName !== snapshotBranchFilter) {
        return false
      }

      if (snapshotCommitFilter !== 'all' && item.commitSha !== snapshotCommitFilter) {
        return false
      }

      return true
    })
  }, [reportSnapshots, snapshotBranchFilter, snapshotCommitFilter])
  const activeRuns = viewMode === 'latest' && runs.length > 0 ? runs.slice(0, 1) : runs
  const activeObservations = activeRuns.length > 0
    ? activeRuns.flatMap((run) => run.observations)
    : allObservations
  const latestProblem = useMemo(() => {
    return latestRun?.observations.find((item) => item.level === 'error' || item.level === 'warning') ?? null
  }, [latestRun])
  const structuredReport = useMemo(
    () => latestReport ? extractStructuredReport(latestReport.content) : [],
    [latestReport],
  )
  const recentProblems = useMemo(() => {
    const source = latestRun?.observations ?? allObservations
    return source
      .filter((item) => item.level === 'error' || item.level === 'warning')
      .slice(-3)
      .reverse()
  }, [allObservations, latestRun])
  const latestScreenshot = useMemo(() => {
    const source = latestRun?.observations ?? allObservations
    const screenshotObservation = [...source]
      .reverse()
      .find((item) => item.kind === 'screenshot' && (item.attachments?.some((attachment) => attachment.contentType?.startsWith('image/')) || item.url))
    if (!screenshotObservation) {
      return null
    }

    const attachment = screenshotObservation.attachments?.find((item) => item.contentType?.startsWith('image/'))
    return {
      observation: screenshotObservation,
      imageUrl: attachment?.url || screenshotObservation.url || '',
      imageName: attachment?.filename || screenshotObservation.title,
    }
  }, [allObservations, latestRun])
  const stats = useMemo(() => ({
    total: activeObservations.length,
    errors: activeObservations.filter((item) => item.level === 'error').length,
    warnings: activeObservations.filter((item) => item.level === 'warning').length,
    screenshots: activeObservations.filter((item) => item.kind === 'screenshot').length,
  }), [activeObservations])
  const jumpToObservation = useCallback((observationId: string) => {
    const element = timelineRef.current?.querySelector<HTMLElement>(`[data-observation-id="${observationId}"]`)
    if (!element) {
      return
    }

    setFocusedObservationId(observationId)
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      setFocusedObservationId((current) => (current === observationId ? null : current))
    }, 2000)
  }, [])
  const handleCopyReport = useCallback(async () => {
    const text = buildReportCopyText({
      run: latestRun,
      latestProblem,
      latestReport,
      latestSnapshot,
    })

    try {
      await navigator.clipboard.writeText(text)
      setReportCopied(true)
      window.setTimeout(() => setReportCopied(false), 2000)
      toast.success(t('workspace.records.copySuccess', { defaultValue: '测试报告已复制。' }))
    } catch {
      toast.error(t('workspace.records.copyFailed', { defaultValue: '复制失败，请手动复制。' }))
    }
  }, [latestProblem, latestReport, latestRun, latestSnapshot, t])
  const handleJumpToSnapshot = useCallback((snapshot: TestReportSnapshotRecord) => {
    const targetObservationId = snapshot.sourceObservationIds?.at(-1)
    if (!targetObservationId) {
      return
    }

    setViewMode('all')
    window.setTimeout(() => {
      jumpToObservation(targetObservationId)
    }, 80)
  }, [jumpToObservation])
  useEffect(() => {
    if (snapshotBranchFilter === 'all') {
      return
    }

    if (!snapshotBranchOptions.includes(snapshotBranchFilter)) {
      setSnapshotBranchFilter('all')
    }
  }, [snapshotBranchFilter, snapshotBranchOptions])
  useEffect(() => {
    if (snapshotCommitFilter === 'all') {
      return
    }

    if (!snapshotCommitOptions.some((item) => item.sha === snapshotCommitFilter)) {
      setSnapshotCommitFilter('all')
    }
  }, [snapshotCommitFilter, snapshotCommitOptions])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
        <CardHeader className="border-b border-zinc-800 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.title', { defaultValue: '测试记录' })}</CardTitle>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t('workspace.records.titleDescription', { defaultValue: '集中查看 tester 子会话收到的终端、浏览器与截图观测。' })}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge className={cn(
                'border',
                liveStatus === 'open'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                  : liveStatus === 'connecting'
                    ? 'border-sky-500/20 bg-sky-500/10 text-sky-200'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400',
              )}>
                {liveStatus === 'open'
                  ? t('workspace.records.liveStatus.open', { defaultValue: '节点已连接' })
                  : liveStatus === 'connecting'
                    ? t('workspace.records.liveStatus.connecting', { defaultValue: '节点连接中' })
                    : t('workspace.records.liveStatus.closed', { defaultValue: '节点未连接' })}
              </Badge>
              {runs.length > 0 ? (
                <div className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-950 p-1">
                  {[
                    { value: 'latest' as const, label: t('workspace.records.viewModes.latest', { defaultValue: '本轮' }) },
                    { value: 'all' as const, label: t('workspace.records.viewModes.all', { defaultValue: '全部' }) },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setViewMode(item.value)}
                      className={cn(
                        'inline-flex h-8 items-center rounded-full px-3 text-xs transition-colors',
                        viewMode === item.value ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {onRefresh ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
                  {t('common.refresh', { defaultValue: '刷新' })}
                </Button>
              ) : null}
              {headerActions}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          {[
            { label: t('workspace.records.stats.total', { defaultValue: '观测总数' }), value: String(stats.total) },
            { label: t('workspace.records.stats.errors', { defaultValue: '错误' }), value: String(stats.errors) },
            { label: t('workspace.records.stats.warnings', { defaultValue: '警告' }), value: String(stats.warnings) },
            { label: t('workspace.records.stats.screenshots', { defaultValue: '截图' }), value: String(stats.screenshots) },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{item.label}</p>
              <p className="mt-2 text-lg font-semibold text-zinc-100">{item.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)_minmax(0,1fr)]">
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
          <CardHeader className="border-b border-zinc-800 pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.summaryTitle', { defaultValue: '测试结论' })}</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleCopyReport()}
                className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
              >
                {reportCopied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {reportCopied ? t('common.copied', { defaultValue: '已复制' }) : t('workspace.records.copySummary', { defaultValue: '复制总结' })}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {latestRun ? (
                <Badge className={cn(
                  'border',
                  latestRun.status === 'failed' && 'border-rose-500/20 bg-rose-500/10 text-rose-200',
                  latestRun.status === 'completed' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
                  latestRun.status === 'running' && 'border-sky-500/20 bg-sky-500/10 text-sky-200',
                )}>
                  {latestRun.status === 'failed'
                    ? t('workspace.records.latestRun.failed', { defaultValue: '本轮异常' })
                    : latestRun.status === 'completed'
                      ? t('workspace.records.latestRun.completed', { defaultValue: '本轮完成' })
                      : t('workspace.records.latestRun.running', { defaultValue: '本轮进行中' })}
                </Badge>
              ) : null}
              {latestRun?.endedAt ? (
                <span className="text-xs text-zinc-500">{t('workspace.records.endedAt', { defaultValue: '结束于 {{value}}', value: formatDate(latestRun.endedAt) })}</span>
              ) : latestRun?.startedAt ? (
                <span className="text-xs text-zinc-500">{t('workspace.records.startedAt', { defaultValue: '开始于 {{value}}', value: formatDate(latestRun.startedAt) })}</span>
              ) : null}
            </div>
            {latestProblem ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                <p className="font-medium">{t('workspace.records.latestProblem', { defaultValue: '最近异常：{{value}}', value: latestProblem.title })}</p>
                {latestProblem.detail ? (
                  <p className="mt-2 text-xs leading-5 text-rose-100/85">{normalizeTextPreview(latestProblem.detail, 160)}</p>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t('workspace.records.testerReport', { defaultValue: 'Tester 报告' })}</p>
              <p className="mt-3 text-sm leading-6 text-zinc-200">
                {latestReport ? normalizeTextPreview(latestReport.content) : t('workspace.records.noTesterReport', { defaultValue: '当前还没有 tester 总结报告，先跑一轮完整测试。' })}
              </p>
              {latestReport ? (
                <p className="mt-3 text-xs text-zinc-500">{formatDate(latestReport.createdAt)}</p>
              ) : null}
            </div>
            {latestSnapshot ? (
              <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t('workspace.records.latestSnapshot', { defaultValue: '最近快照' })}</p>
                  <Badge className={cn(
                    'border',
                    latestSnapshot.runStatus === 'failed' && 'border-rose-500/20 bg-rose-500/10 text-rose-200',
                    latestSnapshot.runStatus === 'completed' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
                    latestSnapshot.runStatus === 'running' && 'border-sky-500/20 bg-sky-500/10 text-sky-200',
                  )}>
                    {runStatusText(latestSnapshot.runStatus)}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-200">{normalizeTextPreview(latestSnapshot.summary)}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                  {latestSnapshot.branchName ? <span>{t('workspace.records.branchName', { defaultValue: '分支 {{value}}', value: latestSnapshot.branchName })}</span> : null}
                  {latestSnapshot.commitShortSha ? <span>{t('workspace.records.commitShortSha', { defaultValue: '提交 {{value}}', value: latestSnapshot.commitShortSha })}</span> : null}
                  <span>{t('workspace.records.snapshotStats.observations', { defaultValue: '观测 {{count}}', count: latestSnapshot.observationsCount })}</span>
                  <span>{t('workspace.records.snapshotStats.errors', { defaultValue: '错误 {{count}}', count: latestSnapshot.errorCount })}</span>
                  <span>{t('workspace.records.snapshotStats.warnings', { defaultValue: '警告 {{count}}', count: latestSnapshot.warningCount })}</span>
                  <span>{t('workspace.records.snapshotStats.screenshots', { defaultValue: '截图 {{count}}', count: latestSnapshot.screenshotCount })}</span>
                </div>
                {latestSnapshot.commitTitle ? (
                  <p className="mt-2 text-xs leading-5 text-zinc-400">{normalizeTextPreview(latestSnapshot.commitTitle, 120)}</p>
                ) : null}
              </div>
            ) : null}
            {structuredReport.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {structuredReport.map((section) => (
                  <div key={section.key} className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{section.label}</p>
                    <div className="mt-3 space-y-2">
                      {section.items.slice(0, 4).map((item) => (
                        <p key={item} className="text-xs leading-5 text-zinc-300">- {normalizeTextPreview(item, 100)}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
          <CardHeader className="border-b border-zinc-800 pb-3">
            <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.latestScreenshot', { defaultValue: '最新截图' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {latestScreenshot?.imageUrl ? (
              <>
                <PreviewableImage
                  src={latestScreenshot.imageUrl}
                  alt={latestScreenshot.imageName}
                  caption={t('workspace.records.imagePreviewHint', { defaultValue: '按 Esc、点击遮罩，或使用关闭按钮退出预览。' })}
                  triggerClassName="w-full overflow-hidden rounded-xl border border-zinc-800 bg-[#09090b] text-left transition hover:border-zinc-700"
                  imageClassName="h-48 w-full object-cover"
                />
                <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                  <p className="text-sm font-medium text-zinc-100">{latestScreenshot.observation.title}</p>
                  <p className="mt-2 text-xs text-zinc-500">{formatDate(latestScreenshot.observation.ts)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => jumpToObservation(latestScreenshot.observation.id)}
                      className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                    >
                      {t('workspace.records.jumpToTimeline', { defaultValue: '定位到时间线' })}
                    </Button>
                    <a
                      href={latestScreenshot.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-200 transition hover:bg-zinc-900 hover:text-zinc-50"
                    >
                      {t('workspace.records.openOriginal', { defaultValue: '打开原图' })}
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-sm text-zinc-500">
                {t('workspace.records.noScreenshotPreview', { defaultValue: '当前还没有可预览截图，先跑一轮带截图的浏览器巡检。' })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
          <CardHeader className="border-b border-zinc-800 pb-3">
            <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.failuresTitle', { defaultValue: '失败定位与回流' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {recentProblems.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t('workspace.records.recentProblems', { defaultValue: '最近失败点' })}</p>
                {recentProblems.map((problem) => (
                  <button
                    key={problem.id}
                    type="button"
                    onClick={() => jumpToObservation(problem.id)}
                    className="block w-full rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-left transition hover:border-zinc-700"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-100">{problem.title}</p>
                      <Badge className={cn(
                        'border',
                        problem.level === 'error'
                          ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
                          : 'border-amber-500/20 bg-amber-500/10 text-amber-200',
                      )}>
                        {problem.level === 'error'
                          ? t('common.error', { defaultValue: '错误' })
                          : t('common.warning', { defaultValue: '警告' })}
                      </Badge>
                    </div>
                    {problem.detail ? (
                      <p className="mt-2 text-xs leading-5 text-zinc-400">{normalizeTextPreview(problem.detail, 100)}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            {recentHandoffs.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-sm text-zinc-500">
                {t('workspace.records.noHandoffs', { defaultValue: '暂无修复或其他子会话回流。' })}
              </div>
            ) : (
              recentHandoffs.slice(0, 3).map((handoff) => (
                <div key={handoff.messageId} className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100">{handoff.childTitle}</p>
                    <Badge className={cn(
                      'border',
                      handoff.status === 'failed'
                        ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
                        : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
                    )}>
                      {handoff.status === 'failed'
                        ? t('workspace.records.status.failed', { defaultValue: '失败' })
                        : t('workspace.records.status.completed', { defaultValue: '完成' })}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{formatDate(handoff.createdAt)}</p>
                  <p className="mt-3 text-xs leading-5 text-zinc-300">{normalizeTextPreview(handoff.content, 140)}</p>
                  {onOpenSession ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenSession(handoff.childSessionId)}
                        className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                      >
                        {t('workspace.records.openSession', { defaultValue: '打开会话' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
        <CardHeader className="border-b border-zinc-800 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.archivesTitle', { defaultValue: '报告快照归档' })}</CardTitle>
              <p className="mt-1 text-xs text-zinc-500">{t('workspace.records.archivesDescription', { defaultValue: '每轮巡检结束后自动沉淀结构化测试快照。' })}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge className="border border-zinc-800 bg-zinc-950 text-zinc-400">
                {t('workspace.records.archivesMatched', { defaultValue: '命中 {{count}} / {{total}}', count: filteredSnapshots.length, total: reportSnapshots.length })}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {reportSnapshots.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-sm text-zinc-500">
              {t('workspace.records.noSnapshots', { defaultValue: '暂无测试快照，先执行一轮浏览器巡检。' })}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSnapshotBranchFilter('all')}
                    className={cn(
                      'inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors',
                      snapshotBranchFilter === 'all'
                        ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                    )}
                  >
                    {t('workspace.records.allBranches', { defaultValue: '全部分支' })}
                  </button>
                  {snapshotBranchOptions.slice(0, 6).map((branch) => (
                    <button
                      key={branch}
                      type="button"
                      onClick={() => {
                        setSnapshotBranchFilter(branch)
                        setSnapshotCommitFilter('all')
                      }}
                      className={cn(
                        'inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors',
                        snapshotBranchFilter === branch
                          ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      {branch}
                    </button>
                  ))}
                </div>
                {snapshotCommitOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSnapshotCommitFilter('all')}
                      className={cn(
                        'inline-flex h-7 items-center rounded-full border px-3 text-[11px] transition-colors',
                        snapshotCommitFilter === 'all'
                          ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100',
                      )}
                    >
                      {t('workspace.records.allCommits', { defaultValue: '全部提交' })}
                    </button>
                    {snapshotCommitOptions.slice(0, 6).map((commit) => (
                      <button
                        key={commit.sha}
                        type="button"
                        onClick={() => setSnapshotCommitFilter(commit.sha)}
                        className={cn(
                          'inline-flex h-7 items-center rounded-full border px-3 text-[11px] transition-colors',
                          snapshotCommitFilter === commit.sha
                            ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100',
                        )}
                      >
                        {commit.shortSha}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 xl:grid-cols-3">
                {filteredSnapshots.slice(0, 6).map((snapshot) => (
                <div key={snapshot.id} className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className={cn(
                        'border',
                        snapshot.runStatus === 'failed' && 'border-rose-500/20 bg-rose-500/10 text-rose-200',
                        snapshot.runStatus === 'completed' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
                        snapshot.runStatus === 'running' && 'border-sky-500/20 bg-sky-500/10 text-sky-200',
                      )}>
                        {runStatusText(snapshot.runStatus)}
                      </Badge>
                    </div>
                    <span className="text-xs text-zinc-500">{formatDate(snapshot.createdAt)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                    {snapshot.branchName ? <span>{t('workspace.records.branchName', { defaultValue: '分支 {{value}}', value: snapshot.branchName })}</span> : null}
                    {snapshot.baseBranch ? <span>{t('workspace.records.baseBranch', { defaultValue: '基线 {{value}}', value: snapshot.baseBranch })}</span> : null}
                    {snapshot.commitShortSha ? <span>{t('workspace.records.commitShortSha', { defaultValue: '提交 {{value}}', value: snapshot.commitShortSha })}</span> : null}
                  </div>
                  {snapshot.commitTitle ? (
                    <p className="mt-2 text-xs leading-5 text-zinc-400">{normalizeTextPreview(snapshot.commitTitle, 80)}</p>
                  ) : null}
                  <p className="mt-3 text-sm leading-6 text-zinc-200">{normalizeTextPreview(snapshot.summary, 160)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                    <span>{t('workspace.records.snapshotStats.observations', { defaultValue: '观测 {{count}}', count: snapshot.observationsCount })}</span>
                    <span>{t('workspace.records.snapshotStats.errors', { defaultValue: '错误 {{count}}', count: snapshot.errorCount })}</span>
                    <span>{t('workspace.records.snapshotStats.warnings', { defaultValue: '警告 {{count}}', count: snapshot.warningCount })}</span>
                    <span>{t('workspace.records.snapshotStats.screenshots', { defaultValue: '截图 {{count}}', count: snapshot.screenshotCount })}</span>
                  </div>
                  {snapshot.failed.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-rose-500/10 bg-rose-500/5 p-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-rose-200/80">{t('workspace.records.reportSections.failed', { defaultValue: '失败项' })}</p>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">{normalizeTextPreview(snapshot.failed[0] ?? '', 100)}</p>
                    </div>
                  ) : null}
                  {snapshot.finalUrl ? (
                    <p className="mt-3 text-xs text-zinc-500">{snapshot.finalUrl}</p>
                  ) : null}
                  {snapshot.sourceObservationIds?.length ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleJumpToSnapshot(snapshot)}
                        className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                      >
                        {t('workspace.records.jumpToTimeline', { defaultValue: '定位到时间线' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
                ))}
              </div>

              {filteredSnapshots.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-sm text-zinc-500">
                  {t('workspace.records.noSnapshotsMatched', { defaultValue: '当前筛选条件下还没有匹配的测试快照。' })}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <Card className="flex h-full min-h-0 items-center justify-center border-zinc-800 bg-zinc-950/70 text-zinc-400 shadow-none">
            <CardContent className="p-6 text-sm">{t('workspace.records.loading', { defaultValue: '正在加载测试记录…' })}</CardContent>
          </Card>
        ) : activeObservations.length === 0 ? (
          <Card className="flex h-full min-h-0 items-center justify-center border-zinc-800 bg-zinc-950/70 text-zinc-400 shadow-none">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-zinc-200">{t('workspace.records.emptyTitle', { defaultValue: '还没有测试记录' })}</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">{t('workspace.records.emptyDescription', { defaultValue: '先运行一次浏览器巡检，记录面板就会展示本轮日志、异常和截图。' })}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <Card className="min-h-0 overflow-hidden border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
              <CardHeader className="border-b border-zinc-800 pb-3">
                <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.runsTitle', { defaultValue: '测试轮次' })}</CardTitle>
              </CardHeader>
              <CardContent className="max-h-full space-y-3 overflow-y-auto p-3">
                {runs.length === 0 ? (
                  <p className="text-xs text-zinc-500">{t('workspace.records.noRuns', { defaultValue: '暂无轮次记录。' })}</p>
                ) : (
                  activeRuns.map((run) => (
                    <div key={run.id} className="rounded-xl border border-zinc-800 bg-[#09090b] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-100">{run.title}</p>
                        <Badge className={cn(
                          'border',
                          run.status === 'failed' && 'border-rose-500/20 bg-rose-500/10 text-rose-200',
                          run.status === 'completed' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
                          run.status === 'running' && 'border-sky-500/20 bg-sky-500/10 text-sky-200',
                        )}>
                          {runStatusText(run.status)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">{formatDate(run.startedAt)}</p>
                      <p className="mt-2 text-xs text-zinc-400">{t('workspace.records.runObservationsCount', { defaultValue: '{{count}} 条观测', count: run.observations.length })}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="min-h-0 overflow-hidden border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
              <CardHeader className="border-b border-zinc-800 pb-3">
                <CardTitle className="text-sm font-medium text-zinc-200">{t('workspace.records.timelineTitle', { defaultValue: '观测时间线' })}</CardTitle>
              </CardHeader>
              <CardContent ref={timelineRef} className="max-h-full space-y-3 overflow-y-auto p-3">
                {activeObservations.map((observation) => {
                  const kindMeta = observationKindMeta[observation.kind]
                  const KindIcon = kindMeta.icon
                  const canRepair = observation.level === 'error' || observation.level === 'warning'
                  return (
                    <div
                      key={observation.id}
                      data-observation-id={observation.id}
                      className={cn(
                        'rounded-xl border p-3 transition-shadow',
                        observationToneClassName[observation.level],
                        focusedObservationId === observation.id && 'ring-2 ring-zinc-100/80 shadow-[0_0_0_1px_rgba(255,255,255,0.2)]',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <KindIcon className="h-4 w-4" />
                          <p className="text-sm font-medium">{observation.title}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {canRepair && onCreateRepairSession ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => onCreateRepairSession(observation)}
                              disabled={repairingObservationId === observation.id}
                              className="h-7 border-current/20 bg-black/10 px-2 text-current hover:bg-black/20"
                            >
                              <Wrench className="mr-1.5 h-3.5 w-3.5" />
                              {repairingObservationId === observation.id
                                ? t('workspace.records.creatingRepair', { defaultValue: '创建中' })
                                : t('workspace.records.startRepair', { defaultValue: '发起修复' })}
                            </Button>
                          ) : null}
                          <Badge className="border border-current/20 bg-black/10 text-current">{kindMeta.label}</Badge>
                          <span className="text-xs opacity-80">{formatDate(observation.ts)}</span>
                        </div>
                      </div>
                      {observation.detail ? (
                        <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 opacity-90">{observation.detail}</p>
                      ) : null}
                      {observation.attachments?.length ? (
                        <div className="mt-3 flex flex-wrap gap-3">
                          {observation.attachments.map((attachment) => {
                            const isImage = attachment.contentType?.startsWith('image/')
                            return isImage ? (
                              <PreviewableImage
                                key={attachment.id}
                                src={attachment.url}
                                alt={attachment.filename}
                                caption={observation.title}
                                triggerClassName="overflow-hidden rounded-lg border border-current/20 bg-black/10"
                                imageClassName="h-28 w-44 object-cover"
                              />
                            ) : (
                              <a
                                key={attachment.id}
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-current/20 bg-black/10 px-3 py-2 text-xs underline-offset-2 hover:underline"
                              >
                                {attachment.filename}
                              </a>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

import type { WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { resolveLocalWorkerEndpoints } from '../../lib/browser-local-network-access'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import type { LocalEnvironmentProbeSnapshot, LocalWorkerDiagnosticsSnapshot } from '../../lib/workspace-local-direct'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type WorkspaceEnvironmentStatusBannerProps = {
  appUrl?: string
  healthUrl?: string
  localEnvironmentProbe?: LocalEnvironmentProbeSnapshot | null
  localWorkerDiagnostics?: LocalWorkerDiagnosticsSnapshot | null
  loading?: boolean
  onOpenApp?: () => void
  onRefreshLocalProbes?: () => void
  onRefresh?: () => void
  status: WorkspaceEnvironmentStatusSnapshot | null
}

const resolveEnvironmentBannerTone = (status: WorkspaceEnvironmentStatusSnapshot['status']) => {
  if (status === 'running') {
    return {
      container: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-50',
      badge: 'border-emerald-400/20 bg-emerald-400/15 text-emerald-100',
    }
  }

  if (status === 'starting' || status === 'checking') {
    return {
      container: 'border-sky-500/20 bg-sky-500/10 text-sky-100',
      badge: 'border-sky-400/20 bg-sky-400/15 text-sky-50',
    }
  }

  if (status === 'stopping') {
    return {
      container: 'border-amber-500/20 bg-amber-500/10 text-amber-50',
      badge: 'border-amber-400/20 bg-amber-400/15 text-amber-100',
    }
  }

  if (status === 'error' || status === 'unreachable') {
    return {
      container: 'border-rose-500/20 bg-rose-500/10 text-rose-100',
      badge: 'border-rose-400/20 bg-rose-400/15 text-rose-50',
    }
  }

  return {
    container: 'border-zinc-800 bg-zinc-950/70 text-zinc-200',
    badge: 'border-zinc-700 bg-zinc-900 text-zinc-100',
  }
}

const resolveEnvironmentStatusLabel = (
  status: WorkspaceEnvironmentStatusSnapshot['status'],
  t: ReturnType<typeof useTranslation>['t'],
) => {
  switch (status) {
    case 'running':
      return t('workspace.environment.status.running', { defaultValue: '运行中' })
    case 'starting':
      return t('workspace.environment.status.starting', { defaultValue: '启动中' })
    case 'stopping':
      return t('workspace.environment.status.stopping', { defaultValue: '停止中' })
    case 'stopped':
      return t('workspace.environment.status.stopped', { defaultValue: '已停止' })
    case 'checking':
      return t('workspace.environment.status.checking', { defaultValue: '检查中' })
    case 'unreachable':
      return t('workspace.environment.status.unreachable', { defaultValue: '不可达' })
    case 'error':
      return t('workspace.environment.status.error', { defaultValue: '异常' })
    default:
      return t('workspace.environment.status.unsupported', { defaultValue: '未接入探测' })
  }
}

export function WorkspaceEnvironmentStatusBanner({
  appUrl,
  healthUrl,
  localEnvironmentProbe,
  localWorkerDiagnostics,
  loading = false,
  onOpenApp,
  onRefreshLocalProbes,
  onRefresh,
  status,
}: WorkspaceEnvironmentStatusBannerProps) {
  const { t } = useTranslation()
  const defaultLocalWorkerStatusUrl = resolveLocalWorkerEndpoints()[0]?.statusUrl ?? 'http://127.0.0.1:48100/api/status'
  const effectiveStatus = status ?? {
    status: 'checking',
    message: t('workspace.environment.statusChecking', { defaultValue: '正在检查环境状态。' }),
    checkedAt: new Date().toISOString(),
  } satisfies WorkspaceEnvironmentStatusSnapshot
  const tone = resolveEnvironmentBannerTone(effectiveStatus.status)
  const checkedAtText = effectiveStatus.checkedAt
    ? new Date(effectiveStatus.checkedAt).toLocaleTimeString()
    : ''

  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', tone.container)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('gap-1.5', tone.badge)}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {resolveEnvironmentStatusLabel(effectiveStatus.status, t)}
            </Badge>
            {typeof effectiveStatus.httpStatus === 'number' ? (
              <span className="text-[11px] uppercase tracking-[0.14em] text-current/70">
                HTTP {effectiveStatus.httpStatus}
              </span>
            ) : null}
            {checkedAtText ? (
              <span className="text-[11px] text-current/70">
                {t('workspace.environment.lastChecked', { defaultValue: '最近检查 {{value}}', value: checkedAtText })}
              </span>
            ) : null}
          </div>
          <p className="leading-6">{effectiveStatus.message}</p>
          {effectiveStatus.url ? (
            <p className="truncate text-xs text-current/70">
              {effectiveStatus.url}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          {onRefreshLocalProbes ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void onRefreshLocalProbes()}
              className="h-8 w-8 rounded-md border border-current/15 bg-black/10 text-current hover:bg-black/15 hover:text-current"
              aria-label={t('workspace.environment.refreshLocalProbe', { defaultValue: '刷新本地探测' })}
              title={t('workspace.environment.refreshLocalProbe', { defaultValue: '刷新本地探测' })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onRefresh ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="h-8 w-8 rounded-md border border-current/15 bg-black/10 text-current hover:bg-black/15 hover:text-current"
              aria-label={t('workspace.environment.refresh', { defaultValue: '刷新环境状态' })}
              title={t('workspace.environment.refresh', { defaultValue: '刷新环境状态' })}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          {appUrl && onOpenApp ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void onOpenApp()}
              className="h-8 w-8 rounded-md border border-current/15 bg-black/10 text-current hover:bg-black/15 hover:text-current"
              aria-label={t('workspace.environment.openApp', { defaultValue: '打开应用' })}
              title={t('workspace.environment.openApp', { defaultValue: '打开应用' })}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {localWorkerDiagnostics || localEnvironmentProbe ? (
        <div className="mt-3 grid gap-2 border-t border-current/10 pt-3 text-xs sm:grid-cols-2">
          <div className="rounded-md border border-current/10 bg-black/10 px-3 py-2">
            <p className="font-medium text-current">{t('workspace.environment.localWorker', { defaultValue: '本机 Worker' })}</p>
            <p className="mt-1 text-current/80">
              {localWorkerDiagnostics
                ? localWorkerDiagnostics.status === 'ok'
                  ? t('workspace.environment.localWorkerOk', {
                    defaultValue: '可达 · executor {{executorId}} · {{daemonMode}}',
                    executorId: localWorkerDiagnostics.executorId || '-',
                    daemonMode: localWorkerDiagnostics.daemonMode || 'running',
                  })
                    + (
                      localWorkerDiagnostics.summary
                        ? t('workspace.environment.localWorkerDoctorSummary', {
                          defaultValue: ' · 检查 {{passed}}/{{total}} 通过',
                          passed: localWorkerDiagnostics.summary.passed,
                          total: localWorkerDiagnostics.summary.total,
                        })
                        : ''
                    )
                  : localWorkerDiagnostics.error || t('workspace.environment.localWorkerFailed', { defaultValue: '本机 Worker 不可达。' })
                : t('workspace.environment.localWorkerIdle', { defaultValue: '尚未进行本地 Worker 探测。' })}
            </p>
            {localWorkerDiagnostics?.status === 'ok' && localWorkerDiagnostics.summary && localWorkerDiagnostics.summary.failed > 0 ? (
              <p className="mt-1 text-current/60">
                {t('workspace.environment.localWorkerDoctorFailure', {
                  defaultValue: '存在 {{count}} 项未通过{{label}}',
                  count: localWorkerDiagnostics.summary.failed,
                  label: localWorkerDiagnostics.firstFailureLabel ? ` · ${localWorkerDiagnostics.firstFailureLabel}` : '',
                })}
              </p>
            ) : null}
            <p className="mt-1 truncate text-current/60">{localWorkerDiagnostics?.url || defaultLocalWorkerStatusUrl}</p>
          </div>
          <div className="rounded-md border border-current/10 bg-black/10 px-3 py-2">
            <p className="font-medium text-current">{t('workspace.environment.localEnvironment', { defaultValue: '本地环境探测' })}</p>
            <p className="mt-1 text-current/80">
              {localEnvironmentProbe
                ? localEnvironmentProbe.status === 'ok'
                  ? t('workspace.environment.localEnvironmentOk', {
                    defaultValue: '可达 · HTTP {{status}}',
                    status: localEnvironmentProbe.httpStatus ?? 200,
                  })
                  : localEnvironmentProbe.error || t('workspace.environment.localEnvironmentFailed', { defaultValue: '本地环境不可达。' })
                : t('workspace.environment.localEnvironmentIdle', {
                  defaultValue: healthUrl
                    ? '当前健康检查地址不是本机 loopback，未启用本地探测。'
                    : '当前没有可用的本地健康检查地址。',
                })}
            </p>
            <p className="mt-1 truncate text-current/60">{localEnvironmentProbe?.url || healthUrl || '-'}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

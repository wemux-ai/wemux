import React from 'react'
import { StatusBadge } from './status-badge'
import type { ConsoleDetail, ConsoleMetric, StatusTone, WorkerMcpServer } from '../worker-console-types'

type McpStatusPanelProps = {
  title: string
  description: string
  metrics: ConsoleMetric[]
  details: ConsoleDetail[]
  issuesTitle: string
  noIssuesLabel: string
  issues: Array<{ label: string; value: string; tone?: StatusTone }>
  serversTitle: string
  emptyLabel: string
  kindLabels: Record<WorkerMcpServer['kind'], string>
  statusEnabledLabel: string
  statusDisabledLabel: string
  effectiveLabel: string
  configuredLabel: string
  targetLabel: string
  endpointLabel: string
  commandLabel: string
  actingUserLabel: string
  headersLabel: string
  transportLabel: string
  scopeEnabledLabel: string
  scopeDisabledLabel: string
  servers: WorkerMcpServer[]
}

const toneByServer = (server: WorkerMcpServer): StatusTone => {
  if (!server.enabled) return 'neutral'
  if (server.materialized) return 'success'
  return 'warning'
}

export const McpStatusPanel = ({
  title,
  description,
  metrics,
  details,
  issuesTitle,
  noIssuesLabel,
  issues,
  serversTitle,
  emptyLabel,
  kindLabels,
  statusEnabledLabel,
  statusDisabledLabel,
  effectiveLabel,
  configuredLabel,
  targetLabel,
  endpointLabel,
  commandLabel,
  actingUserLabel,
  headersLabel,
  transportLabel,
  scopeEnabledLabel,
  scopeDisabledLabel,
  servers,
}: McpStatusPanelProps) => {
  return (
    <section className="console-card p-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
        {description ? <p className="text-sm leading-6 text-zinc-300">{description}</p> : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatusBadge key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_320px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {details.map((detail) => (
            <div key={detail.label} className="console-kv">
              <div className="console-kv-label">{detail.label}</div>
              <div className="console-kv-value break-all">{detail.value}</div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-semibold text-white">{issuesTitle}</div>
          {issues.length === 0 ? (
            <div className="console-empty">{noIssuesLabel}</div>
          ) : (
            <div className="grid gap-3">
              {issues.map((issue) => (
                <div key={issue.label} className="console-card-muted p-4">
                  <StatusBadge label={issue.label} tone={issue.tone} value={issue.value} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="text-sm font-semibold text-white">{serversTitle}</div>
        {servers.length === 0 ? (
          <div className="console-empty">{emptyLabel}</div>
        ) : (
          <div className="grid gap-3">
            {servers.map((server) => (
              <div key={server.id} className="console-card-muted p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{server.name}</div>
                    <div className="mt-1 text-xs text-zinc-400">{kindLabels[server.kind]}</div>
                  </div>
                  <StatusBadge
                    label={server.enabled ? statusEnabledLabel : statusDisabledLabel}
                    tone={toneByServer(server)}
                    value={server.materialized ? effectiveLabel : configuredLabel}
                  />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="console-kv">
                    <div className="console-kv-label">{targetLabel}</div>
                    <div className="console-kv-value break-all">{server.target}</div>
                  </div>
                  <div className="console-kv">
                    <div className="console-kv-label">{endpointLabel}</div>
                    <div className="console-kv-value break-all">{server.endpoint || '—'}</div>
                  </div>
                  <div className="console-kv">
                    <div className="console-kv-label">{commandLabel}</div>
                    <div className="console-kv-value break-all">{server.command || '—'}</div>
                  </div>
                  <div className="console-kv">
                    <div className="console-kv-label">{actingUserLabel}</div>
                    <div className="console-kv-value">{server.actingUserScoped ? scopeEnabledLabel : scopeDisabledLabel}</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="console-kv">
                    <div className="console-kv-label">{transportLabel}</div>
                    <div className="console-kv-value">{server.transport} / {server.capabilityMode}</div>
                  </div>
                  <div className="console-kv">
                    <div className="console-kv-label">{headersLabel}</div>
                    <div className="console-kv-value">{server.headerKeys.length > 0 ? server.headerKeys.join(', ') : '—'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

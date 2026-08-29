import React from 'react'
import { StatusBadge } from './status-badge'
import type { ConsoleAction, ConsoleDetail, ConsoleMetric, StatusTone } from '../worker-console-types'

type RuntimeOverviewPanelProps = {
  title: string
  description: string
  actionsTitle: string
  actionsBody: string
  issuesTitle: string
  issuesBody: string
  noIssuesLabel: string
  metrics: ConsoleMetric[]
  details: ConsoleDetail[]
  issues: Array<{ label: string; value: string; tone?: StatusTone }>
  actions: ConsoleAction[]
}

const buttonClassName = (tone: ConsoleAction['tone']) => {
  if (tone === 'danger') return 'console-button-danger'
  if (tone === 'secondary') return 'console-button-secondary'
  return 'console-button'
}

export const RuntimeOverviewPanel = ({
  title,
  description,
  actionsTitle,
  actionsBody,
  issuesTitle,
  issuesBody,
  noIssuesLabel,
  metrics,
  details,
  issues,
  actions,
}: RuntimeOverviewPanelProps) => {
  return (
    <section className="console-card p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h2 className="console-section-title">{title}</h2>
          {description ? <p className="console-section-body">{description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              className={buttonClassName(action.tone)}
              disabled={action.disabled}
              onClick={action.onClick}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatusBadge key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-white">{actionsTitle}</div>
            {actionsBody ? <p className="console-section-body">{actionsBody}</p> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {details.map((detail) => (
              <div key={detail.label} className="console-kv">
                <div className="console-kv-label">{detail.label}</div>
                <div className="console-kv-value break-all">{detail.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-white">{issuesTitle}</div>
            {issuesBody ? <p className="console-section-body">{issuesBody}</p> : null}
          </div>

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
    </section>
  )
}

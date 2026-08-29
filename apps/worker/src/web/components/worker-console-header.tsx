import React from 'react'
import { StatusBadge } from './status-badge'
import type { ConsoleAction, Locale, StatusTone } from '../worker-console-types'

type WorkerConsoleHeaderProps = {
  eyebrow: string
  title: string
  description: string
  languageLabel: string
  locale: Locale
  machineNameLabel: string
  machineName: string
  cloudUrlLabel: string
  cloudUrl: string
  lastHeartbeatLabel: string
  lastHeartbeat: string
  nextStepLabel: string
  onLocaleChange: (locale: Locale) => void
  primaryAction?: ConsoleAction
  secondaryActions: ConsoleAction[]
  statuses: Array<{ label: string; value: string; tone?: StatusTone }>
}

const buttonClassName = (tone: ConsoleAction['tone']) => {
  if (tone === 'danger') return 'console-button-danger'
  if (tone === 'secondary') return 'console-button-secondary'
  return 'console-button'
}

export const WorkerConsoleHeader = ({
  eyebrow,
  title,
  description,
  languageLabel,
  locale,
  machineNameLabel,
  machineName,
  cloudUrlLabel,
  cloudUrl,
  lastHeartbeatLabel,
  lastHeartbeat,
  nextStepLabel,
  onLocaleChange,
  primaryAction,
  secondaryActions,
  statuses,
}: WorkerConsoleHeaderProps) => {
  return (
    <section className="console-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="console-pill">{eyebrow}</span>
            <h1 className="text-[20px] font-semibold tracking-tight text-zinc-50 sm:text-[24px]">{title}</h1>
          </div>
          {description ? <p className="max-w-3xl text-sm leading-6 text-zinc-400">{description}</p> : null}
          <div className="console-meta-list">
            <div className="console-meta-item">
              <span className="console-meta-label">{machineNameLabel}</span>
              <span className="text-zinc-200">{machineName}</span>
            </div>
            <div className="console-meta-item">
              <span className="console-meta-label">{cloudUrlLabel}</span>
              <span className="break-all text-zinc-200">{cloudUrl}</span>
            </div>
            <div className="console-meta-item">
              <span className="console-meta-label">{lastHeartbeatLabel}</span>
              <span className="text-zinc-200">{lastHeartbeat}</span>
            </div>
          </div>
        </div>

        <div className="flex w-full max-w-md flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-end">
            <div>
              <div className="text-[11px] uppercase tracking-[0.1em] text-zinc-400">{languageLabel}</div>
              <div className="mt-2 inline-flex rounded-[12px] border border-white/10 bg-black/20 p-1">
                <span className="console-button">English</span>
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-[0.1em] text-zinc-400">{nextStepLabel}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {primaryAction ? (
                  <button className={buttonClassName(primaryAction.tone)} disabled={primaryAction.disabled} onClick={primaryAction.onClick} type="button">
                    {primaryAction.label}
                  </button>
                ) : null}
                {secondaryActions.map((action) => (
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
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statuses.map((status) => (
          <StatusBadge key={status.label} label={status.label} tone={status.tone} value={status.value} />
        ))}
      </div>
    </section>
  )
}

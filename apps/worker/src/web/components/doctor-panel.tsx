import React from 'react'
import { StatusBadge } from './status-badge'
import type { ConsoleAction, ConsoleDetail, WorkerDoctorItem } from '../worker-console-types'

type DoctorPanelProps = {
  title: string
  description: string
  summaryTitle: string
  summaryText: string
  summaryBadgeLabel: string
  summaryBadgeTone: 'success' | 'warning'
  failedItemsTitle: string
  passedItemsTitle: string
  noFailedItemsLabel: string
  developerDataTitle: string
  rawLabel: string
  probeItems: ConsoleDetail[]
  failedItems: WorkerDoctorItem[]
  passedItems: WorkerDoctorItem[]
  rawJson: unknown
  action: ConsoleAction
}

const renderItem = (item: WorkerDoctorItem) => {
  return (
    <div key={item.id} className={`rounded-[12px] border p-3.5 ${item.ok ? 'border-emerald-500/30 bg-emerald-950/25' : 'border-rose-500/30 bg-rose-950/25'}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-semibold text-zinc-100">{item.label || item.id}</div>
        <span className="console-pill">{item.ok ? 'OK' : 'FAIL'}</span>
      </div>
      <div className="mt-2.5 text-sm leading-6 text-zinc-200">{item.detail}</div>
      {item.hint ? <div className="mt-1.5 text-xs leading-5 text-zinc-400">{item.hint}</div> : null}
    </div>
  )
}

export const DoctorPanel = ({
  title,
  description,
  summaryTitle,
  summaryText,
  summaryBadgeLabel,
  summaryBadgeTone,
  failedItemsTitle,
  passedItemsTitle,
  noFailedItemsLabel,
  developerDataTitle,
  rawLabel,
  probeItems,
  failedItems,
  passedItems,
  rawJson,
  action,
}: DoctorPanelProps) => {
  return (
    <section className="console-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          {description ? <p className="text-sm leading-6 text-zinc-300">{description}</p> : null}
        </div>
        <button className="console-button-secondary" onClick={action.onClick} type="button">
          {action.label}
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-5">
          <div className="console-card-muted p-4">
            <div className="text-sm font-semibold text-white">{summaryTitle}</div>
            <div className="mt-4">
              <StatusBadge label={summaryTitle} tone={summaryBadgeTone} value={summaryBadgeLabel} />
            </div>
            <div className="mt-4 text-sm text-zinc-300">{summaryText}</div>
          </div>

          <div className="grid gap-3">
            <div className="text-sm font-semibold text-white">{failedItemsTitle}</div>
            {failedItems.length === 0 ? <div className="console-empty">{noFailedItemsLabel}</div> : failedItems.map(renderItem)}
          </div>

          <div className="grid gap-3">
            <div className="text-sm font-semibold text-white">{passedItemsTitle}</div>
            {passedItems.map(renderItem)}
          </div>
        </div>

        <div className="grid gap-5">
          <div className="console-card-muted p-4">
            <div className="text-sm font-semibold text-white">{developerDataTitle}</div>
            <div className="mt-4 grid gap-3">
              {probeItems.map((probe) => (
                <div key={probe.label} className="console-kv">
                  <div className="console-kv-label">{probe.label}</div>
                  <div className="console-kv-value">{probe.value}</div>
                </div>
              ))}
            </div>
          </div>

          <details className="console-card-muted p-4 text-sm text-zinc-300">
            <summary className="cursor-pointer text-white">{rawLabel}</summary>
            <pre className="mt-4 overflow-auto text-xs text-zinc-300">{JSON.stringify(rawJson, null, 2)}</pre>
          </details>
        </div>
      </div>
    </section>
  )
}

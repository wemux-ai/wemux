import React from 'react'
import type { ConsoleAction, ConsoleDetail, StatusTone } from '../worker-console-types'

type ConnectionSettingsPanelProps = {
  title: string
  description: string
  statusLabel: string
  statusTitle: string
  statusBody: string
  statusTone: StatusTone
  pairingTitle: string
  pairingBody: string
  quickConnectBody: string
  rePairingHint: string
  configTitle: string
  configBody: string
  capabilitiesTitle: string
  capabilitiesBody: string
  machineTitle: string
  machineBody: string
  connectionActionsTitle: string
  connectionActionsBody: string
  advancedTitle: string
  advancedBody: string
  expandAdvancedLabel: string
  collapseAdvancedLabel: string
  advancedExpanded: boolean
  dangerTitle: string
  dangerBody: string
  pairingCodeLabel: string
  pairingCodePlaceholder: string
  pairingCode: string
  workerNameLabel: string
  workerNamePlaceholder: string
  workerName: string
  cloudUrlLabel: string
  cloudUrl: string
  workspaceRootLabel: string
  workspaceRoot: string
  maxConcurrencyLabel: string
  maxConcurrency: number
  labelsLabel: string
  labelsPlaceholder: string
  labelsValue: string
  capabilitiesLabel: string
  capabilitiesPlaceholder: string
  capabilitiesValue: string
  machineDetails: ConsoleDetail[]
  primaryActions: ConsoleAction[]
  connectionActions: ConsoleAction[]
  dangerActions: ConsoleAction[]
  onToggleAdvanced: () => void
  onPairingCodeChange: (value: string) => void
  onWorkerNameChange: (value: string) => void
  onCloudUrlChange: (value: string) => void
  onWorkspaceRootChange: (value: string) => void
  onMaxConcurrencyChange: (value: number) => void
  onLabelsChange: (value: string) => void
  onCapabilitiesChange: (value: string) => void
}

const buttonClassName = (tone: ConsoleAction['tone']) => {
  if (tone === 'danger') return 'console-button-danger'
  if (tone === 'secondary') return 'console-button-secondary'
  return 'console-button'
}

const statusClassName = (tone: StatusTone) => {
  if (tone === 'danger') return 'border-rose-500/30 bg-rose-950/40 text-rose-100'
  if (tone === 'warning') return 'border-amber-500/30 bg-amber-950/40 text-amber-100'
  if (tone === 'success') return 'border-emerald-500/30 bg-emerald-950/40 text-emerald-100'
  return 'border-zinc-800 bg-zinc-950 text-zinc-100'
}

export const ConnectionSettingsPanel = ({
  title,
  description,
  statusLabel,
  statusTitle,
  statusBody,
  statusTone,
  pairingTitle,
  pairingBody,
  quickConnectBody,
  rePairingHint,
  configTitle,
  configBody,
  capabilitiesTitle,
  capabilitiesBody,
  machineTitle,
  machineBody,
  connectionActionsTitle,
  connectionActionsBody,
  advancedTitle,
  advancedBody,
  expandAdvancedLabel,
  collapseAdvancedLabel,
  advancedExpanded,
  dangerTitle,
  dangerBody,
  pairingCodeLabel,
  pairingCodePlaceholder,
  pairingCode,
  workerNameLabel,
  workerNamePlaceholder,
  workerName,
  cloudUrlLabel,
  cloudUrl,
  workspaceRootLabel,
  workspaceRoot,
  maxConcurrencyLabel,
  maxConcurrency,
  labelsLabel,
  labelsPlaceholder,
  labelsValue,
  capabilitiesLabel,
  capabilitiesPlaceholder,
  capabilitiesValue,
  machineDetails,
  primaryActions,
  connectionActions,
  dangerActions,
  onToggleAdvanced,
  onPairingCodeChange,
  onWorkerNameChange,
  onCloudUrlChange,
  onWorkspaceRootChange,
  onMaxConcurrencyChange,
  onLabelsChange,
  onCapabilitiesChange,
}: ConnectionSettingsPanelProps) => {
  return (
    <section className="console-card p-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
        {description ? <p className="text-sm leading-6 text-zinc-300">{description}</p> : null}
      </div>

      <div className={`mt-5 rounded-[18px] border p-5 ${statusClassName(statusTone)}`}>
        <div className="text-[11px] uppercase tracking-[0.12em] opacity-70">{statusLabel}</div>
        <div className="mt-2 text-2xl font-semibold text-white">{statusTitle}</div>
        {statusBody ? <p className="mt-2 max-w-3xl text-sm leading-6 opacity-90">{statusBody}</p> : null}
      </div>

      <div className="mt-5 grid gap-5">
        <div className="console-card-muted p-4">
          <div className="space-y-2">
            <div className="text-lg font-semibold text-white">{pairingTitle}</div>
            {pairingBody ? <p className="text-sm leading-6 text-zinc-300">{pairingBody}</p> : null}
            {quickConnectBody ? <p className="text-sm leading-6 text-zinc-400">{quickConnectBody}</p> : null}
            {rePairingHint ? <p className="text-sm leading-6 text-amber-200/90">{rePairingHint}</p> : null}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <label className="grid gap-2 text-sm text-zinc-300">
              <span>{pairingCodeLabel}</span>
              <input className="console-input" onChange={(event) => onPairingCodeChange(event.target.value)} placeholder={pairingCodePlaceholder} value={pairingCode} />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              <span>{workerNameLabel}</span>
              <input className="console-input" onChange={(event) => onWorkerNameChange(event.target.value)} placeholder={workerNamePlaceholder} value={workerName} />
            </label>
            <label className="grid gap-2 text-sm text-zinc-300">
              <span>{cloudUrlLabel}</span>
              <input className="console-input" onChange={(event) => onCloudUrlChange(event.target.value)} value={cloudUrl} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {primaryActions.map((action) => (
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

        <div className="console-card-muted p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="text-lg font-semibold text-white">{advancedTitle}</div>
              {advancedBody ? <p className="text-sm leading-6 text-zinc-300">{advancedBody}</p> : null}
            </div>
            <button className="console-button-secondary" onClick={onToggleAdvanced} type="button">
              {advancedExpanded ? collapseAdvancedLabel : expandAdvancedLabel}
            </button>
          </div>
        </div>

        {advancedExpanded ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="grid gap-5">
              <div className="console-card-muted p-4">
                <div className="space-y-2">
                  <div className="text-lg font-semibold text-white">{configTitle}</div>
                  {configBody ? <p className="text-sm leading-6 text-zinc-300">{configBody}</p> : null}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2 text-sm text-zinc-300">
                    <span>{workspaceRootLabel}</span>
                    <input className="console-input" onChange={(event) => onWorkspaceRootChange(event.target.value)} value={workspaceRoot} />
                  </label>
                  <label className="grid gap-2 text-sm text-zinc-300 md:max-w-52">
                    <span>{maxConcurrencyLabel}</span>
                    <input className="console-input" min={1} onChange={(event) => onMaxConcurrencyChange(Number(event.target.value || '1'))} type="number" value={maxConcurrency} />
                  </label>
                </div>
              </div>

              <div className="console-card-muted p-4">
                <div className="space-y-2">
                  <div className="text-lg font-semibold text-white">{capabilitiesTitle}</div>
                  {capabilitiesBody ? <p className="text-sm leading-6 text-zinc-300">{capabilitiesBody}</p> : null}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2 text-sm text-zinc-300">
                    <span>{labelsLabel}</span>
                    <textarea className="console-textarea" onChange={(event) => onLabelsChange(event.target.value)} placeholder={labelsPlaceholder} value={labelsValue} />
                  </label>
                  <label className="grid gap-2 text-sm text-zinc-300">
                    <span>{capabilitiesLabel}</span>
                    <textarea className="console-textarea" onChange={(event) => onCapabilitiesChange(event.target.value)} placeholder={capabilitiesPlaceholder} value={capabilitiesValue} />
                  </label>
                </div>
              </div>
            </div>

            <div className="grid gap-5">
              <div className="console-card-muted p-4">
                <div className="space-y-2">
                  <div className="text-lg font-semibold text-white">{machineTitle}</div>
                  {machineBody ? <p className="text-sm leading-6 text-zinc-300">{machineBody}</p> : null}
                </div>
                <div className="mt-4 grid gap-3">
                  {machineDetails.map((detail) => (
                    <div key={detail.label} className="console-kv">
                      <div className="console-kv-label">{detail.label}</div>
                      <div className="console-kv-value break-all">{detail.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {connectionActions.length > 0 ? (
                <div className="console-card-muted p-4">
                  <div className="space-y-2">
                    <div className="text-lg font-semibold text-white">{connectionActionsTitle}</div>
                    {connectionActionsBody ? <p className="text-sm leading-6 text-zinc-300">{connectionActionsBody}</p> : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {connectionActions.map((action) => (
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
              ) : null}

              <div className="console-danger-zone">
                <div className="space-y-2">
                  <div className="text-lg font-semibold text-rose-100">{dangerTitle}</div>
                  {dangerBody ? <p className="text-sm leading-6 text-rose-100/80">{dangerBody}</p> : null}
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  {dangerActions.map((action) => (
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
        ) : null}
      </div>
    </section>
  )
}

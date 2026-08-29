import React from 'react'
import type { ConsoleAction, WorkerProjectBinding } from '../worker-console-types'

type ProjectBindingsPanelProps = {
  title: string
  description: string
  badgeLabel: string
  projectIdLabel: string
  repoUrlLabel: string
  localPathLabel: string
  removeLabel: string
  emptyLabel: string
  bindings: WorkerProjectBinding[]
  footerActions: ConsoleAction[]
  onAddBinding: () => void
  onRemoveBinding: (index: number) => void
  onUpdateBinding: (index: number, key: keyof WorkerProjectBinding, value: string) => void
}

const buttonClassName = (tone: ConsoleAction['tone']) => {
  if (tone === 'danger') return 'console-button-danger'
  if (tone === 'secondary') return 'console-button-secondary'
  return 'console-button'
}

export const ProjectBindingsPanel = ({
  title,
  description,
  badgeLabel,
  projectIdLabel,
  repoUrlLabel,
  localPathLabel,
  removeLabel,
  emptyLabel,
  bindings,
  footerActions,
  onAddBinding,
  onRemoveBinding,
  onUpdateBinding,
}: ProjectBindingsPanelProps) => {
  return (
    <section className="console-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          {description ? <p className="text-sm leading-6 text-zinc-300">{description}</p> : null}
        </div>
        <span className="console-pill">{badgeLabel}</span>
      </div>

      <div className="mt-5 grid gap-3">
        {bindings.length === 0 ? (
          <div className="console-empty">{emptyLabel}</div>
        ) : (
          bindings.map((binding, index) => (
            <div key={`${binding.localPath}-${index}`} className="console-card-muted p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="grid flex-1 gap-3 md:grid-cols-3">
                  <label className="grid gap-2 text-sm text-zinc-300">
                    <span>{projectIdLabel}</span>
                    <input className="console-input" onChange={(event) => onUpdateBinding(index, 'projectId', event.target.value)} value={binding.projectId || ''} />
                  </label>
                  <label className="grid gap-2 text-sm text-zinc-300">
                    <span>{repoUrlLabel}</span>
                    <input className="console-input" onChange={(event) => onUpdateBinding(index, 'repoUrl', event.target.value)} value={binding.repoUrl || ''} />
                  </label>
                  <label className="grid gap-2 text-sm text-zinc-300">
                    <span>{localPathLabel}</span>
                    <input className="console-input" onChange={(event) => onUpdateBinding(index, 'localPath', event.target.value)} value={binding.localPath || ''} />
                  </label>
                </div>
                <button className="console-button-secondary" onClick={() => onRemoveBinding(index)} type="button">
                  {removeLabel}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button className="console-button-secondary" onClick={onAddBinding} type="button">
          {footerActions[0]?.label}
        </button>
        {footerActions.slice(1).map((action) => (
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
    </section>
  )
}

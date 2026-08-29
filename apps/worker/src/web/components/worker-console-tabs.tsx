import React from 'react'
import type { ConsoleTabId } from '../worker-console-types'

type WorkerConsoleTabsProps = {
  activeTab: ConsoleTabId
  items: Array<{ id: ConsoleTabId; label: string }>
  onChange: (tab: ConsoleTabId) => void
}

export const WorkerConsoleTabs = ({ activeTab, items, onChange }: WorkerConsoleTabsProps) => {
  return (
    <div className="border-b border-white/10">
      <div className="flex flex-wrap items-center gap-5">
        {items.map((item) => {
          const active = item.id === activeTab
          return (
            <button
              key={item.id}
              className={active ? 'console-tab console-tab-active' : 'console-tab'}
              onClick={() => onChange(item.id)}
              type="button"
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

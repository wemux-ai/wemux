/**
 * [INPUT]: A workspace-scoped panel key, current panel content, and its visible resource state.
 * [OUTPUT]: Retained panel instances that preserve React state and optionally live resources while hidden.
 * [POS]: Shared workspace-shell cache for chat, Git, Preview, files, records, and desktop panels.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useState, type ReactNode } from 'react'
import { WorkbenchResourceVisibilityProvider } from './workbench-resource-registry'

const MAX_RETAINED_WORKSPACE_PANEL_INSTANCES = 16

type RetainedWorkspacePanelCache = {
  panelKeys: string[]
  panels: Record<string, ReactNode>
  retainedResourceByPanelKey: Record<string, boolean>
}

export const touchRetainedWorkspacePanelKey = (panelKeys: string[], activePanelKey: string) => (
  [...panelKeys.filter((panelKey) => panelKey !== activePanelKey), activePanelKey]
    .slice(-MAX_RETAINED_WORKSPACE_PANEL_INSTANCES)
)

export function RetainedWorkspacePanel({
  active,
  children,
  panelKey,
  retainResources = false,
}: {
  active: boolean
  children: ReactNode
  panelKey: string
  retainResources?: boolean
}) {
  const [panelCache, setPanelCache] = useState<RetainedWorkspacePanelCache>(() => (
    children == null
      ? { panelKeys: [], panels: {}, retainedResourceByPanelKey: {} }
      : {
          panelKeys: [panelKey],
          panels: { [panelKey]: children },
          retainedResourceByPanelKey: { [panelKey]: retainResources },
        }
  ))

  useEffect(() => {
    if (children == null) {
      return
    }

    setPanelCache((current) => {
      const panelKeys = touchRetainedWorkspacePanelKey(current.panelKeys, panelKey)
      if (
        current.panels[panelKey] === children
        && current.retainedResourceByPanelKey[panelKey] === retainResources
        && current.panelKeys.join(':') === panelKeys.join(':')
      ) {
        return current
      }

      const panels = { ...current.panels, [panelKey]: children }
      const retainedResourceByPanelKey = {
        ...current.retainedResourceByPanelKey,
        [panelKey]: retainResources,
      }
      for (const cachedPanelKey of Object.keys(panels)) {
        if (!panelKeys.includes(cachedPanelKey)) {
          delete panels[cachedPanelKey]
          delete retainedResourceByPanelKey[cachedPanelKey]
        }
      }

      return { panelKeys, panels, retainedResourceByPanelKey }
    })
  }, [children, panelKey, retainResources])

  const visiblePanelKeys = children == null
    ? panelCache.panelKeys
    : touchRetainedWorkspacePanelKey(panelCache.panelKeys, panelKey)

  return (
    <>
      {visiblePanelKeys.map((cachedPanelKey) => {
        const isActivePanel = active && cachedPanelKey === panelKey
        const resourceActive = isActivePanel || (
          cachedPanelKey === panelKey
            ? retainResources
            : Boolean(panelCache.retainedResourceByPanelKey[cachedPanelKey])
        )
        const content = cachedPanelKey === panelKey && children != null
          ? children
          : panelCache.panels[cachedPanelKey]
        if (content == null) {
          return null
        }

        return (
          <WorkbenchResourceVisibilityProvider key={cachedPanelKey} active={resourceActive}>
            <div
              className={isActivePanel ? 'h-full min-h-0' : 'hidden'}
              aria-hidden={isActivePanel ? undefined : true}
              hidden={!isActivePanel}
            >
              {content}
            </div>
          </WorkbenchResourceVisibilityProvider>
        )
      })}
    </>
  )
}

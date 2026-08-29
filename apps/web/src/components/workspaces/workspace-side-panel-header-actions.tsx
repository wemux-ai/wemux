import { createContext, useContext, type ReactNode } from 'react'

const WorkspaceSidePanelHeaderActionsContext = createContext<ReactNode>(null)

export function WorkspaceSidePanelHeaderActionsProvider({
  children,
  headerActions,
}: {
  children: ReactNode
  headerActions: ReactNode
}) {
  return (
    <WorkspaceSidePanelHeaderActionsContext.Provider value={headerActions}>
      {children}
    </WorkspaceSidePanelHeaderActionsContext.Provider>
  )
}

export function useWorkspaceSidePanelHeaderActions() {
  return useContext(WorkspaceSidePanelHeaderActionsContext)
}

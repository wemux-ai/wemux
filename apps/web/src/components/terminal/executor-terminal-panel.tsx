import type { ComponentProps } from 'react'
import {
  WorkspaceTerminalPanel,
  type WorkspaceTerminalCommandRequest,
} from '../workspaces/workspace-terminal-panel'

export type ExecutorTerminalCommandRequest = WorkspaceTerminalCommandRequest

type ExecutorTerminalPanelProps = Omit<
  ComponentProps<typeof WorkspaceTerminalPanel>,
  'onOpenWorkspaceTarget'
>

const noopOpenWorkspaceTarget = async () => {}

export function ExecutorTerminalPanel(props: ExecutorTerminalPanelProps) {
  return <WorkspaceTerminalPanel {...props} onOpenWorkspaceTarget={noopOpenWorkspaceTarget} />
}

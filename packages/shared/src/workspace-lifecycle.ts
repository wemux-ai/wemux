// [INPUT]: Workspace record lifecycle metadata.
// [OUTPUT]: Shared workspace record lifecycle policy decisions.
// [POS]: Cross-runtime policy boundary for deleting workspace records without conflating them with project directories.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkspaceRecord } from './types'

export const canDeleteWorkspaceRecord = (
  workspace: Pick<WorkspaceRecord, 'source'>,
) => workspace.source !== 'binding'

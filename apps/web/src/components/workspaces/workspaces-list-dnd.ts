import type { DragEvent } from 'react'

export type WorkspaceListDropPosition = 'before' | 'after'

export const resolveWorkspaceListDropPositionFromOffset = (
  offsetY: number,
  containerHeight: number,
): WorkspaceListDropPosition => (
  offsetY >= containerHeight / 2 ? 'after' : 'before'
)

export const resolveWorkspaceListDropPosition = (
  event: DragEvent<HTMLElement>,
): WorkspaceListDropPosition => {
  const bounds = event.currentTarget.getBoundingClientRect()
  return resolveWorkspaceListDropPositionFromOffset(
    event.clientY - bounds.top,
    bounds.height,
  )
}

export const applyWorkspaceListRowDragImage = (
  event: DragEvent<HTMLButtonElement>,
) => {
  const workspaceListRow = event.currentTarget.closest<HTMLElement>('[data-workspace-list-row="true"]')
  if (!workspaceListRow) {
    return
  }

  const bounds = workspaceListRow.getBoundingClientRect()
  event.dataTransfer.setDragImage(
    workspaceListRow,
    Math.max(12, event.clientX - bounds.left),
    event.clientY - bounds.top,
  )
}

export const reorderWorkspaceListIds = (
  orderedWorkspaceIds: string[],
  draggedWorkspaceId: string,
  targetWorkspaceId: string,
  position: WorkspaceListDropPosition,
) => {
  if (!draggedWorkspaceId || draggedWorkspaceId === targetWorkspaceId) {
    return null
  }

  const nextOrderedWorkspaceIds = orderedWorkspaceIds.filter((workspaceId) => workspaceId !== draggedWorkspaceId)
  const targetIndex = nextOrderedWorkspaceIds.indexOf(targetWorkspaceId)
  if (targetIndex < 0) {
    return null
  }

  nextOrderedWorkspaceIds.splice(
    position === 'after' ? targetIndex + 1 : targetIndex,
    0,
    draggedWorkspaceId,
  )

  return nextOrderedWorkspaceIds.every((workspaceId, index) => workspaceId === orderedWorkspaceIds[index])
    ? null
    : nextOrderedWorkspaceIds
}

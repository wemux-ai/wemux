import type { DragEvent } from 'react'

export type SidebarProjectDropPosition = 'before' | 'after'

export const resolveSidebarProjectDropPositionFromOffset = (
  offsetY: number,
  containerHeight: number,
): SidebarProjectDropPosition => (
  offsetY >= containerHeight / 2 ? 'after' : 'before'
)

export const resolveSidebarProjectDropPosition = (
  event: DragEvent<HTMLElement>,
): SidebarProjectDropPosition => {
  const bounds = event.currentTarget.getBoundingClientRect()
  return resolveSidebarProjectDropPositionFromOffset(
    event.clientY - bounds.top,
    bounds.height,
  )
}

export function reorderProjectIds(
  orderedProjectIds: string[],
  draggedProjectId: string,
  targetProjectId: string,
  position: SidebarProjectDropPosition = 'before',
) {
  if (!draggedProjectId || !targetProjectId || draggedProjectId === targetProjectId) {
    return null
  }

  const nextOrderedProjectIds = orderedProjectIds.filter((projectId) => projectId !== draggedProjectId)
  const targetIndex = nextOrderedProjectIds.indexOf(targetProjectId)
  if (targetIndex < 0) {
    return null
  }

  nextOrderedProjectIds.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedProjectId)
  return nextOrderedProjectIds.every((projectId, index) => projectId === orderedProjectIds[index])
    ? null
    : nextOrderedProjectIds
}

export function mergeProjectSectionOrder(
  orderedProjectIds: string[],
  sectionProjectIds: string[],
) {
  if (sectionProjectIds.length <= 1) {
    return null
  }

  const sectionProjectIdSet = new Set(sectionProjectIds)
  const currentSectionProjectIds = orderedProjectIds.filter((projectId) => sectionProjectIdSet.has(projectId))
  if (currentSectionProjectIds.length !== sectionProjectIds.length) {
    return null
  }

  if (sectionProjectIds.every((projectId, index) => projectId === currentSectionProjectIds[index])) {
    return null
  }

  let nextSectionIndex = 0
  return orderedProjectIds.map((projectId) => {
    if (!sectionProjectIdSet.has(projectId)) {
      return projectId
    }

    const nextProjectId = sectionProjectIds[nextSectionIndex]
    nextSectionIndex += 1
    return nextProjectId
  })
}

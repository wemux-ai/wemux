// [INPUT]: 项目工作区排序输入
// [OUTPUT]: 排序结果
// [POS]: 项目工作区顺序
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

type DisplayOrderedEntity = {
  id: string
  createdAt: string
  updatedAt: string
  displayOrder?: number
}

const hasDisplayOrder = (value: number | undefined) => (
  typeof value === 'number' && Number.isFinite(value)
)

const compareDisplayOrder = <T extends DisplayOrderedEntity>(left: T, right: T) => {
  const leftHasDisplayOrder = hasDisplayOrder(left.displayOrder)
  const rightHasDisplayOrder = hasDisplayOrder(right.displayOrder)
  if (leftHasDisplayOrder && rightHasDisplayOrder) {
    return left.displayOrder! - right.displayOrder!
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.createdAt.localeCompare(left.createdAt)
      || left.id.localeCompare(right.id)
  }

  if (leftHasDisplayOrder) {
    return -1
  }

  if (rightHasDisplayOrder) {
    return 1
  }

  return right.updatedAt.localeCompare(left.updatedAt)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id)
}

export const sortProjectsByDisplayOrder = <T extends DisplayOrderedEntity>(projects: T[]) => {
  return [...projects].sort(compareDisplayOrder)
}

export const sortWorkspacesByDisplayOrder = <T extends DisplayOrderedEntity>(workspaces: T[]) => {
  return [...workspaces].sort(compareDisplayOrder)
}

export const resolveNextDisplayOrder = <T extends Partial<Pick<DisplayOrderedEntity, 'displayOrder'>>>(items: T[]) => {
  const orderedValues = items
    .map((item) => item.displayOrder)
    .filter((value): value is number => hasDisplayOrder(value))

  if (orderedValues.length === 0) {
    return 0
  }

  return Math.max(...orderedValues) + 1
}

export const buildDisplayOrderPatch = (orderedIds: string[]) => {
  return new Map(orderedIds.map((id, index) => [id, index] as const))
}

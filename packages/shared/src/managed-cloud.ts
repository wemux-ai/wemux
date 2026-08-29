// [INPUT]: 云节点输入
// [OUTPUT]: 云节点契约
// [POS]: managed cloud 类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const MANAGED_CLOUD_AUTO_EXECUTOR_ID = 'managed-cloud:auto'

export const isManagedCloudAutoExecutorId = (executorId?: string | null) => {
  return executorId?.trim() === MANAGED_CLOUD_AUTO_EXECUTOR_ID
}

// [INPUT]: 云节点（托管 executor）调用请求
// [OUTPUT]: 云节点准入/启动/用量结果（ManagedCloudGate 接口）
// [POS]: 云节点能力网关——核心链路只依赖本模块的稳定接口，不直接 import 云节点服务。
//        公开版：默认实现恒「未配置/不允许」（云节点是托管版能力）。
//        私有版：商业实现在启动时通过 registerManagedCloudGate 注入。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md


export interface ManagedCloudExecutorStartParams {
  [key: string]: unknown
}

export interface ManagedCloudUsageAccessParams {
  userId: string
  teamId?: string
  state?: unknown
  [key: string]: unknown
}

/** 云节点能力网关接口。签名与私有仓云节点服务保持一致；公开版默认恒不允许。 */
export interface ManagedCloudGate {
  /** 开发环境专用开关（私有版 dev-only 放行；公开版恒抛错语义由实现决定）。 */
  ensureDevOnlyAccess(): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isExecutorAllowed<T>(executor: T): boolean
  readonly devOnlyMessage: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isManagedExecutor(executor: any): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startExecutor(params: ManagedCloudExecutorStartParams): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ensureExecutor(params: ManagedCloudExecutorStartParams): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reconcileExecutors(config: unknown): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildUsageRecord(params: Record<string, unknown>): any
  recordUsage(record: unknown): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ensureUsageAccess(params: ManagedCloudUsageAccessParams): Promise<any>
  isUsageLimitError(error: unknown): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listExecutionModelOptions(): Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildLifecycleSnapshotByExecutorId(): any
  /** 开发环境开关（私有版读 env；公开版恒 false——云节点不存在）。 */
  isDevOnlyEnabled(env?: unknown): boolean
  /** 停止托管 executor（公开版无托管 executor，恒 no-op 返回 null）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stopExecutor(params: Record<string, unknown>): Promise<any>
  /** 托管 runtime 状态巡检（公开版恒 null）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inspectRuntime(config?: unknown): Promise<any>
  /** 托管 runtime target 巡检（公开版恒空数组）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inspectRuntimeTargets(executors?: unknown, config?: unknown): Promise<any>
  /** 托管 runtime 错误识别（公开版恒 false）。 */
  isRuntimeError(error: unknown): boolean
  /** 镜像预热（公开版恒空数组）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prewarmRuntimeTargets(config?: unknown, targetIds?: unknown): Promise<any>
  /** 用量响应组装（公开版恒 null）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildUsageResponse(params: Record<string, unknown>): any
  /** 等待 executor 上线（公开版恒 null）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitForExecutorOnline(executorId?: unknown, timeoutMs?: unknown): Promise<any>
}

/**
 * 公开版默认实现：与既有 stub 语义一致——
 * 仅拦截托管 executor（云节点在开源版不存在）；本地 executor 必须放行，
 * 否则 executor 可见性/项目 sync/任务派发全部受损。
 */
export const openSourceManagedCloudGate: ManagedCloudGate = {
  ensureDevOnlyAccess() {
    // 开源版：无云节点，恒放行（与既有 stub 一致）
  },
  isExecutorAllowed<T>(executor: T): boolean {
    const item = executor as { executorSource?: string | null; managedBy?: string | null } | null | undefined
    if (!item) {
      return false
    }
    const isManaged = item.executorSource === 'managed-cloud' || item.managedBy === 'vibemux'
    return !isManaged
  },
  devOnlyMessage: 'managed cloud is not available in the open-source edition',
  isManagedExecutor(executor) {
    const item = executor as { executorSource?: string | null; managedBy?: string | null } | null | undefined
    if (!item) {
      return false
    }
    return item.executorSource === 'managed-cloud' || item.managedBy === 'vibemux'
  },
  async startExecutor() {
    throw new Error('managed cloud is not available in the open-source edition')
  },
  async ensureExecutor() {
    throw new Error('managed cloud is not available in the open-source edition')
  },
  async reconcileExecutors() {
    return null
  },
  buildUsageRecord: () => null,
  recordUsage: () => {},
  async ensureUsageAccess() {
    return { allowed: true, enforcementEnabled: false, requiresPaid: false, message: 'managed cloud is not available in the open-source edition' }
  },
  isUsageLimitError: () => false,
  async listExecutionModelOptions() {
    return [] as unknown as Array<{ id: string }>
  },
  buildLifecycleSnapshotByExecutorId(): Map<string, unknown> {
    return new Map()
  },
  isDevOnlyEnabled: () => false,
  async stopExecutor() {
    return null
  },
  async inspectRuntime() {
    return null
  },
  async inspectRuntimeTargets() {
    return []
  },
  isRuntimeError: () => false,
  async prewarmRuntimeTargets() {
    return []
  },
  buildUsageResponse: () => null,
  async waitForExecutorOnline() {
    return null
  },
}

let currentGate: ManagedCloudGate = openSourceManagedCloudGate

/** 私有仓启动时注入商业实现；公开版不调用。 */
export const registerManagedCloudGate = (impl: ManagedCloudGate): void => {
  currentGate = impl
}

/** 核心链路统一从这里获取云节点网关。 */
export const getManagedCloudGate = (): ManagedCloudGate => currentGate

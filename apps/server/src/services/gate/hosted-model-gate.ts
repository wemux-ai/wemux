// [INPUT]: 官方托管模型的目录查询与执行解析请求
// [OUTPUT]: 托管模型列表/判定/运行时解析结果（HostedModelGate 接口）
// [POS]: 托管模型能力网关——核心链路只依赖本模块的稳定接口，不直接 import 商业服务。
//        公开版：默认实现恒空列表/恒 false/恒 null（BYOK 链路零影响，禁止抛错）。
//        私有版：商业实现在启动时通过 registerHostedModelGate 注入。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AgentType, ExecutionModelOption } from '@shared/types'

/** hosted 执行解析结果的最小形状（私有版由 hosted-model-service 提供真实实现）。 */
export type HostedModelResolution = {
  executionModel?: string
  runtimeSettings: undefined
  runtimeEnv: Record<string, string>
  profile: undefined
  binding: undefined
  /** 标记为官方托管，供调用方区分 hosted 与 BYOK 解析结果。 */
  hosted: true
}

export interface ResolveHostedModelRuntimeParams {
  agentType: AgentType
  executionModel?: string
  fallbackExecutionModel?: string
}

/**
 * 托管模型能力网关接口。签名与私有仓 hosted-model-service 保持一致；
 * 公开版默认实现为恒空/恒不可用（回退 BYOK / 用户自带模型配置）。
 */
export interface HostedModelGate {
  /** 官方托管模型目录选项列表（模型中心「官方模型」区）。 */
  listExecutionModelOptions(): Promise<ExecutionModelOption[]>
  /** 该执行模型 id 是否属于官方托管目录。 */
  isHostedExecutionModel(executionModel?: string | null): Promise<boolean>
  /** hosted 执行解析：命中官方目录返回运行时 env，否则返回 null（调用方回退用户模型库）。 */
  resolveModelRuntime(params: ResolveHostedModelRuntimeParams): Promise<HostedModelResolution | null>
}

/** 公开版默认实现：与既有 stub 语义一致——空列表 / false / null，BYOK 链路无实伤。 */
export const openSourceHostedModelGate: HostedModelGate = {
  async listExecutionModelOptions() {
    return []
  },
  async isHostedExecutionModel(_executionModel) {
    return false
  },
  async resolveModelRuntime(_params) {
    return null
  },
}

let currentGate: HostedModelGate = openSourceHostedModelGate

/** 私有仓启动时注入商业实现；公开版不调用（保持默认恒不可用）。 */
export const registerHostedModelGate = (impl: HostedModelGate): void => {
  currentGate = impl
}

/** 核心链路统一从这里获取托管模型网关。 */
export const getHostedModelGate = (): HostedModelGate => currentGate

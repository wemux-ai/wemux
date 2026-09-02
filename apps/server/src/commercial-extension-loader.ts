// [INPUT]: 当前部署目录中可选的商业扩展编译产物或 TypeScript 源入口
import { getEnv } from '@shared/env'
// [OUTPUT]: 已加载商业扩展时注册其路由/gate，公开版缺失扩展时保持空注册表
// [POS]: 核心启动与可选扩展的唯一运行时装配点。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  enterpriseBackgroundServices,
  enterpriseDevSeedInitializers,
  enterpriseLandingEntries,
  enterpriseMcpToolRegistrations,
  enterpriseRouteRegistrations,
  enterpriseStoreInitializers,
  type CommercialExtensionActivationContext,
} from './extension-registry'
import { registerAppBrand } from './services/brand'
import { registerAdminAnalyticsProvider } from './services/gate/admin-analytics-gate'
import {
  registerCommercialGate,
  registerCreditInsufficientError,
} from './services/gate/commercial-gate'
import { registerHostedModelGate } from './services/gate/hosted-model-gate'
import { registerManagedCloudGate } from './services/gate/managed-cloud-gate'

const builtExtensionEntry = path.resolve(process.cwd(), 'dist-server/apps/server/src/enterprise/index.js')
const sourceExtensionEntry = path.resolve(process.cwd(), 'apps/server/src/enterprise/index.ts')
const commercialExtensionCandidates = process.env.NODE_ENV === 'production'
  ? [builtExtensionEntry, sourceExtensionEntry]
  : [sourceExtensionEntry, builtExtensionEntry]

export const findCommercialServerExtensionEntry = (
  candidates = commercialExtensionCandidates,
  fileExists: (entry: string) => boolean = existsSync,
) => candidates.find(fileExists) ?? null

/** 加载可选商业扩展；公开核心没有私有目录时返回 false。 */
export const loadCommercialServerExtension = async (): Promise<boolean> => {
  // 显式禁用开关：不依赖文件系统状态即可强制以社区版启动（`pnpm dev:oss`）。
  if (getEnv('WEMUX_EXTENSION_DISABLED') === '1') {
    return false
  }
  const entry = findCommercialServerExtensionEntry()
  if (!entry) {
    return false
  }

  const mod = (await import(pathToFileURL(entry).href)) as {
    activateCommercialExtension?: (ctx: CommercialExtensionActivationContext) => void | Promise<void>
  }

  // 新契约：核心把真实注册表以参数交给扩展，避免双包各自持有模块状态。
  // 旧产物无 activate 导出时回退为副作用加载（行为与历史版本一致）。
  if (typeof mod.activateCommercialExtension === 'function') {
    const ctx: CommercialExtensionActivationContext = {
      registries: {
        enterpriseRouteRegistrations,
        enterpriseBackgroundServices,
        enterpriseStoreInitializers,
        enterpriseDevSeedInitializers,
        enterpriseMcpToolRegistrations,
        enterpriseLandingEntries,
      },
      registerAppBrand,
      gates: {
        registerCommercialGate,
        registerCreditInsufficientError,
        registerManagedCloudGate,
        registerHostedModelGate,
        registerAdminAnalyticsProvider,
      },
    }
    await mod.activateCommercialExtension(ctx)
  }
  return true
}

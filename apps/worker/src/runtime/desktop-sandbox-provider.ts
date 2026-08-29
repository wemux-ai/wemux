// [INPUT]: desktop-sandbox provider 配置
// [OUTPUT]: 沙箱提供能力
// [POS]: 桌面沙箱 provider
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  WorkspaceDesktopSandboxProvider,
  WorkspaceDesktopSandboxRequest,
  WorkspaceDesktopSandboxResult,
} from '@shared/types'
import { aioDesktopProvider } from './desktop-sandbox-aio-provider'
import { openSandboxDesktopProvider } from './desktop-sandbox-client'

export interface WorkspaceDesktopSandboxProviderDriver {
  provider: WorkspaceDesktopSandboxProvider
  execute: (request: WorkspaceDesktopSandboxRequest) => Promise<WorkspaceDesktopSandboxResult>
  prepare?: () => Promise<WorkspaceDesktopSandboxResult>
}

export const normalizeDesktopSandboxProvider = (value?: string): WorkspaceDesktopSandboxProvider => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'aio' || normalized === 'aio-sandbox' || normalized === 'agent-infra') {
    return 'aio'
  }
  return 'opensandbox'
}

export const resolveDesktopSandboxProvider = (): WorkspaceDesktopSandboxProvider => (
  normalizeDesktopSandboxProvider(
    process.env.VIBEMUX_DESKTOP_SANDBOX_PROVIDER
      || process.env.VIBEMUX_SANDBOX_DESKTOP_PROVIDER
      || process.env.DESKTOP_SANDBOX_PROVIDER,
  )
)

export const getDesktopSandboxProviderDriver = (): WorkspaceDesktopSandboxProviderDriver => {
  const provider = resolveDesktopSandboxProvider()
  if (provider === 'aio') {
    return aioDesktopProvider
  }
  return openSandboxDesktopProvider
}

export const desktopSandboxProvider = {
  async prepare() {
    return getDesktopSandboxProviderDriver().prepare?.() ?? null
  },

  async execute(request: WorkspaceDesktopSandboxRequest) {
    return getDesktopSandboxProviderDriver().execute(request)
  },
}

// [INPUT]: 平台输入
// [OUTPUT]: 服务工厂
// [POS]: 服务工厂
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { PlatformService } from './platform-service'

export const createPlatformService = async (serviceName?: string): Promise<PlatformService> => {
  switch (process.platform) {
    case 'darwin': {
      const { MacOSService } = await import('./macos-service')
      return new MacOSService(serviceName)
    }
    case 'linux': {
      const { LinuxService } = await import('./linux-service')
      return new LinuxService(serviceName)
    }
    case 'win32': {
      const { WindowsService } = await import('./windows-service')
      return new WindowsService(serviceName)
    }
    default:
      throw new Error(`Unsupported service platform: ${process.platform}`)
  }
}

// [INPUT]: 平台服务选项
// [OUTPUT]: 服务接口
// [POS]: 平台服务抽象
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type ServiceInstallOptions = {
  serviceName: string
  workerPath: string
  args: string[]
  env: Record<string, string>
  logDir: string
  restartOnFailure: boolean
  restartDelayMs: number
  autoStart?: boolean
}

export type ServiceStatus = {
  installed: boolean
  running: boolean
  serviceName: string
  pid?: number
  autostart?: boolean
  mode?: string
  runsAs?: string
  adminRequired?: boolean
  detail?: string
}

export type ServiceLogOptions = {
  follow?: boolean
  lines?: number
  errorsOnly?: boolean
}

export interface PlatformService {
  install(options: ServiceInstallOptions): Promise<void>
  uninstall(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  status(): Promise<ServiceStatus>
  logs(options: ServiceLogOptions): AsyncIterable<string>
}

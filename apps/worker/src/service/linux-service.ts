// [INPUT]: Linux 服务安装输入
// [OUTPUT]: 安装管理
// [POS]: Linux 服务安装
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PlatformService, ServiceInstallOptions, ServiceLogOptions, ServiceStatus } from './platform-service'
import { getDefaultWorkerServiceName, runServiceCommand, streamCommandLines } from './service-common'

const systemdQuote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export class LinuxService implements PlatformService {
  constructor(private readonly serviceName = getDefaultWorkerServiceName()) {}

  private unitName() {
    return `${this.serviceName}.service`
  }

  private servicePath() {
    return path.join(os.homedir(), '.config', 'systemd', 'user', this.unitName())
  }

  async install(options: ServiceInstallOptions) {
    await mkdir(path.dirname(this.servicePath()), { recursive: true })
    await mkdir(options.logDir, { recursive: true })
    await writeFile(this.servicePath(), this.buildService(options), 'utf8')

    // Ensure user services persist after SSH disconnect
    runServiceCommand('loginctl', ['enable-linger'], 10000)

    this.systemctl(['daemon-reload'])
    if (options.autoStart !== false) {
      this.systemctl(['enable', this.unitName()])
      this.systemctl(['restart', this.unitName()])
    } else {
      this.systemctl(['enable', this.unitName()])
    }
  }

  async uninstall() {
    runServiceCommand('systemctl', ['--user', 'disable', '--now', this.unitName()], 30000)
    await unlink(this.servicePath()).catch(() => undefined)
    runServiceCommand('systemctl', ['--user', 'daemon-reload'], 30000)
  }

  async start() {
    this.systemctl(['start', this.unitName()])
  }

  async stop() {
    this.systemctl(['stop', this.unitName()])
  }

  async restart() {
    this.systemctl(['restart', this.unitName()])
  }

  async status(): Promise<ServiceStatus> {
    const installed = existsSync(this.servicePath())
    const active = runServiceCommand('systemctl', ['--user', 'is-active', this.unitName()], 10000)
    const enabled = runServiceCommand('systemctl', ['--user', 'is-enabled', this.unitName()], 10000)
    const show = runServiceCommand('systemctl', ['--user', 'show', this.unitName(), '--property=MainPID', '--property=SubState', '--no-page'], 10000)
    const pidMatch = show.stdout.match(/MainPID=(\d+)/)
    const pid = pidMatch ? Number(pidMatch[1]) : undefined
    return {
      installed,
      running: active.stdout === 'active',
      serviceName: this.serviceName,
      pid: pid && pid > 0 ? pid : undefined,
      autostart: enabled.stdout === 'enabled',
      detail: show.stdout || active.stderr || undefined,
    }
  }

  async *logs(options: ServiceLogOptions): AsyncIterable<string> {
    const args = ['--user', '-u', this.unitName(), '-n', String(Math.max(1, options.lines ?? 100)), '--no-pager']
    if (options.follow) {
      args.push('-f')
    }
    yield* streamCommandLines('journalctl', args)
  }

  private systemctl(args: string[]) {
    const result = runServiceCommand('systemctl', ['--user', ...args], 30000)
    if (!result.ok) {
      throw new Error(result.stderr || result.error || `systemctl --user ${args.join(' ')} failed`)
    }
  }

  private buildService(options: ServiceInstallOptions) {
    const env = Object.entries(options.env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`)
      .join('\n')
    const execStart = [options.workerPath, ...options.args].map(systemdQuote).join(' ')
    return `[Unit]
Description=wemux Worker (${this.serviceName})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=${options.restartOnFailure ? 'always' : 'no'}
RestartSec=${Math.max(1, Math.floor(options.restartDelayMs / 1000))}
${env}

[Install]
WantedBy=default.target
`
  }
}

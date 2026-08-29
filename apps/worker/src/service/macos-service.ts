// [INPUT]: macOS 服务安装输入
// [OUTPUT]: 安装管理
// [POS]: macOS 服务安装
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PlatformService, ServiceInstallOptions, ServiceLogOptions, ServiceStatus } from './platform-service'
import { getDefaultWorkerServiceName, runServiceCommand, streamCommandLines } from './service-common'

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

export class MacOSService implements PlatformService {
  constructor(private readonly serviceName = getDefaultWorkerServiceName()) {}

  private label() {
    return `com.vibemux.${this.serviceName}`
  }

  private launchTarget() {
    return `gui/${process.getuid?.() ?? os.userInfo().uid}/${this.label()}`
  }

  private plistPath() {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', `${this.label()}.plist`)
  }

  private stdoutPath() {
    return path.join(os.homedir(), 'Library', 'Logs', 'Vibemux', `${this.serviceName}.stdout.log`)
  }

  private stderrPath() {
    return path.join(os.homedir(), 'Library', 'Logs', 'Vibemux', `${this.serviceName}.stderr.log`)
  }

  async install(options: ServiceInstallOptions) {
    await mkdir(path.dirname(this.plistPath()), { recursive: true })
    await mkdir(options.logDir, { recursive: true })
    await mkdir(path.dirname(this.stdoutPath()), { recursive: true })
    await writeFile(this.plistPath(), this.buildPlist(options), 'utf8')
    if (options.autoStart !== false) {
      await this.start()
    }
  }

  async uninstall() {
    await this.stop().catch(() => undefined)
    await unlink(this.plistPath()).catch(() => undefined)
  }

  async start() {
    if (!existsSync(this.plistPath())) {
      throw new Error(`Service plist not found: ${this.plistPath()}`)
    }

    const print = runServiceCommand('launchctl', ['print', this.launchTarget()], 10000)
    if (!print.ok) {
      const bootstrap = runServiceCommand('launchctl', ['bootstrap', `gui/${process.getuid?.() ?? os.userInfo().uid}`, this.plistPath()], 15000)
      if (!bootstrap.ok && !/already bootstrapped/i.test(`${bootstrap.stderr}\n${bootstrap.stdout}`)) {
        throw new Error(bootstrap.stderr || bootstrap.error || 'launchctl bootstrap failed')
      }
    }

    const kickstart = runServiceCommand('launchctl', ['kickstart', '-k', this.launchTarget()], 15000)
    if (!kickstart.ok) {
      throw new Error(kickstart.stderr || kickstart.error || 'launchctl kickstart failed')
    }
  }

  async stop() {
    const result = runServiceCommand('launchctl', ['bootout', this.launchTarget()], 15000)
    if (!result.ok && !/No such process|Could not find service/i.test(`${result.stderr}\n${result.stdout}`)) {
      throw new Error(result.stderr || result.error || 'launchctl bootout failed')
    }
  }

  async restart() {
    await this.start()
  }

  async status(): Promise<ServiceStatus> {
    const installed = existsSync(this.plistPath())
    const result = runServiceCommand('launchctl', ['print', this.launchTarget()], 10000)
    const output = `${result.stdout}\n${result.stderr}`
    const pidMatch = output.match(/\bpid\s*=\s*(\d+)/i)
    return {
      installed,
      running: result.ok && Boolean(pidMatch),
      pid: pidMatch ? Number(pidMatch[1]) : undefined,
      autostart: installed,
      serviceName: this.serviceName,
      detail: result.ok ? undefined : result.stderr || result.error || undefined,
    }
  }

  async *logs(options: ServiceLogOptions): AsyncIterable<string> {
    const args = ['-n', String(Math.max(1, options.lines ?? 100))]
    if (options.follow) {
      args.push('-f')
    }
    const files = options.errorsOnly ? [this.stderrPath()] : [this.stdoutPath(), this.stderrPath()]
    const existingFiles = files.filter((file) => existsSync(file))
    if (existingFiles.length === 0) {
      yield `No log files found for ${this.serviceName}.`
      return
    }
    yield* streamCommandLines('tail', [...args, ...existingFiles])
  }

  private buildPlist(options: ServiceInstallOptions) {
    const args = [options.workerPath, ...options.args]
      .map((arg) => `        <string>${escapeXml(arg)}</string>`)
      .join('\n')
    const env = Object.entries(options.env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `        <key>${escapeXml(key)}</key>\n        <string>${escapeXml(value)}</string>`)
      .join('\n')

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(this.label())}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key>
    <${options.autoStart === false ? 'false' : 'true'}/>
    <key>KeepAlive</key>
    <${options.restartOnFailure ? 'true' : 'false'}/>
    <key>ThrottleInterval</key>
    <integer>${Math.max(1, Math.floor(options.restartDelayMs / 1000))}</integer>
    <key>StandardOutPath</key>
    <string>${escapeXml(this.stdoutPath())}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(this.stderrPath())}</string>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
</dict>
</plist>
`
  }
}

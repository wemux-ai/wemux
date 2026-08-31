// [INPUT]: Windows 服务安装输入
// [OUTPUT]: 安装管理
// [POS]: Windows 服务安装
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { PlatformService, ServiceInstallOptions, ServiceLogOptions, ServiceStatus } from './platform-service'
import { getDefaultWorkerServiceName, runServiceCommand, streamCommandLines } from './service-common'

const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`
const cmdQuote = (value: string) => `"${value.replace(/"/g, '""')}"`

type WindowsScheduledTaskInfo = {
  taskName?: string
  taskPath?: string
  state?: string
  enabled?: boolean
  execute?: string
  arguments?: string
}

type WindowsServiceRuntimeConfig = {
  workerPath: string
  args: string[]
  env: Record<string, string>
  restartOnFailure: boolean
  restartDelayMs: number
}

export class WindowsService implements PlatformService {
  constructor(private readonly serviceName = getDefaultWorkerServiceName()) {}

  private scheduledTaskPath() {
    return '\\Wemux\\'
  }

  private scheduledTaskLeafName() {
    return this.serviceName
  }

  private serviceRoot() {
    return path.join(os.homedir(), 'AppData', 'Local', 'Wemux', 'services', this.serviceName)
  }

  private envPath() {
    return path.join(this.serviceRoot(), 'service-env.json')
  }

  private pidPath() {
    return path.join(this.serviceRoot(), 'worker.pid')
  }

  private supervisorPidPath() {
    return path.join(this.serviceRoot(), 'worker-supervisor.pid')
  }

  private stdoutPath() {
    return path.join(this.serviceRoot(), 'stdout.log')
  }

  private stderrPath() {
    return path.join(this.serviceRoot(), 'stderr.log')
  }

  private supervisorLogPath() {
    return path.join(this.serviceRoot(), 'supervisor.log')
  }

  private supervisorLaunchLogPath() {
    return path.join(this.serviceRoot(), 'supervisor-launch.log')
  }

  private startupShortcutPath() {
    const home = process.env.USERPROFILE || os.homedir()
    const startupDir = path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    return path.join(startupDir, `Wemux-${this.serviceName}.vbs`)
  }

  private supervisorNodeCommand(config?: WindowsServiceRuntimeConfig) {
    const currentCliPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
    const cliPath = config?.args?.[0] && existsSync(config.args[0])
      ? config.args[0]
      : currentCliPath
    const command = config?.workerPath && existsSync(config.workerPath)
      ? config.workerPath
      : process.execPath

    if (!cliPath) {
      throw new Error('Cannot resolve worker CLI path for Windows service supervisor.')
    }

    return {
      command,
      args: [cliPath, 'service', 'supervisor', '--name', this.serviceName],
    }
  }

  private supervisorNodeCommandLine(config?: WindowsServiceRuntimeConfig) {
    const command = this.supervisorNodeCommand(config)
    return [command.command, ...command.args].map(cmdQuote).join(' ')
  }

  /**
   * Scheduled tasks launch console apps in the interactive session with a visible
   * console window. Wrapping the supervisor in `conhost --headless` keeps it running
   * without a window; otherwise closing that window delivers CTRL_CLOSE (SIGHUP) to
   * the supervisor and worker and takes the node offline.
   */
  private supervisorTaskCommand(config: WindowsServiceRuntimeConfig) {
    const supervisorCommand = this.supervisorNodeCommand(config)
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
    return {
      execute: path.join(systemRoot, 'System32', 'conhost.exe'),
      args: ['--headless', supervisorCommand.command, ...supervisorCommand.args],
    }
  }

  async install(options: ServiceInstallOptions) {
    mkdirSync(this.serviceRoot(), { recursive: true })
    mkdirSync(options.logDir, { recursive: true })
    const runtimeConfig = {
      workerPath: options.workerPath,
      args: options.args,
      env: options.env,
      restartOnFailure: options.restartOnFailure,
      restartDelayMs: options.restartDelayMs,
    }
    writeFileSync(this.envPath(), `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8')

    // Try scheduled task first (requires admin), fall back to startup shortcut (no admin needed)
    const scheduledTaskResult = this.tryRegisterScheduledTask(runtimeConfig)
    if (scheduledTaskResult.ok) {
      if (options.autoStart !== false) {
        await this.start()
      }
      return
    }

    // Fallback: create a startup shortcut via VBS script (hidden window)
    this.installStartupShortcut(runtimeConfig)
    if (options.autoStart !== false) {
      await this.startSupervisorProcess()
    }
  }

  private tryRegisterScheduledTask(config: WindowsServiceRuntimeConfig): { ok: boolean; error?: string } {
    const result = runServiceCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      this.buildRegisterScheduledTaskCommand(config),
    ], 30000)

    if (result.ok) {
      return { ok: true }
    }

    return { ok: false, error: result.stderr || result.error || 'Register-ScheduledTask failed' }
  }

  private buildRegisterScheduledTaskCommand(config: WindowsServiceRuntimeConfig) {
    const taskCommand = this.supervisorTaskCommand(config)
    const actionCmd = `New-ScheduledTaskAction -Execute ${psQuote(taskCommand.execute)} -Argument ${psQuote(taskCommand.args.map(cmdQuote).join(' '))} -WorkingDirectory ${psQuote(this.serviceRoot())}`
    const triggerCmd = 'New-ScheduledTaskTrigger -AtLogOn'
    const settingsCmd = [
      'New-ScheduledTaskSettingsSet',
      '-AllowStartIfOnBatteries',
      '-DontStopIfGoingOnBatteries',
      '-StartWhenAvailable',
      '-MultipleInstances IgnoreNew',
      '-ExecutionTimeLimit (New-TimeSpan -Seconds 0)',
    ].join(' ')
    return [
      '$action = ' + actionCmd,
      ';',
      '$trigger = ' + triggerCmd,
      ';',
      '$settings = ' + settingsCmd,
      ';',
      'Register-ScheduledTask',
      `-TaskName ${psQuote(this.scheduledTaskLeafName())}`,
      `-TaskPath ${psQuote(this.scheduledTaskPath())}`,
      '-Action $action',
      '-Trigger $trigger',
      '-Settings $settings',
      `-Description ${psQuote(`wemux Worker (${this.serviceName})`)}`,
      '-Force',
    ].join(' ')
  }

  private installStartupShortcut(config: WindowsServiceRuntimeConfig) {
    // VBS script to launch the supervisor hidden (no console window on login)
    const shortcutPath = this.startupShortcutPath()
    mkdirSync(path.dirname(shortcutPath), { recursive: true })
    const vbsContent = [
      `Set objShell = CreateObject("WScript.Shell")`,
      `objShell.Run "${this.supervisorNodeCommandLine(config).replace(/\\/g, '\\\\').replace(/"/g, '""')}", 0, False`,
    ].join('\n')

    writeFileSync(shortcutPath, vbsContent, 'utf8')
  }

  async uninstall() {
    await this.stop().catch(() => undefined)
    this.runPowerShell([
      'Unregister-ScheduledTask',
      '-TaskName', psQuote(this.scheduledTaskLeafName()),
      '-TaskPath', psQuote(this.scheduledTaskPath()),
      '-Confirm:$false',
      '-ErrorAction', 'SilentlyContinue',
    ].join(' '))
    rmSync(this.startupShortcutPath(), { force: true })
    rmSync(this.serviceRoot(), { recursive: true, force: true })
  }

  async start() {
    const current = await this.readScheduledTaskInfo()
    if (current?.state?.toLowerCase() === 'running') {
      return
    }

    if (!current) {
      await this.startSupervisorProcess()
      return
    }

    this.prepareStartupAttemptLogs()
    this.runPowerShell([
      'Start-ScheduledTask',
      '-TaskName', psQuote(this.scheduledTaskLeafName()),
      '-TaskPath', psQuote(this.scheduledTaskPath()),
    ].join(' '))
    await this.waitForSupervisorRunning()
  }

  async stop() {
    const current = await this.readScheduledTaskInfo()
    if (current?.state?.toLowerCase() === 'running') {
      this.runPowerShell([
        'Stop-ScheduledTask',
        '-TaskName', psQuote(this.scheduledTaskLeafName()),
        '-TaskPath', psQuote(this.scheduledTaskPath()),
      ].join(' '))
    }

    const pid = this.readPid()
    if (pid) {
      runServiceCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 30000)
    }

    const supervisorPid = this.readSupervisorPid()
    if (supervisorPid && supervisorPid !== pid) {
      runServiceCommand('taskkill.exe', ['/PID', String(supervisorPid), '/T', '/F'], 30000)
    }
  }

  async restart() {
    await this.stop().catch(() => undefined)
    await this.start()
  }

  async status(): Promise<ServiceStatus> {
    const installed = existsSync(this.envPath())
    const hasStartupShortcut = existsSync(this.startupShortcutPath())
    const scheduledTask = await this.readScheduledTaskInfo()
    const pid = this.readPid()
    const supervisorPid = this.readSupervisorPid()
    const state = scheduledTask?.state?.trim() || ''
    const taskToRun = [scheduledTask?.execute?.trim(), scheduledTask?.arguments?.trim()].filter(Boolean).join(' ')

    const isInstalled = installed && (Boolean(scheduledTask) || hasStartupShortcut)
    const workerRunning = pid ? this.isProcessRunning(pid) : false
    const supervisorRunning = supervisorPid ? this.isProcessRunning(supervisorPid) : false

    return {
      installed: isInstalled,
      running: state.toLowerCase() === 'running'
        ? workerRunning || supervisorRunning
        : hasStartupShortcut && (workerRunning || supervisorRunning),
      serviceName: this.serviceName,
      pid: pid || supervisorPid || undefined,
      autostart: scheduledTask?.enabled ?? hasStartupShortcut ?? installed,
      mode: 'current-user',
      runsAs: process.env.USERNAME || os.userInfo().username,
      adminRequired: false,
      detail: scheduledTask
        ? `${state || 'Unknown'}${taskToRun ? ` | ${taskToRun}` : ''}`
        : hasStartupShortcut
          ? 'Current-user startup shortcut (starts when this Windows user logs in)'
          : (installed ? 'Service files present but no autostart configured.' : undefined),
    }
  }

  async *logs(options: ServiceLogOptions): AsyncIterable<string> {
    const files = options.errorsOnly
      ? [this.stderrPath(), this.supervisorLogPath(), this.supervisorLaunchLogPath()]
      : [this.stdoutPath(), this.stderrPath(), this.supervisorLogPath(), this.supervisorLaunchLogPath()]
    const existingFiles = files.filter((file) => existsSync(file))
    if (existingFiles.length === 0) {
      yield `No log files found for ${this.serviceName}.`
      return
    }

    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      this.buildTailCommand(existingFiles, options),
    ]
    yield* streamCommandLines('powershell.exe', args)
  }

  private async startSupervisorProcess() {
    const pid = this.readPid()
    const supervisorPid = this.readSupervisorPid()
    if ((pid && this.isProcessRunning(pid)) || (supervisorPid && this.isProcessRunning(supervisorPid))) {
      return
    }

    this.prepareStartupAttemptLogs()
    const config = this.readServiceRuntimeConfig()
    const supervisorCommand = this.supervisorNodeCommand(config)
    const launchLogFd = openSync(this.supervisorLaunchLogPath(), 'a')
    writeFileSync(launchLogFd, `[worker-supervisor-launch] starting node supervisor at ${new Date().toISOString()}\n`, 'utf8')
    writeFileSync(launchLogFd, `[worker-supervisor-launch] command ${[supervisorCommand.command, ...supervisorCommand.args].join(' ')}\n`, 'utf8')
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(supervisorCommand.command, supervisorCommand.args, {
        cwd: this.serviceRoot(),
        detached: true,
        windowsHide: true,
        stdio: ['ignore', launchLogFd, launchLogFd],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeFileSync(launchLogFd, `[worker-supervisor-launch] spawn failed: ${message}\n`, 'utf8')
      closeSync(launchLogFd)
      throw error
    }
    child.once('error', (error) => {
      try {
        writeFileSync(launchLogFd, `[worker-supervisor-launch] spawn error: ${error.message}\n`, 'utf8')
      } catch {
        // Best-effort diagnostics only.
      }
    })
    if (child.pid) {
      writeFileSync(this.supervisorPidPath(), String(child.pid), 'utf8')
      writeFileSync(launchLogFd, `[worker-supervisor-launch] node supervisor pid ${child.pid}\n`, 'utf8')
    }
    child.unref()
    closeSync(launchLogFd)

    await this.waitForSupervisorRunning()
  }

  private async waitForSupervisorRunning() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const nextPid = this.readPid()
      const nextSupervisorPid = this.readSupervisorPid()
      if ((nextPid && this.isProcessRunning(nextPid)) || (nextSupervisorPid && this.isProcessRunning(nextSupervisorPid))) {
        return
      }
    }

    const logTail = this.readStartupLogTail()
    throw new Error([
      'Worker supervisor did not stay running.',
      logTail ? `Recent service logs:\n${logTail}` : `Check logs with \`${this.serviceName} service logs --name ${this.serviceName}\`.`,
    ].join('\n'))
  }

  private prepareStartupAttemptLogs() {
    mkdirSync(this.serviceRoot(), { recursive: true })
    rmSync(this.pidPath(), { force: true })
    rmSync(this.supervisorPidPath(), { force: true })

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    for (const logPath of [this.stdoutPath(), this.stderrPath(), this.supervisorLogPath(), this.supervisorLaunchLogPath()]) {
      if (!existsSync(logPath)) {
        continue
      }
      try {
        renameSync(logPath, `${logPath}.${stamp}.bak`)
      } catch {
        try {
          writeFileSync(logPath, '', 'utf8')
        } catch {
          // If another process still owns the file, keep going so the real start error is surfaced.
        }
      }
    }
  }

  private hideSupervisorConsoleWindow() {
    if (process.platform !== 'win32') {
      return
    }
    // If the supervisor was launched with a visible console (e.g. by an older
    // scheduled task action), hide the window as soon as possible. Hiding with
    // SW_HIDE does not deliver CTRL_CLOSE, so the supervisor and worker keep
    // running; a user closing a visible window would otherwise take the node offline.
    const script = [
      `Add-Type -Name Win32Console -Namespace Native -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'`,
      `$h = [Native.Win32Console]::GetConsoleWindow()`,
      `if ($h -ne [IntPtr]::Zero) { [Native.Win32Console]::ShowWindow($h, 0) | Out-Null }`,
    ].join('; ')
    const result = runServiceCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      script,
    ], 15000)
    if (!result.ok) {
      this.appendSupervisorLog(`[worker-supervisor] console window hide failed: ${result.stderr || result.error || 'unknown error'}`)
    }
  }

  private readStartupLogTail() {
    const chunks: string[] = []
    for (const [label, logPath] of [
      ['stdout', this.stdoutPath()],
      ['stderr', this.stderrPath()],
      ['supervisor', this.supervisorLogPath()],
      ['supervisor-launch', this.supervisorLaunchLogPath()],
    ] as const) {
      try {
        if (!existsSync(logPath)) {
          continue
        }
        const lines = readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-80)
        if (lines.length > 0) {
          chunks.push(`[${label}]\n${lines.join('\n')}`)
        }
      } catch {
        // Best-effort diagnostics only.
      }
    }

    return chunks.join('\n')
  }

  private readServiceRuntimeConfig(): WindowsServiceRuntimeConfig {
    const raw = readFileSync(this.envPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<WindowsServiceRuntimeConfig>
    if (!parsed.workerPath || !Array.isArray(parsed.args)) {
      throw new Error(`Invalid Windows service runtime config: ${this.envPath()}`)
    }
    return {
      workerPath: parsed.workerPath,
      args: parsed.args,
      env: parsed.env && typeof parsed.env === 'object' ? parsed.env as Record<string, string> : {},
      restartOnFailure: parsed.restartOnFailure !== false,
      restartDelayMs: Number.isFinite(parsed.restartDelayMs) ? Number(parsed.restartDelayMs) : 5000,
    }
  }

  async runSupervisorLoop() {
    mkdirSync(this.serviceRoot(), { recursive: true })
    this.hideSupervisorConsoleWindow()
    const config = this.readServiceRuntimeConfig()
    writeFileSync(this.supervisorPidPath(), String(process.pid), 'utf8')
    this.appendSupervisorLog(`[worker-supervisor] node supervisor starting at ${new Date().toISOString()}; workerPath=${config.workerPath}; args=${config.args.join(' ')}`)

    const cleanup = () => {
      rmSync(this.pidPath(), { force: true })
      rmSync(this.supervisorPidPath(), { force: true })
    }
    process.once('SIGTERM', () => {
      this.appendSupervisorLog(`[worker-supervisor] received SIGTERM at ${new Date().toISOString()}`)
      cleanup()
      process.exit(0)
    })
    process.once('SIGINT', () => {
      this.appendSupervisorLog(`[worker-supervisor] received SIGINT at ${new Date().toISOString()}`)
      cleanup()
      process.exit(0)
    })

    try {
      while (true) {
        await this.runWorkerOnce(config)
        rmSync(this.pidPath(), { force: true })
        if (!config.restartOnFailure) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, Math.max(1000, config.restartDelayMs)))
      }
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error)
      this.appendSupervisorLog(`[worker-supervisor] node supervisor failed at ${new Date().toISOString()}: ${message}`)
      throw error
    } finally {
      cleanup()
    }
  }

  private async runWorkerOnce(config: WindowsServiceRuntimeConfig) {
    if (!existsSync(config.workerPath)) {
      throw new Error(`Worker executable not found: ${config.workerPath}`)
    }

    this.appendSupervisorLog(`[worker-supervisor] launching worker at ${new Date().toISOString()}; file=${config.workerPath}; args=${config.args.join(' ')}`)
    const stdoutFd = openSync(this.stdoutPath(), 'a')
    const stderrFd = openSync(this.stderrPath(), 'a')
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(config.workerPath, config.args, {
        cwd: this.serviceRoot(),
        env: { ...process.env, ...config.env },
        windowsHide: true,
        stdio: ['ignore', stdoutFd, stderrFd],
      })
    } finally {
      closeSync(stdoutFd)
      closeSync(stderrFd)
    }

    if (child.pid) {
      writeFileSync(this.pidPath(), String(child.pid), 'utf8')
      this.appendSupervisorLog(`[worker-supervisor] worker pid ${child.pid}`)
    }

    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    this.appendSupervisorLog(`[worker-supervisor] worker exited at ${new Date().toISOString()}; code=${result.code ?? 'null'}; signal=${result.signal ?? 'null'}`)
  }

  private appendSupervisorLog(message: string) {
    mkdirSync(this.serviceRoot(), { recursive: true })
    appendFileSync(this.supervisorLogPath(), `${message}\n`, 'utf8')
  }

  private readPid() {
    try {
      if (!existsSync(this.pidPath())) {
        return 0
      }
      const raw = readFileSync(this.pidPath(), 'utf8').trim()
      const pid = Number(raw)
      return Number.isFinite(pid) && pid > 0 ? pid : 0
    } catch {
      return 0
    }
  }

  private readSupervisorPid() {
    try {
      if (!existsSync(this.supervisorPidPath())) {
        return 0
      }
      const raw = readFileSync(this.supervisorPidPath(), 'utf8').trim()
      const pid = Number(raw)
      return Number.isFinite(pid) && pid > 0 ? pid : 0
    } catch {
      return 0
    }
  }

  private isProcessRunning(pid: number) {
    if (!pid) {
      return false
    }

    if (process.platform !== 'win32') {
      return true
    }

    const result = runServiceCommand('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 15000)
    if (!result.ok) {
      return false
    }

    return result.stdout.split(/\r?\n/).some((line) => line.includes(`"${pid}"`) || line.includes(`,${pid},`))
  }

  private runPowerShell(command: string, timeout = 30000) {
    const result = runServiceCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      command,
    ], timeout)
    if (!result.ok) {
      throw new Error(result.stderr || result.error || 'powershell command failed')
    }
    return result.stdout
  }

  private async readScheduledTaskInfo(): Promise<WindowsScheduledTaskInfo | null> {
    const command = [
      '$task = Get-ScheduledTask',
      `-TaskName ${psQuote(this.scheduledTaskLeafName())}`,
      `-TaskPath ${psQuote(this.scheduledTaskPath())}`,
      '-ErrorAction SilentlyContinue',
      ';',
      'if (-not $task) { return }',
      ';',
      '$action = $task.Actions | Select-Object -First 1',
      ';',
      '[pscustomobject]@{',
      'taskName = $task.TaskName;',
      'taskPath = $task.TaskPath;',
      'state = [string]$task.State;',
      'enabled = [bool]$task.Settings.Enabled;',
      'execute = if ($action) { [string]$action.Execute } else { "" };',
      'arguments = if ($action) { [string]$action.Arguments } else { "" };',
      '} | ConvertTo-Json -Compress',
    ].join(' ')

    const result = runServiceCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      command,
    ], 15000)

    if (!result.ok) {
      return null
    }

    const raw = result.stdout.trim()
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw) as WindowsScheduledTaskInfo
    } catch {
      return null
    }
  }

  private buildTailCommand(files: string[], options: ServiceLogOptions) {
    const fileArray = `@(${files.map((file) => psQuote(file)).join(', ')})`
    const lineCount = Math.max(1, options.lines ?? 100)
    if (options.follow) {
      return `$files = ${fileArray}; Get-Content -Path $files -Tail ${lineCount} -Wait`
    }
    return `$files = ${fileArray}; Get-Content -Path $files -Tail ${lineCount}`
  }

}

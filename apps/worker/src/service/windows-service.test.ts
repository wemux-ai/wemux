import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('WindowsService install writes supervisor assets and handles permission fallback', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'vibemux-windows-service-'))
  const previousHome = process.env.USERPROFILE
  const previousHomeDrive = process.env.HOMEDRIVE
  const previousHomePath = process.env.HOMEPATH
  const previousHomeEnv = process.env.HOME

  process.env.USERPROFILE = tempHome
  process.env.HOMEDRIVE = path.parse(tempHome).root.replace(/\\$/, '')
  process.env.HOMEPATH = tempHome.slice(process.env.HOMEDRIVE.length) || '\\'
  process.env.HOME = tempHome

  try {
    const { WindowsService } = await import('./windows-service')
    const service = new WindowsService('vibemux-worker-test')
    const rootDir = path.join(tempHome, 'AppData', 'Local', 'Vibemux', 'services', 'vibemux-worker-test')
    const logDir = path.join(tempHome, 'logs')
    const fakeNodePath = path.join(tempHome, 'node.exe')
    const fakeCliPath = path.join(tempHome, 'node_modules', 'vibemux-worker-preview', 'bin', 'cli.mjs')

    await writeFile(fakeNodePath, '')
    await mkdir(path.dirname(fakeCliPath), { recursive: true })
    await writeFile(fakeCliPath, '')

    // Install should not throw — either scheduled task or startup shortcut fallback works
    await service.install({
      serviceName: 'vibemux-worker-test',
      workerPath: fakeNodePath,
      args: [fakeCliPath, 'daemon'],
      env: {
        VIBEMUX_WORKER_HOME: 'C:\\Users\\demo\\.vibemux',
        VIBEMUX_WORKER_RESTART_STRATEGY: 'system-service',
      },
      logDir,
      restartOnFailure: true,
      restartDelayMs: 5000,
      autoStart: false,
    })

    // Verify env file was written
    const envJson = JSON.parse(await readFile(path.join(rootDir, 'service-env.json'), 'utf8')) as {
      workerPath: string
      args: string[]
      env: Record<string, string>
    }
    assert.equal(envJson.workerPath, fakeNodePath)
    assert.deepEqual(envJson.args, [fakeCliPath, 'daemon'])
    assert.equal(envJson.env.VIBEMUX_WORKER_RESTART_STRATEGY, 'system-service')

    assert.equal(existsSync(path.join(rootDir, 'worker-supervisor.ps1')), false)

    const startupShortcut = await readFile(
      path.join(tempHome, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Vibemux-vibemux-worker-test.vbs'),
      'utf8',
    )
    assert.match(startupShortcut, /""service"" ""supervisor""/)
    assert.match(startupShortcut, new RegExp(fakeNodePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(startupShortcut, new RegExp(fakeCliPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(startupShortcut, /powershell\.exe -NoProfile/)

    // Status should report installed with autostart
    const status = await service.status()
    assert.ok(status.installed, 'Service should report as installed')
    assert.ok(status.autostart, 'Service should have autostart configured')
    assert.equal(status.mode, 'current-user')
    assert.equal(status.adminRequired, false)
    assert.match(status.detail || '', /Current-user startup/)
  } finally {
    if (previousHome === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = previousHome
    }
    if (previousHomeDrive === undefined) {
      delete process.env.HOMEDRIVE
    } else {
      process.env.HOMEDRIVE = previousHomeDrive
    }
    if (previousHomePath === undefined) {
      delete process.env.HOMEPATH
    } else {
      process.env.HOMEPATH = previousHomePath
    }
    if (previousHomeEnv === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHomeEnv
    }
    await rm(tempHome, { recursive: true, force: true })
  }
})

test('WindowsService scheduled task action hides the supervisor console window', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'vibemux-windows-task-'))
  const previousHome = process.env.USERPROFILE
  process.env.USERPROFILE = tempHome

  try {
    const { WindowsService } = await import('./windows-service')
    const service = new WindowsService('vibemux-worker-test')
    const fakeNodePath = path.join(tempHome, 'node.exe')
    const fakeCliPath = path.join(tempHome, 'node_modules', 'vibemux-worker-preview', 'bin', 'cli.mjs')

    await writeFile(fakeNodePath, '')
    await mkdir(path.dirname(fakeCliPath), { recursive: true })
    await writeFile(fakeCliPath, '')

    // Access the private builder so the scheduled task action can be asserted
    // without executing PowerShell.
    const registerCommand = (service as unknown as {
      buildRegisterScheduledTaskCommand(config: {
        workerPath: string
        args: string[]
        env: Record<string, string>
        restartOnFailure: boolean
        restartDelayMs: number
      }): string
    }).buildRegisterScheduledTaskCommand({
      workerPath: fakeNodePath,
      args: [fakeCliPath, 'daemon'],
      env: {},
      restartOnFailure: true,
      restartDelayMs: 5000,
    })

    // The task must launch the node supervisor through conhost --headless so Task
    // Scheduler does not open a visible console window; closing such a window would
    // deliver CTRL_CLOSE to the supervisor and worker and take the node offline.
    assert.match(registerCommand, /New-ScheduledTaskAction -Execute '.*conhost\.exe'/, 'task action should run conhost.exe')
    assert.match(registerCommand, /--headless/, 'task action should hide the console window')
    assert.match(registerCommand, new RegExp(fakeNodePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(registerCommand, new RegExp(fakeCliPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(registerCommand, /"service" "supervisor"/)
    assert.doesNotMatch(registerCommand, /-Execute '.*(node|powershell)\.exe' -Argument/, 'node must not be the task action root')
  } finally {
    if (previousHome === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = previousHome
    }
    await rm(tempHome, { recursive: true, force: true })
  }
})

test('WindowsService supervisor hides its console window when one is present', async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), 'vibemux-windows-hide-'))
  const previousHome = process.env.USERPROFILE
  process.env.USERPROFILE = tempHome

  try {
    const { WindowsService } = await import('./windows-service')
    const service = new WindowsService('vibemux-worker-test')

    // The Win32 hide script must be well-formed (SW_HIDE) and the call must not
    // throw on non-Windows hosts (spawn of powershell.exe just fails quietly).
    const hide = (service as unknown as { hideSupervisorConsoleWindow(): void }).hideSupervisorConsoleWindow
    assert.doesNotThrow(() => hide.call(service))
  } finally {
    if (previousHome === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = previousHome
    }
    await rm(tempHome, { recursive: true, force: true })
  }
})

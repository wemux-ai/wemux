import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const serverHealthUrl = process.env.WEMUX_DESKTOP_SERVER_HEALTH_URL || 'http://127.0.0.1:8989/api/health'
const webUrl = process.env.WEMUX_DESKTOP_DEV_URL || 'http://127.0.0.1:15173/chat'
const webOrigin = new URL(webUrl).origin
const managedChildren = new Set()

const isWindows = process.platform === 'win32'
const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'

const isReachable = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

const startManagedProcess = (args, env = {}) => {
  const child = spawn(pnpmCommand, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    detached: !isWindows,
  })
  managedChildren.add(child)
  child.once('exit', () => managedChildren.delete(child))
  return child
}

const runSetupCommand = (args) => new Promise((resolve, reject) => {
  const child = spawn(pnpmCommand, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`pnpm ${args.join(' ')} failed with exit code ${code}`))
  })
})

const waitForUrl = async (name, url, processToWatch) => {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await isReachable(url)) return
    if (processToWatch?.exitCode !== null) {
      throw new Error(`${name} exited before ${url} became ready`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${name} at ${url}`)
}

const stopChild = (child) => {
  if (!child.pid || child.exitCode !== null) return
  try {
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch {
    // The process may already have exited.
  }
}

let shuttingDown = false
const shutdown = (exitCode = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of managedChildren) stopChild(child)
  setTimeout(() => process.exit(exitCode), 150).unref()
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

try {
  let serverProcess
  if (!(await isReachable(serverHealthUrl))) {
    if (process.env.WEMUX_DESKTOP_SKIP_INFRA !== '1') {
      console.log('[desktop] ensuring local Postgres and object storage are running...')
      await runSetupCommand(['dev:infra:up'])
    }
    console.log('[desktop] starting control-plane server...')
    // Better Auth validates the browser Origin independently from API CORS.
    // Desktop dev uses its own Vite port, so add that origin to the managed
    // server process without requiring a local .env edit.
    const trustedOrigins = new Set(
      (process.env.BETTER_AUTH_TRUSTED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    trustedOrigins.add(webOrigin)
    serverProcess = startManagedProcess(['dev:server'], {
      BETTER_AUTH_TRUSTED_ORIGINS: [...trustedOrigins].join(','),
    })
  }

  let webProcess
  if (!(await isReachable(webUrl))) {
    console.log('[desktop] starting web dev server on 127.0.0.1:15173...')
    webProcess = startManagedProcess(['dev:client'], {
      HOST: '127.0.0.1',
      PORT: '15173',
      VITE_HMR_HOST: '127.0.0.1',
    })
  }

  await Promise.all([
    waitForUrl('control-plane server', serverHealthUrl, serverProcess),
    waitForUrl('web dev server', webUrl, webProcess),
  ])

  console.log(`[desktop] launching Electron at ${webUrl}`)
  const electronProcess = spawn(electronPath, ['.'], {
    cwd: desktopRoot,
    env: { ...process.env, WEMUX_DESKTOP_DEV_URL: webUrl },
    stdio: 'inherit',
    detached: !isWindows,
  })
  managedChildren.add(electronProcess)
  electronProcess.once('exit', (code) => {
    managedChildren.delete(electronProcess)
    shutdown(code ?? 0)
  })
} catch (error) {
  console.error(`[desktop] ${error instanceof Error ? error.message : String(error)}`)
  shutdown(1)
}

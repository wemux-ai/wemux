/**
 * [INPUT]: Terminal launch requests, runtime environment, and optional persistent Zellij identity.
 * [OUTPUT]: Interactive terminal sessions backed by Zellij, node-pty, Python PTY, or a pipe shell.
 * [POS]: Worker-owned terminal process boundary and backend fallback chain.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path, { dirname } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { ExecutorTerminalRequestMode, ExecutorTerminalResult } from '@shared/types'
import { getProcessPathValue, setProcessPathValue } from '../core/command-utils'
import { getWorkerHome } from '../core/config'
import { materializeRuntimeEnvironment, mergeRuntimeEnvironmentIntoProcessEnv } from '../execution/runtime-environment'
import { ensureZellijBinary } from './zellij-binary-manager'

type TerminalOutputStream = 'stdout' | 'stderr' | 'system'
type TerminalSessionMode = 'pty' | 'pipe'
type TerminalSessionBackend = 'node-pty' | 'python-pty' | 'pipe' | 'zellij'

type NodePtySession = {
  onData: (callback: (chunk: string) => void) => void
  onExit: (callback: (event: { exitCode: number }) => void) => void
  write: (input: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

type NodePtyModule = {
  spawn: (file: string, args: string[], options: {
    cwd: string
    env: NodeJS.ProcessEnv
    cols: number
    rows: number
    name: string
  }) => NodePtySession
}

type TerminalSessionCallbacks = {
  onExit: (exitCode: number) => void
  onLog: (message: string, payload?: Record<string, unknown>) => void
  onOutput: (stream: TerminalOutputStream, chunk: string) => void
  onReady: (mode: TerminalSessionMode, backend: TerminalSessionBackend, cwd: string) => void
}

export type TerminalSession = {
  backend: TerminalSessionBackend
  mode: TerminalSessionMode
  isPersistent?: () => boolean
  kill: () => void
  detach?: () => void
  resize: (cols: number, rows: number) => void
  write: (input: string) => void
}

type OpenTerminalSessionParams = TerminalSessionCallbacks & {
  cols?: number
  cwd: string
  rows?: number
  shell?: string
  terminalKey?: string
  workspaceRoot?: string
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  onPersistentReady?: () => void
}

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32
const DEFAULT_TERM_NAME = 'xterm-256color'
const READY_TIMEOUT_MS = 250
const BACKGROUND_COMMAND_START_GRACE_MS = 1500
const BACKGROUND_COMMAND_OUTPUT_LIMIT = 24000
const BACKGROUND_COMMAND_STOP_GRACE_MS = 1500
const require = createRequire(import.meta.url)

export const shouldUseZellijTerminalBackend = (
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const explicit = env.WEMUX_TERMINAL_BACKEND?.trim().toLowerCase()
  if (explicit === 'native' || explicit === 'regular' || explicit === 'pty') {
    return false
  }
  // Windows uses the plain PTY backend. That was already the real outcome there —
  // the Zellij attempt failed and fell back — so this only skips the wasted
  // download round trips and the error banner on every terminal open.
  if (platform === 'win32') {
    return false
  }
  if (explicit === 'zellij') {
    return true
  }
  return platform === 'linux' || platform === 'darwin'
}

const sanitizeZellijSessionName = (value: string) => value
  .replace(/[^A-Za-z0-9_.:-]+/g, '-')
  .replace(/^-+|-+$/g, '')

const MAX_READABLE_ZELLIJ_SESSION_NAME_LENGTH = 48

export const buildZellijSessionName = (terminalKey: string | undefined, cwd: string) => {
  const source = terminalKey?.trim() || cwd
  const readableName = sanitizeZellijSessionName(source) || 'terminal'
  if (readableName.length <= MAX_READABLE_ZELLIJ_SESSION_NAME_LENGTH) {
    return `wemux-${readableName}`
  }

  return `wemux-${createHash('sha256').update(source).digest('hex').slice(0, 32)}`
}

// Unix domain socket paths are capped at ~104 bytes (sun_path) on macOS and 108 on
// Linux. Zellij binds "$ZELLIJ_SOCKET_DIR/<version>/<session_name>", so anchoring the
// socket dir under the (deep) worker node dir can silently blow the limit. Keep it
// short and stable instead, and scope it per-uid so workers cannot collide in /tmp.
const MAX_UNIX_SOCKET_PATH_LENGTH = 104

// Budget left for the socket dir once the longest possible session name and a
// "/<version>/" segment are accounted for: "vibemux-" + 48 readable chars is the
// worst case from buildZellijSessionName, plus two separators and a semver.
const MAX_ZELLIJ_SOCKET_DIR_LENGTH = MAX_UNIX_SOCKET_PATH_LENGTH
  - 1 - 'vibemux-'.length - MAX_READABLE_ZELLIJ_SESSION_NAME_LENGTH
  - 1 - '10.10.10'.length

// Deliberately "/tmp" and not os.tmpdir(): on macOS the latter is the long
// per-user "/var/folders/<...>/T" path (~49 bytes), which alone would eat half of
// the sun_path budget this constant exists to protect.
const SHORT_UNIX_TMP_DIR = '/tmp'

export const resolveZellijSocketDir = (
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
  env: NodeJS.ProcessEnv = process.env,
  dirExists: (target: string) => boolean = existsSync,
) => {
  if (platform === 'win32') {
    return ''
  }

  // Prefer XDG_RUNTIME_DIR where it exists (Linux, incl. containers): it is short,
  // already user-owned and 0700, so it sidesteps the /tmp squatting window
  // entirely. macOS has no equivalent short private dir — os.tmpdir() is private
  // but far too long for sun_path — so it falls through to /tmp, where
  // ensureZellijSocketDir does the validation.
  // Require the dir to already exist: a stale XDG_RUNTIME_DIR (set but missing, as
  // in some containers) would otherwise fail mkdir under root-owned /run/user and
  // cost us zellij entirely, when /tmp would have worked.
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim()
  if (runtimeDir && path.isAbsolute(runtimeDir) && dirExists(runtimeDir)) {
    const candidate = path.join(runtimeDir, 'vibemux-zellij')
    if (Buffer.byteLength(candidate, 'utf8') <= MAX_ZELLIJ_SOCKET_DIR_LENGTH) {
      return candidate
    }
  }

  return path.join(SHORT_UNIX_TMP_DIR, `wemux-zellij-${uid}`)
}

export const buildZellijSocketPath = (params: {
  socketDir: string
  version: string
  sessionName: string
}) => path.join(params.socketDir, params.version.replace(/^v/, ''), params.sessionName)

export const isZellijSocketPathWithinLimit = (socketPath: string) => (
  Buffer.byteLength(socketPath, 'utf8') <= MAX_UNIX_SOCKET_PATH_LENGTH
)

/**
 * /tmp is world-writable with a sticky bit, so the socket dir must be validated
 * rather than blindly created: a pre-planted symlink at our path would otherwise
 * survive `mkdirSync(..., { recursive: true })` and have `chmodSync` follow it,
 * letting someone else host (and read) our terminal sockets. Verify the entry is a
 * real directory we own with no access for anyone else, and refuse it otherwise.
 */
export const ensureZellijSocketDir = (
  socketDir: string,
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
) => {
  try {
    mkdirSync(socketDir, { recursive: true, mode: 0o700 })
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code !== 'EEXIST') {
      throw error
    }
  }

  // lstat, not stat: stat would resolve a hostile symlink and report the target.
  const stats = lstatSync(socketDir)
  if (stats.isSymbolicLink()) {
    throw new Error(`Zellij socket dir must not be a symlink: ${socketDir}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Zellij socket dir is not a directory: ${socketDir}`)
  }
  if (typeof process.getuid === 'function' && stats.uid !== uid) {
    throw new Error(`Zellij socket dir is owned by uid ${stats.uid}, expected ${uid}: ${socketDir}`)
  }

  // Unconditional: mkdirSync's mode is subject to umask, so the created dir is not
  // reliably 0700 (and an inherited dir may be looser). Cheap and idempotent.
  chmodSync(socketDir, 0o700)
}

const shellSingleQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

// POSIX-only by construction: the Zellij backend never engages on win32.
export const buildZellijAttachShellCommand = (params: {
  cwd: string
  sessionName: string
  zellijPath: string
}) => {
  return `cd ${shellSingleQuote(params.cwd)} && exec ${shellSingleQuote(params.zellijPath)} attach --create ${shellSingleQuote(params.sessionName)}`
}

const compactProcessEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

export const createZellijTerminalEnv = (params: {
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  shell: string
  socketDir?: string
  sourceEnv?: NodeJS.ProcessEnv
  zellijPath: string
}): NodeJS.ProcessEnv => {
  const env = mergeRuntimeEnvironmentIntoProcessEnv({
    ...createTerminalCommandEnv(params.sourceEnv),
    PATH: `${dirname(params.zellijPath)}${path.delimiter}${getProcessPathValue(params.sourceEnv ?? process.env)}`,
    SHELL: params.shell,
    TERM: params.sourceEnv?.TERM || process.env.TERM || DEFAULT_TERM_NAME,
  }, params.runtimeEnvironment)
  if (params.socketDir) {
    env.ZELLIJ_SOCKET_DIR = params.socketDir
  }
  return env
}

type BackgroundTerminalCommandRecord = {
  pid: number
  child: ChildProcess
  command: string
  cwd: string
  startedAt: string
}

const PYTHON_PTY_BRIDGE = String.raw`
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import threading

shell = os.environ.get('DEVKANBAN_SHELL') or '/bin/sh'
cwd = os.environ.get('DEVKANBAN_CWD') or os.getcwd()
cols = max(1, int(os.environ.get('DEVKANBAN_COLS') or '120'))
rows = max(1, int(os.environ.get('DEVKANBAN_ROWS') or '32'))
term_name = os.environ.get('DEVKANBAN_TERM_NAME') or 'xterm-256color'

def set_winsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

pid, master_fd = pty.fork()

if pid == 0:
    try:
        os.chdir(cwd)
    except OSError as error:
        sys.stderr.write(f'[python-pty] chdir failed: {error}\n')
        sys.stderr.flush()
        os._exit(1)

    os.environ['TERM'] = term_name

    try:
        shell_args = [] if os.name == 'nt' else ['-i', '-l']
        os.execvpe(shell, [shell] + shell_args, os.environ)
    except OSError as error:
        sys.stderr.write(f'[python-pty] exec failed: {error}\n')
        sys.stderr.flush()
        os._exit(1)

set_winsize(master_fd, cols, rows)
closed = False

def terminate_child():
    global closed
    if closed:
        return

    closed = True

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return

def handle_control_message(message):
    msg_type = message.get('type')

    if msg_type == 'input':
        data = base64.b64decode(message.get('data') or '')
        if data:
            os.write(master_fd, data)
        return

    if msg_type == 'resize':
        next_cols = max(1, int(message.get('cols') or cols))
        next_rows = max(1, int(message.get('rows') or rows))
        set_winsize(master_fd, next_cols, next_rows)
        try:
            os.kill(pid, signal.SIGWINCH)
        except ProcessLookupError:
            pass
        return

    if msg_type == 'close':
        terminate_child()

def control_loop():
    try:
        for line in sys.stdin:
            text = line.strip()
            if not text:
                continue

            try:
                handle_control_message(json.loads(text))
            except Exception as error:
                sys.stderr.write(f'[python-pty] control error: {error}\n')
                sys.stderr.flush()
    finally:
        terminate_child()

threading.Thread(target=control_loop, daemon=True).start()

exit_code = 0

while True:
    try:
        readable, _, _ = select.select([master_fd], [], [], 0.2)
    except (OSError, ValueError):
        break

    if master_fd in readable:
        try:
            chunk = os.read(master_fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise

        if not chunk:
            break

        os.write(sys.stdout.fileno(), chunk)
        sys.stdout.flush()

    try:
        result = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        break

    if result != (0, 0):
        status = result[1]

        if os.WIFEXITED(status):
            exit_code = os.WEXITSTATUS(status)
        elif os.WIFSIGNALED(status):
            exit_code = 128 + os.WTERMSIG(status)

        break

try:
    os.close(master_fd)
except OSError:
    pass

sys.exit(exit_code)
`

let cachedPythonCommand: string | null | undefined
let cachedNodePtyModule: NodePtyModule | null | undefined
const backgroundTerminalCommands = new Map<number, BackgroundTerminalCommandRecord>()

export const ensureNodePtySpawnHelperExecutable = (options: {
  arch?: string
  moduleEntryPath?: string
  platform?: NodeJS.Platform
} = {}) => {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    return false
  }

  try {
    const moduleEntryPath = options.moduleEntryPath ?? require.resolve('node-pty')
    const helperPath = path.join(
      path.resolve(dirname(moduleEntryPath), '..'),
      'prebuilds',
      `darwin-${options.arch ?? process.arch}`,
      'spawn-helper',
    )
    try {
      accessSync(helperPath, constants.X_OK)
    } catch {
      chmodSync(helperPath, 0o755)
      accessSync(helperPath, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

export const buildInteractiveShellArgs = (platform = process.platform) => (
  platform === 'win32' ? [] : ['-i', '-l']
)
export const buildNonInteractiveShellArgs = (command: string, platform = process.platform) => (
  platform === 'win32'
    ? ['/d', '/c', `call ${command}`]
    : ['-c', command]
)

const resolveTerminalCwd = (cwd?: string) => {
  const trimmed = cwd?.trim()
  if (!trimmed) {
    return process.cwd()
  }

  if (trimmed === '~') {
    return os.homedir()
  }

  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }

  return trimmed
}

const isExecutableFile = (filePath?: string | null) => {
  if (!filePath?.trim()) {
    return false
  }

  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const flushDecoder = (decoder: StringDecoder) => {
  const tail = decoder.end()
  return tail.length > 0 ? tail : ''
}

const createBackgroundCommandCapture = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'vibemux-terminal-command-'))
  const outputPath = path.join(directory, 'output.log')
  return {
    outputPath,
    cleanup: () => {
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch {
        // ignore temp cleanup races
      }
    },
  }
}

const readBackgroundCommandOutput = (outputPath: string) => {
  try {
    const text = readFileSync(outputPath, 'utf8')
    return text.length <= BACKGROUND_COMMAND_OUTPUT_LIMIT
      ? text
      : text.slice(0, BACKGROUND_COMMAND_OUTPUT_LIMIT)
  } catch {
    return ''
  }
}

const waitForChildExit = (child: ChildProcess, timeoutMs: number) => {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      child.off('exit', handleExit)
      resolve()
    }

    const handleExit = () => {
      finish()
    }

    const timer = setTimeout(() => {
      finish()
    }, Math.max(0, timeoutMs))

    child.once('exit', handleExit)
  })
}

const killWindowsProcessTree = (pid: number, _signal: NodeJS.Signals) => {
  const args = ['/pid', String(pid), '/t', '/f']
  const result = spawnSync('taskkill', args, { stdio: 'ignore' })
  return result.status === 0
}

const sendSignalToBackgroundProcess = (pid: number, signal: NodeJS.Signals) => {
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, signal)
    } else {
      return killWindowsProcessTree(pid, signal)
    }
    return true
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code === 'ESRCH') {
      return false
    }
    throw error
  }
}

const terminateChildProcessTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (!child.pid) {
    child.kill(signal)
    return
  }
  if (process.platform === 'win32') {
    killWindowsProcessTree(child.pid, signal)
    return
  }
  // Deliberately signals only the direct child. Reaping the whole group would need
  // `detached: true` at spawn time, and that regressed the wait path: zsh -c in a
  // new session left the stdio pipes open after exit, so 'close' never fired and
  // even a fast command hung. Grandchildren of a timed-out command can therefore
  // outlive it — a known limitation, not a trade worth a hanging terminal.
  child.kill(signal)
}

const unrefReadableStream = (stream: NodeJS.ReadableStream | null) => {
  const maybeUnref = stream as (NodeJS.ReadableStream & { unref?: () => void }) | null
  maybeUnref?.unref?.()
}

const trackBackgroundTerminalCommand = (record: BackgroundTerminalCommandRecord) => {
  backgroundTerminalCommands.set(record.pid, record)
  record.child.once('exit', () => {
    backgroundTerminalCommands.delete(record.pid)
  })
}

export const terminateAllBackgroundTerminalCommands = async () => {
  const records = Array.from(backgroundTerminalCommands.values())
  if (records.length === 0) {
    return
  }

  for (const record of records) {
    const found = sendSignalToBackgroundProcess(record.pid, 'SIGTERM')
    if (!found) {
      backgroundTerminalCommands.delete(record.pid)
    }
  }

  await Promise.all(records.map((record) => waitForChildExit(record.child, BACKGROUND_COMMAND_STOP_GRACE_MS)))

  const survivors = Array.from(backgroundTerminalCommands.values())
  for (const record of survivors) {
    const found = sendSignalToBackgroundProcess(record.pid, 'SIGKILL')
    if (!found) {
      backgroundTerminalCommands.delete(record.pid)
    }
  }

  await Promise.all(survivors.map((record) => waitForChildExit(record.child, 250)))
}

const createReadyNotifier = (
  onReady: TerminalSessionCallbacks['onReady'],
  mode: TerminalSessionMode,
  backend: TerminalSessionBackend,
  cwd: string,
) => {
  let ready = false
  const timer = setTimeout(() => {
    if (ready) {
      return
    }

    ready = true
    onReady(mode, backend, cwd)
  }, READY_TIMEOUT_MS)

  return {
    markReady: () => {
      if (ready) {
        return
      }

      ready = true
      clearTimeout(timer)
      onReady(mode, backend, cwd)
    },
    dispose: () => {
      clearTimeout(timer)
    },
  }
}

const canSpawnCommand = (command: string) => {
  // Probe the modules the PTY bridge actually needs. `import sys` succeeds on
  // Windows too, which used to make python-pty look available and then die at
  // runtime with an ImportError, handing the user a terminal that exits instantly.
  const result = spawnSync(command, ['-c', 'import fcntl, pty, termios'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

const resolvePythonCommand = () => {
  if (cachedPythonCommand !== undefined) {
    return cachedPythonCommand
  }

  if (process.platform === 'win32') {
    cachedPythonCommand = null
    return cachedPythonCommand
  }

  const absoluteCandidates = ['/usr/bin/python3', '/opt/homebrew/bin/python3']
  for (const candidate of absoluteCandidates) {
    if (isExecutableFile(candidate) && canSpawnCommand(candidate)) {
      cachedPythonCommand = candidate
      return cachedPythonCommand
    }
  }

  const pathCandidates = ['python3', 'python']
  for (const candidate of pathCandidates) {
    if (canSpawnCommand(candidate)) {
      cachedPythonCommand = candidate
      return cachedPythonCommand
    }
  }

  cachedPythonCommand = null
  return cachedPythonCommand
}

const resolveNodePtyModule = () => {
  if (cachedNodePtyModule !== undefined) {
    return cachedNodePtyModule
  }

  try {
    ensureNodePtySpawnHelperExecutable()
    cachedNodePtyModule = require('node-pty') as NodePtyModule
  } catch {
    cachedNodePtyModule = null
  }

  return cachedNodePtyModule
}

export const resolveInteractiveTerminalShell = () => {
  if (process.platform === 'win32') {
    return process.env.ComSpec?.trim() || 'cmd.exe'
  }

  const preferred = process.env.SHELL?.trim()
  if (preferred && isExecutableFile(preferred)) {
    return preferred
  }

  if (process.platform === 'darwin' && isExecutableFile('/bin/zsh')) {
    return '/bin/zsh'
  }

  if (isExecutableFile('/bin/bash')) {
    return '/bin/bash'
  }

  return 'sh'
}

export const resolveNonInteractiveTerminalShell = () => {
  if (process.platform === 'win32') {
    return process.env.ComSpec?.trim() || 'cmd.exe'
  }

  if (process.platform === 'darwin' && isExecutableFile('/bin/zsh')) {
    return '/bin/zsh'
  }

  if (isExecutableFile('/bin/bash')) {
    return '/bin/bash'
  }

  return 'sh'
}

export const resolveTerminalLaunchCwd = (cwd?: string) => {
  return resolveTerminalCwd(cwd)
}

const TERMINAL_ENV_STRIP_PREFIXES = [
  'VITE_',
  'NEXT_PUBLIC_',
  'NUXT_PUBLIC_',
  'PUBLIC_',
] as const

const TERMINAL_ENV_STRIP_KEYS = new Set([
  'APP_URL',
  'APP_BASE_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'PORT',
  'WEMUX_PUBLIC_BASE_URL',
])

export const createTerminalCommandEnv = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const nextEnv: NodeJS.ProcessEnv = {}
  const sourcePath = getProcessPathValue(source)

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'undefined') {
      continue
    }

    if (TERMINAL_ENV_STRIP_KEYS.has(key)) {
      continue
    }

    if (TERMINAL_ENV_STRIP_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue
    }

    nextEnv[key] = value
  }

  if (sourcePath && !getProcessPathValue(nextEnv)) {
    setProcessPathValue(nextEnv, sourcePath)
  }

  return nextEnv
}

export const runTerminalCommand = (
  command: string,
  cwd?: string,
  options?: {
    mode?: ExecutorTerminalRequestMode
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    timeoutMs?: number
  },
): Promise<ExecutorTerminalResult> => {
  return new Promise((resolve) => {
    const shell = resolveNonInteractiveTerminalShell()
    const requestedCwd = resolveTerminalCwd(cwd)
    const resolvedCwd = resolveTerminalLaunchCwd(requestedCwd)
    const mode = options?.mode ?? 'wait'
    try {
      materializeRuntimeEnvironment(resolvedCwd, options?.runtimeEnvironment)
    } catch (error) {
      resolve({
        command,
        cwd: resolvedCwd,
        stdout: '',
        stderr: error instanceof Error ? `环境变量文件写入失败：${error.message}` : '环境变量文件写入失败。',
        exitCode: 1,
        mode,
        detached: false,
        at: new Date().toISOString(),
      })
      return
    }

    const terminalEnv = mergeRuntimeEnvironmentIntoProcessEnv(createTerminalCommandEnv(), options?.runtimeEnvironment)
    if (mode === 'background') {
      try {
        const capture = createBackgroundCommandCapture()
        const usePipedBackgroundOutput = process.platform === 'win32'
        const backgroundCommand = usePipedBackgroundOutput
          ? command
          : `exec >"$WEMUX_BACKGROUND_OUTPUT_PATH" 2>&1\n${command}`
        let pipedBackgroundOutput = ''
        const child = spawn(shell, buildNonInteractiveShellArgs(backgroundCommand), {
          cwd: resolvedCwd,
          env: {
            ...terminalEnv,
            WEMUX_BACKGROUND_OUTPUT_PATH: capture.outputPath,
          },
          detached: process.platform !== 'win32',
          stdio: usePipedBackgroundOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
        })
        if (usePipedBackgroundOutput) {
          child.stdout?.on('data', (chunk) => {
            pipedBackgroundOutput += String(chunk)
          })
          child.stderr?.on('data', (chunk) => {
            pipedBackgroundOutput += String(chunk)
          })
        }
        const pid = child.pid
        if (!pid) {
          capture.cleanup()
          resolve({
            command,
            cwd: resolvedCwd,
            stdout: '',
            stderr: '后台环境命令启动失败：未获取到子进程 pid。',
            exitCode: 1,
            mode,
            detached: false,
            at: new Date().toISOString(),
          })
          return
        }

        let settled = false

        const cleanup = () => {
          child.off('error', handleError)
          child.off('exit', handleExit)
        }

        const resolveStarted = () => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(startTimer)
          cleanup()
          child.unref()
          unrefReadableStream(child.stdout)
          unrefReadableStream(child.stderr)
          trackBackgroundTerminalCommand({
            pid,
            child,
            command,
            cwd: resolvedCwd,
            startedAt: new Date().toISOString(),
          })
          capture.cleanup()
          resolve({
            command,
            cwd: resolvedCwd,
            stdout: '',
            stderr: '',
            exitCode: 0,
            mode,
            detached: true,
            pid,
            at: new Date().toISOString(),
          })
        }

        const resolveExited = (exitCode: number) => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(startTimer)
          cleanup()
          const output = usePipedBackgroundOutput ? pipedBackgroundOutput : readBackgroundCommandOutput(capture.outputPath)
          capture.cleanup()
          resolve({
            command,
            cwd: resolvedCwd,
            stdout: '',
            stderr: output,
            exitCode,
            mode,
            detached: false,
            pid,
            at: new Date().toISOString(),
          })
        }

        const handleError = (error: Error) => {
          const output = usePipedBackgroundOutput ? pipedBackgroundOutput : readBackgroundCommandOutput(capture.outputPath)
          capture.cleanup()
          if (settled) {
            return
          }

          settled = true
          clearTimeout(startTimer)
          cleanup()
          resolve({
            command,
            cwd: resolvedCwd,
            stdout: '',
            stderr: output || error.message,
            exitCode: 1,
            mode,
            detached: false,
            pid,
            at: new Date().toISOString(),
          })
        }

        const handleExit = (code: number | null) => {
          resolveExited(code ?? 0)
        }

        const startTimer = setTimeout(() => {
          resolveStarted()
        }, BACKGROUND_COMMAND_START_GRACE_MS)

        child.on('error', handleError)
        child.on('exit', handleExit)
        return
      } catch (error) {
        resolve({
          command,
          cwd: resolvedCwd,
          stdout: '',
          stderr: error instanceof Error ? error.message : '后台环境命令启动失败。',
          exitCode: 1,
          mode,
          detached: false,
          at: new Date().toISOString(),
        })
        return
      }
    }

    const timeoutMs = Math.max(0, options?.timeoutMs ?? 0)
    const child = spawn(shell, buildNonInteractiveShellArgs(command), {
      cwd: resolvedCwd,
      env: terminalEnv,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let drainTimer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      if (killTimer) {
        clearTimeout(killTimer)
      }
      if (drainTimer) {
        clearTimeout(drainTimer)
      }
      child.off('close', handleClose)
      child.off('error', handleError)
    }
    const resolveOnce = (result: ExecutorTerminalResult) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(result)
    }
    const resolveTimedOut = () => {
      resolveOnce({
        command,
        cwd: resolvedCwd,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}远程终端命令执行超时。`,
        exitCode: 124,
        mode,
        at: new Date().toISOString(),
      })
    }
    const terminateTimedOutCommand = () => {
      if (settled) {
        return
      }

      // Don't resolve yet: output already written by the command may still be
      // sitting in the pipe, and discarding it hides whatever the command printed
      // before it hung. Signal, then let 'close' resolve once stdio has drained.
      timedOut = true
      terminateChildProcessTree(child, 'SIGTERM')
      killTimer = setTimeout(() => {
        terminateChildProcessTree(child, 'SIGKILL')
      }, 500)
      // Safety net: if 'close' never arrives (stdio held open by a stray
      // grandchild), still answer the caller rather than hanging forever.
      drainTimer = setTimeout(resolveTimedOut, 800)
    }
    const timeoutTimer = timeoutMs > 0
      ? setTimeout(terminateTimedOutCommand, timeoutMs)
      : null
    const handleClose = (code: number | null) => {
      if (timedOut) {
        resolveTimedOut()
        return
      }

      resolveOnce({
        command,
        cwd: resolvedCwd,
        stdout,
        stderr,
        exitCode: code ?? 0,
        mode,
        at: new Date().toISOString(),
      })
    }
    const handleError = (error: Error) => {
      resolveOnce({
        command,
        cwd: resolvedCwd,
        stdout,
        stderr: `${stderr}${error.message}`,
        exitCode: 1,
        mode,
        at: new Date().toISOString(),
      })
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', handleClose)
    child.on('error', handleError)
  })
}

const createNodePtySession = (params: OpenTerminalSessionParams): TerminalSession => {
  const { cols = DEFAULT_COLS, cwd, onExit, onLog, onOutput, onReady, rows = DEFAULT_ROWS, shell = resolveInteractiveTerminalShell() } = params
  const resolvedCwd = resolveTerminalLaunchCwd(cwd)
  const pty = resolveNodePtyModule()
  const terminalEnv = mergeRuntimeEnvironmentIntoProcessEnv(createTerminalCommandEnv(), params.runtimeEnvironment)
  if (!pty) {
    throw new Error('node-pty 不可用，无法启动原生 PTY。')
  }

  const child = pty.spawn(shell, buildInteractiveShellArgs(), {
    cwd: resolvedCwd,
    env: terminalEnv,
    cols,
    rows,
    name: DEFAULT_TERM_NAME,
  })
  const readyNotifier = createReadyNotifier(onReady, 'pty', 'node-pty', resolvedCwd)

  child.onData((chunk) => {
    readyNotifier.markReady()
    onLog('pty output', {
      backend: 'node-pty',
      chunkLength: chunk.length,
      preview: chunk.slice(0, 120),
    })
    onOutput('stdout', chunk)
  })

  child.onExit(({ exitCode }) => {
    readyNotifier.dispose()
    onLog('pty exit', {
      backend: 'node-pty',
      exitCode,
    })
    onExit(exitCode ?? 0)
  })

  return {
    backend: 'node-pty',
    mode: 'pty',
    write: (input) => child.write(input),
    resize: (nextCols, nextRows) => child.resize(Math.max(1, nextCols), Math.max(1, nextRows)),
    kill: () => child.kill('SIGTERM'),
  }
}

const createPythonPtySession = (params: OpenTerminalSessionParams): TerminalSession => {
  const { cols = DEFAULT_COLS, cwd, onExit, onLog, onOutput, onReady, rows = DEFAULT_ROWS, shell = resolveInteractiveTerminalShell() } = params
  const resolvedCwd = resolveTerminalLaunchCwd(cwd)
  const pythonCommand = resolvePythonCommand()
  const terminalEnv = mergeRuntimeEnvironmentIntoProcessEnv(createTerminalCommandEnv(), params.runtimeEnvironment)
  if (!pythonCommand) {
    throw new Error('python3 不可用，无法启动 PTY fallback。')
  }

  const child = spawn(pythonCommand, ['-u', '-c', PYTHON_PTY_BRIDGE], {
    cwd: resolvedCwd,
    env: {
      ...terminalEnv,
      DEVKANBAN_COLS: String(Math.max(1, cols)),
      DEVKANBAN_CWD: resolvedCwd,
      DEVKANBAN_ROWS: String(Math.max(1, rows)),
      DEVKANBAN_SHELL: shell,
      DEVKANBAN_TERM_NAME: DEFAULT_TERM_NAME,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const control = child.stdin
  if (!control) {
    child.kill('SIGTERM')
    throw new Error('python PTY control pipe 不可用。')
  }

  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  const readyNotifier = createReadyNotifier(onReady, 'pty', 'python-pty', resolvedCwd)

  const forwardChunk = (stream: TerminalOutputStream, text: string) => {
    if (text.length === 0) {
      return
    }

    if (stream === 'stdout') {
      readyNotifier.markReady()
    }

    onLog('pty output', {
      backend: 'python-pty',
      chunkLength: text.length,
      preview: text.slice(0, 120),
      stream,
    })
    onOutput(stream, text)
  }

  child.stdout.on('data', (chunk) => {
    forwardChunk('stdout', stdoutDecoder.write(chunk))
  })

  child.stderr.on('data', (chunk) => {
    forwardChunk('system', stderrDecoder.write(chunk))
  })

  child.on('error', (error) => {
    onLog('python pty error', { message: error.message })
    onOutput('system', `\r\n[python-pty error] ${error.message}\r\n`)
  })

  child.on('close', (code) => {
    readyNotifier.dispose()
    forwardChunk('stdout', flushDecoder(stdoutDecoder))
    forwardChunk('system', flushDecoder(stderrDecoder))
    onLog('pty exit', {
      backend: 'python-pty',
      exitCode: code ?? 0,
    })
    onExit(code ?? 0)
  })

  const sendControlMessage = (message: Record<string, number | string>) => {
    if (control.destroyed) {
      return
    }

    control.write(`${JSON.stringify(message)}\n`)
  }

  return {
    backend: 'python-pty',
    mode: 'pty',
    write: (input) => {
      sendControlMessage({
        type: 'input',
        data: Buffer.from(input, 'utf8').toString('base64'),
      })
    },
    resize: (nextCols, nextRows) => {
      sendControlMessage({
        type: 'resize',
        cols: Math.max(1, nextCols),
        rows: Math.max(1, nextRows),
      })
    },
    kill: () => {
      sendControlMessage({ type: 'close' })
      control.end()
      child.kill('SIGTERM')
    },
  }
}

const createCompatPipeSession = (params: OpenTerminalSessionParams): TerminalSession => {
  const { cwd, onExit, onLog, onOutput, onReady } = params
  const resolvedCwd = resolveTerminalLaunchCwd(cwd)
  const shell = resolveInteractiveTerminalShell()
  const terminalEnv = mergeRuntimeEnvironmentIntoProcessEnv(createTerminalCommandEnv(), params.runtimeEnvironment)
  const child = spawn(shell, process.platform === 'win32' ? [] : ['-il'], {
    cwd: resolvedCwd,
    env: {
      ...terminalEnv,
      BASH_SILENCE_DEPRECATION_WARNING: '1',
      TERM: process.env.TERM || DEFAULT_TERM_NAME,
    },
    stdio: 'pipe',
  })

  child.stdin.setDefaultEncoding('utf8')
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const readyNotifier = createReadyNotifier(onReady, 'pipe', 'pipe', resolvedCwd)

  child.stdout.on('data', (text: string) => {
    readyNotifier.markReady()
    onLog('fallback shell stdout', {
      backend: 'pipe',
      chunkLength: text.length,
      preview: text.slice(0, 120),
    })
    onOutput('stdout', text)
  })

  child.stderr.on('data', (text: string) => {
    readyNotifier.markReady()
    onLog('fallback shell stderr', {
      backend: 'pipe',
      chunkLength: text.length,
      preview: text.slice(0, 120),
    })
    onOutput('stderr', text)
  })

  child.on('error', (error) => {
    onLog('fallback shell error', { message: error.message })
    onOutput('system', `\r\n[fallback shell error] ${error.message}\r\n`)
  })

  child.on('close', (code) => {
    readyNotifier.dispose()
    onLog('fallback shell exit', {
      backend: 'pipe',
      exitCode: code ?? 0,
    })
    onExit(code ?? 0)
  })
  if (process.platform !== 'win32') {
    child.stdin.write('export PS1="$ "\n')
  }

  return {
    backend: 'pipe',
    mode: 'pipe',
    write: (input) => {
      if (child.stdin.destroyed) {
        return
      }

      child.stdin.write(input.replace(/\r/g, '\n'))
    },
    resize: () => {
      // no-op for compatibility shell
    },
    kill: () => child.kill('SIGTERM'),
  }
}

const openRegularTerminalSession = (params: OpenTerminalSessionParams): TerminalSession => {
  const { cwd, onLog } = params
  const resolvedCwd = resolveTerminalLaunchCwd(cwd)
  const shell = params.shell ?? resolveInteractiveTerminalShell()

  try {
    return createNodePtySession({ ...params, cwd: resolvedCwd, shell })
  } catch (error) {
    onLog('node-pty spawn failed, falling back to python pty', {
      cwd: resolvedCwd,
      shell,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }

  try {
    return createPythonPtySession({ ...params, cwd: resolvedCwd, shell })
  } catch (error) {
    onLog('python pty spawn failed, falling back to pipe shell', {
      cwd: resolvedCwd,
      shell,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }

  return createCompatPipeSession({ ...params, cwd: resolvedCwd })
}

const createZellijSession = (params: OpenTerminalSessionParams): TerminalSession => {
  const { cwd, onExit, onLog, onOutput, onReady, shell = resolveInteractiveTerminalShell() } = params
  const resolvedCwd = resolveTerminalLaunchCwd(cwd)
  const sessionName = buildZellijSessionName(params.terminalKey, resolvedCwd)
  const zellijSocketDir = resolveZellijSocketDir()
  const pendingInput: string[] = []
  let zellijPath = ''
  let ptySession: TerminalSession | null = null
  let closed = false
  let detached = false
  let persistent = true

  const killZellijSession = (binaryPath: string) => {
    const killer = spawn(binaryPath, ['kill-session', sessionName], {
      cwd: resolvedCwd,
      env: {
        ...createTerminalCommandEnv(),
        ...(zellijSocketDir ? { ZELLIJ_SOCKET_DIR: zellijSocketDir } : {}),
      },
      stdio: 'ignore',
    })
    killer.on('error', (error) => {
      onLog('zellij kill-session failed', { sessionName, error: error.message })
    })
    killer.unref()
  }

  const flushPendingInput = () => {
    if (!ptySession || pendingInput.length === 0) {
      return
    }
    const input = pendingInput.splice(0).join('')
    if (input) {
      ptySession.write(input)
    }
  }

  // zellij 是节点级 tool：二进制缓存固定落机器级 workerHome（AGENTS.md node/ = 节点级），
  // 不随 workspaceRoot（云节点沙箱 workspaceRoot 在 R2 挂载上时也不落 R2）；
  // zellij socket 已在 /tmp，会话文件不落 R2。
  void ensureZellijBinary({ workspaceRoot: getWorkerHome() }).then((binary) => {
    zellijPath = binary.binaryPath
    if (closed) {
      killZellijSession(zellijPath)
      return
    }
    if (detached) {
      return
    }
    onLog('opening zellij terminal session', {
      sessionName,
      zellijPath,
      cwd: resolvedCwd,
      target: binary.target,
      version: binary.version,
    })
    if (zellijSocketDir) {
      const socketPath = buildZellijSocketPath({
        socketDir: zellijSocketDir,
        version: binary.version,
        sessionName,
      })
      if (!isZellijSocketPathWithinLimit(socketPath)) {
        throw new Error(
          `Zellij socket path exceeds the ${MAX_UNIX_SOCKET_PATH_LENGTH}-byte unix socket limit: ${socketPath}`,
        )
      }
      ensureZellijSocketDir(zellijSocketDir)
    }
    params.onPersistentReady?.()

    const zellijEnv = createZellijTerminalEnv({
      runtimeEnvironment: params.runtimeEnvironment,
      shell,
      socketDir: zellijSocketDir,
      zellijPath,
    })
    const zellijCommand = buildZellijAttachShellCommand({
      cwd: resolvedCwd,
      sessionName,
      zellijPath,
    })
    const callbacks: TerminalSessionCallbacks = {
      onExit: (exitCode) => {
        if (detached) {
          onLog('zellij pty detached', { sessionName, exitCode })
          return
        }
        onExit(exitCode)
      },
      onLog: (message, payload) => onLog(message, { ...payload, zellijSessionName: sessionName }),
      onOutput,
      onReady: (_mode, _backend, readyCwd) => {
        onReady('pty', 'zellij', readyCwd)
      },
    }
    const zellijShell = '/bin/sh'
    const zellijShellArgs = buildNonInteractiveShellArgs(zellijCommand)
    const openParams: OpenTerminalSessionParams = {
      ...params,
      cwd: resolvedCwd,
      shell: zellijShell,
      runtimeEnvironment: {
        mode: 'process-env',
        variables: compactProcessEnv(zellijEnv),
      },
      ...callbacks,
    }

    try {
      const pty = resolveNodePtyModule()
      if (!pty) {
        throw new Error('node-pty unavailable for zellij attach')
      }
      const child = pty.spawn(zellijShell, zellijShellArgs, {
        cwd: resolvedCwd,
        env: zellijEnv,
        cols: params.cols ?? DEFAULT_COLS,
        rows: params.rows ?? DEFAULT_ROWS,
        name: DEFAULT_TERM_NAME,
      })
      const readyNotifier = createReadyNotifier(callbacks.onReady, 'pty', 'zellij', resolvedCwd)
      child.onData((chunk) => {
        readyNotifier.markReady()
        onOutput('stdout', chunk)
      })
      child.onExit(({ exitCode }) => {
        readyNotifier.dispose()
        callbacks.onExit(exitCode ?? 0)
      })
      ptySession = {
        backend: 'zellij',
        mode: 'pty',
        isPersistent: () => persistent,
        write: (input) => child.write(input),
        resize: (nextCols, nextRows) => child.resize(Math.max(1, nextCols), Math.max(1, nextRows)),
        detach: () => child.kill('SIGTERM'),
        kill: () => child.kill('SIGTERM'),
      }
    } catch (nodePtyError) {
      onLog('zellij node-pty attach failed, falling back to python pty', {
        sessionName,
        error: nodePtyError instanceof Error ? nodePtyError.message : String(nodePtyError),
      })
      ptySession = createPythonPtySession({
        ...openParams,
        shell: zellijShell,
      })
      ptySession.write(zellijCommand)
      ptySession.write('\n')
    }
    flushPendingInput()
  }).catch((error) => {
    onLog('zellij prepare failed', {
      sessionName,
      error: error instanceof Error ? error.message : String(error),
    })
    if (closed || detached) {
      return
    }
    // An unsupported platform/arch is a permanent, benign condition — the regular
    // PTY fallback is the correct end state, so don't stamp an error into every
    // terminal the user opens. Anything else is actionable and worth surfacing.
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('does not support')) {
      onOutput('system', `\r\n[zellij unavailable, using regular PTY] ${message}\r\n`)
    }
    persistent = false
    ptySession = openRegularTerminalSession({ ...params, cwd: resolvedCwd, shell })
    flushPendingInput()
  })

  return {
    backend: 'zellij',
    mode: 'pty',
    isPersistent: () => persistent,
    write: (input) => {
      if (closed || detached) {
        return
      }
      if (ptySession) {
        ptySession.write(input)
        return
      }
      pendingInput.push(input)
    },
    resize: (cols, rows) => {
      ptySession?.resize(cols, rows)
    },
    detach: () => {
      detached = true
      ptySession?.detach?.()
    },
    kill: () => {
      closed = true
      ptySession?.kill()
      if (zellijPath) {
        killZellijSession(zellijPath)
      }
    },
  }
}

export const openTerminalSession = (params: OpenTerminalSessionParams): TerminalSession => {
  const { cwd, onLog } = params
  const requestedCwd = resolveTerminalCwd(cwd)
  const resolvedCwd = resolveTerminalLaunchCwd(requestedCwd)
  const shell = params.shell ?? resolveInteractiveTerminalShell()

  onLog('opening pty session', {
    requestedCwd,
    cwd: resolvedCwd,
    shell,
  })

  try {
    materializeRuntimeEnvironment(resolvedCwd, params.runtimeEnvironment)
  } catch (error) {
    onLog('runtime env file materialization failed', {
      cwd: resolvedCwd,
      error: error instanceof Error ? error.message : 'unknown',
    })
    throw error
  }

  if (shouldUseZellijTerminalBackend()) {
    return createZellijSession({ ...params, cwd: resolvedCwd, shell })
  }

  return openRegularTerminalSession({ ...params, cwd: resolvedCwd, shell })
}

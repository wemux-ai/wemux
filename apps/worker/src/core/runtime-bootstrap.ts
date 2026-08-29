// [INPUT]: 运行时目标（base/all/RuntimeId）
// [OUTPUT]: 就绪检测（prompt/auto/block）
// [POS]: 运行时 bootstrap
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import type { RuntimeId } from '@shared/agent-type'
import { inspectAgentCliRequirement, getAgentCliInstallStrategy } from './agent-cli-bootstrap'
import { getWorkerAppRoot } from './app-root'
import { getCommandDetail, hasCommand, resolveExecutable, runCommand, runPrivilegedCommand } from './command-utils'
import { resolveOpencodeExecutable } from './opencode-runtime'
import type { InstallAttempt, InstallExecutionOptions, InstallStrategy, RuntimeCheck, RuntimeRequirementId } from './runtime-bootstrap-types'

type RuntimeBootstrapPlan = {
  ok: boolean
  target: WorkerRuntimeTarget
  items: RuntimeCheck[]
  missingItems: RuntimeCheck[]
  message: string
}

export type WorkerRuntimeTarget = 'base' | 'all' | RuntimeId

export type WorkerRuntimeBootstrapReport = {
  ok: boolean
  changed: boolean
  target: WorkerRuntimeTarget
  items: RuntimeCheck[]
  attempts?: InstallAttempt[]
  message: string
}

export type WorkerRuntimeInteractiveStatus = 'ready' | 'declined' | 'failed' | 'non_interactive_blocked'

export type WorkerRuntimeInteractiveResult = {
  status: WorkerRuntimeInteractiveStatus
  report: WorkerRuntimeBootstrapReport
  message: string
}

export type WorkerRuntimeBootstrapMode = 'prompt' | 'auto' | 'block'

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const workspaceRoot = getWorkerAppRoot()

const prependPathEntry = (entry: string) => {
  const currentPath = process.env.PATH ?? ''
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  if (parts.includes(entry)) {
    return
  }

  process.env.PATH = currentPath ? `${entry}${path.delimiter}${currentPath}` : entry
}

const ensureWindowsGitOnPath = () => {
  if (process.platform !== 'win32') {
    return null
  }

  const roots = [process.env['ProgramFiles'], process.env['ProgramW6432'], process.env['LocalAppData']].filter(
    (value): value is string => Boolean(value),
  )
  const candidates = [
    ['Git', 'cmd', 'git.exe'],
    ['Git', 'bin', 'git.exe'],
    ['Programs', 'Git', 'cmd', 'git.exe'],
    ['Programs', 'Git', 'bin', 'git.exe'],
  ]

  for (const root of roots) {
    for (const candidate of candidates) {
      const executablePath = path.join(root, ...candidate)
      if (!existsSync(executablePath)) {
        continue
      }

      prependPathEntry(path.dirname(executablePath))
      return executablePath
    }
  }

  return null
}

const getRequirementLabel = (id: RuntimeRequirementId) => {
  if (id === 'git') return 'Git'
  if (id === 'unzip') return 'unzip'
  if (id === 'opencode') return 'OpenCode runtime'
  if (id === 'pi-runtime') return 'Pi runtime'
  if (id === 'codex-cli') return 'Codex CLI'
  if (id === 'codex-auth') return 'Codex 登录'
  if (id === 'claude-cli') return 'Claude Code CLI'
  return 'Claude Code 登录'
}

const buildAttempt = (
  id: RuntimeRequirementId,
  strategy: Pick<InstallStrategy, 'installer' | 'commandSummary'> | null,
  attempt: Pick<InstallAttempt, 'ok' | 'changed' | 'detail' | 'skipped'>,
): InstallAttempt => {
  return {
    id,
    label: getRequirementLabel(id),
    ok: attempt.ok,
    changed: attempt.changed,
    detail: attempt.detail,
    skipped: attempt.skipped,
    installer: strategy?.installer,
    commandSummary: strategy?.commandSummary,
  }
}

const runGlobalNodeInstall = (
  packageName: string,
  commandSummary: string,
  id: RuntimeRequirementId,
  fallbackDetail: string,
  options?: InstallExecutionOptions,
) => {
  const strategy = { installer: 'npm', commandSummary }
  let result = runCommand('npm', ['install', '-g', packageName], {
    streamOutput: options?.streamOutput,
    timeout: INSTALL_TIMEOUT_MS,
  })

  if (!result.ok && process.platform !== 'win32') {
    result = runPrivilegedCommand('npm', ['install', '-g', packageName], INSTALL_TIMEOUT_MS, options)
  }

  return buildAttempt(id, strategy, {
    ok: result.ok,
    changed: result.ok,
    detail: getCommandDetail(result, fallbackDetail),
  })
}

const buildLinuxPackageInstallStrategy = (params: {
  id: RuntimeRequirementId
  packageName: string
  manualHint: {
    apt: string
    dnf: string
    yum: string
    pacman: string
    apk: string
    fallback: string
  }
  failureLabel: {
    apt: string
    dnf: string
    yum: string
    pacman: string
    apk: string
  }
}) => {
  if (process.platform !== 'linux') {
    return null
  }

  if (hasCommand('apt-get')) {
    const commandSummary = `sudo apt-get update && sudo apt-get install -y ${params.packageName}`
    return {
      installer: 'apt-get',
      commandSummary,
      manualHint: params.manualHint.apt,
      run(options) {
        const strategy = { installer: 'apt-get', commandSummary }
        const update = runPrivilegedCommand('apt-get', ['update'], INSTALL_TIMEOUT_MS, options)
        if (!update.ok) {
          return buildAttempt(params.id, strategy, {
            ok: false,
            changed: false,
            detail: getCommandDetail(update, 'apt-get update 失败'),
          })
        }

        const install = runPrivilegedCommand('apt-get', ['install', '-y', params.packageName], INSTALL_TIMEOUT_MS, options)
        return buildAttempt(params.id, strategy, {
          ok: install.ok,
          changed: install.ok,
          detail: getCommandDetail(install, params.failureLabel.apt),
        })
      },
    } satisfies InstallStrategy
  }

  if (hasCommand('dnf')) {
    const commandSummary = `sudo dnf install -y ${params.packageName}`
    return {
      installer: 'dnf',
      commandSummary,
      manualHint: params.manualHint.dnf,
      run(options) {
        const strategy = { installer: 'dnf', commandSummary }
        const result = runPrivilegedCommand('dnf', ['install', '-y', params.packageName], INSTALL_TIMEOUT_MS, options)
        return buildAttempt(params.id, strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, params.failureLabel.dnf),
        })
      },
    } satisfies InstallStrategy
  }

  if (hasCommand('yum')) {
    const commandSummary = `sudo yum install -y ${params.packageName}`
    return {
      installer: 'yum',
      commandSummary,
      manualHint: params.manualHint.yum,
      run(options) {
        const strategy = { installer: 'yum', commandSummary }
        const result = runPrivilegedCommand('yum', ['install', '-y', params.packageName], INSTALL_TIMEOUT_MS, options)
        return buildAttempt(params.id, strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, params.failureLabel.yum),
        })
      },
    } satisfies InstallStrategy
  }

  if (hasCommand('pacman')) {
    const commandSummary = `sudo pacman -Sy --noconfirm ${params.packageName}`
    return {
      installer: 'pacman',
      commandSummary,
      manualHint: params.manualHint.pacman,
      run(options) {
        const strategy = { installer: 'pacman', commandSummary }
        const result = runPrivilegedCommand('pacman', ['-Sy', '--noconfirm', params.packageName], INSTALL_TIMEOUT_MS, options)
        return buildAttempt(params.id, strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, params.failureLabel.pacman),
        })
      },
    } satisfies InstallStrategy
  }

  if (hasCommand('apk')) {
    const commandSummary = `sudo apk add ${params.packageName}`
    return {
      installer: 'apk',
      commandSummary,
      manualHint: params.manualHint.apk,
      run(options) {
        const strategy = { installer: 'apk', commandSummary }
        const result = runPrivilegedCommand('apk', ['add', params.packageName], INSTALL_TIMEOUT_MS, options)
        return buildAttempt(params.id, strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, params.failureLabel.apk),
        })
      },
    } satisfies InstallStrategy
  }

  return null
}

const resolveGitInstallStrategy = (): InstallStrategy | null => {
  if (process.platform === 'win32') {
    if (hasCommand('winget')) {
      return {
        installer: 'winget',
        commandSummary: 'winget install --id Git.Git --exact --source winget',
        manualHint: '请先安装 Git 并确认它在 PATH 中可执行；Windows 可优先使用 winget 安装。',
        run(options) {
          const strategy = { installer: 'winget', commandSummary: 'winget install --id Git.Git --exact --source winget' }
          const result = runCommand(
            'winget',
            ['install', '--id', 'Git.Git', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'],
            { streamOutput: options?.streamOutput, timeout: INSTALL_TIMEOUT_MS },
          )
          if (result.ok) {
            ensureWindowsGitOnPath()
          }

          return buildAttempt('git', strategy, {
            ok: result.ok,
            changed: result.ok,
            detail: getCommandDetail(result, 'winget install Git.Git 失败'),
          })
        },
      }
    }

    if (hasCommand('choco')) {
      return {
        installer: 'choco',
        commandSummary: 'choco install git -y',
        manualHint: '请先安装 Git 并确认它在 PATH 中可执行；Windows 可使用 choco 安装。',
        run(options) {
          const strategy = { installer: 'choco', commandSummary: 'choco install git -y' }
          const result = runCommand('choco', ['install', 'git', '-y'], {
            streamOutput: options?.streamOutput,
            timeout: INSTALL_TIMEOUT_MS,
          })
          if (result.ok) {
            ensureWindowsGitOnPath()
          }

          return buildAttempt('git', strategy, {
            ok: result.ok,
            changed: result.ok,
            detail: getCommandDetail(result, 'choco install git 失败'),
          })
        },
      }
    }

    return null
  }

  if (process.platform === 'darwin') {
    if (!hasCommand('brew')) {
      return null
    }

    return {
      installer: 'brew',
      commandSummary: 'brew install git',
      manualHint: '请先安装 Git 并确认它在 PATH 中可执行；macOS 可执行 `brew install git`。',
      run(options) {
        const strategy = { installer: 'brew', commandSummary: 'brew install git' }
        const result = runCommand('brew', ['install', 'git'], {
          streamOutput: options?.streamOutput,
          timeout: INSTALL_TIMEOUT_MS,
        })
        return buildAttempt('git', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, 'brew install git 失败'),
        })
      },
    }
  }

  if (process.platform === 'linux') {
    return buildLinuxPackageInstallStrategy({
      id: 'git',
      packageName: 'git',
      manualHint: {
        apt: '请先安装 Git 并确认它在 PATH 中可执行；Debian/Ubuntu 可执行 `sudo apt-get update && sudo apt-get install -y git`。',
        dnf: '请先安装 Git 并确认它在 PATH 中可执行；Fedora 可执行 `sudo dnf install -y git`。',
        yum: '请先安装 Git 并确认它在 PATH 中可执行；CentOS/RHEL 可执行 `sudo yum install -y git`。',
        pacman: '请先安装 Git 并确认它在 PATH 中可执行；Arch 可执行 `sudo pacman -Sy --noconfirm git`。',
        apk: '请先安装 Git 并确认它在 PATH 中可执行；Alpine 可执行 `sudo apk add git`。',
        fallback: '请先安装 Git，并确认它在 PATH 中可执行。',
      },
      failureLabel: {
        apt: 'apt-get install git 失败',
        dnf: 'dnf install git 失败',
        yum: 'yum install git 失败',
        pacman: 'pacman 安装 git 失败',
        apk: 'apk add git 失败',
      },
    })
  }

  return null
}

const resolveUnzipInstallStrategy = (): InstallStrategy | null => {
  return buildLinuxPackageInstallStrategy({
    id: 'unzip',
    packageName: 'unzip',
    manualHint: {
      apt: '请先安装 unzip；Debian/Ubuntu 可执行 `sudo apt-get update && sudo apt-get install -y unzip`。',
      dnf: '请先安装 unzip；Fedora 可执行 `sudo dnf install -y unzip`。',
      yum: '请先安装 unzip；CentOS/RHEL 可执行 `sudo yum install -y unzip`。',
      pacman: '请先安装 unzip；Arch 可执行 `sudo pacman -Sy --noconfirm unzip`。',
      apk: '请先安装 unzip；Alpine 可执行 `sudo apk add unzip`。',
      fallback: '请先安装 unzip，并确认它在 PATH 中可执行。',
    },
    failureLabel: {
      apt: 'apt-get install unzip 失败',
      dnf: 'dnf install unzip 失败',
      yum: 'yum install unzip 失败',
      pacman: 'pacman 安装 unzip 失败',
      apk: 'apk add unzip 失败',
    },
  })
}

const resolveOpencodeInstallStrategy = (): InstallStrategy | null => {
  if (!existsSync(`${workspaceRoot}/package.json`)) {
    return null
  }

  if (existsSync(`${workspaceRoot}/pnpm-lock.yaml`) && hasCommand('pnpm')) {
    return {
      installer: 'pnpm',
      commandSummary: 'pnpm install --frozen-lockfile',
      manualHint: '请在 worker 根目录执行 `pnpm install --frozen-lockfile`，确保 `@opencode-ai/sdk` 与 `opencode-ai` runtime 都已安装。',
      run(options) {
        const strategy = { installer: 'pnpm', commandSummary: 'pnpm install --frozen-lockfile' }
        const result = runCommand('pnpm', ['install', '--frozen-lockfile'], {
          cwd: workspaceRoot,
          streamOutput: options?.streamOutput,
          timeout: INSTALL_TIMEOUT_MS,
        })
        return buildAttempt('opencode', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, 'pnpm install 失败'),
        })
      },
    }
  }

  if (existsSync(`${workspaceRoot}/package-lock.json`) && hasCommand('npm')) {
    return {
      installer: 'npm',
      commandSummary: 'npm ci',
      manualHint: '请在 worker 根目录执行 `npm ci`，确保 `@opencode-ai/sdk` 与 `opencode-ai` runtime 都已安装。',
      run(options) {
        const strategy = { installer: 'npm', commandSummary: 'npm ci' }
        const result = runCommand('npm', ['ci'], {
          cwd: workspaceRoot,
          streamOutput: options?.streamOutput,
          timeout: INSTALL_TIMEOUT_MS,
        })
        return buildAttempt('opencode', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, 'npm ci 失败'),
        })
      },
    }
  }

  if (hasCommand('npm')) {
    return {
      installer: 'npm',
      commandSummary: 'npm install',
      manualHint: '请在 worker 根目录执行 `npm install`，确保 `@opencode-ai/sdk` 与 `opencode-ai` runtime 都已安装。',
      run(options) {
        const strategy = { installer: 'npm', commandSummary: 'npm install' }
        const result = runCommand('npm', ['install'], {
          cwd: workspaceRoot,
          streamOutput: options?.streamOutput,
          timeout: INSTALL_TIMEOUT_MS,
        })
        return buildAttempt('opencode', strategy, {
          ok: result.ok,
          changed: result.ok,
          detail: getCommandDetail(result, 'npm install 失败'),
        })
      },
    }
  }

  return null
}

const getInstallStrategy = (id: RuntimeRequirementId) => {
  if (id === 'git') return resolveGitInstallStrategy()
  if (id === 'unzip') return resolveUnzipInstallStrategy()
  if (id === 'opencode') return resolveOpencodeInstallStrategy()
  return getAgentCliInstallStrategy(id)
}

const checkGit = (): RuntimeCheck => {
  ensureWindowsGitOnPath()
  const result = runCommand('git', ['--version'])
  const strategy = resolveGitInstallStrategy()

  return {
    id: 'git',
    label: 'Git',
    ok: result.ok,
    detail: getCommandDetail(result, 'git 不可用'),
    autoInstallable: Boolean(strategy),
    installer: strategy?.installer,
    installCommand: strategy?.commandSummary,
    hint: strategy?.manualHint || '请先安装 Git，并确认它在 PATH 中可执行。',
  }
}

const checkUnzip = (): RuntimeCheck => {
  const executable = resolveExecutable('unzip')
  const result = executable ? runCommand(executable, ['-v']) : null
  const strategy = resolveUnzipInstallStrategy()

  return {
    id: 'unzip',
    label: 'unzip',
    ok: Boolean(executable && result?.ok),
    detail: executable && result?.ok ? `unzip 已安装：${executable}` : 'unzip 不可用，wemux Mesh 无法自动下载并解压组件。',
    autoInstallable: Boolean(strategy),
    installer: strategy?.installer,
    installCommand: strategy?.commandSummary,
    hint: strategy?.manualHint || '请先安装 unzip，并确认它在 PATH 中可执行。',
  }
}

const checkOpencodeSdk = (): RuntimeCheck => {
  const result = runCommand(
    process.execPath,
    ['-e', 'import("@opencode-ai/sdk").then(() => console.log("ok")).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) })'],
    { cwd: workspaceRoot },
  )
  const strategy = resolveOpencodeInstallStrategy()
  const executable = resolveOpencodeExecutable(workspaceRoot)
  const version = executable ? runCommand(executable, ['--version']) : null
  const detail = !result.ok
    ? getCommandDetail(result, 'OpenCode runtime 依赖不可用')
    : executable && version?.ok
      ? `@opencode-ai/sdk 已安装；${version.stdout || executable}`
      : '未检测到可执行的 OpenCode runtime（`opencode`）。'

  return {
    id: 'opencode',
    label: 'OpenCode runtime',
    ok: result.ok && Boolean(executable && version?.ok),
    detail,
    autoInstallable: Boolean(strategy),
    installer: strategy?.installer,
    installCommand: strategy?.commandSummary,
    hint: strategy?.manualHint || '请检查 worker 依赖安装状态，并确认 `opencode-ai` 已随 worker 依赖一起安装。',
  }
}

const checkPiRuntime = (): RuntimeCheck => {
  const result = runCommand(
    process.execPath,
    ['-e', 'import("@mariozechner/pi-coding-agent").then(() => console.log("ok")).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) })'],
    { cwd: workspaceRoot },
  )

  return {
    id: 'pi-runtime',
    label: 'Pi runtime',
    ok: result.ok,
    detail: result.ok ? '@mariozechner/pi-coding-agent 已安装' : getCommandDetail(result, 'Pi SDK 不可用'),
    autoInstallable: false,
    hint: '请检查 worker 依赖安装状态，并确认 `@mariozechner/pi-coding-agent` 可被当前 Node 运行时加载。',
  }
}

const inspectRequirement = async (id: RuntimeRequirementId): Promise<RuntimeCheck> => {
  if (id === 'git') {
    return checkGit()
  }

  if (id === 'unzip') {
    return checkUnzip()
  }

  if (id === 'opencode') {
    return checkOpencodeSdk()
  }

  if (id === 'pi-runtime') {
    return checkPiRuntime()
  }

  const result = await inspectAgentCliRequirement(id)
  if (result) {
    return result
  }

  return {
    id,
    label: getRequirementLabel(id),
    ok: false,
    detail: '未知检查项。',
    autoInstallable: false,
  }
}

const getRequirementIdsForTarget = (target: WorkerRuntimeTarget): RuntimeRequirementId[] => {
  const linuxBaseRequirements: RuntimeRequirementId[] = process.platform === 'linux' ? ['unzip'] : []

  if (target === 'all') {
    return ['git', ...linuxBaseRequirements, 'opencode', 'pi-runtime', 'codex-cli', 'codex-auth', 'claude-cli', 'claude-auth']
  }

  if (target === 'Pi') {
    return ['pi-runtime']
  }

  if (target === 'Codex') {
    return ['git', 'codex-cli', 'codex-auth']
  }

  if (target === 'ClaudeCode') {
    return ['git', 'claude-cli', 'claude-auth']
  }

  return ['git', ...linuxBaseRequirements, 'opencode']
}

const getTargetReadyMessage = (target: WorkerRuntimeTarget) => {
  if (target === 'Pi') return 'Pi 运行环境已就绪。'
  if (target === 'Codex') return 'Git、Codex CLI 与登录状态已就绪。'
  if (target === 'ClaudeCode') return 'Git、Claude Code CLI 与登录状态已就绪。'
  if (target === 'all') return 'Git、OpenCode、Pi、Codex、Claude Code 运行环境已就绪。'
  return process.platform === 'linux' ? 'Git、unzip 与 OpenCode 运行时已就绪。' : 'Git 与 OpenCode 运行时已就绪。'
}

const buildRuntimePlan = (
  items: RuntimeCheck[],
  target: WorkerRuntimeTarget,
): RuntimeBootstrapPlan => {
  const missingItems = items.filter((item) => !item.ok)
  const ok = missingItems.length === 0

  return {
    ok,
    target,
    items,
    missingItems,
    message: ok ? getTargetReadyMessage(target) : `运行环境缺失：${missingItems.map((item) => item.label).join('、')}`,
  }
}

const formatBootstrapFailureMessage = (items: RuntimeCheck[]) => {
  const failedItems = items.filter((item) => !item.ok)
  if (failedItems.length === 0) {
    return '自动准备失败。'
  }

  const summary = `自动准备失败：${failedItems.map((item) => item.label).join('、')}`
  const details = failedItems
    .map((item) => `- ${item.label}: ${item.detail}`)
    .join('\n')

  return details ? `${summary}\n${details}` : summary
}

const inspectWorkerRuntime = async (target: WorkerRuntimeTarget = 'base') => {
  const items = await Promise.all(getRequirementIdsForTarget(target).map((id) => inspectRequirement(id)))
  return buildRuntimePlan(items, target)
}

const buildBootstrapReport = (
  plan: RuntimeBootstrapPlan,
  attempts: InstallAttempt[] = [],
): WorkerRuntimeBootstrapReport => {
  const changed = attempts.some((attempt) => attempt.changed)
  const attemptDetails = new Map(attempts.map((attempt) => [attempt.id, attempt.detail]))
  const items = plan.items.map((item) => {
    const attemptDetail = attemptDetails.get(item.id)
    if (!attemptDetail) {
      return item
    }

    return {
      ...item,
      detail: `${item.detail}；自动准备：${attemptDetail}`,
    }
  })

  return {
    ok: plan.ok,
    changed,
    target: plan.target,
    attempts,
    items,
    message: plan.ok
      ? changed
        ? `已自动补齐${plan.target === 'base' ? ' Worker ' : ''}运行环境。`
        : plan.message
      : formatBootstrapFailureMessage(items),
  }
}

const printStepHeader = (index: number, total: number, label: string) => {
  console.log(`[${index}/${total}] ${label}`)
}

const printStepResult = (status: '成功' | '失败' | '跳过', detail: string) => {
  console.log(`  ${status} - ${detail}`)
}

const executeBootstrapPlan = async (
  plan: RuntimeBootstrapPlan,
  options?: InstallExecutionOptions & { printProgress?: boolean },
): Promise<WorkerRuntimeBootstrapReport> => {
  if (plan.ok) {
    return buildBootstrapReport(plan)
  }

  const attempts: InstallAttempt[] = []
  const totalSteps = plan.missingItems.length * 2 + 1
  let stepIndex = 1

  for (const item of plan.missingItems) {
    const strategy = getInstallStrategy(item.id)
    const installTitle = strategy ? `安装 ${item.label}（${strategy.installer}）` : `安装 ${item.label}`
    if (options?.printProgress) {
      printStepHeader(stepIndex, totalSteps, installTitle)
    }

    const attempt = strategy
      ? strategy.run(options)
      : buildAttempt(item.id, null, {
          ok: false,
          changed: false,
          skipped: true,
          detail: item.hint || `当前环境无法自动安装 ${item.label}。`,
        })

    attempts.push(attempt)
    if (options?.printProgress) {
      printStepResult(attempt.ok ? '成功' : attempt.skipped ? '跳过' : '失败', attempt.detail)
    }
    stepIndex += 1

    const recheck = await inspectRequirement(item.id)
    if (options?.printProgress) {
      printStepHeader(stepIndex, totalSteps, `校验 ${item.label}`)
      printStepResult(recheck.ok ? '成功' : '失败', recheck.detail)
    }
    stepIndex += 1
  }

  const nextPlan = await inspectWorkerRuntime(plan.target)
  if (options?.printProgress) {
    printStepHeader(stepIndex, totalSteps, '最终复检')
    printStepResult(nextPlan.ok ? '成功' : '失败', nextPlan.message)
  }

  return buildBootstrapReport(nextPlan, attempts)
}

const formatRequirementSummary = (plan: RuntimeBootstrapPlan) => {
  return plan.missingItems
    .map((item) => {
      const installDetail = item.installCommand ? `；自动安装：${item.installCommand}` : ''
      return `- ${item.label}: ${item.detail}${installDetail}`
    })
    .join('\n')
}

const printManualRecovery = (plan: RuntimeBootstrapPlan) => {
  console.log('[worker] 可手动执行的修复建议：')
  for (const item of plan.missingItems) {
    console.log(`- ${item.label}: ${item.hint || '请手动安装后重试。'}`)
  }
}

const isInteractiveTerminal = () => {
  return Boolean(stdin.isTTY && stdout.isTTY)
}

const normalizeAutoInstallSetting = (value?: string) => {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return null
}

export const resolveWorkerRuntimeBootstrapMode = (params?: {
  interactiveTerminal?: boolean
  autoInstallSetting?: string
}): WorkerRuntimeBootstrapMode => {
  const interactiveTerminal = params?.interactiveTerminal ?? isInteractiveTerminal()
  const autoInstallSetting = normalizeAutoInstallSetting(
    params?.autoInstallSetting ?? process.env.VIBEMUX_WORKER_AUTO_INSTALL,
  )

  if (autoInstallSetting === true) {
    return 'auto'
  }

  if (autoInstallSetting === false) {
    return interactiveTerminal ? 'prompt' : 'block'
  }

  return interactiveTerminal ? 'prompt' : 'auto'
}

const isAffirmativeAnswer = (value: string) => {
  const normalized = value.trim().toLowerCase()
  return normalized === 'y' || normalized === 'yes' || normalized === '是'
}

export const ensureWorkerRuntimeReady = async (
  options?: InstallExecutionOptions & { autoInstall?: boolean; printProgress?: boolean; target?: WorkerRuntimeTarget },
): Promise<WorkerRuntimeBootstrapReport> => {
  const plan = await inspectWorkerRuntime(options?.target ?? 'base')
  if (plan.ok || !options?.autoInstall) {
    return buildBootstrapReport(plan)
  }

  return executeBootstrapPlan(plan, options)
}

export const ensureWorkerRuntimeReadyInteractive = async (
  commandName: string,
  target: WorkerRuntimeTarget = 'base',
): Promise<WorkerRuntimeInteractiveResult> => {
  const plan = await inspectWorkerRuntime(target)
  const report = buildBootstrapReport(plan)
  if (plan.ok) {
    return {
      status: 'ready',
      report,
      message: report.message,
    }
  }

  console.log(`[worker] 命令 ${commandName} 运行前检测到缺失依赖：`)
  console.log(formatRequirementSummary(plan))

  const interactiveTerminal = isInteractiveTerminal()
  const bootstrapMode = resolveWorkerRuntimeBootstrapMode({
    interactiveTerminal,
  })

  if (bootstrapMode === 'auto') {
    console.log('[worker] 将尝试自动安装缺失依赖。')
    const installedReport = await executeBootstrapPlan(plan, {
      interactiveAuth: interactiveTerminal,
      printProgress: true,
      streamOutput: true,
    })
    if (!installedReport.ok) {
      printManualRecovery(buildRuntimePlan(installedReport.items, target))
      return {
        status: 'failed',
        report: installedReport,
        message: installedReport.message,
      }
    }

    return {
      status: 'ready',
      report: installedReport,
      message: installedReport.message,
    }
  }

  if (!interactiveTerminal || bootstrapMode === 'block') {
    const message = '当前终端不可交互，无法确认是否自动安装缺失依赖。'
    console.error(`[worker] ${message}`)
    printManualRecovery(plan)
    return {
      status: 'non_interactive_blocked',
      report,
      message,
    }
  }

  const terminal = createInterface({ input: stdin, output: stdout })

  try {
    const answer = await terminal.question('是否现在自动安装缺失依赖？[y/N] ')
    if (!isAffirmativeAnswer(answer)) {
      const message = '用户拒绝自动安装，Worker 已退出。'
      console.error(`[worker] ${message}`)
      printManualRecovery(plan)
      return {
        status: 'declined',
        report,
        message,
      }
    }
  } finally {
    terminal.close()
  }

  const installedReport = await executeBootstrapPlan(plan, {
    interactiveAuth: true,
    printProgress: true,
    streamOutput: true,
  })
  if (!installedReport.ok) {
    printManualRecovery(buildRuntimePlan(installedReport.items, target))
    return {
      status: 'failed',
      report: installedReport,
      message: installedReport.message,
    }
  }

  return {
    status: 'ready',
    report: installedReport,
    message: installedReport.message,
  }
}

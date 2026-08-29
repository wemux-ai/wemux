// [INPUT]: doctor 检查项
// [OUTPUT]: 检查结果
// [POS]: worker doctor 自检
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { accessSync, constants, mkdirSync } from 'node:fs'
import type { WorkerDoctorItem } from './types'
import { getWorkerHome, loadWorkerConfig } from '../core/config'
import { ensureWorkspaceLayout } from '../core/workspace'
import { getSafeWorkerRuntimeState, sanitizeWorkerConfig } from '../core/runtime-state'
import { ensureWorkerRuntimeReady } from '../core/runtime-bootstrap'
import { loadWorkerMeshRuntimeConfigFromEnv } from './mesh-runtime-manager'
import { resolveExecutable } from '../core/command-utils'

const checkPathWritable = (targetPath: string) => {
  try {
    mkdirSync(targetPath, { recursive: true })
    accessSync(targetPath, constants.W_OK)
    return {
      ok: true,
      detail: `Writable: ${targetPath}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'path access failed'
    return {
      ok: false,
      detail: message,
    }
  }
}

const checkWorkspace = (workspaceRoot: string) => {
  try {
    const layout = ensureWorkspaceLayout(workspaceRoot)
    return {
      ok: true,
      detail: `Ready: ${layout.root}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'workspace setup failed'
    return {
      ok: false,
      detail: message,
    }
  }
}

const probeCloudUrl = async (cloudUrl: string) => {
  try {
    const response = await fetch(cloudUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    return {
      ok: true,
      status: response.status,
      message: `Control plane reachable, HTTP ${response.status}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud probe failed'
    return {
      ok: false,
      status: undefined,
      message,
    }
  }
}

const probeOfficialSite = async () => {
  try {
    const response = await fetch('https://opencode.ai', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    return {
      ok: response.ok,
      status: response.status,
      url: 'https://opencode.ai',
      message: response.ok ? `Official site reachable, HTTP ${response.status}` : `Official site returned an unexpected status, HTTP ${response.status}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'official site probe failed'
    return {
      ok: false,
      status: undefined,
      url: 'https://opencode.ai',
      message,
    }
  }
}

const buildDoctorSummary = (items: WorkerDoctorItem[]) => {
  const passed = items.filter((item) => item.ok).length
  const failed = items.length - passed

  return {
    total: items.length,
    passed,
    failed,
    ok: failed === 0,
  }
}

const buildWorkerDoctor = async () => {
  const config = loadWorkerConfig()
  const [cloudReachable, officialSiteReachable, runtimeBootstrap] = await Promise.all([
    probeCloudUrl(config.cloudUrl),
    probeOfficialSite(),
    ensureWorkerRuntimeReady({ target: 'all' }),
  ])
  const workerHome = checkPathWritable(getWorkerHome())
  const workspace = checkWorkspace(config.workspaceRoot)
  const git = runtimeBootstrap.items.find((item) => item.id === 'git') ?? { ok: false, detail: 'Git status is unknown.' }
  const opencode = runtimeBootstrap.items.find((item) => item.id === 'opencode') ?? { ok: false, detail: 'OpenCode runtime status is unknown.' }
  const codexCli = runtimeBootstrap.items.find((item) => item.id === 'codex-cli') ?? { ok: false, detail: 'Codex CLI status is unknown.' }
  const codexAuth = runtimeBootstrap.items.find((item) => item.id === 'codex-auth') ?? { ok: false, detail: 'Codex sign-in status is unknown.' }
  const claudeCli = runtimeBootstrap.items.find((item) => item.id === 'claude-cli') ?? { ok: false, detail: 'Claude Code CLI status is unknown.' }
  const claudeAuth = runtimeBootstrap.items.find((item) => item.id === 'claude-auth') ?? { ok: false, detail: 'Claude Code authentication status is unknown.' }
  const opencodeConfigReady = Boolean(config.opencodeConfigContent?.trim())
  const codexConfigReady = Boolean(config.codexConfigContent?.trim())
  const claudeConfigReady = Boolean(config.claudeCodeConfigContent?.trim())
  const meshConfig = loadWorkerMeshRuntimeConfigFromEnv()
  const easyTierCorePath = meshConfig.corePath || resolveExecutable('easytier-core')
  const easyTierCliPath = meshConfig.cliPath || resolveExecutable('easytier-cli')
  const easyTierConfigured = Boolean(
    meshConfig.networkName?.trim()
    && meshConfig.networkSecret?.trim()
    && meshConfig.peers.length > 0,
  )
  const items: WorkerDoctorItem[] = [
    {
      id: 'git',
      category: 'tooling',
      label: 'Git',
      ok: git.ok,
      detail: git.detail,
      hint: git.ok ? undefined : 'Install Git first and confirm it is executable from PATH.',
    },
    {
      id: 'opencode',
      category: 'tooling',
      label: 'OpenCode Runtime',
      ok: opencode.ok,
      detail: opencode.detail,
      hint: opencode.ok ? undefined : 'Check the worker dependency installation and confirm both `@opencode-ai/sdk` and the local `opencode` runtime are available.',
    },
    {
      id: 'codex-cli',
      category: 'tooling',
      label: 'Codex CLI',
      ok: codexCli.ok,
      detail: codexCli.detail,
      hint: codexCli.ok ? undefined : 'Install the Codex CLI first. The worker can also run `npm install -g @openai/codex` automatically.',
    },
    {
      id: 'codex-auth',
      category: 'tooling',
      label: 'Codex Sign-In',
      ok: codexAuth.ok,
      detail: codexAuth.detail,
      hint: codexAuth.ok ? undefined : 'Run `codex` and complete sign-in before trying again.',
    },
    {
      id: 'claude-cli',
      category: 'tooling',
      label: 'Claude Code CLI',
      ok: claudeCli.ok,
      detail: claudeCli.detail,
      hint: claudeCli.ok ? undefined : 'Install the Claude Code CLI first. The worker prefers the official native install flow.',
    },
    {
      id: 'claude-auth',
      category: 'tooling',
      label: 'Claude Code Authentication',
      ok: claudeAuth.ok,
      detail: claudeAuth.detail,
      hint: claudeAuth.ok ? undefined : 'Configure Claude Console/API credentials, or run `claude` and complete sign-in before trying again.',
    },
    {
      id: 'opencode-config',
      category: 'config',
      label: 'OpenCode Configuration',
      ok: opencodeConfigReady,
      detail: opencodeConfigReady ? 'Loaded the OpenCode providers configuration.' : 'OpenCode providers configuration was not found.',
      hint: opencodeConfigReady ? undefined : 'Add the OpenCode providers JSON in central settings or on this worker machine.',
    },
    {
      id: 'codex-config',
      category: 'config',
      label: 'Codex Configuration',
      ok: codexConfigReady,
      detail: codexConfigReady ? 'Loaded `Codex config.toml`.' : '`Codex config.toml` was not found.',
      hint: codexConfigReady ? undefined : 'Provide it through central settings, or prepare `~/.codex/config.toml` on this worker machine.',
    },
    {
      id: 'claude-config',
      category: 'config',
      label: 'Claude Code Configuration',
      ok: claudeConfigReady,
      detail: claudeConfigReady ? 'Loaded `Claude Code settings.json`.' : '`Claude Code settings.json` was not found.',
      hint: claudeConfigReady ? undefined : 'Provide it through central settings, or prepare `~/.claude/settings.json` on this worker machine.',
    },
    {
      id: 'worker-home',
      category: 'filesystem',
      label: 'Worker Home',
      ok: workerHome.ok,
      detail: workerHome.detail,
      hint: workerHome.ok ? undefined : 'Check directory permissions and confirm the worker home can be created and written.',
    },
    {
      id: 'workspace',
      category: 'filesystem',
      label: 'Workspace',
      ok: workspace.ok,
      detail: workspace.detail,
      hint: workspace.ok ? undefined : 'Confirm the workspace root path is valid and writable by the current user.',
    },
    {
      id: 'machine-id',
      category: 'config',
      label: 'Machine ID',
      ok: Boolean(config.machineId),
      detail: config.machineId ? `Configured: ${config.machineId}` : 'Machine ID is not configured.',
      hint: config.machineId ? undefined : 'Reset the local worker config and start the worker again to generate a fresh machine ID.',
    },
    {
      id: 'pairing',
      category: 'config',
      label: 'Pairing',
      ok: Boolean(config.executorId && config.executorToken),
      detail: config.executorId ? `Paired: ${config.executorId}` : 'Pairing has not been completed.',
      hint: config.executorId ? undefined : 'Run the installer command generated by wemux, or enter the pairing code in the local worker console.',
    },
    {
      id: 'cloud-url',
      category: 'network',
      label: 'Control Plane URL',
      ok: Boolean(config.cloudUrl?.trim()),
      detail: config.cloudUrl?.trim() || 'Cloud URL is not configured.',
      hint: config.cloudUrl?.trim() ? undefined : 'Enter the control-plane Cloud URL first.',
    },
    {
      id: 'cloud-reachable',
      category: 'network',
      label: 'Control Plane Reachability',
      ok: cloudReachable.ok,
      detail: cloudReachable.message,
      hint: cloudReachable.ok ? undefined : 'Confirm the control-plane service is running and reachable from this machine.',
    },
    {
      id: 'official-site',
      category: 'network',
      label: 'OpenCode Official Site',
      ok: officialSiteReachable.ok,
      detail: officialSiteReachable.message,
      hint: officialSiteReachable.ok ? undefined : 'If the official site is unreachable, the current network likely has outbound access restrictions.',
    },
    {
      id: 'easytier-mesh',
      category: 'network',
      label: 'EasyTier Mesh',
      ok: !meshConfig.enabled || (Boolean(easyTierCorePath) && Boolean(easyTierCliPath) && easyTierConfigured),
      detail: meshConfig.enabled
        ? [
            easyTierCorePath ? `core: ${easyTierCorePath}` : 'core: missing',
            easyTierCliPath ? `cli: ${easyTierCliPath}` : 'cli: missing',
            easyTierConfigured ? 'enrollment: configured' : 'enrollment: incomplete',
          ].join(', ')
        : 'Mesh is disabled.',
      hint: meshConfig.enabled && (!easyTierCorePath || !easyTierCliPath || !easyTierConfigured)
        ? 'Install EasyTier and set VIBEMUX_EASYTIER_NETWORK_NAME, VIBEMUX_EASYTIER_NETWORK_SECRET, and VIBEMUX_EASYTIER_PEERS.'
        : undefined,
    },
  ]

  return {
    config: sanitizeWorkerConfig(config),
    checks: {
      git: git.ok,
      opencodeAvailable: opencode.ok,
      codexCliAvailable: codexCli.ok,
      codexAuthenticated: codexAuth.ok,
      claudeCliAvailable: claudeCli.ok,
      claudeAuthenticated: claudeAuth.ok,
      opencodeConfigLoaded: opencodeConfigReady,
      codexConfigLoaded: codexConfigReady,
      claudeConfigLoaded: claudeConfigReady,
      workerHomeWritable: workerHome.ok,
      workspaceConfigured: Boolean(config.workspaceRoot),
      workspaceReady: workspace.ok,
      machineIdConfigured: Boolean(config.machineId),
      paired: Boolean(config.executorId && config.executorToken),
      cloudUrlConfigured: Boolean(config.cloudUrl?.trim()),
      cloudReachable: cloudReachable.ok,
      officialSiteReachable: officialSiteReachable.ok,
    },
    items,
    summary: buildDoctorSummary(items),
    cloudProbe: cloudReachable,
    officialSiteProbe: officialSiteReachable,
    runtime: getSafeWorkerRuntimeState(),
  }
}

export const runWorkerDoctor = async () => {
  console.log(JSON.stringify(await buildWorkerDoctor(), null, 2))
}

export const getWorkerDoctor = () => {
  return buildWorkerDoctor()
}

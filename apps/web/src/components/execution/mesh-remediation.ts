import type { ExecutorRecord } from '@shared/types'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const isPreviewWorker = (executor: Pick<ExecutorRecord, 'version' | 'workspaceRoot'>) => (
  executor.version?.includes('preview') || executor.workspaceRoot.includes('.vibemux-preview')
)

const resolveWorkerBinPath = (executor: Pick<ExecutorRecord, 'version' | 'workspaceRoot'>) => {
  const userHomeMatch = executor.workspaceRoot.match(/^\/Users\/[^/]+/)
  return userHomeMatch ? `${userHomeMatch[0]}/.local/bin/wemux` : 'Wemux'
}

const installUnzipCommand = [
  'if command -v apt-get >/dev/null 2>&1; then',
  '  sudo apt-get update && sudo apt-get install -y unzip',
  'elif command -v dnf >/dev/null 2>&1; then',
  '  sudo dnf install -y unzip',
  'elif command -v yum >/dev/null 2>&1; then',
  '  sudo yum install -y unzip',
  'elif command -v apk >/dev/null 2>&1; then',
  '  sudo apk add unzip',
  'else',
  '  echo "Please install unzip with this system package manager." >&2',
  '  exit 1',
  'fi',
].join('\n')

const restartWindowsWorkerCommand = (executor: Pick<ExecutorRecord, 'version'>) => {
  const binName = executor.version?.includes('preview') ? 'wemux-worker-preview' : 'wemux-worker'
  return [
    '$bin = Join-Path $env:LOCALAPPDATA "Vibemux\\bin\\wemux.cmd"',
    '& $bin worker service restart --name "' + binName + '"',
  ].join('\n')
}

export const getMeshRemediation = (
  executor: Pick<ExecutorRecord, 'platform' | 'presence' | 'version' | 'workspaceRoot'>,
  language = 'zh',
) => {
  const mesh = executor.presence?.mesh
  const error = mesh?.errorMessage?.trim() || ''
  const isMissingUnzip = /auto download requires unzip|install unzip|unzip.+not found|requires unzip/i.test(error)
  const isMacTunPermissionIssue = executor.platform === 'darwin'
    && mesh?.enabled
    && (mesh.status === 'degraded' || mesh.status === 'error')
    && (/tun device error/i.test(error) || /operation not permitted/i.test(error) || /failed to get manage client/i.test(error))
  const isMacMeshConfigPending = executor.platform === 'darwin'
    && mesh?.enabled
    && (mesh.status === 'degraded' || mesh.status === 'error')
    && (/control plane assigned/i.test(error) || /latest mesh enrollment/i.test(error) || /mesh helper is using/i.test(error))

  if (isMissingUnzip) {
    if (executor.platform === 'win32') {
      return {
        kind: 'windows-mesh-extract' as const,
        title: tr(language, 'Windows Mesh 组件解压方式已更新', 'Windows Mesh extraction has been updated'),
        description: tr(
          language,
          '这台 Windows 节点不需要安装 Linux unzip。新版 worker 会使用 Windows 自带 PowerShell 解压 Mesh 组件；升级后重启 worker，或等待自更新重启后 Mesh 会自动重试。',
          'This Windows executor does not need Linux unzip. The updated worker uses built-in PowerShell to extract Mesh components; restart the worker after upgrading, or wait for auto-update to restart and retry Mesh.',
        ),
        command: restartWindowsWorkerCommand(executor),
        note: tr(language, '如果仍显示旧错误，请确认 worker 版本已更新到包含 Windows Mesh 解压修复的版本。', 'If the old error remains, confirm the worker has updated to a version that includes the Windows Mesh extraction fix.'),
      }
    }

    return {
      kind: 'missing-unzip' as const,
      title: tr(language, '缺少 unzip，Mesh 无法自动下载组件', 'Install unzip so Mesh can download its components'),
      description: tr(
        language,
        '在这台 Linux 节点安装 unzip 后，重启 worker 或等待 Wemux Mesh 自动重试。高级用法也可以手动放置 EasyTier 二进制，并设置 WEMUX_EASYTIER_CORE_PATH 和 WEMUX_EASYTIER_CLI_PATH。',
        'Install unzip on this Linux executor, then restart the worker or wait for Wemux Mesh to retry. Advanced setup can also provide EasyTier binaries manually via WEMUX_EASYTIER_CORE_PATH and WEMUX_EASYTIER_CLI_PATH.',
      ),
      command: installUnzipCommand,
      note: tr(language, '复制命令会自动识别常见 Linux 包管理器；安装完成后可在节点详情里点刷新确认 Mesh 恢复。', 'The copied command detects common Linux package managers automatically; after installation, refresh the executor details to confirm Mesh recovery.'),
    }
  }

  if (isMacTunPermissionIssue || isMacMeshConfigPending) {
    const workerHome = executor.workspaceRoot.trim()
    const workerBinPath = resolveWorkerBinPath(executor)
    return {
      kind: 'macos-easytier-helper' as const,
      title: tr(language, '需要在这台 Mac 的终端执行一次授权命令', 'Run one authorization command in Terminal on this Mac'),
      description: tr(
        language,
        '复制下方命令，粘贴到目标机器终端执行；完成后回到这里等待 Wemux Mesh 自动恢复。worker 仍然以普通用户执行任务。',
        'Copy the command below, paste it into the target machine terminal, then return here and wait for Wemux Mesh to recover. The worker still executes tasks as the normal user.',
      ),
      command: `sudo WEMUX_WORKER_HOME=${shellQuote(workerHome)} ${shellQuote(workerBinPath)} worker mesh install-service`,
    }
  }

  return null
}

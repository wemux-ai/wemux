// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: External request origin and the packaged worker installer manifest.
// [OUTPUT]: Environment-pinned Unix, Windows, and Docker worker installers plus artifact routes.
// [POS]: Server installer boundary; package identity must determine worker channel, home, service, and default port.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Hono } from 'hono'
import { resolveExternalRequestScheme } from '../services/preview-hostname'

type WorkerInstallerManifest = {
  packageName: string
  packageVersion: string
  binName: string
  fileName: string
  builtAt: string
  commitSha?: string
}

const resolveWorkerInstallerDir = () => {
  const configured = process.env.VIBEMUX_WORKER_INSTALLER_DIR?.trim()
  if (configured) {
    return path.resolve(configured)
  }

  return path.resolve(process.cwd(), 'dist-server', 'worker-installer')
}

const resolveWorkerInstallerManifestPath = () => {
  return path.join(resolveWorkerInstallerDir(), 'manifest.json')
}

const resolveWorkerInstallerPackagePath = () => {
  return path.join(resolveWorkerInstallerDir(), 'package.tgz')
}

const loadWorkerInstallerManifest = async () => {
  const manifestPath = resolveWorkerInstallerManifestPath()
  const packagePath = resolveWorkerInstallerPackagePath()
  if (!existsSync(manifestPath) || !existsSync(packagePath)) {
    return null
  }

  const raw = await readFile(manifestPath, 'utf8')
  return JSON.parse(raw) as WorkerInstallerManifest
}

const resolveRequestHost = (requestUrl: string, hostHeader?: string | null, forwardedHostHeader?: string | null) => {
  const forwardedHost = forwardedHostHeader
    ?.split(',')
    .map((value) => value.trim())
    .find(Boolean)
  if (forwardedHost) {
    return forwardedHost
  }

  const directHost = hostHeader?.trim()
  if (directHost) {
    return directHost
  }

  return new URL(requestUrl).host
}

const buildServerUrl = (requestUrl: string, headers: Headers) => {
  const scheme = resolveExternalRequestScheme({
    requestUrl,
    headers,
  })
  const host = resolveRequestHost(
    requestUrl,
    headers.get('host'),
    headers.get('x-forwarded-host'),
  )
  return `${scheme}://${host}`
}

export const buildWorkerDockerInstallScript = (serverUrl: string, manifest?: WorkerInstallerManifest | null) => {
  const previewPackage = manifest?.packageName === 'wemux-worker-preview' || manifest?.packageName === 'vibemux-worker-preview'
  const workerPort = previewPackage ? 48123 : 48100
  const releaseChannel = previewPackage ? 'preview' : 'production'
  return `#!/usr/bin/env bash
set -euo pipefail

# ── 颜色与装饰：仅在终端输出时启用 ANSI 颜色，管道/重定向/日志场景自动降级为纯文本 ──
C_RESET=""
C_BOLD=""
C_GREEN=""
C_CYAN=""
C_YELLOW=""
C_RED=""
if [[ -t 2 && -z "\${NO_COLOR:-}" && "\${TERM:-}" != "dumb" ]]; then
  C_RESET=$'\\033[0m'
  C_BOLD=$'\\033[1m'
  C_GREEN=$'\\033[32m'
  C_CYAN=$'\\033[36m'
  C_YELLOW=$'\\033[33m'
  C_RED=$'\\033[31m'
fi

say2() {
  if [[ -n "$C_RESET" ]]; then
    printf '%s%s%s\\n' "$1" "$2" "$C_RESET" >&2
  else
    printf '%s\\n' "$2" >&2
  fi
}

PAIRING_CODE=""
WORKER_NAME=""
SERVER_URL="${serverUrl}"
CONTAINER_NAME=""
VOLUME_NAME=""
WORKER_PORT="${workerPort}"
WORKER_HOME="/data/vibemux-worker"
DOCKER_IMAGE="node:22-bookworm-slim"

shell_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-12
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pairing-code)
      PAIRING_CODE="\${2:-}"
      shift 2
      ;;
    --name)
      WORKER_NAME="\${2:-}"
      shift 2
      ;;
    --server-url)
      SERVER_URL="\${2:-}"
      shift 2
      ;;
    --container-name)
      CONTAINER_NAME="\${2:-}"
      shift 2
      ;;
    --volume-name)
      VOLUME_NAME="\${2:-}"
      shift 2
      ;;
    --worker-port)
      WORKER_PORT="\${2:-}"
      shift 2
      ;;
    --image)
      DOCKER_IMAGE="\${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  install-worker-docker.sh --pairing-code <CODE> [options]

Options:
  --name <NAME>             Worker display name
  --server-url <URL>        wemux server URL, default: current server
  --container-name <NAME>   Docker container name
  --volume-name <NAME>      Docker volume name
  --worker-port <PORT>      Worker console port inside the container
  --image <IMAGE>           Base image, default: node:22-bookworm-slim
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PAIRING_CODE" ]]; then
  echo "Missing required --pairing-code" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is not installed or not available on PATH." >&2
  echo "Install Docker Engine or Docker Desktop first, then run: docker version" >&2
  exit 1
fi

if ! docker version >/dev/null 2>&1; then
  DOCKER_CONTEXT="$(docker context show 2>/dev/null || echo unknown)"
  HOST_OS="$(uname -s 2>/dev/null || echo unknown)"
  echo "Docker is not running or the current Docker context is unavailable." >&2
  echo "Current context: $DOCKER_CONTEXT" >&2
  if [[ "$HOST_OS" == "Linux" ]]; then
    echo "On Linux, start the Docker daemon, then run: docker version" >&2
    echo "Try: systemctl start docker" >&2
    echo "If systemd is unavailable, try: service docker start" >&2
  else
    echo "Start OrbStack or Docker Desktop, then run: docker version" >&2
    echo "If you use Docker Desktop instead of OrbStack, try: docker context use default" >&2
  fi
  exit 1
fi

RESOURCE_SUFFIX="$(shell_slug "$PAIRING_CODE")"
if [[ -z "$RESOURCE_SUFFIX" || "$RESOURCE_SUFFIX" == "pairingcode" ]]; then
  RESOURCE_SUFFIX="new"
fi

if [[ -z "$CONTAINER_NAME" ]]; then
  CONTAINER_NAME="vibemux-worker-$RESOURCE_SUFFIX"
fi

if [[ -z "$VOLUME_NAME" ]]; then
  VOLUME_NAME="vibemux-worker-home-$RESOURCE_SUFFIX"
fi

say2 "$C_CYAN" "Starting wemux worker Docker container: $CONTAINER_NAME"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker_args=(
  run -d
  --name "$CONTAINER_NAME"
  --restart unless-stopped
  --add-host host.docker.internal:host-gateway
  --cap-add NET_ADMIN
  --device /dev/net/tun
  -e NODE_ENV=production
  -e VIBEMUX_WORKER_RELEASE_CHANNEL=${releaseChannel}
  -e "VIBEMUX_CLOUD_URL=$SERVER_URL"
  -e "HOME=$WORKER_HOME"
  -e "VIBEMUX_WORKER_HOME=$WORKER_HOME"
  -e "VIBEMUX_WORKER_INSTALL_PREFIX=$WORKER_HOME/install"
  -e VIBEMUX_WORKER_HOST=0.0.0.0
  -e "VIBEMUX_WORKER_PORT=$WORKER_PORT"
  -e VIBEMUX_WORKER_AUTO_INSTALL=true
  -e VIBEMUX_WORKER_AUTO_UPDATE=1
  -e VIBEMUX_WORKER_RESTART_STRATEGY=docker
  -e VIBEMUX_WORKER_RUN_MODE=docker
  -e "VIBEMUX_INSTALL_URL=$SERVER_URL/install"
  -e "VIBEMUX_PAIRING_CODE=$PAIRING_CODE"
)

if [[ -n "$WORKER_NAME" ]]; then
  docker_args+=(-e "VIBEMUX_WORKER_NAME=$WORKER_NAME")
fi

docker_args+=(
  -v "$VOLUME_NAME:$WORKER_HOME"
  "$DOCKER_IMAGE"
  bash
  -lc
  'set -euo pipefail
mkdir -p "$VIBEMUX_WORKER_HOME" "$VIBEMUX_WORKER_INSTALL_PREFIX"
if ! command -v curl >/dev/null 2>&1; then
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends curl ca-certificates unzip >/dev/null
  rm -rf /var/lib/apt/lists/*
fi
args=(--pairing-code "$VIBEMUX_PAIRING_CODE" --server-url "$VIBEMUX_CLOUD_URL" --install-dir "$VIBEMUX_WORKER_INSTALL_PREFIX" --foreground)
if [[ -n "\${VIBEMUX_WORKER_NAME:-}" ]]; then
  args+=(--name "$VIBEMUX_WORKER_NAME")
fi
curl -fsSL "$VIBEMUX_INSTALL_URL" | bash -s -- "\${args[@]}"'
)

docker "\${docker_args[@]}"
echo "" >&2
if [[ -n "$C_RESET" ]]; then
  printf '%s%s%s\\n' "$C_GREEN" "════════════════════════════════════════════════════════════" "$C_RESET" >&2
  printf '%s%s%s\\n' "$C_BOLD$C_GREEN" "  ✨  wemux worker Docker 容器已启动 · Container started  ✨" "$C_RESET" >&2
  printf '%s%s%s\\n' "$C_GREEN" "════════════════════════════════════════════════════════════" "$C_RESET" >&2
fi
say2 "$C_GREEN" "wemux worker container started: $CONTAINER_NAME"
say2 "$C_CYAN" "Logs: docker logs -f $CONTAINER_NAME"
echo "" >&2
say2 "$C_BOLD$C_GREEN" "  ▶ 下一步 · Next steps"
say2 "$C_CYAN" "  1. 打开执行中心查看这台机器：$SERVER_URL/execution"
say2 "$C_CYAN" "  2. 停止并删除容器：docker rm -f $CONTAINER_NAME"
say2 "$C_CYAN" "  3. 查看容器日志：docker logs -f $CONTAINER_NAME"
`
}

export const buildWorkerInstallBootstrapScript = (serverUrl: string, manifest: WorkerInstallerManifest) => {
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ -t 2 && -z "\${NO_COLOR:-}" && "\${TERM:-}" != "dumb" ]]; then
  printf '\\033[36m%s\\033[0m\\n' "wemux worker installer bootstrap (${manifest.packageName}@${manifest.packageVersion})" >&2
  ${manifest.commitSha ? `printf '\\033[2m%s\\033[0m\\n' "Installer commit: ${manifest.commitSha}" >&2` : ''}
else
  echo "wemux worker installer bootstrap (${manifest.packageName}@${manifest.packageVersion})" >&2
  ${manifest.commitSha ? `echo "Installer commit: ${manifest.commitSha}" >&2` : ''}
fi
echo "" >&2

TMP_SCRIPT="$(mktemp "\${TMPDIR:-/tmp}/wemux-worker-install.XXXXXX")"
cleanup() {
  rm -f "$TMP_SCRIPT"
}
trap cleanup EXIT

curl -fsSL "${serverUrl}/install/worker.sh" -o "$TMP_SCRIPT"
exec bash "$TMP_SCRIPT" "$@"
`
}

export const buildWorkerInstallPowerShellScript = (serverUrl: string, manifest?: WorkerInstallerManifest | null) => {
  return `param(
  [Parameter(Mandatory = $true)]
  [string]$PairingCode,
  [string]$WorkerName = "",
  [string]$InstallDir = "",
  [string]$ServerUrl = "${serverUrl}",
  [string]$LogDir = "",
  [string]$ServiceName = "",
  [ValidateSet("CurrentUser", "Foreground")]
  [string]$InstallMode = "CurrentUser",
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Step = 0
$TotalSteps = 9
$ShimDir = Join-Path $HOME "AppData\\Local\\Vibemux\\bin"
$ShimPath = ""
$CommandBin = ""

function Write-Step {
  param([string]$Message)
  $script:Step += 1
  Write-Host ("[{0}/{1}] {2}" -f $script:Step, $script:TotalSteps, $Message) -ForegroundColor Cyan
}

function Get-CommandPath {
  param([string[]]$Candidates)

  foreach ($candidate in $Candidates) {
    $resolved = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($resolved) {
      return $resolved.Source
    }
  }

  return ""
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $segments = @()
  if ($machinePath) {
    $segments += $machinePath
  }
  if ($userPath) {
    $segments += $userPath
  }
  $env:Path = ($segments | Where-Object { $_ } | Select-Object -Unique) -join ";"
}

function Ensure-Node22 {
  $nodeCommand = Get-CommandPath @("node.exe", "node")
  if ($nodeCommand) {
    $nodeMajor = & $nodeCommand -p "process.versions.node.split('.')[0]"
    if ($LASTEXITCODE -eq 0 -and [int]$nodeMajor -ge 22) {
      return
    }
  }

  if (Get-CommandPath @("winget.exe", "winget")) {
    Write-Host "Detected Node.js < 22. Installing or activating Node.js 22 with winget..."
    & winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "winget install OpenJS.NodeJS.LTS failed"
    }
    Refresh-ProcessPath
  } elseif (Get-CommandPath @("choco.exe", "choco")) {
    Write-Host "Detected Node.js < 22. Installing or activating Node.js 22 with choco..."
    & choco install nodejs-lts -y
    if ($LASTEXITCODE -ne 0) {
      throw "choco install nodejs-lts failed"
    }
    Refresh-ProcessPath
  }

  $nodeCommand = Get-CommandPath @("node.exe", "node")
  if ($nodeCommand) {
    $nodeMajor = & $nodeCommand -p "process.versions.node.split('.')[0]"
    if ($LASTEXITCODE -eq 0 -and [int]$nodeMajor -ge 22) {
      return
    }
  }

  $currentVersion = if ($nodeCommand) { & $nodeCommand -v } else { "missing" }
  $message = @"
Node.js 22 or newer is required. Current: $currentVersion
Recommended quick fix:
  winget install --id OpenJS.NodeJS.LTS --exact --source winget
"@
  throw $message
}

Write-Host "wemux worker installer${manifest ? ` (${manifest.packageName}@${manifest.packageVersion})` : ''}" -ForegroundColor Cyan
${manifest?.commitSha ? `Write-Host "Installer commit: ${manifest.commitSha}" -ForegroundColor Cyan` : ''}
Write-Host "Install mode: $InstallMode (runs as current Windows user: $env:USERNAME; admin not required)."
Write-Host "Preparing this machine for wemux. This may take a few minutes on the first run." -ForegroundColor Cyan
Write-Host ""

Write-Step "Checking Node.js runtime..."
Ensure-Node22
$nodeCommand = Get-CommandPath @("node.exe", "node")
Write-Host ("Using Node.js {0}." -f (& $nodeCommand -v)) -ForegroundColor Green

Write-Step "Preparing installer workspace..."
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("wemux-worker-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

try {
  $manifestUrl = "$ServerUrl/install/worker/manifest.json"
  $packageUrl = "$ServerUrl/install/worker/package.tgz"
  $manifestPath = Join-Path $tmpDir "manifest.json"
  $packagePath = Join-Path $tmpDir "worker.tgz"

  Write-Step "Downloading worker manifest..."
  Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl -OutFile $manifestPath

  Write-Step "Downloading worker package..."
  Invoke-WebRequest -UseBasicParsing -Uri $packageUrl -OutFile $packagePath

  $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
  $packageName = if ($manifest.packageName) { [string]$manifest.packageName } else { "wemux-worker-preview" }
  $binName = if ($manifest.binName) { [string]$manifest.binName } elseif ($manifest.packageName) { [string]$manifest.packageName } else { "wemux-worker-preview" }
  if (-not $ServiceName) {
    $ServiceName = $binName
  }

  if (-not $InstallDir) {
    $isPreviewPackage = ($packageName -eq "vibemux-worker-preview" -or $packageName -eq "wemux-worker-preview")
    if ($isPreviewPackage) {
      $InstallDir = Join-Path $HOME ".wemux-preview-worker"
    } else {
      $InstallDir = Join-Path $HOME ".wemux-worker"
    }
  }

  if ($packageName -eq "vibemux-worker-preview" -or $packageName -eq "wemux-worker-preview") {
    $env:VIBEMUX_WORKER_HOME = Join-Path $HOME ".wemux-preview"
    $env:VIBEMUX_WORKER_RELEASE_CHANNEL = "preview"
  } else {
    $env:VIBEMUX_WORKER_HOME = Join-Path $HOME ".wemux"
    $env:VIBEMUX_WORKER_RELEASE_CHANNEL = "production"
  }

  $workerBinCandidates = @(
    (Join-Path $InstallDir ($binName + ".cmd")),
    (Join-Path (Join-Path $InstallDir "bin") ($binName + ".cmd"))
  )
  $existingWorkerBin = $workerBinCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($existingWorkerBin) {
    Write-Host ("Stopping existing {0} service before upgrade..." -f $ServiceName)
    & $existingWorkerBin service stop --name $ServiceName
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Existing service stop returned a non-zero exit code; continuing with process cleanup."
    }
  }

  $serviceRoot = Join-Path $HOME ("AppData\\Local\\Vibemux\\services\\" + $ServiceName)
  foreach ($pidFileName in @("worker.pid", "worker-supervisor.pid")) {
    $pidPath = Join-Path $serviceRoot $pidFileName
    if (Test-Path $pidPath) {
      $rawPid = (Get-Content -Path $pidPath -Raw -ErrorAction SilentlyContinue).Trim()
      $pidValue = 0
      if ([int]::TryParse($rawPid, [ref]$pidValue) -and $pidValue -gt 0) {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      }
      Remove-Item -Path $pidPath -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500

  if (-not (Get-CommandPath @("tar.exe", "tar"))) {
    throw "tar is required to extract the self-contained worker package"
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Write-Step ("Installing {0} into {1}..." -f $packageName, $InstallDir)
  $extractDir = Join-Path $tmpDir "extract"
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  & (Get-CommandPath @("tar.exe", "tar")) -xzf $packagePath -C $extractDir
  if ($LASTEXITCODE -ne 0) {
    throw "worker package extraction failed with exit code $LASTEXITCODE"
  }

  $packageDir = Join-Path (Join-Path (Join-Path $InstallDir "lib") "node_modules") $packageName
  $extractedPackageDir = Join-Path $extractDir $packageName
  if (-not (Test-Path (Join-Path $extractedPackageDir "package.json"))) {
    throw "Extracted worker package is missing package.json"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $packageDir -Parent) | Out-Null
  if (Test-Path $packageDir) {
    Remove-Item -Path $packageDir -Recurse -Force
  }
  Move-Item -Path $extractedPackageDir -Destination $packageDir

  $workerBin = Join-Path (Join-Path $InstallDir "bin") ($binName + ".cmd")
  New-Item -ItemType Directory -Force -Path (Split-Path $workerBin -Parent) | Out-Null
  @"
@echo off
call "$nodeCommand" "$packageDir\\bin\\cli.mjs" %*
"@ | Set-Content -Path $workerBin -Encoding Ascii

  $workerBinCandidates = @($workerBin)

  Write-Step "Creating user command shim..."
  New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null
  $ShimPath = Join-Path $ShimDir ($binName + ".cmd")
  @"
@echo off
call "$workerBin" %*
"@ | Set-Content -Path $ShimPath -Encoding Ascii
  # wemux 是品牌规范命令（与 web 控制台 / 文档一致）；长名 shim 保留用于兼容
  $WemuxShimPath = Join-Path $ShimDir "wemux.cmd"
  @"
@echo off
call "$workerBin" %*
"@ | Set-Content -Path $WemuxShimPath -Encoding Ascii

  $pathEntries = ($env:Path -split ";") | Where-Object { $_ }
  $CommandBin = if ($pathEntries -contains $ShimDir) { $binName } else { $ShimPath }
  $WemuxCommandBin = if ($pathEntries -contains $ShimDir) { "wemux" } else { $WemuxShimPath }

  Write-Step "Bootstrapping Git and agent runtimes..."
  $workerBinDir = Split-Path $workerBin -Parent
  $workerPackageBinDir = Join-Path (Join-Path $packageDir "node_modules") ".bin"
  $env:VIBEMUX_WORKER_INSTALL_PREFIX = $InstallDir
  $env:Path = "$workerBinDir;$workerPackageBinDir;$env:Path"
  # Runtime bootstrap 是增强步骤：失败不阻断安装，worker 主体仍可配对并运行。
  & $workerBin bootstrap --target base
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Runtime bootstrap failed; continuing installation. The worker can still run." -ForegroundColor Yellow
    Write-Host "Fix agent runtimes later with: $CommandBin worker doctor" -ForegroundColor Yellow
  }

  if ($Foreground -or $InstallMode -eq "Foreground") {
    Write-Step "Pairing worker and starting in foreground..."
    if ($WorkerName) {
      & $workerBin connect --pairing-code $PairingCode --server-url $ServerUrl --name $WorkerName
    } else {
      & $workerBin connect --pairing-code $PairingCode --server-url $ServerUrl
    }
    exit $LASTEXITCODE
  }

  if (-not $LogDir) {
    $LogDir = Join-Path $InstallDir "logs"
  }

  Write-Step "Pairing worker..."
  if ($WorkerName) {
    & $workerBin connect --pairing-code $PairingCode --server-url $ServerUrl --no-start --name $WorkerName
  } else {
    & $workerBin connect --pairing-code $PairingCode --server-url $ServerUrl --no-start
  }
  if ($LASTEXITCODE -ne 0) {
    throw "worker pairing failed"
  }

  Write-Step "Installing and starting current-user worker startup..."
  & $workerBin service install --name $ServiceName --worker-path $workerBin --install-prefix $InstallDir --log-dir $LogDir
  if ($LASTEXITCODE -ne 0) {
    throw "worker current-user startup install failed"
  }

  Write-Host ""
  Write-Host ("════════════════════════════════════════════════════════════") -ForegroundColor Green
  Write-Host ("  ✨  wemux Worker 安装完成 · Install complete  ✨") -ForegroundColor Green
  Write-Host ("════════════════════════════════════════════════════════════") -ForegroundColor Green
  Write-Host ("Installed {0} into {1}" -f $packageName, $InstallDir) -ForegroundColor Green
  Write-Host ("Installed and started current-user worker startup: {0}" -f $ServiceName) -ForegroundColor Green
  Write-Host ("Runs as Windows user: {0}" -f $env:USERNAME)
  Write-Host "Admin required: no"
  Write-Host "Starts when this Windows user logs in."
  Write-Host ("Log directory: {0}" -f $LogDir)
  Write-Host ""
  Write-Host ("Command shim: {0}" -f $ShimPath)
  Write-Host ("wemux command: {0}" -f $WemuxCommandBin)
  if ($CommandBin -eq $ShimPath) {
    Write-Host "Tip: add $HOME\\AppData\\Local\\Vibemux\\bin to PATH to run the worker from any shell."
  }
  Write-Host ""
  Write-Host ("▶ 接下来 · Next steps") -ForegroundColor Cyan
  Write-Host ("  1. 打开执行中心，这台机器已经在线：{0}/execution" -f $ServerUrl)
  Write-Host ("  2. 常用命令（wemux）：") -ForegroundColor Cyan
  Write-Host ('     ' + $WemuxCommandBin + ' worker service status --name "' + $ServiceName + '"')
  Write-Host ('     ' + $WemuxCommandBin + ' worker service logs --name "' + $ServiceName + '" --follow')
  Write-Host ('     ' + $WemuxCommandBin + ' worker update --check')
  Write-Host ""
  Write-Host ("  3. 在本机打开 worker 控制台：") -ForegroundColor Cyan
  Write-Host ('     ' + $WemuxCommandBin + ' worker open')
  Write-Host ""
  Write-Host "Useful commands:"
  Write-Host ('  ' + $CommandBin + ' service status --name "' + $ServiceName + '"')
  Write-Host ('  ' + $CommandBin + ' service logs --name "' + $ServiceName + '" --follow')
  Write-Host ("  {0} update --check" -f $CommandBin)
} finally {
  Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
`
}

export const buildWorkerInstallScript = (serverUrl: string, manifest?: WorkerInstallerManifest | null) => {
  return `#!/usr/bin/env bash
set -euo pipefail

# ── 颜色与装饰：仅在终端输出时启用 ANSI 颜色，管道/重定向/日志场景自动降级为纯文本 ──
C_RESET=""
C_BOLD=""
C_GREEN=""
C_CYAN=""
C_YELLOW=""
C_RED=""
USE_COLOR_STDERR=0
if [[ -t 2 && -z "\${NO_COLOR:-}" && "\${TERM:-}" != "dumb" ]]; then
  USE_COLOR_STDERR=1
  C_RESET=$'\\033[0m'
  C_BOLD=$'\\033[1m'
  C_GREEN=$'\\033[32m'
  C_CYAN=$'\\033[36m'
  C_YELLOW=$'\\033[33m'
  C_RED=$'\\033[31m'
fi
USE_COLOR_STDOUT=0
if [[ -t 1 && -z "\${NO_COLOR:-}" && "\${TERM:-}" != "dumb" ]]; then
  USE_COLOR_STDOUT=1
  C_RESET=$'\\033[0m'
  C_BOLD=$'\\033[1m'
  C_GREEN=$'\\033[32m'
  C_CYAN=$'\\033[36m'
  C_YELLOW=$'\\033[33m'
  C_RED=$'\\033[31m'
fi

say_err() {
  if [[ "$USE_COLOR_STDERR" == "1" ]]; then
    printf '%s%s%s\\n' "$1" "$2" "$C_RESET" >&2
  else
    printf '%s\\n' "$2" >&2
  fi
}

say_out() {
  if [[ "$USE_COLOR_STDOUT" == "1" ]]; then
    printf '%s%s%s\\n' "$1" "$2" "$C_RESET"
  else
    printf '%s\\n' "$2"
  fi
}

print_rule_err() {
  if [[ "$USE_COLOR_STDERR" == "1" ]]; then
    printf '%s%s%s\\n' "$C_GREEN" "════════════════════════════════════════════════════════════" "$C_RESET" >&2
  fi
}

print_failure_banner() {
  local title="$1"
  local hint="$2"
  echo "" >&2
  printf '%s%s%s\\n' "$C_RED" "════════════════════════════════════════════════════════════" "$C_RESET" >&2
  say_err "$C_BOLD$C_RED" "  ✗ $title"
  printf '%s%s%s\\n' "$C_RED" "════════════════════════════════════════════════════════════" "$C_RESET" >&2
  say_err "$C_YELLOW" "$hint"
}

PAIRING_CODE=""
WORKER_NAME=""
INSTALL_DIR=""
SERVER_URL="${serverUrl}"
LOG_DIR=""
SERVICE_NAME=""
FOREGROUND="0"
STEP=0
TOTAL_STEPS=10
SHIM_DIR="\${HOME}/.local/bin"
SHIM_PATH=""
GLOBAL_SHIM_DIR="/usr/local/bin"
GLOBAL_SHIM_PATH=""
COMMAND_BIN=""
NODE_BIN=""

print_step() {
  STEP=$((STEP + 1))
  if [[ "$USE_COLOR_STDERR" == "1" ]]; then
    printf '%s==> [%s/%s]%s %s%s%s\\n' "$C_BOLD" "$STEP" "$TOTAL_STEPS" "$C_RESET" "$C_CYAN" "$1" "$C_RESET" >&2
  else
    printf '[%s/%s] %s\\n' "$STEP" "$TOTAL_STEPS" "$1" >&2
  fi
}

download_file() {
  local url="$1"
  local output="$2"
  local curl_status=0
  if [[ -t 2 ]]; then
    curl -fL --progress-bar "$url" -o "$output" || curl_status="$?"
  else
    curl -fsSL "$url" -o "$output" || curl_status="$?"
  fi

  if [[ "$curl_status" -eq 0 ]]; then
    return 0
  fi

  if [[ "$curl_status" -eq 23 ]]; then
    local output_dir
    output_dir="$(dirname "$output")"
    echo "" >&2
    echo "Download write failed while saving $url to $output." >&2
    echo "这通常不是服务端返回问题，而是本机无法继续写入下载目标。" >&2
    echo "Most common causes: disk full, inode exhaustion, or an unwritable temporary directory." >&2
    echo "" >&2
    echo "Suggested checks:" >&2
    echo "  df -h \"$output_dir\"" >&2
    echo "  df -i \"$output_dir\"" >&2
    echo "  ls -ld \"$output_dir\"" >&2
  fi

  return "$curl_status"
}

print_rule_err
say_err "$C_BOLD$C_CYAN" "wemux worker installer${manifest ? ` (${manifest.packageName}@${manifest.packageVersion})` : ''}"
${manifest?.commitSha ? `say_err "$C_CYAN" "Installer commit: ${manifest.commitSha}"` : ''}
print_rule_err
say_err "$C_CYAN" "Preparing this machine for wemux. This may take a few minutes on the first run."
echo "" >&2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pairing-code)
      PAIRING_CODE="\${2:-}"
      shift 2
      ;;
    --name)
      WORKER_NAME="\${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="\${2:-}"
      shift 2
      ;;
    --server-url)
      SERVER_URL="\${2:-}"
      shift 2
      ;;
    --log-dir)
      LOG_DIR="\${2:-}"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="\${2:-}"
      shift 2
      ;;
    --foreground)
      FOREGROUND="1"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  install-worker.sh --pairing-code <CODE> [options]

Options:
  --name <NAME>             Worker display name
  --install-dir <DIR>       Install prefix, default: ~/.wemux-worker or ~/.wemux-preview-worker
  --server-url <URL>        wemux server URL
  --log-dir <DIR>           Service log directory
  --service-name <NAME>     Service name, default: package name
  --foreground              Run in foreground instead of installing a service
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PAIRING_CODE" ]]; then
  echo "Missing required --pairing-code" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

load_nvm() {
  local nvm_dir="\${NVM_DIR:-\$HOME/.nvm}"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    export NVM_DIR="$nvm_dir"
    . "$nvm_dir/nvm.sh"
    return 0
  fi
  return 1
}

install_nvm() {
  local nvm_dir="\${NVM_DIR:-\$HOME/.nvm}"
  say_err "$C_YELLOW" "nvm is not installed. Installing nvm to $nvm_dir..."
  export NVM_DIR="$nvm_dir"
  mkdir -p "$NVM_DIR"
  PROFILE=/dev/null curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
}

run_installer_command() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
    return $?
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return $?
  fi

  echo "This command needs root privileges but sudo is not available: $*" >&2
  return 127
}

print_unzip_failure() {
  local log_path="$1"
  say_err "$C_RED" "unzip is required for wemux Mesh auto-download."
  echo "自动准备失败：缺少 unzip，wemux Mesh 无法自动下载并解压组件。" >&2
  if [[ -s "$log_path" ]]; then
    echo "" >&2
    echo "Installer output:" >&2
    tail -n 40 "$log_path" >&2 || true
  fi
  echo "" >&2
  echo "Manual fix, then rerun this installer:" >&2
  echo "  Debian/Ubuntu: apt-get update && apt-get install -y unzip" >&2
  echo "  Fedora:        dnf install -y unzip" >&2
  echo "  CentOS/RHEL:   yum install -y unzip" >&2
  echo "  Alpine:        apk add unzip" >&2
  echo "  Arch:          pacman -Sy --noconfirm unzip" >&2
}

install_unzip_with_package_manager() {
  local log_path="$1"

  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing unzip with apt-get..." >&2
    run_installer_command apt-get update >>"$log_path" 2>&1 &&
    run_installer_command apt-get install -y unzip >>"$log_path" 2>&1
    return $?
  fi

  if command -v dnf >/dev/null 2>&1; then
    echo "Installing unzip with dnf..." >&2
    run_installer_command dnf install -y unzip >>"$log_path" 2>&1
    return $?
  fi

  if command -v yum >/dev/null 2>&1; then
    echo "Installing unzip with yum..." >&2
    run_installer_command yum install -y unzip >>"$log_path" 2>&1
    return $?
  fi

  if command -v apk >/dev/null 2>&1; then
    echo "Installing unzip with apk..." >&2
    run_installer_command apk add unzip >>"$log_path" 2>&1
    return $?
  fi

  if command -v pacman >/dev/null 2>&1; then
    echo "Installing unzip with pacman..." >&2
    run_installer_command pacman -Sy --noconfirm unzip >>"$log_path" 2>&1
    return $?
  fi

  echo "No supported package manager found for installing unzip." >>"$log_path"
  return 127
}

ensure_unzip() {
  if [[ "$(uname -s 2>/dev/null || true)" != "Linux" ]]; then
    return 0
  fi

  if command -v unzip >/dev/null 2>&1; then
    say_err "$C_GREEN" "unzip is already available."
    return 0
  fi

  say_err "$C_YELLOW" "unzip is missing. Installing it before Mesh bootstrap..."
  local log_path
  log_path="$(mktemp "\${TMPDIR:-/tmp}/vibemux-unzip-install.XXXXXX")"
  if install_unzip_with_package_manager "$log_path" && command -v unzip >/dev/null 2>&1; then
    rm -f "$log_path"
    say_err "$C_GREEN" "unzip is ready."
    return 0
  fi

  print_unzip_failure "$log_path"
  rm -f "$log_path"
  exit 1
}

can_write_global_shim() {
  if [[ "\${VIBEMUX_INSTALL_GLOBAL_SHIM:-1}" == "0" ]]; then
    return 1
  fi

  if [[ "$(id -u)" == "0" ]]; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

install_global_shim() {
  GLOBAL_SHIM_PATH="$GLOBAL_SHIM_DIR/$BIN_NAME"
  if ! can_write_global_shim; then
    return 1
  fi

  run_installer_command mkdir -p "$GLOBAL_SHIM_DIR"
  run_installer_command ln -sfn "$WORKER_WRAPPER" "$GLOBAL_SHIM_PATH"
  run_installer_command ln -sfn "$INSTALL_DIR/bin/wemux" "$GLOBAL_SHIM_DIR/wemux"
}

worker_console_base_port() {
  if [[ "$PACKAGE_NAME" == "vibemux-worker-preview" || "$PACKAGE_NAME" == "wemux-worker-preview" ]]; then
    echo "48123"
    return 0
  fi

  echo "48100"
}

read_worker_health() {
  local base_port="$1"
  local offset
  for ((offset = 0; offset < 20; offset += 1)); do
    local port=$((base_port + offset))
    local payload
    payload="$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
    if [[ -n "$payload" && "$payload" == *'"service":"worker-local-server"'* ]]; then
      printf '%s' "$payload"
      return 0
    fi
  done

  return 1
}

is_worker_health_connected() {
  local payload="$1"
  node -e "const data = JSON.parse(process.argv[1]); process.exit(data && data.connected === true ? 0 : 1)" "$payload" >/dev/null 2>&1
}

wait_for_worker_cloud_connection() {
  if [[ "\${VIBEMUX_INSTALL_SKIP_CONNECT_CHECK:-0}" == "1" ]]; then
    say_err "$C_YELLOW" "Worker cloud connection verification skipped."
    return 0
  fi

  local base_port
  base_port="$(worker_console_base_port)"
  local last_health=""
  say_err "$C_CYAN" "Waiting for worker cloud connection..."
  local attempt
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    last_health="$(read_worker_health "$base_port" || true)"
    if [[ -n "$last_health" ]] && is_worker_health_connected "$last_health"; then
      say_err "$C_GREEN" "Worker cloud connection verified."
      return 0
    fi
    sleep 2
  done

  echo "" >&2
  printf '%s%s%s\\n' "$C_RED" "⚠ 未确认云端连接 · Cloud connection not confirmed" "$C_RESET" >&2
  echo "Worker service was installed, but cloud connection was not confirmed within 60 seconds." >&2
  echo "服务已安装，但 60 秒内没有确认已连接云端；请不要把这次安装视为完全成功。" >&2
  if [[ -n "$last_health" ]]; then
    echo "Last local worker health:" >&2
    echo "$last_health" >&2
  else
    echo "Local worker health endpoint did not respond on ports $base_port-$((base_port + 19))." >&2
  fi
  echo "" >&2
  echo "Diagnostics:" >&2
  echo "  $COMMAND_BIN service status --name \"$SERVICE_NAME\"" >&2
  echo "  $COMMAND_BIN service logs --name \"$SERVICE_NAME\" --follow" >&2
  echo "  curl -fsS http://127.0.0.1:$base_port/api/health" >&2
  echo "" >&2
  echo "Service status snapshot:" >&2
  "$COMMAND_BIN" service status --name "$SERVICE_NAME" >&2 || true
  echo "" >&2
  echo "Recent service logs:" >&2
  "$COMMAND_BIN" service logs --name "$SERVICE_NAME" --lines 120 >&2 || true
  return 1
}

ensure_node_22() {
  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ -n "$node_major" && "$node_major" -ge 22 ]]; then
      return 0
    fi
  fi

  if ! command -v nvm >/dev/null 2>&1; then
    load_nvm || install_nvm
    load_nvm || {
      echo "nvm was installed but could not be loaded from \${NVM_DIR:-\$HOME/.nvm}/nvm.sh" >&2
      exit 1
    }
  fi

  if command -v nvm >/dev/null 2>&1; then
    say_err "$C_YELLOW" "Detected Node.js < 22. Installing or activating Node.js 22 with nvm..."
    nvm install 22 >/dev/null
    nvm use 22 >/dev/null
    hash -r
  fi

  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ -n "$node_major" && "$node_major" -ge 22 ]]; then
      return 0
    fi
  fi

  local current_version="missing"
  if command -v node >/dev/null 2>&1; then
    current_version="$(node -v)"
  fi

  echo "Node.js 22 or newer is required. Current: $current_version" >&2
  echo "Recommended quick fix:" >&2
  echo '  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash' >&2
  echo '  export NVM_DIR="$HOME/.nvm"' >&2
  echo '  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >&2
  echo '  nvm install 22 && nvm use 22' >&2
  exit 1
}

print_step "Checking Node.js runtime..."
ensure_node_22
say_err "$C_GREEN" "Using Node.js $(node -v)."
NODE_BIN="$(command -v node)"
NODE_BIN_DIR="$(dirname "$NODE_BIN")"

print_step "Checking unzip dependency..."
ensure_unzip

print_step "Preparing installer workspace..."
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

MANIFEST_URL="$SERVER_URL/install/worker/manifest.json"
PACKAGE_URL="$SERVER_URL/install/worker/package.tgz"
MANIFEST_PATH="$TMP_DIR/manifest.json"
PACKAGE_PATH="$TMP_DIR/worker.tgz"

print_step "Downloading worker manifest..."
download_file "$MANIFEST_URL" "$MANIFEST_PATH"

print_step "Downloading worker package..."
download_file "$PACKAGE_URL" "$PACKAGE_PATH"

PACKAGE_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.packageName||'wemux-worker-preview')" "$MANIFEST_PATH")"
BIN_NAME="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.binName||data.packageName||'wemux-worker-preview')" "$MANIFEST_PATH")"

if [[ "$PACKAGE_NAME" == "vibemux-worker-preview" || "$PACKAGE_NAME" == "wemux-worker-preview" ]]; then
  WORKER_HOME="\${HOME}/.wemux-preview"
  RELEASE_CHANNEL="preview"
else
  WORKER_HOME="\${HOME}/.wemux"
  RELEASE_CHANNEL="production"
fi

if [[ -z "$INSTALL_DIR" ]]; then
  if [[ "$RELEASE_CHANNEL" == "preview" ]]; then
    INSTALL_DIR="\${HOME}/.wemux-preview-worker"
  else
    INSTALL_DIR="\${HOME}/.wemux-worker"
  fi
fi

mkdir -p "$INSTALL_DIR"
print_step "Installing $PACKAGE_NAME into $INSTALL_DIR..."
if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to extract the self-contained worker package" >&2
  exit 1
fi
PACKAGE_EXTRACT_DIR="$TMP_DIR/package-extract"
mkdir -p "$PACKAGE_EXTRACT_DIR"
tar -xzf "$PACKAGE_PATH" -C "$PACKAGE_EXTRACT_DIR"
PACKAGE_DIR="$INSTALL_DIR/lib/node_modules/$PACKAGE_NAME"
if [[ ! -f "$PACKAGE_EXTRACT_DIR/$PACKAGE_NAME/package.json" ]]; then
  echo "Extracted worker package is missing package.json" >&2
  exit 1
fi
mkdir -p "$(dirname "$PACKAGE_DIR")"
rm -rf "$PACKAGE_DIR"
mv "$PACKAGE_EXTRACT_DIR/$PACKAGE_NAME" "$PACKAGE_DIR"
mkdir -p "$INSTALL_DIR/bin"
for entry in \
  "vbx:vbx.mjs" \
  "vibemux:vibemux.mjs" \
  "wemux:wemux.mjs" \
  "$BIN_NAME:cli.mjs"; do
  shim_name="\${entry%%:*}"
  target_name="\${entry#*:}"
  rm -f "$INSTALL_DIR/bin/$shim_name"
  ln -s "../lib/node_modules/$PACKAGE_NAME/bin/$target_name" "$INSTALL_DIR/bin/$shim_name"
done

# 自包含包若在打包侧丢失可执行位（tar 直出场景），在此兜底恢复，
# 否则下方 -x 校验会误报 binary not found，mac/linux 直接 spawn 也会失败。
chmod +x "$PACKAGE_DIR/bin/"*.mjs 2>/dev/null || true

WORKER_BIN="$INSTALL_DIR/bin/$BIN_NAME"
if [[ ! -x "$WORKER_BIN" ]]; then
  echo "Installed worker binary not found at $WORKER_BIN" >&2
  exit 1
fi

WORKER_WRAPPER="$INSTALL_DIR/bin/$BIN_NAME-node-wrapper"
# 升级时旧 npm 安装会留下指向旧包目录的 node-wrapper 符号链接，包目录被替换后它已失效；
# 先移除，避免 cat > 顺着断链写入失败。
rm -f "$WORKER_WRAPPER"
cat > "$WORKER_WRAPPER" <<'EOF'
#!/usr/bin/env bash
export VIBEMUX_WORKER_EXECUTABLE_PATH="__VIBEMUX_WORKER_BIN__"
export VIBEMUX_WORKER_INSTALL_PREFIX="__VIBEMUX_INSTALL_DIR__"
export VIBEMUX_WORKER_HOME="__VIBEMUX_WORKER_HOME__"
export VIBEMUX_WORKER_RELEASE_CHANNEL="__VIBEMUX_RELEASE_CHANNEL__"
export PATH="__VIBEMUX_INSTALL_DIR__/bin:__VIBEMUX_NODE_BIN_DIR__:\${PATH:-}"
exec "__VIBEMUX_NODE_BIN__" "__VIBEMUX_WORKER_BIN__" "$@"
EOF
sed -i.bak -e "s#__VIBEMUX_NODE_BIN__#$NODE_BIN#g" -e "s#__VIBEMUX_NODE_BIN_DIR__#$NODE_BIN_DIR#g" -e "s#__VIBEMUX_WORKER_BIN__#$WORKER_BIN#g" -e "s#__VIBEMUX_INSTALL_DIR__#$INSTALL_DIR#g" -e "s#__VIBEMUX_WORKER_HOME__#$WORKER_HOME#g" -e "s#__VIBEMUX_RELEASE_CHANNEL__#$RELEASE_CHANNEL#g" "$WORKER_WRAPPER"
rm -f "$WORKER_WRAPPER.bak"
chmod +x "$WORKER_WRAPPER"

print_step "Creating user command shim..."
mkdir -p "$SHIM_DIR"
SHIM_PATH="$SHIM_DIR/$BIN_NAME"
ln -sfn "$WORKER_WRAPPER" "$SHIM_PATH"
# wemux 是品牌规范命令（与 web 控制台 / 文档一致）；长名 shim 保留用于兼容
ln -sfn "$INSTALL_DIR/bin/wemux" "$SHIM_DIR/wemux"
if install_global_shim; then
  COMMAND_BIN="$GLOBAL_SHIM_PATH"
else
  COMMAND_BIN="$BIN_NAME"
  case ":\${PATH}:" in
    *":$SHIM_DIR:"*) ;;
    *)
      COMMAND_BIN="$SHIM_PATH"
      ;;
  esac
fi

# 教程与提示统一使用 wemux 命令：优先 PATH 上的 wemux，否则给出完整路径
WEMUX_CMD="$INSTALL_DIR/bin/wemux"
if [[ -e "$GLOBAL_SHIM_DIR/wemux" ]]; then
  WEMUX_CMD="wemux"
elif [[ -e "$SHIM_DIR/wemux" ]]; then
  case ":\${PATH}:" in
    *":$SHIM_DIR:"*) WEMUX_CMD="wemux" ;;
  esac
fi

print_step "Bootstrapping Git and agent runtimes..."
# Runtime bootstrap 是增强步骤：失败不阻断安装，worker 主体仍可配对并运行。
if ! "$WORKER_WRAPPER" bootstrap --target base; then
  say_err "$C_YELLOW" "Runtime bootstrap failed; continuing installation. The worker can still run."
  say_err "$C_YELLOW" "Fix agent runtimes later with: $WEMUX_CMD worker doctor"
fi

if [[ "$FOREGROUND" == "1" ]]; then
  print_step "Pairing worker and starting in foreground..."
  if [[ -n "$WORKER_NAME" ]]; then
    exec "$WORKER_WRAPPER" connect --pairing-code "$PAIRING_CODE" --server-url "$SERVER_URL" --name "$WORKER_NAME"
  fi
  exec "$WORKER_WRAPPER" connect --pairing-code "$PAIRING_CODE" --server-url "$SERVER_URL"
fi

if [[ -z "$SERVICE_NAME" ]]; then
  SERVICE_NAME="$BIN_NAME"
fi

if [[ -z "$LOG_DIR" ]]; then
  LOG_DIR="$INSTALL_DIR/logs"
fi

run_pairing() {
  if [[ -n "$WORKER_NAME" ]]; then
    "$WORKER_WRAPPER" connect --pairing-code "$PAIRING_CODE" --server-url "$SERVER_URL" --no-start --name "$WORKER_NAME"
  else
    "$WORKER_WRAPPER" connect --pairing-code "$PAIRING_CODE" --server-url "$SERVER_URL" --no-start
  fi
}

print_step "Pairing worker..."
if ! run_pairing; then
  print_failure_banner "配对失败 · Worker pairing failed" "配对码可能已过期，或无法访问 $SERVER_URL。请重新获取配对码后再次运行安装命令；也可以运行 $WEMUX_CMD worker doctor 排查。"
  exit 1
fi

if [[ "$(uname -s 2>/dev/null || true)" == "Linux" ]]; then
  print_step "Enabling linger for user services to persist after SSH disconnect..."
  loginctl enable-linger || true
fi

print_step "Installing and starting worker service..."
if ! "$WORKER_WRAPPER" service install --name "$SERVICE_NAME" --worker-path "$WORKER_WRAPPER" --install-prefix "$INSTALL_DIR" --log-dir "$LOG_DIR"; then
  print_failure_banner "服务安装失败 · Service install failed" "请查看上面的错误信息，然后重新运行安装命令；也可以运行 $WEMUX_CMD worker doctor 排查。"
  exit 1
fi
wait_for_worker_cloud_connection

echo ""
echo "════════════════════════════════════════════════════════════"
say_out "$C_BOLD$C_GREEN" "  ✨  wemux Worker 安装完成 · Install complete  ✨"
echo "════════════════════════════════════════════════════════════"
say_out "$C_GREEN" "wemux Worker is installed, paired, and connected."
say_out "$C_GREEN" "Cloud connection: connected to $SERVER_URL"
say_out "$C_GREEN" "Worker service: $SERVICE_NAME"
say_out "$C_GREEN" "Installed $PACKAGE_NAME into $INSTALL_DIR"
say_out "$C_GREEN" "Installed and started service: $SERVICE_NAME"
say_out "$C_GREEN" "Log directory: $LOG_DIR"
echo ""
say_out "$C_CYAN" "Command shim: $SHIM_PATH"
if [[ -n "$GLOBAL_SHIM_PATH" && -e "$GLOBAL_SHIM_PATH" ]]; then
  say_out "$C_CYAN" "Global command: $GLOBAL_SHIM_PATH"
fi
say_out "$C_CYAN" "wemux command: $WEMUX_CMD"
if [[ "$COMMAND_BIN" == "$SHIM_PATH" ]]; then
  echo "Tip: add ~/.local/bin to PATH to run '$BIN_NAME' from any shell:"
  echo '  export PATH="$HOME/.local/bin:$PATH"'
fi
echo ""
echo "════════════════════════════════════════════════════════════"
say_out "$C_BOLD$C_GREEN" "  ▶ 接下来 · Next steps"
echo "════════════════════════════════════════════════════════════"
say_out "$C_CYAN" "  1. 打开执行中心，这台机器已经在线，可以直接派发任务："
say_out "$C_CYAN" "     $SERVER_URL/execution"
echo ""
say_out "$C_CYAN" "  2. 常用命令（wemux）："
say_out "$C_CYAN" "     $WEMUX_CMD worker service status --name \"$SERVICE_NAME\""
say_out "$C_CYAN" "     $WEMUX_CMD worker service logs --name \"$SERVICE_NAME\" --follow"
say_out "$C_CYAN" "     $WEMUX_CMD worker update --check"
echo ""
say_out "$C_CYAN" "  3. 在本机打开 worker 控制台："
say_out "$C_CYAN" "     $WEMUX_CMD worker open"
echo ""
echo "Useful commands:"
echo "  $COMMAND_BIN service status --name \"$SERVICE_NAME\""
echo "  $COMMAND_BIN service logs --name \"$SERVICE_NAME\" --follow"
echo "  $COMMAND_BIN update"
echo "  $COMMAND_BIN update --check"
`
}

export const registerWorkerInstallRoutes = (app: Hono) => {
  app.get('/install/worker/manifest.json', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    if (!manifest) {
      return c.json({ message: 'worker installer artifact not available' }, 404)
    }
    return c.json(manifest)
  })

  app.get('/install/worker/package.tgz', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    const packagePath = resolveWorkerInstallerPackagePath()
    if (!manifest || !existsSync(packagePath)) {
      return c.json({ message: 'worker installer artifact not available' }, 404)
    }

    const body = await readFile(packagePath)
    c.header('Content-Type', 'application/octet-stream')
    c.header('Content-Disposition', `attachment; filename="${manifest.fileName}"`)
    c.header('Cache-Control', 'no-store')
    return c.body(body)
  })

  app.get('/install/worker.sh', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    if (!manifest) {
      return c.text('worker installer artifact not available\n', 404)
    }

    const script = buildWorkerInstallScript(buildServerUrl(c.req.url, c.req.raw.headers), manifest)
    c.header('Content-Type', 'text/x-shellscript; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(script)
  })

  app.get('/install/worker.ps1', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    if (!manifest) {
      return c.text('worker installer artifact not available\n', 404)
    }

    const script = buildWorkerInstallPowerShellScript(buildServerUrl(c.req.url, c.req.raw.headers), manifest)
    c.header('Content-Type', 'text/plain; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(script)
  })

  app.get('/install', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    if (!manifest) {
      return c.text('worker installer artifact not available\n', 404)
    }

    const script = buildWorkerInstallBootstrapScript(buildServerUrl(c.req.url, c.req.raw.headers), manifest)
    c.header('Content-Type', 'text/x-shellscript; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(script)
  })

  app.get('/install.ps1', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    if (!manifest) {
      return c.text('worker installer artifact not available\n', 404)
    }

    const script = buildWorkerInstallPowerShellScript(buildServerUrl(c.req.url, c.req.raw.headers), manifest)
    c.header('Content-Type', 'text/plain; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(script)
  })

  app.get('/install/docker', async (c) => {
    const manifest = await loadWorkerInstallerManifest()
    if (!manifest) {
      return c.text('worker installer artifact not available\n', 404)
    }

    const script = buildWorkerDockerInstallScript(buildServerUrl(c.req.url, c.req.raw.headers), manifest)
    c.header('Content-Type', 'text/x-shellscript; charset=utf-8')
    c.header('Cache-Control', 'no-store')
    return c.body(script)
  })
}

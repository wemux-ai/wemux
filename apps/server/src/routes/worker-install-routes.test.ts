import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import {
  buildWorkerDockerInstallScript,
  buildWorkerInstallBootstrapScript,
  buildWorkerInstallPowerShellScript,
  buildWorkerInstallScript,
  registerWorkerInstallRoutes,
} from './worker-install-routes'

test('buildWorkerInstallScript installs production workers into the production prefix by default', () => {
  const script = buildWorkerInstallScript('https://wemux.ai', {
    packageName: 'vibemux-worker',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker',
    fileName: 'vibemux-worker-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
    commitSha: 'abcdef1234567890',
  })

  assert.match(script, /wemux worker installer \(vibemux-worker@0\.3\.30\)/)
  assert.match(script, /Installer commit: abcdef1234567890/)
  assert.match(script, /PACKAGE_NAME="\$\(node -e /)
  assert.match(script, /INSTALL_DIR="\$\{HOME\}\/\.vibemux-worker"/)
  assert.match(script, /WORKER_WRAPPER="\$INSTALL_DIR\/bin\/\$BIN_NAME-node-wrapper"/)
  assert.match(script, /export VIBEMUX_WORKER_EXECUTABLE_PATH="__VIBEMUX_WORKER_BIN__"/)
  assert.match(script, /export VIBEMUX_WORKER_INSTALL_PREFIX="__VIBEMUX_INSTALL_DIR__"/)
  assert.match(script, /WORKER_HOME="\$\{HOME\}\/\.vibemux"/)
  assert.match(script, /RELEASE_CHANNEL="production"/)
  assert.match(script, /export VIBEMUX_WORKER_HOME="__VIBEMUX_WORKER_HOME__"/)
  assert.match(script, /export VIBEMUX_WORKER_RELEASE_CHANNEL="__VIBEMUX_RELEASE_CHANNEL__"/)
  assert.match(script, /NODE_BIN_DIR="\$\(dirname "\$NODE_BIN"\)"/)
  assert.match(script, /export PATH="__VIBEMUX_INSTALL_DIR__\/bin:__VIBEMUX_NODE_BIN_DIR__:\$\{PATH:-\}"/)
  assert.match(script, /exec "__VIBEMUX_NODE_BIN__" "__VIBEMUX_WORKER_BIN__" "\$@"/)
  assert.match(script, /__VIBEMUX_NODE_BIN_DIR__#\$NODE_BIN_DIR#g/)
  assert.match(script, /__VIBEMUX_INSTALL_DIR__#\$INSTALL_DIR#g/)
  assert.match(script, /GLOBAL_SHIM_DIR="\/usr\/local\/bin"/)
  assert.match(script, /VIBEMUX_INSTALL_GLOBAL_SHIM:-1/)
  assert.match(script, /install_global_shim\(\)/)
  assert.match(script, /run_installer_command ln -sfn "\$WORKER_WRAPPER" "\$GLOBAL_SHIM_PATH"/)
  assert.match(script, /Global command: \$GLOBAL_SHIM_PATH/)
  assert.match(script, /TOTAL_STEPS=10/)
  assert.match(script, /ensure_unzip\(\)/)
  assert.match(script, /print_step "Checking unzip dependency\.\.\."/)
  assert.match(script, /run_installer_command apt-get update >>"\$log_path" 2>&1 &&\n    run_installer_command apt-get install -y unzip/)
  assert.match(script, /unzip is required for wemux Mesh auto-download\./)
  assert.match(script, /Debian\/Ubuntu: apt-get update && apt-get install -y unzip/)
  assert.ok(script.indexOf('print_step "Checking unzip dependency..."') < script.indexOf('print_step "Bootstrapping Git and agent runtimes..."'))
  assert.match(script, /connect --pairing-code "\$PAIRING_CODE" --server-url "\$SERVER_URL" --no-start/)
  assert.match(script, /service install --name "\$SERVICE_NAME" --worker-path "\$WORKER_WRAPPER" --install-prefix "\$INSTALL_DIR" --log-dir "\$LOG_DIR"/)
  assert.match(script, /wait_for_worker_cloud_connection\(\)/)
  assert.match(script, /Worker service was installed, but cloud connection was not confirmed within 60 seconds\./)
  assert.match(script, /Service status snapshot:/)
  assert.match(script, /Recent service logs:/)
  assert.match(script, /Most common causes: disk full, inode exhaustion, or an unwritable temporary directory\./)
  assert.match(script, /df -h "\$output_dir"/)
  assert.match(script, /wemux Worker is installed, paired, and connected\./)
  assert.doesNotMatch(script, /nohup/)
})

test('buildWorkerInstallScript keeps the preview prefix for preview packages', () => {
  const script = buildWorkerInstallScript('https://wemux.xyz', {
    packageName: 'vibemux-worker-preview',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker-preview',
    fileName: 'vibemux-worker-preview-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
  })

  assert.match(script, /if \[\[ "\$PACKAGE_NAME" == "vibemux-worker-preview" \|\| "\$PACKAGE_NAME" == "wemux-worker-preview" \]\]/)
  assert.match(script, /INSTALL_DIR="\$\{HOME\}\/\.vibemux-preview-worker"/)
  assert.match(script, /WORKER_HOME="\$\{HOME\}\/\.vibemux-preview"/)
  assert.match(script, /RELEASE_CHANNEL="preview"/)
})

test('buildWorkerInstallScript installs and loads nvm when Node.js is missing', () => {
  const script = buildWorkerInstallScript('https://wemux.xyz', {
    packageName: 'vibemux-worker-preview',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker-preview',
    fileName: 'vibemux-worker-preview-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
  })

  assert.match(script, /install_nvm\(\)/)
  assert.match(script, /nvm is not installed\. Installing nvm to \$nvm_dir/)
  assert.match(script, /PROFILE=\/dev\/null curl -fsSL https:\/\/raw\.githubusercontent\.com\/nvm-sh\/nvm\/v0\.40\.3\/install\.sh \| PROFILE=\/dev\/null bash/)
  assert.match(script, /load_nvm \|\| install_nvm/)
  assert.match(script, /load_nvm \|\| \{/)
  assert.match(script, /nvm install 22 >\/dev\/null/)
  assert.match(script, /echo '  export NVM_DIR="\$HOME\/\.nvm"' >&2/)
  assert.match(script, /echo '  \[ -s "\$NVM_DIR\/nvm\.sh" \] && \. "\$NVM_DIR\/nvm\.sh"' >&2/)
})

test('buildWorkerInstallBootstrapScript downloads the real installer before executing it', () => {
  const script = buildWorkerInstallBootstrapScript('https://wemux.xyz', {
    packageName: 'vibemux-worker-preview',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker-preview',
    fileName: 'vibemux-worker-preview-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
    commitSha: 'bootstrapsha123',
  })

  assert.match(script, /wemux worker installer bootstrap \(vibemux-worker-preview@0\.3\.30\)/)
  assert.match(script, /Installer commit: bootstrapsha123/)
  assert.match(script, /mktemp "\$\{TMPDIR:-\/tmp\}\/wemux-worker-install\.XXXXXX"/)
  assert.match(script, /curl -fsSL "https:\/\/wemux\.xyz\/install\/worker\.sh" -o "\$TMP_SCRIPT"/)
  assert.match(script, /exec bash "\$TMP_SCRIPT" "\$@"/)
})

test('buildWorkerInstallPowerShellScript installs Windows workers in current-user mode', () => {
  const script = buildWorkerInstallPowerShellScript('https://wemux.ai', {
    packageName: 'vibemux-worker',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker',
    fileName: 'vibemux-worker-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
    commitSha: 'powershellsha123',
  })

  assert.match(script, /wemux worker installer \(vibemux-worker@0\.3\.30\)/)
  assert.match(script, /Installer commit: powershellsha123/)
  assert.match(script, /param\(/)
  assert.match(script, /\[ValidateSet\("CurrentUser", "Foreground"\)\]/)
  assert.match(script, /\$InstallMode = "CurrentUser"/)
  assert.match(script, /Install mode: \$InstallMode \(runs as current Windows user: \$env:USERNAME; admin not required\)\./)
  assert.match(script, /Invoke-WebRequest -UseBasicParsing -Uri \$manifestUrl -OutFile \$manifestPath/)
  assert.match(script, /Stopping existing \{0\} service before upgrade/)
  assert.match(script, /service stop --name \$ServiceName/)
  assert.match(script, /worker-supervisor\.pid/)
  assert.match(script, /Stop-Process -Id \$pidValue -Force -ErrorAction SilentlyContinue/)
  assert.match(script, /Join-Path \$InstallDir \(\$binName \+ "\.cmd"\)/)
  assert.match(script, /Join-Path \(Join-Path \$InstallDir "lib"\) "node_modules"\) \$packageName/)
  assert.match(script, /Join-Path \(Join-Path \$packageDir "node_modules"\) "\.bin"/)
  assert.match(script, /worker package extraction failed with exit code/)
  assert.doesNotMatch(script, /npm install worker package/)
  assert.doesNotMatch(script, /npm is required/)
  assert.match(script, /tar is required to extract the self-contained worker package/)
  assert.match(script, /\$env:VIBEMUX_WORKER_INSTALL_PREFIX = \$InstallDir/)
  assert.match(script, /\$legacyWorkerHome = Join-Path \$HOME "\.vibemux"/)
  assert.match(script, /Test-Path \$legacyWorkerHome/)
  assert.match(script, /Join-Path \$HOME "\.wemux"/)
  assert.match(script, /\$env:VIBEMUX_WORKER_RELEASE_CHANNEL = "production"/)
  assert.match(script, /Installing and starting current-user worker startup/)
  assert.match(script, /service install --name \$ServiceName --worker-path \$workerBin --install-prefix \$InstallDir --log-dir \$LogDir/)
  assert.match(script, /worker current-user startup install failed/)
  assert.match(script, /Installed and started current-user worker startup/)
  assert.match(script, /Runs as Windows user/)
  assert.match(script, /Admin required: no/)
  assert.match(script, /Starts when this Windows user logs in\./)
  assert.match(script, /\$ShimDir = Join-Path \$HOME "AppData\\Local\\Vibemux\\bin"/)
})

test('buildWorkerDockerInstallScript starts a self-contained Docker worker', () => {
  const script = buildWorkerDockerInstallScript('https://wemux.ai', {
    packageName: 'vibemux-worker',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker',
    fileName: 'vibemux-worker-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
  })

  assert.match(script, /command -v docker >\/dev\/null 2>&1/)
  assert.match(script, /docker version >\/dev\/null 2>&1/)
  assert.match(script, /docker context show/)
  assert.match(script, /uname -s 2>\/dev\/null/)
  assert.match(script, /systemctl start docker/)
  assert.match(script, /service docker start/)
  assert.match(script, /docker rm -f "\$CONTAINER_NAME"/)
  assert.match(script, /run -d/)
  assert.match(script, /--cap-add NET_ADMIN/)
  assert.match(script, /--device \/dev\/net\/tun/)
  assert.match(script, /apt-get install -y --no-install-recommends curl ca-certificates unzip/)
  assert.match(script, /-v "\$VOLUME_NAME:\$WORKER_HOME"/)
  assert.match(script, /-e "HOME=\$WORKER_HOME"/)
  assert.match(script, /-e "VIBEMUX_WORKER_INSTALL_PREFIX=\$WORKER_HOME\/install"/)
  assert.match(script, /-e VIBEMUX_WORKER_AUTO_UPDATE=1/)
  assert.match(script, /WORKER_PORT="48100"/)
  assert.match(script, /-e VIBEMUX_WORKER_RELEASE_CHANNEL=production/)
  assert.match(script, /-e VIBEMUX_WORKER_RESTART_STRATEGY=docker/)
  assert.match(script, /VIBEMUX_INSTALL_URL=\$SERVER_URL\/install/)
  assert.match(script, /mkdir -p "\$VIBEMUX_WORKER_HOME" "\$VIBEMUX_WORKER_INSTALL_PREFIX"/)
  assert.match(script, /--install-dir "\$VIBEMUX_WORKER_INSTALL_PREFIX" --foreground/)
  assert.match(script, /--server-url "\$VIBEMUX_CLOUD_URL"/)
  assert.match(script, /curl -fsSL "\$VIBEMUX_INSTALL_URL" \| bash -s --/)
  assert.doesNotMatch(script, /pnpm worker:docker:dev/)
})

test('buildWorkerDockerInstallScript keeps preview channel and port isolated', () => {
  const script = buildWorkerDockerInstallScript('https://wemux.xyz', {
    packageName: 'vibemux-worker-preview',
    packageVersion: '0.3.30',
    binName: 'vibemux-worker-preview',
    fileName: 'vibemux-worker-preview-0.3.30.tgz',
    builtAt: '2026-06-27T00:00:00.000Z',
  })

  assert.match(script, /WORKER_PORT="48123"/)
  assert.match(script, /-e VIBEMUX_WORKER_RELEASE_CHANNEL=preview/)
})

test('registerWorkerInstallRoutes serves the short install alias', async () => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-worker-install-route-'))
  const previousInstallerDir = process.env.VIBEMUX_WORKER_INSTALLER_DIR
  process.env.VIBEMUX_WORKER_INSTALLER_DIR = installDir

  try {
    await writeFile(path.join(installDir, 'manifest.json'), `${JSON.stringify({
      packageName: 'vibemux-worker',
      packageVersion: '0.2.70',
      binName: 'vibemux-worker',
      fileName: 'vibemux-worker-0.2.70.tgz',
      builtAt: new Date().toISOString(),
    })}\n`)
    await writeFile(path.join(installDir, 'package.tgz'), 'fake')

    const app = new Hono()
    registerWorkerInstallRoutes(app)

    const response = await app.request('https://wemux.ai/install')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type')?.includes('text/x-shellscript'), true)
    const script = await response.text()
    assert.match(script, /curl -fsSL "https:\/\/wemux\.ai\/install\/worker\.sh" -o "\$TMP_SCRIPT"/)
    assert.doesNotMatch(script, /Node\.js 22 or newer is required/)
  } finally {
    if (previousInstallerDir === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_DIR
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_DIR = previousInstallerDir
    }
    await rm(installDir, { recursive: true, force: true })
  }
})

test('registerWorkerInstallRoutes serves the direct worker installer script', async () => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-worker-install-route-worker-sh-'))
  const previousInstallerDir = process.env.VIBEMUX_WORKER_INSTALLER_DIR
  process.env.VIBEMUX_WORKER_INSTALLER_DIR = installDir

  try {
    await writeFile(path.join(installDir, 'manifest.json'), `${JSON.stringify({
      packageName: 'vibemux-worker',
      packageVersion: '0.2.70',
      binName: 'vibemux-worker',
      fileName: 'vibemux-worker-0.2.70.tgz',
      builtAt: new Date().toISOString(),
    })}\n`)
    await writeFile(path.join(installDir, 'package.tgz'), 'fake')

    const app = new Hono()
    registerWorkerInstallRoutes(app)

    const response = await app.request('https://wemux.ai/install/worker.sh')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type')?.includes('text/x-shellscript'), true)
    const script = await response.text()
    assert.match(script, /wemux worker installer \(vibemux-worker@0\.2\.70\)/)
    assert.match(script, /Node\.js 22 or newer is required/)
  } finally {
    if (previousInstallerDir === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_DIR
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_DIR = previousInstallerDir
    }
    await rm(installDir, { recursive: true, force: true })
  }
})

test('registerWorkerInstallRoutes serves the powershell install alias', async () => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-worker-install-route-ps1-'))
  const previousInstallerDir = process.env.VIBEMUX_WORKER_INSTALLER_DIR
  process.env.VIBEMUX_WORKER_INSTALLER_DIR = installDir

  try {
    await writeFile(path.join(installDir, 'manifest.json'), `${JSON.stringify({
      packageName: 'vibemux-worker',
      packageVersion: '0.2.70',
      binName: 'vibemux-worker',
      fileName: 'vibemux-worker-0.2.70.tgz',
      builtAt: new Date().toISOString(),
    })}\n`)
    await writeFile(path.join(installDir, 'package.tgz'), 'fake')

    const app = new Hono()
    registerWorkerInstallRoutes(app)

    const response = await app.request('https://wemux.ai/install.ps1')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type')?.includes('text/plain'), true)
    assert.match(await response.text(), /ServerUrl = "https:\/\/wemux\.ai"/)
  } finally {
    if (previousInstallerDir === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_DIR
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_DIR = previousInstallerDir
    }
    await rm(installDir, { recursive: true, force: true })
  }
})

test('registerWorkerInstallRoutes serves the docker install alias', async () => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-worker-install-route-docker-'))
  const previousInstallerDir = process.env.VIBEMUX_WORKER_INSTALLER_DIR
  process.env.VIBEMUX_WORKER_INSTALLER_DIR = installDir

  try {
    await writeFile(path.join(installDir, 'manifest.json'), `${JSON.stringify({
      packageName: 'vibemux-worker',
      packageVersion: '0.2.70',
      binName: 'vibemux-worker',
      fileName: 'vibemux-worker-0.2.70.tgz',
      builtAt: new Date().toISOString(),
    })}\n`)
    await writeFile(path.join(installDir, 'package.tgz'), 'fake')

    const app = new Hono()
    registerWorkerInstallRoutes(app)

    const response = await app.request('https://wemux.ai/install/docker')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type')?.includes('text/x-shellscript'), true)
    const script = await response.text()
    assert.match(script, /SERVER_URL="https:\/\/wemux.ai"/)
    assert.match(script, /docker "\$\{docker_args\[@\]\}"/)
    assert.match(script, /VIBEMUX_WORKER_AUTO_UPDATE=1/)
  } finally {
    if (previousInstallerDir === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_DIR
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_DIR = previousInstallerDir
    }
    await rm(installDir, { recursive: true, force: true })
  }
})

test('registerWorkerInstallRoutes keeps Docker host installer requests on http', async () => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-worker-install-route-docker-host-'))
  const previousInstallerDir = process.env.VIBEMUX_WORKER_INSTALLER_DIR
  process.env.VIBEMUX_WORKER_INSTALLER_DIR = installDir

  try {
    await writeFile(path.join(installDir, 'manifest.json'), `${JSON.stringify({
      packageName: 'vibemux-worker',
      packageVersion: '0.2.70',
      binName: 'vibemux-worker',
      fileName: 'vibemux-worker-0.2.70.tgz',
      builtAt: new Date().toISOString(),
    })}\n`)
    await writeFile(path.join(installDir, 'package.tgz'), 'fake')

    const app = new Hono()
    registerWorkerInstallRoutes(app)

    const response = await app.request('http://host.docker.internal:18989/install')
    assert.equal(response.status, 200)
    assert.match(await response.text(), /curl -fsSL "http:\/\/host\.docker\.internal:18989\/install\/worker\.sh" -o "\$TMP_SCRIPT"/)
  } finally {
    if (previousInstallerDir === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_DIR
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_DIR = previousInstallerDir
    }
    await rm(installDir, { recursive: true, force: true })
  }
})

test('generated installer runs without a worker name on macOS bash', { skip: process.platform !== 'darwin' ? 'macOS-only installer smoke test' : false }, async () => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), 'vibemux-worker-install-smoke-'))

  try {
    const packageName = 'vibemux-worker-preview'
    const packageRoot = path.join(installDir, packageName)
    const packageBinDir = path.join(packageRoot, 'bin')
    const serverRoot = path.join(installDir, 'server')
    const workerArtifactDir = path.join(serverRoot, 'install', 'worker')
    const workerLogPath = path.join(installDir, 'worker-invocations.log')
    const scriptPath = path.join(installDir, 'install.sh')
    const targetInstallDir = path.join(installDir, 'target')
    const fakeHomeDir = path.join(installDir, 'home')
    const fakeShimPath = path.join(fakeHomeDir, '.local', 'bin', 'vibemux-worker-preview')
    const serverUrl = pathToFileURL(serverRoot).href

    await mkdir(packageBinDir, { recursive: true })
    await mkdir(workerArtifactDir, { recursive: true })
    await mkdir(fakeHomeDir, { recursive: true })
    await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: 'vibemux-worker-preview',
      version: '0.0.0-smoke',
      type: 'module',
      bin: { 'vibemux-worker-preview': 'bin/cli.mjs' },
    }, null, 2)}\n`)
    await writeFile(path.join(packageBinDir, 'cli.mjs'), `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'

appendFileSync(process.env.FAKE_WORKER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
`)
    await chmod(path.join(packageBinDir, 'cli.mjs'), 0o755)
    await writeFile(path.join(packageBinDir, 'vbx.mjs'), '#!/usr/bin/env node\n')
    await writeFile(path.join(packageBinDir, 'vibemux.mjs'), '#!/usr/bin/env node\n')
    await writeFile(path.join(packageBinDir, 'wemux.mjs'), '#!/usr/bin/env node\n')
    await writeFile(path.join(packageBinDir, 'node-wrapper.mjs'), '#!/usr/bin/env node\n')

    const packedFileName = `${packageName}-0.0.0-smoke.tgz`
    const archivePath = path.join(workerArtifactDir, 'package.tgz')
    const pack = spawnSync('tar', ['-czf', archivePath, '-C', installDir, packageName], {
      encoding: 'utf8',
    })
    assert.equal(pack.status, 0, pack.stderr)
    await writeFile(path.join(workerArtifactDir, 'manifest.json'), `${JSON.stringify({
      packageName: 'vibemux-worker-preview',
      packageVersion: '0.0.0-smoke',
      binName: 'vibemux-worker-preview',
      fileName: packedFileName,
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`)
    await writeFile(scriptPath, buildWorkerInstallScript(serverUrl, {
      packageName: 'vibemux-worker-preview',
      packageVersion: '0.0.0-smoke',
      binName: 'vibemux-worker-preview',
      fileName: packedFileName,
      builtAt: new Date().toISOString(),
    }))
    await chmod(scriptPath, 0o755)

    const install = spawnSync('bash', [
      scriptPath,
      '--pairing-code',
      'TESTPAIR',
      '--install-dir',
      targetInstallDir,
      '--service-name',
      'fake-vibemux-worker',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_WORKER_LOG: workerLogPath,
        HOME: fakeHomeDir,
        VIBEMUX_INSTALL_GLOBAL_SHIM: '0',
        VIBEMUX_INSTALL_SKIP_CONNECT_CHECK: '1',
      },
    })

    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`)
    assert.match(install.stderr, /^wemux worker installer \(vibemux-worker-preview@0\.0\.0-smoke\)\nPreparing this machine for wemux\. This may take a few minutes on the first run\.\n\n/)
    assert.match(install.stderr, /\[1\/10\] Checking Node\.js runtime/)
    assert.match(install.stderr, /\[2\/10\] Checking unzip dependency/)
    assert.match(install.stderr, /\[10\/10\] Installing and starting worker service/)
    assert.doesNotMatch(`${install.stdout}\n${install.stderr}`, /npm install/)
    assert.match(install.stderr, /Worker cloud connection verification skipped\./)
    assert.match(install.stdout, /wemux Worker is installed, paired, and connected\./)
    assert.match(install.stdout, /Cloud connection: connected to file:\/\//)
    assert.match(install.stdout, /Worker service: fake-vibemux-worker/)
    assert.match(install.stdout, new RegExp(`Command shim: ${fakeShimPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(install.stdout, /export PATH="\$HOME\/\.local\/bin:\$PATH"/)
    assert.match(install.stdout, /Useful commands:\n  \/.*\/\.local\/bin\/vibemux-worker-preview service status --name fake-vibemux-worker/)
    assert.match(install.stdout, /vibemux-worker-preview update\n/)
    assert.match(install.stdout, /vibemux-worker-preview update --check/)
    assert.doesNotMatch(`${install.stdout}\n${install.stderr}`, /unbound variable/)

    const shimResult = spawnSync(fakeShimPath, ['update', '--check'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_WORKER_LOG: workerLogPath,
        HOME: fakeHomeDir,
      },
    })
    assert.equal(shimResult.status, 0, `${shimResult.stdout}\n${shimResult.stderr}`)

    const invocations = (await readFile(workerLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])

    assert.deepEqual(invocations[0], ['bootstrap', '--target', 'base'])
    assert.deepEqual(invocations[1], ['connect', '--pairing-code', 'TESTPAIR', '--server-url', serverUrl, '--no-start'])
    assert.deepEqual(invocations[2]?.slice(0, 4), ['service', 'install', '--name', 'fake-vibemux-worker'])
    assert.match(invocations[2]?.[5] ?? '', /vibemux-worker-preview-node-wrapper$/)
    assert.deepEqual(invocations[3], ['update', '--check'])
  } finally {
    await rm(installDir, { recursive: true, force: true })
  }
})

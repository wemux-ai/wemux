import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorRecord } from '@shared/types'
import { getExecutorMeshDisplayState, getExecutorMeshRemotePeers } from './executor-mesh-display'
import { getMeshRemediation } from './mesh-remediation'

const executorWithMesh = (mesh: NonNullable<ExecutorRecord['presence']>['mesh']) => ({
  presence: {
    connectedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    runningTaskIds: [],
    queuedTaskIds: [],
    mesh,
  },
})

test('shows joined instead of degraded when mesh has an IP and no remote peers', () => {
  const state = getExecutorMeshDisplayState(executorWithMesh({
    enabled: true,
    status: 'degraded',
    meshNodeId: '2154642186',
    meshIpv4: '10.144.92.26/24',
    meshHostname: 'MBP',
    routeMode: 'unknown',
    peers: [{
      meshNodeId: '2154642186',
      meshIpv4: '10.144.92.26/24',
      routeMode: 'unknown',
      lastSeenAt: new Date().toISOString(),
    }],
    reportedAt: new Date().toISOString(),
  }), 'zh')

  assert.equal(state.label, 'Mesh 已入网')
  assert.equal(state.detailLabel, '已入网')
  assert.equal(state.tone, 'info')
  assert.equal(state.peerCountLabel, '等待其它节点')
})

test('excludes the local EasyTier row from remote peers', () => {
  const mesh = {
    enabled: true,
    status: 'ready' as const,
    meshNodeId: 'local-node',
    meshIpv4: '10.144.1.10/24',
    peers: [
      {
        meshNodeId: 'local-node',
        meshIpv4: '10.144.1.10/24',
        routeMode: 'unknown' as const,
        lastSeenAt: new Date().toISOString(),
      },
      {
        meshNodeId: 'remote-node',
        meshIpv4: '10.144.1.11/24',
        routeMode: 'direct' as const,
        lastSeenAt: new Date().toISOString(),
      },
    ],
    reportedAt: new Date().toISOString(),
  }

  assert.deepEqual(getExecutorMeshRemotePeers(mesh).map((peer) => peer.meshNodeId), ['remote-node'])
})

test('shows config pending when a macOS mesh helper still uses old enrollment', () => {
  const mesh = {
    enabled: true,
    status: 'degraded' as const,
    meshIpv4: '10.144.92.26/24',
    meshHostname: 'MBP',
    errorMessage: 'Mesh helper is using 10.144.92.26/24, but the control plane assigned 10.144.161.94. Restart or reinstall the mesh helper to apply the latest mesh enrollment.',
    peers: [],
    reportedAt: new Date().toISOString(),
  }
  const executor = {
    platform: 'darwin',
    version: '0.3.3-preview.172',
    workspaceRoot: '/Users/x/.vibemux-preview',
    presence: {
      lastHeartbeatAt: new Date().toISOString(),
      runningTaskIds: [],
      queuedTaskIds: [],
      mesh,
    },
  } satisfies Pick<ExecutorRecord, 'platform' | 'presence' | 'version' | 'workspaceRoot'>

  const state = getExecutorMeshDisplayState(executor, 'zh')
  assert.equal(state.label, 'Mesh 配置待应用')
  assert.equal(state.detailLabel, '待应用')
  assert.equal(state.tone, 'warning')

  const remediation = getMeshRemediation(executor)
  assert.match(remediation?.command ?? '', /mesh install-service/)
  assert.equal(remediation?.title, '需要在这台 Mac 的终端执行一次授权命令')
  assert.ok(remediation?.command.includes("WEMUX_WORKER_HOME='/Users/x/.vibemux-preview'"))
})

test('suggests installing unzip when mesh auto download cannot extract EasyTier', () => {
  const executor = {
    platform: 'linux',
    version: '0.3.32-preview.b2c5504c',
    workspaceRoot: '/root/.vibemux-preview',
    presence: {
      lastHeartbeatAt: new Date().toISOString(),
      runningTaskIds: [],
      queuedTaskIds: [],
      mesh: {
        enabled: true,
        status: 'error' as const,
        errorMessage: 'EasyTier auto download requires unzip. Install unzip or set WEMUX_EASYTIER_CORE_PATH and WEMUX_EASYTIER_CLI_PATH.',
        peers: [],
        reportedAt: new Date().toISOString(),
      },
    },
  } satisfies Pick<ExecutorRecord, 'platform' | 'presence' | 'version' | 'workspaceRoot'>

  const remediation = getMeshRemediation(executor, 'zh')
  assert.equal(remediation?.kind, 'missing-unzip')
  assert.match(remediation?.title ?? '', /缺少 unzip/)
  assert.match(remediation?.description ?? '', /WEMUX_EASYTIER_CORE_PATH/)
  assert.match(remediation?.command ?? '', /apt-get install -y unzip/)
  assert.match(remediation?.command ?? '', /dnf install -y unzip/)
  assert.match(remediation?.command ?? '', /apk add unzip/)
})

test('suggests Windows worker restart instead of Linux unzip command on win32', () => {
  const executor = {
    platform: 'win32',
    version: '0.3.80-preview.5b2108dc',
    workspaceRoot: 'C:/Users/X/.vibemux-preview',
    presence: {
      lastHeartbeatAt: new Date().toISOString(),
      runningTaskIds: [],
      queuedTaskIds: [],
      mesh: {
        enabled: true,
        status: 'error' as const,
        errorMessage: 'EasyTier auto download requires unzip. Install unzip or set WEMUX_EASYTIER_CORE_PATH and WEMUX_EASYTIER_CLI_PATH.',
        peers: [],
        reportedAt: new Date().toISOString(),
      },
    },
  } satisfies Pick<ExecutorRecord, 'platform' | 'presence' | 'version' | 'workspaceRoot'>

  const remediation = getMeshRemediation(executor, 'zh')
  assert.equal(remediation?.kind, 'windows-mesh-extract')
  assert.match(remediation?.title ?? '', /Windows Mesh/)
  assert.match(remediation?.description ?? '', /PowerShell/)
  assert.match(remediation?.command ?? '', /wemux\.cmd/)
  assert.match(remediation?.command ?? '', /worker service restart --name "wemux-worker-preview"/)
  assert.doesNotMatch(remediation?.command ?? '', /apt-get|dnf|yum|apk/)
})

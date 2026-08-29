import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLocalDirectTerminalWsUrl,
  buildLocalTerminalMeshBridgeWsUrl,
  buildPublicTerminalGatewayWsUrl,
  canUseLocalDirectTerminal,
  resolveActiveTerminalTransport,
  resolveLocalDirectTerminalUnavailableDetail,
  resolveTerminalRemoteTransportKind,
  resolveTerminalRemoteTransportUnavailableDetail,
  resolveTerminalRemoteTransportName,
  resolveTerminalTransportOptions,
  resolveTerminalTransportLabel,
  shouldUseExecutorRealtimeBaseUrlForTerminal,
} from './workspace-terminal-local-direct'

test('shouldUseExecutorRealtimeBaseUrlForTerminal accepts a usable realtime endpoint', () => {
  assert.equal(shouldUseExecutorRealtimeBaseUrlForTerminal({
    executorRealtimeBaseUrl: 'https://hk.example.com',
    currentPageOrigin: 'https://pre.example.com',
  }), true)
  assert.equal(shouldUseExecutorRealtimeBaseUrlForTerminal({
    executorRealtimeBaseUrl: 'http://127.0.0.1:8989',
    currentPageOrigin: 'http://127.0.0.1:15173',
  }), true)
})

test('shouldUseExecutorRealtimeBaseUrlForTerminal rejects endpoints that can never connect', () => {
  // Empty / malformed values must fall back to the page origin rather than
  // producing a URL the browser will refuse.
  assert.equal(shouldUseExecutorRealtimeBaseUrlForTerminal({ executorRealtimeBaseUrl: '' }), false)
  assert.equal(shouldUseExecutorRealtimeBaseUrlForTerminal({ executorRealtimeBaseUrl: '   ' }), false)
  assert.equal(shouldUseExecutorRealtimeBaseUrlForTerminal({
    executorRealtimeBaseUrl: 'not a url',
    currentPageOrigin: 'https://pre.example.com',
  }), false)

  // ws:// from an https page is blocked as mixed content, so never even try.
  assert.equal(shouldUseExecutorRealtimeBaseUrlForTerminal({
    executorRealtimeBaseUrl: 'http://10.0.0.5:8989',
    currentPageOrigin: 'https://pre.example.com',
  }), false)
})

test('canUseLocalDirectTerminal requires executor id match', () => {
  assert.equal(canUseLocalDirectTerminal({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-1',
  }), true)
  assert.equal(canUseLocalDirectTerminal({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-2',
  }), false)
  assert.equal(canUseLocalDirectTerminal({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: undefined,
  }), false)
})

test('buildLocalDirectTerminalWsUrl appends one-time ticket', () => {
  assert.equal(
    buildLocalDirectTerminalWsUrl({
      ticket: 'ticket-1',
      wsUrl: 'ws://127.0.0.1:48100/api/terminal-direct/ws',
    }),
    'ws://127.0.0.1:48100/api/terminal-direct/ws?ticket=ticket-1',
  )
})

test('buildLocalTerminalMeshBridgeWsUrl wraps signed mesh terminal targets through local worker', () => {
  assert.equal(
    buildLocalTerminalMeshBridgeWsUrl({
      ticket: 'ticket-1',
      targetWsUrl: 'ws://10.144.9.20:39080/api/terminal-mesh/ws?vmx_mesh_token=token',
      endpoint: {
        environment: 'preview',
        port: 48123,
        baseUrl: 'http://127.0.0.1:48123',
        healthUrl: 'http://127.0.0.1:48123/api/health',
        statusUrl: 'http://127.0.0.1:48123/api/status',
        doctorUrl: 'http://127.0.0.1:48123/api/doctor',
        terminalDirectWsUrl: 'ws://127.0.0.1:48123/api/terminal-direct/ws',
      },
    }),
    'ws://127.0.0.1:48123/api/terminal-mesh-bridge/ws?target=ws%3A%2F%2F10.144.9.20%3A39080%2Fapi%2Fterminal-mesh%2Fws%3Fvmx_mesh_token%3Dtoken&ticket=ticket-1',
  )
})

test('buildLocalTerminalMeshBridgeWsUrl rejects non-mesh terminal targets', () => {
  assert.equal(buildLocalTerminalMeshBridgeWsUrl({
    ticket: 'ticket-1',
    targetWsUrl: 'ws://127.0.0.1:39080/api/terminal-mesh/ws?vmx_mesh_token=token',
  }), '')
  assert.equal(buildLocalTerminalMeshBridgeWsUrl({
    ticket: 'ticket-1',
    targetWsUrl: 'ws://8.8.8.8:39080/api/terminal-mesh/ws?vmx_mesh_token=token',
  }), '')
  assert.equal(buildLocalTerminalMeshBridgeWsUrl({
    ticket: 'ticket-1',
    targetWsUrl: 'wss://10.144.9.20:39080/api/terminal-mesh/ws?vmx_mesh_token=token',
  }), '')
})

test('buildPublicTerminalGatewayWsUrl appends one-time ticket', () => {
  assert.equal(
    buildPublicTerminalGatewayWsUrl({
      ticket: 'ticket-1',
      wsUrl: 'wss://hk1.wemux.xyz/api/terminal-public/ws',
    }),
    'wss://hk1.wemux.xyz/api/terminal-public/ws?ticket=ticket-1',
  )
  assert.equal(buildPublicTerminalGatewayWsUrl({
    ticket: 'ticket-1',
    wsUrl: 'wss://hk1.wemux.xyz/api/terminal-direct/ws',
  }), '')
})

test('resolveTerminalTransportLabel labels local direct transport', () => {
  assert.equal(resolveTerminalTransportLabel('local-direct'), '本地连接')
  assert.equal(resolveTerminalTransportLabel('public-gateway'), '公网终端入口')
  assert.equal(resolveTerminalTransportLabel('server', 'gateway'), '公网终端入口')
  assert.equal(resolveTerminalTransportLabel('server', 'tunnel'), '云端 Tunnel')
})

test('resolveTerminalRemoteTransportKind distinguishes direct gateway from control-plane tunnel', () => {
  assert.equal(resolveTerminalRemoteTransportKind({
    executorRealtimeBaseUrl: 'https://node-1.wemux.xyz',
    currentPageOrigin: 'https://app.wemux.xyz',
  }), 'gateway')
  assert.equal(resolveTerminalRemoteTransportKind({
    executorRealtimeBaseUrl: 'wss://app.wemux.localtest.me:15173',
    currentPageOrigin: 'http://app.wemux.localtest.me:15173',
  }), 'tunnel')
  assert.equal(resolveTerminalRemoteTransportKind({
    executorRealtimeBaseUrl: undefined,
    currentPageOrigin: 'https://app.wemux.xyz',
  }), 'tunnel')
})

test('resolveTerminalRemoteTransportName returns readable remote transport labels', () => {
  assert.equal(resolveTerminalRemoteTransportName('gateway'), '公网终端入口')
  assert.equal(resolveTerminalRemoteTransportName('tunnel'), '云端 Tunnel')
})

test('resolveTerminalRemoteTransportUnavailableDetail explains missing remote modes', () => {
  assert.equal(resolveTerminalRemoteTransportUnavailableDetail('gateway'), '当前节点未配置公网终端入口，终端仍通过云端 Tunnel 中转')
  assert.equal(resolveTerminalRemoteTransportUnavailableDetail('tunnel'), '当前节点已走公网终端入口，这个终端暂时没有单独的云端 Tunnel 入口')
})

test('resolveLocalDirectTerminalUnavailableDetail explains why local direct is disabled', () => {
  assert.equal(resolveLocalDirectTerminalUnavailableDetail({
    workspaceExecutorId: undefined,
    localWorkerExecutorId: 'executor-1',
  }), '当前工作区还没有绑定执行节点')
  assert.equal(resolveLocalDirectTerminalUnavailableDetail({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: undefined,
  }), '浏览器未探测到本机 Worker，或本机 Worker 还没有连上 executor')
  assert.equal(resolveLocalDirectTerminalUnavailableDetail({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-2',
  }), '当前工作区运行在其他 executor 上，本机 Worker 只能直连自己承载的工作区')
})

test('resolveActiveTerminalTransport prefers lowest successful latency in auto mode', () => {
  assert.equal(resolveActiveTerminalTransport({
    preference: 'auto',
    serverAvailable: true,
    localDirectAvailable: true,
    transportProbes: {
      server: { status: 'ok', roundTripMs: 82 },
      'local-direct': { status: 'ok', roundTripMs: 12 },
    },
  }), 'local-direct')

  assert.equal(resolveActiveTerminalTransport({
    preference: 'auto',
    serverAvailable: true,
    localDirectAvailable: true,
    transportProbes: {
      server: { status: 'ok', roundTripMs: 18 },
      'local-direct': { status: 'error', error: 'blocked' },
      'public-gateway': { status: 'ok', roundTripMs: 32 },
    },
  }), 'server')

  assert.equal(resolveActiveTerminalTransport({
    preference: 'auto',
    serverAvailable: true,
    localDirectAvailable: false,
    publicGatewayAvailable: true,
    transportProbes: {
      server: { status: 'ok', roundTripMs: 82 },
      'public-gateway': { status: 'ok', roundTripMs: 24 },
    },
  }), 'public-gateway')
})

test('resolveActiveTerminalTransport respects manual preference when available', () => {
  assert.equal(resolveActiveTerminalTransport({
    preference: 'server',
    serverAvailable: true,
    localDirectAvailable: true,
    publicGatewayAvailable: true,
    transportProbes: {
      server: { status: 'ok', roundTripMs: 40 },
      'local-direct': { status: 'ok', roundTripMs: 5 },
      'public-gateway': { status: 'ok', roundTripMs: 22 },
    },
  }), 'server')
})

test('resolveTerminalTransportOptions exposes latency and unavailable state', () => {
  const options = resolveTerminalTransportOptions({
    remoteTransport: 'tunnel',
    localDirectUnavailableDetail: '当前工作区运行在其他 executor 上，本机 Worker 只能直连自己承载的工作区',
    publicGatewayDetail: '公网终端入口直连',
    serverUrl: 'wss://example.test/terminal',
    transportProbes: {
      server: { status: 'ok', roundTripMs: 18 },
      'local-direct': { status: 'unavailable' },
      'public-gateway': { status: 'ok', roundTripMs: 28 },
    },
  })

  assert.deepEqual(options.map((option) => ({
    transport: option.transport,
    available: option.available,
    latencyMs: option.latencyMs,
    status: option.status,
  })), [
    {
      transport: 'local-direct',
      available: false,
      latencyMs: undefined,
      status: 'unavailable',
    },
    {
      transport: 'public-gateway',
      available: true,
      latencyMs: 28,
      status: 'ok',
    },
    {
      transport: 'server',
      available: true,
      latencyMs: 18,
      status: 'ok',
    },
  ])

  assert.equal(options[0]?.detail, '当前工作区运行在其他 executor 上，本机 Worker 只能直连自己承载的工作区')
  assert.equal(options[1]?.label, '公网终端入口')
  assert.equal(options[2]?.label, '云端 Tunnel')
})

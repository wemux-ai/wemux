import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  buildPreviewMeshBridgeHost,
  handlePreviewMeshBridgeHttp,
  isAllowedMeshBridgeTargetHost,
  validateTerminalMeshBridgeTarget,
  validatePreviewMeshBridgeTarget,
} from './preview-mesh-bridge'

const listen = async (server: http.Server, host = '127.0.0.1', port = 0) => {
  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

const close = async (server: http.Server) => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

const requestText = async (params: {
  port: number
  path: string
  host?: string
  headers?: http.OutgoingHttpHeaders
}) => await new Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
  const request = http.request({
    hostname: '127.0.0.1',
    port: params.port,
    path: params.path,
    method: 'GET',
    headers: {
      ...(params.host ? { host: params.host } : {}),
      ...(params.headers ?? {}),
    },
  }, (response) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    response.on('end', () => {
      resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
      })
    })
  })
  request.on('error', reject)
  request.end()
})

test('validatePreviewMeshBridgeTarget accepts only signed mesh preview proxy URLs', () => {
  assert.equal(validatePreviewMeshBridgeTarget('https://preview.example.com'), null)
  assert.equal(validatePreviewMeshBridgeTarget('http://10.144.9.20:39080/api/preview-mesh/http/preview-1/app'), null)
  assert.equal(validatePreviewMeshBridgeTarget('http://127.0.0.1:39080/api/preview-mesh/http/preview-1/app?vmx_mesh_token=token'), null)
  assert.equal(validatePreviewMeshBridgeTarget('http://8.8.8.8:39080/api/preview-mesh/http/preview-1/app?vmx_mesh_token=token'), null)

  const validated = validatePreviewMeshBridgeTarget('http://10.144.9.20:39080/api/preview-mesh/http/preview-1/app?vmx_mesh_token=token')
  assert.equal(validated?.previewId, 'preview-1')
  assert.equal(validated?.initialPath, '/app')
})

test('isAllowedMeshBridgeTargetHost accepts private mesh targets and rejects public or loopback hosts', () => {
  assert.equal(isAllowedMeshBridgeTargetHost('10.144.9.20'), true)
  assert.equal(isAllowedMeshBridgeTargetHost('172.16.2.10'), true)
  assert.equal(isAllowedMeshBridgeTargetHost('192.168.1.20'), true)
  assert.equal(isAllowedMeshBridgeTargetHost('node-a.internal'), true)
  assert.equal(isAllowedMeshBridgeTargetHost('127.0.0.1'), false)
  assert.equal(isAllowedMeshBridgeTargetHost('169.254.1.1'), false)
  assert.equal(isAllowedMeshBridgeTargetHost('8.8.8.8'), false)
})

test('validateTerminalMeshBridgeTarget accepts only signed mesh terminal proxy URLs', () => {
  assert.equal(validateTerminalMeshBridgeTarget('ws://10.144.9.20:39080/api/terminal-mesh/ws'), null)
  assert.equal(validateTerminalMeshBridgeTarget('http://10.144.9.20:39080/api/terminal-mesh/ws?vmx_mesh_token=token'), null)
  assert.equal(validateTerminalMeshBridgeTarget('ws://127.0.0.1:39080/api/terminal-mesh/ws?vmx_mesh_token=token'), null)

  const validated = validateTerminalMeshBridgeTarget('ws://10.144.9.20:39080/api/terminal-mesh/ws?vmx_mesh_token=token')
  assert.equal(validated?.hostname, '10.144.9.20')
})

test('preview mesh bridge bootstraps a cookie and proxies follow-up requests through stored target', async () => {
  const previousAllowLoopback = process.env.VIBEMUX_MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS
  process.env.VIBEMUX_MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS = '1'
  const meshProxy = http.createServer((request, response) => {
    response.end(`mesh:${request.url}`)
  })
  const meshProxyPort = await listen(meshProxy)
  const localBridge = http.createServer(async (request, response) => {
    if (await handlePreviewMeshBridgeHttp(request, response)) {
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  const localBridgePort = await listen(localBridge)
  const target = `http://127.0.0.1:${meshProxyPort}/api/preview-mesh/http/preview-1/app?vmx_mesh_token=token`
  const bridgeHost = `${buildPreviewMeshBridgeHost('preview-1')}:${localBridgePort}`

  try {
    const bootstrap = await requestText({
      port: localBridgePort,
      host: bridgeHost,
      path: `/api/preview-mesh-bridge/bootstrap?target=${encodeURIComponent(target)}`,
    })
    assert.equal(bootstrap.statusCode, 302)
    assert.equal(bootstrap.headers.location, '/app')
    const cookie = Array.isArray(bootstrap.headers['set-cookie'])
      ? bootstrap.headers['set-cookie'][0]
      : bootstrap.headers['set-cookie']
    assert.ok(cookie?.includes('vmx_mesh_bridge_target='))

    const proxied = await requestText({
      port: localBridgePort,
      host: bridgeHost,
      path: '/assets/main.js?cache=1',
      headers: {
        cookie,
      },
    })
    assert.equal(proxied.statusCode, 200)
    assert.equal(proxied.body, 'mesh:/api/preview-mesh/http/preview-1/assets/main.js?cache=1&vmx_mesh_token=token')
  } finally {
    if (typeof previousAllowLoopback === 'string') {
      process.env.VIBEMUX_MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS = previousAllowLoopback
    } else {
      delete process.env.VIBEMUX_MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS
    }
    await close(localBridge)
    await close(meshProxy)
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspacePreviewSourceSummary } from '@shared/types'
import { resolveListPreviewAddress } from './workspace-list-preview-address'

const baseSource = (overrides: Partial<WorkspacePreviewSourceSummary> = {}): WorkspacePreviewSourceSummary => ({
  publicUrl: 'https://myapp-preview--host1.wemux.xyz/',
  previewHost: 'myapp-preview--host1.wemux.xyz',
  appUrl: 'http://127.0.0.1:3000/',
  port: 3000,
  primary: true,
  ...overrides,
})

test('resolveListPreviewAddress: tunnel 模式显示隧道域名', () => {
  const addr = resolveListPreviewAddress({
    source: baseSource(),
    remoteTransport: 'tunnel',
  })
  assert.equal(addr.transport, 'tunnel')
  assert.equal(addr.url, 'https://myapp-preview--host1.wemux.xyz/')
  assert.equal(addr.host, 'myapp-preview--host1.wemux.xyz')
  assert.equal(addr.port, 3000)
  assert.equal(addr.transportLabel, '隧道预览域名')
})

test('resolveListPreviewAddress: gateway 模式显示公网预览域名', () => {
  const addr = resolveListPreviewAddress({
    source: baseSource({ publicUrl: 'https://myapp.wemux.xyz/', previewHost: 'myapp.wemux.xyz' }),
    remoteTransport: 'gateway',
  })
  assert.equal(addr.transport, 'gateway')
  assert.equal(addr.host, 'myapp.wemux.xyz')
  assert.equal(addr.transportLabel, '公网预览域名')
})

test('resolveListPreviewAddress: 不因本地能直连就显示 127.0.0.1(列表页不跑 probe)', () => {
  // 即使 source.appUrl 是 loopback,列表页也不擅自降级为 local-direct
  const addr = resolveListPreviewAddress({
    source: baseSource({ appUrl: 'http://127.0.0.1:3000/' }),
    remoteTransport: 'tunnel',
  })
  assert.equal(addr.transport, 'tunnel')
  assert.notEqual(addr.host, '127.0.0.1')
  assert.equal(addr.host, 'myapp-preview--host1.wemux.xyz')
})

test('resolveListPreviewAddress: 不同端口有独立隧道域名,切换端口时地址跟着变', () => {
  const source3000 = baseSource({ port: 3000, publicUrl: 'https://myapp-preview--host1-3000.wemux.xyz/' })
  const source8080 = baseSource({ port: 8080, publicUrl: 'https://myapp-preview--host1-8080.wemux.xyz/', primary: false })
  const remoteTransport = 'tunnel' as const

  const addr3000 = resolveListPreviewAddress({ source: source3000, remoteTransport })
  const addr8080 = resolveListPreviewAddress({ source: source8080, remoteTransport })

  assert.notEqual(addr3000.url, addr8080.url)
  assert.equal(addr3000.host, 'myapp-preview--host1-3000.wemux.xyz')
  assert.equal(addr8080.host, 'myapp-preview--host1-8080.wemux.xyz')
})

test('resolveListPreviewAddress: 保留备注', () => {
  const addr = resolveListPreviewAddress({
    source: baseSource({ note: 'Web' }),
    remoteTransport: 'tunnel',
  })
  assert.equal(addr.note, 'Web')
})

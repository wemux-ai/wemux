import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseLocalDirectPreview } from '../../lib/browser-local-network-access'
import {
  buildPreviewIframeUrl,
  resolveActivePreviewTransport,
  resolveAuthorizedPreviewCopyUrl,
  resolveDirectPreviewAccessUrl,
  resolvePreviewAddressNavigation,
  resolvePreviewCookieAccessWarning,
  resolvePreviewDisplayPath,
  resolvePreviewDisplayUrl,
  resolvePreviewDomainLabel,
  resolvePreviewNavigationBridgePath,
  resolvePublicDirectExternalReason,
  resolveRemotePreviewBaseUrl,
  resolveSelectedPreviewSourceRemoteIframeUrl,
  resolvePreviewShareActionLabel,
  resolvePreviewShareCopyLabel,
  resolvePreviewTransportName,
  resolvePreviewTransportOptions,
  resolvePreviewNavigationUrl,
  resolvePreviewStableAccessUrl,
  resolvePreviewTransportLabel,
  resolveVisiblePreviewError,
  shouldReconnectWaitingRemotePreview,
  shouldOpenRemotePreviewForTransport,
} from './workspace-preview-panel'

test('resolvePreviewDisplayPath strips bootstrap query params from the visible path', () => {
  assert.equal(
    resolvePreviewDisplayPath('https://preview.wemux.localtest.me/dashboard?vmx_viewer_token=token-123&vmx_transport=direct&tab=logs#tail'),
    '/dashboard?tab=logs#tail',
  )
})

test('resolvePreviewDisplayUrl strips bootstrap query params from the visible address', () => {
  assert.equal(
    resolvePreviewDisplayUrl('https://preview.wemux.localtest.me/dashboard?vmx_viewer_token=token-123&vmx_transport=direct&tab=logs#tail'),
    'https://preview.wemux.localtest.me/dashboard?tab=logs#tail',
  )
})

test('buildPreviewIframeUrl does not carry bootstrap query params into cookie-backed navigation urls', () => {
  assert.equal(
    buildPreviewIframeUrl('https://preview.wemux.localtest.me/?vmx_viewer_token=token-123&vmx_transport=direct', '/settings?mode=compact'),
    'https://preview.wemux.localtest.me/settings?mode=compact',
  )
})

test('resolvePreviewNavigationUrl keeps bootstrap query params only for the first iframe load', () => {
  const bootstrapIframeUrl = 'https://preview.wemux.localtest.me/?vmx_viewer_token=token-123'
  const cookieBackedBaseUrl = 'https://preview.wemux.localtest.me'

  assert.equal(
    resolvePreviewNavigationUrl({
      bootstrapIframeUrl,
      cookieBackedBaseUrl,
      previewPath: '/settings?mode=compact',
      useBootstrapToken: true,
    }),
    'https://preview.wemux.localtest.me/settings?mode=compact&vmx_viewer_token=token-123',
  )

  assert.equal(
    resolvePreviewNavigationUrl({
      bootstrapIframeUrl,
      cookieBackedBaseUrl,
      previewPath: '/settings?mode=compact',
      useBootstrapToken: false,
    }),
    'https://preview.wemux.localtest.me/settings?mode=compact',
  )
})

test('resolvePreviewStableAccessUrl ignores rotating preview bootstrap params', () => {
  assert.equal(
    resolvePreviewStableAccessUrl('https://preview.wemux.localtest.me/?vmx_viewer_token=token-123&vmx_transport=direct&tab=logs#tail'),
    'https://preview.wemux.localtest.me/?tab=logs#tail',
  )
  assert.equal(
    resolvePreviewStableAccessUrl('https://preview.wemux.localtest.me/?vmx_viewer_token=token-456&vmx_transport=direct&tab=logs#tail'),
    'https://preview.wemux.localtest.me/?tab=logs#tail',
  )
})

test('resolvePreviewAddressNavigation supports browser-like jumps for same-origin full urls', () => {
  assert.deepEqual(
    resolvePreviewAddressNavigation({
      value: 'https://preview.wemux.localtest.me/settings?mode=compact#editor',
      bootstrapIframeUrl: 'https://preview.wemux.localtest.me/?vmx_viewer_token=token-123&vmx_transport=direct',
      cookieBackedBaseUrl: 'https://preview.wemux.localtest.me',
      useBootstrapToken: true,
    }),
    {
      previewPath: '/settings?mode=compact#editor',
      iframeUrl: 'https://preview.wemux.localtest.me/settings?mode=compact&vmx_viewer_token=token-123#editor',
      currentPreviewUrl: 'https://preview.wemux.localtest.me/settings?mode=compact#editor',
      displayUrl: 'https://preview.wemux.localtest.me/settings?mode=compact#editor',
    },
  )
})

test('resolvePreviewAddressNavigation supports direct jumps to external urls', () => {
  assert.deepEqual(
    resolvePreviewAddressNavigation({
      value: 'https://example.com/docs?ref=preview#top',
      bootstrapIframeUrl: 'https://preview.wemux.localtest.me/?vmx_viewer_token=token-123&vmx_transport=direct',
      cookieBackedBaseUrl: 'https://preview.wemux.localtest.me',
      useBootstrapToken: true,
    }),
    {
      previewPath: '/docs?ref=preview#top',
      iframeUrl: 'https://example.com/docs?ref=preview#top',
      currentPreviewUrl: 'https://example.com/docs?ref=preview#top',
      displayUrl: 'https://example.com/docs?ref=preview#top',
    },
  )
})

test('resolvePreviewAddressNavigation rebases the current path when the preview transport changes', () => {
  assert.deepEqual(
    resolvePreviewAddressNavigation({
      value: 'http://154.222.24.117:3000/dashboard?tab=logs',
      bootstrapIframeUrl: 'https://workspace-preview.wemux.xyz/?vmx_viewer_token=token-123',
      cookieBackedBaseUrl: 'https://workspace-preview.wemux.xyz/',
      useBootstrapToken: false,
      rebaseAbsoluteUrl: true,
    }),
    {
      previewPath: '/dashboard?tab=logs',
      iframeUrl: 'https://workspace-preview.wemux.xyz/dashboard?tab=logs',
      currentPreviewUrl: 'https://workspace-preview.wemux.xyz/dashboard?tab=logs',
      displayUrl: 'https://workspace-preview.wemux.xyz/dashboard?tab=logs',
    },
  )
})

test('resolvePreviewNavigationBridgePath accepts only same-origin preview navigation', () => {
  assert.deepEqual(
    resolvePreviewNavigationBridgePath({
      href: 'https://preview.wemux.localtest.me/conversations/abc?vmx_viewer_token=token-123&vmx_transport=direct&tab=chat#latest',
      previewBaseUrl: 'https://preview.wemux.localtest.me/',
    }),
    {
      path: '/conversations/abc?tab=chat#latest',
      url: 'https://preview.wemux.localtest.me/conversations/abc?tab=chat#latest',
    },
  )

  assert.equal(
    resolvePreviewNavigationBridgePath({
      href: 'https://evil.example.com/conversations/abc',
      previewBaseUrl: 'https://preview.wemux.localtest.me/',
    }),
    null,
  )
})

test('resolveDirectPreviewAccessUrl rewrites loopback preview source urls to executor network hosts', () => {
  assert.equal(
    resolveDirectPreviewAccessUrl({
      sourceAppUrl: 'http://localhost:3000/dashboard?tab=logs#tail',
      targetHost: '203.0.113.10',
    }),
    'http://203.0.113.10:3000/dashboard?tab=logs#tail',
  )
})

test('resolveDirectPreviewAccessUrl skips non-loopback source urls', () => {
  assert.equal(
    resolveDirectPreviewAccessUrl({
      sourceAppUrl: 'https://preview.wemux.xyz/dashboard',
      targetHost: '192.168.1.8',
    }),
    '',
  )
})

test('resolvePreviewCookieAccessWarning flags loopback preview urls inside hosted pages', () => {
  assert.deepEqual(
    resolvePreviewCookieAccessWarning({
      previewUrl: 'http://127.0.0.1:3005/chat',
      currentPageHostname: 'wemux.xyz',
    }),
    {
      reason: 'loopback',
      host: '127.0.0.1:3005',
      origin: 'http://127.0.0.1:3005',
      isHostedWemuxPage: true,
    },
  )
})

test('resolvePreviewCookieAccessWarning flags ip and nip preview urls', () => {
  assert.equal(
    resolvePreviewCookieAccessWarning({
      previewUrl: 'https://preview-abc.wemux.xyz/chat',
      currentPageHostname: 'wemux.xyz',
    }),
    null,
  )
  assert.equal(
    resolvePreviewCookieAccessWarning({
      previewUrl: 'http://203.0.113.10:3005/chat',
      currentPageHostname: 'wemux.xyz',
    })?.reason,
    'ip',
  )
  assert.equal(
    resolvePreviewCookieAccessWarning({
      previewUrl: 'http://preview-abc.127.0.0.1.nip.io:48123/chat',
      currentPageHostname: 'wemux.xyz',
    })?.reason,
    'nip',
  )
})

test('canUseLocalDirectPreview returns true when loopback source and executor ids match', () => {
  assert.equal(canUseLocalDirectPreview({
    sourceAppUrl: 'http://127.0.0.1:5173/',
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-1',
  }), true)
})

test('canUseLocalDirectPreview returns false when executor ids do not match', () => {
  assert.equal(canUseLocalDirectPreview({
    sourceAppUrl: 'http://127.0.0.1:5173/',
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-2',
  }), false)
})

test('canUseLocalDirectPreview returns false for non-loopback source urls', () => {
  assert.equal(canUseLocalDirectPreview({
    sourceAppUrl: 'https://preview.wemux.xyz/dashboard',
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-1',
  }), false)
})

test('canUseLocalDirectPreview returns false when the local worker executor id is unavailable', () => {
  assert.equal(canUseLocalDirectPreview({
    sourceAppUrl: 'http://localhost:5173/',
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: undefined,
  }), false)
})

test('resolvePreviewTransportLabel returns 本地连接 for localhost previews', () => {
  assert.equal(resolvePreviewTransportLabel(null, 'local-direct'), '本地连接')
})

test('resolvePreviewTransportLabel returns 公网 IP 直连 for public direct previews', () => {
  assert.equal(resolvePreviewTransportLabel(null, 'public-direct'), '公网 IP 直连')
})

test('resolvePreviewTransportLabel returns 隧道预览域名 for tunnel previews', () => {
  assert.equal(resolvePreviewTransportLabel({
    accessMode: 'tunnel',
  } as any), '隧道预览域名')
})

test('resolvePreviewTransportLabel returns 公网预览域名 for public proxy previews', () => {
  assert.equal(resolvePreviewTransportLabel({
    accessMode: 'public-proxy',
  } as any), '公网预览域名')
})

test('resolvePreviewTransportName returns readable labels for all transports', () => {
  assert.equal(resolvePreviewTransportName('local-direct'), '本地连接')
  assert.equal(resolvePreviewTransportName('public-direct'), '公网 IP 直连')
  assert.equal(resolvePreviewTransportName('mesh-bridge'), 'Mesh Bridge')
  assert.equal(resolvePreviewTransportName('gateway'), '公网预览域名')
  assert.equal(resolvePreviewTransportName('tunnel'), '隧道预览域名')
})

test('resolveSelectedPreviewSourceRemoteIframeUrl keeps per-port remote preview iframe urls', () => {
  assert.equal(resolveSelectedPreviewSourceRemoteIframeUrl({
    selectedPreviewSource: {
      id: 'mastra',
      appUrl: 'http://127.0.0.1:4111/',
      accessUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/?vmx_viewer_token=token-4111',
      primary: false,
    },
    fallbackIframeUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/?vmx_viewer_token=token-3005',
  }), 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/?vmx_viewer_token=token-4111')
})

test('resolveRemotePreviewBaseUrl keeps selected per-port preview domains for remote navigation', () => {
  assert.equal(resolveRemotePreviewBaseUrl({
    preview: {
      publicUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/',
    } as any,
    selectedPreviewSource: {
      id: 'mastra',
      appUrl: 'http://127.0.0.1:4111/',
      accessUrl: 'http://mastra-shopping--preview--b5dfdk-4111.wemux.localtest.me:18989/?vmx_viewer_token=token-4111',
      primary: false,
    },
    iframeUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/?vmx_viewer_token=token-3005',
  }), 'http://mastra-shopping--preview--b5dfdk-4111.wemux.localtest.me:18989/?vmx_viewer_token=token-4111')
})

test('resolveAuthorizedPreviewCopyUrl keeps selected per-port preview domains authorized for copy', () => {
  assert.equal(resolveAuthorizedPreviewCopyUrl({
    preview: {
      publicUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/',
    } as any,
    selectedPreviewSource: {
      id: 'mastra',
      appUrl: 'http://127.0.0.1:4111/',
      accessUrl: 'http://mastra-shopping--preview--b5dfdk-4111.wemux.localtest.me:18989/?vmx_viewer_token=token-4111',
      primary: false,
    },
    iframeUrl: 'http://mastra-shopping--preview--b5dfdk.wemux.localtest.me:18989/?vmx_viewer_token=token-3005',
  }), 'http://mastra-shopping--preview--b5dfdk-4111.wemux.localtest.me:18989/?vmx_viewer_token=token-4111')
})

test('resolveRemotePreviewBaseUrl prefers preview domain over local app url fallback', () => {
  assert.equal(resolveRemotePreviewBaseUrl({
    preview: {
      publicUrl: 'https://preview-abc.wemux.xyz/',
    } as any,
    selectedPreviewSource: {
      id: 'primary',
      appUrl: 'http://127.0.0.1:3005/',
      accessUrl: 'http://127.0.0.1:3005/',
      primary: true,
    },
    iframeUrl: 'https://preview-abc.wemux.xyz/?vmx_viewer_token=token-123',
  }), 'https://preview-abc.wemux.xyz/?vmx_viewer_token=token-123')
})

test('resolveAuthorizedPreviewCopyUrl falls back to iframeUrl before bare publicUrl', () => {
  assert.equal(resolveAuthorizedPreviewCopyUrl({
    preview: {
      publicUrl: 'https://preview-abc.wemux.xyz/',
    } as any,
    selectedPreviewSource: {
      id: 'primary',
      appUrl: 'http://127.0.0.1:3005/',
      accessUrl: 'http://127.0.0.1:3005/',
      primary: true,
    },
    iframeUrl: 'https://preview-abc.wemux.xyz/?vmx_viewer_token=token-123',
  }), 'https://preview-abc.wemux.xyz/?vmx_viewer_token=token-123')
})

test('resolveRemotePreviewBaseUrl keeps selected remote source domains for extra ports', () => {
  assert.equal(resolveRemotePreviewBaseUrl({
    preview: {
      publicUrl: 'https://preview-abc.wemux.xyz/',
    } as any,
    selectedPreviewSource: {
      id: 'admin',
      appUrl: 'http://127.0.0.1:3006/',
      accessUrl: 'https://preview-abc-admin.wemux.xyz/',
      primary: false,
    },
  }), 'https://preview-abc-admin.wemux.xyz/')
})

test('resolveRemotePreviewBaseUrl falls back to preview public url when no selected source exists', () => {
  assert.equal(resolveRemotePreviewBaseUrl({
    preview: {
      publicUrl: 'https://preview-abc.wemux.xyz/',
    } as any,
    selectedPreviewSource: null,
  }), 'https://preview-abc.wemux.xyz/')
})

test('preview domain and share labels distinguish public proxy from tunnel sessions', () => {
  assert.equal(resolvePreviewDomainLabel({ accessMode: 'public-proxy' } as any), '公网预览域名')
  assert.equal(resolvePreviewDomainLabel({ accessMode: 'tunnel' } as any), '隧道预览域名')
  assert.equal(resolvePreviewShareActionLabel({
    accessMode: 'public-proxy',
    share: { enabled: false },
  } as any), '公开公网预览域名分享链接')
  assert.equal(resolvePreviewShareActionLabel({
    accessMode: 'tunnel',
    share: { enabled: false },
  } as any), '公开隧道预览域名分享链接')
  assert.equal(resolvePreviewShareActionLabel({
    accessMode: 'public-proxy',
    share: { enabled: true },
  } as any), '撤销分享')
  assert.equal(resolvePreviewShareCopyLabel({ accessMode: 'public-proxy' } as any), '复制公网预览域名分享链接')
  assert.equal(resolvePreviewShareCopyLabel({ accessMode: 'tunnel' } as any), '复制隧道预览域名分享链接')
})

test('resolvePublicDirectExternalReason keeps public direct as external-only from hosted pages', () => {
  assert.equal(resolvePublicDirectExternalReason({
    activeTransport: 'public-direct',
    pageProtocol: 'https:',
    previewUrl: 'http://203.0.113.10:4002/',
  }), 'mixed-content')

  assert.equal(resolvePublicDirectExternalReason({
    activeTransport: 'public-direct',
    pageProtocol: 'http:',
    previewUrl: 'http://203.0.113.10:4002/',
  }), 'public-ip')

  assert.equal(resolvePublicDirectExternalReason({
    activeTransport: 'gateway',
    pageProtocol: 'https:',
    previewUrl: 'https://test-preview--6g3ove.wemux.xyz/',
  }), '')
})

test('resolveVisiblePreviewError hides stale preview errors after iframe has recovered', () => {
  assert.equal(resolveVisiblePreviewError({
    previewLastError: 'code=1006',
    connected: true,
    iframeLoaded: true,
    iframeLoadTimedOut: false,
  }), '')
})

test('resolveVisiblePreviewError keeps preview errors visible before recovery completes', () => {
  assert.equal(resolveVisiblePreviewError({
    previewLastError: 'code=1006',
    connected: true,
    iframeLoaded: false,
    iframeLoadTimedOut: false,
  }), 'code=1006')
})

test('resolveActivePreviewTransport auto-selects the lowest-latency available transport', () => {
  assert.equal(resolveActivePreviewTransport({
    preference: 'auto',
    preview: {
      accessMode: 'tunnel',
    } as any,
    canAttemptLocalDirectPreview: true,
    localDirectPreviewFailed: false,
    transportProbes: {
      'local-direct': { status: 'ok', roundTripMs: 12 },
      tunnel: { status: 'ok', roundTripMs: 85 },
    },
  }), 'local-direct')
})

test('resolveActivePreviewTransport respects manual transport selection when available', () => {
  assert.equal(resolveActivePreviewTransport({
    preference: 'tunnel',
    preview: {
      accessMode: 'tunnel',
    } as any,
    canAttemptLocalDirectPreview: true,
    localDirectPreviewFailed: false,
    transportProbes: {
      'local-direct': { status: 'ok', roundTripMs: 12 },
      tunnel: { status: 'ok', roundTripMs: 85 },
    },
  }), 'tunnel')
})

test('resolveActivePreviewTransport falls back to remote transport when manual local-direct is unavailable', () => {
  assert.equal(resolveActivePreviewTransport({
    preference: 'local-direct',
    preview: {
      accessMode: 'public-proxy',
    } as any,
    canAttemptLocalDirectPreview: false,
    localDirectPreviewFailed: false,
    transportProbes: {
      gateway: { status: 'ok', roundTripMs: 40 },
    },
  }), 'gateway')
})

test('resolveActivePreviewTransport can use mesh bridge when local direct is unavailable', () => {
  assert.equal(resolveActivePreviewTransport({
    preference: 'auto',
    preview: {
      accessMode: 'tunnel',
    } as any,
    canAttemptLocalDirectPreview: false,
    localDirectPreviewFailed: false,
    meshBridgeBaseUrl: 'http://preview-preview-1.127.0.0.1.nip.io:48123/api/preview-mesh-bridge/bootstrap?target=x',
  }), 'mesh-bridge')
})

test('resolveActivePreviewTransport can use public direct before mesh bridge', () => {
  assert.equal(resolveActivePreviewTransport({
    preference: 'auto',
    preview: {
      accessMode: 'tunnel',
    } as any,
    canAttemptLocalDirectPreview: false,
    localDirectPreviewFailed: false,
    publicDirectBaseUrl: 'http://203.0.113.10:4002/',
    meshBridgeBaseUrl: 'http://preview-preview-1.127.0.0.1.nip.io:48123/api/preview-mesh-bridge/bootstrap?target=x',
  }), 'public-direct')
})

test('resolveActivePreviewTransport respects manual public direct selection when available', () => {
  assert.equal(resolveActivePreviewTransport({
    preference: 'public-direct',
    preview: {
      accessMode: 'public-proxy',
    } as any,
    canAttemptLocalDirectPreview: false,
    localDirectPreviewFailed: false,
    publicDirectBaseUrl: 'http://203.0.113.10:4002/',
    transportProbes: {
      gateway: { status: 'ok', roundTripMs: 80 },
    },
  }), 'public-direct')
})

test('shouldOpenRemotePreviewForTransport stays off for local-direct without preview session', () => {
  assert.equal(shouldOpenRemotePreviewForTransport({
    activeTransport: 'local-direct',
    preview: null,
  }), false)
})

test('shouldOpenRemotePreviewForTransport stays off for public-direct without preview session', () => {
  assert.equal(shouldOpenRemotePreviewForTransport({
    activeTransport: 'public-direct',
    preview: null,
  }), false)
})

test('shouldOpenRemotePreviewForTransport turns on for tunnel without preview session', () => {
  assert.equal(shouldOpenRemotePreviewForTransport({
    activeTransport: 'tunnel',
    preview: null,
  }), true)
})

test('shouldOpenRemotePreviewForTransport turns off for connected remote preview', () => {
  assert.equal(shouldOpenRemotePreviewForTransport({
    activeTransport: 'tunnel',
    preview: {
      status: 'active',
      accessMode: 'tunnel',
      tunnelClientStatus: 'open',
    } as any,
  }), false)
})

test('shouldReconnectWaitingRemotePreview retries only a remote Preview that is still opening', () => {
  assert.equal(shouldReconnectWaitingRemotePreview({ status: 'opening' }), true)
  assert.equal(shouldReconnectWaitingRemotePreview({ status: 'waiting_tunnel' }), true)
  assert.equal(shouldReconnectWaitingRemotePreview({ status: 'active' }), false)
  assert.equal(shouldReconnectWaitingRemotePreview({ status: 'closed' }), false)
  assert.equal(shouldReconnectWaitingRemotePreview(null), false)
})

test('resolvePreviewTransportOptions exposes availability and latency for the current session transports', () => {
  const options = resolvePreviewTransportOptions({
    preview: {
      accessMode: 'tunnel',
      tunnelLatencyMs: 101,
    } as any,
    canAttemptLocalDirectPreview: true,
    localDirectBaseUrl: 'http://127.0.0.1:3000/',
    publicDirectBaseUrl: 'http://203.0.113.10:3000/',
    previewAccessUrl: 'https://preview.wemux.xyz/',
    previewBaseUrl: 'https://preview.wemux.xyz/',
    transportProbes: {
      'local-direct': { status: 'ok', roundTripMs: 14 },
      'public-direct': { status: 'ok', roundTripMs: 36 },
      'mesh-bridge': { status: 'unavailable' },
      tunnel: { status: 'ok', roundTripMs: 101 },
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
      available: true,
      latencyMs: 14,
      status: 'ok',
    },
    {
      transport: 'public-direct',
      available: true,
      latencyMs: 36,
      status: 'ok',
    },
    {
      transport: 'mesh-bridge',
      available: false,
      latencyMs: undefined,
      status: 'unavailable',
    },
    {
      transport: 'gateway',
      available: false,
      latencyMs: undefined,
      status: 'unavailable',
    },
    {
      transport: 'tunnel',
      available: true,
      latencyMs: 101,
      status: 'ok',
    },
  ])
})

test('resolvePreviewTransportOptions exposes on-demand tunnel when local source exists but remote preview is not started yet', () => {
  const options = resolvePreviewTransportOptions({
    preview: null,
    canAttemptLocalDirectPreview: true,
    allowOnDemandTunnel: true,
    localDirectBaseUrl: 'http://127.0.0.1:3000/',
    publicDirectBaseUrl: 'http://203.0.113.10:3000/',
    transportProbes: {
      'local-direct': { status: 'ok', roundTripMs: 14 },
      'public-direct': { status: 'ok', roundTripMs: 30 },
      'mesh-bridge': { status: 'unavailable' },
    },
  })

  assert.deepEqual(options.map((option) => ({
    transport: option.transport,
    available: option.available,
    url: option.url,
  })), [
    {
      transport: 'local-direct',
      available: true,
      url: 'http://127.0.0.1:3000/',
    },
    {
      transport: 'public-direct',
      available: true,
      url: 'http://203.0.113.10:3000/',
    },
    {
      transport: 'mesh-bridge',
      available: false,
      url: '',
    },
    {
      transport: 'gateway',
      available: false,
      url: '',
    },
    {
      transport: 'tunnel',
      available: true,
      url: '',
    },
  ])
})

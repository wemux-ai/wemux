/**
 * [INPUT]: Preview hosts, viewer credentials, preview-session state, and proxy requests.
 * [OUTPUT]: Authenticated preview traffic, gateway relay traffic, and standalone preview status pages.
 * [POS]: HTTP/WebSocket edge for Preview sessions; delegates session state and tunnel transport to services.
 *
 * [PROTOCOL]: Update this header when this file's responsibility or contracts change, then check AGENTS.md.
 */
import type { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { WebSocket as NodeWebSocket, type RawData } from 'ws'
import { clusterConfig } from '../cluster/config'
import { resolveExecutorRequestTarget } from '../control-plane/executor-node-routing'
import {
  buildExecutorPreviewIngressHttpUrl,
  buildExecutorPreviewIngressWebSocketUrl,
  canUseExecutorPreviewPublicProxy,
  getExecutorPreviewProxySecret,
} from '../services/preview-public-proxy'
import type { PreviewSessionRecord } from '../services/preview-session-record'
import { resolveExternalRequestScheme } from '../services/preview-hostname'
import { previewSessionService } from '../services/preview-session-service'
import { previewTunnelService } from '../services/preview-tunnel-service'
import { getNode } from '../storage/postgres/distributed-task-store'
import { ensureClusterToken } from './shared'

const PREVIEW_ACCESS_COOKIE = 'vmx_preview_access'
const PREVIEW_PROXY_PREFIX = '/_vmx_proxy'
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const WEBSOCKET_HEADER_NAMES = new Set([
  'connection',
  'upgrade',
  'host',
  'sec-websocket-key',
  'sec-websocket-extensions',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'cookie',
])
const LOOPBACK_HOST_ALIASES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

type PreviewLocalizedCopy = {
  zh: string
  en: string
}

const escapePreviewHtml = (value: string) => {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;')
}

const buildPreviewHtml = (params: {
  title: PreviewLocalizedCopy
  body: PreviewLocalizedCopy
  status: string
  details?: Array<{
    label: PreviewLocalizedCopy
    value: string
  }>
  hint?: PreviewLocalizedCopy
  refreshSeconds?: number
}) => {
  const refreshSeconds = typeof params.refreshSeconds === 'number' && params.refreshSeconds > 0
    ? params.refreshSeconds
    : null
  const refreshHead = refreshSeconds === null
    ? ''
    : `\n    <meta http-equiv="refresh" content="${refreshSeconds}" />`
  const refreshScript = refreshSeconds === null
    ? ''
    : `\n    <script>window.setTimeout(function(){ window.location.reload(); }, ${Math.round(refreshSeconds * 1000)});</script>`
  const escapedStatus = escapePreviewHtml(params.status.trim().split('_').join(' '))
  const titleZh = escapePreviewHtml(params.title.zh)
  const titleEn = escapePreviewHtml(params.title.en)
  const bodyZh = escapePreviewHtml(params.body.zh)
  const bodyEn = escapePreviewHtml(params.body.en)
  const detailsHtml = (params.details || [])
    .map((detail) => {
      const labelZh = escapePreviewHtml(detail.label.zh)
      const labelEn = escapePreviewHtml(detail.label.en)
      const value = escapePreviewHtml(detail.value)
      return `
        <section class="detail-card">
          <div class="detail-label">
            <span>${labelZh}</span>
            <span>${labelEn}</span>
          </div>
          <pre>${value}</pre>
        </section>`
    })
    .join('')
  const hintHtml = params.hint
    ? `
      <div class="hint">
        <p>${escapePreviewHtml(params.hint.zh)}</p>
        <p>${escapePreviewHtml(params.hint.en)}</p>
      </div>`
    : ''
  const refreshNote = refreshSeconds === null
    ? ''
    : `
      <div class="refresh-note">
        <p>${escapePreviewHtml(`页面会每 ${refreshSeconds} 秒自动刷新一次。`)}</p>
        <p>${escapePreviewHtml(`This page refreshes automatically every ${refreshSeconds} seconds.`)}</p>
      </div>`
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${refreshHead}
    <title>${titleEn}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050505;
        --panel: #09090b;
        --panel-header: #070708;
        --surface: #09090b;
        --border: #27272a;
        --divider: #18181b;
        --title: #f4f4f5;
        --text: #d4d4d8;
        --muted: #a1a1aa;
        --faint: #71717a;
        --status: #7dd3fc;
        --status-bg: rgba(14, 116, 144, 0.16);
        --status-border: rgba(14, 116, 144, 0.34);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, "SF Pro Display", "PingFang SC", "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .shell {
        width: min(680px, 100%);
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
      }
      .eyebrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        min-height: 43px;
        padding: 0 16px;
        border-bottom: 1px solid var(--divider);
        background: var(--panel-header);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--status-border);
        background: var(--status-bg);
        color: var(--status);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .badge::before {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: currentColor;
        animation: pulse 1.5s ease-in-out infinite;
      }
      .brand {
        color: var(--faint);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.13em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        padding: 24px 24px 0;
        color: var(--title);
        font-size: clamp(28px, 4vw, 36px);
        font-weight: 650;
        line-height: 1.15;
        letter-spacing: -0.03em;
      }
      .subtitle {
        padding: 5px 24px 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.5;
      }
      .body-copy {
        margin-top: 18px;
        padding: 0 24px;
        display: grid;
        gap: 5px;
      }
      p {
        margin: 0;
        color: var(--text);
        line-height: 1.6;
        font-size: 13px;
      }
      .muted {
        color: var(--muted);
      }
      .details {
        margin: 20px 24px 0;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .detail-card {
        background: var(--surface);
      }
      .detail-card + .detail-card {
        border-top: 1px solid var(--divider);
      }
      .detail-label {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--divider);
        color: var(--faint);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      pre {
        margin: 0;
        padding: 11px 12px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text);
        font: 12px/1.55 "SFMono-Regular", "SF Mono", "JetBrains Mono", ui-monospace, monospace;
      }
      .hint,
      .refresh-note {
        position: relative;
        margin: 12px 24px 0;
        padding: 11px 12px 11px 16px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
      }
      .hint::before,
      .refresh-note::before {
        position: absolute;
        top: 11px;
        bottom: 11px;
        left: 0;
        width: 2px;
        border-radius: 2px;
        background: var(--status);
        content: "";
      }
      .hint p + p,
      .refresh-note p + p {
        margin-top: 3px;
        color: var(--muted);
      }
      .refresh-note {
        margin-bottom: 24px;
      }
      @keyframes pulse {
        50% { opacity: 0.45; }
      }
      @media (prefers-reduced-motion: reduce) {
        .badge::before { animation: none; }
      }
      @media (max-width: 640px) {
        main { padding: 12px; }
        .shell {
          border-radius: 10px;
        }
        h1 { padding: 20px 18px 0; }
        .subtitle, .body-copy { padding-left: 18px; padding-right: 18px; }
        .details, .hint, .refresh-note { margin-left: 18px; margin-right: 18px; }
        .detail-label {
          flex-direction: column;
          gap: 3px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="shell">
        <div class="eyebrow">
          <span class="badge">${escapedStatus}</span>
          <span class="brand">wemux Preview Gateway</span>
        </div>
        <h1>${titleZh}</h1>
        <div class="subtitle">${titleEn}</div>
        <div class="body-copy">
          <p>${bodyZh}</p>
          <p class="muted">${bodyEn}</p>
        </div>
        <div class="details">${detailsHtml}</div>
        ${hintHtml}
        ${refreshNote}
      </section>
    </main>
    ${refreshScript}
  </body>
</html>`
}

const setPreviewAccessCookie = (c: any, accessToken: string) => {
  const secure = resolveExternalRequestScheme({
    requestUrl: c.req.url,
    headers: c.req.raw.headers,
  }) === 'https'
  setCookie(c, PREVIEW_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'None' : 'Lax',
    path: '/',
  })
}

const buildAuthFailureHtml = (params: {
  title: PreviewLocalizedCopy
  body: PreviewLocalizedCopy
  status?: number
}) => {
  return new Response(buildPreviewHtml({
    title: params.title,
    status: String(params.status ?? 401),
    body: params.body,
    hint: {
      zh: '请返回 wemux 重新打开预览，或使用有效的分享链接继续访问。',
      en: 'Return to wemux and reopen the preview, or continue with a valid share link.',
    },
  }), {
    status: params.status ?? 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

export const buildPreviewBootstrapRedirectUrl = (_session: PreviewSessionRecord, requestUrl: string) => {
  const redirectUrl = new URL(requestUrl)
  redirectUrl.searchParams.delete('vmx_viewer_token')
  redirectUrl.searchParams.delete('share_token')
  return redirectUrl.toString()
}

const buildPreviewProxyFailureHtml = (params: {
  status: number
  sourceAppUrl: string
  detail: string
}) => {
  return new Response(buildPreviewHtml({
    title: {
      zh: 'Preview 源应用暂时不可用',
      en: 'Preview Source App Unavailable',
    },
    status: String(params.status),
    body: {
      zh: `wemux Preview 隧道已经连通，但源应用 ${params.sourceAppUrl} 当前没有返回可展示的页面。`,
      en: `The wemux preview tunnel is connected, but the source app at ${params.sourceAppUrl} did not return a page.`,
    },
    details: [
      {
        label: {
          zh: '源应用地址',
          en: 'Source app URL',
        },
        value: params.sourceAppUrl,
      },
      {
        label: {
          zh: '错误详情',
          en: 'Error details',
        },
        value: params.detail,
      },
    ],
    hint: {
      zh: '请确认本地开发服务仍在运行，并监听了当前 preview 绑定的端口。',
      en: 'Check that the local development server is still running and listening on the port bound to this preview.',
    },
  }), {
    status: params.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

const stripPreviewAccessCookie = (cookieHeader: string) => {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.startsWith(`${PREVIEW_ACCESS_COOKIE}=`))
    .join('; ')
}

const resolvePreviewGatewayAuthorization = (c: any) => {
  const host = c.req.header('host') || ''
  const session = previewSessionService.getSessionByHost(host)
  if (!session) {
    return { kind: 'passthrough' as const }
  }

  const viewerToken = c.req.query('vmx_viewer_token')
  if (viewerToken) {
    const exchanged = previewSessionService.exchangeBootstrapToken(viewerToken)
    if (!exchanged || exchanged.session.id !== session.id) {
      return {
        kind: 'reject' as const,
        response: buildAuthFailureHtml({
          title: {
            zh: 'Preview 访问已过期',
            en: 'Preview Access Expired',
          },
          body: {
            zh: '当前预览访问令牌无效或已过期，请从 wemux 重新打开这个预览页面。',
            en: 'The preview viewer token is invalid or expired. Please reopen this preview from wemux.',
          },
        }),
      }
    }

    return {
      kind: 'bootstrap' as const,
      session,
      accessToken: exchanged.accessToken,
      redirectTo: buildPreviewBootstrapRedirectUrl(session, c.req.url),
    }
  }

  const shareToken = c.req.query('share_token')
  if (shareToken) {
    const exchanged = previewSessionService.exchangeShareToken(shareToken)
    if (!exchanged || exchanged.session.id !== session.id) {
      return {
        kind: 'reject' as const,
        response: buildAuthFailureHtml({
          title: {
            zh: '分享链接已失效',
            en: 'Share Link Expired',
          },
          body: {
            zh: '这个分享预览链接无效、已过期，或者已经被撤销。',
            en: 'This share preview link is invalid, expired, or has been revoked.',
          },
        }),
      }
    }

    return {
      kind: 'bootstrap' as const,
      session,
      accessToken: exchanged.accessToken,
      redirectTo: buildPreviewBootstrapRedirectUrl(session, c.req.url),
    }
  }

  const accessToken = getCookie(c, PREVIEW_ACCESS_COOKIE)
  if (!accessToken) {
    return {
      kind: 'reject' as const,
      response: buildAuthFailureHtml({
        title: {
          zh: '需要 Preview 访问授权',
          en: 'Preview Authorization Required',
        },
        body: {
          zh: '请从 wemux 内打开这个预览，或使用有效的分享链接继续访问。',
          en: 'Open this preview from wemux, or use a valid share link to continue.',
        },
      }),
    }
  }

  const verified = previewSessionService.verifyAccessToken(accessToken, session.id)
  if (!verified) {
    deleteCookie(c, PREVIEW_ACCESS_COOKIE, { path: '/' })
    return {
      kind: 'reject' as const,
      response: buildAuthFailureHtml({
        title: {
          zh: 'Preview 访问已过期',
          en: 'Preview Access Expired',
        },
        body: {
          zh: '当前预览访问凭证已经失效，请从 wemux 重新打开预览以刷新访问权限。',
          en: 'The preview access cookie is no longer valid. Reopen the preview from wemux to refresh access.',
        },
      }),
    }
  }

  return {
    kind: 'authorized' as const,
    session,
  }
}

const resolveSessionHostTargetUrl = (session: PreviewSessionRecord, host: string) => {
  const normalizedHost = host.trim().toLowerCase()
  const binding = session.additionalSourceBindings.find((item) => item.publicHost.trim().toLowerCase() === normalizedHost)
  if (!binding || binding.appUrl === session.source.appUrl) {
    return undefined
  }
  return binding.appUrl
}

const normalizePreviewWebSocketHeaders = (request: Request, previewSessionId: string) => {
  const headers: Array<[string, string]> = []
  request.headers.forEach((value, name) => {
    const normalized = name.toLowerCase()
    if (normalized === 'cookie') {
      const sanitized = stripPreviewAccessCookie(value)
      if (sanitized) {
        headers.push([name, sanitized])
      }
      return
    }
    if (WEBSOCKET_HEADER_NAMES.has(normalized)) {
      return
    }
    headers.push([name, value])
  })

  const requestUrl = new URL(request.url)
  headers.push(['x-forwarded-host', requestUrl.host])
  headers.push(['x-forwarded-proto', requestUrl.protocol.replace(':', '')])
  headers.push(['x-wemux-preview-id', previewSessionId])
  return headers
}

const parseWebSocketProtocols = (request: Request) => {
  const raw = request.headers.get('sec-websocket-protocol') || ''
  if (!raw.trim()) {
    return []
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const toBuffer = async (payload: unknown) => {
  if (typeof payload === 'string') {
    return payload
  }

  if (payload instanceof Uint8Array) {
    return Buffer.from(payload)
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload)
  }

  if (payload instanceof Blob) {
    return Buffer.from(await payload.arrayBuffer())
  }

  return Buffer.from(String(payload))
}

const normalizePort = (url: URL) => {
  if (url.port) {
    return url.port
  }

  return url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80'
}

const encodeRelayJson = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const decodeRelayJson = <T>(raw: string | null | undefined): T | null => {
  const encoded = raw?.trim()
  if (!encoded) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

const sanitizeRelayRequestHeaders = (headers: Headers) => {
  headers.delete('host')
  headers.delete('x-cluster-token')
  headers.delete('x-wemux-preview-path')
  headers.delete('x-wemux-preview-target-url')
  headers.delete('x-wemux-preview-relay-headers')
  headers.delete('x-wemux-preview-relay-subprotocols')
  return headers
}

type PreviewRelayTarget = {
  relayUrl: string
}

type PublicPreviewIngressTarget = {
  ingressHttpUrl: string
}

export const previewGatewayRelayDeps = {
  getNode: (nodeId: string) => getNode(nodeId),
}

export const buildClusterPreviewHttpRelayUrl = (params: {
  relayUrl: string
  previewSessionId: string
}) => {
  const url = new URL(params.relayUrl)
  url.pathname = `/api/internal/cluster/preview-sessions/${encodeURIComponent(params.previewSessionId)}/http-relay`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const buildClusterPreviewGatewayRelayWebSocketUrl = (params: {
  relayUrl: string
  previewSessionId: string
}) => {
  const url = new URL(params.relayUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/internal/cluster/preview-sessions/${encodeURIComponent(params.previewSessionId)}/gateway-relay/ws`
  url.search = ''
  url.hash = ''
  return url.toString()
}

const resolvePreviewRelayTarget = async (session: PreviewSessionRecord): Promise<PreviewRelayTarget | null> => {
  const tunnelConnectedNodeId = session.tunnelConnectedNodeId?.trim()
  if (tunnelConnectedNodeId) {
    if (tunnelConnectedNodeId === clusterConfig.nodeId) {
      return null
    }

    const connectedNode = previewGatewayRelayDeps.getNode(tunnelConnectedNodeId)
    const relayUrl = connectedNode?.relayUrl?.trim() || connectedNode?.url?.trim()
    if (relayUrl) {
      return {
        relayUrl,
      }
    }

    return null
  }

  const target = await resolveExecutorRequestTarget(session.executorId)
  if (target.mode !== 'remote') {
    return null
  }

  return {
    relayUrl: target.relayUrl,
  }
}

const resolvePublicPreviewIngressTarget = (session: PreviewSessionRecord): PublicPreviewIngressTarget | null => {
  if (session.purpose !== 'app' || !canUseExecutorPreviewPublicProxy(session.executorId)) {
    return null
  }

  const ingressHttpUrl = buildExecutorPreviewIngressHttpUrl({
    executorId: session.executorId,
    previewSessionId: session.id,
  })
  if (!ingressHttpUrl) {
    return null
  }

  return { ingressHttpUrl }
}

const relayPreviewHttpRequest = async (params: {
  relayUrl: string
  previewSessionId: string
  request: Request
  pathWithQuery: string
  targetUrl?: string
}) => {
  const relayHeaders = new Headers(params.request.headers)
  relayHeaders.set('x-wemux-preview-path', params.pathWithQuery)
  if (params.targetUrl) {
    relayHeaders.set('x-wemux-preview-target-url', params.targetUrl)
  } else {
    relayHeaders.delete('x-wemux-preview-target-url')
  }
  if (clusterConfig.sharedToken) {
    relayHeaders.set('x-cluster-token', clusterConfig.sharedToken)
  }
  relayHeaders.delete('host')

  const relayBody = params.request.method === 'GET' || params.request.method === 'HEAD'
    ? undefined
    : await params.request.arrayBuffer()

  return fetch(buildClusterPreviewHttpRelayUrl({
    relayUrl: params.relayUrl,
    previewSessionId: params.previewSessionId,
  }), {
    method: params.request.method,
    headers: relayHeaders,
    body: relayBody,
  })
}

const relayPreviewPublicIngressHttpRequest = async (params: {
  executorId: string
  ingressHttpUrl: string
  request: Request
  pathWithQuery: string
  targetUrl?: string
}) => {
  const relayHeaders = new Headers(params.request.headers)
  relayHeaders.set('x-wemux-preview-path', params.pathWithQuery)
  relayHeaders.set('authorization', `Bearer ${getExecutorPreviewProxySecret(params.executorId)}`)
  if (params.targetUrl) {
    relayHeaders.set('x-wemux-preview-target-url', params.targetUrl)
  } else {
    relayHeaders.delete('x-wemux-preview-target-url')
  }
  relayHeaders.delete('host')

  const relayBody = params.request.method === 'GET' || params.request.method === 'HEAD'
    ? undefined
    : await params.request.arrayBuffer()

  return fetch(params.ingressHttpUrl, {
    method: params.request.method,
    headers: relayHeaders,
    body: relayBody,
  })
}

const buildInternalPreviewProxyRequest = async (params: {
  session: PreviewSessionRecord
  request: Request
  pathWithQuery: string
}) => {
  const headers = sanitizeRelayRequestHeaders(new Headers(params.request.headers))
  const body = params.request.method === 'GET' || params.request.method === 'HEAD'
    ? undefined
    : await params.request.arrayBuffer()

  return new Request(new URL(params.pathWithQuery, params.session.publicUrl), {
    method: params.request.method,
    headers,
    body,
  })
}

const normalizeLoopbackHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  if (normalized === '[::1]') {
    return '::1'
  }

  return normalized
}

const normalizeLoopbackProtocol = (protocol: string) => {
  if (protocol === 'ws:') {
    return 'http:'
  }

  if (protocol === 'wss:') {
    return 'https:'
  }

  return protocol
}

const isLoopbackHostnameAlias = (hostname: string) => {
  return LOOPBACK_HOST_ALIASES.has(normalizeLoopbackHostname(hostname))
}

const areLoopbackHostsEquivalent = (left: URL, right: URL) => {
  return isLoopbackHostnameAlias(left.hostname)
    && isLoopbackHostnameAlias(right.hostname)
    && normalizePort(left) === normalizePort(right)
    && normalizeLoopbackProtocol(left.protocol) === normalizeLoopbackProtocol(right.protocol)
}

const resolveLoopbackProxyTarget = (session: PreviewSessionRecord, rawTargetUrl: string) => {
  let targetUrl: URL
  try {
    targetUrl = new URL(rawTargetUrl)
  } catch {
    return null
  }

  if (
    (targetUrl.protocol !== 'http:'
      && targetUrl.protocol !== 'https:'
      && targetUrl.protocol !== 'ws:'
      && targetUrl.protocol !== 'wss:')
    || !LOOPBACK_HOSTNAMES.has(targetUrl.hostname)
  ) {
    return null
  }

  const allowed = [session.source, ...session.additionalSources].find((source) => {
    try {
      const sourceUrl = new URL(source.appUrl)
      return areLoopbackHostsEquivalent(sourceUrl, targetUrl)
    } catch {
      return false
    }
  })
  if (!allowed) {
    return null
  }

  return {
    targetUrl: allowed.appUrl,
    pathWithQuery: `${targetUrl.pathname}${targetUrl.search}`,
  }
}

const parsePreviewProxyRequest = (session: PreviewSessionRecord, requestUrl: URL) => {
  if (!requestUrl.pathname.startsWith(`${PREVIEW_PROXY_PREFIX}/`)) {
    return null
  }

  const encodedTargetUrl = requestUrl.pathname.slice(`${PREVIEW_PROXY_PREFIX}/`.length)
  if (!encodedTargetUrl) {
    return null
  }

  let targetUrl: string
  try {
    targetUrl = decodeURIComponent(encodedTargetUrl)
  } catch {
    return null
  }

  const resolved = resolveLoopbackProxyTarget(session, targetUrl)
  if (!resolved) {
    return null
  }

  return {
    targetUrl: resolved.targetUrl,
    pathWithQuery: `${resolved.pathWithQuery}${requestUrl.search}`,
  }
}

const buildForbiddenPreviewProxyResponse = () => {
  return new Response('Preview target URL is not allowed for this session.', {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

const buildDesktopNoVncPolish = (session: PreviewSessionRecord) => {
  if (session.purpose !== 'desktop') {
    return ''
  }

  return `<style data-wemux-desktop-novnc-polish>
#noVNC_status_bar { display: none !important; }
#noVNC_container { top: 0 !important; }
</style>`
}

const buildPreviewRuntimeScript = (session: PreviewSessionRecord) => {
  const allowedTargetUrls = JSON.stringify([session.source, ...session.additionalSources].map((source) => source.appUrl))
  return `${buildDesktopNoVncPolish(session)}<script>
(() => {
  const allowedTargets = ${allowedTargetUrls};
  const proxyPrefix = ${JSON.stringify(PREVIEW_PROXY_PREFIX)};
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  const allowedByOrigin = new Map();
  const copyStaticFields = (Target, Source) => {
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      if (!(key in Source)) {
        continue;
      }
      try {
        Target[key] = Source[key];
      } catch {}
    }
  };
  const normalizeLoopbackHostname = (hostname) => {
    const normalized = String(hostname || '').trim().toLowerCase();
    return normalized === '[::1]' ? '::1' : normalized;
  };
  const normalizeProtocolFamily = (protocol) => {
    if (protocol === 'ws:') {
      return 'http:';
    }
    if (protocol === 'wss:') {
      return 'https:';
    }
    return protocol;
  };
  const toOriginKey = (url) => {
    const normalizedProtocol = normalizeProtocolFamily(url.protocol);
    const port = url.port || (normalizedProtocol === 'https:' ? '443' : '80');
    const hostname = normalizeLoopbackHostname(url.hostname);
    const canonicalHost = loopbackHosts.has(hostname) ? 'loopback' : hostname;
    return \`\${normalizedProtocol}//\${canonicalHost}:\${port}\`;
  };

  for (const target of allowedTargets) {
    try {
      const url = new URL(target);
      allowedByOrigin.set(toOriginKey(url), target);
    } catch {}
  }

  const toProxyUrl = (input) => {
    try {
      const url = new URL(typeof input === 'string' ? input : String(input), window.location.href);
      const originKey = toOriginKey(url);
      if (!loopbackHosts.has(url.hostname) || !allowedByOrigin.has(originKey)) {
        return null;
      }

      return \`\${proxyPrefix}/\${encodeURIComponent(url.toString())}\`;
    } catch {
      return null;
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const rewritten = toProxyUrl(typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input)));
    if (!rewritten) {
      return originalFetch(input, init);
    }

    if (input instanceof Request) {
      return originalFetch(new Request(rewritten, input), init);
    }

    return originalFetch(rewritten, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const rewritten = toProxyUrl(url);
    return originalOpen.call(this, method, rewritten || url, ...rest);
  };

  if (typeof window.EventSource === 'function') {
    const NativeEventSource = window.EventSource;
    const WrappedEventSource = function(url, config) {
      const rewritten = toProxyUrl(url);
      return new NativeEventSource(rewritten || url, config);
    };
    WrappedEventSource.prototype = NativeEventSource.prototype;
    WrappedEventSource.prototype.constructor = WrappedEventSource;
    copyStaticFields(WrappedEventSource, NativeEventSource);
    window.EventSource = WrappedEventSource;
  }

  if (typeof window.WebSocket === 'function') {
    const NativeWebSocket = window.WebSocket;
    const WrappedWebSocket = function(url, protocols) {
      const rewritten = toProxyUrl(url);
      return new NativeWebSocket(rewritten || url, protocols);
    };
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    WrappedWebSocket.prototype.constructor = WrappedWebSocket;
    copyStaticFields(WrappedWebSocket, NativeWebSocket);
    window.WebSocket = WrappedWebSocket;
  }
})();
</script>`
}

const injectPreviewRuntimeIntoHtml = (html: string, session: PreviewSessionRecord) => {
  if (session.purpose === 'code-server') {
    return html
  }

  const runtimeScript = buildPreviewRuntimeScript(session)
  if (html.includes('</head>')) {
    return html.replace('</head>', `${runtimeScript}</head>`)
  }

  if (html.includes('<body>')) {
    return html.replace('<body>', `<body>${runtimeScript}`)
  }

  return `${runtimeScript}${html}`
}

const HTML_INJECTION_BUFFER_LIMIT_BYTES = 64 * 1024

const createPreviewRuntimeInjectedStream = (body: ReadableStream<Uint8Array>, session: PreviewSessionRecord) => {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const reader = body.getReader()
  let buffered = ''
  let injected = false

  const flushInjectedHtml = (controller: ReadableStreamDefaultController<Uint8Array>, html: string) => {
    controller.enqueue(encoder.encode(injectPreviewRuntimeIntoHtml(html, session)))
    injected = true
  }

  const tryInjectBufferedHtml = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    const headIndex = buffered.indexOf('</head>')
    const bodyIndex = buffered.indexOf('<body>')
    if (headIndex < 0 && bodyIndex < 0 && encoder.encode(buffered).byteLength < HTML_INJECTION_BUFFER_LIMIT_BYTES) {
      return false
    }

    flushInjectedHtml(controller, buffered)
    buffered = ''
    return true
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          const tail = decoder.decode()
          if (tail) {
            buffered += tail
          }

          if (!injected) {
            flushInjectedHtml(controller, buffered)
          } else if (buffered) {
            controller.enqueue(encoder.encode(buffered))
          }
          controller.close()
          return
        }

        const chunk = decoder.decode(value, { stream: true })
        if (!injected) {
          buffered += chunk
          if (!tryInjectBufferedHtml(controller)) {
            continue
          }
          continue
        }

        controller.enqueue(encoder.encode(chunk))
        return
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export const registerPreviewGatewayRoutes = (app: Hono) => {
  app.all('/api/internal/cluster/preview-sessions/:previewSessionId/http-relay', async (c) => {
    if (!ensureClusterToken(c)) {
      return c.json({ message: '无权限访问集群内部 preview relay。' }, 401)
    }

    const previewSessionId = c.req.param('previewSessionId')
    const session = previewSessionService.getSessionById(previewSessionId)
    if (!session) {
      return c.json({ message: 'preview session 不存在。' }, 404)
    }

    const pathWithQuery = c.req.header('x-wemux-preview-path')?.trim()
    if (!pathWithQuery) {
      return c.json({ message: '缺少 preview relay path。' }, 400)
    }

    const targetUrl = c.req.header('x-wemux-preview-target-url')?.trim() || undefined
    const proxyRequest = await buildInternalPreviewProxyRequest({
      session,
      request: c.req.raw,
      pathWithQuery,
    })
    return previewTunnelService.proxyHttpRequest(previewSessionId, proxyRequest, targetUrl)
  })

  app.use('*', async (c, next) => {
    const isWebSocketUpgrade = (c.req.header('upgrade') || '').toLowerCase() === 'websocket'
    if (isWebSocketUpgrade) {
      await next()
      return
    }

    const auth = resolvePreviewGatewayAuthorization(c)
    if (auth.kind === 'passthrough') {
      await next()
      return
    }

    if (auth.kind === 'reject') {
      return auth.response
    }

    if (auth.kind === 'bootstrap') {
      setPreviewAccessCookie(c, auth.accessToken)
      return c.redirect(auth.redirectTo, 302)
    }

    if (auth.session.status !== 'active') {
      return c.html(buildPreviewHtml({
        title: {
          zh: 'Preview 正在等待隧道连接',
          en: 'Preview Waiting For Tunnel',
        },
        status: auth.session.status,
        body: {
          zh: `当前 preview session ${auth.session.id} 还没有开始转发应用流量，正在等待源应用与隧道就绪。`,
          en: `Preview session ${auth.session.id} is not serving app traffic yet and is still waiting for the source app and tunnel to become ready.`,
        },
        details: [
          {
            label: {
              zh: '当前源地址',
              en: 'Current source URL',
            },
            value: auth.session.source.appUrl,
          },
          {
            label: {
              zh: '会话 ID',
              en: 'Session ID',
            },
            value: auth.session.id,
          },
        ],
        hint: {
          zh: '如果你的本地服务刚启动，这通常会在几秒内恢复。',
          en: 'If your local service has just started, this usually recovers within a few seconds.',
        },
        refreshSeconds: 1,
      }))
    }

    const requestUrl = new URL(c.req.url)
    const proxyTarget = parsePreviewProxyRequest(auth.session, requestUrl)
    if (!proxyTarget && requestUrl.pathname.startsWith(`${PREVIEW_PROXY_PREFIX}/`)) {
      return buildForbiddenPreviewProxyResponse()
    }
    const proxyPathRequest = proxyTarget
      ? new Request(new URL(proxyTarget.pathWithQuery, auth.session.publicUrl), c.req.raw)
      : c.req.raw
    const pathWithQuery = proxyTarget?.pathWithQuery || `${requestUrl.pathname}${requestUrl.search}`
    const hostTargetUrl = resolveSessionHostTargetUrl(auth.session, c.req.header('host') || '')
    const targetUrl = proxyTarget?.targetUrl ?? hostTargetUrl
    const publicIngressTarget = resolvePublicPreviewIngressTarget(auth.session)
    const relayTarget = await resolvePreviewRelayTarget(auth.session)
    const response = publicIngressTarget
      ? await relayPreviewPublicIngressHttpRequest({
          executorId: auth.session.executorId,
          ingressHttpUrl: publicIngressTarget.ingressHttpUrl,
          request: proxyPathRequest,
          pathWithQuery,
          targetUrl,
        })
      : relayTarget
        ? await relayPreviewHttpRequest({
          relayUrl: relayTarget.relayUrl,
          previewSessionId: auth.session.id,
          request: proxyPathRequest,
          pathWithQuery,
          targetUrl,
        })
        : await previewTunnelService.proxyHttpRequest(
          auth.session.id,
          proxyPathRequest,
          targetUrl,
        )
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok && (!contentType || contentType.includes('text/plain'))) {
      const detail = (await response.text()).trim() || 'The upstream preview process returned an empty error response.'
      return buildPreviewProxyFailureHtml({
        status: response.status,
        sourceAppUrl: targetUrl || auth.session.source.appUrl,
        detail,
      })
    }

    if (!contentType.includes('text/html')) {
      return response
    }

    if (auth.session.purpose === 'code-server') {
      return response
    }

    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(
      response.body
        ? createPreviewRuntimeInjectedStream(response.body, auth.session)
        : injectPreviewRuntimeIntoHtml(await response.text(), auth.session),
      {
        status: response.status,
        headers,
      },
    )
  })
}

export const registerPreviewGatewayWsRoute = (app: Hono, upgradeWebSocket: any) => {
  app.get(
    '/api/internal/cluster/preview-sessions/:previewSessionId/gateway-relay/ws',
    async (c, next) => {
      if (!ensureClusterToken(c)) {
        return c.json({ message: '无权限访问集群内部 preview websocket relay。' }, 401)
      }

      const previewSessionId = c.req.param('previewSessionId')
      const session = previewSessionService.getSessionById(previewSessionId)
      if (!session) {
        return c.json({ message: 'preview session 不存在。' }, 404)
      }

      const pathWithQuery = c.req.query('path')?.trim()
      if (!pathWithQuery) {
        return c.json({ message: '缺少 preview relay websocket path。' }, 400)
      }

      ;(c as any).set('previewSessionId', previewSessionId)
      ;(c as any).set('previewSessionRecord', session)
      ;(c as any).set('previewRelayPathWithQuery', pathWithQuery)
      ;(c as any).set('previewRelayTargetUrl', c.req.query('targetUrl')?.trim() || undefined)
      ;(c as any).set(
        'previewRelayHeaders',
        decodeRelayJson<Array<[string, string]>>(c.req.header('x-wemux-preview-relay-headers')) ?? [],
      )
      ;(c as any).set(
        'previewRelaySubprotocols',
        decodeRelayJson<string[]>(c.req.header('x-wemux-preview-relay-subprotocols')) ?? [],
      )
      await next()
    },
    upgradeWebSocket((c: any) => {
      const previewSessionId = c.get('previewSessionId') as string
      const pathWithQuery = c.get('previewRelayPathWithQuery') as string
      const targetUrl = c.get('previewRelayTargetUrl') as string | undefined
      const relayHeaders = c.get('previewRelayHeaders') as Array<[string, string]>
      const relaySubprotocols = c.get('previewRelaySubprotocols') as string[]
      let streamId = ''

      return {
        onOpen(_: Event, ws: any) {
          streamId = previewTunnelService.openGatewayWebSocket({
            previewSessionId,
            socket: ws,
            pathWithQuery,
            targetUrl,
            headers: relayHeaders,
            subprotocols: relaySubprotocols,
          }) || ''

          if (!streamId) {
            ws.close(1013, 'preview tunnel unavailable')
          }
        },
        async onMessage(event: MessageEvent, ws: any) {
          if (!streamId) {
            ws.close(1013, 'preview tunnel unavailable')
            return
          }

          const payload = await toBuffer(event.data)
          previewTunnelService.pushGatewayWebSocketData(previewSessionId, streamId, payload)
        },
        onClose(event: CloseEvent) {
          if (!streamId) {
            return
          }

          previewTunnelService.closeGatewayWebSocket(previewSessionId, streamId, event.code, event.reason)
        },
      }
    }),
  )

  app.get(
    '*',
    async (c, next) => {
      const isWebSocketUpgrade = (c.req.header('upgrade') || '').toLowerCase() === 'websocket'
      if (!isWebSocketUpgrade) {
        await next()
        return
      }

      const auth = resolvePreviewGatewayAuthorization(c)
      if (auth.kind === 'passthrough') {
        return new Response('Not found', { status: 404 })
      }

      if (auth.kind === 'reject') {
        return auth.response
      }

      if (auth.kind === 'bootstrap') {
        setPreviewAccessCookie(c, auth.accessToken)
        return new Response('Preview websocket bootstrap requires a refreshed page load.', {
          status: 409,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        })
      }

      ;(c as any).set('previewSessionId', auth.session.id)
      ;(c as any).set('previewSessionRecord', auth.session)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const previewSessionId = c.get('previewSessionId') as string
      const previewSession = c.get('previewSessionRecord') as PreviewSessionRecord
      const request = c.req.raw as Request
      let streamId = ''
      let relaySocket: NodeWebSocket | null = null
      const relayHeaders = encodeRelayJson(normalizePreviewWebSocketHeaders(request, previewSessionId))
      const relaySubprotocols = encodeRelayJson(parseWebSocketProtocols(request))

      return {
        async onOpen(_: Event, ws: any) {
          const requestUrl = new URL(request.url)
          const proxyTarget = parsePreviewProxyRequest(previewSession, requestUrl)
          if (!proxyTarget && requestUrl.pathname.startsWith(`${PREVIEW_PROXY_PREFIX}/`)) {
            ws.close(1008, 'preview target URL is not allowed')
            return
          }
          const pathWithQuery = proxyTarget?.pathWithQuery || `${requestUrl.pathname}${requestUrl.search}`
          const hostTargetUrl = resolveSessionHostTargetUrl(previewSession, request.headers.get('host') || '')
          const targetUrl = proxyTarget?.targetUrl ?? hostTargetUrl
          const publicIngressTarget = resolvePublicPreviewIngressTarget(previewSession)
          const relayTarget = await resolvePreviewRelayTarget(previewSession)
          if (publicIngressTarget || relayTarget) {
            const relayUrl = publicIngressTarget
              ? new URL(buildExecutorPreviewIngressWebSocketUrl({
                  executorId: previewSession.executorId,
                  previewSessionId,
                  pathWithQuery,
                  targetUrl,
                }))
              : new URL(buildClusterPreviewGatewayRelayWebSocketUrl({
                  relayUrl: relayTarget!.relayUrl,
                  previewSessionId,
                }))
            if (relayTarget && !publicIngressTarget) {
              relayUrl.searchParams.set('path', pathWithQuery)
              if (targetUrl) {
                relayUrl.searchParams.set('targetUrl', targetUrl)
              }
            }

            const nextRelaySocket = new NodeWebSocket(
              relayUrl,
              undefined,
              {
                headers: {
                  ...(publicIngressTarget
                    ? { authorization: `Bearer ${getExecutorPreviewProxySecret(previewSession.executorId)}` }
                    : (clusterConfig.sharedToken ? { 'x-cluster-token': clusterConfig.sharedToken } : {})),
                  ...(publicIngressTarget || relayTarget
                    ? {
                        'x-wemux-preview-relay-headers': relayHeaders,
                        'x-wemux-preview-relay-subprotocols': relaySubprotocols,
                      }
                    : {}),
                },
              },
            )
            relaySocket = nextRelaySocket
            nextRelaySocket.on('message', (data: RawData) => {
              if (ws.readyState !== ws.OPEN) {
                return
              }
              ws.send(data)
            })
            nextRelaySocket.on('close', (code: number, reasonBuffer: Buffer) => {
              if (ws.readyState !== ws.OPEN) {
                return
              }
              const reason = Buffer.from(reasonBuffer).toString('utf8') || 'preview relay closed'
              ws.close(code || 1011, reason)
            })
            nextRelaySocket.on('error', (error: Error) => {
              if (ws.readyState !== ws.OPEN) {
                return
              }
              ws.close(1011, error.message || 'preview relay failed')
            })
            return
          }

          streamId = previewTunnelService.openGatewayWebSocket({
            previewSessionId,
            socket: ws,
            pathWithQuery,
            targetUrl,
            headers: normalizePreviewWebSocketHeaders(request, previewSessionId),
            subprotocols: parseWebSocketProtocols(request),
          }) || ''

          if (!streamId) {
            ws.close(1013, 'preview tunnel unavailable')
          }
        },
        async onMessage(event: MessageEvent, ws: any) {
          if (relaySocket) {
            if (relaySocket.readyState !== NodeWebSocket.OPEN) {
              ws.close(1013, 'preview relay unavailable')
              return
            }

            relaySocket.send(await toBuffer(event.data))
            return
          }

          if (!streamId) {
            ws.close(1013, 'preview tunnel unavailable')
            return
          }

          const payload = await toBuffer(event.data)
          previewTunnelService.pushGatewayWebSocketData(previewSessionId, streamId, payload)
        },
        onClose(event: CloseEvent) {
          if (relaySocket) {
            if (relaySocket.readyState === NodeWebSocket.OPEN || relaySocket.readyState === 0) {
              relaySocket.close(event.code, event.reason)
            }
            return
          }

          if (!streamId) {
            return
          }

          previewTunnelService.closeGatewayWebSocket(
            previewSessionId,
            streamId,
            event.code,
            event.reason,
          )
        },
      }
    }),
  )
}

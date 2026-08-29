// [INPUT]: 代理请求
// [OUTPUT]: 反向代理
// [POS]: preview 公共代理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { executorRegistry } from '../control-plane/executor-registry'

const trimTrailingSlash = (value: string) => value.trim().replace(/\/+$/, '')

export const getExecutorPreviewProxySecret = (executorId: string) => {
  return executorRegistry.getPreviewProxySecret(executorId)
}

export const getExecutorPreviewIngressBaseUrl = (executorId: string) => {
  const value = executorRegistry.getExecutor(executorId)?.previewIngressBaseUrl?.trim() || ''
  return value ? trimTrailingSlash(value) : ''
}

export const canUseExecutorPreviewPublicProxy = (executorId: string) => {
  const executor = executorRegistry.getExecutor(executorId)
  return Boolean(
    executor?.previewExposureMode === 'public-ingress'
    && getExecutorPreviewProxySecret(executorId)
    && getExecutorPreviewIngressBaseUrl(executorId),
  )
}

export const buildExecutorPreviewIngressHttpUrl = (params: {
  executorId: string
  previewSessionId: string
}) => {
  const baseUrl = getExecutorPreviewIngressBaseUrl(params.executorId)
  if (!baseUrl) {
    return ''
  }
  return `${baseUrl}/api/preview-ingress/http/${encodeURIComponent(params.previewSessionId)}`
}

export const buildExecutorPreviewIngressWebSocketUrl = (params: {
  executorId: string
  previewSessionId: string
  pathWithQuery: string
  targetUrl?: string
}) => {
  const baseUrl = getExecutorPreviewIngressBaseUrl(params.executorId)
  if (!baseUrl) {
    return ''
  }
  const url = new URL(`${baseUrl}/api/preview-ingress/ws/${encodeURIComponent(params.previewSessionId)}`)
  url.searchParams.set('path', params.pathWithQuery)
  if (params.targetUrl?.trim()) {
    url.searchParams.set('targetUrl', params.targetUrl.trim())
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export const probeExecutorPreviewIngress = async (executorId: string) => {
  const baseUrl = getExecutorPreviewIngressBaseUrl(executorId)
  const sharedSecret = getExecutorPreviewProxySecret(executorId)
  const checkedAt = new Date().toISOString()
  if (!baseUrl || !sharedSecret) {
    return {
      reachable: false,
      checkedAt,
      error: !baseUrl ? 'preview ingress base url missing' : 'preview proxy secret missing',
    }
  }

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${sharedSecret}`,
      },
    })
    if (!response.ok) {
      return {
        reachable: false,
        checkedAt,
        error: `health check returned ${response.status}`,
      }
    }
    return {
      reachable: true,
      checkedAt,
      error: '',
    }
  } catch (error) {
    return {
      reachable: false,
      checkedAt,
      error: error instanceof Error ? error.message : 'health check failed',
    }
  }
}

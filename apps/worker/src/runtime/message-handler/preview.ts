// [INPUT]: preview 消息
// [OUTPUT]: 处理结果
// [POS]: preview 消息处理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ControlPlaneToExecutorMessage } from '@shared/types'
import { previewIngressRegistry } from '../../preview-ingress/registry'
import { previewTunnelManager } from '../../preview-tunnel/manager'
import type { ControlPlaneMessageHandlerParams } from './types'

const describePreviewTunnelUrl = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return 'invalid-url'
  }
}

export const handlePreviewMessage = (
  message: ControlPlaneToExecutorMessage,
  params: ControlPlaneMessageHandlerParams,
) => {
  const config = params.getConfig()

  if (message.type === 'preview.tunnel.open') {
    console.log('[preview-tunnel] control open received', {
      previewSessionId: message.previewSessionId,
      executorId: config.executorId,
      tunnelUrl: describePreviewTunnelUrl(message.tunnelUrl),
      targetUrl: message.targetUrl,
    })
    previewIngressRegistry.register({
      previewSessionId: message.previewSessionId,
      workspaceId: message.workspaceId,
      executorId: config.executorId,
      targetUrl: message.targetUrl,
      additionalTargetUrls: [],
      transport: 'mesh-preview-proxy',
    })
    previewTunnelManager.open(message, config, params.send)
    return true
  }

  if (message.type === 'preview.tunnel.close') {
    console.log('[preview-tunnel] control close received', {
      previewSessionId: message.previewSessionId,
      executorId: config.executorId,
    })
    previewTunnelManager.close(message.previewSessionId, 'closed by control plane')
    previewIngressRegistry.unregister(message.previewSessionId)
    return true
  }

  if (message.type === 'preview.ingress.register') {
    previewIngressRegistry.register({
      previewSessionId: message.previewSessionId,
      workspaceId: message.workspaceId,
      executorId: config.executorId,
      publicHost: message.publicHost,
      targetUrl: message.targetUrl,
      additionalTargetUrls: message.additionalTargetUrls,
      transport: message.transport,
    })
    console.log('[preview-ingress] route registered', {
      previewSessionId: message.previewSessionId,
      publicHost: message.publicHost,
      transport: message.transport ?? 'gateway-public-proxy',
      targetUrl: message.targetUrl,
      additionalTargetCount: message.additionalTargetUrls?.length ?? 0,
    })
    return true
  }

  if (message.type === 'preview.ingress.unregister') {
    previewIngressRegistry.unregister(message.previewSessionId)
    console.log('[preview-ingress] route unregistered', {
      previewSessionId: message.previewSessionId,
    })
    return true
  }

  return false
}

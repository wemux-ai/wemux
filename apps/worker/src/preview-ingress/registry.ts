// [INPUT]: 预览注册输入
// [OUTPUT]: 注册表
// [POS]: 预览注册表
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type PreviewIngressRoute = {
  previewSessionId: string
  workspaceId?: string
  executorId?: string
  publicHost?: string
  targetUrl: string
  additionalTargetUrls: string[]
  transport: 'gateway-public-proxy' | 'mesh-preview-proxy'
}

const routes = new Map<string, PreviewIngressRoute>()

export const previewIngressRegistry = {
  register(params: {
    previewSessionId: string
    workspaceId?: string
    executorId?: string
    publicHost?: string
    targetUrl: string
    additionalTargetUrls?: string[]
    transport?: 'gateway-public-proxy' | 'mesh-preview-proxy'
  }) {
    routes.set(params.previewSessionId, {
      previewSessionId: params.previewSessionId,
      workspaceId: params.workspaceId?.trim() || undefined,
      executorId: params.executorId?.trim() || undefined,
      publicHost: params.publicHost?.trim() || undefined,
      targetUrl: params.targetUrl.trim(),
      additionalTargetUrls: Array.from(new Set((params.additionalTargetUrls ?? []).map((value) => value.trim()).filter(Boolean))),
      transport: params.transport ?? 'gateway-public-proxy',
    })
  },

  unregister(previewSessionId: string) {
    routes.delete(previewSessionId)
  },

  get(previewSessionId: string) {
    return routes.get(previewSessionId) ?? null
  },
}

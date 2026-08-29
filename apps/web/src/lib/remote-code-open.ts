import type { WorkspaceRemoteCodeResponse } from '@shared/types'

export const resolveRemoteCodeOpenUrl = (response: WorkspaceRemoteCodeResponse) => (
  response.viewer?.iframeUrl
  || response.remoteCode.iframeUrl
  || ''
)

export const isRemoteCodeTunnelReady = (response: WorkspaceRemoteCodeResponse) => (
  response.remoteCode.phase === 'ready'
  && Boolean(resolveRemoteCodeOpenUrl(response))
  && (
    !response.preview
    || response.preview.status === 'active'
    || response.preview.tunnelClientStatus === 'open'
  )
)

export const waitForRemoteCodeTunnel = async (params: {
  openResponse: WorkspaceRemoteCodeResponse
  poll: () => Promise<WorkspaceRemoteCodeResponse>
  onUpdate?: (response: WorkspaceRemoteCodeResponse) => void
  timeoutMs?: number
  intervalMs?: number
}) => {
  const timeoutMs = params.timeoutMs ?? 30000
  const intervalMs = params.intervalMs ?? 700
  const deadline = Date.now() + timeoutMs
  let latest = params.openResponse

  while (!isRemoteCodeTunnelReady(latest) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    latest = await params.poll()
    params.onUpdate?.(latest)
  }

  return latest
}

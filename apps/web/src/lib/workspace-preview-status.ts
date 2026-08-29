import type { PreviewSessionDto } from '@shared/types'

export const isWorkspacePreviewConnected = (preview: PreviewSessionDto | null) => (
  Boolean(
    preview?.status === 'active'
    && (
      preview.accessMode === 'public-proxy'
      || preview.tunnelClientStatus === 'open'
    ),
  )
)

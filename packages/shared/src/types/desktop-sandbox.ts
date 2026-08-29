export type WorkspaceDesktopSandboxPhase =
  | 'idle'
  | 'creating'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'error'

export type WorkspaceDesktopSandboxOperation =
  | 'status'
  | 'start'
  | 'stop'
  | 'command'
  | 'file.read'
  | 'file.write'
  | 'desktop.action'
  | 'cli.start'
  | 'cli.stop'
  | 'cli.command'

export type WorkspaceDesktopSandboxAction =
  | 'terminal'
  | 'file-manager'
  | 'note'
  | 'demo-window'

export type WorkspaceDesktopSandboxDisplayProfile =
  | 'auto'
  | '1080p'
  | '720p'
  | '480p'

export type WorkspaceDesktopSandboxEffectiveDisplayProfile =
  | '1080p'
  | '720p'
  | '480p'

export type WorkspaceDesktopSandboxProvider =
  | 'opensandbox'
  | 'aio'

export interface WorkspaceDesktopSandboxClientNetworkHint {
  effectiveType?: string
  downlinkMbps?: number
  rttMs?: number
  saveData?: boolean
}

export interface WorkspaceDesktopSandboxDisplaySettings {
  profile: WorkspaceDesktopSandboxDisplayProfile
  effectiveProfile: WorkspaceDesktopSandboxEffectiveDisplayProfile
  width: number
  height: number
  depth: number
  noVncQuality: number
  noVncCompression: number
}

export interface WorkspaceDesktopSandboxCliState {
  phase: WorkspaceDesktopSandboxPhase
  message: string
  image?: string
  sandboxId?: string
  lastOutput?: string
  error?: string
}

export interface WorkspaceDesktopSandboxStatus {
  provider?: WorkspaceDesktopSandboxProvider
  phase: WorkspaceDesktopSandboxPhase
  message: string
  streamUrl?: string
  viewUrl?: string
  controlUrl: string
  streamRedirectUrl: string
  previewId?: string
  previewHost?: string
  password?: string
  sandboxId?: string
  displayProfile?: WorkspaceDesktopSandboxDisplayProfile
  effectiveDisplayProfile?: WorkspaceDesktopSandboxEffectiveDisplayProfile
  displaySettings?: WorkspaceDesktopSandboxDisplaySettings
  lastOutput?: string
  error?: string
  cli?: WorkspaceDesktopSandboxCliState
  containerName?: string
  image?: string
  platform?: string
  hostPort?: number
  mountedCwd?: string
}

export interface WorkspaceDesktopSandboxResult extends WorkspaceDesktopSandboxStatus {
  ok: boolean
  output?: string
}

export interface WorkspaceDesktopSandboxRequest {
  operation: WorkspaceDesktopSandboxOperation
  cwd?: string
  command?: string
  /** 后台执行命令（不等待退出，用于起常驻进程如 Chromium） */
  background?: boolean
  path?: string
  content?: string
  action?: WorkspaceDesktopSandboxAction
  displayProfile?: WorkspaceDesktopSandboxDisplayProfile
  clientNetwork?: WorkspaceDesktopSandboxClientNetworkHint
}

export interface WorkspaceDesktopSandboxDto extends WorkspaceDesktopSandboxResult {
  taskId: string
  workspaceId: string
  workspaceSessionId: string
  executorId: string
  cwd?: string
  agentUsageHint: string
}

export const WORKSPACE_DESKTOP_SANDBOX_FIXED_DISPLAY = {
  width: 1920,
  height: 1080,
  depth: 24,
} as const

export const WORKSPACE_DESKTOP_SANDBOX_QUALITY_PROFILES: Record<
  WorkspaceDesktopSandboxEffectiveDisplayProfile,
  Pick<WorkspaceDesktopSandboxDisplaySettings, 'noVncQuality' | 'noVncCompression'>
> = {
  '1080p': {
    noVncQuality: 8,
    noVncCompression: 5,
  },
  '720p': {
    noVncQuality: 5,
    noVncCompression: 7,
  },
  '480p': {
    noVncQuality: 3,
    noVncCompression: 9,
  },
}

export const normalizeWorkspaceDesktopSandboxDisplayProfile = (
  profile?: WorkspaceDesktopSandboxDisplayProfile,
): WorkspaceDesktopSandboxDisplayProfile => (
  profile === 'auto' || profile === '1080p' || profile === '720p' || profile === '480p'
    ? profile
    : 'auto'
)

export const resolveWorkspaceDesktopSandboxEffectiveDisplayProfile = (
  profile?: WorkspaceDesktopSandboxDisplayProfile,
  network?: WorkspaceDesktopSandboxClientNetworkHint,
): WorkspaceDesktopSandboxEffectiveDisplayProfile => {
  const normalizedProfile = normalizeWorkspaceDesktopSandboxDisplayProfile(profile)
  if (normalizedProfile !== 'auto') {
    return normalizedProfile
  }

  if (network?.saveData) return '480p'

  const effectiveType = network?.effectiveType?.toLowerCase()
  if (effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g') {
    return '480p'
  }

  const downlink = network?.downlinkMbps
  const rtt = network?.rttMs
  if (typeof downlink === 'number' && downlink > 0) {
    if (downlink < 1.8) return '480p'
    if (downlink >= 8 && (!rtt || rtt <= 120)) return '1080p'
  }
  if (typeof rtt === 'number' && rtt > 250) return '480p'

  return '720p'
}

export const resolveWorkspaceDesktopSandboxDisplaySettings = (params: {
  profile?: WorkspaceDesktopSandboxDisplayProfile
  network?: WorkspaceDesktopSandboxClientNetworkHint
} = {}): WorkspaceDesktopSandboxDisplaySettings => {
  const profile = normalizeWorkspaceDesktopSandboxDisplayProfile(params.profile)
  const effectiveProfile = resolveWorkspaceDesktopSandboxEffectiveDisplayProfile(profile, params.network)
  const qualityProfile = WORKSPACE_DESKTOP_SANDBOX_QUALITY_PROFILES[effectiveProfile]
  return {
    profile,
    effectiveProfile,
    width: WORKSPACE_DESKTOP_SANDBOX_FIXED_DISPLAY.width,
    height: WORKSPACE_DESKTOP_SANDBOX_FIXED_DISPLAY.height,
    depth: WORKSPACE_DESKTOP_SANDBOX_FIXED_DISPLAY.depth,
    noVncQuality: qualityProfile.noVncQuality,
    noVncCompression: qualityProfile.noVncCompression,
  }
}

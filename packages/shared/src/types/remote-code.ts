export type WorkspaceRemoteCodeOperation = 'status' | 'start' | 'stop' | 'restart'

export type WorkspaceRemoteCodePhase =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'error'

export interface WorkspaceRemoteCodeRequest {
  operation: WorkspaceRemoteCodeOperation
  workspaceId: string
  workspaceSessionId: string
  cwd: string
}

export interface WorkspaceRemoteCodeResult {
  ok: boolean
  phase: WorkspaceRemoteCodePhase
  workspaceId: string
  workspaceSessionId: string
  cwd?: string
  localUrl?: string
  password?: string
  pid?: number
  port?: number
  startedAt?: string
  updatedAt: string
  message?: string
  error?: string
}

export interface WorkspaceRemoteCodeDto extends Omit<WorkspaceRemoteCodeResult, 'password'> {
  taskId: string
  executorId: string
  previewId?: string
  publicUrl?: string
  iframeUrl?: string
  passwordAvailable?: boolean
}

export interface WorkspaceRemoteCodeResponse {
  remoteCode: WorkspaceRemoteCodeDto
  preview?: import('./preview').PreviewSessionDto | null
  viewer?: import('./preview').PreviewViewerAccess | null
  passwordOnce?: string
}

import type { ExecutorDirectoryBrowseResult } from '@shared/types'

type WorkspaceDirectoryBrowse = (
  executorId: string,
  rootPath: string,
  directoryPath: string,
  timeoutMs?: number,
) => Promise<ExecutorDirectoryBrowseResult>

type WorkspaceDirectoryProbeResult =
  | { ready: true }
  | { ready: false; message?: string }

export const buildWorkspaceDirectoryNotReadyMessage = (cwd: string, detail?: string) => {
  const normalizedDetail = detail?.trim()
  return normalizedDetail
    ? `工作区目录准备后不可访问：${cwd}（${normalizedDetail}）`
    : `工作区目录准备后不可访问：${cwd}`
}

export const verifyWorkspaceDirectoryReady = async (params: {
  executorId: string
  cwd: string
  browseDirectory: WorkspaceDirectoryBrowse
  timeoutMs?: number
}) => {
  try {
    const result = await params.browseDirectory(params.executorId, params.cwd, params.cwd, params.timeoutMs ?? 5000)
    if (result.ok) {
      return { ok: true as const }
    }

    return {
      ok: false as const,
      message: buildWorkspaceDirectoryNotReadyMessage(params.cwd, result.message),
    }
  } catch (error) {
    return {
      ok: false as const,
      message: buildWorkspaceDirectoryNotReadyMessage(
        params.cwd,
        error instanceof Error ? error.message : String(error),
      ),
    }
  }
}

export const probeWorkspaceDirectoryOnExecutor = async (params: {
  executorId: string
  cwd: string
  browseDirectory: WorkspaceDirectoryBrowse
  timeoutMs?: number
}): Promise<WorkspaceDirectoryProbeResult> => {
  try {
    const result = await params.browseDirectory(params.executorId, params.cwd, params.cwd, params.timeoutMs ?? 5000)
    return result.ok
      ? { ready: true }
      : { ready: false, message: result.message }
  } catch (error) {
    return {
      ready: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export const shouldEnsureWorkspaceDirectoryOnExecutor = async (params: {
  executorId: string
  cwd: string
  workingDirectoryMode: 'worktree' | 'original-dir'
  worktreeStatus?: string | null
  browseDirectory: WorkspaceDirectoryBrowse
  timeoutMs?: number
}) => {
  const probe = await probeWorkspaceDirectoryOnExecutor({
    executorId: params.executorId,
    cwd: params.cwd,
    browseDirectory: params.browseDirectory,
    timeoutMs: params.timeoutMs,
  })

  if (probe.ready) {
    if (params.workingDirectoryMode === 'worktree' && params.worktreeStatus !== 'created') {
      return {
        shouldEnsure: true,
        probe,
        reason: 'status-not-created' as const,
      }
    }

    return {
      shouldEnsure: params.workingDirectoryMode === 'original-dir',
      probe,
      reason: params.workingDirectoryMode === 'original-dir' ? 'original-dir-verify' as const : 'directory-ready' as const,
    }
  }

  return {
    shouldEnsure: true,
    probe,
    reason: 'directory-missing' as const,
  }
}

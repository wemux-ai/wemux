import { buildWorkspaceOpenCommandAttempts, getWorkspaceOpenTargetLabel, type WorkspaceOpenTarget } from '@shared/workspace-open-command'
import { toast } from 'sonner'
import { api } from './api'
import { resolveFirstOpenableExecutorDirectory } from './executor-open-path'

type WorkspaceOpenTranslation = (key: string, options?: Record<string, unknown>) => string

type OpenWorkspaceInTargetParams = {
  executorId?: string
  executorName: string
  platform?: string
  candidateCwds: string[]
  target: WorkspaceOpenTarget
  customCommand?: string
  debugPrefix: string
  t: WorkspaceOpenTranslation
}

const now = () => globalThis.performance?.now?.() ?? Date.now()

const formatElapsed = (durationMs: number) => durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${Math.round(durationMs)}ms`

const previewCommand = (command: string) => command.trim().replace(/\s+/g, ' ').slice(0, 120)

const previewOutput = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 180)

export const openWorkspaceInTarget = async ({
  executorId,
  executorName,
  platform,
  candidateCwds,
  target,
  customCommand,
  debugPrefix,
  t,
}: OpenWorkspaceInTargetParams) => {
  if (!executorId) {
    toast.error(t('workspace.noBoundExecutor', { defaultValue: '当前工作区还没有绑定执行节点。' }))
    return false
  }

  if (candidateCwds.length === 0) {
    toast.error(t('workspace.noOpenablePath', { defaultValue: '当前工作区还没有可打开的目录。' }))
    return false
  }

  if (target === 'custom' && !customCommand?.trim()) {
    toast.error(t('workspace.openTarget.customCommandMissing', { defaultValue: '请先在设置里填写自定义打开命令。' }))
    return false
  }

  const targetLabel = getWorkspaceOpenTargetLabel(target)
  const startedAt = now()
  const loadingToastId = toast.loading(t('workspace.openTarget.opening', {
    defaultValue: '正在节点 {{name}} 上打开 {{target}}，请稍候…',
    name: executorName,
    target: targetLabel,
  }))
  console.groupCollapsed(`${debugPrefix} ${executorName}`)
  console.info(`${debugPrefix} start`, {
    candidateCwds,
    executorId,
    executorName,
    platform: platform || 'unknown',
    target,
    targetLabel,
  })

  try {
    const openableCwds = await resolveFirstOpenableExecutorDirectory(executorId, candidateCwds, {
      onProbeStart: ({ candidatePath, index, total }) => {
        toast.loading(`正在检查可打开目录 ${index}/${total}…`, { id: loadingToastId })
        console.info(`${debugPrefix} directory probe start`, { candidatePath, index, total, target })
      },
      onProbeFinish: ({ candidatePath, durationMs, index, message, ok, total }) => {
        console.info(`${debugPrefix} directory probe finish`, {
          candidatePath,
          duration: formatElapsed(durationMs ?? 0),
          index,
          message: message || '',
          ok,
          target,
          total,
        })
      },
    })
    console.info(`${debugPrefix} selected openable directories`, { openableCwds, target })

    const totalAttempts = openableCwds.reduce((count, cwd) => (
      count + buildWorkspaceOpenCommandAttempts({
        target,
        platform,
        path: cwd,
        customCommand,
      }).length
    ), 0)

    if (totalAttempts === 0) {
      toast.error(t('workspace.openTarget.notFound', {
        defaultValue: '节点 {{name}} 上未找到可用的 {{target}} 打开方式。',
        name: executorName,
        target: targetLabel,
      }))
      return false
    }

    let attemptedCount = 0
    let lastFailureMessage = ''

    for (const cwd of openableCwds) {
      const attempts = buildWorkspaceOpenCommandAttempts({
        target,
        platform,
        path: cwd,
        customCommand,
      })
      for (const command of attempts) {
        attemptedCount += 1
        const commandPreview = previewCommand(command)
        const attemptStartedAt = now()
        toast.loading(`正在尝试 ${attemptedCount}/${totalAttempts} 打开 ${targetLabel}…`, { id: loadingToastId })
        console.info(`${debugPrefix} command attempt start`, {
          attempt: attemptedCount,
          command: commandPreview,
          cwd,
          target,
          totalAttempts,
        })

        try {
          const response = await api.executeExecutorTerminal(executorId, {
            command,
            cwd,
            mode: 'background',
          })
          const durationMs = now() - attemptStartedAt
          const failurePreview = previewOutput(response.result.stderr || response.result.stdout || '')
          console.info(`${debugPrefix} command attempt finish`, {
            attempt: attemptedCount,
            duration: formatElapsed(durationMs),
            exitCode: response.result.exitCode,
            output: failurePreview,
            target,
          })
          if (response.result.exitCode === 0) {
            const totalDurationMs = now() - startedAt
            console.info(`${debugPrefix} success`, {
              attempt: attemptedCount,
              command: commandPreview,
              cwd,
              target,
              totalDuration: formatElapsed(totalDurationMs),
            })
            toast.success(`${t('workspace.openTarget.opened', {
              defaultValue: '已在节点 {{name}} 打开 {{target}}。',
              name: executorName,
              target: targetLabel,
            })}（${formatElapsed(totalDurationMs)}）`)
            return true
          }

          lastFailureMessage = response.result.stderr.trim() || response.result.stdout.trim() || lastFailureMessage
        } catch (error) {
          const durationMs = now() - attemptStartedAt
          lastFailureMessage = error instanceof Error ? error.message : lastFailureMessage
          console.warn(`${debugPrefix} command attempt error`, {
            attempt: attemptedCount,
            command: commandPreview,
            cwd,
            duration: formatElapsed(durationMs),
            error: lastFailureMessage,
            target,
          })
        }
      }
    }

    console.warn(`${debugPrefix} failed`, {
      elapsed: formatElapsed(now() - startedAt),
      lastFailureMessage,
      target,
    })
    toast.error(lastFailureMessage || t('workspace.openTarget.notFound', {
      defaultValue: '节点 {{name}} 上未找到可用的 {{target}} 打开方式。',
      name: executorName,
      target: targetLabel,
    }))
    return false
  } finally {
    console.groupEnd()
    toast.dismiss(loadingToastId)
  }
}

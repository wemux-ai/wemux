// [INPUT]: 主聊天运行时状态输入
// [OUTPUT]: 状态快照
// [POS]: 主聊天运行时状态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const buildMainChatExecutionKey = (userId: string, sessionId: string) => {
  return `${userId}:${sessionId}`
}

const activeMainChatAbortControllers = new Map<string, AbortController>()

export const bindMainChatExecutionAbortSignal = (params: {
  userId: string
  sessionId: string
  upstreamSignal?: AbortSignal
}) => {
  const localController = new AbortController()
  const combinedController = new AbortController()
  const executionKey = buildMainChatExecutionKey(params.userId, params.sessionId)

  const abortCombined = (reason?: unknown) => {
    if (!combinedController.signal.aborted) {
      combinedController.abort(reason)
    }
  }

  const handleLocalAbort = () => {
    abortCombined(localController.signal.reason)
  }

  const handleUpstreamAbort = () => {
    abortCombined(params.upstreamSignal?.reason)
  }

  localController.signal.addEventListener('abort', handleLocalAbort, { once: true })
  params.upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true })
  activeMainChatAbortControllers.set(executionKey, localController)

  if (params.upstreamSignal?.aborted) {
    abortCombined(params.upstreamSignal.reason)
  }

  return {
    signal: combinedController.signal,
    cleanup() {
      localController.signal.removeEventListener('abort', handleLocalAbort)
      params.upstreamSignal?.removeEventListener('abort', handleUpstreamAbort)
      if (activeMainChatAbortControllers.get(executionKey) === localController) {
        activeMainChatAbortControllers.delete(executionKey)
      }
    },
  }
}

export const stopMainChatExecution = (params: {
  userId: string
  sessionId: string
}) => {
  const controller = activeMainChatAbortControllers.get(
    buildMainChatExecutionKey(params.userId, params.sessionId),
  )
  if (!controller) {
    return false
  }

  controller.abort('user_stop')
  return true
}

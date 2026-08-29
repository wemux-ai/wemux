import type { ControlPlaneToExecutorMessage } from '@shared/types'
import { handleConfigSyncMessage, syncWorkerAgentConfig, syncWorkerOpenCodeConfig } from './config-sync'
import { handleCodexOauthMessage } from './codex-oauth'
import { handleExecutorOpsMessage } from './executor-ops'
import { handlePreviewMessage } from './preview'
import { createPromptQueue } from './prompt-queue'
import { handleTaskMessage } from './task'
import { handleTerminalMessage } from './terminal'
import type { ControlPlaneMessageHandlerParams } from './types'

export { syncWorkerAgentConfig, syncWorkerOpenCodeConfig }

export const createControlPlaneMessageHandler = (params: ControlPlaneMessageHandlerParams) => {
  const promptQueue = createPromptQueue(params)

  const handleMessage = (message: ControlPlaneToExecutorMessage) => {
    if (params.getCurrentSocket() !== params.expectedSocket) {
      return
    }

    if (handleConfigSyncMessage(message, params)) {
      return
    }

    if (handleCodexOauthMessage(message, params)) {
      return
    }

    if (handleExecutorOpsMessage(message, params)) {
      return
    }

    if (handlePreviewMessage(message, params)) {
      return
    }

    if (message.type === 'executor.agent.prompt.request' || message.type === 'executor.agent.prompt.cancel') {
      promptQueue.handlePromptMessage(message)
      return
    }

    if (handleTerminalMessage(message, params)) {
      return
    }

    if (handleTaskMessage(message, params)) {
      return
    }
  }

  return {
    abortActivePrompts: promptQueue.abortActivePrompts,
    handleMessage,
    drainPromptQueue: promptQueue.drainPromptQueue,
  }
}

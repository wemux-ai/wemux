import { createOpencodeClient } from '@opencode-ai/sdk'
import { createOpenCodeInactivityTracker } from '@shared/opencode-activity'
import { unwrapOpenCodeEvent } from '@shared/opencode-event'
import {
  extractOpenCodeTextOutput,
  getOpenCodeErrorFromMessageEntries,
  getOpenCodeOutputFromMessageEntries,
  hasSettledOpenCodeAssistantEntry,
  isOpenCodeMissingTextOutput,
  OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE,
} from '@shared/opencode-message-output'
import type { Project, Task } from '@shared/types'
import { getErrorText, getOpencodeClient, getTaskWorkingDirectory, logOpenCodeDebug, parseExecutionModel } from './core'

const PROMPT_OUTPUT_POLL_INTERVAL_MS = 500
const PROMPT_OUTPUT_POLL_TIMEOUT_MS = 120_000
const PROMPT_OUTPUT_LOOKBACK_MS = 1_000
const OPENCODE_NO_ACTIVITY_TIMEOUT_ERROR_MESSAGE = `OpenCode 会话已启动，但在 ${PROMPT_OUTPUT_POLL_TIMEOUT_MS}ms 内没有返回事件或文本输出。`

const createAbortError = () => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export const isAbortError = (error: unknown) => {
  return error instanceof Error && error.name === 'AbortError'
}

export const createSession = async (client: ReturnType<typeof createOpencodeClient>, cwd: string, title: string) => {
  const session = await client.session.create({
    body: { title },
    query: { directory: cwd },
  })

  if (!session.data?.id) {
    const reason = getErrorText(session)
    throw new Error(reason === 'OpenCode 执行失败。' ? 'OpenCode 会话创建失败' : `OpenCode 会话创建失败：${reason}`)
  }

  return session.data.id
}

export const ensureSession = async (
  client: ReturnType<typeof createOpencodeClient>,
  cwd: string,
  sessionId: string | undefined,
  title: string,
) => {
  if (!sessionId) {
    return createSession(client, cwd, title)
  }

  try {
    const session = await client.session.get({
      path: { id: sessionId },
      query: { directory: cwd },
    })

    if (!session.data) {
      return createSession(client, cwd, title)
    }

    await client.session.update({
      path: { id: sessionId },
      body: { title },
      query: { directory: cwd },
    })

    return sessionId
  } catch {
    return createSession(client, cwd, title)
  }
}

const sessionPromptLocks = new Map<string, Promise<void>>()

export const withOpencodeSessionLock = async <T>(
  sessionId: string,
  runner: (context: { waited: boolean }) => Promise<T>,
) => {
  const previous = sessionPromptLocks.get(sessionId) ?? Promise.resolve()
  const waited = sessionPromptLocks.has(sessionId)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.finally(() => current)
  sessionPromptLocks.set(sessionId, tail)

  await previous.catch(() => undefined)

  try {
    return await runner({ waited })
  } finally {
    release()
    if (sessionPromptLocks.get(sessionId) === tail) {
      sessionPromptLocks.delete(sessionId)
    }
  }
}

type PromptPart = {
  type: string
  text?: string
}

type PromptMessageInfo = {
  id?: string
  role?: string
  time?: {
    created?: number
    completed?: number
  }
  error?: unknown
}

type PromptMessageEntry = {
  info?: PromptMessageInfo
  parts?: PromptPart[]
}

const getParts = (parts?: PromptPart[]) => Array.isArray(parts) ? parts : []

const summarizeEntries = (entries: PromptMessageEntry[]) => {
  return entries.map((entry) => ({
    id: entry.info?.id,
    role: entry.info?.role,
    created: entry.info?.time?.created,
    completed: Boolean(entry.info?.time?.completed),
    error: Boolean(entry.info?.error),
    partTypes: getParts(entry.parts).map((part) => part.type),
    textPreview: extractTextOutput(getParts(entry.parts)).slice(0, 160),
  }))
}

const readSessionSnapshot = async (client: ReturnType<typeof createOpencodeClient>, cwd: string, sessionId: string) => {
  try {
    const messages = await client.session.messages({
      path: { id: sessionId },
      query: { directory: cwd, limit: 20 },
    })

    return summarizeEntries(Array.isArray(messages.data) ? messages.data as PromptMessageEntry[] : [])
  } catch (error) {
    return [{ snapshotError: getErrorText(error) }]
  }
}

const extractTextOutput = (parts: PromptPart[]) => {
  return extractOpenCodeTextOutput(parts)
}

const extractStreamingText = (parts: Map<string, string>) => {
  return [...parts.values()]
    .join('')
    .trim()
}

const getMessageTextState = (state: Map<string, Map<string, string>>, messageId: string) => {
  const existing = state.get(messageId)
  if (existing) {
    return existing
  }

  const next = new Map<string, string>()
  state.set(messageId, next)
  return next
}

const applyOpenCodePartTextDelta = (
  state: Map<string, Map<string, string>>,
  delta: Record<string, unknown>,
) => {
  const messageId = typeof delta.messageID === 'string' ? delta.messageID.trim() : ''
  const partId = typeof delta.partID === 'string' ? delta.partID.trim() : ''
  const textDelta = typeof delta.delta === 'string' ? delta.delta : ''
  if (!messageId || !partId || delta.field !== 'text' || !textDelta) {
    return undefined
  }

  const partState = getMessageTextState(state, messageId)
  const previousText = partState.get(partId) ?? ''
  const text = `${previousText}${textDelta}`
  partState.set(partId, text)

  return {
    id: partId,
    sessionID: typeof delta.sessionID === 'string' ? delta.sessionID : undefined,
    messageID: messageId,
    type: 'text',
    text,
  }
}

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const promptSession = async (
  client: ReturnType<typeof createOpencodeClient>,
  cwd: string,
  sessionId: string,
  prompt: string,
  model?: Task['executionModel'],
  system?: string,
  signal?: AbortSignal,
) => {
  const selectedModel = parseExecutionModel(model)
  const promptStartedAtMs = Date.now()
  const inactivityTracker = createOpenCodeInactivityTracker(PROMPT_OUTPUT_POLL_TIMEOUT_MS)
  let aborted = false
  let promptError: Error | null = null
  const textStateByMessageId = new Map<string, Map<string, string>>()
  let sawRelevantActivity = false
  let assistantMessageId = ''
  const abortController = new AbortController()
  let promptTimedOut = false
  let promptTimeout: NodeJS.Timeout | null = null
  const schedulePromptTimeout = () => {
    if (promptTimeout) {
      clearTimeout(promptTimeout)
    }

    promptTimeout = setTimeout(() => {
      if (aborted || signal?.aborted || promptError) {
        return
      }

      promptTimedOut = true
      promptError = new Error(OPENCODE_NO_ACTIVITY_TIMEOUT_ERROR_MESSAGE)
      logOpenCodeDebug('sdk:prompt-timeout', {
        cwd,
        sessionId,
        sawRelevantActivity,
        lastActivityAt: inactivityTracker.getLastActivityAt(),
        inactiveForMs: inactivityTracker.getElapsedSinceActivity(),
      })
      abortController.abort()
    }, inactivityTracker.getRemainingMs())
  }
  const markRelevantActivity = () => {
    sawRelevantActivity = true
    inactivityTracker.markActivity()
    schedulePromptTimeout()
  }

  schedulePromptTimeout()
  const handleAbort = () => {
    aborted = true
    if (promptTimeout) {
      clearTimeout(promptTimeout)
      promptTimeout = null
    }
    abortController.abort()
    void client.session.abort({
      path: { id: sessionId },
      query: { directory: cwd },
    }).catch(() => undefined)
  }

  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    logOpenCodeDebug('sdk:prompt-start', {
      cwd,
      sessionId,
      model: model ?? 'default',
      promptPreview: prompt.slice(0, 200),
      hasSystem: Boolean(system),
    })
    const subscription = await client.event.subscribe({ signal: abortController.signal })
    logOpenCodeDebug('sdk:prompt-subscribed', { cwd, sessionId })
    const promptPromise = client.session.promptAsync({
      path: { id: sessionId },
      query: { directory: cwd },
      body: {
        model: selectedModel,
        system,
        parts: [{ type: 'text', text: prompt }],
      },
    }).then((result) => {
      logOpenCodeDebug('sdk:prompt-async-result', {
        cwd,
        sessionId,
        ok: !('error' in result) || !result.error,
        error: 'error' in result && result.error ? getErrorText(result.error) : undefined,
        hasData: 'data' in result ? Boolean(result.data) : undefined,
      })

      if ('error' in result && result.error) {
        throw result.error
      }

      return result
    }).catch((error) => {
      if (aborted || signal?.aborted) {
        return undefined
      }

      promptError = error instanceof Error ? error : new Error(getErrorText(error))
      logOpenCodeDebug('sdk:prompt-async-error', {
        cwd,
        sessionId,
        error: promptError.message,
      })
      abortController.abort()
      return undefined
    })

    for await (const rawEvent of subscription.stream as AsyncIterable<Record<string, unknown>>) {
      if (aborted || signal?.aborted) {
        throw createAbortError()
      }

      const event = unwrapOpenCodeEvent(rawEvent)
      if (!event) {
        continue
      }

      if (event.type === 'session.status') {
        const currentSessionId = event.properties.sessionID
        if (currentSessionId === sessionId) {
          markRelevantActivity()
          logOpenCodeDebug('sdk:event-session-status', {
            sessionId,
            status: event.properties.status,
          })
        }
        continue
      }

      if (event.type === 'message.updated') {
        const info = event.properties.info as { id?: string; sessionID?: string; role?: string }
        if (info.sessionID !== sessionId || info.role !== 'assistant' || !info.id) {
          continue
        }

        assistantMessageId = info.id
        markRelevantActivity()
        logOpenCodeDebug('sdk:event-message-updated', {
          sessionId,
          assistantMessageId,
          role: info.role,
        })
        continue
      }

      if (event.type === 'message.part.delta') {
        const part = applyOpenCodePartTextDelta(textStateByMessageId, event.properties)
        if (!part) {
          continue
        }

        if (part.sessionID !== sessionId) {
          continue
        }

        if (assistantMessageId && part.messageID !== assistantMessageId) {
          continue
        }

        markRelevantActivity()
        logOpenCodeDebug('sdk:event-message-part-delta', {
          sessionId,
          assistantMessageId,
          partId: part.id,
          messageId: part.messageID,
          textPreview: part.text.slice(0, 120),
        })
        continue
      }

      if (event.type === 'message.part.updated') {
        const part = event.properties.part as {
          id: string
          sessionID?: string
          messageID?: string
          type: string
          text?: string
        }

        if (part.sessionID !== sessionId) {
          continue
        }

        if (assistantMessageId && part.messageID !== assistantMessageId) {
          continue
        }

        markRelevantActivity()
        logOpenCodeDebug('sdk:event-message-part', {
          sessionId,
          assistantMessageId,
          partId: part.id,
          messageId: part.messageID,
          partType: part.type,
          textPreview: (part.text ?? '').slice(0, 120),
        })
        if (part.type === 'text' && part.messageID) {
          getMessageTextState(textStateByMessageId, part.messageID).set(part.id, part.text ?? '')
        }
        continue
      }

      if (event.type === 'session.error') {
        const properties = event.properties as { sessionID?: string; error?: unknown }
        if (properties.sessionID !== sessionId) {
          continue
        }

        logOpenCodeDebug('sdk:event-session-error', {
          sessionId,
          error: properties.error,
        })

        throw new Error(getErrorText(properties.error))
      }

      if (event.type === 'session.idle') {
        const properties = event.properties as { sessionID?: string }
        if (properties.sessionID === sessionId && sawRelevantActivity) {
          logOpenCodeDebug('sdk:event-session-idle', {
            sessionId,
            assistantMessageId,
            textPartCount: assistantMessageId ? (textStateByMessageId.get(assistantMessageId)?.size ?? 0) : 0,
          })
          break
        }
      }
    }

    abortController.abort()
    await promptPromise

    if (aborted || signal?.aborted) {
      throw createAbortError()
    }

    if (promptError) {
      throw promptError
    }

    let output = assistantMessageId
      ? extractStreamingText(textStateByMessageId.get(assistantMessageId) ?? new Map())
      : ''
    let settledAssistantError = ''
    if (!output) {
      for (let attempt = 0; attempt === 0 || !inactivityTracker.hasTimedOut(); attempt += 1) {
        if (attempt > 0) {
          await sleep(PROMPT_OUTPUT_POLL_INTERVAL_MS)
        }

        const [messages, sessionStatuses] = await Promise.all([
          client.session.messages({
            path: { id: sessionId },
            query: { directory: cwd, limit: 20 },
          }),
          client.session.status({
            query: { directory: cwd },
          }).catch(() => null),
        ])
        const entries = Array.isArray(messages.data) ? messages.data as PromptMessageEntry[] : []
        const promptWindowStartedAtMs = assistantMessageId
          ? undefined
          : Math.max(0, promptStartedAtMs - PROMPT_OUTPUT_LOOKBACK_MS)
        const currentSessionStatus = sessionStatuses?.data
          && typeof sessionStatuses.data === 'object'
          && sessionId in sessionStatuses.data
          ? sessionStatuses.data[sessionId]
          : undefined
        const sessionStillBusy = currentSessionStatus?.type === 'busy'

        output = getOpenCodeOutputFromMessageEntries(entries, {
          preferredMessageId: assistantMessageId,
          promptStartedAtMs: promptWindowStartedAtMs,
        })
        settledAssistantError = getOpenCodeErrorFromMessageEntries(entries, {
          preferredMessageId: assistantMessageId,
          promptStartedAtMs: promptWindowStartedAtMs,
        })
        const hasSettledAssistantOutput = hasSettledOpenCodeAssistantEntry(entries, {
          preferredMessageId: assistantMessageId,
          promptStartedAtMs: promptWindowStartedAtMs,
        })
        if (output || settledAssistantError || hasSettledAssistantOutput || sessionStillBusy) {
          markRelevantActivity()
        }
        if (output && !sessionStillBusy && hasSettledAssistantOutput) {
          break
        }

        if (!sessionStillBusy && hasSettledAssistantOutput) {
          break
        }
      }
    }

    if (!output && settledAssistantError) {
      throw new Error(settledAssistantError)
    }

    if (isOpenCodeMissingTextOutput(output)) {
      throw new Error(OPENCODE_MISSING_TEXT_OUTPUT_ERROR_MESSAGE)
    }

    logOpenCodeDebug('sdk:prompt-finish', {
      cwd,
      sessionId,
      assistantMessageId,
      outputPreview: output.slice(0, 200),
    })

    return output
  } catch (error) {
    if (promptTimedOut && isAbortError(error)) {
      throw promptError ?? error
    }

    logOpenCodeDebug('sdk:prompt-error', {
      cwd,
      sessionId,
      assistantMessageId,
      aborted,
      error: getErrorText(error),
      snapshot: await readSessionSnapshot(client, cwd, sessionId),
    })
    throw error
  } finally {
    if (promptTimeout) {
      clearTimeout(promptTimeout)
    }
    signal?.removeEventListener('abort', handleAbort)
  }
}

export const runTransientOpenCodePrompt = async (
  cwd: string,
  prompt: string,
  title: string,
  modelOrSystem?: string,
  maybeSystem?: string,
) => {
  const model = maybeSystem === undefined ? undefined : modelOrSystem
  const system = maybeSystem === undefined ? modelOrSystem : maybeSystem
  logOpenCodeDebug('sdk:start', { cwd, promptPreview: prompt.slice(0, 160), title, mode: 'transient', model: model ?? 'default' })

  try {
    const client = await getOpencodeClient(cwd)
    const sessionId = await createSession(client, cwd, title)
    const output = await promptSession(client, cwd, sessionId, prompt, model, system)
    await client.session.delete({ path: { id: sessionId }, query: { directory: cwd } }).catch(() => undefined)

    logOpenCodeDebug('sdk:finish', { ok: true, outputPreview: output.slice(0, 200), sessionId, model: model ?? 'default' })
    return { ok: true, output }
  } catch (error) {
    const errorMessage = getErrorText(error)
    logOpenCodeDebug('sdk:error', { error: errorMessage, mode: 'transient', model: model ?? 'default' })
    return { ok: false, output: errorMessage }
  }
}

export const runPersistentOpenCodePrompt = async (task: Task | WorkspaceTaskExecutionView, project: Project, prompt: string, system?: string, signal?: AbortSignal) => {
  const cwd = getTaskWorkingDirectory(task, project)
  const runtimeSessionId = 'agentSessionId' in task ? (task.agentSessionId ?? task.opencodeSessionId) : undefined

  logOpenCodeDebug('sdk:start', { cwd, promptPreview: prompt.slice(0, 160), taskId: task.id, mode: 'persistent' })

  try {
    const client = await getOpencodeClient(cwd)
    const sessionId = await ensureSession(client, cwd, runtimeSessionId, `Task: ${task.title}`)
    const output = await withOpencodeSessionLock(sessionId, async () => {
      return promptSession(client, cwd, sessionId, prompt, task.executionModel, system, signal)
    })

    logOpenCodeDebug('sdk:finish', { ok: true, outputPreview: output.slice(0, 200), sessionId })
    return {
      ok: true,
      output,
      agentSessionId: sessionId,
      opencodeSessionId: sessionId,
    }
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        aborted: true,
        output: '任务已取消',
        agentSessionId: runtimeSessionId,
        opencodeSessionId: runtimeSessionId,
      }
    }

    const errorMessage = getErrorText(error)
    logOpenCodeDebug('sdk:error', { error: errorMessage, taskId: task.id, mode: 'persistent' })
    return {
      ok: false,
      output: errorMessage,
      agentSessionId: runtimeSessionId,
      opencodeSessionId: runtimeSessionId,
    }
  }
}
import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'

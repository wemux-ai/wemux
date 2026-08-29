// [INPUT]: Claude Code stream/control events, prompt execution surface, and runtime settings.
// [OUTPUT]: Streamed Claude responses with surface-scoped tool authorization.
// [POS]: Worker execution adapter for Claude Code prompt turns.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { parseExecutionModelId, toNativeRuntimeModelId } from '@shared/model-profile'
import type { ClaudeCodeAgentSettings, ModelTokenUsage } from '@shared/types'
import { buildAgentRuntimeEnvironment } from './agent-runtime-env'
import { emitAgentEvent, normalizeExecutionModel, readJsonLine, resolveExecutable, shouldSpawnWithShellOnWindows, toAbortError, type WorkerAgentPromptParams, type WorkerAgentPromptResult } from './agent-runner-shared'

type ClaudeControlRequest =
  | {
      type: 'control_request'
      request_id: string
      request:
        | {
            subtype: 'can_use_tool'
            tool_name: string
            input: Record<string, unknown>
            tool_use_id?: string
          }
        | {
            subtype: 'hook_callback'
            callback_id: string
            input: Record<string, unknown>
            tool_use_id?: string
          }
    }
  | {
      type: 'control_cancel_request'
      request_id: string
    }

type ClaudeControlResponse = {
  type: 'control_response'
  response:
    | {
        subtype: 'success'
        request_id: string
        response?: unknown
      }
    | {
        subtype: 'error'
        request_id: string
        error?: string
      }
}

type ClaudeSdkRequest =
  | {
      type: 'control_request'
      request_id: string
      request:
        | {
            subtype: 'initialize'
            hooks?: unknown
          }
        | {
            subtype: 'set_permission_mode'
            mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
          }
        | {
            subtype: 'interrupt'
          }
    }
  | {
      type: 'user'
      message: {
        role: 'user'
        content: string
      }
    }

type ClaudeStreamEvent =
  | { type: 'system'; subtype?: string; session_id?: string }
  | {
      type: 'stream_event'
      session_id?: string
      event: {
        type: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
      }
    }
  | {
      type: 'assistant'
      session_id?: string
      message?: {
        id?: string
        content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
      }
    }
  | {
      type: 'user'
      session_id?: string
      message?: { content?: Array<{ type?: string; tool_use_id?: string; content?: string }> }
    }
  | {
      type: 'result'
      session_id?: string
      result?: string
      is_error?: boolean
      /** Claude Code CLI result 消息携带的 token 用量（与 Anthropic API usage 同构）。 */
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
        service_tier?: string
      }
      total_cost_usd?: number
    }

const normalizeUsageCount = (value: number | undefined) => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

export const extractClaudeResultUsage = (payload: {
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}): ModelTokenUsage | undefined => {
  const usage = payload.usage
  if (!usage) {
    return undefined
  }

  const inputTokens = normalizeUsageCount(usage.input_tokens)
  const outputTokens = normalizeUsageCount(usage.output_tokens)
  const cacheReadTokens = normalizeUsageCount(usage.cache_read_input_tokens)
  const cacheWriteTokens = normalizeUsageCount(usage.cache_creation_input_tokens)
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens: undefined,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
    /** 真实消耗口径：input + output（Claude 不单独报 reasoning，输出里含推理）；cache 单独列不计入总量。 */
    totalTokens: inputTokens + outputTokens,
  }
}

const READ_ONLY_TOOLS = new Set(['Glob', 'Grep', 'LS', 'NotebookRead', 'Read', 'Task', 'TodoRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'TodoWrite', 'Write'])

const normalizeToolName = (value: string) => value.split('(')[0]?.trim() || value.trim()

export const resolveClaudePermissionMode = (settings: ClaudeCodeAgentSettings | undefined) => {
  if (settings?.planMode) {
    return 'plan' as const
  }

  return settings?.permissionMode ?? 'bypassPermissions'
}

const resolveEffectivePermissionMode = (mode: ReturnType<typeof resolveClaudePermissionMode>) => {
  if (mode === 'bypassPermissions' && typeof process.getuid === 'function' && process.getuid() === 0) {
    return 'acceptEdits' as const
  }

  return mode
}

export const shouldAllowClaudeTool = (
  mode: ReturnType<typeof resolveClaudePermissionMode>,
  toolName: string,
) => {
  const normalized = normalizeToolName(toolName)
  if (mode === 'bypassPermissions') {
    return true
  }

  if (READ_ONLY_TOOLS.has(normalized)) {
    return true
  }

  if (mode === 'acceptEdits' && EDIT_TOOLS.has(normalized)) {
    return true
  }

  return false
}

const sendClaudeMessage = (stdin: NodeJS.WritableStream, payload: ClaudeSdkRequest | ClaudeControlResponse) => {
  stdin.write(`${JSON.stringify(payload)}\n`)
}

const isClaudeSessionNotFound = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return /session.*(not found|expired|invalid|does not exist)/i.test(message)
    || /no.*session.*found/i.test(message)
    || /invalid.*session/i.test(message)
}

const runClaudeCodePromptCore = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  const executable = resolveExecutable('claude')
  if (!executable) {
    throw new Error('未检测到 `claude` 可执行文件。')
  }

  const claudeSettings = params.agentSettings && 'permissionMode' in params.agentSettings ? params.agentSettings : undefined
  const requestedProviderId = parseExecutionModelId(params.executionModel)?.providerId || 'anthropic'
  const defaultProviderId = parseExecutionModelId(claudeSettings?.defaultModel)?.providerId || 'anthropic'
  const selectedModel = normalizeExecutionModel(
    toNativeRuntimeModelId('ClaudeCode', requestedProviderId, params.executionModel),
  ) ?? normalizeExecutionModel(
    toNativeRuntimeModelId('ClaudeCode', defaultProviderId, claudeSettings?.defaultModel),
  )
  const permissionMode = resolveClaudePermissionMode(claudeSettings)
  const effectivePermissionMode = resolveEffectivePermissionMode(permissionMode)

  const args = [
    '-p',
    '--output-format=stream-json',
    '--input-format=stream-json',
    '--verbose',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-mode',
    effectivePermissionMode,
    ...(params.runtimeArgs ?? []),
  ]

  if (selectedModel) {
    args.push('--model', selectedModel)
  }

  const resumeSessionId = params.resumeSessionId?.trim()
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }

  return new Promise<WorkerAgentPromptResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: params.cwd,
      env: {
        ...buildAgentRuntimeEnvironment(),
        ...(params.runtimeEnv ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: shouldSpawnWithShellOnWindows(executable),
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let sessionId = ''
    let assistantMessageId = ''
    let finalOutput = ''
    let lastError = ''
    let completed = false
    /** Claude Code CLI result 消息携带的 token 用量。 */
    let claudeUsage: ModelTokenUsage | undefined
    const textState = new Map<string, string>()
    const reasoningState = new Map<string, string>()

    const ensureAssistantMessage = () => {
      assistantMessageId = assistantMessageId || `${sessionId || 'claude'}:assistant`
      emitAgentEvent('ClaudeCode', params.onEvent, {
        type: 'message.updated',
        properties: {
          info: {
            id: assistantMessageId,
            role: 'assistant',
          },
        },
      })
      return assistantMessageId
    }

    const emitTextPart = (kind: 'text' | 'reasoning', partId: string, text: string, delta?: string) => {
      emitAgentEvent('ClaudeCode', params.onEvent, {
        type: 'message.part.updated',
        properties: {
          part: {
            id: partId,
            messageID: ensureAssistantMessage(),
            type: kind,
            text,
          },
          delta,
        },
      })
    }

    const sendControlResponse = (response: ClaudeControlResponse['response']) => {
      sendClaudeMessage(child.stdin, {
        type: 'control_response',
        response,
      })
    }

    const emitPendingInteraction = (interaction: {
      id: string
      type: 'question' | 'approval' | 'permission'
      title: string
      prompt?: string
      toolName?: string
    }) => {
      emitAgentEvent('ClaudeCode', params.onEvent, {
        type: 'interaction.pending',
        properties: {
          interaction: {
            ...interaction,
            status: 'pending',
            provider: 'ClaudeCode',
          },
        },
      })
    }

    const handleControlRequest = (payload: ClaudeControlRequest) => {
      if (payload.type !== 'control_request') {
        return
      }

      if (payload.request.subtype === 'hook_callback') {
        sendControlResponse({
          subtype: 'success',
          request_id: payload.request_id,
          response: {},
        })
        return
      }

      const toolName = payload.request.tool_name
      const allowed = shouldAllowClaudeTool(effectivePermissionMode, toolName)

      if (!allowed) {
        emitPendingInteraction({
          id: payload.request.tool_use_id?.trim() || payload.request_id,
          type: 'permission',
          title: toolName,
          prompt: payload.request.input ? JSON.stringify(payload.request.input, null, 2) : undefined,
          toolName,
        })
        emitAgentEvent('ClaudeCode', params.onEvent, {
          type: 'permission.updated',
          properties: {
            title: toolName,
          },
        })
      }

      sendControlResponse({
        subtype: 'success',
        request_id: payload.request_id,
        response: allowed
          ? {
              behavior: 'allow',
              updatedInput: payload.request.input,
            }
          : {
              behavior: 'deny',
              message: `当前会话未启用 ${toolName} 权限。`,
              interrupt: false,
            },
      })
    }

    const handleAbort = () => {
      sendClaudeMessage(child.stdin, {
        type: 'control_request',
        request_id: randomUUID(),
        request: {
          subtype: 'interrupt',
        },
      })
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM')
        }
      }, 250)
    }

    params.signal?.addEventListener('abort', handleAbort, { once: true })

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }

      const controlRequest = readJsonLine<ClaudeControlRequest>(trimmed)
      if (controlRequest?.type === 'control_request' || controlRequest?.type === 'control_cancel_request') {
        handleControlRequest(controlRequest)
        return
      }

      const payload = readJsonLine<ClaudeStreamEvent>(trimmed)
      if (!payload) {
        return
      }

      if (payload.session_id) {
        sessionId = payload.session_id
      }

      if (payload.type === 'system' && payload.subtype === 'init') {
        emitAgentEvent('ClaudeCode', params.onEvent, {
          type: 'session.status',
          properties: {
            status: {
              type: 'busy',
              message: 'Claude Code 会话已就绪',
            },
          },
        })
        return
      }

      if (payload.type === 'stream_event') {
        const event = payload.event
        const partKey = `${sessionId || 'claude'}:${event.index ?? 0}`

        if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          const nextText = `${reasoningState.get(partKey) ?? ''}${event.delta.thinking ?? ''}`
          reasoningState.set(partKey, nextText)
          emitTextPart('reasoning', `${partKey}:thinking`, nextText, event.delta.thinking ?? '')
          return
        }

        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const nextText = `${textState.get(partKey) ?? ''}${event.delta.text ?? ''}`
          textState.set(partKey, nextText)
          finalOutput = nextText.trim() || finalOutput
          emitTextPart('text', `${partKey}:text`, nextText, event.delta.text ?? '')
          return
        }

        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          emitAgentEvent('ClaudeCode', params.onEvent, {
            type: 'message.part.updated',
            properties: {
              part: {
                id: event.content_block.id ?? `${partKey}:tool`,
                messageID: ensureAssistantMessage(),
                type: 'tool',
                tool: event.content_block.name ?? 'tool',
                state: {
                  status: 'running',
                },
              },
            },
          })
        }
        return
      }

      if (payload.type === 'assistant') {
        sessionId = payload.session_id ?? sessionId
        assistantMessageId = payload.message?.id ?? ensureAssistantMessage()
        const assistantContents = Array.isArray(payload.message?.content) ? payload.message.content : []
        for (const content of assistantContents) {
          if (content.type === 'text' && content.text?.trim()) {
            finalOutput = content.text.trim()
            emitTextPart('text', `${assistantMessageId}:final`, finalOutput)
          }

          if (content.type === 'tool_use') {
            emitAgentEvent('ClaudeCode', params.onEvent, {
              type: 'message.part.updated',
              properties: {
                part: {
                  id: content.id ?? `${assistantMessageId}:tool`,
                  messageID: ensureAssistantMessage(),
                  type: 'tool',
                  tool: content.name ?? 'tool',
                  state: {
                    status: 'running',
                    raw: content.input ? JSON.stringify(content.input, null, 2) : undefined,
                  },
                },
              },
            })
          }
        }
        return
      }

      if (payload.type === 'user') {
        const userContents = Array.isArray(payload.message?.content) ? payload.message.content : []
        const toolUseId = userContents.find((item) => item.tool_use_id)?.tool_use_id
        if (!toolUseId) {
          return
        }

        emitAgentEvent('ClaudeCode', params.onEvent, {
          type: 'message.part.updated',
          properties: {
            part: {
              id: toolUseId,
              messageID: ensureAssistantMessage(),
              type: 'tool',
              tool: 'tool',
              state: {
                status: 'completed',
                output: userContents.find((item) => item.tool_use_id === toolUseId)?.content,
              },
            },
          },
        })
        return
      }

      if (payload.type === 'result') {
        completed = !payload.is_error
        if (payload.result?.trim()) {
          finalOutput = payload.result.trim()
        }
        claudeUsage = extractClaudeResultUsage(payload) || claudeUsage

        if (payload.is_error) {
          lastError = payload.result?.trim() || 'Claude Code 执行失败'
          emitAgentEvent('ClaudeCode', params.onEvent, {
            type: 'session.error',
            properties: { error: lastError },
          })
          return
        }

        emitAgentEvent('ClaudeCode', params.onEvent, {
          type: 'session.status',
          properties: {
            status: {
              type: 'idle',
              message: 'Claude Code 已完成',
            },
          },
        })

        if (!child.killed) {
          child.kill('SIGTERM')
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        handleLine(line)
      }
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString()
    })

    child.on('error', (error) => {
      params.signal?.removeEventListener('abort', handleAbort)
      reject(error)
    })

    child.on('close', (code) => {
      params.signal?.removeEventListener('abort', handleAbort)

      if (stdoutBuffer.trim()) {
        handleLine(stdoutBuffer)
      }

      if (params.signal?.aborted) {
        reject(toAbortError(params.signal))
        return
      }

      if ((!completed && code !== 0) || lastError) {
        reject(new Error(lastError || stderrBuffer.trim().split('\n').filter(Boolean).at(-1) || `Claude Code 执行失败（退出码 ${code ?? -1}）`))
        return
      }

      resolve({
        ok: true,
        output: finalOutput || stderrBuffer.trim().split('\n').filter(Boolean).at(-1) || 'Claude Code 未返回文本输出。',
        sessionId: sessionId || undefined,
        usage: claudeUsage,
      })
    })

    sendClaudeMessage(child.stdin, {
      type: 'control_request',
      request_id: randomUUID(),
      request: {
        subtype: 'initialize',
      },
    })

    sendClaudeMessage(child.stdin, {
        type: 'control_request',
        request_id: randomUUID(),
        request: {
          subtype: 'set_permission_mode',
          mode: effectivePermissionMode,
        },
      })

    sendClaudeMessage(child.stdin, {
      type: 'user',
      message: {
        role: 'user',
        content: params.prompt,
      },
    })
  })
}

export const runClaudeCodePrompt = async (params: WorkerAgentPromptParams): Promise<WorkerAgentPromptResult> => {
  try {
    return await runClaudeCodePromptCore(params)
  } catch (error) {
    if (params.resumeSessionId && isClaudeSessionNotFound(error)) {
      return runClaudeCodePromptCore({ ...params, resumeSessionId: undefined })
    }
    throw error
  }
}

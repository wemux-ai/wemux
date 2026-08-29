import { existsSync } from 'node:fs'
import { delimiter } from 'node:path'
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import type { ExecutionLog, ExecutionModelOption, Project, Task } from '@shared/types'
import { resolveTaskWorktreePath } from '@shared/workspace-paths'
import { loadState } from '../../storage/app-state-store'

const parseCommand = (command: string) => {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''))
}

const resolveCommand = (command: string) => {
  const [name, ...args] = parseCommand(command.trim())
  if (!name) {
    return null
  }

  if (name.includes('/') || name.includes('\\')) {
    return existsSync(name) ? { command: name, args } : null
  }

  const paths = (process.env.PATH ?? '').split(delimiter)
  for (const entry of paths) {
    const candidate = `${entry}/${name}`
    if (existsSync(candidate)) {
      return { command: candidate, args }
    }
  }

  return null
}

export const findExecutable = (command: string) => {
  return resolveCommand(command) !== null
}

type OpenCodeServerHandle = {
  url: string
  close: () => void
}

let sharedServerPromise: Promise<OpenCodeServerHandle> | null = null
let sharedServerConfigContent = ''
let sharedServerHandle: OpenCodeServerHandle | null = null

export const logOpenCodeDebug = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[opencode-debug] ${stage}`, JSON.stringify(payload))
}

export const logPrompt = (label: string, prompt: string) => {
  console.log(`${label}\n${prompt}`)
}

export const getErrorText = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

   if (error && typeof error === 'object') {
    const maybeError = error as {
      message?: unknown
      data?: { message?: unknown }
      error?: { message?: unknown; data?: { message?: unknown } }
    }

    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
      return maybeError.message
    }

    if (typeof maybeError.data?.message === 'string' && maybeError.data.message.trim()) {
      return maybeError.data.message
    }

    if (typeof maybeError.error?.message === 'string' && maybeError.error.message.trim()) {
      return maybeError.error.message
    }

    if (typeof maybeError.error?.data?.message === 'string' && maybeError.error.data.message.trim()) {
      return maybeError.error.data.message
    }
  }

  return '未知错误'
}

export const parseExecutionModel = (model?: string) => {
  if (!model) {
    return undefined
  }

  const [providerID, ...rest] = model.split('/')
  const modelID = rest.join('/')

  if (!providerID || !modelID) {
    return undefined
  }

  return { providerID, modelID }
}

const buildExecutionModelOption = (
  providerId: string,
  modelId: string,
  defaultModel?: string,
): ExecutionModelOption => ({
  id: `${providerId}/${modelId}`,
  label: `${providerId}/${modelId}`,
  providerId,
  modelId,
  isDefault: defaultModel === `${providerId}/${modelId}`,
})

const getProviderModelIds = (models: unknown) => {
  if (Array.isArray(models)) {
    return models
      .map((model) => {
        if (!model || typeof model !== 'object') {
          return undefined
        }

        return 'id' in model && typeof model.id === 'string' ? model.id : undefined
      })
      .filter((modelId): modelId is string => Boolean(modelId))
  }

  if (!models || typeof models !== 'object') {
    return []
  }

  return Object.entries(models)
    .map(([modelId, model]) => {
      if (!model || typeof model !== 'object') {
        return modelId
      }

      return 'id' in model && typeof model.id === 'string' ? model.id : modelId
    })
    .filter((modelId): modelId is string => Boolean(modelId))
}

export const normalizeModelResponse = (raw: unknown, defaultModel?: string): ExecutionModelOption[] => {
  if (!raw || typeof raw !== 'object') {
    return []
  }

  const data = raw as {
    providers?: Array<{ id?: string; name?: string; models?: unknown }> | Record<string, { id?: string; name?: string; models?: unknown }>
    provider?: Record<string, { id?: string; name?: string; models?: unknown }>
    default?: Record<string, string>
  }

  const excludedProviders = ['cloudflare', 'cf Workers', 'cf']
  const providers = Array.isArray(data.providers)
    ? data.providers
    : [
      ...Object.entries(data.providers ?? {}).map(([providerKey, provider]) => ({
        id: provider.id || provider.name || providerKey,
        models: provider.models,
      })),
      ...Object.entries(data.provider ?? {}).map(([providerKey, provider]) => ({
        id: provider.id || provider.name || providerKey,
        models: provider.models,
      })),
    ]

  return providers
    .filter((provider) => {
      const providerId = provider.id?.toLowerCase() ?? ''
      return !excludedProviders.some((excluded) => providerId.includes(excluded.toLowerCase()))
    })
    .flatMap((provider) => {
      const providerId = provider.id
      if (!providerId) {
        return []
      }

      return getProviderModelIds(provider.models)
        .map((modelId) => buildExecutionModelOption(providerId, modelId, defaultModel))
    })
    .sort((left, right) => {
      if (left.isDefault) return -1
      if (right.isDefault) return 1
      return left.label.localeCompare(right.label)
    })
}

const startOpencodeServer = async (configContent?: string) => {
  try {
    const response = await fetch('http://127.0.0.1:4096/path')
    if (response.ok) {
      logOpenCodeDebug('server:reuse-existing', { reason: 'healthy-existing-server' })
      return {
        url: 'http://127.0.0.1:4096',
        close: () => {},
      }
    }
  } catch {
    // ignore and continue to local startup
  }

  try {
    const runtime = await createOpencode({
      port: 4096,
      timeout: 15000,
      config: parseOpencodeConfigContent(configContent),
    })
    return runtime.server
  } catch (error) {
    logOpenCodeDebug('server:reuse-existing', { error: getErrorText(error) })

    const existing = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' })
    const pathInfo = await existing.path.get()
    if (!pathInfo.data) {
      throw new Error('OpenCode 服务不可用')
    }

    return {
      url: 'http://127.0.0.1:4096',
      close: () => {},
    }
  }
}

const getSharedOpencodeServer = async (configContent?: string) => {
  const normalizedConfigContent = configContent?.trim() ?? ''
  if (sharedServerPromise && sharedServerConfigContent !== normalizedConfigContent) {
    sharedServerHandle?.close()
    sharedServerHandle = null
    sharedServerPromise = null
  }

  if (!sharedServerPromise) {
    sharedServerConfigContent = normalizedConfigContent
    sharedServerPromise = startOpencodeServer(normalizedConfigContent).then((server) => {
      sharedServerHandle = server
      return server
    }).catch((error) => {
      sharedServerPromise = null
      sharedServerConfigContent = ''
      sharedServerHandle = null
      throw error
    })
  }

  return sharedServerPromise
}

export const getRootOpencodeClient = async (configContent?: string) => {
  const server = await getSharedOpencodeServer(configContent)
  return createOpencodeClient({ baseUrl: server.url })
}

export const getOpencodeClient = async (cwd: string) => {
  const server = await getSharedOpencodeServer()
  return createOpencodeClient({ baseUrl: server.url, directory: cwd })
}

export const getTaskWorkingDirectory = (task: Task, project: Project) => {
  const state = loadState()
  const worktreePath = resolveTaskWorktreePath(state.config.workspaceRoot, project, task)
  if (existsSync(worktreePath)) {
    return worktreePath
  }

  return project.gitUrl || '未准备工作目录'
}

export const getRecentConversation = (logs?: ExecutionLog[]) => {
  return (logs ?? [])
    .filter((log) => log.role !== 'system')
    .slice(-8)
    .map((log) => `${log.role === 'user' ? '用户' : log.role === 'agent' ? 'Agent' : '审核'}: ${log.content}`)
    .join('\n')
}

export const truncateText = (value: string, limit: number) => {
  if (value.length <= limit) {
    return value
  }

  return `${value.slice(0, limit)}...`
}

export const extractJsonBlock = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return value.slice(start, end + 1)
  }

  return value.trim()
}

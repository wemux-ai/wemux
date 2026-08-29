// [INPUT]: Worker prompt/task requests with runtime settings, execution surface, MCP, skills, and attachments.
// [OUTPUT]: Validated runtime dispatch with surface-scoped Agent capabilities and streamed results.
// [POS]: Shared Worker Agent execution entrypoint for control-plane and Workspace turns.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { stat } from 'node:fs/promises'
import { getRuntimeDescriptor, resolveRuntimeIdForAgentType, type RuntimeId } from '@shared/agent-type'
import { runWorkerOpenCodePrompt, runWorkerOpenCodeTask, type OpenCodePromptEvent } from './opencode'
import { runClaudeCodePrompt } from './claude-runner'
import { runCodexPrompt } from './codex-runner'
import { runPiPrompt } from './pi-runner'
import { ensureWorkerRuntimeReady } from '../core/runtime-bootstrap'
import { emitAgentEvent, type WorkerAgentPromptParams, type WorkerAgentTaskParams } from './agent-runner-shared'
import { injectPromptAttachments, materializePromptAttachments } from './prompt-attachments'
import { prepareWorkerAgentRuntime, prependRuntimePrompt } from './runtime-context'
import { normalizeFilesystemPath } from '../runtime/local-git-repository'

const buildTaskPrompt = (params: Pick<WorkerAgentTaskParams, 'title' | 'description'>) => {
  return [
    `任务标题: ${params.title}`,
    `任务描述: ${params.description}`,
    '',
    '请直接在当前工作目录完成任务所需修改。',
    '如需读写文件、运行命令或验证结果，请直接执行。',
    '完成后请返回简洁总结：做了什么、是否还有阻塞。',
  ].join('\n')
}

const emitWorkerPromptStatus = (params: WorkerAgentPromptParams, message: string) => {
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'session.status',
    properties: {
      status: {
        type: 'busy',
        message,
      },
    },
  })
}

const emitWorkerPromptError = (params: WorkerAgentPromptParams, message: string) => {
  emitAgentEvent(params.agentType, params.onEvent, {
    type: 'session.error',
    properties: {
      error: message,
      message,
    },
  })
}

const normalizePromptWorkingDirectoryError = (cwd: string, error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    return `当前工作目录不存在：${cwd}`
  }

  return error instanceof Error
    ? `无法访问当前工作目录 ${cwd}：${error.message}`
    : `无法访问当前工作目录：${cwd}`
}

export const validateWorkerPromptWorkingDirectory = async (cwd: string) => {
  const directoryStats = await stat(normalizeFilesystemPath(cwd))
  if (!directoryStats.isDirectory()) {
    throw new Error(`当前工作目录不是目录：${cwd}`)
  }
}

type RuntimePromptRunnerParams = {
  params: WorkerAgentPromptParams
  prompt: string
  runtimeEnv: Record<string, string>
  runtimeArgs: string[]
}

type RuntimePromptRunner = (
  runnerParams: RuntimePromptRunnerParams,
) => Promise<Awaited<ReturnType<typeof runWorkerOpenCodePrompt>> | Awaited<ReturnType<typeof runCodexPrompt>> | Awaited<ReturnType<typeof runClaudeCodePrompt>>>

const PROMPT_RUNNERS: Partial<Record<RuntimeId, RuntimePromptRunner>> = {
  OpenCode: async ({ params, prompt, runtimeEnv, runtimeArgs }) => {
    return runWorkerOpenCodePrompt({
      actingUserId: params.actingUserId,
      runtimeAgentId: params.runtimeAgentId,
      workspaceId: params.workspaceId,
      resumeSessionId: params.resumeSessionId,
      cwd: params.cwd,
      title: params.title,
      prompt,
      executionModel: params.executionModel,
      agentSettings: params.agentSettings,
      opencodeConfig: params.opencodeConfig,
      mcpServers: params.mcpServers,
      runtimeEnv,
      runtimeArgs,
      signal: params.signal,
      onEvent: (event: OpenCodePromptEvent) => {
        emitAgentEvent('OpenCode', params.onEvent, event)
      },
    })
  },
  Codex: async ({ params, prompt, runtimeEnv, runtimeArgs }) => {
    return runCodexPrompt({
      ...params,
      prompt,
      runtimeEnv,
      runtimeArgs,
    })
  },
  ClaudeCode: async ({ params, prompt, runtimeEnv, runtimeArgs }) => {
    return runClaudeCodePrompt({
      ...params,
      prompt,
      runtimeEnv,
      runtimeArgs,
    })
  },
  Pi: async ({ params, prompt, runtimeEnv }) => {
    return runPiPrompt({
      ...params,
      prompt,
      runtimeEnv,
    })
  },
}

export const runWorkerAgentPrompt = async (params: WorkerAgentPromptParams) => {
  const resolvedCwd = normalizeFilesystemPath(params.cwd)
  emitWorkerPromptStatus(params, '正在检查工作目录...')
  try {
    await validateWorkerPromptWorkingDirectory(resolvedCwd)
  } catch (error) {
    const message = normalizePromptWorkingDirectoryError(resolvedCwd, error)
    emitWorkerPromptError(params, message)
    throw new Error(message)
  }

  if (!params.skipRuntimeCheck) {
    emitWorkerPromptStatus(params, '正在执行中')
    const runtime = await ensureWorkerRuntimeReady({
      autoInstall: true,
      target: params.agentType,
    })
    if (!runtime.ok) {
      emitWorkerPromptError(params, runtime.message)
      throw new Error(runtime.message)
    }
  }

  if ((params.attachments?.length ?? 0) > 0 || (params.preparedAttachments?.length ?? 0) > 0) {
    emitWorkerPromptStatus(params, '正在准备附件...')
  }
  const prepared = await materializePromptAttachments({
    attachments: params.attachments,
    cloudUrl: params.cloudUrl,
    signal: params.signal,
  })
  emitWorkerPromptStatus(params, '正在准备 Agent 运行上下文...')
  const runtime = params.runtimePrepared
    ? {
        promptPrefix: '',
        runtimeEnv: params.runtimeEnv ?? {},
        runtimeArgs: params.runtimeArgs ?? [],
        cleanup: () => undefined,
      }
    : prepareWorkerAgentRuntime({
        agentType: params.agentType,
        cwd: resolvedCwd,
        actingUserId: params.actingUserId,
        runtimeAgentId: params.runtimeAgentId,
        workspaceId: params.workspaceId,
        runtimeSkillPackages: params.runtimeSkillPackages,
        mcpServers: params.mcpServers,
        runtimeEnv: params.runtimeEnv,
      })
  const mergedRuntimeEnv = {
    ...runtime.runtimeEnv,
    ...(params.runtimeEnv ?? {}),
  }
  const prompt = injectPromptAttachments(
    prependRuntimePrompt(params.prompt, runtime.promptPrefix),
    prepared.attachments,
  )

  try {
    const runtimeId = resolveRuntimeIdForAgentType(params.agentType)
    emitWorkerPromptStatus(params, `正在启动 ${getRuntimeDescriptor(runtimeId).label}...`)
    const runner = PROMPT_RUNNERS[runtimeId]
    if (!runner) {
      throw new Error(`暂未配置 ${runtimeId} prompt runner。`)
    }

    return await runner({
      params: {
        ...params,
        cwd: resolvedCwd,
        preparedAttachments: prepared.attachments,
      },
      prompt,
      runtimeEnv: mergedRuntimeEnv,
      runtimeArgs: runtime.runtimeArgs,
    })
  } finally {
    await prepared.cleanup()
    runtime.cleanup()
  }
}

export const runWorkerAgentTask = async (params: WorkerAgentTaskParams) => {
  const resolvedCwd = normalizeFilesystemPath(params.cwd)
  if (!params.skipRuntimeCheck && params.agentType === 'OpenCode') {
    const runtime = await ensureWorkerRuntimeReady({
      autoInstall: true,
      target: params.agentType,
    })
    if (!runtime.ok) {
      throw new Error(runtime.message)
    }
  }

  const runtime = prepareWorkerAgentRuntime({
    agentType: params.agentType,
    cwd: resolvedCwd,
    actingUserId: params.actingUserId,
    runtimeAgentId: params.runtimeAgentId,
    workspaceId: params.workspaceId,
    runtimeSkillPackages: params.runtimeSkillPackages,
    mcpServers: params.mcpServers,
    runtimeEnv: params.runtimeEnv,
  })
  const mergedRuntimeEnv = {
    ...runtime.runtimeEnv,
    ...(params.runtimeEnv ?? {}),
  }
  if (params.agentType === 'OpenCode') {
    try {
      return await runWorkerOpenCodeTask({
        actingUserId: params.actingUserId,
        runtimeAgentId: params.runtimeAgentId,
        cwd: resolvedCwd,
        title: params.title,
        description: prependRuntimePrompt(params.description, runtime.promptPrefix),
        executionModel: params.executionModel,
        agentSettings: params.agentSettings,
        opencodeConfig: params.opencodeConfig,
        mcpServers: params.mcpServers,
        runtimeEnv: mergedRuntimeEnv,
        runtimeArgs: runtime.runtimeArgs,
        signal: params.signal,
      })
    } finally {
      runtime.cleanup()
    }
  }

  try {
    return await runWorkerAgentPrompt({
      agentType: params.agentType,
      actingUserId: params.actingUserId,
      runtimeAgentId: params.runtimeAgentId,
      cwd: resolvedCwd,
      title: params.title,
      prompt: prependRuntimePrompt(buildTaskPrompt(params), runtime.promptPrefix),
      executionModel: params.executionModel,
      agentSettings: params.agentSettings,
      mcpServers: params.mcpServers,
      runtimeSkillPackages: params.runtimeSkillPackages,
      runtimeEnv: mergedRuntimeEnv,
      runtimeArgs: runtime.runtimeArgs,
      runtimePrepared: true,
      signal: params.signal,
    })
  } finally {
    runtime.cleanup()
  }
}

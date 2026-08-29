// [INPUT]: A control-plane assigned task, local workspace, and worker runtime dependencies.
// [OUTPUT]: A completed task result with metadata-only Git delivery references.
// [POS]: Worker task execution boundary; code and test files remain on the worker or Git remote.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attachTaskResultDelivery } from '@shared/distributed-task-result'
import { getTaskGitBranchName } from '@shared/task-git-branch'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { DistributedTask, TaskExecutionResult, WorkerProjectBinding } from '@shared/types'
import { ensureWorkerRuntimeReady } from '../../core/runtime-bootstrap'
import { getTaskWorktreePath } from '../../core/workspace'
import { runWorkerAgentTask } from '../agent-runner'
import { applyTaskGitIdentity, createTaskGitAuthContext, resolveTaskGitCommitIdentityEnv } from '../git-identity'
import { materializeRuntimeEnvironment } from '../runtime-environment'
import { awaitBackgroundPresetStep, buildAgentTaskPrompt, executePresetStep, startPresetStepInBackground } from './preset-commands'
import { buildIdentity, commitAndMaybePush, ensureFreshWorktree, ensureOriginalDirectoryBranch, ensureRepoReady, resolveWorkingDirectoryMode } from './git-workspace'
import type { PresetCommandStep } from './types'

const TASK_RUNTIME_MARKER = 'vibemux-task-runtime-'
const resolveFileMaterializationRuntimeEnvironment = (runtimeEnvironment?: RuntimeEnvironmentExecutionPayload) => (
  runtimeEnvironment?.mode === 'env-file' ? runtimeEnvironment : undefined
)

const shouldIsolateAgentCwd = (agentType: DistributedTask['agentType']) => {
  return agentType === 'Codex' || agentType === 'ClaudeCode'
}

const mergeRuntimeEnv = (...sources: Array<Record<string, string | undefined> | undefined>) => {
  const runtimeEnv: Record<string, string> = {}
  for (const source of sources) {
    if (!source) {
      continue
    }
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        runtimeEnv[key] = value
      }
    }
  }
  return runtimeEnv
}

const createTaskAgentCwd = (task: DistributedTask, executionPath: string) => {
  if (!shouldIsolateAgentCwd(task.agentType)) {
    return {
      cwd: executionPath,
      cleanup: () => undefined,
    }
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `${TASK_RUNTIME_MARKER}${task.id.slice(0, 8)}-`))
  const isolatedCwd = path.join(tempRoot, 'workspace')
  try {
    symlinkSync(executionPath, isolatedCwd, process.platform === 'win32' ? 'junction' : 'dir')
    return {
      cwd: isolatedCwd,
      cleanup: () => {
        rmSync(tempRoot, { recursive: true, force: true })
      },
    }
  } catch {
    rmSync(tempRoot, { recursive: true, force: true })
    return {
      cwd: executionPath,
      cleanup: () => undefined,
    }
  }
}

const runTaskInPreparedDirectory = async (params: {
  task: DistributedTask
  executionPath: string
  agentCwd: string
  commandEnv?: NodeJS.ProcessEnv
  runtimeEnv: Record<string, string>
  signal?: AbortSignal
  emit: (status: DistributedTask['status'], message: string) => void
}) => {
  const backgroundInstallStep = startPresetStepInBackground({
    step: 'install',
    task: params.task,
    cwd: params.executionPath,
    signal: params.signal,
    env: params.commandEnv,
    emit: params.emit,
  })
  const executedPresetSteps = backgroundInstallStep
    ? [await awaitBackgroundPresetStep(backgroundInstallStep, params.emit)]
    : []

  params.emit('executing', `开始调用 ${params.task.agentType} 执行任务`)
  const agentResult = await runWorkerAgentTask({
    agentType: params.task.agentType,
    actingUserId: params.task.requestedByUserId,
    cwd: params.agentCwd,
    title: `Distributed Task ${params.task.id}`,
    description: buildAgentTaskPrompt(params.task),
    executionModel: params.task.executionModel ?? params.task.opencodeConfig?.model,
    agentSettings: params.task.agentSettings,
    opencodeConfig: params.task.opencodeConfig,
    mcpServers: params.task.mcpServers,
    skipRuntimeCheck: true,
    runtimeSkillPackages: params.task.runtimeSkillPackages,
    runtimeEnv: params.runtimeEnv,
    signal: params.signal,
  })

  for (const step of ['build', 'test', 'lint'] satisfies PresetCommandStep[]) {
    const executedStep = await executePresetStep({
      step,
      task: params.task,
      cwd: params.executionPath,
      signal: params.signal,
      env: params.commandEnv,
      emit: params.emit,
    })
    if (executedStep) executedPresetSteps.push(executedStep)
  }

  return { agentResult, executedPresetSteps }
}

export const executeAssignedTask = async (params: {
  task: DistributedTask
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  /** 任务级实验功能开关（task.assign 下发）；Phase 1/2 agent 工具注入点在此读取 */
  featureFlags?: import('@shared/user-experimental-settings').ExecutorFeatureFlags
  executorId: string
  workspaceRoot: string
  projectBindings?: WorkerProjectBinding[]
  signal?: AbortSignal
  emit: (status: DistributedTask['status'], message: string) => void
}) => {
  const startedAt = new Date().toISOString()
  const branchName = params.task.workspaceBranchName?.trim() || getTaskGitBranchName(params.task.id)
  const worktreePath = getTaskWorktreePath(
    params.workspaceRoot,
    params.task.id,
    params.task.workspaceId,
    params.task.requestedByUserId,
    params.task.workspaceSessionId ? params.task.rootPath : undefined,
  )
  const workingDirectoryMode = resolveWorkingDirectoryMode(params.task)
  let identityCleanup: ReturnType<typeof applyTaskGitIdentity> | null = null
  let gitAuthContext: ReturnType<typeof createTaskGitAuthContext> | null = null
  let agentCwdCleanup: (() => void) | null = null

  try {
    params.emit('preparing', '检查 Worker 运行环境')
    const runtime = await ensureWorkerRuntimeReady({
      autoInstall: true,
      target: params.task.agentType,
    })
    if (!runtime.ok) {
      throw new Error(runtime.message)
    }

    params.emit('preparing', '运行环境已就绪')
    if (params.task.versionControl === 'none') {
      const executionPath = params.task.rootPath?.trim() || worktreePath
      mkdirSync(executionPath, { recursive: true })
      materializeRuntimeEnvironment(executionPath, resolveFileMaterializationRuntimeEnvironment(params.runtimeEnvironment))
      params.emit('preparing', `项目目录已就绪：${executionPath}`)
      const agentCwd = createTaskAgentCwd(params.task, executionPath)
      agentCwdCleanup = agentCwd.cleanup

      const { agentResult, executedPresetSteps } = await runTaskInPreparedDirectory({
        task: params.task,
        executionPath,
        agentCwd: agentCwd.cwd,
        runtimeEnv: mergeRuntimeEnv(params.task.runtimeEnv),
        signal: params.signal,
        emit: params.emit,
      })

      const completedAt = new Date().toISOString()
      const result: TaskExecutionResult = attachTaskResultDelivery({
        taskId: params.task.id,
        status: 'completed',
        returnMode: params.task.returnMode,
        summary: [
          executedPresetSteps.length > 0 ? `已执行项目预设命令：\n${executedPresetSteps.map((step) => `- ${step}`).join('\n')}` : undefined,
          agentResult.output,
        ].filter(Boolean).join('\n\n'),
        output: agentResult.output,
        filesChanged: [],
        startedAt,
        completedAt,
        durationSec: Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000)),
        executorNodeId: params.executorId,
        agentSessionId: agentResult.sessionId,
        opencodeSessionId: agentResult.sessionId,
        usage: agentResult.usage,
      }, {
        repoUrl: params.task.repoUrl,
        baseBranch: params.task.defaultBranch,
        taskDescription: params.task.description,
      })

      return {
        task: {
          ...params.task,
          status: 'completed' as const,
          startedAt,
          completedAt,
          updatedAt: completedAt,
          result,
        },
      }
    }

    const identity = buildIdentity(params.task)
    gitAuthContext = createTaskGitAuthContext({
      taskId: params.task.id,
      identity,
      repoUrl: params.task.repoUrl,
    })

    params.emit('preparing', '准备本地仓库')
    const { repoDir, git, taskBranchExists } = await ensureRepoReady({
      workspaceRoot: params.workspaceRoot,
      task: params.task,
      branchName,
      bindings: params.projectBindings,
      env: gitAuthContext.env,
    })
    params.emit('preparing', `仓库已就绪：${repoDir}`)
    const executionPath = workingDirectoryMode === 'original-dir'
      ? (params.task.rootPath?.trim() || repoDir)
      : worktreePath

    if (workingDirectoryMode === 'worktree') {
      await ensureFreshWorktree(repoDir, worktreePath, branchName)
      const startPoint = taskBranchExists || await git.branch(['-r']).then((branches) => branches.all.includes(`origin/${branchName}`))
        ? `origin/${branchName}`
        : (params.task.baseCommit?.trim() || params.task.defaultBranch?.trim() || 'main')
      await git.raw(['worktree', 'add', '--force', '-B', branchName, worktreePath, startPoint])
      params.emit('executing', `已创建 worktree：${worktreePath}`)
    } else {
      const startPoint = await ensureOriginalDirectoryBranch({
        git,
        task: params.task,
        branchName,
        taskBranchExists,
      })
      params.emit('executing', `已在原始目录 ${executionPath} 切换到 ${startPoint} 并开始执行`)
    }

    materializeRuntimeEnvironment(executionPath, resolveFileMaterializationRuntimeEnvironment(params.runtimeEnvironment))
    identityCleanup = applyTaskGitIdentity({
      taskId: params.task.id,
      worktreePath: executionPath,
      identity,
      repoUrl: params.task.repoUrl,
    })
    const gitCommandEnv = identityCleanup.env
    const gitCommitIdentityEnv = resolveTaskGitCommitIdentityEnv(identity)
    const agentCwd = createTaskAgentCwd(params.task, executionPath)
    agentCwdCleanup = agentCwd.cleanup

    const { agentResult, executedPresetSteps } = await runTaskInPreparedDirectory({
      task: params.task,
      executionPath,
      agentCwd: agentCwd.cwd,
      commandEnv: gitCommandEnv,
      runtimeEnv: mergeRuntimeEnv(params.task.runtimeEnv, gitCommitIdentityEnv),
      signal: params.signal,
      emit: params.emit,
    })

    const pushOutcome = await commitAndMaybePush({
      task: params.task,
      worktreePath: executionPath,
      branchName,
      identity,
      env: gitCommandEnv,
    })
    const completedAt = new Date().toISOString()
    const result: TaskExecutionResult = attachTaskResultDelivery({
      taskId: params.task.id,
      status: 'completed',
      returnMode: params.task.returnMode,
      summary: [
        executedPresetSteps.length > 0 ? `已执行项目预设命令：\n${executedPresetSteps.map((step) => `- ${step}`).join('\n')}` : undefined,
        agentResult.output,
        pushOutcome.pushMessage,
      ].filter(Boolean).join('\n\n'),
      output: agentResult.output,
      filesChanged: pushOutcome.changedFiles,
      remoteBranchName: pushOutcome.remoteBranchName,
      commitShas: pushOutcome.commitShas,
      startedAt,
      completedAt,
      durationSec: Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000)),
      executorNodeId: params.executorId,
      agentSessionId: agentResult.sessionId,
      opencodeSessionId: agentResult.sessionId,
      usage: agentResult.usage,
    }, {
      repoUrl: params.task.repoUrl,
      baseBranch: params.task.defaultBranch,
      taskDescription: params.task.description,
    })

    return {
      task: {
        ...params.task,
        status: 'completed' as const,
        startedAt,
        completedAt,
        updatedAt: completedAt,
        result,
      },
    }
  } catch (error) {
    const completedAt = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'worker task execution failed'
    return {
      task: {
        ...params.task,
        status: 'failed' as const,
        startedAt,
        completedAt,
        updatedAt: completedAt,
        errorMessage: message,
        result: attachTaskResultDelivery({
          taskId: params.task.id,
          status: 'failed' as const,
          returnMode: params.task.returnMode,
          summary: message,
          output: message,
          filesChanged: [],
          startedAt,
          completedAt,
          durationSec: Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000)),
          executorNodeId: params.executorId,
        }, {
          repoUrl: params.task.repoUrl,
          baseBranch: params.task.defaultBranch,
          taskDescription: params.task.description,
        }),
      },
    }
  } finally {
    agentCwdCleanup?.()
    identityCleanup?.cleanup()
    gitAuthContext?.cleanup()
  }
}

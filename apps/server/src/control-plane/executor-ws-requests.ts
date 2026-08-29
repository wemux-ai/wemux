// [INPUT]: Executor ids, typed control-plane request payloads, live sockets, and pending request registries.
// [OUTPUT]: Typed request promises for local and clustered workers, including specialized streaming/deduped flows.
// [POS]: Server-side WebSocket request boundary between orchestration services and worker executors.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  ControlPlaneToExecutorMessage,
  ExecutorAgentPromptAbortReason,
  ExecutorAgentSessionReadResult,
  ExecutorAgentSessionsResult,
  ExecutorAgentPromptEvent,
  ExecutorAgentWorkdirDownloadResult,
  ExecutorAgentWorkdirReadResult,
  ExecutorAgentWorkdirResult,
  ExecutorAgentPromptResult,
  ExecutorDirectoryBrowseResult,
  ExecutorFileReadResult,
  ExecutorFileWriteResult,
  ExecutorGitBaselineDiffResult,
  ExecutorGitBaselineSnapshotResult,
  ExecutorGitCommitResult,
  ExecutorGitCheckoutResult,
  ExecutorGitCommitDiffResult,
  ExecutorGitChangeActionResult,
  ExecutorGitDiffResult,
  ExecutorGitFileDiffResult,
  ExecutorGitGraphResult,
  ExecutorGitPullRequestResult,
  ExecutorGitPushResult,
  ExecutorGitRebaseResult,
  ExecutorGitWorkingTreeDiffResult,
  ExecutorGitStatusResult,
  ExecutorHttpProbeResult,
  ExecutorWorktreeStartPointMode,
  ExecutorSkillScanResult,
  ExecutorTerminalRequestMode,
  ExecutorTerminalResult,
  ExecutorTerminalLocalAttachTicketResult,
  ExecutorTerminalSessionAttachResult,
  ExecutorTerminalSessionCloseResult,
  ExecutorTerminalSessionCreateResult,
  ExecutorTerminalSessionsResult,
  ExecutorWorkspaceOperationEvent,
  ExecutorWorktreeResult,
  GitProvider,
  LocalPathProbeResult,
  PatVerificationResult,
  RepoBranchSnapshotResult,
  SshVerificationResult,
  TaskRuntimeGitIdentity,
  WorkerDoctorPayload,
} from '@shared/types'
import { buildWorkspaceTerminalSessionKey } from '@shared/types'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import { executorRegistry } from './executor-registry'
import {
  forwardExecutorClusterRequest,
  resolveExecutorRequestTarget,
} from './executor-node-routing'
import { type ServerAgentType } from '../services/server-agent'
import {
  buildWorktreeEnsureDedupeKey,
  inflightWorktreeEnsures,
  isSocketOpen,
  logTerminalDebug,
  pendingAgentPrompts,
  pendingAgentSessionLists,
  pendingAgentSessionReads,
  pendingAgentWorkdirDownloads,
  pendingAgentWorkdirReads,
  pendingAgentWorkdirRequests,
  pendingDesktopSandboxRequests,
  pendingRemoteCodeRequests,
  pendingConfigExports,
  pendingCodexOauthRequests,
  pendingDoctorRequests,
  pendingDirectoryBrowses,
  pendingFileReads,
  pendingFileWrites,
  pendingGitCommits,
  pendingGitCheckouts,
  pendingGitCommitDiffs,
  pendingGitDiffs,
  pendingGitBaselineDiffs,
  pendingGitBaselineSnapshots,
  pendingGitGraphs,
  pendingGitPullRequests,
  pendingGitPushes,
  pendingGitRebases,
  pendingGitWorkingTreeDiffs,
  pendingGitStatuses,
  pendingGitFileDiffs,
  pendingGitChanges,
  pendingHttpProbes,
  pendingPatVerifications,
  pendingSshVerifications,
  pendingRepoBranches,
  pendingRepoProbes,
  pendingSkillScans,
  pendingTerminalLocalAttachTickets,
  pendingTerminalSessionAttaches,
  pendingTerminalSessionCloses,
  pendingTerminalSessionCreates,
  pendingTerminalSessionLists,
  pendingTelemetryRequests,
  pendingTerminalRequests,
  pendingWorktreeCleanups,
  pendingWorktreeEnsures,
  send,
} from './executor-ws-service-state'
import { clearPendingWorkspacePrompt, registerPendingWorkspacePrompt } from '../services/task-chat-dispatch/workspace-prompt-recovery'
import { clearPendingMainChatPrompt, registerPendingMainChatPrompt } from '../services/main-chat-prompt-recovery'
import { buildWorktreeEnsureFailureMessage } from './worktree-ensure-failure-message'

type PendingExecutorRequest<T> = {
  executorId: string
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const requestOnLocalExecutor = <T>(params: {
  executorId: string
  pending: Map<string, PendingExecutorRequest<T>>
  timeoutMs: number
  offlineMessage: string
  timeoutMessage: string
  buildMessage: (requestId: string) => ControlPlaneToExecutorMessage
}) => {
  const socket = executorRegistry.getSocket(params.executorId)
  if (!socket || !isSocketOpen(socket)) return Promise.reject(new Error(params.offlineMessage))

  const requestId = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      params.pending.delete(requestId)
      reject(new Error(params.timeoutMessage))
    }, params.timeoutMs)
    params.pending.set(requestId, { executorId: params.executorId, resolve, reject, timer })
    send(socket, params.buildMessage(requestId))
  })
}

const requestRepoProbeOnLocalNode = (executorId: string, localPath: string, timeoutMs = 15000) => {
  return requestOnLocalExecutor<LocalPathProbeResult>({
    executorId,
    pending: pendingRepoProbes,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法探测本地目录。',
    timeoutMessage: '执行器目录探测超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.repo-probe.request',
      requestId,
      localPath,
      at: new Date().toISOString(),
    }),
  })
}

const requestPatVerificationOnLocalNode = (
  executorId: string,
  provider: Extract<GitProvider, 'github' | 'gitlab'>,
  host: string,
  patToken: string,
  timeoutMs = 15000,
) => {
  return requestOnLocalExecutor<PatVerificationResult>({
    executorId,
    pending: pendingPatVerifications,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法校验 PAT。',
    timeoutMessage: '执行器 PAT 校验超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.git.pat.verify.request',
      requestId,
      provider,
      host,
      patToken,
      at: new Date().toISOString(),
    }),
  })
}

const requestSshVerificationOnLocalNode = (
  executorId: string,
  payload: {
    host: string
    sshPrivateKey: string
    repoUrl?: string
    sshUser?: string
  },
  timeoutMs = 25000,
) => {
  return requestOnLocalExecutor<SshVerificationResult>({
    executorId,
    pending: pendingSshVerifications,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法校验 SSH 身份。',
    timeoutMessage: '执行器 SSH 校验超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.git.ssh.verify.request',
      requestId,
      ...payload,
      at: new Date().toISOString(),
    }),
  })
}

const requestTelemetryOnLocalNode = (executorId: string, timeoutMs = 15000) => {
  return requestOnLocalExecutor<import('@shared/types').ExecutorTelemetrySnapshot>({
    executorId,
    pending: pendingTelemetryRequests,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法刷新资源状态。',
    timeoutMessage: '执行器资源刷新超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.telemetry.request',
      requestId,
      at: new Date().toISOString(),
    }),
  })
}

const requestDoctorOnLocalNode = (executorId: string, timeoutMs = 20000) => {
  return requestOnLocalExecutor<WorkerDoctorPayload>({
    executorId,
    pending: pendingDoctorRequests,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法执行自检。',
    timeoutMessage: '执行器自检超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.doctor.request',
      requestId,
      at: new Date().toISOString(),
    }),
  })
}

const requestTerminalSessionListOnLocalNode = (
  executorId: string,
  payload: {
    scope?: import('@shared/types').WorkspaceTerminalSessionScope
    workspaceId?: string
  },
  timeoutMs = 15000,
) => {
  return requestOnLocalExecutor<ExecutorTerminalSessionsResult>({
    executorId,
    pending: pendingTerminalSessionLists,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法读取终端会话。',
    timeoutMessage: '执行器读取终端会话超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.terminal.sessions.list.request',
      requestId,
      scope: payload.scope,
      workspaceId: payload.workspaceId,
      at: new Date().toISOString(),
    }),
  })
}

const requestTerminalSessionCreateOnLocalNode = (
  executorId: string,
  payload: {
    terminalId: string
    scope: import('@shared/types').WorkspaceTerminalSessionScope
    workspaceId?: string
    title?: string
    cwd?: string
    cols?: number
    rows?: number
    ownerUserId?: string
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  },
  timeoutMs = 15000,
) => {
  return requestOnLocalExecutor<ExecutorTerminalSessionCreateResult>({
    executorId,
    pending: pendingTerminalSessionCreates,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法创建终端会话。',
    timeoutMessage: '执行器创建终端会话超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.terminal.session.create',
      requestId,
      terminalId: payload.terminalId,
      scope: payload.scope,
      workspaceId: payload.workspaceId,
      title: payload.title,
      cwd: payload.cwd,
      cols: payload.cols,
      rows: payload.rows,
      ownerUserId: payload.ownerUserId,
      runtimeEnvironment: payload.runtimeEnvironment,
      at: new Date().toISOString(),
    }),
  })
}

const requestTerminalLocalAttachTicketOnLocalNode = (
  executorId: string,
  payload: {
    terminalId: string
    scope: import('@shared/types').WorkspaceTerminalSessionScope
    workspaceId?: string
    cwd?: string
  },
  timeoutMs = 15000,
) => {
  return requestOnLocalExecutor<ExecutorTerminalLocalAttachTicketResult>({
    executorId,
    pending: pendingTerminalLocalAttachTickets,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法创建本地终端直连票据。',
    timeoutMessage: '执行器创建本地终端直连票据超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.terminal.local-attach-ticket.request',
      requestId,
      terminalId: payload.terminalId,
      scope: payload.scope,
      workspaceId: payload.workspaceId,
      cwd: payload.cwd,
      at: new Date().toISOString(),
    }),
  })
}

const requestTerminalSessionCloseOnLocalNode = (
  executorId: string,
  payload: {
    terminalId: string
    scope: import('@shared/types').WorkspaceTerminalSessionScope
    workspaceId?: string
  },
  timeoutMs = 15000,
) => {
  return requestOnLocalExecutor<ExecutorTerminalSessionCloseResult>({
    executorId,
    pending: pendingTerminalSessionCloses,
    timeoutMs,
    offlineMessage: '执行器当前未在线，无法关闭终端会话。',
    timeoutMessage: '执行器关闭终端会话超时，请稍后重试。',
    buildMessage: (requestId) => ({
      type: 'executor.terminal.session.close',
      requestId,
      terminalId: payload.terminalId,
      scope: payload.scope,
      workspaceId: payload.workspaceId,
      at: new Date().toISOString(),
    }),
  })
}

const requestTerminalCommandOnLocalNode = (
  executorId: string,
  command: string,
  cwd?: string,
  options?: {
    timeoutMs?: number
    mode?: ExecutorTerminalRequestMode
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  },
) => {
  const socket = executorRegistry.getSocket(executorId)
  if (!socket || !isSocketOpen(socket)) {
    return Promise.reject(new Error('执行器当前未在线，无法打开远程终端。'))
  }

  const requestId = crypto.randomUUID()
  const timeoutMs = options?.timeoutMs ?? 60000
  const workerTimeoutMs = Math.max(1, timeoutMs > 1000 ? timeoutMs - 500 : timeoutMs)
  return new Promise<ExecutorTerminalResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTerminalRequests.delete(requestId)
      reject(new Error('远程终端执行超时，请稍后重试。'))
    }, timeoutMs)

    pendingTerminalRequests.set(requestId, {
      command,
      cwd,
      executorId,
      mode: options?.mode ?? 'wait',
      resolve,
      reject,
      startedAt: Date.now(),
      timer,
    })

    logTerminalDebug('sending one-shot terminal request', {
      executorId,
      requestId,
      cwd,
      command,
      mode: options?.mode ?? 'wait',
    })

    send(socket, {
      type: 'executor.terminal.request',
      requestId,
      command,
      cwd,
      mode: options?.mode ?? 'wait',
      timeoutMs: workerTimeoutMs,
      runtimeEnvironment: options?.runtimeEnvironment,
      at: new Date().toISOString(),
    })
  })
}

export const executorWsRequests = {
  requestConfigExport(
    executorId: string,
    options?: {
      timeoutMs?: number
      agentType?: ServerAgentType
      includeResolvedModelBindings?: boolean
    },
  ) {
    const timeoutMs = options?.timeoutMs ?? 10000
    return requestOnLocalExecutor<{
      opencodeConfigContent?: string
      codexConfigContent?: string
      codexAuthContent?: string
      claudeCodeConfigContent?: string
      defaultModel?: string
      agentSettings?: import('@shared/types').AgentSettings
      availableModels?: import('@shared/types').ExecutionModelOption[]
      resolvedModelBindings?: import('@shared/types').ResolvedModelImportBinding[]
      modelsMessage?: string
      at: string
    }>({
      executorId,
      pending: pendingConfigExports,
      timeoutMs,
      offlineMessage: '执行节点当前不在线。',
      timeoutMessage: '从执行节点获取运行时配置超时。',
      buildMessage: (requestId) => ({
        type: 'config.export.request',
        requestId,
        agentType: options?.agentType as import('@shared/types').AgentType | undefined,
        includeResolvedModelBindings: options?.includeResolvedModelBindings ?? false,
        at: new Date().toISOString(),
      }),
    })
  },

  requestCodexOauth(
    executorId: string,
    operation: import('@shared/types').CodexOauthOperation,
    payload: {
      userId: string
      accountId?: string
    },
    timeoutMs = operation === 'device.start' ? 20000 : 10000,
  ) {
    return requestOnLocalExecutor<import('@shared/types').ExecutorCodexOauthResponsePayload>({
      executorId,
      pending: pendingCodexOauthRequests,
      timeoutMs,
      offlineMessage: '执行节点当前不在线，无法访问 ChatGPT 账号。',
      timeoutMessage: '从执行节点读取 ChatGPT 账号超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.codex-oauth.request',
        requestId,
        userId: payload.userId,
        operation,
        accountId: payload.accountId?.trim() || undefined,
        at: new Date().toISOString(),
      }),
    })
  },

  async requestRepoProbe(executorId: string, localPath: string, timeoutMs = 15000) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestRepoProbeOnLocalNode(executorId, localPath, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<LocalPathProbeResult>({
        executorId,
        target,
        request: {
          operation: 'repo-probe',
          localPath,
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法探测本地目录。')
  },

  async requestPatVerification(
    executorId: string,
    provider: Extract<GitProvider, 'github' | 'gitlab'>,
    host: string,
    patToken: string,
    timeoutMs = 15000,
  ) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestPatVerificationOnLocalNode(executorId, provider, host, patToken, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<PatVerificationResult>({
        executorId,
        target,
        request: {
          operation: 'pat-verification',
          provider,
          host,
          patToken,
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法校验 PAT。')
  },

  async requestSshVerification(
    executorId: string,
    payload: {
      host: string
      sshPrivateKey: string
      repoUrl?: string
      sshUser?: string
    },
    timeoutMs = 25000,
  ) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestSshVerificationOnLocalNode(executorId, payload, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<SshVerificationResult>({
        executorId,
        target,
        request: {
          operation: 'ssh-verification',
          ...payload,
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法校验 SSH 身份。')
  },

  async requestTelemetry(executorId: string, timeoutMs = 15000) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestTelemetryOnLocalNode(executorId, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<import('@shared/types').ExecutorTelemetrySnapshot>({
        executorId,
        target,
        request: {
          operation: 'telemetry',
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法刷新资源状态。')
  },

  async requestDoctor(executorId: string, timeoutMs = 20000) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestDoctorOnLocalNode(executorId, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<WorkerDoctorPayload>({
        executorId,
        target,
        request: {
          operation: 'doctor',
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法执行自检。')
  },

  requestRepoProbeOnLocalNode,
  requestPatVerificationOnLocalNode,
  requestSshVerificationOnLocalNode,
  requestTelemetryOnLocalNode,
  requestDoctorOnLocalNode,
  requestTerminalSessionListOnLocalNode,
  requestTerminalSessionCreateOnLocalNode,
  requestTerminalLocalAttachTicketOnLocalNode,
  requestTerminalSessionCloseOnLocalNode,
  requestTerminalCommandOnLocalNode,

  requestSkillScan(
    executorId: string,
    payload: {
      scanMode: import('@shared/types').ExecutorSkillScanMode
      rootPath?: string
    },
    timeoutMs = 30000,
  ) {
    return requestOnLocalExecutor<ExecutorSkillScanResult>({
      executorId,
      pending: pendingSkillScans,
      timeoutMs,
      offlineMessage: '执行器当前未在线，无法扫描本地技能目录。',
      timeoutMessage: '执行器扫描技能目录超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.skills.scan.request',
        requestId,
        scanMode: payload.scanMode,
        rootPath: payload.rootPath,
        at: new Date().toISOString(),
      }),
    })
  },

  requestAgentSessionList(executorId: string, timeoutMs = 15000) {
    return requestOnLocalExecutor<ExecutorAgentSessionsResult>({
      executorId,
      pending: pendingAgentSessionLists,
      timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取本地 Agent 会话。',
      timeoutMessage: '执行器读取本地 Agent 会话超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.agent-sessions.list.request',
        requestId,
        at: new Date().toISOString(),
      }),
    })
  },

  requestAgentSessionRead(
    executorId: string,
    payload: {
      source: import('@shared/types').ExecutorAgentSessionSource
      sessionId: string
    },
    timeoutMs = 15000,
  ) {
    return requestOnLocalExecutor<ExecutorAgentSessionReadResult>({
      executorId,
      pending: pendingAgentSessionReads,
      timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取本地 Agent 会话详情。',
      timeoutMessage: '执行器读取本地 Agent 会话详情超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.agent-sessions.read.request',
        requestId,
        source: payload.source,
        sessionId: payload.sessionId,
        at: new Date().toISOString(),
      }),
    })
  },

  requestRepoBranches(executorId: string, localPath: string, repoUrl?: string, preferredBranch?: string, gitIdentity?: import('@shared/types').TaskRuntimeGitIdentity, timeoutMs = 45000) {
    const socket = executorRegistry.getSocket(executorId)
    if (!socket || !isSocketOpen(socket)) {
      return Promise.reject(new Error('执行器当前未在线，无法读取仓库分支。'))
    }

    const requestId = crypto.randomUUID()
    return new Promise<RepoBranchSnapshotResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRepoBranches.delete(requestId)
        console.warn('[executor-repo-branches] timeout', JSON.stringify({
          executorId,
          requestId,
          localPath,
          repoUrl,
          preferredBranch,
          timeoutMs,
        }))
        reject(new Error('执行器读取仓库分支超时，请稍后重试。若该执行器是局域网内旧进程，请先重启到最新版本。'))
      }, timeoutMs)

      pendingRepoBranches.set(requestId, {
        executorId,
        resolve,
        reject,
        timer,
      })

      console.log('[executor-repo-branches] request', JSON.stringify({
        executorId,
        requestId,
        localPath,
        repoUrl,
        preferredBranch,
        timeoutMs,
      }))

      send(socket, {
        type: 'executor.repo-branches.request',
        requestId,
        localPath,
        repoUrl,
        preferredBranch,
        gitIdentity,
        at: new Date().toISOString(),
      })
    })
  },

  requestGitCheckout(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    branchName: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitCheckoutResult>({
      executorId, pending: pendingGitCheckouts, timeoutMs,
      offlineMessage: '执行器当前未在线，无法切换分支。', timeoutMessage: '执行器切换分支超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.checkout.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        branchName: payload.branchName,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitDiff(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    baseBranch: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitDiffResult>({
      executorId, pending: pendingGitDiffs, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取 Git diff。', timeoutMessage: '执行器读取 Git diff 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.diff.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        baseBranch: payload.baseBranch,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitCommit(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    branchName?: string
    commitMessage: string
    push?: boolean
    stagedOnly?: boolean
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 45000) {
    return requestOnLocalExecutor<ExecutorGitCommitResult>({
      executorId, pending: pendingGitCommits, timeoutMs,
      offlineMessage: '执行器当前未在线，无法自动提交改动。', timeoutMessage: '执行器自动提交改动超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.commit.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        branchName: payload.branchName,
        commitMessage: payload.commitMessage,
        push: payload.push,
        stagedOnly: payload.stagedOnly,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitWorkingTreeDiff(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitWorkingTreeDiffResult>({
      executorId, pending: pendingGitWorkingTreeDiffs, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取当前工作区 Git 改动。', timeoutMessage: '执行器读取当前工作区 Git 改动超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.working-tree-diff.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitStatus(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitStatusResult>({
      executorId, pending: pendingGitStatuses, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取 Git 状态。', timeoutMessage: '执行器读取 Git 状态超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.status.request', requestId, worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl, gitIdentity: payload.gitIdentity, at: new Date().toISOString(),
      }),
    })
  },

  requestGitFileDiff(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    path: string
    stage: 'staged' | 'unstaged'
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitFileDiffResult>({
      executorId, pending: pendingGitFileDiffs, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取文件 diff。', timeoutMessage: '执行器读取文件 diff 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.file-diff.request', requestId, worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl, path: payload.path, stage: payload.stage, gitIdentity: payload.gitIdentity, at: new Date().toISOString(),
      }),
    })
  },

  requestGitChange(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    action: 'stage' | 'unstage' | 'discard'
    paths: string[]
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitChangeActionResult>({
      executorId, pending: pendingGitChanges, timeoutMs,
      offlineMessage: '执行器当前未在线，无法更新 Git 改动。', timeoutMessage: '执行器更新 Git 改动超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.change.request', requestId, worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl, action: payload.action, paths: payload.paths, gitIdentity: payload.gitIdentity, at: new Date().toISOString(),
      }),
    })
  },

  requestGitCommitDiff(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    commitSha: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitCommitDiffResult>({
      executorId, pending: pendingGitCommitDiffs, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取 commit diff。', timeoutMessage: '执行器读取 commit diff 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.commit-diff.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        commitSha: payload.commitSha,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitBaselineSnapshot(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitBaselineSnapshotResult>({
      executorId, pending: pendingGitBaselineSnapshots, timeoutMs,
      offlineMessage: '执行器当前未在线，无法创建 Git turn baseline。', timeoutMessage: '执行器创建 Git turn baseline 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.baseline-snapshot.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitBaselineDiff(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    baselineTreeSha: string
    targetCommitSha?: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitBaselineDiffResult>({
      executorId, pending: pendingGitBaselineDiffs, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取 Git turn baseline diff。', timeoutMessage: '执行器读取 Git turn baseline diff 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.baseline-diff.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        baselineTreeSha: payload.baselineTreeSha,
        targetCommitSha: payload.targetCommitSha,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitRebase(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    baseBranch: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 45000) {
    return requestOnLocalExecutor<ExecutorGitRebaseResult>({
      executorId, pending: pendingGitRebases, timeoutMs,
      offlineMessage: '执行器当前未在线，无法执行 rebase。', timeoutMessage: '执行器执行 rebase 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.rebase.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        baseBranch: payload.baseBranch,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitGraph(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    baseBranch: string
    limit?: number
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 30000) {
    return requestOnLocalExecutor<ExecutorGitGraphResult>({
      executorId, pending: pendingGitGraphs, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取 Git graph。', timeoutMessage: '执行器读取 Git graph 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.graph.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        baseBranch: payload.baseBranch,
        limit: payload.limit,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitPush(executorId: string, payload: {
    worktreePath: string
    repoUrl?: string
    branchName?: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 45000) {
    return requestOnLocalExecutor<ExecutorGitPushResult>({
      executorId, pending: pendingGitPushes, timeoutMs,
      offlineMessage: '执行器当前未在线，无法推送分支。', timeoutMessage: '执行器推送分支超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.push.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        branchName: payload.branchName,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestGitPullRequest(executorId: string, payload: {
    worktreePath: string
    repoUrl: string
    title: string
    body: string
    baseBranch: string
    compareBranch?: string
    gitIdentity?: TaskRuntimeGitIdentity
  }, timeoutMs = 60000) {
    return requestOnLocalExecutor<ExecutorGitPullRequestResult>({
      executorId, pending: pendingGitPullRequests, timeoutMs,
      offlineMessage: '执行器当前未在线，无法创建 PR。', timeoutMessage: '执行器创建 PR 超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.git.pull-request.request',
        requestId,
        worktreePath: payload.worktreePath,
        repoUrl: payload.repoUrl,
        title: payload.title,
        body: payload.body,
        baseBranch: payload.baseBranch,
        compareBranch: payload.compareBranch,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      }),
    })
  },

  requestWorktreeEnsure(executorId: string, payload: {
    workspaceId?: string
    ownerUserId?: string
    repoPath?: string
    repoUrl?: string
    preferredBranch?: string
    startPointMode?: ExecutorWorktreeStartPointMode
    branchName: string
    worktreePath: string
    workingDirectoryMode?: import('@shared/types').WorkingDirectoryMode
    gitIdentity?: TaskRuntimeGitIdentity
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    onOperationEvent?: (event: ExecutorWorkspaceOperationEvent) => void
  }, timeoutMs = 30000) {
    const socket = executorRegistry.getSocket(executorId)
    if (!socket || !isSocketOpen(socket)) {
      return Promise.reject(new Error('执行器当前未在线，无法准备工作目录。'))
    }

    const dedupeKey = buildWorktreeEnsureDedupeKey({
      executorId,
      workspaceId: payload.workspaceId,
      ownerUserId: payload.ownerUserId,
      repoPath: payload.repoPath,
      repoUrl: payload.repoUrl,
      preferredBranch: payload.preferredBranch,
      startPointMode: payload.startPointMode,
      branchName: payload.branchName,
      worktreePath: payload.worktreePath,
      workingDirectoryMode: payload.workingDirectoryMode,
    })
    const inflight = inflightWorktreeEnsures.get(dedupeKey)
    if (inflight) {
      return inflight
    }

    const requestId = crypto.randomUUID()
    let promise!: Promise<ExecutorWorktreeResult>
    promise = new Promise<ExecutorWorktreeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = pendingWorktreeEnsures.get(requestId)
        inflightWorktreeEnsures.delete(dedupeKey)
        pendingWorktreeEnsures.delete(requestId)
        reject(new Error(buildWorktreeEnsureFailureMessage(
          '执行器准备工作目录超时，请稍后重试。',
          pending?.lastOperationEvent,
        )))
      }, timeoutMs)

      pendingWorktreeEnsures.set(requestId, {
        executorId,
        resolve,
        reject,
        onOperationEvent: payload.onOperationEvent,
        lastOperationEvent: undefined,
        timer,
        dedupeKey,
      })

      send(socket, {
        type: 'executor.worktree.ensure.request',
        requestId,
        workspaceId: payload.workspaceId,
        ownerUserId: payload.ownerUserId,
        repoPath: payload.repoPath,
        repoUrl: payload.repoUrl,
        preferredBranch: payload.preferredBranch,
        startPointMode: payload.startPointMode,
        branchName: payload.branchName,
        worktreePath: payload.worktreePath,
        workingDirectoryMode: payload.workingDirectoryMode,
        gitIdentity: payload.gitIdentity,
        runtimeEnvironment: payload.runtimeEnvironment,
        at: new Date().toISOString(),
      })
    })
    inflightWorktreeEnsures.set(dedupeKey, promise)
    return promise
  },

  requestWorktreeCleanup(executorId: string, payload: {
    workspaceId?: string
    ownerUserId?: string
    repoPath?: string
    repoUrl?: string
    worktreePath: string
    workingDirectoryMode?: import('@shared/types').WorkingDirectoryMode
    branchName?: string
    deleteLocalBranch?: boolean
    deleteRemoteBranch?: boolean
    gitIdentity?: TaskRuntimeGitIdentity
    onOperationEvent?: (event: ExecutorWorkspaceOperationEvent) => void
  }, timeoutMs = 30000) {
    const socket = executorRegistry.getSocket(executorId)
    if (!socket || !isSocketOpen(socket)) {
      return Promise.reject(new Error('执行器当前未在线，无法清理工作目录。'))
    }

    const requestId = crypto.randomUUID()
    return new Promise<ExecutorWorktreeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingWorktreeCleanups.delete(requestId)
        reject(new Error('执行器清理工作目录超时，请稍后重试。'))
      }, timeoutMs)

      pendingWorktreeCleanups.set(requestId, {
        executorId,
        resolve,
        reject,
        onOperationEvent: payload.onOperationEvent,
        timer,
      })

      send(socket, {
        type: 'executor.worktree.cleanup.request',
        requestId,
        workspaceId: payload.workspaceId,
        ownerUserId: payload.ownerUserId,
        repoPath: payload.repoPath,
        repoUrl: payload.repoUrl,
        worktreePath: payload.worktreePath,
        workingDirectoryMode: payload.workingDirectoryMode,
        branchName: payload.branchName,
        deleteLocalBranch: payload.deleteLocalBranch,
        deleteRemoteBranch: payload.deleteRemoteBranch,
        gitIdentity: payload.gitIdentity,
        at: new Date().toISOString(),
      })
    })
  },

  async requestAgentPrompt(executorId: string, payload: {
    agentType: ServerAgentType
    actingUserId?: string
    runtimeAgentId?: string
    resumeSessionId?: string
    cwd: string
    agentWorkdir?: {
      agentId: string
      sessionId?: string
      workspaceId?: string
    }
    title: string
    prompt: string
    attachments?: import('@shared/task-chat-attachment').TaskChatAttachment[]
    executionModel?: string
    agentSettings?: import('@shared/types').AgentRuntimeSettings
    opencodeConfig?: import('@shared/types').OpenCodeExecutionConfig
    mcpServers?: import('@shared/mcp').McpServerPolicy[]
    runtimeSkillPackages?: import('@shared/types').ExecutorSkillPackage[]
    runtimeEnv?: Record<string, string>
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    recovery?: {
      taskId: string
      workspaceId: string
      workspaceSessionId: string
      userId: string
      userMessage: string
      attachments?: import('@shared/task-chat-attachment').TaskChatAttachment[]
      turnId: string
      expectedRuntimeSequence: number
      executionModel?: string
    }
    mainChatRecovery?: {
      userId: string
      sessionId: string
      userMessage: string
      attachments?: import('@shared/task-chat-attachment').TaskChatAttachment[]
      continuationScope?: import('../routes/project-main-chat-session').MainChatContinuationScope
    }
    onEvent?: (event: ExecutorAgentPromptEvent) => void
    signal?: AbortSignal
    timeoutMs?: number
  }) {
    const socket = executorRegistry.getSocket(executorId)
    if (!socket || !isSocketOpen(socket)) {
      return Promise.reject(new Error('执行器当前未在线，无法运行工作区对话。'))
    }

    const requestId = crypto.randomUUID()
    if (payload.recovery) {
      await registerPendingWorkspacePrompt({
        requestId,
        executorId,
        taskId: payload.recovery.taskId,
        workspaceId: payload.recovery.workspaceId,
        workspaceSessionId: payload.recovery.workspaceSessionId,
        userId: payload.recovery.userId,
        userMessage: payload.recovery.userMessage,
        attachments: payload.recovery.attachments ?? [],
        turnId: payload.recovery.turnId,
        expectedRuntimeSequence: payload.recovery.expectedRuntimeSequence,
        executionModel: payload.recovery.executionModel,
        createdAt: new Date().toISOString(),
      })
    }
    if (payload.mainChatRecovery) {
      await registerPendingMainChatPrompt({
        requestId,
        executorId,
        userId: payload.mainChatRecovery.userId,
        sessionId: payload.mainChatRecovery.sessionId,
        userMessage: payload.mainChatRecovery.userMessage,
        attachments: payload.mainChatRecovery.attachments ?? [],
        continuationScope: payload.mainChatRecovery.continuationScope,
        createdAt: new Date().toISOString(),
      })
    }
    console.log('[executor-agent] request', JSON.stringify({
      executorId,
      requestId,
      agentType: payload.agentType,
      resumeSessionId: payload.resumeSessionId ?? null,
      cwd: payload.cwd,
      title: payload.title,
      executionModel: payload.executionModel ?? 'default',
      attachmentCount: payload.attachments?.length ?? 0,
      promptPreview: payload.prompt.slice(0, 200),
    }))
    return new Promise<ExecutorAgentPromptResult>((resolve, reject) => {
      const requestedTimeoutMs = payload.timeoutMs
      const timeoutMs = typeof requestedTimeoutMs === 'number'
        && Number.isFinite(requestedTimeoutMs)
        && requestedTimeoutMs > 0
        ? Math.max(1_000, requestedTimeoutMs)
        : undefined
      const abortHandler = () => {
        const pending = pendingAgentPrompts.get(requestId)
        if (!pending) {
          return
        }

        if (pending.timer) {
          clearTimeout(pending.timer)
        }
        pending.cleanupAbortListener?.()
        pendingAgentPrompts.delete(requestId)
        void clearPendingWorkspacePrompt(requestId)
        void clearPendingMainChatPrompt(requestId)
        const signalReason = payload.signal?.reason
        const abortReason: ExecutorAgentPromptAbortReason = signalReason === 'user_stop'
          || (typeof signalReason === 'object' && signalReason !== null && 'reason' in signalReason && signalReason.reason === 'user_stop')
          ? 'user_stop'
          : 'server_abort'
        const abortMessage = abortReason === 'user_stop' ? '已停止' : '请求已中止'
        send(socket, {
          type: 'executor.agent.prompt.cancel',
          requestId,
          reason: abortReason,
          message: abortMessage,
          at: new Date().toISOString(),
        })

        const error = new Error(abortMessage)
        error.name = 'AbortError'
        ;(error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason = abortReason
        reject(error)
      }

      const cleanupAbortListener = () => {
        payload.signal?.removeEventListener('abort', abortHandler)
      }

      pendingAgentPrompts.set(requestId, {
        executorId,
        resolve: (value) => {
          void clearPendingWorkspacePrompt(requestId)
          void clearPendingMainChatPrompt(requestId)
          resolve(value)
        },
        reject: (reason) => {
          void clearPendingWorkspacePrompt(requestId)
          void clearPendingMainChatPrompt(requestId)
          reject(reason)
        },
        onEvent: payload.onEvent,
        timer: timeoutMs
          ? setTimeout(() => {
            const pending = pendingAgentPrompts.get(requestId)
            if (!pending) {
              return
            }

            pending.cleanupAbortListener?.()
            pendingAgentPrompts.delete(requestId)
            void clearPendingWorkspacePrompt(requestId)
            void clearPendingMainChatPrompt(requestId)
            send(socket, {
              type: 'executor.agent.prompt.cancel',
              requestId,
              reason: 'server_timeout',
              message: `执行器工作区对话超时（${timeoutMs}ms）。`,
              at: new Date().toISOString(),
            })
            const error = new Error(`执行器工作区对话超时（${timeoutMs}ms）。`)
            error.name = 'AbortError'
            ;(error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason = 'server_timeout'
            reject(error)
          }, timeoutMs)
          : undefined,
        cleanupAbortListener,
      })

      payload.signal?.addEventListener('abort', abortHandler, { once: true })

      send(socket, {
        type: 'executor.agent.prompt.request',
        requestId,
        agentType: payload.agentType as import('@shared/types').Task['agentType'],
        actingUserId: payload.actingUserId,
        runtimeAgentId: payload.runtimeAgentId,
        resumeSessionId: payload.resumeSessionId,
        cwd: payload.cwd,
        agentWorkdir: payload.agentWorkdir,
        title: payload.title,
        prompt: payload.prompt,
        attachments: payload.attachments,
        executionModel: payload.executionModel,
        agentSettings: payload.agentSettings,
        opencodeConfig: payload.opencodeConfig,
        mcpServers: payload.mcpServers,
        runtimeSkillPackages: payload.runtimeSkillPackages,
        runtimeEnv: payload.runtimeEnv,
        runtimeEnvironment: payload.runtimeEnvironment,
        at: new Date().toISOString(),
      })
    })
  },

  requestDirectoryBrowse(executorId: string, rootPath: string, directoryPath?: string, timeoutMs = 15000) {
    return requestOnLocalExecutor<ExecutorDirectoryBrowseResult>({
      executorId, pending: pendingDirectoryBrowses, timeoutMs,
      offlineMessage: '执行器当前未在线，无法浏览目录。',
      timeoutMessage: '执行器目录浏览超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.directory-browse.request',
        requestId,
        rootPath,
        directoryPath,
        at: new Date().toISOString(),
      }),
    })
  },

  requestFileRead(executorId: string, rootPath: string, filePath: string, timeoutMs = 15000) {
    return requestOnLocalExecutor<ExecutorFileReadResult>({
      executorId, pending: pendingFileReads, timeoutMs,
      offlineMessage: '执行器当前未在线，无法读取文件。',
      timeoutMessage: '执行器文件读取超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.file-read.request',
        requestId,
        rootPath,
        filePath,
        at: new Date().toISOString(),
      }),
    })
  },

  requestFileWrite(executorId: string, rootPath: string, filePath: string, content: string, timeoutMs = 15000) {
    return requestOnLocalExecutor<ExecutorFileWriteResult>({
      executorId, pending: pendingFileWrites, timeoutMs,
      offlineMessage: '执行器当前未在线，无法写入文件。',
      timeoutMessage: '执行器文件写入超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.file-write.request',
        requestId,
        rootPath,
        filePath,
        content,
        at: new Date().toISOString(),
      }),
    })
  },

  requestAgentWorkdir(
    executorId: string,
    payload: {
      agentId: string
      action: 'summary' | 'ensure' | 'rescan' | 'list' | 'cleanup' | 'delete'
      relativePath?: string
      refresh?: boolean
      workspaceId?: string
    },
    timeoutMs = 30000,
  ) {
    return requestOnLocalExecutor<ExecutorAgentWorkdirResult>({
      executorId, pending: pendingAgentWorkdirRequests, timeoutMs,
      offlineMessage: '执行器当前未在线，无法访问 Agent 工作目录。',
      timeoutMessage: '执行器 Agent 工作目录请求超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.agent.workdir.request',
        requestId,
        agentId: payload.agentId,
        action: payload.action,
        relativePath: payload.relativePath,
        refresh: payload.refresh,
        workspaceId: payload.workspaceId,
        at: new Date().toISOString(),
      }),
    })
  },

  requestAgentWorkdirDownload(
    executorId: string,
    payload: {
      agentId: string
      relativePath: string
      workspaceId?: string
    },
    timeoutMs = 30000,
  ) {
    return requestOnLocalExecutor<ExecutorAgentWorkdirDownloadResult>({
      executorId, pending: pendingAgentWorkdirDownloads, timeoutMs,
      offlineMessage: '执行器当前未在线，无法下载 Agent 工作目录文件。',
      timeoutMessage: '执行器 Agent 工作目录下载超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.agent.workdir.download.request',
        requestId,
        agentId: payload.agentId,
        relativePath: payload.relativePath,
        workspaceId: payload.workspaceId,
        at: new Date().toISOString(),
      }),
    })
  },

  requestAgentWorkdirRead(
    executorId: string,
    payload: {
      agentId: string
      relativePath: string
      workspaceId?: string
    },
    timeoutMs = 30000,
  ) {
    return requestOnLocalExecutor<ExecutorAgentWorkdirReadResult>({
      executorId, pending: pendingAgentWorkdirReads, timeoutMs,
      offlineMessage: '执行器当前未在线，无法预览 Agent 工作目录文件。',
      timeoutMessage: '执行器 Agent 工作目录文件预览超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.agent.workdir.read.request',
        requestId,
        agentId: payload.agentId,
        relativePath: payload.relativePath,
        workspaceId: payload.workspaceId,
        at: new Date().toISOString(),
      }),
    })
  },

  async requestTerminalSessionList(
    executorId: string,
    payload: {
      scope?: import('@shared/types').WorkspaceTerminalSessionScope
      workspaceId?: string
    },
    timeoutMs = 15000,
  ) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestTerminalSessionListOnLocalNode(executorId, payload, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<ExecutorTerminalSessionsResult>({
        executorId,
        target,
        request: {
          operation: 'terminal-session-list',
          scope: payload.scope,
          workspaceId: payload.workspaceId,
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法读取终端会话。')
  },

  async requestTerminalSessionCreate(
    executorId: string,
    payload: {
      terminalId: string
      scope: import('@shared/types').WorkspaceTerminalSessionScope
      workspaceId?: string
      title?: string
      cwd?: string
      cols?: number
      rows?: number
      ownerUserId?: string
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    },
    timeoutMs = 15000,
  ) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestTerminalSessionCreateOnLocalNode(executorId, payload, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<ExecutorTerminalSessionCreateResult>({
        executorId,
        target,
        request: {
          operation: 'terminal-session-create',
          terminalId: payload.terminalId,
          scope: payload.scope,
          workspaceId: payload.workspaceId,
          title: payload.title,
          cwd: payload.cwd,
          cols: payload.cols,
          rows: payload.rows,
          ownerUserId: payload.ownerUserId,
          runtimeEnvironment: payload.runtimeEnvironment,
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法创建终端会话。')
  },

  requestTerminalSessionAttach(
    executorId: string,
    payload: {
      clientId: string
      terminalId: string
      scope: import('@shared/types').WorkspaceTerminalSessionScope
      workspaceId?: string
    },
    timeoutMs = 15000,
  ) {
    return requestOnLocalExecutor<ExecutorTerminalSessionAttachResult>({
      executorId, pending: pendingTerminalSessionAttaches, timeoutMs,
      offlineMessage: '执行器当前未在线，无法附着终端会话。',
      timeoutMessage: '执行器附着终端会话超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.terminal.session.attach',
        requestId,
        clientId: payload.clientId,
        terminalId: payload.terminalId,
        scope: payload.scope,
        workspaceId: payload.workspaceId,
        at: new Date().toISOString(),
      }),
    })
  },

  requestTerminalLocalAttachTicket(
    executorId: string,
    payload: {
      terminalId: string
      scope: import('@shared/types').WorkspaceTerminalSessionScope
      workspaceId?: string
      cwd?: string
    },
    timeoutMs = 15000,
  ) {
    return requestTerminalLocalAttachTicketOnLocalNode(executorId, payload, timeoutMs)
  },

  notifyTerminalSessionDetach(
    executorId: string,
    payload: {
      clientId: string
      terminalId: string
      scope: import('@shared/types').WorkspaceTerminalSessionScope
      workspaceId?: string
    },
  ) {
    const socket = executorRegistry.getSocket(executorId)
    if (!socket || !isSocketOpen(socket)) {
      return false
    }

    send(socket, {
      type: 'executor.terminal.session.detach',
      clientId: payload.clientId,
      terminalId: payload.terminalId,
      scope: payload.scope,
      workspaceId: payload.workspaceId,
      at: new Date().toISOString(),
    })
    return true
  },

  async requestTerminalSessionClose(
    executorId: string,
    payload: {
      terminalId: string
      scope: import('@shared/types').WorkspaceTerminalSessionScope
      workspaceId?: string
    },
    timeoutMs = 15000,
  ) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestTerminalSessionCloseOnLocalNode(executorId, payload, timeoutMs)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<ExecutorTerminalSessionCloseResult>({
        executorId,
        target,
        request: {
          operation: 'terminal-session-close',
          terminalId: payload.terminalId,
          scope: payload.scope,
          workspaceId: payload.workspaceId,
          timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法关闭终端会话。')
  },

  async requestTerminalCommand(
    executorId: string,
    command: string,
    cwd?: string,
    options?: {
      timeoutMs?: number
      mode?: ExecutorTerminalRequestMode
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    },
  ) {
    const target = await resolveExecutorRequestTarget(executorId)
    if (target.mode === 'local') {
      return requestTerminalCommandOnLocalNode(executorId, command, cwd, options)
    }
    if (target.mode === 'remote') {
      return forwardExecutorClusterRequest<ExecutorTerminalResult>({
        executorId,
        target,
        request: {
          operation: 'terminal-command',
          command,
          cwd,
          mode: options?.mode,
          runtimeEnvironment: options?.runtimeEnvironment,
          timeoutMs: options?.timeoutMs,
        },
      })
    }

    throw new Error('执行器当前未在线，无法打开远程终端。')
  },

  requestHttpProbe(
    executorId: string,
    url: string,
    options?: {
      timeoutMs?: number
    },
  ) {
    const timeoutMs = options?.timeoutMs ?? 10000
    return requestOnLocalExecutor<ExecutorHttpProbeResult>({
      executorId, pending: pendingHttpProbes, timeoutMs,
      offlineMessage: '执行器当前未在线，无法探测环境地址。',
      timeoutMessage: '环境地址探测超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.http.probe.request',
        requestId,
        url,
        timeoutMs,
        at: new Date().toISOString(),
      }),
    })
  },

  requestDesktopSandbox(executorId: string, payload: {
    request: import('@shared/types').WorkspaceDesktopSandboxRequest
  }, timeoutMs = 120000) {
    return requestOnLocalExecutor<import('@shared/types').WorkspaceDesktopSandboxResult>({
      executorId, pending: pendingDesktopSandboxRequests, timeoutMs,
      offlineMessage: '执行器当前未在线，无法操作 desktop sandbox。',
      timeoutMessage: 'desktop sandbox 请求超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.desktop-sandbox.request',
        requestId,
        request: payload.request,
        at: new Date().toISOString(),
      }),
    })
  },

  requestRemoteCode(executorId: string, payload: {
    request: import('@shared/types').WorkspaceRemoteCodeRequest
  }, timeoutMs = 60000) {
    return requestOnLocalExecutor<import('@shared/types').WorkspaceRemoteCodeResult>({
      executorId, pending: pendingRemoteCodeRequests, timeoutMs,
      offlineMessage: '执行器当前未在线，无法操作 Code Server。',
      timeoutMessage: 'Code Server 请求超时，请稍后重试。',
      buildMessage: (requestId) => ({
        type: 'executor.remote-code.request',
        requestId,
        request: payload.request,
        at: new Date().toISOString(),
      }),
    })
  },

}

import type { McpServerPolicy } from '../mcp'
import type { ExecutorFeatureFlags } from '../user-experimental-settings'
import type { CodexOauthOperation, ExecutorCodexOauthResponsePayload } from './codex-oauth'
import type { TaskChatAttachment } from '../task-chat-attachment'
import type { WorkspaceDesktopSandboxRequest, WorkspaceDesktopSandboxResult } from './desktop-sandbox'
import type { WorkspaceRemoteCodeRequest, WorkspaceRemoteCodeResult } from './remote-code'
import type { PreviewTunnelClientStatus } from './preview'
import type { WorkerMeshEnrollmentConfig, WorkerMeshStatus } from './mesh'
import type {
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
} from '../task-git-ops'

import type {
  AgentRuntimeSettings,
  AgentSettings,
  DistributedTaskStatus,
  ExecutionModelOption,
  GitProvider,
  OpenCodeExecutionConfig,
  ResolvedModelImportBinding,
  WorkingDirectoryMode,
} from './core'
import type { AgentType } from './core'
import type {
  ExecutorAgentPromptEvent,
  ExecutorAgentWorkdirDownloadResult,
  ExecutorAgentSessionReadResult,
  ExecutorAgentSessionsResult,
  ExecutorAgentWorkdirReadResult,
  ExecutorAgentWorkdirResult,
  ExecutorAgentPromptResult,
  ExecutorDirectoryBrowseResult,
  ExecutorFileReadResult,
  ExecutorFileWriteResult,
  ExecutorHttpProbeResult,
  ExecutorPairRequest,
  ExecutorPairResponse,
  ExecutorSkillPackage,
  ExecutorSkillScanResult,
  ExecutorTelemetrySnapshot,
  ExecutorTerminalRequestMode,
  ExecutorTerminalResult,
  ExecutorTerminalLocalAttachTicketResult,
  ExecutorTerminalSessionAttachResult,
  ExecutorTerminalSessionCloseResult,
  ExecutorTerminalSessionCreateResult,
  ExecutorTerminalSessionOutput,
  ExecutorTerminalSessionsResult,
  ExecutorWorkspaceOperationEvent,
  ExecutorWorktreeResult,
  LocalPathProbeResult,
  PatVerificationResult,
  RepoBranchSnapshotResult,
  SshVerificationResult,
  TaskRuntimeGitIdentity,
  WorkerDoctorPayload,
} from './executor'
import type { DistributedTask } from './task-domain'
import type { RuntimeEnvironmentExecutionPayload } from '../runtime-environment'
import type { WorkspaceTerminalSessionDescriptor, WorkspaceTerminalSessionScope, WorkspaceTerminalSessionSnapshot } from '../workspace-terminal'

export type ExecutorWorktreeStartPointMode = 'workspace-branch' | 'preferred-branch'

export type PreviewIngressTransport = 'gateway-public-proxy'

export type {
  ExecutorGitBaselineDiffResult,
  ExecutorGitBaselineSnapshotResult,
  ExecutorGitCommitResult,
  ExecutorGitCheckoutResult,
  ExecutorGitCommitDiffResult,
  ExecutorGitChange,
  ExecutorGitChangeAction,
  ExecutorGitChangeActionResult,
  ExecutorGitDiffResult,
  ExecutorGitFileDiffResult,
  ExecutorGitGraphCommit,
  ExecutorGitGraphResult,
  ExecutorGitPullRequestResult,
  ExecutorGitPushResult,
  ExecutorGitRebaseResult,
  ExecutorGitWorkingTreeDiffResult,
  ExecutorGitStatusResult,
  TaskGitDiffFile,
  TaskGitPullRequestResult,
} from '../task-git-ops'

export type ExecutorToControlPlaneMessage =
  | {
      type: 'executor.register'
      executorId: string
      capabilities: string[]
      labels: string[]
      workspaceRoot: string
      maxConcurrency: number
      localServerPort?: number
      localServerInstanceId?: string
      previewExposureMode?: 'private' | 'public-ingress'
      previewIngressPort?: number
      previewIngressBaseUrl?: string
      previewIngressDetectedPublicIp?: string
      previewIngressDetectedLanIp?: string
      projectBindings?: import('./executor').WorkerProjectBinding[]
      sshPubkey?: string
      platform?: string
      version?: string
      telemetry?: ExecutorTelemetrySnapshot
      mesh?: WorkerMeshStatus
      runningTaskIds?: string[]
      queuedTaskIds?: string[]
      terminalSessions?: WorkspaceTerminalSessionDescriptor[]
    }
  | {
      type: 'executor.heartbeat'
      executorId: string
      runningTaskIds: string[]
      queuedTaskIds: string[]
      localServerPort?: number
      localServerInstanceId?: string
      previewExposureMode?: 'private' | 'public-ingress'
      previewIngressPort?: number
      previewIngressBaseUrl?: string
      previewIngressDetectedPublicIp?: string
      previewIngressDetectedLanIp?: string
      projectBindings?: import('./executor').WorkerProjectBinding[]
      sshPubkey?: string
      version?: string
      at: string
      telemetry?: ExecutorTelemetrySnapshot
      mesh?: WorkerMeshStatus
      terminalSessions?: WorkspaceTerminalSessionDescriptor[]
    }
  | {
      type: 'executor.latency.pong'
      executorId: string
      requestId: string
      sentAt: string
      receivedAt: string
      respondedAt: string
    }
  | {
      type: 'executor.capabilities.update'
      executorId: string
      capabilities: string[]
      labels: string[]
      workspaceRoot: string
      maxConcurrency: number
      previewExposureMode?: 'private' | 'public-ingress'
      previewIngressPort?: number
      previewIngressBaseUrl?: string
      previewIngressDetectedLanIp?: string
      projectBindings?: import('./executor').WorkerProjectBinding[]
      sshPubkey?: string
    }
  | {
      type: 'task.ack'
      taskId: string
      idempotencyKey: string
      executorId: string
      accepted: boolean
      reason?: string
    }
  | {
      type: 'task.event'
      taskId: string
      idempotencyKey: string
      executorId: string
      sequence?: number
      status: DistributedTaskStatus
      message: string
      at: string
    }
  | {
      type: 'task.result'
      task: DistributedTask
      executorId: string
      sequence?: number
    }
  | {
      type: 'config.export.response'
      executorId: string
      requestId: string
      opencodeConfigContent?: string
      codexConfigContent?: string
      codexAuthContent?: string
      claudeCodeConfigContent?: string
      defaultModel?: string
      agentSettings?: AgentSettings
      availableModels?: ExecutionModelOption[]
      resolvedModelBindings?: ResolvedModelImportBinding[]
      modelsMessage?: string
      at: string
    }
  | {
      type: 'executor.repo-probe.response'
      executorId: string
      requestId: string
      result: LocalPathProbeResult
      at: string
    }
  | {
      type: 'executor.git.pat.verify.response'
      executorId: string
      requestId: string
      result: PatVerificationResult
      at: string
    }
  | {
      type: 'executor.git.ssh.verify.response'
      executorId: string
      requestId: string
      result: SshVerificationResult
      at: string
    }
  | {
      type: 'executor.telemetry.response'
      executorId: string
      requestId: string
      telemetry: ExecutorTelemetrySnapshot
      at: string
    }
  | {
      type: 'executor.doctor.response'
      executorId: string
      requestId: string
      doctor: WorkerDoctorPayload
      at: string
    }
  | {
      type: 'executor.directory-browse.response'
      executorId: string
      requestId: string
      result: ExecutorDirectoryBrowseResult
      at: string
    }
  | {
      type: 'executor.file-read.response'
      executorId: string
      requestId: string
      result: ExecutorFileReadResult
      at: string
    }
  | {
      type: 'executor.file-write.response'
      executorId: string
      requestId: string
      result: ExecutorFileWriteResult
      at: string
    }
  | {
      type: 'executor.agent.workdir.response'
      executorId: string
      requestId: string
      result: ExecutorAgentWorkdirResult
      at: string
    }
  | {
      type: 'executor.agent.workdir.download.response'
      executorId: string
      requestId: string
      result: ExecutorAgentWorkdirDownloadResult
      at: string
    }
  | {
      type: 'executor.agent.workdir.read.response'
      executorId: string
      requestId: string
      result: ExecutorAgentWorkdirReadResult
      at: string
    }
  | {
      type: 'executor.agent-sessions.list.response'
      executorId: string
      requestId: string
      result: ExecutorAgentSessionsResult
      at: string
    }
  | {
      type: 'executor.agent-sessions.read.response'
      executorId: string
      requestId: string
      result: ExecutorAgentSessionReadResult
      at: string
    }
  | {
      type: 'executor.skills.scan.response'
      executorId: string
      requestId: string
      result: ExecutorSkillScanResult
      at: string
    }
  | {
      type: 'executor.repo-branches.response'
      executorId: string
      requestId: string
      result: RepoBranchSnapshotResult
      at: string
    }
  | {
      type: 'executor.git.commit.response'
      executorId: string
      requestId: string
      result: ExecutorGitCommitResult
      at: string
    }
  | {
      type: 'executor.git.checkout.response'
      executorId: string
      requestId: string
      result: ExecutorGitCheckoutResult
      at: string
    }
  | {
      type: 'executor.git.commit-diff.response'
      executorId: string
      requestId: string
      result: ExecutorGitCommitDiffResult
      at: string
    }
  | {
      type: 'executor.git.baseline-snapshot.response'
      executorId: string
      requestId: string
      result: ExecutorGitBaselineSnapshotResult
      at: string
    }
  | {
      type: 'executor.git.baseline-diff.response'
      executorId: string
      requestId: string
      result: ExecutorGitBaselineDiffResult
      at: string
    }
  | {
      type: 'executor.git.diff.response'
      executorId: string
      requestId: string
      result: ExecutorGitDiffResult
      at: string
    }
  | {
      type: 'executor.git.working-tree-diff.response'
      executorId: string
      requestId: string
      result: ExecutorGitWorkingTreeDiffResult
      at: string
    }
  | {
      type: 'executor.git.status.response'
      executorId: string
      requestId: string
      result: ExecutorGitStatusResult
      at: string
    }
  | {
      type: 'executor.git.file-diff.response'
      executorId: string
      requestId: string
      result: ExecutorGitFileDiffResult
      at: string
    }
  | {
      type: 'executor.git.change.response'
      executorId: string
      requestId: string
      result: ExecutorGitChangeActionResult
      at: string
    }
  | {
      type: 'executor.git.rebase.response'
      executorId: string
      requestId: string
      result: ExecutorGitRebaseResult
      at: string
    }
  | {
      type: 'executor.git.graph.response'
      executorId: string
      requestId: string
      result: ExecutorGitGraphResult
      at: string
    }
  | {
      type: 'executor.git.push.response'
      executorId: string
      requestId: string
      result: ExecutorGitPushResult
      at: string
    }
  | {
      type: 'executor.git.pull-request.response'
      executorId: string
      requestId: string
      result: ExecutorGitPullRequestResult
      at: string
    }
  | {
      type: 'executor.worktree.ensure.response'
      executorId: string
      requestId: string
      result: ExecutorWorktreeResult
      at: string
    }
  | {
      type: 'executor.worktree.cleanup.response'
      executorId: string
      requestId: string
      result: ExecutorWorktreeResult
      at: string
    }
  | {
      type: 'executor.workspace.operation.event'
      executorId: string
      requestId: string
      event: ExecutorWorkspaceOperationEvent
      at: string
    }
  | {
      type: 'executor.agent.prompt.response'
      executorId: string
      requestId: string
      result: ExecutorAgentPromptResult
      at: string
    }
  | {
      type: 'executor.agent.prompt.event'
      executorId: string
      requestId: string
      event: ExecutorAgentPromptEvent
      at: string
    }
  | {
      type: 'executor.terminal.response'
      executorId: string
      requestId: string
      result: ExecutorTerminalResult
    }
  | {
      type: 'executor.terminal.sessions.list.response'
      executorId: string
      requestId: string
      result: ExecutorTerminalSessionsResult
      at: string
    }
  | {
      type: 'executor.terminal.session.create.response'
      executorId: string
      requestId: string
      result: ExecutorTerminalSessionCreateResult
      at: string
    }
  | {
      type: 'executor.terminal.session.attach.response'
      executorId: string
      requestId: string
      result: ExecutorTerminalSessionAttachResult
      at: string
    }
  | {
      type: 'executor.terminal.local-attach-ticket.response'
      executorId: string
      requestId: string
      result: ExecutorTerminalLocalAttachTicketResult
      at: string
    }
  | {
      type: 'executor.terminal.session.close.response'
      executorId: string
      requestId: string
      result: ExecutorTerminalSessionCloseResult
      at: string
    }
  | {
      type: 'executor.terminal.session.snapshot'
      executorId: string
      clientId: string
      snapshot: WorkspaceTerminalSessionSnapshot
      at: string
    }
  | {
      type: 'executor.http.probe.response'
      executorId: string
      requestId: string
      result: ExecutorHttpProbeResult
      at: string
    }
  | {
      type: 'executor.desktop-sandbox.response'
      executorId: string
      requestId: string
      result: WorkspaceDesktopSandboxResult
      at: string
    }
  | {
      type: 'executor.remote-code.response'
      executorId: string
      requestId: string
      result: WorkspaceRemoteCodeResult
      at: string
    }
  | {
      type: 'executor.terminal.session.ready'
      executorId: string
      terminalId: string
      terminalKey: string
      clientId?: string
      cwd?: string
      mode?: 'pty' | 'pipe'
      at: string
    }
  | {
      type: 'executor.terminal.session.output'
      executorId: string
      output: ExecutorTerminalSessionOutput
    }
  | {
      type: 'executor.terminal.session.exit'
      executorId: string
      terminalId: string
      terminalKey: string
      exitCode: number
      at: string
    }
  | {
      type: 'preview.tunnel.status'
      executorId: string
      previewSessionId: string
      status: PreviewTunnelClientStatus
      message?: string
      at: string
    }
  | {
      type: 'executor.codex-oauth.response'
      executorId: string
      requestId: string
      operation: CodexOauthOperation
      ok: boolean
      payload?: ExecutorCodexOauthResponsePayload
      error?: string
      at: string
    }

export type ControlPlaneToExecutorMessage =
  | {
      type: 'control-plane.ready'
      executorId: string
      heartbeatIntervalMs: number
      now: string
      opencodeConfigContent?: string
      codexConfigContent?: string
      codexAuthContent?: string
      claudeCodeConfigContent?: string
      claudeCodeCredentialsContent?: string
      defaultModel?: string
      agentSettings?: AgentSettings
      workerUpdateSettings?: import('./core').WorkerUpdateSettings
      mcpServers?: McpServerPolicy[]
      maxConcurrency?: number
      previewExposureMode?: 'private' | 'public-ingress'
      previewIngressPort?: number
      previewProxySecret?: string
      meshEnrollment?: WorkerMeshEnrollmentConfig
      featureFlags?: ExecutorFeatureFlags
    }
  | {
      type: 'task.assign'
      task: DistributedTask
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      featureFlags?: ExecutorFeatureFlags
    }
  | {
      type: 'config.sync'
      opencodeConfigContent?: string
      codexConfigContent?: string
      codexAuthContent?: string
      claudeCodeConfigContent?: string
      claudeCodeCredentialsContent?: string
      defaultModel?: string
      agentSettings?: AgentSettings
      workerUpdateSettings?: import('./core').WorkerUpdateSettings
      mcpServers?: McpServerPolicy[]
      maxConcurrency?: number
      previewExposureMode?: 'private' | 'public-ingress'
      previewIngressPort?: number
      previewProxySecret?: string
      meshEnrollment?: WorkerMeshEnrollmentConfig
      featureFlags?: ExecutorFeatureFlags
      at: string
    }
  | {
      type: 'executor.unpair'
      reason?: string
      shutdown?: boolean
      at: string
    }
  | {
      type: 'executor.shutdown'
      reason?: string
      at: string
    }
  | {
      type: 'config.export.request'
      requestId: string
      agentType?: AgentType
      includeResolvedModelBindings?: boolean
      at: string
    }
  | {
      type: 'task.cancel'
      taskId: string
      reason?: string
    }
  | {
      type: 'executor.sync.request'
      cursor?: string
    }
  | {
      type: 'executor.latency.ping'
      executorId: string
      requestId: string
      sentAt: string
    }
  | {
      type: 'executor.repo-probe.request'
      requestId: string
      localPath: string
      at: string
    }
  | {
      type: 'executor.git.pat.verify.request'
      requestId: string
      provider: Extract<GitProvider, 'github' | 'gitlab'>
      host: string
      patToken: string
      at: string
    }
  | {
      type: 'executor.git.ssh.verify.request'
      requestId: string
      host: string
      sshPrivateKey: string
      repoUrl?: string
      sshUser?: string
      at: string
    }
  | {
      type: 'executor.telemetry.request'
      requestId: string
      at: string
    }
  | {
      type: 'executor.doctor.request'
      requestId: string
      at: string
    }
  | {
      type: 'executor.repo-branches.request'
      requestId: string
      localPath: string
      repoUrl?: string
      preferredBranch?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.commit.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      branchName?: string
      commitMessage: string
      push?: boolean
      stagedOnly?: boolean
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.checkout.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      branchName: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.commit-diff.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      commitSha: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.baseline-snapshot.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.baseline-diff.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      baselineTreeSha: string
      targetCommitSha?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.diff.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      baseBranch: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.working-tree-diff.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.status.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.file-diff.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      path: string
      stage: 'staged' | 'unstaged'
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.change.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      action: 'stage' | 'unstage' | 'discard'
      paths: string[]
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.rebase.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      baseBranch: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.graph.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      baseBranch: string
      limit?: number
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.push.request'
      requestId: string
      worktreePath: string
      repoUrl?: string
      branchName?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.git.pull-request.request'
      requestId: string
      worktreePath: string
      repoUrl: string
      title: string
      body: string
      baseBranch: string
      compareBranch?: string
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
    | {
        type: 'executor.worktree.ensure.request'
        requestId: string
        workspaceId?: string
        ownerUserId?: string
        repoPath?: string
        repoUrl?: string
        preferredBranch?: string
        startPointMode?: ExecutorWorktreeStartPointMode
        branchName: string
      worktreePath: string
      workingDirectoryMode?: WorkingDirectoryMode
      gitIdentity?: TaskRuntimeGitIdentity
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      at: string
    }
    | {
        type: 'executor.worktree.cleanup.request'
        requestId: string
        workspaceId?: string
        ownerUserId?: string
        repoPath?: string
        repoUrl?: string
        worktreePath: string
      workingDirectoryMode?: WorkingDirectoryMode
      branchName?: string
      deleteLocalBranch?: boolean
      deleteRemoteBranch?: boolean
      gitIdentity?: TaskRuntimeGitIdentity
      at: string
    }
  | {
      type: 'executor.agent.prompt.request'
      requestId: string
      agentType: AgentType
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
      attachments?: TaskChatAttachment[]
      executionModel?: string
      agentSettings?: AgentRuntimeSettings
      opencodeConfig?: OpenCodeExecutionConfig
      mcpServers?: McpServerPolicy[]
      runtimeSkillPackages?: ExecutorSkillPackage[]
      runtimeEnv?: Record<string, string>
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      featureFlags?: ExecutorFeatureFlags
      at: string
    }
  | {
      type: 'executor.agent.prompt.cancel'
      requestId: string
      reason?: import('./executor').ExecutorAgentPromptAbortReason
      message?: string
      at: string
    }
  | {
      type: 'executor.directory-browse.request'
      requestId: string
      rootPath: string
      directoryPath?: string
      at: string
    }
  | {
      type: 'executor.file-read.request'
      requestId: string
      rootPath: string
      filePath: string
      at: string
    }
  | {
      type: 'executor.file-write.request'
      requestId: string
      rootPath: string
      filePath: string
      content: string
      at: string
    }
  | {
      type: 'executor.agent.workdir.request'
      requestId: string
      agentId: string
      action: 'summary' | 'ensure' | 'rescan' | 'list' | 'cleanup' | 'delete'
      relativePath?: string
      refresh?: boolean
      workspaceId?: string
      at: string
    }
  | {
      type: 'executor.agent.workdir.download.request'
      requestId: string
      agentId: string
      relativePath: string
      workspaceId?: string
      at: string
    }
  | {
      type: 'executor.agent.workdir.read.request'
      requestId: string
      agentId: string
      relativePath: string
      workspaceId?: string
      at: string
    }
  | {
      type: 'executor.agent-sessions.list.request'
      requestId: string
      at: string
    }
  | {
      type: 'executor.agent-sessions.read.request'
      requestId: string
      source: import('./executor').ExecutorAgentSessionSource
      sessionId: string
      at: string
    }
  | {
      type: 'executor.skills.scan.request'
      requestId: string
      scanMode: import('./executor').ExecutorSkillScanMode
      rootPath?: string
      at: string
    }
  | {
      type: 'executor.terminal.request'
      requestId: string
      command: string
      cwd?: string
      mode?: ExecutorTerminalRequestMode
      timeoutMs?: number
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      at: string
    }
  | {
      type: 'executor.terminal.sessions.list.request'
      requestId: string
      scope?: WorkspaceTerminalSessionScope
      workspaceId?: string
      at: string
    }
  | {
      type: 'executor.http.probe.request'
      requestId: string
      url: string
      timeoutMs?: number
      at: string
    }
  | {
      type: 'executor.desktop-sandbox.request'
      requestId: string
      request: WorkspaceDesktopSandboxRequest
      at: string
    }
  | {
      type: 'executor.remote-code.request'
      requestId: string
      request: WorkspaceRemoteCodeRequest
      at: string
    }
  | {
      type: 'executor.terminal.session.create'
      requestId: string
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      title?: string
      cwd?: string
      cols?: number
      rows?: number
      ownerUserId?: string
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
      at: string
    }
  | {
      type: 'executor.terminal.session.attach'
      requestId: string
      clientId: string
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      at: string
    }
  | {
      type: 'executor.terminal.local-attach-ticket.request'
      requestId: string
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      cwd?: string
      at: string
    }
  | {
      type: 'executor.terminal.session.detach'
      clientId: string
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      at: string
    }
  | {
      type: 'executor.terminal.session.input'
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      input: string
    }
  | {
      type: 'executor.terminal.session.resize'
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      cols: number
      rows: number
    }
  | {
      type: 'executor.terminal.session.close'
      requestId: string
      terminalId: string
      scope: WorkspaceTerminalSessionScope
      workspaceId?: string
      at: string
    }
  | {
      type: 'preview.tunnel.open'
      previewSessionId: string
      workspaceId?: string
      tunnelUrl: string
      tunnelToken: string
      targetUrl: string
      injectNavigationBridge?: boolean
      at: string
    }
  | {
      type: 'preview.tunnel.close'
      previewSessionId: string
      at: string
    }
  | {
      type: 'preview.ingress.register'
      previewSessionId: string
      workspaceId?: string
      publicHost?: string
      targetUrl: string
      additionalTargetUrls?: string[]
      transport?: PreviewIngressTransport
      at: string
    }
  | {
      type: 'preview.ingress.unregister'
      previewSessionId: string
      at: string
    }
  | {
      type: 'executor.codex-oauth.request'
      requestId: string
      userId: string
      operation: CodexOauthOperation
      accountId?: string
      at: string
    }

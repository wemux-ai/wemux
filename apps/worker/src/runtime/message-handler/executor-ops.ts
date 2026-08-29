/**
 * [INPUT]: Control-plane executor operation messages and current Worker runtime configuration.
 * [OUTPUT]: Worker operation responses for Git, files, diagnostics, terminals, and runtime tools.
 * [POS]: Worker message-dispatch boundary for non-task executor operations.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { verifyPatTokenViaApi } from '@shared/git-pat'
import {
  cleanupAgentWorkdirRuntime,
  ensureAgentWorkdir,
  getAgentWorkdirSummary,
  listAgentWorkdirFiles,
  readAgentWorkdirFileContent,
  removeAgentWorkdirFile,
  resolveAgentWorkdirFile,
} from '@shared/agent-workdir'
import type { ControlPlaneToExecutorMessage, ExecutorHttpProbeResult, SshVerificationResult } from '@shared/types'
import { loadWorkerRuntimeConfig } from '../../core/runtime-cloud-url'
import { listLocalAgentSessions, readLocalAgentSession, type AgentSessionSource } from '../../local-api/agent-sessions'
import {
  checkoutLocalTaskBranch,
  applyLocalTaskGitChange,
  commitLocalTaskChanges,
  commitLocalTaskStagedChanges,
  createLocalTaskPullRequest,
  getLocalTaskGitFileDiff,
  getLocalTaskCommitDiff,
  getLocalTaskGitBaselineDiff,
  getLocalTaskGitBaselineSnapshot,
  getLocalTaskGitDiff,
  getLocalTaskGitGraph,
  getLocalTaskGitStatus,
  getLocalTaskGitWorkingTreeDiff,
  pushLocalTaskBranch,
  rebaseLocalTaskBranch,
} from '../git-ops'
import { browseExecutorDirectories, getLocalRepositoryBranchSnapshot, probeLocalRepositoryPath, readExecutorFileContent, writeExecutorFileContent } from '../local-repo-probe'
import { scanLocalSkills } from '../local-skill-scan'
import { desktopSandboxProvider } from '../desktop-sandbox-provider'
import { getWorkerDoctor } from '../doctor'
import { verifyGitSshCredential } from '../git-ssh-verifier'
import { cleanupLocalTaskWorktree, ensureLocalTaskWorktree } from '../local-worktree'
import { remapManagedProjectPath } from '../managed-workspace-path'
import { remoteCodeManager } from '../remote-code-manager'
import { getWorkingDirectoryMode } from './shared'
import type { ControlPlaneMessageHandlerParams } from './types'

const probeExecutorHttpUrl = async (url: string, timeoutMs = 5000): Promise<ExecutorHttpProbeResult> => {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, Math.max(500, timeoutMs))

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    })

    await response.body?.cancel().catch(() => undefined)

    return {
      ok: true,
      reachable: true,
      url,
      statusCode: response.status,
      finalUrl: response.url || url,
      responseTimeMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    }
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : error.message)
      : 'environment probe failed'

    return {
      ok: false,
      reachable: false,
      url,
      error: message,
      responseTimeMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export const handleExecutorOpsMessage = (
  message: ControlPlaneToExecutorMessage,
  params: ControlPlaneMessageHandlerParams,
) => {
  let config = params.getConfig()

  const refreshConfig = () => {
    config = loadWorkerRuntimeConfig()
    params.setConfig(config)
    return config
  }

  if (message.type === 'executor.latency.ping') {
    if (!config.executorId || message.executorId !== config.executorId) {
      return true
    }

    const receivedAt = new Date().toISOString()
    params.send({
      type: 'executor.latency.pong',
      executorId: config.executorId,
      requestId: message.requestId,
      sentAt: message.sentAt,
      receivedAt,
      respondedAt: new Date().toISOString(),
    })
    return true
  }

  if (message.type === 'executor.repo-probe.request') {
    refreshConfig()
    void probeLocalRepositoryPath(message.localPath).then((result) => {
      params.send({
        type: 'executor.repo-probe.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.pat.verify.request') {
    refreshConfig()
    void verifyPatTokenViaApi(message.patToken, message.provider, message.host).then((result) => {
      params.send({
        type: 'executor.git.pat.verify.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.ssh.verify.request') {
    refreshConfig()
    const sendResult = (result: SshVerificationResult) => {
      params.send({
        type: 'executor.git.ssh.verify.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    }
    void verifyGitSshCredential({
      host: message.host,
      privateKey: message.sshPrivateKey,
      repoUrl: message.repoUrl,
      sshUser: message.sshUser,
      workspaceRoot: config.workspaceRoot,
    })
      .then(sendResult)
      .catch(() => {
        sendResult({
          ok: false,
          host: message.host.trim().toLowerCase(),
          sshUser: message.sshUser?.trim() || 'git',
          repoUrl: message.repoUrl?.trim() || undefined,
          message: 'Worker SSH 验证失败，请检查节点运行状态。',
        })
      })
    return true
  }

  if (message.type === 'executor.doctor.request') {
    refreshConfig()
    void getWorkerDoctor().then((doctor) => {
      params.send({
        type: 'executor.doctor.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        doctor,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.directory-browse.request') {
    refreshConfig()
    const rootPath = remapManagedProjectPath(config.workspaceRoot, message.rootPath || config.workspaceRoot) || config.workspaceRoot
    const directoryPath = remapManagedProjectPath(config.workspaceRoot, message.directoryPath)
    void browseExecutorDirectories(rootPath, directoryPath).then((result) => {
      params.send({
        type: 'executor.directory-browse.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.file-read.request') {
    refreshConfig()
    const rootPath = remapManagedProjectPath(config.workspaceRoot, message.rootPath || config.workspaceRoot) || config.workspaceRoot
    const filePath = remapManagedProjectPath(config.workspaceRoot, message.filePath) || message.filePath
    void readExecutorFileContent(rootPath, filePath).then((result) => {
      params.send({
        type: 'executor.file-read.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.file-write.request') {
    refreshConfig()
    const rootPath = remapManagedProjectPath(config.workspaceRoot, message.rootPath || config.workspaceRoot) || config.workspaceRoot
    const filePath = remapManagedProjectPath(config.workspaceRoot, message.filePath) || message.filePath
    void writeExecutorFileContent(rootPath, filePath, message.content).then((result) => {
      params.send({
        type: 'executor.file-write.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.http.probe.request') {
    refreshConfig()
    void probeExecutorHttpUrl(message.url, message.timeoutMs).then((result) => {
      params.send({
        type: 'executor.http.probe.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.agent.workdir.request') {
    refreshConfig()
    const workspaceId = message.workspaceId?.trim() || undefined
    void Promise.resolve().then(() => {
      if (message.action === 'ensure') {
        const result = ensureAgentWorkdir(message.agentId, undefined, workspaceId)
        return { ok: true, workdir: result.summary, files: result.files, message: 'Agent 工作目录已初始化。' }
      }

      if (message.action === 'rescan') {
        const result = listAgentWorkdirFiles(message.agentId, true, undefined, workspaceId)
        return { ok: true, workdir: result.summary, files: result.files, message: 'Agent 工作目录索引已刷新。' }
      }

      if (message.action === 'cleanup') {
        return {
          ok: true,
          workdir: cleanupAgentWorkdirRuntime(message.agentId, undefined, workspaceId),
          files: listAgentWorkdirFiles(message.agentId, false, undefined, workspaceId).files,
          message: '已清理 Agent 系统临时目录。',
        }
      }

      if (message.action === 'delete') {
        const result = removeAgentWorkdirFile(message.agentId, message.relativePath || '', undefined, workspaceId)
        return { ok: true, workdir: result.summary, files: result.files, message: '文件已删除。' }
      }

      if (message.action === 'list') {
        const result = listAgentWorkdirFiles(message.agentId, message.refresh === true, undefined, workspaceId)
        return { ok: true, workdir: result.summary, files: result.files }
      }

      return {
        ok: true,
        workdir: getAgentWorkdirSummary(message.agentId, undefined, workspaceId),
        files: listAgentWorkdirFiles(message.agentId, false, undefined, workspaceId).files,
      }
    }).catch((error) => {
      return {
        ok: false,
        workdir: getAgentWorkdirSummary(message.agentId, undefined, workspaceId),
        files: listAgentWorkdirFiles(message.agentId, false, undefined, workspaceId).files,
        message: error instanceof Error ? error.message : 'Agent 工作目录请求失败。',
      }
    }).then((result) => {
      params.send({
        type: 'executor.agent.workdir.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.agent.workdir.download.request') {
    refreshConfig()
    const workspaceId = message.workspaceId?.trim() || undefined
    void Promise.resolve().then(() => {
      const resolved = resolveAgentWorkdirFile(message.agentId, message.relativePath, undefined, workspaceId)
      return {
        ok: true,
        relativePath: resolved.relativePath,
        filename: basename(resolved.relativePath),
        contentBase64: readFileSync(resolved.absolutePath).toString('base64'),
      }
    }).catch((error) => {
      return {
        ok: false,
        relativePath: message.relativePath,
        message: error instanceof Error ? error.message : 'Agent 工作目录文件下载失败。',
      }
    }).then((result) => {
      params.send({
        type: 'executor.agent.workdir.download.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.agent.workdir.read.request') {
    refreshConfig()
    const workspaceId = message.workspaceId?.trim() || undefined
    void Promise.resolve().then(() => {
      return readAgentWorkdirFileContent(message.agentId, message.relativePath, undefined, workspaceId)
    }).catch((error) => {
      return {
        ok: false,
        relativePath: message.relativePath,
        message: error instanceof Error ? error.message : 'Agent 工作目录文件预览失败。',
      }
    }).then((result) => {
      params.send({
        type: 'executor.agent.workdir.read.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.agent-sessions.list.request') {
    refreshConfig()
    void Promise.resolve().then(() => {
      return listLocalAgentSessions()
    }).catch((error) => {
      return {
        ok: false,
        sessions: [],
        counts: {
          claude: 0,
          opencode: 0,
          codex: 0,
          pi: 0,
        },
        message: error instanceof Error ? error.message : '读取本地 Agent 会话失败。',
      }
    }).then((result) => {
      params.send({
        type: 'executor.agent-sessions.list.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.agent-sessions.read.request') {
    refreshConfig()
    void Promise.resolve().then(() => {
      const session = readLocalAgentSession(message.source as AgentSessionSource, message.sessionId)
      if (!session) {
        return {
          ok: false,
          message: '会话不存在或已不可读。',
        }
      }

      return {
        ok: true,
        session,
      }
    }).catch((error) => {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '读取本地 Agent 会话详情失败。',
      }
    }).then((result) => {
      params.send({
        type: 'executor.agent-sessions.read.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.skills.scan.request') {
    refreshConfig()
    void scanLocalSkills({
      workspaceRoot: config.workspaceRoot,
      scanMode: message.scanMode,
      rootPath: message.rootPath,
    }).then((result) => {
      params.send({
        type: 'executor.skills.scan.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.repo-branches.request') {
    refreshConfig()
    console.log('[worker] [repo-branches] request received', JSON.stringify({
      requestId: message.requestId,
      executorId: config.executorId,
      localPath: message.localPath,
      repoUrl: message.repoUrl,
      preferredBranch: message.preferredBranch,
    }))
    void getLocalRepositoryBranchSnapshot(message.localPath, message.repoUrl, message.preferredBranch, message.gitIdentity, config.workspaceRoot).then((result) => {
      console.log('[worker] [repo-branches] request resolved', JSON.stringify({
        requestId: message.requestId,
        executorId: config.executorId,
        ok: result.ok,
        branchCount: result.branches.length,
        defaultBranch: result.defaultBranch,
        message: result.message,
      }))
      params.send({
        type: 'executor.repo-branches.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.checkout.request') {
    refreshConfig()
    void checkoutLocalTaskBranch({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      branchName: message.branchName,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.checkout.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.commit.request') {
    refreshConfig()
    const commit = message.stagedOnly ? commitLocalTaskStagedChanges : commitLocalTaskChanges
    void commit({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      branchName: message.branchName,
      commitMessage: message.commitMessage,
      push: message.push,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.commit.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.status.request') {
    refreshConfig()
    void getLocalTaskGitStatus({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.status.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.file-diff.request') {
    refreshConfig()
    void getLocalTaskGitFileDiff({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      path: message.path,
      stage: message.stage,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.file-diff.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.change.request') {
    refreshConfig()
    void applyLocalTaskGitChange({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      action: message.action,
      paths: message.paths,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.change.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.diff.request') {
    refreshConfig()
    void getLocalTaskGitDiff({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      baseBranch: message.baseBranch,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.diff.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.working-tree-diff.request') {
    refreshConfig()
    void getLocalTaskGitWorkingTreeDiff({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.working-tree-diff.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.baseline-snapshot.request') {
    refreshConfig()
    void getLocalTaskGitBaselineSnapshot({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.baseline-snapshot.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.baseline-diff.request') {
    refreshConfig()
    void getLocalTaskGitBaselineDiff({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      baselineTreeSha: message.baselineTreeSha,
      targetCommitSha: message.targetCommitSha,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.baseline-diff.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.commit-diff.request') {
    refreshConfig()
    void getLocalTaskCommitDiff({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      commitSha: message.commitSha,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.commit-diff.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.rebase.request') {
    refreshConfig()
    void rebaseLocalTaskBranch({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      baseBranch: message.baseBranch,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.rebase.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.graph.request') {
    refreshConfig()
    void getLocalTaskGitGraph({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      baseBranch: message.baseBranch,
      limit: message.limit,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.graph.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.push.request') {
    refreshConfig()
    void pushLocalTaskBranch({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      branchName: message.branchName,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.push.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.git.pull-request.request') {
    refreshConfig()
    void createLocalTaskPullRequest({
      worktreePath: message.worktreePath,
      repoUrl: message.repoUrl,
      title: message.title,
      body: message.body,
      baseBranch: message.baseBranch,
      compareBranch: message.compareBranch,
      gitIdentity: message.gitIdentity,
    }).then((result) => {
      params.send({
        type: 'executor.git.pull-request.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.worktree.ensure.request') {
    refreshConfig()
    void ensureLocalTaskWorktree({
      workspaceRoot: config.workspaceRoot,
      workspaceId: message.workspaceId,
      ownerUserId: message.ownerUserId,
      repoPath: message.repoPath,
      repoUrl: message.repoUrl,
      preferredBranch: message.preferredBranch,
      startPointMode: message.startPointMode,
      branchName: message.branchName,
      worktreePath: message.worktreePath,
      gitIdentity: message.gitIdentity,
      workingDirectoryMode: getWorkingDirectoryMode(message),
      runtimeEnvironment: message.runtimeEnvironment,
      onOperationEvent: (event) => {
        params.send({
          type: 'executor.workspace.operation.event',
          executorId: config.executorId!,
          requestId: message.requestId,
          event,
          at: new Date().toISOString(),
        })
      },
    }).then((result) => {
      params.send({
        type: 'executor.worktree.ensure.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.worktree.cleanup.request') {
    refreshConfig()
    void cleanupLocalTaskWorktree({
      workspaceRoot: config.workspaceRoot,
      workspaceId: message.workspaceId,
      ownerUserId: message.ownerUserId,
      repoPath: message.repoPath,
      repoUrl: message.repoUrl,
      worktreePath: message.worktreePath,
      workingDirectoryMode: getWorkingDirectoryMode(message),
      branchName: message.branchName,
      deleteLocalBranch: message.deleteLocalBranch,
      deleteRemoteBranch: message.deleteRemoteBranch,
      gitIdentity: message.gitIdentity,
      onOperationEvent: (event) => {
        params.send({
          type: 'executor.workspace.operation.event',
          executorId: config.executorId!,
          requestId: message.requestId,
          event,
          at: new Date().toISOString(),
        })
      },
    }).then((result) => {
      params.send({
        type: 'executor.worktree.cleanup.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.desktop-sandbox.request') {
    refreshConfig()
    void desktopSandboxProvider.execute(message.request).then((result) => {
      params.send({
        type: 'executor.desktop-sandbox.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  if (message.type === 'executor.remote-code.request') {
    refreshConfig()
    void remoteCodeManager.execute(message.request).then((result) => {
      params.send({
        type: 'executor.remote-code.response',
        executorId: config.executorId!,
        requestId: message.requestId,
        result,
        at: new Date().toISOString(),
      })
    })
    return true
  }

  return false
}

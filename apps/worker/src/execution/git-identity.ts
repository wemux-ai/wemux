/**
 * [INPUT]: Task-scoped Git identity, repository URL, worktree path, and Worker node storage.
 * [OUTPUT]: Git commit identity plus isolated PAT or SSH process authentication context.
 * [POS]: Worker execution boundary that prepares credentials for real task Git commands.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { TaskRuntimeGitIdentity } from '@shared/types'
import { createGitAuthContext } from '@shared/git-auth'
import { resolveWemuxAutomatedCommitAuthor } from '@shared/git-commit-message'
import { getWorkerNodeDir } from '../core/config'

const runGit = (worktreePath: string, args: string[], env?: NodeJS.ProcessEnv) => {
  const result = spawnSync('git', args, {
    cwd: worktreePath,
    env,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git command failed').trim())
  }
}

const tryRunGit = (worktreePath: string, args: string[], env?: NodeJS.ProcessEnv) => {
  try {
    runGit(worktreePath, args, env)
  } catch {
    return
  }
}

export const resolveTaskGitCommitIdentityEnv = (identity: TaskRuntimeGitIdentity): Record<string, string> => {
  const commitAuthor = resolveWemuxAutomatedCommitAuthor(identity)
  const name = commitAuthor?.name
  const email = commitAuthor?.email
  if (!name || !email) {
    return {}
  }

  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  }
}

export const mergeTaskGitCommitIdentityEnv = (
  env: NodeJS.ProcessEnv | undefined,
  identity: TaskRuntimeGitIdentity,
): NodeJS.ProcessEnv => ({
  ...(env ?? {}),
  ...resolveTaskGitCommitIdentityEnv(identity),
})

export type TaskGitAuthContext = {
  env: NodeJS.ProcessEnv
  tempDir: string
  configureRepo: (worktreePath: string) => void
  cleanup: (worktreePath?: string) => void
}

export const createTaskGitAuthContext = (params: {
  taskId: string
  identity: TaskRuntimeGitIdentity
  repoUrl?: string
}): TaskGitAuthContext => {
  const context = createGitAuthContext({
    taskId: params.taskId,
    identity: params.identity,
    repoUrl: params.repoUrl,
    knownHostsFile: path.join(getWorkerNodeDir(), 'cache', 'git', 'known_hosts'),
  })
  Object.assign(context.env, resolveTaskGitCommitIdentityEnv(params.identity))

  return {
    env: context.env,
    tempDir: context.tempDir,
    configureRepo(worktreePath: string) {
      if (params.identity.name && params.identity.email) {
        const commitAuthor = resolveWemuxAutomatedCommitAuthor(params.identity)
        runGit(worktreePath, ['config', '--local', 'user.name', commitAuthor?.name ?? params.identity.name], context.env)
        runGit(worktreePath, ['config', '--local', 'user.email', commitAuthor?.email ?? params.identity.email], context.env)
      }

      if (context.env.GIT_SSH_COMMAND) {
        runGit(worktreePath, ['config', '--local', 'core.sshCommand', context.env.GIT_SSH_COMMAND], context.env)
      }

      if (context.env.GIT_ASKPASS) {
        runGit(worktreePath, ['config', '--local', 'core.askPass', context.env.GIT_ASKPASS], context.env)
      }
    },
    cleanup(worktreePath?: string) {
      if (worktreePath) {
        if (params.identity.name && params.identity.email) {
          tryRunGit(worktreePath, ['config', '--local', '--unset-all', 'user.name'], context.env)
          tryRunGit(worktreePath, ['config', '--local', '--unset-all', 'user.email'], context.env)
        }

        tryRunGit(worktreePath, ['config', '--local', '--unset-all', 'core.askPass'], context.env)
        tryRunGit(worktreePath, ['config', '--local', '--unset-all', 'core.sshCommand'], context.env)
      }

      context.cleanup()
    },
  }
}

export const applyTaskGitIdentity = (params: {
  taskId: string
  worktreePath: string
  identity: TaskRuntimeGitIdentity
  repoUrl?: string
}) => {
  const context = createTaskGitAuthContext({
    taskId: params.taskId,
    identity: params.identity,
    repoUrl: params.repoUrl,
  })

  context.configureRepo(params.worktreePath)

  return {
    tempDir: context.tempDir,
    env: context.env,
    cleanup() {
      context.cleanup(params.worktreePath)
    },
  }
}

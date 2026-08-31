import { existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { buildWemuxAgentCommitMessage, resolveWemuxAutomatedCommitAuthor } from '@shared/git-commit-message'
import { createGitAuthContext, getSimpleGitOptionsForEnv } from '@shared/git-auth'
import type { WorkspaceTaskExecutionView } from '@shared/task-workspace'
import type { Project, TaskRuntimeGitIdentity } from '@shared/types'
import { resolveProjectExecutionPath } from '../../cluster/project-workspace'
import { normalizeFilesystemPath } from '../../lib/filesystem-paths'

const DEFAULT_BRANCH_FALLBACK = 'main'

const createGitClient = (baseDir: string, env?: NodeJS.ProcessEnv) => {
  return simpleGit({
    baseDir,
    ...getSimpleGitOptionsForEnv(env),
  }).env(env ?? {})
}

const normalizeBranchName = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed || trimmed === 'HEAD' || trimmed.endsWith('/HEAD')) {
    return ''
  }

  const withoutRemotePrefix = trimmed.startsWith('remotes/') ? trimmed.slice('remotes/'.length) : trimmed
  return withoutRemotePrefix.startsWith('origin/') ? withoutRemotePrefix.slice('origin/'.length) : withoutRemotePrefix
}

const resolveRepoBranchSnapshot = async (repoPath: string, preferredBranch?: string) => {
  const git = simpleGit(repoPath)
  const [allBranches, localBranches] = await Promise.all([
    git.branch(['-a']),
    git.branchLocal(),
  ])

  let remoteHeadBranch = ''
  try {
    remoteHeadBranch = normalizeBranchName(await git.raw(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']))
  } catch {
    remoteHeadBranch = ''
  }

  const branches = Array.from(
    new Set(
      allBranches.all
        .map(normalizeBranchName)
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

  const normalizedPreferredBranch = normalizeBranchName(preferredBranch ?? '')
  const normalizedCurrentBranch = normalizeBranchName(localBranches.current)
  const defaultBranch = [remoteHeadBranch, normalizedPreferredBranch, normalizedCurrentBranch, branches[0], DEFAULT_BRANCH_FALLBACK]
    .find((branch) => branch && (branch === DEFAULT_BRANCH_FALLBACK || branches.includes(branch))) ?? DEFAULT_BRANCH_FALLBACK

  return {
    branches,
    defaultBranch,
    currentBranch: normalizedCurrentBranch,
  }
}

const hasGitRepo = async (repoPath: string) => {
  if (!existsSync(repoPath)) return false
  const git = simpleGit(repoPath)
  return git.checkIsRepo()
}

const getRemoteBranchRef = (branchName: string) => `origin/${branchName}`

const hasRemoteBranch = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  const branches = await git.branch(['-r'])
  return branches.all.includes(getRemoteBranchRef(branchName))
}

const syncTaskBranchBeforePush = async (git: ReturnType<typeof simpleGit>, branchName: string) => {
  await git.fetch(['--all', '--prune'])
  if (await hasRemoteBranch(git, branchName)) {
    await git.rebase([getRemoteBranchRef(branchName)])
  }
}

export const cloneRepository = async (gitUrl: string, localPath: string): Promise<{ ok: boolean; message: string }> => {
  const resolvedLocalPath = normalizeFilesystemPath(localPath)

  if (existsSync(resolvedLocalPath)) {
    return { ok: false, message: `目录 ${resolvedLocalPath} 已存在，请选择其他路径。` }
  }

  const git = simpleGit()
  try {
    mkdirSync(path.dirname(resolvedLocalPath), { recursive: true })
    await git.clone(gitUrl, resolvedLocalPath)
    return { ok: true, message: `已克隆仓库到 ${resolvedLocalPath}` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '克隆失败。' }
  }
}

export const checkLocalPath = async (localPath: string): Promise<{ ok: boolean; name?: string; gitUrl?: string; message: string }> => {
  const resolvedLocalPath = normalizeFilesystemPath(localPath)

  if (!existsSync(resolvedLocalPath)) {
    return { ok: false, message: '目录不存在' }
  }

  const stat = await import('node:fs/promises')
  const stats = await stat.stat(resolvedLocalPath)
  if (!stats.isDirectory()) {
    return { ok: false, message: '请选择目录而非文件' }
  }

  const name = path.basename(resolvedLocalPath)

  try {
    const git = simpleGit(resolvedLocalPath)
    const isRepo = await git.checkIsRepo()
    if (isRepo) {
      const remotes = await git.getRemotes(true)
      const origin = remotes.find(r => r.name === 'origin')
      const snapshot = await resolveRepoBranchSnapshot(resolvedLocalPath)
      return {
        ok: true,
        name,
        gitUrl: origin?.refs.fetch || '',
        message: snapshot.branches.length > 0 ? `已检测到 Git 仓库，共 ${snapshot.branches.length} 个分支` : '已检测到 Git 仓库',
      }
    }
    return { ok: true, name, message: '目录无 Git 仓库' }
  } catch {
    return { ok: true, name, message: '无法读取 Git 信息' }
  }
}

export const pickFolder = async (): Promise<{ ok: boolean; path?: string; name?: string; gitUrl?: string; message: string }> => {
  const { execSync } = await import('node:child_process')
  
  try {
    const script = `
      tell application "System Events"
        activate
        set folderPath to POSIX path of (choose folder with prompt "选择项目目录")
      end tell
      return folderPath
    `
    const result = execSync(`osascript -e '${script}'`, { encoding: 'utf8' }).trim()
    
    if (!result || result === '') {
      return { ok: false, message: '未选择目录' }
    }

    const localPath = result
    const name = path.basename(localPath)

    try {
      const git = simpleGit(localPath)
      const isRepo = await git.checkIsRepo()
      if (isRepo) {
        const remotes = await git.getRemotes(true)
        const origin = remotes.find(r => r.name === 'origin')
        const snapshot = await resolveRepoBranchSnapshot(localPath)
        return {
          ok: true,
          path: localPath,
          name,
          gitUrl: origin?.refs.fetch || '',
          message: snapshot.branches.length > 0 ? `已选择目录，检测到 ${snapshot.branches.length} 个分支` : '已选择目录',
        }
      }
      return { ok: true, path: localPath, name, message: '已选择目录（无 Git 仓库）' }
    } catch {
      return { ok: true, path: localPath, name, message: '已选择目录' }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '选择目录失败' }
  }
}

export const getRepositoryBranchSnapshot = async (repoPath: string, preferredBranch?: string): Promise<{ ok: boolean; branches: string[]; defaultBranch: string; message?: string }> => {
  if (!(await hasGitRepo(repoPath))) {
    return {
      ok: false,
      branches: [],
      defaultBranch: normalizeBranchName(preferredBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
      message: `项目目录 ${repoPath} 不是有效 Git 仓库，无法读取分支列表。`,
    }
  }

  try {
    const snapshot = await resolveRepoBranchSnapshot(repoPath, preferredBranch)
    return {
      ok: true,
      branches: snapshot.branches,
      defaultBranch: snapshot.defaultBranch,
    }
  } catch (error) {
    return {
      ok: false,
      branches: [],
      defaultBranch: normalizeBranchName(preferredBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
      message: error instanceof Error ? error.message : '读取分支列表失败。',
    }
  }
}

export const listProjectBranches = async (project: Project): Promise<{ ok: boolean; branches: string[]; defaultBranch: string; message?: string }> => {
  try {
    const repoPath = await resolveProjectExecutionPath(project)
    return await getRepositoryBranchSnapshot(repoPath, project.defaultBranch)
  } catch (error) {
    return {
      ok: false,
      branches: [],
      defaultBranch: normalizeBranchName(project.defaultBranch ?? '') || DEFAULT_BRANCH_FALLBACK,
      message: error instanceof Error ? error.message : '读取分支列表失败。',
    }
  }
}

export const createWorktree = async (project: Project, task: WorkspaceTaskExecutionView, worktreePath: string) => {
  const repoPath = await resolveProjectExecutionPath(project)
  const requestedStartPoint = normalizeBranchName(task.baseBranch?.trim() || task.baseBranchHint?.trim() || project.defaultBranch || DEFAULT_BRANCH_FALLBACK)
  console.log('[worktree-debug] createWorktree 开始', {
    projectLocalPath: repoPath,
    taskId: task.id,
    baseBranch: requestedStartPoint,
    branchName: task.branchName,
    worktreePath,
  })

  const isRepo = await hasGitRepo(repoPath)
  console.log('[worktree-debug] hasGitRepo result:', isRepo, 'path:', repoPath)

  if (!isRepo) {
    return {
      ok: false,
      message: `项目目录 ${repoPath} 不是有效 Git 仓库，无法创建真实 worktree。`,
    }
  }

  console.log('[worktree-debug] 准备创建 worktree 目录:', path.dirname(worktreePath))
  mkdirSync(path.dirname(worktreePath), { recursive: true })
  const git = simpleGit(repoPath)

  try {
    const snapshot = await getRepositoryBranchSnapshot(repoPath, project.defaultBranch)
    const startPoint = snapshot.ok && snapshot.branches.length > 0 && !snapshot.branches.includes(requestedStartPoint)
      ? snapshot.defaultBranch
      : requestedStartPoint

    if (!snapshot.ok || !snapshot.branches.includes(startPoint)) {
      return {
        ok: false,
        message: snapshot.branches.length > 0
          ? `起始分支 ${startPoint} 不存在。当前仓库分支：${snapshot.branches.join(', ')}`
          : snapshot.message || `起始分支 ${startPoint} 不存在。`,
      }
    }

    console.log('[worktree-debug] 执行 git worktree add:', '-b', task.branchName, worktreePath, startPoint)
    await git.raw(['worktree', 'add', '-b', task.branchName, worktreePath, startPoint])
    return {
      ok: true,
      message: `已基于 ${startPoint} 创建 worktree ${worktreePath} 并切出分支 ${task.branchName}。`,
    }
  } catch (error) {
    console.log('[worktree-debug] 创建 worktree 失败:', error)
    return {
      ok: false,
      message: error instanceof Error ? error.message : '准备隔离目录失败。',
    }
  }
}

export const cleanupWorktree = async (project: Project, _task: WorkspaceTaskExecutionView, worktreePath: string) => {
  const repoPath = await resolveProjectExecutionPath(project)

  if (!(await hasGitRepo(repoPath))) {
    return {
      ok: false,
      message: `项目目录 ${repoPath} 不是有效 Git 仓库，无法清理隔离目录。`,
    }
  }

  const git = simpleGit(repoPath)
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath])
    return {
      ok: true,
      message: `已清理隔离目录 ${worktreePath}。`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '清理隔离目录失败。',
    }
  }
}

const buildCommitMessageFromReply = (
  reply: string,
  task: { id: string },
  identity?: TaskRuntimeGitIdentity,
) => (
  buildWemuxAgentCommitMessage({
    reply,
    fallback: `wemux: ${task.id}`,
    agentIdentity: {
      name: identity?.agentCoAuthorName,
      email: identity?.agentCoAuthorEmail,
    },
    userIdentity: {
      name: identity?.name,
      email: identity?.email,
    },
  })
)

export const finalizeTaskWorktreeGit = async (params: {
  project: Project
  task: WorkspaceTaskExecutionView
  worktreePath: string
  identity?: TaskRuntimeGitIdentity
  commitMessage?: string
}) => {
  if (!params.identity?.name || !params.identity.email) {
    throw new Error('当前任务缺少 Git 用户名或邮箱，请先在设置页完成 Git 授权配置。')
  }

  const authContext = createGitAuthContext({
    taskId: params.task.worktreeId,
    identity: params.identity,
    repoUrl: params.project.gitUrl,
  })

  try {
    const git = createGitClient(params.worktreePath, authContext.env)
    const status = await git.status()
    const changedFiles = Array.from(new Set(status.files.map((file) => file.path))).sort()

    if (changedFiles.length === 0) {
      return {
        changedFiles,
        commitShas: undefined,
        remoteBranchName: undefined,
        pushMessage: '没有文件改动，跳过提交与推送。',
      }
    }

    const commitAuthor = resolveWemuxAutomatedCommitAuthor(params.identity) ?? params.identity
    await git.addConfig('user.name', commitAuthor.name ?? params.identity.name, false, 'local')
    await git.addConfig('user.email', commitAuthor.email ?? params.identity.email, false, 'local')
    if (authContext.env.GIT_SSH_COMMAND) {
      await git.addConfig('core.sshCommand', authContext.env.GIT_SSH_COMMAND, false, 'local')
    }
    if (authContext.env.GIT_ASKPASS) {
      await git.addConfig('core.askPass', authContext.env.GIT_ASKPASS, false, 'local')
    }

    await git.add(['--all'])
    await git.commit(buildCommitMessageFromReply(params.commitMessage ?? '', params.task, params.identity))
    const commitSha = (await git.revparse(['HEAD'])).trim()

    let remoteBranchName: string | undefined
    let pushMessage = '已创建本地提交。'
    const projectVersionControl = params.project.versionControl ?? (params.project.gitUrl.trim() ? 'git-remote' : 'none')
    if (projectVersionControl === 'git-remote' && params.identity.credentialToken) {
      await syncTaskBranchBeforePush(git, params.task.branchName)
      await git.push(['-u', 'origin', params.task.branchName])
      remoteBranchName = params.task.branchName
      pushMessage = `已推送远端分支 ${params.task.branchName}。`
    } else if (projectVersionControl === 'git-local') {
      pushMessage = '本地 Git 项目已创建本地提交，未尝试推送远端。'
    } else {
      pushMessage = '缺少 task 级临时凭证，已创建本地提交但未推送远端。'
    }

    return {
      changedFiles,
      commitShas: commitSha ? [commitSha] : undefined,
      remoteBranchName,
      pushMessage,
    }
  } finally {
    authContext.cleanup()
  }
}

export const openInVSCode = async (project: Project, _task: WorkspaceTaskExecutionView | { worktreeStatus?: 'created' | 'planned' | 'cleaned' }, worktreePath: string): Promise<{ ok: boolean; message: string }> => {
  const repoPath = await resolveProjectExecutionPath(project)
  const targetPath = existsSync(worktreePath) ? worktreePath : repoPath

  if (!existsSync(targetPath)) {
    return {
      ok: false,
      message: `目录不存在，无法打开 VS Code：${targetPath}`,
    }
  }

  try {
    const child = spawn('code', ['.'], {
      cwd: targetPath,
      detached: true,
      stdio: 'ignore',
    })

    child.unref()

    return {
      ok: true,
      message: `已通过 VS Code 打开 ${targetPath}`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '打开 VS Code 失败。',
    }
  }
}

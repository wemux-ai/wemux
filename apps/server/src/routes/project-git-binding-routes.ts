/**
 * [INPUT]: Authenticated project bindings, repository URLs, user Git credentials, and online workers.
 * [OUTPUT]: Host-compatible project identity bindings with real SSH repository-access verification.
 * [POS]: Project-level control-plane boundary between stored identities and executable Git access.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { isSshGitRemoteUrl, resolveGitRemoteHost } from '@shared/git-auth'
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { getProjectAssignees } from '../repositories/auth'
import { listVisibleOnlineExecutors } from '../control-plane/scheduler'
import { executorWsService } from '../control-plane/executor-ws-service'
import {
  getGitCredentialById,
  listGitCredentialSummaries,
  normalizeGitCredentialHost,
} from '../services/git-credential-store'
import {
  deleteProjectGitCredentialBinding,
  getProjectGitCredentialBinding,
  listProjectGitCredentialBindings,
  saveProjectGitCredentialBinding,
  saveProjectGitHubAppInstallationBinding,
} from '../services/project-git-binding-store'
import { getGitHubAppInstallationById, getGitHubAppInstallationForUser, isGitHubAppInstallationAccessibleToUser } from '../services/github-app-installation-store'
import { loadState } from '../storage/app-state-store'
import { getAuthorizedProject, getUserIdFromHeader, jsonError } from './shared'

const bindingPayloadSchema = z.object({
  credentialId: z.string().trim().optional(),
  githubInstallationId: z.coerce.number().int().positive().optional(),
  githubRepositoryId: z.coerce.number().int().positive().optional(),
  githubRepositoryName: z.string().trim().optional(),
}).superRefine((value, ctx) => {
  if (value.credentialId?.trim()) {
    return
  }

  if (value.githubInstallationId) {
    return
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: '请选择 Git 身份或 GitHub App installation。',
    path: ['credentialId'],
  })
})

const isCredentialCompatibleWithRepo = (credential: { host: string }, repoUrl?: string) => {
  const repoHost = resolveGitRemoteHost(repoUrl)
  if (!repoHost) {
    return true
  }

  return normalizeGitCredentialHost(credential.host) === normalizeGitCredentialHost(repoHost)
}

const buildBindingPayload = async (projectId: string, userId: string) => {
  const [binding, credentials, projectBindings] = await Promise.all([
    getProjectGitCredentialBinding(projectId, userId),
    listGitCredentialSummaries(userId),
    listProjectGitCredentialBindings(projectId),
  ])
  const credential = binding?.credentialId
    ? credentials.find((item) => item.id === binding.credentialId) ?? null
    : null
  const boundUserIds = new Set(projectBindings.map((item) => item.userId))

  return {
    binding,
    credential,
    credentials,
    members: getProjectAssignees(projectId).map((member) => ({
      id: member.id,
      email: member.email,
      name: member.name,
      avatarUrl: member.avatarUrl,
      hasBinding: boundUserIds.has(member.id),
    })),
  }
}

export const registerProjectGitBindingRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/projects/:id/git-credential-binding', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(loadState(), userId, projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    return c.json(await buildBindingPayload(projectId, userId))
  })

  app.put('/api/projects/:id/git-credential-binding', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(loadState(), userId, projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    const payload = bindingPayloadSchema.parse(await c.req.json())
    let successMessage = '项目 Git 身份绑定已更新。'

    if (payload.credentialId?.trim()) {
      const credential = await getGitCredentialById(userId, payload.credentialId)
      if (!credential) {
        return c.json({ message: 'Git 身份不存在，或不属于当前用户。' }, 404)
      }
      if (!isCredentialCompatibleWithRepo(credential, projectResult.project.gitUrl)) {
        return c.json({ message: '所选 Git 身份与当前项目仓库 Host 不匹配，请选择同一 Host 的凭证。' }, 400)
      }
      if (credential.authMode === 'ssh') {
        const repoUrl = projectResult.project.gitUrl?.trim()
        if (!repoUrl || !isSshGitRemoteUrl(repoUrl)) {
          return c.json({ message: 'SSH 身份只能绑定 SSH 仓库地址，请先将项目远端地址改为 SSH URL。' }, 400)
        }
        if (!credential.activatedAt || !credential.sshPrivateKey) {
          return c.json({ message: '请先在设置页验证该 SSH 身份，再绑定项目。' }, 409)
        }

        const executors = listVisibleOnlineExecutors(userId)
        const preferredExecutorId = projectResult.project.preferredExecutorId?.trim()
        const executor = preferredExecutorId
          ? executors.find((item) => item.executorId === preferredExecutorId)
          : executors.find((item) => item.ownerUserId === userId) ?? executors[0]
        if (!executor) {
          return c.json({
            message: preferredExecutorId
              ? '项目指定的 Worker 当前不在线，无法在实际执行节点验证 SSH 仓库访问权限。'
              : '当前没有在线 Worker，无法验证 SSH 仓库访问权限。',
          }, 503)
        }

        try {
          const verification = await executorWsService.requestSshVerification(executor.executorId, {
            host: credential.host,
            sshPrivateKey: credential.sshPrivateKey,
            repoUrl,
            sshUser: 'git',
          })
          if (!verification.ok) {
            return c.json({ message: `${verification.message}（由 Worker ${executor.name} 校验）` }, 400)
          }
          successMessage = `项目 Git 身份已绑定，SSH 仓库读取权限验证通过（Worker ${executor.name}）。`
        } catch (error) {
          return c.json({
            message: `SSH 仓库验证失败：${error instanceof Error ? error.message : '未知错误'}`,
          }, 503)
        }
      }

      await saveProjectGitCredentialBinding({
        projectId,
        userId,
        credentialId: credential.id,
      })
    } else if (payload.githubInstallationId) {
      const linkedInstallation = await getGitHubAppInstallationForUser(userId, payload.githubInstallationId)
      const installation = linkedInstallation ?? await getGitHubAppInstallationById(payload.githubInstallationId)
      if (!installation) {
        return c.json({ message: 'GitHub App installation 不存在，或不属于当前用户。' }, 404)
      }
      if (!linkedInstallation && !(await isGitHubAppInstallationAccessibleToUser(userId, payload.githubInstallationId))) {
        return c.json({ message: 'GitHub App installation 不存在，或不属于当前用户。' }, 404)
      }
      if (!isCredentialCompatibleWithRepo({ host: installation.providerHost }, projectResult.project.gitUrl)) {
        return c.json({ message: '所选 GitHub App installation 与当前项目仓库 Host 不匹配。' }, 400)
      }

      await saveProjectGitHubAppInstallationBinding({
        projectId,
        userId,
        githubInstallationId: installation.installationId,
        githubRepositoryId: payload.githubRepositoryId,
        githubRepositoryName: payload.githubRepositoryName,
        githubAccountLogin: installation.accountLogin,
        githubAccountType: installation.accountType,
        providerHost: installation.providerHost,
      })
    } else {
      return c.json({ message: '请选择 Git 身份或 GitHub App installation。' }, 400)
    }

    return c.json({
      ok: true,
      ...(await buildBindingPayload(projectId, userId)),
      message: successMessage,
    })
  })

  app.delete('/api/projects/:id/git-credential-binding', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(loadState(), userId, projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    await deleteProjectGitCredentialBinding(projectId, userId)
    return c.json({
      ok: true,
      ...(await buildBindingPayload(projectId, userId)),
      message: '项目 Git 身份绑定已取消。',
    })
  })
}

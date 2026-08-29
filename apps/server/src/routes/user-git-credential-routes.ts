/**
 * [INPUT]: Authenticated Git credential HTTP payloads and online worker verification capacity.
 * [OUTPUT]: Redacted credential summaries plus real PAT or SSH verification results.
 * [POS]: User-facing control-plane route boundary for the Git identity lifecycle.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { GitProvider, PatVerificationResult } from '@shared/types'
import { listVisibleOnlineExecutors } from '../control-plane/scheduler'
import { executorWsService } from '../control-plane/executor-ws-service'
import { generateSshKeyPair } from '../services/git-ssh-key-manager'
import { resolvePatVerificationHost, verifyPatToken } from '../services/git-pat-verifier'
import {
  activateSshCredentialAfterVerification,
  createGitCredential,
  deleteGitCredential,
  getGitCredentialById,
  listGitCredentialSummaries,
  setDefaultGitCredential,
  updateGitCredential,
} from '../services/git-credential-store'
import { getUserIdFromHeader } from './shared'

const providerSchema = z.enum(['github', 'gitlab', 'generic'])
const authModeSchema = z.enum(['pat', 'ssh'])

const baseCredentialSchema = z.object({
  label: z.string().trim().min(1, '身份名称不能为空。'),
  provider: providerSchema,
  host: z.string().trim().min(1, 'Host 不能为空。'),
  authMode: authModeSchema,
  name: z.string().trim().min(1, 'Git 用户名不能为空。'),
  email: z.string().trim().email('Git 邮箱格式不正确。'),
  isDefault: z.boolean().optional(),
})

const patCredentialSchema = baseCredentialSchema.extend({
  authMode: z.literal('pat'),
  patToken: z.string().trim().min(8, 'PAT 长度至少 8 位。'),
})

const patVerificationSchema = z.object({
  provider: providerSchema,
  host: z.string().trim().min(1, 'Host 不能为空。'),
  patToken: z.string().trim().min(8, 'PAT 长度至少 8 位。'),
})

const sshGenerateSchema = baseCredentialSchema.extend({
  authMode: z.literal('ssh'),
})

const updateCredentialSchema = z.object({
  label: z.string().trim().min(1).optional(),
  provider: providerSchema.optional(),
  host: z.string().trim().min(1).optional(),
  authMode: authModeSchema.optional(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  patToken: z.string().trim().min(8).optional(),
  isDefault: z.boolean().optional(),
})

const selectGitVerificationExecutor = (userId: string) => {
  const executors = listVisibleOnlineExecutors(userId)
  return executors.find((item) => item.ownerUserId === userId) ?? executors[0] ?? null
}

const appendWorkerVerificationMessage = (message: string, executorName: string) => `${message}（由 Worker ${executorName} 校验）`

const verifySshCredential: MiddlewareHandler = async (c) => {
  const userId = getUserIdFromHeader(c)!
  const credentialId = c.req.param('credentialId')!
  const credential = await getGitCredentialById(userId, credentialId)
  if (!credential || credential.authMode !== 'ssh') {
    return c.json({ message: 'SSH 凭证不存在。' }, 404)
  }
  if (!credential.sshPrivateKey) {
    return c.json({ message: 'SSH 私钥不存在，请删除后重新生成该身份。' }, 409)
  }

  const executor = selectGitVerificationExecutor(userId)
  if (!executor) {
    return c.json({ message: '当前没有在线 Worker，无法验证 SSH 身份。' }, 503)
  }

  try {
    const result = await executorWsService.requestSshVerification(executor.executorId, {
      host: credential.host,
      sshPrivateKey: credential.sshPrivateKey,
      sshUser: 'git',
    })
    if (!result.ok) {
      return c.json({
        ...result,
        message: appendWorkerVerificationMessage(result.message, executor.name),
      }, 400)
    }

    const activatedCredential = await activateSshCredentialAfterVerification({
      userId,
      credentialId,
      expectedUpdatedAt: credential.updatedAt,
    })
    if (!activatedCredential) {
      return c.json({ message: 'SSH 身份在验证期间已发生变化，请重新验证。' }, 409)
    }

    return c.json({
      ...result,
      ok: true,
      credentials: await listGitCredentialSummaries(userId),
      message: appendWorkerVerificationMessage('SSH 身份验证通过。', executor.name),
    })
  } catch (error) {
    return c.json({
      message: `SSH 身份验证失败：${error instanceof Error ? error.message : '未知错误'}`,
    }, 503)
  }
}

const verifyPatTokenViaWorker = async (params: {
  fallbackMessage: string
  host: string
  patToken: string
  provider: Extract<GitProvider, 'github' | 'gitlab'>
  userId: string
}): Promise<PatVerificationResult> => {
  const executor = selectGitVerificationExecutor(params.userId)
  if (!executor) {
    return {
      ok: false,
      provider: params.provider,
      message: `${params.fallbackMessage} 当前没有在线 Worker 可代为校验。`,
    }
  }

  try {
    const result = await executorWsService.requestPatVerification(
      executor.executorId,
      params.provider,
      params.host,
      params.patToken,
    )

    return {
      ...result,
      message: appendWorkerVerificationMessage(result.message, executor.name),
    }
  } catch (error) {
    return {
      ok: false,
      provider: params.provider,
      message: `${params.fallbackMessage} Worker ${executor.name} 校验失败：${error instanceof Error ? error.message : '未知错误'}。`,
    }
  }
}

export const registerUserGitCredentialRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/user/git-credentials', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    return c.json({ credentials: await listGitCredentialSummaries(userId) })
  })

  app.post('/api/user/git-credentials', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = patCredentialSchema.parse(await c.req.json())
    const credential = await createGitCredential({
      userId,
      label: payload.label,
      provider: payload.provider,
      host: payload.host,
      authMode: 'pat',
      name: payload.name,
      email: payload.email,
      patToken: payload.patToken,
      isDefault: payload.isDefault,
      activatedAt: new Date().toISOString(),
    })
    const credentials = await listGitCredentialSummaries(userId)

    return c.json({
      ok: true,
      credential: credentials.find((item) => item.id === credential.id) ?? null,
      credentials,
      message: 'Git 身份已保存。',
    })
  })

  app.post('/api/user/git-credentials/verify', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = patVerificationSchema.parse(await c.req.json())
    if (payload.provider === 'generic') {
      return c.json({
        ok: true,
        provider: payload.provider,
        account: payload.host,
        message: 'Generic Git Host 暂不支持在线校验，请保存后在项目里实际测试。',
      })
    }

    const target = await resolvePatVerificationHost(payload.provider, payload.host)
    const result = target.ok
      ? await verifyPatToken(payload.patToken, payload.provider, target.host)
      : await verifyPatTokenViaWorker({
          fallbackMessage: target.message,
          host: target.host || payload.host,
          patToken: payload.patToken,
          provider: payload.provider,
          userId,
        })
    return c.json(result, result.ok ? 200 : 400)
  })

  app.post('/api/user/git-credentials/ssh/generate', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = sshGenerateSchema.parse(await c.req.json())
    try {
      const { publicKey, privateKey, fingerprint } = generateSshKeyPair(userId)
      const credential = await createGitCredential({
        userId,
        label: payload.label,
        provider: payload.provider,
        host: payload.host,
        authMode: 'ssh',
        name: payload.name,
        email: payload.email,
        sshPublicKey: publicKey,
        sshPrivateKey: privateKey,
        sshKeyFingerprint: fingerprint,
        isDefault: false,
      })
      const credentials = await listGitCredentialSummaries(userId)

      return c.json({
        ok: true,
        credential: credentials.find((item) => item.id === credential.id) ?? null,
        publicKey,
        fingerprint,
        credentials,
        message: payload.isDefault
          ? 'SSH 密钥对已生成。请添加公钥并验证身份后，再将它设为默认。'
          : 'SSH 密钥对已生成，请先添加公钥再验证身份。',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      return c.json({ message: `SSH 密钥生成或保存失败：${message}` }, 500)
    }
  })

  app.post('/api/user/git-credentials/:credentialId/ssh/verify', requireAuth, verifySshCredential)
  app.post('/api/user/git-credentials/:credentialId/ssh/activate', requireAuth, verifySshCredential)

  app.put('/api/user/git-credentials/:credentialId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const credentialId = c.req.param('credentialId')
    const payload = updateCredentialSchema.parse(await c.req.json())
    const credential = await updateGitCredential(userId, credentialId, payload)
    if (!credential) {
      return c.json({ message: 'Git 身份不存在。' }, 404)
    }
    const credentials = await listGitCredentialSummaries(userId)

    return c.json({
      ok: true,
      credential: credentials.find((item) => item.id === credential.id) ?? null,
      credentials,
      message: 'Git 身份已更新。',
    })
  })

  app.post('/api/user/git-credentials/:credentialId/default', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const credentialId = c.req.param('credentialId')
    let credential
    try {
      credential = await setDefaultGitCredential(userId, credentialId)
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '默认 Git 身份更新失败。' }, 409)
    }
    if (!credential) {
      return c.json({ message: 'Git 身份不存在。' }, 404)
    }
    const credentials = await listGitCredentialSummaries(userId)

    return c.json({
      ok: true,
      credential: credentials.find((item) => item.id === credential.id) ?? null,
      credentials,
      message: '默认 Git 身份已更新。',
    })
  })

  app.delete('/api/user/git-credentials/:credentialId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const credentialId = c.req.param('credentialId')
    const deleted = await deleteGitCredential(userId, credentialId)
    if (!deleted) {
      return c.json({ message: 'Git 身份不存在。' }, 404)
    }

    return c.json({
      ok: true,
      credentials: await listGitCredentialSummaries(userId),
      message: 'Git 身份已删除。',
    })
  })
}

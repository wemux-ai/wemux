// [INPUT]: OpenRouter 官方 OAuth PKCE 协议（openrouter.ai/docs/oauth）与公开模型目录 /api/v1/models。
// [OUTPUT]: PKCE 生成、授权链接（headless 粘贴码模式）、code→API Key 交换、免费模型发现、
//           pending verifier 存取（TTL + 单次消费）、幂等登记「OpenRouter 免费模型」聚合 profile。
// [POS]: 模型中心 OpenRouter BYOK 账号接入服务；路由层只做协议与校验，交换/登记逻辑都在这里。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash, randomBytes } from 'node:crypto'
import type { ServerAgentType } from '../server-agent'
import {
  createModelProfileForUser,
  listVisibleModelProfilesForUser,
  updateModelProfileForUser,
} from '../model-profile-service'

export const OPENROUTER_SITE_BASE = 'https://openrouter.ai'
export const OPENROUTER_API_BASE = `${OPENROUTER_SITE_BASE}/api/v1`
/** 授权后在用户 OpenRouter 后台显示的 key 备注 */
export const OPENROUTER_OAUTH_KEY_LABEL = 'Wemux'
/** OAuth 登记的聚合 profile 名称 / 标记（description 精确匹配，用于 status 判定与幂等更新） */
export const OPENROUTER_OAUTH_PROFILE_NAME = 'OpenRouter 免费模型'
export const OPENROUTER_OAUTH_PROFILE_DESCRIPTION = 'OpenRouter 免费模型（OAuth 一键接入，费用记在用户自己的 OpenRouter 账户）'
/** 官方限制：免费模型授权码一次性且 10 分钟过期 */
const PENDING_TTL_MS = 10 * 60 * 1000
/** 免费模型单日请求配额有限（未充值 50 次/天），登记数量收敛避免刷爆限额 */
const MAX_FREE_MODELS = 24

export type PkcePair = { codeVerifier: string, codeChallenge: string }

export const generatePkcePair = (): PkcePair => {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

/** Headless 模式授权链接：不带 callback_url，OpenRouter 页面直接显示授权码供用户粘贴；此模式强制要求 PKCE */
export const buildOpenRouterAuthorizeUrl = (codeChallenge: string): string => {
  const search = new URLSearchParams({
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    key_label: OPENROUTER_OAUTH_KEY_LABEL,
  })
  return `${OPENROUTER_SITE_BASE}/auth?${search.toString()}`
}

// ── pending verifier（内存态：authorize 与 import 必须落在同一 server 进程）──

type PendingFlow = { codeVerifier: string, expiresAt: number }

const pendingFlows = new Map<string, PendingFlow>()

const pruneExpiredPendingFlows = (now: number) => {
  for (const [userId, flow] of pendingFlows) {
    if (flow.expiresAt <= now) {
      pendingFlows.delete(userId)
    }
  }
}

export const rememberOpenRouterVerifier = (userId: string, codeVerifier: string, now = Date.now()) => {
  pruneExpiredPendingFlows(now)
  pendingFlows.set(userId, { codeVerifier, expiresAt: now + PENDING_TTL_MS })
}

/** 单次消费：取出后即删除；过期返回 null */
export const takeOpenRouterVerifier = (userId: string, now = Date.now()): string | null => {
  pruneExpiredPendingFlows(now)
  const flow = pendingFlows.get(userId)
  if (!flow) {
    return null
  }
  pendingFlows.delete(userId)
  if (flow.expiresAt <= now) {
    return null
  }
  return flow.codeVerifier
}

// ── code → API Key 交换 ──

export const exchangeOpenRouterCodeForKey = async ({ code, codeVerifier }: {
  code: string
  codeVerifier: string
}): Promise<string> => {
  const response = await fetch(`${OPENROUTER_API_BASE}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      code_challenge_method: 'S256',
    }),
    signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json().catch(() => ({})) as { key?: unknown }
  if (!response.ok || typeof payload.key !== 'string' || !payload.key.startsWith('sk-or-')) {
    throw new Error(
      response.status === 403
        ? '授权码无效或已过期（授权码一次性且 10 分钟有效），请重新打开授权页获取新码。'
        : `OpenRouter 授权码交换失败 (${response.status})，请稍后重试。`,
    )
  }
  return payload.key
}

// ── 免费模型发现（公开接口，无需鉴权）──

export type OpenRouterFreeModel = { modelId: string, label: string }

type OpenRouterCatalogEntry = {
  id?: unknown
  name?: unknown
  context_length?: unknown
}

/** 纯函数：过滤 `:free` 模型，按上下文长度降序并截断 */
export const filterOpenRouterFreeModels = (
  entries: unknown,
  limit = MAX_FREE_MODELS,
): OpenRouterFreeModel[] => {
  if (!Array.isArray(entries)) {
    return []
  }
  return entries
    .filter((entry): entry is OpenRouterCatalogEntry => typeof entry === 'object' && entry !== null)
    .filter((entry) => typeof entry.id === 'string' && entry.id.endsWith(':free'))
    .sort((a, b) => (typeof b.context_length === 'number' ? b.context_length : 0) - (typeof a.context_length === 'number' ? a.context_length : 0))
    .slice(0, limit)
    .map((entry) => ({
      modelId: entry.id as string,
      label: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.id as string,
    }))
}

export const listOpenRouterFreeModels = async (): Promise<OpenRouterFreeModel[]> => {
  const response = await fetch(`${OPENROUTER_API_BASE}/models`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    throw new Error(`OpenRouter 模型目录请求失败 (${response.status})`)
  }
  const payload = await response.json().catch(() => ({})) as { data?: unknown }
  return filterOpenRouterFreeModels(payload.data)
}

// ── 幂等登记聚合 profile（bindings 携带 BYOK key 与 baseUrl，走通用模型配置下发链路）──


/** bindings 结构：与 model-profile-service 创建/更新入参对齐 */
type OpenRouterProfileBinding = {
  agentType: ServerAgentType
  providerId: string
  modelId: string
  label: string
  baseUrl?: string
  apiToken?: string
}

export const isOpenRouterOAuthProfile = (profile: { description?: string | null }) => (
  profile.description?.trim() === OPENROUTER_OAUTH_PROFILE_DESCRIPTION
)

/**
 * 幂等创建/更新「OpenRouter 免费模型」聚合 profile：
 * - 首次：按当前免费模型目录建一个 private profile；
 * - 再次：合并「最新目录 + 用户已加过的模型」（不丢手工补充），仅在有变化时更新。
 * 返回本次新增的模型 label 列表。
 */
export const ensureOpenRouterOAuthProfile = async ({ userId, apiKey, models }: {
  userId: string
  apiKey: string
  models: OpenRouterFreeModel[]
}): Promise<string[]> => {
  const profiles = await listVisibleModelProfilesForUser(userId)
  const sameAccount = profiles.filter((profile) => isOpenRouterOAuthProfile(profile))
  const primary = sameAccount[0]

  const buildBindings = (items: OpenRouterFreeModel[]): OpenRouterProfileBinding[] => items.map((item) => ({
    agentType: 'OpenCode',
    providerId: 'openrouter',
    modelId: item.modelId,
    label: item.label,
    baseUrl: OPENROUTER_API_BASE,
    apiToken: apiKey,
  }))

  if (!primary) {
    await createModelProfileForUser({
      name: OPENROUTER_OAUTH_PROFILE_NAME,
      description: OPENROUTER_OAUTH_PROFILE_DESCRIPTION,
      visibility: 'private',
      ownerUserId: userId,
      source: 'manual',
      bindings: buildBindings(models),
    })
    return models.map((item) => item.label)
  }

  // 已有聚合 profile：保留用户已添加的模型，再并入最新目录
  const existingModels: OpenRouterFreeModel[] = primary.bindings.map((binding) => ({
    modelId: binding.modelId,
    label: binding.label,
  }))
  const knownIds = new Set(existingModels.map((item) => item.modelId))
  const missing = models.filter((item) => !knownIds.has(item.modelId))
  if (missing.length > 0) {
    await updateModelProfileForUser({
      userId,
      profileId: primary.id,
      name: OPENROUTER_OAUTH_PROFILE_NAME,
      description: OPENROUTER_OAUTH_PROFILE_DESCRIPTION,
      visibility: primary.visibility,
      bindings: buildBindings([...existingModels, ...missing]),
    })
  }
  return missing.map((item) => item.label)
}

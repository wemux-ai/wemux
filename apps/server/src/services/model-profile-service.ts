/**
 * [INPUT]: User-scoped model profile requests and explicit worker configuration exports.
 * [OUTPUT]: Model profile CRUD, manual worker imports, and runtime credential resolution.
 * [POS]: Server-side model library boundary; worker models enter only through an explicit import request.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { getUserTeams } from '../repositories/auth'
import { listUserWorkspaces } from '../repositories/workspace'
import { isWorkspaceResourceVisible } from '@shared/workspace-scope'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { executorWsService } from '../control-plane/executor-ws-service'
import {
  buildAgentExecutionModelId,
  buildExecutionModelId,
  findPreferredModelProfileBinding,
  MANAGED_MODEL_RUNTIME_ENV,
  matchesAgentExecutionModelOption,
  normalizeModelProviderBaseUrl,
  normalizeModelProfileRuntimeSettings,
  parseClaudeCodeConfigModel,
  parseCodexConfigModel,
  parseExecutionModelId,
  resolveModelEnvPrefix,
  toExecutionModelOption,
} from '@shared/model-profile'
import type {
  AgentType,
  ExecutionModelOption,
  ModelProfile,
  ModelProfileRuntimeSettings,
  ModelProfileSource,
  ModelProfileVisibility,
} from '@shared/types'
import {
  createModelProfile,
  deleteModelProfile,
  getModelProfileById,
  listModelProfiles,
  listModelProfilesWithSecrets,
  replaceModelProfileBindings,
  updateModelProfileBinding,
  updateModelProfileMeta,
} from '../storage/postgres/model-profile-store'
import { type ServerAgentType } from './server-agent'
import { getHostedModelGate } from './gate/hosted-model-gate'
import { getCommercialGate, isCreditInsufficientError } from './gate/commercial-gate'

type CreateModelProfileInput = {
  name: string
  description?: string
  visibility: ModelProfile['visibility']
  ownerUserId: string
  teamId?: string
  workspaceId?: string
  source?: ModelProfileSource
  sourceExecutorId?: string
  bindings: Array<{
    agentType: ServerAgentType
    providerId: string
    modelId: string
    label: string
    baseUrl?: string
    apiToken?: string
    isDefault?: boolean
    runtimeSettings?: ModelProfileRuntimeSettings
  }>
}

type ImportModelProfileInput = {
  userId: string
  executorId: string
  agentType: ServerAgentType
  visibility: ModelProfile['visibility']
  teamId?: string
  workspaceId?: string
}

type UpdateModelProfileInput = {
  userId: string
  profileId: string
  name: string
  description?: string
  visibility: ModelProfile['visibility']
  teamId?: string
  workspaceId?: string
  bindings: Array<{
    id?: string
    agentType: ServerAgentType
    providerId: string
    modelId: string
    label: string
    baseUrl?: string
    apiToken?: string
    clearApiToken?: boolean
    isDefault?: boolean
    runtimeSettings?: ModelProfileRuntimeSettings
  }>
}

type ProviderScopeBinding = {
  providerId: string
  baseUrl?: string
}

type VisibleBindingLookup = {
  agentType: AgentType
  providerId: string
  modelId: string
  baseUrl?: string
}

const canAccessProfile = (profile: ModelProfile, userId: string, teamIds: Set<string>, workspaceIds: Set<string>) => {
  if (!profile.ownerUserId) {
    return true
  }

  if (profile.ownerUserId === userId) {
    return true
  }

  const workspaceId = profile.workspaceId?.trim()
  if (profile.visibility === 'workspace' && workspaceId) {
    return workspaceIds.has(workspaceId)
  }

  const teamId = profile.teamId?.trim()
  if (profile.visibility !== 'team' || !teamId) {
    return false
  }

  return teamIds.has(teamId)
}

const requireScopeAccess = async (visibility: ModelProfile['visibility'], userId: string, options?: { teamId?: string; workspaceId?: string }) => {
  const normalizedWorkspaceId = options?.workspaceId?.trim()
  if (visibility === 'workspace' && !normalizedWorkspaceId) {
    throw new Error('工作区共享模型必须选择 workspace。')
  }

  if (normalizedWorkspaceId) {
    const workspaces = await listUserWorkspaces(userId)
    if (!workspaces.some((workspace) => workspace.id === normalizedWorkspaceId)) {
      throw new Error('当前用户不在所选 workspace 中。')
    }
  }

  if (visibility !== 'team') {
    return
  }

  const normalizedTeamId = options?.teamId?.trim()
  if (!normalizedTeamId) {
    throw new Error('团队共享模型必须选择团队。')
  }

  const teams = getUserTeams(userId)
  if (!teams.some((team) => team.id === normalizedTeamId)) {
    throw new Error('当前用户不在所选团队中。')
  }
}

const buildImportedProfileName = (agentType: ServerAgentType, executionModel: string) => {
  return `${agentType} · ${executionModel}`
}

const buildProviderScopeKey = (binding: ProviderScopeBinding) => {
  return `${binding.providerId.trim()}::${normalizeModelProviderBaseUrl(binding.baseUrl)}`
}

const listProviderScopeKeys = (bindings: ProviderScopeBinding[]) => {
  return Array.from(new Set(bindings.map((binding) => buildProviderScopeKey(binding))))
}

const ensureCreateProviderScope = (bindings: ProviderScopeBinding[]) => {
  if (listProviderScopeKeys(bindings).length > 1) {
    throw new Error('一个模型只能绑定一个供应商，请将不同供应商拆成多个模型。')
  }
}

const ensureUpdateProviderScope = (
  currentBindings: ProviderScopeBinding[],
  nextBindings: ProviderScopeBinding[],
) => {
  const currentProviderScopes = listProviderScopeKeys(currentBindings)
  const nextProviderScopes = listProviderScopeKeys(nextBindings)

  if (currentProviderScopes.length <= 1) {
    ensureCreateProviderScope(nextBindings)
    return
  }

  if (nextProviderScopes.length > currentProviderScopes.length) {
    throw new Error('历史多供应商模型不再支持继续新增供应商，请拆成多个模型。')
  }
}

const listVisibleProfilesInternal = async (userId: string, includeSecrets = false) => {
  const profiles = includeSecrets ? await listModelProfilesWithSecrets() : await listModelProfiles()
  const teamIds = new Set(getUserTeams(userId).map((team) => team.id))
  const workspaceIds = new Set((await listUserWorkspaces(userId)).map((workspace) => workspace.id))
  return profiles.filter((profile) => canAccessProfile(profile, userId, teamIds, workspaceIds))
}

const matchesVisibleBindingLookup = (
  binding: Pick<ModelProfile['bindings'][number], 'agentType' | 'providerId' | 'modelId' | 'baseUrl'>,
  target: VisibleBindingLookup,
) => {
  return binding.agentType === target.agentType
    && binding.providerId === target.providerId
    && binding.modelId === target.modelId
    && normalizeModelProviderBaseUrl(binding.baseUrl) === normalizeModelProviderBaseUrl(target.baseUrl)
}

export const findModelProfileByBindingInProfiles = (
  profiles: ModelProfile[],
  target: VisibleBindingLookup,
) => {
  return profiles.find((profile) => profile.bindings.some((binding) => matchesVisibleBindingLookup(binding, target))) ?? null
}

const findCompatibleModelProfileBinding = (
  profiles: ModelProfile[],
  providerId: string,
  modelId: string,
) => {
  const normalizedProviderId = providerId.trim()
  const normalizedModelId = modelId.trim()
  if (!normalizedProviderId || !normalizedModelId) {
    return null
  }

  for (const profile of profiles) {
    if (!profile.enabled) {
      continue
    }

    const binding = profile.bindings.find((item) => (
      item.providerId === normalizedProviderId
      && item.modelId === normalizedModelId
    ))

    if (binding) {
      return { profile, binding }
    }
  }

  return null
}

const findVisibleProfileById = async (userId: string, profileId: string) => {
  const profiles = await listVisibleProfilesInternal(userId)
  return profiles.find((profile) => profile.id === profileId) ?? null
}

const findVisibleProfileByBinding = async (userId: string, target: VisibleBindingLookup) => {
  const profiles = await listVisibleProfilesInternal(userId)
  return findModelProfileByBindingInProfiles(profiles, target)
}

type PersistedModelProfileCreateInput = Parameters<typeof createModelProfile>[0]

export const buildPersistedModelProfileCreateInput = (input: CreateModelProfileInput): PersistedModelProfileCreateInput => ({
  id: crypto.randomUUID(),
  name: input.name.trim(),
  description: input.description?.trim() || undefined,
  visibility: input.visibility,
  ownerUserId: input.ownerUserId.trim(),
  teamId: input.visibility === 'team' ? input.teamId?.trim() : undefined,
  workspaceId: input.workspaceId?.trim() || undefined,
  source: input.source ?? 'manual',
  sourceExecutorId: input.sourceExecutorId?.trim() || undefined,
  bindings: input.bindings.map((binding) => ({
    id: crypto.randomUUID(),
    agentType: binding.agentType as AgentType,
    providerId: binding.providerId.trim(),
    modelId: binding.modelId.trim(),
    label: binding.label.trim() || `${binding.agentType} · ${buildExecutionModelId(binding.providerId, binding.modelId)}`,
    baseUrl: normalizeModelProviderBaseUrl(binding.baseUrl) || undefined,
    apiToken: binding.apiToken?.trim() || undefined,
    isDefault: binding.isDefault,
    runtimeSettings: binding.runtimeSettings,
  })),
})

const createImportedBindings = async (input: ImportModelProfileInput) => {
  const exported = await executorWsService.requestConfigExport(input.executorId, {
    agentType: input.agentType as AgentType,
    includeResolvedModelBindings: true,
  })

  if (exported.resolvedModelBindings && exported.resolvedModelBindings.length > 0) {
    return exported.resolvedModelBindings.map((binding) => ({
      providerId: binding.providerId,
      modelId: binding.modelId,
      baseUrl: normalizeModelProviderBaseUrl(binding.baseUrl) || undefined,
      apiToken: binding.apiToken,
      label: binding.label,
      runtimeSettings: binding.runtimeSettings,
    }))
  }

  if (input.agentType === 'OpenCode') {
    const models = exported.availableModels ?? []
    return models
      .filter((model) => model.providerId.trim() && model.modelId.trim())
      .map((model) => ({
        providerId: model.providerId,
        modelId: model.modelId,
        baseUrl: undefined,
        label: buildImportedProfileName('OpenCode', buildExecutionModelId(model.providerId, model.modelId)),
        runtimeSettings: {
          defaultModel: buildExecutionModelId(model.providerId, model.modelId),
        } satisfies ModelProfileRuntimeSettings,
      }))
  }

  if (input.agentType === 'Codex') {
    const model = parseCodexConfigModel(exported.codexConfigContent)
    if (!model) {
      return []
    }

    return [{
      providerId: 'openai',
      modelId: model,
      baseUrl: undefined,
      label: buildImportedProfileName(input.agentType, buildExecutionModelId('openai', model)),
      runtimeSettings: {
        defaultModel: model,
      } satisfies ModelProfileRuntimeSettings,
    }]
  }

  if (input.agentType === 'Pi') {
    const fallbackModel = exported.agentSettings?.Pi.defaultModel?.trim() || ''
    const parsed = parseExecutionModelId(fallbackModel)
    const providerId = parsed?.providerId || 'pi'
    const modelId = parsed?.modelId || fallbackModel

    if (!modelId) {
      return []
    }

    return [{
      providerId,
      modelId,
      baseUrl: undefined,
      label: buildImportedProfileName('Pi', parsed ? buildExecutionModelId(providerId, modelId) : modelId),
      runtimeSettings: {
        defaultModel: parsed ? buildExecutionModelId(providerId, modelId) : modelId,
        agentDir: exported.agentSettings?.Pi.agentDir?.trim() || undefined,
      } satisfies ModelProfileRuntimeSettings,
    }]
  }

  const model = parseClaudeCodeConfigModel(exported.claudeCodeConfigContent)
  if (!model) {
    return []
  }

  return [{
    providerId: 'anthropic',
    modelId: model,
    baseUrl: undefined,
    label: buildImportedProfileName('ClaudeCode', buildExecutionModelId('anthropic', model)),
    runtimeSettings: {
      defaultModel: model,
    } satisfies ModelProfileRuntimeSettings,
  }]
}

export const buildModelRuntimeEnv = (
  agentType: ServerAgentType,
  binding: Pick<ModelProfile['bindings'][number], 'providerId' | 'modelId' | 'baseUrl' | 'apiToken'> & { id?: string },
) => {
  const baseUrl = normalizeModelProviderBaseUrl(binding.baseUrl)
  const apiToken = binding.apiToken?.trim()
  if (!baseUrl && !apiToken) {
    return undefined
  }

  const envPrefix = resolveModelEnvPrefix(agentType as AgentType, binding.providerId)
  return {
    ...(apiToken ? { [`${envPrefix}_API_KEY`]: apiToken } : {}),
    ...(baseUrl ? { [`${envPrefix}_BASE_URL`]: baseUrl } : {}),
    ...(apiToken
      ? {
          [MANAGED_MODEL_RUNTIME_ENV.enabled]: '1',
          [MANAGED_MODEL_RUNTIME_ENV.bindingId]: binding.id?.trim() || 'transient-model-profile-binding',
          [MANAGED_MODEL_RUNTIME_ENV.providerId]: binding.providerId,
          [MANAGED_MODEL_RUNTIME_ENV.modelId]: binding.modelId,
          ...(baseUrl ? { [MANAGED_MODEL_RUNTIME_ENV.baseUrl]: baseUrl } : {}),
          [MANAGED_MODEL_RUNTIME_ENV.apiKey]: apiToken,
        }
      : {}),
  }
}

export const listVisibleModelProfilesForUser = async (userId: string) => {
  return listVisibleProfilesInternal(userId)
}

export const listAgentModelProfileOptions = async (userId: string, agentType: ServerAgentType, workspaceId?: string) => {
  const profiles = await listVisibleProfilesInternal(userId)
  return profiles
    .flatMap((profile) => profile.bindings
      .filter((binding) => profile.enabled && binding.agentType === agentType)
      .filter((binding) => !workspaceId?.trim() || isWorkspaceResourceVisible(profile, {
        userId,
        workspaceId,
      }))
      .map((binding) => toExecutionModelOption(profile, binding)))
}

export const findVisibleModelProfileBindingForUser = async (userId: string, bindingId: string) => {
  const normalizedBindingId = bindingId.trim()
  if (!normalizedBindingId) {
    return null
  }

  const profiles = await listVisibleProfilesInternal(userId, true)
  for (const profile of profiles) {
    const binding = profile.bindings.find((item) => item.id === normalizedBindingId)
    if (binding) {
      return { profile, binding }
    }
  }

  return null
}

export const resolveModelRuntimeCredentialBinding = (
  profiles: ModelProfile[],
  binding: ModelProfile['bindings'][number],
) => {
  if (binding.apiToken?.trim()) {
    return binding
  }

  const baseUrl = normalizeModelProviderBaseUrl(binding.baseUrl)
  if (!baseUrl) {
    return binding
  }

  const credentialBinding = profiles
    .flatMap((profile) => profile.bindings)
    .find((candidate) => (
      candidate.agentType === binding.agentType
      && Boolean(candidate.apiToken?.trim())
      && normalizeModelProviderBaseUrl(candidate.baseUrl) === baseUrl
    ))

  return credentialBinding
    ? { ...binding, apiToken: credentialBinding.apiToken }
    : binding
}

export const resolveModelProfileRuntime = async (params: {
  userId: string
  agentType: ServerAgentType
  executionModel?: string
  fallbackExecutionModel?: string
  /** 工作区会话执行时传入，hosted 用量扣 workspace 账户并按其余额拦截。 */
  workspaceId?: string
}) => {
  // 官方托管模型优先：命中网关目录时直接注入网关 baseUrl/key，不再回退用户模型库。
  const hostedRuntime = await getHostedModelGate().resolveModelRuntime({
    agentType: params.agentType as AgentType,
    executionModel: params.executionModel,
    fallbackExecutionModel: params.fallbackExecutionModel,
  })
  if (hostedRuntime) {
    // 余额拦截：余额低于 CREDIT_MIN_BALANCE（-50）时拒绝执行官方模型（429 语义由调用方映射）。
    // 扣费归属与结算一致：workspace 会话扣 workspace 账户，否则扣 user 账户。
    const accountOwnerType = params.workspaceId?.trim() ? 'workspace' as const : 'user' as const
    const accountOwnerId = accountOwnerType === 'workspace' ? params.workspaceId!.trim() : params.userId
    try {
      await getCommercialGate().ensureSufficientBalance(accountOwnerType, accountOwnerId)
    } catch (error) {
      if (isCreditInsufficientError(error)) {
        throw error
      }
      // 账户读取失败不阻塞执行（记日志由调用方兜底）。
    }
    return hostedRuntime
  }

  const profiles = await listVisibleProfilesInternal(params.userId, true)
  const exactRuntimeMatch = findPreferredModelProfileBinding(
    profiles,
    params.agentType as AgentType,
    params.executionModel,
    params.fallbackExecutionModel,
  )
  const normalizedExecutionModel = params.executionModel?.trim() || undefined
  const parsedExecutionModel = parseExecutionModelId(normalizedExecutionModel)
  const compatibleMatch = exactRuntimeMatch
    ? null
    : parsedExecutionModel
      ? findCompatibleModelProfileBinding(profiles, parsedExecutionModel.providerId, parsedExecutionModel.modelId)
      : null
  const matched = exactRuntimeMatch ?? compatibleMatch

  if (!matched) {
    return {
      executionModel: normalizedExecutionModel,
      runtimeSettings: undefined,
      runtimeEnv: undefined,
      profile: undefined,
      binding: undefined,
    }
  }

  const runtimeBinding = resolveModelRuntimeCredentialBinding(profiles, matched.binding)

  return {
    executionModel: normalizedExecutionModel && exactRuntimeMatch
      ? buildAgentExecutionModelId(params.agentType as AgentType, matched.binding) || normalizedExecutionModel
      : normalizedExecutionModel,
    runtimeSettings: normalizeModelProfileRuntimeSettings(params.agentType, runtimeBinding.runtimeSettings),
    runtimeEnv: buildModelRuntimeEnv(params.agentType, runtimeBinding),
    profile: matched.profile,
    binding: runtimeBinding,
  }
}

export const createModelProfileForUser = async (input: CreateModelProfileInput) => {
  await requireScopeAccess(input.visibility, input.ownerUserId, {
    teamId: input.teamId,
    workspaceId: input.workspaceId,
  })
  if (input.bindings.length === 0) {
    throw new Error('模型至少需要一个绑定。')
  }
  ensureCreateProviderScope(input.bindings)

  for (const binding of input.bindings) {
    const existing = await findVisibleProfileByBinding(input.ownerUserId, {
      agentType: binding.agentType as AgentType,
      providerId: binding.providerId,
      modelId: binding.modelId,
      baseUrl: binding.baseUrl,
    })
    if (existing) {
      throw new Error(`模型 ${binding.providerId}/${binding.modelId} 已被 ${binding.agentType} 使用，请先删除旧绑定。`)
    }
  }

  const now = new Date().toISOString()
  const profile = await createModelProfile(buildPersistedModelProfileCreateInput(input))

  if (!profile) {
    throw new Error(`模型在 ${now} 创建失败。`)
  }

  return profile
}

export const updateModelProfileForUser = async (input: UpdateModelProfileInput) => {
  await requireScopeAccess(input.visibility, input.userId, {
    teamId: input.teamId,
    workspaceId: input.workspaceId,
  })
  const current = await findVisibleProfileById(input.userId, input.profileId)
  if (!current) {
    throw new Error('模型不存在或无权限访问。')
  }

  if (current.ownerUserId && current.ownerUserId !== input.userId) {
    throw new Error('只有创建者可以编辑模型。')
  }

  ensureUpdateProviderScope(current.bindings, input.bindings)

  for (const binding of input.bindings) {
    const existing = await findVisibleProfileByBinding(input.userId, {
      agentType: binding.agentType as AgentType,
      providerId: binding.providerId,
      modelId: binding.modelId,
      baseUrl: binding.baseUrl,
    })
    if (existing && existing.id !== current.id) {
      throw new Error(`模型 ${binding.providerId}/${binding.modelId} 已被 ${binding.agentType} 使用，请先删除旧绑定。`)
    }
  }

  const updatedAt = new Date().toISOString()
  const updatedMeta = await updateModelProfileMeta({
    id: current.id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    visibility: input.visibility,
    ownerUserId: current.ownerUserId?.trim() || input.userId,
    teamId: input.visibility === 'team' ? input.teamId?.trim() || null : null,
    workspaceId: input.workspaceId?.trim() || null,
    updatedAt,
  })
  if (!updatedMeta) {
    throw new Error('模型更新失败。')
  }

  const updatedProfile = await replaceModelProfileBindings({
    profileId: current.id,
    updatedAt,
    bindings: input.bindings.map((binding) => ({
      id: binding.id?.trim() || crypto.randomUUID(),
      agentType: binding.agentType as AgentType,
      providerId: binding.providerId.trim(),
      modelId: binding.modelId.trim(),
      label: binding.label.trim() || `${binding.agentType} · ${buildExecutionModelId(binding.providerId, binding.modelId)}`,
      baseUrl: normalizeModelProviderBaseUrl(binding.baseUrl) || undefined,
      apiToken: binding.apiToken?.trim() || undefined,
      clearApiToken: binding.clearApiToken,
      isDefault: binding.isDefault,
      runtimeSettings: binding.runtimeSettings,
    })),
  })
  if (!updatedProfile) {
    throw new Error('模型绑定更新失败。')
  }

  return updatedProfile
}

export const importModelProfilesFromExecutor = async (input: ImportModelProfileInput) => {
  await requireScopeAccess(input.visibility, input.userId, {
    teamId: input.teamId,
    workspaceId: input.workspaceId,
  })

  const visibleExecutorIds = new Set(listVisibleExecutorsForUser(input.userId).map((executor) => executor.executorId))
  if (!visibleExecutorIds.has(input.executorId)) {
    throw new Error('当前执行节点不可见或无权限访问。')
  }

  const bindings = await createImportedBindings(input)
  if (bindings.length === 0) {
    throw new Error('当前节点没有可导入的模型。')
  }

  const importedProfiles: ModelProfile[] = []
  for (const binding of bindings) {
    const existing = await findVisibleProfileByBinding(input.userId, {
      agentType: input.agentType as AgentType,
      providerId: binding.providerId,
      modelId: binding.modelId,
      baseUrl: binding.baseUrl,
    })

    if (existing) {
      const targetBinding = existing.bindings.find((item) => (
        item.agentType === input.agentType
        && item.providerId === binding.providerId
        && item.modelId === binding.modelId
      ))
      if (!targetBinding) {
        continue
      }

      const updatedAt = new Date().toISOString()
      await updateModelProfileMeta({
        id: existing.id,
        ownerUserId: existing.ownerUserId?.trim() || input.userId,
        sourceExecutorId: input.executorId,
        updatedAt,
      })
      const updated = await updateModelProfileBinding({
        profileId: existing.id,
        bindingId: targetBinding.id,
        agentType: input.agentType as AgentType,
        providerId: binding.providerId,
        modelId: binding.modelId,
        label: binding.label,
        runtimeSettings: binding.runtimeSettings,
        isDefault: targetBinding.isDefault,
        updatedAt,
      })
      if (updated) {
        importedProfiles.push(updated)
      }
      continue
    }

    const created = await createModelProfileForUser({
      name: buildImportedProfileName(input.agentType, buildExecutionModelId(binding.providerId, binding.modelId)),
      visibility: input.visibility,
      ownerUserId: input.userId,
      teamId: input.teamId,
      workspaceId: input.workspaceId,
      source: 'worker-import',
      sourceExecutorId: input.executorId,
      bindings: [{
        agentType: input.agentType,
        providerId: binding.providerId,
        modelId: binding.modelId,
        label: binding.label,
        runtimeSettings: binding.runtimeSettings,
      }],
    })
    importedProfiles.push(created)
  }

  return importedProfiles
}

export const deleteVisibleModelProfile = async (userId: string, profileId: string) => {
  const profile = await findVisibleProfileById(userId, profileId)
  if (!profile) {
    throw new Error('模型不存在或无权限访问。')
  }

  if (profile.ownerUserId && profile.ownerUserId !== userId) {
    throw new Error('只有创建者可以删除模型。')
  }

  await deleteModelProfile(profileId)
}

export const getVisibleModelProfile = async (userId: string, profileId: string) => {
  return findVisibleProfileById(userId, profileId)
}

export const listVisibleModelProfileExecutors = (userId: string) => {
  return listVisibleExecutorsForUser(userId)
}

export const buildModelOptionsFromProfiles = (profiles: ModelProfile[], agentType: ServerAgentType): ExecutionModelOption[] => {
  return profiles
    .flatMap((profile) => profile.bindings
      .filter((binding) => profile.enabled && binding.agentType === agentType)
      .map((binding) => toExecutionModelOption(profile, binding)))
}

export const findVisibleProfileBindingByExecutionModel = async (params: {
  userId: string
  agentType: ServerAgentType
  executionModel?: string
}) => {
  const profiles = await listVisibleProfilesInternal(params.userId)
  const normalizedExecutionModel = params.executionModel?.trim()
  const matched = profiles.find((profile) => profile.bindings.some((binding) => (
    binding.agentType === params.agentType
    && matchesAgentExecutionModelOption(params.agentType as AgentType, normalizedExecutionModel, {
      id: buildAgentExecutionModelId(params.agentType as AgentType, binding),
      providerId: binding.providerId,
    })
  )))

  return matched ?? null
}

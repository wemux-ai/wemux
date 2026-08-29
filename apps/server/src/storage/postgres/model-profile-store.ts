import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { coerceAgentType } from '@shared/agent-type'
import { normalizeModelProviderBaseUrl } from '@shared/model-profile'
import type { AgentType, ModelProfile, ModelProfileBinding, ModelProfileRuntimeSettings, ModelProfileSource } from '@shared/types'
import { decryptSecret, encryptSecret } from '../../services/secret-crypto'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson } from './helpers'
import { modelProfileBindings, modelProfiles } from './schema'

type ModelProfileRow = {
  profileId: string
  profileName: string
  profileDescription: string | null
  profileVisibility: ModelProfile['visibility']
  profileOwnerUserId: string
  profileTeamId: string | null
  profileWorkspaceId: string | null
  profileSource: ModelProfileSource
  profileSourceExecutorId: string | null
  profileEnabled: boolean
  profileCreatedAt: string
  profileUpdatedAt: string
  bindingId: string | null
  bindingAgentType: AgentType | null
  bindingProviderId: string | null
  bindingModelId: string | null
  bindingLabel: string | null
  bindingBaseUrl: string | null
  bindingApiTokenEncrypted: string | null
  bindingIsDefault: boolean | null
  bindingRuntimeSettingsJson: ModelProfileRuntimeSettings | null
}

type BindingInput = {
  id: string
  agentType: AgentType
  providerId: string
  modelId: string
  label: string
  baseUrl?: string
  apiToken?: string
  clearApiToken?: boolean
  isDefault?: boolean
  runtimeSettings?: ModelProfileRuntimeSettings
}

type CreateModelProfileInput = {
  id: string
  name: string
  description?: string
  visibility: ModelProfile['visibility']
  ownerUserId: string
  teamId?: string
  workspaceId?: string
  source: ModelProfileSource
  sourceExecutorId?: string
  enabled?: boolean
  bindings: BindingInput[]
}

type CloneWorkspaceModelProfilesInput = {
  ownerUserId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
}

type UpdateModelProfileBindingInput = Omit<BindingInput, 'id'> & {
  profileId: string
  bindingId: string
  updatedAt: string
}

type ReplaceModelProfileBindingsInput = {
  profileId: string
  bindings: BindingInput[]
  updatedAt: string
}

const normalizeBaseUrl = (value?: string) => normalizeModelProviderBaseUrl(value) || null
const encryptApiToken = (value?: string) => {
  const normalized = value?.trim() || ''
  return normalized ? encryptSecret(normalized) : null
}

const selectModelProfileRows = () => getDrizzleDb()
  .select({
    profileId: modelProfiles.id,
    profileName: modelProfiles.name,
    profileDescription: modelProfiles.description,
    profileVisibility: modelProfiles.visibility,
    profileOwnerUserId: modelProfiles.ownerUserId,
    profileTeamId: modelProfiles.teamId,
    profileWorkspaceId: modelProfiles.workspaceId,
    profileSource: modelProfiles.source,
    profileSourceExecutorId: modelProfiles.sourceExecutorId,
    profileEnabled: modelProfiles.enabled,
    profileCreatedAt: modelProfiles.createdAt,
    profileUpdatedAt: modelProfiles.updatedAt,
    bindingId: modelProfileBindings.id,
    bindingAgentType: modelProfileBindings.agentType,
    bindingProviderId: modelProfileBindings.providerId,
    bindingModelId: modelProfileBindings.modelId,
    bindingLabel: modelProfileBindings.label,
    bindingBaseUrl: modelProfileBindings.baseUrl,
    bindingApiTokenEncrypted: modelProfileBindings.apiTokenEncrypted,
    bindingIsDefault: modelProfileBindings.isDefault,
    bindingRuntimeSettingsJson: modelProfileBindings.runtimeSettingsJson,
  })
  .from(modelProfiles)
  .leftJoin(modelProfileBindings, eq(modelProfileBindings.modelProfileId, modelProfiles.id))
  .$dynamic()

const getEncryptedBindingToken = async (profileId: string, bindingId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ apiTokenEncrypted: modelProfileBindings.apiTokenEncrypted })
    .from(modelProfileBindings)
    .where(and(eq(modelProfileBindings.modelProfileId, profileId), eq(modelProfileBindings.id, bindingId)))
    .limit(1)
  return rows[0]?.apiTokenEncrypted ?? null
}

const resolveEncryptedToken = async (profileId: string, binding: Pick<BindingInput, 'id' | 'apiToken' | 'clearApiToken'>) => {
  if (binding.clearApiToken) {
    return null
  }

  const nextToken = encryptApiToken(binding.apiToken)
  return nextToken ?? getEncryptedBindingToken(profileId, binding.id)
}

const listRows = async () => {
  await ensurePostgresReady()
  return selectModelProfileRows()
    .orderBy(desc(modelProfiles.createdAt), asc(modelProfileBindings.agentType), asc(modelProfileBindings.providerId), asc(modelProfileBindings.modelId))
}

const mapRowsToProfiles = (rows: ModelProfileRow[], includeSecrets = false) => {
  const profiles = new Map<string, ModelProfile>()

  for (const row of rows) {
    const current = profiles.get(row.profileId) ?? {
      id: row.profileId,
      name: row.profileName,
      description: row.profileDescription ?? undefined,
      visibility: row.profileVisibility,
      ownerUserId: row.profileOwnerUserId,
      teamId: row.profileTeamId ?? undefined,
      workspaceId: row.profileWorkspaceId ?? undefined,
      source: row.profileSource,
      sourceExecutorId: row.profileSourceExecutorId ?? undefined,
      enabled: row.profileEnabled,
      createdAt: row.profileCreatedAt,
      updatedAt: row.profileUpdatedAt,
      bindings: [],
    }

    if (row.bindingId && row.bindingAgentType && row.bindingProviderId && row.bindingModelId && row.bindingLabel) {
      const rawAgentType = row.bindingAgentType as string
      const agentType = coerceAgentType(rawAgentType)
      const isLegacyBindingShadowedByCodex = rawAgentType === 'CodexDesktop'
        && current.bindings.some((binding) => (
          binding.agentType === 'Codex'
          && binding.providerId === row.bindingProviderId
          && binding.modelId === row.bindingModelId
        ))
      if (isLegacyBindingShadowedByCodex) {
        profiles.set(row.profileId, current)
        continue
      }

      current.bindings.push({
        id: row.bindingId,
        agentType,
        providerId: row.bindingProviderId,
        modelId: row.bindingModelId,
        label: row.bindingLabel,
        baseUrl: row.bindingBaseUrl ?? undefined,
        hasApiToken: Boolean(row.bindingApiTokenEncrypted),
        ...(includeSecrets && row.bindingApiTokenEncrypted
          ? { apiToken: decryptSecret(row.bindingApiTokenEncrypted) }
          : {}),
        isDefault: Boolean(row.bindingIsDefault),
        runtimeSettings: row.bindingRuntimeSettingsJson ?? undefined,
      } satisfies ModelProfileBinding)
    }

    profiles.set(row.profileId, current)
  }

  return Array.from(profiles.values())
}

const bindingInsertValues = (profileId: string, binding: BindingInput, timestamp: string, encryptedToken?: string | null) => ({
  id: binding.id,
  modelProfileId: profileId,
  agentType: binding.agentType,
  providerId: binding.providerId,
  modelId: binding.modelId,
  label: binding.label,
  baseUrl: normalizeBaseUrl(binding.baseUrl),
  apiTokenEncrypted: encryptedToken ?? encryptApiToken(binding.apiToken),
  isDefault: binding.isDefault ?? false,
  runtimeSettingsJson: binding.runtimeSettings ?? null,
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const initModelProfileStore = async () => {
  await ensurePostgresReady()
}

export const listModelProfiles = async () => {
  return cloneJson(mapRowsToProfiles(await listRows()))
}

export const listModelProfilesWithSecrets = async () => {
  return cloneJson(mapRowsToProfiles(await listRows(), true))
}

export const getModelProfileById = async (id: string) => {
  await ensurePostgresReady()
  const rows = await selectModelProfileRows()
    .where(eq(modelProfiles.id, id))
    .orderBy(asc(modelProfileBindings.agentType), asc(modelProfileBindings.providerId), asc(modelProfileBindings.modelId))

  return mapRowsToProfiles(rows)[0] ?? null
}

export const findModelProfileByBinding = async (
  agentType: AgentType,
  providerId: string,
  modelId: string,
  baseUrl?: string,
) => {
  await ensurePostgresReady()
  const rows = await selectModelProfileRows()
    .where(and(
      eq(modelProfileBindings.agentType, agentType),
      eq(modelProfileBindings.providerId, providerId),
      eq(modelProfileBindings.modelId, modelId),
      sql`COALESCE(${modelProfileBindings.baseUrl}, '') = ${normalizeBaseUrl(baseUrl) ?? ''}`,
    ))

  return mapRowsToProfiles(rows)[0] ?? null
}

export const createModelProfile = async (input: CreateModelProfileInput) => {
  await ensurePostgresReady()
  const timestamp = new Date().toISOString()
  await getDrizzleDb().transaction(async (tx) => {
    await tx.insert(modelProfiles).values({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      ownerUserId: input.ownerUserId,
      teamId: input.teamId ?? null,
      workspaceId: input.workspaceId ?? null,
      source: input.source,
      sourceExecutorId: input.sourceExecutorId ?? null,
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    for (const binding of input.bindings) {
      await tx.insert(modelProfileBindings).values(bindingInsertValues(input.id, binding, timestamp))
    }
  })

  return getModelProfileById(input.id)
}

export const deleteModelProfiles = async (ids: string[]) => {
  const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
  if (normalizedIds.length === 0) {
    return
  }

  await ensurePostgresReady()
  await getDrizzleDb().transaction(async (tx) => {
    await tx.delete(modelProfileBindings).where(inArray(modelProfileBindings.modelProfileId, normalizedIds))
    await tx.delete(modelProfiles).where(inArray(modelProfiles.id, normalizedIds))
  })
}

export const cloneWorkspaceModelProfiles = async (input: CloneWorkspaceModelProfilesInput) => {
  const sourceWorkspaceId = input.sourceWorkspaceId.trim()
  const targetWorkspaceId = input.targetWorkspaceId.trim()
  if (!sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId) {
    return []
  }

  const sourceProfiles = (await listModelProfilesWithSecrets())
    .filter((profile) => (
      profile.ownerUserId === input.ownerUserId
      && profile.workspaceId === sourceWorkspaceId
      && profile.bindings.length > 0
    ))

  const clonedProfiles: ModelProfile[] = []
  for (const profile of sourceProfiles) {
    const cloned = await createModelProfile({
      id: crypto.randomUUID(),
      name: profile.name,
      description: profile.description,
      visibility: 'workspace',
      ownerUserId: input.ownerUserId,
      workspaceId: targetWorkspaceId,
      source: profile.source,
      sourceExecutorId: profile.sourceExecutorId,
      enabled: profile.enabled,
      bindings: profile.bindings.map((binding) => ({
        id: crypto.randomUUID(),
        agentType: binding.agentType,
        providerId: binding.providerId,
        modelId: binding.modelId,
        label: binding.label,
        baseUrl: binding.baseUrl,
        apiToken: binding.apiToken,
        isDefault: binding.isDefault,
        runtimeSettings: binding.runtimeSettings,
      })),
    })
    if (cloned) {
      clonedProfiles.push(cloned)
    }
  }

  return clonedProfiles
}

export const updateModelProfileBinding = async (input: UpdateModelProfileBindingInput) => {
  const encryptedToken = await resolveEncryptedToken(input.profileId, { id: input.bindingId, apiToken: input.apiToken, clearApiToken: input.clearApiToken })
  await ensurePostgresReady()
  await getDrizzleDb().transaction(async (tx) => {
    await tx.update(modelProfileBindings)
      .set({
        agentType: input.agentType,
        providerId: input.providerId,
        modelId: input.modelId,
        label: input.label,
        baseUrl: normalizeBaseUrl(input.baseUrl),
        apiTokenEncrypted: encryptedToken,
        isDefault: input.isDefault ?? false,
        runtimeSettingsJson: input.runtimeSettings ?? null,
        updatedAt: input.updatedAt,
      })
      .where(and(eq(modelProfileBindings.id, input.bindingId), eq(modelProfileBindings.modelProfileId, input.profileId)))
    await tx.update(modelProfiles)
      .set({ updatedAt: input.updatedAt })
      .where(eq(modelProfiles.id, input.profileId))
  })
  return getModelProfileById(input.profileId)
}

export const replaceModelProfileBindings = async (input: ReplaceModelProfileBindingsInput) => {
  const current = await getModelProfileById(input.profileId)
  if (!current) {
    return null
  }

  const nextBindingIds = new Set(input.bindings.map((binding) => binding.id))
  const removedBindingIds = current.bindings
    .map((binding) => binding.id)
    .filter((bindingId) => !nextBindingIds.has(bindingId))

  await ensurePostgresReady()
  await getDrizzleDb().transaction(async (tx) => {
    if (removedBindingIds.length > 0) {
      await tx.delete(modelProfileBindings)
        .where(and(eq(modelProfileBindings.modelProfileId, input.profileId), inArray(modelProfileBindings.id, removedBindingIds)))
    }

    for (const binding of input.bindings) {
      const exists = current.bindings.some((item) => item.id === binding.id)
      if (exists) {
        const encryptedToken = await resolveEncryptedToken(input.profileId, binding)
        await tx.update(modelProfileBindings)
          .set({
            agentType: binding.agentType,
            providerId: binding.providerId,
            modelId: binding.modelId,
            label: binding.label,
            baseUrl: normalizeBaseUrl(binding.baseUrl),
            apiTokenEncrypted: encryptedToken,
            isDefault: binding.isDefault ?? false,
            runtimeSettingsJson: binding.runtimeSettings ?? null,
            updatedAt: input.updatedAt,
          })
          .where(and(eq(modelProfileBindings.id, binding.id), eq(modelProfileBindings.modelProfileId, input.profileId)))
        continue
      }

      await tx.insert(modelProfileBindings).values(bindingInsertValues(input.profileId, binding, input.updatedAt))
    }

    await tx.update(modelProfiles)
      .set({ updatedAt: input.updatedAt })
      .where(eq(modelProfiles.id, input.profileId))
  })
  return getModelProfileById(input.profileId)
}

export const updateModelProfileMeta = async (params: {
  id: string
  name?: string
  description?: string | null
  visibility?: ModelProfile['visibility']
  ownerUserId?: string
  teamId?: string | null
  workspaceId?: string | null
  sourceExecutorId?: string
  updatedAt: string
}) => {
  const current = await getModelProfileById(params.id)
  if (!current) {
    return null
  }

  const nextDescription = Object.prototype.hasOwnProperty.call(params, 'description')
    ? params.description ?? null
    : current.description ?? null
  const nextTeamId = Object.prototype.hasOwnProperty.call(params, 'teamId')
    ? params.teamId ?? null
    : current.teamId ?? null
  const nextWorkspaceId = Object.prototype.hasOwnProperty.call(params, 'workspaceId')
    ? params.workspaceId ?? null
    : current.workspaceId ?? null
  const nextOwnerUserId = Object.prototype.hasOwnProperty.call(params, 'ownerUserId')
    ? params.ownerUserId ?? ''
    : current.ownerUserId

  await ensurePostgresReady()
  await getDrizzleDb()
    .update(modelProfiles)
    .set({
      name: params.name ?? current.name,
      description: nextDescription,
      visibility: params.visibility ?? current.visibility,
      ownerUserId: nextOwnerUserId,
      teamId: nextTeamId,
      workspaceId: nextWorkspaceId,
      sourceExecutorId: params.sourceExecutorId ?? current.sourceExecutorId ?? null,
      updatedAt: params.updatedAt,
    })
    .where(eq(modelProfiles.id, params.id))

  return getModelProfileById(params.id)
}

export const deleteModelProfile = async (id: string) => {
  await deleteModelProfiles([id])
}

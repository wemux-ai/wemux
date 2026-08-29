import assert from 'node:assert/strict'
import test from 'node:test'
import { MANAGED_MODEL_RUNTIME_ENV } from '@shared/model-profile'
import type { ModelProfile } from '@shared/types'
import {
  buildModelRuntimeEnv,
  buildPersistedModelProfileCreateInput,
  findModelProfileByBindingInProfiles,
  resolveModelRuntimeCredentialBinding,
} from './model-profile-service'

const createProfile = (overrides?: Partial<ModelProfile>): ModelProfile => ({
  id: 'profile-1',
  name: 'CodexZH',
  visibility: 'private',
  ownerUserId: 'user-1',
  source: 'manual',
  enabled: true,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  bindings: [],
  ...overrides,
})

test('findModelProfileByBindingInProfiles matches the exact runtime binding', () => {
  const profile = createProfile({
    bindings: [
      {
        id: 'binding-1',
        agentType: 'Pi',
        providerId: 'codexzh',
        modelId: 'gpt-5.4',
        label: 'codexzh/gpt-5.4',
        baseUrl: 'https://api.codexzh.com/v1',
        hasApiToken: false,
      },
    ],
  })

  const matched = findModelProfileByBindingInProfiles([profile], {
    agentType: 'Pi',
    providerId: 'codexzh',
    modelId: 'gpt-5.4',
    baseUrl: 'https://api.codexzh.com/v1',
  })

  assert.equal(matched?.id, 'profile-1')
})

test('findModelProfileByBindingInProfiles ignores bindings from other runtimes', () => {
  const profile = createProfile({
    bindings: [
      {
        id: 'binding-1',
        agentType: 'OpenCode',
        providerId: 'codexzh',
        modelId: 'gpt-5.4',
        label: 'codexzh/gpt-5.4',
        baseUrl: 'https://api.codexzh.com/v1',
        hasApiToken: false,
      },
    ],
  })

  const matched = findModelProfileByBindingInProfiles([profile], {
    agentType: 'Pi',
    providerId: 'codexzh',
    modelId: 'gpt-5.4',
    baseUrl: 'https://api.codexzh.com/v1',
  })

  assert.equal(matched, null)
})

test('buildPersistedModelProfileCreateInput keeps ownerUserId for private manual profiles', () => {
  const persisted = buildPersistedModelProfileCreateInput({
    name: 'OpenAI Private',
    visibility: 'private',
    ownerUserId: 'user-private',
    source: 'manual',
    bindings: [{
      agentType: 'OpenCode',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      label: 'openai/gpt-5.5',
      baseUrl: 'https://API.OpenAI.com/v1/',
    }],
  })

  assert.equal(persisted.ownerUserId, 'user-private')
  assert.equal(persisted.bindings[0]?.baseUrl, 'https://api.openai.com/v1')
})

test('buildPersistedModelProfileCreateInput keeps ownerUserId for private worker imports', () => {
  const persisted = buildPersistedModelProfileCreateInput({
    name: 'Imported',
    visibility: 'private',
    ownerUserId: 'user-import',
    source: 'worker-import',
    sourceExecutorId: 'executor-1',
    bindings: [{
      agentType: 'Codex',
      providerId: 'openai',
      modelId: 'gpt-5.5',
      label: 'openai/gpt-5.5',
    }],
  })

  assert.equal(persisted.ownerUserId, 'user-import')
  assert.equal(persisted.source, 'worker-import')
  assert.equal(persisted.sourceExecutorId, 'executor-1')
})

test('buildModelRuntimeEnv keeps worker-imported Codex credentials node-local', () => {
  const runtimeEnv = buildModelRuntimeEnv('Codex', {
    id: 'binding-worker-import',
    providerId: 'custom',
    modelId: 'gpt-5.6-sol',
    baseUrl: 'https://blackaicoding.com/v1',
  })
  const environment = runtimeEnv as Record<string, string | undefined>

  assert.equal(environment.OPENAI_BASE_URL, 'https://blackaicoding.com/v1')
  assert.equal(environment[MANAGED_MODEL_RUNTIME_ENV.enabled], undefined)
  assert.equal(environment[MANAGED_MODEL_RUNTIME_ENV.bindingId], undefined)
})

test('buildModelRuntimeEnv isolates control-plane managed Codex credentials', () => {
  const runtimeEnv = buildModelRuntimeEnv('Codex', {
    id: 'binding-managed',
    providerId: 'custom',
    modelId: 'gpt-5.6-sol',
    baseUrl: 'https://blackaicoding.com/v1',
    apiToken: 'managed-token',
  })

  assert.equal(runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.enabled], '1')
  assert.equal(runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.bindingId], 'binding-managed')
  assert.equal(runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.providerId], 'custom')
  assert.equal(runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.modelId], 'gpt-5.6-sol')
  assert.equal(runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.baseUrl], 'https://blackaicoding.com/v1')
  assert.equal(runtimeEnv?.[MANAGED_MODEL_RUNTIME_ENV.apiKey], 'managed-token')
})

test('resolveModelRuntimeCredentialBinding reuses credentials for the same visible provider endpoint', () => {
  const importedBinding: ModelProfile['bindings'][number] = {
    id: 'binding-imported-terra',
    agentType: 'Codex',
    providerId: 'custom',
    modelId: 'gpt-5.6-terra',
    label: 'custom/gpt-5.6-terra',
    baseUrl: 'https://blackaicoding.com/v1',
  }
  const credentialProfile = createProfile({
    id: 'profile-blackai',
    bindings: [{
      id: 'binding-blackai',
      agentType: 'Codex',
      providerId: 'blackai',
      modelId: 'gpt-5.4',
      label: 'blackai/gpt-5.4',
      baseUrl: 'https://blackaicoding.com/v1/',
      apiToken: 'blackai-token',
      hasApiToken: true,
    }],
  })

  const resolved = resolveModelRuntimeCredentialBinding([
    createProfile({ id: 'profile-imported', bindings: [importedBinding] }),
    credentialProfile,
  ], importedBinding)

  assert.equal(resolved.providerId, 'custom')
  assert.equal(resolved.modelId, 'gpt-5.6-terra')
  assert.equal(resolved.apiToken, 'blackai-token')
})

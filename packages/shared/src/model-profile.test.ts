import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAgentExecutionModelId,
  findPreferredModelProfileBinding,
  normalizeModelProviderBaseUrl,
  resolveMatchingAgentExecutionModelOptionId,
  toNativeRuntimeModelId,
} from './model-profile'
import type { ExecutionModelOption } from './types'
import type { ModelProfile } from './types'

const createProfile = (): ModelProfile => ({
  id: 'profile-1',
  name: 'Pi GPT',
  visibility: 'private',
  ownerUserId: 'user-1',
  source: 'manual',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  bindings: [{
    id: 'binding-1',
    agentType: 'Pi',
    providerId: 'openai',
    modelId: 'gpt-5',
    label: 'Pi · openai/gpt-5',
    runtimeSettings: {
      defaultModel: 'openai/gpt-5',
    },
  }],
})

test('findPreferredModelProfileBinding falls back to the default execution model when no explicit model is provided', () => {
  const matched = findPreferredModelProfileBinding([createProfile()], 'Pi', undefined, 'openai/gpt-5')
  assert.equal(matched?.binding.id, 'binding-1')
})

test('findPreferredModelProfileBinding does not override an explicit execution model with the default binding', () => {
  const matched = findPreferredModelProfileBinding([createProfile()], 'Pi', 'openai/gpt-4.1', 'openai/gpt-5')
  assert.equal(matched, null)
})

test('buildAgentExecutionModelId normalizes native runtime model ids when the provider prefix is duplicated', () => {
  assert.equal(buildAgentExecutionModelId('Codex', {
    providerId: 'minimax-cn-coding-plan',
    modelId: 'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
  }), 'minimax-cn-coding-plan/MiniMax-M2.7-highspeed')
})

test('resolveMatchingAgentExecutionModelOptionId matches legacy canonical ids against native runtime options', () => {
  const options: ExecutionModelOption[] = [{
    id: 'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
    label: 'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
    providerId: 'minimax-cn-coding-plan',
    modelId: 'MiniMax-M2.7-highspeed',
  }]

  assert.equal(
    resolveMatchingAgentExecutionModelOptionId(
      'Codex',
      options,
      'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
    ),
    'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
  )
})

test('resolveMatchingAgentExecutionModelOptionId still matches legacy native ids against canonical native runtime options', () => {
  const options: ExecutionModelOption[] = [{
    id: 'codexzh/gpt-5.4',
    label: 'codexzh/gpt-5.4',
    providerId: 'codexzh',
    modelId: 'gpt-5.4',
  }]

  assert.equal(
    resolveMatchingAgentExecutionModelOptionId('Codex', options, 'gpt-5.4'),
    'codexzh/gpt-5.4',
  )
})

test('toNativeRuntimeModelId strips canonical provider prefixes for native runtimes', () => {
  assert.equal(
    toNativeRuntimeModelId('Codex', 'codexzh', 'codexzh/gpt-5.4'),
    'gpt-5.4',
  )
  assert.equal(
    toNativeRuntimeModelId('ClaudeCode', 'anthropic', 'anthropic/claude-sonnet-4'),
    'claude-sonnet-4',
  )
  assert.equal(
    toNativeRuntimeModelId('Pi', 'openai', 'openai/gpt-5'),
    'openai/gpt-5',
  )
})

test('findPreferredModelProfileBinding matches legacy canonical native runtime selections', () => {
  const profile: ModelProfile = {
    ...createProfile(),
    bindings: [{
      id: 'binding-codex-1',
      agentType: 'Codex',
      providerId: 'minimax-cn-coding-plan',
      modelId: 'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
      label: 'Codex · minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
      runtimeSettings: {
        defaultModel: 'MiniMax-M2.7-highspeed',
      },
    }],
  }

  const matched = findPreferredModelProfileBinding(
    [profile],
    'Codex',
    'minimax-cn-coding-plan/MiniMax-M2.7-highspeed',
  )
  assert.equal(matched?.binding.id, 'binding-codex-1')
})

test('findPreferredModelProfileBinding prefers the exact provider for duplicate native model ids', () => {
  const profiles: ModelProfile[] = [
    {
      ...createProfile(),
      id: 'profile-custom',
      bindings: [{
        id: 'binding-custom',
        agentType: 'Codex',
        providerId: 'custom',
        modelId: 'gpt-5.4',
        label: 'custom/gpt-5.4',
      }],
    },
    {
      ...createProfile(),
      id: 'profile-blackai',
      bindings: [{
        id: 'binding-blackai',
        agentType: 'Codex',
        providerId: 'blackai',
        modelId: 'gpt-5.4',
        label: 'blackai/gpt-5.4',
      }],
    },
  ]

  const matched = findPreferredModelProfileBinding(profiles, 'Codex', 'blackai/gpt-5.4')

  assert.equal(matched?.profile.id, 'profile-blackai')
  assert.equal(matched?.binding.id, 'binding-blackai')
})

test('normalizeModelProviderBaseUrl trims and canonicalizes provider base urls', () => {
  assert.equal(
    normalizeModelProviderBaseUrl(' https://API.OpenAI.com/v1/ '),
    'https://api.openai.com/v1',
  )
  assert.equal(
    normalizeModelProviderBaseUrl('https://openrouter.ai/api/v1///'),
    'https://openrouter.ai/api/v1',
  )
  assert.equal(normalizeModelProviderBaseUrl(''), '')
})

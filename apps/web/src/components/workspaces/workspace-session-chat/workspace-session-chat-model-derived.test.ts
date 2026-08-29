import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutionModelOption } from '@shared/types'
import {
  buildWorkspaceSessionGroupedModelOptions,
  resolveTaskChatEffectiveModel,
  resolveTaskChatModelSummaryLabel,
} from './workspace-session-chat-model-derived'

const modelOptions: ExecutionModelOption[] = [
  {
    id: 'codexzh/gpt-5.4-mini',
    label: 'codexzh/gpt-5.4-mini',
    providerId: 'codexzh',
    modelId: 'gpt-5.4-mini',
    source: 'catalog',
  },
  {
    id: 'opencode/gpt-5.4-mini',
    label: 'opencode/gpt-5.4-mini',
    providerId: 'opencode',
    modelId: 'gpt-5.4-mini',
    source: 'runtime',
  },
]

test('resolveTaskChatModelSummaryLabel includes provider name for matched models', () => {
  assert.equal(
    resolveTaskChatModelSummaryLabel('codexzh/gpt-5.4-mini', modelOptions),
    'codexzh / gpt-5.4-mini',
  )
})

test('resolveTaskChatModelSummaryLabel includes runtime source label for matched runtime models', () => {
  assert.equal(
    resolveTaskChatModelSummaryLabel('opencode/gpt-5.4-mini', modelOptions),
    'opencode · node / gpt-5.4-mini',
  )
})

test('resolveTaskChatModelSummaryLabel falls back to canonical provider/model ids when the model is unavailable', () => {
  assert.equal(
    resolveTaskChatModelSummaryLabel('openai/gpt-5.4', modelOptions),
    'openai / gpt-5.4',
  )
})

test('resolveTaskChatEffectiveModel uses the visible default when the persisted selection is unavailable', () => {
  assert.equal(
    resolveTaskChatEffectiveModel('', 'custom/gpt-5.6-terra'),
    'custom/gpt-5.6-terra',
  )
})

test('resolveTaskChatEffectiveModel keeps an available explicit selection', () => {
  assert.equal(
    resolveTaskChatEffectiveModel('blackai/gpt-5.4', 'custom/gpt-5.6-terra'),
    'blackai/gpt-5.4',
  )
})

test('buildWorkspaceSessionGroupedModelOptions sorts providers and models by recent selections first', () => {
  const groupedModelOptions = buildWorkspaceSessionGroupedModelOptions({
    modelMenuPreferences: {
      recentModelIds: [
        'openai/gpt-4.1',
        'anthropic/claude-sonnet-4',
        'openai/gpt-5',
      ],
      recentProviderLabels: [
        'openai',
        'anthropic · node',
      ],
    },
    modelOptions: [
      {
        id: 'openai/gpt-4.1',
        label: 'openai/gpt-4.1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        source: 'catalog',
      },
      {
        id: 'openai/gpt-5',
        label: 'openai/gpt-5',
        providerId: 'openai',
        modelId: 'gpt-5',
        source: 'catalog',
      },
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'anthropic/claude-sonnet-4',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
        source: 'runtime',
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'google/gemini-2.5-pro',
        providerId: 'google',
        modelId: 'gemini-2.5-pro',
        source: 'catalog',
      },
    ],
    visibleDefaultModel: '',
    visibleSelectedModel: 'openai/gpt-4.1',
  })

  assert.deepEqual(
    groupedModelOptions.map((group) => group.providerLabel),
    ['openai', 'anthropic · node', 'google'],
  )
  assert.deepEqual(
    groupedModelOptions[0]?.models.map((model) => model.id),
    ['openai/gpt-4.1', 'openai/gpt-5'],
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutionModelOption } from '@shared/types'
import { recordWorkspaceSessionModelMenuSelection } from './workspace-session-model-menu-preferences'

const openAiGpt5: ExecutionModelOption = {
  id: 'openai/gpt-5',
  label: 'openai/gpt-5',
  providerId: 'openai',
  modelId: 'gpt-5',
  source: 'catalog',
}

const openAiGpt4: ExecutionModelOption = {
  id: 'openai/gpt-4.1',
  label: 'openai/gpt-4.1',
  providerId: 'openai',
  modelId: 'gpt-4.1',
  source: 'catalog',
}

const runtimeClaude: ExecutionModelOption = {
  id: 'anthropic/claude-sonnet-4',
  label: 'anthropic/claude-sonnet-4',
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4',
  source: 'runtime',
}

test('recordWorkspaceSessionModelMenuSelection moves the latest model and provider to the front', () => {
  const preferences = recordWorkspaceSessionModelMenuSelection(
    recordWorkspaceSessionModelMenuSelection(
      recordWorkspaceSessionModelMenuSelection(
        {
          recentModelIds: [],
          recentProviderLabels: [],
        },
        openAiGpt5,
      ),
      runtimeClaude,
    ),
    openAiGpt4,
  )

  assert.deepEqual(preferences.recentModelIds, [
    'openai/gpt-4.1',
    'anthropic/claude-sonnet-4',
    'openai/gpt-5',
  ])
  assert.deepEqual(preferences.recentProviderLabels, [
    'openai',
    'anthropic · node',
  ])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { extractClaudeResultUsage, resolveClaudePermissionMode, shouldAllowClaudeTool } from './claude-runner'

test('resolveClaudePermissionMode follows the configured runtime settings', () => {
  const settings = {
    _runtime: 'ClaudeCode' as const,
    defaultModel: '',
    permissionMode: 'bypassPermissions' as const,
    planMode: false,
  }

  assert.equal(resolveClaudePermissionMode(settings), 'bypassPermissions')
  assert.equal(resolveClaudePermissionMode({ ...settings, planMode: true }), 'plan')
  assert.equal(resolveClaudePermissionMode(undefined), 'bypassPermissions')
})

test('default permission mode allows read and delegation tools but blocks writes', () => {
  assert.equal(shouldAllowClaudeTool('default', 'Read'), true)
  assert.equal(shouldAllowClaudeTool('default', 'Task'), true)
  assert.equal(shouldAllowClaudeTool('default', 'Edit'), false)
  assert.equal(shouldAllowClaudeTool('acceptEdits', 'Edit'), true)
  assert.equal(shouldAllowClaudeTool('bypassPermissions', 'Bash'), true)
})

test('extractClaudeResultUsage maps Claude Code CLI usage to ModelTokenUsage', () => {
  assert.deepEqual(
    extractClaudeResultUsage({
      usage: {
        input_tokens: 1800,
        output_tokens: 450,
        cache_creation_input_tokens: 120,
        cache_read_input_tokens: 600,
      },
    }),
    {
      inputTokens: 1800,
      outputTokens: 450,
      reasoningTokens: undefined,
      cacheReadTokens: 600,
      cacheWriteTokens: 120,
      // 真实消耗口径：input + output；cache 单独列不计入总量。
      totalTokens: 2250,
    },
  )
})

test('extractClaudeResultUsage returns undefined for missing or zero usage', () => {
  assert.equal(extractClaudeResultUsage({}), undefined)
  assert.equal(
    extractClaudeResultUsage({ usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    undefined,
  )
})

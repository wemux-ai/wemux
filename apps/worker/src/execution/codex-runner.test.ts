import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCodexCollaborationMode,
  extractCodexErrorMessage,
  extractCodexRuntimeErrorText,
  extractCodexTurnUsage,
  extractTurnError,
  isTransientCodexStatusMessage,
  isTransientCodexRetryableMessage,
  pickCodexProcessErrorMessage,
  replaceCodexBaseUrlInConfig,
  resolveCodexElicitationResponse,
  resolveCodexSandbox,
  shouldRetryCodexWithAlternateProtocolForTest,
  rewriteCodexConfigForExecutionModel,
} from './codex-runner'

test('resolveCodexElicitationResponse accepts trusted read-only Vibemux MCP calls', () => {
  assert.deepEqual(resolveCodexElicitationResponse('mcpServer/elicitation/request', {
    mode: 'form',
    serverName: 'mcp_vibemux',
    message: 'Approve MCP tool call project_list?',
  }), { action: 'accept', content: {}, _meta: null })
})

test('resolveCodexElicitationResponse declines write and untrusted MCP calls with the complete protocol shape', () => {
  assert.deepEqual(resolveCodexElicitationResponse('mcpServer/elicitation/request', {
    mode: 'form',
    serverName: 'mcp_vibemux',
    message: 'Approve MCP tool call project_delete?',
  }), { action: 'decline', content: null, _meta: null })
  assert.deepEqual(resolveCodexElicitationResponse('mcpServer/elicitation/request', {
    mode: 'form',
    serverName: 'third_party',
    message: 'Approve MCP tool call project_list?',
  }), { action: 'decline', content: null, _meta: null })
  assert.equal(resolveCodexElicitationResponse('item/tool/requestUserInput'), null)
})

test('buildCodexCollaborationMode keeps the selected model in turn payloads', () => {
  assert.deepEqual(buildCodexCollaborationMode('gpt-5.6-terra'), {
    mode: 'default',
    settings: {
      model: 'gpt-5.6-terra',
      reasoning_effort: null,
      developer_instructions: null,
    },
  })
})

test('resolveCodexSandbox honors configured sandbox and defaults to workspace-write', () => {
  const settings = {
    _runtime: 'Codex' as const,
    defaultModel: '',
    sandbox: 'danger-full-access' as const,
    approval: 'never' as const,
    reasoningEffort: 'high' as const,
    reasoningSummary: 'auto' as const,
  }

  assert.equal(resolveCodexSandbox(settings), 'danger-full-access')
  assert.equal(resolveCodexSandbox(undefined), 'workspace-write')
})

test('extractTurnError prefers detailed Codex retry messages over generic failure text', () => {
  const message = extractTurnError({
    id: 'turn-1',
    status: 'failed',
    error: {
      message: 'Codex 执行失败',
      details: [
        'Reconnecting... 1/5',
        'Reconnecting... 2/5',
        'exceeded retry limit, last status: 429 Too Many Requests',
      ].join('\n'),
    },
  })

  assert.equal(message, [
    'Reconnecting... 1/5',
    'Reconnecting... 2/5',
    'exceeded retry limit, last status: 429 Too Many Requests',
  ].join('\n'))
})

test('extractTurnError reads nested JSON error payloads emitted by Codex', () => {
  const message = extractTurnError({
    id: 'turn-2',
    status: 'failed',
    error: {
      message: 'Codex 执行失败',
      details: JSON.stringify({
        error: {
          message: 'exceeded retry limit, last status: 429 Too Many Requests',
        },
      }),
    },
  })

  assert.equal(message, 'exceeded retry limit, last status: 429 Too Many Requests')
})

test('extractCodexErrorMessage prefers nested structured details over generic top-level messages', () => {
  const message = extractCodexErrorMessage({
    message: 'Codex 执行失败',
    error: {
      data: {
        message: 'sandbox denied write access to /tmp/example',
      },
    },
  })

  assert.equal(message, 'sandbox denied write access to /tmp/example')
})

test('extractCodexErrorMessage prefers stable additional details over transient reconnect status', () => {
  const message = extractCodexErrorMessage({
    error: {
      message: 'Reconnecting... 1/5',
      additionalDetails: 'unexpected status 401 Unauthorized: 未提供令牌',
    },
    willRetry: true,
  })

  assert.equal(message, 'unexpected status 401 Unauthorized: 未提供令牌')
})

test('extractCodexRuntimeErrorText translates spawn E2BIG into a user-friendly startup hint', () => {
  const error = new Error('spawn E2BIG') as Error & { code?: string }
  error.code = 'E2BIG'

  assert.equal(
    extractCodexRuntimeErrorText(error),
    'Codex 启动失败：当前会话挂载的 Skills、MCP 或环境变量过多，超过了系统启动限制。请减少重复 Skills、关闭一部分 MCP，或精简环境变量后重试。',
  )
})

test('pickCodexProcessErrorMessage reads structured stderr payloads when the primary error is generic', () => {
  const message = pickCodexProcessErrorMessage(
    'Codex 执行失败',
    [
      '{"jsonrpc":"2.0","method":"log","params":{"message":"request failed"}}',
      '{"error":{"message":"exceeded retry limit, last status: 429 Too Many Requests"}}',
    ].join('\n'),
    1,
  )

  assert.equal(message, 'exceeded retry limit, last status: 429 Too Many Requests')
})

test('pickCodexProcessErrorMessage does not surface transient stream close as final failure reason', () => {
  const message = pickCodexProcessErrorMessage(
    'stream disconnected before completion: stream closed before response.completed',
    '',
    1,
  )

  assert.equal(message, 'Codex 连接短暂中断，但进程已退出且未收到完成事件。请重试本轮工作区对话。')
})

test('pickCodexProcessErrorMessage rewrites raw spawn E2BIG into a user-friendly startup hint', () => {
  const message = pickCodexProcessErrorMessage('spawn E2BIG', '', null)

  assert.equal(
    message,
    'Codex 启动失败：当前会话挂载的 Skills、MCP 或环境变量过多，超过了系统启动限制。请减少重复 Skills、关闭一部分 MCP，或精简环境变量后重试。',
  )
})

test('isTransientCodexStatusMessage recognizes reconnect progress notifications', () => {
  assert.equal(isTransientCodexStatusMessage('Reconnecting... 1/5'), true)
  assert.equal(isTransientCodexStatusMessage('reconnecting... 5/5'), true)
  assert.equal(isTransientCodexStatusMessage('exceeded retry limit, last status: 429 Too Many Requests'), false)
})

test('isTransientCodexRetryableMessage recognizes transient stream completion disconnects', () => {
  assert.equal(
    isTransientCodexRetryableMessage('stream disconnected before completion: stream closed before response.completed'),
    true,
  )
  assert.equal(
    isTransientCodexRetryableMessage('WebSocket stream closed before response.completed'),
    true,
  )
  assert.equal(
    isTransientCodexRetryableMessage('sandbox denied write access to /tmp/example'),
    false,
  )
})

test('replaceCodexBaseUrlInConfig rewrites matching provider base_url while preserving unrelated config', () => {
  const source = [
    'model = "gpt-5.4"',
    'model_provider = "codexzh"',
    '',
    '[model_providers.codexzh]',
    'base_url = "https://api.codexzh.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    '',
    '[model_providers.openai]',
    'base_url = "https://api.openai.com/v1"',
  ].join('\n')

  const rewritten = replaceCodexBaseUrlInConfig(source, 'codexzh', 'http://127.0.0.1:43123/v1')

  assert.equal(rewritten.changed, true)
  assert.match(rewritten.content, /base_url = "http:\/\/127\.0\.0\.1:43123\/v1"/)
  assert.match(rewritten.content, /\[model_providers\.openai\]\nbase_url = "https:\/\/api\.openai\.com\/v1"/)
})

test('rewriteCodexConfigForExecutionModel injects provider base_url for default model launches', () => {
  const source = [
    'model = "gpt-5.4"',
    'model_provider = "openai"',
    '',
    '[projects."C:\\workspace"]',
    'trust_level = "trusted"',
  ].join('\n')

  const rewritten = rewriteCodexConfigForExecutionModel(source, {
    runtimeEnv: {
      OPENAI_API_KEY: 'runtime-key',
      OPENAI_BASE_URL: 'https://blackaicoding.com/v1',
    },
  })

  assert.equal(rewritten.changed, true)
  assert.match(rewritten.content, /^model = "gpt-5\.4"$/m)
  assert.match(rewritten.content, /^model_provider = "openai"$/m)
  assert.match(rewritten.content, /\[model_providers\.openai\]\nname = "openai"\nbase_url = "https:\/\/blackaicoding\.com\/v1"\nenv_key = "OPENAI_API_KEY"/)
})

test('rewriteCodexConfigForExecutionModel rewrites provider selection for runtime model switching', () => {
  const source = [
    'model = "gpt-5.4"',
    'model_provider = "codexzh"',
    '',
    '[model_providers.codexzh]',
    'base_url = "https://api.codexzh.com/v1"',
    'env_key = "CODEXZH_API_KEY"',
  ].join('\n')

  const rewritten = rewriteCodexConfigForExecutionModel(source, {
    executionModel: 'openai/gpt-5.5',
    runtimeEnv: {
      OPENAI_API_KEY: 'runtime-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    },
  })

  assert.equal(rewritten.changed, true)
  assert.match(rewritten.content, /^model = "gpt-5\.5"$/m)
  assert.match(rewritten.content, /^model_provider = "openai"$/m)
  assert.match(rewritten.content, /\[model_providers\.openai\]\nname = "openai"\nbase_url = "https:\/\/api\.openai\.com\/v1"\nenv_key = "OPENAI_API_KEY"/)
  assert.match(rewritten.content, /\[model_providers\.codexzh\]\nbase_url = "https:\/\/api\.codexzh\.com\/v1"\nenv_key = "CODEXZH_API_KEY"/)
})

test('rewriteCodexConfigForExecutionModel creates a minimal provider config when Codex home has no config yet', () => {
  const rewritten = rewriteCodexConfigForExecutionModel('', {
    executionModel: 'codexzh/gpt-5.4-mini',
    runtimeEnv: {
      OPENAI_API_KEY: 'runtime-key',
      OPENAI_BASE_URL: 'https://api.codexzh.com/v1',
    },
  })

  assert.equal(rewritten.changed, true)
  assert.equal(rewritten.content, [
    'model = "gpt-5.4-mini"',
    'model_provider = "codexzh"',
    '',
    '[model_providers.codexzh]',
    'name = "codexzh"',
    'base_url = "https://api.codexzh.com/v1"',
    'env_key = "OPENAI_API_KEY"',
  ].join('\n'))
})

test('shouldRetryCodexWithAlternateProtocolForTest treats initialize timeout as retryable', () => {
  assert.equal(
    shouldRetryCodexWithAlternateProtocolForTest(new Error('Codex 启动超时：initialize 在 60000ms 内没有响应。请检查节点上的 Codex CLI 登录状态、模型配置或网络，然后重试本轮工作区对话。')),
    true,
  )
  assert.equal(
    shouldRetryCodexWithAlternateProtocolForTest(new Error('Codex 启动超时：thread/start 在 60000ms 内没有响应。')),
    false,
  )
})

test('extractCodexTurnUsage maps Codex token_count to ModelTokenUsage', () => {
  assert.deepEqual(
    extractCodexTurnUsage({
      id: 'turn-1',
      status: 'completed',
      token_count: {
        input_tokens: 2200,
        output_tokens: 500,
        reasoning_tokens: 300,
      },
    }),
    {
      inputTokens: 2200,
      outputTokens: 500,
      reasoningTokens: 300,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      // 真实消耗口径：input + output + reasoning。
      totalTokens: 3000,
    },
  )
})

test('extractCodexTurnUsage returns undefined for missing or zero token_count', () => {
  assert.equal(extractCodexTurnUsage(undefined), undefined)
  assert.equal(extractCodexTurnUsage({ id: 'turn-1', status: 'completed' }), undefined)
  assert.equal(
    extractCodexTurnUsage({ id: 'turn-1', status: 'completed', token_count: { input_tokens: 0, output_tokens: 0 } }),
    undefined,
  )
})

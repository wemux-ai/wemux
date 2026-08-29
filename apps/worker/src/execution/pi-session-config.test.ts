import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SessionManager } from '@mariozechner/pi-coding-agent'
import {
  findPiSessionRecoveryEntryId,
  preparePiSessionConfig,
  recoverPiSessionManagerIfNeeded,
} from './pi-session-config'

const createTempRuntime = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-pi-session-config-'))
  const cwd = path.join(root, 'workspace')
  const agentDir = path.join(root, 'agent')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  return { root, cwd, agentDir }
}

test('preparePiSessionConfig exposes auth for custom providers from runtime env', async () => {
  const temp = createTempRuntime()

  try {
    const runtime = await preparePiSessionConfig({
      cwd: temp.cwd,
      executionModel: 'moonshot/kimi-k2',
      settings: {
        _runtime: 'Pi' as const,
        defaultModel: '',
        agentDir: temp.agentDir,
      },
      runtimeEnv: {
        MOONSHOT_API_KEY: 'moonshot-test-key',
        MOONSHOT_BASE_URL: 'https://api.moonshot.ai/v1',
      },
    })

    try {
      assert.equal(runtime.selectedModel?.provider, 'moonshot')
      assert.equal(runtime.selectedModel?.id, 'kimi-k2')

      const auth = runtime.selectedModel
        ? await runtime.modelRegistry.getApiKeyAndHeaders(runtime.selectedModel)
        : { ok: false as const }
      assert.equal(auth.ok, true)
      if (auth.ok) {
        assert.equal(auth.apiKey, 'moonshot-test-key')
      }
    } finally {
      runtime.cleanup()
    }
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test('preparePiSessionConfig gives unknown OpenAI-compatible providers conservative compat', async () => {
  const temp = createTempRuntime()

  try {
    const runtime = await preparePiSessionConfig({
      cwd: temp.cwd,
      executionModel: 'blackai/gpt-5.4',
      settings: {
        _runtime: 'Pi' as const,
        defaultModel: '',
        agentDir: temp.agentDir,
      },
      runtimeEnv: {
        BLACKAI_API_KEY: 'blackai-test-key',
        BLACKAI_BASE_URL: 'https://api.blackai.example/v1',
      },
    })

    try {
      assert.equal(runtime.selectedModel?.provider, 'blackai')
      assert.equal(runtime.selectedModel?.id, 'gpt-5.4')
      assert.equal(runtime.selectedModel?.api, 'openai-completions')
      const compat = runtime.selectedModel?.compat as Record<string, unknown> | undefined
      assert.equal(compat?.supportsDeveloperRole, false)
      assert.equal(compat?.supportsReasoningEffort, false)
      assert.equal(compat?.supportsStore, false)
      assert.equal(compat?.supportsUsageInStreaming, false)
      assert.equal(compat?.supportsStrictMode, false)
      assert.equal(compat?.maxTokensField, 'max_tokens')

      const auth = runtime.selectedModel
        ? await runtime.modelRegistry.getApiKeyAndHeaders(runtime.selectedModel)
        : { ok: false as const }
      assert.equal(auth.ok, true)
      if (auth.ok) {
        assert.equal(auth.apiKey, 'blackai-test-key')
      }
    } finally {
      runtime.cleanup()
    }
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test('Pi provider overlay preserves existing provider auth and compat options', async () => {
  const temp = createTempRuntime()

  try {
    writeFileSync(path.join(temp.agentDir, 'models.json'), `${JSON.stringify({
      providers: {
        blackai: {
          baseUrl: 'https://stored.blackai.example/v1',
          apiKey: 'stored-key',
          api: 'openai-completions',
          authHeader: true,
          headers: {
            'X-Provider': 'stored-header',
          },
          compat: {
            requiresToolResultName: true,
            supportsDeveloperRole: true,
          },
          models: [
            {
              id: 'gpt-5.4',
              name: 'Stored GPT 5.4',
              compat: {
                requiresAssistantAfterToolResult: true,
              },
            },
          ],
        },
      },
    })}\n`, 'utf8')
    const runtime = await preparePiSessionConfig({
      cwd: temp.cwd,
      executionModel: 'blackai/gpt-5.4',
      settings: {
        _runtime: 'Pi' as const,
        defaultModel: '',
        agentDir: temp.agentDir,
      },
      runtimeEnv: {
        BLACKAI_API_KEY: 'runtime-key',
        BLACKAI_BASE_URL: 'https://runtime.blackai.example/v1',
      },
    })

    try {
      assert.equal(runtime.selectedModel?.provider, 'blackai')
      assert.equal(runtime.selectedModel?.id, 'gpt-5.4')
      assert.equal(runtime.selectedModel?.baseUrl, 'https://runtime.blackai.example/v1')
      assert.equal(runtime.selectedModel?.name, 'Stored GPT 5.4')

      const compat = runtime.selectedModel?.compat as Record<string, unknown> | undefined
      assert.equal(compat?.requiresAssistantAfterToolResult, true)
      assert.equal(compat?.supportsDeveloperRole, true)
      assert.equal(compat?.supportsReasoningEffort, false)
      assert.equal(compat?.requiresToolResultName, true)
      assert.equal(compat?.maxTokensField, 'max_tokens')

      const auth = runtime.selectedModel
        ? await runtime.modelRegistry.getApiKeyAndHeaders(runtime.selectedModel)
        : { ok: false as const }
      assert.equal(auth.ok, true)
      if (auth.ok) {
        assert.equal(auth.apiKey, 'runtime-key')
        assert.equal(auth.headers?.Authorization, 'Bearer runtime-key')
        assert.equal(auth.headers?.['X-Provider'], 'stored-header')
      }
    } finally {
      runtime.cleanup()
    }
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test('preparePiSessionConfig canonicalizes provider aliases before resolving auth', async () => {
  const temp = createTempRuntime()

  try {
    const runtime = await preparePiSessionConfig({
      cwd: temp.cwd,
      executionModel: 'gemini/gemini-2.5-flash',
      settings: {
        _runtime: 'Pi' as const,
        defaultModel: '',
        agentDir: temp.agentDir,
      },
      runtimeEnv: {
        GOOGLE_API_KEY: 'google-test-key',
      },
    })

    try {
      assert.equal(runtime.selectedModel?.provider, 'google')

      const auth = runtime.selectedModel
        ? await runtime.modelRegistry.getApiKeyAndHeaders(runtime.selectedModel)
        : { ok: false as const }
      assert.equal(auth.ok, true)
      if (auth.ok) {
        assert.equal(auth.apiKey, 'google-test-key')
      }
    } finally {
      runtime.cleanup()
    }
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test('preparePiSessionConfig isolates managed sessions by execution model', async () => {
  const temp = createTempRuntime()

  try {
    const openaiRuntime = await preparePiSessionConfig({
      cwd: temp.cwd,
      executionModel: 'openai/gpt-5',
      settings: {
        _runtime: 'Pi' as const,
        defaultModel: '',
        agentDir: temp.agentDir,
      },
      runtimeEnv: {
        OPENAI_API_KEY: 'openai-test-key',
      },
    })

    const zhipuRuntime = await preparePiSessionConfig({
      cwd: temp.cwd,
      executionModel: 'hs/glm-5.2',
      settings: {
        _runtime: 'Pi' as const,
        defaultModel: '',
        agentDir: temp.agentDir,
      },
      runtimeEnv: {
        HS_API_KEY: 'hs-test-key',
        HS_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/',
      },
    })

    try {
      assert.notEqual(openaiRuntime.sessionManager.getSessionId(), zhipuRuntime.sessionManager.getSessionId())
      assert.equal(zhipuRuntime.selectedModel?.provider, 'hs')
      assert.equal(zhipuRuntime.selectedModel?.id, 'glm-5.2')
      assert.equal(zhipuRuntime.selectedModel?.api, 'openai-completions')
    } finally {
      openaiRuntime.cleanup()
      zhipuRuntime.cleanup()
    }
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

test('findPiSessionRecoveryEntryId returns the last stable assistant before poisoned tool calls', () => {
  const recoveryEntryId = findPiSessionRecoveryEntryId([
    {
      id: 'user-1',
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
    {
      id: 'assistant-1',
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' },
    },
    {
      id: 'assistant-tool',
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_ok', name: 'ls', arguments: {} },
          { type: 'toolCall', id: '', name: '', arguments: { path: '.' } },
        ],
      },
    },
  ])

  assert.equal(recoveryEntryId, 'assistant-1')
})

test('findPiSessionRecoveryEntryId returns the last stable assistant before poisoned image history', () => {
  const recoveryEntryId = findPiSessionRecoveryEntryId([
    {
      id: 'user-1',
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
    {
      id: 'assistant-1',
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' },
    },
    {
      id: 'user-2',
      type: 'message',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'input_image', url: 'https://example.com/image.png' },
        ],
      },
    },
  ])

  assert.equal(recoveryEntryId, 'assistant-1')
})

test('findPiSessionRecoveryEntryId returns the last stable assistant before poisoned image provider errors', () => {
  const recoveryEntryId = findPiSessionRecoveryEntryId([
    {
      id: 'user-1',
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
    {
      id: 'assistant-1',
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop' },
    },
    {
      id: 'assistant-error',
      type: 'message',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: "400 Unknown parameter: 'input[74].content[1].url'.",
      },
    },
  ])

  assert.equal(recoveryEntryId, 'assistant-1')
})

test('recoverPiSessionManagerIfNeeded forks away from invalid Pi tool-call history', () => {
  const temp = createTempRuntime()

  try {
    const sessionManager = SessionManager.create(temp.cwd, path.join(temp.agentDir, 'sessions'))
    sessionManager.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: Date.now(),
    } as never)
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      stopReason: 'stop',
      timestamp: Date.now(),
    } as never)
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'toolCall', id: '', name: '', arguments: { path: '.' } }],
      timestamp: Date.now(),
    } as never)

    const previousSessionId = sessionManager.getSessionId()
    assert.equal(recoverPiSessionManagerIfNeeded(sessionManager), true)
    assert.notEqual(sessionManager.getSessionId(), previousSessionId)

    const roles = sessionManager.buildSessionContext().messages.map((message) => message.role)
    assert.deepEqual(roles, ['user', 'assistant'])
  } finally {
    rmSync(temp.root, { recursive: true, force: true })
  }
})

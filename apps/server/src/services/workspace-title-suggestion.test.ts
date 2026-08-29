import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceTitleSuggestionPrompt,
  buildWorkspaceNameFromInitialPrompt,
  sanitizeSuggestedWorkspaceTitle,
  suggestWorkspaceTitleWithDeepSeek,
} from './workspace-title-suggestion'

test('buildWorkspaceNameFromInitialPrompt strips markdown prefixes and truncates', () => {
  assert.equal(
    buildWorkspaceNameFromInitialPrompt(`  ##  ${'修'.repeat(40)}  `),
    '修'.repeat(32),
  )
})

test('sanitizeSuggestedWorkspaceTitle strips wrappers and prefixes', () => {
  assert.equal(
    sanitizeSuggestedWorkspaceTitle('标题：「工作区创建修复。」', '工作区创建流程又出问题了'),
    '工作区创建修复',
  )
})

test('sanitizeSuggestedWorkspaceTitle reads JSON title fields', () => {
  assert.equal(
    sanitizeSuggestedWorkspaceTitle('{"title":"Workspace Naming Fix"}', 'fallback'),
    'Workspace Naming Fix',
  )
})

test('sanitizeSuggestedWorkspaceTitle falls back for unusable output', () => {
  assert.equal(sanitizeSuggestedWorkspaceTitle('  标题  ', 'fallback'), 'fallback')
})

test('buildWorkspaceTitleSuggestionPrompt asks the model to avoid copying the full input', () => {
  assert.match(buildWorkspaceTitleSuggestionPrompt('修复工作区创建流程'), /不要照抄完整用户输入/)
})

test('suggestWorkspaceTitleWithDeepSeek falls back when api key is missing', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const result = await suggestWorkspaceTitleWithDeepSeek({
      initialPrompt: '修复工作区创建流程',
      fallbackTitle: '修复工作区创建流程',
      log: { info: () => {} },
    })

    assert.equal(result.source, 'fallback')
    assert.equal(result.reason, 'deepseek_api_key_missing')
  } finally {
    if (previousKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = previousKey
    }
  }
})

test('suggestWorkspaceTitleWithDeepSeek calls chat completions and sanitizes output', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'test-key'
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  try {
    const result = await suggestWorkspaceTitleWithDeepSeek({
      initialPrompt: '修复工作区创建流程',
      fallbackTitle: '修复工作区创建流程',
      log: { info: () => {} },
      fetchImpl: async (input, init) => {
        requestUrl = String(input)
        requestInit = init
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '标题：「工作区创建修复」',
            },
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    assert.equal(requestUrl, 'https://api.deepseek.com/chat/completions')
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer test-key')
    assert.equal(result.source, 'ai')
    assert.equal(result.title, '工作区创建修复')
  } finally {
    if (previousKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = previousKey
    }
  }
})

test('suggestWorkspaceTitleWithDeepSeek sends text-only content even when image data is provided', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'test-key'
  let requestInit: RequestInit | undefined

  try {
    await suggestWorkspaceTitleWithDeepSeek({
      initialPrompt: '看看这张图然后帮我命名工作区',
      fallbackTitle: '默认标题',
      imageDataUrl: 'data:image/png;base64,abc123',
      log: { info: () => {} },
      fetchImpl: async (_input, init) => {
        requestInit = init
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '工作区命名',
            },
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const body = JSON.parse(String(requestInit?.body)) as {
      messages: Array<{ role: string; content: unknown }>
    }
    const userMessage = body.messages.find((message) => message.role === 'user')
    // DeepSeek chat 不支持图片：附图被忽略，user content 保持纯文本
    assert.equal(typeof userMessage?.content, 'string')
    assert.match(String(userMessage?.content), /看看这张图然后帮我命名工作区/)
  } finally {
    if (previousKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY
    } else {
      process.env.DEEPSEEK_API_KEY = previousKey
    }
  }
})

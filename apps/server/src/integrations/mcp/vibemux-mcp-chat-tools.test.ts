import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppState } from '@shared/types'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import type { McpServer } from './sdk'
import { ErrorCode, McpError } from './sdk'
import { registerVibemuxMcpChatTools, normalizeMcpArguments } from './vibemux-mcp-chat-tools'
import type { VibemuxMcpContext } from './vibemux-mcp-context'

type CapturedTool = {
  config: Record<string, unknown>
  callback: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
}

const captureChatTools = (runtimeAgentId?: string) => {
  const tools = new Map<string, CapturedTool>()
  const server = {
    registerTool: (name: string, config: Record<string, unknown>, callback: CapturedTool['callback']) => {
      tools.set(name, { config, callback })
      return {}
    },
  } as unknown as McpServer
  const ctx: VibemuxMcpContext = {
    userId: 'user-1',
    runtimeAgentId,
    getState: () => ({ projects: [], tasks: [], mainChatSessions: [] }) as unknown as AppState,
    getConversations: () => [],
  }
  registerVibemuxMcpChatTools(server, ctx)
  return tools
}

test('chat.send / chat.group.list / chat.user.list 已注册，只读工具带注解', () => {
  const tools = captureChatTools('agent-1')
  const send = tools.get('chat.send')
  const list = tools.get('chat.group.list')
  const users = tools.get('chat.user.list')
  assert.ok(send, 'chat.send registered')
  assert.ok(list, 'chat.group.list registered')
  assert.ok(users, 'chat.user.list registered')
  assert.deepEqual(list!.config.annotations, VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS)
  assert.deepEqual(users!.config.annotations, VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS)
})

test('chat.send schema 兼容文本参数（preprocess 归一化）且描述含必填说明', () => {
  const send = captureChatTools('agent-1').get('chat.send')
  const config = send!.config as Record<string, unknown>
  // inputSchema 是 preprocess 包装（接受字符串/对象），非裸 shape
  assert.equal(typeof config.inputSchema, 'object')
  // 描述强调必填参数
  assert.match(String(config.description), /必须一次/)
  assert.match(String(config.description), /chat\.send\(target=/)
})

test('normalizeMcpArguments 文本参数 → 对象', () => {
  assert.deepEqual(
    normalizeMcpArguments('target: user\nuserId: u2\nmessage: 你好'),
    { target: 'user', userId: 'u2', message: '你好' },
  )
  assert.deepEqual(normalizeMcpArguments('{"target":"user","message":"hi"}'), { target: 'user', message: 'hi' })
  assert.deepEqual(normalizeMcpArguments({ target: 'user' }), { target: 'user' })
  assert.deepEqual(normalizeMcpArguments(''), {})
})

test('chat.send 非 Agent 身份调用报错', async () => {
  const send = captureChatTools().get('chat.send')!
  await assert.rejects(
    () => send.callback({ target: 'user', userId: 'user-2', message: '你好' }),
    (error: unknown) => {
      assert.ok(error instanceof McpError)
      assert.equal((error as McpError).code, ErrorCode.InvalidParams)
      assert.match(String((error as McpError).message), /Agent 身份/)
      return true
    },
  )
})

test('chat.group.list 非 Agent 身份调用报错', async () => {
  const list = captureChatTools().get('chat.group.list')!
  await assert.rejects(
    () => list.callback({}),
    (error: unknown) => {
      assert.ok(error instanceof McpError)
      assert.equal((error as McpError).code, ErrorCode.InvalidParams)
      return true
    },
  )
})

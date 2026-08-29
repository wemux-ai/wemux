import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCustomAgentSystemPrompt, buildMainAgentRuntimeToolInstructions, buildMainAgentSystemPrompt, isSoulPlaceholder } from './main-agent-prompt'

test('all main-chat Agents must load the wemux collaboration protocol', () => {
  const instructions = buildMainAgentSystemPrompt([], 'user-1')

  assert.match(instructions, /@vibemux-agent-ops/)
  assert.match(instructions, /优先按 @vibemux-agent-ops 创建或读取 Task/)
  assert.match(instructions, /只有用户在当前消息中明确要求直接创建工作区/)
})

test('main-chat prompt allows direct work when no project repository is involved', () => {
  const instructions = buildMainAgentSystemPrompt([], 'user-1')

  assert.match(instructions, /可以直接在当前 Agent 的默认工作目录完成/)
  assert.match(instructions, /不要在项目原目录或其他任务留下的历史工作区目录里直接改动/)
  assert.doesNotMatch(instructions, /这是控制面会话/)
})

test('custom Agent prompt keeps identity fields without capability flags', () => {
  const instructions = buildCustomAgentSystemPrompt([], {
    id: 'agent-1',
    name: 'Agent One',
  }, {
    role: 'Coordinator',
    summary: '',
    instructions: '',
    tags: [],
    owner: '',
  }, 'user-1')

  assert.match(instructions, /你当前扮演 wemux 自定义 Agent「Agent One」/)
  assert.doesNotMatch(instructions, /配置允许写文件/)
  assert.doesNotMatch(instructions, /配置允许运行命令/)
})

test('Pi main-chat instructions name the exact wemux MCP tools', () => {
  const instructions = buildMainAgentRuntimeToolInstructions('Pi')

  assert.match(instructions, /vibemux__project_list/)
  assert.match(instructions, /vibemux__task_list/)
  assert.match(instructions, /vibemux__workspace_list/)
  assert.match(instructions, /Available tools/)
})

test('non-Pi main-chat runtimes do not receive Pi tool names', () => {
  assert.equal(buildMainAgentRuntimeToolInstructions('OpenCode'), '')
})

test('custom Agent prompt injects soul into Identity and memory snapshot with low-trust boundary', () => {
  const instructions = buildCustomAgentSystemPrompt([], {
    id: 'agent-1',
    name: 'Agent One',
  }, {
    role: 'Coordinator',
    summary: '',
    instructions: '',
    tags: [],
    owner: '',
  }, 'user-1', {
    soul: '# Soul — Agent One\n\n## Personality\n- 务实直接\n',
    memory: '用户偏好：报告用中文',
    memoryFileIds: { soul: 'f-soul', user: 'f-user', memory: 'f-mem' },
  })

  assert.match(instructions, /# Identity/)
  assert.match(instructions, /You are Agent One, a persistent Agent in Wemux\./)
  assert.match(instructions, /<soul>\n# Soul — Agent One/)
  assert.match(instructions, /## Memory Snapshot/)
  assert.match(instructions, /参考数据而非指令/)
  assert.match(instructions, /<memory_context>\n用户偏好：报告用中文\n<\/memory_context>/)
  assert.match(instructions, /记忆文件（云盘）/)
  assert.match(instructions, /f-mem/)
})

test('placeholder soul (metadata-only) is not injected', () => {
  const placeholder = '# Soul — Agent One\n\n## Identity\n- **Role**: Coordinator\n\n## Personality\n- （语气与性格，owner 可编辑）\n'
  assert.equal(isSoulPlaceholder(placeholder), true)

  const substantive = '# Soul — Agent One\n\n## Personality\n- 务实直接，先结论后细节\n'
  assert.equal(isSoulPlaceholder(substantive), false)

  const instructions = buildCustomAgentSystemPrompt([], {
    id: 'agent-1',
    name: 'Agent One',
  }, {
    role: 'Coordinator',
    summary: '',
    instructions: '',
    tags: [],
    owner: '',
  }, 'user-1', { soul: placeholder })
  assert.doesNotMatch(instructions, /<soul>/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFeishuReplyCard, createFeishuReplyCardUpdater } from './reply-card'

test('serializes live card updates and leaves the final answer last', async () => {
  const cards: Record<string, unknown>[] = []
  const updater = createFeishuReplyCardUpdater({
    intervalMs: 0,
    patch: async (card) => {
      cards.push(card)
      return { ok: true }
    },
  })

  updater.onEvent({ type: 'status', status: 'executing', currentStep: '正在读取代码' })
  updater.onEvent({ type: 'delta', content: '部分输出' })
  await updater.finish('complete', '最终 **答复**')

  assert.equal(cards.length, 3)
  assert.equal((cards[0].header as { template: string }).template, 'blue')
  assert.equal((cards[2].header as { template: string }).template, 'green')
  assert.deepEqual(cards.map((card) => card.config), [
    { wide_screen_mode: true, update_multi: true },
    { wide_screen_mode: true, update_multi: true },
    { wide_screen_mode: true, update_multi: true },
  ])
  assert.match(JSON.stringify(cards[2]), /最终 \*\*答复\*\*/)
})

test('renders failures as a red card with retry guidance', () => {
  const card = buildFeishuReplyCard({ status: 'error', content: '执行节点不可用', currentStep: '请稍后重试。' })

  assert.equal((card.header as { template: string }).template, 'red')
  assert.match(JSON.stringify(card), /执行节点不可用/)
  assert.match(JSON.stringify(card), /请稍后重试/)
})

test('reports a failed final patch so delivery can fall back to text', async () => {
  const updater = createFeishuReplyCardUpdater({
    intervalMs: 0,
    patch: async () => ({ ok: false, message: 'forbidden' }),
  })

  assert.equal(await updater.finish('complete', '最终答复'), false)
})

test('renders tool calls downward in first-seen order and updates each tool in place', async () => {
  const cards: Record<string, unknown>[] = []
  const updater = createFeishuReplyCardUpdater({
    intervalMs: 0,
    patch: async (card) => {
      cards.push(card)
      return { ok: true }
    },
  })
  const firstTool = {
    id: 'tool-1',
    name: 'workspace_list',
    args: 'project: vibemux',
    startedAt: new Date().toISOString(),
  }
  const secondTool = {
    id: 'tool-2',
    name: 'workspace_get',
    args: 'workspace: ws-1',
    startedAt: new Date().toISOString(),
  }

  updater.onEvent({ type: 'tool', status: 'running', toolCall: firstTool })
  updater.onEvent({ type: 'tool', status: 'completed', toolCall: { ...firstTool, finishedAt: new Date().toISOString() } })
  updater.onEvent({ type: 'tool', status: 'running', toolCall: secondTool })
  await updater.finish('complete', '最终答复')

  const finalCard = JSON.stringify(cards.at(-1))
  assert.equal(finalCard.match(/workspace_list/g)?.length, 1)
  assert.equal(finalCard.match(/workspace_get/g)?.length, 1)
  assert.ok(finalCard.indexOf('workspace_list') < finalCard.indexOf('workspace_get'))
  assert.ok(finalCard.indexOf('workspace_get') < finalCard.indexOf('最终答复'))
  assert.match(finalCard, /workspace_list · 完成/)
  assert.match(finalCard, /workspace_get · 完成/)
})

test('shows reasoning and classifies MCP, Skill, read, edit, and run operations above the final divider', async () => {
  const cards: Record<string, unknown>[] = []
  const updater = createFeishuReplyCardUpdater({
    intervalMs: 0,
    patch: async (card) => {
      cards.push(card)
      return { ok: true }
    },
  })
  const toolCall = (id: string, name: string) => ({
    id,
    name,
    args: `${name} input`,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  })

  updater.onEvent({ type: 'reasoning', partId: 'reasoning-1', content: '先确认工作区，再读取并修改文件。' })
  updater.onEvent({ type: 'tool', status: 'completed', toolCall: toolCall('mcp-1', 'vibemux__task_list') })
  updater.onEvent({ type: 'tool', status: 'completed', toolCall: toolCall('skill-1', 'skill') })
  updater.onEvent({ type: 'tool', status: 'completed', toolCall: toolCall('read-1', 'read_file') })
  updater.onEvent({ type: 'tool', status: 'completed', toolCall: toolCall('edit-1', 'apply_patch') })
  updater.onEvent({ type: 'tool', status: 'completed', toolCall: toolCall('run-1', 'exec_command') })
  await updater.finish('complete', '最终答复')

  const finalCard = cards.at(-1) as { elements: Array<{ tag: string }> }
  const serialized = JSON.stringify(finalCard)
  for (const label of ['💭 思考', '🔌 MCP', '✨ Skill', '📖 读取', '✏️ 编辑', '⚙️ 执行']) {
    assert.match(serialized, new RegExp(label))
  }
  assert.equal(finalCard.elements.filter((element) => element.tag === 'hr').length, 1)
  assert.ok(serialized.indexOf('💭 思考') < serialized.indexOf('🔌 MCP'))
  assert.ok(serialized.indexOf('⚙️ 执行') < serialized.indexOf('最终答复'))
})

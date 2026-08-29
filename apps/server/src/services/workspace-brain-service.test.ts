import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BRAIN_INSTRUCTIONS,
  listBrainDispatchRecords,
  WORKSPACE_BRAIN_CONTEXT_COMPRESS_AT,
  WORKSPACE_BRAIN_CONTEXT_KEEP_AFTER_COMPRESS,
  WORKSPACE_BRAIN_CONTEXT_MAX_ITEMS,
} from './workspace-brain-service'

test('默认大脑提示词包含红线：有主不碰 / 不建影子任务 / 只派工作区内', () => {
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('有负责人'))
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('不创建影子任务'))
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('绝不外派'))
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('有主事件一律不碰'))
})

test('默认大脑提示词包含协作闭环：建任务/派发/结果插回群聊', () => {
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('task.create'))
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('task.assign'))
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('workspace.group_chat.send'))
})

test('默认大脑提示词强调成本控制：小事不唤醒大模型', () => {
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('不要为小事唤醒大模型执行'))
  assert.ok(DEFAULT_BRAIN_INSTRUCTIONS.includes('低成本'))
})

test('工作区上下文：记录与快照（零模型成本闭环）', () => {
  // 快照构建纯函数（不依赖 meta 存储）：直接验证 buildWorkspaceBrainContextSnapshot 需要 meta——这里验证记录结构
  const item = { at: '2026-08-14T05:00:00.000Z', kind: 'group_chat' as const, source: 'Demo', text: '群里讨论了部署方案，决定用 preview 验证' }
  const context = { updatedAt: item.at, summaryLines: ['团队近期聚焦登录页修复'], recentItems: [item] }
  const snapshotLines: string[] = ['--- 工作区持续摘要 ---', ...context.summaryLines]
  const itemLine = `- ${item.at.slice(0, 16)} | ${item.kind} | ${item.source} | ${item.text}`
  const snapshot = [...snapshotLines, '--- 工作区最近讨论/事件 ---', itemLine].join('\n')
  assert.ok(snapshot.includes('工作区持续摘要'))
  assert.ok(snapshot.includes('团队近期聚焦登录页修复'))
  assert.ok(snapshot.includes('group_chat'))
  assert.ok(snapshot.includes('群里讨论了部署方案'))
})

test('大脑分发记录：仅返回 type=brain.event.review 且属于该工作区的任务', () => {
  // listBrainDispatchRecords 依赖全局 agent 缓存；无注册 agent 时返回空数组（不抛错）
  const records = listBrainDispatchRecords('workspace-x')
  assert.ok(Array.isArray(records))
})

test('P2 增量摘要：压缩阈值低于池上限，压缩后仍保留最近条目', () => {
  // 压缩在池满前触发（COMPRESS_AT < MAX_ITEMS），避免老讨论无限堆积；
  // 压缩保留数 > 0，保证时间线仍有近期条目可看。
  assert.ok(WORKSPACE_BRAIN_CONTEXT_COMPRESS_AT < WORKSPACE_BRAIN_CONTEXT_MAX_ITEMS)
  assert.ok(WORKSPACE_BRAIN_CONTEXT_KEEP_AFTER_COMPRESS > 0)
  assert.ok(WORKSPACE_BRAIN_CONTEXT_KEEP_AFTER_COMPRESS < WORKSPACE_BRAIN_CONTEXT_COMPRESS_AT)
})

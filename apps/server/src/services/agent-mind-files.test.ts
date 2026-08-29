// [INPUT]: 无（纯函数测试）
// [OUTPUT]: soul 模板生成与记忆占位符清理的验证
// [POS]: 验证 agent-mind-files 的核心纯逻辑（模板内容、strip 规则）；drive 存储组合调用在真实环境验收
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSoulTemplate, stripMemoryPlaceholder } from './agent-mind-files'

test('soul 模板包含 Agent 名与角色（四段式）', () => {
  const template = buildSoulTemplate('测试助手', '研发助手')

  assert.match(template, /# Soul — 测试助手/)
  assert.match(template, /## Identity/)
  assert.match(template, /研发助手/)
  assert.match(template, /## Personality/)
  assert.match(template, /## Work Style/)
  assert.match(template, /## Boundaries/)
  // 记忆纪律写进模板，引导 Agent 记录到 memory
  assert.match(template, /memory\/MEMORY\.md/)
})

test('soul 模板角色为空时回退「未设置」', () => {
  const template = buildSoulTemplate('助手', '')
  assert.match(template, /未设置/)
})

test('strip 去掉标题行、模板占位说明与 HTML 注释，保留实质内容', () => {
  const raw = [
    '# Memory',
    '_这里记录 Agent 自己学到的知识。_',
    '<!-- 注释 -->',
    '- 项目用 pnpm',
    '',
    '- 用户偏好：报告用中文',
  ].join('\n')

  const stripped = stripMemoryPlaceholder(raw)

  assert.doesNotMatch(stripped, /# Memory/)
  assert.doesNotMatch(stripped, /_这里记录/)
  assert.doesNotMatch(stripped, /<!--/)
  assert.match(stripped, /项目用 pnpm/)
  assert.match(stripped, /报告用中文/)
})

test('纯占位模板 strip 后为空（不注入空记忆）', () => {
  const placeholderOnly = '# Memory\n\n_这里记录 Agent 自己学到的知识。_\n'
  assert.equal(stripMemoryPlaceholder(placeholderOnly), '')
})

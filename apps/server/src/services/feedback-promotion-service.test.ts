import assert from 'node:assert/strict'
import test from 'node:test'

import type { FeedbackItem } from '@shared/types'
import { buildIssuePayload, FeedbackPromotionError } from './feedback-promotion-service'

const makeItem = (overrides: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: 'feedback:abc-123',
  type: 'feature',
  title: '希望支持日历视图',
  body: '第一行\n第二行',
  status: 'triaged',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  ...overrides,
})

test('community 域未同意公开时拒绝 promote（409）', () => {
  const item = makeItem({ consentPublic: false })
  assert.throws(
    () => buildIssuePayload(item, 'community'),
    (error: unknown) => error instanceof FeedbackPromotionError && error.status === 409,
  )
})

test('community 域已同意公开时正常构建，正文含原始反馈引用与元信息', () => {
  const payload = buildIssuePayload(makeItem({ consentPublic: true }), 'community')
  assert.ok(payload.title.startsWith('[feedback] 希望支持日历视图'))
  assert.ok(payload.body.includes('## 原始反馈'))
  assert.ok(payload.body.includes('> 第一行\n> 第二行'))
  assert.ok(payload.body.includes('<!-- wemux-feedback:feedback:abc-123 -->'))
  assert.ok(payload.body.includes('consentPublic: yes'))
  assert.ok(payload.body.includes('routing: community'))
})

test('internal 域不要求 consentPublic，meta 标记 no', () => {
  const payload = buildIssuePayload(makeItem({ consentPublic: false }), 'internal')
  assert.ok(payload.body.includes('consentPublic: no'))
  assert.ok(payload.body.includes('routing: internal'))
})

test('有 AI 规范化草稿时输出结构化小节与验收清单', () => {
  const item = makeItem({
    consentPublic: true,
    normalized: {
      at: '2026-08-23T01:00:00.000Z',
      method: 'llm',
      draft: {
        background: '用户排期靠外部工具',
        scenario: '小团队周计划',
        expectation: '内置日历',
        acceptance: ['能切换月/周视图', '支持拖拽改期'],
      },
    },
  })
  const payload = buildIssuePayload(item, 'community')
  assert.ok(payload.body.includes('## 背景\n用户排期靠外部工具'))
  assert.ok(payload.body.includes('## 场景\n小团队周计划'))
  assert.ok(payload.body.includes('## 期望\n内置日历'))
  assert.ok(payload.body.includes('- [ ] 能切换月/周视图'))
  assert.ok(payload.body.includes('- [ ] 支持拖拽改期'))
  // 规范化草稿存在时，原始反馈仍保留（不覆盖原文）
  assert.ok(payload.body.includes('## 原始反馈'))
})

test('超长标题被截断到 200 字符内', () => {
  const payload = buildIssuePayload(makeItem({ title: '长'.repeat(500) }), 'internal')
  assert.ok(payload.title.length <= 200)
})

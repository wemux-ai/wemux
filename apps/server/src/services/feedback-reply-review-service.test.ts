import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewReplyByRules, parseReviewResult } from './feedback-reply-review-service'

test('规则审查：承诺时间线 → high', () => {
  const result = reviewReplyByRules('我们马上修复这个问题')
  assert.equal(result.risk, 'high')
  assert.ok(result.reasons.some((r) => r.includes('马上')))
})

test('规则审查：语气不当 → high', () => {
  const result = reviewReplyByRules('你这个傻用户')
  assert.equal(result.risk, 'high')
})

test('规则审查：泄露内部信息 → high', () => {
  const result = reviewReplyByRules('这个功能在商业版里，vibemux.xyz')
  assert.equal(result.risk, 'high')
})

test('规则审查：回复过长 → medium', () => {
  const result = reviewReplyByRules('A'.repeat(2001))
  assert.equal(result.risk, 'medium')
  assert.ok(result.reasons.some((r) => r.includes('过长')))
})

test('规则审查：干净回复 → low', () => {
  const result = reviewReplyByRules('感谢反馈，我们已记录并会跟进。')
  assert.equal(result.risk, 'low')
  assert.equal(result.reasons.length, 0)
})

test('规则审查：大小写不敏感', () => {
  assert.equal(reviewReplyByRules('ASAP fix').risk, 'high')
  assert.equal(reviewReplyByRules('Internal').risk, 'high')
})

test('parseReviewResult：标准 JSON', () => {
  const result = parseReviewResult('{"risk":"high","reasons":["承诺时间线"]}')
  assert.equal(result?.risk, 'high')
  assert.deepEqual(result?.reasons, ['承诺时间线'])
})

test('parseReviewResult：杂文容错', () => {
  const result = parseReviewResult('审查结果：\n{"risk":"low","reasons":[],"suggestions":["加个感谢"]}\n已通过')
  assert.equal(result?.risk, 'low')
  assert.deepEqual(result?.suggestions, ['加个感谢'])
})

test('parseReviewResult：非法 JSON → null', () => {
  assert.equal(parseReviewResult('不是 json'), null)
})
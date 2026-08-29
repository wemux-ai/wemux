import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyFeedbackRuleBased, parseNormalizationResult } from './feedback-normalization-service'

test('classifyFeedbackRuleBased 通过关键词识别 bug', () => {
  assert.equal(classifyFeedbackRuleBased('登录页报错', '点了登录按钮后闪退'), 'bug')
  assert.equal(classifyFeedbackRuleBased('Worker 崩溃了', 'node_modules missing'), 'bug')
})

test('classifyFeedbackRuleBased 通过关键词识别 feature', () => {
  assert.equal(classifyFeedbackRuleBased('希望加一个日历视图', '方便排期'), 'feature')
  assert.equal(classifyFeedbackRuleBased('建议支持深色模式', '晚上用太刺眼'), 'feature')
})

test('classifyFeedbackRuleBased 无关键词时兜底 chat', () => {
  assert.equal(classifyFeedbackRuleBased('随便问问', '今天天气不错'), 'chat')
})

test('classifyFeedbackRuleBased 大小写不敏感', () => {
  assert.equal(classifyFeedbackRuleBased('BUG', 'CRASH'), 'bug')
  assert.equal(classifyFeedbackRuleBased('Feature Request', ''), 'feature')
})

test('parseNormalizationResult 解析标准 JSON', () => {
  const result = parseNormalizationResult('{"type":"bug","draft":{"background":"用户登录失败","scenario":"点击登录后","expectation":"正常登录","acceptance":["能登录"]},"duplicateOfId":null}')
  assert.ok(result)
  assert.equal(result?.type, 'bug')
  assert.equal(result?.draft?.background, '用户登录失败')
  assert.deepEqual(result?.draft?.acceptance, ['能登录'])
  assert.equal(result?.duplicateOfId, null)
})

test('parseNormalizationResult 容忍 markdown fence', () => {
  const result = parseNormalizationResult('```json\n{"type":"feature","draft":{"acceptance":["支持切换"]},"duplicateOfId":null}\n```')
  assert.ok(result)
  assert.equal(result?.type, 'feature')
})

test('parseNormalizationResult 容忍前后多余文本', () => {
  const result = parseNormalizationResult('好的，这是规范化结果：\n{"draft":{},"duplicateOfId":null}\n后面还有字')
  assert.ok(result)
})

test('parseNormalizationResult 非法 JSON 返回 null', () => {
  assert.equal(parseNormalizationResult('不是 JSON'), null)
  assert.equal(parseNormalizationResult('{bad json}'), null)
})

test('parseNormalizationResult 缺字段时不抛（draft 为空对象）', () => {
  const result = parseNormalizationResult('{"duplicateOfId":null}')
  assert.ok(result)
  assert.ok(result?.draft)
})
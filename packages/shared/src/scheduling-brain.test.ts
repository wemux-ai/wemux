import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceBrainDecisionByRules,
  classifyWorkspaceIntentByRules,
  pickBrainTargetAgentByRules,
} from './scheduling-brain'

const agents = [
  { id: 'agent-frontend', name: '前端小强', role: '前端开发' },
  { id: 'agent-backend', name: '后端老王', role: '后端开发 / 数据库' },
  { id: 'agent-review', name: '审查官', role: '代码审查' },
]

test('规则意图：明确的执行类需求 → task_request', () => {
  for (const message of [
    '帮我修一下登录页面的 bug',
    '实现一个用户列表 API',
    '重构一下这个支付模块',
    '把新功能部署到 preview',
    '跑一下测试',
    'fix the checkout flow',
  ]) {
    assert.equal(classifyWorkspaceIntentByRules(message), 'task_request', message)
  }
})

test('规则意图：无 @ 的委托 → agent_request', () => {
  for (const message of [
    '帮我看看这个情况怎么处理',
    '请跟进一下那个 issue',
    '分析一下这个方案',
    'check the server logs',
  ]) {
    assert.equal(classifyWorkspaceIntentByRules(message), 'agent_request', message)
  }
})

test('规则意图：纯提问 → question', () => {
  for (const message of [
    '这个接口为什么慢？',
    '如何配置环境变量',
    'what time is it?',
  ]) {
    assert.equal(classifyWorkspaceIntentByRules(message), 'question', message)
  }
})

test('规则意图：寒暄 → chat', () => {
  for (const message of ['你好', '谢谢大家', '辛苦了', 'ok thanks']) {
    assert.equal(classifyWorkspaceIntentByRules(message), 'chat', message)
  }
})

test('规则意图：空/无效 → none', () => {
  for (const message of ['', '   ', '。', '……']) {
    assert.equal(classifyWorkspaceIntentByRules(message), 'none', message)
  }
})

test('规则目标：按职责 token 匹配', () => {
  const result = pickBrainTargetAgentByRules({
    message: '后端接口超时了，帮忙看一下',
    agents,
  })
  assert.equal(result.targetAgentId, 'agent-backend')
  assert.ok(result.confidence >= 0.5)
})

test('规则目标：无匹配回落群负责人', () => {
  const result = pickBrainTargetAgentByRules({
    message: '随便聊聊今天的天气',
    agents,
    orchestratorAgentId: 'agent-frontend',
  })
  assert.equal(result.targetAgentId, 'agent-frontend')
})

test('规则目标：负责人不在群内则无目标', () => {
  const result = pickBrainTargetAgentByRules({
    message: '随便聊聊今天的天气',
    agents,
    orchestratorAgentId: 'agent-not-in-group',
  })
  assert.equal(result.targetAgentId, undefined)
})

test('规则完整决策：task_request → run_agent', () => {
  const decision = buildWorkspaceBrainDecisionByRules({
    message: '修一下后端报错',
    agents,
    orchestratorAgentId: 'agent-backend',
  })
  assert.equal(decision.intent, 'task_request')
  assert.equal(decision.action.kind, 'run_agent')
  assert.equal(decision.source, 'rules')
  if (decision.action.kind === 'run_agent') {
    assert.equal(decision.action.targetAgentId, 'agent-backend')
  }
})

test('规则完整决策：question → none（仅记录，不直答）', () => {
  const decision = buildWorkspaceBrainDecisionByRules({
    message: '今天天气怎么样？',
    agents,
  })
  assert.equal(decision.intent, 'question')
  assert.equal(decision.action.kind, 'none')
})

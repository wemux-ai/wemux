// [INPUT]: HostedModelGate 默认实现语义验证
// [OUTPUT]: 开源默认实现恒空/恒不可用（消失类语义）的回归防线
// [POS]: gate 语义单测——公开版 BYOK 链路依赖「hosted 恒 null 回退」，语义漂移在此拦截。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getHostedModelGate,
  openSourceHostedModelGate,
  registerHostedModelGate,
} from './hosted-model-gate'

test('open source default gate returns empty hosted catalog options', async () => {
  const options = await openSourceHostedModelGate.listExecutionModelOptions()
  assert.deepEqual(options, [])
})

test('open source default gate reports every model as non-hosted', async () => {
  assert.equal(await openSourceHostedModelGate.isHostedExecutionModel('hosted/gpt-5'), false)
  assert.equal(await openSourceHostedModelGate.isHostedExecutionModel('openai/gpt-5'), false)
  assert.equal(await openSourceHostedModelGate.isHostedExecutionModel(undefined), false)
  assert.equal(await openSourceHostedModelGate.isHostedExecutionModel(null), false)
})

test('open source default gate resolves to null so BYOK fallback stays intact', async () => {
  const resolution = await openSourceHostedModelGate.resolveModelRuntime({
    agentType: 'Pi',
    executionModel: 'hosted/gpt-5',
    fallbackExecutionModel: 'openai/gpt-5',
  })
  assert.equal(resolution, null)
})

test('registerHostedModelGate injects a private implementation and getter reflects it', async () => {
  const custom = {
    listExecutionModelOptions: async () => [{ id: 'hosted/x', label: 'x', providerId: 'hosted', modelId: 'x', source: 'hosted' as const }],
    isHostedExecutionModel: async (executionModel?: string | null) => executionModel === 'hosted/x',
    resolveModelRuntime: async () => null,
  }
  registerHostedModelGate(custom)
  try {
    assert.equal(getHostedModelGate(), custom)
    assert.deepEqual(await getHostedModelGate().listExecutionModelOptions(), await custom.listExecutionModelOptions())
    assert.equal(await getHostedModelGate().isHostedExecutionModel('hosted/x'), true)
  } finally {
    // 恢复默认，避免污染同进程其他用例
    registerHostedModelGate(openSourceHostedModelGate)
  }
  assert.equal(getHostedModelGate(), openSourceHostedModelGate)
})

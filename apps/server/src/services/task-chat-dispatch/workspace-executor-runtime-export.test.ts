// [INPUT]: requestRuntimeModelExport 的快速路径行为验证（模型库先出 + worker 运行时模型后台补全）。
// [OUTPUT]: grace 超时 pending、后台补全缓存、阻塞路径与失败传播断言。
// [POS]: workspace-executor 运行时模型导出逻辑的单元测试（stub executorWsService，不依赖 Postgres）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { requestRuntimeModelExport } from './workspace-executor'

const originalRequestConfigExport = executorWsService.requestConfigExport

test.after(() => {
  executorWsService.requestConfigExport = originalRequestConfigExport
})

const exportResult = {
  defaultModel: 'opencode/gpt-5.4',
  at: new Date().toISOString(),
}

const SLOW_EXPORT_MS = 200

const stubRequestConfigExport = (behavior: 'fast' | 'slow' | 'fail') => {
  executorWsService.requestConfigExport = (async () => {
    if (behavior === 'fail') {
      throw new Error('执行节点当前不在线。')
    }
    if (behavior === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, SLOW_EXPORT_MS))
    }
    return exportResult
  }) as typeof executorWsService.requestConfigExport
}

test('grace path returns pending while the export keeps running and later fills the cache', async () => {
  stubRequestConfigExport('slow')

  const first = await requestRuntimeModelExport(
    { userId: 'grace-user', executorId: 'grace-exec', agentType: 'OpenCode' },
    { graceMs: 20 },
  )
  assert.equal(first.pending, true)
  assert.equal(first.exported, null)

  // 后台导出完成后，后续请求应命中缓存且不再触发 pending。
  await new Promise((resolve) => setTimeout(resolve, SLOW_EXPORT_MS + 100))
  const second = await requestRuntimeModelExport(
    { userId: 'grace-user', executorId: 'grace-exec', agentType: 'OpenCode' },
    { graceMs: 20 },
  )
  assert.equal(second.pending, false)
  assert.equal(second.exported?.defaultModel, exportResult.defaultModel)
})

test('blocking path awaits the export and returns the full result', async () => {
  stubRequestConfigExport('fast')

  const result = await requestRuntimeModelExport(
    { userId: 'block-user', executorId: 'block-exec', agentType: 'Codex' },
  )
  assert.equal(result.pending, false)
  assert.equal(result.exported?.defaultModel, exportResult.defaultModel)
})

test('failure propagates in blocking path and never marks pending', async () => {
  stubRequestConfigExport('fail')

  await assert.rejects(
    requestRuntimeModelExport(
      { userId: 'fail-user', executorId: 'fail-exec', agentType: 'ClaudeCode' },
    ),
    /执行节点当前不在线/,
  )
})

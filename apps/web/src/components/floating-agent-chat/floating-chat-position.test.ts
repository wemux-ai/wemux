import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampFabPosition, FAB_MARGIN, FAB_SIZE, readPersistedFabPosition } from './floating-chat-position'

test('clampFabPosition 将 FAB 吸附在视口内（起点 + 位移）', () => {
  const result = clampFabPosition({
    startLeft: 100,
    startTop: 100,
    deltaX: 30,
    deltaY: 40,
    viewportWidth: 1000,
    viewportHeight: 800,
  })
  assert.deepEqual(result, { x: 130, y: 140 })
})

test('clampFabPosition 超出右/下边界时吸附到最大边界', () => {
  const result = clampFabPosition({
    startLeft: 500,
    startTop: 500,
    deltaX: 10000,
    deltaY: 10000,
    viewportWidth: 800,
    viewportHeight: 600,
  })
  assert.equal(result.x, 800 - FAB_SIZE - FAB_MARGIN)
  assert.equal(result.y, 600 - FAB_SIZE - FAB_MARGIN)
})

test('clampFabPosition 超出左/上边界时吸附到最小边距', () => {
  const result = clampFabPosition({
    startLeft: 10,
    startTop: 10,
    deltaX: -10000,
    deltaY: -10000,
    viewportWidth: 800,
    viewportHeight: 600,
  })
  assert.equal(result.x, FAB_MARGIN)
  assert.equal(result.y, FAB_MARGIN)
})

test('clampFabPosition 极小视口时仍不越界', () => {
  const result = clampFabPosition({
    startLeft: 0,
    startTop: 0,
    deltaX: 0,
    deltaY: 0,
    viewportWidth: 10,
    viewportHeight: 10,
  })
  assert.equal(result.x, FAB_MARGIN)
  assert.equal(result.y, FAB_MARGIN)
})

test('readPersistedFabPosition 在无 window 环境返回 null', () => {
  assert.equal(readPersistedFabPosition(), null)
})

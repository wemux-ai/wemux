// [INPUT]: 全局搜索纯逻辑输入
// [OUTPUT]: 分组拍平 / 选中移动 / 快捷键判定行为断言
// [POS]: global-search-nav 纯函数测试；不依赖 DOM/React
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import type { GlobalSearchResult } from '@shared/types'
import {
  flattenGroupedResults,
  moveSelectionIndex,
  resolveGlobalSearchShortcut,
  resolveInitialSelectionIndex,
} from './global-search-nav'

const result = (type: GlobalSearchResult['type'], id: string): GlobalSearchResult => ({
  type,
  id,
  title: `title-${id}`,
  snippet: '',
  route: '/',
})

test('flattenGroupedResults 按固定分组顺序拍平', () => {
  const results: GlobalSearchResult[] = [
    result('task', 't1'),
    result('chat', 'c1'),
    result('agent', 'a1'),
    result('task', 't2'),
  ]
  const flat = flattenGroupedResults(results)
  assert.deepEqual(
    flat.map((entry) => `${entry.group}:${entry.result.id}`),
    ['chat:c1', 'agent:a1', 'task:t1', 'task:t2'],
  )
})

test('flattenGroupedResults 空数组', () => {
  assert.deepEqual(flattenGroupedResults([]), [])
})

test('moveSelectionIndex 循环移动', () => {
  assert.equal(moveSelectionIndex(0, 5, 1), 1)
  assert.equal(moveSelectionIndex(4, 5, 1), 0)
  assert.equal(moveSelectionIndex(0, 5, -1), 4)
  assert.equal(moveSelectionIndex(-1, 5, 1), 0)
  assert.equal(moveSelectionIndex(-1, 5, -1), 4)
  assert.equal(moveSelectionIndex(0, 0, 1), -1)
})

test('resolveInitialSelectionIndex 首项选中', () => {
  assert.equal(resolveInitialSelectionIndex(3), 0)
  assert.equal(resolveInitialSelectionIndex(0), -1)
})

test('resolveGlobalSearchShortcut：Cmd/Ctrl+K 开合', () => {
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'k', code: 'KeyK' }), 'toggle')
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'k', code: 'KeyK' }), 'toggle')
  // repeat / 组合键 / 已处理事件不触发
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'k', code: 'KeyK', repeat: true }), null)
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 'k', code: 'KeyK' }), null)
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'k', code: 'KeyK', defaultPrevented: true }), null)
})

test('resolveGlobalSearchShortcut：Ctrl+F 仅在非输入态接管', () => {
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'f', code: 'KeyF' }), 'toggle')
  assert.equal(
    resolveGlobalSearchShortcut({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: 'f',
      code: 'KeyF',
      target: { tagName: 'INPUT' },
    }),
    null,
  )
  assert.equal(
    resolveGlobalSearchShortcut({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: 'f',
      code: 'KeyF',
      target: { isContentEditable: true },
    }),
    null,
  )
  // Mac 上 Cmd+F 放行（浏览器/编辑器查找），只有 Ctrl+F 接管
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'f', code: 'KeyF' }), null)
})

test('resolveGlobalSearchShortcut：普通键不触发', () => {
  assert.equal(resolveGlobalSearchShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'a' }), null)
})

// [INPUT]: 无（纯函数测试）
// [OUTPUT]: isMarkdown 后缀匹配断言
// [POS]: 回归 BUG-04——.md 预览必须走 Markdown 渲染分支（正常命名文件此前被 /^\.md$/ 排除）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMarkdown } from './drive-file-preview'

const mdFile = (name: string) => ({ name, contentType: 'document' as const, mimeType: null, id: 'f', sizeBytes: 0, updatedAt: '', workspaceId: null, parentId: null })

test('isMarkdown：正常命名 .md 文件命中（BUG-04 回归）', () => {
  assert.equal(isMarkdown(mdFile('voice19-doc-test.md')), true)
  assert.equal(isMarkdown(mdFile('README.md')), true)
  assert.equal(isMarkdown(mdFile('docs/GUIDE.MD')), true)
})

test('isMarkdown：.markdown 后缀命中', () => {
  assert.equal(isMarkdown(mdFile('notes.markdown')), true)
})

test('isMarkdown：非 md 文件不命中', () => {
  assert.equal(isMarkdown(mdFile('index.tsx')), false)
  assert.equal(isMarkdown(mdFile('file.txt')), false)
  assert.equal(isMarkdown(mdFile('.md')), true) // 旧正则唯一命中场景仍成立
})

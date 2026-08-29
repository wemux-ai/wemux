import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_NOTES_FOLDER_NAME, sanitizeNoteTitle } from './floating-notes-panel'

test('默认便签目录名', () => {
  assert.equal(DEFAULT_NOTES_FOLDER_NAME, '便签笔记')
})

test('sanitizeNoteTitle 去除路径分隔符与非法字符', () => {
  assert.equal(sanitizeNoteTitle('a/b\\c:d*e?f"g<h>i|j', 'fallback'), 'abcdefghij')
  assert.equal(sanitizeNoteTitle('  快速 记录  ', 'fallback'), '快速 记录')
})

test('sanitizeNoteTitle 去掉 .md 扩展名', () => {
  assert.equal(sanitizeNoteTitle('README.md', 'fallback'), 'README')
  assert.equal(sanitizeNoteTitle('notes.markdown', 'fallback'), 'notes')
})

test('sanitizeNoteTitle 空标题回退默认名', () => {
  assert.equal(sanitizeNoteTitle('   ', '未命名笔记'), '未命名笔记')
  assert.equal(sanitizeNoteTitle('///', '未命名笔记'), '未命名笔记')
})

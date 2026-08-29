import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TaskCommentMarkdown } from './task-comment-markdown'

test('TaskCommentMarkdown renders GitHub-flavored comment formatting', () => {
  const markup = renderToStaticMarkup(
    <TaskCommentMarkdown content={'**重点**\n\n- 第一项\n- 第二项\n\n`inline code`\n\n[详情](https://example.com)\n\n| 名称 | 状态 |\n| --- | --- |\n| Timeline | 已创建 |\n\n<script>alert(1)</script>'} />,
  )

  assert.match(markup, /<strong[^>]*>重点<\/strong>/)
  assert.match(markup, /<ul[^>]*>/)
  assert.match(markup, /<code[^>]*>inline code<\/code>/)
  assert.match(markup, /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer"/)
  assert.match(markup, /<table[^>]*>/)
  assert.doesNotMatch(markup, /<script/i)
})

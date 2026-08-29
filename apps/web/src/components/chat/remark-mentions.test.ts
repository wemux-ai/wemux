import assert from 'node:assert/strict'
import test from 'node:test'

import { remarkMentions } from './remark-mentions'

type AnyNode = {
  type: string
  value?: string
  children?: AnyNode[]
  data?: Record<string, unknown>
  [key: string]: unknown
}

test('splits @member text into mention nodes, keeping all occurrences', () => {
  const tree: AnyNode = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Hi @Ada please review, and @Ada again.' },
        ],
      },
    ],
  }

  remarkMentions([{ id: 'user-1', name: 'Ada' }])()(tree as never)

  const children = (tree.children![0] as AnyNode).children!
  assert.equal(children.length, 5)
  assert.deepEqual(
    children.map((child) => child.type),
    ['text', 'mention', 'text', 'mention', 'text'],
  )
  assert.equal(children[0]!.value, 'Hi ')
  assert.equal(children[1]!.value, '@Ada')
  assert.deepEqual((children[1]!.data as AnyNode).hProperties, { userId: 'user-1', name: 'Ada', avatarUrl: '' })
  assert.equal(children[2]!.value, ' please review, and ')
  assert.equal(children[3]!.value, '@Ada')
  assert.equal(children[4]!.value, ' again.')
})

test('handles mentions inside nested inline nodes and leaves substrings untouched', () => {
  const tree: AnyNode = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'cc ' },
          {
            type: 'strong',
            children: [{ type: 'text', value: '@Ada' }],
          },
          { type: 'text', value: ' and @Developer is not a mention' },
        ],
      },
    ],
  }

  remarkMentions([{ id: 'user-1', name: 'Ada' }])()(tree as never)

  const paragraph = tree.children![0] as AnyNode
  const strong = paragraph.children![1] as AnyNode
  assert.equal(strong.children![0]!.type, 'mention')
  assert.deepEqual((strong.children![0]!.data as AnyNode).hProperties, { userId: 'user-1', name: 'Ada', avatarUrl: '' })

  // '@Developer'（@Ada 的子串前缀）不应命中；尾段保持纯文本。
  const tail = paragraph.children![2] as AnyNode
  assert.equal(tail.type, 'text')
  assert.equal(tail.value, ' and @Developer is not a mention')
})

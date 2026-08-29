// [INPUT]: 成员 mention 目标（id=userId / name）
// [OUTPUT]: remark 插件：把 mdast 文本节点里的 `@成员名` 切成 `mention` 自定义节点（data.hName/hProperties）
// [POS]: 聊天正文 markdown 的 mention 高亮预处理；复用 shared 的 resolveChatMentionRanges，与派发目标一致
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveChatMentionRanges, type ChatMentionTarget as SharedChatMentionTarget } from '@shared/chat-mentions'
import type { ChatMentionTarget } from './mention-text'

type MdastNode = {
  type: string
  value?: string
  children?: MdastNode[]
  data?: Record<string, unknown>
  [key: string]: unknown
}

type TextRef = { parent: MdastNode; index: number; node: MdastNode }

const collectTextNodes = (node: MdastNode, refs: TextRef[]): void => {
  if (node.type === 'text') {
    return
  }
  const children = node.children
  if (!children) {
    return
  }
  children.forEach((child, index) => {
    if (child.type === 'text') {
      refs.push({ parent: node, index, node: child })
    } else {
      collectTextNodes(child, refs)
    }
  })
}

/**
 * 把 `@成员名` 文本切分为 `mention` 节点。所有命中都高亮（渲染），不做「去重只取一次」——
 * 那套语义属于 dispatch（resolveChatMentionTargetIds），这里只负责展示。
 */
export const remarkMentions = (targets: readonly ChatMentionTarget[]) => {
  const sharedTargets: SharedChatMentionTarget[] = targets.map((target) => ({ id: target.id, name: target.name }))
  const targetById = new Map(targets.map((target) => [target.id, target] as const))

  return () => (tree: MdastNode) => {
    if (sharedTargets.length === 0) {
      return
    }

    const refs: TextRef[] = []
    collectTextNodes(tree, refs)

    // 倒序处理：同一 parent 内的文本节点从右往左切，避免前一次 splice 挪动后续 index。
    for (const ref of refs.reverse()) {
      const value = ref.node.value ?? ''
      const ranges = resolveChatMentionRanges(value, sharedTargets)
      if (ranges.length === 0) {
        continue
      }

      const segments: MdastNode[] = []
      let cursor = 0
      for (const range of ranges) {
        if (range.start > cursor) {
          segments.push({ type: 'text', value: value.slice(cursor, range.start) })
        }
        const target = targetById.get(range.targetId)
        if (target) {
          segments.push({
            type: 'mention',
            value: value.slice(range.start, range.end),
            data: {
              hName: 'mention',
              hProperties: {
                userId: target.id,
                name: target.name,
                avatarUrl: target.avatarUrl ?? '',
              },
            },
          })
        } else {
          segments.push({ type: 'text', value: value.slice(range.start, range.end) })
        }
        cursor = range.end
      }
      if (cursor < value.length) {
        segments.push({ type: 'text', value: value.slice(cursor) })
      }

      ref.parent.children!.splice(ref.index, 1, ...segments)
    }
  }
}

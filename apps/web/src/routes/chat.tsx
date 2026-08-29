// [INPUT]: 聊天请求
// [OUTPUT]: 聊天页
// [POS]: 主聊天页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { ChatRoutePage } from './-chat-route/chat-route'

export const Route = createFileRoute('/chat' as never)({
  component: ChatRoutePage,
})

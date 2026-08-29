// [INPUT]: 对象身份（user/agent + id + 展示名/头像）+ 子节点
// [OUTPUT]: 按身份包 UserCardPopover / AgentCardPopover（hover/click），无法识别时原样渲染
// [POS]: 列表/卡片等各类头像的统一卡片入口；聊天消息头像走 ChatMessageItem 自带的 card props
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'
import { AgentCardPopover } from './agent-card-popover'
import { UserCardPopover } from './user-card-popover'

export function IdentityCardWrapper({
  kind,
  id,
  name,
  avatarUrl,
  triggerMode = 'hover',
  children,
}: {
  kind?: 'user' | 'agent' | 'system' | null
  id?: string | null
  name?: string
  avatarUrl?: string | null
  triggerMode?: 'hover' | 'click'
  children: ReactNode
}) {
  if (kind === 'agent' && id) {
    return (
      <AgentCardPopover agentId={id} name={name} avatarUrl={avatarUrl} triggerMode={triggerMode}>
        {children}
      </AgentCardPopover>
    )
  }

  if (kind === 'user' && id) {
    return (
      <UserCardPopover userId={id} name={name} avatarUrl={avatarUrl} triggerMode={triggerMode}>
        {children}
      </UserCardPopover>
    )
  }

  return <>{children}</>
}

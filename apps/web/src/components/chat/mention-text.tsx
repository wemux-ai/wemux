// [INPUT]: remark 插件产出的 mention 节点 props（userId / name / avatarUrl / 文本 children）
// [OUTPUT]: 成员 mention 蓝色 chip + 悬停用户卡片（hover）+ 点击跳详情
// [POS]: 聊天正文 mention 渲染；member 走 UserCardPopover，agent/其他保持纯文本（由上游 remark-mentions 决定）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'
import { UserCardPopover } from '../profiles/user-card-popover'

export type ChatMentionTarget = {
  /** 成员 userId（UserCardPopover 的 userId） */
  id: string
  name: string
  avatarUrl?: string
}

/**
 * remark-mentions 插件把 `@成员名` 转成 `mention` 节点，hProperties 落到这些 props。
 * 渲染为可悬停 chip；点击跳详情由 UserCardPopover hover 模式内的 Link 承担。
 */
export function MentionNode({
  userId,
  name,
  avatarUrl,
  children,
}: {
  userId?: string
  name?: string
  avatarUrl?: string
  children?: ReactNode
}) {
  if (!userId) {
    return <>{children}</>
  }

  return (
    <UserCardPopover
      userId={userId}
      name={name}
      avatarUrl={avatarUrl || undefined}
      triggerMode="hover"
    >
      <span className="mx-0.5 inline-flex cursor-pointer items-center rounded bg-sky-500/10 px-1 font-medium text-sky-300 transition-colors hover:bg-sky-500/20">
        {children}
      </span>
    </UserCardPopover>
  )
}

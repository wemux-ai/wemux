// [INPUT]: userId 路由参数 + 画像 API
// [OUTPUT]: 用户画像页（本人可编辑，他人只读）
// [POS]: 用户画像页；可见性隔离由服务端保证
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { UserProfileCard } from '../components/profiles/user-profile-card'
import { TimelineSection } from '../components/profiles/user-timeline-section'

export const Route = createFileRoute('/profile/$userId')({
  component: ProfileRoute,
})

function ProfileRoute() {
  const { userId } = Route.useParams()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-900 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-zinc-100">用户画像</h1>
        <span className="ml-auto text-[11px] text-zinc-600">职位 · 技能 · 简介 · 最近工作 · 时间线</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <UserProfileCard userId={userId} />
          <TimelineSection targetType="user" targetId={userId} />
        </div>
      </div>
    </div>
  )
}

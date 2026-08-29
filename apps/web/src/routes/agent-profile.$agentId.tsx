// [INPUT]: agentId 路由参数 + Agent 画像 API
// [OUTPUT]: Agent 画像页（owner 可编辑身份描述，他人只读）
// [POS]: Agent 画像页；可见性隔离由服务端保证
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { AgentProfileCard } from '../components/profiles/agent-profile-card'
import { TimelineSection } from '../components/profiles/user-timeline-section'

export const Route = createFileRoute('/agent-profile/$agentId')({
  component: AgentProfileRoute,
})

function AgentProfileRoute() {
  const { agentId } = Route.useParams()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-900 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-zinc-100">Agent 画像</h1>
        <span className="ml-auto text-[11px] text-zinc-600">身份描述 · 专长 · 健康度 · 时间线</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <AgentProfileCard agentId={agentId} />
          <TimelineSection targetType="agent" targetId={agentId} />
        </div>
      </div>
    </div>
  )
}

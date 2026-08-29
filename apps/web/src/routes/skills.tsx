// [INPUT]: 技能请求
// [OUTPUT]: 技能页
// [POS]: Skills 页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { SkillsPage } from '../components/skills/skills-page'
import { useApp } from '../lib/app-provider'

export const Route = createFileRoute('/skills')({
  component: SkillsRoute,
})

function SkillsRoute() {
  const { busy } = useApp()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SkillsPage busy={busy} />
    </div>
  )
}

// [INPUT]: 用量统计请求
// [OUTPUT]: 用量统计页（个人 / Agent / 团队三视角）
// [POS]: Token 用量看板页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const UsagePage = lazy(() => import('../components/usage/usage-page').then((module) => ({ default: module.UsagePage })))

export const Route = createFileRoute('/usage')({
  component: UsageRoute,
})

function UsageRoute() {
  return (
    <Suspense fallback={null}>
      <UsagePage />
    </Suspense>
  )
}

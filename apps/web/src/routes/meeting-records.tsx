// [INPUT]: 会议记录查看请求
// [OUTPUT]: /meeting-records 路由
// [POS]: 会议智能（feature）web 查看页入口
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { lazy, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const MeetingRecordsPage = lazy(() =>
  import('../components/meeting-records/meeting-records-page').then((module) => ({ default: module.MeetingRecordsPage })),
)

export const Route = createFileRoute('/meeting-records')({
  component: MeetingRecordsRoute,
})

function MeetingRecordsRoute() {
  return (
    <Suspense fallback={null}>
      <MeetingRecordsPage />
    </Suspense>
  )
}

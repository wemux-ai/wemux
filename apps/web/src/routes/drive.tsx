// [INPUT]: Drive 请求
// [OUTPUT]: Drive 云盘页（协作目录 + 个人目录 双区树）
// [POS]: Drive 云盘页；协作目录绑定全局当前组织（getStoredCollaborationWorkspaceId）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { DrivePage } from '../components/drive/drive-page'

export const Route = createFileRoute('/drive')({
  component: DriveRoute,
})

function DriveRoute() {
  return <DrivePage />
}

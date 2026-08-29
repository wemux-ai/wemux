// [INPUT]: 总账号体系设置请求
// [OUTPUT]: /admin/settings 路由
// [POS]: 总账号体系设置页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { AdminSettingsPage } from '@/components/admin/admin-settings-page'

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsRoute,
})

function AdminSettingsRoute() {
  return <AdminSettingsPage />
}

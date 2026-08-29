// [INPUT]: 用户管理请求
// [OUTPUT]: /admin/users 路由
// [POS]: 用户管理页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { AdminUsersPage } from '@/components/admin/admin-users-page'

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersRoute,
})

function AdminUsersRoute() {
  return <AdminUsersPage />
}

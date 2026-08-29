import { createFileRoute } from '@tanstack/react-router'
import { AdminNodesPage } from '@/components/admin/admin-nodes-page'

export const Route = createFileRoute('/admin/nodes')({
  component: AdminNodesPage,
})

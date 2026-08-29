import { createFileRoute } from '@tanstack/react-router'
import { AdminFeedbackPage } from '@/components/admin/admin-feedback-page'

export const Route = createFileRoute('/admin/feedback')({
  component: AdminFeedbackRoute,
})

function AdminFeedbackRoute() {
  return <AdminFeedbackPage />
}

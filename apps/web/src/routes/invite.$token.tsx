// [INPUT]: 邀请 token
// [OUTPUT]: 邀请接受页
// [POS]: 邀请页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { useAuth } from '../lib/auth-context'
import { useTranslation } from '../lib/i18n/react'
import { buildNoIndexHead } from '../lib/marketing-site'

export const Route = createFileRoute('/invite.$token' as never)({
  head: () => buildNoIndexHead({
    title: 'Wemux Team Invitation',
    description: 'Accept a private Wemux workspace invitation. Invitation pages are not meant to appear in search results.',
  }),
  component: InviteRoute,
})

function InviteRoute() {
  const { t } = useTranslation()
  const { token } = Route.useParams() as { token: string }
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [teamName, setTeamName] = useState('')
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    void api.verifyInvitation(token)
      .then((response) => {
        if (!response.valid) {
          setError(response.message || t('invite.invalid', { defaultValue: '邀请无效' }))
          return
        }
        setTeamName(response.invitation?.teamName || '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('invite.verifyFailed', { defaultValue: '邀请验证失败' })))
      .finally(() => setLoading(false))
  }, [t, token])

  const handleAccept = async () => {
    try {
      await api.acceptInvitation(token)
      setAccepted(true)
      // 自有 telemetry：邀请被接受（邀请链路漏斗节点）
      void api.trackEvent({ eventType: 'invite_used', payload: { token } }).catch(() => undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invite.acceptFailed', { defaultValue: '接受邀请失败' }))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t('invite.title', { defaultValue: '组织邀请' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" size={16} />{t('invite.verifying', { defaultValue: '正在验证邀请...' })}</div>}
          {!loading && error && <div className="flex items-center gap-2 text-sm text-rose-600"><XCircle size={16} />{error}</div>}
          {!loading && !error && !accepted && (
            <>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t('invite.received', { defaultValue: '你已收到组织邀请' })}</p>
                <p className="text-lg font-semibold">{teamName || t('invite.unnamedTeam', { defaultValue: '未命名组织' })}</p>
                <p className="text-sm text-muted-foreground">{t('invite.currentUser', { defaultValue: '当前登录用户：{{email}}', email: user?.email || t('invite.notLoggedIn', { defaultValue: '未登录' }) })}</p>
              </div>
              <div className="flex gap-2">
                <Button disabled={!user} onClick={() => void handleAccept()}>{t('invite.accept', { defaultValue: '接受邀请' })}</Button>
                {!user && <a className="inline-flex items-center text-sm text-primary underline" href="/login">{t('invite.loginFirst', { defaultValue: '先登录再接受' })}</a>}
              </div>
            </>
          )}
          {accepted && <div className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 size={16} />{t('invite.accepted', { defaultValue: '邀请已接受，返回设置页的组织管理查看。' })}</div>}
        </CardContent>
      </Card>
    </div>
  )
}

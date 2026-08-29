// [INPUT]: /api/admin/users/* 数据
// [OUTPUT]: /admin/users 用户管理页（列表 + 详情 + 状态/角色/配额/用量/订阅/登录记录/产出视图）
// [POS]: admin 用户管理 UI；权限以 server 为准
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, UserX, UserCheck, Shield, KeyRound, RefreshCw, Ban, Power, LogOut, Save, X, AlertTriangle, Layers, Boxes, Bot, CreditCard, ScrollText, History, MessageSquareText } from 'lucide-react'
import type { AdminAuthEventRecord, AdminUserActivityResponse, AdminUserAuditResponse, AdminUserDetailResponse, AdminUserRecord } from '@/lib/api/types'
import type { FeedbackItem } from '@shared/types'
import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { useTranslation } from '@/lib/i18n/react'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Input } from '@/components/ui-admin/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui-admin/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui-admin/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui-admin/tabs'
import { formatDate } from '@/lib/utils'
import { PageContainer, PageHeader, StatsGrid, EmptyState } from './page-container'
import { cn } from '@/lib/utils'

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  suspended: 'secondary',
  banned: 'destructive',
}

const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'secondary',
  user: 'outline',
}

const TASK_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  done: 'default',
  in_review: 'secondary',
  in_progress: 'secondary',
  todo: 'outline',
  backlog: 'outline',
  blocked: 'destructive',
  cancelled: 'destructive',
}

const formatTokens = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—'
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

const auditEventLabel = (eventType: string) => i18n.t(`admin.users.auditEvent${eventType.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`, { defaultValue: eventType })

const formatAuditPayload = (payload: Record<string, unknown>) => {
  const parts: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'targetUserId') continue
    if (value === null || value === undefined || value === '') continue
    parts.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
  }
  return parts.join(' · ').slice(0, 120)
}

const feedbackStatusLabel = (status: string) => i18n.t(`feedback.status.${status}`, { defaultValue: status })

const feedbackTypeLabel = (type: string) => {
  if (type === 'chat') return i18n.t('admin.users.feedbackTypeChat')
  return i18n.t(`feedback.type.${type}`, { defaultValue: type })
}

const noteStatusLabel = (status: string) => i18n.t(`admin.users.note${status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`, { defaultValue: status })

export function AdminUsersPage() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AdminUserDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [usagePeriod, setUsagePeriod] = useState<'7d' | '30d' | 'all'>('30d')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.listUsers({
        q: searchQuery || undefined,
        status: statusFilter,
        role: roleFilter,
        limit: 50,
      })
      setUsers(response.users)
      setTotal(response.total)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('admin.users.loadListFailed'))
    } finally {
      setLoading(false)
    }
  }, [searchQuery, statusFilter, roleFilter])

  useEffect(() => {
    void load()
  }, [load])

  const loadDetail = async (userId: string, period: '7d' | '30d' | 'all' = usagePeriod) => {
    setDetailLoading(true)
    try {
      setSelected(await api.getUserDetail(userId, period))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('admin.users.loadDetailFailed'))
    } finally {
      setDetailLoading(false)
    }
  }

  const stats = useMemo(() => ({
    total,
    active: users.filter((user) => user.status === 'active').length,
    suspended: users.filter((user) => user.status === 'suspended').length,
    banned: users.filter((user) => user.status === 'banned').length,
  }), [users, total])

  return (
    <PageContainer>
      <PageHeader
        title={t('admin.users.title')}
        description={t('admin.users.subtitle')}
      />

      <StatsGrid>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t('admin.users.totalUsers')}</CardDescription><CardTitle className="text-2xl">{total}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t('admin.users.activeLoaded')}</CardDescription><CardTitle className="text-2xl">{stats.active}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t('admin.users.suspended')}</CardDescription><CardTitle className="text-2xl">{stats.suspended}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>{t('admin.users.banned')}</CardDescription><CardTitle className="text-2xl">{stats.banned}</CardTitle></CardHeader>
        </Card>
      </StatsGrid>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('admin.users.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? 'all')}>
          <SelectTrigger className="w-36"><SelectValue placeholder={t('admin.users.status')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('admin.users.active')}</SelectItem>
            <SelectItem value="suspended">{t('admin.users.suspended')}</SelectItem>
            <SelectItem value="banned">{t('admin.users.banned')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value ?? 'all')}>
          <SelectTrigger className="w-36"><SelectValue placeholder={t('admin.users.role')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.allRoles')}</SelectItem>
            <SelectItem value="user">{t('admin.users.userRole')}</SelectItem>
            <SelectItem value="admin">{t('admin.users.adminRole')}</SelectItem>
            <SelectItem value="owner">{t('admin.users.ownerRole')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => void load()} title={t('admin.users.refresh')}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      {loading ? (
        <EmptyState icon={Search} title={t('admin.users.loadingUsers')} description="" />
      ) : users.length === 0 ? (
        <EmptyState icon={UserX} title={t('admin.users.noUsers')} description={t('admin.users.noUsersDesc')} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.users.colUser')}</TableHead>
                  <TableHead>{t('admin.users.colStatus')}</TableHead>
                  <TableHead>{t('admin.users.colRole')}</TableHead>
                  <TableHead>{t('admin.users.colProvider')}</TableHead>
                  <TableHead>{t('admin.users.colPlan')}</TableHead>
                  <TableHead>{t('admin.users.colLastLogin')}</TableHead>
                  <TableHead>{t('admin.users.colRegistered')}</TableHead>
                  <TableHead className="text-right">{t('admin.users.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className="cursor-pointer" onClick={() => void loadDetail(user.id)}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : user.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{user.name}{user.isInternal ? ' ⭐' : ''}</p>
                          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANTS[user.status] || 'secondary'}>{user.status}</Badge></TableCell>
                    <TableCell><Badge variant={ROLE_VARIANTS[user.role] || 'outline'}>{user.role}</Badge></TableCell>
                    <TableCell><span className="text-sm text-muted-foreground">{user.authProvider || '—'}</span></TableCell>
                    <TableCell><span className="text-sm">{user.plan || '—'}</span></TableCell>
                    <TableCell><span className="text-xs text-muted-foreground">{user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'}</span></TableCell>
                    <TableCell><span className="text-xs text-muted-foreground">{formatDate(user.createdAt ?? '')}</span></TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); void loadDetail(user.id) }}>{t('admin.users.detail')}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selected ? (
        <UserDetailDrawer
          detail={selected}
          loading={detailLoading}
          onClose={() => setSelected(null)}
          onChanged={() => { void load(); void loadDetail(selected.user.id, usagePeriod) }}
          onPeriodChange={(period) => { setUsagePeriod(period); void loadDetail(selected.user.id, period) }}
        />
      ) : null}
    </PageContainer>
  )
}

function UserDetailDrawer({
  detail,
  loading,
  onClose,
  onChanged,
  onPeriodChange,
}: {
  detail: AdminUserDetailResponse
  loading: boolean
  onClose: () => void
  onChanged: () => void
  onPeriodChange: (period: '7d' | '30d' | 'all') => void
}) {
  const { t } = useTranslation()
  const { user, billing, tokenQuota, quotaSnapshot, usage, overview, authEvents, dailyActivity, teams } = detail
  const [statusBusy, setStatusBusy] = useState(false)
  const [roleBusy, setRoleBusy] = useState(false)
  const [quotaLimit, setQuotaLimit] = useState(String(tokenQuota?.limitTokens ?? 0))
  const [quotaPeriod, setQuotaPeriod] = useState<'day' | 'month'>(tokenQuota?.period ?? 'month')
  const [quotaAction, setQuotaAction] = useState<'warn' | 'block'>(tokenQuota?.action ?? 'block')
  const [quotaBusy, setQuotaBusy] = useState(false)
  const [note, setNote] = useState(user.supportNote ?? '')
  const [noteBusy, setNoteBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionInfo, setActionInfo] = useState('')
  const [activity, setActivity] = useState<AdminUserActivityResponse | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [audit, setAudit] = useState<AdminUserAuditResponse | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditLoaded, setAuditLoaded] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null)
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackLoaded, setFeedbackLoaded] = useState(false)
  const [noteStatus, setNoteStatus] = useState<'pending' | 'in_progress' | 'resolved'>(user.supportNoteStatus ?? 'pending')

  const runAction = async (action: () => Promise<unknown>, busySetter: (value: boolean) => void) => {
    setActionError('')
    setActionInfo('')
    busySetter(true)
    try {
      await action()
      setActionInfo(t('admin.users.actionSuccess'))
      onChanged()
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : t('admin.users.actionFailed'))
    } finally {
      busySetter(false)
    }
  }

  const loadActivity = async () => {
    if (activityLoaded) return
    setActionError('')
    setActivityLoading(true)
    try {
      setActivity(await api.getUserActivity(user.id))
      setActivityLoaded(true)
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : t('admin.users.loadActivityFailed'))
    } finally {
      setActivityLoading(false)
    }
  }

  const loadAudit = async () => {
    if (auditLoaded) return
    setActionError('')
    setAuditLoading(true)
    try {
      setAudit(await api.getUserAudit(user.id))
      setAuditLoaded(true)
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : t('admin.users.loadAuditFailed'))
    } finally {
      setAuditLoading(false)
    }
  }

  const loadFeedback = async () => {
    if (feedbackLoaded) return
    setActionError('')
    setFeedbackLoading(true)
    try {
      const response = await api.getUserFeedback(user.id)
      setFeedback(response.feedback)
      setFeedbackLoaded(true)
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : t('admin.users.loadFeedbackFailed'))
    } finally {
      setFeedbackLoading(false)
    }
  }

  // 备注状态随详情刷新同步（保存成功后 detail 刷新）
  useEffect(() => {
    if (user.supportNoteStatus) {
      setNoteStatus(user.supportNoteStatus)
    }
  }, [user.supportNoteStatus])

  const authStats = useMemo(() => {
    const counts = { success: 0, fail: 0, blocked: 0 }
    const byIp = new Map<string, { count: number; last: string }>()
    for (const event of authEvents) {
      if (event.result === 'success') counts.success += 1
      else if (event.result === 'fail') counts.fail += 1
      else counts.blocked += 1
      if (event.ip) {
        const entry = byIp.get(event.ip) ?? { count: 0, last: event.createdAt }
        entry.count += 1
        if (event.createdAt > entry.last) entry.last = event.createdAt
        byIp.set(event.ip, entry)
      }
    }
    return { counts, byIp: [...byIp.entries()].map(([ip, value]) => ({ ip, ...value })).sort((left, right) => right.count - left.count) }
  }, [authEvents])

  // 用户问题时间线：合并登录 / 审计 / 反馈 / 备注更新，按时间倒序
  const timeline = useMemo(() => {
    if (!audit || !feedback) return null
    const items: Array<{ time: string; kind: 'auth' | 'audit' | 'feedback' | 'note'; title: string; detail: string }> = []
    for (const event of authEvents) {
      items.push({ time: event.createdAt, kind: 'auth', title: eventLabel(event), detail: `${event.result}${event.ip ? ` · ${event.ip}` : ''}` })
    }
    for (const log of audit.logs) {
      const isNote = log.eventType === 'admin_user_note_updated'
      items.push({
        time: log.createdAt,
        kind: isNote ? 'note' : 'audit',
        title: auditEventLabel(log.eventType),
        detail: isNote
          ? String(log.payload?.note ?? '') || t('admin.users.auditEventAdminUserNoteUpdated')
          : formatAuditPayload(log.payload ?? {}),
      })
    }
    for (const item of feedback) {
      items.push({
        time: item.createdAt,
        kind: 'feedback',
        title: item.title,
        detail: `${feedbackTypeLabel(item.type)} · ${feedbackStatusLabel(item.status)}`,
      })
    }
    return items.sort((left, right) => right.time.localeCompare(left.time)).slice(0, 80)
  }, [authEvents, audit, feedback, t])

  const eventLabel = (event: AdminAuthEventRecord) => {
    const labels: Record<string, string> = {
      login_success: t('admin.users.authEventLoginSuccess'),
      login_fail: t('admin.users.authEventLoginFail'),
      register: t('admin.users.authEventRegister'),
      email_verify_requested: t('admin.users.authEventEmailVerifyRequested'),
      email_verify_success: t('admin.users.authEventEmailVerifySuccess'),
      password_reset_requested: t('admin.users.authEventPasswordResetRequested'),
      password_reset_success: t('admin.users.authEventPasswordResetSuccess'),
      token_revoked: t('admin.users.authEventTokenRevoked'),
      force_logout: t('admin.users.authEventForceLogout'),
      account_suspended: t('admin.users.authEventAccountSuspended'),
      account_banned: t('admin.users.authEventAccountBanned'),
      account_restored: t('admin.users.authEventAccountRestored'),
      role_changed: t('admin.users.authEventRoleChanged'),
      support_note_updated: t('admin.users.authEventSupportNoteUpdated'),
    }
    return labels[event.eventType] || event.eventType
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l bg-background shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : user.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-base font-semibold">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email} · {t('admin.users.registered', { date: formatDate(user.createdAt ?? '') })}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {actionError ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</div> : null}
          {actionInfo ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">{actionInfo}</div> : null}
          {loading ? <p className="text-xs text-muted-foreground">{t('admin.users.refreshing')}</p> : null}

          <Tabs defaultValue="overview" onValueChange={(value) => {
            if (value === 'activity') void loadActivity()
            if (value === 'audit') void loadAudit()
            if (value === 'feedback') void loadFeedback()
            if (value === 'timeline') {
              void loadAudit()
              void loadFeedback()
            }
          }}>
            <TabsList>
              <TabsTrigger value="overview">{t('admin.users.tabOverview')}</TabsTrigger>
              <TabsTrigger value="usage">{t('admin.users.tabUsage')}</TabsTrigger>
              <TabsTrigger value="activity">{t('admin.users.tabActivity')}</TabsTrigger>
              <TabsTrigger value="audit">{t('admin.users.tabAudit')}</TabsTrigger>
              <TabsTrigger value="feedback">{t('admin.users.tabFeedback')}</TabsTrigger>
              <TabsTrigger value="timeline">{t('admin.users.tabTimeline')}</TabsTrigger>
              <TabsTrigger value="auth">{t('admin.users.tabAuth')}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-5 pt-4">
              {/* 运营状态条：一眼看全 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <InfoCard label={t('admin.users.plan')} value={billing.plan} />
                <InfoCard label={t('admin.users.subscription')} value={overview.subscriptions.length > 0 ? t('admin.users.subscriptionsActive', { count: overview.subscriptions.length }) : t('admin.users.none')} />
                <InfoCard label={t('admin.users.quotaUsage')} value={quotaSnapshot.limitTokens ? `${formatTokens(quotaSnapshot.usedTokens)} / ${formatTokens(quotaSnapshot.limitTokens)}` : t('admin.users.noQuota')} />
                <InfoCard label={t('admin.users.onlineSessions')} value={String(overview.onlineSessions)} />
                <InfoCard label={t('admin.users.lastLogin')} value={user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'} />
              </div>

              {overview.failedLogins.last30d > 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-600">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {t('admin.users.failedLogins', { count: overview.failedLogins.last30d })}
                    {overview.failedLogins.last7d > 0 ? t('admin.users.failedLogins7d', { count: overview.failedLogins.last7d }) : ''}
                    {overview.failedLogins.lastFailedAt ? `${t('admin.users.failedLoginsLast', { date: formatDate(overview.failedLogins.lastFailedAt) })}${overview.failedLogins.lastFailedIp ? t('admin.users.fromIp', { ip: overview.failedLogins.lastFailedIp }) : ''}` : ''}
                  </span>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <InfoCard label={t('admin.users.statusLabel')} value={user.status} />
                <InfoCard label={t('admin.users.roleLabel')} value={user.role} />
                <InfoCard label={t('admin.users.authProvider')} value={user.authProvider || '—'} />
                <InfoCard label={t('admin.users.emailVerified')} value={user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : t('admin.users.no')} />
              </div>

              {/* 订阅明细：替代布尔 */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm"><CreditCard className="mr-1.5 inline h-4 w-4" />{t('admin.users.subscriptionsTitle')}</CardTitle></CardHeader>
                <CardContent>
                  {overview.subscriptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('admin.users.noSubscriptions')}</p>
                  ) : (
                    <div className="space-y-2">
                      {overview.subscriptions.map((subscription) => (
                        <div key={subscription.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{subscription.productName || subscription.id}</p>
                            <p className="text-xs text-muted-foreground">
                              {subscription.status} · {subscription.environment}
                              {subscription.currentPeriodEndAt ? t('admin.users.until', { date: formatDate(subscription.currentPeriodEndAt) }) : ''}
                              {subscription.canceledAt ? t('admin.users.canceled', { date: formatDate(subscription.canceledAt) }) : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <Badge variant={subscription.status === 'active' ? 'default' : 'secondary'}>{subscription.status}</Badge>
                            {subscription.amountPaid != null ? <p className="mt-1 text-xs text-muted-foreground">${subscription.amountPaid.toFixed(2)}</p> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.accountStatus')}</CardTitle><CardDescription>{t('admin.users.accountStatusDesc')}</CardDescription></CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  {user.status !== 'active' ? (
                    <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void runAction(
                      () => api.updateUserStatus(user.id, { status: 'active' }),
                      setStatusBusy,
                    )}>
                      <UserCheck className="mr-1.5 h-4 w-4" /> {t('admin.users.restore')}
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" disabled={statusBusy} onClick={() => void runAction(
                        () => api.updateUserStatus(user.id, { status: 'suspended' }),
                        setStatusBusy,
                      )}>
                        <Power className="mr-1.5 h-4 w-4" /> {t('admin.users.suspend')}
                      </Button>
                      <Button size="sm" variant="destructive" disabled={statusBusy} onClick={() => void runAction(
                        () => api.updateUserStatus(user.id, { status: 'banned', reason: 'Admin action' }),
                        setStatusBusy,
                      )}>
                        <Ban className="mr-1.5 h-4 w-4" /> {t('admin.users.ban')}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => void runAction(
                    () => api.revokeUserSessions(user.id),
                    setStatusBusy,
                  )}>
                    <LogOut className="mr-1.5 h-4 w-4" /> {t('admin.users.forceLogout')}
                  </Button>
                  {user.bannedReason ? <p className="w-full text-xs text-muted-foreground">{t('admin.users.banReason', { reason: user.bannedReason })}</p> : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.roleTitle')}</CardTitle><CardDescription>{t('admin.users.roleDesc')}</CardDescription></CardHeader>
                <CardContent className="flex items-center gap-2">
                  {(['user', 'admin', 'owner'] as const).map((role) => (
                    <Button key={role} size="sm" variant={user.role === role ? 'default' : 'outline'} disabled={roleBusy || user.role === role} onClick={() => void runAction(
                      () => api.updateUserRole(user.id, role),
                      setRoleBusy,
                    )}>
                      <Shield className="mr-1.5 h-4 w-4" /> {role}
                    </Button>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.supportNote')}</CardTitle><CardDescription>{t('admin.users.supportNoteDesc')}</CardDescription></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">{t('admin.users.noteStatus')}</label>
                    <Select value={noteStatus} onValueChange={(value) => setNoteStatus((value ?? 'pending') as 'pending' | 'in_progress' | 'resolved')}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">{t('admin.users.notePending')}</SelectItem>
                        <SelectItem value="in_progress">{t('admin.users.noteInProgress')}</SelectItem>
                        <SelectItem value="resolved">{t('admin.users.noteResolved')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge variant={noteStatus === 'resolved' ? 'default' : noteStatus === 'in_progress' ? 'secondary' : 'outline'}>{noteStatusLabel(noteStatus)}</Badge>
                  </div>
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder={t('admin.users.notePlaceholder')} className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
                  <Button size="sm" variant="outline" disabled={noteBusy} onClick={() => void runAction(
                    () => api.updateUserNote(user.id, note, noteStatus),
                    setNoteBusy,
                  )}>
                    <Save className="mr-1.5 h-4 w-4" /> {t('admin.users.saveNote')}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.teamsTitle')}</CardTitle></CardHeader>
                <CardContent>
                  {teams.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noTeams')}</p> : (
                    <div className="flex flex-wrap gap-2">{teams.map((team) => <Badge key={team.id} variant="outline">{team.name}</Badge>)}</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="usage" className="space-y-5 pt-4">
              <div className="flex items-center justify-between">
                <CardDescription>{t('admin.users.usageDesc')}</CardDescription>
                <Select value={usage.period} onValueChange={(value) => onPeriodChange((value ?? '30d') as '7d' | '30d' | 'all')}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">{t('admin.users.period7d')}</SelectItem>
                    <SelectItem value="30d">{t('admin.users.period30d')}</SelectItem>
                    <SelectItem value="all">{t('admin.users.periodAll')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.tokenUsage')}</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3">
                    <InfoCard label={t('admin.users.runs')} value={String(usage.totals.runCount)} />
                    <InfoCard label={t('admin.users.totalTokens')} value={formatTokens(usage.totals.totalTokens)} />
                    <InfoCard label={t('admin.users.inputOutput')} value={`${formatTokens(usage.totals.inputTokens)} / ${formatTokens(usage.totals.outputTokens)}`} />
                  </div>
                  {usage.daily.length > 0 ? (
                    <div className="mt-4 flex h-16 items-end gap-1">
                      {usage.daily.map((day) => (
                        <div key={day.date} title={`${day.date}: ${day.totalTokens} tokens`} className="flex-1 rounded-t bg-primary/60" style={{ height: `${Math.max(4, Math.min(100, (day.totalTokens / (Math.max(...usage.daily.map((d) => d.totalTokens), 1))) * 100))}%` }} />
                      ))}
                    </div>
                  ) : <p className="mt-3 text-sm text-muted-foreground">{t('admin.users.noUsage')}</p>}
                </CardContent>
              </Card>

              {/* 配额消费比 */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.quotaConsumption')}</CardTitle><CardDescription>{quotaSnapshot.message}</CardDescription></CardHeader>
                <CardContent>
                  {quotaSnapshot.limitTokens ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{quotaSnapshot.periodStart ? t('admin.users.since', { date: formatDate(quotaSnapshot.periodStart) }) : t('admin.users.period')}</span>
                        <span className="font-medium">{formatTokens(quotaSnapshot.usedTokens)} / {formatTokens(quotaSnapshot.limitTokens)} ({quotaSnapshot.usagePercent ?? 0}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div
                          className={cn('h-1.5 rounded-full', (quotaSnapshot.usagePercent ?? 0) >= 100 ? 'bg-destructive' : (quotaSnapshot.usagePercent ?? 0) >= 80 ? 'bg-amber-500' : 'bg-primary/60')}
                          style={{ width: `${Math.min(100, quotaSnapshot.usagePercent ?? 0)}%` }}
                        />
                      </div>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">{t('admin.users.noQuotaPolicy')}</p>}
                </CardContent>
              </Card>

              <div className="grid gap-5 sm:grid-cols-2">
                <DistributionCard
                  title={t('admin.users.topModels')}
                  rows={usage.byModel.map((row) => ({ label: row.executionModel || row.providerId || '—', tokens: row.totals.totalTokens, runCount: row.runCount }))}
                />
                <DistributionCard
                  title={t('admin.users.topAgents')}
                  rows={usage.byAgent.map((row) => ({ label: row.agentName || row.agentId || '—', tokens: row.totals.totalTokens, runCount: row.runCount }))}
                />
              </div>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.tokenQuota')}</CardTitle><CardDescription>{t('admin.users.tokenQuotaDesc')}</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">{t('admin.users.limitTokens')}</label>
                      <Input type="number" min={0} value={quotaLimit} onChange={(event) => setQuotaLimit(event.target.value)} className="w-40" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">{t('admin.users.period')}</label>
                      <Select value={quotaPeriod} onValueChange={(value) => setQuotaPeriod((value ?? 'month') as 'day' | 'month')}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="day">{t('admin.users.perDay')}</SelectItem>
                          <SelectItem value="month">{t('admin.users.perMonth')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">{t('admin.users.actionLabel')}</label>
                      <Select value={quotaAction} onValueChange={(value) => setQuotaAction((value ?? 'block') as 'warn' | 'block')}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="block">{t('admin.users.block')}</SelectItem>
                          <SelectItem value="warn">{t('admin.users.warn')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" disabled={quotaBusy} onClick={() => void runAction(
                      () => api.updateUserTokenQuota(user.id, { limitTokens: Number(quotaLimit) || 0, period: quotaPeriod, action: quotaAction }),
                      setQuotaBusy,
                    )}>
                      <KeyRound className="mr-1.5 h-4 w-4" /> {t('admin.users.applyQuota')}
                    </Button>
                  </div>
                  {tokenQuota ? <p className="text-xs text-muted-foreground">{t('admin.users.currentQuota', { limit: formatTokens(tokenQuota.limitTokens), period: tokenQuota.period, action: tokenQuota.action })}</p> : <p className="text-xs text-muted-foreground">{t('admin.users.noQuotaSet')}</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="space-y-5 pt-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <DailyTrendBars
                  label={t('admin.users.trendEvents')}
                  color="#0ea5e9"
                  rows={dailyActivity.map((day) => ({ date: day.date, value: day.events }))}
                />
                <DailyTrendBars
                  label={t('admin.users.trendRuns')}
                  color="#f59e0b"
                  rows={dailyActivity.map((day) => ({ date: day.date, value: day.runs }))}
                />
              </div>
              {activityLoading ? <p className="text-sm text-muted-foreground">{t('admin.users.loadingActivity')}</p> : activity ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <InfoCard label={t('admin.users.tasksInfo')} value={String(activity.tasks.total)} />
                    <InfoCard label={t('admin.users.workspacesInfo')} value={t('admin.users.workspacesCount', { member: activity.workspaces.memberOf, owned: activity.workspaces.owned })} />
                    <InfoCard label={t('admin.users.executorsInfo')} value={t('admin.users.executorsCount', { online: activity.executors.online, total: activity.executors.total })} />
                    <InfoCard label={t('admin.users.agentsInfo')} value={t('admin.users.agentsCount', { total: activity.agents.total, online: activity.agents.online })} />
                  </div>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm"><Layers className="mr-1.5 inline h-4 w-4" />{t('admin.users.tasksInfo')}</CardTitle>
                      <CardDescription>{t('admin.users.tasksCreated', { created: activity.tasks.created, assigned: activity.tasks.assigned, inReview: activity.tasks.inReview, done: activity.tasks.done })}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {activity.tasks.recent.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noTasks')}</p> : (
                        <div className="space-y-2">
                          {activity.tasks.recent.map((task) => (
                            <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{task.title}</p>
                                <p className="truncate text-xs text-muted-foreground">{task.id}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge variant={TASK_STATUS_VARIANTS[task.status] || 'outline'}>{task.status}</Badge>
                                <span className="text-xs text-muted-foreground">{formatDate(task.updatedAt)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm"><Boxes className="mr-1.5 inline h-4 w-4" />{t('admin.users.workspacesInfo')}</CardTitle><CardDescription>{t('admin.users.workspacesCardDesc')}</CardDescription></CardHeader>
                    <CardContent>
                      {activity.workspaces.recent.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noMemberships')}</p> : (
                        <div className="space-y-2">
                          {activity.workspaces.recent.map((workspace) => (
                            <div key={workspace.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{workspace.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{workspace.id}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Badge variant={workspace.role === 'owner' ? 'default' : 'outline'}>{workspace.role}</Badge>
                                <span className="text-xs text-muted-foreground">{formatDate(workspace.updatedAt)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.executorsInfo')}</CardTitle><CardDescription>{t('admin.users.executorsCardDesc')}</CardDescription></CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-3">
                          <InfoCard label={t('admin.users.paired')} value={String(activity.executors.total)} />
                          <InfoCard label={t('admin.users.onlineShort')} value={String(activity.executors.online)} />
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">{activity.executors.lastSeenAt ? t('admin.users.lastSeen', { date: formatDate(activity.executors.lastSeenAt) }) : t('admin.users.neverOnline')}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm"><Bot className="mr-1.5 inline h-4 w-4" />{t('admin.users.agentsInfo')}</CardTitle><CardDescription>{t('admin.users.agentsCardDesc')}</CardDescription></CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-3">
                          <InfoCard label={t('admin.users.totalShort')} value={String(activity.agents.total)} />
                          <InfoCard label={t('admin.users.onlineShort')} value={String(activity.agents.online)} />
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">{activity.agents.error > 0 ? t('admin.users.inErrorState', { count: activity.agents.error }) : t('admin.users.noErrorState')}</p>
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : <p className="text-sm text-muted-foreground">{t('admin.users.noActivityData')}</p>}
            </TabsContent>

            <TabsContent value="audit" className="space-y-4 pt-4">
              {auditLoading ? <p className="text-sm text-muted-foreground">{t('admin.users.loadingAudit')}</p> : (
                <>
                  <CardDescription><ScrollText className="mr-1.5 inline h-4 w-4" />{t('admin.users.auditDesc')}</CardDescription>
                  {!audit || audit.logs.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noAuditRecords')}</p> : (
                    <div className="space-y-2">
                      {audit.logs.map((log) => (
                        <div key={log.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{auditEventLabel(log.eventType)}</p>
                            <p className="text-xs text-muted-foreground">
                              {log.actorType} · {log.actorId || t('admin.users.system')}
                              {log.payload ? ` · ${formatAuditPayload(log.payload)}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant={log.role === 'target' ? 'secondary' : 'outline'}>{log.role === 'both' ? t('admin.users.actorAndTarget') : log.role}</Badge>
                            <span className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="feedback" className="space-y-4 pt-4">
              {feedbackLoading ? <p className="text-sm text-muted-foreground">{t('admin.users.loadingFeedback')}</p> : (
                <>
                  <CardDescription><MessageSquareText className="mr-1.5 inline h-4 w-4" />{t('admin.users.feedbackDesc')}</CardDescription>
                  {!feedback || feedback.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noFeedback')}</p> : (
                    <div className="space-y-2">
                      {feedback.map((item) => (
                        <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="text-xs text-muted-foreground">{item.body.slice(0, 140)}{item.body.length > 140 ? '…' : ''}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline">{feedbackTypeLabel(item.type)}</Badge>
                              <Badge variant={item.status === 'closed' ? 'default' : item.status === 'triaged' ? 'secondary' : 'outline'}>{feedbackStatusLabel(item.status)}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4 pt-4">
              {!audit || !feedback ? <p className="text-sm text-muted-foreground">{t('admin.users.loadingTimeline')}</p> : (
                <>
                  <CardDescription><History className="mr-1.5 inline h-4 w-4" />{t('admin.users.timelineDesc')}</CardDescription>
                  {!timeline || timeline.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noActivityRecorded')}</p> : (
                    <div className="space-y-2">
                      {timeline.map((entry, index) => (
                        <div key={`${entry.kind}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant={entry.kind === 'note' ? 'default' : entry.kind === 'feedback' ? 'secondary' : 'outline'}>{t(`admin.users.timelineKind${entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1)}`)}</Badge>
                              <p className="truncate text-sm font-medium">{entry.title}</p>
                            </div>
                            {entry.detail ? <p className="mt-1 truncate text-xs text-muted-foreground">{entry.detail}</p> : null}
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.time)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="auth" className="space-y-4 pt-4">
              <DailyTrendBars
                label={t('admin.users.trendLogins')}
                color="#10b981"
                rows={dailyActivity.map((day) => ({ date: day.date, value: day.logins }))}
              />
              <div className="grid grid-cols-3 gap-3">
                <InfoCard label={t('admin.users.successWindow')} value={String(authStats.counts.success)} />
                <InfoCard label={t('admin.users.failedWindow')} value={String(authStats.counts.fail)} />
                <InfoCard label={t('admin.users.blockedWindow')} value={String(authStats.counts.blocked)} />
              </div>
              {authStats.byIp.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.users.byIp')}</CardTitle></CardHeader>
                  <CardContent className="space-y-1.5">
                    {authStats.byIp.slice(0, 8).map((row) => (
                      <div key={row.ip} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{row.ip}</span>
                        <span className="font-medium">{t('admin.users.ipCount', { count: row.count, date: formatDate(row.last) })}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
              {authEvents.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noAuthEvents')}</p> : (
                <div className="space-y-2">
                  {authEvents.map((event) => (
                    <div key={event.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{eventLabel(event)}</p>
                        <p className="text-xs text-muted-foreground">
                          {event.provider || '—'} · {event.result} · {event.ip || t('admin.users.noIp')}{event.userAgent ? ` · ${event.userAgent.slice(0, 60)}` : ''}
                        </p>
                        {event.metadataJson?.reason ? <p className="text-xs text-destructive">{t('admin.users.authReason', { reason: String(event.metadataJson.reason) })}</p> : null}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(event.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

function DistributionCard({ title, rows }: { title: string; rows: Array<{ label: string; tokens: number; runCount: number }> }) {
  const { t } = useTranslation()
  const max = Math.max(...rows.map((row) => row.tokens), 1)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2.5">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.users.noUsage')}</p> : rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{row.label}</span>
              <span className="shrink-0 font-medium">{formatTokens(row.tokens)} · {row.runCount} runs</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary/60" style={{ width: `${Math.max(2, (row.tokens / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DailyTrendBars({ label, color, rows }: { label: string; color: string; rows: Array<{ date: string; value: number }> }) {
  const { t } = useTranslation()
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
        <CardDescription>{t('admin.users.last14d')}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.users.noData')}</p>
        ) : (
          <div className="flex h-24 items-end gap-1">
            {rows.map((row) => (
              <div
                key={row.date}
                className="flex-1 rounded-t"
                style={{ height: `${Math.max(4, (row.value / max) * 100)}%`, backgroundColor: color }}
                title={`${row.date}: ${row.value}`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
  )
}

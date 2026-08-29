import { useMemo, useState } from 'react'
import { Search, Activity, AlertTriangle, Clock, Shield } from 'lucide-react'
import type { AdminApprovalRequestRecord, AdminAuditLogRecord } from '@/lib/api'
import { AuditEventIcon, getAuditEventBadgeVariant, getAuditEventSummary } from './audit-event'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Input } from '@/components/ui-admin/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui-admin/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui-admin/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui-admin/tabs'
import { formatDate } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/react'
import { PageContainer, PageHeader, StatsGrid, EmptyState } from './page-container'
import { cn } from '@/lib/utils'

interface AdminAuditPageProps {
  logs: AdminAuditLogRecord[]
  pendingApprovals: AdminApprovalRequestRecord[]
}

export function AdminAuditPage({ logs, pendingApprovals }: AdminAuditPageProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<'logs' | 'approvals'>('logs')
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = searchQuery === '' ||
        log.eventType.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.actorId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.taskId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.workspaceId?.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesType = eventTypeFilter === 'all' || log.eventType.includes(eventTypeFilter)

      return matchesSearch && matchesType
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [logs, searchQuery, eventTypeFilter])

  const stats = useMemo(() => ({
    totalLogs: logs.length,
    pendingApprovals: pendingApprovals.length,
    highRiskApprovals: pendingApprovals.filter(a => a.riskLevel === 'high').length,
    recentEvents: logs.filter(l => {
      const eventTime = new Date(l.createdAt).getTime()
      return Date.now() - eventTime < 24 * 60 * 60 * 1000
    }).length,
  }), [logs, pendingApprovals])

  const getRiskBadge = (riskLevel: AdminApprovalRequestRecord['riskLevel']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      low: 'secondary',
      medium: 'default',
      high: 'destructive',
    }
    return <Badge variant={variants[riskLevel] || 'secondary'}>{riskLevel}</Badge>
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin.audit.title')}
        description={t('admin.audit.subtitle')}
      />

      <StatsGrid>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.audit.totalEvents')}</CardDescription>
            <CardTitle className="text-2xl">{stats.totalLogs}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">{t('admin.audit.auditLogEntries')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.audit.pendingApprovals')}</CardDescription>
            <CardTitle className="text-2xl text-warning">{stats.pendingApprovals}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {t('admin.audit.awaitingDecision')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.audit.highRiskPending')}</CardDescription>
            <CardTitle className="text-2xl text-destructive">{stats.highRiskApprovals}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              {t('admin.audit.requiresAttention')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.audit.events24h')}</CardDescription>
            <CardTitle className="text-2xl">{stats.recentEvents}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              {t('admin.audit.recentActivity')}
            </div>
          </CardContent>
        </Card>
      </StatsGrid>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'logs' | 'approvals')} className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs">{t('admin.audit.tabLogs')}</TabsTrigger>
          <TabsTrigger value="approvals">
            {t('admin.audit.tabApprovals')}
            {pendingApprovals.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {pendingApprovals.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t('admin.audit.auditEvents')}</CardTitle>
                  <CardDescription>
                    {t('admin.audit.auditTrail')}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder={t('admin.audit.searchEvents')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={cn('w-64 pl-8')}
                    />
                  </div>
                  <Select value={eventTypeFilter} onValueChange={(value) => setEventTypeFilter(value ?? 'all')}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder={t('admin.audit.eventType')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('admin.audit.allTypes')}</SelectItem>
                      <SelectItem value="admin">{t('admin.audit.typeAdmin')}</SelectItem>
                      <SelectItem value="task">{t('admin.audit.typeTask')}</SelectItem>
                      <SelectItem value="agent">{t('admin.audit.typeAgent')}</SelectItem>
                      <SelectItem value="approval">{t('admin.audit.typeApproval')}</SelectItem>
                      <SelectItem value="channel">{t('admin.audit.typeChannel')}</SelectItem>
                      <SelectItem value="executor">{t('admin.audit.typeExecutor')}</SelectItem>
                      <SelectItem value="workspace">{t('admin.audit.typeWorkspace')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredLogs.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title={t('admin.audit.noLogsFound')}
                  description={searchQuery || eventTypeFilter !== 'all' ? t('admin.audit.tryAdjustingFilters') : t('admin.audit.noEventsRecorded')}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.audit.colEvent')}</TableHead>
                      <TableHead>{t('admin.audit.colActor')}</TableHead>
                      <TableHead>{t('admin.audit.colScope')}</TableHead>
                      <TableHead>{t('admin.audit.colDetails')}</TableHead>
                      <TableHead>{t('admin.audit.colCreated')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 50).map((log) => {
                      const summary = getAuditEventSummary(log, t)
                      return (
                        <TableRow key={log.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <AuditEventIcon log={log} className="h-4 w-4" />
                              <div>
                                <Badge variant={getAuditEventBadgeVariant(log)} className="text-xs">
                                  {log.eventType}
                                </Badge>
                                <div className="text-xs text-muted-foreground mt-1">{log.id}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {log.actorId ? `${log.actorType}:${log.actorId}` : log.actorType}
                          </TableCell>
                          <TableCell>
                            {log.workspaceId || log.taskId || log.projectId || '-'}
                          </TableCell>
                          <TableCell>
                            {summary ? (
                              <span
                                className="block max-w-[280px] truncate text-xs text-muted-foreground"
                                title={summary}
                              >
                                {summary}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(log.createdAt)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals">
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.audit.pendingApprovals')}</CardTitle>
              <CardDescription>
                {t('admin.audit.approvalsSubtitle')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingApprovals.length === 0 ? (
                <EmptyState
                  icon={Shield}
                  title={t('admin.audit.noPendingApprovals')}
                  description={t('admin.audit.allApprovalsProcessed')}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.audit.colTitle')}</TableHead>
                      <TableHead>{t('admin.audit.riskLevel')}</TableHead>
                      <TableHead>{t('admin.audit.colWorkspace')}</TableHead>
                      <TableHead>{t('admin.audit.colCreated')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingApprovals.map((approval) => (
                      <TableRow key={approval.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{approval.title}</div>
                            <div className="text-xs text-muted-foreground">{approval.id}</div>
                          </div>
                        </TableCell>
                        <TableCell>{getRiskBadge(approval.riskLevel)}</TableCell>
                        <TableCell>{approval.workspaceId || '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(approval.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

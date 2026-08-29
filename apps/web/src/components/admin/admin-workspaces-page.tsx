import { useMemo, useState } from 'react'
import { Search, MoreHorizontal, Users, Play, Square, AlertTriangle, RefreshCw } from 'lucide-react'
import type { Project, Task, TaskWorkspaceBinding, Workspace, WorkspaceSession } from '@shared/types'
import type { WorkspaceSessionEventsPage, WorkspaceSessionRuntimeSnapshot } from '@shared/workspace-session-history'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Input } from '@/components/ui-admin/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui-admin/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui-admin/dropdown-menu'
import { formatDate } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/react'
import { PageContainer, PageHeader, StatsGrid, EmptyState } from './page-container'
import { cn } from '@/lib/utils'

interface AdminWorkspacesPageProps {
  workspaces: Workspace[]
  projects: Project[]
  tasks: Task[]
  bindings: TaskWorkspaceBinding[]
  sessions: WorkspaceSession[]
  canManage: boolean
  busy: boolean
  runtimeSnapshot: WorkspaceSessionRuntimeSnapshot | null
  runtimeLoading: boolean
  eventsPage: WorkspaceSessionEventsPage | null
  eventsLoading: boolean
  onRefreshRuntime: (workspaceId: string, workspaceSessionId: string) => Promise<void>
  onEnsureWorktree: (taskId: string, workspaceId: string, workspaceSessionId: string) => Promise<void>
  onCleanupTask: (taskId: string) => Promise<void>
}

export function AdminWorkspacesPage({
  workspaces,
  projects,
  tasks,
  bindings,
  sessions,
  canManage,
  busy,
  runtimeSnapshot,
  runtimeLoading,
  eventsPage,
  eventsLoading,
  onRefreshRuntime,
  onEnsureWorktree,
  onCleanupTask,
}: AdminWorkspacesPageProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSession, setSelectedSession] = useState<WorkspaceSession | null>(null)

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])

  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      return searchQuery === '' ||
        session.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        session.workspaceId?.toLowerCase().includes(searchQuery.toLowerCase())
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [sessions, searchQuery])

  const stats = useMemo(() => ({
    total: sessions.length,
    running: sessions.filter(s => s.runtimeStatus === 'running').length,
    stopped: sessions.filter(s => s.runtimeStatus === 'idle' || s.runtimeStatus === 'completed' || s.runtimeStatus === 'cancelled').length,
    error: sessions.filter(s => s.runtimeStatus === 'error' || s.runtimeStatus === 'lost').length,
  }), [sessions])

  const getStatusBadge = (status: WorkspaceSession['runtimeStatus']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      running: 'default',
      idle: 'secondary',
      completed: 'secondary',
      cancelled: 'outline',
      queued: 'outline',
      waiting: 'outline',
      error: 'destructive',
      lost: 'destructive',
    }
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin.workspaces.title')}
        description={t('admin.workspaces.subtitle')}
      />

      <StatsGrid>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.workspaces.totalSessions')}</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">{t('admin.workspaces.allSessions')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.workspaces.running')}</CardDescription>
            <CardTitle className="text-2xl text-success">{stats.running}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Play className="h-4 w-4" />
              {t('admin.workspaces.activeSessions')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.workspaces.stopped')}</CardDescription>
            <CardTitle className="text-2xl">{stats.stopped}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Square className="h-4 w-4" />
              {t('admin.workspaces.inactiveSessions')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.workspaces.errors')}</CardDescription>
            <CardTitle className="text-2xl text-destructive">{stats.error}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              {t('admin.workspaces.failedSessions')}
            </div>
          </CardContent>
        </Card>
      </StatsGrid>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('admin.workspaces.sessionList')}</CardTitle>
              <CardDescription>
                {t('admin.workspaces.sessionListDesc')}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={t('admin.workspaces.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn('w-64 pl-8')}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSessions.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('admin.workspaces.noSessions')}
              description={searchQuery ? t('admin.workspaces.tryAdjustingSearch') : t('admin.workspaces.noSessionsYet')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.workspaces.colSession')}</TableHead>
                  <TableHead>{t('admin.workspaces.colStatus')}</TableHead>
                  <TableHead>{t('admin.workspaces.colWorkspace')}</TableHead>
                  <TableHead>{t('admin.workspaces.colUpdated')}</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSessions.slice(0, 50).map((session) => (
                  <TableRow
                    key={session.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedSession(session)}
                  >
                    <TableCell>
                      <div>
                        <div className="font-medium">{session.id}</div>
                        <div className="text-xs text-muted-foreground">{session.workspaceId}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(session.runtimeStatus)}</TableCell>
                    <TableCell>{session.workspaceId || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(session.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                      <DropdownMenuTrigger
                        render={(triggerProps) => (
                          <Button
                            variant="ghost"
                            size="icon"
                            {...triggerProps}
                            onClick={(e) => {
                              e.stopPropagation()
                              triggerProps.onClick?.(e)
                            }}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        )}
                      />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => void onRefreshRuntime(session.workspaceId, session.id)}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {t('admin.workspaces.refreshRuntime')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}

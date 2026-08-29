import { useMemo, useState } from 'react'
import { RefreshCw, Search, MoreHorizontal, Cpu, Wifi, WifiOff, Server } from 'lucide-react'
import type { DistributedTask, ExecutionEventLogRecord, ExecutorRecord, Project, ProjectBinding, Workspace } from '@shared/types'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Input } from '@/components/ui-admin/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui-admin/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui-admin/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui-admin/dropdown-menu'
import { formatDate } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/react'
import { PageContainer, PageHeader, StatsGrid, EmptyState } from './page-container'
import type { WorkerDoctorPayload } from '@/lib/api'

interface AdminExecutorsPageProps {
  executors: ExecutorRecord[]
  distributedTasks: DistributedTask[]
  projectBindings: ProjectBinding[]
  projects: Project[]
  workspaces: Workspace[]
  executionEvents: ExecutionEventLogRecord[]
  canManage: boolean
  refreshingExecutorId: string | null
  actionExecutorId: string | null
  onRefreshAll: () => Promise<void>
  onRefreshExecutor: (executorId: string) => Promise<void>
  onUpdateExecutor: (executorId: string, payload: { previewExposureMode?: 'private' | 'public-ingress'; previewIngressPort?: number }) => Promise<void>
  onRunDoctor: (executorId: string) => Promise<WorkerDoctorPayload>
  onShutdownExecutor: (executorId: string) => Promise<void>
  onDeleteExecutor: (executorId: string) => Promise<void>
}

export function AdminExecutorsPage({
  executors,
  distributedTasks,
  projectBindings,
  projects,
  workspaces,
  executionEvents,
  canManage,
  refreshingExecutorId,
  actionExecutorId,
  onRefreshAll,
  onRefreshExecutor,
  onUpdateExecutor,
  onRunDoctor,
  onShutdownExecutor,
  onDeleteExecutor,
}: AdminExecutorsPageProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedExecutor, setSelectedExecutor] = useState<ExecutorRecord | null>(null)

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])

  const filteredExecutors = useMemo(() => {
    return executors.filter(executor => {
      const matchesSearch = searchQuery === '' ||
        executor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        executor.executorId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        executor.machineName?.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesStatus = statusFilter === 'all' || executor.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [executors, searchQuery, statusFilter])

  const stats = useMemo(() => ({
    total: executors.length,
    online: executors.filter(e => e.status === 'online').length,
    offline: executors.filter(e => e.status === 'offline').length,
    meshReady: executors.filter(e => e.presence?.mesh?.status === 'ready').length,
  }), [executors])

  const getStatusBadge = (status: ExecutorRecord['status']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      online: 'default',
      paired: 'secondary',
      offline: 'destructive',
      disabled: 'outline',
    }
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>
  }

  const getMeshBadge = (executor: ExecutorRecord) => {
    const status = executor.presence?.mesh?.status
    if (!status) return <Badge variant="outline">N/A</Badge>

    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      ready: 'default',
      installing: 'secondary',
      connecting: 'secondary',
      degraded: 'destructive',
      error: 'destructive',
    }
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin.executors.title')}
        description={t('admin.executors.subtitle')}
        actions={
          <Button onClick={() => void onRefreshAll()} disabled={refreshingExecutorId !== null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshingExecutorId ? 'animate-spin' : ''}`} />
            {t('admin.executors.refreshAll')}
          </Button>
        }
      />

      <StatsGrid>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.executors.totalExecutors')}</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Server className="h-4 w-4" />
              {t('admin.executors.registeredInControlPlane')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.executors.online')}</CardDescription>
            <CardTitle className="text-2xl text-success">{stats.online}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wifi className="h-4 w-4" />
              {t('admin.executors.currentlyConnected')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.executors.offline')}</CardDescription>
            <CardTitle className="text-2xl text-destructive">{stats.offline}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <WifiOff className="h-4 w-4" />
              {t('admin.executors.notResponding')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.executors.meshReady')}</CardDescription>
            <CardTitle className="text-2xl">{stats.meshReady}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="h-4 w-4" />
              {t('admin.executors.easyTierConnected')}
            </div>
          </CardContent>
        </Card>
      </StatsGrid>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('admin.executors.registry')}</CardTitle>
              <CardDescription>
                {t('admin.executors.registryDesc')}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={t('admin.executors.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-64 pl-8"
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? 'all')}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t('admin.executors.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.executors.allStatus')}</SelectItem>
                  <SelectItem value="online">{t('admin.executors.online')}</SelectItem>
                  <SelectItem value="offline">{t('admin.executors.offline')}</SelectItem>
                  <SelectItem value="paired">{t('admin.executors.paired')}</SelectItem>
                  <SelectItem value="disabled">{t('admin.executors.disabled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredExecutors.length === 0 ? (
            <EmptyState
              icon={Cpu}
              title={t('admin.executors.noExecutors')}
              description={searchQuery || statusFilter !== 'all' ? t('admin.executors.tryAdjustingFilters') : t('admin.executors.noExecutorsRegistered')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.executors.colName')}</TableHead>
                  <TableHead>{t('admin.executors.colStatus')}</TableHead>
                  <TableHead>{t('admin.executors.colMesh')}</TableHead>
                  <TableHead>{t('admin.executors.colOwner')}</TableHead>
                  <TableHead>{t('admin.executors.colLastSeen')}</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExecutors.map((executor) => (
                  <TableRow
                    key={executor.executorId}
                    className="cursor-pointer"
                    onClick={() => setSelectedExecutor(executor)}
                  >
                    <TableCell>
                      <div>
                        <div className="font-medium">{executor.name}</div>
                        <div className="text-xs text-muted-foreground">{executor.executorId}</div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(executor.status)}</TableCell>
                    <TableCell>{getMeshBadge(executor)}</TableCell>
                    <TableCell>{executor.ownerUserId || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(executor.lastSeenAt || executor.createdAt)}
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
                          <DropdownMenuItem onClick={() => void onRefreshExecutor(executor.executorId)}>
                            {t('admin.executors.refreshTelemetry')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void onRunDoctor(executor.executorId)}>
                            {t('admin.executors.runDoctor')}
                          </DropdownMenuItem>
                          {canManage && (
                            <>
                              <DropdownMenuItem onClick={() => void onShutdownExecutor(executor.executorId)}>
                                {t('admin.executors.shutdown')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => void onDeleteExecutor(executor.executorId)}
                              >
                                {t('admin.executors.delete')}
                              </DropdownMenuItem>
                            </>
                          )}
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

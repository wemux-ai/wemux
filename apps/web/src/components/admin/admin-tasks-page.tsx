import { useMemo, useState } from 'react'
import { Search, MoreHorizontal, Zap, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react'
import { getProjectColor } from '@shared/project-color'
import type { DistributedTask, ExecutorRecord, Project, Task } from '@shared/types'
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
import { cn } from '@/lib/utils'

interface AdminTasksPageProps {
  tasks: DistributedTask[]
  projects: Project[]
  originTasks: Task[]
  executors: ExecutorRecord[]
  canManage: boolean
  busy: boolean
  onCancelTask: (taskId: string) => Promise<unknown>
  onRetryTask: (taskId: string) => Promise<unknown>
  onAssignTask: (taskId: string, executorNodeId: string) => Promise<unknown>
  onTakeoverTask: (taskId: string, executorNodeId?: string) => Promise<unknown>
}

export function AdminTasksPage({
  tasks,
  projects,
  originTasks,
  executors,
  canManage,
  busy,
  onCancelTask,
  onRetryTask,
  onAssignTask,
  onTakeoverTask,
}: AdminTasksPageProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  const executorMap = useMemo(() => new Map(executors.map(e => [e.executorId, e])), [executors])
  const originTaskMap = useMemo(() => new Map(originTasks.map(t => [t.id, t])), [originTasks])

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesSearch = searchQuery === '' ||
        task.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.executorNodeId?.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesStatus = statusFilter === 'all' || task.status === statusFilter
      const matchesProject = projectFilter === 'all' || task.projectId === projectFilter

      return matchesSearch && matchesStatus && matchesProject
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [tasks, searchQuery, statusFilter, projectFilter])

  const stats = useMemo(() => {
    const activeStatuses = ['queued', 'assigned', 'preparing', 'executing', 'syncing_back']
    const failedStatuses = ['failed', 'timed_out', 'lost']

    return {
      total: tasks.length,
      active: tasks.filter(t => activeStatuses.includes(t.status)).length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => failedStatuses.includes(t.status)).length,
    }
  }, [tasks])

  const getStatusBadge = (status: DistributedTask['status']) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      queued: 'secondary',
      assigned: 'secondary',
      preparing: 'secondary',
      executing: 'secondary',
      syncing_back: 'secondary',
      failed: 'destructive',
      timed_out: 'destructive',
      lost: 'destructive',
      cancelled: 'outline',
      draft: 'outline',
    }
    return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>
  }

  const getStatusIcon = (status: DistributedTask['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-success" />
      case 'failed':
      case 'timed_out':
      case 'lost':
        return <XCircle className="h-4 w-4 text-destructive" />
      case 'executing':
      case 'syncing_back':
        return <Zap className="h-4 w-4 text-primary" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin.tasks.title')}
        description={t('admin.tasks.subtitle')}
      />

      <StatsGrid>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.tasks.totalTasks')}</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">{t('admin.tasks.allDistributedTasks')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.tasks.active')}</CardDescription>
            <CardTitle className="text-2xl text-primary">{stats.active}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Zap className="h-4 w-4" />
              {t('admin.tasks.currentlyProcessing')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.tasks.completed')}</CardDescription>
            <CardTitle className="text-2xl text-success">{stats.completed}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" />
              {t('admin.tasks.successfullyFinished')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('admin.tasks.failed')}</CardDescription>
            <CardTitle className="text-2xl text-destructive">{stats.failed}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              {t('admin.tasks.requiresAttention')}
            </div>
          </CardContent>
        </Card>
      </StatsGrid>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('admin.tasks.taskList')}</CardTitle>
              <CardDescription>
                {t('admin.tasks.taskListDesc')}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={t('admin.tasks.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn('w-64 pl-8')}
                />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? 'all')}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder={t('admin.tasks.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.tasks.allStatus')}</SelectItem>
                  <SelectItem value="queued">{t('admin.tasks.queued')}</SelectItem>
                  <SelectItem value="executing">{t('admin.tasks.executing')}</SelectItem>
                  <SelectItem value="completed">{t('admin.tasks.completed')}</SelectItem>
                  <SelectItem value="failed">{t('admin.tasks.failed')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value ?? 'all')}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('admin.tasks.project')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.tasks.allProjects')}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTasks.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={t('admin.tasks.noTasks')}
              description={searchQuery || statusFilter !== 'all' || projectFilter !== 'all' ? t('admin.tasks.tryAdjustingFilters') : t('admin.tasks.noTasksYet')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.tasks.colTask')}</TableHead>
                  <TableHead>{t('admin.tasks.colStatus')}</TableHead>
                  <TableHead>{t('admin.tasks.colProject')}</TableHead>
                  <TableHead>{t('admin.tasks.colExecutor')}</TableHead>
                  <TableHead>{t('admin.tasks.colUpdated')}</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.slice(0, 50).map((task) => {
                  const project = projectMap.get(task.projectId)
                  const executor = task.executorNodeId ? executorMap.get(task.executorNodeId) : null
                  const originTask = originTaskMap.get(task.originTaskId)

                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(task.status)}
                          <div>
                            <div className="font-medium">{originTask?.title || task.description || task.id}</div>
                            <div className="text-xs text-muted-foreground">{task.id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(task.status)}</TableCell>
                      <TableCell>{project?.name || task.projectId}</TableCell>
                      <TableCell>{executor?.name || task.executorNodeId || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(task.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={(triggerProps) => (
                              <Button variant="ghost" size="icon" {...triggerProps}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            )}
                          />
                          <DropdownMenuContent align="end">
                            {task.status !== 'completed' && task.status !== 'cancelled' && (
                              <DropdownMenuItem onClick={() => void onCancelTask(task.id)}>
                                {t('admin.tasks.cancelTask')}
                              </DropdownMenuItem>
                            )}
                            {['failed', 'timed_out', 'lost', 'cancelled'].includes(task.status) && (
                              <DropdownMenuItem onClick={() => void onRetryTask(task.id)}>
                                {t('admin.tasks.retryTask')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}

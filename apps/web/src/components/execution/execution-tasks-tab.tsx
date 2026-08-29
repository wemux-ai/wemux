import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { ExecutorSelect } from '../ui/executor-select'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { SearchableSelect } from '../ui/searchable-select'
import { useSidebar } from '../ui/sidebar'
import { agentMeta, cn, formatDate, formatExecutionModelLabel } from '../../lib/utils'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { useTranslation } from '../../lib/i18n/react'
import { DistributedTaskDetails, StatusTag } from './execution-shared'
import type { DistributedTask, ExecutorRecord, Project, ProjectBinding, Task } from '@shared/types'
import type { TaskGitPullRequestResult } from '@shared/task-git-ops'

export function TasksTab({
  distributedTasks,
  executors,
  projectBindings,
  tasks,
  projects,
  selectedTaskId,
  onSelectTask,
  selectedTask,
  selectedOriginTask,
  executorOptions,
  busy,
  onCreateDistributedTask,
  onAssignTask,
  onCreatePullRequest,
  onRefreshPullRequestStatus,
  onCancelTask,
  onRetryTask,
  onTakeoverTask,
}: {
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  projectBindings: ProjectBinding[]
  tasks: Task[]
  projects: Project[]
  selectedTaskId: string
  onSelectTask: (id: string) => void
  selectedTask: DistributedTask | null
  selectedOriginTask?: Task
  executorOptions: Array<{ value: string; label: string }>
  busy: boolean
  onCreateDistributedTask: (payload: { originTaskId: string; projectId: string; description: string; priority?: 'low' | 'medium' | 'high'; timeoutSec?: number; executorNodeId?: string; returnMode?: 'summary' | 'branch' | 'commit'; syncBackStrategy?: 'none' | 'pull-branch'; gitIdentityMode?: 'personal' }) => Promise<unknown>
  onAssignTask: (taskId: string, nodeId: string) => void
  onCreatePullRequest: (taskId: string, payload: { title?: string; body?: string; baseBranch?: string }) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onRefreshPullRequestStatus: (taskId: string) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onCancelTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onTakeoverTask: (taskId: string, nodeId?: string) => void
}) {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const candidateTasks = useMemo(
    () => tasks.filter((task) => !task.executionHistory.some((run) => Boolean(run.distributedTaskId)) && task.status !== 'done').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [tasks],
  )
  const [draftTaskId, setDraftTaskId] = useState('')
  const [draftExecutorId, setDraftExecutorId] = useState('')
  const [draftReturnMode, setDraftReturnMode] = useState<'summary' | 'branch' | 'commit'>('commit')
  const [draftTimeoutSec, setDraftTimeoutSec] = useState('1800')

  useEffect(() => {
    if (!draftTaskId && candidateTasks[0]) {
      setDraftTaskId(candidateTasks[0].id)
    }
  }, [candidateTasks, draftTaskId])

  useEffect(() => {
    if (!draftExecutorId && executorOptions[0]) {
      setDraftExecutorId(executorOptions[0].value)
    }
  }, [draftExecutorId, executorOptions])

  useEffect(() => {
    if (!isMobile) {
      setMobileView('list')
      return
    }

    if (selectedTaskId) {
      setMobileView('detail')
    }
  }, [isMobile, selectedTaskId])

  const selectedDraftTask = candidateTasks.find((task) => task.id === draftTaskId) ?? null
  const selectedDraftProject = projects.find((project) => project.id === selectedDraftTask?.projectId)
  const syncBackStrategy = 'none' as const
  const syncStrategyHint = draftReturnMode === 'summary'
    ? t('execution.tasks.syncHint.summary', { defaultValue: 'summary 模式只保留执行摘要，不会触发仓库同步动作。' })
    : t('execution.tasks.syncHint.git', { defaultValue: '代码通过 Git 提交和远端分支交付；控制面只保存元数据，不保存代码内容。' })
  const showListPanel = !isMobile || mobileView === 'list'
  const showDetailPanel = !isMobile || mobileView === 'detail'

  return (
    <div className="space-y-4">
      {isMobile && distributedTasks.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-zinc-800 bg-[#09090b] p-1.5">
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={cn('flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors', mobileView === 'list' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}
          >
            {t('execution.tasks.listTab', { defaultValue: '任务列表' })}
          </button>
          <button
            type="button"
            onClick={() => setMobileView('detail')}
            disabled={!selectedTask}
            className={cn('flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-zinc-600', mobileView === 'detail' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100')}
          >
            {t('execution.tasks.detailTab', { defaultValue: '任务详情' })}
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {showListPanel ? (
      <Card className="rounded-none border-zinc-800 bg-zinc-950/75">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-medium text-zinc-50">任务列表</h3>
              <p className="mt-1 text-sm text-zinc-400">{t('execution.tasks.distributedCount', { defaultValue: '{{count}} 个分布式任务', count: distributedTasks.length })}</p>
            </div>
            <Button type="button" onClick={() => setCreateDialogOpen(true)} className="rounded-xl bg-zinc-100 text-zinc-950 hover:bg-white">{t('execution.tasks.dispatchTask', { defaultValue: '投递任务' })}</Button>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-3 text-sm leading-6 text-zinc-400">
            {t('execution.tasks.flowHint', { defaultValue: '操作链路：先点“投递任务”，再选择现有任务、选择节点，最后创建分布式任务并立即分配。' })}
          </div>

          {distributedTasks.length === 0 ? (
            <p className="mt-8 text-center text-sm text-zinc-500">{t('execution.tasks.empty', { defaultValue: '暂无任务' })}</p>
          ) : (
            <div className="mt-4 space-y-2">
              {distributedTasks.map((task) => (
                (() => {
                  const originTask = tasks.find((item) => item.id === task.originTaskId)

                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onSelectTask(task.id)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                        task.id === selectedTaskId ? 'border-zinc-600 bg-zinc-800' : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusTag status={task.status} />
                        {originTask ? (
                          <Badge className={cn('border-0', agentMeta[originTask.agentType].soft)}>
                            <RuntimeLabel runtime={originTask.agentType} size={12} labelClassName="text-inherit" />
                          </Badge>
                        ) : null}
                        {['assigned', 'preparing', 'executing', 'syncing_back'].includes(task.status) && <Badge variant="outline" className="border-sky-500/30 text-xs text-sky-300">{t('execution.tasks.inProgress', { defaultValue: '进行中' })}</Badge>}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-zinc-200">{task.description}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {originTask?.executionModel ? `${formatExecutionModelLabel(originTask.executionModel)} · ` : ''}
                        {formatDate(task.updatedAt)}
                      </p>
                    </button>
                  )
                })()
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t('execution.tasks.dialog.title', { defaultValue: '投递任务到节点' })}</DialogTitle>
            <DialogDescription className="text-zinc-500">{t('execution.tasks.dialog.description', { defaultValue: '把已有 Kanban 任务转换成分布式执行任务，并直接派发到选中的节点上运行。' })}</DialogDescription>
          </DialogHeader>

          <DialogBody>
          {candidateTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-500">{t('execution.tasks.dialog.noCandidate', { defaultValue: '当前没有可投递的任务。只有未进入分布式执行的任务，才会出现在这里。' })}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{t('execution.tasks.dialog.selectTask', { defaultValue: '选择任务' })}</p>
                <SearchableSelect
                  value={draftTaskId}
                  options={candidateTasks.map((task) => {
                    const project = projects.find((item) => item.id === task.projectId)
                    return {
                      value: task.id,
                      label: `${project?.name || task.projectId} / ${task.title}`,
                      description: task.description,
                    }
                  })}
                  placeholder={t('execution.tasks.dialog.selectTask', { defaultValue: '选择任务' })}
                  searchPlaceholder={t('execution.tasks.dialog.searchTask', { defaultValue: '搜索任务' })}
                  emptyText={t('execution.tasks.dialog.noMatchedTask', { defaultValue: '没有匹配的任务' })}
                  onChange={setDraftTaskId}
                />
              </div>
              {selectedDraftTask ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-zinc-100">{selectedDraftTask.title}</p>
                    <Badge className={cn('border-0', agentMeta[selectedDraftTask.agentType].soft)}>
                      <RuntimeLabel runtime={selectedDraftTask.agentType} size={12} labelClassName="text-inherit" />
                    </Badge>
                    {selectedDraftTask.executionModel ? <Badge variant="outline" className="border-zinc-700 text-zinc-300">{formatExecutionModelLabel(selectedDraftTask.executionModel)}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">{selectedDraftProject?.name || selectedDraftTask.projectId}</p>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">{selectedDraftTask.description}</p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{t('execution.tasks.dialog.executor', { defaultValue: '节点' })}</p>
                  <ExecutorSelect
                    value={draftExecutorId}
                    options={[
                      { value: '', label: t('execution.tasks.dialog.selectExecutor', { defaultValue: '选择节点' }), statusTone: 'neutral' },
                      ...executorOptions.map((opt) => ({
                        value: opt.value,
                        label: opt.label,
                        statusTone: 'neutral',
                      })),
                    ]}
                    placeholder={t('execution.tasks.dialog.selectExecutor', { defaultValue: '选择节点' })}
                    searchPlaceholder={t('execution.tasks.dialog.searchExecutor', { defaultValue: '搜索节点' })}
                    emptyText={t('execution.tasks.dialog.noMatchedExecutor', { defaultValue: '没有匹配的节点' })}
                    onChange={setDraftExecutorId}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{t('execution.tasks.dialog.returnMode', { defaultValue: '返回模式' })}</p>
                  <NativeSelect value={draftReturnMode} onChange={(e) => setDraftReturnMode(e.target.value as 'summary' | 'branch' | 'commit')}>
                    <option value="summary">summary</option>
                    <option value="branch">branch</option>
                    <option value="commit">commit</option>
                  </NativeSelect>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{t('execution.tasks.dialog.gitIdentity', { defaultValue: 'Git 身份' })}</p>
                  <div className="flex h-11 items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100">personal</div>
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{t('execution.tasks.dialog.timeoutSec', { defaultValue: '超时秒数' })}</p>
                  <Input value={draftTimeoutSec} onChange={(e) => setDraftTimeoutSec(e.target.value)} type="number" min="60" max="7200" className="border-zinc-800 bg-zinc-900 text-zinc-100" />
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm leading-6 text-zinc-400">
                {t('execution.tasks.dialog.createHint', { defaultValue: '创建后会自动生成一条分布式任务，并立刻分配到你选中的节点。后续状态、提交分支、重试、接管都在当前页面继续操作。' })}
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm leading-6 text-zinc-400">
                <p>{t('execution.tasks.dialog.syncStrategy', { defaultValue: '同步策略：`{{strategy}}`', strategy: syncBackStrategy })}</p>
                <p className="mt-1">{syncStrategyHint}</p>
              </div>
            </div>
          )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">{t('common.cancel')}</Button>
            <Button
              type="button"
              disabled={busy || !selectedDraftTask || !draftExecutorId}
              onClick={async () => {
                if (!selectedDraftTask || !draftExecutorId) return

                try {
                  await onCreateDistributedTask({
                    originTaskId: selectedDraftTask.id,
                    projectId: selectedDraftTask.projectId,
                    description: selectedDraftTask.description,
                    priority: 'medium',
                    timeoutSec: Math.max(60, Number(draftTimeoutSec) || 1800),
                    executorNodeId: draftExecutorId,
                    returnMode: draftReturnMode,
                    syncBackStrategy,
                    gitIdentityMode: 'personal',
                  })
                  toast.success(t('execution.tasks.toast.dispatched', { defaultValue: '任务已投递到节点' }))
                  setCreateDialogOpen(false)
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t('execution.tasks.toast.dispatchFailed', { defaultValue: '投递任务失败' }))
                }
              }}
              className="bg-zinc-100 text-zinc-950 hover:bg-white"
            >
              {t('execution.tasks.dialog.createAndAssign', { defaultValue: '创建并分配' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showDetailPanel ? (
      <Card className="rounded-none border-zinc-800 bg-zinc-950/75">
        <CardContent className="p-5">
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMobileView('list')}
              className="mb-3 h-8 rounded-lg px-0 text-zinc-500 hover:bg-transparent hover:text-zinc-100"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('execution.tasks.backToList', { defaultValue: '返回任务列表' })}
            </Button>
          ) : null}
          {selectedTask ? (
            <DistributedTaskDetails
              distributedTasks={distributedTasks}
              executors={executors}
              projectBindings={projectBindings}
              task={selectedTask}
              originTask={selectedOriginTask}
              executorOptions={executorOptions}
              busy={busy}
              onAssignTask={onAssignTask}
              onCreatePullRequest={onCreatePullRequest}
              onRefreshPullRequestStatus={onRefreshPullRequestStatus}
              onCancelTask={onCancelTask}
              onRetryTask={onRetryTask}
              onTakeoverTask={onTakeoverTask}
            />
          ) : (
            <p className="mt-8 text-center text-sm text-zinc-500">{t('execution.tasks.selectToView', { defaultValue: '选择一个任务查看详情' })}</p>
          )}
        </CardContent>
      </Card>
      ) : null}
      </div>
    </div>
  )
}

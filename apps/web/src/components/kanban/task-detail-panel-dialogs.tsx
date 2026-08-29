import type { ReactNode } from 'react'
import type { ExecutorRecord, Task, Workspace } from '@shared/types'
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '@shared/task-input-limits'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '../../components/ui/drawer'
import { ExecutorSelect } from '../../components/ui/executor-select'
import { Input } from '../../components/ui/input'
import { ScrollArea } from '../../components/ui/scroll-area'
import { SearchableSelect } from '../../components/ui/searchable-select'
import { Switch } from '../../components/ui/switch'
import { Textarea } from '../../components/ui/textarea'

interface TaskWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task
  executors: ExecutorRecord[]
  selectedWorkspace: Workspace | null
  selectedWorkspaceId: string
  newWorkspaceName: string
  workspacePrompt: string
  workspaceWorkingDirectoryMode: Workspace['workingDirectoryMode']
  workspaceExecutionModel: string
  workspaceAgentManaged: Task['agentManaged']
  activeExecutorId: string
  selectedBranch: string
  defaultModel: string
  modelOptions: Array<{ id: string; modelId: string; providerId: string; isDefault?: boolean }>
  modelLoading: boolean
  branchOptions: string[]
  branchLoading: boolean
  branchMessage: string
  workspaceConfigReady: boolean
  launchingWorkspace: boolean
  busy: boolean
  onCleanup: () => void
  onNameChange: (value: string) => void
  onPromptChange: (value: string) => void
  onWorkingDirectoryModeChange: (value: Workspace['workingDirectoryMode']) => void
  onModelChange: (value: string) => void
  onBranchChange: (value: string) => void
  onAgentManagedChange: (value: Task['agentManaged']) => void
  onExecutorChange: (value: string) => void
  onSubmit: () => void
}

interface TaskEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskTitleInput: string
  taskDescriptionInput: string
  busy: boolean
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSubmit: () => void
}

interface TaskDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deleteTaskChecked: boolean
  deleteTaskWorkspaces: boolean
  busy: boolean
  onDeleteTaskChange: (checked: boolean) => void
  onDeleteTaskWorkspacesChange: (checked: boolean) => void
  onSubmit: () => void
}

export function TaskWorkspaceDialog({
  open,
  onOpenChange,
  task,
  executors,
  selectedWorkspace,
  selectedWorkspaceId,
  newWorkspaceName,
  workspacePrompt,
  workspaceWorkingDirectoryMode,
  workspaceExecutionModel,
  workspaceAgentManaged,
  activeExecutorId,
  selectedBranch,
  defaultModel,
  modelOptions,
  modelLoading,
  branchOptions,
  branchLoading,
  branchMessage,
  workspaceConfigReady,
  launchingWorkspace,
  busy,
  onCleanup,
  onNameChange,
  onPromptChange,
  onWorkingDirectoryModeChange,
  onModelChange,
  onBranchChange,
  onAgentManagedChange,
  onExecutorChange,
  onSubmit,
}: TaskWorkspaceDialogProps) {
  const submitDisabled = busy || launchingWorkspace || !workspaceConfigReady || !selectedBranch || !newWorkspaceName.trim()

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="max-w-[560px] border-l border-zinc-800 bg-[#09090b] text-zinc-100">
        <DrawerTitle className="sr-only">工作区配置</DrawerTitle>
        <DrawerDescription className="sr-only">配置工作区并发起 AI 执行。</DrawerDescription>

        <div className="flex h-full flex-col">
          <div className="border-b border-zinc-900 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-zinc-50">{selectedWorkspaceId ? '配置工作区' : '新建工作区'}</p>
                <p className="mt-1 text-sm text-zinc-500">先写清目标，再选择节点、模型和起始分支。</p>
              </div>
              <DrawerClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="关闭工作区抽屉"
                  className="h-9 w-9 rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-5 p-5">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <p className="mb-4 text-lg font-semibold tracking-tight text-zinc-50">这个工作区要完成什么？</p>
                <Textarea
                  value={workspacePrompt}
                  onChange={(event) => onPromptChange(event.target.value)}
                  placeholder="例如：先把登录流程重构成可测试的 service + action 结构"
                  className="min-h-[160px] border-none bg-transparent px-0 text-base leading-7 text-zinc-100 shadow-none focus-visible:ring-0"
                />
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  会自动带上当前任务标题和描述。你可以在这里追加本次工作区的执行范围、约束或交付方式。
                </p>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">执行配置</p>
                <div className="mt-4 grid gap-4">
                  <FieldBlock label="执行节点" hint="工作区会在这个节点上准备仓库并启动会话。">
                    <ExecutorSelect
                      value={activeExecutorId}
                      options={[
                        { value: '', label: '选择节点', statusTone: 'neutral' },
                        ...executors.map((executor) => ({
                          value: executor.executorId,
                          label: executor.name,
                          description: executor.machineName,
                          keywords: [executor.machineName],
                          statusTone: executor.status === 'online' ? 'online' : 'offline',
                        })),
                      ]}
                      placeholder="选择节点"
                      searchPlaceholder="搜索节点"
                      emptyText="没有匹配的节点"
                      triggerClassName="h-10"
                      onChange={onExecutorChange}
                    />
                  </FieldBlock>

                  <FieldBlock
                    label="工作目录"
                    hint={selectedWorkspaceId ? '现有工作区的目录模式暂不在这里修改。' : '选择隔离目录（worktree），或直接在原始目录中工作。'}
                  >
                    <SearchableSelect
                      value={workspaceWorkingDirectoryMode}
                      options={[
                        { value: 'worktree', label: '隔离目录（worktree）', description: '适合并行会话与安全试验' },
                        { value: 'original-dir', label: '原始目录', description: '直接复用当前仓库目录' },
                      ]}
                      placeholder="选择目录模式"
                      searchPlaceholder="搜索目录模式"
                      emptyText="没有匹配的目录模式"
                      disabled={Boolean(selectedWorkspaceId)}
                      triggerClassName="h-10"
                      onChange={(value) => onWorkingDirectoryModeChange(value as Workspace['workingDirectoryMode'])}
                    />
                  </FieldBlock>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldBlock label="执行模型" hint={modelLoading ? '正在读取模型配置…' : `留空则使用默认模型${defaultModel ? `（${defaultModel}）` : ''}。`}>
                      <SearchableSelect
                        value={workspaceExecutionModel}
                        options={[
                          { value: '', label: `默认模型${defaultModel ? `（${defaultModel}）` : ''}` },
                          ...modelOptions.map((model) => ({
                            value: model.id,
                            label: `${model.providerId}/${model.modelId}`,
                            description: model.isDefault ? '默认' : undefined,
                            keywords: [model.providerId, model.modelId],
                          })),
                        ]}
                        placeholder={`默认模型${defaultModel ? `（${defaultModel}）` : ''}`}
                        searchPlaceholder="搜索模型"
                        emptyText="没有匹配的模型"
                        disabled={!workspaceConfigReady}
                        triggerClassName="h-10"
                        onChange={onModelChange}
                      />
                    </FieldBlock>

                    <FieldBlock label="起始分支" hint={branchMessage || (task.baseBranchHint ? `建议从 ${task.baseBranchHint} 开始。` : '优先选择本次任务的基线分支。')}>
                      <SearchableSelect
                        value={selectedBranch}
                        options={[
                          { value: '', label: branchLoading ? '读取中...' : '选择分支' },
                          ...branchOptions.map((branch) => ({
                            value: branch,
                            label: branch,
                          })),
                        ]}
                        placeholder={branchLoading ? '读取中...' : '选择分支'}
                        searchPlaceholder="搜索分支"
                        emptyText="没有匹配的分支"
                        disabled={branchLoading || branchOptions.length === 0}
                        triggerClassName="h-10"
                        onChange={onBranchChange}
                      />
                    </FieldBlock>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-200">AI 托管</p>
                      <p className="mt-1 text-xs text-zinc-500">开启后，任务会优先走 AI 托管执行路径。</p>
                    </div>
                    <Switch
                      checked={workspaceAgentManaged === 'ai'}
                      onCheckedChange={(checked) => onAgentManagedChange(checked ? 'ai' : 'none')}
                      className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-800"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">工作区信息</p>
                <div className="mt-4 grid gap-4">
                  <FieldBlock label="工作区标题" hint="建议写成这次上下文的短标题，后续会出现在列表和聊天页。">
                    <Input
                      value={newWorkspaceName}
                      onChange={(event) => onNameChange(event.target.value)}
                      placeholder="例如：登录流程重构"
                      className="border-zinc-800 bg-zinc-950"
                    />
                  </FieldBlock>

                  {selectedWorkspace ? (
                    <div className="rounded-lg border border-zinc-800 bg-black/20 px-4 py-3 text-xs leading-5 text-zinc-500">
                      {selectedWorkspace.repoReady
                        ? `当前工作区仓库已就绪${selectedWorkspace.repoPath ? `：${selectedWorkspace.repoPath}` : '。'}`
                        : '当前工作区仓库未就绪；若项目已配置 Git 地址，执行前会尝试自动准备。'}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="border-t border-zinc-900 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                {selectedWorkspaceId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onCleanup}
                    disabled={busy}
                    className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    清理工作区
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <DrawerClose asChild>
                  <Button variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
                    取消
                  </Button>
                </DrawerClose>
                <Button onClick={onSubmit} disabled={submitDisabled} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                  {selectedWorkspaceId ? '保存并打开工作区' : '创建工作区并打开'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export function TaskEditDialog({
  open,
  onOpenChange,
  taskTitleInput,
  taskDescriptionInput,
  busy,
  onTitleChange,
  onDescriptionChange,
  onSubmit,
}: TaskEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle>编辑任务</DialogTitle>
          <DialogDescription className="text-zinc-500">
            更新任务标题和描述。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <FieldBlock label="标题" hint={`最多 ${TASK_TITLE_MAX_LENGTH} 个字符。`}>
            <Input
              value={taskTitleInput}
              onChange={(event) => onTitleChange(event.target.value.slice(0, TASK_TITLE_MAX_LENGTH))}
              placeholder="任务标题"
              className="border-zinc-800 bg-zinc-950"
            />
          </FieldBlock>
          <FieldBlock label="描述" hint={`${taskDescriptionInput.length}/${TASK_DESCRIPTION_MAX_LENGTH}`}>
            <Textarea
              value={taskDescriptionInput}
              onChange={(event) => onDescriptionChange(event.target.value.slice(0, TASK_DESCRIPTION_MAX_LENGTH))}
              placeholder="描述这条任务要做什么"
              className="min-h-[140px] border-zinc-800 bg-zinc-950"
            />
          </FieldBlock>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
            取消
          </Button>
          <Button onClick={onSubmit} disabled={busy || !taskDescriptionInput.trim()} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskDeleteDialog({
  open,
  onOpenChange,
  deleteTaskChecked,
  deleteTaskWorkspaces,
  busy,
  onDeleteTaskChange,
  onDeleteTaskWorkspacesChange,
  onSubmit,
}: TaskDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle>确认删除任务</DialogTitle>
          <DialogDescription className="text-zinc-500">
            删除后无法恢复。你可以删除任务本身，也可以同时清理这个任务下的工作区。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <Checkbox
              checked={deleteTaskChecked}
              onCheckedChange={(checked) => onDeleteTaskChange(checked === true)}
            />
            <span className="text-sm text-zinc-200">删除任务</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <Checkbox
              checked={deleteTaskWorkspaces}
              onCheckedChange={(checked) => onDeleteTaskWorkspacesChange(checked === true)}
            />
            <span className="text-sm text-zinc-200">删除任务下的工作区</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={busy || (!deleteTaskChecked && !deleteTaskWorkspaces)}
          >
            删除所选内容
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-300">{label}</p>
        {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

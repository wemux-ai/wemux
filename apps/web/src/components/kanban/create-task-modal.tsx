/**
 * [INPUT]: Project/task defaults, assignee catalog, draft storage, and create-task callback.
 * [OUTPUT]: Task/subtask creation payload including Agent assignment intent and handoff prompt.
 * [POS]: Kanban task creation dialog; server remains authoritative for readiness and dispatch.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronRight, Maximize2, Minimize2, Paperclip, UserRound, X } from 'lucide-react'
import { type ProjectAssignee, type TaskQuickCreatePayload } from '../../lib/api'
import type { Project, Task, TaskStatus } from '@shared/types'
import { getProjectColor } from '@shared/project-color'
import { loadProjectAssignees } from '../../lib/project-collaboration-data'
import { clearCreateTaskDraft, loadCreateTaskDraft, saveCreateTaskDraft } from '../../lib/storage'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '../ui/dialog'
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import type { UploadedImage } from '../ui/image-input'
import {
  AssigneeChipSelect,
  CreateTaskBasicsSection,
  CreateTaskExecutionSection,
  ProjectChipSelect,
} from './create-task-modal-sections'
import {
  type SearchableSelectOption,
} from './create-task-modal-controls'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'

export type CreateTaskFormPayload = {
  projectId: string
  title?: string
  description: string
  priority: Task['priority']
  status?: TaskStatus
  startedAt?: string
  dueAt?: string
  assigneeId?: string
  assigneeAgentId?: string
  assignmentStartMode?: 'now' | 'parked'
  handoffPrompt?: string
  idempotencyKey?: string
  acceptanceCriteria?: string
  requirementType?: 'task' | 'requirement'
  parentTaskId?: string
  images?: UploadedImage[]
}

interface CreateTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  projects: Project[]
  assignees: ProjectAssignee[]
  onCreate: (payload: CreateTaskFormPayload) => Promise<boolean>
  onQuickCreate?: (payload: TaskQuickCreatePayload) => Promise<boolean>
  busy: boolean
  initialProjectId?: string
  projectLocked?: boolean
  initialRequirementType?: 'task' | 'requirement'
  initialDescription?: string
  initialPriority?: Task['priority']
  initialAssigneeId?: string
  initialAcceptanceCriteria?: string
  initialStatus?: TaskStatus
  parentTask?: Task
  draftScope?: string
}

const formatDateTimeInputPart = (value: number) => String(value).padStart(2, '0')

const toDateTimeLocalInputValue = (value?: string) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return [
    date.getFullYear(),
    formatDateTimeInputPart(date.getMonth() + 1),
    formatDateTimeInputPart(date.getDate()),
  ].join('-') + `T${formatDateTimeInputPart(date.getHours())}:${formatDateTimeInputPart(date.getMinutes())}`
}

const resolveDueAtInputValue = (inputValue: string) => {
  if (!inputValue.trim()) {
    return undefined
  }

  const date = new Date(inputValue)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const resolveStartedAtInputValue = (inputValue: string) => {
  if (!inputValue.trim()) {
    return undefined
  }

  const date = new Date(inputValue)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function CreateTaskModal({
  open,
  onOpenChange,
  project,
  projects,
  assignees,
  onCreate,
  onQuickCreate,
  busy,
  initialProjectId,
  projectLocked = false,
  initialRequirementType = 'task',
  initialDescription = '',
  initialPriority,
  initialAssigneeId,
  initialAcceptanceCriteria,
  initialStatus = 'todo',
  parentTask,
  draftScope,
}: CreateTaskModalProps) {
  const { t } = useTranslation()
  const [creationMode, setCreationMode] = useState<'manual' | 'agent'>('manual')
  const [requirementType, setRequirementType] = useState<'task' | 'requirement'>('task')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [quickCreateRequest, setQuickCreateRequest] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [priority, setPriority] = useState<'none' | 'low' | 'medium' | 'high' | 'urgent'>('none')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [assigneeId, setAssigneeId] = useState('')
  const [assignmentStartMode, setAssignmentStartMode] = useState<'now' | 'parked'>('now')
  const [handoffPrompt, setHandoffPrompt] = useState('')
  const [startedAtInput, setStartedAtInput] = useState('')
  const [dueAtInput, setDueAtInput] = useState('')
  const [isImageTargetActive, setIsImageTargetActive] = useState(false)
  const [localProjectId, setLocalProjectId] = useState(project?.id || '')
  const [localAssignees, setLocalAssignees] = useState(assignees)
  const [quickCreateAgents, setQuickCreateAgents] = useState<ProjectAssignee[]>([])
  const [quickCreateAgentsByProjectId, setQuickCreateAgentsByProjectId] = useState<Record<string, ProjectAssignee[]>>({})
  const [creatorAgentId, setCreatorAgentId] = useState('')
  const [hydratedProjectId, setHydratedProjectId] = useState('')
  const [createMore, setCreateMore] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const activeDraftScope = draftScope ?? (parentTask ? `subtask:${parentTask.id}` : undefined)
  const defaultPriority = initialPriority ?? 'none'
  const defaultAssigneeId = initialAssigneeId ?? parentTask?.assigneeId ?? ''
  const defaultAcceptanceCriteria = initialAcceptanceCriteria ?? parentTask?.acceptanceCriteria ?? ''
  const isAgentQuickCreate = creationMode === 'agent' && !parentTask
  const hasAgentAssignmentDetails = creationMode === 'manual' && assigneeId.startsWith('agent:')
  const modalTaskLabel = parentTask
    ? t('createTask.modal.newSubtask')
    : isAgentQuickCreate
      ? '通过 Agent 创建'
    : requirementType === 'requirement'
      ? t('createTask.modal.newRequirement')
      : t('createTask.modal.newTask')
  const createButtonLabel = parentTask
    ? t('createTask.modal.createSubtask')
    : isAgentQuickCreate
      ? '创建'
    : requirementType === 'requirement'
      ? t('createTask.modal.recordRequirement')
      : t('createTask.modal.createTask')

  const modalSizeClassName = expanded
    ? 'h-[min(92vh,60rem)] w-[min(96vw,64rem)] max-w-none'
    : 'h-auto max-h-[min(90vh,44rem)] w-[min(92vw,44rem)] max-w-none'

  const currentProject = useMemo(
    () => projects.find((p) => p.id === localProjectId) || (creationMode === 'manual' ? project : null),
    [creationMode, localProjectId, projects, project],
  )
  const activeProjectId = creationMode === 'agent'
    ? localProjectId
    : localProjectId || initialProjectId || project?.id || ''

  const projectOptions = useMemo<SearchableSelectOption[]>(
    () => projects.map((projectItem, index) => ({
      value: projectItem.id,
      label: projectItem.name,
      description: projectItem.gitUrl || t('projectsPage.binding.pathPlaceholder'),
      shortcutHint: String(index + 1),
      color: getProjectColor(projectItem),
    })),
    [projects, t],
  )

  const searchableProjectOptions = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: '',
        label: creationMode === 'agent' ? '由 Agent 选择' : t('createTask.modal.noProject'),
        description: creationMode === 'agent' ? 'Agent 会根据任务内容和项目上下文选择' : t('createTask.modal.projectPlaceholder'),
        shortcutHint: '0',
      },
      ...projectOptions,
    ],
    [creationMode, projectOptions, t],
  )

  const quickCreateAgentCandidates = localProjectId
    ? quickCreateAgentsByProjectId[localProjectId] ?? quickCreateAgents
    : quickCreateAgents
  const quickCreateAgentOptions = useMemo<SearchableSelectOption[]>(
    () => quickCreateAgentCandidates.map((agent) => ({
      value: agent.id.replace(/^agent:/, ''),
      label: agent.name,
      description: 'Agent',
      avatarUrl: agent.avatarUrl,
    })),
    [quickCreateAgentCandidates],
  )

  const assigneeOptions = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: '',
        label: t('createTask.modal.noAssignee'),
        description: t('createTask.modal.assigneePlaceholder'),
        shortcutHint: '0',
      },
      ...localAssignees.map((assignee, index) => ({
        value: assignee.id,
        label: assignee.name,
        description: assignee.email,
        avatarUrl: assignee.avatarUrl,
        shortcutHint: String(index + 1),
      })),
    ],
    [localAssignees, t],
  )

  const restoreDraftOrDefault = (projectId: string) => {
    const draft = loadCreateTaskDraft(projectId, activeDraftScope)

    clearImages()
    setRequirementType(draft?.requirementType ?? initialRequirementType)
    setTitle(draft?.title ?? '')
    setDescription(initialDescription || draft?.description || '')
    setAcceptanceCriteria(draft?.acceptanceCriteria ?? defaultAcceptanceCriteria)
    setPriority(draft?.priority ?? defaultPriority)
    setStatus(initialStatus)
    setAssigneeId(draft?.assigneeId ?? defaultAssigneeId)
    setAssignmentStartMode('now')
    setHandoffPrompt('')
    setStartedAtInput(toDateTimeLocalInputValue(draft?.startedAt))
    setDueAtInput(toDateTimeLocalInputValue(draft?.dueAt))
    setHydratedProjectId(projectId)
  }

  useEffect(() => {
    if (!open) {
      return
    }

    setLocalProjectId(initialProjectId || project?.id || '')
  }, [open, initialProjectId, project?.id])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    if (creationMode === 'manual') {
      restoreDraftOrDefault(activeProjectId)
    }

    const loadAssignees = async () => {
      if (!activeProjectId) {
        setLocalAssignees([])
        return
      }

      try {
        const assigneesRes = await loadProjectAssignees(activeProjectId)
        if (cancelled) return
        setLocalAssignees(assigneesRes)
      } catch (error) {
        if (cancelled) return
        setLocalAssignees([])
      }
    }

    void loadAssignees()

    return () => {
      cancelled = true
    }
  }, [
    activeDraftScope,
    activeProjectId,
    creationMode,
    defaultAcceptanceCriteria,
    defaultAssigneeId,
    defaultPriority,
    initialDescription,
    initialRequirementType,
    initialStatus,
    open,
  ])

  useEffect(() => {
    if (!open || creationMode !== 'agent') return

    let cancelled = false
    void Promise.all(projects.map(async (projectItem) => ({
      projectId: projectItem.id,
      assignees: await loadProjectAssignees(projectItem.id).catch(() => []),
    })))
      .then((catalogs) => {
        if (cancelled) return
        const agentsById = new Map<string, ProjectAssignee>()
        const agentsByProjectId: Record<string, ProjectAssignee[]> = {}
        for (const catalog of catalogs) {
          const projectAgents = catalog.assignees.filter((assignee) => assignee.kind === 'agent')
          agentsByProjectId[catalog.projectId] = projectAgents
          for (const assignee of projectAgents) {
            agentsById.set(assignee.id, assignee)
          }
        }
        setQuickCreateAgentsByProjectId(agentsByProjectId)
        setQuickCreateAgents([...agentsById.values()])
      })
      .catch(() => {
        if (!cancelled) {
          setQuickCreateAgentsByProjectId({})
          setQuickCreateAgents([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [creationMode, open, projects])

  useEffect(() => {
    if (creationMode !== 'agent') return
    if (quickCreateAgentOptions.some((option) => option.value === creatorAgentId)) return
    setCreatorAgentId(quickCreateAgentOptions[0]?.value ?? '')
  }, [creationMode, creatorAgentId, quickCreateAgentOptions])

  useEffect(() => {
    if (
      !open
      || creationMode !== 'manual'
      || !activeProjectId
      || hydratedProjectId !== activeProjectId
    ) {
      return
    }

    const hasDraftContent = Boolean(
      title.trim()
      || description.trim()
      || acceptanceCriteria.trim() !== defaultAcceptanceCriteria.trim()
      || requirementType !== 'task'
      || priority !== defaultPriority
      || assigneeId !== defaultAssigneeId
      || startedAtInput.trim()
      || dueAtInput.trim()
    )

    if (!hasDraftContent) {
      clearCreateTaskDraft(activeProjectId, activeDraftScope)
      return
    }

    saveCreateTaskDraft(activeProjectId, {
      title,
      description,
      acceptanceCriteria,
      requirementType,
      priority,
      assigneeId,
      startedAt: startedAtInput,
      dueAt: dueAtInput,
    }, activeDraftScope)
  }, [
    acceptanceCriteria,
    activeDraftScope,
    activeProjectId,
    assigneeId,
    creationMode,
    defaultAcceptanceCriteria,
    defaultAssigneeId,
    defaultPriority,
    description,
    startedAtInput,
    dueAtInput,
    hydratedProjectId,
    open,
    priority,
    requirementType,
    title,
  ])

  const clearImages = () => {
    for (const image of images) {
      if (image.url.startsWith('blob:')) {
        URL.revokeObjectURL(image.url)
      }
    }

    setImages([])
  }

  const resetState = () => {
    setCreationMode('manual')
    setRequirementType(initialRequirementType)
    setTitle('')
    setDescription(initialDescription)
    setQuickCreateRequest('')
    clearImages()
    setPriority(defaultPriority)
    setStatus(initialStatus)
    setAssigneeId(defaultAssigneeId)
    setAssignmentStartMode('now')
    setHandoffPrompt('')
    setStartedAtInput('')
    setDueAtInput('')
    setAcceptanceCriteria(defaultAcceptanceCriteria)
    setLocalProjectId(initialProjectId || project?.id || '')
    setLocalAssignees(assignees)
    setQuickCreateAgents([])
    setQuickCreateAgentsByProjectId({})
    setCreatorAgentId('')
    setHydratedProjectId('')
    setCreateMore(false)
  }

  const handleClose = () => {
    resetState()
    onOpenChange(false)
  }

  const handleCreate = async () => {
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    const trimmedQuickCreateRequest = quickCreateRequest.trim()
    if (creationMode === 'agent') {
      if (!trimmedQuickCreateRequest || !creatorAgentId || !onQuickCreate) return
      const created = await onQuickCreate({
        creatorAgentId,
        request: trimmedQuickCreateRequest,
        projectSelection: localProjectId
          ? { mode: 'fixed', projectId: localProjectId }
          : { mode: 'agent' },
        priority,
        status: status === 'backlog' ? 'backlog' : 'todo',
        assignmentStartMode: status === 'backlog' ? 'parked' : assignmentStartMode,
        idempotencyKey: crypto.randomUUID(),
      })
      if (!created) return

      if (createMore) {
        setQuickCreateRequest('')
        return
      }
      handleClose()
      return
    }

    if (!trimmedTitle && !trimmedDescription) return
    const targetProjectId = localProjectId || currentProject?.id
    if (!targetProjectId) return

    const created = await onCreate({
      projectId: targetProjectId,
      title: trimmedTitle || undefined,
      description: trimmedDescription || trimmedTitle,
      priority,
      status,
      startedAt: resolveStartedAtInputValue(startedAtInput),
      dueAt: resolveDueAtInputValue(dueAtInput),
      assigneeId: assigneeId.startsWith('agent:') ? undefined : assigneeId || undefined,
      assigneeAgentId: assigneeId.startsWith('agent:') ? assigneeId.slice('agent:'.length) : undefined,
      assignmentStartMode: status === 'backlog' ? 'parked' : assignmentStartMode,
      handoffPrompt: assignmentStartMode === 'now' ? handoffPrompt.trim() || undefined : undefined,
      idempotencyKey: crypto.randomUUID(),
      acceptanceCriteria: acceptanceCriteria.trim() || undefined,
      requirementType,
      parentTaskId: parentTask?.id,
      images,
    })
    if (!created) {
      return
    }

    clearCreateTaskDraft(targetProjectId, activeDraftScope)
    if (createMore) {
      setTitle('')
      setDescription('')
      setAcceptanceCriteria(defaultAcceptanceCriteria)
      setAssignmentStartMode('now')
      setHandoffPrompt('')
      clearImages()
      setStartedAtInput('')
      setDueAtInput('')
      setHydratedProjectId(targetProjectId)
      return
    }

    handleClose()
  }

  const handleInlineImages = async (files: File[] | null) => {
    if (!files || files.length === 0) return

    const remainingSlots = Math.max(0, 5 - images.length)
    if (remainingSlots === 0) return

    const nextImages = await Promise.all(
      files
        .filter((file) => file.type.startsWith('image/'))
        .slice(0, remainingSlots)
        .map(async (file) => ({
          id: crypto.randomUUID(),
          url: URL.createObjectURL(file),
          filename: file.name || `pasted-image-${Date.now()}.png`,
        })),
    )

    if (nextImages.length === 0) return
    setImages((current) => [...current, ...nextImages])
  }

  const handleDescriptionPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = []

    for (const item of Array.from(e.clipboardData.items)) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }

    if (files.length === 0) return
    e.preventDefault()
    void handleInlineImages(files)
  }

  const removeInlineImage = (id: string) => {
    setImages((current) => {
      const image = current.find((item) => item.id === id)
      if (image?.url.startsWith('blob:')) {
        URL.revokeObjectURL(image.url)
      }

      return current.filter((item) => item.id !== id)
    })
  }

  const hasCreateTaskContent = creationMode === 'agent'
    ? Boolean(quickCreateRequest.trim() && creatorAgentId)
    : Boolean(title.trim() || description.trim())

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : handleClose())}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'overflow-hidden rounded-xl border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40 transition-all duration-200',
          modalSizeClassName,
        )}
      >
        <DialogTitle className="sr-only">{modalTaskLabel}</DialogTitle>

        <div className={cn(
          'relative flex h-full flex-col overflow-hidden',
        )}>
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-900 px-4 pb-2.5 pt-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-zinc-400">
              <span className="inline-flex h-6 max-w-[12rem] items-center rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-300">
                <span className="truncate">
                  {creationMode === 'agent' && !localProjectId
                    ? '由 Agent 选择'
                    : currentProject?.name ?? t('createTask.modal.unselectedProject')}
                </span>
              </span>
              <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
              {parentTask ? (
                <>
                  <span className="max-w-[12rem] truncate text-xs text-zinc-500" title={parentTask.title}>
                    {parentTask.title}
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
                </>
              ) : null}
              <span className="truncate text-sm font-medium text-zinc-200">{modalTaskLabel}</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={expanded ? t('createTask.modal.collapse') : t('createTask.modal.expand')}
                onClick={() => setExpanded((prev) => !prev)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              >
                {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              <DialogClose asChild>
                <button
                  type="button"
                  aria-label={t('createTask.modal.close')}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </DialogClose>
            </div>
          </div>

          <div
            className={cn(
              'min-h-0 overflow-y-auto px-5 pb-4 pt-2 sm:px-6 sm:pt-0',
              isAgentQuickCreate && 'flex flex-col',
              expanded ? 'flex-1' : 'flex-auto',
            )}
          >
            {!parentTask ? (
              <div className="flex items-center gap-1 py-3">
                <Button
                  type="button"
                  size="sm"
                  variant={creationMode === 'manual' ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setCreationMode('manual')
                    setLocalProjectId(initialProjectId || project?.id || '')
                  }}
                  className="h-8 px-3 text-xs"
                >
                  <UserRound data-icon="inline-start" />
                  手动
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={creationMode === 'agent' ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setCreationMode('agent')
                    setLocalProjectId('')
                    setTitle('')
                    setAssigneeId('')
                    setPriority('none')
                    setStatus('todo')
                    setAssignmentStartMode('now')
                  }}
                  className="h-8 px-3 text-xs"
                >
                  <Bot data-icon="inline-start" />
                  通过 Agent
                </Button>
              </div>
            ) : null}

            {isAgentQuickCreate ? (
              <FieldGroup className={cn('gap-4', expanded && 'min-h-0 flex-1')}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">创建者</span>
                    <AssigneeChipSelect
                      value={creatorAgentId}
                      options={quickCreateAgentOptions}
                      emptyLabel="选择 Agent"
                      triggerClassName="max-w-[12rem]"
                      side="bottom"
                      sideOffset={6}
                      onChange={setCreatorAgentId}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">项目</span>
                    <ProjectChipSelect
                      value={localProjectId}
                      options={searchableProjectOptions}
                      emptyLabel="由 Agent 选择"
                      triggerClassName="max-w-[12rem]"
                      side="bottom"
                      sideOffset={6}
                      onChange={setLocalProjectId}
                    />
                  </div>
                </div>

                <Field className={cn('gap-2', expanded && 'min-h-0 flex-1')}>
                  <FieldLabel className="text-xs text-zinc-500">任务说明</FieldLabel>
                  <Textarea
                    autoFocus
                    value={quickCreateRequest}
                    onChange={(event) => setQuickCreateRequest(event.target.value)}
                    placeholder="告诉 Agent 要创建什么任务，例如：修复 Web 项目里收件箱加载缓慢的问题"
                    className={cn(
                      'resize-none rounded-lg',
                      expanded ? 'min-h-[24rem] flex-1' : 'min-h-[10rem]',
                    )}
                  />
                </Field>
              </FieldGroup>
            ) : (
              <CreateTaskBasicsSection
                expanded={expanded}
                title={title}
                setTitle={setTitle}
                description={description}
                setDescription={setDescription}
                images={images}
                removeInlineImage={removeInlineImage}
                handleDescriptionPaste={handleDescriptionPaste}
                handleInlineImages={handleInlineImages}
                isImageTargetActive={isImageTargetActive}
                setIsImageTargetActive={setIsImageTargetActive}
              />
            )}
          </div>

          <div className="shrink-0 border-t border-zinc-900 bg-[#060607] px-5 py-4 sm:px-6 sm:py-3">
            {!isAgentQuickCreate ? (
              <CreateTaskExecutionSection
                priority={priority}
                setPriority={setPriority}
                status={status}
                setStatus={setStatus}
                assigneeId={assigneeId}
                setAssigneeId={setAssigneeId}
                startedAtInput={startedAtInput}
                setStartedAtInput={setStartedAtInput}
                dueAtInput={dueAtInput}
                setDueAtInput={setDueAtInput}
                assigneeOptions={assigneeOptions}
                localProjectId={localProjectId}
                projectOptions={searchableProjectOptions}
                projectLocked={projectLocked}
                setLocalProjectId={setLocalProjectId}
              />
            ) : null}

            {hasAgentAssignmentDetails ? (
              <div className="mt-3 space-y-2 border-t border-zinc-900 pt-3">
                <Textarea
                  value={handoffPrompt}
                  onChange={(event) => setHandoffPrompt(event.target.value.slice(0, 4000))}
                  disabled={assignmentStartMode === 'parked' || status === 'backlog'}
                  placeholder="给 Agent 的补充指令（可选）"
                  className="min-h-[64px] resize-y border-zinc-800 bg-zinc-950 text-xs text-zinc-200 placeholder:text-zinc-600"
                />
                <Switch
                  checked={status !== 'backlog' && assignmentStartMode === 'now'}
                  disabled={status === 'backlog'}
                  onCheckedChange={(checked) => setAssignmentStartMode(checked ? 'now' : 'parked')}
                  label={status === 'backlog' ? 'Backlog 任务只保存负责人' : '指派后立即启动 Agent'}
                  containerClassName="px-0 py-0"
                  labelClassName="text-[11px] text-zinc-400"
                />
              </div>
            ) : null}

            <div
              className={cn(
                'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
                isAgentQuickCreate ? 'mt-0' : 'mt-4 sm:mt-3',
              )}
            >
              <div>
                {creationMode === 'manual' ? (
                  <>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleInlineImages(event.target.files ? Array.from(event.target.files) : null)
                    event.currentTarget.value = ''
                  }}
                />
                <button
                  type="button"
                  aria-label={t('createTask.modal.attachImages')}
                  onClick={() => attachmentInputRef.current?.click()}
                  className="flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                  </>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-3">
                <Switch
                  checked={createMore}
                  onCheckedChange={setCreateMore}
                  label={t('createTask.modal.createMore')}
                  containerClassName="px-0 py-0"
                  labelClassName="text-[11px] text-zinc-400"
                />
                <Button
                  onClick={handleCreate}
                  disabled={!hasCreateTaskContent || busy}
                  className="h-8 sm:h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                >
                  {createButtonLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

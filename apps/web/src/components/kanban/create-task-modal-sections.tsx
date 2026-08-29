/**
 * [INPUT]: Task form state, project/assignee options, shared limits, and shadcn form controls.
 * [OUTPUT]: Basic task fields and execution settings for the create-task dialog.
 * [POS]: Kanban create-task modal section composition.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useId, useState } from 'react'
import { CalendarClock, UserRound, X } from 'lucide-react'
import type { TaskStatus } from '@shared/types'
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '@shared/task-input-limits'
import { resolveMediaUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { DateTimePicker } from '../ui/date-time-picker'
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Textarea } from '../ui/textarea'
import { PrioritySelect, StatusSelect, type SearchableSelectOption } from './create-task-modal-controls'
import { TaskStatusIcon } from '../task-status-icon'
import type { UploadedImage } from '../ui/image-input'
import { useTranslation } from '../../lib/i18n/react'

const SETTING_CHIP_CLASS = 'inline-flex h-8 sm:h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900 hover:text-zinc-100'
const MENU_PANEL_CLASS = 'rounded-lg border border-zinc-800 bg-[#09090b] p-1 text-zinc-100 shadow-xl shadow-black/30'

export function CreateTaskBasicsSection({
  expanded,
  title,
  setTitle,
  description,
  setDescription,
  images,
  removeInlineImage,
  handleDescriptionPaste,
  handleInlineImages,
  isImageTargetActive,
  setIsImageTargetActive,
}: {
  expanded: boolean
  title: string
  setTitle: (value: string) => void
  description: string
  setDescription: (value: string) => void
  images: UploadedImage[]
  removeInlineImage: (id: string) => void
  handleDescriptionPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  handleInlineImages: (files: File[] | null) => Promise<void>
  isImageTargetActive: boolean
  setIsImageTargetActive: (value: boolean) => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()

  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldLabel htmlFor={titleId} className="sr-only">
          {t('createTask.modal.taskTitlePlaceholder')}
        </FieldLabel>
        <Input
          id={titleId}
          autoFocus
          placeholder={t('createTask.modal.taskTitlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TASK_TITLE_MAX_LENGTH))}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={descriptionId} className="sr-only">
          {t('createTask.modal.descriptionPlaceholder')}
        </FieldLabel>
        <Textarea
          id={descriptionId}
          placeholder={t('createTask.modal.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, TASK_DESCRIPTION_MAX_LENGTH))}
          onPaste={handleDescriptionPaste}
          onDragOver={(e) => {
            e.preventDefault()
            setIsImageTargetActive(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setIsImageTargetActive(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsImageTargetActive(false)
            void handleInlineImages(Array.from(e.dataTransfer.files))
          }}
          data-drop-target={isImageTargetActive}
          className={cn(
            'resize-none data-[drop-target=true]:border-primary',
            expanded ? 'min-h-[32rem]' : 'min-h-[8rem] sm:min-h-[11rem]',
          )}
        />
      </Field>

      {images.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative size-16 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              <img src={resolveMediaUrl(img.url)} alt={img.filename} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => removeInlineImage(img.id)}
                className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-3.5 text-zinc-100" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </FieldGroup>
  )
}

export function CreateTaskExecutionSection({
  priority,
  setPriority,
  status,
  setStatus,
  assigneeId,
  setAssigneeId,
  startedAtInput,
  setStartedAtInput,
  dueAtInput,
  setDueAtInput,
  assigneeOptions,
  localProjectId,
  projectOptions,
  projectLocked,
  setLocalProjectId,
}: {
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  setPriority: (value: 'none' | 'low' | 'medium' | 'high' | 'urgent') => void
  status: TaskStatus
  setStatus: (value: TaskStatus) => void
  assigneeId: string
  setAssigneeId: (value: string) => void
  startedAtInput: string
  setStartedAtInput: (value: string) => void
  dueAtInput: string
  setDueAtInput: (value: string) => void
  assigneeOptions: SearchableSelectOption[]
  localProjectId: string
  projectOptions: SearchableSelectOption[]
  projectLocked?: boolean
  setLocalProjectId: (value: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-1.5">
      <StatusSelect
        value={status}
        onChange={setStatus}
        side="top"
        sideOffset={8}
      />

      <PrioritySelect
        value={priority}
        onChange={setPriority}
        side="top"
        sideOffset={8}
      />

      <AssigneeChipSelect
        value={assigneeId}
        options={assigneeOptions}
        onChange={setAssigneeId}
      />

      <DateTimeChip
        value={startedAtInput}
        label={t('createTask.modal.startTime')}
        highlightTone="sky"
        onChange={setStartedAtInput}
      />

      <DateTimeChip
        value={dueAtInput}
        label={t('createTask.modal.dueDate')}
        highlightTone="violet"
        onChange={setDueAtInput}
      />

      {projectLocked ? (
        <div className={cn(SETTING_CHIP_CLASS, 'max-w-[10rem]')}>
          <ProjectColorSwatch color={projectOptions.find((option) => option.value === localProjectId)?.color} />
          <span className="truncate">{projectOptions.find((option) => option.value === localProjectId)?.label ?? t('createTask.modal.unselectedProject')}</span>
        </div>
      ) : (
        <ProjectChipSelect
          value={localProjectId}
          options={projectOptions}
          onChange={setLocalProjectId}
        />
      )}

    </div>
  )
}

export function AssigneeChipSelect({
  value,
  options,
  onChange,
  emptyLabel,
  triggerClassName,
  side = 'top',
  sideOffset = 8,
}: {
  value: string
  options: SearchableSelectOption[]
  onChange: (value: string) => void
  emptyLabel?: string
  triggerClassName?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(SETTING_CHIP_CLASS, 'max-w-[10rem]', triggerClassName)}>
          <AssigneeOptionAvatar option={selectedOption} compact />
          <span className={cn('truncate', !value && 'text-zinc-400')}>
            {value ? selectedOption?.label : (emptyLabel ?? t('createTask.modal.assignee'))}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align="start"
        className={cn(MENU_PANEL_CLASS, 'z-[100] w-[15.5rem] p-0')}
      >
        <div className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col gap-1 overflow-y-auto overscroll-contain p-1">
          {options.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-zinc-500">
              {emptyLabel ?? t('createTask.modal.assignee')}
            </div>
          ) : (
            options.map((option) => (
              <SelectMenuRow
                key={`${option.value || 'default'}-${option.label}`}
                active={option.value === value}
                leading={<AssigneeOptionAvatar option={option} />}
                label={option.label}
                meta={option.shortcutHint}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ProjectChipSelect({
  value,
  options,
  onChange,
  emptyLabel,
  triggerClassName,
  side = 'top',
  sideOffset = 8,
}: {
  value: string
  options: SearchableSelectOption[]
  onChange: (value: string) => void
  emptyLabel?: string
  triggerClassName?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value) ?? null
  const noProjectOption = options.find((option) => option.value === '')
  const projectItems = options.filter((option) => option.value !== '')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(SETTING_CHIP_CLASS, 'max-w-[10rem]', triggerClassName)}>
          <ProjectColorSwatch color={selectedOption?.color} />
          <span className={cn('truncate', !value && 'text-zinc-400')}>
            {value
              ? selectedOption?.label
              : (emptyLabel ?? noProjectOption?.label ?? t('createTask.modal.project'))}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align="start"
        className={cn(MENU_PANEL_CLASS, 'z-[100] w-[15.5rem] p-0')}
      >
        <div className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col gap-1 overflow-y-auto overscroll-contain p-1">
          {noProjectOption ? (
            <SelectMenuRow
              active={noProjectOption.value === value}
              leading={<ProjectColorSwatch color={noProjectOption.color} />}
              label={noProjectOption.label}
              meta={noProjectOption.shortcutHint}
              onClick={() => {
                onChange(noProjectOption.value)
                setOpen(false)
              }}
            />
          ) : null}

          {projectItems.length > 0 ? (
            <div className="px-3 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
              {t('createTask.modal.projectSectionLabel')}
            </div>
          ) : null}

          {projectItems.map((option) => (
            <SelectMenuRow
              key={option.value}
              active={option.value === value}
              leading={<ProjectColorSwatch color={option.color} />}
              label={option.label}
              meta={option.shortcutHint}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DateTimeChip({
  value,
  label,
  highlightTone,
  onChange,
}: {
  value: string
  label: string
  highlightTone: 'sky' | 'violet'
  onChange: (value: string) => void
}) {
  const accentClassName = highlightTone === 'sky'
    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:border-sky-500/40 hover:bg-sky-500/15'
    : 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:border-violet-500/40 hover:bg-violet-500/15'

  return (
    <DateTimePicker
      value={value}
      onChange={onChange}
      placeholder={label}
      side="top"
      sideOffset={6}
      className="max-w-[10rem]"
      trigger={
        <div className="inline-flex items-center gap-0.5">
            <button
              type="button"
              aria-label={value ? `${label}: ${formatDateTimeLabel(value)}` : label}
              className={cn(
                'inline-flex h-8 sm:h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900 hover:text-zinc-100',
                'max-w-[10rem]',
                value && accentClassName,
              )}
            >
            <CalendarClock className="h-3 w-3 shrink-0 text-zinc-500" />
            <span className="truncate">{value ? formatDateTimeLabel(value) : label}</span>
          </button>
          {value ? (
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
              aria-label="清空时间"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      }
    />
  )
}

function SelectMenuRow({
  active,
  leading,
  label,
  meta,
  onClick,
}: {
  active: boolean
  leading: React.ReactNode
  label: string
  meta?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center justify-between gap-2.5 rounded-md px-2.5 text-left transition-colors',
        active ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/40 hover:text-zinc-100',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {leading}
        <span className="truncate text-[13px] font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {active ? <CheckMark /> : null}
        {meta ? <span className="text-[12px] text-zinc-500">{meta}</span> : null}
      </span>
    </button>
  )
}

function AssigneeOptionAvatar({
  option,
  compact = false,
}: {
  option: SearchableSelectOption | null
  compact?: boolean
}) {
  if (!option?.value) {
    return <UserRound className={cn('shrink-0 text-zinc-500', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
  }

  return (
    <Avatar className={cn('shrink-0 border border-zinc-700 bg-zinc-900', compact ? 'h-4 w-4' : 'h-5 w-5')}>
      {option.avatarUrl ? <AvatarImage src={resolveMediaUrl(option.avatarUrl)} /> : null}
      <AvatarFallback className="bg-zinc-800 text-[9px] font-semibold text-zinc-200">
        {getInitials(option.label)}
      </AvatarFallback>
    </Avatar>
  )
}

function ProjectColorSwatch({ color }: { color?: string }) {
  return (
    <span
      className="inline-flex h-3 w-3 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color || '#52525b' }}
    />
  )
}

function CheckMark() {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-zinc-100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
      </svg>
    </span>
  )
}

function getInitials(label: string) {
  const initials = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return initials || '?'
}

function formatDateTimeLabel(value: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MetaChip({
  icon,
  label,
  compact = false,
}: {
  icon: React.ReactNode
  label: string
  compact?: boolean
}) {
  return (
    <div className={cn(SETTING_CHIP_CLASS, 'max-w-[10rem]')}>
      <span className="text-zinc-500">{icon}</span>
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </div>
  )
}

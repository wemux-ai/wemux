import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  Import,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ExecutorRecord, Project as SharedProject } from '@shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isGlobalSkill, normalizeSkillSlug, type SkillFileDetail, type SkillFileInventoryEntry, type SkillRecord } from '@shared/skill'
import { toast } from 'sonner'
import { api, type AgentRecord, type CollaborationWorkspace, type SkillScanResult } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { useApp } from '../../lib/app-provider'
import {
  COLLABORATION_WORKSPACE_CHANGE_EVENT,
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspace,
  resolveCollaborationWorkspaceId,
} from '../../lib/collaboration-workspace'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { useAppDialog } from '../ui/app-dialog-provider'
import { Badge } from '../ui/badge'
import { PreviewableImage } from '../ui/previewable-image'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { ScrollArea } from '../ui/scroll-area'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { CapabilityCard } from '../capabilities/capability-card'
import { buildSkillUsageSummary } from '../capabilities/capability-usage'
import {
  buildTree,
  CreateSkillDialog,
  formatUpdatedAt,
  ImportSkillDialog,
  type ImportMode,
  SkillTree,
} from './skills-page-parts'
import {
  compatibilityMeta,
  defaultMarkdown,
  ensureFileInventory,
  findDefaultPath,
  sourceMeta,
  summarizeImportResult,
  summarizeScanResult,
  trustMeta,
} from './skill-page-utils'

const text = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const buildSkillScopeKey = (skill: SkillRecord) => {
  if (skill.sourceType === 'project') {
    return `project:${skill.sourceRef?.trim() || 'unknown'}`
  }

  if (skill.visibility === 'workspace') {
    return `workspace:${skill.workspaceId?.trim() || 'unknown'}`
  }

  return `global:${skill.ownerUserId?.trim() || 'shared'}`
}

const dedupeSkillsForDisplay = (skills: SkillRecord[]) => {
  const keptByScopeSlug = new Map<string, SkillRecord>()

  for (const skill of skills) {
    const normalizedSlug = normalizeSkillSlug(skill.slug) ?? skill.slug.trim().toLowerCase()
    const scopeSlugKey = `${buildSkillScopeKey(skill)}:${normalizedSlug}`
    const current = keptByScopeSlug.get(scopeSlugKey)
    if (!current) {
      keptByScopeSlug.set(scopeSlugKey, skill)
      continue
    }

    const currentUpdatedAt = Date.parse(current.updatedAt)
    const nextUpdatedAt = Date.parse(skill.updatedAt)
    if (Number.isFinite(nextUpdatedAt) && (!Number.isFinite(currentUpdatedAt) || nextUpdatedAt > currentUpdatedAt)) {
      keptByScopeSlug.set(scopeSlugKey, skill)
      continue
    }

    if (nextUpdatedAt === currentUpdatedAt && skill.createdAt > current.createdAt) {
      keptByScopeSlug.set(scopeSlugKey, skill)
    }
  }

  const visibleIds = new Set(Array.from(keptByScopeSlug.values(), (skill) => skill.id))
  return skills.filter((skill) => visibleIds.has(skill.id))
}

export function SkillsPage({
  busy,
}: {
  busy: boolean
}) {
  const { language } = useTranslation()
  const { user } = useAuth()
  const { confirm } = useAppDialog()
  const { state } = useApp()
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileSaving, setFileSaving] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [toggleSavingSkillId, setToggleSavingSkillId] = useState('')
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [selectedPath, setSelectedPath] = useState('SKILL.md')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [skillFilter, setSkillFilter] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [activeFile, setActiveFile] = useState<SkillFileDetail | null>(null)
  const [fileDraft, setFileDraft] = useState('')
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview')
  const [editMode, setEditMode] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('git')
  const [summary, setSummary] = useState('')
  const [lastScanResult, setLastScanResult] = useState<SkillScanResult | null>(null)
  const [scanScope, setScanScope] = useState<'project' | 'global'>('project')
  const [scanExecutorId, setScanExecutorId] = useState('')
  const [scanProjectIds, setScanProjectIds] = useState<string[]>([])
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'workspace'>('private')
  const [workspaceId, setWorkspaceId] = useState('')
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused' | 'pi'>('all')
  const [mobileView, setMobileView] = useState<'catalog' | 'detail' | 'file'>('catalog')

  const displaySkills = useMemo(
    () => dedupeSkillsForDisplay(skills),
    [skills],
  )
  const selectedSkill = useMemo(
    () => displaySkills.find((skill) => skill.id === selectedSkillId) ?? displaySkills[0] ?? null,
    [displaySkills, selectedSkillId],
  )
  const selectedSkillWorkspace = useMemo(
    () => resolveCollaborationWorkspace(workspaces, workspaceId || selectedSkill?.workspaceId || defaultWorkspaceId),
    [defaultWorkspaceId, selectedSkill?.workspaceId, workspaceId, workspaces],
  )
  const canManageSelectedSkill = selectedSkill
    ? (!selectedSkill.ownerUserId || selectedSkill.ownerUserId === user?.id || selectedSkill.sourceType === 'project')
    : false
  const canManageSkill = (skill: SkillRecord) => !skill.ownerUserId || skill.ownerUserId === user?.id || skill.sourceType === 'project'

  const usageBySkillId = useMemo(() => {
    return new Map(displaySkills.map((skill) => [skill.id, buildSkillUsageSummary({ agents, skill })]))
  }, [agents, displaySkills])
  const selectedSkillUsage = useMemo(
    () => selectedSkill ? (usageBySkillId.get(selectedSkill.id) ?? null) : null,
    [selectedSkill, usageBySkillId],
  )
  const availableProjects = useMemo<Array<Pick<SharedProject, 'id' | 'name'>>>(() => {
    return [...state.projects]
      .map((project) => ({ id: project.id, name: project.name }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [state.projects])

  const filteredSkills = useMemo(() => {
    const keyword = skillFilter.trim().toLowerCase()

    return displaySkills.filter((skill) => {
      const haystack = [
        skill.name,
        skill.slug,
        skill.description ?? '',
        skill.sourceLocator ?? '',
      ].join(' ').toLowerCase()
      const usage = usageBySkillId.get(skill.id)
      const keywordMatches = !keyword || haystack.includes(keyword)
      const usageMatches = usageFilter === 'all'
        ? true
        : usageFilter === 'used'
          ? (usage?.usedByCount ?? 0) > 0
          : usageFilter === 'unused'
            ? (usage?.usedByCount ?? 0) === 0
            : (usage?.usedByPiAgentsCount ?? 0) > 0

      return keywordMatches && usageMatches
    })
  }, [displaySkills, skillFilter, usageBySkillId, usageFilter])

  const groupedSkills = useMemo(() => {
    return {
      global: filteredSkills.filter((skill) => isGlobalSkill(skill)),
      project: filteredSkills.filter((skill) => !isGlobalSkill(skill)),
    }
  }, [filteredSkills])

  const selectedTree = useMemo(
    () => buildTree(selectedSkill ? ensureFileInventory(selectedSkill) : []),
    [selectedSkill],
  )

  const metaDirty = selectedSkill
    ? (
      name !== selectedSkill.name
      || slug !== selectedSkill.slug
      || description !== (selectedSkill.description ?? '')
      || (selectedSkill.sourceType !== 'project' && (
        visibility !== (selectedSkill.visibility ?? 'private')
        || (visibility === 'workspace' ? workspaceId !== (selectedSkill.workspaceId ?? '') : Boolean(selectedSkill.workspaceId))
      ))
    )
    : false
  const fileDirty = activeFile ? fileDraft !== activeFile.content : false

  const loadSkills = async () => {
    setLoading(true)
    try {
      const [response, workspaceResponse, agentsResponse, executorsResponse] = await Promise.all([
        api.listSkills(getStoredCollaborationWorkspaceId() || undefined),
        api.listCollaborationWorkspaces().catch(() => ({ workspaces: [] })),
        api.listAgents().catch(() => ({ agents: [] })),
        api.listExecutors().catch(() => ({ executors: [] })),
      ])
      setSkills(response.skills)
      setWorkspaces(workspaceResponse.workspaces)
      setAgents(agentsResponse.agents)
      setExecutors(executorsResponse.executors)
      setDefaultWorkspaceId((current) => resolveCollaborationWorkspaceId(
        workspaceResponse.workspaces,
        current || getStoredCollaborationWorkspaceId(),
      ))
      setSelectedSkillId((current) => {
        if (response.skills.some((skill) => skill.id === current)) {
          return current
        }

        return response.skills[0]?.id ?? ''
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, 'Skills 加载失败', 'Failed to load skills'))
    } finally {
      setLoading(false)
    }
  }

  const loadSkillFile = async (skillId: string, filePath: string) => {
    setFileLoading(true)
    try {
      const response = await api.getSkillFile(skillId, filePath)
      setActiveFile(response)
      setFileDraft(response.content)
      setEditMode(false)
      setPreviewMode(response.markdown ? 'preview' : 'code')
    } catch (error) {
      setActiveFile(null)
      toast.error(error instanceof Error ? error.message : text(language, 'Skill 文件加载失败', 'Failed to load skill file'))
    } finally {
      setFileLoading(false)
    }
  }

  useEffect(() => {
    void loadSkills()
  }, [])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const nextWorkspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      setDefaultWorkspaceId(resolveCollaborationWorkspaceId(workspaces, nextWorkspaceId || getStoredCollaborationWorkspaceId()))
    }

    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => {
      window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    }
  }, [workspaces])

  useEffect(() => {
    if (!selectedSkill) {
      setName('')
      setSlug('')
      setDescription('')
      setSelectedPath('SKILL.md')
      setActiveFile(null)
      setMobileView('catalog')
      return
    }

    setName(selectedSkill.name)
    setSlug(selectedSkill.slug)
    setDescription(selectedSkill.description ?? '')
    setVisibility(selectedSkill.visibility ?? 'private')
    setWorkspaceId(selectedSkill.workspaceId ?? defaultWorkspaceId)
    setSelectedPath((current) => {
      return ensureFileInventory(selectedSkill).some((entry) => entry.path === current)
        ? current
        : findDefaultPath(selectedSkill)
    })
    setExpandedDirs(new Set(['references', 'scripts', 'assets']))
  }, [defaultWorkspaceId, selectedSkill?.id, selectedSkill?.updatedAt])

  useEffect(() => {
    if (scanProjectIds.length === 0) {
      return
    }

    const validProjectIds = new Set(availableProjects.map((project) => project.id))
    setScanProjectIds((current) => current.filter((projectId) => validProjectIds.has(projectId)))
  }, [availableProjects, scanProjectIds.length])

  useEffect(() => {
    if (!selectedSkill) {
      return
    }

    void loadSkillFile(selectedSkill.id, selectedPath)
  }, [selectedPath, selectedSkill?.id])

  const handleSelectSkill = (skillId: string) => {
    setSelectedSkillId(skillId)
    setMobileView('detail')
  }

  const handleSelectPath = (path: string) => {
    setSelectedPath(path)
    setMobileView('file')
  }

  const handleCreateSkill = async (payload: {
    name: string
    slug: string
    description: string
  }) => {
    setMetaSaving(true)
    try {
      const response = await api.createSkill({
        name: payload.name.trim(),
        slug: payload.slug.trim() || undefined,
        description: payload.description.trim() || undefined,
        markdown: defaultMarkdown(payload.name.trim(), payload.description.trim(), language === 'zh' ? 'zh' : 'en'),
      })
      await loadSkills()
      setSelectedSkillId(response.skill.id)
      setCreateOpen(false)
      toast.success(text(language, 'Skill 已创建', 'Skill created'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, 'Skill 创建失败', 'Failed to create skill'))
    } finally {
      setMetaSaving(false)
    }
  }

  const handleGitImport = async (payload: { url: string; ref: string; subdirectory: string }) => {
    setGitBusy(true)
    try {
      const result = await api.importSkills({
        mode: 'git',
        url: payload.url.trim(),
        ref: payload.ref.trim() || undefined,
        subdirectory: payload.subdirectory.trim() || undefined,
      })
      setSummary(summarizeImportResult(result, language === 'zh' ? 'zh' : 'en'))
      await loadSkills()
      setImportOpen(false)
      toast.success(text(language, `导入完成：新增 ${result.imported.length}，更新 ${result.updated.length}`, `Import complete: ${result.imported.length} added, ${result.updated.length} updated`))
      if (result.warnings[0]) {
        toast.warning(result.warnings[0])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, 'Git 导入失败', 'Git import failed'))
    } finally {
      setGitBusy(false)
    }
  }

  const handleDownloadImport = async (url: string) => {
    setDownloadBusy(true)
    try {
      const result = await api.importSkills({
        mode: 'download',
        url: url.trim(),
      })
      setSummary(summarizeImportResult(result, language === 'zh' ? 'zh' : 'en'))
      await loadSkills()
      setImportOpen(false)
      toast.success(text(language, `下载导入完成：新增 ${result.imported.length}，更新 ${result.updated.length}`, `Download import complete: ${result.imported.length} added, ${result.updated.length} updated`))
      if (result.warnings[0]) {
        toast.warning(result.warnings[0])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '下载导入失败', 'Download import failed'))
    } finally {
      setDownloadBusy(false)
    }
  }

  const handleScanSkills = async (payload?: {
    scope?: 'project' | 'global'
    projectIds?: string[]
    executorId?: string
  }) => {
    setScanBusy(true)
    try {
      const nextScope = payload?.scope ?? scanScope
      const normalizedProjectIds = Array.from(new Set((payload?.projectIds ?? scanProjectIds).map((projectId) => projectId.trim()).filter(Boolean)))
      const normalizedExecutorId = (payload?.executorId ?? scanExecutorId).trim()
      const result = await api.scanSkills(nextScope === 'global'
        ? {
            scope: 'global',
            executorId: normalizedExecutorId || undefined,
          }
        : {
            scope: 'project',
            projectIds: normalizedProjectIds.length > 0 ? normalizedProjectIds : undefined,
            executorId: normalizedExecutorId || undefined,
          })
      setLastScanResult(result)
      setSummary(summarizeScanResult(result, language === 'zh' ? 'zh' : 'en'))
      await loadSkills()
      toast.success(text(language, `扫描完成：新增 ${result.imported.length}，更新 ${result.updated.length}`, `Scan complete: ${result.imported.length} added, ${result.updated.length} updated`))
      if (result.skipped[0]) {
        const firstSkipped = result.skipped[0]
        toast.warning(text(
          language,
          `${firstSkipped.subjectName}：${firstSkipped.reason}`,
          `${firstSkipped.subjectName}: ${firstSkipped.reason}`,
        ))
      } else if (result.warnings[0]) {
        toast.warning(result.warnings[0])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '扫描失败', 'Scan failed'))
    } finally {
      setScanBusy(false)
    }
  }

  const handleSaveMeta = async () => {
    if (!selectedSkill || !metaDirty || !canManageSelectedSkill) {
      return
    }

    setMetaSaving(true)
    try {
      const response = await api.updateSkill(selectedSkill.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        visibility: selectedSkill.sourceType === 'project' ? undefined : visibility,
        workspaceId: selectedSkill.sourceType === 'project'
          ? undefined
          : (visibility === 'workspace' ? workspaceId || undefined : ''),
      })
      setSkills((current) => current.map((skill) => skill.id === response.skill.id ? response.skill : skill))
      toast.success(text(language, 'Skill 信息已保存', 'Skill info saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '信息保存失败', 'Failed to save info'))
    } finally {
      setMetaSaving(false)
    }
  }

  const handleSaveFile = async () => {
    if (!selectedSkill || !activeFile || !fileDirty) {
      return
    }

    setFileSaving(true)
    try {
      const response = await api.updateSkillFile(selectedSkill.id, {
        path: activeFile.path,
        content: fileDraft,
      })
      setActiveFile(response)
      setFileDraft(response.content)
      setEditMode(false)
      await loadSkills()
      toast.success(text(language, `已保存 ${response.path}`, `Saved ${response.path}`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '文件保存失败', 'Failed to save file'))
    } finally {
      setFileSaving(false)
    }
  }

  const handleDeleteSkill = async () => {
    if (!selectedSkill) {
      return
    }

    const confirmed = await confirm({
      title: text(language, `确认删除 Skill「${selectedSkill.name}」？`, `Delete skill "${selectedSkill.name}"?`),
      description: text(language, '删除后将从当前技能目录移除对应文件。', 'This removes the corresponding files from the current skill directory.'),
      confirmText: text(language, '删除 Skill', 'Delete Skill'),
      cancelText: text(language, '取消', 'Cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setMetaSaving(true)
    try {
      await api.deleteSkill(selectedSkill.id)
      setActiveFile(null)
      await loadSkills()
      toast.success(text(language, 'Skill 已删除', 'Skill deleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, 'Skill 删除失败', 'Failed to delete skill'))
    } finally {
      setMetaSaving(false)
    }
  }

  const handleToggleSkillEnabled = async (skill: SkillRecord, enabled: boolean) => {
    setToggleSavingSkillId(skill.id)
    try {
      const response = await api.updateSkill(skill.id, { enabled })
      setSkills((current) => current.map((item) => {
        if (item.id !== response.skill.id) {
          return item
        }

        return item.id === selectedSkillId
          ? { ...response.skill, updatedAt: item.updatedAt }
          : response.skill
      }))
      toast.success(text(language, enabled ? 'Skill 已启用' : 'Skill 已停用', enabled ? 'Skill enabled' : 'Skill disabled'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '状态切换失败', 'Failed to update skill status'))
    } finally {
      setToggleSavingSkillId('')
    }
  }

  const visibilityMeta = (skill: SkillRecord) => {
    if (skill.sourceType === 'project') {
      const project = state.projects.find((p) => p.id === skill.sourceRef)
      return {
        label: project?.name || text(language, '项目内', 'Project'),
        description: text(language, '只在所属项目内可用。', 'Only available inside its project.'),
        className: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
      }
    }

    if (skill.visibility === 'workspace') {
      return {
        label: text(language, '组织共享', 'Workspace shared'),
        description: text(language, `共享到 ${resolveCollaborationWorkspace(workspaces, skill.workspaceId)?.name || '当前组织'}。`, `Shared to ${resolveCollaborationWorkspace(workspaces, skill.workspaceId)?.name || 'the current workspace'}.`),
        className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
      }
    }

    if (skill.ownerUserId) {
      return {
        label: text(language, '私有', 'Private'),
        description: text(language, '仅自己可见。', 'Only visible to you.'),
        className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
      }
    }

    return {
      label: text(language, '全局可见', 'Global'),
      description: text(language, '历史全局 Skill，当前对所有人可见。', 'Legacy global skill visible to everyone.'),
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    }
  }

  const renderSkillSection = (title: string, items: SkillRecord[], emptyText: string) => {
    return (
      <div className="w-full space-y-1">
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-zinc-400">
          {title}
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <div className="px-2 py-2 text-xs text-zinc-500">{emptyText}</div>
        ) : (
          items.map((skill) => {
            const source = sourceMeta(skill.sourceType, language === 'zh' ? 'zh' : 'en')
            const scope = visibilityMeta(skill)
            const usage = usageBySkillId.get(skill.id)
            const active = selectedSkill?.id === skill.id

            return (
              <div
                key={skill.id}
                className={cn(
                  'box-border w-full min-w-0 overflow-hidden rounded-lg border px-3 py-2.5 transition-colors',
                  active ? 'border-zinc-700 bg-zinc-800/80' : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900',
                  !skill.enabled && 'opacity-75',
                )}
              >
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <button
                    type="button"
                    onClick={() => handleSelectSkill(skill.id)}
                    className="min-w-0 flex-1 overflow-hidden text-left"
                  >
                    <div className="min-w-0">
                      <span className={cn('block truncate text-sm font-medium', active ? 'text-zinc-100' : 'text-zinc-300')}>{skill.name}</span>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', active ? 'bg-zinc-700 text-zinc-300' : source.className)}>{source.label}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px]', active ? 'bg-zinc-700 text-zinc-300' : scope.className)}>{scope.label}</span>
                      <span className="text-[10px] text-zinc-500">{usage?.usedByCount ?? 0}</span>
                    </div>
                  </button>
                  <div className="shrink-0 self-center pt-0.5">
                    <Switch
                      checked={skill.enabled}
                      disabled={toggleSavingSkillId === skill.id || !canManageSkill(skill)}
                      onCheckedChange={(checked) => void handleToggleSkillEnabled(skill, checked)}
                      aria-label={text(language, `${skill.name} 开关`, `${skill.name} toggle`)}
                      className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700"
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#050505] text-zinc-100">
        <div className="grid min-h-0 min-w-0 flex-1 xl:grid-cols-[18rem_22rem_minmax(0,1fr)]">
          <aside
            className={cn(
              'flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-zinc-800 xl:border-b-0 xl:border-r',
              mobileView !== 'catalog' && 'hidden xl:flex',
            )}
          >
            <div className="shrink-0 border-b border-zinc-800 px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-100">
                    <Bot size={16} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-zinc-50">{text(language, 'Skill 能力库', 'Skill Registry')}</h2>
                    <p className="text-xs text-zinc-500">{displaySkills.length} {text(language, '个 Skill', 'skills')}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                  className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <Import size={14} />
                  {text(language, '导入', 'Import')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <Plus size={14} />
                  {text(language, '新建', 'New')}
                </Button>
              </div>

              {summary ? (
                <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                  {summary}
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <span className="text-lg font-semibold text-zinc-100">{displaySkills.length}</span>
                  <span className="ml-1 text-xs text-zinc-500">{text(language, '全部', 'Total')}</span>
                </div>
                <div>
                  <span className="text-lg font-semibold text-emerald-400">{groupedSkills.global.length}</span>
                  <span className="ml-1 text-xs text-zinc-500">{text(language, '全局', 'Global')}</span>
                </div>
                <div>
                  <span className="text-lg font-semibold text-sky-400">{groupedSkills.project.length}</span>
                  <span className="ml-1 text-xs text-zinc-500">{text(language, '项目', 'Project')}</span>
                </div>
              </div>
            </div>

            <ScrollArea className="min-h-0 min-w-0 flex-1">
              <div className="box-border w-full space-y-4 p-3 pr-4">
                {loading ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-6 text-sm text-zinc-500">
                    {text(language, '正在加载 skills...', 'Loading skills...')}
                  </div>
                ) : null}
                {!loading && filteredSkills.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-6 text-sm text-zinc-500">
                    {displaySkills.length === 0 ? text(language, '还没有任何 skill，先引入一个。', 'No skills yet. Import one to get started.') : text(language, '没有匹配的 skill。', 'No matching skills.')}
                  </div>
                ) : null}
                {renderSkillSection(text(language, '全局 Skills', 'Global Skills'), groupedSkills.global, text(language, '还没有全局 skill。', 'No global skills yet.'))}
                {renderSkillSection(text(language, '项目 Skills', 'Project Skills'), groupedSkills.project, text(language, '当前没有项目 skill。', 'No project skills.'))}
              </div>
            </ScrollArea>
          </aside>

          <section
            className={cn(
              'flex min-h-0 min-w-0 flex-col border-b border-zinc-800 bg-zinc-950/30 xl:border-b-0 xl:border-r',
              mobileView !== 'detail' && 'hidden xl:flex',
            )}
          >
            {!selectedSkill ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="text-center">
                  <Bot className="mx-auto h-8 w-8 text-zinc-600" />
                  <p className="mt-3 text-sm text-zinc-500">{text(language, '选择左侧 Skill 查看详情', 'Select a skill from the left')}</p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-zinc-800 px-4 py-3">
                  <div className="mb-2 xl:hidden">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setMobileView('catalog')}
                      className="-ml-2 h-8 px-2 text-zinc-400 hover:text-zinc-100"
                    >
                      <ChevronLeft size={16} />
                      {text(language, '返回列表', 'Back to list')}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold text-zinc-50">{selectedSkill.name}</h3>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] shrink-0',
                            isGlobalSkill(selectedSkill)
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : 'border-sky-500/20 bg-sky-500/10 text-sky-300',
                          )}
                        >
                          {isGlobalSkill(selectedSkill) ? text(language, '全局', 'Global') : text(language, '项目', 'Project')}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-xs text-zinc-500 sm:truncate">{selectedSkill.description}</p>
                    </div>
                    <div className="flex items-center gap-1 self-end sm:self-auto">
                      <Button variant="ghost" size="icon" disabled={busy || loading} onClick={() => void loadSkills()} className="h-8 w-8">
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                      </Button>
                      <Button variant="ghost" size="icon" disabled={metaSaving || !canManageSelectedSkill} onClick={() => void handleDeleteSkill()} className="h-8 w-8 text-rose-400 hover:text-rose-300">
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-4 p-4">
                    <div className="space-y-2">
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={text(language, '名称', 'Name')} className="border-zinc-800 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500" />
                      <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug" className="border-zinc-800 bg-zinc-950 font-mono text-zinc-100 placeholder:text-zinc-500" />
                      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={text(language, '描述', 'Description')} className="border-zinc-800 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500" />
                      {selectedSkill.sourceType !== 'project' && (
                        <NativeSelect value={visibility} disabled={!canManageSelectedSkill} onChange={(e) => setVisibility(e.target.value as 'private' | 'workspace')} className="border-zinc-800 bg-zinc-950 text-zinc-100">
                          <option value="private">{text(language, '私有', 'Private')}</option>
                          <option value="workspace">{text(language, '组织', 'Workspace')}</option>
                        </NativeSelect>
                      )}
                      <Button disabled={!metaDirty || metaSaving || !canManageSelectedSkill} onClick={() => void handleSaveMeta()} size="sm" className="w-full">
                        <Save size={14} />
                        {metaSaving ? text(language, '保存中...', 'Saving...') : text(language, '保存', 'Save')}
                      </Button>
                    </div>

                    <div>
                      <p className="mb-2 text-xs text-zinc-500">{text(language, '文件', 'Files')}</p>
                      <SkillTree
                        expandedDirs={expandedDirs}
                        nodes={selectedTree}
                        onSelectPath={handleSelectPath}
                        onToggleDir={(path) => {
                          setExpandedDirs((current) => {
                            const next = new Set(current)
                            next.has(path) ? next.delete(path) : next.add(path)
                            return next
                          })
                        }}
                        selectedPath={selectedPath}
                      />
                    </div>
                  </div>
                </ScrollArea>
              </div>
            )}
          </section>

          <section
            className={cn(
              'flex min-h-0 min-w-0 flex-col',
              mobileView !== 'file' && 'hidden xl:flex',
            )}
          >
            {!selectedSkill ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <FileText className="mx-auto h-8 w-8 text-zinc-600" />
                  <p className="mt-3 text-sm text-zinc-500">{text(language, '选择 Skill 后查看文件', 'Select a skill to view files')}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="border-b border-zinc-800 px-4 py-3">
                  <div className="mb-2 xl:hidden">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setMobileView('detail')}
                      className="-ml-2 h-8 px-2 text-zinc-400 hover:text-zinc-100"
                    >
                      <ChevronLeft size={16} />
                      {text(language, '返回详情', 'Back to details')}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {activeFile?.kind === 'asset' ? (
                        <ImageIcon size={14} className="shrink-0 text-zinc-500" />
                      ) : (
                        <FileText size={14} className="shrink-0 text-zinc-500" />
                      )}
                      <p className="truncate font-mono text-sm text-zinc-200">{activeFile?.path ?? selectedPath}</p>
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 shrink-0 lg:w-auto lg:justify-end">
                      {activeFile?.markdown && !editMode && (
                        <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
                          <button type="button" onClick={() => setPreviewMode('preview')} className={cn('rounded-md px-3 py-1 text-xs transition-colors', previewMode === 'preview' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-100')}>
                            {text(language, '预览', 'Preview')}
                          </button>
                          <button type="button" onClick={() => setPreviewMode('code')} className={cn('rounded-md px-3 py-1 text-xs transition-colors', previewMode === 'code' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-100')}>
                            {text(language, '源码', 'Code')}
                          </button>
                        </div>
                      )}
                      {activeFile?.editable && canManageSelectedSkill && (
                        editMode ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => { setEditMode(false); setFileDraft(activeFile.content) }}>
                              {text(language, '取消', 'Cancel')}
                            </Button>
                            <Button size="sm" disabled={!fileDirty || fileSaving} onClick={() => void handleSaveFile()}>
                              <Save size={14} />
                              {fileSaving ? text(language, '保存中...', 'Saving...') : text(language, '保存', 'Save')}
                            </Button>
                          </>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setEditMode(true)} className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
                            <Pencil size={14} />
                            {text(language, '编辑', 'Edit')}
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex min-h-0 flex-col p-3 sm:p-4">
                    {fileLoading ? (
                      <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
                        {text(language, '加载中...', 'Loading...')}
                      </div>
                    ) : !activeFile ? (
                      <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
                        {text(language, '从左侧选择文件', 'Select a file from the left')}
                      </div>
                    ) : editMode ? (
                      <Textarea
                        value={fileDraft}
                        onChange={(e) => setFileDraft(e.target.value)}
                        className="min-h-0 flex-1 border-zinc-800 bg-zinc-950 font-mono text-xs leading-6 text-zinc-100"
                      />
                    ) : activeFile.kind === 'asset' ? (
                      <div className="flex justify-center">
                        <PreviewableImage
                          src={`data:image/${activeFile.path.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'png'};base64,${activeFile.content}`}
                          alt={activeFile.path}
                          caption={activeFile.path}
                        />
                      </div>
                    ) : activeFile.markdown && previewMode === 'preview' ? (
                      <div className="skill-markdown-preview markdown-body prose prose-sm sm:prose-base prose-invert max-w-none break-words prose-headings:break-words prose-headings:text-zinc-50 prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-100 prose-code:break-all prose-code:text-zinc-100 prose-pre:border prose-pre:border-zinc-800 prose-pre:bg-zinc-950/70">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {activeFile.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 font-mono text-[11px] leading-6 text-zinc-200 sm:text-xs">
                        <code>{activeFile.content}</code>
                      </pre>
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
          </section>
        </div>
      </div>

      <CreateSkillDialog
        busy={metaSaving}
        open={createOpen}
        onCreate={handleCreateSkill}
        onOpenChange={setCreateOpen}
      />

      <ImportSkillDialog
        busy={busy}
        downloadBusy={downloadBusy}
        gitBusy={gitBusy}
        loading={loading}
        mode={importMode}
        open={importOpen}
        executors={executors}
        lastScanResult={lastScanResult}
        projects={availableProjects}
        scanBusy={scanBusy}
        selectedScanScope={scanScope}
        selectedExecutorId={scanExecutorId}
        selectedProjectIds={scanProjectIds}
        onClose={() => setImportOpen(false)}
        onDownload={handleDownloadImport}
        onGit={handleGitImport}
        onModeChange={setImportMode}
        onOpenChange={setImportOpen}
        onRefresh={loadSkills}
        onSelectedScanScopeChange={setScanScope}
        onSelectedExecutorIdChange={setScanExecutorId}
        onSelectedProjectIdsChange={setScanProjectIds}
        onScan={handleScanSkills}
      />
    </>
  )
}

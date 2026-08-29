import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Link2, Pencil, Plus, RefreshCcw, Save, ScanSearch, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { filterEnabledSkills, type SkillFileDetail, type SkillFileInventoryEntry, type SkillRecord } from '@shared/skill'
import { toast } from 'sonner'
import { api, type CollaborationWorkspace, type SkillScanResult } from '../../lib/api'
import type { PrimaryAgentDraft, SkillPolicy } from '../../lib/agent-config'
import { useAuth } from '../../lib/auth-context'
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
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { PreviewableImage } from '../ui/previewable-image'
import { ScrollArea } from '../ui/scroll-area'
import { Textarea } from '../ui/textarea'
import { buildTree, compatibilityBadgeMeta, CreateSkillInlinePanel, createSkillPolicy, describeScanResult, EmptyLibrary, ensureFileInventory, findDefaultPath, formatUpdatedAt, isSkillAttached, ScanSourcePanel, SkillTree, sourceBadgeMeta, trustBadgeMeta } from './skill-catalog-panel-parts'

export function SkillCatalogPanel({
  busy,
  draft,
  onChange,
  mode = 'agent',
}: {
  busy: boolean
  draft?: PrimaryAgentDraft
  onChange?: (updater: (current: PrimaryAgentDraft) => PrimaryAgentDraft) => void
  mode?: 'agent' | 'global'
}) {
  const { language, t } = useTranslation()
  const { user } = useAuth()
  const { confirm } = useAppDialog()
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [fileSaving, setFileSaving] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Record<string, Set<string>>>({})
  const [selectedPaths, setSelectedPaths] = useState<Record<string, string>>({})
  const [skillFilter, setSkillFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [activeFile, setActiveFile] = useState<SkillFileDetail | null>(null)
  const [fileDraft, setFileDraft] = useState('')
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [editMode, setEditMode] = useState(false)
  const [scanSummary, setScanSummary] = useState('')
  const agentMode = mode === 'agent'

  const selectedSkill = useMemo(
    () => skills.find((item) => item.id === selectedSkillId) ?? skills[0] ?? null,
    [selectedSkillId, skills],
  )

  const selectedPath = useMemo(() => {
    if (!selectedSkill) {
      return 'SKILL.md'
    }

    return selectedPaths[selectedSkill.id] ?? findDefaultPath(selectedSkill)
  }, [selectedPaths, selectedSkill])

  const filteredSkills = useMemo(() => {
    const keyword = skillFilter.trim().toLowerCase()
    if (!keyword) {
      return skills
    }

    return skills.filter((skill) => {
      const haystack = [
        skill.name,
        skill.slug,
        skill.description ?? '',
        skill.sourceLocator ?? '',
      ].join(' ').toLowerCase()

      return haystack.includes(keyword)
    })
  }, [skillFilter, skills])

  const selectedSkillTree = useMemo(
    () => buildTree(selectedSkill ? ensureFileInventory(selectedSkill) : []),
    [selectedSkill],
  )
  const canManageSelectedSkill = selectedSkill
    ? (!selectedSkill.ownerUserId || selectedSkill.ownerUserId === user?.id || selectedSkill.sourceType === 'project')
    : false

  const attached = agentMode && draft && selectedSkill ? isSkillAttached(draft, selectedSkill) : false
  const metaDirty = selectedSkill
    ? name !== selectedSkill.name || slug !== selectedSkill.slug || description !== (selectedSkill.description ?? '')
    : false
  const fileDirty = activeFile ? fileDraft !== activeFile.content : false

  const loadSkills = async () => {
    setLoading(true)
    try {
      const [response, workspaceResponse] = await Promise.all([
        api.listSkills(getStoredCollaborationWorkspaceId() || undefined),
        api.listCollaborationWorkspaces().catch(() => ({ workspaces: [] })),
      ])
      const enabledSkills = filterEnabledSkills(response.skills)
      setSkills(enabledSkills)
      setWorkspaces(workspaceResponse.workspaces)
      setDefaultWorkspaceId((current) => resolveCollaborationWorkspaceId(
        workspaceResponse.workspaces,
        current || getStoredCollaborationWorkspaceId(),
      ))
      setSelectedSkillId((current) => {
        if (enabledSkills.some((item) => item.id === current)) {
          return current
        }

        return enabledSkills[0]?.id ?? ''
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const attachSkill = (skill: SkillRecord) => {
    if (!draft || !onChange) {
      return
    }

    onChange((current) => {
      if (isSkillAttached(current, skill)) {
        return current
      }

      return {
        ...current,
        skills: [...current.skills, createSkillPolicy(skill)],
      }
    })
  }

  const detachSkill = (skill: SkillRecord) => {
    if (!onChange) {
      return
    }

    onChange((current) => ({
      ...current,
      skills: current.skills.filter((item) => {
        return item.skillId !== skill.id
          && item.slug !== skill.slug
          && item.name.trim().toLowerCase() !== skill.name.trim().toLowerCase()
      }),
    }))
  }

  const createManualSkill = async () => {
    if (!createName.trim()) {
      toast.error(t('agents.skillLibrary.toasts.nameRequired'))
      return
    }
    setMetaSaving(true)
    try {
      const response = await api.createSkill({
        name: createName.trim(),
        slug: createSlug.trim() || undefined,
        description: createDescription.trim() || undefined,
        markdown: [
          `# ${createName.trim()}`,
          '',
          createDescription.trim() || t('agents.skillLibrary.create.defaultDescription'),
          '',
          `## ${t('agents.skillLibrary.create.defaultUsageHeading')}`,
          '',
          `- ${t('agents.skillLibrary.create.defaultUsageItems.triggers')}`,
          `- ${t('agents.skillLibrary.create.defaultUsageItems.steps')}`,
          `- ${t('agents.skillLibrary.create.defaultUsageItems.constraints')}`,
        ].join('\n'),
      })

      setCreateName('')
      setCreateSlug('')
      setCreateDescription('')
      setCreateOpen(false)
      await loadSkills()
      setSelectedSkillId(response.skill.id)
      setExpandedSkillId(response.skill.id)
      toast.success(t('agents.skillLibrary.toasts.created'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.createFailed'))
    } finally {
      setMetaSaving(false)
    }
  }

  const scanSkills = async () => {
    setScanBusy(true)
    try {
      const result = await api.scanSkills({ scope: 'global' })
      setScanSummary(describeScanResult(result, t))
      await loadSkills()
      toast.success(t('agents.skillLibrary.toasts.scanSuccess', { imported: result.imported.length, updated: result.updated.length }))
      if (result.warnings[0]) {
        toast.warning(result.warnings[0])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.scanFailed'))
    } finally {
      setScanBusy(false)
    }
  }

  const saveMeta = async () => {
    if (!selectedSkill || !metaDirty) {
      return
    }

    setMetaSaving(true)
    try {
      const response = await api.updateSkill(selectedSkill.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
      })

      setSkills((current) => current.map((item) => (item.id === response.skill.id ? response.skill : item)))
      toast.success(t('agents.skillLibrary.toasts.metaSaved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.metaSaveFailed'))
    } finally {
      setMetaSaving(false)
    }
  }

  const saveFile = async () => {
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
      toast.success(t('agents.skillLibrary.toasts.fileSaved', { path: response.path }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.fileSaveFailed'))
    } finally {
      setFileSaving(false)
    }
  }

  const removeSelectedSkill = async () => {
    if (!selectedSkill) {
      return
    }

    const confirmed = await confirm({
      title: t('agents.skillLibrary.deleteDialog.title', { name: selectedSkill.name }),
      description: attached ? t('agents.skillLibrary.deleteDialog.attachedDescription') : t('agents.skillLibrary.deleteDialog.description'),
      confirmText: t('agents.skillLibrary.deleteDialog.confirm'),
      cancelText: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setMetaSaving(true)
    try {
      await api.deleteSkill(selectedSkill.id)
      if (attached) {
        detachSkill(selectedSkill)
      }
      setActiveFile(null)
      await loadSkills()
      toast.success(t('agents.skillLibrary.toasts.deleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.deleteFailed'))
    } finally {
      setMetaSaving(false)
    }
  }

  const visibilityMeta = (skill: SkillRecord) => {
    if (skill.sourceType === 'project') {
      return {
        label: t('agents.skillLibrary.visibility.project'),
        description: t('agents.skillLibrary.visibilityDescriptions.project'),
        className: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
      }
    }

    if (skill.visibility === 'workspace') {
      return {
        label: t('agents.skillLibrary.visibility.workspace'),
        description: t('agents.skillLibrary.visibilityDescriptions.workspace', {
          name: resolveCollaborationWorkspace(workspaces, skill.workspaceId)?.name || t('agents.skillLibrary.currentWorkspace'),
        }),
        className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
      }
    }

    if (skill.ownerUserId) {
      return {
        label: t('agents.skillLibrary.visibility.private'),
        description: t('agents.skillLibrary.visibilityDescriptions.private'),
        className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
      }
    }

    return {
      label: t('agents.skillLibrary.visibility.global'),
      description: t('agents.skillLibrary.visibilityDescriptions.global'),
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    }
  }

  useEffect(() => {
    void loadSkills()
  }, [])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      setDefaultWorkspaceId(resolveCollaborationWorkspaceId(workspaces, workspaceId || getStoredCollaborationWorkspaceId()))
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
      return
    }

    setName(selectedSkill.name)
    setSlug(selectedSkill.slug)
    setDescription(selectedSkill.description ?? '')
  }, [selectedSkill?.id, selectedSkill?.updatedAt])

  useEffect(() => {
    if (!selectedSkill) {
      return
    }

    const availablePaths = new Set(ensureFileInventory(selectedSkill).map((item) => item.path))
    const fallbackPath = findDefaultPath(selectedSkill)

    setSelectedPaths((current) => {
      const currentPath = current[selectedSkill.id]
      if (currentPath && availablePaths.has(currentPath)) {
        return current
      }

      return { ...current, [selectedSkill.id]: fallbackPath }
    })
  }, [selectedSkill?.id, selectedSkill?.updatedAt])

  useEffect(() => {
    if (!selectedSkillId) {
      setExpandedSkillId(null)
      return
    }

    setExpandedSkillId(selectedSkillId)
  }, [selectedSkillId])

  useEffect(() => {
    if (!selectedSkill) {
      setActiveFile(null)
      return
    }

    let cancelled = false
    setFileLoading(true)
    setEditMode(false)

    void api.getSkillFile(selectedSkill.id, selectedPath)
      .then((response) => {
        if (cancelled) {
          return
        }

        setActiveFile(response)
        setFileDraft(response.content)
        setViewMode(response.markdown ? 'preview' : 'code')
      })
      .catch((error) => {
        if (!cancelled) {
          setActiveFile(null)
          toast.error(error instanceof Error ? error.message : t('agents.skillLibrary.toasts.fileLoadFailed'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFileLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedPath, selectedSkill?.id])

  return (
    <Card className="overflow-hidden rounded-[1.75rem] border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(24,24,27,0.96),rgba(9,9,11,0.98)_60%)] text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <CardContent className="p-0">
        <div className="grid min-h-[calc(100vh-12rem)] xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside className="border-b border-zinc-800 xl:border-b-0 xl:border-r">
            <div className="border-b border-zinc-800 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-sky-200">
                    <Sparkles size={12} />
                    {t('agents.skillLibrary.page.badge')}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">{t('agents.skillLibrary.page.title')}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {t('agents.skillLibrary.page.description')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={busy || loading || scanBusy}
                    onClick={() => void loadSkills()}
                    className="border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <RefreshCcw size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={busy || scanBusy}
                    onClick={() => void scanSkills()}
                    className="border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <ScanSearch size={16} className={cn(scanBusy && 'animate-spin')} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCreateOpen((current) => !current)}
                    className="border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    <Plus size={16} />
                  </Button>
                </div>
              </div>

              <ScanSourcePanel scanSummary={scanSummary} />

              <div className="mt-4">
                <Input
                  value={skillFilter}
                  onChange={(event) => setSkillFilter(event.target.value)}
                  placeholder={t('agents.skillLibrary.page.searchPlaceholder')}
                  className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
                />
              </div>
            </div>

            {createOpen ? (
              <CreateSkillInlinePanel
                createName={createName}
                createSlug={createSlug}
                createDescription={createDescription}
                metaSaving={metaSaving}
                onCreateNameChange={setCreateName}
                onCreateSlugChange={setCreateSlug}
                onCreateDescriptionChange={setCreateDescription}
                onCancel={() => setCreateOpen(false)}
                onCreate={() => void createManualSkill()}
              />
            ) : null}

            <ScrollArea className="h-[calc(100vh-20rem)] min-h-[28rem]">
              <div className="divide-y divide-zinc-800">
                {loading ? (
                  <div className="px-5 py-8 text-sm text-zinc-500">{t('agents.skillLibrary.page.loading')}</div>
                ) : filteredSkills.length === 0 ? (
                  <div className="px-5 py-8 text-sm text-zinc-500">
                    {skills.length === 0 ? t('agents.skillLibrary.page.emptyCatalog') : t('agents.skillLibrary.page.noMatch')}
                  </div>
                ) : (
                  filteredSkills.map((skill) => {
                    const sourceMeta = sourceBadgeMeta(skill, t)
                    const compatibilityMeta = compatibilityBadgeMeta(skill, t)
                    const scopeMeta = visibilityMeta(skill)
                    const expanded = expandedSkillId === skill.id
                    const tree = buildTree(ensureFileInventory(skill))
                    const isSelected = selectedSkill?.id === skill.id
                    const isAttached = agentMode && draft ? isSkillAttached(draft, skill) : false

                    return (
                      <div key={skill.id}>
                        <div className={cn('grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-1 px-3 py-2', isSelected && 'bg-zinc-900/40')}>
                          <button
                            type="button"
                            onClick={() => setSelectedSkillId(skill.id)}
                            className="min-w-0 rounded-xl px-2 py-2 text-left transition-colors hover:bg-zinc-900"
                          >
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-zinc-100">{skill.name}</span>
                              {isAttached ? (
                                <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-200">{t('agents.skillLibrary.badges.attached')}</Badge>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge className={cn('text-[10px]', sourceMeta.className)}>{sourceMeta.label}</Badge>
                              <Badge className={cn('text-[10px]', scopeMeta.className)}>{scopeMeta.label}</Badge>
                              <Badge className={cn('text-[10px]', compatibilityMeta.className)}>{compatibilityMeta.label}</Badge>
                              <span className="text-xs text-zinc-500">{skill.slug}</span>
                            </div>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setExpandedSkillId((current) => (current === skill.id ? null : skill.id))}
                            className="h-9 w-9 rounded-xl text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                          >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </Button>
                        </div>

                        {expanded ? (
                          <div className="pb-2">
                            <SkillTree
                              nodes={tree}
                              selectedPath={selectedPaths[skill.id] ?? findDefaultPath(skill)}
                              expandedDirs={expandedDirs[skill.id] ?? new Set<string>()}
                              onToggleDir={(path) => {
                                setExpandedDirs((current) => {
                                  const next = new Set(current[skill.id] ?? [])
                                  if (next.has(path)) {
                                    next.delete(path)
                                  } else {
                                    next.add(path)
                                  }

                                  return { ...current, [skill.id]: next }
                                })
                              }}
                              onSelectPath={(path) => {
                                setSelectedSkillId(skill.id)
                                setSelectedPaths((current) => ({ ...current, [skill.id]: path }))
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </aside>

          <div className="min-w-0 bg-[linear-gradient(180deg,rgba(12,12,14,0.72),rgba(9,9,11,0.98))]">
            {!selectedSkill ? (
              <div className="p-6">
                <EmptyLibrary
                  title={t('agents.skillLibrary.empty.title')}
                  description={t('agents.skillLibrary.empty.description')}
                />
              </div>
            ) : (
              <div className="flex min-h-[calc(100vh-12rem)] flex-col">
                <div className="border-b border-zinc-800 px-6 py-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-zinc-200">
                          <Bot size={18} />
                        </div>
                        <div className="min-w-0">
                          <h1 className="truncate text-3xl font-semibold tracking-tight text-zinc-50">{selectedSkill.name}</h1>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                            {selectedSkill.description || t('agents.skillLibrary.page.noDescription')}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge className={cn('text-[11px]', sourceBadgeMeta(selectedSkill, t).className)}>{sourceBadgeMeta(selectedSkill, t).label}</Badge>
                        <Badge className={cn('text-[11px]', visibilityMeta(selectedSkill).className)}>{visibilityMeta(selectedSkill).label}</Badge>
                        <Badge className={cn('text-[11px]', trustBadgeMeta(selectedSkill, t).className)}>{trustBadgeMeta(selectedSkill, t).label}</Badge>
                        <Badge className={cn('text-[11px]', compatibilityBadgeMeta(selectedSkill, t).className)}>{compatibilityBadgeMeta(selectedSkill, t).label}</Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {agentMode && draft ? (
                        attached ? (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => detachSkill(selectedSkill)}
                            className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
                          >
                            <Link2 size={16} />
                            {t('agents.skillLibrary.actions.detach')}
                          </Button>
                        ) : (
                          <Button
                            disabled={busy}
                            onClick={() => attachSkill(selectedSkill)}
                            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                          >
                            <Link2 size={16} />
                            {t('agents.skillLibrary.actions.attach')}
                          </Button>
                        )
                      ) : null}
                      <Button
                        variant="outline"
                        disabled={metaSaving || !canManageSelectedSkill}
                        onClick={() => void removeSelectedSkill()}
                        className="border-zinc-800 bg-zinc-950 text-rose-300 hover:bg-zinc-900 hover:text-rose-200"
                      >
                        <Trash2 size={16} />
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Key</p>
                      <p className="mt-2 font-mono text-xs text-zinc-200">{selectedSkill.slug}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{t('agents.skillLibrary.metrics.fileCount')}</p>
                      <p className="mt-2 text-sm text-zinc-200">{ensureFileInventory(selectedSkill).length}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{t('agents.skillLibrary.metrics.source')}</p>
                      <p className="mt-2 truncate text-sm text-zinc-200">{selectedSkill.sourceLocator || 'local/manual'}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{t('agents.skillLibrary.metrics.updatedAt')}</p>
                      <p className="mt-2 text-sm text-zinc-200">{formatUpdatedAt(selectedSkill.updatedAt, language)}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:col-span-2 xl:col-span-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{t('agents.skillLibrary.metrics.visibility')}</p>
                      <p className="mt-2 text-sm text-zinc-200">{visibilityMeta(selectedSkill).description}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-0 border-b border-zinc-800 lg:grid-cols-[20rem_minmax(0,1fr)]">
                  <section className="border-b border-zinc-800 bg-zinc-950/30 p-5 lg:border-b-0 lg:border-r">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                      <Pencil size={15} />
                      {t('agents.skillLibrary.metadata.title')}
                    </div>
                    <div className="mt-4 space-y-3">
                      <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder={t('agents.skillLibrary.metadata.namePlaceholder')}
                        className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
                      />
                      <Input
                        value={slug}
                        onChange={(event) => setSlug(event.target.value)}
                        placeholder="slug"
                        className="border-zinc-800 bg-zinc-950/60 font-mono text-zinc-100 placeholder:text-zinc-500"
                      />
                      <Textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        rows={5}
                        placeholder={t('agents.skillLibrary.metadata.descriptionPlaceholder')}
                        className="border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-500"
                      />
                      <Button
                        onClick={() => void saveMeta()}
                        disabled={!metaDirty || metaSaving || !canManageSelectedSkill}
                        className="w-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                      >
                        <Save size={16} />
                        {metaSaving ? t('agents.skillLibrary.metadata.saving') : t('agents.skillLibrary.metadata.save')}
                      </Button>
                      {!canManageSelectedSkill ? (
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-xs leading-5 text-zinc-500">
                          {t('agents.skillLibrary.metadata.readOnlyNotice')}
                        </div>
                      ) : null}
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-xs leading-5 text-zinc-500">
                        {t('agents.skillLibrary.metadata.libraryNotice')}
                      </div>
                    </div>
                  </section>

                  <section className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-zinc-200">{activeFile?.path ?? selectedPath}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {activeFile
                            ? t('agents.skillLibrary.fileStatus.withKind', {
                              kind: activeFile.kind,
                              mode: activeFile.editable ? t('agents.skillLibrary.fileStatus.editable') : t('agents.skillLibrary.fileStatus.readonly'),
                            })
                            : t('agents.skillLibrary.fileStatus.selectFile')}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {activeFile?.markdown && !editMode ? (
                          <div className="inline-flex rounded-full border border-zinc-800 bg-zinc-950/70 p-1">
                            <button
                              type="button"
                              onClick={() => setViewMode('preview')}
                              className={cn(
                                'rounded-full px-3 py-1.5 text-xs transition-colors',
                                viewMode === 'preview' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100',
                              )}
                            >
                              {t('agents.skillLibrary.actions.preview')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setViewMode('code')}
                              className={cn(
                                'rounded-full px-3 py-1.5 text-xs transition-colors',
                                viewMode === 'code' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100',
                              )}
                            >
                              {t('agents.skillLibrary.actions.code')}
                            </button>
                          </div>
                        ) : null}
                        {activeFile?.editable && canManageSelectedSkill ? (
                          editMode ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setEditMode(false)
                                  setFileDraft(activeFile.content)
                                }}
                                className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
                              >
                                {t('common.cancel')}
                              </Button>
                              <Button
                                onClick={() => void saveFile()}
                                disabled={!fileDirty || fileSaving}
                                className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                              >
                                <Save size={16} />
                                {fileSaving ? t('agents.skillLibrary.actions.savingFile') : t('agents.skillLibrary.actions.saveFile')}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() => setEditMode(true)}
                              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900"
                            >
                              <Pencil size={16} />
                              {t('agents.skillLibrary.actions.editFile')}
                            </Button>
                          )
                        ) : null}
                      </div>
                    </div>

                    <ScrollArea className="h-[32rem] lg:h-[calc(100vh-31rem)]">
                      <div className="px-5 py-5">
                        {fileLoading ? (
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-4 py-8 text-sm text-zinc-500">
                            {t('agents.skillLibrary.page.loadingFile')}
                          </div>
                        ) : !activeFile ? (
                          <EmptyLibrary
                            title={t('agents.skillLibrary.empty.selectFileTitle')}
                            description={t('agents.skillLibrary.empty.selectFileDescription')}
                          />
                        ) : editMode ? (
                          <Textarea
                            value={fileDraft}
                            onChange={(event) => setFileDraft(event.target.value)}
                            rows={24}
                            className="min-h-[28rem] border-zinc-800 bg-zinc-950/70 font-mono text-xs leading-6 text-zinc-100"
                          />
                        ) : activeFile.kind === 'asset' ? (
                          <div className="flex justify-center">
                            <PreviewableImage
                              src={`data:image/${activeFile.path.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'png'};base64,${activeFile.content}`}
                              alt={activeFile.path}
                              caption={activeFile.path}
                            />
                          </div>
                        ) : activeFile.markdown && viewMode === 'preview' ? (
                          <div className="markdown-body prose prose-invert max-w-none prose-headings:text-zinc-50 prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-100 prose-code:text-zinc-100 prose-pre:border prose-pre:border-zinc-800 prose-pre:bg-zinc-950/70">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {activeFile.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <pre className="overflow-x-auto rounded-[1.25rem] border border-zinc-800 bg-zinc-950/70 p-4 font-mono text-xs leading-6 text-zinc-200">
                            <code>{activeFile.content}</code>
                          </pre>
                        )}
                      </div>
                    </ScrollArea>
                  </section>
                </div>

                <div className="grid gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
                  <section className="border-b border-zinc-800 bg-zinc-950/30 p-5 lg:border-b-0 lg:border-r">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                      <ShieldCheck size={15} />
                      {t('agents.skillLibrary.fileTree.title')}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      {t('agents.skillLibrary.fileTree.description')}
                    </p>
                  </section>
                  <section className="p-0">
                    <SkillTree
                      nodes={selectedSkillTree}
                      selectedPath={selectedPath}
                      expandedDirs={expandedDirs[selectedSkill.id] ?? new Set<string>()}
                      onToggleDir={(path) => {
                        setExpandedDirs((current) => {
                          const next = new Set(current[selectedSkill.id] ?? [])
                          if (next.has(path)) {
                            next.delete(path)
                          } else {
                            next.add(path)
                          }

                          return { ...current, [selectedSkill.id]: next }
                        })
                      }}
                      onSelectPath={(path) => setSelectedPaths((current) => ({ ...current, [selectedSkill.id]: path }))}
                    />
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

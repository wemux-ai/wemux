/**
 * [INPUT]: Agent route search, collaboration workspace/project catalogs, control-plane records, and draft mutation APIs.
 * [OUTPUT]: State and actions consumed by the Agent control center, including scope toggles and assignee-cache invalidation.
 * [POS]: Route-level orchestration for Agent selection, creation, configuration, and use.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  parseCustomAgentPortablePackage,
  type CustomAgentPortablePackage,
} from '@shared/custom-agent'
import { filterEnabledSkills, type SkillRecord } from '@shared/skill'
import type { CollaborationWorkspace } from '@shared/types'
import { toast } from 'sonner'
import type { CustomAgentAuditEntry, CustomAgentAuditSummary } from '../components/agents/custom-agent-activity-panel'
import type { SettingsTab } from '../components/agents/custom-agent-detail-panel-shared'
import type {
  AgentRegistryCategoryFilter,
  AgentRegistryRuntimeFilter,
  AgentRegistryStatusFilter,
  TemplateLibraryCategoryFilter as TemplateLibraryCategoryFilterValue,
} from '../components/agents/custom-agent-registry-sidebar'
import { useAppDialog } from '../components/ui/app-dialog-provider'
import {
  api,
  type AgentHeartbeatRecord,
  type AgentRecord,
  type AgentTaskRecord,
  type AgentWorkdirFileEntry,
  type AgentWorkdirReadResult,
  type AgentWorkdirSummary,
} from '../lib/api'
import { useApp } from '../lib/app-provider'
import { notifyAgentSidebarRefresh } from '../lib/custom-agent/helpers'
import { loadCollaborationWorkspaces } from '../lib/collaboration-workspaces-data'
import { COLLABORATION_WORKSPACE_CHANGE_EVENT, getStoredCollaborationWorkspaceId } from '../lib/collaboration-workspace'
import { invalidateProjectAssigneeCatalog } from '../lib/project-collaboration-data'
import {
  buildTemplatePackageDiffSummary,
  buildTemplatePackageFromDraft,
  buildCustomAgentPortabilityReport,
  buildCustomAgentConfig,
  consumeSelectedAgentId,
  createTemplateLibraryItem,
  createAgentMcpServer,
  createAgentSkillSelection,
  createCustomAgentDraft,
  parseCustomAgentProfile,
  readTemplateLibrary,
  removeTemplateLibraryItem,
  setSelectedAgentId as persistSelectedAgentId,
  toCustomAgentDraftFromPortablePackage,
  toCustomAgentDraft,
  toCustomAgentDraftFromTemplatePackage,
  toggleCustomAgentScopeId,
  upsertTemplateLibraryItem,
  validateCustomAgentDraft,
  writeTemplateLibrary,
  type CustomAgentDraft,
  type CustomAgentTemplateLibraryItem,
} from '../lib/custom-agent'
type TemplateExportDraft = {
  templateName: string
  templateSummary: string
  templateDescription: string
  draftName: string
}

const toAuditInvocationMode = (value?: string): CustomAgentAuditEntry['invocationMode'] => {
  if (value === 'mention' || value === 'delegate') {
    return value
  }

  return 'unknown'
}

export const useAgentsContentState = ({
  createToken,
  requestedAgentId,
  requestedTab,
}: {
  createToken?: string
  requestedAgentId?: string
  requestedTab?: SettingsTab
} = {}) => {
  const { state, settingsDraft, setSettingsDraft, runMutation } = useApp()
  const { confirm } = useAppDialog()
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [collaborationWorkspaces, setCollaborationWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getStoredCollaborationWorkspaceId())
  const [availableSkills, setAvailableSkills] = useState<SkillRecord[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [draft, setDraft] = useState<CustomAgentDraft>(() => createCustomAgentDraft())
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([])
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeatRecord[]>([])
  const [channelWebhookUrls, setChannelWebhookUrls] = useState<{ telegram: string; feishu: string; wecom: string; whatsapp: string }>({ telegram: '', feishu: '', wecom: '', whatsapp: '' })
  const [avatarStorage, setAvatarStorage] = useState({ configured: false, driver: 's3-compatible', bucket: '', maxFileSizeMb: 5, acceptedTypes: [] as string[] })
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [telegramWebhookInfo, setTelegramWebhookInfo] = useState<{
    url: string
    hasCustomCertificate: boolean
    pendingUpdateCount: number
    lastErrorDate?: number
    lastErrorMessage: string
    maxConnections?: number
    allowedUpdates: string[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [workdirSummary, setWorkdirSummary] = useState<AgentWorkdirSummary | null>(null)
  const [workdirFiles, setWorkdirFiles] = useState<AgentWorkdirFileEntry[]>([])
  const [workdirLoading, setWorkdirLoading] = useState(false)
  const [workdirRefreshing, setWorkdirRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => requestedTab ?? 'chat')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<AgentRegistryStatusFilter>('all')
  const [runtimeFilter, setRuntimeFilter] = useState<AgentRegistryRuntimeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<AgentRegistryCategoryFilter>('all')
  const [skillQuery, setSkillQuery] = useState('')
  const [manualSkillName, setManualSkillName] = useState('')
  const [mcpQuery, setMcpQuery] = useState('')
  const [manualMcpName, setManualMcpName] = useState('')
  const [manualMcpTarget, setManualMcpTarget] = useState('')
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingTemplate, setExportingTemplate] = useState(false)
  const [templateLibrary, setTemplateLibrary] = useState<CustomAgentTemplateLibraryItem[]>(() => readTemplateLibrary())
  const [templateQuery, setTemplateQuery] = useState('')
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<TemplateLibraryCategoryFilterValue>('all')
  const [selectedTemplateLibraryId, setSelectedTemplateLibraryId] = useState('')
  const [pendingPortablePackage, setPendingPortablePackage] = useState<CustomAgentPortablePackage | null>(null)
  const [templateExportDraft, setTemplateExportDraft] = useState<TemplateExportDraft>({
    templateName: '',
    templateSummary: '',
    templateDescription: '',
    draftName: '',
  })
  const [templateExportOpen, setTemplateExportOpen] = useState(false)
  const [templateExportTargetId, setTemplateExportTargetId] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const consumedCreateTokenRef = useRef('')
  const previousRequestedAgentIdRef = useRef<string | undefined>(undefined)
  const previousRequestedTabRef = useRef<SettingsTab | undefined>(undefined)

  const registry = useMemo(() => {
    return agents
      .filter((agent) => agent.type.trim().toLowerCase() !== 'main')
      .map((agent) => ({
        agent,
        profile: parseCustomAgentProfile(agent),
      }))
  }, [agents])

  const selectedRecord = useMemo(
    () => registry.find((item) => item.agent.id === selectedAgentId) ?? null,
    [registry, selectedAgentId],
  )
  const selectedAgent = selectedRecord?.agent ?? null
  const selectedAgentWorkdirExecutorId = useMemo(() => {
    if (!selectedAgentId) {
      return ''
    }

    return [...state.mainChatSessions]
      .filter((session) => session.customAgentId === selectedAgentId && session.executorId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      ?.executorId?.trim() || ''
  }, [selectedAgentId, state.mainChatSessions])

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return registry.filter(({ agent, profile }) => {
      if (statusFilter === 'archived' && !profile.archived) return false
      if (runtimeFilter !== 'all' && profile.preferredRuntime !== runtimeFilter) return false
      if (categoryFilter !== 'all' && profile.category !== categoryFilter) return false
      if (!normalizedQuery) return true

      const haystack = [agent.name, profile.role, profile.summary, profile.owner, profile.tags.join(' ')].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [categoryFilter, query, registry, runtimeFilter, statusFilter])

  const validation = useMemo(() => validateCustomAgentDraft(draft), [draft])
  const auditEntries = useMemo<CustomAgentAuditEntry[]>(() => {
    if (!selectedAgent) {
      return []
    }

    return state.workspaceSessions
      .filter((session) => session.customAgentId === selectedAgent.id || session.customAgentName === selectedAgent.name)
      .map((session) => {
        const linkedTaskId = state.taskWorkspaceBindings
          .filter((binding) => binding.workspaceId === session.workspaceId && binding.status === 'active')
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))[0]
          ?.taskId || ''
        const task = state.tasks.find((item) => item.id === linkedTaskId)
        const project = task ? state.projects.find((item) => item.id === task.projectId) : null
        return {
          sessionId: session.id,
          taskId: linkedTaskId,
          taskTitle: task?.title || task?.description || session.title || '未命名任务',
          projectId: project?.id || '',
          projectName: project?.name || '未知项目',
          workspaceId: session.workspaceId,
          invocationMode: toAuditInvocationMode(session.agentInvocationMode),
          sessionKind: session.sessionKind,
          sessionRole: session.sessionRole,
          agentType: session.agentType ?? task?.agentType ?? 'unknown',
          status: session.agentRunningStatus,
          currentStep: session.currentStep,
          createdAt: session.createdAt,
          lastActiveAt: session.lastActiveAt,
          executionModel: session.executionModel ?? '',
          mountedSkillNames: session.mountedSkillNames ?? [],
          mountedMcpServerNames: session.mountedMcpServerNames ?? [],
        }
      })
      .sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt) || right.createdAt.localeCompare(left.createdAt))
  }, [selectedAgent, state.projects, state.taskWorkspaceBindings, state.workspaceSessions, state.tasks])

  const auditSummary = useMemo<CustomAgentAuditSummary>(() => {
    const runningStatuses = new Set(['thinking', 'executing', 'waiting'])
    const recentSkillNames = Array.from(new Set(auditEntries.flatMap((entry) => entry.mountedSkillNames))).slice(0, 12)
    const recentMcpServerNames = Array.from(new Set(auditEntries.flatMap((entry) => entry.mountedMcpServerNames))).slice(0, 12)
    return {
      totalSessions: auditEntries.length,
      activeSessions: auditEntries.filter((entry) => entry.status !== 'complete' && entry.status !== 'error').length,
      runningSessions: auditEntries.filter((entry) => runningStatuses.has(entry.status)).length,
      mentionSessions: auditEntries.filter((entry) => entry.invocationMode === 'mention').length,
      delegateSessions: auditEntries.filter((entry) => entry.invocationMode === 'delegate').length,
      projectCount: new Set(auditEntries.map((entry) => entry.projectId).filter(Boolean)).size,
      workspaceCount: new Set(auditEntries.map((entry) => entry.workspaceId).filter(Boolean)).size,
      recentSkillNames,
      recentMcpServerNames,
    }
  }, [auditEntries])

  const suggestedSkills = useMemo(() => {
    const normalizedQuery = skillQuery.trim().toLowerCase()
    const selectedKeys = new Set(
      draft.skills.map((item) => `${item.skillId || item.slug || item.name}`.toLowerCase()),
    )

    return availableSkills.filter((skill) => {
      const key = `${skill.id || skill.slug || skill.name}`.toLowerCase()
      if (selectedKeys.has(key)) return false
      if (!normalizedQuery) return true
      const haystack = [skill.name, skill.slug, skill.description ?? ''].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [availableSkills, draft.skills, skillQuery])

  const suggestedMcpServers = useMemo(() => {
    const normalizedQuery = mcpQuery.trim().toLowerCase()
    const selectedKeys = new Set(draft.mcpServers.map((item) => `${item.name}::${item.target}`.toLowerCase()))

    return state.config.mcpServers.filter((server) => {
      const key = `${server.name}::${server.target}`.toLowerCase()
      if (selectedKeys.has(key)) return false
      if (!normalizedQuery) return true
      const haystack = [server.name, server.target, server.transport, server.capabilityMode].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [draft.mcpServers, mcpQuery, state.config.mcpServers])

  const pendingPackageKind = pendingPortablePackage?.kind ?? null
  const pendingPackageName = useMemo(() => {
    if (!pendingPortablePackage) {
      return ''
    }

    return pendingPortablePackage.kind === 'vibemux-custom-agent-template'
      ? pendingPortablePackage.template.name
      : pendingPortablePackage.agent.name
  }, [pendingPortablePackage])
  const pendingImportDraft = useMemo(
    () => pendingPortablePackage ? toCustomAgentDraftFromPortablePackage(pendingPortablePackage) : null,
    [pendingPortablePackage],
  )
  const pendingPrimarySummary = useMemo(() => {
    if (!pendingPortablePackage || !pendingImportDraft) {
      return ''
    }

    if (pendingPortablePackage.kind === 'vibemux-custom-agent-template') {
      return pendingPortablePackage.template.summary || '未设置'
    }

    return [
      pendingImportDraft.allowedMention ? '@ 调用' : null,
      pendingImportDraft.allowedDelegate ? '正式委派' : null,
    ].filter(Boolean).join(' / ') || '未启用'
  }, [pendingImportDraft, pendingPortablePackage])
  const pendingImportReport = useMemo(() => {
    if (!pendingImportDraft) {
      return null
    }

    return buildCustomAgentPortabilityReport(pendingImportDraft, {
      availableSkills,
      availableMcpServers: state.config.mcpServers,
    })
  }, [availableSkills, pendingImportDraft, state.config.mcpServers])

  const filteredTemplateLibrary = useMemo(() => {
    const normalizedQuery = templateQuery.trim().toLowerCase()
    return templateLibrary.filter((item) => {
      if (templateCategoryFilter !== 'all' && item.package.template.category !== templateCategoryFilter) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      const haystack = [
        item.package.template.name,
        item.package.template.summary,
        item.package.template.description,
        item.package.template.tags.join(' '),
      ].join(' ').toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [templateCategoryFilter, templateLibrary, templateQuery])
  const selectedTemplateLibraryItem = useMemo(
    () => templateLibrary.find((item) => item.id === selectedTemplateLibraryId) ?? null,
    [selectedTemplateLibraryId, templateLibrary],
  )
  const templatePreviewPackage = useMemo(() => {
    if (!templateExportOpen) {
      return null
    }

    return buildTemplatePackageFromDraft(draft, {
      agentName: selectedAgent?.name,
      currentConfig: selectedAgent?.config,
      templateName: templateExportDraft.templateName,
      templateSummary: templateExportDraft.templateSummary,
      templateDescription: templateExportDraft.templateDescription,
      draftName: templateExportDraft.draftName,
    })
  }, [draft, selectedAgent?.config, selectedAgent?.name, templateExportDraft, templateExportOpen])
  const templateDiffSummary = useMemo(() => {
    if (!templateExportTargetId || !selectedTemplateLibraryItem || !templatePreviewPackage) {
      return null
    }

    return buildTemplatePackageDiffSummary(selectedTemplateLibraryItem.package, templatePreviewPackage)
  }, [selectedTemplateLibraryItem, templateExportTargetId, templatePreviewPackage])

  const loadAgents = async (preferredAgentId?: string) => {
    setLoading(true)
    try {
      const [agentsResult, skillsResult] = await Promise.allSettled([api.listAgents(currentWorkspaceId || undefined), api.listSkills(currentWorkspaceId || undefined)])
      if (agentsResult.status !== 'fulfilled') {
        throw agentsResult.reason
      }

      const nextAgents = agentsResult.value.agents
      const nextSkills = skillsResult.status === 'fulfilled' ? filterEnabledSkills(skillsResult.value.skills) : []
      const nextRegistry = nextAgents.filter((agent) => agent.type.trim().toLowerCase() !== 'main')
      const selectedFromMemory = preferredAgentId || consumeSelectedAgentId()
      const nextSelected = selectedFromMemory && nextRegistry.some((agent) => agent.id === selectedFromMemory)
        ? selectedFromMemory
        : nextRegistry[0]?.id ?? ''

      setAgents(nextAgents)
      setAvailableSkills(nextSkills)
      setSelectedAgentId(nextSelected)
      persistSelectedAgentId(nextSelected)
      setCreating(!nextSelected)
      if (!nextSelected) {
        setActiveTab('overview')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Agent 列表失败')
    } finally {
      setLoading(false)
    }
  }

  const loadAgentDetails = async (agentId: string, executorId?: string) => {
    if (!agentId) {
      setTasks([])
      setHeartbeats([])
      setChannelWebhookUrls({ telegram: '', feishu: '', wecom: '', whatsapp: '' })
      setTelegramWebhookInfo(null)
      setWorkdirSummary(null)
      setWorkdirFiles([])
      return
    }

    try {
      setWorkdirFiles([])
      const [taskResponse, heartbeatResponse, channelResponse, workdirResponse] = await Promise.all([
        api.getAgentTasks(agentId),
        api.getAgentHeartbeats(agentId),
        api.getAgentChannel(agentId, currentWorkspaceId || undefined),
        api.getAgentWorkdir(agentId, executorId, currentWorkspaceId || undefined),
      ])
      setTasks(taskResponse.tasks)
      setHeartbeats(heartbeatResponse.heartbeats)
      setChannelWebhookUrls(channelResponse.webhookUrls)
      setTelegramWebhookInfo(channelResponse.telegramWebhookInfo)
      setWorkdirSummary(workdirResponse.workdir)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Agent 活动失败')
      setTasks([])
      setHeartbeats([])
      setChannelWebhookUrls({ telegram: '', feishu: '', wecom: '', whatsapp: '' })
      setTelegramWebhookInfo(null)
      setWorkdirSummary(null)
      setWorkdirFiles([])
    }
  }

  const loadAgentWorkdirFiles = async (agentId: string, mode: 'ensure' | 'refresh' | 'cached' = 'cached', executorId?: string) => {
    if (!agentId) {
      setWorkdirFiles([])
      return
    }

    const setBusy = mode === 'refresh' || mode === 'ensure' ? setWorkdirRefreshing : setWorkdirLoading
    setBusy(true)
    try {
      const response = mode === 'ensure'
        ? await api.ensureAgentWorkdir(agentId, executorId, currentWorkspaceId || undefined)
        : mode === 'refresh'
          ? await api.rescanAgentWorkdir(agentId, executorId, currentWorkspaceId || undefined)
          : await api.listAgentWorkdirFiles(agentId, false, executorId, currentWorkspaceId || undefined)
      setWorkdirSummary(response.workdir)
      setWorkdirFiles(response.files)
      const responseMessage = 'message' in response && typeof response.message === 'string'
        ? response.message
        : ''
      if (mode === 'ensure' && responseMessage) {
        toast.success(responseMessage)
      }
      if (mode === 'refresh' && responseMessage) {
        toast.success(responseMessage)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载 Agent 工作目录失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      setCurrentWorkspaceId(detail?.workspaceId?.trim() || '')
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
  }, [])

  useEffect(() => {
    void loadAgents()
  }, [currentWorkspaceId])

  useEffect(() => {
    void loadCollaborationWorkspaces()
      .then(setCollaborationWorkspaces)
      .catch(() => setCollaborationWorkspaces([]))
  }, [])

  useEffect(() => {
    void api.getAvatarStorageStatus()
      .then((response) => setAvatarStorage(response.storage))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    writeTemplateLibrary(templateLibrary)
  }, [templateLibrary])

  useEffect(() => {
    if (creating) {
      setDraft((current) => (current.name || current.avatarUrl || current.instructions || current.skills.length > 0 || current.mcpServers.length > 0) ? current : createCustomAgentDraft())
      setTasks([])
      setHeartbeats([])
      setWorkdirSummary(null)
      setWorkdirFiles([])
      return
    }

    setDraft(toCustomAgentDraft(selectedAgent))
    if (selectedAgentId) {
      void loadAgentDetails(selectedAgentId, selectedAgentWorkdirExecutorId || undefined)
    }
  }, [creating, selectedAgent, selectedAgentId, selectedAgentWorkdirExecutorId])

  useEffect(() => {
    if (!selectedAgentId || creating || (activeTab !== 'workdir' && activeTab !== 'files' && activeTab !== 'chat')) {
      return
    }

    if (workdirFiles.length > 0 && workdirSummary?.agentId === selectedAgentId) {
      return
    }

    void loadAgentWorkdirFiles(selectedAgentId, 'cached', selectedAgentWorkdirExecutorId || undefined)
  }, [activeTab, creating, selectedAgentId, selectedAgentWorkdirExecutorId, workdirFiles.length, workdirSummary?.agentId])

  useEffect(() => {
    setWorkdirFiles([])
  }, [selectedAgentId, selectedAgentWorkdirExecutorId])

  const startCreate = (seed?: CustomAgentDraft) => {
    setCreating(true)
    setSelectedAgentId('')
    persistSelectedAgentId('')
    notifyAgentSidebarRefresh()
    const workspaceId = currentWorkspaceId.trim()
    const baseDraft = seed ?? createCustomAgentDraft()
    setDraft(workspaceId && !baseDraft.workspaceIdsText.split('\n').map((item) => item.trim()).filter(Boolean).includes(workspaceId)
      ? {
          ...baseDraft,
          workspaceIdsText: [workspaceId, ...baseDraft.workspaceIdsText.split('\n').map((item) => item.trim()).filter(Boolean)].join('\n'),
        }
      : baseDraft)
    setTasks([])
    setHeartbeats([])
    setWorkdirSummary(null)
    setWorkdirFiles([])
    setActiveTab('overview')
  }

  const selectAgent = (agentId: string) => {
    setCreating(false)
    setSelectedAgentId(agentId)
    setSelectedTemplateLibraryId('')
    persistSelectedAgentId(agentId)
    notifyAgentSidebarRefresh()
    setActiveTab(requestedTab ?? 'chat')
  }

  useEffect(() => {
    if (!requestedAgentId) {
      previousRequestedAgentIdRef.current = undefined
      return
    }

    if (loading) {
      return
    }

    if (!registry.some((item) => item.agent.id === requestedAgentId)) {
      return
    }

    if (previousRequestedAgentIdRef.current !== requestedAgentId) {
      previousRequestedAgentIdRef.current = requestedAgentId
      selectAgent(requestedAgentId)
      return
    }

    if (!selectedAgentId && !creating) {
      selectAgent(requestedAgentId)
    }
  }, [creating, loading, registry, requestedAgentId, selectedAgentId])

  useEffect(() => {
    if (!requestedTab) {
      const previousRequestedTab = previousRequestedTabRef.current
      previousRequestedTabRef.current = undefined
      if (previousRequestedTab) {
        setActiveTab((current) => (current === previousRequestedTab ? 'chat' : current))
      }
      return
    }

    previousRequestedTabRef.current = requestedTab
    setActiveTab((current) => (current === requestedTab ? current : requestedTab))
  }, [requestedTab])

  useEffect(() => {
    if (!createToken || consumedCreateTokenRef.current === createToken) {
      return
    }

    consumedCreateTokenRef.current = createToken
    startCreate()
  }, [createToken])

  const saveAgent = async (nextDraft = draft) => {
    const nextValidation = validateCustomAgentDraft(nextDraft)
    if (nextValidation.errors.length > 0) {
      toast.error(nextValidation.errors[0])
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: nextDraft.name.trim(),
        type: 'custom',
        endpoint: nextDraft.endpoint.trim() || undefined,
        config: buildCustomAgentConfig(nextDraft, selectedAgent?.config),
        workspaceId: currentWorkspaceId.trim() || undefined,
      }

      if (creating || !selectedAgent) {
        const response = await api.createAgent(payload)
        const profile = parseCustomAgentProfile(response.agent)
        let channelWarning = response.syncStatus?.warnings?.[0] || ''
        try {
          const channelResponse = await api.updateAgentChannel(response.agent.id, {
            channels: profile.channels as unknown as Record<string, unknown>,
          })
          channelWarning = channelWarning || channelResponse.syncStatus?.warnings?.[0] || ''
        } catch (error) {
          channelWarning = channelWarning || (error instanceof Error ? error.message : '渠道同步失败')
        }
        await loadAgents(response.agent.id)
        setActiveTab('chat')
        invalidateProjectAssigneeCatalog()
        notifyAgentSidebarRefresh()
        if (channelWarning) {
          toast.warning(channelWarning)
        } else {
          toast.success('Agent 已创建')
        }
      } else {
        const response = await api.updateAgent(selectedAgent.id, payload)
        const profile = parseCustomAgentProfile(response.agent)
        let channelWarning = response.syncStatus?.warnings?.[0] || ''
        try {
          const channelResponse = await api.updateAgentChannel(response.agent.id, {
            channels: profile.channels as unknown as Record<string, unknown>,
          })
          channelWarning = channelWarning || channelResponse.syncStatus?.warnings?.[0] || ''
        } catch (error) {
          channelWarning = channelWarning || (error instanceof Error ? error.message : '渠道同步失败')
        }
        await loadAgents(response.agent.id)
        invalidateProjectAssigneeCatalog()
        notifyAgentSidebarRefresh()
        if (channelWarning) {
          toast.warning(channelWarning)
        } else {
          toast.success('Agent 已保存')
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Agent 失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteAgent = async () => {
    if (!selectedAgent) {
      return
    }
    const confirmed = await confirm({
      title: `确认删除 Agent「${selectedAgent.name}」？`,
      description: '这不会删除已有工作区记录，但会移除该 Agent 的主聊天会话；它将不再可被 @ 或委派。',
      confirmText: '删除 Agent',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setDeleting(true)
    try {
      await api.deleteAgent(selectedAgent.id)
      await loadAgents()
      invalidateProjectAssigneeCatalog()
      notifyAgentSidebarRefresh()
      toast.success('Agent 已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Agent 失败')
    } finally {
      setDeleting(false)
    }
  }

  const archiveAgent = async (archived: boolean) => {
    await saveAgent({
      ...draft,
      archived,
      enabled: archived ? false : draft.enabled,
    })
  }

  const toggleWorkspaceId = (workspaceId: string) => {
    setDraft((current) => {
      return { ...current, workspaceIdsText: toggleCustomAgentScopeId(current.workspaceIdsText, workspaceId) }
    })
  }

  const toggleProjectId = (projectId: string) => {
    setDraft((current) => {
      return { ...current, projectIdsText: toggleCustomAgentScopeId(current.projectIdsText, projectId) }
    })
  }

  const exportSelectedAgent = async () => {
    if (!selectedAgent) {
      return
    }

    setExporting(true)
    try {
      const response = await api.exportAgent(selectedAgent.id)
      const safeName = (selectedAgent.name.trim() || 'agent')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'agent'
      const blob = new Blob([JSON.stringify(response.package, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}.agent.json`
      anchor.click()
      window.URL.revokeObjectURL(url)
      toast.success('Agent 已导出')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出 Agent 失败')
    } finally {
      setExporting(false)
    }
  }

  const openTemplateExportDialog = () => {
    if (!selectedAgent && !draft.name.trim() && !draft.instructions.trim()) {
      toast.error('请先选择一个 Agent，或至少先写一些模板内容。')
      return
    }

    const baseName = selectedAgent?.name ?? (draft.name.trim() || 'Agent')
    setTemplateExportDraft({
      templateName: `${baseName} Template`,
      templateSummary: draft.summary.trim(),
      templateDescription: draft.notes.trim() || draft.role.trim(),
      draftName: `${baseName} Copy`,
    })
    setTemplateExportTargetId(null)
    setTemplateExportOpen(true)
  }

  const openTemplateUpdateDialog = (itemId: string) => {
    const templateItem = templateLibrary.find((item) => item.id === itemId)
    if (!templateItem) {
      return
    }

    setSelectedTemplateLibraryId(itemId)
    setTemplateExportDraft({
      templateName: templateItem.package.template.name,
      templateSummary: templateItem.package.template.summary,
      templateDescription: templateItem.package.template.description,
      draftName: templateItem.package.draft.name,
    })
    setTemplateExportTargetId(itemId)
    setTemplateExportOpen(true)
  }

  const materializeTemplatePackage = () => {
    return buildTemplatePackageFromDraft(draft, {
      agentName: selectedAgent?.name,
      currentConfig: selectedAgent?.config,
      templateName: templateExportDraft.templateName,
      templateSummary: templateExportDraft.templateSummary,
      templateDescription: templateExportDraft.templateDescription,
      draftName: templateExportDraft.draftName,
    })
  }

  const saveTemplateToLibrary = async () => {
    setExportingTemplate(true)
    try {
      const templatePackage = materializeTemplatePackage()
      const nextItem = templateExportTargetId
        ? {
            id: templateExportTargetId,
            package: templatePackage,
            savedAt: selectedTemplateLibraryItem?.savedAt ?? new Date().toISOString(),
            updatedAt: selectedTemplateLibraryItem?.updatedAt ?? new Date().toISOString(),
            version: selectedTemplateLibraryItem?.version ?? 1,
            history: selectedTemplateLibraryItem?.history ?? [],
          }
        : createTemplateLibraryItem(templatePackage)
      setTemplateLibrary((current) => upsertTemplateLibraryItem(current, nextItem))
      setSelectedTemplateLibraryId(nextItem.id)
      setTemplateExportOpen(false)
      setTemplateExportTargetId(null)
      toast.success(templateExportTargetId ? '模板已覆盖更新' : '模板已保存到本地模板库')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存模板失败')
    } finally {
      setExportingTemplate(false)
    }
  }

  const exportTemplatePackage = async () => {
    setExportingTemplate(true)
    try {
      const templatePackage = materializeTemplatePackage()
      const safeName = (templatePackage.template.name.trim() || 'agent-template')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'agent-template'
      const blob = new Blob([JSON.stringify(templatePackage, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}.agent-template.json`
      anchor.click()
      window.URL.revokeObjectURL(url)
      setTemplateExportOpen(false)
      toast.success('模板包已导出')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出模板包失败')
    } finally {
      setExportingTemplate(false)
    }
  }

  const importAgentFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const raw = await file.text()
      const parsed = parseCustomAgentPortablePackage(JSON.parse(raw) as Record<string, unknown>)
      setPendingPortablePackage(parsed)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入 Agent 失败')
    } finally {
      event.target.value = ''
    }
  }

  const confirmImportAgent = async () => {
    if (!pendingPortablePackage || pendingPortablePackage.kind !== 'vibemux-custom-agent') {
      return
    }

    setImporting(true)
    try {
      const response = await api.importAgent({ package: pendingPortablePackage })
      await loadAgents(response.agent.id)
      setCreating(false)
      setPendingPortablePackage(null)
      invalidateProjectAssigneeCatalog()
      notifyAgentSidebarRefresh()
      toast.success(response.imported.renamed
        ? `Agent 已导入，名称冲突时自动重命名为「${response.imported.importedName}」`
        : `Agent「${response.imported.importedName}」已导入`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入 Agent 失败')
    } finally {
      setImporting(false)
    }
  }

  const applyImportAsDraft = () => {
    if (!pendingImportDraft) {
      return
    }

    startCreate(pendingImportDraft)
    setPendingPortablePackage(null)
    toast.success(pendingPackageKind === 'vibemux-custom-agent-template'
      ? '模板包已应用到新草稿，你可以继续微调后保存。'
      : '已把导入包应用到新草稿，你可以先检查再保存。')
  }

  const savePendingTemplateToLibrary = () => {
    if (!pendingPortablePackage || pendingPortablePackage.kind !== 'vibemux-custom-agent-template') {
      return
    }

    const nextItem = createTemplateLibraryItem(pendingPortablePackage)
    setTemplateLibrary((current) => upsertTemplateLibraryItem(current, nextItem))
    setSelectedTemplateLibraryId(nextItem.id)
    toast.success('模板包已加入本地模板库')
  }

  const applyTemplateLibraryItem = (itemId: string) => {
    const templateItem = templateLibrary.find((item) => item.id === itemId)
    if (!templateItem) {
      return
    }

    startCreate(toCustomAgentDraftFromTemplatePackage(templateItem.package))
    setSelectedTemplateLibraryId(itemId)
    toast.success(`已套用模板「${templateItem.package.template.name}」`)
  }

  const deleteTemplateLibraryEntry = async (itemId: string) => {
    const templateItem = templateLibrary.find((item) => item.id === itemId)
    if (!templateItem) {
      return
    }

    const confirmed = await confirm({
      title: `确认删除模板「${templateItem.package.template.name}」？`,
      description: '这只会从本地模板库移除，不影响导出的文件。',
      confirmText: '删除模板',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setTemplateLibrary((current) => removeTemplateLibraryItem(current, itemId))
    setSelectedTemplateLibraryId((current) => (current === itemId ? '' : current))
    toast.success('模板已从本地模板库移除')
  }

  const uploadAgentAvatar = async (file: File) => {
    if (!selectedAgent) {
      toast.error('请先保存 Agent，再上传头像。')
      return
    }

    setAvatarBusy(true)
    try {
      const response = await api.uploadAgentAvatar(selectedAgent.id, file)
      setAgents((current) => current.map((agent) => (agent.id === response.agent.id ? response.agent : agent)))
      setDraft((current) => ({ ...current, avatarUrl: response.avatarUrl }))
      invalidateProjectAssigneeCatalog()
      notifyAgentSidebarRefresh()
      toast.success(response.message || 'Agent 头像已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Agent 头像上传失败')
    } finally {
      setAvatarBusy(false)
    }
  }

  const addManualSkill = async () => {
    const trimmed = manualSkillName.trim()
    if (!trimmed) {
      return
    }

    const existingSkill = availableSkills.find((skill) => {
      const normalizedName = skill.name.trim().toLowerCase()
      const normalizedSlug = skill.slug.trim().toLowerCase()
      const candidate = trimmed.toLowerCase()
      return normalizedName === candidate || normalizedSlug === candidate
    })
    if (existingSkill) {
      addSkillFromCatalog(existingSkill)
      setManualSkillName('')
      toast.success('已复用现有全局 Skill，并挂载到当前 Agent')
      return
    }

    try {
      const response = await api.createSkill({
        name: trimmed,
        markdown: `# ${trimmed}\n\n请补充这个 skill 的使用说明。`,
      })
      setAvailableSkills((current) => {
        if (current.some((skill) => skill.id === response.skill.id)) {
          return current
        }

        return [...current, response.skill]
      })
      setDraft((current) => ({
        ...current,
        skills: [...current.skills, createAgentSkillSelection({
          skillId: response.skill.id,
          slug: response.skill.slug,
          name: response.skill.name,
          description: response.skill.description ?? undefined,
        })],
      }))
      setManualSkillName('')
      toast.success('Skill 已创建到全局能力库，并挂载到当前 Agent')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建全局 Skill 失败')
    }
  }

  const addSkillFromCatalog = (skill: SkillRecord) => {
    setDraft((current) => ({
      ...current,
      skills: current.skills.some((item) => item.skillId === skill.id || item.slug === skill.slug || item.name.trim().toLowerCase() === skill.name.trim().toLowerCase())
        ? current.skills
        : [...current.skills, createAgentSkillSelection({
            skillId: skill.id,
            slug: skill.slug,
            name: skill.name,
            description: skill.description ?? undefined,
            tags: [],
          })],
    }))
  }

  const updateSkill = (skillId: string, updater: (current: CustomAgentDraft['skills'][number]) => CustomAgentDraft['skills'][number]) => {
    setDraft((current) => ({
      ...current,
      skills: current.skills.map((item) => (item.id === skillId ? updater(item) : item)),
    }))
  }

  const removeSkill = (skillId: string) => {
    setDraft((current) => ({ ...current, skills: current.skills.filter((item) => item.id !== skillId) }))
  }

  const addManualMcp = async () => {
    const trimmedName = manualMcpName.trim()
    const trimmedTarget = manualMcpTarget.trim()
    if (!trimmedName || !trimmedTarget) {
      return
    }

    const existingServer = state.config.mcpServers.find((server) => {
      return server.target.trim().toLowerCase() === trimmedTarget.toLowerCase()
        || `${server.name.trim().toLowerCase()}::${server.target.trim().toLowerCase()}` === `${trimmedName.toLowerCase()}::${trimmedTarget.toLowerCase()}`
    })
    if (existingServer) {
      addMcpFromGlobal(existingServer)
      setManualMcpName('')
      setManualMcpTarget('')
      toast.success('已复用现有全局 MCP，并挂载到当前 Agent')
      return
    }

    const nextCapabilityMode = draft.preferredRuntime === 'Pi' ? 'resources+tools' : 'resources'
    const nextServer = createAgentMcpServer({
      name: trimmedName,
      target: trimmedTarget,
      capabilityMode: nextCapabilityMode,
    })
    const nextGlobalServers = [...settingsDraft.mcpServers, nextServer]
    const response = await runMutation(() => api.saveSettings({
      ...settingsDraft,
      mcpServers: nextGlobalServers,
    }))
    if (!response) {
      return
    }

    const persistedServer = response.state.config.mcpServers.find((server) => {
      return server.name === trimmedName && server.target === trimmedTarget
    }) ?? nextServer

    setSettingsDraft({
      ...response.state.config,
      mcpServers: response.state.config.mcpServers,
    })
    setDraft((current) => ({
      ...current,
      mcpServers: [...current.mcpServers, createAgentMcpServer(persistedServer)],
    }))
    setManualMcpName('')
    setManualMcpTarget('')
    toast.success('MCP 已写入全局 Registry，并挂载到当前 Agent')
  }

  const addMcpFromGlobal = (server: typeof state.config.mcpServers[number]) => {
    setDraft((current) => ({
      ...current,
      mcpServers: current.mcpServers.some((item) => {
        return item.target.trim().toLowerCase() === server.target.trim().toLowerCase()
          || `${item.name.trim().toLowerCase()}::${item.target.trim().toLowerCase()}` === `${server.name.trim().toLowerCase()}::${server.target.trim().toLowerCase()}`
      })
        ? current.mcpServers
        : [...current.mcpServers, createAgentMcpServer(server)],
    }))
  }

  const updateMcp = (serverId: string, updater: (current: CustomAgentDraft['mcpServers'][number]) => CustomAgentDraft['mcpServers'][number]) => {
    setDraft((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((item) => (item.id === serverId ? updater(item) : item)),
    }))
  }

  const removeMcp = (serverId: string) => {
    setDraft((current) => ({ ...current, mcpServers: current.mcpServers.filter((item) => item.id !== serverId) }))
  }

  const deleteTelegramWebhook = async () => {
    if (!selectedAgent) {
      return
    }
    try {
      const response = await api.deleteAgentTelegramWebhook(selectedAgent.id)
      await loadAgentDetails(selectedAgent.id, selectedAgentWorkdirExecutorId || undefined)
      toast.success(response.message || 'Telegram webhook 已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Telegram webhook 删除失败')
    }
  }

  const disconnectFeishu = async () => {
    if (!selectedAgent) {
      return false
    }

    const confirmed = await confirm({
      title: '断开飞书连接？',
      description: '将立即停止接收飞书消息，并清除 Wemux 保存的 App ID 与密钥。飞书管理后台中已创建的应用不会被删除。',
      confirmText: '断开并清除',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) {
      return false
    }

    try {
      const response = await api.disconnectAgentFeishu(selectedAgent.id)
      setAgents((current) => current.map((agent) => (agent.id === response.agent.id ? response.agent : agent)))
      setDraft((current) => ({
        ...current,
        feishuEnabled: false,
        feishuConnectionMode: 'manual',
        feishuAppId: '',
        feishuAppSecret: '',
        feishuEncryptKey: '',
        feishuVerificationToken: '',
      }))
      toast.success(response.message || '飞书连接已断开')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '飞书连接断开失败')
      return false
    }
  }

  const disconnectWechat = async () => {
    if (!selectedAgent) {
      return false
    }

    const confirmed = await confirm({
      title: '断开微信连接？',
      description: '将立即停止接收微信消息，并清除 Wemux 中保存的微信 iLink 凭证。扫码绑定的微信号本身不会受到影响。',
      confirmText: '断开并清除',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) {
      return false
    }

    try {
      const response = await api.disconnectAgentWechat(selectedAgent.id)
      setAgents((current) => current.map((agent) => (agent.id === response.agent.id ? response.agent : agent)))
      setDraft((current) => ({
        ...current,
        wechatEnabled: false,
        wechatBotToken: '',
        wechatBotId: '',
        wechatWechatUserId: '',
        wechatBaseUrl: '',
      }))
      toast.success(response.message || '微信连接已断开')
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '微信连接断开失败')
      return false
    }
  }

  const ensureWorkdir = async () => {
    if (!selectedAgentId) {
      return
    }

    await loadAgentWorkdirFiles(selectedAgentId, 'ensure', selectedAgentWorkdirExecutorId || undefined)
  }

  const refreshWorkdir = async () => {
    if (!selectedAgentId) {
      return
    }

    await loadAgentWorkdirFiles(selectedAgentId, 'refresh', selectedAgentWorkdirExecutorId || undefined)
  }

  const cleanupWorkdir = async () => {
    if (!selectedAgentId) {
      return
    }

    setWorkdirRefreshing(true)
    try {
      const response = await api.cleanupAgentWorkdir(selectedAgentId, selectedAgentWorkdirExecutorId || undefined, currentWorkspaceId || undefined)
      setWorkdirSummary(response.workdir)
      toast.success(response.message || '已清理 Agent 工作目录临时文件')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理 Agent 工作目录失败')
    } finally {
      setWorkdirRefreshing(false)
    }
  }

  const downloadWorkdirFile = async (relativePath: string) => {
    if (!selectedAgentId) {
      return
    }

    try {
      const response = await api.downloadAgentWorkdirFile(selectedAgentId, relativePath, selectedAgentWorkdirExecutorId || undefined, currentWorkspaceId || undefined)
      const url = window.URL.createObjectURL(response.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = response.filename
      anchor.click()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载 Agent 工作目录文件失败')
    }
  }

  const readWorkdirFile = async (relativePath: string): Promise<AgentWorkdirReadResult> => {
    if (!selectedAgentId) {
      return {
        ok: false,
        relativePath,
        message: '当前没有选中的 Agent。',
      }
    }

    return api.readAgentWorkdirFile(selectedAgentId, relativePath, selectedAgentWorkdirExecutorId || undefined, currentWorkspaceId || undefined)
  }

  const deleteWorkdirFile = async (relativePath: string) => {
    if (!selectedAgentId) {
      return
    }

    const confirmed = await confirm({
      title: '确认删除这个工作目录文件？',
      description: relativePath,
      confirmText: '删除文件',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    try {
      const response = await api.deleteAgentWorkdirFile(selectedAgentId, relativePath, selectedAgentWorkdirExecutorId || undefined, currentWorkspaceId || undefined)
      setWorkdirSummary(response.workdir)
      setWorkdirFiles(response.files)
      toast.success(response.message || '文件已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除 Agent 工作目录文件失败')
    }
  }

  return {
    activeTab,
    addManualMcp,
    addManualSkill,
    addMcpFromGlobal,
    addSkillFromCatalog,
    applyImportAsDraft,
    applyTemplateLibraryItem,
    archiveAgent,
    auditEntries,
    auditSummary,
    availableSkills,
    avatarBusy,
    avatarStorage,
    categoryFilter,
    channelWebhookUrls,
    confirmImportAgent,
    creating,
    deleteAgent,
    deleting,
    deleteTemplateLibraryEntry,
    disconnectFeishu,
    disconnectWechat,
    deleteTelegramWebhook,
    draft,
    exporting,
    exportingTemplate,
    exportSelectedAgent,
    exportTemplatePackage,
    filteredAgents,
    filteredTemplateLibrary,
    heartbeats,
    importAgentFile,
    importing,
    importInputRef,
    collaborationWorkspaces,
    loading,
    manualMcpName,
    manualMcpTarget,
    manualSkillName,
    mcpQuery,
    openTemplateExportDialog,
    openTemplateUpdateDialog,
    pendingImportDraft,
    pendingImportReport,
    pendingPackageKind,
    pendingPackageName,
    pendingPortablePackage,
    pendingPrimarySummary,
    toggleProjectId,
    toggleWorkspaceId,
    query,
    registry,
    removeMcp,
    removeSkill,
    runtimeFilter,
    saveAgent,
    savePendingTemplateToLibrary,
    saveTemplateToLibrary,
    saving,
    cleanupWorkdir,
    deleteWorkdirFile,
    downloadWorkdirFile,
    ensureWorkdir,
    refreshWorkdir,
    readWorkdirFile,
    selectAgent,
    selectedAgent,
    selectedAgentId,
    selectedTemplateLibraryId,
    selectedTemplateLibraryItem,
    setActiveTab,
    setCategoryFilter,
    setDraft,
    setManualMcpName,
    setManualMcpTarget,
    setManualSkillName,
    setMcpQuery,
    setPendingPortablePackage,
    setQuery,
    setRuntimeFilter,
    setSelectedTemplateLibraryId,
    setSkillQuery,
    setStatusFilter,
    setTemplateCategoryFilter,
    setTemplateExportDraft,
    setTemplateExportOpen,
    setTemplateExportTargetId,
    setTemplateQuery,
    skillQuery,
    startCreate,
    state,
    statusFilter,
    suggestedMcpServers,
    suggestedSkills,
    tasks,
    telegramWebhookInfo,
    templateCategoryFilter,
    templateDiffSummary,
    templateExportDraft,
    templateExportOpen,
    templateExportTargetId,
    templateLibrary,
    templateQuery,
    updateMcp,
    updateSkill,
    uploadAgentAvatar,
    validation,
    workdirFiles,
    workdirLoading,
    workdirRefreshing,
    workdirSummary,
  }
}

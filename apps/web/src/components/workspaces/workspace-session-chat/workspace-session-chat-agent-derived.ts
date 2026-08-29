import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { McpServerPolicy } from '@shared/mcp'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import {
  getSubagentRolePromptHint,
  getSubagentRolePromptPlaceholder,
} from '@shared/subagent-role'
import { getWorkspaceSessionRoleLabel } from '@shared/task-workspace'
import type {
  ExecutionLog,
  Project,
  Task,
  WorkspaceSessionRole,
  WorkingDirectoryMode,
} from '@shared/types'
import type { AgentRecord, ConversationMessageRecord } from '../../../lib/api'
import { getCustomAgentAvailabilityReport, matchesCustomAgentQuery } from '../../../lib/custom-agent/availability'
import { parseCustomAgentProfile } from '../../../lib/custom-agent/draft'
import { applyMentionSelection, findMentionedAgents, resolveMentionQuery } from '../../../lib/custom-agent/mentions'
import {
  resolveDefaultDelegateBaseBranch,
  resolveDefaultDelegatePreset,
  resolveDefaultDelegateSessionMode,
  resolveDefaultDelegateWorkingDirectoryMode,
  resolveDelegatePresetOption,
} from '../../../lib/custom-agent/delegate-runtime'
import {
  buildTesterLogContext,
  buildTesterObservationContext,
  mergeTaskChatMcpServers,
} from './workspace-session-chat-helpers'

type TaskChatAgentDerivedParams = {
  availableAgents: AgentRecord[]
  chatSession: TaskChatSessionSnapshot | null
  composerCaret: number
  conversationMessages: ConversationMessageRecord[]
  delegateAgentId: string
  delegateSessionRole: WorkspaceSessionRole
  injectedTesterContextIdsRef: MutableRefObject<string[]>
  input: string
  mcpServers?: McpServerPolicy[]
  project?: Project | null
  setComposerCaret: Dispatch<SetStateAction<number>>
  setInput: Dispatch<SetStateAction<string>>
  systemLogs: ExecutionLog[]
  task: Task
  workspaceId?: string
  workspaceSessionId?: string
}

export function useTaskChatAgentDerived({
  availableAgents,
  chatSession,
  composerCaret,
  conversationMessages,
  delegateAgentId,
  delegateSessionRole,
  injectedTesterContextIdsRef,
  input,
  mcpServers,
  project,
  setComposerCaret,
  setInput,
  systemLogs,
  task,
  workspaceId,
  workspaceSessionId,
}: TaskChatAgentDerivedParams) {
  const boundCustomAgentProfile = useMemo(() => {
    const customAgentId = chatSession?.runtime.customAgentId?.trim()
    const customAgentName = chatSession?.runtime.customAgentName?.trim()
    if (!customAgentId && !customAgentName) {
      return null
    }

    const matchedAgent = availableAgents.find((item) => {
      if (customAgentId && item.id === customAgentId) {
        return true
      }

      return Boolean(customAgentName && item.name.trim() === customAgentName)
    })

    return matchedAgent ? parseCustomAgentProfile(matchedAgent) : null
  }, [availableAgents, chatSession?.runtime.customAgentId, chatSession?.runtime.customAgentName])

  const availableMcpServers = useMemo(() => {
    return mergeTaskChatMcpServers([
      ...(mcpServers ?? []).filter((server) => server.enabled),
      ...(boundCustomAgentProfile?.mcpServers ?? []).filter((server) => server.enabled),
    ])
  }, [boundCustomAgentProfile?.mcpServers, mcpServers])

  const unseenTesterSystemLogs = useMemo(() => {
    const injectedIds = new Set(injectedTesterContextIdsRef.current)
    return systemLogs.filter((log) => !injectedIds.has(`log:${log.id}`)).slice(-3)
  }, [injectedTesterContextIdsRef, systemLogs])

  const unseenTesterObservationMessages = useMemo(() => {
    const injectedIds = new Set(injectedTesterContextIdsRef.current)
    return conversationMessages
      .filter((message) => {
        if (!message.externalRef || typeof message.externalRef !== 'object') {
          return false
        }

        return 'observation' in message.externalRef && !injectedIds.has(`obs:${message.id}`)
      })
      .slice(-3)
  }, [conversationMessages, injectedTesterContextIdsRef])

  const agentScopeReports = useMemo(() => {
    return availableAgents.map((agent) => ({
      agent,
      profile: parseCustomAgentProfile(agent),
      mentionReport: getCustomAgentAvailabilityReport(agent, {
        mode: 'mention',
        projectId: task.projectId,
        collaborationWorkspaceId: project?.workspaceId,
        agentWorkspaceId: workspaceId,
      }),
      delegateReport: getCustomAgentAvailabilityReport(agent, {
        mode: 'delegate',
        projectId: task.projectId,
        collaborationWorkspaceId: project?.workspaceId,
        agentWorkspaceId: workspaceId,
      }),
    }))
  }, [availableAgents, project?.workspaceId, task.projectId, workspaceId])

  const mentionEnabledAgents = useMemo(() => {
    return agentScopeReports.filter((item) => item.mentionReport.available).map((item) => item.agent)
  }, [agentScopeReports])

  const delegatePromptPlaceholder = useMemo(() => {
    return getSubagentRolePromptPlaceholder(delegateSessionRole)
  }, [delegateSessionRole])

  const delegatePromptHint = useMemo(() => {
    return getSubagentRolePromptHint(delegateSessionRole)
  }, [delegateSessionRole])

  const mentionQuery = useMemo(() => {
    const fallbackCaret = composerCaret > 0 && composerCaret <= input.length
      ? composerCaret
      : input.length
    return resolveMentionQuery(input, fallbackCaret, availableAgents)
  }, [availableAgents, composerCaret, input])

  const mentionAvailableOptions = useMemo(() => {
    if (!mentionQuery) {
      return []
    }

    return agentScopeReports
      .filter((item) => item.mentionReport.available && matchesCustomAgentQuery(item.agent, mentionQuery.query))
      .map((item) => item.agent)
  }, [agentScopeReports, mentionQuery])

  const mentionUnavailableOptions = useMemo(() => {
    if (!mentionQuery) {
      return []
    }

    return agentScopeReports
      .filter((item) => !item.mentionReport.available && matchesCustomAgentQuery(item.agent, mentionQuery.query))
      .slice(0, 4)
  }, [agentScopeReports, mentionQuery])

  const mentionedAgents = useMemo(() => {
    return findMentionedAgents(input, mentionEnabledAgents)
  }, [input, mentionEnabledAgents])

  const delegateOptions = useMemo(() => {
    return agentScopeReports
      .filter((item) => item.delegateReport.available)
      .map(({ agent, profile }) => ({
        value: agent.id,
        label: agent.name,
        description: profile.role || profile.summary || agent.type,
        keywords: [agent.name, profile.role, profile.summary, agent.type].filter(Boolean),
      }))
  }, [agentScopeReports])

  const delegateUnavailableOptions = useMemo(() => {
    return agentScopeReports.filter((item) => !item.delegateReport.available).slice(0, 4)
  }, [agentScopeReports])

  const selectedDelegateAgent = useMemo(() => {
    return availableAgents.find((item) => item.id === delegateAgentId) ?? null
  }, [availableAgents, delegateAgentId])

  const selectedDelegateProfile = useMemo(() => {
    return selectedDelegateAgent ? parseCustomAgentProfile(selectedDelegateAgent) : null
  }, [selectedDelegateAgent])

  const selectedDelegatePreset = useMemo(() => {
    return resolveDelegatePresetOption(resolveDefaultDelegatePreset(selectedDelegateAgent))
  }, [selectedDelegateAgent])

  const selectedDelegateSessionMode = useMemo(() => {
    return resolveDefaultDelegateSessionMode(selectedDelegateAgent)
  }, [selectedDelegateAgent])

  const selectedDelegateBaseBranch = useMemo(() => {
    return resolveDefaultDelegateBaseBranch(selectedDelegateAgent, {
      task,
      projectDefaultBranch: project?.defaultBranch,
    })
  }, [project?.defaultBranch, selectedDelegateAgent, task])

  const selectedDelegateWorkingDirectoryMode = useMemo(() => {
    return resolveDefaultDelegateWorkingDirectoryMode(
      selectedDelegateAgent,
      (task as Task & { workingDirectoryMode?: WorkingDirectoryMode }).workingDirectoryMode,
    )
  }, [selectedDelegateAgent, task])

  const insertAgentMention = useCallback((agent: AgentRecord) => {
    if (!mentionQuery) {
      setInput((current) => `${current.trimEnd()} @${agent.name} `.trimStart())
      return
    }

    setInput((current) => applyMentionSelection(current, mentionQuery.start, mentionQuery.end, agent.name))
    setComposerCaret(mentionQuery.start + agent.name.length + 2)
  }, [mentionQuery, setComposerCaret, setInput])

  const updateComposerCaret = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return
    }

    setComposerCaret(target.selectionStart ?? target.value.length)
  }, [setComposerCaret])

  const isCurrentChatScope = useCallback((targetWorkspaceId?: string, targetWorkspaceSessionId?: string) => {
    return (targetWorkspaceId ?? '') === (workspaceId ?? '')
      && (targetWorkspaceSessionId ?? '') === (workspaceSessionId ?? '')
  }, [workspaceId, workspaceSessionId])

  const boundCustomAgentName = chatSession?.runtime.customAgentName?.trim() || ''
  const boundCustomAgentMode = chatSession?.runtime.agentInvocationMode === 'mention'
    ? '@ 调用'
    : chatSession?.runtime.agentInvocationMode === 'delegate'
      ? '委派会话'
      : ''
  const mountedSkillNames = chatSession?.runtime.mountedSkillNames ?? []
  const mountedMcpServerNames = chatSession?.runtime.mountedMcpServerNames ?? []
  const isSubagentSession = chatSession?.runtime.sessionKind === 'subagent'
  const sessionRoleLabel = getWorkspaceSessionRoleLabel(chatSession?.runtime.sessionRole)
  const isTesterSubagentSession = isSubagentSession && chatSession?.runtime.sessionRole === 'tester'

  const markTesterContextInjected = useCallback((params: {
    logs?: ExecutionLog[]
    observations?: ConversationMessageRecord[]
  }) => {
    if ((params.logs?.length ?? 0) === 0 && (params.observations?.length ?? 0) === 0) {
      return
    }

    const next = new Set(injectedTesterContextIdsRef.current)
    for (const log of params.logs ?? []) {
      next.add(`log:${log.id}`)
    }
    for (const message of params.observations ?? []) {
      next.add(`obs:${message.id}`)
    }
    injectedTesterContextIdsRef.current = [...next].slice(-48)
  }, [injectedTesterContextIdsRef])

  const maybeInjectTesterLogContext = useCallback((message: string, options?: {
    testerSession?: boolean
    logs?: ExecutionLog[]
    observations?: ConversationMessageRecord[]
  }) => {
    if (!options?.testerSession) {
      return {
        message,
        injectedLogs: [] as ExecutionLog[],
        injectedObservations: [] as ConversationMessageRecord[],
      }
    }

    const logs = (options.logs ?? []).slice(-3)
    const observations = (options.observations ?? []).slice(-3)
    const contextBlocks = [
      buildTesterLogContext(logs),
      buildTesterObservationContext(observations),
    ].filter(Boolean)

    if (contextBlocks.length === 0) {
      return {
        message,
        injectedLogs: [] as ExecutionLog[],
        injectedObservations: [] as ConversationMessageRecord[],
      }
    }

    return {
      message: `${contextBlocks.join('\n\n')}\n\n[本次用户请求]\n${message}`.trim(),
      injectedLogs: logs,
      injectedObservations: observations,
    }
  }, [])

  const mentionUnavailableAgentItems = useMemo(() => {
    return mentionUnavailableOptions.map(({ agent, mentionReport }) => ({
      agent,
      blockerMessage: mentionReport.blockers[0]?.message || '当前范围不可用。',
    }))
  }, [mentionUnavailableOptions])

  const delegateUnavailableAgentItems = useMemo(() => {
    return delegateUnavailableOptions.map(({ agent, delegateReport }) => ({
      agent,
      blockerMessage: delegateReport.blockers[0]?.message || '当前范围不可用。',
    }))
  }, [delegateUnavailableOptions])

  const selectedDelegateSummary = useMemo(() => {
    if (!selectedDelegateAgent || !selectedDelegateProfile) {
      return null
    }

    const report = getCustomAgentAvailabilityReport(selectedDelegateAgent, {
      mode: 'delegate',
      projectId: task.projectId,
      collaborationWorkspaceId: project?.workspaceId,
      agentWorkspaceId: workspaceId,
    })

    return {
      presetLabel: selectedDelegatePreset.label,
      roleLabel: selectedDelegateProfile.role || selectedDelegateAgent.type,
      presetDescription: selectedDelegatePreset.description,
      highlights: report.highlights,
      sessionModeLabel: selectedDelegateSessionMode,
      baseBranchLabel: selectedDelegateBaseBranch || '未设置',
      workingDirectoryLabel: selectedDelegateWorkingDirectoryMode || 'inherit',
    }
  }, [
    selectedDelegateAgent,
    selectedDelegateBaseBranch,
    selectedDelegatePreset.description,
    selectedDelegatePreset.label,
    selectedDelegateProfile,
    selectedDelegateSessionMode,
    selectedDelegateWorkingDirectoryMode,
    project?.workspaceId,
    task.projectId,
    workspaceId,
  ])

  return {
    availableMcpServers,
    boundCustomAgentMode,
    boundCustomAgentName,
    delegateOptions,
    delegatePromptHint,
    delegatePromptPlaceholder,
    delegateUnavailableAgentItems,
    insertAgentMention,
    isCurrentChatScope,
    isSubagentSession,
    isTesterSubagentSession,
    markTesterContextInjected,
    maybeInjectTesterLogContext,
    mentionAvailableOptions,
    mentionQuery,
    mentionUnavailableAgentItems,
    mentionedAgents,
    mountedMcpServerNames,
    mountedSkillNames,
    selectedDelegateAgent,
    selectedDelegateSummary,
    sessionRoleLabel,
    unseenTesterObservationMessages,
    unseenTesterSystemLogs,
    updateComposerCaret,
  }
}

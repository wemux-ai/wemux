import { toast } from 'sonner'
import { useAppDialog } from '../../components/ui/app-dialog-provider'
import { api } from '../../lib/api'
import { buildMcpServerPolicies } from '../../lib/agent-config'
import type { Language } from '../../lib/i18n'
import { invalidateMainChatThreadCache, mainChatThreadCache } from '../../lib/main-chat-thread-cache'
import {
  applyStateSelection,
  buildMessagesFromSession,
  findCreatedChatSession,
  getSessionAgentId,
  resolveAgentDefaultExecutorId,
  text,
} from './chat-route-helpers'
import type { ChatRouteState } from './use-chat-route-state'

type UseChatRouteSessionActionsParams = {
  language: Language
  routeState: ChatRouteState
}

export function useChatRouteSessionActions({
  language,
  routeState,
}: UseChatRouteSessionActionsParams) {
  const { confirm } = useAppDialog()
  const openConfigDialog = async () => {
    routeState.setShowConfigDialog(true)
    await routeState.loadPrimaryAgent()
  }

  const handleCreateSession = async () => {
    if (routeState.busy) {
      return
    }

    if (!routeState.selectedChatAgent?.canCreateSession) {
      toast.error(text(language, '这个 Agent 当前不可创建新会话。', 'This agent cannot create new sessions right now.'))
      return
    }

    const targetAgentId = routeState.selectedChatAgent.id
    const agentDefaultExecutorId = resolveAgentDefaultExecutorId(routeState.activeCustomAgent)
    const inheritedExecutorId = routeState.activeSession?.executorId || agentDefaultExecutorId
    const createPayload = routeState.activeSession || agentDefaultExecutorId
      ? {
          executorId: inheritedExecutorId || undefined,
          executionModel: inheritedExecutorId
            ? routeState.selectedModel.trim() || undefined
            : undefined,
          workspaceId: routeState.currentWorkspaceId.trim() || undefined,
        }
      : { workspaceId: routeState.currentWorkspaceId.trim() || undefined }
    routeState.setBusy(true)
    try {
      const response = await api.createCustomAgentChatSession(targetAgentId, createPayload)
      const createdSession = findCreatedChatSession(
        routeState.mainChatSessions,
        response.state.mainChatSessions,
        targetAgentId,
      )
      const finalResponse = createdSession && response.state.selectedMainChatSessionId !== createdSession.id
        ? await api.selectMainChatSession(createdSession.id)
        : response

      routeState.setSelectedChatAgentId(targetAgentId)
      const nextActiveSession = finalResponse.state.mainChatSessions.find((session) => {
        return session.id === finalResponse.state.selectedMainChatSessionId
      })
      applyStateSelection(finalResponse.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      if (nextActiveSession) {
        routeState.clearSessionActivity(nextActiveSession.id)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '新建会话失败', 'Failed to create session'))
    } finally {
      routeState.setBusy(false)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    const targetSession = routeState.mainChatSessions.find((session) => session.id === sessionId)
    const previousSelectedSessionId = routeState.state.selectedMainChatSessionId
    const previousSession = routeState.mainChatSessions.find((session) => session.id === previousSelectedSessionId)
    if (targetSession) {
      routeState.setSelectedChatAgentId(getSessionAgentId(targetSession))
    }

    routeState.clearSessionActivity(sessionId, 'completed')

    if (routeState.busy || sessionId === routeState.state.selectedMainChatSessionId) {
      return
    }

    routeState.setBusy(true)
    routeState.setPendingSessionSelectionId(sessionId)
    try {
      if (targetSession) {
        routeState.setState((current) => {
          if (current.selectedMainChatSessionId === sessionId) {
            return current
          }

          return {
            ...current,
            selectedMainChatSessionId: sessionId,
          }
        })
      }

      const response = await api.selectMainChatSession(sessionId)
      applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
    } catch (error) {
      if (previousSelectedSessionId && previousSelectedSessionId !== sessionId) {
        routeState.setState((current) => {
          if (current.selectedMainChatSessionId === previousSelectedSessionId) {
            return current
          }

          return {
            ...current,
            selectedMainChatSessionId: previousSelectedSessionId,
          }
        })
        if (previousSession) {
          routeState.setSelectedChatAgentId(getSessionAgentId(previousSession))
        }
      }

      toast.error(error instanceof Error ? error.message : text(language, '切换会话失败', 'Failed to switch session'))
    } finally {
      routeState.setPendingSessionSelectionId(null)
      routeState.setBusy(false)
    }
  }

  const handleSelectChatAgent = async (agentId: string) => {
    if (routeState.busy || routeState.isStreaming) {
      return
    }

    routeState.setSelectedChatAgentId(agentId)
    const firstSession = routeState.mainChatSessions.find((session) => getSessionAgentId(session) === agentId)
    if (!firstSession) {
      routeState.resetTimeline(buildMessagesFromSession(undefined, language))
      return
    }

    if (firstSession.id === routeState.state.selectedMainChatSessionId) {
      // AppState 不再携带消息，resetTimeline 从 useThread 的已确认消息重建。
      routeState.resetTimeline(routeState.hydratedMessages)
      return
    }

    await handleSelectSession(firstSession.id)
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (routeState.busy || routeState.mainChatSessions.length <= 1) {
      return
    }

    const confirmed = await confirm({
      title: text(language, '删除这个会话？', 'Delete this session?'),
      description: text(language, '会话与其中所有消息将被删除，且不可恢复。', 'The session and all its messages will be deleted permanently.'),
      confirmText: text(language, '删除会话', 'Delete session'),
      cancelText: text(language, '取消', 'Cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    routeState.setBusy(true)
    try {
      const response = await api.deleteMainChatSession(sessionId)
      // 删除后立即清掉缓存条目，避免重挂载时把已删除会话的内容渲染出来。
      invalidateMainChatThreadCache(mainChatThreadCache, sessionId)
      const remainingAgentSession = response.state.mainChatSessions.find((session) => {
        return getSessionAgentId(session) === routeState.selectedChatAgent?.id
      })
      const finalResponse = remainingAgentSession
        && response.state.selectedMainChatSessionId !== remainingAgentSession.id
        ? await api.selectMainChatSession(remainingAgentSession.id)
        : response

      applyStateSelection(finalResponse.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      routeState.clearSessionActivity(sessionId)
      toast.success(response.message || text(language, '会话已删除', 'Session deleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '删除会话失败', 'Failed to delete session'))
    } finally {
      routeState.setBusy(false)
    }
  }

  /** R10.1-B：与 Agent 对话默认公开，可取消公开（private）——仅 owner。 */
  const handleToggleSessionVisibility = async (sessionId: string, nextVisibility: 'public' | 'private') => {
    if (routeState.busy) {
      return
    }

    routeState.setBusy(true)
    try {
      const response = await api.updateMainChatSessionVisibility(sessionId, nextVisibility)
      applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      toast.success(response.message || text(
        language,
        nextVisibility === 'private' ? '已取消公开' : '已设为公开',
        nextVisibility === 'private' ? 'Session made private' : 'Session made public',
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新会话可见性失败', 'Failed to update session visibility'))
    } finally {
      routeState.setBusy(false)
    }
  }

  const handleToggleSessionPinned = async (sessionId: string, pinned: boolean) => {
    if (routeState.busy) {
      return
    }

    routeState.setBusy(true)
    try {
      const response = await api.updateMainChatSessionPinned(sessionId, pinned)
      applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      toast.success(response.message || text(
        language,
        pinned ? '会话已置顶' : '会话已取消置顶',
        pinned ? 'Session pinned' : 'Session unpinned',
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新会话置顶失败', 'Failed to update session pin'))
    } finally {
      routeState.setBusy(false)
    }
  }

  const handleModelChange = async (nextModel: string) => {
    if (!routeState.activeSession || routeState.modelDisabled) {
      return
    }

    const previousModel = routeState.selectedModel
    routeState.setSelectedModel(nextModel)
    routeState.setModelSaving(true)

    try {
      const response = await api.updateMainChatSessionModel(routeState.activeSession.id, nextModel || undefined)
      applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      const updatedSession = response.state.mainChatSessions.find((session) => session.id === routeState.activeSession?.id)
      routeState.setSelectedModel(updatedSession?.executionModel ?? '')
      routeState.setModelMenuOpen(false)
    } catch (error) {
      routeState.setSelectedModel(previousModel)
      toast.error(error instanceof Error ? error.message : text(language, '切换模型失败', 'Failed to switch model'))
    } finally {
      routeState.setModelSaving(false)
    }
  }

  const handleAgentChange = async (nextCustomAgentId?: string) => {
    if (!routeState.activeSession || routeState.busy || routeState.isStreaming) {
      return
    }

    routeState.setConfigLoading(true)
    try {
      const response = await api.updateMainChatSessionAgent(routeState.activeSession.id, nextCustomAgentId)
      applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      routeState.setSelectedChatAgentId(nextCustomAgentId?.trim() || routeState.chatAgents[0]?.id || '')
      routeState.setAgentMenuOpen(false)
      toast.success(response.message || text(language, '会话 Agent 已更新', 'Session agent updated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '切换会话 Agent 失败', 'Failed to switch session agent'))
    } finally {
      routeState.setConfigLoading(false)
    }
  }

  const handleToggleMcpServer = async (serverId: string, enabled: boolean) => {
    if (routeState.busy || routeState.configLoading) {
      return
    }

    routeState.setConfigLoading(true)
    try {
      const response = await api.saveSettings({
        ...routeState.state.config,
        mcpServers: buildMcpServerPolicies(routeState.globalMcpServers.map((server) => {
          return server.id === serverId ? { ...server, enabled } : server
        })),
      })
      applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      toast.success(response.message || text(language, '全局 MCP 配置已更新', 'Global MCP config updated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新 MCP 配置失败', 'Failed to update MCP config'))
    } finally {
      routeState.setConfigLoading(false)
    }
  }

  return {
    handleAgentChange,
    handleCreateSession,
    handleDeleteSession,
    handleModelChange,
    handleSelectChatAgent,
    handleSelectSession,
    handleToggleSessionPinned,
    handleToggleSessionVisibility,
    handleToggleMcpServer,
    openConfigDialog,
  }
}

export type ChatRouteSessionActions = ReturnType<typeof useChatRouteSessionActions>

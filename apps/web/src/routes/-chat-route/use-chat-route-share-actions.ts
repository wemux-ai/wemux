import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  api,
  type ConversationShareRecord,
  type ConversationSharePermission,
  type SessionSearchHit,
  type TeamMember,
  type WorkspaceChatAgentOption,
} from '../../lib/api'
import {
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspaceId,
} from '../../lib/collaboration-workspace'
import type { Language } from '../../lib/i18n'
import { text } from './chat-route-helpers'

export type ForwardTargetOptions = {
  members: TeamMember[]
  agents: WorkspaceChatAgentOption[]
}

const EMPTY_FORWARD_OPTIONS: ForwardTargetOptions = { members: [], agents: [] }

type UseChatRouteShareActionsParams = {
  language: Language
}

export function useChatRouteShareActions({ language }: UseChatRouteShareActionsParams) {
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())

  const toggleMultiSelectMode = useCallback(() => {
    setMultiSelectMode((current) => !current)
    setSelectedSessionIds(new Set())
  }, [])

  const toggleSessionSelected = useCallback((sessionId: string, checked: boolean) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(sessionId)
      } else {
        next.delete(sessionId)
      }
      return next
    })
  }, [])

  const clearSelectedSessions = useCallback(() => {
    setSelectedSessionIds(new Set())
  }, [])

  const [forwardDialogOpen, setForwardDialogOpen] = useState(false)
  const [forwardSourceSessionIds, setForwardSourceSessionIds] = useState<string[]>([])
  const [forwardOptions, setForwardOptions] = useState<ForwardTargetOptions>(EMPTY_FORWARD_OPTIONS)
  const [forwardOptionsLoading, setForwardOptionsLoading] = useState(false)
  const [forwardTargetUserIds, setForwardTargetUserIds] = useState<string[]>([])
  const [forwardTargetAgentIds, setForwardTargetAgentIds] = useState<string[]>([])
  const [forwardBusy, setForwardBusy] = useState(false)

  const openForwardDialog = useCallback(async (sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return
    }

    setForwardSourceSessionIds(sessionIds)
    setForwardTargetUserIds([])
    setForwardTargetAgentIds([])
    setForwardDialogOpen(true)
    setForwardOptionsLoading(true)
    try {
      const workspacesResponse = await api.listCollaborationWorkspaces()
      const workspaceId = resolveCollaborationWorkspaceId(
        workspacesResponse.workspaces,
        getStoredCollaborationWorkspaceId(),
      )
      if (!workspaceId) {
        setForwardOptions(EMPTY_FORWARD_OPTIONS)
        return
      }

      const optionsResponse = await api.getWorkspaceChatGroupOptions(workspaceId)
      setForwardOptions({
        members: optionsResponse.members,
        agents: optionsResponse.agents,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '加载转发目标失败', 'Failed to load forward targets'))
    } finally {
      setForwardOptionsLoading(false)
    }
  }, [language])

  const toggleForwardTargetUser = useCallback((memberId: string, checked: boolean) => {
    setForwardTargetUserIds((current) => (
      checked ? [...current, memberId] : current.filter((id) => id !== memberId)
    ))
  }, [])

  const toggleForwardTargetAgent = useCallback((agentId: string, checked: boolean) => {
    setForwardTargetAgentIds((current) => (
      checked ? [...current, agentId] : current.filter((id) => id !== agentId)
    ))
  }, [])

  const submitForward = useCallback(async () => {
    if (forwardSourceSessionIds.length === 0) {
      return
    }

    const targets = [
      ...forwardTargetUserIds.map((targetId) => ({ targetType: 'user' as const, targetId })),
      ...forwardTargetAgentIds.map((targetId) => ({ targetType: 'agent' as const, targetId })),
    ]
    if (targets.length === 0) {
      toast.error(text(language, '请选择至少一个转发目标。', 'Choose at least one forward target.'))
      return
    }

    setForwardBusy(true)
    try {
      await api.forwardSessions({
        mainChatSessionIds: forwardSourceSessionIds,
        targets,
        permission: 'read',
      })
      toast.success(text(language, '会话已转发', 'Session forwarded'))
      setForwardDialogOpen(false)
      setSelectedSessionIds(new Set())
      setMultiSelectMode(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '转发失败', 'Failed to forward session'))
    } finally {
      setForwardBusy(false)
    }
  }, [forwardSourceSessionIds, forwardTargetAgentIds, forwardTargetUserIds, language])

  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareSourceSessionId, setShareSourceSessionId] = useState('')
  const [shareVisibility, setShareVisibility] = useState<'public' | 'private'>('private')
  const [shareRecords, setShareRecords] = useState<ConversationShareRecord[]>([])
  const [shareLinkToken, setShareLinkToken] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)

  const loadShareRecords = useCallback(async (sessionId: string) => {
    setShareLoading(true)
    try {
      const response = await api.listSessionShares('main_chat', sessionId)
      setShareRecords(response.shares)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '加载分享信息失败', 'Failed to load shares'))
    } finally {
      setShareLoading(false)
    }
  }, [language])

  const openShareDialog = useCallback(async (sessionId: string, currentVisibility: 'public' | 'private' | undefined) => {
    setShareSourceSessionId(sessionId)
    setShareVisibility(currentVisibility ?? 'private')
    setShareLinkToken('')
    setShareDialogOpen(true)
    await loadShareRecords(sessionId)
  }, [loadShareRecords])

  const handleToggleVisibility = useCallback(async (nextVisibility: 'public' | 'private') => {
    if (!shareSourceSessionId) {
      return
    }

    setShareBusy(true)
    try {
      await api.setSessionVisibility('main_chat', shareSourceSessionId, nextVisibility)
      setShareVisibility(nextVisibility)
      toast.success(nextVisibility === 'public'
        ? text(language, '会话已设为公开', 'Session set to public')
        : text(language, '会话已设为私密', 'Session set to private'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新可见性失败', 'Failed to update visibility'))
    } finally {
      setShareBusy(false)
    }
  }, [language, shareSourceSessionId])

  const handleCreateShareLink = useCallback(async (permission: ConversationSharePermission = 'read') => {
    if (!shareSourceSessionId) {
      return
    }

    setShareBusy(true)
    try {
      const response = await api.createSessionShare('main_chat', shareSourceSessionId, {
        targetType: 'link',
        permission,
      })
      setShareLinkToken(response.token ?? '')
      await loadShareRecords(shareSourceSessionId)
      toast.success(text(language, '分享链接已生成', 'Share link created'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '生成分享链接失败', 'Failed to create share link'))
    } finally {
      setShareBusy(false)
    }
  }, [language, loadShareRecords, shareSourceSessionId])

  const handleRevokeShare = useCallback(async (shareId: string) => {
    setShareBusy(true)
    try {
      await api.revokeSessionShare(shareId)
      if (shareSourceSessionId) {
        await loadShareRecords(shareSourceSessionId)
      }
      setShareLinkToken('')
      toast.success(text(language, '分享已撤销', 'Share revoked'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '撤销分享失败', 'Failed to revoke share'))
    } finally {
      setShareBusy(false)
    }
  }, [language, loadShareRecords, shareSourceSessionId])

  const [sessionSearchQuery, setSessionSearchQuery] = useState('')
  const [sessionSearchHits, setSessionSearchHits] = useState<SessionSearchHit[]>([])
  const [sessionSearchLoading, setSessionSearchLoading] = useState(false)

  const runSessionSearch = useCallback(async (query: string) => {
    const trimmed = query.trim()
    setSessionSearchQuery(query)
    if (!trimmed) {
      setSessionSearchHits([])
      return
    }

    setSessionSearchLoading(true)
    try {
      const response = await api.searchSessions(trimmed, 20)
      setSessionSearchHits(response.hits)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '搜索会话失败', 'Failed to search sessions'))
    } finally {
      setSessionSearchLoading(false)
    }
  }, [language])

  return useMemo(() => ({
    multiSelectMode,
    toggleMultiSelectMode,
    selectedSessionIds,
    toggleSessionSelected,
    clearSelectedSessions,

    forwardDialogOpen,
    setForwardDialogOpen,
    forwardSourceSessionIds,
    forwardOptions,
    forwardOptionsLoading,
    forwardTargetUserIds,
    forwardTargetAgentIds,
    forwardBusy,
    openForwardDialog,
    toggleForwardTargetUser,
    toggleForwardTargetAgent,
    submitForward,

    shareDialogOpen,
    setShareDialogOpen,
    shareSourceSessionId,
    shareVisibility,
    shareRecords,
    shareLinkToken,
    shareLoading,
    shareBusy,
    openShareDialog,
    handleToggleVisibility,
    handleCreateShareLink,
    handleRevokeShare,


    sessionSearchQuery,
    sessionSearchHits,
    sessionSearchLoading,
    runSessionSearch,
  }), [
    multiSelectMode,
    toggleMultiSelectMode,
    selectedSessionIds,
    toggleSessionSelected,
    clearSelectedSessions,
    forwardDialogOpen,
    forwardSourceSessionIds,
    forwardOptions,
    forwardOptionsLoading,
    forwardTargetUserIds,
    forwardTargetAgentIds,
    forwardBusy,
    openForwardDialog,
    toggleForwardTargetUser,
    toggleForwardTargetAgent,
    submitForward,
    shareDialogOpen,
    shareSourceSessionId,
    shareVisibility,
    shareRecords,
    shareLinkToken,
    shareLoading,
    shareBusy,
    openShareDialog,
    handleToggleVisibility,
    handleCreateShareLink,
    handleRevokeShare,
    sessionSearchQuery,
    sessionSearchHits,
    sessionSearchLoading,
    runSessionSearch,
  ])
}

export type ChatRouteShareActions = ReturnType<typeof useChatRouteShareActions>

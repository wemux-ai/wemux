/**
 * [INPUT]: Main-chat controller state, workspace group-chat state, and persisted target preference.
 * [OUTPUT]: The `/chat` three-pane layout with one selected Agent or group-chat target.
 * [POS]: Direct Agent and workspace group conversations; task assignment remains Agent-only.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { setMobileBottomNavHidden, setMobileSiteHeaderHidden } from '../../lib/mobile-bottom-nav'
import { setChatTotalUnread } from '../../lib/chat-unread-store'
import { useSidebar } from '../../components/ui/sidebar'
import { cn } from '../../lib/utils'
import { useTranslation } from '../../lib/i18n/react'
import { setAgentLaunchHandler, setDmLaunchHandler } from '../../lib/dm-launch'
import { ChatConfigDialog } from './chat-config-dialog'
import { ChatMainPanel } from './chat-main-panel'
import { ChatSessionSidebar } from './chat-session-sidebar'
import { ChatTargetSidebar } from './chat-target-sidebar'
import { DmChatPanel } from './dm-chat-panel'
import { SessionForwardDialog } from './session-forward-dialog'
import { SessionShareDialog } from './session-share-dialog'
import { useChatRouteController } from './use-chat-route-controller'
import { useDmChatState } from './use-dm-chat-state'
import { useWorkspaceGroupChatState, WorkspaceGroupMainPanel } from './workspace-group-chat-panel'
import { resolveAvailableChatAgentId } from './chat-route-helpers'
import {
  readWorkspaceGroupChatPreferences,
  setPersistedWorkspaceGroupChatTarget,
  writeWorkspaceGroupChatPreferences,
} from './workspace-group-chat-preferences'

const MOBILE_CHAT_DETAIL_HISTORY_KEY = '__vibemuxChatMobileDetail'

const isMobileChatDetailState = (state: unknown) => {
  if (!state || typeof state !== 'object') {
    return false
  }

  return (state as Record<string, unknown>)[MOBILE_CHAT_DETAIL_HISTORY_KEY] === true
}

export function ChatRoutePage() {
  const { language } = useTranslation()
  const { isMobile } = useSidebar()
  const controller = useChatRouteController({ language })
  const groupState = useWorkspaceGroupChatState(language)
  const dmState = useDmChatState({ language })
  const persistedGroupChatPreferences = readWorkspaceGroupChatPreferences()
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [selectedTarget, setSelectedTarget] = useState<{ kind: 'agent' | 'group' | 'dm'; id: string }>({
    kind: persistedGroupChatPreferences.selectedTarget?.kind || 'agent',
    id: persistedGroupChatPreferences.selectedTarget?.id || controller.selectedChatAgent?.id || '',
  })

  // 聊天未读总量（DM + 主对话 + 群聊会话）发布给全局侧边栏 /chat 红点；
  // 聚焦查看会话即清零（各未读 hook 的 markRead 承担），离开页面保留最后值。
  const totalChatUnread = useMemo(() => (
    Object.values(dmState.unreadByConversationId).reduce((sum, count) => sum + count, 0)
    + Object.values(controller.mainChatUnread).reduce((sum, count) => sum + count, 0)
    + Object.values(groupState.unreadCountByGroupId).reduce((sum, count) => sum + count, 0)
  ), [controller.mainChatUnread, dmState.unreadByConversationId, groupState.unreadCountByGroupId])
  useEffect(() => {
    setChatTotalUnread(totalChatUnread)
  }, [totalChatUnread])

  // 从提醒/推送链接进入：?groupChat= 选中群聊、?dmPeer= 选中私聊（一次性，随后清理 URL）。
  const location = useLocation()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const groupId = params.get('groupChat')
    const dmPeerId = params.get('dmPeer')
    if (!groupId && !dmPeerId) {
      return
    }

    if (groupId) {
      groupState.setSelectedGroupId(groupId)
      setSelectedTarget({ kind: 'group', id: groupId })
    } else if (dmPeerId) {
      dmState.selectPeer(dmPeerId)
      setSelectedTarget({ kind: 'dm', id: dmPeerId })
      if (isMobile) {
        openMobileDetail()
      }
    }

    window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [dmState, groupState, isMobile, location.search])

  const isGroupTarget = selectedTarget.kind === 'group'
  const isDmTarget = selectedTarget.kind === 'dm'
  const selectedChatAgentId = controller.selectedChatAgent?.id || ''
  const resolvedAgentTargetId = resolveAvailableChatAgentId(
    selectedTarget.kind === 'agent' ? selectedTarget.id : '',
    controller.chatAgents.map((agent) => agent.id),
    selectedChatAgentId,
  )

  const handleStartDm = async (userId: string) => {
    const conversationId = await dmState.startDm(userId, groupState.selectedWorkspaceId)
    if (conversationId) {
      // DM 选中态 id 为 peerUserId（左栏按私聊对象聚合）。
      setSelectedTarget({ kind: 'dm', id: userId })
      // 从群设置发起私聊后关闭弹窗并（移动端）切到对话详情。
      groupState.setSettingsOpen(false)
      if (isMobile) {
        openMobileDetail()
      }
    }
    return conversationId
  }

  // 悬浮用户卡片「聊天」按钮 → 本页 DM 消费方（卸载时注销）。
  useEffect(() => {
    setDmLaunchHandler((targetUserId) => {
      void handleStartDm(targetUserId)
    })
    return () => setDmLaunchHandler(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmState, groupState, isMobile])

  // Agent 卡片「聊天」→ 切换到该 Agent 的主对话（卸载时注销）。
  useEffect(() => {
    setAgentLaunchHandler((agentId) => {
      setSelectedTarget({ kind: 'agent', id: agentId })
      void controller.handleSelectChatAgent(agentId)
      if (isMobile) {
        openMobileDetail()
      }
    })
    return () => setAgentLaunchHandler(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, isMobile])

  const handleSelectTarget = (target: { kind: 'agent' | 'group' | 'dm'; id: string }) => {
    if (target.kind === 'agent') {
      if (controller.busy || controller.isStreaming) return
      setSelectedTarget(target)
      void controller.handleSelectChatAgent(target.id)
      return
    }

    if (target.kind === 'dm') {
      setSelectedTarget(target)
      dmState.selectPeer(target.id)
      if (isMobile) {
        openMobileDetail()
      }
      return
    }

    setSelectedTarget(target)
    groupState.setSelectedGroupId(target.id)
  }

  const openMobileDetail = useCallback(() => {
    setMobileView('detail')
  }, [])

  const handleBackToList = useCallback(() => {
    if (isMobileChatDetailState(window.history.state)) {
      window.history.back()
      return
    }

    setMobileView('list')
  }, [])

  useEffect(() => {
    if (selectedTarget.kind !== 'group' || !groupState.selectedGroupId) return
    if (selectedTarget.id === groupState.selectedGroupId) return
    setSelectedTarget({ kind: 'group', id: groupState.selectedGroupId })
  }, [groupState.selectedGroupId, selectedTarget])

  // 刷新页面后恢复 DM 选中态（agent/group 各有对应 effect，DM 补上）。
  // 选中态 id 为 peerUserId；selectPeer 幂等（已在该对象的会话中则跳过），
  // 依赖 dmConversations 保证私聊列表异步加载完成后重试一次。
  useEffect(() => {
    if (selectedTarget.kind !== 'dm' || !selectedTarget.id) return
    dmState.selectPeer(selectedTarget.id)
  }, [dmState, dmState.dmConversations, selectedTarget.kind, selectedTarget.id])

  useEffect(() => {
    if (selectedTarget.kind !== 'agent' || !resolvedAgentTargetId) return

    if (selectedTarget.id !== resolvedAgentTargetId) {
      setSelectedTarget({ kind: 'agent', id: resolvedAgentTargetId })
      return
    }

    if (resolvedAgentTargetId === selectedChatAgentId) return
    void controller.handleSelectChatAgent(resolvedAgentTargetId)
  }, [controller.handleSelectChatAgent, resolvedAgentTargetId, selectedChatAgentId, selectedTarget.id, selectedTarget.kind])

  useEffect(() => {
    const nextPreferences = setPersistedWorkspaceGroupChatTarget(
      readWorkspaceGroupChatPreferences(),
      selectedTarget,
    )
    writeWorkspaceGroupChatPreferences(nextPreferences)
  }, [selectedTarget])

  useEffect(() => {
    if (!isMobile) {
      setMobileView('detail')
      return
    }

    const handlePopState = (event: PopStateEvent) => {
      setMobileView(isMobileChatDetailState(event.state) ? 'detail' : 'list')
    }

    setMobileView(isMobileChatDetailState(window.history.state) ? 'detail' : 'list')
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isMobile])

  useEffect(() => {
    if (!isMobile || mobileView !== 'detail' || isMobileChatDetailState(window.history.state)) {
      return
    }

    const currentState = window.history.state
    const nextState = currentState && typeof currentState === 'object'
      ? { ...currentState, [MOBILE_CHAT_DETAIL_HISTORY_KEY]: true }
      : { [MOBILE_CHAT_DETAIL_HISTORY_KEY]: true }

    window.history.pushState(nextState, '', window.location.href)
  }, [isMobile, mobileView])

  useEffect(() => {
    const hidden = isMobile && mobileView === 'detail'
    setMobileBottomNavHidden(hidden)
    setMobileSiteHeaderHidden(hidden)

    return () => {
      setMobileBottomNavHidden(false)
      setMobileSiteHeaderHidden(false)
    }
  }, [isMobile, mobileView])

  const desktopSessionSidebar = (
    <ChatSessionSidebar
      controller={controller}
      groupState={groupState}
      dmState={dmState}
      selectedTarget={selectedTarget}
      language={language}
      isMobile={false}
    />
  )
  const mobileSessionSidebar = (
    <ChatSessionSidebar
      controller={controller}
      groupState={groupState}
      dmState={dmState}
      selectedTarget={selectedTarget}
      language={language}
      isMobile
      onSelectSession={openMobileDetail}
    />
  )
  const mainPanel = isGroupTarget
    ? (
        <WorkspaceGroupMainPanel
          groupState={groupState}
          language={language}
          isMobile={isMobile}
          onBackToList={isMobile ? handleBackToList : undefined}
          onStartDm={handleStartDm}
        />
      )
    : isDmTarget
      ? (
          <DmChatPanel
            dmState={dmState}
            language={language}
            isMobile={isMobile}
            onBackToList={isMobile ? handleBackToList : undefined}
          />
        )
      : (
          <ChatMainPanel
            controller={controller}
            isMobile={isMobile}
            language={language}
            onBackToList={isMobile ? handleBackToList : undefined}
          />
        )

  return (
    <div className="flex h-full min-h-full flex-col bg-[#050505] text-zinc-100">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {isMobile ? (
          mobileView === 'list' ? (
            <div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
              <ChatTargetSidebar
                controller={controller}
                groupState={groupState}
                dmState={dmState}
                language={language}
                selectedTarget={selectedTarget}
                onSelectTarget={handleSelectTarget}
              />
              {mobileSessionSidebar}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">
              {mainPanel}
            </div>
          )
        ) : (
          <Group
            id="main-chat-columns"
            orientation="horizontal"
            className={cn('min-h-0 flex-1')}
          >
            <Panel id="mainChatTargets" defaultSize="20%" minSize="220px" maxSize="320px">
              <ChatTargetSidebar
                controller={controller}
                groupState={groupState}
                dmState={dmState}
                language={language}
                selectedTarget={selectedTarget}
                onSelectTarget={handleSelectTarget}
              />
            </Panel>
            <Separator className="group relative flex w-1 items-center justify-center px-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
              <div className="h-full w-px bg-zinc-900 transition-colors group-hover:bg-zinc-700 group-focus:bg-zinc-700 group-focus-visible:bg-zinc-700" />
            </Separator>
            <Panel id="mainChatSessions" defaultSize="20%" minSize="220px" maxSize="340px">
              {desktopSessionSidebar}
            </Panel>
            <Separator className="group relative flex w-1 items-center justify-center px-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
              <div className="h-full w-px bg-zinc-900 transition-colors group-hover:bg-zinc-700 group-focus:bg-zinc-700 group-focus-visible:bg-zinc-700" />
            </Separator>
            <Panel id="mainChatDetail" defaultSize="60%" minSize="440px">
              {mainPanel}
            </Panel>
          </Group>
        )}
      </div>

      {!isGroupTarget && !isDmTarget ? <ChatConfigDialog controller={controller} language={language} /> : null}
      <SessionForwardDialog language={language} shareActions={controller.shareActions} />
      <SessionShareDialog language={language} shareActions={controller.shareActions} />
    </div>
  )
}

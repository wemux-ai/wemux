import { useEffect, useRef } from 'react'
import type { SkillRecord } from '@shared/skill'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import type { Language } from '../../lib/i18n'
import {
  applyStateSelection,
  buildImageFallbackPrompt,
  consumeLeadingUserEcho,
  createMainChatSystemMessage,
  normalizeChatErrorMessage,
  text,
} from './chat-route-helpers'
import type { ChatBubbleMessage } from './chat-route-types'
import type { TaskProposal, ToolCall } from '@shared/types'
import type { ChatRouteState } from './use-chat-route-state'

type UseChatRouteStreamActionsParams = {
  language: Language
  routeState: ChatRouteState
}

export function useChatRouteStreamActions({
  language,
  routeState,
}: UseChatRouteStreamActionsParams) {
  const sendInFlightRef = useRef(false)

  const handleImageUpload = async (files: File[]) => {
    if (files.length === 0 || routeState.busy || routeState.isUploading) {
      return
    }

    routeState.setIsUploading(true)
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          continue
        }

        const reader = new FileReader()
        const imageBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        const uploaded = await api.uploadMainChatImage(imageBase64, file.name)
        routeState.setImages((previous) => [
          ...previous,
          {
            id: uploaded.id,
            url: uploaded.url,
            filename: file.name,
            contentType: uploaded.contentType || file.type,
          },
        ])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '图片上传失败', 'Failed to upload image'))
    } finally {
      routeState.setIsUploading(false)
    }
  }

  const handleRemoveImage = (imageId: string) => {
    routeState.setImages((previous) => previous.filter((image) => image.id !== imageId))
  }

  const processSend = async (
    userMessage: ChatBubbleMessage,
    sessionId: string,
    value: string,
    remainingEcho = '',
  ) => {
    if (sendInFlightRef.current) {
      return
    }

    sendInFlightRef.current = true
    let localRemainingEcho = remainingEcho
    const assistantAuthorId = routeState.activeSession?.customAgentId?.trim()
      || routeState.selectedChatAgent?.id
      || undefined
    const assistantAuthorName = routeState.activeCustomAgent?.name
      || routeState.selectedChatAgent?.name
      || routeState.primaryAgentSummary?.name
      || text(language, 'Agent', 'Agent')

    routeState.setBusy(true)
    routeState.setIsStreaming(true)
    routeState.markSessionActivity(sessionId, 'running')
    routeState.setStreamStatus(text(language, 'Agent 系统正在分析需求...', 'The Agent system is analyzing the request...'))
    const abortController = new AbortController()
    routeState.streamAbortRef.current = abortController
    routeState.resumeAutoScroll()
    routeState.streamingAssistantIdRef.current = crypto.randomUUID()
    routeState.streamingAssistantSegmentIndexRef.current = 0
    routeState.splitAssistantSegmentOnNextDeltaRef.current = false
    routeState.setMessages((previous) => [...previous, userMessage])
    routeState.appendStatusEntry('thinking', text(language, 'Agent 系统正在分析需求...', 'The Agent system is analyzing the request...'))
    routeState.upsertStreamingAssistant((current) => ({
      ...current,
      authorType: 'agent',
      authorId: assistantAuthorId,
      authorName: assistantAuthorName,
      agentRunningStatus: 'thinking',
      currentStep: text(language, 'Agent 系统正在分析需求...', 'The Agent system is analyzing the request...'),
    }))

    try {
      const result = await api.aiChatStream(
        sessionId,
        value,
        (event) => {
          if (event.type === 'status') {
            const nextStep = event.currentStep || event.content
            routeState.setStreamStatus(nextStep)
            routeState.appendStatusEntry(event.status ?? 'thinking', nextStep)
            routeState.upsertStreamingAssistant((current) => ({
              ...current,
              authorType: 'agent',
              authorId: assistantAuthorId,
              authorName: assistantAuthorName,
              agentRunningStatus: event.status ?? current.agentRunningStatus ?? 'thinking',
              currentStep: nextStep,
            }))
            return
          }

          if (event.type === 'delta') {
            routeState.setStreamStatus(text(language, 'Agent 系统正在回复...', 'The Agent system is responding...'))
            const filtered = consumeLeadingUserEcho(localRemainingEcho, event.content)
            localRemainingEcho = filtered.nextEcho
            if (!filtered.nextContent) {
              return
            }

            if (routeState.splitAssistantSegmentOnNextDeltaRef.current) {
              routeState.streamingAssistantSegmentIndexRef.current += 1
              routeState.splitAssistantSegmentOnNextDeltaRef.current = false
            }

            routeState.upsertStreamingAssistant((current) => ({
              ...current,
              content: current.content + filtered.nextContent,
              authorType: 'agent',
              authorId: assistantAuthorId,
              authorName: assistantAuthorName,
              agentRunningStatus: current.agentRunningStatus === 'waiting' ? current.agentRunningStatus : 'executing',
              currentStep: text(language, 'Agent 系统正在回复...', 'The Agent system is responding...'),
            }))
            routeState.upsertAssistantEntry((current) => current + filtered.nextContent)
            return
          }

          if (event.type === 'reasoning' && event.partId) {
            routeState.upsertThinkingEntry(event.partId, event.content)
            return
          }

          if (event.type === 'tool' && event.toolCall) {
            routeState.upsertToolEntry(event.toolCall as ToolCall)
            routeState.splitAssistantSegmentOnNextDeltaRef.current = true
            return
          }

          if (event.type === 'done') {
            const nextStep = event.currentStep || text(language, 'Agent 系统对话已完成', 'Agent system conversation completed')
            const taskProposal = (event as { taskProposal?: TaskProposal }).taskProposal
            routeState.setStreamStatus(text(language, '已完成', 'Completed'))
            routeState.appendStatusEntry(event.status ?? 'complete', nextStep)
            routeState.upsertStreamingAssistant((current) => ({
              ...current,
              content: event.content || current.content || nextStep,
              streaming: false,
              authorType: 'agent',
              authorId: assistantAuthorId,
              authorName: assistantAuthorName,
              agentRunningStatus: event.status ?? 'complete',
              currentStep: nextStep,
              toolCalls: event.toolCalls ?? current.toolCalls,
              ...(taskProposal ? { taskProposal } : {}),
            }))
            routeState.markSessionActivity(sessionId, 'completed')

            if (event.state) {
              applyStateSelection(event.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
            }
            return
          }

          if (event.type === 'error') {
            const nextStep = event.currentStep?.trim()
              || event.content?.trim()
              || text(language, 'Agent 系统对话失败', 'Agent system conversation failed')
            if (event.state) {
              applyStateSelection(event.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
            }
            routeState.setStreamStatus(text(language, '回复失败', 'Response failed'))
            routeState.appendStatusEntry(
              event.status ?? 'error',
              nextStep,
            )
            routeState.upsertStreamingAssistant((current) => ({
              ...current,
              content: event.content || current.content || nextStep,
              streaming: false,
              authorType: 'agent',
              authorId: assistantAuthorId,
              authorName: assistantAuthorName,
              agentRunningStatus: event.status ?? 'error',
              currentStep: nextStep,
              toolCalls: event.toolCalls ?? current.toolCalls,
            }))
            routeState.markSessionActivity(sessionId, 'completed')
          }
        },
        abortController.signal,
        userMessage.attachments,
        undefined,
        routeState.replyToMessageId,
      )

      if (result.aborted) {
        const abortMessage = result.output || text(language, '本次生成已停止', 'This generation was stopped')
        routeState.appendStatusEntry('error', abortMessage)
        routeState.upsertStreamingAssistant((current) => ({
          ...current,
          content: current.content || abortMessage,
          streaming: false,
          agentRunningStatus: 'error',
          currentStep: abortMessage,
        }))
        routeState.setStreamStatus(
          result.output === '已停止'
            ? text(language, '已停止', 'Stopped')
            : abortMessage,
        )
        routeState.markSessionActivity(sessionId, 'completed')
        return
      }

      if (!result.ok) {
        throw new Error(result.output)
      }
    } catch (error) {
      const message = normalizeChatErrorMessage(
        error instanceof Error ? error.message : text(language, '发送失败', 'Failed to send'),
        language,
      )
      toast.error(message)
      routeState.appendStatusEntry('error', message)
      routeState.upsertStreamingAssistant((current) => ({
        ...current,
        content: current.content || message,
        streaming: false,
        authorType: 'agent',
        authorId: assistantAuthorId,
        authorName: assistantAuthorName,
        agentRunningStatus: 'error',
        currentStep: message,
      }))
      routeState.setStreamStatus(text(language, '回复失败', 'Response failed'))
      routeState.markSessionActivity(sessionId, 'completed')
    } finally {
      sendInFlightRef.current = false
      routeState.streamAbortRef.current = null
      routeState.setBusy(false)
      routeState.setIsStreaming(false)
    }
  }

  const handleSend = async () => {
    const attachments = routeState.images.map((image) => ({
      id: image.id,
      url: image.url,
      filename: image.filename,
      contentType: image.contentType,
    }))
    const rawValue = routeState.chatInput.trim()
    const value = rawValue || (attachments.length > 0 ? buildImageFallbackPrompt(attachments.length, language) : '')
    if ((!value && attachments.length === 0) || routeState.busy || sendInFlightRef.current) {
      return
    }

    if (!routeState.activeSession) {
      toast.error(text(language, '请先选择或创建会话。', 'Select or create a session first.'))
      return
    }

    const userMessage: ChatBubbleMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: value,
      createdAt: new Date().toISOString(),
      attachments,
      ...(routeState.replyToMessageId ? { replyToMessageId: routeState.replyToMessageId } : {}),
      timelineOrder: routeState.nextTimelineOrder(),
    }

    routeState.setChatInput('')
    routeState.setImages([])
    routeState.setReplyToMessageId('')
    const activeSessionId = routeState.activeSession.id
    const selectedExecutorOffline = Boolean(
      routeState.effectiveExecutorId
      && routeState.selectedExecutor
      && routeState.selectedExecutor.status !== 'online',
    )

    if (selectedExecutorOffline) {
      routeState.setMessageQueue((previous) => [...previous, userMessage])
      routeState.setMessages((previous) => [
        ...previous,
        createMainChatSystemMessage(
          text(
            language,
            '当前执行器节点不在线，消息已暂存到发送队列。',
            'The current executor is offline. Your message has been queued.',
          ),
          routeState.nextTimelineOrder(),
          language,
        ),
      ])
      return
    }

    if (routeState.isStreaming || routeState.messageQueue.length > 0) {
      routeState.setMessageQueue((previous) => [...previous, userMessage])
      return
    }

    await processSend(userMessage, activeSessionId, value)
  }

  useEffect(() => {
    // 未指定执行节点时视为「自动分配（官方云节点 / 在线执行器）」：不阻塞队列消费。
    const selectedExecutorOnline = !routeState.effectiveExecutorId
      || routeState.selectedExecutor?.status === 'online'
    if (
      routeState.isStreaming
      || sendInFlightRef.current
      || routeState.messageQueue.length === 0
      || !routeState.activeSession
      || !selectedExecutorOnline
    ) {
      return
    }

    const [nextMessage, ...restQueue] = routeState.messageQueue
    routeState.setMessageQueue(restQueue)
    void processSend(nextMessage, routeState.activeSession.id, nextMessage.content)
  }, [routeState.activeSession, routeState.isStreaming, routeState.messageQueue.length, routeState.selectedExecutor?.status])

  const handleStopStreaming = () => {
    const activeSessionId = routeState.activeSession?.id
    const abortController = routeState.streamAbortRef.current
    if (!abortController) {
      return
    }

    routeState.setStreamStatus(text(language, '已停止', 'Stopped'))
    routeState.setIsStreaming(false)
    routeState.setState((current) => ({
      ...current,
      mainChatSessions: current.mainChatSessions.map((session) => (
        session.id === activeSessionId
          ? {
              ...session,
              agentRunningStatus: 'idle',
              currentStep: '',
            }
          : session
      )),
    }))
    routeState.upsertStreamingAssistant((current) => ({
      ...current,
      content: current.content || text(language, '已停止', 'Stopped'),
      streaming: false,
      agentRunningStatus: 'error',
      currentStep: text(language, '已停止', 'Stopped'),
    }))
    routeState.appendStatusEntry('error', text(language, '已停止', 'Stopped'))
    if (activeSessionId) {
      routeState.clearSessionActivity(activeSessionId)
      void api.stopMainChatSession(activeSessionId).then((response) => {
        applyStateSelection(response.state, routeState.setState, routeState.setSelectedProjectId, routeState.setSelectedTaskId)
      }).catch(() => undefined)
    }
    abortController.abort('user_stop')
  }

  const removeQueuedMessage = (id: string) => {
    routeState.setMessageQueue((previous) => previous.filter((message) => message.id !== id))
  }

  const editQueuedMessage = (id: string, content: string) => {
    routeState.setMessageQueue((previous) => {
      return previous.map((message) => {
        return message.id === id ? { ...message, content, editedAt: new Date().toISOString() } : message
      })
    })
  }

  const moveQueuedMessageToInput = (id: string) => {
    const message = routeState.messageQueue.find((item) => item.id === id)
    if (!message) {
      return
    }

    routeState.setChatInput(message.content)
    routeState.setMessageQueue((previous) => previous.filter((item) => item.id !== id))
  }

  const clearTaskProposal = (messageId: string) => {
    routeState.setMessages((previous) => previous.map((message) => {
      return message.id === messageId ? { ...message, taskProposal: undefined } : message
    }))
  }

  const insertSkillMention = (skill: SkillRecord) => {
    routeState.insertSkillMention(skill)
  }

  return {
    clearTaskProposal,
    editQueuedMessage,
    handleImageUpload,
    handleRemoveImage,
    handleSend,
    handleStopStreaming,
    insertSkillMention,
    moveQueuedMessageToInput,
    removeQueuedMessage,
  }
}

export type ChatRouteStreamActions = ReturnType<typeof useChatRouteStreamActions>

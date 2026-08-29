// [INPUT]: Hono app + WS upgrade，任务对话连接（task+workspace 作用域）
// [OUTPUT]: 任务对话 WS 路由（消息/排队/停止/备用通道）
// [POS]: 任务/工作区对话 WS 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono } from 'hono'
import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import { normalizeTaskChatContextRefs } from '@shared/task-chat-context'
import { buildTaskChatSessionKey, normalizeTaskChatMessageRuntimeConfig } from '@shared/task-chat-session'
import type { TaskChatWsClientMessage } from '@shared/task-chat-ws'
import type { WorkspaceSessionRuntimeStatus } from '@shared/types'
import {
  buildTaskChatSessionSnapshot,
  enqueueTaskChatMessage,
  removeTaskChatQueueEntry,
} from '../control-plane/task-chat-service'
import { deleteConversationMessagesByAnchor } from '../control-plane/conversation-service'
import { parseTokenUserId } from '../repositories/auth'
import { loadState } from '../storage/app-state-store'
import { workspaceSessionHasPersistedHistory } from '../storage/postgres/workspace-session-history-store'
import { getAuthorizedTask, jsonError } from './shared'
import {
  executeTaskChatTurn,
  getTaskChatWorkspaceIfVisible,
  applyTaskChatMessageRuntimeConfig,
  isTaskChatExecutionActive,
  isTaskChatRuntimeBusy,
  isTaskChatQueueDrainBlocked,
  markTaskChatRuntimeStopped,
  persistWorkspaceFailureTurn,
  publishTaskChatSessionUpdate,
  resolveWorkspaceChatDispatchAvailabilityAsync,
  resolveScopedRuntimeTask,
  scheduleTaskChatQueueDrain,
  stopTaskChatExecutionAcrossNodes,
  tryAcquireTaskChatExecutionLease,
} from '../services/task-chat-dispatch'
import { publishTaskChatPart } from '../services/task-chat-broadcast-service'
import {
  registerTaskChatWsConnection,
  sendTaskChatWsMessage,
  unregisterTaskChatWsConnection,
} from '../services/task-chat-ws-service'

const normalizeWsErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

export const registerTaskChatWsRoute = (app: Hono, upgradeWebSocket: any) => {
  app.get(
    '/api/tasks/:id/chat-ws',
    async (c, next) => {
      const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
      const userId = token ? parseTokenUserId(token) : null
      if (!userId) {
        return c.json({ message: '未登录' }, 401)
      }

      const state = loadState()
      const taskId = c.req.param('id')
      const workspaceId = c.req.query('workspaceId')?.trim() || undefined
      const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || undefined
      const taskResult = getAuthorizedTask(state, userId, taskId)
      if (!taskResult.task || !taskResult.project) {
        return jsonError(c, taskResult.message, taskResult.status)
      }

      if (workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)) {
        return jsonError(c, '工作区不存在或无权访问。', 404)
      }

      const initialSnapshot = buildTaskChatSessionSnapshot({
        task: taskResult.task,
        project: taskResult.project,
        workspaceId,
        workspaceSessionId,
      })

      if (initialSnapshot.queue.status === 'queued' && !isTaskChatQueueDrainBlocked(taskResult.task, workspaceId, workspaceSessionId)) {
        scheduleTaskChatQueueDrain({
          taskId,
          workspaceId,
          workspaceSessionId,
        })
      }

      ;(c as any).set('taskChatUserId', userId)
      ;(c as any).set('taskChatWorkspaceId', workspaceId)
      ;(c as any).set('taskChatWorkspaceSessionId', workspaceSessionId)
      ;(c as any).set('taskChatSessionKey', buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId))
      ;(c as any).set('taskChatInitialSnapshot', initialSnapshot)
      ;(c as any).set('taskChatLastEventId', c.req.query('lastEventId')?.trim() || undefined)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const taskId = c.req.param('id') as string
      const userId = c.get('taskChatUserId') as string
      const workspaceId = c.get('taskChatWorkspaceId') as string | undefined
      const workspaceSessionId = c.get('taskChatWorkspaceSessionId') as string | undefined
      const sessionKey = c.get('taskChatSessionKey') as string
      const initialSnapshot = c.get('taskChatInitialSnapshot')
      const lastEventId = c.get('taskChatLastEventId') as string | undefined
      let subscriberId = ''

      const sendError = (ws: any, message: string, requestId?: string) => {
        sendTaskChatWsMessage(ws, {
          type: 'task_chat.error',
          message,
          requestId,
        })
      }

      const handleSend = async (ws: any, message: Extract<TaskChatWsClientMessage, { type: 'task_chat.send' }>) => {
        const normalizedMessage = message.message.trim()
        const attachments = normalizeTaskChatAttachments(message.attachments)
        const contextRefs = normalizeTaskChatContextRefs(message.contextRefs)
        const runtimeConfig = normalizeTaskChatMessageRuntimeConfig(message.runtimeConfig)
        if (!normalizedMessage) {
          sendTaskChatWsMessage(ws, {
            type: 'task_chat.ack',
            requestId: message.requestId,
            action: 'send',
            status: 'error',
            message: '消息不能为空。',
          })
          return
        }

        const state = loadState()
        const taskResult = getAuthorizedTask(state, userId, taskId)
        if (!taskResult.task || !taskResult.project) {
          sendError(ws, taskResult.message, message.requestId)
          return
        }

        if (workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)) {
          sendError(ws, '工作区不存在或无权访问。', message.requestId)
          return
        }

        if (message.launchId) {
          const alreadyCommitted = taskResult.task.logs.some((log) => log.role === 'user' && log.launchId === message.launchId && log.content.trim() === normalizedMessage)
          if (alreadyCommitted) {
            sendTaskChatWsMessage(ws, {
              type: 'task_chat.ack',
              requestId: message.requestId,
              action: 'send',
              status: 'noop',
              message: '重复消息已忽略。',
            })
            sendTaskChatWsMessage(ws, {
              type: 'task_chat.snapshot',
              sessionKey,
              part: {
                type: 'session',
                data: buildTaskChatSessionSnapshot({
                  task: taskResult.task,
                  project: taskResult.project,
                  workspaceId,
                  workspaceSessionId,
                }),
              },
            })
            return
          }
        }

        let currentState = state
        let currentTask = taskResult.task
        let currentProject = taskResult.project
        const scopedRuntimeTask = resolveScopedRuntimeTask(currentTask, workspaceId, workspaceSessionId)
        const runtimeBusy = isTaskChatRuntimeBusy(scopedRuntimeTask.agentRunningStatus)
          || isTaskChatExecutionActive({ taskId, workspaceId, workspaceSessionId })

        if (runtimeConfig && !runtimeBusy) {
          try {
            const runtimeContext = await applyTaskChatMessageRuntimeConfig({
              userId,
              taskId,
              workspaceId,
              workspaceSessionId,
              runtimeConfig,
            })
            currentState = runtimeContext.state
            currentTask = runtimeContext.task
            currentProject = runtimeContext.project
          } catch (error) {
            if (workspaceId) {
              persistWorkspaceFailureTurn({
                task: currentTask,
                project: currentProject,
                userId,
                workspaceId,
                workspaceSessionId,
                userMessage: normalizedMessage,
                attachments,
                errorMessage: normalizeWsErrorMessage(error),
                turnId: message.turnId,
              })
            }
            sendError(ws, normalizeWsErrorMessage(error), message.requestId)
            return
          }
        }

        const dispatchAvailability = await resolveWorkspaceChatDispatchAvailabilityAsync({
          state: currentState,
          userId,
          task: currentTask,
          project: currentProject,
          workspaceId,
          workspaceSessionId,
        })
        if (!dispatchAvailability.ready && !dispatchAvailability.shouldQueue) {
          if (workspaceId) {
            persistWorkspaceFailureTurn({
              task: currentTask,
              project: currentProject,
              userId,
              workspaceId,
              workspaceSessionId,
              userMessage: normalizedMessage,
              attachments,
              errorMessage: dispatchAvailability.message || '当前工作区暂不可发送消息。',
              turnId: message.turnId,
            })
          }
          sendError(ws, dispatchAvailability.message || '当前工作区暂不可发送消息。', message.requestId)
          return
        }

        const runtimeBlocked = !dispatchAvailability.ready
          || isTaskChatQueueDrainBlocked(currentTask, workspaceId, workspaceSessionId)
        const executionLease = runtimeBlocked
          ? null
          : await tryAcquireTaskChatExecutionLease({
              taskId,
              workspaceId,
              workspaceSessionId,
            })

        if (!executionLease) {
          await enqueueTaskChatMessage({
            taskId,
            workspaceId,
            workspaceSessionId,
            message: normalizedMessage,
            attachments,
            contextRefs,
            runtimeConfig,
            createdBy: userId,
          })

          publishTaskChatPart(sessionKey, {
            type: 'session',
            data: buildTaskChatSessionSnapshot({
              task: currentTask,
              project: currentProject,
              workspaceId,
              workspaceSessionId,
            }),
          })

          sendTaskChatWsMessage(ws, {
            type: 'task_chat.ack',
            requestId: message.requestId,
            action: 'send',
            status: 'queued',
            message: dispatchAvailability.message || '消息已入队。',
          })
          scheduleTaskChatQueueDrain({
            taskId,
            workspaceId,
            workspaceSessionId,
          })
          return
        }

        sendTaskChatWsMessage(ws, {
          type: 'task_chat.ack',
          requestId: message.requestId,
          action: 'send',
          status: 'accepted',
        })

        const turnId = message.turnId?.trim() || crypto.randomUUID()

        void executeTaskChatTurn({
          state: currentState,
          userId,
          task: currentTask,
          project: currentProject,
          message: normalizedMessage,
          attachments,
          contextRefs,
          workspaceId,
          workspaceSessionId,
          launchId: message.launchId || undefined,
          turnId,
          runtimeConfig,
          executionSlotAlreadyAcquired: true,
          sessionLease: executionLease,
        }).catch((error) => {
          console.error('[task-chat-ws] send failed', JSON.stringify({
            taskId,
            workspaceId: workspaceId ?? null,
            message: normalizeWsErrorMessage(error),
          }))
          if (workspaceId) {
            persistWorkspaceFailureTurn({
              task: currentTask,
              project: currentProject,
              userId,
              workspaceId,
              workspaceSessionId,
              userMessage: normalizedMessage,
              attachments,
              errorMessage: normalizeWsErrorMessage(error),
              turnId,
            })
          }
          sendError(ws, normalizeWsErrorMessage(error), message.requestId)
        })
      }

      const handleStop = async (ws: any, message: Extract<TaskChatWsClientMessage, { type: 'task_chat.stop' }>) => {
        const stopResult = await stopTaskChatExecutionAcrossNodes({ taskId, workspaceId, workspaceSessionId })
        let accepted = stopResult.stopped
        const state = loadState()
        const taskResult = getAuthorizedTask(state, userId, taskId)
        if (taskResult.task && taskResult.project) {
          const scopedRuntimeTask = resolveScopedRuntimeTask(taskResult.task, workspaceId, workspaceSessionId)
          const runtimeStatus = 'runtimeStatus' in scopedRuntimeTask
            ? scopedRuntimeTask.runtimeStatus as WorkspaceSessionRuntimeStatus
            : undefined
          accepted = accepted || isTaskChatRuntimeBusy(scopedRuntimeTask.agentRunningStatus, runtimeStatus)
          if (accepted) {
            const stoppedRuntime = markTaskChatRuntimeStopped({
              task: taskResult.task,
              workspaceId,
              workspaceSessionId,
            })
            publishTaskChatSessionUpdate(taskId, workspaceId, workspaceSessionId, stoppedRuntime.task, taskResult.project)
          }
        }
        sendTaskChatWsMessage(ws, {
          type: 'task_chat.ack',
          requestId: message.requestId,
          action: 'stop',
          status: accepted ? 'accepted' : 'noop',
          message: accepted ? '已停止。' : '当前没有可停止的回复。',
        })
      }

      const handleQueueRemove = async (ws: any, message: Extract<TaskChatWsClientMessage, { type: 'task_chat.queue.remove' }>) => {
        const state = loadState()
        const taskResult = getAuthorizedTask(state, userId, taskId)
        if (!taskResult.task || !taskResult.project) {
          sendError(ws, taskResult.message, message.requestId)
          return
        }

        if (workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)) {
          sendError(ws, '工作区不存在或无权访问。', message.requestId)
          return
        }

        await removeTaskChatQueueEntry({
          taskId,
          workspaceId,
          workspaceSessionId,
          queueId: message.queueId,
        })

        publishTaskChatPart(sessionKey, {
          type: 'session',
          data: buildTaskChatSessionSnapshot({
            task: taskResult.task,
            project: taskResult.project,
            workspaceId,
            workspaceSessionId,
          }),
        })

        sendTaskChatWsMessage(ws, {
          type: 'task_chat.ack',
          requestId: message.requestId,
          action: 'queue.remove',
          status: 'accepted',
        })
      }

      const handleMessageDelete = async (ws: any, message: Extract<TaskChatWsClientMessage, { type: 'task_chat.message.delete' }>) => {
        const state = loadState()
        const taskResult = getAuthorizedTask(state, userId, taskId)
        if (!taskResult.task || !taskResult.project) {
          sendError(ws, taskResult.message, message.requestId)
          return
        }
        if (workspaceId && workspaceSessionId && await workspaceSessionHasPersistedHistory(workspaceSessionId)) {
          sendError(ws, '当前工作区会话已切换到新历史链路，暂不支持通过旧 conversation 接口删除消息。', message.requestId)
          return
        }

        const sessionSnapshot = buildTaskChatSessionSnapshot({
          task: taskResult.task,
          project: taskResult.project,
          workspaceId,
          workspaceSessionId,
        })
        const conversationId = sessionSnapshot.conversation.conversationId
        if (!conversationId) {
          sendError(ws, '当前会话缺少 conversationId，无法删除消息。', message.requestId)
          return
        }

        deleteConversationMessagesByAnchor(conversationId, message.messageId)

        publishTaskChatPart(sessionKey, {
          type: 'session',
          data: buildTaskChatSessionSnapshot({
            task: taskResult.task,
            project: taskResult.project,
            workspaceId,
            workspaceSessionId,
          }),
        })

        sendTaskChatWsMessage(ws, {
          type: 'task_chat.ack',
          requestId: message.requestId,
          action: 'message.delete',
          status: 'accepted',
        })
      }

      return {
        onOpen(_: Event, ws: any) {
          subscriberId = registerTaskChatWsConnection({
            sessionKey,
            socket: ws,
            lastEventId,
            initialParts: [{
              type: 'session',
              data: initialSnapshot,
            }],
          })
        },
        onMessage(event: MessageEvent<string>, ws: any) {
          let message: TaskChatWsClientMessage

          try {
            message = JSON.parse(String(event.data)) as TaskChatWsClientMessage
          } catch {
            sendError(ws, '无效的任务聊天消息。')
            return
          }

          if (message.type === 'task_chat.ping') {
            sendTaskChatWsMessage(ws, {
              type: 'task_chat.pong',
              requestId: message.requestId,
              at: new Date().toISOString(),
            })
            return
          }

          if (message.type === 'task_chat.send') {
            void handleSend(ws, message)
            return
          }

          if (message.type === 'task_chat.stop') {
            void handleStop(ws, message)
            return
          }

          if (message.type === 'task_chat.queue.remove') {
            void handleQueueRemove(ws, message)
            return
          }

          if (message.type === 'task_chat.message.delete') {
            void handleMessageDelete(ws, message)
            return
          }
        },
        onClose() {
          if (subscriberId) {
            unregisterTaskChatWsConnection(sessionKey, subscriberId)
          }
        },
      }
    }),
  )
}

import { loadState, saveTask } from '../../storage/app-state-store'
import { createTaskFromRequirement, buildAssistantReply, deriveExecutionCenter } from '@shared/task-orchestrator'
import { getProjectsWithContext, findBestProject, generateProjectContext } from '../../repositories/project-selector'
import type { AppState, Project, Task } from '@shared/types'
import {
  appendChannelConversationMessage,
  appendConversationMessage,
  appendTaskConversationMessage,
  bindTaskConversationToChannel,
} from '../../control-plane/conversation-service'
import { recordChannelMessageAudit } from '../../control-plane/governance-service'
import { getChatByEntityIdRecord, getTelegramChatRecord, getTelegramConfigRecord, getTelegramSessionRecord, saveTelegramChatRecord, saveTelegramConfigRecord, saveTelegramSessionRecord } from '../../storage/postgres/telegram-store'

type TelegramConfig = {
  botToken: string
  mainChatId: string
  webhookUrl: string
}

type TelegramSendConfig = {
  botToken: string
  chatId: string
  threadId?: string
}

type TelegramWebhookConfig = {
  botToken: string
  webhookUrl: string
  secretToken?: string
}

const TELEGRAM_META_KEY = 'telegram_config'

const readTelegramConfig = (): TelegramConfig => {
  const stored = getTelegramConfigRecord()

  return {
    botToken: String(stored.botToken ?? '').trim(),
    mainChatId: String(stored.mainChatId ?? '').trim(),
    webhookUrl: String(stored.webhookUrl ?? '').trim(),
  }
}

export const getTelegramConfig = () => readTelegramConfig()

export const saveTelegramConfig = (config: Partial<TelegramConfig>) => {
  return saveTelegramConfigRecord(config)
}

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string; title?: string }
    message_thread_id?: number
    text?: string
    from?: { id: number; first_name?: string; username?: string }
  }
  callback_query?: {
    id: string
    message?: {
      chat: { id: number }
      message_id: number
      text?: string
    }
    data?: string
  }
}

type TelegramChat = {
  chat_id: string
  thread_id: string | null
  type: 'group' | 'main' | 'task'
  entity_id: string | null
}

const isEnabled = () => Boolean(readTelegramConfig().botToken)

const buildTelegramExternalRef = (params: {
  chatId: number
  threadId?: number
  messageId?: number
  direction: 'inbound' | 'outbound'
}) => ({
  channelType: 'telegram',
  externalChatId: String(params.chatId),
  externalThreadId: params.threadId ? String(params.threadId) : undefined,
  externalMessageId: params.messageId ? String(params.messageId) : undefined,
  direction: params.direction,
})

const appendTelegramTaskThreadMessage = (params: {
  task: Task
  project?: Project
  chatId: number
  threadId: number
  role: 'user' | 'assistant' | 'system'
  senderId?: string
  content: string
  messageId?: number
  direction: 'inbound' | 'outbound'
}) => {
  const { conversation, binding } = bindTaskConversationToChannel({
    task: params.task,
    project: params.project,
    channelType: 'telegram',
    externalChatId: String(params.chatId),
    externalThreadId: String(params.threadId),
  })
  const message = appendConversationMessage({
    conversationId: conversation.id,
    role: params.role,
    senderId: params.senderId,
    content: params.content,
    externalRef: buildTelegramExternalRef({
      chatId: params.chatId,
      threadId: params.threadId,
      messageId: params.messageId,
      direction: params.direction,
    }),
  })

  recordChannelMessageAudit({
    projectId: params.project?.id,
    taskId: params.task.id,
    conversationId: conversation.id,
    channelBindingId: binding.id,
    direction: params.direction,
    channelType: 'telegram',
    senderId: params.senderId,
    externalChatId: String(params.chatId),
    externalThreadId: String(params.threadId),
    externalMessageId: params.messageId ? String(params.messageId) : undefined,
  })

  return { conversation, binding, message }
}

const api = async (method: string, params: Record<string, unknown>) => {
  const { botToken } = readTelegramConfig()
  if (!botToken) {
    throw new Error('Telegram bot not configured')
  }

  return apiWithBotToken(botToken, method, params)
}

const apiWithBotToken = async (botToken: string, method: string, params: Record<string, unknown>) => {
  if (!botToken.trim()) {
    throw new Error('Telegram bot not configured')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  return response.json()
}

const normalizeTelegramNumericId = (value?: string) => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

export const sendMessage = async (chatId: number, text: string, threadId?: number, replyToMessageId?: number) => {
  return api('sendMessage', {
    chat_id: chatId,
    text,
    message_thread_id: threadId,
    reply_to_message_id: replyToMessageId,
    parse_mode: 'Markdown',
  })
}

export const sendTelegramMessageWithConfig = async (config: TelegramSendConfig, text: string) => {
  const chatId = normalizeTelegramNumericId(config.chatId)
  if (!chatId) {
    return { ok: false as const, message: 'Telegram Chat ID 未配置' }
  }

  try {
    const result = await apiWithBotToken(config.botToken.trim(), 'sendMessage', {
      chat_id: chatId,
      text,
      ...(normalizeTelegramNumericId(config.threadId) ? { message_thread_id: normalizeTelegramNumericId(config.threadId) } : {}),
    })

    if (result?.ok === false) {
      return { ok: false as const, message: String(result.description || 'Telegram 消息发送失败') }
    }

    return { ok: true as const, result }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Telegram 消息发送失败',
    }
  }
}

export const editMessageText = async (chatId: number, messageId: number, text: string) => {
  return api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
  })
}

export const createForumTopic = async (chatId: number, name: string) => {
  return api('createForumTopic', {
    chat_id: chatId,
    name,
  })
}

export const closeForumTopic = async (chatId: number, topicId: number) => {
  return api('closeForumTopic', {
    chat_id: chatId,
    message_thread_id: topicId,
  })
}

export const getChat = async (chatId: number) => {
  return api('getChat', { chat_id: chatId })
}

/** 查询 bot 自身信息（获取 username 用于生成深链 t.me/<username>?start=...）。 */
export const getMe = async (botToken: string): Promise<{ ok: boolean; username?: string; message?: string }> => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken.trim()}/getMe`)
    if (!response.ok) {
      return { ok: false, message: `Telegram getMe HTTP ${response.status}` }
    }
    const payload = await response.json() as { ok: boolean; result?: { username?: string }; description?: string }
    if (!payload.ok) {
      return { ok: false, message: payload.description || 'Telegram getMe 失败。' }
    }
    return { ok: true, username: payload.result?.username }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Telegram getMe 失败。' }
  }
}

export const saveTelegramChat = (chat: TelegramChat) => {
  saveTelegramChatRecord(chat)
}

export const getTelegramChat = (chatId: string, threadId?: string): TelegramChat | null => {
  return getTelegramChatRecord(chatId, threadId) as TelegramChat | null
}

export const getChatByEntityId = (entityId: string): TelegramChat | null => {
  return getChatByEntityIdRecord(entityId) as TelegramChat | null
}

export const saveTelegramSession = (id: string, chatId: string, threadId: string | null, userId: string | null, state: Record<string, unknown> = {}) => {
  saveTelegramSessionRecord(id, chatId, threadId, userId, state)
}

export const getTelegramSession = (id: string): Record<string, unknown> | null => {
  return getTelegramSessionRecord(id)
}

const processMainChat = async (chatId: number, text: string, userId?: number): Promise<string> => {
  const state = loadState()
  const projects = getProjectsWithContext()
  const projectContext = generateProjectContext(projects)

  const msg = text.toLowerCase()

  if (msg === '/start' || msg === '/help') {
    return `🤖 *wemux Bot*

我可以帮你管理项目和任务：

*常用命令：*
/start - 显示帮助
/projects - 查看项目列表
/tasks - 查看任务列表
/status - 查看进度

*对话模式：*
直接发送消息给我，我会：
- 分析需求并自动创建任务
- 自动选择合适的项目
- 列出所有可用项目供你选择

例如：「为 uniSocial 添加用户登录功能」

项目列表：
${projectContext}`
  }

  if (msg === '/projects' || msg.includes('项目列表')) {
    return `📁 *项目列表*\n\n${projectContext}`
  }

  if (msg === '/tasks' || msg.includes('任务列表')) {
    const allTasks = state.tasks.slice(0, 20)
    const taskSummary = allTasks
      .map((t, i) => {
        const p = state.projects.find((p) => p.id === t.projectId)
        return `${i + 1}. \`${t.title}\` - ${t.status} [${p?.name || '未知项目'}]`
      })
      .join('\n')

    return `📋 *任务列表*\n\n${taskSummary || '暂无任务'}`
  }

  if (msg === '/status' || msg.includes('进度')) {
    const inProgress = state.tasks.filter((t) => t.status === 'in_progress').length
    const todo = state.tasks.filter((t) => t.status === 'todo').length
    const inReview = state.tasks.filter((t) => t.status === 'in_review').length
    const done = state.tasks.filter((t) => t.status === 'done').length

    return `📊 *当前进度*\n\n• 进行中: ${inProgress} 个\n• 待处理: ${todo} 个\n• 待审核: ${inReview} 个\n• 已完成: ${done} 个`
  }

  const taskKeywords = ['开发', '实现', '添加', '创建', '修复', '改', '优化', '重构', '功能', '需求', 'build', 'add', 'create', 'fix', 'implement']
  const isTaskRequest = taskKeywords.some((k) => msg.includes(k))

  if (isTaskRequest || msg.length > 10) {
    let project = state.projects[0]

    if (state.projects.length > 1) {
      const bestMatch = findBestProject(text, projects)
      if (bestMatch) {
        project = state.projects.find((p) => p.id === bestMatch.id) || project
      }
    }

    const task = createTaskFromRequirement(project, text, 'medium', undefined, 'none', undefined, undefined, undefined, state.config)
    saveTask(task)

    const sessionId = `tg_${task.id.slice(0, 8)}`
    const userIdStr = userId ? String(userId) : null
    saveTelegramSession(sessionId, String(chatId), null, userIdStr, { taskId: task.id })

    const threadResult = await createForumTopic(chatId, `📋 ${task.title.slice(0, 30)}`)
    let threadId: number | undefined

    if (threadResult.ok && threadResult.result?.message_thread_id) {
      threadId = threadResult.result.message_thread_id
      saveTelegramChat({
        chat_id: String(chatId),
        thread_id: String(threadId),
        type: 'task',
        entity_id: task.id,
      })
      bindTaskConversationToChannel({
        task,
        project,
        channelType: 'telegram',
        externalChatId: String(chatId),
        externalThreadId: String(threadId),
      })
    }

    appendTaskConversationMessage({
      task,
      project,
      role: 'system',
      content: `任务由 Telegram 消息创建：${text}`,
      externalRef: buildTelegramExternalRef({
        chatId,
        threadId,
        messageId: undefined,
        direction: 'inbound',
      }),
    })

    const nextState: AppState = {
      ...state,
      tasks: [task, ...state.tasks],
      selectedTaskId: task.id,
      selectedProjectId: project.id,
      executionCenter: deriveExecutionCenter([task, ...state.tasks], state.executionCenter),
    }

    const response = `✅ *任务已创建！*\n\n*项目：* ${project.name}\n*任务：* ${task.title}\n*状态：* ${task.status}\n\n${buildAssistantReply(task).content}`

    if (threadId) {
      await sendMessage(chatId, `📋 已为任务创建独立对话 Topic`, threadId)
    }

    return response
  }

  return `我理解了你的消息：${text}\n\n可以告诉我：\n- 项目名称和需求\n- 查看项目列表 (/projects)\n- 查看任务列表 (/tasks)\n- 查看进度 (/status)`
}

const processTaskChat = async (taskId: string, chatId: number, threadId: number, text: string): Promise<string> => {
  const state = loadState()
  const task = state.tasks.find((t) => t.id === taskId)

  if (!task) {
    return '❌ 任务不存在或已被删除'
  }

  const msg = text.toLowerCase()

  if (msg === '/status' || msg === '/info') {
    const project = state.projects.find((p) => p.id === task.projectId)
    return `📋 *任务状态*\n\n*标题：* ${task.title}\n*项目：* ${project?.name || '未知'}\n*状态：* ${task.status}\n*进度：* ${task.currentStep || '待开始'}\n\n${task.description.slice(0, 200)}`
  }

  if (msg === '/advance' || msg.includes('推进')) {
    return `🚀 任务推进功能即将上线，请通过 Web 界面操作任务。`
  }

  return `收到任务对话：${text}\n\n任务「${task.title}」当前状态：${task.status}\n\n请通过 Web 界面管理与推进任务。`
}

export const processTelegramUpdate = async (update: TelegramUpdate): Promise<void> => {
  if (!isEnabled()) {
    console.log('[Telegram] Bot not configured, skipping update')
    return
  }

  console.log('[Telegram] Processing update', update.update_id)

  const message = update.message
  if (!message?.text) return

  const chatId = message.chat.id
  const threadId = message.message_thread_id
  const text = message.text
  const userId = message.from?.id
  const externalMessageId = message.message_id

  console.log('[Telegram] Message:', { chatId, threadId, text: text.slice(0, 50) })

  if (message.chat.type === 'private') {
    const { conversation } = appendChannelConversationMessage({
      channelType: 'telegram',
      externalChatId: String(chatId),
      role: 'user',
      senderId: userId ? String(userId) : undefined,
      content: text,
      externalRef: buildTelegramExternalRef({
        chatId,
        messageId: externalMessageId,
        direction: 'inbound',
      }),
    })
    recordChannelMessageAudit({
      conversationId: conversation.id,
      direction: 'inbound',
      channelType: 'telegram',
      senderId: userId ? String(userId) : undefined,
      externalChatId: String(chatId),
      externalMessageId: String(externalMessageId),
    })
    const response = await processMainChat(chatId, text, userId)
    const result = await sendMessage(chatId, response)
    appendChannelConversationMessage({
      channelType: 'telegram',
      externalChatId: String(chatId),
      role: 'system',
      content: response,
      externalRef: buildTelegramExternalRef({
        chatId,
        messageId: result?.result?.message_id,
        direction: 'outbound',
      }),
    })
    recordChannelMessageAudit({
      conversationId: conversation.id,
      direction: 'outbound',
      channelType: 'telegram',
      externalChatId: String(chatId),
      externalMessageId: result?.result?.message_id ? String(result.result.message_id) : undefined,
    })
    return
  }

  if (!threadId) {
    const { conversation } = appendChannelConversationMessage({
      channelType: 'telegram',
      externalChatId: String(chatId),
      role: 'user',
      senderId: userId ? String(userId) : undefined,
      content: text,
      externalRef: buildTelegramExternalRef({
        chatId,
        messageId: externalMessageId,
        direction: 'inbound',
      }),
    })
    recordChannelMessageAudit({
      conversationId: conversation.id,
      direction: 'inbound',
      channelType: 'telegram',
      senderId: userId ? String(userId) : undefined,
      externalChatId: String(chatId),
      externalMessageId: String(externalMessageId),
    })
    const response = await processMainChat(chatId, text, userId)
    const result = await sendMessage(chatId, response)
    appendChannelConversationMessage({
      channelType: 'telegram',
      externalChatId: String(chatId),
      role: 'system',
      content: response,
      externalRef: buildTelegramExternalRef({
        chatId,
        messageId: result?.result?.message_id,
        direction: 'outbound',
      }),
    })
    recordChannelMessageAudit({
      conversationId: conversation.id,
      direction: 'outbound',
      channelType: 'telegram',
      externalChatId: String(chatId),
      externalMessageId: result?.result?.message_id ? String(result.result.message_id) : undefined,
    })
    return
  }

  const taskChat = getTelegramChat(String(chatId), String(threadId))
  if (taskChat?.type === 'task' && taskChat.entity_id) {
    const state = loadState()
    const task = state.tasks.find((item) => item.id === taskChat.entity_id)
    const project = task ? state.projects.find((item) => item.id === task.projectId) : undefined
    if (task) {
      appendTelegramTaskThreadMessage({
        task,
        project,
        chatId,
        threadId,
        role: 'user',
        senderId: userId ? String(userId) : undefined,
        content: text,
        messageId: externalMessageId,
        direction: 'inbound',
      })
    }
    const response = await processTaskChat(taskChat.entity_id, chatId, threadId, text)
    const result = await sendMessage(chatId, response, threadId)
    if (task) {
      appendTelegramTaskThreadMessage({
        task,
        project,
        chatId,
        threadId,
        role: 'system',
        content: response,
        messageId: result?.result?.message_id,
        direction: 'outbound',
      })
    }
    return
  }

  const state = loadState()
  const tasks = state.tasks.slice(0, 50)
  const stateMsg = text.toLowerCase()
  
  const matchedTask = tasks.find(t => 
    t.title.toLowerCase().includes(stateMsg) || 
    stateMsg.includes(t.id.slice(0, 8))
  )

  if (matchedTask) {
    saveTelegramChat({
      chat_id: String(chatId),
      thread_id: String(threadId),
      type: 'task',
      entity_id: matchedTask.id,
    })
    const project = state.projects.find((item) => item.id === matchedTask.projectId)
    appendTelegramTaskThreadMessage({
      task: matchedTask,
      project,
      chatId,
      threadId,
      role: 'user',
      senderId: userId ? String(userId) : undefined,
      content: text,
      messageId: externalMessageId,
      direction: 'inbound',
    })
    const response = await processTaskChat(matchedTask.id, chatId, threadId, text)
    const result = await sendMessage(chatId, response, threadId)
    appendTelegramTaskThreadMessage({
      task: matchedTask,
      project,
      chatId,
      threadId,
      role: 'system',
      content: response,
      messageId: result?.result?.message_id,
      direction: 'outbound',
    })
    return
  }

  const { conversation } = appendChannelConversationMessage({
    channelType: 'telegram',
    externalChatId: String(chatId),
    externalThreadId: String(threadId),
    role: 'user',
    senderId: userId ? String(userId) : undefined,
    content: text,
    externalRef: buildTelegramExternalRef({
      chatId,
      threadId,
      messageId: externalMessageId,
      direction: 'inbound',
    }),
  })
  recordChannelMessageAudit({
    conversationId: conversation.id,
    direction: 'inbound',
    channelType: 'telegram',
    senderId: userId ? String(userId) : undefined,
    externalChatId: String(chatId),
    externalThreadId: String(threadId),
    externalMessageId: String(externalMessageId),
  })
  const response = await processMainChat(chatId, text, userId)
  const result = await sendMessage(chatId, response, threadId)
  appendChannelConversationMessage({
    channelType: 'telegram',
    externalChatId: String(chatId),
    externalThreadId: String(threadId),
    role: 'system',
    content: response,
    externalRef: buildTelegramExternalRef({
      chatId,
      threadId,
      messageId: result?.result?.message_id,
      direction: 'outbound',
    }),
  })
  recordChannelMessageAudit({
    conversationId: conversation.id,
    direction: 'outbound',
    channelType: 'telegram',
    externalChatId: String(chatId),
    externalThreadId: String(threadId),
    externalMessageId: result?.result?.message_id ? String(result.result.message_id) : undefined,
  })
}

export const notifyTaskUpdate = async (task: Task, message: string): Promise<void> => {
  if (!isEnabled()) return

  const taskChat = getChatByEntityId(task.id)
  if (!taskChat) return

  const state = loadState()
  const project = state.projects.find((item) => item.id === task.projectId)
  const chatId = parseInt(taskChat.chat_id)
  const threadId = taskChat.thread_id ? parseInt(taskChat.thread_id) : undefined

  const result = await sendMessage(chatId, `📋 *任务更新*\n\n${message}`, threadId)
  if (threadId && project) {
    appendTelegramTaskThreadMessage({
      task,
      project,
      chatId,
      threadId,
      role: 'system',
      content: `📋 *任务更新*\n\n${message}`,
      messageId: result?.result?.message_id,
      direction: 'outbound',
    })
  }
}

export const setupWebhook = async (webhookUrl: string) => {
  const config = saveTelegramConfig({ webhookUrl })
  if (!config.botToken) {
    console.log('[Telegram] Bot token not configured')
    return
  }

  try {
    const result = await api('setWebhook', { url: webhookUrl })
    console.log('[Telegram] Webhook setup:', result)
  } catch (error) {
    console.error('[Telegram] Webhook setup failed:', error)
  }
}

export const setupTelegramWebhookWithConfig = async (config: TelegramWebhookConfig) => {
  const botToken = config.botToken.trim()
  const webhookUrl = config.webhookUrl.trim()
  const secretToken = config.secretToken?.trim()
  if (!botToken) {
    return { ok: false as const, message: 'Telegram Bot Token 未配置' }
  }

  if (!webhookUrl) {
    return { ok: false as const, message: 'Telegram Webhook URL 未配置' }
  }

  try {
    const result = await apiWithBotToken(botToken, 'setWebhook', {
      url: webhookUrl,
      ...(secretToken ? { secret_token: secretToken } : {}),
    })

    if (result?.ok === false) {
      return {
        ok: false as const,
        message: String(result.description || 'Telegram webhook 注册失败'),
      }
    }

    return { ok: true as const, result }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Telegram webhook 注册失败',
    }
  }
}

export const getTelegramWebhookInfoWithConfig = async (botToken: string) => {
  const token = botToken.trim()
  if (!token) {
    return { ok: false as const, message: 'Telegram Bot Token 未配置' }
  }

  try {
    const result = await apiWithBotToken(token, 'getWebhookInfo', {})
    if (result?.ok === false) {
      return {
        ok: false as const,
        message: String(result.description || 'Telegram webhook 状态读取失败'),
      }
    }

    const info = result?.result as {
      url?: string
      has_custom_certificate?: boolean
      pending_update_count?: number
      last_error_date?: number
      last_error_message?: string
      max_connections?: number
      allowed_updates?: string[]
    } | undefined

    return {
      ok: true as const,
      info: {
        url: String(info?.url || ''),
        hasCustomCertificate: Boolean(info?.has_custom_certificate),
        pendingUpdateCount: Number(info?.pending_update_count || 0),
        lastErrorDate: typeof info?.last_error_date === 'number' ? info.last_error_date : undefined,
        lastErrorMessage: String(info?.last_error_message || ''),
        maxConnections: typeof info?.max_connections === 'number' ? info.max_connections : undefined,
        allowedUpdates: Array.isArray(info?.allowed_updates) ? info.allowed_updates : [],
      },
    }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Telegram webhook 状态读取失败',
    }
  }
}

export const deleteTelegramWebhookWithConfig = async (botToken: string) => {
  const token = botToken.trim()
  if (!token) {
    return { ok: false as const, message: 'Telegram Bot Token 未配置' }
  }

  try {
    const result = await apiWithBotToken(token, 'deleteWebhook', { drop_pending_updates: false })
    if (result?.ok === false) {
      return {
        ok: false as const,
        message: String(result.description || 'Telegram webhook 删除失败'),
      }
    }

    return { ok: true as const, result }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'Telegram webhook 删除失败',
    }
  }
}

export const isTelegramEnabled = isEnabled

// [INPUT]: Main-chat runtime events and the Feishu card patch transport.
// [OUTPUT]: Compact Feishu reply cards and a throttled, ordered updater.
// [POS]: Feishu presentation lifecycle; inbound orchestration owns when it starts and finishes.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import type { MainChatResponseEvent } from '../../routes/project-main-chat'

export type FeishuReplyCardStatus = 'thinking' | 'running' | 'complete' | 'error'

type FeishuReplyCardState = {
  status: FeishuReplyCardStatus
  content?: string
  currentStep?: string
  timeline?: FeishuReplyTimelineItem[]
}

type FeishuReplyTimelineItem = {
  id: string
  operation: FeishuOperationKind
  name: string
  detail?: string
  result?: string
  status: 'running' | 'complete' | 'error'
}

type FeishuOperationKind = 'reasoning' | 'mcp' | 'skill' | 'search' | 'read' | 'edit' | 'run' | 'ask' | 'browse' | 'tool'

const operationMeta: Record<FeishuOperationKind, { icon: string; label: string }> = {
  reasoning: { icon: '💭', label: '思考' },
  mcp: { icon: '🔌', label: 'MCP' },
  skill: { icon: '✨', label: 'Skill' },
  search: { icon: '🔎', label: '搜索' },
  read: { icon: '📖', label: '读取' },
  edit: { icon: '✏️', label: '编辑' },
  run: { icon: '⚙️', label: '执行' },
  ask: { icon: '❓', label: '确认' },
  browse: { icon: '🌐', label: '浏览' },
  tool: { icon: '🔧', label: '工具' },
}

const MAX_CARD_CONTENT_LENGTH = 18_000
const MAX_TIMELINE_ITEMS = 24
const MAX_REASONING_LENGTH = 800

const resolveToolOperation = (name: string): FeishuOperationKind => {
  const normalized = name.toLowerCase()
  if (normalized.includes('skill')) return 'skill'
  if (normalized.includes('mcp') || normalized.includes('__')) return 'mcp'
  if (normalized.includes('question') || normalized.includes('ask')) return 'ask'
  if (normalized.includes('grep') || normalized.includes('search') || normalized.includes('find') || normalized.includes('glob')) return 'search'
  if (normalized.includes('read') || normalized.includes('open') || normalized.includes('cat') || normalized.includes('head') || normalized.includes('tail')) return 'read'
  if (normalized.includes('edit') || normalized.includes('write') || normalized.includes('patch')) return 'edit'
  if (normalized.includes('exec') || normalized.includes('bash') || normalized.includes('shell') || normalized.includes('terminal') || normalized.includes('command')) return 'run'
  if (normalized.includes('browser') || normalized.includes('fetch') || normalized.includes('click') || normalized.includes('url') || normalized.includes('web')) return 'browse'
  return 'tool'
}

const trimTimelineText = (value: string, limit = MAX_REASONING_LENGTH) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

const trimCardContent = (content: string) => {
  if (content.length <= MAX_CARD_CONTENT_LENGTH) return content
  return `${content.slice(0, MAX_CARD_CONTENT_LENGTH)}\n\n_内容过长，已截断显示。_`
}

export const buildFeishuReplyCard = (state: FeishuReplyCardState): Record<string, unknown> => {
  const meta = state.status === 'complete'
    ? { title: '已完成', template: 'green' }
    : state.status === 'error'
      ? { title: '处理失败', template: 'red' }
      : state.status === 'running'
        ? { title: '正在工作', template: 'blue' }
        : { title: '正在思考', template: 'blue' }
  const content = trimCardContent(state.content?.trim() || '')
  const currentStep = state.currentStep?.trim() || (state.status === 'thinking' ? '正在分析你的问题…' : '')
  const elements: Record<string, unknown>[] = []
  const timeline = state.timeline ?? []

  if (timeline.length > 0) {
    const visibleTimeline = timeline.slice(-MAX_TIMELINE_ITEMS)
    const timelineContent = [
      timeline.length > visibleTimeline.length ? `… 已省略前 ${timeline.length - visibleTimeline.length} 个步骤` : '',
      ...visibleTimeline.flatMap((item, index) => {
        const marker = item.status === 'complete' ? '✅' : item.status === 'error' ? '❌' : '⏳'
        const status = item.status === 'complete' ? '完成' : item.status === 'error' ? '失败' : '进行中'
        const operation = operationMeta[item.operation]
        return [
          `${marker} ${operation.icon} ${operation.label}${item.operation === 'reasoning' ? '' : ` · ${item.name}`} · ${status}`,
          item.detail ? `   ↳ ${item.operation === 'reasoning' ? '' : '输入：'}${item.detail}` : '',
          item.result ? `   ↳ ${item.status === 'error' ? '错误' : '结果'}：${item.result}` : '',
          index < visibleTimeline.length - 1 ? '   │' : '',
        ]
      }),
    ].filter(Boolean).join('\n')
    elements.push({ tag: 'div', text: { tag: 'plain_text', content: timelineContent } })
  }

  if (content) {
    if (elements.length > 0) elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content } })
  }
  if (currentStep && state.status !== 'complete') {
    if (elements.length > 0) elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'plain_text', content: currentStep } })
  }
  if (elements.length === 0) {
    elements.push({ tag: 'div', text: { tag: 'plain_text', content: meta.title } })
  }

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: meta.template,
      title: { tag: 'plain_text', content: `wemux · ${meta.title}` },
    },
    elements,
  }
}

export const createFeishuReplyCardUpdater = (params: {
  patch: (card: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>
  onError?: (message: string) => void
  intervalMs?: number
}) => {
  const intervalMs = params.intervalMs ?? 1_000
  let state: FeishuReplyCardState = { status: 'thinking', currentStep: '正在分析你的问题…' }
  let lastQueuedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve(true)
  let closed = false

  const updateTimelineItem = (item: FeishuReplyTimelineItem) => {
    const timeline = [...(state.timeline ?? [])]
    const existingIndex = timeline.findIndex((entry) => entry.id === item.id)
    if (existingIndex >= 0) timeline[existingIndex] = item
    else timeline.push(item)
    return timeline
  }

  const settleReasoning = (timeline: FeishuReplyTimelineItem[] | undefined) => timeline?.map((item) => (
    item.operation === 'reasoning' && item.status === 'running' ? { ...item, status: 'complete' as const } : item
  ))

  const enqueue = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    lastQueuedAt = Date.now()
    const card = buildFeishuReplyCard(state)
    queue = queue.then(async () => {
      const result = await params.patch(card)
      if (!result.ok) params.onError?.(result.message || '飞书卡片更新失败')
      return result.ok
    }).catch((error) => {
      params.onError?.(error instanceof Error ? error.message : '飞书卡片更新失败')
      return false
    })
  }

  const schedule = () => {
    if (closed || timer) return
    const delay = Math.max(0, intervalMs - (Date.now() - lastQueuedAt))
    if (delay === 0) {
      enqueue()
      return
    }
    timer = setTimeout(enqueue, delay)
  }

  return {
    onEvent(event: MainChatResponseEvent) {
      if (closed) return
      if (event.type === 'delta') {
        state = {
          ...state,
          status: 'running',
          content: `${state.content || ''}${event.content}`,
          timeline: settleReasoning(state.timeline),
        }
      } else if (event.type === 'reasoning') {
        const timeline = updateTimelineItem({
          id: `reasoning:${event.partId}`,
          operation: 'reasoning',
          name: '思考',
          detail: trimTimelineText(event.content),
          status: 'running',
        })
        state = { ...state, status: 'thinking', currentStep: undefined, timeline }
      } else if (event.type === 'status') {
        if (event.currentStep.startsWith('Agent 系统正在调用工具：')) return
        state = {
          ...state,
          status: event.status === 'executing' ? 'running' : event.status,
          currentStep: event.currentStep,
        }
      } else {
        const item: FeishuReplyTimelineItem = {
          id: event.toolCall.id,
          operation: resolveToolOperation(event.toolCall.name),
          name: event.toolCall.name,
          detail: event.toolCall.args?.trim() || undefined,
          result: event.toolCall.result?.trim() || undefined,
          status: event.status === 'completed' ? 'complete' : event.status === 'error' ? 'error' : 'running',
        }
        const timeline = updateTimelineItem(item).map((entry) => (
          entry.operation === 'reasoning' && entry.status === 'running'
            ? { ...entry, status: 'complete' as const }
            : entry
        ))
        state = { ...state, status: 'running', currentStep: undefined, timeline }
      }
      schedule()
    },
    async finish(status: 'complete' | 'error', content: string) {
      closed = true
      if (timer) clearTimeout(timer)
      timer = undefined
      state = {
        status,
        content,
        currentStep: status === 'error' ? '请稍后重试，或检查 Agent 与执行节点配置。' : undefined,
        timeline: state.timeline?.map((item) => item.status === 'running'
          ? { ...item, status: status === 'complete' ? 'complete' as const : 'error' as const }
          : item),
      }
      enqueue()
      return await queue
    },
  }
}

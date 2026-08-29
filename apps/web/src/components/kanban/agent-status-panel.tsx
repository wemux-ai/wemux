/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Canonical AgentRunningStatus plus orchestration and tool-call records.
 * [OUTPUT]: Kanban-local Agent execution visibility using shared lifecycle icon semantics.
 * [POS]: Task-detail status panel; it does not own task status or runtime brand identity.
 */
import { Terminal } from 'lucide-react'
import { getToolCallPersistenceDisplay } from '@shared/tool-call-persistence'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import type { AgentRunningStatus, ToolCall, OrchestrationStep, ValidationCheck } from '@shared/types'
import { AgentActivityIndicator } from '../agent-activity-indicator'

const statusConfig: Record<AgentRunningStatus, { label: string; color: string; bg: string }> = {
  idle: { label: '空闲', color: 'text-zinc-400', bg: 'bg-zinc-900' },
  thinking: { label: '思考中', color: 'text-sky-300', bg: 'bg-sky-500/10' },
  executing: { label: '执行中', color: 'text-sky-300', bg: 'bg-sky-500/10' },
  waiting: { label: '等待中', color: 'text-amber-300', bg: 'bg-amber-500/10' },
  complete: { label: '已完成', color: 'text-emerald-300', bg: 'bg-emerald-500/10' },
  error: { label: '出错', color: 'text-rose-300', bg: 'bg-rose-500/10' },
}

export function StepRow({ step }: { step: OrchestrationStep }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted p-2">
      <div>
        <p className="font-medium text-sm">{step.title}</p>
        <p className="text-xs text-muted-foreground">{step.detail}</p>
      </div>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium',
          step.status === 'done' && 'bg-emerald-100 text-emerald-700',
          step.status === 'running' && 'bg-amber-100 text-amber-700',
          step.status === 'pending' && 'bg-muted text-muted-foreground'
        )}
      >
        {step.status === 'done' ? '完成' : step.status === 'running' ? '进行中' : '未开始'}
      </span>
    </div>
  )
}

export function ValidationRow({ check }: { check: ValidationCheck }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted p-2">
      <span className="text-sm">{check.label}</span>
      <Badge variant={check.passed ? 'default' : 'secondary'} className={check.passed ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}>
        {check.passed ? '通过' : '待验证'}
      </Badge>
    </div>
  )
}

function ToolCallItem({ tool }: { tool: ToolCall }) {
  const display = getToolCallPersistenceDisplay(tool)
  const isRunning = !tool.finishedAt

  return (
    <div
      className={cn(
        'rounded-lg border p-3 text-xs',
        isRunning ? 'border-blue-300 bg-blue-50' : 'border-border bg-background'
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <Terminal size={12} className="text-muted-foreground" />
        <span className="font-medium">{tool.name}</span>
        {isRunning && (
          <span className="ml-auto inline-flex items-center gap-1 text-sky-300">
            <AgentActivityIndicator status="executing" variant="dot" size="xs" />
            运行中...
          </span>
        )}
        {tool.finishedAt && !display.result?.includes('error') && (
          <span className="ml-auto text-emerald-600">完成</span>
        )}
        {tool.finishedAt && display.result?.includes('error') && (
          <span className="ml-auto text-rose-600">失败</span>
        )}
      </div>
      <div className="text-muted-foreground font-mono text-[10px] truncate">{display.args}</div>
      {display.result && (
        <div className="mt-2 pt-2 border-t border-border text-muted-foreground font-mono text-[10px] max-h-20 overflow-auto">
          {display.result}
        </div>
      )}
    </div>
  )
}

interface AgentStatusPanelProps {
  status: AgentRunningStatus
  currentStep: string
  toolCalls: ToolCall[]
}

export function AgentStatusPanel({ status, currentStep, toolCalls }: AgentStatusPanelProps) {
  const config = statusConfig[status]

  if (status === 'idle') return null

  return (
    <Card>
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal size={16} />
            Agent 状态
          </CardTitle>
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium', config.bg, config.color)}>
            <AgentActivityIndicator status={status} size="xs" />
            {config.label}
          </div>
        </div>
        {currentStep && (
          <p className="text-xs text-muted-foreground mt-1">
            当前步骤：<span className="font-medium">{currentStep}</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2 max-h-48 overflow-auto p-3">
        {toolCalls.length === 0 ? (
          <div className="text-center py-4 text-xs text-muted-foreground/60">
            {status === 'thinking' ? 'AI 正在思考...' : '暂无工具调用'}
          </div>
        ) : (
          toolCalls.map((tool) => <ToolCallItem key={tool.id} tool={tool} />)
        )}
      </CardContent>
    </Card>
  )
}

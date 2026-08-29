import { useState } from 'react'
import { ArrowRight, Check, Loader2, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../../lib/api'
import { useApp } from '../../lib/app-provider'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import type { TaskProposal } from '@shared/types'

interface TaskProposalCardProps {
  proposal: TaskProposal
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
  projectName?: string
}

export const TaskProposalCard = ({ proposal, onConfirm, onCancel, loading, projectName }: TaskProposalCardProps) => {
  const navigate = useNavigate()
  const { runMutation } = useApp()
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      const response = await runMutation(() => api.confirmTask(proposal))
      if (response?.state) {
        onConfirm()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleJumpToKanban = () => {
    navigate({ to: '/kanban', search: { projectId: proposal.projectId, taskId: '', createTask: undefined } })
  }

  const difficultyColors = {
    easy: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    hard: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  return (
    <div className="mt-4 rounded-lg border border-orange-400/30 bg-[linear-gradient(180deg,rgba(39,39,42,0.98),rgba(24,24,27,0.98))] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-orange-200/80">新任务</p>
            {projectName && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                {projectName}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-base font-medium text-zinc-100">{proposal.title || '新任务'}</h3>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">{proposal.description}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', difficultyColors[proposal.difficulty])}>
              {proposal.difficulty === 'easy' ? '简单' : proposal.difficulty === 'medium' ? '中等' : '困难'}
            </span>
            {proposal.agentManaged === 'ai' && (
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                AI 自主
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={loading || submitting}
          className="gap-1 rounded-full border border-green-300/20 bg-green-50 px-4 text-zinc-950 hover:bg-green-100"
        >
          {loading || submitting ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          确认创建
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={loading || submitting}
          className="gap-1 rounded-full border-zinc-700 bg-transparent px-4 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="size-3" />
          取消
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleJumpToKanban}
          className="gap-1 rounded-full px-3 text-zinc-400 hover:text-zinc-200"
        >
          查看看板
          <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  )
}

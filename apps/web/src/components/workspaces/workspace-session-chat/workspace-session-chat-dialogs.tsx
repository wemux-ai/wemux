import type { ChangeEvent } from 'react'
import type { WorkspaceSessionRole } from '@shared/types'
import { Button } from '../../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog'
import { SearchableSelect } from '../../ui/searchable-select'
import { Textarea } from '../../ui/textarea'
import { Badge } from '../../ui/badge'
import type { AgentRecord } from '../../../lib/api'

interface DelegateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  delegateAgentId: string
  delegateOptions: Array<{
    value: string
    label: string
    description?: string
    keywords?: string[]
  }>
  delegateUnavailableOptions: Array<{
    agent: AgentRecord
    blockerMessage: string
  }>
  selectedDelegateSummary?: {
    presetLabel: string
    roleLabel: string
    presetDescription: string
    highlights: string[]
    sessionModeLabel: string
    baseBranchLabel: string
    workingDirectoryLabel: string
  } | null
  delegatePrompt: string
  delegatePromptHint: string
  delegatePromptPlaceholder: string
  delegateSessionRole: WorkspaceSessionRole
  sessionRoleOptions: Array<{
    value: string
    label: string
    description: string
  }>
  onSelectAgent: (value: string) => void
  onChangePrompt: (value: string) => void
  onSelectSessionRole: (value: WorkspaceSessionRole) => void
  onConfirm: () => Promise<void>
  onReset: () => void
}

interface ForkDialogProps {
  open: boolean
  sourcePreview: string
  sourceLabel: string
  saving: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: (mode: 'local' | 'worktree') => Promise<void>
}

interface RevisionDialogProps {
  open: boolean
  title: string
  description: string
  message: string
  saving: boolean
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onChangeMessage: (value: string) => void
  onConfirm: (mode: 'local' | 'worktree') => Promise<void>
}

export function TaskChatDelegateDialog({
  open,
  onOpenChange,
  delegateAgentId,
  delegateOptions,
  delegateUnavailableOptions,
  selectedDelegateSummary,
  delegatePrompt,
  delegatePromptHint,
  delegatePromptPlaceholder,
  delegateSessionRole,
  sessionRoleOptions,
  onSelectAgent,
  onChangePrompt,
  onSelectSessionRole,
  onConfirm,
  onReset,
}: DelegateDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) {
          onReset()
        }
      }}
    >
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle>委派给自定义 Agent</DialogTitle>
          <DialogDescription className="text-zinc-500">
            这里会在当前工作区下创建一个独立子会话，不污染主会话上下文；完成后结果会自动回抛到父会话。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">选择 Agent</p>
            <SearchableSelect
              value={delegateAgentId}
              options={delegateOptions}
              placeholder="请选择 Agent"
              searchPlaceholder="搜索 Agent"
              emptyText="当前工作区没有可委派 Agent"
              onChange={onSelectAgent}
            />
            {delegateUnavailableOptions.length > 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-400">
                <p className="font-medium text-zinc-200">以下 Agent 当前没有出现在委派列表里</p>
                <div className="mt-2 space-y-2">
                  {delegateUnavailableOptions.map(({ agent, blockerMessage }) => (
                    <div key={`${agent.id}:delegate-blocked`} className="rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-zinc-200">{agent.name}</span>
                        <span className="text-[10px] text-amber-300">不可委派</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                        {blockerMessage || '当前范围不可用。'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedDelegateSummary ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-400">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-zinc-800 bg-zinc-950 text-zinc-300">
                    {selectedDelegateSummary.presetLabel}
                  </Badge>
                  <span>{selectedDelegateSummary.roleLabel}</span>
                </div>
                <p className="mt-2 leading-5 text-zinc-500">{selectedDelegateSummary.presetDescription}</p>
                <div className="mt-2 space-y-1 text-[11px] leading-5 text-zinc-500">
                  {selectedDelegateSummary.highlights.slice(0, 3).map((item) => (
                    <p key={item}>- {item}</p>
                  ))}
                  <p>- 会话策略：{selectedDelegateSummary.sessionModeLabel}</p>
                  <p>- 基线分支：{selectedDelegateSummary.baseBranchLabel}</p>
                  <p>- 工作目录：{selectedDelegateSummary.workingDirectoryLabel}</p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">委派说明</p>
            <p className="text-xs text-zinc-500">{delegatePromptHint}</p>
            <Textarea
              value={delegatePrompt}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChangePrompt(event.target.value)}
              rows={6}
              placeholder={delegatePromptPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">子会话角色</p>
            <SearchableSelect
              value={delegateSessionRole}
              options={sessionRoleOptions}
              placeholder="请选择子会话角色"
              searchPlaceholder="搜索子会话角色"
              emptyText="没有可选角色"
              onChange={(value) => onSelectSessionRole(value as WorkspaceSessionRole)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onReset}
            className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
          >
            取消
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={!delegateAgentId}
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            确认委派
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskChatForkDialog({
  open,
  sourcePreview,
  sourceLabel,
  saving,
  onOpenChange,
  onCancel,
  onConfirm,
}: ForkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle>从较早消息创建分支？</DialogTitle>
          <DialogDescription className="text-zinc-500">
            这会保留你当前的文件和工作树状态不变。如果后续轮次改动了文件系统，新分支内容可能与当前磁盘上的内容不一致。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-400">
            <p className="font-medium text-zinc-200">{sourceLabel}</p>
            <p className="mt-2 whitespace-pre-wrap break-words leading-5 text-zinc-500">{sourcePreview}</p>
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onConfirm('local')}
              className="rounded-2xl border border-zinc-700 bg-zinc-800/60 px-4 py-4 text-left transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium text-zinc-100">派生到本地</p>
              <p className="mt-1 text-sm text-zinc-500">在新的本地聊天中从此消息继续，继续复用当前 worktree。</p>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onConfirm('worktree')}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium text-zinc-100">派生到新工作树</p>
              <p className="mt-1 text-sm text-zinc-500">在新的 worktree 中从此消息继续，和当前会话彻底隔离。</p>
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={saving}
            className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
          >
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskChatRevisionDialog({
  open,
  title,
  description,
  message,
  saving,
  confirmLabel,
  onOpenChange,
  onCancel,
  onChangeMessage,
  onConfirm,
}: RevisionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-zinc-500">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">新的输入</p>
            <Textarea
              value={message}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChangeMessage(event.target.value)}
              rows={6}
              placeholder="请输入新的提示词"
            />
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              disabled={saving || !message.trim()}
              onClick={() => void onConfirm('local')}
              className="rounded-2xl border border-zinc-700 bg-zinc-800/60 px-4 py-4 text-left transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium text-zinc-100">{confirmLabel}到本地</p>
              <p className="mt-1 text-sm text-zinc-500">创建一个新的本地分支会话，并继续复用当前 worktree。</p>
            </button>
            <button
              type="button"
              disabled={saving || !message.trim()}
              onClick={() => void onConfirm('worktree')}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="font-medium text-zinc-100">{confirmLabel}到新工作树</p>
              <p className="mt-1 text-sm text-zinc-500">创建一个隔离的新 worktree，会话和文件改动都与当前分开。</p>
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={saving}
            className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
          >
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

export type DeleteWorkspaceOptions = {
  deleteLocalBranch: boolean
  deleteRemoteBranch: boolean
}

type DeleteWorkspaceDialogProps = {
  open: boolean
  workspaceName: string
  branchName?: string
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: DeleteWorkspaceOptions) => Promise<void> | void
  title: string
  description: string
  localBranchLabel: string
  localBranchHint: string
  remoteBranchLabel: string
  remoteBranchHint: string
  cancelText: string
  confirmText: string
}

const DEFAULT_OPTIONS: DeleteWorkspaceOptions = {
  deleteLocalBranch: false,
  deleteRemoteBranch: false,
}

export function DeleteWorkspaceDialog({
  open,
  workspaceName,
  branchName,
  busy = false,
  onOpenChange,
  onConfirm,
  title,
  description,
  localBranchLabel,
  localBranchHint,
  remoteBranchLabel,
  remoteBranchHint,
  cancelText,
  confirmText,
}: DeleteWorkspaceDialogProps) {
  const [options, setOptions] = useState<DeleteWorkspaceOptions>(DEFAULT_OPTIONS)
  const normalizedBranchName = branchName?.trim() || ''
  const localBranchDisplayLabel = normalizedBranchName
    ? `${localBranchLabel} (${normalizedBranchName})`
    : localBranchLabel
  const remoteBranchDisplayLabel = normalizedBranchName
    ? `${remoteBranchLabel} (${normalizedBranchName})`
    : remoteBranchLabel

  useEffect(() => {
    if (!open) {
      setOptions(DEFAULT_OPTIONS)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title.replace('{{name}}', workspaceName)}</DialogTitle>
          <DialogDescription className="text-zinc-500">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <Checkbox
              checked={options.deleteLocalBranch}
              disabled={options.deleteRemoteBranch}
              onCheckedChange={(checked) => {
                setOptions((current) => ({
                  ...current,
                  deleteLocalBranch: checked === true,
                }))
              }}
            />
            <span className="space-y-1">
              <span className="block text-sm text-zinc-200">{localBranchDisplayLabel}</span>
              <span className="block text-xs leading-5 text-zinc-500">{localBranchHint}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <Checkbox
              checked={options.deleteRemoteBranch}
              onCheckedChange={(checked) => {
                const nextChecked = checked === true
                setOptions((current) => ({
                  deleteLocalBranch: nextChecked ? true : current.deleteLocalBranch,
                  deleteRemoteBranch: nextChecked,
                }))
              }}
            />
            <span className="space-y-1">
              <span className="block text-sm text-zinc-200">{remoteBranchDisplayLabel}</span>
              <span className="block text-xs leading-5 text-zinc-500">{remoteBranchHint}</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm(options)}
            disabled={busy}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

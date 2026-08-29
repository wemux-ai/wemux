import { Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'

type WorkspaceSessionRenameDialogProps = {
  busy: boolean
  draft: string
  open: boolean
  t: (key: string, options?: Record<string, unknown>) => string
  onDraftChange: (draft: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}

export function WorkspaceSessionRenameDialog({
  busy,
  draft,
  open,
  t,
  onDraftChange,
  onOpenChange,
  onSubmit,
}: WorkspaceSessionRenameDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) {
          onDraftChange('')
        }
      }}
    >
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('workspace.shell.renameSessionTitle')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
        <Input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (isImeComposingKeyboardEvent(event)) {
              return
            }

            if (event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
          }}
          maxLength={80}
          autoFocus
          className="h-10 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100"
        />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!draft.trim() || busy}
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

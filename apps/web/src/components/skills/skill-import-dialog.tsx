import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { SkillActionPanel, type SkillsAction } from './skill-action-panel'

export function SkillImportDialog({
  activeAction,
  busy,
  createBusy,
  createDescription,
  createName,
  downloadBusy,
  downloadUrl,
  gitBusy,
  gitRef,
  gitSubdirectory,
  gitUrl,
  loading,
  open,
  scanBusy,
  onActionChange,
  onClose,
  onCreate,
  onCreateDescriptionChange,
  onCreateNameChange,
  onDownload,
  onDownloadUrlChange,
  onGit,
  onGitRefChange,
  onGitSubdirectoryChange,
  onGitUrlChange,
  onRefresh,
  onScan,
  onOpenChange,
}: {
  activeAction: SkillsAction
  busy: boolean
  createBusy: boolean
  createDescription: string
  createName: string
  downloadBusy: boolean
  downloadUrl: string
  gitBusy: boolean
  gitRef: string
  gitSubdirectory: string
  gitUrl: string
  loading: boolean
  open: boolean
  scanBusy: boolean
  onActionChange: (value: SkillsAction) => void
  onClose: () => void
  onCreate: () => void
  onCreateDescriptionChange: (value: string) => void
  onCreateNameChange: (value: string) => void
  onDownload: () => void
  onDownloadUrlChange: (value: string) => void
  onGit: () => void
  onGitRefChange: (value: string) => void
  onGitSubdirectoryChange: (value: string) => void
  onGitUrlChange: (value: string) => void
  onRefresh: () => void
  onScan: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>引入 Skill</DialogTitle>
          <DialogDescription className="text-zinc-500">
            引入完成后会自动进入全局默认技能集合，任意项目中新建对话的 AI 都能读到它。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
        <SkillActionPanel
          activeAction={activeAction}
          busy={busy}
          createBusy={createBusy}
          createDescription={createDescription}
          createName={createName}
          loading={loading}
          downloadBusy={downloadBusy}
          downloadUrl={downloadUrl}
          gitBusy={gitBusy}
          gitRef={gitRef}
          gitSubdirectory={gitSubdirectory}
          gitUrl={gitUrl}
          scanBusy={scanBusy}
          onActionChange={onActionChange}
          onCreate={onCreate}
          onCreateDescriptionChange={onCreateDescriptionChange}
          onCreateNameChange={onCreateNameChange}
          onDownload={onDownload}
          onDownloadUrlChange={onDownloadUrlChange}
          onGit={onGit}
          onGitRefChange={onGitRefChange}
          onGitSubdirectoryChange={onGitSubdirectoryChange}
          onGitUrlChange={onGitUrlChange}
          onRefresh={onRefresh}
          onScan={onScan}
        />

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
          >
            关闭
          </button>
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

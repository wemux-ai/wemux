import { Check, Copy, Link as LinkIcon, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import { resolveAppUrl } from '../../lib/runtime-config'
import type { Language } from '../../lib/i18n'
import type { ChatRouteShareActions } from './use-chat-route-share-actions'
import { text } from './chat-route-helpers'

type SessionShareDialogProps = {
  language: Language
  shareActions: ChatRouteShareActions
}

export function SessionShareDialog({ language, shareActions }: SessionShareDialogProps) {
  const {
    shareDialogOpen,
    setShareDialogOpen,
    shareVisibility,
    shareRecords,
    shareLinkToken,
    shareLoading,
    shareBusy,
    handleToggleVisibility,
    handleCreateShareLink,
    handleRevokeShare,
  } = shareActions

  const [copiedKey, setCopiedKey] = useState('')

  const copyToClipboard = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1500)
    } catch {
      // Ignore clipboard failures; the user can still select and copy manually.
    }
  }

  const linkShareUrl = shareLinkToken ? resolveAppUrl(`/embed/session/${shareLinkToken}`) : ''
  const embedCode = linkShareUrl
    ? `<iframe src="${linkShareUrl}" style="width:100%;height:600px;border:0;" loading="lazy"></iframe>`
    : ''

  const directShares = shareRecords.filter((share) => share.targetType !== 'link' && !share.revokedAt)

  return (
    <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
      <DialogContent className="max-w-lg border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle>{text(language, '分享会话', 'Share Session')}</DialogTitle>
        </DialogHeader>

        <DialogBody>
        {shareLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" />
            {text(language, '加载中…', 'Loading…')}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
              <div>
                <p className="text-sm text-zinc-100">{text(language, '公开会话', 'Public session')}</p>
                <p className="text-xs text-zinc-500">
                  {text(language, '组织成员可直接查看，无需单独分享。', 'Organization members can view without an individual share.')}
                </p>
              </div>
              <Switch
                checked={shareVisibility === 'public'}
                disabled={shareBusy}
                onCheckedChange={(checked) => void handleToggleVisibility(checked ? 'public' : 'private')}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '嵌入链接', 'Embed link')}</p>
              {linkShareUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    <LinkIcon className="size-4 shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{linkShareUrl}</span>
                    <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => void copyToClipboard('link', linkShareUrl)}>
                      {copiedKey === 'link' ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{embedCode}</span>
                    <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => void copyToClipboard('embed', embedCode)}>
                      {copiedKey === 'embed' ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-rose-300 hover:text-rose-200"
                    disabled={shareBusy}
                    onClick={() => {
                      const linkShare = shareRecords.find((share) => share.targetType === 'link' && !share.revokedAt)
                      if (linkShare) {
                        void handleRevokeShare(linkShare.id)
                      }
                    }}
                  >
                    {text(language, '撤销链接', 'Revoke link')}
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="secondary" size="sm" disabled={shareBusy} onClick={() => void handleCreateShareLink('read')}>
                  {shareBusy ? <Loader2 className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
                  {text(language, '生成嵌入链接', 'Generate embed link')}
                </Button>
              )}
              <p className="text-xs text-zinc-600">
                {text(language, '嵌入的内容会随会话实时更新，而不是静态快照。', 'Embedded content stays live and updates with the session, not a static snapshot.')}
              </p>
            </div>

            {directShares.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{text(language, '已分享给', 'Shared with')}</p>
                <div className="space-y-1.5">
                  {directShares.map((share) => (
                    <div key={share.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300">
                      <span className="truncate">{share.targetType === 'agent' ? text(language, 'Agent', 'Agent') : text(language, '成员', 'Member')} · {share.targetId}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6 text-zinc-500 hover:text-rose-300"
                        disabled={shareBusy}
                        onClick={() => void handleRevokeShare(share.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

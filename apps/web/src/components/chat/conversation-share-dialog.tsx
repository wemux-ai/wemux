// [INPUT]: 会话 ID 与分享操作
// [OUTPUT]: 会话分享弹窗（生成链接 / 复制 / 历史列表 / 关闭）
// [POS]: 会话分享 UI；服务端鉴权会话成员，匿名访问走 token
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Link2, Loader2, Share2, Trash2 } from 'lucide-react'
import type { ConversationShareRecord } from '@shared/types'
import { api } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'

export function ConversationShareDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [shares, setShares] = useState<ConversationShareRecord[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!open || !conversationId) return
    setLoading(true)
    try {
      const res = await api.listConversationShares(conversationId)
      setShares(res.shares)
    } catch {
      setShares([])
    } finally {
      setLoading(false)
    }
  }, [open, conversationId])

  useEffect(() => { void reload() }, [reload])

  const createShare = async () => {
    try {
      await api.createConversationShare(conversationId)
      toast.success('分享链接已生成。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成失败。')
    }
  }

  const closeShare = async (shareId: string) => {
    try {
      await api.deleteConversationShare(conversationId, shareId)
      toast.success('已关闭分享。')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '关闭失败。')
    }
  }

  const copyLink = async (token: string | null) => {
    if (!token) return
    await navigator.clipboard.writeText(`${window.location.origin}/shared/${token}`).catch(() => {})
    toast.success('已复制分享链接。')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-4" />
            分享会话
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6 text-zinc-500"><Loader2 className="size-4 animate-spin" /></div>
          ) : shares.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">
              暂无分享。生成链接后，任何人持链接可只读查看该会话。
            </p>
          ) : (
            shares.map((share) => (
              <div key={share.id} className="flex items-center gap-2 rounded border border-zinc-800 px-2.5 py-2">
                <Link2 className="size-3.5 shrink-0 text-zinc-500" />
                <button
                  className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300 hover:text-zinc-100"
                  title={`${window.location.origin}/shared/${share.shareToken}`}
                  onClick={() => share.shareToken && void copyLink(share.shareToken)}
                >
                  /shared/{share.shareToken?.slice(0, 12)}…
                </button>
                {share.shareToken ? (
                  <Button variant="ghost" size="icon" className="size-6 text-zinc-500 hover:text-zinc-200" onClick={() => void copyLink(share.shareToken as string)}>
                    <Copy className="size-3.5" />
                  </Button>
                ) : null}
                <Button variant="ghost" size="icon" className="size-6 text-zinc-500 hover:text-red-400" onClick={() => void closeShare(share.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void createShare()}>
            <Link2 className="mr-1.5 size-3.5" />
            生成分享链接
          </Button>
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

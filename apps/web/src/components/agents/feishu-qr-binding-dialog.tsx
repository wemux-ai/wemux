// [INPUT]: A saved Agent id and the Feishu QR-binding API.
// [OUTPUT]: A bounded scan-and-poll dialog that reports the saved channel config.
// [POS]: Agent-page UI for the server-owned Feishu device authorization flow.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, ScanLine } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api, type FeishuBindingSession } from '../../lib/api'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

type BoundConfig = { appId: string; appSecret: string }

export function FeishuQrBindingDialog({ agentId, agentName, open, onOpenChange, onBound }: {
  agentId: string
  agentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onBound: (feishu: BoundConfig) => void
}) {
  const [session, setSession] = useState<FeishuBindingSession | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSession(null)
    setError('')
    void api.beginAgentFeishuBinding(agentId)
      .then((next) => { if (!cancelled) setSession(next) })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '二维码生成失败。')
      })
    return () => { cancelled = true }
  }, [agentId, open])

  useEffect(() => {
    if (!session || session.status !== 'pending') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await api.getAgentFeishuBinding(agentId, session.sessionId)
        if (cancelled) return
        setSession(next)
        if (next.status === 'success') {
          onOpenChange(false)
          void api.getAgentChannel(agentId)
            .then((channel) => onBound({ appId: channel.channels.feishu.appId, appSecret: channel.channels.feishu.appSecret }))
            .catch((reason: unknown) => console.error('Failed to refresh the Feishu binding:', reason))
        } else if (next.status === 'pending') {
          timer = setTimeout(poll, 2000)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '绑定状态读取失败。')
      }
    }
    timer = setTimeout(poll, 2000)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [agentId, onBound, onOpenChange, session?.sessionId, session?.status])

  const failure = error || (session?.status === 'error' ? session.message || '飞书绑定失败。' : '')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[30rem] overflow-hidden border-zinc-800 bg-[#0c0c0f] p-0 text-zinc-100 shadow-2xl shadow-black/60">
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200">
              <ScanLine className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">绑定到飞书</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5 text-zinc-500">为「{agentName}」创建专属 Bot，扫码授权后会自动连接。</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 px-5 py-5">
          <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 text-[11px] text-zinc-500">
            <span className="flex size-5 items-center justify-center rounded-full bg-zinc-100 font-medium text-zinc-950">1</span>
            <span className="h-px bg-zinc-800" />
            <span className="flex size-5 items-center justify-center rounded-full border border-zinc-700 text-zinc-400">2</span>
            <span className="h-px bg-zinc-800" />
            <span className="flex size-5 items-center justify-center rounded-full border border-zinc-700 text-zinc-400">3</span>
          </div>
          <div className="grid grid-cols-3 text-center text-[11px] text-zinc-500"><span>扫码</span><span>授权</span><span>完成连接</span></div>

          <div className="flex min-h-56 flex-col items-center justify-center gap-4" aria-live="polite">
          {failure ? (
              <div className="max-w-sm rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-center text-sm leading-6 text-rose-200">{failure}</div>
          ) : session?.qrCodeUrl ? (
            <>
                <div className="rounded-xl border border-zinc-700 bg-white p-3 shadow-[0_12px_28px_rgba(0,0,0,0.28)]">
                  <QRCodeSVG value={session.qrCodeUrl} size={196} />
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-300">
                  <Loader2 className="size-3.5 animate-spin text-zinc-500" />
                  等待飞书确认授权
                </div>
                <a className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-200" href={session.qrCodeUrl} target="_blank" rel="noreferrer">
                  无法扫码？在飞书中打开 <ExternalLink className="size-3" />
                </a>
            </>
          ) : (
              <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="size-4 animate-spin" />正在生成安全二维码…</div>
          )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/50 px-5 py-3">
          <p className="text-xs text-zinc-600">无需填写 App ID、Secret 或回调地址</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50">取消</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

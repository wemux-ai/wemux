// [INPUT]: A saved Agent id and the WeChat iLink QR-binding API.
// [OUTPUT]: A bounded scan-and-poll dialog that reports the saved channel config.
// [POS]: Agent-page UI for the server-owned WeChat iLink device authorization flow.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, ScanLine, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api, type WechatBindingSession } from '../../lib/api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

type BoundWechat = { enabled: boolean; botToken: string }

const TERMINAL_STATUSES = new Set(['success', 'error', 'expired', 'verify_code_blocked'])

export function WechatQrBindingDialog({ agentId, agentName, open, onOpenChange, onBound }: {
  agentId: string
  agentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onBound: (wechat: BoundWechat) => void
}) {
  const [session, setSession] = useState<WechatBindingSession | null>(null)
  const [error, setError] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [submittingCode, setSubmittingCode] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSession(null)
    setError('')
    setVerifyCode('')
    void api.beginAgentWechatBinding(agentId)
      .then((next) => { if (!cancelled) setSession(next) })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '二维码生成失败。')
      })
    return () => { cancelled = true }
  }, [agentId, open])

  useEffect(() => {
    if (!session || TERMINAL_STATUSES.has(session.status) || session.status === 'need_verifycode') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await api.getAgentWechatBinding(agentId, session.sessionId)
        if (cancelled) return
        setSession(next)
        if (next.status === 'success') {
          onOpenChange(false)
          void api.getAgentChannel(agentId)
            .then((channel) => onBound({
              enabled: channel.channels.wechat.enabled,
              botToken: channel.channels.wechat.botToken,
            }))
            .catch((reason: unknown) => console.error('Failed to refresh the WeChat binding:', reason))
        } else if (!TERMINAL_STATUSES.has(next.status) && next.status !== 'need_verifycode') {
          timer = setTimeout(poll, 2000)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '绑定状态读取失败。')
      }
    }
    timer = setTimeout(poll, 2000)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [agentId, onBound, onOpenChange, session?.sessionId, session?.status])

  const submitCode = async () => {
    if (!session || !verifyCode.trim()) return
    setSubmittingCode(true)
    try {
      const result = await api.submitAgentWechatVerifyCode(agentId, session.sessionId, verifyCode.trim())
      if (!result.ok) {
        setError(result.message || '验证码提交失败。')
        return
      }
      setVerifyCode('')
      setSession((current) => (current ? { ...current, status: 'scaned', requiresVerifyCode: false } : current))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '验证码提交失败。')
    } finally {
      setSubmittingCode(false)
    }
  }

  const failure = error || (session && TERMINAL_STATUSES.has(session.status) ? session.message || '微信绑定失败。' : '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[30rem] overflow-hidden border-zinc-800 bg-[#0c0c0f] p-0 text-zinc-100 shadow-2xl shadow-black/60">
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200">
              <ScanLine className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">绑定到微信</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-5 text-zinc-500">用手机微信扫描二维码，确认后「{agentName}」即可在微信中与你对话。</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            使用腾讯官方微信 iLink（智联）通道，扫码即绑定，无需创建应用或填写密钥
          </div>

          <div className="flex min-h-56 flex-col items-center justify-center gap-4" aria-live="polite">
            {failure ? (
              <div className="max-w-sm rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-center text-sm leading-6 text-rose-200">{failure}</div>
            ) : session?.requiresVerifyCode || session?.status === 'need_verifycode' ? (
              <div className="w-full max-w-sm space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4">
                <p className="text-center text-sm text-zinc-200">请在手机微信上确认授权，并输入屏幕上显示的数字</p>
                <div className="flex gap-2">
                  <Input
                    value={verifyCode}
                    onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="数字验证码"
                    inputMode="numeric"
                    className="border-zinc-700 bg-zinc-950 text-center text-base tracking-[0.4em] text-zinc-100"
                  />
                  <Button type="button" size="sm" disabled={submittingCode || !verifyCode.trim()} onClick={submitCode} className="h-9 shrink-0">
                    {submittingCode ? <Loader2 className="size-3.5 animate-spin" /> : '确认'}
                  </Button>
                </div>
              </div>
            ) : session?.qrCodeUrl ? (
              <>
                <div className="rounded-xl border border-zinc-700 bg-white p-3 shadow-[0_12px_28px_rgba(0,0,0,0.28)]">
                  <QRCodeSVG value={session.qrCodeUrl} size={196} />
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-300">
                  <Loader2 className="size-3.5 animate-spin text-zinc-500" />
                  {session.status === 'scaned' ? '已扫码，等待确认' : '等待微信扫码确认'}
                </div>
                <a className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-200" href={session.qrCodeUrl} target="_blank" rel="noreferrer">
                  无法扫码？在浏览器中打开 <ExternalLink className="size-3" />
                </a>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="size-4 animate-spin" />正在生成安全二维码…</div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/50 px-5 py-3">
          <p className="text-xs text-zinc-600">仅支持私聊；无需公网地址，服务端长轮询接收消息</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50">取消</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

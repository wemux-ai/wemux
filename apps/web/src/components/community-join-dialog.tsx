import { ExternalLink, MessageCircle, QrCode } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { useCommunityChannels } from '../lib/community-channels'

const text = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const isSafeExternalUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const isSafeImageUrl = (value: string) => value.startsWith('/') || isSafeExternalUrl(value)

type CommunityJoinDialogProps = {
  language: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommunityJoinDialog({ language, open, onOpenChange }: CommunityJoinDialogProps) {
  const { discordUrl, wechatQrUrl } = useCommunityChannels()
  const hasDiscordLink = isSafeExternalUrl(discordUrl)
  const hasWechatQr = isSafeImageUrl(wechatQrUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <MessageCircle className="h-4 w-4 text-zinc-400" />
            {text(language, '加入 Wemux 社群', 'Join the Wemux community')}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-zinc-500">
            {text(language, '交流使用经验、获取产品动态，也可以直接反馈问题。', 'Exchange ideas, get product updates, and share feedback directly.')}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-zinc-900">
          <section className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-zinc-100">Discord</h3>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {text(language, '英文社区：跨时区交流、公告与产品反馈。', 'English-speaking community: cross-timezone discussion, announcements, and feedback.')}
                </p>
              </div>
              {hasDiscordLink ? (
                <Button asChild className="h-8 shrink-0 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200">
                  <a href={discordUrl} target="_blank" rel="noreferrer">
                    {text(language, '打开 Discord', 'Open Discord')}
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : null}
            </div>
            {!hasDiscordLink ? (
              <p className="mt-3 text-[11px] text-zinc-600">
                {text(language, 'Discord 社群链接配置后会在这里显示。', 'The Discord community link will appear here once configured.')}
              </p>
            ) : null}
          </section>

          <section className="px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
                <QrCode className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-zinc-100">{text(language, '微信群', 'WeChat group')}</h3>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {text(language, '中文社区：使用微信扫描群二维码加入。', 'Chinese-speaking community: scan the group QR code with WeChat to join.')}
                </p>
              </div>
            </div>
            {hasWechatQr ? (
              <div className="mt-4 flex justify-center border-t border-zinc-900 pt-4">
                <img
                  src={wechatQrUrl}
                  alt={text(language, 'Wemux 微信群二维码', 'Wemux WeChat group QR code')}
                  className="h-44 w-44 rounded-md border border-zinc-800 bg-white object-contain p-1"
                />
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-zinc-600">
                {text(language, '微信群二维码配置后会在这里显示。', 'The WeChat group QR code will appear here once configured.')}
              </p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CommunityLinkList({
  className,
  language,
}: {
  className: string
  language: string
}) {
  const [open, setOpen] = useState(false)
  const { discordUrl } = useCommunityChannels()
  const hasDiscordLink = isSafeExternalUrl(discordUrl)

  return (
    <>
      {hasDiscordLink ? (
        <a className={className} href={discordUrl} target="_blank" rel="noreferrer">
          Discord
        </a>
      ) : null}
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {text(language, '微信群', 'WeChat group')}
      </button>
      <CommunityJoinDialog language={language} open={open} onOpenChange={setOpen} />
    </>
  )
}

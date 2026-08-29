// [INPUT]: FeedbackForm 表单（提交 + 我的反馈）+ 客服会话 + 与创始人长聊天线程
// [OUTPUT]: 帮助/反馈中心浮窗：第一窗口「与创始人沟通」长对话；Tab2「反馈与建议」= 逐条反馈列表 + 详情
// [POS]: 用户侧问号（?）入口弹窗；聊天为每用户单一长上下文线程，反馈为独立一条条
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useState } from 'react'
import { MessageSquareText, Bug } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { FeedbackConversation } from './feedback-conversation'
import { FeedbackForm } from './feedback-form'

type FeedbackDialogTab = 'chat' | 'feedback'

/** 与创始人的长聊天线程：单一线程，历史全在，不新建/不分条。 */
function ChatThread() {
  const [activeId, setActiveId] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const thread = await api.getChatThread()
        if (!cancelled) {
          setActiveId(thread.feedback?.id ?? undefined)
        }
      } catch {
        // 静默：无会话时进入新建模式
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-[32rem] min-h-0 flex-col">
      <FeedbackConversation
        feedbackId={activeId}
        onCreated={(item) => setActiveId(item.id)}
      />
    </div>
  )
}

/** 反馈与建议：逐条反馈（bug/feature）列表 + 详情会话。 */
function FeedbackTabContent() {
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'detail'; id: string }>({ kind: 'list' })

  if (view.kind === 'detail') {
    return (
      <div className="flex h-[32rem] min-h-0 flex-col">
        <FeedbackConversation
          feedbackId={view.id}
          onBack={() => setView({ kind: 'list' })}
        />
      </div>
    )
  }

  return (
    <FeedbackForm
      onCreated={(item) => setView({ kind: 'detail', id: item.id })}
      onOpen={(item) => setView({ kind: 'detail', id: item.id })}
    />
  )
}

export function FeedbackDialog({
  open,
  onOpenChange,
  initialTab = 'chat',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开时默认落在哪个 Tab：chat=与创始人沟通（默认第一窗口），feedback=反馈与建议。 */
  initialTab?: FeedbackDialogTab
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<FeedbackDialogTab>(initialTab)

  // 每次打开都回到指定入口窗口
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-w-3xl border-zinc-800 bg-[#09090b] p-0 sm:rounded-xl"
      >
        <div className="border-b border-zinc-900 px-6 pb-2.5 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950">
              <MessageSquareText className="size-4 text-zinc-200" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold tracking-tight text-zinc-100">
                {t('feedback.dialogTitle')}
              </DialogTitle>
              <p className="mt-0.5 text-[11px] text-zinc-500">{t('feedback.dialogSubtitle')}</p>
            </div>
          </div>
          <div className="mt-2 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            <button
              type="button"
              onClick={() => setTab('chat')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                tab === 'chat' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <MessageSquareText className="size-3.5" />
              {t('feedback.tabs.chat')}
            </button>
            <button
              type="button"
              onClick={() => setTab('feedback')}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                tab === 'feedback' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Bug className="size-3.5" />
              {t('feedback.tabs.feedback')}
            </button>
          </div>
        </div>
        <div className="flex max-h-[75vh] min-h-[30rem] flex-col overflow-hidden px-6 py-5">
          {tab === 'chat' ? <ChatThread /> : <div className="overflow-y-auto"><FeedbackTabContent /></div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

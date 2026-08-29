// [INPUT]: /feedback URL search（open=<feedbackId>）+ FeedbackForm 回调
// [OUTPUT]: 用户反馈页（双栏：新建/我的反馈 + 「与创始人直接沟通」会话视图）
// [POS]: Route boundary for the user-facing feedback page
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useState } from 'react'
import { useTranslation } from '@/lib/i18n/react'
import type { FeedbackItem } from '@shared/types'
import { FeedbackConversation } from './feedback-conversation'
import { FeedbackForm } from './feedback-form'

export function FeedbackPage({ initialOpenId }: { initialOpenId?: string }) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | undefined>(initialOpenId)

  const handleCreated = (item: FeedbackItem) => {
    setSelectedId(item.id)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{t('feedback.dialogTitle')}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t('feedback.founderSubtitle')}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <FeedbackForm onCreated={handleCreated} onOpen={(item) => setSelectedId(item.id)} />
        </div>
        <div className="min-h-[28rem] overflow-hidden rounded-lg border border-zinc-800 bg-[#09090b]">
          {selectedId ? (
            <FeedbackConversation feedbackId={selectedId} onFeedbackUpdated={() => undefined} />
          ) : (
            <div className="flex h-full min-h-[28rem] flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-zinc-300">{t('feedback.selectHint')}</p>
              <p className="max-w-xs text-xs leading-5 text-zinc-600">{t('feedback.selectHintDesc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

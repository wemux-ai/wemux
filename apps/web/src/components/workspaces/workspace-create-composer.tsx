import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { TaskChatComposer } from './workspace-session-chat/workspace-session-chat-layout'
import type { ChatImage } from './workspace-session-chat/workspace-session-chat-types'

interface WorkspaceCreateComposerProps {
  busy: boolean
  footerControls: ReactNode
  input: string
  isUploading?: boolean
  onInputChange: (value: string) => void
  onPasteImages?: (files: File[]) => void
  onRemoveImage?: (id: string) => void
  onSubmit: () => Promise<void> | void
  onUploadImages?: (files: File[]) => void
  sendDisabled: boolean
  images?: ChatImage[]
  imagesLocked?: boolean
  placeholder?: string
  showUpload?: boolean
  className?: string
}

const noopImages = () => undefined

export function WorkspaceCreateComposer({
  busy,
  footerControls,
  input,
  isUploading = false,
  onInputChange,
  onPasteImages = noopImages,
  onRemoveImage,
  onSubmit,
  onUploadImages = noopImages,
  sendDisabled,
  images = [],
  imagesLocked = false,
  placeholder,
  showUpload = true,
  className,
}: WorkspaceCreateComposerProps) {
  return (
    <TaskChatComposer
      floating={false}
      input={input}
      placeholder={placeholder}
      onInputChange={(value) => onInputChange(value)}
      onCaretChange={() => undefined}
      onNavigateHistory={() => undefined}
      onSend={async () => { await onSubmit() }}
      onStop={async () => undefined}
      onPasteImages={onPasteImages}
      onUploadImages={onUploadImages}
      isUploading={isUploading}
      isSendingMessage={busy}
      busy={busy}
      sendDisabled={sendDisabled}
      isSessionBusy={false}
      queuedMessages={[]}
      onEditQueuedMessage={() => undefined}
      onRemoveQueuedMessage={async () => undefined}
      messageQueue={[]}
      onRemoveQueuedDraft={() => undefined}
      onEditQueuedDraft={() => undefined}
      onMoveQueuedDraftToInput={() => undefined}
      mentionedAgents={[]}
      mentionQueryActive={false}
      mentionAvailableOptions={[]}
      mentionUnavailableOptions={[]}
      onInsertAgentMention={() => undefined}
      selectedContextItems={[]}
      onRemoveSelectedContextItem={() => undefined}
      images={images}
      imagesLocked={imagesLocked}
      onRemoveImage={onRemoveImage ?? (() => undefined)}
      actionPlacement="inside"
      composerClassName={cn(
        'px-4 py-3 text-sm leading-6 placeholder:text-zinc-500',
        showUpload ? 'pr-24' : 'pr-14',
      )}
      composerMaxHeight={240}
      composerMinHeight={82}
      inputShellClassName="rounded-lg border border-zinc-800 bg-[#09090b] shadow-none focus-within:border-zinc-700 focus-within:shadow-none"
      sendActionClassName="h-8 w-8 rounded-full border border-zinc-700 bg-zinc-100 text-zinc-950 shadow-none hover:bg-zinc-200 hover:shadow-none"
      shellClassName={cn(
        'rounded-lg border border-zinc-800 bg-[#050505] bg-none from-transparent to-transparent p-2 shadow-none backdrop-blur-0',
        className,
      )}
      uploadActionClassName={cn(
        'h-8 w-8 rounded-full border border-zinc-800 bg-[#050505] text-zinc-500 shadow-none hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200',
        !showUpload && 'hidden',
      )}
      footerControls={footerControls}
    />
  )
}

import { memo } from 'react'
import { ConversationFeed, type ConversationFeedProps } from './conversation-feed'
import type { ConversationMessage, ConversationStatus, ConversationTurn, ConversationTurnEntry } from './conversation-types'

export type ChatTranscriptMessage = ConversationMessage
export type ChatTranscriptStatus = ConversationStatus
export type ChatTranscriptTurnEntry = ConversationTurnEntry
export type ChatTranscriptTurn = ConversationTurn
export type ChatTranscriptProps = ConversationFeedProps

export const ChatTranscript = memo(function ChatTranscript(props: ChatTranscriptProps) {
  return <ConversationFeed {...props} />
})

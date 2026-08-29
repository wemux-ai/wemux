import { resolveConversationAccess, filterMessagesForMembership, resolveMembershipWindow, type ConversationViewer } from '../control-plane/conversation-access'
import { listConversationMessages, listConversations, type ConversationMessageRecord, type ConversationRecord } from '../storage/conversation-store'

export type SessionSearchHit = {
  conversation: ConversationRecord
  matchedMessages: ConversationMessageRecord[]
}

const MAX_SNIPPETS_PER_HIT = 3

const matchesQuery = (value: string, needle: string) => value.toLowerCase().includes(needle)

export const searchSessions = async (params: {
  query: string
  viewer: ConversationViewer
  limit?: number
}): Promise<SessionSearchHit[]> => {
  const needle = params.query.trim().toLowerCase()
  if (!needle) {
    return []
  }

  const limit = params.limit ?? 20
  const hits: SessionSearchHit[] = []

  for (const conversation of listConversations()) {
    if (hits.length >= limit) {
      break
    }

    const access = await resolveConversationAccess({ conversationId: conversation.id, viewer: params.viewer })
    if (!access.ok) {
      continue
    }

    const titleMatches = matchesQuery(conversation.title, needle)

    const membership = access.level === 'member' ? access.membership : resolveMembershipWindow(conversation.id, params.viewer)
    const visibleMessages = filterMessagesForMembership(listConversationMessages(conversation.id), membership)
    const matchedMessages = visibleMessages
      .filter((message) => matchesQuery(message.content, needle))
      .slice(-MAX_SNIPPETS_PER_HIT)

    if (titleMatches || matchedMessages.length > 0) {
      hits.push({ conversation, matchedMessages })
    }
  }

  return hits
}

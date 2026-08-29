/**
 * [INPUT]: Current workspace, accepted friends, and the user's DM conversations.
 * [OUTPUT]: Workspace-scoped DM visibility for the `/chat` target sidebar.
 * [POS]: Keeps workspace membership contacts local while confirmed friends remain available across workspaces.
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */
import type { ConnectionUserBrief } from '../../lib/api/methods/connections'
import type { DmConversationListItem } from '../../lib/api/methods/collaboration'

/**
 * A DM belongs to the workspace where it was opened. Confirmed friends are the
 * only cross-workspace exception, matching the external-contact model.
 */
export const filterWorkspaceVisibleDmConversations = (params: {
  conversations: readonly DmConversationListItem[]
  workspaceId: string
  friends: readonly ConnectionUserBrief[]
}) => {
  const workspaceId = params.workspaceId.trim()
  const friendIds = new Set(params.friends.map((friend) => friend.id))

  return params.conversations.filter((item) => {
    const peerUserId = item.peer?.userId
    return Boolean(
      (peerUserId && friendIds.has(peerUserId))
      || (workspaceId && item.conversation.workspaceId === workspaceId),
    )
  })
}

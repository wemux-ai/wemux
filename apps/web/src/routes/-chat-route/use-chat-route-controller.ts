import type { Language } from '../../lib/i18n'
import { useChatRouteSessionActions } from './use-chat-route-session-actions'
import { useChatRouteShareActions } from './use-chat-route-share-actions'
import { useChatRouteState } from './use-chat-route-state'
import { useChatRouteStreamActions } from './use-chat-route-stream-actions'

type UseChatRouteControllerParams = {
  language: Language
}

export function useChatRouteController({ language }: UseChatRouteControllerParams) {
  const routeState = useChatRouteState({ language })
  const sessionActions = useChatRouteSessionActions({ language, routeState })
  const streamActions = useChatRouteStreamActions({ language, routeState })
  const shareActions = useChatRouteShareActions({ language })

  return {
    ...routeState,
    ...sessionActions,
    ...streamActions,
    shareActions,
  }
}

export type ChatRouteController = ReturnType<typeof useChatRouteController>

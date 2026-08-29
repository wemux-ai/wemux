export const SELECTED_AGENT_KEY = 'vibemux.selectedAgentId'
export const AGENT_SIDEBAR_REFRESH_EVENT = 'vibemux.agentSidebarRefresh'

export const setSelectedAgentId = (agentId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(SELECTED_AGENT_KEY, agentId)
}

export const consumeSelectedAgentId = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.sessionStorage.getItem(SELECTED_AGENT_KEY) ?? ''
}

export const notifyAgentSidebarRefresh = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(AGENT_SIDEBAR_REFRESH_EVENT))
}

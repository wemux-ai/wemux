const TRACE_STORAGE_KEY = 'vibemux.workspaceSessionChatTrace'

const normalizeTraceToggle = (value: string | null | undefined) => {
  return /^(1|true|yes|on)$/i.test((value ?? '').trim())
}

export const isWorkspaceSessionChatTraceEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return normalizeTraceToggle(window.localStorage.getItem(TRACE_STORAGE_KEY))
  } catch {
    return false
  }
}

export const traceWorkspaceSessionChat = (
  event: string,
  payload: Record<string, unknown> = {},
) => {
  if (!isWorkspaceSessionChatTraceEnabled()) {
    return
  }

  const timestamp = typeof performance !== 'undefined'
    ? Math.round(performance.now())
    : Date.now()

  console.info('[workspace-session-chat]', event, {
    t: timestamp,
    ...payload,
  })
}

export const getWorkspaceSessionChatTraceHint = () => {
  return `localStorage.setItem('${TRACE_STORAGE_KEY}', '1')`
}

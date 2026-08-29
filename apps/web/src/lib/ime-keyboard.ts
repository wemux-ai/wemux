type ImeKeyboardEventLike = {
  isComposing?: boolean
  key?: string
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    key?: string
    keyCode?: number
    which?: number
  } | null
  which?: number
}

const IME_PROCESS_KEYCODE = 229

export function isImeComposingKeyboardEvent(event: ImeKeyboardEventLike): boolean {
  if (
    event.isComposing
    || event.key === 'Process'
    || event.keyCode === IME_PROCESS_KEYCODE
    || event.which === IME_PROCESS_KEYCODE
  ) {
    return true
  }

  const nativeEvent = event.nativeEvent
  if (!nativeEvent) {
    return false
  }

  return nativeEvent.isComposing === true
    || nativeEvent.key === 'Process'
    || nativeEvent.keyCode === IME_PROCESS_KEYCODE
    || nativeEvent.which === IME_PROCESS_KEYCODE
}

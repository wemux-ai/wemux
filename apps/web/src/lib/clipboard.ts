// [INPUT]: Plain text plus browser and Electron clipboard capabilities.
// [OUTPUT]: A boolean indicating whether the text reached a clipboard provider.
// [POS]: Shared web clipboard fallback used by command-copying workflows.
// [PROTOCOL]: Update this header when clipboard precedence or return contracts change, then check AGENTS.md.

import { writeNativeClipboardText } from './native-client'

type ClipboardWriters = {
  writeNative: (text: string) => Promise<boolean | null>
  writeBrowser?: (text: string) => Promise<void>
}

const defaultClipboardWriters = (): ClipboardWriters => ({
  writeNative: writeNativeClipboardText,
  writeBrowser: typeof navigator !== 'undefined' ? navigator.clipboard?.writeText.bind(navigator.clipboard) : undefined,
})

export const copyTextToClipboard = async (
  text: string,
  writers: ClipboardWriters = defaultClipboardWriters(),
): Promise<boolean> => {
  if (!text) return false

  try {
    if (await writers.writeNative(text)) return true
  } catch {}

  if (!writers.writeBrowser) return false
  try {
    await writers.writeBrowser(text)
    return true
  } catch {
    return false
  }
}

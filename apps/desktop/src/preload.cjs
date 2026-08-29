const { contextBridge, ipcRenderer } = require('electron')

const deepLinkListeners = new Set()
const updateListeners = new Set()
const pendingDeepLinks = []

ipcRenderer.on('wemux:deep-link', (_event, urls) => {
  const normalizedUrls = Array.isArray(urls) ? urls.filter((url) => typeof url === 'string') : []
  if (deepLinkListeners.size === 0) {
    pendingDeepLinks.push(...normalizedUrls)
    return
  }
  for (const listener of deepLinkListeners) listener(normalizedUrls)
})

ipcRenderer.on('wemux:update', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return
  for (const listener of updateListeners) listener(payload)
})

const desktopBridge = {
  platform: process.platform,
  invoke(command, args) {
    return ipcRenderer.invoke('wemux:invoke', command, args)
  },
  onDeepLink(listener) {
    if (typeof listener !== 'function') return () => {}
    deepLinkListeners.add(listener)
    if (pendingDeepLinks.length > 0) {
      listener(pendingDeepLinks.splice(0))
    }
    return () => deepLinkListeners.delete(listener)
  },
  onUpdate(listener) {
    if (typeof listener !== 'function') return () => {}
    updateListeners.add(listener)
    return () => updateListeners.delete(listener)
  },
}

contextBridge.exposeInMainWorld('__WEMUX_DESKTOP__', Object.freeze(desktopBridge))

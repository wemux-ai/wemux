// Runs inside react-native-webview and exposes the same narrow contract as Electron preload.
export const buildInjectedNativeBridge = (platform: string) => `
(() => {
  if (window.__WEMUX_MOBILE__) return true;

  let requestSequence = 0;
  const pendingRequests = new Map();
  const deepLinkListeners = new Set();
  const updateListeners = new Set();
  const queuedDeepLinks = [];

  window.addEventListener('wemux-mobile-response', (event) => {
    const detail = event.detail || {};
    const pending = pendingRequests.get(detail.id);
    if (!pending) return;
    pendingRequests.delete(detail.id);
    clearTimeout(pending.timer);
    if (detail.error) pending.reject(new Error(detail.error));
    else pending.resolve(detail.result);
  });

  window.__WEMUX_MOBILE_DISPATCH_DEEP_LINK__ = (urls) => {
    const normalized = Array.isArray(urls) ? urls.filter((url) => typeof url === 'string') : [];
    if (deepLinkListeners.size === 0) {
      queuedDeepLinks.push(...normalized);
      return;
    }
    deepLinkListeners.forEach((listener) => listener(normalized));
  };

  window.__WEMUX_MOBILE_DISPATCH_UPDATE__ = (payload) => {
    updateListeners.forEach((listener) => listener(payload));
  };

  window.__WEMUX_MOBILE__ = Object.freeze({
    platform: ${JSON.stringify(platform)},
    invoke(command, args) {
      return new Promise((resolve, reject) => {
        const id = 'mobile-' + Date.now() + '-' + (++requestSequence);
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error('native bridge request timed out'));
        }, 30000);
        pendingRequests.set(id, { resolve, reject, timer });
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'invoke',
          id,
          command,
          args: args || {},
        }));
      });
    },
    onDeepLink(listener) {
      if (typeof listener !== 'function') return () => {};
      deepLinkListeners.add(listener);
      if (queuedDeepLinks.length > 0) listener(queuedDeepLinks.splice(0));
      return () => deepLinkListeners.delete(listener);
    },
    onUpdate(listener) {
      if (typeof listener !== 'function') return () => {};
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
  });

  document.documentElement.classList.add('wemux-react-native-window');
  return true;
})();
true;
`

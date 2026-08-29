import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview'
import { buildInjectedNativeBridge } from './src/injected-bridge'
import { handleMobileBridgeRequest, type MobileBridgeRequest } from './src/native-bridge'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

const defaultDevelopmentUrl = Platform.select({
  android: 'http://10.0.2.2:15173/chat',
  default: 'http://127.0.0.1:15173/chat',
}) as string

const appUrl = process.env.EXPO_PUBLIC_WEMUX_APP_URL
  || (__DEV__ ? defaultDevelopmentUrl : 'https://wemux.ai/chat')

const serializeInjectedEvent = (eventName: string, detail: unknown) => `
window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail: ${JSON.stringify(detail)} }));
true;
`

export default function App() {
  const webViewRef = useRef<WebView>(null)
  const pendingDeepLinks = useRef<string[]>([])
  const [webReady, setWebReady] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [loadError, setLoadError] = useState('')
  const injectedBridge = useMemo(
    () => buildInjectedNativeBridge(Platform.OS),
    [],
  )

  const injectDeepLinks = useCallback((urls: string[]) => {
    if (!webReady || !webViewRef.current) {
      pendingDeepLinks.current.push(...urls)
      return
    }
    webViewRef.current.injectJavaScript(`
window.__WEMUX_MOBILE_DISPATCH_DEEP_LINK__?.(${JSON.stringify(urls)});
true;
`)
  }, [webReady])

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url) injectDeepLinks([url])
    })
    const subscription = Linking.addEventListener('url', ({ url }) => injectDeepLinks([url]))
    return () => subscription.remove()
  }, [injectDeepLinks])

  useEffect(() => {
    if (!webReady || pendingDeepLinks.current.length === 0) return
    const urls = pendingDeepLinks.current.splice(0)
    injectDeepLinks(urls)
  }, [injectDeepLinks, webReady])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false
      webViewRef.current?.goBack()
      return true
    })
    return () => subscription.remove()
  }, [canGoBack])

  const handleBridgeMessage = async (event: WebViewMessageEvent) => {
    let request: MobileBridgeRequest
    try {
      request = JSON.parse(event.nativeEvent.data) as MobileBridgeRequest
      if (request.type !== 'invoke' || typeof request.id !== 'string' || typeof request.command !== 'string') {
        return
      }
    } catch {
      return
    }

    const response = await handleMobileBridgeRequest(
      request,
      () => pendingDeepLinks.current.splice(0),
    )
    webViewRef.current?.injectJavaScript(serializeInjectedEvent('wemux-mobile-response', response))
    if (request.command === 'install_update' && !response.error) {
      webViewRef.current?.injectJavaScript(`
window.__WEMUX_MOBILE_DISPATCH_UPDATE__?.({ type: 'installed' });
true;
`)
    }
  }

  const handleNavigationChange = (navigation: WebViewNavigation) => {
    setCanGoBack(navigation.canGoBack)
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <WebView
        ref={webViewRef}
        source={{ uri: appUrl }}
        style={styles.webView}
        containerStyle={styles.webViewContainer}
        injectedJavaScriptBeforeContentLoaded={injectedBridge}
        onMessage={(event) => void handleBridgeMessage(event)}
        onNavigationStateChange={handleNavigationChange}
        onLoadStart={() => setLoadError('')}
        onLoadEnd={() => setWebReady(true)}
        onError={(event) => setLoadError(event.nativeEvent.description || 'Unable to load Wemux')}
        onHttpError={(event) => setLoadError(`HTTP ${event.nativeEvent.statusCode}`)}
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        originWhitelist={['http://*', 'https://*', 'wemux://*']}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.centered}>
            <ActivityIndicator color="#34d399" />
          </View>
        )}
      />
      {loadError ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>无法连接 Wemux</Text>
          <Text style={styles.errorMessage}>{loadError}</Text>
          <Text style={styles.errorUrl}>{appUrl}</Text>
          <Pressable style={styles.retryButton} onPress={() => webViewRef.current?.reload()}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  webView: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  centered: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#09090b',
  },
  errorOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#09090b',
  },
  errorTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '600',
  },
  errorMessage: {
    marginTop: 10,
    color: '#a1a1aa',
    fontSize: 14,
    textAlign: 'center',
  },
  errorUrl: {
    marginTop: 8,
    color: '#52525b',
    fontSize: 11,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    borderRadius: 6,
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: {
    color: '#18181b',
    fontSize: 14,
    fontWeight: '600',
  },
})

# apps/mobile - React Native mobile shell (L2)

## Scope

- Owns the Expo/React Native iOS and Android application shell.
- Reuses the product renderer through `react-native-webview` while native screens can migrate incrementally.
- Owns mobile deep links, local notifications, microphone recording and Expo OTA update commands.
- Android also owns the foreground meeting-listening service, GGUF model
  downloads, and the JNI MOSS/MiniCPM5 runtime used for offline transcription.
- Exposes only the message-based `window.__WEMUX_MOBILE__` bridge to the renderer.

## Boundaries

- Product UI and control-plane API contracts remain in `apps/web` and shared packages.
- Do not add desktop-only behavior such as autostart, tray or local worker probing to mobile.
- The root product version is the source of truth through `app.config.cjs`.

[PROTOCOL]: Update this file when the mobile shell contract or ownership changes, then check the root AGENTS.md.

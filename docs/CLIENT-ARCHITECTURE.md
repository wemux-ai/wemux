# Client Architecture

Wemux uses two maintained native shells:

- Desktop: Electron in `apps/desktop`
- Mobile: React Native + Expo in `apps/mobile`

Both shells reuse the React product renderer in `apps/web`. Platform capabilities are exposed through a small promise-based bridge implemented by `apps/web/src/lib/native-client.ts`:

| Capability | Electron | React Native |
|---|---:|---:|
| Deep links (`wemux://`) | Yes | Yes |
| System notifications | Yes | Yes |
| Automatic updates | electron-updater | Expo Updates |
| Microphone recording | Yes | Yes |
| Tray / global shortcut / launch at login | Yes | Not applicable |
| Local worker daemon probe | Yes | Not applicable |

## Development

```bash
pnpm dev:desktop       # Electron; starts web/server if their ports are not healthy
pnpm dev:mobile        # Expo development server
pnpm mobile:ios        # Open iOS simulator
pnpm mobile:android    # Open Android emulator
```

For a physical mobile device, set `EXPO_PUBLIC_WEMUX_APP_URL` to a LAN-reachable web URL before starting Expo. The defaults target `127.0.0.1:15173` on iOS Simulator and `10.0.2.2:15173` on Android Emulator.

## Builds

```bash
pnpm build:desktop
pnpm build:mobile
```

Desktop packages are produced by Electron Builder. Mobile native projects can be generated with `pnpm mobile:init`; production signing remains owned by the iOS/Android release credentials rather than repository source.

## Mobile self-build

Official mobile installers (TestFlight / App Store, Play Store, signed APK) are not published yet; they are planned once signing credentials and store accounts are in place. Until then, community users can build the mobile app locally.

Prerequisites: Node.js 22, pnpm 10, Xcode 16+ (iOS), Android Studio with its SDK (Android).

```bash
pnpm install
pnpm mobile:init        # generates the gitignored native projects: apps/mobile/ios, apps/mobile/android
```

The mobile shell loads a running Wemux server; point `EXPO_PUBLIC_WEMUX_APP_URL` at your server URL (for example `http://<LAN-IP>:15173`) when building for a physical device. Simulator/emulator defaults already target the local dev server.

Android APK for direct install:

```bash
cd apps/mobile/android
./gradlew assembleDebug           # output: app/build/outputs/apk/debug/app-debug.apk
```

The generated project signs with a debug keystore, which is fine for local testing. For a production-grade build, configure your own release keystore in `android/app/build.gradle`.

iOS on device/simulator: open `apps/mobile/ios/Wemux.xcworkspace` in Xcode, select your own development team under Signing & Capabilities, then run the `Wemux` scheme.

```bash
pnpm build:mobile      # expo export: static renderer bundle into apps/mobile/dist
```

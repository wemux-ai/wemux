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

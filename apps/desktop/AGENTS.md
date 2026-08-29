# apps/desktop - Electron desktop shell (L2)

## Scope

- Owns the Electron main process, sandboxed preload bridge, desktop packaging and desktop development launcher.
- Reuses the renderer from `apps/web`; product UI and business logic stay in the web app.
- Exposes only the narrow `window.__WEMUX_DESKTOP__` bridge. Renderer code must not receive Node.js primitives.
- Desktop releases use the root product version and `electron-builder`; this package does not own a separate product version.

## Security invariants

- Keep `contextIsolation`, renderer sandboxing and `webSecurity` enabled.
- Keep Node integration disabled.
- Validate every IPC command and renderer sender in the main process.
- Open untrusted external URLs through the OS browser, not inside the privileged application window.

[PROTOCOL]: Update this file when the desktop shell contract or ownership changes, then check the root AGENTS.md.

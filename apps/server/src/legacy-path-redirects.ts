// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Incoming request URL.
// [OUTPUT]: Canonical wemux path for legacy vibemux paths (301), or null.
// [POS]: Replaces the Cloudflare Pages `_redirects` table after the static frontend split was retired
//   (web is now served entirely by the control-plane SSR). Keeps old compare slugs and
//   trailing-slash normalization alive regardless of the hosting layer.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const COMPARE_SLUG_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ['/compare/vibemux-vs-cline-kanban', '/compare/wemux-vs-cline-kanban'],
  ['/compare/vibemux-vs-claude-code', '/compare/wemux-vs-claude-code'],
  ['/compare/vibemux-vs-codex', '/compare/wemux-vs-codex'],
  ['/compare/vibemux-vs-cursor', '/compare/wemux-vs-cursor'],
  ['/compare/vibemux-vs-devin', '/compare/wemux-vs-devin'],
  ['/compare/vibemux-vs-github-copilot', '/compare/wemux-vs-github-copilot'],
  ['/compare/vibemux-vs-openhands', '/compare/wemux-vs-openhands'],
  ['/compare/vibemux-vs-orca', '/compare/wemux-vs-orca'],
  ['/compare/vibemux-vs-replit', '/compare/wemux-vs-replit'],
]

// 静态托管时代 `/xxx/ → /xxx` 的 301 规范化；SSR 下 API 与上传路径不做此处理。
const NON_CANONICAL_PATH_PREFIXES = ['/api/', '/uploads/', '/mcp']

/**
 * Resolves legacy path redirects that previously lived in the Cloudflare Pages
 * `_redirects` file. Preserves query strings when redirecting.
 */
export const resolveLegacyPathRedirect = (requestUrl: string): string | null => {
  const request = new URL(requestUrl)
  const { pathname, search } = request

  if (pathname === '/index.html') {
    return `/${search}`
  }

  for (const [from, to] of COMPARE_SLUG_REDIRECTS) {
    if (pathname === from || pathname === `${from}/`) {
      return `${to}${search}`
    }
  }

  if (
    pathname.length > 1
    && pathname.endsWith('/')
    && !NON_CANONICAL_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return `${pathname.slice(0, -1)}${search}`
  }

  return null
}

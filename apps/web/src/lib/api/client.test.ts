import assert from 'node:assert/strict'
import test from 'node:test'
import { authFetch, extractErrorMessage, resolveMediaUrl, wemuxTokenStillValid } from './client'

const createStorageMock = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    _store: store,
  }
}

const installBrowserGlobals = () => {
  const globals = globalThis as Record<string, unknown>
  const previousWindow = globals.window
  const previousLocalStorage = globals.localStorage
  const previousSessionStorage = globals.sessionStorage

  const localStorage = createStorageMock()
  const sessionStorage = createStorageMock()
  const location = {
    pathname: '/',
    origin: 'http://localhost:8989',
    hostname: 'localhost',
    port: '8989',
    protocol: 'http:',
    href: '',
  }

  globals.window = { location, localStorage, sessionStorage }
  globals.localStorage = localStorage
  globals.sessionStorage = sessionStorage

  return {
    location,
    localStorage,
    sessionStorage,
    restore: () => {
      if (previousWindow === undefined) delete globals.window
      else globals.window = previousWindow
      if (previousLocalStorage === undefined) delete globals.localStorage
      else globals.localStorage = previousLocalStorage
      if (previousSessionStorage === undefined) delete globals.sessionStorage
      else globals.sessionStorage = previousSessionStorage
    },
  }
}

test('extractErrorMessage prefers the message field from JSON error bodies', () => {
  const message = extractErrorMessage('{"message":"Free 套餐最多保留 5 个组织，请先删除现有组织后再新建。"}')

  assert.equal(message, 'Free 套餐最多保留 5 个组织，请先删除现有组织后再新建。')
})

test('extractErrorMessage falls back to raw text for non-JSON responses', () => {
  const message = extractErrorMessage('Request failed: upstream unavailable')

  assert.equal(message, 'Request failed: upstream unavailable')
})

test('resolveMediaUrl redirects legacy built-in Agent avatars to replacement files', () => {
  assert.equal(resolveMediaUrl('/agents/avatars/agent-research.png'), '/agents/avatars/agent-03.png')
  assert.equal(
    resolveMediaUrl('https://app.vibemux.test/agents/avatars/agent-research.png?legacy=1'),
    'https://app.vibemux.test/agents/avatars/agent-03.png?legacy=1',
  )
  assert.equal(resolveMediaUrl('/agents/avatars/agent-20.png'), '/agents/avatars/agent-20.png')
})

test('extractErrorMessage reads nested error fields from JSON payloads', () => {
  const message = extractErrorMessage('{"error":"exceeded retry limit, last status: 429 Too Many Requests"}')

  assert.equal(message, 'exceeded retry limit, last status: 429 Too Many Requests')
})

test('extractErrorMessage summarizes Cloudflare 522 HTML error pages', () => {
  const message = extractErrorMessage(`
    <!DOCTYPE html>
    <html>
      <head><title>wemux.xyz | 522: Connection timed out</title></head>
      <body>
        <h1>Connection timed out <span>Error code 522</span></h1>
        <span>Cloudflare</span>
      </body>
    </html>
  `)

  assert.equal(message, '服务暂时不可用：Cloudflare 连接源站超时（522），请稍后重试。')
})

test('extractErrorMessage summarizes generic HTML error pages', () => {
  const message = extractErrorMessage('<html><body><h1>Bad Gateway</h1></body></html>')

  assert.equal(message, '服务暂时不可用：接口返回了 HTML 错误页，请稍后重试。')
})

test('BUG-05：vibemux token 有效时 401 不被判为登出（/api/auth/me 200）', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    assert.match(url, /\/api\/auth\/me$/)
    return new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const stillValid = await wemuxTokenStillValid('vibemux-token')
    assert.equal(stillValid, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('BUG-05：vibemux token 失效时（/api/auth/me 401）判为登出', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 401, headers: { 'content-type': 'application/json' } })
  try {
    const stillValid = await wemuxTokenStillValid('expired-token')
    assert.equal(stillValid, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('BUG-05：网络不可达时保守按登出处理（不引入新风险）', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network down') }
  try {
    const stillValid = await wemuxTokenStillValid('vibemux-token')
    assert.equal(stillValid, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('authFetch：匿名请求（未携带 token）401 不触发强制登出跳转', async () => {
  const browser = installBrowserGlobals()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 })
  try {
    const response = await authFetch('/api/anything')
    assert.equal(response.status, 401)
    // 不整页跳 /login，也不写强制登出标记
    assert.equal(browser.location.href, '')
    assert.equal(browser.sessionStorage._store.get('vibemux_auth_forced_logout'), undefined)
  } finally {
    globalThis.fetch = originalFetch
    browser.restore()
  }
})

test('authFetch：携带失效 token 的 401 仍会强制登出并跳转 /login', async () => {
  const browser = installBrowserGlobals()
  browser.localStorage.setItem('auth_token', 'expired-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify({}), { status: 401, headers: { 'content-type': 'application/json' } })
    }
    return new Response('unauthorized', { status: 401 })
  }
  try {
    const response = await authFetch('/api/anything')
    assert.equal(response.status, 401)
    // 有 token 且 token 已失效：保持原有强制登出行为
    assert.equal(browser.location.href, '/login')
    assert.equal(browser.sessionStorage._store.get('vibemux_auth_forced_logout'), '1')
    assert.equal(browser.localStorage.getItem('auth_token'), null)
  } finally {
    globalThis.fetch = originalFetch
    browser.restore()
  }
})

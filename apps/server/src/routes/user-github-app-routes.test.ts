import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { createToken } from '../repositories/auth'
import { registerUserGitHubAppRoutes } from './user-github-app-routes'

const requireAuth: MiddlewareHandler = async (_c, next) => {
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerUserGitHubAppRoutes(app, requireAuth)
  return app
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

const setGitHubAppEnv = () => {
  const previous = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_API_BASE_URL: process.env.GITHUB_APP_API_BASE_URL,
    GITHUB_APP_WEB_BASE_URL: process.env.GITHUB_APP_WEB_BASE_URL,
  }

  process.env.GITHUB_APP_ID = '12345'
  process.env.GITHUB_APP_SLUG = 'vibemux-test-app'
  process.env.GITHUB_APP_PRIVATE_KEY = privateKeyPem
  process.env.GITHUB_APP_API_BASE_URL = 'https://api.github.test'
  process.env.GITHUB_APP_WEB_BASE_URL = 'https://github.test'

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('github app callback accepts signed state without bearer token', async () => {
  const restoreEnv = setGitHubAppEnv()
  const originalFetch = globalThis.fetch
  const app = createApp()
  const userId = `user-${crypto.randomUUID()}`
  let fetchCalled = false

  globalThis.fetch = async (input) => {
    fetchCalled = true
    assert.equal(String(input), 'https://api.github.test/app/installations/137435212')
    return new Response('upstream error', { status: 500 })
  }

  try {
    const connectResponse = await app.request('/api/user/github-app-installations/connect-url?returnTo=%2Fsettings%3Fsection%3Dgit&commitAuthorName=Alice%20Dev&commitAuthorEmail=alice%40example.com', {
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
      },
    })

    assert.equal(connectResponse.status, 200)
    const connectPayload = await connectResponse.json() as { configured: boolean; url: string }
    assert.equal(connectPayload.configured, true)

    const state = new URL(connectPayload.url).searchParams.get('state')
    assert.ok(state)

    const callbackResponse = await app.request(
      `http://server/api/user/github-app-installations/callback?installation_id=137435212&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    )

    assert.equal(callbackResponse.status, 302)
    assert.equal(fetchCalled, true)
    assert.equal(
      callbackResponse.headers.get('location'),
      '/settings?section=git&githubApp=error&message=github_app_installation_sync_failed',
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv()
  }
})

test('authorize-url returns 503 when oauth is not configured', async () => {
  const restoreEnv = setGitHubAppEnv()
  try {
    const app = createApp()
    const response = await app.request('/api/user/github-app-installations/authorize-url?returnTo=%2Fsettings%3Fsection%3Dgit', {
      headers: {
        Authorization: `Bearer ${createToken('user-oauth-1')}`,
      },
    })
    assert.equal(response.status, 503)
    const payload = await response.json() as { oauthConfigured: boolean }
    assert.equal(payload.oauthConfigured, false)
  } finally {
    restoreEnv()
  }
})

test('authorize-url returns a github oauth url when configured', async () => {
  const restoreEnv = setGitHubAppEnv()
  process.env.GITHUB_APP_CLIENT_ID = 'client-abc'
  process.env.GITHUB_APP_CLIENT_SECRET = 'secret-xyz'
  try {
    const app = createApp()
    const response = await app.request('/api/user/github-app-installations/authorize-url?returnTo=%2Fsettings%3Fsection%3Dgit', {
      headers: {
        Authorization: `Bearer ${createToken('user-oauth-1')}`,
      },
    })
    assert.equal(response.status, 200)
    const payload = await response.json() as { oauthConfigured: boolean; url: string }
    assert.equal(payload.oauthConfigured, true)
    const url = new URL(payload.url)
    assert.equal(url.origin, 'https://github.test')
    assert.equal(url.pathname, '/login/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), 'client-abc')
    assert.ok(url.searchParams.get('state'))
  } finally {
    restoreEnv()
  }
})

test('github app callback exchanges an oauth code without requiring a linked installation', async () => {
  const restoreEnv = setGitHubAppEnv()
  process.env.GITHUB_APP_CLIENT_ID = 'client-abc'
  process.env.GITHUB_APP_CLIENT_SECRET = 'secret-xyz'
  const originalFetch = globalThis.fetch
  const app = createApp()
  const userId = `user-${crypto.randomUUID()}`
  const calls: string[] = []

  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://github.test/login/oauth/access_token') {
      return Response.json({ access_token: 'user-token-oauth', token_type: 'bearer' })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  try {
    const connectResponse = await app.request('/api/user/github-app-installations/connect-url?returnTo=%2Fsettings%3Fsection%3Dgit&commitAuthorName=Alice%20Dev&commitAuthorEmail=alice%40example.com', {
      headers: {
        Authorization: `Bearer ${createToken(userId)}`,
      },
    })
    const connectPayload = await connectResponse.json() as { url: string }
    const state = new URL(connectPayload.url).searchParams.get('state')
    assert.ok(state)

    const callbackResponse = await app.request(
      `http://server/api/user/github-app-installations/callback?code=oauth-code-1&state=${encodeURIComponent(state!)}`,
      { redirect: 'manual' },
    )

    assert.equal(callbackResponse.status, 302)
    assert.deepEqual(calls, ['https://github.test/login/oauth/access_token'])
    const location = callbackResponse.headers.get('location') ?? ''
    assert.ok(location.includes('githubApp=connected'))
    assert.ok(location.includes('githubOAuth=authorized'))
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv()
  }
})

test('github app callback rejects a mismatched authenticated user', async () => {
  const restoreEnv = setGitHubAppEnv()
  const originalFetch = globalThis.fetch
  const app = createApp()
  const stateOwnerId = `user-${crypto.randomUUID()}`
  const otherUserId = `user-${crypto.randomUUID()}`

  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for mismatched users')
  }

  try {
    const connectResponse = await app.request('/api/user/github-app-installations/connect-url?returnTo=%2Fsettings%3Fsection%3Dgit&commitAuthorName=Alice%20Dev&commitAuthorEmail=alice%40example.com', {
      headers: {
        Authorization: `Bearer ${createToken(stateOwnerId)}`,
      },
    })

    assert.equal(connectResponse.status, 200)
    const connectPayload = await connectResponse.json() as { url: string }
    const state = new URL(connectPayload.url).searchParams.get('state')
    assert.ok(state)

    const callbackResponse = await app.request(
      `http://server/api/user/github-app-installations/callback?installation_id=137435212&state=${encodeURIComponent(state)}`,
      {
        headers: {
          Authorization: `Bearer ${createToken(otherUserId)}`,
        },
        redirect: 'manual',
      },
    )

    assert.equal(callbackResponse.status, 302)
    assert.equal(
      callbackResponse.headers.get('location'),
      '/settings?section=git&githubApp=error&message=github_app_state_invalid',
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import { DESKTOP_SANDBOX_DEV_ONLY_MESSAGE, requireDesktopSandboxDevOnlyAccess } from '../services/desktop-sandbox-dev-access'
import { buildDesktopPreviewAccessTarget } from './desktop-sandbox-routes'

const createApp = () => {
  const app = new Hono()
  app.use('/api/tasks/:id/desktop-sandbox/*', requireDesktopSandboxDevOnlyAccess)
  app.get('/api/tasks/:id/desktop-sandbox/current', (c) => c.json({ message: 'ok' }))
  return app
}

test('desktop sandbox routes return 404 outside development', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousPublicBaseUrl = process.env.VIBEMUX_PUBLIC_BASE_URL
  process.env.NODE_ENV = 'production'
  delete process.env.VIBEMUX_PUBLIC_BASE_URL

  try {
    const response = await createApp().request('/api/tasks/task-1/desktop-sandbox/current')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      message: DESKTOP_SANDBOX_DEV_ONLY_MESSAGE,
    })
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
    if (previousPublicBaseUrl === undefined) {
      delete process.env.VIBEMUX_PUBLIC_BASE_URL
    } else {
      process.env.VIBEMUX_PUBLIC_BASE_URL = previousPublicBaseUrl
    }
  }
})

test('desktop sandbox routes are available in preview', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousPublicBaseUrl = process.env.VIBEMUX_PUBLIC_BASE_URL
  process.env.NODE_ENV = 'production'
  process.env.VIBEMUX_PUBLIC_BASE_URL = 'https://wemux.xyz'

  try {
    const response = await createApp().request('/api/tasks/task-1/desktop-sandbox/current')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      message: 'ok',
    })
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }
    if (previousPublicBaseUrl === undefined) {
      delete process.env.VIBEMUX_PUBLIC_BASE_URL
    } else {
      process.env.VIBEMUX_PUBLIC_BASE_URL = previousPublicBaseUrl
    }
  }
})

test('desktop sandbox preview uses localtest host for local dev even when project preview env points to production', () => {
  const previousPreviewBaseDomain = process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN
  const previousPreviewScheme = process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME
  process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN = 'wemux.xyz'
  process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME = 'https'

  try {
    const target = buildDesktopPreviewAccessTarget({
      requestUrl: 'http://app.wemux.localtest.me:15173/api/tasks/task-1/desktop-sandbox/open',
      headers: new Headers({
        host: 'app.wemux.localtest.me:15173',
      }),
      projectName: 'Shopping Agent',
      previewId: 'desktop-preview-1',
    })

    assert.equal(
      target.publicHost,
      'shopping-agent-preview--desktop-preview-1.wemux.localtest.me:18989',
    )
    assert.equal(
      target.publicUrl,
      'http://shopping-agent-preview--desktop-preview-1.wemux.localtest.me:18989/',
    )
    assert.equal(
      target.tunnelUrl,
      'ws://app.wemux.localtest.me:18989/api/preview-tunnels/ws',
    )
  } finally {
    if (previousPreviewBaseDomain === undefined) {
      delete process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN
    } else {
      process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN = previousPreviewBaseDomain
    }
    if (previousPreviewScheme === undefined) {
      delete process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME
    } else {
      process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME = previousPreviewScheme
    }
  }
})

test('desktop sandbox preview prefers browser origin when dev proxy hides the localtest host', () => {
  const previousPreviewBaseDomain = process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN
  const previousPreviewScheme = process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME
  process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN = 'wemux.xyz'
  process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME = 'https'

  try {
    const target = buildDesktopPreviewAccessTarget({
      requestUrl: 'http://127.0.0.1:18989/api/tasks/task-1/desktop-sandbox/open',
      headers: new Headers({
        host: '127.0.0.1:18989',
        origin: 'http://app.wemux.localtest.me:15173',
        referer: 'http://app.wemux.localtest.me:15173/workspaces?panel=desktop',
      }),
      projectName: 'Shopping Agent',
      previewId: 'desktop-preview-2',
    })

    assert.equal(
      target.publicHost,
      'shopping-agent-preview--desktop-preview-2.wemux.localtest.me:18989',
    )
    assert.equal(
      target.publicUrl,
      'http://shopping-agent-preview--desktop-preview-2.wemux.localtest.me:18989/',
    )
    assert.equal(
      target.tunnelUrl,
      'ws://127.0.0.1:18989/api/preview-tunnels/ws',
    )
  } finally {
    if (previousPreviewBaseDomain === undefined) {
      delete process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN
    } else {
      process.env.VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN = previousPreviewBaseDomain
    }
    if (previousPreviewScheme === undefined) {
      delete process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME
    } else {
      process.env.VIBEMUX_PROJECT_PREVIEW_SCHEME = previousPreviewScheme
    }
  }
})

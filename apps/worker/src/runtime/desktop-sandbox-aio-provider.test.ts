import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { aioDesktopProvider, buildAioVncUrl } from './desktop-sandbox-aio-provider'

test('buildAioVncUrl points noVNC at the AIO root websockify endpoint', () => {
  const previousBaseUrl = process.env.VIBEMUX_AIO_SANDBOX_BASE_URL
  try {
    process.env.VIBEMUX_AIO_SANDBOX_BASE_URL = 'http://127.0.0.1:18081'
    const url = new URL(buildAioVncUrl())

    assert.equal(url.pathname, '/vnc/index.html')
    assert.equal(url.searchParams.get('autoconnect'), 'true')
    assert.equal(url.searchParams.get('resize'), 'scale')
    assert.equal(url.searchParams.get('path'), 'websockify')
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.VIBEMUX_AIO_SANDBOX_BASE_URL
    } else {
      process.env.VIBEMUX_AIO_SANDBOX_BASE_URL = previousBaseUrl
    }
  }
})

test('prepare checks an external AIO Sandbox during worker startup', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-aio-prepare-'))
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME
  const previousBaseUrl = process.env.VIBEMUX_AIO_SANDBOX_BASE_URL
  const previousFetch = globalThis.fetch
  try {
    process.env.VIBEMUX_WORKER_HOME = tempHome
    process.env.VIBEMUX_AIO_SANDBOX_BASE_URL = 'http://127.0.0.1:18081'
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch

    const result = await aioDesktopProvider.prepare()

    assert.equal(result.ok, true)
    assert.equal(result.provider, 'aio')
    assert.equal(result.phase, 'ready')
    assert.match(result.streamUrl || '', /\/vnc\/index\.html/)
    assert.match(result.streamUrl || '', /path=websockify/)
  } finally {
    globalThis.fetch = previousFetch
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }
    if (previousBaseUrl === undefined) {
      delete process.env.VIBEMUX_AIO_SANDBOX_BASE_URL
    } else {
      process.env.VIBEMUX_AIO_SANDBOX_BASE_URL = previousBaseUrl
    }
    rmSync(tempHome, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { checkInstallerPackageUpdate, checkNpmPackageUpdate, resolveWorkerReleaseChannel } from './worker-release'

test('packaged worker channel overrides ambient shell channel', () => {
  assert.equal(resolveWorkerReleaseChannel({
    metadataChannel: 'production',
    packageName: 'vibemux-worker',
    environmentChannel: 'preview',
  }), 'production')
  assert.equal(resolveWorkerReleaseChannel({
    metadataChannel: 'preview',
    packageName: 'vibemux-worker',
    environmentChannel: 'preview',
  }), 'production')
  assert.equal(resolveWorkerReleaseChannel({
    packageName: 'vibemux-worker-preview',
    environmentChannel: 'production',
  }), 'preview')
  assert.equal(resolveWorkerReleaseChannel({
    packageName: 'vibemux',
    environmentChannel: 'preview',
  }), 'preview')
  // 兼容窗口：新包名同样识别
  assert.equal(resolveWorkerReleaseChannel({
    packageName: 'wemux-worker',
    environmentChannel: 'preview',
  }), 'production')
  assert.equal(resolveWorkerReleaseChannel({
    packageName: 'wemux-worker-preview',
    environmentChannel: 'production',
  }), 'preview')
})

test('checkInstallerPackageUpdate checks installer manifest for preview packages', async () => {
  const originalInstallerUrl = process.env.VIBEMUX_WORKER_INSTALLER_URL
  const originalFetch = globalThis.fetch

  try {
    process.env.VIBEMUX_WORKER_INSTALLER_URL = 'https://preview.example/install'
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), 'https://preview.example/install/worker/manifest.json')
      return new Response(JSON.stringify({
        packageName: 'vibemux-worker-preview',
        packageVersion: '0.3.47-preview.new',
      }), { status: 200 })
    }) as typeof fetch

    const result = await checkInstallerPackageUpdate(
      '0.3.46-preview.old',
      'preview',
      'vibemux-worker-preview',
      'preview',
    )

    assert.equal(result.ok, true)
    assert.equal(result.available, true)
    assert.equal(result.latestVersion, '0.3.47-preview.new')
    assert.equal(result.packageUrl, 'https://preview.example/install/worker/package.tgz')
  } finally {
    if (originalInstallerUrl === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_URL
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_URL = originalInstallerUrl
    }
    globalThis.fetch = originalFetch
  }
})

test('checkInstallerPackageUpdate allows vibemux legacy package against wemux manifest in same channel', async () => {
  const originalInstallerUrl = process.env.VIBEMUX_WORKER_INSTALLER_URL
  const originalFetch = globalThis.fetch

  try {
    process.env.VIBEMUX_WORKER_INSTALLER_URL = 'https://preview.example/install'
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), 'https://preview.example/install/worker/manifest.json')
      return new Response(JSON.stringify({
        packageName: 'wemux-worker-preview',
        packageVersion: '0.3.114-preview.new',
      }), { status: 200 })
    }) as typeof fetch

    const result = await checkInstallerPackageUpdate(
      '0.3.112-preview.old',
      'preview',
      'vibemux-worker-preview',
      'preview',
    )

    assert.equal(result.ok, true)
    assert.equal(result.available, true)
    assert.equal(result.latestVersion, '0.3.114-preview.new')
    assert.equal(result.packageUrl, 'https://preview.example/install/worker/package.tgz')
  } finally {
    if (originalInstallerUrl === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_URL
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_URL = originalInstallerUrl
    }
    globalThis.fetch = originalFetch
  }
})

test('checkInstallerPackageUpdate rejects cross-channel manifest package name', async () => {
  const originalInstallerUrl = process.env.VIBEMUX_WORKER_INSTALLER_URL
  const originalFetch = globalThis.fetch

  try {
    process.env.VIBEMUX_WORKER_INSTALLER_URL = 'https://preview.example/install'
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        packageName: 'wemux-worker',
        packageVersion: '0.3.114',
      }), { status: 200 })
    }) as typeof fetch

    const result = await checkInstallerPackageUpdate(
      '0.3.112-preview.old',
      'preview',
      'vibemux-worker-preview',
      'preview',
    )

    assert.equal(result.ok, false)
    assert.equal(result.available, false)
    assert.match(result.message, /通道不匹配/)
  } finally {
    if (originalInstallerUrl === undefined) {
      delete process.env.VIBEMUX_WORKER_INSTALLER_URL
    } else {
      process.env.VIBEMUX_WORKER_INSTALLER_URL = originalInstallerUrl
    }
    globalThis.fetch = originalFetch
  }
})

test('checkNpmPackageUpdate falls back to installer manifest when npm metadata fails', async () => {
  const result = await checkNpmPackageUpdate(
    '0.3.83-preview.old',
    'preview',
    'vibemux-worker-preview',
    'preview',
    {
      loadPackageMetadata: async () => {
        throw new Error('registry unavailable')
      },
      checkInstallerFallback: async () => ({
        ok: true,
        currentVersion: '0.3.83-preview.old',
        latestVersion: '0.3.86-preview.new',
        channel: 'preview',
        available: true,
        packageName: 'vibemux-worker-preview',
        packageTag: 'preview',
        packageUrl: 'https://preview.example/install/worker/package.tgz',
        message: '检测到 installer 新版本 0.3.86-preview.new。',
      }),
    },
  )

  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(result.latestVersion, '0.3.86-preview.new')
  assert.equal(result.packageUrl, 'https://preview.example/install/worker/package.tgz')
})

test('checkNpmPackageUpdate falls back when npm dist-tag is missing', async () => {
  const result = await checkNpmPackageUpdate(
    '0.3.83-preview.old',
    'preview',
    'vibemux-worker-preview',
    'preview',
    {
      loadPackageMetadata: async () => ({ 'dist-tags': {} }),
      checkInstallerFallback: async () => ({
        ok: true,
        currentVersion: '0.3.83-preview.old',
        latestVersion: '0.3.86-preview.new',
        channel: 'preview',
        available: true,
        packageName: 'vibemux-worker-preview',
        packageTag: 'preview',
        packageUrl: 'https://preview.example/install/worker/package.tgz',
        message: '检测到 installer 新版本 0.3.86-preview.new。',
      }),
    },
  )

  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(result.latestVersion, '0.3.86-preview.new')
})

const withInstallerEnv = async (
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
) => {
  const keys = ['WEMUX_WORKER_INSTALLER_URL', 'VIBEMUX_WORKER_INSTALLER_URL', 'WEMUX_INSTALL_URL', 'VIBEMUX_INSTALL_URL']
  const saved = new Map(keys.map((key) => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  try {
    for (const key of keys) {
      delete process.env[key]
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        process.env[key] = value
      }
    }
    await run()
  } finally {
    for (const key of keys) {
      const value = saved.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    globalThis.fetch = originalFetch
  }
}

test('checkInstallerPackageUpdate follows the paired control plane when no override is set', async () => {
  await withInstallerEnv({}, async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), 'https://selfhosted.example/install/worker/manifest.json')
      return new Response(JSON.stringify({
        packageName: 'wemux-worker-preview',
        packageVersion: '0.3.131-new',
      }), { status: 200 })
    }) as typeof fetch

    const result = await checkInstallerPackageUpdate(
      '0.3.131-old',
      'preview',
      'wemux-worker-preview',
      'preview',
      { pairedCloudUrl: 'https://selfhosted.example/' },
    )

    assert.equal(result.ok, true)
    assert.equal(result.available, true)
    assert.equal(result.latestVersion, '0.3.131-new')
    assert.equal(result.packageUrl, 'https://selfhosted.example/install/worker/package.tgz')
  })
})

test('explicit installer URL env takes precedence over the paired control plane', async () => {
  await withInstallerEnv({ VIBEMUX_WORKER_INSTALLER_URL: 'https://override.example/install' }, async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), 'https://override.example/install/worker/manifest.json')
      return new Response(JSON.stringify({
        packageName: 'wemux-worker-preview',
        packageVersion: '0.3.131-new',
      }), { status: 200 })
    }) as typeof fetch

    const result = await checkInstallerPackageUpdate(
      '0.3.131-old',
      'preview',
      'wemux-worker-preview',
      'preview',
      { pairedCloudUrl: 'https://selfhosted.example' },
    )

    assert.equal(result.ok, true)
    assert.equal(result.available, true)
    assert.equal(result.packageUrl, 'https://override.example/install/worker/package.tgz')
  })
})

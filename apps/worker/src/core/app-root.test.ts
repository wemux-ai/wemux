import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { resolveNpmWorkerInstallPrefixFromAppRoot } from './app-root'

test('resolveNpmWorkerInstallPrefixFromAppRoot detects Windows npm global prefix layout', () => {
  const prefix = path.join(os.tmpdir(), 'vibemux-preview-worker-prefix')

  assert.equal(
    resolveNpmWorkerInstallPrefixFromAppRoot(
      path.join(prefix, 'node_modules', 'vibemux-worker-preview'),
      'vibemux-worker-preview',
    ),
    prefix,
  )
})

test('getWorkerLauncherPath uses the preview bin name on Windows preview installs', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-app-root-preview-'))
  const packageRoot = path.join(tempDir, 'lib', 'node_modules', 'vibemux-worker-preview')
  const tempModulePath = path.join(packageRoot, 'app-root.ts')
  const previousRuntimeRoot = process.env.VIBEMUX_RUNTIME_ROOT

  try {
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: 'vibemux-worker-preview',
      version: '0.0.0-test',
    })}\n`)
    writeFileSync(
      tempModulePath,
      readFileSync(new URL('./app-root.ts', import.meta.url), 'utf8'),
      'utf8',
    )

    process.env.VIBEMUX_RUNTIME_ROOT = packageRoot

    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })

    try {
      const { getWorkerLauncherPath } = await import(`${pathToFileURL(tempModulePath).href}?test=${Date.now()}`)
      const launcherPath = getWorkerLauncherPath()
      assert.match(launcherPath, /vibemux-worker-preview\.cmd$/)
      assert.doesNotMatch(launcherPath, /vibemux-worker-preview\/bin\//)
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, 'platform', originalPlatformDescriptor)
      }
    }
  } finally {
    if (previousRuntimeRoot === undefined) {
      delete process.env.VIBEMUX_RUNTIME_ROOT
    } else {
      process.env.VIBEMUX_RUNTIME_ROOT = previousRuntimeRoot
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

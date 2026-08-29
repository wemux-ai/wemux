import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildZellijAssetName,
  buildZellijDownloadUrl,
  ensureZellijBinary,
  extractZellijArchive,
  resolveCachedZellijBinary,
  resolveZellijDownloadBaseUrl,
  resolveZellijInstallDir,
  resolveZellijTarget,
} from './zellij-binary-manager'

const resolveMockArchiveTool = (command: string) => {
  if (process.platform === 'win32') {
    return command === 'powershell.exe' || command === 'powershell' ? 'powershell.exe' : null
  }
  return command === 'tar' ? '/usr/bin/tar' : null
}

test('resolveZellijTarget maps supported Node platforms to release targets', () => {
  assert.equal(resolveZellijTarget('linux', 'x64'), 'x86_64-unknown-linux-musl')
  assert.equal(resolveZellijTarget('linux', 'arm64'), 'aarch64-unknown-linux-musl')
  assert.equal(resolveZellijTarget('darwin', 'x64'), 'x86_64-apple-darwin')
  assert.equal(resolveZellijTarget('darwin', 'arm64'), 'aarch64-apple-darwin')
  assert.equal(resolveZellijTarget('freebsd', 'x64'), '')
})

test('resolveZellijTarget reports no win32 target since Windows uses plain PTY', () => {
  assert.equal(resolveZellijTarget('win32', 'x64'), '')
  assert.equal(resolveZellijTarget('win32', 'arm64'), '')
  assert.equal(buildZellijAssetName({ platform: 'win32', arch: 'x64' }), '')
  assert.equal(buildZellijDownloadUrl({ platform: 'win32', arch: 'x64' }), '')
})

test('buildZellijAssetName prefers no-web release archives', () => {
  assert.equal(buildZellijAssetName({
    platform: 'linux',
    arch: 'x64',
  }), 'zellij-no-web-x86_64-unknown-linux-musl.tar.gz')
  assert.equal(buildZellijAssetName({
    platform: 'darwin',
    arch: 'arm64',
    noWeb: false,
  }), 'zellij-aarch64-apple-darwin.tar.gz')
})

test('buildZellijDownloadUrl points at the release asset', () => {
  assert.equal(
    buildZellijDownloadUrl({
      version: '0.44.3',
      platform: 'linux',
      arch: 'x64',
      baseUrl: 'https://downloads.example.com/zellij',
    }),
    'https://downloads.example.com/zellij/v0.44.3/zellij-no-web-x86_64-unknown-linux-musl.tar.gz',
  )
})

test('resolveZellijDownloadBaseUrl prefers an explicit mirror, then env, then upstream', () => {
  const env = { VIBEMUX_ZELLIJ_DOWNLOAD_BASE_URL: 'https://mirror.internal/zellij' }

  assert.equal(
    resolveZellijDownloadBaseUrl('https://explicit.example.com/z', env),
    'https://explicit.example.com/z',
  )
  assert.equal(resolveZellijDownloadBaseUrl(undefined, env), 'https://mirror.internal/zellij')
  assert.equal(resolveZellijDownloadBaseUrl('   ', env), 'https://mirror.internal/zellij')
  assert.equal(
    resolveZellijDownloadBaseUrl(undefined, {}),
    'https://github.com/zellij-org/zellij/releases/download',
  )
})

test('extractZellijArchive uses platform extraction tools', () => {
  const calls: Array<{ command: string; args: string[] }> = []
  extractZellijArchive('/tmp/zellij.tar.gz', '/tmp/zellij', {
    resolveExecutable: (command) => command === 'tar' ? '/usr/bin/tar' : null,
    runCommand: (command, args) => {
      calls.push({ command, args })
      return { ok: true, stdout: '', stderr: '' }
    },
  }, 'linux')

  assert.equal(calls[0]?.command, '/usr/bin/tar')
  assert.deepEqual(calls[0]?.args, ['-xzf', '/tmp/zellij.tar.gz', '-C', '/tmp/zellij'])
})

test('resolveCachedZellijBinary finds a cached worker runtime binary', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-cache-'))
  try {
    const installDir = resolveZellijInstallDir({
      workspaceRoot: root,
      version: 'v0.44.3',
      platform: process.platform,
      arch: process.arch,
    })
    mkdirSync(installDir, { recursive: true })
    const binaryPath = path.join(installDir, process.platform === 'win32' ? 'zellij.exe' : 'zellij')
    writeFileSync(binaryPath, '')
    if (process.platform !== 'win32') {
      chmodSync(binaryPath, 0o755)
    }

    const resolved = resolveCachedZellijBinary({
      workspaceRoot: root,
      version: 'v0.44.3',
    })
    assert.equal(resolved?.binaryPath, binaryPath)
    assert.equal(resolved?.version, 'v0.44.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureZellijBinary coalesces concurrent downloads for the same target', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-singleflight-'))
  try {
    let archiveFetchCount = 0
    let extractCount = 0
    const archiveBytes = new TextEncoder().encode('fake archive')
    const binaryBytes = new TextEncoder().encode('fake zellij binary')
    const binaryDigest = createHash('sha256').update(binaryBytes).digest('hex')
    const [first, second] = await Promise.all([
      ensureZellijBinary({
        workspaceRoot: root,
        fetchImpl: async (url) => {
          if (String(url).endsWith('.sha256sum')) {
            return new Response(`${binaryDigest}  zellij\n`)
          }
          archiveFetchCount += 1
          await new Promise((resolve) => setTimeout(resolve, 20))
          return new Response(archiveBytes)
        },
        resolveExecutable: resolveMockArchiveTool,
        runCommand: () => {
          extractCount += 1
          const installDir = resolveZellijInstallDir({ workspaceRoot: root })
          mkdirSync(installDir, { recursive: true })
          const binaryPath = path.join(installDir, process.platform === 'win32' ? 'zellij.exe' : 'zellij')
          writeFileSync(binaryPath, binaryBytes)
          if (process.platform !== 'win32') {
            chmodSync(binaryPath, 0o755)
          }
          return { ok: true, stdout: '', stderr: '' }
        },
      }),
      ensureZellijBinary({
        workspaceRoot: root,
        fetchImpl: async (url) => {
          if (String(url).endsWith('.sha256sum')) {
            return new Response(`${binaryDigest}  zellij\n`)
          }
          archiveFetchCount += 1
          return new Response(archiveBytes)
        },
        resolveExecutable: resolveMockArchiveTool,
        runCommand: () => {
          extractCount += 1
          return { ok: true, stdout: '', stderr: '' }
        },
      }),
    ])

    assert.equal(first.binaryPath, second.binaryPath)
    assert.equal(archiveFetchCount, 1)
    assert.equal(extractCount, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureZellijBinary verifies the extracted binary against upstream sha256sum files', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-checksum-'))
  try {
    const archiveBytes = new TextEncoder().encode('fake archive')
    const binaryBytes = new TextEncoder().encode('fake zellij binary')
    const binaryDigest = createHash('sha256').update(binaryBytes).digest('hex')
    let checksumUrl = ''
    const resolved = await ensureZellijBinary({
      workspaceRoot: root,
      fetchImpl: async (url) => {
        if (String(url).endsWith('.sha256sum')) {
          checksumUrl = String(url)
          return new Response(`${binaryDigest}  zellij\n`)
        }
        return new Response(archiveBytes)
      },
      resolveExecutable: resolveMockArchiveTool,
      runCommand: () => {
        const installDir = resolveZellijInstallDir({ workspaceRoot: root })
        mkdirSync(installDir, { recursive: true })
        const binaryPath = path.join(installDir, process.platform === 'win32' ? 'zellij.exe' : 'zellij')
        writeFileSync(binaryPath, binaryBytes)
        if (process.platform !== 'win32') {
          chmodSync(binaryPath, 0o755)
        }
        return { ok: true, stdout: '', stderr: '' }
      },
    })

    assert.ok(resolved.binaryPath.endsWith(process.platform === 'win32' ? 'zellij.exe' : 'zellij'))
    assert.match(checksumUrl, /zellij-no-web-[^.]+\.sha256sum$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureZellijBinary falls back to the full archive after a no-web checksum mismatch', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-checksum-fallback-'))
  try {
    const archiveBytes = new TextEncoder().encode('fake archive')
    const binaryBytes = new TextEncoder().encode('fake zellij binary')
    const binaryDigest = createHash('sha256').update(binaryBytes).digest('hex')
    const archiveUrls: string[] = []
    const resolved = await ensureZellijBinary({
      workspaceRoot: root,
      fetchImpl: async (url) => {
        const requestUrl = String(url)
        if (requestUrl.endsWith('.sha256sum')) {
          return new Response(requestUrl.includes('zellij-no-web-')
            ? `${'0'.repeat(64)}  zellij\n`
            : `${binaryDigest}  zellij\n`)
        }
        archiveUrls.push(requestUrl)
        return new Response(archiveBytes)
      },
      resolveExecutable: resolveMockArchiveTool,
      runCommand: () => {
        const installDir = resolveZellijInstallDir({ workspaceRoot: root })
        const binaryPath = path.join(installDir, process.platform === 'win32' ? 'zellij.exe' : 'zellij')
        writeFileSync(binaryPath, binaryBytes)
        return { ok: true, stdout: '', stderr: '' }
      },
    })

    assert.ok(resolved.binaryPath.endsWith(process.platform === 'win32' ? 'zellij.exe' : 'zellij'))
    assert.equal(archiveUrls.length, 2)
    assert.match(archiveUrls[0] || '', /zellij-no-web-/)
    assert.doesNotMatch(archiveUrls[1] || '', /zellij-no-web-/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureZellijBinary rejects checksum mismatches', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-zellij-checksum-mismatch-'))
  try {
    const archiveBytes = new TextEncoder().encode('fake archive')
    await assert.rejects(
      ensureZellijBinary({
        workspaceRoot: root,
        fetchImpl: async (url) => String(url).endsWith('.sha256sum')
          ? new Response(`${'0'.repeat(64)}  zellij\n`)
          : new Response(archiveBytes),
        resolveExecutable: (command) => command === 'tar' ? '/usr/bin/tar' : null,
        runCommand: () => {
          const installDir = resolveZellijInstallDir({ workspaceRoot: root })
          mkdirSync(installDir, { recursive: true })
          const binaryPath = path.join(installDir, process.platform === 'win32' ? 'zellij.exe' : 'zellij')
          writeFileSync(binaryPath, 'fake zellij binary')
          if (process.platform !== 'win32') {
            chmodSync(binaryPath, 0o755)
          }
          return { ok: true, stdout: '', stderr: '' }
        },
      }),
      /checksum mismatch/,
    )
    assert.equal(resolveCachedZellijBinary({ workspaceRoot: root }), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

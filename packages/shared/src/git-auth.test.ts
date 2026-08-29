import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildGitSshCommandArgs,
  createGitAuthContext,
  createSshCommand,
  isSshGitRemoteUrl,
  resolveGitRemoteHost,
  resolveGitCertificateAuthorityEnv,
  rewriteGitCredentialError,
} from './git-auth'

test('recognizes Codeup SSH repository URLs without treating HTTPS as SSH', () => {
  assert.equal(isSshGitRemoteUrl('git@codeup.aliyun.com:team/repo.git'), true)
  assert.equal(isSshGitRemoteUrl('ssh://git@codeup.aliyun.com/team/repo.git'), true)
  assert.equal(isSshGitRemoteUrl('https://codeup.aliyun.com/team/repo.git'), false)
  assert.equal(resolveGitRemoteHost('git@codeup.aliyun.com:team/repo.git'), 'codeup.aliyun.com')
})

test('builds non-interactive SSH arguments with persistent host-key checking', () => {
  const args = buildGitSshCommandArgs('/tmp/key file', '/tmp/known hosts')
  assert.deepEqual(args, [
    '-i',
    '/tmp/key file',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'UserKnownHostsFile=/tmp/known hosts',
  ])

  const command = createSshCommand('/tmp/key file', '/tmp/known hosts')
  assert.match(command, /StrictHostKeyChecking=accept-new/)
  assert.doesNotMatch(command, /StrictHostKeyChecking=no/)
})

test('creates SSH auth context with the supplied persistent known_hosts file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-ssh-context-'))
  const knownHostsFile = path.join(root, 'node', 'cache', 'git', 'known_hosts')
  const context = createGitAuthContext({
    taskId: 'git-auth-test',
    identity: {
      mode: 'personal',
      authMode: 'ssh',
      credentialToken: 'test-private-key',
    },
    repoUrl: 'git@codeup.aliyun.com:team/repo.git',
    knownHostsFile,
  })

  try {
    assert.equal(context.knownHostsFile, knownHostsFile)
    assert.equal(existsSync(knownHostsFile), true)
    assert.match(context.env.GIT_SSH_COMMAND || '', /UserKnownHostsFile=/)
  } finally {
    context.cleanup()
    rmSync(root, { recursive: true, force: true })
  }
})

test('rewriteGitCredentialError rewrites HTTPS certificate verification failures', () => {
  const error = rewriteGitCredentialError(
    new Error("fatal: unable to access 'https://github.com/example-org/example-repo.git/': server certificate verification failed. CAfile: none CRLfile: none"),
    'https://github.com/example-org/example-repo.git',
  )

  assert.match(error.message, /无法验证 GitHub 仓库的 HTTPS 证书/)
  assert.match(error.message, /http\.sslCAInfo/)
  assert.match(error.message, /改用 SSH 仓库地址/)
})

test('rewriteGitCredentialError keeps credential guidance for PAT failures', () => {
  const error = rewriteGitCredentialError(
    new Error('remote: Invalid username or token. fatal: Authentication failed'),
    'https://github.com/example-org/example-repo.git',
  )

  assert.match(error.message, /当前凭证无法访问 GitHub 仓库/)
})

test('rewriteGitCredentialError preserves unrelated errors', () => {
  const source = new Error('some unrelated git error')
  const error = rewriteGitCredentialError(source, 'https://github.com/example-org/example-repo.git')

  assert.equal(error, source)
})

test('resolveGitCertificateAuthorityEnv keeps explicit certificate env untouched', () => {
  const result = resolveGitCertificateAuthorityEnv({
    GIT_SSL_CAINFO: '/custom/certs.pem',
  })

  assert.deepEqual(result, {})
})

test('resolveGitCertificateAuthorityEnv discovers a fallback CA bundle when none is configured', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-ca-'))
  const certificateBundle = path.join(tempDir, 'cert.pem')
  writeFileSync(certificateBundle, 'dummy cert')

  try {
    const result = resolveGitCertificateAuthorityEnv({}, [certificateBundle])
    assert.deepEqual(result, {
      GIT_SSL_CAINFO: certificateBundle,
      SSL_CERT_FILE: certificateBundle,
      CURL_CA_BUNDLE: certificateBundle,
    })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('resolveGitCertificateAuthorityEnv generates a CA bundle from Node roots when no candidate path exists', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vibemux-git-ca-generated-'))
  const generatedBundle = path.join(tempDir, 'generated.pem')

  try {
    const result = resolveGitCertificateAuthorityEnv({}, [], generatedBundle)
    assert.equal(result.GIT_SSL_CAINFO, generatedBundle)
    assert.equal(result.SSL_CERT_FILE, generatedBundle)
    assert.equal(result.CURL_CA_BUNDLE, generatedBundle)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

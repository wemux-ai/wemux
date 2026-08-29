import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGitIdentityDiagnosticMessage,
  selectCredentialForProjectCore,
} from './task-git-identity'
import type { GitCredential } from '../services/git-credential-store'
import type { GitHubAppInstallation } from '../services/github-app-installation-store'
import type { ProjectGitCredentialBinding } from '../services/project-git-binding-store'

const now = '2026-06-08T00:00:00.000Z'

const GIT_HUB_REPO_URL = 'https://github.com/acme/demo.git'
const GIT_LAB_REPO_URL = 'https://gitlab.com/acme/demo.git'

const createCredential = (overrides: Partial<GitCredential> = {}): GitCredential => ({
  id: 'credential-1',
  userId: 'user-1',
  label: 'GitHub PAT',
  provider: 'github',
  host: 'github.com',
  authMode: 'pat',
  name: 'Alice Dev',
  email: 'alice@example.com',
  isDefault: false,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const createSshCredential = (overrides: Partial<GitCredential> = {}): GitCredential => createCredential({
  id: 'ssh-1',
  label: 'GitHub SSH',
  authMode: 'ssh',
  sshPublicKey: 'ssh-ed25519 AAAA',
  sshPrivateKey: 'private-key',
  activatedAt: now,
  ...overrides,
})

const createBinding = (overrides: Partial<ProjectGitCredentialBinding> = {}): ProjectGitCredentialBinding => ({
  id: 'binding-1',
  projectId: 'project-1',
  userId: 'user-1',
  authSourceType: 'user-credential',
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const createInstallation = (overrides: Partial<GitHubAppInstallation> = {}): GitHubAppInstallation => ({
  installationId: 42,
  accountLogin: 'acme',
  accountType: 'Organization',
  provider: 'github',
  providerHost: 'github.com',
  repositorySelection: 'selected',
  permissions: {},
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

test('selectCredentialForProjectCore: no binding and no credentials → no-binding', () => {
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'no-binding' })
})

test('selectCredentialForProjectCore: no binding with only inactive ssh credential → credential-inactive', () => {
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [createSshCredential({ activatedAt: undefined })],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'credential-inactive' })
})

test('selectCredentialForProjectCore: no binding, credentials exist but repo host mismatch → host-mismatch', () => {
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [createCredential({ host: 'gitlab.com' })],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'host-mismatch' })
})

test('selectCredentialForProjectCore: no binding, single usable credential without repo url → selected', () => {
  const credential = createCredential()
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [credential],
  }), { credential: { authSourceType: 'user-credential', credential } })
})

test('selectCredentialForProjectCore: no binding, host matching single credential → selected', () => {
  const credential = createCredential()
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [credential],
    repoUrl: GIT_HUB_REPO_URL,
  }), { credential: { authSourceType: 'user-credential', credential } })
})

test('selectCredentialForProjectCore: no binding, default credential wins among host candidates', () => {
  const defaultCredential = createCredential({ id: 'default-1', isDefault: true })
  const otherCredential = createCredential({ id: 'other-1' })
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [otherCredential, defaultCredential],
    repoUrl: GIT_HUB_REPO_URL,
  }), { credential: { authSourceType: 'user-credential', credential: defaultCredential } })
})

test('selectCredentialForProjectCore: bound inactive ssh credential → credential-inactive', () => {
  const boundCredential = createSshCredential({ activatedAt: undefined })
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'user-credential', credentialId: boundCredential.id }),
    installation: null,
    boundCredential,
    allCredentials: [],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'credential-inactive' })
})

test('selectCredentialForProjectCore: bound credential inactive but usable fallback matches → fallback selected', () => {
  const boundCredential = createSshCredential({ activatedAt: undefined })
  const fallbackCredential = createCredential({ id: 'pat-1' })
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'user-credential', credentialId: boundCredential.id }),
    installation: null,
    boundCredential,
    allCredentials: [fallbackCredential],
    repoUrl: GIT_HUB_REPO_URL,
  }), { credential: { authSourceType: 'user-credential', credential: fallbackCredential } })
})

test('selectCredentialForProjectCore: bound credential host mismatch without fallback → host-mismatch', () => {
  const boundCredential = createCredential({ host: 'gitlab.com' })
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'user-credential', credentialId: boundCredential.id }),
    installation: null,
    boundCredential,
    allCredentials: [],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'host-mismatch' })
})

test('selectCredentialForProjectCore: github-app binding with missing installation → binding-installation-missing', () => {
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'github-app-installation', githubInstallationId: 42 }),
    installation: null,
    boundCredential: null,
    allCredentials: [],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'binding-installation-missing' })
})

test('selectCredentialForProjectCore: github-app binding with matching installation → selected', () => {
  const binding = createBinding({ authSourceType: 'github-app-installation', githubInstallationId: 42 })
  const installation = createInstallation()
  assert.deepEqual(selectCredentialForProjectCore({
    binding,
    installation,
    boundCredential: null,
    allCredentials: [],
    repoUrl: GIT_HUB_REPO_URL,
  }), { credential: { authSourceType: 'github-app-installation', binding, installation } })
})

test('selectCredentialForProjectCore: github-app binding installation host mismatch without fallback → host-mismatch', () => {
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'github-app-installation', githubInstallationId: 42 }),
    installation: createInstallation({ providerHost: 'gitlab.com' }),
    boundCredential: null,
    allCredentials: [],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'host-mismatch' })
})

test('selectCredentialForProjectCore: github-app binding installation missing but usable fallback matches → fallback selected', () => {
  const fallbackCredential = createCredential({ id: 'pat-1' })
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'github-app-installation', githubInstallationId: 42 }),
    installation: null,
    boundCredential: null,
    allCredentials: [fallbackCredential],
    repoUrl: GIT_HUB_REPO_URL,
  }), { credential: { authSourceType: 'user-credential', credential: fallbackCredential } })
})

test('selectCredentialForProjectCore: bound usable credential with matching host → selected', () => {
  const boundCredential = createCredential({ id: 'bound-pat' })
  assert.deepEqual(selectCredentialForProjectCore({
    binding: createBinding({ authSourceType: 'user-credential', credentialId: boundCredential.id }),
    installation: null,
    boundCredential,
    allCredentials: [createCredential({ id: 'other' })],
    repoUrl: GIT_HUB_REPO_URL,
  }), { credential: { authSourceType: 'user-credential', credential: boundCredential } })
})

test('selectCredentialForProjectCore: multiple host candidates without default → no-binding', () => {
  assert.deepEqual(selectCredentialForProjectCore({
    binding: null,
    installation: null,
    boundCredential: null,
    allCredentials: [createCredential({ id: 'a' }), createCredential({ id: 'b' })],
    repoUrl: GIT_HUB_REPO_URL,
  }), { reason: 'no-binding' })
})

test('buildGitIdentityDiagnosticMessage includes the unified settings guidance tail', () => {
  const guidance = '请在设置页配置 Git 权限（GitHub App 或 PAT）。'
  for (const code of ['no-binding', 'host-mismatch', 'credential-inactive', 'binding-installation-missing'] as const) {
    const message = buildGitIdentityDiagnosticMessage(code)
    assert.ok(message.endsWith(guidance), `${code} message should end with guidance`)
    assert.equal(message.length, message.length)
  }

  assert.match(buildGitIdentityDiagnosticMessage('no-binding'), /项目未绑定/)
  assert.match(buildGitIdentityDiagnosticMessage('host-mismatch'), /host/)
  assert.match(buildGitIdentityDiagnosticMessage('credential-inactive'), /SSH/)
  assert.match(buildGitIdentityDiagnosticMessage('binding-installation-missing'), /GitHub App/)
})

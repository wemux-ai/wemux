import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import {
  buildGitHubAppOAuthAuthorizeUrl,
  exchangeGitHubAppOAuthCode,
  fetchGitHubAppInstallationRepositories,
  fetchGitHubAppUserInstallations,
  fetchGitHubAppUserRepositories,
  isGitHubAppUserInstallationAccessible,
  resolveGitHubAppAgentCoAuthorIdentity,
  resolveGitHubAppCommitIdentity,
} from './github-app-service'

const withGitHubAppEnv = (env: Record<string, string | undefined>, run: () => void) => {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key])
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

const withGitHubAppEnvAsync = async <T>(env: Record<string, string | undefined>, run: () => Promise<T>) => {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key])
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

test('resolveGitHubAppCommitIdentity defaults to the app bot login', () => {
  withGitHubAppEnv({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'vibemux-dev',
    GITHUB_APP_PRIVATE_KEY: 'private-key',
    GITHUB_APP_BOT_LOGIN: undefined,
    GITHUB_APP_BOT_EMAIL: undefined,
    VIBEMUX_GITHUB_APP_BOT_LOGIN: undefined,
    VIBEMUX_GITHUB_APP_BOT_EMAIL: undefined,
  }, () => {
    assert.deepEqual(resolveGitHubAppCommitIdentity(), {
      name: 'vibemux-dev[bot]',
      email: 'vibemux-dev[bot]@users.noreply.github.com',
    })
  })
})

test('resolveGitHubAppCommitIdentity prefers the acting user identity', () => {
  assert.deepEqual(resolveGitHubAppCommitIdentity({
    name: 'Alice Dev',
    email: 'alice@example.com',
  }), {
    name: 'Alice Dev',
    email: 'alice@example.com',
  })
})

test('resolveGitHubAppCommitIdentity allows an explicit bot identity override', () => {
  withGitHubAppEnv({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'vibemux-dev',
    GITHUB_APP_PRIVATE_KEY: 'private-key',
    GITHUB_APP_BOT_LOGIN: 'Vibemux Automation',
    GITHUB_APP_BOT_EMAIL: '123456+vibemux-dev[bot]@users.noreply.github.com',
  }, () => {
    assert.deepEqual(resolveGitHubAppCommitIdentity(), {
      name: 'Vibemux Automation',
      email: '123456+vibemux-dev[bot]@users.noreply.github.com',
    })
  })
})

test('resolveGitHubAppAgentCoAuthorIdentity uses the configured production app bot identity', () => {
  withGitHubAppEnv({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'vibemux-dev',
    GITHUB_APP_PRIVATE_KEY: 'private-key',
    GITHUB_APP_BOT_LOGIN: 'Vibemux',
    GITHUB_APP_BOT_EMAIL: '289628643+vibemux[bot]@users.noreply.github.com',
  }, () => {
    assert.deepEqual(resolveGitHubAppAgentCoAuthorIdentity(), {
      name: 'Vibemux',
      email: '289628643+vibemux[bot]@users.noreply.github.com',
    })
  })
})

test('fetchGitHubAppInstallationRepositories returns normalized clone choices', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []

  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://api.github.test/app/installations/42/access_tokens') {
      return Response.json({ token: 'installation-token', expires_at: '2026-06-07T12:00:00Z' })
    }
    if (url === 'https://api.github.test/installation/repositories?per_page=100&page=1') {
      return Response.json({
        repositories: [
          {
            id: 2,
            name: 'beta',
            full_name: 'acme/beta',
            private: true,
            archived: false,
            disabled: false,
            fork: false,
            default_branch: 'main',
            html_url: 'https://github.test/acme/beta',
            clone_url: 'https://github.test/acme/beta.git',
            ssh_url: 'git@github.test:acme/beta.git',
            owner: { login: 'acme' },
          },
          {
            id: 1,
            name: 'alpha',
            full_name: 'acme/alpha',
            private: false,
            archived: false,
            disabled: false,
            fork: false,
            default_branch: 'dev',
            html_url: 'https://github.test/acme/alpha',
            clone_url: 'https://github.test/acme/alpha.git',
            owner: { login: 'acme' },
          },
        ],
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  try {
    await withGitHubAppEnvAsync({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_SLUG: 'vibemux-dev',
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
      GITHUB_APP_API_BASE_URL: 'https://api.github.test',
      GITHUB_APP_WEB_BASE_URL: 'https://github.test',
    }, async () => {
      const repositories = await fetchGitHubAppInstallationRepositories(42)
      assert.deepEqual(calls, [
        'https://api.github.test/app/installations/42/access_tokens',
        'https://api.github.test/installation/repositories?per_page=100&page=1',
      ])
      assert.deepEqual(repositories.map((repository) => repository.fullName), ['acme/alpha', 'acme/beta'])
      assert.equal(repositories[0].cloneUrl, 'https://github.test/acme/alpha.git')
      assert.equal(repositories[1].private, true)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('buildGitHubAppOAuthAuthorizeUrl includes client id, state and callback url', () => {
  withGitHubAppEnv({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'vibemux-dev',
    GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    GITHUB_APP_WEB_BASE_URL: 'https://github.test',
    GITHUB_APP_CLIENT_ID: 'client-abc',
    GITHUB_APP_CLIENT_SECRET: 'secret-xyz',
    GITHUB_APP_CALLBACK_URL: 'https://server.test/api/user/github-app-installations/callback',
  }, () => {
    const url = buildGitHubAppOAuthAuthorizeUrl('state-1')
    assert.equal(url, 'https://github.test/login/oauth/authorize?client_id=client-abc&state=state-1&redirect_uri=https%3A%2F%2Fserver.test%2Fapi%2Fuser%2Fgithub-app-installations%2Fcallback')
  })
})

test('buildGitHubAppOAuthAuthorizeUrl omits redirect_uri when callback url is not configured', () => {
  withGitHubAppEnv({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'vibemux-dev',
    GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    GITHUB_APP_WEB_BASE_URL: 'https://github.test',
    GITHUB_APP_CLIENT_ID: 'client-abc',
    GITHUB_APP_CLIENT_SECRET: 'secret-xyz',
  }, () => {
    const url = buildGitHubAppOAuthAuthorizeUrl('state-2')
    assert.equal(url, 'https://github.test/login/oauth/authorize?client_id=client-abc&state=state-2')
  })
})

test('exchangeGitHubAppOAuthCode exchanges code for a user access token', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: string | null = null

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://github.test/login/oauth/access_token')
    requestBody = String(init?.body)
    return Response.json({
      access_token: 'user-token-1',
      token_type: 'bearer',
      scope: '',
    })
  }

  try {
    await withGitHubAppEnvAsync({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_SLUG: 'vibemux-dev',
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
      GITHUB_APP_WEB_BASE_URL: 'https://github.test',
      GITHUB_APP_CLIENT_ID: 'client-abc',
      GITHUB_APP_CLIENT_SECRET: 'secret-xyz',
    }, async () => {
      const result = await exchangeGitHubAppOAuthCode('code-1')
      assert.equal(result.accessToken, 'user-token-1')
      assert.equal(result.refreshToken, undefined)
      assert.equal(result.expiresAt, undefined)
      assert.ok(requestBody?.includes('client_id=client-abc'))
      assert.ok(requestBody?.includes('client_secret=secret-xyz'))
      assert.ok(requestBody?.includes('code=code-1'))
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('exchangeGitHubAppOAuthCode keeps refresh token and expiry when provided', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () => Response.json({
    access_token: 'user-token-2',
    token_type: 'bearer',
    expires_in: 28800,
    refresh_token: 'refresh-token-2',
    refresh_token_expires_in: 15811200,
  })

  try {
    await withGitHubAppEnvAsync({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_SLUG: 'vibemux-dev',
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
      GITHUB_APP_WEB_BASE_URL: 'https://github.test',
      GITHUB_APP_CLIENT_ID: 'client-abc',
      GITHUB_APP_CLIENT_SECRET: 'secret-xyz',
    }, async () => {
      const result = await exchangeGitHubAppOAuthCode('code-2')
      assert.equal(result.accessToken, 'user-token-2')
      assert.equal(result.refreshToken, 'refresh-token-2')
      assert.ok(result.expiresAt && result.expiresAt > new Date().toISOString())
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchGitHubAppUserRepositories aggregates repositories across accessible installations', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []

  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://api.github.test/user/installations?per_page=100&page=1') {
      return Response.json({
        total_count: 2,
        installations: [
          { id: 11, account: { id: 1, login: 'alice', type: 'User' }, repository_selection: 'all' },
          { id: 22, account: { id: 2, login: 'bob', type: 'User' }, repository_selection: 'selected' },
        ],
      })
    }
    if (url === 'https://api.github.test/user/installations/11/repositories?per_page=100&page=1') {
      return Response.json({
        repositories: [
          {
            id: 1,
            name: 'own-repo',
            full_name: 'alice/own-repo',
            private: true,
            archived: false,
            disabled: false,
            fork: false,
            default_branch: 'main',
            clone_url: 'https://github.test/alice/own-repo.git',
            owner: { login: 'alice' },
          },
        ],
      })
    }
    if (url === 'https://api.github.test/user/installations/22/repositories?per_page=100&page=1') {
      return Response.json({
        repositories: [
          {
            id: 2,
            name: 'shared-repo',
            full_name: 'bob/shared-repo',
            private: true,
            archived: false,
            disabled: false,
            fork: false,
            default_branch: 'main',
            clone_url: 'https://github.test/bob/shared-repo.git',
            owner: { login: 'bob' },
          },
          {
            id: 1,
            name: 'own-repo',
            full_name: 'alice/own-repo',
            private: true,
            archived: false,
            disabled: false,
            fork: false,
            default_branch: 'main',
            clone_url: 'https://github.test/alice/own-repo.git',
            owner: { login: 'alice' },
          },
        ],
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  try {
    await withGitHubAppEnvAsync({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_SLUG: 'vibemux-dev',
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
      GITHUB_APP_API_BASE_URL: 'https://api.github.test',
      GITHUB_APP_WEB_BASE_URL: 'https://github.test',
    }, async () => {
      const repositories = await fetchGitHubAppUserRepositories('user-token')
      assert.deepEqual(calls.slice(0, 2), [
        'https://api.github.test/user/installations?per_page=100&page=1',
        'https://api.github.test/user/installations/11/repositories?per_page=100&page=1',
      ])
      // 协作仓库 bob/shared-repo 出现在聚合列表里，且带提供访问的 installation id
      assert.deepEqual(repositories.map((repository) => repository.fullName), ['alice/own-repo', 'bob/shared-repo'])
      assert.equal(repositories[0].installationId, 11)
      assert.equal(repositories[1].installationId, 22)
      // 同一仓库跨多个安装出现时只保留一次
      assert.equal(repositories.length, 2)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('isGitHubAppUserInstallationAccessible checks the accessible installation list', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === 'https://api.github.test/user/installations?per_page=100&page=1') {
      return Response.json({
        installations: [
          { id: 11, account: { id: 1, login: 'alice', type: 'User' }, repository_selection: 'all' },
          { id: 22, account: { id: 2, login: 'bob', type: 'User' }, repository_selection: 'selected' },
        ],
      })
    }
    return Response.json({ installations: [] })
  }

  try {
    await withGitHubAppEnvAsync({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_SLUG: 'vibemux-dev',
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
      GITHUB_APP_API_BASE_URL: 'https://api.github.test',
      GITHUB_APP_WEB_BASE_URL: 'https://github.test',
    }, async () => {
      assert.equal(await isGitHubAppUserInstallationAccessible('user-token', 22), true)
      assert.equal(await isGitHubAppUserInstallationAccessible('user-token', 99), false)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchGitHubAppUserInstallations normalizes installation summaries', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () => Response.json({
    total_count: 1,
    installations: [
      { id: 33, account: { id: 3, login: 'acme-org', type: 'Organization' }, repository_selection: 'selected', suspended_at: null },
    ],
  })

  try {
    await withGitHubAppEnvAsync({
      GITHUB_APP_ID: '12345',
      GITHUB_APP_SLUG: 'vibemux-dev',
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
      GITHUB_APP_API_BASE_URL: 'https://api.github.test',
      GITHUB_APP_WEB_BASE_URL: 'https://github.test',
    }, async () => {
      const installations = await fetchGitHubAppUserInstallations('user-token')
      assert.equal(installations.length, 1)
      assert.equal(installations[0].installationId, 33)
      assert.equal(installations[0].accountLogin, 'acme-org')
      assert.equal(installations[0].accountType, 'Organization')
      assert.equal(installations[0].repositorySelection, 'selected')
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

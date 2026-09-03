import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { Hono } from 'hono'
import {
  getGitHubAppInstallationById,
  upsertGitHubAppInstallation,
} from '../services/github-app-installation-store'
import { registerGitHubWebhookRoutes } from './github-webhook-routes'

// ── DB 集成（本地 Postgres 可用时执行，与 global-search-service.test.ts 同模式）──

const resolveDbUrl = () => process.env.DATABASE_URL?.trim()
  || process.env.POSTGRES_URL?.trim()
  || 'postgres://vibemux:vibemux@127.0.0.1:5434/vibemux'

let dbAvailable: boolean | null = null
const isDbAvailable = async (): Promise<boolean> => {
  if (dbAvailable !== null) {
    return dbAvailable
  }
  try {
    process.env.DATABASE_URL = resolveDbUrl()
    const { getDrizzleDb } = await import('../storage/postgres/drizzle-db')
    const { sql } = await import('drizzle-orm')
    await getDrizzleDb().execute(sql`select 1`)
    dbAvailable = true
  } catch {
    dbAvailable = false
  }
  return dbAvailable
}

const dbSkip = async () => (await isDbAvailable()) ? false : '本地 Postgres 不可用，跳过 DB 集成用例'

const WEBHOOK_SECRET = 'test-webhook-secret'

const setWebhookEnv = () => {
  const previous = process.env.GITHUB_WEBHOOK_SECRET
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET
  return () => {
    if (previous === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previous
    }
  }
}

const createApp = () => {
  const app = new Hono()
  registerGitHubWebhookRoutes(app)
  return app
}

const signPayload = (rawBody: string) =>
  `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`

const postWebhook = async (event: string, payload: unknown, signature?: string) => {
  const rawBody = JSON.stringify(payload)
  const app = createApp()
  return await app.request('/api/github/webhooks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-Hub-Signature-256': signature ?? signPayload(rawBody),
    },
    body: rawBody,
  })
}

test('installation webhook rejects an invalid signature', async () => {
  const restoreEnv = setWebhookEnv()
  try {
    const response = await postWebhook('installation', { action: 'created', installation: { id: 1 } }, 'sha256=invalid')
    assert.equal(response.status, 401)
  } finally {
    restoreEnv()
  }
})

test('installation webhook created action upserts the installation record', async () => {
  if (await dbSkip()) {
    return
  }
  const restoreEnv = setWebhookEnv()
  const installationId = 160000000 + Math.floor(Math.random() * 1000000)
  try {
    const response = await postWebhook('installation', {
      action: 'created',
      installation: {
        id: installationId,
        account: { login: 'octocat', id: 9527, type: 'Organization' },
        repository_selection: 'selected',
        permissions: { contents: 'read', metadata: 'read' },
        suspended_at: null,
      },
    })

    assert.equal(response.status, 200)
    const installation = await getGitHubAppInstallationById(installationId)
    assert.equal(installation?.accountLogin, 'octocat')
    assert.equal(installation?.accountType, 'Organization')
    assert.equal(installation?.repositorySelection, 'selected')
  } finally {
    restoreEnv()
    const { deleteGitHubAppInstallationEverywhere } = await import('../services/github-app-installation-store')
    await deleteGitHubAppInstallationEverywhere(installationId)
  }
})

test('installation webhook deleted action removes installations, links and bindings', async () => {
  if (await dbSkip()) {
    return
  }
  const restoreEnv = setWebhookEnv()
  const installationId = 170000000 + Math.floor(Math.random() * 1000000)
  try {
    await upsertGitHubAppInstallation({
      installationId,
      accountId: 9527,
      accountLogin: 'octocat',
      accountType: 'User',
      repositorySelection: 'all',
      permissions: { contents: 'read' },
    })
    assert.ok(await getGitHubAppInstallationById(installationId))

    const response = await postWebhook('installation', {
      action: 'deleted',
      installation: {
        id: installationId,
        account: { login: 'octocat', id: 9527, type: 'User' },
      },
    })

    assert.equal(response.status, 200)
    assert.equal(await getGitHubAppInstallationById(installationId), null)
  } finally {
    restoreEnv()
    const { deleteGitHubAppInstallationEverywhere } = await import('../services/github-app-installation-store')
    await deleteGitHubAppInstallationEverywhere(installationId)
  }
})

test('installation webhook suspend action records the suspension timestamp', async () => {
  if (await dbSkip()) {
    return
  }
  const restoreEnv = setWebhookEnv()
  const installationId = 180000000 + Math.floor(Math.random() * 1000000)
  try {
    const suspendedAt = '2026-09-01T00:00:00Z'
    const response = await postWebhook('installation', {
      action: 'suspend',
      installation: {
        id: installationId,
        account: { login: 'octocat', id: 9527, type: 'User' },
        repository_selection: 'all',
        permissions: { contents: 'read' },
        suspended_at: suspendedAt,
      },
    })

    assert.equal(response.status, 200)
    const installation = await getGitHubAppInstallationById(installationId)
    assert.equal(installation?.suspendedAt, suspendedAt)
  } finally {
    restoreEnv()
    const { deleteGitHubAppInstallationEverywhere } = await import('../services/github-app-installation-store')
    await deleteGitHubAppInstallationEverywhere(installationId)
  }
})

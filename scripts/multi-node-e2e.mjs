#!/usr/bin/env node
/**
 * 多节点 Active-Active 双真实进程 E2E（P0-5）
 *
 * 启动两个独立 control-plane 进程（node-a:19001 / node-b:19002）共享同一 PostgreSQL，
 * 验证：
 *   1. 两节点均能启动并达到 /api/ready（共享库无迁移锁冲突、各自注册节点）
 *   2. /api/health 返回各自 nodeId
 *   3. 跨节点缓存刷新：A 的节点写入经 storage_change 触发器同步到 B 的 /api/cluster/nodes
 *   4. kill A 后 A /api/ready 不可达，B 仍在 /api/ready；心跳窗口内 B 将 A 标记 offline
 *
 * 用法：
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/multi-node-e2e.mjs
 *   （默认使用 postgres://vibemux:vibemux@127.0.0.1:5434/vibemux 作为主库，自动创建/清理 e2e 库）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const MAIN_DB_URL = process.env.DATABASE_URL
  || 'postgres://vibemux:vibemux@127.0.0.1:5434/vibemux'
const E2E_DB = 'vibemux_multinode_e2e'
const STALE_TIMEOUT_MS = Number(process.env.WEMUX_CLUSTER_NODE_STALE_TIMEOUT_MS ?? process.env.VIBEMUX_CLUSTER_NODE_STALE_TIMEOUT_MS || 5_000)
const BOOT_TIMEOUT_MS = 90_000

const TSX = path.resolve('node_modules/.bin/tsx')
const SERVER_ENTRY = path.resolve('apps/server/src/index.ts')

const log = (...args) => console.log('[multi-node-e2e]', ...args)
const fail = (message) => {
  console.error('[multi-node-e2e] FAIL:', message)
  process.exit(1)
}

const parseDbUrl = (url) => {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/)
  if (!m) throw new Error(`cannot parse DATABASE_URL: ${url}`)
  return { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5] }
}

// 简易 pg 客户端（避免顶层依赖）
const pgClient = async (url, extraDb) => {
  const base = parseDbUrl(url)
  const db = extraDb || base.database
  const { default: pg } = await import('pg')
  const client = new pg.Client({
    user: base.user, password: base.password, host: base.host, port: base.port, database: db,
  })
  await client.connect()
  return client
}

const ensureE2eDatabase = async () => {
  const main = await pgClient(MAIN_DB_URL)
  try {
    await main.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${E2E_DB}' AND pid <> pg_backend_pid()`)
    await main.query(`DROP DATABASE IF EXISTS ${E2E_DB}`)
    await main.query(`CREATE DATABASE ${E2E_DB}`)
  } finally {
    await main.end()
  }
}

const dropE2eDatabase = async () => {
  const main = await pgClient(MAIN_DB_URL)
  try {
    await main.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${E2E_DB}' AND pid <> pg_backend_pid()`)
    await main.query(`DROP DATABASE IF EXISTS ${E2E_DB}`)
  } finally {
    await main.end()
  }
}

const e2eDbUrl = () => MAIN_DB_URL.replace(/\/[^/]+$/, `/${E2E_DB}`)

const buildServerEnv = (nodeId, port, extra = {}) => {
  const secrets = {
    TOKEN_SECRET: 'e2e-token-secret-shared',
    BETTER_AUTH_SECRET: 'e2e-better-auth-secret-shared',
    SECRET_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    VIBEMUX_CLUSTER_TOKEN: 'e2e-cluster-token-shared',
  }
  return {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_URL: e2eDbUrl(),
    WEMUX_NODE_ID: nodeId,
    WEMUX_NODE_NAME: nodeId,
    WEMUX_NODE_URL: `http://127.0.0.1:${port}`,
    WEMUX_NODE_RELAY_URL: `http://127.0.0.1:${port}`,
    WEMUX_NODE_REGION: 'e2e',
    VIBEMUX_CLUSTER_NODE_STALE_TIMEOUT_MS: String(STALE_TIMEOUT_MS),
    VIBEMUX_ENABLE_DEV_LOGIN: 'true',
    VIBEMUX_BUNDLED_POSTGRES_ENABLED: 'false',
    VIBEMUX_BUNDLED_OBJECT_STORAGE_ENABLED: 'false',
    ...secrets,
    ...extra,
  }
}

const spawnServer = (nodeId, port) => {
  const child = spawn(TSX, [SERVER_ENTRY], {
    env: buildServerEnv(nodeId, port),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const out = []
  child.stdout.on('data', (d) => out.push(d.toString()))
  child.stderr.on('data', (d) => out.push(d.toString()))
  child.log = () => out.join('')
  child.killTree = () => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
  return child
}

const waitFor = async (fn, timeoutMs, intervalMs = 1000, label = '') => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`)
}

const api = async (baseUrl, pathname, options = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body }
}

const main = async () => {
  log(`main db: ${MAIN_DB_URL} | e2e db: ${E2E_DB} | stale timeout: ${STALE_TIMEOUT_MS}ms`)
  await ensureE2eDatabase()
  log('created e2e database')

  const workdir = mkdtempSync(path.join(tmpdir(), 'wemux-e2e-'))
  const serverA = spawnServer('node-a', 19001)
  const serverB = spawnServer('node-b', 19002)

  try {
    // 1. 两节点均启动并达到 ready
    log('waiting for node-a ready...')
    await waitFor(async () => {
      const r = await api('http://127.0.0.1:19001', '/api/ready')
      return r.status === 200 && r.body.ok
    }, BOOT_TIMEOUT_MS, 1500, 'node-a ready')
    log('node-a ready')

    log('waiting for node-b ready...')
    await waitFor(async () => {
      const r = await api('http://127.0.0.1:19002', '/api/ready')
      return r.status === 200 && r.body.ok
    }, BOOT_TIMEOUT_MS, 1500, 'node-b ready')
    log('node-b ready')

    // 2. 各自 /api/health 返回正确 nodeId
    const healthA = await api('http://127.0.0.1:19001', '/api/health')
    const healthB = await api('http://127.0.0.1:19002', '/api/health')
    if (healthA.body?.architecture?.controlPlane?.nodeId !== 'node-a') fail('node-a health nodeId mismatch')
    if (healthB.body?.architecture?.controlPlane?.nodeId !== 'node-b') fail('node-b health nodeId mismatch')
    log(`health ok: A=${healthA.body?.architecture?.controlPlane?.nodeId} B=${healthB.body?.architecture?.controlPlane?.nodeId}`)

    // 3. dev 登录拿 token（走 A），验证跨节点缓存刷新
    const login = await api('http://127.0.0.1:19001', '/api/auth/dev/login', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'demo' }),
    })
    if (login.status !== 200 || !login.body?.token) {
      fail(`dev login failed: ${login.status} ${JSON.stringify(login.body)}`)
    }
    const token = login.body.token
    log('dev login ok')

    // 3a. A 视图包含两节点（A 注册自己 + 跨节点同步 B）
    log('waiting for cross-node node registry sync on A...')
    await waitFor(async () => {
      const r = await api('http://127.0.0.1:19001', '/api/cluster/nodes', { token })
      if (r.status !== 200) return false
      const ids = new Set(r.body.nodes.map((n) => n.nodeId))
      return ids.has('node-a') && ids.has('node-b')
    }, 30_000, 1000, 'A sees both nodes')
    log('node-a sees node-a + node-b (cross-node sync ok)')

    // 3b. B 视图同样包含两节点
    await waitFor(async () => {
      const r = await api('http://127.0.0.1:19002', '/api/cluster/nodes', { token })
      if (r.status !== 200) return false
      const ids = new Set(r.body.nodes.map((n) => n.nodeId))
      return ids.has('node-a') && ids.has('node-b')
    }, 30_000, 1000, 'B sees both nodes')
    log('node-b sees node-a + node-b (cross-node sync ok)')

    // 3c. /api/health 可观测字段（P1-4）
    if (typeof healthA.body?.postgres?.pool?.total !== 'number') fail('health missing postgres.pool')
    if (typeof healthA.body?.storageChangeListener?.lag !== 'number') fail('health missing listener lag')
    if (healthA.body?.node?.nodeId !== 'node-a') fail('health node.nodeId mismatch')
    if (typeof healthA.body?.node?.heartbeatAgeMs !== 'number') fail('health missing node heartbeatAgeMs')
    if (typeof healthA.body?.persistence?.fireAndForgetFailures !== 'number') fail('health missing persistence failures')
    log(`health observability ok (pool=${healthA.body?.postgres?.pool?.total} lag=${healthA.body?.storageChangeListener?.lag})`)

    // 3d. /api/admin/nodes 多节点状态（P0-6/P1-4）
    const adminNodes = await api('http://127.0.0.1:19001', '/api/admin/nodes', { token })
    if (adminNodes.status !== 200) fail(`admin nodes endpoint failed: ${adminNodes.status}`)
    const adminNodeIds = new Set((adminNodes.body?.nodes ?? []).map((n) => n.nodeId))
    if (!adminNodeIds.has('node-a') || !adminNodeIds.has('node-b')) fail('admin nodes missing nodes')
    const nodeAFromAdmin = (adminNodes.body?.nodes ?? []).find((n) => n.nodeId === 'node-a')
    if (nodeAFromAdmin?.isCurrent !== true) fail('admin nodes isCurrent wrong')
    if (typeof nodeAFromAdmin?.heartbeatAgeMs !== 'number') fail('admin nodes missing heartbeatAgeMs')
    if (nodeAFromAdmin?.probe?.ready !== true) fail(`admin nodes probe for current node failed: ${JSON.stringify(nodeAFromAdmin?.probe)}`)
    log(`admin nodes ok (${adminNodeIds.size} nodes, current node /api/ready probe true)`)

    // 4. kill A → A ready 不可达；B 在心跳窗口内将 A 标记 offline
    log(`killing node-a (stale timeout ${STALE_TIMEOUT_MS}ms)...`)
    serverA.killTree()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const readyA = await api('http://127.0.0.1:19001', '/api/ready').catch(() => ({ status: 0 }))
    if (readyA.status !== 0) fail('node-a should be unreachable after kill')
    log('node-a unreachable after kill')

    const readyB = await api('http://127.0.0.1:19002', '/api/ready')
    if (readyB.status !== 200 || !readyB.body.ok) fail('node-b should stay ready')
    log('node-b still ready after node-a kill')

    log('waiting for node-b to mark node-a offline...')
    await waitFor(async () => {
      const r = await api('http://127.0.0.1:19002', '/api/cluster/nodes', { token })
      if (r.status !== 200) return false
      const nodeA = r.body.nodes.find((n) => n.nodeId === 'node-a')
      return nodeA?.status === 'offline'
    }, STALE_TIMEOUT_MS + 30_000, 1500, 'B marks A offline')
    log('node-b marked node-a offline (lease reaper ok)')

    console.log('\n[multi-node-e2e] ✅ ALL CHECKS PASSED')
  } finally {
    serverA.killTree()
    serverB.killTree()
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (process.env.KEEP_E2E_DB !== '1') {
      await dropE2eDatabase()
      log('dropped e2e database')
    } else {
      log('KEEP_E2E_DB=1, keeping e2e database')
    }
    rmSync(workdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('[multi-node-e2e] ERROR:', error)
  process.exit(1)
})

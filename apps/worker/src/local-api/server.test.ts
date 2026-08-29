import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { getWorkerRuntimeState, updateWorkerRuntimeState } from '../core/runtime-state'

const importLocalApiServerModule = async () => {
  return import(`./server.ts?test=${Date.now()}-${Math.random()}`)
}

const withWorkerEnv = async (
  env: NodeJS.ProcessEnv,
  run: () => Promise<void>,
) => {
  const previous = {
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV,
    VIBEMUX_CLOUD_URL: process.env.VIBEMUX_CLOUD_URL,
    VIBEMUX_WORKER_HOME: process.env.VIBEMUX_WORKER_HOME,
    VIBEMUX_WORKER_PORT: process.env.VIBEMUX_WORKER_PORT,
  }

  Object.assign(process.env, env)

  for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
    if (!env[key]) {
      delete process.env[key]
    }
  }

  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }

      process.env[key] = value
    }
  }
}

const listenOnEphemeralPort = async () => {
  const server = http.createServer((_request, response) => {
    response.statusCode = 204
    response.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  return {
    server,
    port: address.port,
  }
}

test('startLocalWorkerServer scans forward to a free port when the preferred port is busy', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-local-api-busy-'))
  const occupied = await listenOnEphemeralPort()
  let handle: Awaited<ReturnType<typeof import('./server.ts').startLocalWorkerServer>> | undefined

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'http://127.0.0.1:8989',
      VIBEMUX_WORKER_PORT: String(occupied.port),
    }, async () => {
      const { startLocalWorkerServer } = await importLocalApiServerModule()
      updateWorkerRuntimeState({ executorId: 'executor-local-api-test' })
      handle = await startLocalWorkerServer({
        optional: true,
        portCandidates: [occupied.port],
      })
      const bound = handle!

      assert.ok(bound.server, 'expected a bound local console server')
      assert.ok(bound.port, 'expected a bound local console port')
      assert.notEqual(bound.port, occupied.port)
      assert.ok(bound.instanceId, 'expected a local console instance id')
      assert.equal(getWorkerRuntimeState().localConsole?.enabled, true)
      assert.equal(getWorkerRuntimeState().localConsole?.port, bound.port)
      assert.equal(getWorkerRuntimeState().localConsole?.instanceId, bound.instanceId)

      const identityResponse = await fetch(`http://127.0.0.1:${bound.port}/api/local-access/identity`)
      assert.equal(identityResponse.status, 200)
      assert.deepEqual(await identityResponse.json(), {
        executorId: 'executor-local-api-test',
        instanceId: bound.instanceId,
        protocolVersion: 1,
      })
    })
  } finally {
    updateWorkerRuntimeState({ executorId: undefined })
    await new Promise<void>((resolve) => {
      handle?.server?.close(() => resolve())
      if (!handle?.server) {
        resolve()
      }
    })
    await new Promise<void>((resolve) => occupied.server.close(() => resolve()))
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('startLocalWorkerServer rejects a duplicate executor without disabling ordinary port fallback', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-local-api-duplicate-'))
  const existing = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ executorId: 'executor-duplicate-test' }))
  })
  await new Promise<void>((resolve, reject) => {
    existing.once('error', reject)
    existing.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (existing.address() as AddressInfo).port

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'http://127.0.0.1:8989',
      VIBEMUX_WORKER_PORT: String(port),
    }, async () => {
      const { startLocalWorkerServer } = await importLocalApiServerModule()
      updateWorkerRuntimeState({ executorId: 'executor-duplicate-test' })
      await assert.rejects(
        startLocalWorkerServer({ optional: true, rejectDuplicateExecutor: true }),
        /already running/,
      )
    })
  } finally {
    updateWorkerRuntimeState({ executorId: undefined })
    await new Promise<void>((resolve) => existing.close(() => resolve()))
    rmSync(tempHome, { recursive: true, force: true })
  }
})

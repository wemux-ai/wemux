import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveExecutorConnectionRoute } from './executor-connection-route'

const restoreEnv = (snapshot: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }
}

test('resolveExecutorConnectionRoute assigns domestic realtime url for CN requests', () => {
  const snapshot = {
    VIBEMUX_DOMESTIC_REALTIME_BASE_URL: process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL,
    VIBEMUX_PUBLIC_BASE_URL: process.env.VIBEMUX_PUBLIC_BASE_URL,
    VIBEMUX_DOMESTIC_COUNTRY_CODES: process.env.VIBEMUX_DOMESTIC_COUNTRY_CODES,
    VIBEMUX_EXECUTOR_ROUTE_RULES_JSON: process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON,
  }

  process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL = 'https://hk.wemux.xyz'
  process.env.VIBEMUX_PUBLIC_BASE_URL = 'https://wemux.xyz'
  process.env.VIBEMUX_DOMESTIC_COUNTRY_CODES = 'CN,MO'
  delete process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON

  try {
    const route = resolveExecutorConnectionRoute({
      requestUrl: 'http://127.0.0.1:8989/api/control-plane/executors/connection-route',
      headers: {
        'cf-ipcountry': 'CN',
      },
    })

    assert.equal(route.assignedCloudUrl, 'https://hk.wemux.xyz')
    assert.deepEqual(route.assignedLabels, ['route:hk', 'realtime:hk'])
    assert.deepEqual(route.managedRoutingLabels, ['route:hk', 'realtime:hk'])
    assert.equal(route.countryCode, 'CN')
    assert.equal(route.matchedRouteId, 'domestic-hk')
    assert.deepEqual(route.candidates, [
      {
        id: 'domestic-hk',
        cloudUrl: 'https://hk.wemux.xyz',
        labels: ['route:hk', 'realtime:hk'],
      },
      {
        id: 'public-default',
        cloudUrl: 'http://127.0.0.1:8989',
        labels: [],
      },
    ])
  } finally {
    restoreEnv(snapshot)
  }
})

test('resolveExecutorConnectionRoute falls back to public base url for unmatched requests', () => {
  const snapshot = {
    VIBEMUX_DOMESTIC_REALTIME_BASE_URL: process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL,
    VIBEMUX_PUBLIC_BASE_URL: process.env.VIBEMUX_PUBLIC_BASE_URL,
    VIBEMUX_EXECUTOR_ROUTE_RULES_JSON: process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON,
  }

  process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL = 'https://hk.wemux.xyz'
  process.env.VIBEMUX_PUBLIC_BASE_URL = 'https://wemux.xyz'
  delete process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON

  try {
    const route = resolveExecutorConnectionRoute({
      requestUrl: 'http://127.0.0.1:8989/api/control-plane/executors/connection-route',
      headers: {
        'cf-ipcountry': 'US',
        host: 'vibemux-vibemux-pr-52.up.railway.app',
        'x-forwarded-proto': 'https',
      },
    })

    assert.equal(route.assignedCloudUrl, 'https://vibemux-vibemux-pr-52.up.railway.app')
    assert.deepEqual(route.assignedLabels, [])
    assert.deepEqual(route.managedRoutingLabels, ['route:hk', 'realtime:hk'])
    assert.equal(route.countryCode, 'US')
    assert.equal(route.matchedRouteId, undefined)
    assert.deepEqual(route.candidates, [
      {
        id: 'public-default',
        cloudUrl: 'https://vibemux-vibemux-pr-52.up.railway.app',
        labels: [],
      },
    ])
  } finally {
    restoreEnv(snapshot)
  }
})

test('resolveExecutorConnectionRoute supports explicit regional route rules with continent matching', () => {
  const snapshot = {
    VIBEMUX_PUBLIC_BASE_URL: process.env.VIBEMUX_PUBLIC_BASE_URL,
    VIBEMUX_EXECUTOR_ROUTE_RULES_JSON: process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON,
    VIBEMUX_DOMESTIC_REALTIME_BASE_URL: process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL,
  }

  process.env.VIBEMUX_PUBLIC_BASE_URL = 'https://wemux.ai'
  process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = JSON.stringify([
    {
      id: 'hk',
      cloudUrl: 'https://hk.wemux.ai',
      labels: ['route:hk', 'realtime:hk'],
      countries: ['CN', 'HK'],
    },
    {
      id: 'us',
      cloudUrl: 'https://us.wemux.ai',
      labels: ['route:us', 'realtime:us'],
      continents: ['NA'],
    },
    {
      id: 'eu',
      cloudUrl: 'https://eu.wemux.ai',
      labels: ['route:eu', 'realtime:eu'],
      continents: ['EU'],
    },
  ])
  delete process.env.VIBEMUX_DOMESTIC_REALTIME_BASE_URL

  try {
    const route = resolveExecutorConnectionRoute({
      requestUrl: 'http://127.0.0.1:8989/api/control-plane/executors/connection-route',
      headers: {
        'cf-ipcountry': 'US',
        'cf-ipcontinent': 'NA',
      },
    })

    assert.equal(route.assignedCloudUrl, 'https://us.wemux.ai')
    assert.deepEqual(route.assignedLabels, ['route:us', 'realtime:us'])
    assert.deepEqual(route.managedRoutingLabels, [
      'route:hk',
      'realtime:hk',
      'route:us',
      'realtime:us',
      'route:eu',
      'realtime:eu',
    ])
    assert.equal(route.countryCode, 'US')
    assert.equal(route.continentCode, 'NA')
    assert.equal(route.matchedRouteId, 'us')
    assert.deepEqual(route.candidates, [
      {
        id: 'us',
        cloudUrl: 'https://us.wemux.ai',
        labels: ['route:us', 'realtime:us'],
      },
      {
        id: 'public-default',
        cloudUrl: 'http://127.0.0.1:8989',
        labels: [],
      },
    ])
  } finally {
    restoreEnv(snapshot)
  }
})

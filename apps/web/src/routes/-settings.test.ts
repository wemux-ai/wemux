import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSettingsRouteSearch } from './-settings-route-search'

test('/settings accepts localNetworkAccess as a settings section', () => {
  assert.equal(
    parseSettingsRouteSearch({ section: 'localNetworkAccess' }).section,
    'localNetworkAccess',
  )
})

test('/settings accepts experimental as a settings section', () => {
  assert.equal(
    parseSettingsRouteSearch({ section: 'experimental' }).section,
    'experimental',
  )
})

test('/settings accepts floatingChat as a settings section', () => {
  assert.equal(
    parseSettingsRouteSearch({ section: 'floatingChat' }).section,
    'floatingChat',
  )
})

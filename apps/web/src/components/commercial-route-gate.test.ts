import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCommercialRouteComponent,
  registerCommercialRouteResolver,
} from './commercial-route-gate'

test('returns no commercial page before an extension registers', () => {
  assert.equal(getCommercialRouteComponent('/pricing'), null)
})

test('delegates commercial paths to the registered extension resolver', () => {
  const PricingPage = () => null
  registerCommercialRouteResolver((pathname) => pathname === '/pricing' ? PricingPage : null)

  assert.equal(getCommercialRouteComponent('/pricing'), PricingPage)
  assert.equal(getCommercialRouteComponent('/enterprise/unknown'), null)
})

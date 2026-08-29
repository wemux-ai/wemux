import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLegacyDomainRedirect } from './domain-redirect'

test('redirects the preview legacy domain and preserves path/query', () => {
  assert.equal(
    resolveLegacyDomainRedirect(
      'http://origin.internal/api/bootstrap?scope=workspaces',
      'vibemux.xyz',
    ),
    'https://wemux.xyz/api/bootstrap?scope=workspaces',
  )
})

test('redirects production subdomains to the matching wemux.ai subdomain', () => {
  assert.equal(
    resolveLegacyDomainRedirect('http://origin.internal/chat', 'www.vibemux.com'),
    'https://www.wemux.ai/chat',
  )
  assert.equal(
    resolveLegacyDomainRedirect('http://origin.internal/health', 'hk.vibemux.com:443'),
    'https://hk.wemux.ai/health',
  )
})

test('does not redirect canonical, local, or lookalike hosts', () => {
  assert.equal(resolveLegacyDomainRedirect('http://origin.internal/', 'wemux.ai'), null)
  assert.equal(resolveLegacyDomainRedirect('http://origin.internal/', 'app.vibemux.localtest.me'), null)
  assert.equal(resolveLegacyDomainRedirect('http://origin.internal/', 'notvibemux.xyz'), null)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGitHubRepositoryResourceId,
  buildGitHubResourceBindingContextKey,
  resolveGitHubResourceBindingStatus,
} from './github-resources'

test('builds stable GitHub resource identities and context keys', () => {
  assert.equal(buildGitHubRepositoryResourceId({
    repoHost: 'GitHub.COM',
    repoOwner: 'example-org',
    repoName: 'example-repo',
    nativeId: 89,
  }), 'github:github.com:example-org:example-repo:89')

  assert.equal(buildGitHubResourceBindingContextKey({
    taskId: ' task-1 ',
    workspaceId: ' workspace-1 ',
    workspaceSessionId: ' session-1 ',
  }), 'task:task-1|workspace:workspace-1|session:session-1')
})

test('requires a concrete local context for a GitHub resource binding', () => {
  assert.throws(
    () => buildGitHubResourceBindingContextKey({}),
    /requires a task, workspace, or workspace session target/,
  )
})

test('heuristic suggestions never overwrite a confirmed or rejected decision', () => {
  assert.equal(resolveGitHubResourceBindingStatus(undefined, 'suggested'), 'suggested')
  assert.equal(resolveGitHubResourceBindingStatus('suggested', 'confirmed'), 'confirmed')
  assert.equal(resolveGitHubResourceBindingStatus('suggested', 'rejected'), 'rejected')
  assert.equal(resolveGitHubResourceBindingStatus('confirmed', 'suggested'), 'confirmed')
  assert.equal(resolveGitHubResourceBindingStatus('rejected', 'suggested'), 'rejected')
  assert.equal(resolveGitHubResourceBindingStatus('rejected', 'confirmed'), 'confirmed')
})

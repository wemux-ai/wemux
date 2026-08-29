import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskRuntimeGitIdentity } from '@shared/types'
import { getRepositoryWorkflowJobLogs } from './github-pull-request-service'

const githubIdentity: TaskRuntimeGitIdentity = {
  mode: 'personal',
  provider: 'github',
  authMode: 'pat',
  credentialToken: 'test-token',
}

test('getRepositoryWorkflowJobLogs retries transient BlobNotFound responses and returns logs', async () => {
  const originalFetch = globalThis.fetch
  const fetchCalls: string[] = []

  globalThis.fetch = async (input) => {
    fetchCalls.push(String(input))
    if (fetchCalls.length === 1) {
      return new Response(
        '<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob does not exist.</Message></Error>',
        { status: 404 },
      )
    }

    return new Response('line 1\r\nline 2\r\n', { status: 200 })
  }

  try {
    const result = await getRepositoryWorkflowJobLogs({
      repoUrl: 'https://github.com/acme/widgets.git',
      gitIdentity: githubIdentity,
      runId: '101',
      jobId: '202',
    })

    assert.equal(fetchCalls.length, 2)
    assert.equal(result.ok, true)
    assert.equal(result.lineCount, 2)
    assert.equal(result.excerpt, 'line 1\nline 2')
  } finally {
    globalThis.fetch = originalFetch
  }
})

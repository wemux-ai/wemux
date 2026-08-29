import assert from 'node:assert/strict'
import test from 'node:test'

import { pickWorkerServiceHostEnv } from './service-common'

test('worker service host env excludes ambient worker selection and credentials', () => {
  const env = pickWorkerServiceHostEnv({
    PATH: '/usr/bin',
    LANG: 'en_US.UTF-8',
    SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
    VIBEMUX_WORKER_HOME: '/tmp/wrong-worker-home',
    VIBEMUX_CLOUD_URL: 'https://wrong.example',
    VIBEMUX_WORKER_RELEASE_CHANNEL: 'preview',
    VIBEMUX_TOKEN: 'secret',
    OPENAI_API_KEY: 'secret',
  })

  assert.equal(env.LANG, 'en_US.UTF-8')
  assert.equal(env.SSH_AUTH_SOCK, '/tmp/ssh-agent.sock')
  assert.equal(env.VIBEMUX_WORKER_HOME, undefined)
  assert.equal(env.VIBEMUX_CLOUD_URL, undefined)
  assert.equal(env.VIBEMUX_WORKER_RELEASE_CHANNEL, undefined)
  assert.equal(env.VIBEMUX_TOKEN, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
})

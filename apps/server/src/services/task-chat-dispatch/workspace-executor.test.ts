import assert from 'node:assert/strict'
import test from 'node:test'
import { isNonCodingPreviewModel, shouldEmitWorkspaceAutoCommitStartMessage } from './workspace-executor'

const isMissingWorkspaceCwdError = (message: string) => {
  const normalizedMessage = message.trim()
  if (!normalizedMessage) {
    return false
  }

  return normalizedMessage.includes('工作目录不存在:')
    || normalizedMessage.includes('当前工作目录不存在：')
    || normalizedMessage.includes('当前工作目录不存在:')
}

test('missing workspace cwd matcher accepts worker and opencode error variants', () => {
  assert.equal(isMissingWorkspaceCwdError('工作目录不存在: /root/.vibemux-dev/workspace/repos/todomap'), true)
  assert.equal(isMissingWorkspaceCwdError('当前工作目录不存在：/root/.vibemux-dev/workspace/repos/todomap'), true)
  assert.equal(isMissingWorkspaceCwdError('当前工作目录不存在: /root/.vibemux-dev/workspace/repos/todomap'), true)
  assert.equal(isMissingWorkspaceCwdError('无法访问当前工作目录 /tmp/demo：permission denied'), false)
})

test('shouldEmitWorkspaceAutoCommitStartMessage only announces commit progress when files actually changed', () => {
  assert.equal(shouldEmitWorkspaceAutoCommitStartMessage(null), false)
  assert.equal(shouldEmitWorkspaceAutoCommitStartMessage({ ok: false, files: [] }), false)
  assert.equal(shouldEmitWorkspaceAutoCommitStartMessage({ ok: true, files: [] }), false)
  assert.equal(shouldEmitWorkspaceAutoCommitStartMessage({
    ok: true,
    files: [{ path: 'apps/web/src/routes/chat.tsx', additions: 1, deletions: 0, status: 'modified' }],
  }), true)
})

test('coding model options exclude image preview and generation runtimes', () => {
  const model = (id: string) => ({ id, label: id, providerId: 'provider', modelId: id })

  assert.equal(isNonCodingPreviewModel(model('google/gemini-3-pro-image-preview')), true)
  assert.equal(isNonCodingPreviewModel(model('openai/dall-e-3')), true)
  assert.equal(isNonCodingPreviewModel(model('openai/gpt-5.6-terra')), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRuntimeEnvironmentExecution, type RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import { executorWsService } from '../control-plane/executor-ws-service'
import { buildRuntimeEnvironmentReferenceContext } from '../services/runtime-environment-service'
import { runPreviewEnvironmentCommand } from './preview-routes'

test('preview environment command uses background mode and runtime environment', async (t) => {
  const calls: Array<{
    executorId: string
    command: string
    cwd?: string
    options?: {
      timeoutMs?: number
      mode?: 'wait' | 'background'
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    }
  }> = []

  const restore = t.mock.method(
    executorWsService,
    'requestTerminalCommand',
    async (executorId: string, command: string, cwd?: string, options?: {
      timeoutMs?: number
      mode?: 'wait' | 'background'
      runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    }) => {
      calls.push({ executorId, command, cwd, options })
      return {
        command,
        cwd,
        stdout: '',
        stderr: '',
        exitCode: 0,
        detached: options?.mode === 'background',
        mode: options?.mode ?? 'wait',
        at: new Date().toISOString(),
      }
    },
  )

  const runtimeEnvironment: RuntimeEnvironmentExecutionPayload = {
    mode: 'process-env',
    variables: {
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    },
  }

  await runPreviewEnvironmentCommand({
    executorId: 'executor-1',
    command: 'pnpm dev',
    cwd: '/tmp/worktree',
    mode: 'background',
    runtimeEnvironment,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.options?.mode, 'background')
  assert.deepEqual(calls[0]?.options?.runtimeEnvironment, runtimeEnvironment)
  restore.mock.restore()
})

test('preview open final runtime env resolves preview.publicUrl for Better Auth style refs', () => {
  // Mirrors the second-phase resolve after sourceBinding.publicUrl is known.
  const referenceContext = buildRuntimeEnvironmentReferenceContext({
    platform: {
      project: { id: 'project-1' },
      workspace: { id: 'workspace-1' },
      workspaceSession: { id: 'session-1' },
      task: { id: 'task-1' },
      preview: {
        publicUrl: 'https://demo.preview.example',
        publicHost: 'demo.preview.example',
        port: 5173,
      },
      executor: {
        executorId: 'executor-1',
        name: 'dev-node',
        machineName: 'dev-node.local',
        previewIngressDetectedPublicIp: '203.0.113.8',
      },
    },
    missingPlatformVariable: 'error',
  })

  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: [
        'BETTER_AUTH_URL=${{ preview.publicUrl }}',
        'BETTER_AUTH_TRUSTED_ORIGINS=${{ preview.publicOrigin }}',
        'PREVIEW_HOST=${{ preview.publicHost }}',
      ].join('\n'),
    },
    referenceContext,
  })

  assert.deepEqual(result?.payload.variables, {
    BETTER_AUTH_URL: 'https://demo.preview.example',
    BETTER_AUTH_TRUSTED_ORIGINS: 'https://demo.preview.example',
    PREVIEW_HOST: 'demo.preview.example',
  })
})

test('preview prepare-phase runtime env preserves missing preview.publicUrl', () => {
  const referenceContext = buildRuntimeEnvironmentReferenceContext({
    platform: {
      project: { id: 'project-1' },
      workspace: { id: 'workspace-1' },
    },
    missingPlatformVariable: 'preserve',
  })

  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: 'BETTER_AUTH_URL=${{ preview.publicUrl }}',
    },
    referenceContext,
  })

  assert.equal(result?.payload.variables.BETTER_AUTH_URL, '${{ preview.publicUrl }}')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidRuntimeEnvironmentFileName,
  mergeRuntimeEnvironmentEntries,
  parseRuntimeEnvironmentContent,
  resolveRuntimeEnvironmentExecution,
  validateRuntimeEnvironmentConfig,
} from './runtime-environment'

test('parseRuntimeEnvironmentContent ignores comments and supports export prefix', () => {
  const result = parseRuntimeEnvironmentContent([
    '# comment',
    'FOO=1',
    'export BAR=two words',
    '',
  ].join('\n'))

  assert.deepEqual(result.entries, [
    { key: 'FOO', value: '1' },
    { key: 'BAR', value: 'two words' },
  ])
  assert.deepEqual(result.issues, [])
})

test('parseRuntimeEnvironmentContent reports duplicate keys', () => {
  const result = parseRuntimeEnvironmentContent([
    'FOO=1',
    'FOO=2',
  ].join('\n'))

  assert.equal(result.entries.length, 1)
  assert.equal(result.issues[0]?.code, 'duplicate-key')
})

test('mergeRuntimeEnvironmentEntries preserves project order and applies workspace overrides', () => {
  const merged = mergeRuntimeEnvironmentEntries(
    [
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ],
    [
      { key: 'B', value: '22' },
      { key: 'C', value: '3' },
    ],
  )

  assert.deepEqual(merged.entries, [
    { key: 'A', value: '1' },
    { key: 'B', value: '22' },
    { key: 'C', value: '3' },
  ])
  assert.equal(merged.overrideCount, 1)
})

test('isValidRuntimeEnvironmentFileName requires a safe relative path', () => {
  assert.equal(isValidRuntimeEnvironmentFileName('.env.local'), true)
  assert.equal(isValidRuntimeEnvironmentFileName('config/runtime.env'), true)
  assert.equal(isValidRuntimeEnvironmentFileName('/tmp/.env'), false)
  assert.equal(isValidRuntimeEnvironmentFileName('../.env'), false)
  assert.equal(isValidRuntimeEnvironmentFileName('config/../.env'), false)
})

test('validateRuntimeEnvironmentConfig requires file name for env-file mode', () => {
  const issues = validateRuntimeEnvironmentConfig({
    mode: 'env-file',
    content: 'FOO=1',
  })

  assert.equal(issues[0]?.code, 'missing-file-name')
})

test('resolveRuntimeEnvironmentExecution merges variables and lets workspace override delivery mode', () => {
  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: [
        'BASE_URL=https://example.com',
        'API_KEY=project',
      ].join('\n'),
    },
    workspaceConfig: {
      mode: 'env-file',
      fileName: '.env.local',
      content: [
        'API_KEY=workspace',
        'PORT=3000',
      ].join('\n'),
    },
  })

  assert.ok(result)
  assert.equal(result?.payload.mode, 'env-file')
  assert.equal(result?.payload.fileName, '.env.local')
  assert.equal(result?.payload.fileContent, [
    'BASE_URL=https://example.com',
    'API_KEY=workspace',
    'PORT=3000',
  ].join('\n'))
  assert.deepEqual(result?.payload.variables, {
    BASE_URL: 'https://example.com',
    API_KEY: 'workspace',
    PORT: '3000',
  })
  assert.equal(result?.effectiveSummary.overrideCount, 1)
})

test('resolveRuntimeEnvironmentExecution expands same-scope variable references', () => {
  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'env-file',
      fileName: '.env',
      content: [
        'API_HOST=https://api.example.com',
        'AUTH_PATH=/auth',
        'AUTH_ENDPOINT=${{ API_HOST }}${{ AUTH_PATH }}',
      ].join('\n'),
    },
  })

  assert.equal(result?.payload.variables.AUTH_ENDPOINT, 'https://api.example.com/auth')
  assert.equal(
    result?.payload.fileContent,
    [
      'API_HOST=https://api.example.com',
      'AUTH_PATH=/auth',
      'AUTH_ENDPOINT=https://api.example.com/auth',
    ].join('\n'),
  )
})

test('resolveRuntimeEnvironmentExecution uses workspace override for bare ${{ KEY }} references', () => {
  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: [
        'API_TOKEN=project-token',
        'EFFECTIVE_TOKEN=${{ API_TOKEN }}',
      ].join('\n'),
    },
    workspaceConfig: {
      mode: 'process-env',
      content: 'API_TOKEN=workspace-token',
    },
  })

  assert.equal(result?.payload.variables.API_TOKEN, 'workspace-token')
  assert.equal(result?.payload.variables.EFFECTIVE_TOKEN, 'workspace-token')
})

test('resolveRuntimeEnvironmentExecution supports explicit project and workspace scopes', () => {
  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: [
        'API_TOKEN=project-token',
        'PROJECT_TOKEN=${{ project.API_TOKEN }}',
      ].join('\n'),
    },
    workspaceConfig: {
      mode: 'process-env',
      content: [
        'API_TOKEN=workspace-token',
        'WORKSPACE_TOKEN=${{ workspace.API_TOKEN }}',
        'EFFECTIVE_TOKEN=${{ API_TOKEN }}',
      ].join('\n'),
    },
  })

  assert.deepEqual(result?.payload.variables, {
    API_TOKEN: 'workspace-token',
    PROJECT_TOKEN: 'project-token',
    WORKSPACE_TOKEN: 'workspace-token',
    EFFECTIVE_TOKEN: 'workspace-token',
  })
})

test('resolveRuntimeEnvironmentExecution expands platform preview and vibemux aliases', () => {
  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: [
        'BETTER_AUTH_URL=${{ preview.publicUrl }}',
        'BETTER_AUTH_TRUSTED_ORIGINS=${{ vibemux.preview.publicOrigin }}',
        'NODE_PUBLIC_IP=${{ node.publicIp }}',
      ].join('\n'),
    },
    referenceContext: {
      platformVariables: {
        'preview.publicUrl': 'https://app.example.preview',
        'preview.publicOrigin': 'https://app.example.preview',
        'vibemux.preview.publicOrigin': 'https://app.example.preview',
        'node.publicIp': '203.0.113.10',
      },
      missingPlatformVariable: 'error',
    },
  })

  assert.deepEqual(result?.payload.variables, {
    BETTER_AUTH_URL: 'https://app.example.preview',
    BETTER_AUTH_TRUSTED_ORIGINS: 'https://app.example.preview',
    NODE_PUBLIC_IP: '203.0.113.10',
  })
})

test('resolveRuntimeEnvironmentExecution errors on missing user variables', () => {
  assert.throws(
    () => resolveRuntimeEnvironmentExecution({
      projectConfig: {
        mode: 'process-env',
        content: 'AUTH_URL=${{ MISSING_USER_VAR }}',
      },
    }),
    /环境变量不存在：MISSING_USER_VAR/,
  )

  assert.throws(
    () => resolveRuntimeEnvironmentExecution({
      projectConfig: {
        mode: 'process-env',
        content: 'TOKEN=${{ project.MISSING }}',
      },
    }),
    /项目级环境变量不存在：MISSING/,
  )

  assert.throws(
    () => resolveRuntimeEnvironmentExecution({
      projectConfig: {
        mode: 'process-env',
        content: 'TOKEN=project',
      },
      workspaceConfig: {
        mode: 'process-env',
        content: 'TOKEN=${{ workspace.MISSING }}',
      },
    }),
    /工作区级环境变量不存在：MISSING/,
  )
})

test('resolveRuntimeEnvironmentExecution errors on self and cyclic references', () => {
  assert.throws(
    () => resolveRuntimeEnvironmentExecution({
      projectConfig: {
        mode: 'process-env',
        content: 'A=${{ A }}',
      },
    }),
    /环境变量引用存在循环：A/,
  )

  assert.throws(
    () => resolveRuntimeEnvironmentExecution({
      projectConfig: {
        mode: 'process-env',
        content: [
          'A=${{ B }}',
          'B=${{ A }}',
        ].join('\n'),
      },
    }),
    /环境变量引用存在循环/,
  )
})

test('resolveRuntimeEnvironmentExecution preserves missing platform variables by default', () => {
  const result = resolveRuntimeEnvironmentExecution({
    projectConfig: {
      mode: 'process-env',
      content: [
        'BETTER_AUTH_URL=${{ preview.publicUrl }}',
        'STATIC=ok',
      ].join('\n'),
    },
    referenceContext: {
      missingPlatformVariable: 'preserve',
    },
  })

  assert.equal(result?.payload.variables.BETTER_AUTH_URL, '${{ preview.publicUrl }}')
  assert.equal(result?.payload.variables.STATIC, 'ok')
})

test('resolveRuntimeEnvironmentExecution errors on missing platform variables when configured', () => {
  assert.throws(
    () => resolveRuntimeEnvironmentExecution({
      projectConfig: {
        mode: 'process-env',
        content: 'BETTER_AUTH_URL=${{ preview.publicUrl }}',
      },
      referenceContext: {
        missingPlatformVariable: 'error',
      },
    }),
    /平台环境变量不可用：preview\.publicUrl/,
  )
})

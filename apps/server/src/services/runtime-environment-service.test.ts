import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRuntimeEnvironmentPlatformVariables,
  buildRuntimeEnvironmentReferenceContext,
} from './runtime-environment-service'

test('buildRuntimeEnvironmentPlatformVariables maps project/workspace/preview/node fields with vibemux aliases', () => {
  const variables = buildRuntimeEnvironmentPlatformVariables({
    project: { id: 'project-1' },
    workspace: { id: 'workspace-1' },
    workspaceSession: { id: 'session-1' },
    task: { id: 'task-1' },
    preview: {
      publicUrl: 'https://demo.preview.example',
      publicHost: 'demo.preview.example',
      port: 3000,
    },
    executor: {
      executorId: 'executor-1',
      name: 'Mac Mini',
      machineName: 'mac-mini.local',
      previewIngressDetectedPublicIp: '203.0.113.8',
      previewIngressDetectedLanIp: '192.168.1.20',
      presence: {
        runningTaskIds: [],
        queuedTaskIds: [],
        lastHeartbeatAt: new Date().toISOString(),
        mesh: {
          enabled: true,
          status: 'ready',
          meshIpv4: '10.144.1.2',
          meshHostname: 'node-a.mesh',
          reportedAt: new Date().toISOString(),
        },
      },
    },
  })

  assert.equal(variables['project.id'], 'project-1')
  assert.equal(variables['vibemux.project.id'], 'project-1')
  assert.equal(variables['workspace.id'], 'workspace-1')
  assert.equal(variables['workspaceSession.id'], 'session-1')
  assert.equal(variables['task.id'], 'task-1')
  assert.equal(variables['preview.publicUrl'], 'https://demo.preview.example')
  assert.equal(variables['preview.publicOrigin'], 'https://demo.preview.example')
  assert.equal(variables['preview.publicHost'], 'demo.preview.example')
  assert.equal(variables['preview.port'], '3000')
  assert.equal(variables['node.id'], 'executor-1')
  assert.equal(variables['node.name'], 'Mac Mini')
  assert.equal(variables['node.machineName'], 'mac-mini.local')
  assert.equal(variables['node.publicIp'], '203.0.113.8')
  assert.equal(variables['node.lanIp'], '192.168.1.20')
  assert.equal(variables['node.meshIp'], '10.144.1.2')
  assert.equal(variables['node.meshHostname'], 'node-a.mesh')
  assert.equal(variables['vibemux.node.meshIp'], '10.144.1.2')
})

test('buildRuntimeEnvironmentPlatformVariables omits empty fields and derives origin from publicUrl', () => {
  const variables = buildRuntimeEnvironmentPlatformVariables({
    preview: {
      publicUrl: 'https://app.example:8443/path',
    },
    executor: {
      executorId: 'executor-1',
      name: 'node',
      machineName: 'node',
      previewIngressDetectedPublicIp: '  ',
    },
  })

  assert.equal(variables['preview.publicUrl'], 'https://app.example:8443/path')
  assert.equal(variables['preview.publicOrigin'], 'https://app.example:8443')
  assert.equal(variables['node.publicIp'], undefined)
  assert.equal(variables['node.lanIp'], undefined)
})

test('buildRuntimeEnvironmentReferenceContext defaults missing platform vars to preserve', () => {
  const context = buildRuntimeEnvironmentReferenceContext({
    platform: {
      project: { id: 'p1' },
    },
  })

  assert.equal(context.missingPlatformVariable, 'preserve')
  assert.equal(context.platformVariables?.['project.id'], 'p1')
})

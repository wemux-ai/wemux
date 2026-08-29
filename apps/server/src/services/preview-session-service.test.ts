import assert from 'node:assert/strict'
import test from 'node:test'
import { previewSessionService } from './preview-session-service'
import { normalizePreviewPublicUrl } from './preview-hostname'

test('createOrReuseSession keeps the original preview host for a reused session', async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const created = previewSessionService.createOrReuseSession({
      previewId: 'preview-session-original',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'workspace-session-1',
      executorId: 'executor-1',
      ownerUserId: 'user-1',
      source: {
        appUrl: 'http://127.0.0.1:3000/',
        targetProtocol: 'http',
        targetHost: '127.0.0.1',
        targetPort: 3000,
        targetBasePath: '/',
      },
      additionalSources: [],
      publicHost: 'alpha-preview--preview-session-original.wemux.localtest.me:8989',
      publicUrl: 'http://alpha-preview--preview-session-original.wemux.localtest.me:8989/',
    })

    assert.equal(created.created, true)

    const reused = previewSessionService.createOrReuseSession({
      previewId: 'preview-session-replacement',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'workspace-session-1',
      executorId: 'executor-1',
      ownerUserId: 'user-1',
      source: {
        appUrl: 'http://127.0.0.1:3000/',
        targetProtocol: 'http',
        targetHost: '127.0.0.1',
        targetPort: 3000,
        targetBasePath: '/',
      },
      additionalSources: [],
      publicHost: 'beta-preview--preview-session-replacement.wemux.localtest.me:8989',
      publicUrl: 'http://beta-preview--preview-session-replacement.wemux.localtest.me:8989/',
    })

    assert.equal(reused.created, false)
    assert.equal(reused.session.id, created.session.id)
    assert.equal(reused.session.publicHost, created.session.publicHost)
    assert.equal(reused.session.publicUrl, created.session.publicUrl)
    assert.equal(
      previewSessionService.getSessionByHost(created.session.publicHost)?.id,
      created.session.id,
    )
    assert.equal(
      previewSessionService.getSessionByHost('beta-preview--preview-session-replacement.wemux.localtest.me:8989'),
      null,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    console.error = originalConsoleError
  }
})

test('createOrReuseSession reuses a running preview across workspace sessions in the same workspace', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-workspace-scope-original',
    projectId: 'project-workspace-scope',
    taskId: 'task-workspace-scope',
    workspaceId: 'workspace-scope',
    workspaceSessionId: 'workspace-session-scope-a',
    executorId: 'executor-workspace-scope',
    ownerUserId: 'user-workspace-scope',
    source: {
      appUrl: 'http://127.0.0.1:3100/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3100,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'scope-preview--preview-workspace-scope-original.wemux.localtest.me:8989',
    publicUrl: 'http://scope-preview--preview-workspace-scope-original.wemux.localtest.me:8989/',
  })

  assert.equal(created.created, true)

  const reused = previewSessionService.createOrReuseSession({
    previewId: 'preview-workspace-scope-replacement',
    projectId: 'project-workspace-scope',
    taskId: 'task-workspace-scope',
    workspaceId: 'workspace-scope',
    workspaceSessionId: 'workspace-session-scope-b',
    executorId: 'executor-workspace-scope',
    ownerUserId: 'user-workspace-scope',
    source: {
      appUrl: 'http://127.0.0.1:3100/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3100,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'scope-preview--preview-workspace-scope-replacement.wemux.localtest.me:8989',
    publicUrl: 'http://scope-preview--preview-workspace-scope-replacement.wemux.localtest.me:8989/',
  })

  assert.equal(reused.created, false)
  assert.equal(reused.session.id, created.session.id)
  assert.equal(reused.session.workspaceSessionId, 'workspace-session-scope-b')
  assert.equal(
    previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: 'task-workspace-scope',
      workspaceId: 'workspace-scope',
      ownerUserId: 'user-workspace-scope',
    })?.id,
    created.session.id,
  )
})

test('createOrReuseSession does not reuse a preview when access mode changes', () => {
  const tunnelPreview = previewSessionService.createOrReuseSession({
    previewId: 'preview-access-mode-tunnel',
    projectId: 'project-access-mode',
    taskId: 'task-access-mode',
    workspaceId: 'workspace-access-mode',
    workspaceSessionId: 'workspace-session-access-mode-a',
    executorId: 'executor-access-mode',
    ownerUserId: 'user-access-mode',
    source: {
      appUrl: 'http://127.0.0.1:3300/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3300,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'access-mode-tunnel-preview--preview-access-mode-tunnel.wemux.localtest.me:8989',
    publicUrl: 'http://access-mode-tunnel-preview--preview-access-mode-tunnel.wemux.localtest.me:8989/',
    accessMode: 'tunnel',
  })

  assert.equal(tunnelPreview.created, true)

  previewSessionService.close(tunnelPreview.session.id, 'replaced_by_public_proxy')

  const publicPreview = previewSessionService.createOrReuseSession({
    previewId: 'preview-access-mode-public',
    projectId: 'project-access-mode',
    taskId: 'task-access-mode',
    workspaceId: 'workspace-access-mode',
    workspaceSessionId: 'workspace-session-access-mode-b',
    executorId: 'executor-access-mode',
    ownerUserId: 'user-access-mode',
    source: {
      appUrl: 'http://127.0.0.1:3300/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3300,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'access-mode-public-preview--preview-access-mode-public.wemux.localtest.me:8989',
    publicUrl: 'http://access-mode-public-preview--preview-access-mode-public.wemux.localtest.me:8989/',
    accessMode: 'public-proxy',
  })

  assert.equal(publicPreview.created, true)
  assert.notEqual(publicPreview.session.id, tunnelPreview.session.id)
  assert.equal(publicPreview.session.accessMode, 'public-proxy')
})

test('getOwnerSessionForTaskWorkspace filters current previews by executor', () => {
  const oldExecutorPreview = previewSessionService.createOrReuseSession({
    previewId: 'preview-executor-filter-old',
    projectId: 'project-executor-filter',
    taskId: 'task-executor-filter',
    workspaceId: 'workspace-executor-filter',
    workspaceSessionId: 'workspace-session-executor-filter-old',
    executorId: 'executor-filter-old',
    ownerUserId: 'user-executor-filter',
    source: {
      appUrl: 'http://127.0.0.1:3200/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3200,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'executor-filter-old-preview--preview-executor-filter-old.wemux.localtest.me:8989',
    publicUrl: 'http://executor-filter-old-preview--preview-executor-filter-old.wemux.localtest.me:8989/',
  })

  assert.equal(oldExecutorPreview.created, true)
  assert.equal(
    previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: 'task-executor-filter',
      workspaceId: 'workspace-executor-filter',
      ownerUserId: 'user-executor-filter',
      executorId: 'executor-filter-new',
    }),
    null,
  )

  const newExecutorPreview = previewSessionService.createOrReuseSession({
    previewId: 'preview-executor-filter-new',
    projectId: 'project-executor-filter',
    taskId: 'task-executor-filter',
    workspaceId: 'workspace-executor-filter',
    workspaceSessionId: 'workspace-session-executor-filter-new',
    executorId: 'executor-filter-new',
    ownerUserId: 'user-executor-filter',
    source: {
      appUrl: 'http://127.0.0.1:3200/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3200,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'executor-filter-new-preview--preview-executor-filter-new.wemux.localtest.me:8989',
    publicUrl: 'http://executor-filter-new-preview--preview-executor-filter-new.wemux.localtest.me:8989/',
  })

  assert.equal(newExecutorPreview.created, true)
  assert.equal(
    previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: 'task-executor-filter',
      workspaceId: 'workspace-executor-filter',
      ownerUserId: 'user-executor-filter',
      executorId: 'executor-filter-old',
    })?.id,
    oldExecutorPreview.session.id,
  )
  assert.equal(
    previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: 'task-executor-filter',
      workspaceId: 'workspace-executor-filter',
      ownerUserId: 'user-executor-filter',
      executorId: 'executor-filter-new',
    })?.id,
    newExecutorPreview.session.id,
  )
})

test('createOrReuseSession keeps app and desktop previews separate for the same workspace', () => {
  const appPreview = previewSessionService.createOrReuseSession({
    previewId: 'preview-purpose-app',
    projectId: 'project-purpose',
    taskId: 'task-purpose',
    workspaceId: 'workspace-purpose',
    workspaceSessionId: 'workspace-session-purpose',
    executorId: 'executor-purpose',
    ownerUserId: 'user-purpose',
    source: {
      appUrl: 'http://127.0.0.1:3000/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3000,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'purpose-app-preview--preview-purpose-app.wemux.localtest.me:8989',
    publicUrl: 'http://purpose-app-preview--preview-purpose-app.wemux.localtest.me:8989/',
  })

  const desktopPreview = previewSessionService.createOrReuseSession({
    previewId: 'preview-purpose-desktop',
    purpose: 'desktop',
    projectId: 'project-purpose',
    taskId: 'task-purpose',
    workspaceId: 'workspace-purpose',
    workspaceSessionId: 'workspace-session-purpose',
    executorId: 'executor-purpose',
    ownerUserId: 'user-purpose',
    source: {
      appUrl: 'http://127.0.0.1:49745/proxy/6080/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 49745,
      targetBasePath: '/proxy/6080/',
    },
    additionalSources: [],
    publicHost: 'purpose-desktop-preview--preview-purpose-desktop.wemux.localtest.me:8989',
    publicUrl: 'http://purpose-desktop-preview--preview-purpose-desktop.wemux.localtest.me:8989/',
  })

  assert.equal(appPreview.created, true)
  assert.equal(desktopPreview.created, true)
  assert.notEqual(appPreview.session.id, desktopPreview.session.id)
  assert.equal(
    previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: 'task-purpose',
      workspaceId: 'workspace-purpose',
      ownerUserId: 'user-purpose',
    })?.id,
    appPreview.session.id,
  )
  assert.equal(
    previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: 'task-purpose',
      workspaceId: 'workspace-purpose',
      ownerUserId: 'user-purpose',
      purpose: 'desktop',
    })?.id,
    desktopPreview.session.id,
  )
})

test('createOrReuseSession normalizes duplicate preview bindings for the same port', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-duplicate-bindings',
    projectId: 'project-duplicate-bindings',
    taskId: 'task-duplicate-bindings',
    workspaceId: 'workspace-duplicate-bindings',
    workspaceSessionId: 'workspace-session-duplicate-bindings',
    executorId: 'executor-duplicate-bindings',
    ownerUserId: 'user-duplicate-bindings',
    source: {
      appUrl: 'http://127.0.0.1:3005/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3005,
      targetBasePath: '/',
    },
    sourceBinding: {
      id: 'primary-preview',
      appUrl: 'http://127.0.0.1:3005/',
      publicHost: 'preview-3005-primary.wemux.xyz',
      publicUrl: 'https://preview-3005-primary.wemux.xyz/',
      port: 3005,
    },
    additionalSources: [{
      appUrl: 'http://localhost:3005/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3005,
      targetBasePath: '/',
    }],
    additionalSourceBindings: [{
      id: 'duplicate-preview',
      appUrl: 'http://localhost:3005/',
      publicHost: 'preview-3005-duplicate.wemux.xyz',
      publicUrl: 'https://preview-3005-duplicate.wemux.xyz/',
      port: 3005,
      note: 'Preview',
      domainType: 'generated',
    }],
    publicHost: 'preview-3005-primary.wemux.xyz',
    publicUrl: 'https://preview-3005-primary.wemux.xyz/',
  })

  assert.equal(created.created, true)
  assert.equal(created.session.additionalSourceBindings.length, 0)
  assert.equal(created.session.additionalSources.length, 0)

  const dto = previewSessionService.toDto(created.session)
  assert.equal(dto.domainBindings?.length, 1)
  assert.equal(dto.additionalSourceAppUrls.length, 0)
})

test('createOrReuseSession cleans duplicate preview bindings when reusing an existing session', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-reuse-dedupe',
    projectId: 'project-reuse-dedupe',
    taskId: 'task-reuse-dedupe',
    workspaceId: 'workspace-reuse-dedupe',
    workspaceSessionId: 'workspace-session-reuse-dedupe-a',
    executorId: 'executor-reuse-dedupe',
    ownerUserId: 'user-reuse-dedupe',
    source: {
      appUrl: 'http://127.0.0.1:3005/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3005,
      targetBasePath: '/',
    },
    additionalSources: [{
      appUrl: 'http://localhost:3005/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3005,
      targetBasePath: '/',
    }],
    additionalSourceBindings: [{
      id: 'duplicate-preview-reuse',
      appUrl: 'http://localhost:3005/',
      publicHost: 'preview-3005-reuse-duplicate.wemux.xyz',
      publicUrl: 'https://preview-3005-reuse-duplicate.wemux.xyz/',
      port: 3005,
      note: 'Preview',
      domainType: 'generated',
    }],
    publicHost: 'preview-3005-reuse-primary.wemux.xyz',
    publicUrl: 'https://preview-3005-reuse-primary.wemux.xyz/',
  })

  assert.equal(created.created, true)

  const reused = previewSessionService.createOrReuseSession({
    previewId: 'preview-reuse-dedupe-next',
    projectId: 'project-reuse-dedupe',
    taskId: 'task-reuse-dedupe',
    workspaceId: 'workspace-reuse-dedupe',
    workspaceSessionId: 'workspace-session-reuse-dedupe-b',
    executorId: 'executor-reuse-dedupe',
    ownerUserId: 'user-reuse-dedupe',
    source: {
      appUrl: 'http://127.0.0.1:3005/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3005,
      targetBasePath: '/',
    },
    additionalSources: [{
      appUrl: 'http://127.0.0.1:4111/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 4111,
      targetBasePath: '/',
    }],
    additionalSourceBindings: [{
      id: 'mastra',
      appUrl: 'http://127.0.0.1:4111/',
      publicHost: 'preview-4111-reuse.wemux.xyz',
      publicUrl: 'https://preview-4111-reuse.wemux.xyz/',
      port: 4111,
      note: 'mastra',
      domainType: 'custom',
    }],
    publicHost: 'preview-3005-reuse-primary-next.wemux.xyz',
    publicUrl: 'https://preview-3005-reuse-primary-next.wemux.xyz/',
  })

  assert.equal(reused.created, false)
  assert.equal(reused.session.sourceBinding?.port, 3005)
  assert.equal(reused.session.additionalSourceBindings.length, 1)
  assert.equal(reused.session.additionalSourceBindings[0]?.port, 4111)
  assert.equal(reused.session.additionalSourceBindings[0]?.note, 'mastra')
  assert.equal(reused.session.additionalSources.length, 1)
  assert.equal(reused.session.additionalSources[0]?.targetPort, 4111)
})

test('toDto keeps only unique preview domain bindings per port', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-dto-dedupe',
    projectId: 'project-dto-dedupe',
    taskId: 'task-dto-dedupe',
    workspaceId: 'workspace-dto-dedupe',
    workspaceSessionId: 'workspace-session-dto-dedupe',
    executorId: 'executor-dto-dedupe',
    ownerUserId: 'user-dto-dedupe',
    source: {
      appUrl: 'http://127.0.0.1:3005/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3005,
      targetBasePath: '/',
    },
    additionalSources: [
      {
        appUrl: 'http://localhost:3005/',
        targetProtocol: 'http',
        targetHost: '127.0.0.1',
        targetPort: 3005,
        targetBasePath: '/',
      },
      {
        appUrl: 'http://127.0.0.1:4111/',
        targetProtocol: 'http',
        targetHost: '127.0.0.1',
        targetPort: 4111,
        targetBasePath: '/',
      },
    ],
    additionalSourceBindings: [
      {
        id: 'duplicate-3005',
        appUrl: 'http://localhost:3005/',
        publicHost: 'preview-3005-dto-duplicate.wemux.xyz',
        publicUrl: 'https://preview-3005-dto-duplicate.wemux.xyz/',
        port: 3005,
        note: 'Preview',
        domainType: 'generated',
      },
      {
        id: 'mastra-4111',
        appUrl: 'http://127.0.0.1:4111/',
        publicHost: 'preview-4111-dto.wemux.xyz',
        publicUrl: 'https://preview-4111-dto.wemux.xyz/',
        port: 4111,
        note: 'mastra',
        domainType: 'custom',
      },
    ],
    publicHost: 'preview-3005-dto-primary.wemux.xyz',
    publicUrl: 'https://preview-3005-dto-primary.wemux.xyz/',
  })

  const dto = previewSessionService.toDto(created.session)
  assert.deepEqual(dto.domainBindings?.map((binding) => binding.port), [3005, 4111])
  assert.deepEqual(dto.additionalSourceAppUrls.map((binding) => binding.port), [4111])
})

test('createOrReuseSession indexes additional source domain bindings', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-additional-domain-bindings',
    projectId: 'project-additional-domain',
    taskId: 'task-additional-domain',
    workspaceId: 'workspace-additional-domain',
    workspaceSessionId: 'workspace-session-additional-domain',
    executorId: 'executor-additional-domain',
    ownerUserId: 'user-additional-domain',
    source: {
      appUrl: 'http://127.0.0.1:3000/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3000,
      targetBasePath: '/',
    },
    additionalSources: [{
      appUrl: 'http://127.0.0.1:3001/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3001,
      targetBasePath: '/',
    }],
    additionalSourceBindings: [{
      id: 'api-domain',
      appUrl: 'http://127.0.0.1:3001/',
      publicHost: 'app-3001-preview--preview-additional-domain-bindings.wemux.xyz',
      publicUrl: 'https://app-3001-preview--preview-additional-domain-bindings.wemux.xyz/',
      port: 3001,
      note: 'API',
      domainType: 'generated',
    }],
    publicHost: 'app-preview--preview-additional-domain-bindings.wemux.xyz',
    publicUrl: 'https://app-preview--preview-additional-domain-bindings.wemux.xyz/',
  })

  assert.equal(created.created, true)
  assert.equal(
    previewSessionService.getSessionByHost('app-3001-preview--preview-additional-domain-bindings.wemux.xyz')?.id,
    created.session.id,
  )

  const dto = previewSessionService.toDto(created.session)
  assert.deepEqual(dto.additionalSourceAppUrls, [{
    appUrl: 'http://127.0.0.1:3001/',
    healthUrl: undefined,
    publicUrl: 'https://app-3001-preview--preview-additional-domain-bindings.wemux.xyz/',
    previewHost: 'app-3001-preview--preview-additional-domain-bindings.wemux.xyz',
    port: 3001,
    note: 'API',
    domainType: 'generated',
  }])
  assert.deepEqual(dto.domainBindings?.[1], {
    id: 'api-domain',
    appUrl: 'http://127.0.0.1:3001/',
    publicUrl: 'https://app-3001-preview--preview-additional-domain-bindings.wemux.xyz/',
    previewHost: 'app-3001-preview--preview-additional-domain-bindings.wemux.xyz',
    port: 3001,
    note: 'API',
    domainType: 'generated',
    primary: false,
  })

  const access = previewSessionService.issueViewerAccess(created.session.id)
  assert.ok(access)
  assert.equal(access.additionalSourceAccess?.[0]?.publicUrl, 'https://app-3001-preview--preview-additional-domain-bindings.wemux.xyz/')
  assert.equal(access.additionalSourceAccess?.[0]?.note, 'API')
  assert.match(access.additionalSourceAccess?.[0]?.iframeUrl ?? '', /vmx_viewer_token=/)
})

test('normalizePreviewPublicUrl repairs malformed persisted preview urls', () => {
  assert.equal(
    normalizePreviewPublicUrl({
      publicHost: 'vibemux-preview--abc.wemux.localtest.me:18989',
      publicUrl: 'http//vibemux-preview--abc.wemux.localtest.me:18989/',
      fallbackScheme: 'http',
    }),
    'http://vibemux-preview--abc.wemux.localtest.me:18989/',
  )
  assert.equal(
    normalizePreviewPublicUrl({
      publicHost: 'vibemux-preview--abc.wemux.localtest.me:18989',
      publicUrl: '',
      fallbackScheme: 'http',
    }),
    'http://vibemux-preview--abc.wemux.localtest.me:18989/',
  )
  assert.equal(
    normalizePreviewPublicUrl({
      publicHost: 'shopping-agent-preview--abc.wemux.xyz',
      publicUrl: 'http//shopping-agent-preview--abc.wemux.xyz/',
    }),
    'https://shopping-agent-preview--abc.wemux.xyz/',
  )
})

test('updateTunnelLatency surfaces the latest preview tunnel RTT and clears it after disconnect', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-latency-session',
    projectId: 'project-latency',
    taskId: 'task-latency',
    workspaceId: 'workspace-latency',
    workspaceSessionId: 'workspace-session-latency',
    executorId: 'executor-latency',
    ownerUserId: 'user-latency',
    source: {
      appUrl: 'http://127.0.0.1:4173/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 4173,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'latency-preview--preview-latency-session.wemux.localtest.me:8989',
    publicUrl: 'http://latency-preview--preview-latency-session.wemux.localtest.me:8989/',
  })

  assert.equal(created.created, true)

  previewSessionService.markTunnelConnected(created.session.id, 'connection-latency', 'us-node-1')
  assert.equal(
    previewSessionService.getSessionById(created.session.id)?.tunnelConnectedNodeId,
    'us-node-1',
  )
  const updated = previewSessionService.updateTunnelLatency(created.session.id, 187)
  assert.equal(updated?.tunnelLatencyMs, 187)
  assert.ok(updated?.tunnelLatencySampledAt)

  previewSessionService.markTunnelDisconnected(created.session.id, 'connection-latency', 'preview tunnel websocket closed')
  assert.equal(
    previewSessionService.getSessionById(created.session.id)?.tunnelConnectedNodeId,
    undefined,
  )
  const afterDisconnect = previewSessionService.toDto(
    previewSessionService.getSessionById(created.session.id)!,
  )
  assert.equal(afterDisconnect.tunnelLatencyMs, undefined)
  assert.equal(afterDisconnect.tunnelLatencySampledAt, undefined)
})

test('exchangeBootstrapToken keeps viewer bootstrap usable across repeated iframe reloads', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-bootstrap-token-repeat',
    projectId: 'project-bootstrap',
    taskId: 'task-bootstrap',
    workspaceId: 'workspace-bootstrap',
    workspaceSessionId: 'workspace-session-bootstrap',
    executorId: 'executor-bootstrap',
    ownerUserId: 'user-bootstrap',
    source: {
      appUrl: 'http://127.0.0.1:3000/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3000,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'bootstrap-preview--preview-bootstrap-token-repeat.wemux.localtest.me:8989',
    publicUrl: 'http://bootstrap-preview--preview-bootstrap-token-repeat.wemux.localtest.me:8989/',
  })

  assert.equal(created.created, true)

  const viewer = previewSessionService.issueViewerAccess(created.session.id)
  assert.ok(viewer)

  const token = viewer.iframeUrl.split('vmx_viewer_token=')[1] || ''
  const firstExchange = previewSessionService.exchangeBootstrapToken(token)
  const secondExchange = previewSessionService.exchangeBootstrapToken(token)

  assert.equal(firstExchange?.session.id, created.session.id)
  assert.equal(secondExchange?.session.id, created.session.id)
  assert.notEqual(firstExchange?.accessToken, secondExchange?.accessToken)
  assert.equal(
    previewSessionService.verifyAccessToken(firstExchange!.accessToken, created.session.id)?.grantType,
    'owner',
  )
})

test('close revokes viewer and share access for preview sessions', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-close-revoke-access',
    projectId: 'project-close-revoke-access',
    taskId: 'task-close-revoke-access',
    workspaceId: 'workspace-close-revoke-access',
    workspaceSessionId: 'workspace-session-close-revoke-access',
    executorId: 'executor-close-revoke-access',
    ownerUserId: 'user-close-revoke-access',
    source: {
      appUrl: 'http://127.0.0.1:3999/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3999,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'close-preview--preview-close-revoke-access.wemux.localtest.me:8989',
    publicUrl: 'http://close-preview--preview-close-revoke-access.wemux.localtest.me:8989/',
  })

  const viewer = previewSessionService.issueViewerAccess(created.session.id)
  assert.ok(viewer)
  const viewerToken = viewer.iframeUrl.split('vmx_viewer_token=')[1] || ''

  const share = previewSessionService.createShare(created.session.id, 60)
  assert.ok(share)
  const shareToken = share.share.shareUrl.split('share_token=')[1] || ''

  previewSessionService.close(created.session.id, 'stopped_by_user')

  assert.equal(previewSessionService.issueViewerAccess(created.session.id), null)
  assert.equal(previewSessionService.exchangeBootstrapToken(viewerToken), null)
  assert.equal(previewSessionService.exchangeShareToken(shareToken), null)
})

test('revokeShare invalidates previously issued share access tokens', () => {
  const created = previewSessionService.createOrReuseSession({
    previewId: 'preview-share-access-revoke',
    projectId: 'project-share-access-revoke',
    taskId: 'task-share-access-revoke',
    workspaceId: 'workspace-share-access-revoke',
    workspaceSessionId: 'workspace-session-share-access-revoke',
    executorId: 'executor-share-access-revoke',
    ownerUserId: 'user-share-access-revoke',
    source: {
      appUrl: 'http://127.0.0.1:3777/',
      targetProtocol: 'http',
      targetHost: '127.0.0.1',
      targetPort: 3777,
      targetBasePath: '/',
    },
    additionalSources: [],
    publicHost: 'share-revoke-preview--preview-share-access-revoke.wemux.localtest.me:8989',
    publicUrl: 'http://share-revoke-preview--preview-share-access-revoke.wemux.localtest.me:8989/',
  })

  const share = previewSessionService.createShare(created.session.id, 60)
  assert.ok(share)

  const shareToken = share.share.shareUrl.split('share_token=')[1] || ''
  const exchanged = previewSessionService.exchangeShareToken(shareToken)
  assert.ok(exchanged)
  assert.equal(
    previewSessionService.verifyAccessToken(exchanged.accessToken, created.session.id)?.grantType,
    'share',
  )

  previewSessionService.revokeShare(created.session.id)

  assert.equal(
    previewSessionService.verifyAccessToken(exchanged.accessToken, created.session.id),
    null,
  )
})

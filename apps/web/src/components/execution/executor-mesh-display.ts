import type { ExecutorRecord, WorkerMeshPeer, WorkerMeshStatus } from '@shared/types'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

export type ExecutorMeshDisplayTone = 'success' | 'info' | 'warning' | 'danger' | 'muted'

export type ExecutorMeshDisplayState = {
  label: string
  detailLabel: string
  tone: ExecutorMeshDisplayTone
  description: string
  peerCountLabel: string
  remotePeerCount: number
}

const isSelfPeer = (mesh: WorkerMeshStatus, peer: WorkerMeshPeer) => {
  const peerIpv4 = peer.meshIpv4?.trim()
  const meshIpv4 = mesh.meshIpv4?.trim()
  return Boolean(
    (peer.executorId && peer.executorId === mesh.meshNodeId)
    || (peer.meshNodeId && peer.meshNodeId === mesh.meshNodeId)
    || (peerIpv4 && meshIpv4 && peerIpv4 === meshIpv4),
  )
}

export const getExecutorMeshRemotePeers = (mesh?: WorkerMeshStatus) => {
  if (!mesh?.peers?.length) {
    return []
  }

  return mesh.peers.filter((peer) => !isSelfPeer(mesh, peer))
}

export const getExecutorMeshDisplayState = (
  executor: Pick<ExecutorRecord, 'presence'>,
  language: string,
): ExecutorMeshDisplayState => {
  const mesh = executor.presence?.mesh
  const status = mesh?.status
  const hasMeshIp = Boolean(mesh?.meshIpv4?.trim())
  const hasError = Boolean(mesh?.errorMessage?.trim()) || status === 'error'
  const isConfigPending = Boolean(mesh?.errorMessage?.match(/control plane assigned|latest mesh enrollment|Mesh helper is using/i))
  const remotePeerCount = getExecutorMeshRemotePeers(mesh).length

  if (status === 'ready') {
    return {
      label: tr(language, 'Mesh 就绪', 'Mesh Ready'),
      detailLabel: tr(language, '就绪', 'Ready'),
      tone: 'success',
      description: tr(language, '已加入 Wemux Mesh，并发现可用的私有网络节点。', 'Joined Wemux Mesh and found reachable private network peers.'),
      peerCountLabel: tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`),
      remotePeerCount,
    }
  }

  if (isConfigPending) {
    return {
      label: tr(language, 'Mesh 配置待应用', 'Mesh Update Needed'),
      detailLabel: tr(language, '待应用', 'Update Needed'),
      tone: 'warning',
      description: tr(language, '这台节点已加入 Wemux Mesh，但本机 helper 还在使用旧的 Mesh 配置。按提示刷新 helper 后会切到当前工作区网段。', 'This node has joined Wemux Mesh, but its local helper is still using old mesh settings. Refresh the helper to move it into the current workspace subnet.'),
      peerCountLabel: tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`),
      remotePeerCount,
    }
  }

  if (hasError) {
    return {
      label: tr(language, 'Mesh 异常', 'Mesh Error'),
      detailLabel: tr(language, '异常', 'Error'),
      tone: 'danger',
      description: tr(language, 'Wemux Mesh 启动或探测失败，需要处理下方错误后才能加入私有网络。', 'Wemux Mesh failed to start or probe; fix the error below before it can join the private network.'),
      peerCountLabel: tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`),
      remotePeerCount,
    }
  }

  if (hasMeshIp) {
    return {
      label: remotePeerCount > 0
        ? tr(language, 'Mesh 已入网', 'Mesh Joined')
        : tr(language, 'Mesh 已入网', 'Mesh Joined'),
      detailLabel: tr(language, '已入网', 'Joined'),
      tone: remotePeerCount > 0 ? 'success' : 'info',
      description: remotePeerCount > 0
        ? tr(language, '已加入 Wemux Mesh，正在等待私有网络路由稳定。', 'Joined Wemux Mesh and is waiting for private routing to settle.')
        : tr(language, '这台节点已加入 Wemux Mesh。当前同一网络里暂时没有其它可用节点，所以还不会显示直连。', 'This node has joined Wemux Mesh. There are no other reachable nodes in the same network yet, so direct routing is not shown.'),
      peerCountLabel: remotePeerCount > 0
        ? tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`)
        : tr(language, '等待其它节点', 'Waiting for peers'),
      remotePeerCount,
    }
  }

  if (status === 'connecting' || status === 'installing' || status === 'degraded') {
    return {
      label: status === 'installing'
        ? tr(language, 'Mesh 安装中', 'Mesh Installing')
        : tr(language, 'Mesh 建立中', 'Mesh Connecting'),
      detailLabel: status === 'installing'
        ? tr(language, '安装中', 'Installing')
        : tr(language, '建立中', 'Connecting'),
      tone: 'warning',
      description: tr(language, 'Wemux Mesh 正在启动，还没有拿到 Mesh IP。', 'Wemux Mesh is starting and has not reported a Mesh IP yet.'),
      peerCountLabel: tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`),
      remotePeerCount,
    }
  }

  if (status === 'disabled') {
    return {
      label: tr(language, 'Mesh 已关闭', 'Mesh Disabled'),
      detailLabel: tr(language, '已关闭', 'Disabled'),
      tone: 'muted',
      description: tr(language, '这台节点没有启用 Wemux Mesh。', 'Wemux Mesh is not enabled on this node.'),
      peerCountLabel: tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`),
      remotePeerCount,
    }
  }

  return {
    label: tr(language, 'Mesh 未知', 'Mesh Unknown'),
    detailLabel: tr(language, '未知', 'Unknown'),
    tone: 'muted',
    description: tr(language, '还没有收到这台节点的 Wemux Mesh 状态。', 'No Wemux Mesh status has been reported for this node yet.'),
    peerCountLabel: tr(language, `${remotePeerCount} 个远端节点`, `${remotePeerCount} remote peer${remotePeerCount === 1 ? '' : 's'}`),
    remotePeerCount,
  }
}

export const getExecutorMeshStatusBadgeClassName = (
  state: Pick<ExecutorMeshDisplayState, 'tone'>,
  extraClassName = '',
) => {
  const baseClassName = extraClassName.trim()
  const toneClassName = state.tone === 'success'
    ? 'border-emerald-300/50 bg-emerald-500/20 text-white'
    : state.tone === 'info'
      ? 'border-sky-300/50 bg-sky-500/20 text-white'
      : state.tone === 'warning'
        ? 'border-amber-300/50 bg-amber-500/20 text-amber-50'
        : state.tone === 'danger'
          ? 'border-rose-300/50 bg-rose-500/20 text-rose-50'
          : 'border-zinc-500/70 bg-zinc-900/80 text-zinc-50'
  return baseClassName ? `${toneClassName} ${baseClassName}` : toneClassName
}

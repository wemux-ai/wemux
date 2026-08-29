// [INPUT]: 用户可见 Agent/工作区/机器图谱数据（/api/agent-universe/graph）
// [OUTPUT]: Agent 宇宙图谱视图（Obsidian 式实时物理球图：rAF 物理引擎——弹簧/斥力/球碰撞/
//           节点拖拽惯性；头像节点；单击选中 / 双击跳转 / 缩放平移 / 筛选 / 图例统计）
// [POS]: feature Agent 宇宙视图 v2；零新依赖（自研轻量物理引擎，DOM 直操作保持丝滑）；
//        节点=Agent（状态色描边 + 头像 + 忙碌光晕），工作区/机器为上下文节点；
//        点击交互：单击=选中（固定详情卡+高亮邻居），双击=跳对应管理页，拖动=物理甩动
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Orbit, Search } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { AgentUniverseGraph, AgentUniverseNode } from '@shared/types'
import { agentsMethods } from '../../lib/api/methods/agents'
import { resolveMediaUrl } from '../../lib/api'
import { cn } from '../../lib/utils'

const VIEW_W = 1000
const VIEW_H = 640

type AgentVisualStatus = 'working' | 'online' | 'offline' | 'error'

const AGENT_STATUS_COLOR: Record<AgentVisualStatus, string> = {
  working: '#fbbf24',
  online: '#a78bfa',
  offline: '#71717a',
  error: '#ef4444',
}

const NODE_TYPE_COLOR: Record<Exclude<AgentUniverseNode['type'], 'agent'>, string> = {
  workspace: '#34d399',
  executor: '#38bdf8',
}

const EDGE_COLOR: Record<string, string> = {
  belongs_to: '#059669',
  runs_on: '#0284c7',
  executes_on: '#52525b',
  collaborates: '#db2777',
}

const NODE_RADIUS: Record<AgentUniverseNode['type'], number> = {
  agent: 14,
  workspace: 9,
  executor: 9,
}

/** 物理引擎参数（每帧 dt=1 的离散积分） */
const PHYSICS = {
  repulsion: 2800,
  /** 斥力作用范围：大于此间距不再排斥（避免远处持续力导致永不收敛/微动） */
  repelRange: 100,
  springLength: 110,
  springStrength: 0.02,
  damping: 0.86,
  restitution: 0.65,
  maxVelocity: 7,
  edgeMargin: 42,
  /** 停止判定：每帧最大位移小于该值（px）视为静止，停止 rAF 循环 */
  stillnessThreshold: 0.05,
}

const agentVisualStatus = (node: Extract<AgentUniverseNode, { type: 'agent' }>): AgentVisualStatus => {
  if (node.liveBusyCount > 0) return 'working'
  if (node.status === 'error') return 'error'
  if (node.status === 'offline') return 'offline'
  return 'online'
}

const nodeColor = (node: AgentUniverseNode): string => {
  if (node.type === 'agent') return AGENT_STATUS_COLOR[agentVisualStatus(node)]
  return NODE_TYPE_COLOR[node.type]
}

type PhysicsBody = { x: number; y: number; vx: number; vy: number; r: number }

const sanitizeSvgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_')

export const createBodies = (
  nodes: AgentUniverseNode[],
  previous: Map<string, PhysicsBody> | null,
): Map<string, PhysicsBody> => {
  const bodies = new Map<string, PhysicsBody>()
  for (const node of nodes) {
    const radius = NODE_RADIUS[node.type]
    const prior = previous?.get(node.id)
    bodies.set(node.id, prior
      ? { ...prior, r: radius }
      : {
        x: VIEW_W / 2 + (Math.random() - 0.5) * VIEW_W * 0.5,
        y: VIEW_H / 2 + (Math.random() - 0.5) * VIEW_H * 0.5,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r: radius,
      })
  }
  return bodies
}

/** 单步物理：弹簧（边）+ 斥力（全对）+ 球碰撞（分离+弹性）+ 积分/阻尼/边界。返回是否仍在运动。
 * draggedId：拖拽中的节点（位置由指针控制，不积分）；pinnedIds：固定节点（位置锁定，当墙推其他球）。 */
export const stepPhysics = (
  bodies: Map<string, PhysicsBody>,
  edges: AgentUniverseGraph['edges'],
  draggedId: string | null,
  pinnedIds: ReadonlySet<string> = new Set(),
): boolean => {
  const dragged = draggedId ? bodies.get(draggedId) ?? null : null
  const isFrozen = (body: PhysicsBody, id: string) => body === dragged || pinnedIds.has(id)
  const items = [...bodies.entries()]
  const p = PHYSICS

  // 弹簧
  for (const edge of edges) {
    const a = bodies.get(edge.source)
    const b = bodies.get(edge.target)
    if (!a || !b) continue
    let dx = b.x - a.x
    let dy = b.y - a.y
    const dist = Math.hypot(dx, dy) || 1
    const force = (dist - p.springLength) * p.springStrength
    dx /= dist
    dy /= dist
    if (!isFrozen(a, edge.source)) { a.vx += dx * force; a.vy += dy * force }
    if (!isFrozen(b, edge.target)) { b.vx -= dx * force; b.vy -= dy * force }
  }

  // 斥力 + 碰撞
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [idA, a] = items[i]
      const [idB, b] = items[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist = Math.hypot(dx, dy) || 1
      // 斥力（带距离截止：> repelRange 不再排斥，保证平衡点外力趋零、系统能收敛停下）
      const nx = dx / dist
      const ny = dy / dist
      if (dist < p.repelRange) {
        const t = 1 - dist / p.repelRange
        const repulse = (p.repulsion * t * t) / Math.max(dist, 1)
        if (!isFrozen(a, idA)) { a.vx -= nx * repulse; a.vy -= ny * repulse }
        if (!isFrozen(b, idB)) { b.vx += nx * repulse; b.vy += ny * repulse }
      }

      // 碰撞：位置分离 + 弹性速度交换（被拖节点视为移动中的重球：位置由指针控制，
      // 用其拖拽速度把被撞节点弹飞；固定节点视为静止墙）
      const minDist = a.r + b.r
      if (dist < minDist) {
        const overlap = minDist - dist
        const aFrozen = isFrozen(a, idA)
        const bFrozen = isFrozen(b, idB)
        if (aFrozen && !bFrozen) {
          b.x += nx * overlap * 1.15
          b.y += ny * overlap * 1.15
          const hit = nx * a.vx + ny * a.vy
          if (hit > 0) { b.vx += nx * hit * 2.2; b.vy += ny * hit * 2.2 }
        } else if (bFrozen && !aFrozen) {
          a.x -= nx * overlap * 1.15
          a.y -= ny * overlap * 1.15
          const hit = nx * b.vx + ny * b.vy
          if (hit > 0) { a.vx -= nx * hit * 2.2; a.vy -= ny * hit * 2.2 }
        } else if (aFrozen && bFrozen) {
          // 两个都固定/拖拽：各推一半（拖拽方仍被指针覆盖，固定方保持）
          if (a !== dragged) { a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5 }
          if (b !== dragged) { b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5 }
        } else {
          const totalMass = a.r * a.r + b.r * b.r || 1
          const aRatio = (b.r * b.r) / totalMass
          const bRatio = (a.r * a.r) / totalMass
          a.x -= nx * overlap * aRatio
          a.y -= ny * overlap * aRatio
          b.x += nx * overlap * bRatio
          b.y += ny * overlap * bRatio

          const rvx = b.vx - a.vx
          const rvy = b.vy - a.vy
          const velAlongNormal = rvx * nx + rvy * ny
          if (velAlongNormal < 0) {
            const impulse = (-(1 + p.restitution) * velAlongNormal) / 2
            a.vx -= impulse * nx; a.vy -= impulse * ny
            b.vx += impulse * nx; b.vy += impulse * ny
          }
        }
      }
    }
  }

  // 积分 + 阻尼 + 边界 + 速度钳制（跳过被拖/固定节点）；停止判定 = 最大位移
  let maxDisplacement = 0
  for (const [id, item] of items) {
    if (isFrozen(item, id)) continue
    const speed = Math.hypot(item.vx, item.vy)
    if (speed > p.maxVelocity) {
      const scale = p.maxVelocity / speed
      item.vx *= scale
      item.vy *= scale
    }
    item.vx *= p.damping
    item.vy *= p.damping
    item.x += item.vx
    item.y += item.vy
    if (item.x < p.edgeMargin) { item.x = p.edgeMargin; item.vx *= -0.5 }
    if (item.x > VIEW_W - p.edgeMargin) { item.x = VIEW_W - p.edgeMargin; item.vx *= -0.5 }
    if (item.y < p.edgeMargin) { item.y = p.edgeMargin; item.vy *= -0.5 }
    if (item.y > VIEW_H - p.edgeMargin) { item.y = VIEW_H - p.edgeMargin; item.vy *= -0.5 }
    maxDisplacement = Math.max(maxDisplacement, Math.abs(item.vx), Math.abs(item.vy))
  }
  return maxDisplacement > p.stillnessThreshold
}

/** 工作区子图过滤：只保留目标工作区节点 + 直达 Agent/机器 + 直接边（供筛选下拉使用）。 */
export const filterByWorkspace = (
  nodes: AgentUniverseNode[],
  edges: AgentUniverseGraph['edges'],
  workspaceId: string,
): { nodes: AgentUniverseNode[]; edges: AgentUniverseGraph['edges'] } => {
  const wsId = `workspace:${workspaceId}`
  const keep = new Set([wsId])
  const keepEdges = edges.filter((edge) => edge.source === wsId || edge.target === wsId)
  for (const edge of keepEdges) {
    keep.add(edge.source)
    keep.add(edge.target)
  }
  return {
    nodes: nodes.filter((node) => keep.has(node.id)),
    edges: keepEdges,
  }
}

type FilterStatus = 'all' | 'working' | 'online' | 'offline'

type DragState =
  | { mode: 'node'; id: string; startClientX: number; startClientY: number; moved: boolean; lastViewX: number; lastViewY: number; prevViewX: number; prevViewY: number }
  | { mode: 'pan'; startClientX: number; startClientY: number; origX: number; origY: number }
  | null

export function AgentUniverseView({ workspaceFilter: routeWorkspaceFilter }: { workspaceFilter?: string }) {
  const [graph, setGraph] = useState<AgentUniverseGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [query, setQuery] = useState('')
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const pinnedRef = useRef<Set<string>>(new Set())

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      pinnedRef.current = next
      return next
    })
  }

  const svgRef = useRef<SVGSVGElement>(null)
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map())
  const nodeElsRef = useRef<Map<string, SVGGElement>>(new Map())
  const edgeElsRef = useRef<Map<string, SVGLineElement>>(new Map())
  const edgesRef = useRef<AgentUniverseGraph['edges']>([])
  const rafRef = useRef<number>(0)
  const runningRef = useRef(false)
  const dragStateRef = useRef<DragState>(null)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    setLoading(true)
    const load = () => agentsMethods.getAgentUniverseGraph(routeWorkspaceFilter)
      .then((res) => { if (alive) setGraph(res.graph) })
      .catch(() => { if (alive) setGraph({ nodes: [], edges: [] }) })
      .finally(() => { if (alive) setLoading(false) })
    void load()
    const timer = window.setInterval(load, 30_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [routeWorkspaceFilter])

  const filteredGraph = useMemo(() => {
    if (!graph) return graph
    const normalized = query.trim().toLowerCase()
    const agentVisible = (node: AgentUniverseNode): boolean => {
      if (node.type !== 'agent') return true
      if (statusFilter === 'working' && node.liveBusyCount === 0) return false
      if (statusFilter === 'online' && (node.liveBusyCount > 0 || node.status !== 'online')) return false
      if (statusFilter === 'offline' && node.status !== 'offline' && node.status !== 'error') return false
      if (normalized && !node.label.toLowerCase().includes(normalized)) return false
      return true
    }
    const visibleIds = new Set(graph.nodes.filter(agentVisible).map((node) => node.id))
    let nodes = graph.nodes.filter((node) => visibleIds.has(node.id))
    let edges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    // 工作区子图过滤：只保留目标工作区 + 直达 Agent/机器 + 直接边
    if (selectedWorkspaceId) {
      const sub = filterByWorkspace(nodes, edges, selectedWorkspaceId)
      nodes = sub.nodes
      edges = sub.edges
    }
    return { nodes, edges }
  }, [graph, statusFilter, selectedWorkspaceId, query])

  // —— 物理循环（DOM 直操作，不触发 React 渲染）——
  const syncDom = useCallback(() => {
    for (const [id, el] of nodeElsRef.current) {
      const body = bodiesRef.current.get(id)
      if (!body) continue
      el.setAttribute('transform', `translate(${body.x}, ${body.y})`)
    }
    for (const [key, line] of edgeElsRef.current) {
      const [source, target] = key.split('→')
      const a = bodiesRef.current.get(source)
      const b = bodiesRef.current.get(target)
      if (!a || !b) continue
      line.setAttribute('x1', String(a.x))
      line.setAttribute('y1', String(a.y))
      line.setAttribute('x2', String(b.x))
      line.setAttribute('y2', String(b.y))
    }
  }, [])

  const stopLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    runningRef.current = false
  }, [])

  const startLoop = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    const loop = () => {
      const dragging = dragStateRef.current?.mode === 'node' ? dragStateRef.current.id : null
      const moving = stepPhysics(bodiesRef.current, edgesRef.current, dragging, pinnedRef.current)
      syncDom()
      if (moving || dragging) {
        rafRef.current = requestAnimationFrame(loop)
      } else {
        runningRef.current = false
        rafRef.current = 0
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [syncDom])

  // 数据/筛选变化 → 重建物理体（保留旧位置）+ 重启循环
  useEffect(() => {
    if (!filteredGraph) return
    edgesRef.current = filteredGraph.edges
    bodiesRef.current = createBodies(filteredGraph.nodes, bodiesRef.current)
    startLoop()
    return stopLoop
  }, [filteredGraph, startLoop, stopLoop])

  // 渲染前惰性初始化物理体（filteredGraph 首次可用时），保证首帧节点/边有真实位置
  if (filteredGraph && bodiesRef.current.size === 0) {
    bodiesRef.current = createBodies(filteredGraph.nodes, null)
  }

  useEffect(() => () => stopLoop(), [stopLoop])

  // —— 坐标换算与画布交互 ——
  const toViewBox = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()!
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2
    setTransform((t) => {
      const k = Math.min(3.5, Math.max(0.3, t.k * factor))
      const { x, y } = toViewBox(event.clientX, event.clientY)
      return { x: x - (x - t.x) * (k / t.k), y: y - (y - t.y) * (k / t.k), k }
    })
  }

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = event.target as Element
    if (target !== event.currentTarget && target.getAttribute('data-pan-bg') !== 'true') return
    // 空白：平移画布 + 取消选中
    setSelectedId(null)
    dragStateRef.current = { mode: 'pan', startClientX: event.clientX, startClientY: event.clientY, origX: transform.x, origY: transform.y }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragStateRef.current
    if (!drag) return
    if (drag.mode === 'pan') {
      setTransform((t) => ({ ...t, x: drag.origX + (event.clientX - drag.startClientX), y: drag.origY + (event.clientY - drag.startClientY) }))
      return
    }
    // 节点拖拽：位移超阈值判定为拖动，物理体位置跟随指针（viewBox 坐标）
    const view = toViewBox(event.clientX, event.clientY)
    const moved = drag.moved || Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) > 4
    const body = bodiesRef.current.get(drag.id)
    if (body) {
      if (moved) {
        drag.prevViewX = drag.lastViewX
        drag.prevViewY = drag.lastViewY
        // 记录拖拽速度（每帧位移），供碰撞弹飞被撞球使用
        body.vx = view.x - body.x
        body.vy = view.y - body.y
        body.x = view.x
        body.y = view.y
      }
      drag.lastViewX = view.x
      drag.lastViewY = view.y
    }
    drag.moved = moved
    if (moved) startLoop()
  }

  const openNode = (node: AgentUniverseNode) => {
    if (node.type === 'agent') {
      void navigate({ to: '/agents' as never, params: {} as never, search: { agentId: node.agentId, tab: 'overview' } as never })
    } else if (node.type === 'workspace') {
      void navigate({ to: '/workspaces' as never, params: {} as never, search: { workspaceId: node.workspaceId } as never })
    } else {
      void navigate({ to: '/execution' as never, params: {} as never, search: {} as never })
    }
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragStateRef.current
    dragStateRef.current = null
    if (!drag) return
    if (drag.mode === 'pan') return

    const node = filteredGraph?.nodes.find((item) => item.id === drag.id)
    if (drag.moved) {
      // 松手 → 惯性：用最近两次指针位置估算速度
      const body = bodiesRef.current.get(drag.id)
      if (body) {
        body.vx = drag.lastViewX - drag.prevViewX
        body.vy = drag.lastViewY - drag.prevViewY
      }
      startLoop()
      return
    }
    // 未移动 = 点击：双击（同节点 <320ms）跳转，否则选中
    if (!node) return
    const now = Date.now()
    const last = lastClickRef.current
    if (last && last.id === node.id && now - last.time < 320) {
      lastClickRef.current = null
      openNode(node)
      return
    }
    lastClickRef.current = { id: node.id, time: now }
    setSelectedId(node.id)
  }

  const endInteraction = () => {
    // pointerleave 时结束平移（节点拖拽用 pointercapture 不依赖 leave）
    if (dragStateRef.current?.mode === 'pan') dragStateRef.current = null
  }

  const handleNodePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.stopPropagation()
    // 指针捕获：拖出 svg 后也能收到 move/up，松手不丢失
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch { /* 某些环境不支持捕获，忽略 */ }
    dragStateRef.current = {
      mode: 'node',
      id: nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      lastViewX: 0,
      lastViewY: 0,
      prevViewX: 0,
      prevViewY: 0,
    }
  }

  const resetView = () => setTransform({ x: 0, y: 0, k: 1 })

  if (loading && !graph) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载 Agent 宇宙…
      </div>
    )
  }

  if (!filteredGraph || filteredGraph.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
          暂无 Agent 图谱数据。请先在「Agents」页创建或导入 Agent。
        </div>
      </div>
    )
  }

  const agentNodes = filteredGraph.nodes.filter((node) => node.type === 'agent') as Extract<AgentUniverseNode, { type: 'agent' }>[]
  const workingCount = agentNodes.filter((node) => node.liveBusyCount > 0).length
  const executorCount = filteredGraph.nodes.filter((node) => node.type === 'executor').length
  const workspaceCount = filteredGraph.nodes.filter((node) => node.type === 'workspace').length

  const focusId = selectedId ?? hovered?.id ?? null
  const neighborIds = new Set<string>()
  if (focusId) {
    for (const edge of filteredGraph.edges) {
      if (edge.source === focusId) neighborIds.add(edge.target)
      if (edge.target === focusId) neighborIds.add(edge.source)
    }
    neighborIds.add(focusId)
  }

  const focusedNode = focusId ? filteredGraph.nodes.find((node) => node.id === focusId) : null
  const hoveredNode = hovered && !selectedId ? filteredGraph.nodes.find((node) => node.id === hovered.id) ?? null : null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-900 px-3 py-2 text-[11px]">
        <span className="text-zinc-400">
          {agentNodes.length} 个 Agent · {workspaceCount} 个工作区 · {executorCount} 台机器 · <span className="text-amber-400">{workingCount} 正在工作</span>
        </span>
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
          {([['all', '全部'], ['working', '工作中'], ['online', '在线'], ['offline', '离线']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                statusFilter === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Agent…"
            className="h-6 w-36 rounded-md border border-zinc-800 bg-zinc-950 pl-6 pr-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
          />
        </div>
        <select
          value={selectedWorkspaceId}
          onChange={(event) => setSelectedWorkspaceId(event.target.value)}
          className="h-6 max-w-40 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 text-[11px] text-zinc-300 outline-none focus:border-zinc-700"
        >
          <option value="">全部工作区</option>
          {(graph?.nodes ?? []).filter((node) => node.type === 'workspace').map((node) => (
            <option key={node.id} value={node.workspaceId}>{node.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={resetView}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          复位视图
        </button>
        <span className="ml-auto text-[10px] text-zinc-600">拖动球体 · 双击打开 · 单击选中 · 右键固定 · 滚轮缩放 · 空白拖拽平移</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={endInteraction}
        >
          <defs>
            {filteredGraph.nodes.map((node) => (
              node.type === 'agent' && node.avatarUrl ? (
                <clipPath key={node.id} id={`clip-${sanitizeSvgId(node.id)}`}>
                  <circle r={NODE_RADIUS[node.type] - 2} />
                </clipPath>
              ) : null
            ))}
          </defs>
          <rect data-pan-bg="true" x={0} y={0} width={VIEW_W} height={VIEW_H} fill="transparent" />
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
            {filteredGraph.edges.map((edge, index) => {
              const fallback = { x: VIEW_W / 2, y: VIEW_H / 2 }
              const a = bodiesRef.current.get(edge.source) ?? fallback
              const b = bodiesRef.current.get(edge.target) ?? fallback
              const active = focusId === null || neighborIds.has(edge.source) || neighborIds.has(edge.target)
              return (
                <line
                  key={`${edge.source}→${edge.target}-${index}`}
                  ref={(el) => {
                    const key = `${edge.source}→${edge.target}-${index}`
                    if (el) edgeElsRef.current.set(key, el)
                    else edgeElsRef.current.delete(key)
                  }}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? EDGE_COLOR[edge.type] : '#1c1c21'}
                  strokeWidth={active ? 1.1 : 0.5}
                  strokeOpacity={active ? 0.75 : 1}
                />
              )
            })}
            {filteredGraph.nodes.map((node) => {
              const radius = NODE_RADIUS[node.type]
              // 首次渲染时物理体可能尚未由 useEffect 重建，用默认位置保证元素存在（rAF 首帧即纠正）
              const body = bodiesRef.current.get(node.id) ?? { x: VIEW_W / 2, y: VIEW_H / 2, vx: 0, vy: 0, r: radius }
              const active = focusId === null || neighborIds.has(node.id)
              const color = nodeColor(node)
              const busy = node.type === 'agent' && node.liveBusyCount > 0
              const selected = selectedId === node.id
              const pinned = pinnedIds.has(node.id)
              const isAgent = node.type === 'agent'
              return (
                <g
                  key={node.id}
                  ref={(el) => {
                    if (el) nodeElsRef.current.set(node.id, el)
                    else nodeElsRef.current.delete(node.id)
                  }}
                  transform={`translate(${body.x}, ${body.y})`}
                  opacity={active ? 1 : 0.18}
                  className="cursor-pointer"
                  onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    togglePin(node.id)
                  }}
                  onPointerEnter={(event) => {
                    event.stopPropagation()
                    if (!selectedId) setHovered({ id: node.id, x: event.clientX, y: event.clientY })
                  }}
                  onPointerLeave={() => setHovered((current) => (current?.id === node.id ? null : current))}
                >
                  {busy && (
                    <circle r={radius + 5} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.5}>
                      <animate attributeName="r" values={`${radius + 4};${radius + 9}`} dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values="0.6;0" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {isAgent && node.avatarUrl ? (
                    <>
                      <circle r={radius} fill={color} fillOpacity={0.22} stroke={selected ? '#fafafa' : pinned ? color : '#09090b'} strokeWidth={selected ? 2.5 : pinned ? 2 : 1.5} strokeDasharray={pinned ? '3 2' : undefined} />
                      <image
                        href={resolveMediaUrl(node.avatarUrl)}
                        x={-(radius - 2)} y={-(radius - 2)} width={(radius - 2) * 2} height={(radius - 2) * 2}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#clip-${sanitizeSvgId(node.id)})`}
                      />
                    </>
                  ) : (
                    <circle r={radius} fill={color} fillOpacity={0.9} stroke={selected ? '#fafafa' : pinned ? color : '#09090b'} strokeWidth={selected ? 2.5 : pinned ? 2 : 1.5} strokeDasharray={pinned ? '3 2' : undefined} />
                  )}
                  {pinned && (
                    <text y={-radius - 3} textAnchor="middle" fontSize="9" className="pointer-events-none">🔒</text>
                  )}
                  {node.type === 'agent' ? (
                    <text y={radius + 12} textAnchor="middle" className="pointer-events-none" fontSize="9.5" fill="#e4e4e7">
                      {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
                    </text>
                  ) : (
                    <text y={radius + 11} textAnchor="middle" className="pointer-events-none" fontSize="8" fill="#a1a1aa">
                      {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* hover 浮动详情（未选中时） */}
        {hoveredNode && hovered && !selectedId && (
          <div
            className="pointer-events-none fixed z-10 w-60 rounded-lg border border-zinc-800 bg-zinc-950/95 p-2.5 text-[11px] text-zinc-300 shadow-xl"
            style={{ left: Math.min(hovered.x + 14, window.innerWidth - 260), top: Math.min(hovered.y + 14, window.innerHeight - 240) }}
          >
            <NodeDetailCard node={hoveredNode} hint="单击选中 · 双击打开" />
          </div>
        )}

        {/* 选中详情卡（固定右下） */}
        {selectedId && focusedNode && (
          <div className="absolute bottom-3 right-3 z-10 w-72 rounded-lg border border-zinc-700/60 bg-zinc-950/95 p-3 text-[11px] text-zinc-300 shadow-2xl">
            <NodeDetailCard node={focusedNode} hint={pinnedIds.has(selectedId) ? '已固定（🔒）· 右键或按钮解锁' : '再次单击其他节点切换 · 双击打开 · 单击空白取消'} />
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => togglePin(selectedId)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                {pinnedIds.has(selectedId) ? '🔓 取消固定' : '📌 固定位置'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                取消选中
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-[10px] text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: AGENT_STATUS_COLOR.working }} />工作中
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: AGENT_STATUS_COLOR.online }} />在线空闲
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: AGENT_STATUS_COLOR.offline }} />离线
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: NODE_TYPE_COLOR.workspace }} />工作区
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: NODE_TYPE_COLOR.executor }} />机器
        </span>
        <span className="ml-auto flex items-center gap-1 text-zinc-700">
          <Orbit className="h-3 w-3" />Agent 宇宙
        </span>
      </div>
    </div>
  )
}

function NodeDetailCard({ node, hint }: { node: AgentUniverseNode; hint: string }) {
  if (node.type === 'agent') {
    const visual = agentVisualStatus(node)
    const statusLabel: Record<AgentVisualStatus, string> = {
      working: `工作中（${node.liveBusyCount} 个会话）`,
      online: '在线空闲',
      offline: '离线',
      error: '异常',
    }
    return (
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-100">
          <span className="h-2 w-2 rounded-full" style={{ background: AGENT_STATUS_COLOR[visual] }} />Agent
        </div>
        <div className="flex items-center gap-1.5">
          {node.avatarUrl ? (
            <img src={resolveMediaUrl(node.avatarUrl)} alt="" className="h-6 w-6 rounded-full object-cover" />
          ) : null}
          <div className="truncate text-xs font-semibold text-zinc-100">{node.label}</div>
        </div>
        <div className="mt-1.5 space-y-0.5 text-zinc-400">
          <div className="text-amber-300/90">{statusLabel[visual]}</div>
          <div>模型：{node.model || '未配置'}</div>
          <div>Runtime：{node.runtime}</div>
          <div>归属 {node.workspaceCount} 个工作区 · {node.skillCount} 个技能</div>
        </div>
        <div className="pt-1 text-zinc-600">{hint}</div>
      </div>
    )
  }
  if (node.type === 'workspace') {
    return (
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-100">
          <span className="h-2 w-2 rounded-full" style={{ background: NODE_TYPE_COLOR.workspace }} />工作区
        </div>
        <div className="truncate text-xs font-semibold text-zinc-100">{node.label}</div>
        <div className="mt-1.5 text-zinc-400">{node.agentCount} 个 Agent 归属此工作区</div>
        <div className="pt-1 text-zinc-600">{hint}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-100">
        <span className="h-2 w-2 rounded-full" style={{ background: NODE_TYPE_COLOR.executor }} />机器
      </div>
      <div className="truncate text-xs font-semibold text-zinc-100">{node.machineName}</div>
      <div className="mt-1.5 space-y-0.5 text-zinc-400">
        <div>状态：{node.status}</div>
        <div>平台：{node.platform || '未知'}{node.version ? ` · v${node.version}` : ''}</div>
        <div>{node.agentCount} 个 Agent 在此执行</div>
      </div>
      <div className="pt-1 text-zinc-600">{hint}</div>
    </div>
  )
}

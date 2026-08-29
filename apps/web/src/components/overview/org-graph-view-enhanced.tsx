// [INPUT]: workspaceId + /api/org/graph（节点/边）
// [OUTPUT]: 可交互关系图谱（节点可拖动，显示真实头像，hover 高亮邻居，点击查看详情）
// [POS]: 增强版组织图谱视图（节点拖动 + 实时物理模拟 + 头像显示）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { OrgGraph, OrgGraphEdge, OrgGraphNode } from '@shared/types'
import { orgMethods } from '../../lib/api/methods/org'
import { UserCardPopover } from '../profiles/user-card-popover'
import { resolveMediaUrl } from '../../lib/api'
import { getBuiltInAgentAvatarUrl, getAgentAvatarAccent } from '../../lib/agent-avatar'

const NODE_COLOR: Record<OrgGraphNode['type'], string> = {
  user: '#38bdf8',
  agent: '#a78bfa',
  project: '#34d399',
  conversation: '#f472b6',
  drive_file: '#94a3b8',
}

const NODE_RADIUS: Record<OrgGraphNode['type'], number> = {
  user: 26,
  agent: 24,
  project: 22,
  conversation: 20,
  drive_file: 18,
}

type Position = { x: number; y: number }
type Velocity = { x: number; y: number }

interface SimulationNode {
  id: string
  pos: Position
  vel: Velocity
  pinned: boolean
}

/** 实时物理模拟：拖动时持续运行，松开后继续收敛 */
class ForceSimulation {
  nodes: Map<string, SimulationNode>
  edges: OrgGraphEdge[]
  width: number
  height: number
  repulsion = 3000
  springLength = 120
  springStrength = 0.01
  damping = 0.85
  animationFrame: number | null = null
  isRunning = false
  onTickCallback: (() => void) | null = null
  nodesArray: SimulationNode[] = []
  adjacencyList: Map<string, Set<string>> = new Map()

  constructor(nodes: OrgGraphNode[], edges: OrgGraphEdge[], width: number, height: number) {
    this.nodes = new Map()
    this.edges = edges
    this.width = width
    this.height = height

    for (const node of nodes) {
      this.nodes.set(node.id, {
        id: node.id,
        pos: {
          x: width / 2 + (Math.random() - 0.5) * width * 0.6,
          y: height / 2 + (Math.random() - 0.5) * height * 0.6,
        },
        vel: { x: 0, y: 0 },
        pinned: false,
      })
    }

    this.nodesArray = Array.from(this.nodes.values())

    for (const edge of edges) {
      if (!this.adjacencyList.has(edge.source)) this.adjacencyList.set(edge.source, new Set())
      if (!this.adjacencyList.has(edge.target)) this.adjacencyList.set(edge.target, new Set())
      this.adjacencyList.get(edge.source)!.add(edge.target)
      this.adjacencyList.get(edge.target)!.add(edge.source)
    }
  }

  tick() {
    const nodesArray = this.nodesArray

    for (let i = 0; i < nodesArray.length; i++) {
      const a = nodesArray[i]
      if (a.pinned) continue

      for (let j = i + 1; j < nodesArray.length; j++) {
        const b = nodesArray[j]
        const dx = a.pos.x - b.pos.x
        const dy = a.pos.y - b.pos.y
        const distSq = dx * dx + dy * dy
        if (distSq < 1) continue

        const dist = Math.sqrt(distSq)
        const force = this.repulsion / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force

        a.vel.x += fx
        a.vel.y += fy
        if (!b.pinned) {
          b.vel.x -= fx
          b.vel.y -= fy
        }
      }
    }

    for (const edge of this.edges) {
      const a = this.nodes.get(edge.source)
      const b = this.nodes.get(edge.target)
      if (!a || !b) continue
      const dx = b.pos.x - a.pos.x
      const dy = b.pos.y - a.pos.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - this.springLength) * this.springStrength
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      if (!a.pinned) {
        a.vel.x += fx
        a.vel.y += fy
      }
      if (!b.pinned) {
        b.vel.x -= fx
        b.vel.y -= fy
      }
    }

    let maxVelocity = 0
    for (const node of nodesArray) {
      if (node.pinned) continue
      node.vel.x *= this.damping
      node.vel.y *= this.damping
      node.pos.x = Math.max(40, Math.min(this.width - 40, node.pos.x + node.vel.x))
      node.pos.y = Math.max(40, Math.min(this.height - 40, node.pos.y + node.vel.y))
      const velMag = node.vel.x * node.vel.x + node.vel.y * node.vel.y
      if (velMag > maxVelocity) maxVelocity = velMag
    }

    return Math.sqrt(maxVelocity)
  }

  start(onTick: () => void) {
    if (this.isRunning) return
    this.isRunning = true
    this.onTickCallback = onTick
    let iterations = 0
    const maxIterations = 300
    const velocityThreshold = 0.05

    const animate = () => {
      const maxVel = this.tick()
      this.onTickCallback?.()
      iterations++

      if (iterations < maxIterations && (maxVel > velocityThreshold || this.hasPinnedNodes())) {
        this.animationFrame = requestAnimationFrame(animate)
      } else {
        this.stop()
      }
    }

    this.animationFrame = requestAnimationFrame(animate)
  }

  stop() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
    this.isRunning = false
    this.onTickCallback = null
  }

  hasPinnedNodes() {
    return this.nodesArray.some((n) => n.pinned)
  }

  pinNode(id: string, x: number, y: number) {
    const node = this.nodes.get(id)
    if (node) {
      node.pinned = true
      node.pos.x = x
      node.pos.y = y
      node.vel.x = 0
      node.vel.y = 0
      if (!this.isRunning) {
        this.start(this.onTickCallback || (() => {}))
      }
    }
  }

  unpinNode(id: string) {
    const node = this.nodes.get(id)
    if (node) {
      node.pinned = false
    }
  }
}

export function OrgGraphViewEnhanced({ workspaceId }: { workspaceId: string }) {
  const [graph, setGraph] = useState<OrgGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<ForceSimulation | null>(null)
  const [, setTick] = useState(0)
  const neighborIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    setGraph(null)
    orgMethods.getOrgGraph(workspaceId)
      .then((res) => setGraph(res.graph))
      .catch(() => setGraph({ workspaceId, nodes: [], edges: [] }))
      .finally(() => setLoading(false))
  }, [workspaceId])

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return

    const simulation = new ForceSimulation(graph.nodes, graph.edges, 900, 560)
    simulationRef.current = simulation
    simulation.start(() => setTick((t) => t + 1))

    return () => {
      simulation.stop()
    }
  }, [graph])

  const handleNodeMouseDown = (nodeId: string, event: React.MouseEvent<SVGGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(nodeId)

    const svg = svgRef.current
    if (!svg || !simulationRef.current) return

    const rect = svg.getBoundingClientRect()
    let lastX = event.clientX
    let lastY = event.clientY

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY

      const node = simulationRef.current?.nodes.get(nodeId)
      if (!node) return

      node.pos.x = Math.max(40, Math.min(900 - 40, node.pos.x + dx * (900 / rect.width)))
      node.pos.y = Math.max(40, Math.min(560 - 40, node.pos.y + dy * (560 / rect.height)))
      setTick((t) => t + 1)
    }

    const handleMouseUp = () => {
      simulationRef.current?.unpinNode(nodeId)
      setDragging(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  useEffect(() => {
    if (!hovered || !graph) {
      neighborIdsRef.current.clear()
      return
    }
    neighborIdsRef.current.clear()
    for (const edge of graph.edges) {
      if (edge.source === hovered) neighborIdsRef.current.add(edge.target)
      if (edge.target === hovered) neighborIdsRef.current.add(edge.source)
    }
    neighborIdsRef.current.add(hovered)
  }, [hovered, graph])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载关系图谱…
      </div>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
          该组织暂无图谱数据。
        </div>
      </div>
    )
  }

  const neighborIds = neighborIdsRef.current
  const positions = simulationRef.current?.nodes ?? new Map()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-2 py-1.5 text-[10px] text-zinc-600">
        {Object.entries(NODE_COLOR).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>
      <svg ref={svgRef} viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <defs>
          {graph.nodes.map((node) => {
            const nodeId = `avatar-${node.id.replace(/[^a-zA-Z0-9]/g, '-')}`
            if (node.type === 'user') {
              return (
                <pattern key={nodeId} id={nodeId} width="1" height="1" patternContentUnits="objectBoundingBox">
                  <image
                    href={node.metadata?.avatarUrl ? resolveMediaUrl(node.metadata.avatarUrl) : '/default-avatar.png'}
                    x="0"
                    y="0"
                    width="1"
                    height="1"
                    preserveAspectRatio="xMidYMid slice"
                  />
                </pattern>
              )
            }
            if (node.type === 'agent') {
              const avatarUrl = node.metadata?.avatarUrl
                ? resolveMediaUrl(node.metadata.avatarUrl)
                : getBuiltInAgentAvatarUrl('engineering')
              return (
                <pattern key={nodeId} id={nodeId} width="1" height="1" patternContentUnits="objectBoundingBox">
                  <image href={avatarUrl} x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice" />
                </pattern>
              )
            }
            return null
          })}
        </defs>

        {graph.edges.map((edge, index) => {
          const a = positions.get(edge.source)
          const b = positions.get(edge.target)
          if (!a || !b) return null
          const active = hovered === null || neighborIds.has(edge.source) || neighborIds.has(edge.target)
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              x1={a.pos.x}
              y1={a.pos.y}
              x2={b.pos.x}
              y2={b.pos.y}
              stroke={active ? '#3f3f46' : '#1f1f23'}
              strokeWidth={active ? 1.5 : 0.8}
              opacity={active ? 1 : 0.4}
            />
          )
        })}

        {graph.nodes.map((node) => {
          const simNode = positions.get(node.id)
          if (!simNode) return null
          const pos = simNode.pos
          const userNode = node.type === 'user'
          const agentNode = node.type === 'agent'
          const active = hovered === null || neighborIds.has(node.id)
          const radius = NODE_RADIUS[node.type]
          const nodeId = `avatar-${node.id.replace(/[^a-zA-Z0-9]/g, '-')}`

          const circleElement = (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              opacity={active ? 1 : 0.3}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
              className="cursor-grab active:cursor-grabbing"
              style={{ transition: dragging === node.id ? 'none' : 'opacity 0.2s ease' }}
            >
              {userNode || agentNode ? (
                <>
                  <circle
                    r={radius + 3}
                    fill={NODE_COLOR[node.type]}
                    fillOpacity={0.2}
                    stroke={NODE_COLOR[node.type]}
                    strokeWidth={2}
                    filter="url(#glow)"
                  />
                  <circle r={radius} fill={`url(#${nodeId})`} stroke="#09090b" strokeWidth={2} />
                </>
              ) : (
                <>
                  <circle
                    r={radius + 2}
                    fill={NODE_COLOR[node.type]}
                    fillOpacity={0.15}
                    stroke={NODE_COLOR[node.type]}
                    strokeWidth={1.5}
                  />
                  <circle r={radius} fill={NODE_COLOR[node.type]} fillOpacity={0.9} stroke="#09090b" strokeWidth={2} />
                </>
              )}
              <text
                y={radius + 16}
                textAnchor="middle"
                fontSize="11"
                fill="#a1a1aa"
                fontWeight="500"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.label}
              </text>
            </g>
          )

          if (userNode) {
            return (
              <UserCardPopover key={node.id} userId={node.id.replace(/^user:/, '')} name={node.label}>
                {circleElement}
              </UserCardPopover>
            )
          }
          return circleElement
        })}

        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>
      <div className="shrink-0 px-2 pb-1 text-[10px] text-zinc-700">
        节点：{graph.nodes.length} · 连接：{graph.edges.length} · 拖动节点调整布局，悬停高亮邻居，点击成员查看今日时间线
      </div>
    </div>
  )
}

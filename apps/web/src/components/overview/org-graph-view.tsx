// [INPUT]: workspaceId + /api/org/graph（节点/边）
// [OUTPUT]: 关系图谱轻量版（自绘 SVG 力导向：斥力 + 弹簧迭代收敛；节点着色；hover 高亮邻居；点击 user 节点开用户卡片）
// [POS]: Obsidian 式关系图谱视图（首版自绘零依赖，复用 git-graph 自绘先例）；按 workspace 过滤；数据第一版所有人可见
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { OrgGraph, OrgGraphEdge, OrgGraphNode } from '@shared/types'
import { orgMethods } from '../../lib/api/methods/org'
import { UserCardPopover } from '../profiles/user-card-popover'

const NODE_COLOR: Record<OrgGraphNode['type'], string> = {
  user: '#38bdf8',
  agent: '#a78bfa',
  project: '#34d399',
  conversation: '#f472b6',
  drive_file: '#94a3b8',
}

const NODE_RADIUS: Record<OrgGraphNode['type'], number> = {
  user: 11,
  agent: 9,
  project: 10,
  conversation: 8,
  drive_file: 7,
}

type Position = { x: number; y: number }

/** 轻量力导向布局：斥力 + 弹簧迭代收敛（节点数少时 O(n²) 足够） */
const computeLayout = (nodes: OrgGraphNode[], edges: OrgGraphEdge[], iterations = 120): Map<string, Position> => {
  const positions = new Map<string, Position>()
  const velocities = new Map<string, Position>()
  const width = 900
  const height = 560
  for (const node of nodes) {
    positions.set(node.id, { x: width / 2 + (Math.random() - 0.5) * width * 0.5, y: height / 2 + (Math.random() - 0.5) * height * 0.5 })
    velocities.set(node.id, { x: 0, y: 0 })
  }
  const repulsion = 4200
  const springLength = 90
  const springStrength = 0.02
  const damping = 0.85

  for (let iter = 0; iter < iterations; iter++) {
    // 斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id)!
        const b = positions.get(nodes[j].id)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist = Math.hypot(dx, dy) || 1
        const force = repulsion / (dist * dist)
        dx /= dist
        dy /= dist
        const va = velocities.get(nodes[i].id)!
        const vb = velocities.get(nodes[j].id)!
        va.x += dx * force
        va.y += dy * force
        vb.x -= dx * force
        vb.y -= dy * force
      }
    }
    // 弹簧
    for (const edge of edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b) continue
      let dx = b.x - a.x
      let dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 1
      const force = (dist - springLength) * springStrength
      dx /= dist
      dy /= dist
      const va = velocities.get(edge.source)!
      const vb = velocities.get(edge.target)!
      va.x += dx * force
      va.y += dy * force
      vb.x -= dx * force
      vb.y -= dy * force
    }
    // 积分 + 阻尼 + 边界
    for (const node of nodes) {
      const pos = positions.get(node.id)!
      const vel = velocities.get(node.id)!
      vel.x *= damping
      vel.y *= damping
      pos.x = Math.max(30, Math.min(width - 30, pos.x + vel.x))
      pos.y = Math.max(30, Math.min(height - 30, pos.y + vel.y))
    }
  }
  return positions
}

export function OrgGraphView({ workspaceId }: { workspaceId: string }) {
  const [graph, setGraph] = useState<OrgGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    setLoading(true)
    setGraph(null)
    orgMethods.getOrgGraph(workspaceId)
      .then((res) => setGraph(res.graph))
      .catch(() => setGraph({ workspaceId, nodes: [], edges: [] }))
      .finally(() => setLoading(false))
  }, [workspaceId])

  const positions = useMemo(() => (graph ? computeLayout(graph.nodes, graph.edges) : new Map()), [graph])

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

  const neighborIds = new Set<string>()
  if (hovered) {
    for (const edge of graph.edges) {
      if (edge.source === hovered) neighborIds.add(edge.target)
      if (edge.target === hovered) neighborIds.add(edge.source)
    }
    neighborIds.add(hovered)
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))

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
        {graph.edges.map((edge, index) => {
          const a = positions.get(edge.source)
          const b = positions.get(edge.target)
          if (!a || !b) return null
          const active = hovered === null || neighborIds.has(edge.source) || neighborIds.has(edge.target)
          return (
            <line
              key={index}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={active ? '#3f3f46' : '#1f1f23'}
              strokeWidth={active ? 1 : 0.5}
            />
          )
        })}
        {graph.nodes.map((node) => {
          const pos = positions.get(node.id)
          if (!pos) return null
          const userNode = node.type === 'user'
          const active = hovered === null || neighborIds.has(node.id)
          const circle = (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              opacity={active ? 1 : 0.25}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle r={NODE_RADIUS[node.type]} fill={NODE_COLOR[node.type]} fillOpacity={0.9} stroke="#09090b" strokeWidth={1.5} />
              <title>{node.label}</title>
            </g>
          )
          if (userNode) {
            return (
              <UserCardPopover key={node.id} userId={node.id.replace(/^user:/, '')} name={node.label}>
                {circle}
              </UserCardPopover>
            )
          }
          return circle
        })}
      </svg>
      <div className="shrink-0 px-2 pb-1 text-[10px] text-zinc-700">
        节点：{graph.nodes.length} · 连接：{graph.edges.length} · 悬停高亮邻居，点击成员查看今日时间线
      </div>
    </div>
  )
}

// [INPUT]: 纯函数输入（节点/边 + 物理参数）
// [OUTPUT]: 宇宙图谱物理引擎行为断言（弹簧收敛 / 碰撞分离 / 固定节点 / 边界钳制 / 保留位置）
// [POS]: Agent 宇宙物理引擎纯函数测试（createBodies / stepPhysics）；不依赖 DOM
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentUniverseGraph } from '@shared/types'
import { createBodies, filterByWorkspace, stepPhysics } from './agent-universe-view'

const node = (id: string, type: 'agent' | 'workspace' | 'executor' = 'agent'): AgentUniverseGraph['nodes'][number] => {
  if (type === 'workspace') return { id, type: 'workspace', label: id, workspaceId: id, agentCount: 0 }
  if (type === 'executor') return { id, type: 'executor', label: id, executorId: id, machineName: id, status: 'online', agentCount: 0 }
  return { id, type: 'agent', label: id, agentId: id, status: 'online', liveBusyCount: 0, model: '', runtime: 'openCode', avatarUrl: '', workspaceCount: 0, skillCount: 0 }
}

const graphOf = (nodes: ReturnType<typeof node>[], edges: AgentUniverseGraph['edges'] = []): AgentUniverseGraph => ({ nodes, edges })

test('createBodies：生成全部节点体并保留旧位置', () => {
  const first = createBodies([node('a'), node('b')], null)
  assert.equal(first.size, 2)
  const bodyA = first.get('a')!
  bodyA.x = 123.5
  bodyA.y = 456.25
  const second = createBodies([node('a'), node('b'), node('c')], first)
  // 保留旧节点位置
  assert.equal(second.get('a')!.x, 123.5)
  assert.equal(second.get('a')!.y, 456.25)
  // 新节点有位置
  assert.ok(second.get('c'))
})

test('stepPhysics：碰撞分离——重叠的球被推开到不重叠', () => {
  const bodies = createBodies([node('a'), node('b')], null)
  const a = bodies.get('a')!
  const b = bodies.get('b')!
  // 两球中心重叠（半径 14+14=28）
  a.x = 100; a.y = 100; a.vx = 0; a.vy = 0
  b.x = 105; b.y = 100; b.vx = 0; b.vy = 0
  // 迭代若干帧直到分离
  for (let i = 0; i < 60; i++) {
    stepPhysics(bodies, [], null)
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  assert.ok(dist >= 27, `碰撞后应分离（dist=${dist.toFixed(2)}）`)
})

test('stepPhysics：弹性碰撞——运动球撞静止球把动量传递', () => {
  const bodies = createBodies([node('a'), node('b')], null)
  const a = bodies.get('a')!
  const b = bodies.get('b')!
  a.x = 200; a.y = 100; a.vx = 5; a.vy = 0
  b.x = 240; b.y = 100; b.vx = 0; b.vy = 0
  let moved = true
  for (let i = 0; i < 40 && moved; i++) {
    moved = stepPhysics(bodies, [], null)
  }
  // b 被撞离初始位置（动量传递）
  assert.ok(Math.hypot(b.x - 240, b.y - 100) > 5, '静止球应被撞开')
})

test('stepPhysics：固定节点不动，但其他球会被它推开', () => {
  const bodies = createBodies([node('a'), node('b')], null)
  const a = bodies.get('a')!
  const b = bodies.get('b')!
  a.x = 100; a.y = 100; a.vx = 0; a.vy = 0
  b.x = 105; b.y = 100; b.vx = 0; b.vy = 0
  const pinned = new Set<string>(['a'])
  for (let i = 0; i < 40; i++) {
    stepPhysics(bodies, [], null, pinned)
  }
  // a 完全不动
  assert.equal(a.x, 100)
  assert.equal(a.y, 100)
  // b 被推开
  assert.ok(Math.hypot(b.x - 105, b.y - 100) > 5, '固定球应把其他球推开')
})

test('stepPhysics：边界钳制——球不会飞出画布', () => {
  const bodies = createBodies([node('a')], null)
  const a = bodies.get('a')!
  a.x = 1; a.y = 1
  a.vx = -100; a.vy = -100
  for (let i = 0; i < 30; i++) {
    stepPhysics(bodies, [], null)
  }
  assert.ok(a.x >= 40 && a.x <= 960, `x 在边界内（${a.x.toFixed(1)}）`)
  assert.ok(a.y >= 40 && a.y <= 600, `y 在边界内（${a.y.toFixed(1)}）`)
})

test('stepPhysics：弹簧——相连节点被拉近', () => {
  const bodies = createBodies([node('a'), node('b')], null)
  const a = bodies.get('a')!
  const b = bodies.get('b')!
  a.x = 100; a.y = 100; a.vx = 0; a.vy = 0
  b.x = 500; b.y = 100; b.vx = 0; b.vy = 0
  for (let i = 0; i < 200; i++) {
    stepPhysics(bodies, [{ source: 'a', target: 'b', type: 'collaborates' }], null)
  }
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  assert.ok(dist < 300, `弹簧应拉近两球（dist=${dist.toFixed(1)}）`)
})

test('stepPhysics：收敛后停止运动（位移阈值）', () => {
  const bodies = createBodies([node('a'), node('b'), node('c')], null)
  let frames = 0
  let moving = true
  while (moving && frames < 500) {
    moving = stepPhysics(bodies, [], null)
    frames++
  }
  assert.ok(frames < 500, '应在有限帧内收敛')
  // 收敛后位置稳定（允许位移阈值内的不可见微漂移 <0.2px）
  const snapshot = [...bodies.values()].map((b) => ({ x: b.x, y: b.y }))
  stepPhysics(bodies, [], null)
  const maxDrift = Math.max(...[...bodies.values()].map((b, i) => Math.hypot(b.x - snapshot[i].x, b.y - snapshot[i].y)))
  assert.ok(maxDrift < 0.2, `收敛后漂移应可忽略（maxDrift=${maxDrift.toFixed(3)}px）`)
})

test('graphOf 装配：节点类型投影正确', () => {
  const g = graphOf([node('a'), node('ws', 'workspace'), node('ex', 'executor')])
  assert.equal(g.nodes.length, 3)
})

test('filterByWorkspace：只保留目标工作区直达子图', () => {
  const g = graphOf(
    [node('a'), node('b'), node('workspace:ws', 'workspace'), node('workspace:ws2', 'workspace')],
    [
      { source: 'a', target: 'workspace:ws', type: 'belongs_to' },
      { source: 'b', target: 'workspace:ws2', type: 'belongs_to' },
    ],
  )
  const sub = filterByWorkspace(g.nodes, g.edges, 'ws')
  assert.ok(sub.nodes.some((n) => n.id === 'a'))
  assert.ok(sub.nodes.some((n) => n.id === 'workspace:ws'))
  assert.equal(sub.nodes.some((n) => n.id === 'b'), false)
  assert.equal(sub.nodes.some((n) => n.id === 'workspace:ws2'), false)
  assert.equal(sub.edges.length, 1)
  assert.equal(sub.edges[0].source, 'a')
})

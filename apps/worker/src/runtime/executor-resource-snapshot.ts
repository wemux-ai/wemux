// [INPUT]: 系统资源（CPU/内存/磁盘）
// [OUTPUT]: 资源快照
// [POS]: executor 资源快照采集
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, statfsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExecutorCpuSnapshot, ExecutorDiskSnapshot, ExecutorMemorySnapshot, ExecutorSystemSnapshot, ExecutorTelemetrySnapshot } from '@shared/types'

type CpuTotals = {
  idle: number
  total: number
}

let previousCpuTotals: CpuTotals | null = null

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const readCpuTotals = (): CpuTotals => {
  return os.cpus().reduce<CpuTotals>((totals, cpu) => {
    const nextTotal = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
    return {
      idle: totals.idle + cpu.times.idle,
      total: totals.total + nextTotal,
    }
  }, { idle: 0, total: 0 })
}

const resolveCpuSnapshot = (): ExecutorCpuSnapshot => {
  const cpus = os.cpus()
  const totals = readCpuTotals()
  const previousTotals = previousCpuTotals
  previousCpuTotals = totals

  const totalSpeed = cpus.reduce((sum, cpu) => sum + (Number.isFinite(cpu.speed) ? cpu.speed : 0), 0)
  const usagePercent = (() => {
    if (!previousTotals) {
      return undefined
    }

    const totalDelta = totals.total - previousTotals.total
    const idleDelta = totals.idle - previousTotals.idle

    if (totalDelta <= 0) {
      return undefined
    }

    return round((1 - idleDelta / totalDelta) * 100, 1)
  })()

  return {
    coreCount: cpus.length,
    model: cpus[0]?.model,
    averageSpeedMhz: cpus.length > 0 ? Math.round(totalSpeed / cpus.length) : undefined,
    loadAverage: os.loadavg().map((value) => round(value, 2)) as [number, number, number],
    usagePercent,
  }
}

const resolveMemorySnapshot = (): ExecutorMemorySnapshot => {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()

  return {
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
  }
}

const resolveExistingPath = (inputPath: string) => {
  let currentPath = path.resolve(inputPath || process.cwd())
  while (!existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) {
      return process.cwd()
    }
    currentPath = parentPath
  }

  return currentPath
}

const resolveDiskSnapshot = (workspaceRoot: string): ExecutorDiskSnapshot | undefined => {
  try {
    const probePath = resolveExistingPath(workspaceRoot)
    const stats = statfsSync(probePath)
    const blockSize = Number(stats.bsize)
    const totalBlocks = Number(stats.blocks)
    const freeBlocks = Number(stats.bfree)
    const availableBlocks = Number(stats.bavail)

    if (!Number.isFinite(blockSize) || !Number.isFinite(totalBlocks) || blockSize <= 0 || totalBlocks <= 0) {
      return undefined
    }

    const totalBytes = totalBlocks * blockSize
    const freeBytes = Math.max(0, freeBlocks * blockSize)
    const availableBytes = Math.max(0, availableBlocks * blockSize)

    return {
      path: probePath,
      totalBytes,
      freeBytes,
      availableBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
    }
  } catch {
    return undefined
  }
}

const resolveSystemSnapshot = (workerVersion: string): ExecutorSystemSnapshot => {
  return {
    platform: process.platform,
    arch: os.arch(),
    hostname: os.hostname(),
    release: os.release(),
    version: typeof os.version === 'function' ? os.version() : undefined,
    nodeVersion: process.version,
    workerVersion,
    systemUptimeSec: Math.max(0, Math.round(os.uptime())),
    processUptimeSec: Math.max(0, Math.round(process.uptime())),
  }
}

export const buildExecutorTelemetrySnapshot = (input: { workspaceRoot: string; workerVersion: string }): ExecutorTelemetrySnapshot => {
  return {
    capturedAt: new Date().toISOString(),
    cpu: resolveCpuSnapshot(),
    memory: resolveMemorySnapshot(),
    disk: resolveDiskSnapshot(input.workspaceRoot),
    system: resolveSystemSnapshot(input.workerVersion),
  }
}

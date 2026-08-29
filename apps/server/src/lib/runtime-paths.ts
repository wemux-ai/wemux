import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEnv } from '@shared/env'

const runtimeRoot = getEnv('WEMUX_RUNTIME_DIR')?.trim() || join(tmpdir(), 'vibemux-runtime')

export const getRuntimeRoot = () => runtimeRoot

export const getPatchArtifactsDir = () => join(runtimeRoot, 'patches')

export const getPatchArtifactPath = (artifactId: string) => join(getPatchArtifactsDir(), artifactId)

export const getTestArtifactsDir = () => join(runtimeRoot, 'test-artifacts')

export const getTestArtifactDir = (taskId: string) => join(getTestArtifactsDir(), taskId)

export const getTestArtifactPath = (taskId: string, filename: string) => join(getTestArtifactDir(taskId), filename)

export const getExecutorRegistryPath = () => join(runtimeRoot, 'control-plane', 'executors.json')

export const ensureDirectory = (directory: string) => {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }
}

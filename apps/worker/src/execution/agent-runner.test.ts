import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { validateWorkerPromptWorkingDirectory } from './agent-runner'

test('validateWorkerPromptWorkingDirectory accepts an existing directory', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-agent-runner-'))

  try {
    await assert.doesNotReject(() => validateWorkerPromptWorkingDirectory(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validateWorkerPromptWorkingDirectory expands home-relative directories', async () => {
  const root = mkdtempSync(path.join(os.homedir(), 'vibemux-agent-runner-home-'))
  const relativeToHome = path.relative(os.homedir(), root)

  try {
    await assert.doesNotReject(() => validateWorkerPromptWorkingDirectory(`~/${relativeToHome}`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validateWorkerPromptWorkingDirectory rejects a missing directory', async () => {
  const cwd = path.join(os.tmpdir(), `vibemux-agent-runner-missing-${randomUUID()}`)

  await assert.rejects(
    () => validateWorkerPromptWorkingDirectory(cwd),
    (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, 'ENOENT')
      return true
    },
  )
})

test('validateWorkerPromptWorkingDirectory rejects a file path', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-agent-runner-file-'))
  const filePath = path.join(root, 'not-a-directory.txt')
  writeFileSync(filePath, 'hello')

  try {
    await assert.rejects(
      () => validateWorkerPromptWorkingDirectory(filePath),
      /当前工作目录不是目录/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// [INPUT]: CLI 确认输入
// [OUTPUT]: 交互确认结果
// [POS]: CLI 确认工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createInterface } from 'node:readline/promises'

import type { CliFlagMap } from '../cli-flags'

export const confirmDangerousAction = async (flags: CliFlagMap, action: string) => {
  if (flags.has('yes') || flags.has('y')) return
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Refusing to ${action} without confirmation. Re-run with --yes.`)
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await prompt.question(`${action}? [y/N] `)).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      throw new Error('Cancelled.')
    }
  } finally {
    prompt.close()
  }
}

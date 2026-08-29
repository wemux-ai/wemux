/**
 * [INPUT]: Raw CLI arguments.
 * [OUTPUT]: Parsed positional arguments and normalized flag values.
 * [POS]: Shared dependency-free argument parser for worker commands.
 * [PROTOCOL]: Update this header when responsibilities change, then check AGENTS.md.
 */

export type CliFlagMap = Map<string, string | true>

export type ParsedCliArgs = {
  flags: CliFlagMap
  positionals: string[]
}

const BOOLEAN_FLAGS = new Set([
  'V',
  'check',
  'errors-only',
  'f',
  'follow',
  'h',
  'help',
  'json',
  'no-restart',
  'no-start',
  'new-session',
  'pair-only',
  'version',
  'yes',
  'y',
])

export const parseCliArgs = (args: string[]): ParsedCliArgs => {
  const flags = new Map<string, string | true>()
  const positionals: string[] = []
  let positionalOnly = false

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (positionalOnly || !current.startsWith('-') || current === '-') {
      positionals.push(current)
      continue
    }
    if (current === '--') {
      positionalOnly = true
      continue
    }

    const normalized = current.startsWith('--') ? current.slice(2) : current.slice(1)
    const equalsIndex = normalized.indexOf('=')
    if (equalsIndex >= 0) {
      flags.set(normalized.slice(0, equalsIndex), normalized.slice(equalsIndex + 1))
      continue
    }

    const next = args[index + 1]
    if (BOOLEAN_FLAGS.has(normalized) || !next || next.startsWith('-')) {
      flags.set(normalized, true)
      continue
    }

    flags.set(normalized, next)
    index += 1
  }

  return { flags, positionals }
}

export const parseCliFlags = (args: string[]): CliFlagMap => {
  return parseCliArgs(args).flags
}

export const getStringFlag = (flags: CliFlagMap, name: string) => {
  const value = flags.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

export const hasFlag = (flags: CliFlagMap, name: string) => {
  return flags.has(name)
}

export const getNumberFlag = (flags: CliFlagMap, name: string, fallback: number) => {
  const value = Number(getStringFlag(flags, name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

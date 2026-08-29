// [INPUT]: CLI 输出输入
// [OUTPUT]: 格式化输出
// [POS]: CLI 输出工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type OutputFormat = 'json' | 'table'

export const getOutputFormat = (flags: Map<string, string | true>): OutputFormat => {
  if (flags.has('json')) return 'json'
  return 'table'
}

export const output = (data: unknown, format: OutputFormat = 'table') => {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (typeof data === 'string') {
    console.log(data)
    return
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>

    // Check for common patterns
    if (Array.isArray(obj.agents)) {
      printTable(obj.agents, 'AGENTS')
      return
    }
    if (Array.isArray(obj.types)) {
      console.log('AGENT TYPES')
      for (const t of obj.types) {
        const desc = obj.description && typeof obj.description === 'object'
          ? (obj.description as Record<string, string>)[t]
          : ''
        console.log(`  ${t}${desc ? ` — ${desc}` : ''}`)
      }
      return
    }
    if (Array.isArray(obj.servers)) {
      printTable(obj.servers, 'MCP SERVERS')
      return
    }
    if (Array.isArray(obj.sessions)) {
      printTable(obj.sessions, 'SESSIONS')
      return
    }
    if (Array.isArray(obj.projects)) {
      printTable(obj.projects, 'PROJECTS')
      return
    }
    if (Array.isArray(obj.tasks)) {
      printTable(obj.tasks, 'TASKS')
      return
    }
    if (Array.isArray(obj.workspaces)) {
      printTable(obj.workspaces, 'WORKSPACES')
      return
    }
    if (Array.isArray(obj.executors)) {
      printTable(obj.executors, 'EXECUTORS')
      return
    }
    if (Array.isArray(obj.runs)) {
      printTable(obj.runs, 'RUNS')
      return
    }
    if (Array.isArray(obj.conversations)) {
      printTable(obj.conversations, 'CONVERSATIONS')
      return
    }
    if (Array.isArray(obj.items)) {
      printTable(obj.items, 'INBOX ITEMS')
      return
    }
    if (Array.isArray(obj.groups)) {
      printTable(obj.groups, 'INBOX GROUPS')
      return
    }
    if (Array.isArray(obj.files)) {
      printTable(obj.files, 'DRIVE FILES')
      return
    }

    // Single object — print key-value
    printObject(obj)
    return
  }

  console.log(String(data))
}

const printTable = (items: unknown[], title?: string) => {
  if (title) {
    console.log(title)
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.log('  (empty)')
    return
  }

  // Collect all keys
  const keys = new Set<string>()
  for (const item of items) {
    if (item && typeof item === 'object') {
      for (const k of Object.keys(item as Record<string, unknown>)) {
        keys.add(k)
      }
    }
  }

  const cols = [...keys]
  const widths = cols.map((col) => Math.max(col.length, ...items.map((item) => {
    const val = (item as Record<string, unknown>)?.[col]
    return formatCell(val).length
  })))

  // Header
  const header = cols.map((col, i) => col.padEnd(widths[i])).join('  ')
  console.log(header)
  console.log(cols.map((_, i) => '─'.repeat(widths[i])).join('──'))

  // Rows
  for (const item of items) {
    const row = cols.map((col, i) => {
      const val = (item as Record<string, unknown>)?.[col]
      return formatCell(val).padEnd(widths[i])
    }).join('  ')
    console.log(row)
  }
}

const printObject = (obj: Record<string, unknown>, indent = 0) => {
  const prefix = '  '.repeat(indent)
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      console.log(`${prefix}${key}:`)
      for (const item of value) {
        printObject(item as Record<string, unknown>, indent + 1)
        console.log('')
      }
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${prefix}${key}:`)
      printObject(value as Record<string, unknown>, indent + 1)
    } else {
      console.log(`${prefix}${key}: ${formatCell(value)}`)
    }
  }
}

const formatCell = (val: unknown): string => {
  if (val === null || val === undefined) return ''
  if (typeof val === 'boolean') return val ? '✓' : '✗'
  if (typeof val === 'object') return JSON.stringify(val)
  const str = String(val)
  return str.length > 50 ? str.slice(0, 47) + '...' : str
}

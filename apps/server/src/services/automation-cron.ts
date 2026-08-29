// [INPUT]: cron 触发输入
// [OUTPUT]: 调度扫描结果
// [POS]: 自动化 cron 调度
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export interface ParsedCron {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
}

type FieldSpec = {
  min: number
  max: number
  name: string
}

const FIELD_SPECS: FieldSpec[] = [
  { min: 0, max: 59, name: 'minute' },
  { min: 0, max: 23, name: 'hour' },
  { min: 1, max: 31, name: 'day of month' },
  { min: 1, max: 12, name: 'month' },
  { min: 0, max: 6, name: 'day of week' },
]

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const validateBounds = (value: number, spec: FieldSpec) => {
  if (value < spec.min || value > spec.max) {
    throw new Error(`Value ${value} out of range [${spec.min}-${spec.max}] for cron ${spec.name} field`)
  }
}

const parseField = (token: string, spec: FieldSpec) => {
  const values = new Set<number>()

  for (const rawPart of token.split(',')) {
    const part = rawPart.trim()
    if (!part) {
      throw new Error(`Empty element in cron ${spec.name} field`)
    }

    const slashIndex = part.indexOf('/')
    if (slashIndex !== -1) {
      const base = part.slice(0, slashIndex)
      const step = Number.parseInt(part.slice(slashIndex + 1), 10)
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid step in cron ${spec.name} field`)
      }

      let start = spec.min
      let end = spec.max
      if (base === '*') {
        // noop
      } else if (base.includes('-')) {
        const [rawStart, rawEnd] = base.split('-')
        start = Number.parseInt(rawStart ?? '', 10)
        end = Number.parseInt(rawEnd ?? '', 10)
      } else {
        start = Number.parseInt(base, 10)
      }

      validateBounds(start, spec)
      validateBounds(end, spec)
      if (start > end) {
        throw new Error(`Invalid range ${start}-${end} in cron ${spec.name} field`)
      }

      for (let value = start; value <= end; value += step) {
        values.add(value)
      }
      continue
    }

    if (part.includes('-')) {
      const [rawStart, rawEnd] = part.split('-')
      const start = Number.parseInt(rawStart ?? '', 10)
      const end = Number.parseInt(rawEnd ?? '', 10)
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid range in cron ${spec.name} field`)
      }
      validateBounds(start, spec)
      validateBounds(end, spec)
      if (start > end) {
        throw new Error(`Invalid range ${start}-${end} in cron ${spec.name} field`)
      }
      for (let value = start; value <= end; value += 1) {
        values.add(value)
      }
      continue
    }

    if (part === '*') {
      for (let value = spec.min; value <= spec.max; value += 1) {
        values.add(value)
      }
      continue
    }

    const value = Number.parseInt(part, 10)
    if (!Number.isInteger(value)) {
      throw new Error(`Invalid value "${part}" in cron ${spec.name} field`)
    }
    validateBounds(value, spec)
    values.add(value)
  }

  if (values.size === 0) {
    throw new Error(`Empty result for cron ${spec.name} field`)
  }

  return [...values].sort((left, right) => left - right)
}

export const parseCron = (expression: string): ParsedCron => {
  const trimmed = expression.trim()
  if (!trimmed) {
    throw new Error('Cron expression must not be empty')
  }

  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have exactly 5 fields, got ${fields.length}`)
  }

  return {
    minutes: parseField(fields[0]!, FIELD_SPECS[0]!),
    hours: parseField(fields[1]!, FIELD_SPECS[1]!),
    daysOfMonth: parseField(fields[2]!, FIELD_SPECS[2]!),
    months: parseField(fields[3]!, FIELD_SPECS[3]!),
    daysOfWeek: parseField(fields[4]!, FIELD_SPECS[4]!),
  }
}

export const validateCron = (expression: string) => {
  try {
    parseCron(expression)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid cron expression'
  }
}

const floorToMinute = (date: Date) => {
  const next = new Date(date.getTime())
  next.setUTCSeconds(0, 0)
  return next
}

const assertTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
  } catch {
    throw new Error(`Invalid timezone: ${timeZone}`)
  }
}

const getZonedMinuteParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  })
  const parts = formatter.formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = WEEKDAY_INDEX[map.weekday ?? '']
  if (weekday == null) {
    throw new Error(`Unable to resolve weekday for timezone ${timeZone}`)
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday,
  }
}

const matchesCronMinute = (expression: string, timeZone: string, date: Date) => {
  const cron = parseCron(expression)
  const parts = getZonedMinuteParts(date, timeZone)
  return (
    cron.minutes.includes(parts.minute)
    && cron.hours.includes(parts.hour)
    && cron.daysOfMonth.includes(parts.day)
    && cron.months.includes(parts.month)
    && cron.daysOfWeek.includes(parts.weekday)
  )
}

export const nextCronTick = (expression: string, after: Date) => {
  return nextCronTickInTimeZone(expression, 'UTC', after)
}

export const nextCronTickInTimeZone = (expression: string, timeZone: string, after: Date) => {
  assertTimeZone(timeZone)
  const validationError = validateCron(expression)
  if (validationError) {
    throw new Error(validationError)
  }

  const cursor = floorToMinute(after)
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)

  const limit = 366 * 24 * 60 * 5
  for (let index = 0; index < limit; index += 1) {
    if (matchesCronMinute(expression, timeZone, cursor)) {
      return new Date(cursor.getTime())
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  }

  return null
}

// [INPUT]: 项目颜色输入
// [OUTPUT]: 颜色分配
// [POS]: 项目颜色工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export function normalizeHexColor(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const raw = value.trim()
  if (!raw) {
    return null
  }

  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex.split('').map((char) => `${char}${char}`).join('').toLowerCase()}`
  }

  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toLowerCase()}`
  }

  return null
}

function hslComponentToHex(value: number) {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0')
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = Math.max(0, Math.min(100, saturation)) / 100
  const l = Math.max(0, Math.min(100, lightness)) / 100
  const c = (1 - Math.abs((2 * l) - 1)) * s
  const h = ((hue % 360) + 360) % 360
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - (c / 2)

  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  return `#${hslComponentToHex((r + m) * 255)}${hslComponentToHex((g + m) * 255)}${hslComponentToHex((b + m) * 255)}`
}

export function deriveProjectColor(seed: string) {
  let hash = 0

  for (const char of seed.trim() || 'project') {
    hash = ((hash * 33) + char.charCodeAt(0)) >>> 0
  }

  return hslToHex(hash % 360, 68, 56)
}

export function generateRandomProjectColor() {
  return hslToHex(Math.floor(Math.random() * 360), 68, 56)
}

export function getProjectColor(project: { name: string; color?: string | null }) {
  return normalizeHexColor(project.color) ?? deriveProjectColor(project.name)
}

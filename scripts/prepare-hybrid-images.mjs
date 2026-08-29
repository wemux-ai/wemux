import { spawnSync } from 'node:child_process'

const REQUIRED_IMAGES = [
  'node:22-bookworm-slim',
  'postgres:16-alpine',
]

const MAX_PULL_ATTEMPTS = 3

const runDocker = (args, timeout = 15_000) => {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    timeout,
  })
}

const getOutput = (result) => {
  return result.stderr?.trim() || result.stdout?.trim() || result.error?.message || '未知错误'
}

const hasLocalImage = (image) => {
  return runDocker(['image', 'inspect', image], 5_000).status === 0
}

const pullImage = (image) => {
  let lastError = '未知错误'

  for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
    process.stderr.write(`hybrid 预检：拉取镜像 ${image}（${attempt}/${MAX_PULL_ATTEMPTS}）...\n`)
    const result = runDocker(['pull', image], 120_000)
    if (result.status === 0) {
      return null
    }
    lastError = getOutput(result)
  }

  return lastError
}

const contextResult = runDocker(['context', 'show'])
const missingImages = REQUIRED_IMAGES.filter((image) => !hasLocalImage(image))

if (missingImages.length === 0) {
  process.exit(0)
}

process.stderr.write(`hybrid 预检：缺少 ${missingImages.length} 个 Docker 镜像，先尝试预拉取，避免 worker 提前启动。\n`)

const failures = missingImages.flatMap((image) => {
  const error = pullImage(image)
  return error ? [{ image, error }] : []
})

if (failures.length === 0) {
  process.stderr.write('hybrid 预检：Docker 镜像已准备完成。\n')
  process.exit(0)
}

const context = contextResult.status === 0 ? contextResult.stdout.trim() : 'unknown'
const failureLines = failures.map(({ image, error }) => `- ${image}: ${error}`)
const detail = failures.map(({ error }) => error).join('\n')
const hint = detail.includes('TLS handshake timeout')
  ? '这通常表示当前到 Docker Hub 的网络握手超时；稍后重试，或先手动执行 `docker pull node:22-bookworm-slim` 验证网络。'
  : detail.includes('i/o timeout')
    ? '这通常表示当前网络访问 Docker Registry 超时；请检查代理、DNS 或网络连通性。'
    : detail.includes('toomanyrequests')
      ? '当前命中了 Docker Hub 拉取限流；请登录 Docker、稍后重试，或配置镜像加速。'
      : '当前无法准备 hybrid 所需镜像，请先确认 Docker Registry 可访问后再重试。'

process.stderr.write([
  'wemux hybrid 启动前检查失败：Docker daemon 可用，但依赖镜像未准备完成。',
  `当前 Docker context: ${context}`,
  ...failureLines,
  hint,
  '由于 stack 尚未就绪，本次不会再把 worker 一起拉起来制造额外 WebSocket 噪音。',
].join('\n'))
process.stderr.write('\n')
process.exit(1)

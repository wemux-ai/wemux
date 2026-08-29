import { spawnSync } from 'node:child_process'

const runDocker = (args) => {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 15000,
  })
}

const getOutput = (result) => {
  return result.stderr?.trim() || result.stdout?.trim() || result.error?.message || '未知错误'
}

const contextResult = runDocker(['context', 'show'])
const infoResult = runDocker(['info', '--format', '{{json .ServerVersion}}'])

if (infoResult.status === 0) {
  process.exit(0)
}

const detail = getOutput(infoResult)
const context = contextResult.status === 0 ? contextResult.stdout.trim() : 'unknown'
const hint = detail.includes('EOF')
  ? '这通常表示 OrbStack / Docker Desktop 后台服务未就绪，或刚刚异常重启。'
  : detail.includes('permission denied') || detail.includes('operation not permitted')
    ? '当前 Docker socket 不可访问，请确认你有权限访问 Docker daemon。'
    : '当前 Docker daemon 不可用，请先确认 OrbStack / Docker Desktop 已正常运行。'

process.stderr.write([
  'wemux hybrid 启动前检查失败：无法连接 Docker daemon。',
  `当前 Docker context: ${context}`,
  `原始错误: ${detail}`,
  hint,
  '建议先执行 `docker version` 或 `docker info` 自检，通过后再运行 `pnpm dev:hybrid`。',
].join('\n'))
process.stderr.write('\n')
process.exit(infoResult.status ?? 1)

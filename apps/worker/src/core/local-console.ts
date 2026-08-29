// [INPUT]: 本地控制台输入
// [OUTPUT]: 打开本地控制台
// [POS]: 本地控制台启动
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

const DEFAULT_LOCAL_CONSOLE_HOST = '127.0.0.1'

const normalizeDisplayHost = (host: string) => {
  if (host === '0.0.0.0' || host === '::') {
    return DEFAULT_LOCAL_CONSOLE_HOST
  }

  return host
}

const formatUrlHost = (host: string) => {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export const getLocalWorkerConsoleListenHost = () => {
  return process.env.VIBEMUX_WORKER_HOST?.trim() || DEFAULT_LOCAL_CONSOLE_HOST
}

export const getLocalWorkerConsoleUrl = (port: number) => {
  const host = normalizeDisplayHost(getLocalWorkerConsoleListenHost())
  return `http://${formatUrlHost(host)}:${port}`
}

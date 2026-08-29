// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Node process environment（仅 server / worker 使用；web 不得 import 本模块）。
// [OUTPUT]: 双前缀环境变量读取：`WEMUX_*` 优先，旧 `VIBEMUX_*` 兜底；以及启动期桥接函数。
//   桥接只同步非空 `WEMUX_*` 值——部署层常注入 `${WEMUX_X:-}` 空壳，空串不得覆盖 .env 已配的旧前缀真实值。
// [POS]: 品牌迁移兼容层（Phase 2）。兼容窗口内新旧前缀都生效，窗口结束后移除 `VIBEMUX_*` 分支。

/**
 * 品牌迁移兼容层：
 * - 新环境变量统一使用 `WEMUX_` 前缀；
 * - 旧 `VIBEMUX_` 前缀在兼容窗口内继续生效；
 * - 同名时 `WEMUX_` 优先于 `VIBEMUX_`。
 */

const toLegacyEnvName = (name: string) => {
  return name.startsWith('WEMUX_') ? `VIBEMUX_${name.slice('WEMUX_'.length)}` : name
}

/**
 * 双读读取：传新前缀名（如 `WEMUX_CLOUD_URL`），自动回退旧前缀。
 * 用于模块加载期（import 时）的环境读取，避免依赖桥接时序。
 */
export const getEnv = (name: string): string | undefined => {
  return process.env[name] ?? process.env[toLegacyEnvName(name)]
}

/**
 * 启动期桥接：把已设置的 `WEMUX_*` 同步到 `VIBEMUX_*`，
 * 让仍直接读取旧前缀的运行时代码在兼容窗口内看到新值。
 * 需在 dotenv 加载之后、任何运行时环境读取之前调用。
 *
 * 注意：只同步**非空**值。部署层（如 docker-compose）常注入
 * `WEMUX_X=${WEMUX_X:-}` 空壳占位，若把空字符串写进 `VIBEMUX_*`，
 * 会覆盖 .env 里已配置的旧前缀真实值，导致配置静默失效。
 */
export const bridgeWemuxEnvToLegacy = () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('WEMUX_') && process.env[key]?.trim()) {
      process.env[toLegacyEnvName(key)] = process.env[key]
    }
  }
}

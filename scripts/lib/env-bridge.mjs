// 品牌迁移兼容层（Phase 2）：WEMUX_* 优先同步到 VIBEMUX_*，旧前缀仍可直接设置。
// 作为副作用模块：在脚本首个 import 位置引入，保证模块级 env 读取前完成映射。
for (const key of Object.keys(process.env)) {
  if (key.startsWith('WEMUX_')) {
    process.env[`VIBEMUX_${key.slice('WEMUX_'.length)}`] = process.env[key]
  }
}

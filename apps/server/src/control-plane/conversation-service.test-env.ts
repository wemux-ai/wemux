// 测试前置：db.ts 在模块加载期解析 DATABASE_URL，因此必须在导入任何 store 前设置。
// 本地 dev docker（vibemux-postgres，宿主 5434）未配置 env 时使用默认连接串；CI 用真实 env。
if (!process.env.DATABASE_URL?.trim() && !process.env.POSTGRES_URL?.trim()) {
  process.env.DATABASE_URL = 'postgres://vibemux:vibemux@127.0.0.1:5434/vibemux'
}

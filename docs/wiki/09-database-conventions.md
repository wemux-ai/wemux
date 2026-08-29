# 数据库规范

## 核心原则

1. 只保留 Postgres 作为主库
2. 禁止 SQL 字符串拼接，必须参数化
3. Server 是唯一数据库访问层；web / worker / shared 不直接碰库
4. **Schema 变更由 Drizzle 管理**（`schema.ts` / `schema-core.ts` + `drizzle/` migrations）
5. 业务读写用 Drizzle query builder（`getDrizzleDb` / `withDrizzleTransaction`）

## 连接配置

### 开发环境

```bash
DATABASE_URL=postgres://vibemux:local-dev-password@127.0.0.1:5434/vibemux
```

### 生产环境

```bash
DATABASE_URL=postgres://user:password@db-host:5432/vibemux
```

## 访问路径

| 层 | 路径 | 说明 |
| --- | --- | --- |
| 连接池 / 启动迁移 | `apps/server/src/storage/postgres/db.ts` | `ensurePostgresReady()` 跑 Drizzle `migrate()`；已有库会自动 baseline |
| Drizzle 入口 | `drizzle-db.ts` | `getDrizzleDb()`、`withDrizzleTransaction()`，复用同一 `pg` pool |
| 表类型描述 | `schema.ts` + `schema-core.ts` | TypeScript 表定义，generate 的输入 |
| Migration 文件 | `apps/server/src/storage/postgres/drizzle/` | `pnpm db:generate` 产出 |
| 业务读写 | `*-store.ts` / 相关 services | Drizzle query builder |

## 改表流程（唯一路径）

```text
1. 修改 schema.ts / schema-core.ts
2. pnpm db:generate
3. 检查 drizzle/000x_*.sql
4. 本地 pnpm db:migrate 或启动 server（ensurePostgresReady 会 migrate）
5. 提交 schema + drizzle migration 文件并部署
```

### 已有库（曾经用手写 SQL 建过）

首次启动 Drizzle 路径时：

- 若已有 `public.users` 且 `drizzle.__drizzle_migrations` 为空  
- server 会 **自动 baseline**（只写 journal，不重跑 CREATE）  
- 之后只应用新的 migration  

也可手动：

```bash
pnpm db:baseline
pnpm db:migrate
```

### 空库

```bash
pnpm db:migrate
# 或直接启动 server
```

会从 `0000_*.sql` 建出完整 schema。

## 数据库工具

| 工具 | 用途 |
|------|------|
| `pnpm db:reset` | 重置开发数据库 volume（本地） |
| `pnpm db:reset:all` | 重置 postgres + 对象存储 volume |
| `pnpm db:generate` | 根据 schema 生成 migration |
| `pnpm db:migrate` | 应用 migration |
| `pnpm db:baseline` | 已有库标记当前 migration 已应用（不跑 CREATE） |
| `pnpm db:studio` | 浏览数据库 |

## 禁止事项

- 禁止 SQL 字符串拼接，必须参数化
- 禁止再新增手写 `schemaStatements` / `migrationStatements` 启动建表路径（已删除）
- 禁止在未确认作用域时混改 chat 与 workspace 会话逻辑
- 禁止让 web/worker 直接假设本地文件系统或数据库可用
- 禁止 Drizzle schema 泄漏到 shared 跨端包

## 相关文档

- [Drizzle Adoption 进度](../DRIZZLE-ADOPTION.md)
- [Drizzle Adoption](../DRIZZLE-ADOPTION.md)
- [基础设施](./15-infrastructure.md)

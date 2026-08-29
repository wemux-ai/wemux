# 匿名使用上报（Community Usage Reporting）

> 适用范围：自托管 / 社区版部署。本文档随公开仓库分发，说明我们收集什么、不收集什么、如何关闭。

Wemux 社区版默认开启**匿名使用上报**：你的实例会定期（每天一次 + 启动时）向 `https://wemux.ai/api/community-usage/report` 发送一条极小的聚合报告，帮助我们了解社区版的真实使用情况，把维护精力花在真正被用到的功能上。

## 我们收集什么

每次上报只包含以下字段（`schemaVersion: 1`）：

```json
{
  "schemaVersion": 1,
  "installId": "6f9619ff-8b86-d011-b42d-00c04fc964ff",
  "version": "0.3.128",
  "os": "linux x64",
  "deploymentMode": "",
  "reportedAt": "2026-08-23T12:00:00.000Z",
  "counters": {
    "usersTotal": 3,
    "teamsTotal": 1,
    "tasksTotal": 42,
    "conversationsTotal": 17,
    "agentRunsTotal": 88
  }
}
```

| 字段 | 说明 |
|------|------|
| `installId` | 首次启动时随机生成的 UUID，仅用于去重计数；与你任何身份信息无关 |
| `version` | Wemux 版本号 |
| `os` | 操作系统与架构（如 `linux x64`） |
| `deploymentMode` | 仅当部署方显式设置 `WEMUX_DEPLOYMENT_MODE` 时携带 |
| `counters` | 五个累计聚合计数：用户数 / 组织数 / 任务数 / 会话数 / Agent 启动数 |

## 我们不收集什么

- ❌ 仓库名、项目名、任务标题、会话内容等任何内容类数据
- ❌ 用户名、邮箱、IP 等身份信息
- ❌ 模型 key、凭据、环境变量
- ❌ 代码、diff、文件内容

上报 payload 的字段白名单硬编码在源码中（`packages/shared/src/types/community-usage.ts`），可以自行审计。

## 如何关闭

任选其一：

1. **环境变量**（推荐）：

   ```bash
   WEMUX_USAGE_REPORTING_DISABLED=1
   ```

   docker-compose 生产部署在 `.env.production` 中加入该行即可。

2. **自建端点覆盖**：把上报指向你自己的服务做审计或转发：

   ```bash
   WEMUX_USAGE_REPORTING_ENDPOINT=https://your-endpoint.example.com/report
   ```

关闭后不影响任何功能——上报是尽力而为的后台请求，失败静默，从不阻塞业务链路。

## 收集端（仅官方云实例需要）

上报的接收端点 `/api/community-usage/report` 默认关闭，只有 wemux.ai 官方实例通过以下变量开启：

```bash
WEMUX_COMMUNITY_USAGE_COLLECTOR_ENABLED=1
```

自托管实例无需开启；开启即成为收集端，开始接收其他实例的上报。该开关只影响接收端，不改变你实例自身的上报行为。

## 设计原则

- **Opt-out 而非 opt-in**：为了测到真实的安装基数（这是开源项目最重要的健康指标），默认开启；作为交换，我们承诺本页披露的字段就是全部字段。
- **与产品遥测分离**：实例内部的产品埋点（`telemetry_events` 表）只落在你自己的 Postgres 里，永不外发；两者是独立模块。
- **可验证**：所有相关代码都在公开仓库中——reporter 在 `apps/server/src/services/community-usage-reporter-service.ts`，字段清洗在 `packages/shared/src/types/community-usage.ts`。

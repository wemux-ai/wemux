# 开发测试登录

目标：

- 本地开发时不再强依赖 Google OAuth
- 登录页直接提供一组可点击的测试账号
- 保留生产环境现有登录链路，不把开发入口带到线上

## 方案概览

现在登录页有两条并行入口：

- 正常入口：继续使用 Google 登录
- 开发入口：在本地开发环境展示“开发测试账号”面板，点击即可一键登录

开发入口只在下面条件同时满足时启用：

- `NODE_ENV !== production`
- `WEMUX_ENABLE_DEV_LOGIN !== false`

服务端新增两个开发接口：

- `GET /api/auth/dev/accounts`
  - 返回当前可用的开发测试账号列表
- `POST /api/auth/dev/login`
  - 传入 `accountId`
  - 服务端按配置自动创建或更新该账号
  - 直接签发 Wemux 自己的 token

这样浏览器自动化、Agent 验证、本地 smoke test 都不用再走 Google 跳转和账号选择流程。

## 默认测试账号

如果没有配置自定义账号，系统会自动准备用于本地开发的示例账号。账号只在非生产环境
启用，登录页会直接展示一键登录按钮。示例账号和密码不要用于共享或生产环境。

## 自定义更多测试账号

可以通过环境变量 `WEMUX_DEV_LOGIN_ACCOUNTS` 覆盖默认账号列表。

格式是一个 JSON 数组，例如：

```bash
WEMUX_DEV_LOGIN_ACCOUNTS='[
  {
    "id": "pm",
    "label": "Product Manager",
    "description": "测试普通成员常规路径",
    "email": "pm@test.com",
    "password": "<local-dev-password>",
    "name": "PM User",
    "onboarding": "complete",
    "onboardingPath": "team"
  }
]'
```

字段说明：

- `id`：登录按钮使用的稳定标识
- `label`：登录页展示名称
- `description`：登录页说明文案
- `email`：测试账号邮箱
- `password`：本地数据库里的密码
- `name`：用户昵称
- `onboarding`：`complete` 或 `fresh`
- `onboardingPath`：可选，控制首登路径标签

## 账号创建与更新规则

开发账号不是一次性种子数据，而是“按配置收敛”的：

- 服务启动时会自动确保这些账号存在
- 点击开发账号登录时，也会再次确保该账号状态正确
- 如果你修改了名字、权限或 onboarding 状态，下一次启动或下一次点击登录时会自动对齐

这样做的好处是：

- 不需要手动清库再重建账号
- 测试 persona 可以长期稳定复用
- 自动化脚本拿到的是固定身份，而不是临时 OAuth 会话

## 前端行为

登录页在开发环境会额外显示一个“开发测试账号”区块：

- 每个账号都是一个一键登录按钮
- 点击后直接调用开发登录接口
- 成功后沿用现有跳转逻辑：
  - 已完成 onboarding 进入 `/dashboard`
  - 未完成 onboarding 进入 `/onboarding`

Google 登录仍然保留，方便偶尔验证真实 OAuth 流程。

## 安全边界

这个能力的边界非常明确：

- 生产环境默认关闭
- 只有开发环境才会暴露账号列表和一键登录接口
- 这不是替代正式认证，而是本地开发加速器

如果你要在 preview 或共享测试环境里禁用它，显式设置：

```bash
WEMUX_ENABLE_DEV_LOGIN=false
```

## 推荐工作流

本地开发推荐这样使用：

1. 启动 `web` 和 `server`
2. 打开 `/login`
3. 直接点一个测试账号进入系统
4. 只有在需要回归 OAuth 时，才使用 Google 登录

这样浏览器自动化、UI 迭代和 Agent 自测都会稳定很多。

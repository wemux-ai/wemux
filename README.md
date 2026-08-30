# Wemux

> **AI Native organization OS.**
>
> **Agent 与人类共同协作的平台** — AI agent orchestration with real isolated worker execution.
>
> **English**: README.md | **中文**: [README.zh-CN.md](README.zh-CN.md)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/Self--hosted-✔-brightgreen.svg)](docs/SELF-HOSTING.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Wemux is an open-source agent collaboration platform. It orchestrates AI agents that execute real coding work on **worker machines** (your machines, your credentials), in isolated Git worktrees, with full traceability — not in a black box in the cloud. A control plane handles planning, routing and review; the actual work always runs on workers you own.

**Open source** — Apache-2.0 licensed (see [LICENSE](LICENSE)), fully self-hostable, community driven. Star us on [GitHub](https://github.com/wemux-ai/wemux), open an [issue](https://github.com/wemux-ai/wemux/issues), or join the discussion. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

> **Note** — This repository contains the open-source community edition of Wemux. Some platform capabilities — hosted model gateway, usage-based billing, hosted cloud-node pool, and partner systems — are operated as separate commercial services and are **not part of this repository**. **Self-hosted cloud nodes are open source** (bring your own Docker/BoxLite hosts — see [SELF-HOSTING.md § 七](docs/SELF-HOSTING.md)). Everything in this repo is free to use under Apache-2.0. See [Open source vs hosted](#open-source-vs-hosted-services) for the full breakdown.

## Contents

- [Highlights](#highlights)
- [Open source vs hosted services](#open-source-vs-hosted-services)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Quick start (self-hosted)](#quick-start-self-hosted)
- [Deploy on Railway](#deploy-on-railway)
- [Model configuration (BYOK)](#model-configuration-byok)
- [Development](#development)
- [FAQ](#faq)
- [Telemetry (anonymous, opt-out)](#telemetry-anonymous-opt-out)
- [Community & resources](#community--resources)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Highlights

- **Worker-first execution** — code tasks run on worker daemons in isolated worktrees/branches; the control plane never executes your code.
- **Main chat orchestration** — a main agent understands requirements, routes to workers, picks agents, dispatches, verifies and asks for human confirmation.
- **Workspaces & tasks** — kanban task management, natural-language task creation, workspace sessions with realtime collaboration, group chat with agents.
- **Drive** — workspace-level file storage with sharing.
- **Channel integrations** — Feishu (飞书), Slack, DingTalk, WeCom (企业微信), WeChat, WhatsApp inbound channels.
- **Multi-node mesh** — connect multiple workers, group them with easytier, route by capability.
- **BYOK model config** — agents run on your own model keys via OpenCode/Claude Code/Codex runtimes on the worker.
- **Native clients** — Electron desktop and React Native/Expo mobile (Android/iOS) apps.

## Open source vs hosted services

This repository is the self-hostable **community edition**: everything in the left column is included here, free to use and modify under Apache-2.0. The capabilities in the right column are operated as separate commercial hosted services and are **not part of this repository** — in the code they exist only as neutral no-op stubs (never a gate, never a paywall, nothing that blocks or limits the community edition).

| Capability | Open source (this repo) | Commercial hosted only |
|---|---|---|
| Core platform — web console, control plane, worker daemon | ✅ | — |
| Worker execution (pairing, worktrees, agent runtime) | ✅ | — |
| BYOK model configuration | ✅ | — |
| Main chat / tasks / workspaces orchestration & group chat | ✅ | — |
| Drive (workspace file storage & sharing) | ✅ | — |
| Channel integrations (Feishu / Slack / DingTalk / WeCom / WeChat / WhatsApp) | ✅ | — |
| Multi-node mesh (easytier) | ✅ | — |
| Usage dashboard & user-set token quota | ✅ | platform-enforced quota |
| Admin console (users / feedback / ops) | ✅ | billing, credits, gateways, cloud-nodes, partners panels |
| Native clients (Electron desktop + React Native Android/iOS) | ✅ | — |
| Hosted model gateway (official model catalog) | — | ✅ |
| Managed cloud nodes (hosted sandbox workers) | **self-hosted runtime included** (docker-cli / boxlite / ascii-box / CF sandbox) | hosted pool |
| Subscription / usage billing, credits & payments | — | ✅ |
| Partner (合作商) systems | — | ✅ |

The community edition is fully self-contained around **local workers + BYOK models**; the split above does not affect core orchestration, execution or collaboration features. See also [SELF-HOSTING.md § Community edition scope](docs/SELF-HOSTING.md).

## How it works

Wemux keeps humans in the loop while agents do the heavy lifting:

1. **Describe** — create a task in natural language from the main chat, a workspace kanban, or even an inbound IM channel (Feishu / Slack / …).
2. **Plan** — a main agent turns your words into a structured task, picks an agent and a workspace, and routes it to an available worker.
3. **Execute** — the worker prepares an isolated Git worktree on your machine, and the agent runtime (OpenCode / Claude Code / Codex) does the work with your credentials — your code never leaves your machine.
4. **Review** — the worker reports back a diff and results; you review and approve before anything is merged.
5. **Deliver** — approved changes are delivered, and every step stays traceable in the workspace session.

## Architecture

```text
┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐
│  web        │──▶│  server      │──▶│  worker (daemon)    │
│  console    │   │  control     │   │  ├─ repo prepare    │
│  (React)    │   │  plane       │   │  ├─ worktree        │
│             │   │  (Hono)      │   │  ├─ agent runtime   │
└─────────────┘   │  Postgres    │   │  └─ git delivery    │
                  │  S3/R2       │   └─────────────────────┘
                  └──────────────┘
```

```text
.
├── apps/
│   ├── web/       React + Vite + TanStack Start console
│   ├── server/    Hono control plane: HTTP/WS, scheduling, auth, chat orchestration, workspace/task management
│   ├── worker/    Local executor daemon: pairing, repo preparation, isolated worktrees, agent runtime, delivery
│   ├── desktop/   Electron desktop client
│   ├── mobile/    React Native + Expo mobile client (Android/iOS)
├── packages/
│   └── shared/    Cross-end types, contracts and pure helpers
├── scripts/       Build & dev tooling
├── deploy/        Dockerfiles, compose stacks, production deployment
└── docs/          Documentation (self-hosting, telemetry, roadmap, …)
```

Storage: PostgreSQL (Drizzle migrations) + S3-compatible object storage (R2/MinIO).

## Quick start (self-hosted)

Requirements: Node.js 20+, pnpm 10+, Docker (for Postgres).

```bash
git clone https://github.com/wemux-ai/wemux.git
cd wemux
pnpm install

# 1. Start infrastructure (Postgres + object storage)
pnpm dev:infra:up

# 2. Configure environment
cp .env.development.local.example .env.development.local
#   edit DATABASE_URL / OBJECT_STORAGE_* to match your setup

# 3. Run control plane + console
pnpm dev:server    # API on :8989
pnpm dev:client    # web console

# 4. Run a worker (same machine or any machine)
pnpm dev:worker
#   pair the worker with the control plane, then create a task
```

Prefer a single command? `pnpm dev` runs server, console and worker together in a TUI.

The worker does not have to run on the same machine as the control plane. For a quick worker install on another macOS/Linux machine, generate the install command from **Execution → Add Executor** in the control plane. It will look like:

```bash
curl -fsSL https://<server>/install | bash -s -- \
  --pairing-code '<PAIRING_CODE>' \
  --server-url 'https://<server>'
```

The generated command installs, pairs, registers, and starts the worker service. Windows/WSL and Docker commands are available from the same dialog.

For production-style deployment see [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md), `deploy/`, and the Dockerfiles (`deploy/docker/Dockerfile.control-plane`, `deploy/docker/Dockerfile.managed-worker`). A one-command production stack is available via `deploy/docker/docker-compose.production.yml` + `.env.production.example`.

## Deploy on Railway

Deploy your own instance without managing a VPS. The repository ships `.railway/railway.ts` (Railway Infrastructure as Code) that provisions the control plane, Postgres, and an object-storage Bucket with build/start/healthcheck preconfigured:

```bash
git clone https://github.com/wemux-ai/wemux.git && cd wemux
pnpm install
railway login
railway init          # or `railway link` for an existing project
railway config apply  # creates Postgres + Bucket + control-plane (wires DATABASE_URL)
railway up            # deploy the current checkout
```

It runs:

```text
pnpm build:client && pnpm build:server && pnpm build:worker:preview-installer
NODE_ENV=production node dist-server/apps/server/src/control-plane-entry.js
healthcheck: /api/ready
```

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/wemux-community)

> **Heads-up:** Railway deprecated Config-as-Code (`railway.json`) — new services no longer read it. A bare **New Project → Deploy from GitHub repo** misdetects this repository as a TanStack Start app and crashes at start (`srvx: command not found`). Use the IaC flow above, the official template, or set the build/start/healthcheck commands on the service manually. The root `railway.json` only keeps serving pre-existing (legacy) services until 2026-12-01.

Set these variables on the control-plane service before deploying:

| Variable | Required value / default |
|---|---|
| `DATABASE_URL` | **Required.** Reference the Railway Postgres service, for example `${{Postgres.DATABASE_URL}}` (adjust `Postgres` to the actual service name). `POSTGRES_URL` is also accepted. |
| `OBJECT_STORAGE_ENDPOINT` | **Required for uploads.** HTTPS S3-compatible endpoint from Railway Bucket, Cloudflare R2, or another provider. |
| `OBJECT_STORAGE_BUCKET` | **Required for uploads.** Existing bucket name. |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | **Required for uploads.** Object-storage access key. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | **Required for uploads.** Object-storage secret key. |
| `OBJECT_STORAGE_REGION` | Optional; defaults to `auto`. |
| `BETTER_AUTH_SECRET` | **Required in production.** Generate with `openssl rand -hex 32`. |
| `TOKEN_SECRET` | **Required in production.** Generate separately with `openssl rand -hex 32`. |
| `SECRET_ENCRYPTION_KEY` | **Required.** A 32-byte hex key; generate separately with `openssl rand -hex 32`. |
| `WEMUX_PUBLIC_BASE_URL` | Set to the final public origin, for example `https://your-app.up.railway.app`. |
| `BETTER_AUTH_URL` | Set to the same public origin; required for reliable login/OAuth callbacks. |
| `HOST` | Optional; defaults to `0.0.0.0`. |
| `PORT` | Do not pin it. Railway injects `PORT`; the application fallback is `8989`. |
| `NODE_ENV` | Already set to `production` by the start command. |

After the deploy, generate a Railway domain under **Settings → Networking**, set both public URL variables to that HTTPS origin, and redeploy. Verify `https://<domain>/api/ready`, then open `/execution`, choose **Add Executor**, and run the generated install command on the worker machine.

Full setup, custom-domain, worker-pairing, and upgrade instructions: [SELF-HOSTING.md → Railway](docs/SELF-HOSTING.md).

## Model configuration (BYOK)

Model keys are configured **on the worker side** — your keys never leave your machine. Configure your runtime (OpenCode/Claude Code/Codex) on the worker, then select models in the console's model center. No built-in API keys are shipped with Wemux.

> **Runtime licenses** — the Wemux platform is Apache-2.0, but the agent CLIs it orchestrates carry their own licenses: [OpenCode](https://github.com/sst/opencode) is Apache-2.0; Claude Code and Codex are proprietary tools of Anthropic and OpenAI respectively — you authenticate with your own accounts and are subject to their terms.

## Development

```bash
pnpm install
pnpm typecheck                  # strict TS across web + server
pnpm dev                        # all-in-one dev: server + console + worker (TUI)
pnpm build                      # production client + server build

# focused tests
pnpm exec tsx --test packages/shared/src/task-workspace.test.ts
```

Database schema changes go through Drizzle: edit the schema, run `pnpm db:generate`, and commit the generated migration. See [SELF-HOSTING.md](docs/SELF-HOSTING.md) for deployment details and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## FAQ

**Does my code ever leave my machine?**
No. Tasks execute on your workers in isolated Git worktrees; only diffs, logs and artifacts are reported back to the control plane. Agent runtimes run with your credentials on your machine, and BYOK model keys never leave the worker. The control plane never executes your code.

**Do I need a powerful machine or GPU?**
No. The worker just runs the agent CLI locally — model inference happens at your model provider (Anthropic, OpenAI, OpenRouter, local models, …). Any laptop or server can be a worker.

**Which agent runtimes and models can I use?**
Wemux orchestrates OpenCode, Claude Code and Codex runtimes, with any model your runtime supports — bring your own keys (BYOK).

**Do I have to self-host?**
No. The same product is offered as a hosted service (wemux.ai) with managed cloud nodes and billing. This repository is the self-hostable community edition.

**Is it really free?**
Yes. Everything in this repository is Apache-2.0, including the self-hosted cloud-node runtime. Only separately operated hosted services — model gateway, hosted cloud-node pool, billing, partner systems — are commercial, and none of them is part of this repo.

**How is Wemux different from cloud agent platforms?**
Worker-first execution: code runs on machines you control, in isolated worktrees, with human-in-the-loop diff review before merge. Plus multi-node mesh, IM channel integrations, and workspace-level collaboration — all self-hostable.

## Telemetry (anonymous, opt-out)

Self-hosted instances report **anonymous aggregate usage** once a day to help us understand how the community edition is used: version, OS, and five cumulative counters (users / orgs / tasks / sessions / agent starts).

- ❌ Never collected: repository names, task titles, session content, usernames, emails, IPs, code — any content or identity data.
- ✅ The full payload schema is documented and auditable: [docs/TELEMETRY.md](docs/TELEMETRY.md) (field whitelist lives in the source at `packages/shared/src/types/community-usage.ts`).

Turn it off with a single environment variable:

```bash
WEMUX_USAGE_REPORTING_DISABLED=1
```

Reporting is best-effort and never blocks anything — disabling it does not affect any feature.

## Community & resources

- [GitHub Issues](https://github.com/wemux-ai/wemux/issues) — reproducible bugs and clearly scoped engineering tasks
- [GitHub Discussions](https://github.com/wemux-ai/wemux/discussions) — usage questions, ideas, use cases and roadmap discussion
- [Community governance](docs/COMMUNITY-GOVERNANCE.md) — channel rules, Issue quality bar and maintainer workflow
- [Roadmap](ROADMAP.md) — what's planned next
- [SELF-HOSTING.md](docs/SELF-HOSTING.md) — production deployment guide
- [Changelog](CHANGELOG.md) — release history

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). External contributions go through the standard fork → PR flow. Please read the contribution guidelines first — some compatibility stubs are maintainer-owned and may not accept direct changes.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) — please report privately, do not open a public issue.

## License

[Apache-2.0](LICENSE). Documentation and marketing assets are licensed separately (see NOTICE). "wemux" and the wemux.ai domain are trademarks and are not granted by the open-source license.

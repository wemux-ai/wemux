// [INPUT]: worker 安装文档请求
// [OUTPUT]: 安装页
// [POS]: Worker Install 文档页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { requireIndexedMarketingPage } from '@shared/site-seo'
import { MarketingPageLayout, MarketingSection } from '../components/marketing/marketing-page-layout'
import { buildMarketingHead, buildPageUrl, marketingSite } from '../lib/marketing-site'
import {
  buildWorkerDockerConnectCommand,
  buildWorkerLocalConnectCommand,
  getWorkerDaemonCommand,
  getWorkerLocalConsoleUrl,
  getWorkerOpenCommand,
  getWorkerRestartCommand,
} from '../lib/worker-connect-command'

const seoPage = requireIndexedMarketingPage('/docs/worker-install')
const { title, description } = seoPage

const checklist = [
  'A connect command is generated in /execution.',
  'The command runs successfully on the target machine.',
  'Later restarts can reuse the same connect command because old pairing codes are ignored after the first successful pairing.',
  'The paired machine shows online or paired in the executor list.',
  'The first task returns logs, branch output, and a review path.',
]

const buildInstallSteps = () => {
  return [
    {
      body: 'Open the Execution page in Wemux, create a new executor, and generate a connect command.',
      command: 'Open /execution -> New Executor -> Generate Connect Command',
      title: '1. Generate a connect command',
    },
    {
      body: 'Choose Local or Docker, then run the generated command on the target machine. For Local, pick macOS/Linux or Windows first. Local install registers a service with auto-restart and auto-update; Docker uses the container restart policy.',
      command: `# macOS / Linux\n${buildWorkerLocalConnectCommand('<PAIRING_CODE>', { installTarget: 'unix' })}\n\n# Windows PowerShell\n${buildWorkerLocalConnectCommand('<PAIRING_CODE>', { installTarget: 'windows' })}\n\n# Docker option\n${buildWorkerDockerConnectCommand('<PAIRING_CODE>')}`,
      title: '2. Run it on the target machine',
    },
    {
      body: 'After the service is installed, it restarts automatically on reboot, crash, and worker updates.',
      command: `${getWorkerRestartCommand()} service status\n${getWorkerRestartCommand()} service logs --follow`,
      title: '3. Check the service later',
    },
    {
      body: 'If you prefer the manual path after installing, you can open the local Worker Console and paste only the pairing code there.',
      command: `${getWorkerOpenCommand()}\n${getWorkerLocalConsoleUrl()}`,
      title: '4. Optional manual fallback',
    },
    {
      body: 'Create one real task, keep execution mode enabled, and route it to the newly paired worker. Confirm that a branch, logs, and reviewable output come back.',
      command: 'Create task -> choose executor -> wait for branch/log/result',
      title: '5. Complete the first task',
    },
  ]
}

const buildCommandCards = () => {
  return [
    {
      command: buildWorkerLocalConnectCommand('<PAIRING_CODE>', { installTarget: 'unix' }),
      detail: 'Installs the worker on macOS or Linux, pairs it, registers a user-level service, and enables service-backed auto-update.',
      title: 'macOS / Linux install',
    },
    {
      command: buildWorkerLocalConnectCommand('<PAIRING_CODE>', { installTarget: 'windows' }),
      detail: 'Installs the worker on Windows, pairs it, registers a scheduled background service, and enables service-backed auto-update. ⚠️ The current version has limited compatibility with native Windows — we recommend using WSL (Windows Subsystem for Linux) or choosing the macOS / Linux target instead.',
      title: 'Windows install (limited support)',
    },
    {
      command: buildWorkerDockerConnectCommand('<PAIRING_CODE>'),
      detail: 'Runs the worker inside node:22-bookworm-slim, persists install state in a Docker volume, and lets idle workers self-update through the container restart policy.',
      title: 'Docker connect command',
    },
    {
      command: getWorkerRestartCommand(),
      detail: 'Installed worker binary path used for service management and manual diagnostics.',
      title: 'Installed binary',
    },
    {
      command: `${getWorkerOpenCommand()}\n${getWorkerDaemonCommand()}`,
      detail: 'Manual fallback after installation when you want to open the local console or run the daemon in foreground.',
      title: 'Manual console path',
    },
  ]
}

export const Route = createFileRoute('/docs/worker-install')({
  head: () => {
    const installSteps = buildInstallSteps()
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'HowTo',
          description,
          name: title,
          step: installSteps.map((step, index) => ({
            '@type': 'HowToStep',
            name: step.title,
            position: index + 1,
            text: `${step.body} ${step.command}`,
          })),
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              item: marketingSite.homeUrl,
              name: 'Home',
              position: 1,
            },
            {
              '@type': 'ListItem',
              item: buildPageUrl('/docs/worker-install'),
              name: 'Worker Install',
              position: 2,
            },
          ],
        },
      ],
    }

    return buildMarketingHead({
      description,
      path: '/docs/worker-install',
      structuredData,
      title,
    })
  },
  component: WorkerInstallRoute,
})

function WorkerInstallRoute() {
  const installSteps = buildInstallSteps()
  const commandCards = buildCommandCards()

  return (
    <MarketingPageLayout
      description="This is the shortest onboarding path we want beta users to complete: install a worker, pair it, and prove the first task can come back with real execution output."
      eyebrow="Worker Install"
      title="Install a Wemux worker, connect it fast, and finish the first task loop."
    >
      <MarketingSection
        description="If this path is slow or confusing, onboarding breaks. The goal is not a long manual. The goal is to get one machine online fast."
        title="Fast path"
      >
        <div className="space-y-4">
          {installSteps.map((step) => (
            <article className="border border-white/[0.08] bg-black/25 p-5" key={step.title}>
              <h3 className="text-lg font-medium text-white">{step.title}</h3>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">{step.body}</p>
              <pre className="mt-4 overflow-x-auto border border-white/[0.08] bg-[#050507] p-4 font-mono text-xs leading-6 text-zinc-200">
                <code>{step.command}</code>
              </pre>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        description="These are the exact commands a beta user is most likely to need during install and pairing."
        title="Commands"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {commandCards.map((card) => (
            <article className="border border-white/[0.08] bg-black/25 p-5" key={card.title}>
              <h3 className="text-lg font-medium text-white">{card.title}</h3>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{card.detail}</p>
              <pre className="mt-4 overflow-x-auto border border-white/[0.08] bg-[#050507] p-4 font-mono text-xs leading-6 text-zinc-200">
                <code>{card.command}</code>
              </pre>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        description="If any item below is false, the onboarding is not complete yet."
        title="Success checklist"
      >
        <ul className="space-y-3 text-sm leading-7 text-zinc-300">
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingSection
        description="These links connect install intent back to product framing and beta conversion."
        title="Related pages"
      >
        <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/">
            Homepage
          </a>
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/faq">
            FAQ
          </a>
          <a
            className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white"
            href="/compare/ai-chat-vs-ai-delivery"
          >
            Chat vs delivery
          </a>
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/use-cases/ai-coding-delivery">
            AI coding delivery
          </a>
          <a className="bg-violet-600 px-4 py-3 text-white transition hover:bg-violet-500" href="/login">
            Apply for beta
          </a>
        </div>
      </MarketingSection>
    </MarketingPageLayout>
  )
}

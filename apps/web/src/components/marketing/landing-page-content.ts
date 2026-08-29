import type { Language } from '../../lib/i18n'
import type { PreviewViewId } from './landing-product-preview-data'

export type NavItem = {
  label: string
  labelEn: string
  href: string
}

export type BilingualText = {
  zh: string
  en: string
}

export type HeroTag = BilingualText & {
  viewId: PreviewViewId
}

export type AgentRole = {
  name: string
  summary: string
  summaryEn: string
}

export type WorkerNode = {
  name: string
  ip: string
  memory: string
  cpu: string
  task: BilingualText
  status: 'online' | 'busy' | 'private' | 'standby'
}

export type Scenario = {
  title: string
  titleEn: string
  description: string
  descriptionEn: string
}

export type LandingText = {
  navStatus: string
  startCta: string
  hero: {
    eyebrow: string
    alphaLabel: string
    alphaMessage: string
    title: string
    description: string
    secondaryDescription: string
    primaryCta: string
    secondaryCta: string
  }
  console: {
    terminalLabel: string
  }
  pain: SectionText & {
    cards: Array<{
      title: string
      eyebrow: string
      description: string
    }>
    mobileSupport: {
      eyebrow: string
      title: string
      description: string
      secondaryDescription: string
      quickActions: string[]
      capabilities: Array<{
        title: string
        description: string
      }>
      controlTitle: string
      controlCards: Array<{
        title: string
        description: string
      }>
      flowLabel: string
      flow: string[]
      liveLabel: string
      deviceLabel: string
      liveTask: string
      liveSummary: string
      actionsLabel: string
      actions: string[]
      updatesLabel: string
      oversightLabel: string
    }
  }
  agents: SectionText
  workers: {
    eyebrow: string
    title: string
    description: string
    secondaryDescription: string
    controlNode: string
    memoryLabel: string
    cpuLabel: string
    footer: string
  }
  useCases: SectionText
  faq: SectionText & {
    items: Array<{
      question: string
      answer: string
    }>
  }
  cta: {
    eyebrow: string
    title: string
    description: string
    secondaryDescription: string
    downloadCta: string
  }
  footer: {
    summary: string
  }
}

export type SectionText = {
  eyebrow: string
  title: string
  kicker?: string
  description?: string
}

export const loginPath = '/login'
export const navItems: NavItem[] = [
  { label: '控制台', labelEn: 'Console', href: '#console' },
  { label: '状态', labelEn: 'Status', href: '#status' },
  { label: 'Agent', labelEn: 'Agents', href: '#agents' },
  { label: '节点', labelEn: 'Workers', href: '#workers' },
  { label: '定价', labelEn: 'Pricing', href: '#pricing' },
  { label: '场景', labelEn: 'Use Cases', href: '#use-cases' },
  { label: '常见问题', labelEn: 'FAQ', href: '#faq' },
]

export const heroTags: HeroTag[] = [
  { zh: '工作区', en: 'Workspaces', viewId: 'workspaces' },
  { zh: '聊天', en: 'Chat', viewId: 'chat' },
  { zh: '项目', en: 'Projects', viewId: 'projects' },
  { zh: '云盘', en: 'Drive', viewId: 'drive' },
  { zh: '文档', en: 'Docs', viewId: 'docs' },
  { zh: 'Agent', en: 'Agents', viewId: 'agent-developer' },
  { zh: '节点', en: 'Workers', viewId: 'execution' },
  { zh: '组织管理', en: 'Organization', viewId: 'teams' },
  { zh: 'MCP', en: 'MCP', viewId: 'mcp' },
  { zh: 'Skills', en: 'Skills', viewId: 'skills' },
]

export const agentRoles: AgentRole[] = [
  { name: 'Developer Agent', summary: '实现需求、修复 Bug、提交 patch。', summaryEn: 'Build features, fix bugs, and prepare patches.' },
  { name: 'Tester Agent', summary: '启动环境、浏览器巡检、记录异常。', summaryEn: 'Run environments, inspect browsers, and log issues.' },
  { name: 'Reviewer Agent', summary: '审查改动、提示风险、生成验证清单。', summaryEn: 'Review changes, flag risks, and produce checklists.' },
  { name: 'Doc Writer Agent', summary: '整理文档、更新说明、输出总结。', summaryEn: 'Update docs, release notes, and change summaries.' },
  { name: 'Researcher Agent', summary: '调研方案、分析竞品、收集资料。', summaryEn: 'Research options, competitors, and supporting materials.' },
  { name: 'Operator Agent', summary: '协助发布、运营、增长和日常流程。', summaryEn: 'Support launches, operations, growth, and recurring workflows.' },
]

export const workerNodes: WorkerNode[] = [
  {
    name: 'MacBook',
    ip: '192.168.1.24',
    memory: '18 / 32 GB',
    cpu: '41%',
    task: { zh: '登录回调修复', en: 'Auth callback fix' },
    status: 'busy',
  },
  {
    name: 'Cloud VM',
    ip: '10.18.0.12',
    memory: '46 / 64 GB',
    cpu: '72%',
    task: { zh: '浏览器回归测试', en: 'Browser regression' },
    status: 'online',
  },
  {
    name: 'Office PC',
    ip: '172.16.8.33',
    memory: '9 / 16 GB',
    cpu: '24%',
    task: { zh: '文档整理', en: 'Docs cleanup' },
    status: 'online',
  },
  {
    name: 'Home Server',
    ip: '192.168.1.88',
    memory: '28 / 64 GB',
    cpu: '55%',
    task: { zh: '研究资料收集', en: 'Research crawl' },
    status: 'private',
  },
  {
    name: 'Backup Mini',
    ip: '100.96.4.17',
    memory: '6 / 16 GB',
    cpu: '8%',
    task: { zh: '等待调度', en: 'Waiting for route' },
    status: 'standby',
  },
]

export const scenarios: Scenario[] = [
  {
    title: '软件开发',
    titleEn: 'Software Development',
    description: '需求、Bug、重构、测试、评审。',
    descriptionEn: 'Requirements, bugs, refactors, testing, and review.',
  },
  {
    title: '产品规划',
    titleEn: 'Product Planning',
    description: 'Idea、PRD、UIUX、用户反馈。',
    descriptionEn: 'Ideas, PRDs, UI/UX work, and user feedback.',
  },
  {
    title: '内容写作',
    titleEn: 'Content Writing',
    description: '文档、博客、发布说明、研究总结。',
    descriptionEn: 'Docs, blogs, release notes, and research summaries.',
  },
  {
    title: '运营协作',
    titleEn: 'Operations',
    description: '发布 checklist、增长实验、客户反馈整理。',
    descriptionEn: 'Launch checklists, growth experiments, and customer feedback triage.',
  },
]

export const nodeStatusClasses: Record<WorkerNode['status'], string> = {
  online: 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.55)]',
  busy: 'bg-violet-400 shadow-[0_0_18px_rgba(167,139,250,0.55)]',
  private: 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.5)]',
  standby: 'bg-zinc-600',
}

export const landingMeta: Record<Language, { title: string; description: string }> = {
  zh: {
    title: 'Wemux - AI 原生组织的操作系统',
    description: 'Wemux 是 AI 原生组织的操作系统：团队与 Agent 在同一个系统中协作，任务、Agent 会话、文档与上下文共享，跨团队、跨组织的项目都能放进同一条流程。',
  },
  en: {
    title: 'Wemux - The AI-Native Operating System for Your Organization',
    description: 'Wemux is the AI-native operating system for your organization: teams and agents collaborate in one system where tasks, agent sessions, documents, and context are shared across teams, projects, and organizations.',
  },
}

export const topologyNodePositions = [
  'left-6 top-6',
  'right-6 top-8',
  'bottom-10 left-8',
  'bottom-10 right-8',
  'bottom-4 left-1/2 -translate-x-1/2',
]

export const landingText: Record<Language, LandingText> = {
  zh: {
    navStatus: 'AI 原生组织的操作系统',
    startCta: '开始使用',
    hero: {
      eyebrow: 'The control plane for your AI workforce',
      alphaLabel: 'Alpha',
      alphaMessage: '阿尔法版本，快速迭代中，界面与能力会持续更新。',
      title: 'AI 原生组织的操作系统',
      description: '一个系统，团队与 Agent 共同协作：项目任务、Agent 会话与文档共享，不再散落在不同工具里。',
      secondaryDescription: 'Agent 可以在本地、云端或私有服务器持续运行。团队在同一个工作区里分派任务、共享上下文并查看结果。',
      primaryCta: '创建我的 AI 原生组织',
      secondaryCta: '查看 Agent 分工',
    },
    console: {
      terminalLabel: '工作流：人类 → Agent → Worker → 审核；状态：人类掌控',
    },
    pain: {
      eyebrow: '02 / 痛点',
      title: 'Agent 能干活，但人类还缺一个工作控制台',
      cards: [
        { title: '任务散落', eyebrow: '任务入口', description: '聊天框能完成一次请求，却很难承载持续流动的任务、优先级和协作状态。' },
        { title: '执行绑死机器', eyebrow: '执行节点', description: '一台电脑离线，任务就停住；长任务、本地私有仓库和团队共享能力也难调度。' },
        { title: '结果变成黑盒', eyebrow: '审核确认', description: '没有统一日志、会话、产物和审核入口，人类很难判断是否该确认、重试或接管。' },
      ],
      mobileSupport: {
        eyebrow: '手机 / 移动端支持',
        title: '移动端口袋控制台',
        description: '在通勤路上也能精准掌控。快速新建开发需求，随时查阅实时生成的代码 Diff 和执行日志。',
        secondaryDescription: '桌面端适合重度编辑，手机端适合关键控制。你不必一直守在电脑前，依然能让 Agent 工作流持续推进。',
        quickActions: ['创建任务', 'AI 聊天', '终端控制', 'Git 操作'],
        capabilities: [
          { title: '随时盯状态', description: '打开手机就能看到哪个任务卡住、哪个节点在线、哪个结果正等你确认。' },
          { title: '直接做判断', description: '发现跑偏就能立刻要求重试、切换 Agent，或在关键节点接管处理。' },
          { title: '不中断工作流', description: '人不在电脑前，任务也不会因为没人盯盘就失去节奏和反馈。' },
        ],
        controlTitle: '安全与可控：不止是 AI',
        controlCards: [
          {
            title: '隔离分支执行',
            description: 'AI 生成的代码始终在临时的隔离分支（Shadow Branches）中执行，不会直接污染你的主干仓库。',
          },
          {
            title: '人工最后确认',
            description: '所有代码交付都需要在 Wemux 控制台进行人工 Review。确认无误后，一键合并至主分支。',
          },
        ],
        flowLabel: '工作流',
        flow: ['人类设定目标', 'Agent 执行', 'Worker 交付', '人工审核确认'],
        liveLabel: '实时任务',
        deviceLabel: '移动控制台',
        liveTask: '支付回调修复 / Reviewer 等待确认',
        liveSummary: '3 个节点在线，1 个任务待你审批，日志仍在持续回传。',
        actionsLabel: '手机上可直接处理',
        actions: ['新建任务', '分派 Agent', '查看日志', '确认 / 重试'],
        updatesLabel: '实时更新',
        oversightLabel: '人工把关',
      },
    },
    agents: {
      eyebrow: '03 / Agent 角色',
      title: '给每类工作配置专属 Agent',
    },
    workers: {
      eyebrow: '04 / 分布式执行',
      title: '让所有在线机器成为执行能力',
      description: '你不需要守着一台电脑等任务跑完。把 worker 部署到不同地方，Wemux 会把任务派发给合适的在线节点。',
      secondaryDescription: '云端机器跑长任务，本地机器处理私有仓库，团队机器共享执行能力。',
      controlNode: '控制台',
      memoryLabel: '内存',
      cpuLabel: 'CPU',
      footer: '分布式任务调度',
    },
    useCases: {
      eyebrow: '06 / 场景',
      title: '不只适合开发',
      kicker: '开发是第一个场景，但不是唯一场景。',
      description: '看板 + Agent + 执行节点的组合，适合更多知识工作流。',
    },
    faq: {
      eyebrow: '07 / 常见问题',
      title: '你可能会先问这些',
      items: [
        {
          question: 'Wemux 是替代现有 AI 工具吗？',
          answer: '不是。Wemux 是 AI 原生组织的操作系统，把任务、Agent、worker、日志和审核组织到一条流程里。你仍然可以接入不同 Agent 或模型。',
        },
        {
          question: '任务只能是开发任务吗？',
          answer: '不是。开发是第一个场景，但写作、研究、测试、运营、发布 checklist 和用户反馈整理都可以放进同一个看板流程。',
        },
        {
          question: 'Worker 节点可以部署在哪里？',
          answer: '可以部署在主力机、云服务器、备用电脑、团队机器或家用服务器上。只要节点在线，就能成为可调度的执行能力。',
        },
        {
          question: 'Agent 会自动替我做最终决定吗？',
          answer: '不会。Agent 可以执行任务并产出结果，但最终确认、重试、接管和完成判断都由人类控制。',
        },
        {
          question: '手机上能做什么？',
          answer: '可以新建任务、分派 Agent、查看执行日志、追踪状态、审核结果，也可以要求重试或接管。',
        },
      ],
    },
    cta: {
      eyebrow: 'AI 组织操作系统',
      title: '从单个 AI 工具，升级到\nAI 原生组织的操作系统',
      description: '把任务放进看板，把工作交给 Agent，把执行分散到在线节点，把最终决策留给人类。',
      secondaryDescription: '人类与 Agent 协作：你负责目标与判断，Agent 负责执行与交付，结果始终由你确认。',
      downloadCta: '下载桌面端',
    },
    footer: {
      summary: 'Wemux 是 AI 原生组织的操作系统。',
    },
  },
  en: {
    navStatus: 'The AI-Native Organization OS',
    startCta: 'Get Started',
    hero: {
      eyebrow: 'The control plane for your AI workforce',
      alphaLabel: 'Alpha',
      alphaMessage: 'Alpha release. Rapidly iterating, so the UI and capabilities will keep changing.',
      title: 'The AI-Native Organization OS',
      description: 'One system where your team and agents work together — projects, tasks, agent sessions, and documents shared in one place, not scattered across tools.',
      secondaryDescription: 'Agents can keep running on your Mac, in the cloud, or on a private server. Your team can assign tasks, share context, and review results in one workspace.',
      primaryCta: 'Create My AI-Native Organization',
      secondaryCta: 'See Agent Roles',
    },
    console: {
      terminalLabel: 'WORKFLOW: HUMAN → AGENT → WORKER → REVIEW / STATUS: UNDER HUMAN CONTROL',
    },
    pain: {
      eyebrow: '02 / Pain Point',
      title: 'Agents can do the work — humans still lack the console.',
      cards: [
        { title: 'Scattered Tasks', eyebrow: 'Task Intake', description: 'A chat can handle one request, but it does not carry priorities, status, and collaboration over time.' },
        { title: 'Machine-bound Execution', eyebrow: 'Worker Routing', description: 'When one computer goes offline, the work stops. Long jobs, private repos, and shared team capacity need routing.' },
        { title: 'Opaque Results', eyebrow: 'Human Review', description: 'Without unified logs, sessions, artifacts, and approval, humans cannot confidently confirm, retry, or take over.' },
      ],
      mobileSupport: {
        eyebrow: 'Phone / Mobile Support',
        title: 'A mobile work console in your pocket.',
        description: 'Stay precise even while commuting. Create new dev tasks fast and check live diffs and execution logs from your phone.',
        secondaryDescription: 'Desktop is for heavy editing. Mobile is for critical control. You do not need to stay at your desk to keep the agent workflow moving.',
        quickActions: ['Create Task', 'AI Chat', 'Terminal', 'Git Ops'],
        capabilities: [
          { title: 'Check Status Fast', description: 'See which task is blocked, which worker is online, and which result is waiting for approval the moment you unlock your phone.' },
          { title: 'Act Immediately', description: 'Request a retry, switch the assigned agent, or take over at the exact moment work starts drifting.' },
          { title: 'Keep the Flow Moving', description: 'The workflow does not lose momentum just because the human operator is away from a laptop.' },
        ],
        controlTitle: 'Safety and control: more than just AI.',
        controlCards: [
          {
            title: 'Isolated Branch Execution',
            description: 'AI-generated code always runs in temporary isolated branches, so it does not directly contaminate your mainline repository.',
          },
          {
            title: 'Final Human Approval',
            description: 'Every code delivery still goes through human review inside Wemux before a one-click merge back to the main branch.',
          },
        ],
        flowLabel: 'Workflow',
        flow: ['Humans set goals', 'Agents execute', 'Workers deliver', 'Humans approve'],
        liveLabel: 'Live Task',
        deviceLabel: 'Mobile Command',
        liveTask: 'Payment callback fix / Reviewer waiting for approval',
        liveSummary: '3 workers online, 1 task waiting for your approval, and logs are still streaming back.',
        actionsLabel: 'Direct actions from mobile',
        actions: ['Create task', 'Assign agent', 'View logs', 'Approve / Retry'],
        updatesLabel: 'Live Updates',
        oversightLabel: 'Human In Loop',
      },
    },
    agents: {
      eyebrow: '03 / Agent Roles',
      title: 'Configure dedicated agents for each kind of work.',
    },
    workers: {
      eyebrow: '04 / Distributed Execution',
      title: 'Turn every online machine into execution capacity.',
      description: 'You do not need to watch one computer until a task finishes. Deploy workers anywhere and Wemux routes work to the right online node.',
      secondaryDescription: 'Run long jobs on cloud machines, private repos on local hardware, and shared tasks on team workers.',
      controlNode: 'Control',
      memoryLabel: 'Memory',
      cpuLabel: 'CPU',
      footer: 'Distributed Task Routing',
    },
    useCases: {
      eyebrow: '06 / Use Cases',
      title: 'Not just for development.',
      kicker: 'Development is the first workflow, not the only one.',
      description: 'Kanban + agents + execution workers can support many knowledge workflows.',
    },
    faq: {
      eyebrow: '07 / FAQ',
      title: 'Questions teams usually ask first.',
      items: [
        {
          question: 'Does Wemux replace existing AI tools?',
          answer: 'No. Wemux is the operating system for AI-native organizations. It organizes tasks, agents, workers, logs, and approvals into one workflow while still letting you connect different agents or models.',
        },
        {
          question: 'Is it only for software development?',
          answer: 'No. Development is the first workflow, but writing, research, testing, operations, launch checklists, and feedback triage can use the same board-driven process.',
        },
        {
          question: 'Where can worker nodes run?',
          answer: 'Workers can run on your main machine, a cloud server, a spare computer, a team machine, or a home server. Any online worker becomes schedulable execution capacity.',
        },
        {
          question: 'Will agents make final decisions for me?',
          answer: 'No. Agents can execute and produce results, but final confirmation, retries, takeover, and completion stay under human control.',
        },
        {
          question: 'What can I do from mobile?',
          answer: 'You can create tasks, assign agents, inspect logs, track status, review results, request retries, or take over work while away from your desk.',
        },
      ],
    },
    cta: {
      eyebrow: 'AI-native organization OS',
      title: 'From single AI tools to\nthe operating system for your organization',
      description: 'From a conversation to a traceable task, to execution in real environments and result review.',
      secondaryDescription: 'Humans and agents collaborate: you own goals and judgment, agents execute and deliver, and every result comes back for your confirmation.',
      downloadCta: 'Download the desktop app',
    },
    footer: {
      summary: 'Wemux is the operating system for AI-native organizations.',
    },
  },
}

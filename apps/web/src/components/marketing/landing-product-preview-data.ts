import type { Language } from '../../lib/i18n'

export type LocalizedText = Record<Language, string>
export type Tone = 'zinc' | 'sky' | 'violet' | 'amber' | 'emerald' | 'rose'
export type PreviewViewId =
  | 'new-task'
  | 'dashboard'
  | 'projects'
  | 'workspaces'
  | 'drive'
  | 'docs'
  | 'teams'
  | 'chat'
  | 'project-product'
  | 'project-docs'
  | 'project-growth'
  | 'agent-developer'
  | 'agent-tester'
  | 'agent-reviewer'
  | 'execution'
  | 'models'
  | 'skills'
  | 'mcp'
  | 'settings'

export type ProjectPreviewViewId = Extract<PreviewViewId, 'project-product' | 'project-docs' | 'project-growth'>

export type PreviewMetric = {
  value: string
  label: LocalizedText
  tone: Tone
}

export type PreviewProject = {
  viewId: ProjectPreviewViewId
  name: string
  meta: LocalizedText
  color: string
  runtime: LocalizedText
}

export type PreviewAgent = {
  viewId: PreviewViewId
  name: string
  role: LocalizedText
  state: LocalizedText
}

export type PreviewTask = {
  title: LocalizedText
  description: LocalizedText
  agent: string
  status: string
  statusTone: Tone
  priority: LocalizedText
  priorityTone: Tone
  node: string
  assignee: string
  updated: LocalizedText
}

export type PreviewColumn = {
  title: LocalizedText
  tone: Tone
  tasks: PreviewTask[]
}

export type PreviewLog = {
  time: string
  level: string
  tone: Tone
  message: LocalizedText
}

export type PreviewNode = {
  name: string
  ip: string
  memory: string
  cpu: string
  status: string
  tone: Tone
}

export type PreviewInspector = {
  title: LocalizedText
  status: string
  statusTone: Tone
  agent: string
  node: string
  workspace: string
  returnMode: string
  noticeTitle: LocalizedText
  noticeDescription: LocalizedText
  validation: LocalizedText[]
  logs: PreviewLog[]
}

export type PreviewProjectBoard = {
  projectId: ProjectPreviewViewId
  repo: string
  headline: LocalizedText
  description: LocalizedText
  stats: PreviewMetric[]
  columns: PreviewColumn[]
  inspector: PreviewInspector
}

export const toneClassNames: Record<Tone, { dot: string; text: string; border: string; bg: string }> = {
  zinc: { dot: 'bg-zinc-500', text: 'text-zinc-400', border: 'border-zinc-700', bg: 'bg-zinc-500/10' },
  sky: { dot: 'bg-sky-400', text: 'text-sky-300', border: 'border-sky-500/35', bg: 'bg-sky-500/10' },
  violet: { dot: 'bg-violet-400', text: 'text-violet-300', border: 'border-violet-500/35', bg: 'bg-violet-500/10' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/35', bg: 'bg-amber-500/10' },
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-500/35', bg: 'bg-emerald-500/10' },
  rose: { dot: 'bg-rose-400', text: 'text-rose-300', border: 'border-rose-500/35', bg: 'bg-rose-500/10' },
}

export const previewProjects: PreviewProject[] = [
  {
    viewId: 'project-product',
    name: 'Wemux Console',
    meta: { zh: '12 tasks', en: '12 tasks' },
    color: '#8b5cf6',
    runtime: { zh: '运行中', en: 'Running' },
  },
  {
    viewId: 'project-docs',
    name: 'Wemux Docs',
    meta: { zh: '4 tasks', en: '4 tasks' },
    color: '#38bdf8',
    runtime: { zh: '待审核', en: 'Review' },
  },
  {
    viewId: 'project-growth',
    name: 'Community Operations',
    meta: { zh: '7 tasks', en: '7 tasks' },
    color: '#10b981',
    runtime: { zh: '稳定', en: 'Stable' },
  },
]

export const previewAgents: PreviewAgent[] = [
  { viewId: 'agent-developer', name: 'Developer', role: { zh: '代码与重构', en: 'Code and refactor' }, state: { zh: '启用', en: 'Enabled' } },
  { viewId: 'agent-tester', name: 'Tester', role: { zh: '浏览器巡检', en: 'Browser checks' }, state: { zh: '启用', en: 'Enabled' } },
  { viewId: 'agent-reviewer', name: 'Reviewer', role: { zh: '风险与审核', en: 'Risk and review' }, state: { zh: '启用', en: 'Enabled' } },
]

export const previewProjectBoards = {
  'project-product': {
    projectId: 'project-product',
    repo: 'github.com/wemux-ai/wemux',
    headline: { zh: 'Wemux Console · 开发任务全链路同步', en: 'Wemux Console · Development workflow in sync' },
    description: { zh: '需求、Bug、测试与评审在同一个 Agent 看板里推进。', en: 'Features, bugs, tests, and reviews move through one agent board.' },
    stats: [
      { value: '5', label: { zh: 'Agent 在线', en: 'Agents Online' }, tone: 'violet' },
      { value: '3', label: { zh: '节点可调度', en: 'Workers Ready' }, tone: 'emerald' },
      { value: '68%', label: { zh: '登录修复进度', en: 'Auth Fix Progress' }, tone: 'sky' },
      { value: '2', label: { zh: '等待代码审核', en: 'Code Reviews' }, tone: 'amber' },
    ],
    columns: [
      {
        title: { zh: 'Todo', en: 'Todo' },
        tone: 'sky',
        tasks: [
          {
            title: { zh: '调研竞品 onboarding 流程', en: 'Research competitor onboarding' },
            description: { zh: '整理核心路径、关键转化点和可复用交互。', en: 'Map key paths, conversion points, and reusable interactions.' },
            agent: 'Researcher',
            status: 'READY',
            statusTone: 'zinc',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Cloud VM',
            assignee: 'RX',
            updated: { zh: '刚刚', en: 'now' },
          },
          {
            title: { zh: '拆分任务详情抽屉', en: 'Split task detail drawer' },
            description: { zh: '把状态、会话、产物和审核记录拆成可维护组件。', en: 'Split status, sessions, artifacts, and review records into maintainable components.' },
            agent: 'Developer',
            status: 'QUEUED',
            statusTone: 'zinc',
            priority: { zh: '低', en: 'LOW' },
            priorityTone: 'zinc',
            node: 'Office PC',
            assignee: 'DV',
            updated: { zh: '12 分钟前', en: '12m ago' },
          },
        ],
      },
      {
        title: { zh: 'In Progress', en: 'In Progress' },
        tone: 'amber',
        tasks: [
          {
            title: { zh: '修复登录回调 Bug', en: 'Fix auth callback bug' },
            description: { zh: 'Agent 正在隔离工作区修改 OAuth 回调处理。', en: 'Agent is patching OAuth callback handling in an isolated workspace.' },
            agent: 'Developer',
            status: '68%',
            statusTone: 'emerald',
            priority: { zh: '高', en: 'HIGH' },
            priorityTone: 'rose',
            node: 'MacBook',
            assignee: 'DV',
            updated: { zh: '3 分钟前', en: '3m ago' },
          },
          {
            title: { zh: '浏览器巡检支付流程', en: 'Inspect checkout flow' },
            description: { zh: '远端节点运行浏览器并记录异常截图。', en: 'Remote worker runs browser checks and captures failures.' },
            agent: 'Tester',
            status: '42%',
            statusTone: 'emerald',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Home Server',
            assignee: 'QA',
            updated: { zh: '8 分钟前', en: '8m ago' },
          },
        ],
      },
      {
        title: { zh: 'In Review', en: 'In Review' },
        tone: 'violet',
        tasks: [
          {
            title: { zh: '评审 API 重构结果', en: 'Review API refactor result' },
            description: { zh: '等待人类确认 diff、测试记录和风险清单。', en: 'Waiting for human approval on diff, test records, and risks.' },
            agent: 'Reviewer',
            status: 'DIFF',
            statusTone: 'amber',
            priority: { zh: '高', en: 'HIGH' },
            priorityTone: 'rose',
            node: 'Cloud VM',
            assignee: 'RV',
            updated: { zh: '18 分钟前', en: '18m ago' },
          },
        ],
      },
      {
        title: { zh: 'Done', en: 'Done' },
        tone: 'emerald',
        tasks: [
          {
            title: { zh: '更新 worker 配对引导', en: 'Update worker pairing guide' },
            description: { zh: '节点配对、截图和最终摘要已确认。', en: 'Worker pairing, screenshots, and final summary are approved.' },
            agent: 'Operator',
            status: 'DONE',
            statusTone: 'emerald',
            priority: { zh: '低', en: 'LOW' },
            priorityTone: 'zinc',
            node: 'Office PC',
            assignee: 'OP',
            updated: { zh: '今天', en: 'today' },
          },
        ],
      },
    ],
    inspector: {
      title: { zh: '修复登录回调 Bug', en: 'Fix auth callback bug' },
      status: '68%',
      statusTone: 'amber',
      agent: 'Developer',
      node: 'MacBook · 192.168.1.24',
      workspace: 'auth-flow-fix',
      returnMode: 'commit + summary',
      noticeTitle: { zh: '等待人类审核', en: 'Human review required' },
      noticeDescription: { zh: 'Agent 已创建提交，测试记录保留在执行工作区。', en: 'Agent created a commit and kept test records in the execution workspace.' },
      validation: [
        { zh: 'OAuth 回调路径已修复', en: 'OAuth callback path patched' },
        { zh: '登录回归测试通过', en: 'Login regression passed' },
        { zh: '等待 Owner 确认上线', en: 'Waiting for owner approval' },
      ],
      logs: [
        { time: '09:41:03', level: 'TASK', tone: 'violet', message: { zh: '任务进入队列：修复登录回调 Bug', en: 'Queued task: fix auth callback bug' } },
        { time: '09:41:08', level: 'AGENT', tone: 'sky', message: { zh: '分派给 Developer Agent', en: 'Delegated to Developer Agent' } },
        { time: '09:41:12', level: 'WORKER', tone: 'emerald', message: { zh: '选择在线节点 MacBook-Pro', en: 'Selected online worker MacBook-Pro' } },
        { time: '09:41:19', level: 'SPACE', tone: 'sky', message: { zh: '进入隔离工作区并开始执行', en: 'Entered isolated workspace and started' } },
        { time: '09:45:32', level: 'REVIEW', tone: 'amber', message: { zh: '等待人类审核 Diff 与测试结果', en: 'Waiting for human review of diff and tests' } },
      ],
    },
  },
  'project-docs': {
    projectId: 'project-docs',
    repo: 'github.com/wemux-ai/wemux',
    headline: { zh: 'Wemux Docs · 文档生产与审核流水线', en: 'Wemux Docs · Documentation production pipeline' },
    description: { zh: '发布说明、教程、README 和知识库由专属 Agent 分工处理。', en: 'Release notes, guides, READMEs, and knowledge base work are delegated to dedicated agents.' },
    stats: [
      { value: '3', label: { zh: '写作 Agent 在线', en: 'Writing Agents' }, tone: 'sky' },
      { value: '2', label: { zh: '文档待审核', en: 'Docs In Review' }, tone: 'amber' },
      { value: '91%', label: { zh: '发布说明完成', en: 'Release Notes Done' }, tone: 'emerald' },
      { value: '4', label: { zh: '引用需核对', en: 'Citations To Check' }, tone: 'violet' },
    ],
    columns: [
      {
        title: { zh: 'Todo', en: 'Todo' },
        tone: 'sky',
        tasks: [
          {
            title: { zh: '补齐 Worker 部署教程', en: 'Complete worker deployment guide' },
            description: { zh: '整理 Mac、云服务器和公司私有服务器的部署步骤。', en: 'Document deployment steps for Mac, cloud VM, and private servers.' },
            agent: 'Doc Writer',
            status: 'READY',
            statusTone: 'zinc',
            priority: { zh: '高', en: 'HIGH' },
            priorityTone: 'rose',
            node: 'Cloud VM',
            assignee: 'DW',
            updated: { zh: '5 分钟前', en: '5m ago' },
          },
          {
            title: { zh: '整理 FAQ 初稿', en: 'Draft FAQ section' },
            description: { zh: '把安全、节点、手机控制和人工审核问题整理成问答。', en: 'Turn safety, workers, mobile control, and human review concerns into Q&A.' },
            agent: 'Researcher',
            status: 'QUEUED',
            statusTone: 'zinc',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Office PC',
            assignee: 'RX',
            updated: { zh: '16 分钟前', en: '16m ago' },
          },
        ],
      },
      {
        title: { zh: 'Writing', en: 'Writing' },
        tone: 'amber',
        tasks: [
          {
            title: { zh: '整理 v0.4 发布说明', en: 'Prepare v0.4 release notes' },
            description: { zh: '根据任务结果生成面向用户的变更摘要。', en: 'Generate user-facing change notes from completed tasks.' },
            agent: 'Doc Writer',
            status: '91%',
            statusTone: 'emerald',
            priority: { zh: '高', en: 'HIGH' },
            priorityTone: 'rose',
            node: 'MacBook',
            assignee: 'DW',
            updated: { zh: '2 分钟前', en: '2m ago' },
          },
          {
            title: { zh: '改写 Agent 工作流介绍', en: 'Rewrite agent workflow intro' },
            description: { zh: '把单次对话改写成控制台工作流叙事。', en: 'Reframe one-off chat copy into a control-console workflow narrative.' },
            agent: 'Reviewer',
            status: '54%',
            statusTone: 'emerald',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Home Server',
            assignee: 'RV',
            updated: { zh: '9 分钟前', en: '9m ago' },
          },
        ],
      },
      {
        title: { zh: 'Review', en: 'Review' },
        tone: 'violet',
        tasks: [
          {
            title: { zh: '审核 README 快速开始', en: 'Review README quickstart' },
            description: { zh: '核对命令、环境变量和截图是否与当前版本一致。', en: 'Check commands, environment variables, and screenshots against the current version.' },
            agent: 'Reviewer',
            status: 'CHECK',
            statusTone: 'amber',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Office PC',
            assignee: 'RV',
            updated: { zh: '23 分钟前', en: '23m ago' },
          },
        ],
      },
      {
        title: { zh: 'Published', en: 'Published' },
        tone: 'emerald',
        tasks: [
          {
            title: { zh: '归档移动端审核指南', en: 'Archive mobile review guide' },
            description: { zh: '内容、封面和目录位置已确认。', en: 'Content, cover, and table-of-contents placement are approved.' },
            agent: 'Operator',
            status: 'LIVE',
            statusTone: 'emerald',
            priority: { zh: '低', en: 'LOW' },
            priorityTone: 'zinc',
            node: 'Cloud VM',
            assignee: 'OP',
            updated: { zh: '昨天', en: 'yesterday' },
          },
        ],
      },
    ],
    inspector: {
      title: { zh: '整理 v0.4 发布说明', en: 'Prepare v0.4 release notes' },
      status: '91%',
      statusTone: 'emerald',
      agent: 'Doc Writer',
      node: 'MacBook · 192.168.1.24',
      workspace: 'release-notes-v04',
      returnMode: 'markdown + changelog',
      noticeTitle: { zh: '等待最终校对', en: 'Final proofreading required' },
      noticeDescription: { zh: 'Doc Writer 已完成初稿，Reviewer 正在核对截图与命令。', en: 'Doc Writer completed the draft; Reviewer is checking screenshots and commands.' },
      validation: [
        { zh: '变更列表已按用户价值分组', en: 'Changes grouped by user value' },
        { zh: '安装命令已与当前版本核对', en: 'Install commands checked against current version' },
        { zh: '等待产品 Owner 修改标题', en: 'Waiting for product owner title edit' },
      ],
      logs: [
        { time: '10:12:04', level: 'TASK', tone: 'violet', message: { zh: '导入 v0.4 已完成任务', en: 'Imported completed v0.4 tasks' } },
        { time: '10:12:19', level: 'AGENT', tone: 'sky', message: { zh: '分派给 Doc Writer Agent', en: 'Delegated to Doc Writer Agent' } },
        { time: '10:13:02', level: 'DOCS', tone: 'emerald', message: { zh: '生成发布说明结构与变更摘要', en: 'Generated release note outline and change summary' } },
        { time: '10:18:44', level: 'CHECK', tone: 'amber', message: { zh: 'Reviewer 标记 4 处截图需核对', en: 'Reviewer flagged 4 screenshots for checking' } },
        { time: '10:23:11', level: 'REVIEW', tone: 'violet', message: { zh: '等待人类确认最终标题', en: 'Waiting for human approval on final title' } },
      ],
    },
  },
  'project-growth': {
    projectId: 'project-growth',
    repo: 'github.com/wemux-ai/wemux',
    headline: { zh: 'Community Operations · 社区协作', en: 'Community Operations · Community collaboration' },
    description: { zh: '反馈整理、文档检查和协作复盘持续异步推进。', en: 'Feedback triage, documentation checks, and collaboration reviews keep moving asynchronously.' },
    stats: [
      { value: '7', label: { zh: '运营任务', en: 'Ops Tasks' }, tone: 'emerald' },
      { value: '128', label: { zh: '反馈已聚类', en: 'Feedback Clustered' }, tone: 'violet' },
      { value: '36%', label: { zh: '实验覆盖用户', en: 'Experiment Reach' }, tone: 'sky' },
      { value: '1', label: { zh: '发布阻塞项', en: 'Launch Blocker' }, tone: 'amber' },
    ],
    columns: [
      {
        title: { zh: 'Backlog', en: 'Backlog' },
        tone: 'sky',
        tasks: [
          {
            title: { zh: '聚类上周用户反馈', en: 'Cluster last week user feedback' },
            description: { zh: '把客服、社群和表单反馈合并成主题与优先级。', en: 'Merge support, community, and form feedback into themes and priorities.' },
            agent: 'Researcher',
            status: 'READY',
            statusTone: 'zinc',
            priority: { zh: '高', en: 'HIGH' },
            priorityTone: 'rose',
            node: 'Cloud VM',
            assignee: 'RX',
            updated: { zh: '刚刚', en: 'now' },
          },
          {
            title: { zh: '准备文档改进假设', en: 'Prepare documentation improvement hypothesis' },
            description: { zh: '梳理目标指标、样本门槛和失败条件。', en: 'Define target metrics, sample threshold, and stop conditions.' },
            agent: 'Operator',
            status: 'QUEUED',
            statusTone: 'zinc',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Office PC',
            assignee: 'OP',
            updated: { zh: '14 分钟前', en: '14m ago' },
          },
        ],
      },
      {
        title: { zh: 'Running', en: 'Running' },
        tone: 'amber',
        tasks: [
          {
            title: { zh: '检查发布说明', en: 'Check release notes' },
            description: { zh: '核对埋点、公告、客服话术和回滚预案。', en: 'Check tracking, announcement, support scripts, and rollback plan.' },
            agent: 'Operator',
            status: '76%',
            statusTone: 'emerald',
            priority: { zh: '高', en: 'HIGH' },
            priorityTone: 'rose',
            node: 'Home Server',
            assignee: 'OP',
            updated: { zh: '4 分钟前', en: '4m ago' },
          },
          {
            title: { zh: '整理用户反馈', en: 'Organize user feedback' },
            description: { zh: '按主题、影响和下一步动作生成跟进列表。', en: 'Create follow-up lists by theme, impact, and next action.' },
            agent: 'Researcher',
            status: '33%',
            statusTone: 'emerald',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'Cloud VM',
            assignee: 'RX',
            updated: { zh: '11 分钟前', en: '11m ago' },
          },
        ],
      },
      {
        title: { zh: 'Approval', en: 'Approval' },
        tone: 'violet',
        tasks: [
          {
            title: { zh: '确认首封邮件文案', en: 'Approve first-touch email copy' },
            description: { zh: '等待人类确认语气、CTA 和发送人。', en: 'Waiting for human approval on tone, CTA, and sender.' },
            agent: 'Reviewer',
            status: 'COPY',
            statusTone: 'amber',
            priority: { zh: '中', en: 'MED' },
            priorityTone: 'sky',
            node: 'MacBook',
            assignee: 'RV',
            updated: { zh: '28 分钟前', en: '28m ago' },
          },
        ],
      },
      {
        title: { zh: 'Done', en: 'Done' },
        tone: 'emerald',
        tasks: [
          {
            title: { zh: '复盘邀请制转化数据', en: 'Review invite conversion data' },
            description: { zh: '转化漏斗、结论和下一轮动作已同步。', en: 'Funnel, findings, and next actions are synced.' },
            agent: 'Operator',
            status: 'DONE',
            statusTone: 'emerald',
            priority: { zh: '低', en: 'LOW' },
            priorityTone: 'zinc',
            node: 'Office PC',
            assignee: 'OP',
            updated: { zh: '今天', en: 'today' },
          },
        ],
      },
    ],
    inspector: {
      title: { zh: '检查发布说明', en: 'Check release notes' },
      status: '76%',
      statusTone: 'amber',
      agent: 'Operator',
      node: 'Home Server · 192.168.1.88',
      workspace: 'launch-readiness',
      returnMode: 'checklist + blockers',
      noticeTitle: { zh: '发现 1 个阻塞项', en: '1 blocker found' },
      noticeDescription: { zh: 'Operator 已完成大部分检查，埋点事件命名仍需人工确认。', en: 'Operator completed most checks; tracking event naming still needs human confirmation.' },
      validation: [
        { zh: '公告、客服话术与回滚预案已确认', en: 'Announcement, support script, and rollback plan confirmed' },
        { zh: '验证结果已记录', en: 'Validation results recorded' },
        { zh: '等待确认文档内容', en: 'Waiting to confirm documentation content' },
      ],
      logs: [
        { time: '15:06:21', level: 'TASK', tone: 'violet', message: { zh: '导入发布说明模板', en: 'Imported release notes template' } },
        { time: '15:06:40', level: 'AGENT', tone: 'sky', message: { zh: '分派给 Operator Agent', en: 'Delegated to Operator Agent' } },
        { time: '15:07:15', level: 'WORKER', tone: 'emerald', message: { zh: '选择在线节点处理协作资料', en: 'Selected an online worker for collaboration files' } },
        { time: '15:12:08', level: 'OPS', tone: 'emerald', message: { zh: '已完成 18/24 个检查项', en: 'Completed 18/24 checklist items' } },
        { time: '15:14:33', level: 'BLOCK', tone: 'amber', message: { zh: '埋点事件命名需要人类确认', en: 'Tracking event naming needs human confirmation' } },
      ],
    },
  },
} satisfies Record<ProjectPreviewViewId, PreviewProjectBoard>

export const previewNodes: PreviewNode[] = [
  { name: 'MacBook-Pro', ip: '192.168.1.24', memory: '18 / 32 GB', cpu: '42%', status: 'online', tone: 'violet' },
  { name: 'Cloud VM', ip: '10.18.0.12', memory: '46 / 64 GB', cpu: '68%', status: 'busy', tone: 'emerald' },
  { name: 'Home Server', ip: '192.168.1.88', memory: '9 / 16 GB', cpu: '21%', status: 'private', tone: 'sky' },
]

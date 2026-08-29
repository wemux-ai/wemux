import { normalizeAgentConfig } from '@shared/agent-config'
import { DEFAULT_WORKSPACE_ROOT } from '@shared/workspace-paths'
import { advanceTask, buildAssistantReply, createAdapters, createExecutionCenter, createTaskFromRequirement } from '@shared/task-orchestrator'
import type { AppState, ChatMessage, ClusterNode, DistributedTask, MainChatSession, Project, ProjectBinding, Task } from '@shared/types'

const now = new Date().toISOString()

const projectId = 'project-alpha'

const demoConfig = normalizeAgentConfig({
  opencodeCommand: '/Users/x/.opencode/bin/opencode acp',
  opencodeConfigContent: '',
  codexAuthContent: '',
  heartbeatSeconds: 15,
  maxRetries: 3,
  autoCleanupWorktree: false,
  defaultModel: '',
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
})

const projects: Project[] = [
  {
    id: projectId,
    name: 'wemux Core',
    gitUrl: 'git@github.com:demo/vibemux-core.git',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'project-beta',
    name: 'Agent Sandbox',
    gitUrl: 'git@github.com:demo/agent-sandbox.git',
    createdAt: now,
    updatedAt: now,
  },
]

const seedPendingTask = createTaskFromRequirement(projects[0], '支持填写项目名称、Git 仓库地址和本地路径。', 'medium', undefined, undefined, undefined, undefined, undefined, demoConfig)
const seedProgressTask = advanceTask(createTaskFromRequirement(projects[0], '为每个任务生成独立 worktree 与 feature 分支。', 'hard', undefined, undefined, undefined, undefined, undefined, demoConfig), demoConfig)
const seedReviewTask = advanceTask(advanceTask(createTaskFromRequirement(projects[0], '检查代码变更、运行测试并记录校验日志。', 'hard', undefined, undefined, undefined, undefined, undefined, demoConfig), demoConfig), demoConfig)
const seedDoneTask = advanceTask(advanceTask(advanceTask(createTaskFromRequirement(projects[0], '让用户通过自然语言快速创建任务。', 'medium', undefined, undefined, undefined, undefined, undefined, demoConfig), demoConfig), demoConfig), demoConfig)

const tasks: Task[] = [seedPendingTask, seedProgressTask, seedReviewTask, seedDoneTask]

const messages: ChatMessage[] = [
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '我是 Agent 体系入口。告诉我需求，我会帮你拆解任务、选择合适的 Agent，并把任务推进到待确认。',
    createdAt: now,
  },
  buildAssistantReply(seedProgressTask),
]

const mainChatSessionId = crypto.randomUUID()

const mainChatSessions: MainChatSession[] = [
  {
    id: mainChatSessionId,
    title: '默认会话',
    executorId: undefined,
    executionModel: undefined,
    messages,
    createdAt: now,
    updatedAt: now,
  },
]

export const initialServerState: AppState = {
  projects,
  tasks,
  nodes: [] as ClusterNode[],
  projectBindings: [] as ProjectBinding[],
  distributedTasks: [] as DistributedTask[],
  taskWorkspaceBindings: [],
  workspaceSessions: [],
  mainChatSessions,
  selectedMainChatSessionId: mainChatSessionId,
  selectedProjectId: projectId,
  selectedTaskId: tasks[1].id,
  filters: {
    status: 'all',
    agent: 'all',
  },
  config: {
    ...demoConfig,
  },
  adapters: createAdapters(),
  executionCenter: createExecutionCenter(tasks),
}

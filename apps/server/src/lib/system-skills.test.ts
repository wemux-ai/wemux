import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendRequiredPrimaryAgentSystemSkills,
  getSystemSkillDefinitions,
  WEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG,
  WEMUX_DESKTOP_SANDBOX_SYSTEM_SKILL_SLUG,
  WEMUX_DRIVE_WRITEBACK_SYSTEM_SKILL_SLUG,
  WEMUX_MEMORY_SYSTEM_SKILL_SLUG,
  WEMUX_TEST_AGENT_SYSTEM_SKILL_SLUG,
  WEMUX_YML_SYSTEM_SKILL_SLUG,
} from './system-skills'

test('system skills include the mandatory wemux Agent collaboration protocol', () => {
  const skills = getSystemSkillDefinitions()
  const collaborationSkill = skills.find((skill) => skill.slug === WEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG)

  if (!collaborationSkill) {
    assert.fail('expected built-in Wemux Agent collaboration skill to exist')
  }

  assert.equal(collaborationSkill.sourceLocator.startsWith('builtin://'), true)
  assert.equal(collaborationSkill.markdown.includes('所有 wemux Agent 的强制协作协议'), true)
  assert.equal(collaborationSkill.markdown.includes('task.execute(taskId, workspaceId'), true)
  assert.equal(collaborationSkill.markdown.includes('必须且只能调用一次 `task.delivery.report`'), true)
  assert.equal(collaborationSkill.markdown.includes('自动把 `task.comment.add` 和 `task.delivery.report` 挂回原评论线程'), true)
  assert.equal(collaborationSkill.markdown.includes('群聊不是 Squad'), true)
  assert.equal(collaborationSkill.markdown.includes('优先处理刚收到的新任务事件'), true)
  assert.equal(collaborationSkill.markdown.includes('`createdBy.type=agent`'), true)
  assert.equal(collaborationSkill.markdown.includes('如果当前是普通 Main Chat、Direct Chat、Group Chat 或外部渠道消息，先用 `task.create` 创建 Task'), true)
  assert.equal(collaborationSkill.markdown.includes('只有用户在当前消息中明确要求“直接创建工作区”时，才允许跳过 Task 创建'), true)
  assert.equal(collaborationSkill.markdown.includes('优先走 Task + Workspace Session'), true)
  assert.equal(collaborationSkill.markdown.includes('可以直接在当前 Agent 的默认工作目录完成'), true)
  assert.equal(collaborationSkill.markdown.includes('实际文件修改和命令执行只能发生在 Workspace Session'), false)
  assert.equal(collaborationSkill.markdown.includes('用 `workspace.create` 新建'), true)
  assert.equal(collaborationSkill.markdown.includes('`attention.waitFor`'), true)
  assert.equal(collaborationSkill.markdown.includes('Context Capsule 只是领取时的服务端快照'), true)
  assert.equal(collaborationSkill.markdown.includes('一次 Attention 只产生一次最终回复或交付动作'), true)
  assert.equal(collaborationSkill.markdown.includes('`delegatedPrompt` 是你自行撰写给 Coding Agent 的自由文本执行指令'), true)
  assert.equal(collaborationSkill.markdown.includes('不要添加自己的身份前缀、任务 ID 或本地路径'), true)
  assert.equal(collaborationSkill.markdown.includes('一个 Task 只由一个负责 Agent 执行'), true)
  assert.equal(collaborationSkill.markdown.includes('把候选 Agent 列给用户，问清指派给谁'), true)
  assert.equal(collaborationSkill.markdown.includes('task.assign(taskId, assigneeAgentId, handoffPrompt?, startMode?)'), true)
  assert.equal(collaborationSkill.markdown.includes('避免一个任务两个 Agent 并行'), true)
  assert.equal(collaborationSkill.markdown.includes('只有当前 Agent 是该任务的负责人时，才继续下面的工作区与执行步骤'), true)
  assert.equal(collaborationSkill.markdown.includes('## 云盘文件（Drive）'), true)
  assert.equal(collaborationSkill.markdown.includes('drive.write_file'), true)
  assert.equal(collaborationSkill.markdown.includes('组织文件要求你是该组织成员，个人文件只限本人'), true)
  assert.equal(collaborationSkill.files['references/mcp-tools-full.md'].content.includes('`task.assign`'), true)
  assert.equal(collaborationSkill.files['references/mcp-tools-full.md'].content.includes('vibemux__task_delivery_report'), true)
  assert.equal(collaborationSkill.files['references/mcp-tools-full.md'].content.includes('`delegatedPrompt` 不会被控制面改写成固定模板'), true)
  assert.equal(collaborationSkill.files['references/mcp-tools-full.md'].content.includes('## 云盘文件（Drive）'), true)
  assert.equal(collaborationSkill.files['references/mcp-tools-full.md'].content.includes('`drive.list_files`'), true)
  assert.equal(collaborationSkill.files['references/mcp-tools-full.md'].content.includes('`drive.write_file`'), true)
})

test('system skills include the built-in wemux YML writer package', () => {
  const skills = getSystemSkillDefinitions()
  const vibemuxYmlSkill = skills.find((skill) => skill.slug === WEMUX_YML_SYSTEM_SKILL_SLUG)

  if (!vibemuxYmlSkill) {
    assert.fail('expected built-in wemux YML skill to exist')
  }

  assert.equal(vibemuxYmlSkill.sourceLocator.startsWith('builtin://'), true)
  assert.equal(vibemuxYmlSkill.markdown.includes('.vibemux.yml'), true)
  assert.equal(vibemuxYmlSkill.markdown.includes('Ports must be dynamic per-worktree expressions'), true)
  assert.equal(vibemuxYmlSkill.markdown.includes('never literal numbers'), true)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('`appPort` is the primary app port'), true)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('{{add worktree.unique_id BASE_PORT}}'), true)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('build: "..."'), false)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('test: "..."'), false)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('lint: "..."'), false)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('branch: "..."'), false)
  assert.equal(vibemuxYmlSkill.files['references/schema.md'].content.includes('nuke: "..."'), false)
  assert.equal(vibemuxYmlSkill.files['references/examples.md'].content.includes('docker compose'), true)
  assert.equal(vibemuxYmlSkill.files['references/examples.md'].content.includes('pnpm build'), false)
  assert.equal(vibemuxYmlSkill.files['references/examples.md'].content.includes('pnpm test'), false)
  assert.equal(vibemuxYmlSkill.files['references/examples.md'].content.includes('pnpm lint'), false)
  assert.equal(vibemuxYmlSkill.files['references/examples.md'].content.includes('npm run build'), false)
  assert.equal(vibemuxYmlSkill.files['references/examples.md'].content.includes('npm run lint'), false)
})

test('system skills include the built-in Desktop Sandbox package', () => {
  const skills = getSystemSkillDefinitions()
  const desktopSandboxSkill = skills.find((skill) => skill.slug === WEMUX_DESKTOP_SANDBOX_SYSTEM_SKILL_SLUG)

  if (!desktopSandboxSkill) {
    assert.fail('expected built-in Desktop Sandbox skill to exist')
  }

  assert.equal(desktopSandboxSkill.sourceLocator.startsWith('builtin://'), true)
  assert.equal(desktopSandboxSkill.markdown.includes('Desktop Sandbox is a separate environment'), true)
  assert.equal(desktopSandboxSkill.files['references/commands.md'].content.includes('desktop-sandbox status'), true)
})

test('system skills include the built-in Test Agent package', () => {
  const skills = getSystemSkillDefinitions()
  const testAgentSkill = skills.find((skill) => skill.slug === WEMUX_TEST_AGENT_SYSTEM_SKILL_SLUG)

  if (!testAgentSkill) {
    assert.fail('expected built-in Test Agent skill to exist')
  }

  assert.equal(testAgentSkill.sourceLocator.startsWith('builtin://'), true)
  assert.equal(testAgentSkill.markdown.includes('Desktop Sandbox'), true)
  assert.equal(testAgentSkill.markdown.includes('/home/desktop/workspace'), true)
  assert.equal(testAgentSkill.files['references/commands.md'].content.includes('npm install'), true)
})

test('primary agent config appends required system skills without duplicates', () => {
  const appended = appendRequiredPrimaryAgentSystemSkills({
    skills: ['existing-skill'],
  })
  const appendedAgain = appendRequiredPrimaryAgentSystemSkills(appended)

  assert.deepEqual((appended.skills as Array<{ slug?: string } | string>).map((skill) => (
    typeof skill === 'string' ? skill : skill.slug
  )), ['existing-skill', WEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG, WEMUX_YML_SYSTEM_SKILL_SLUG, WEMUX_DESKTOP_SANDBOX_SYSTEM_SKILL_SLUG, WEMUX_TEST_AGENT_SYSTEM_SKILL_SLUG, WEMUX_DRIVE_WRITEBACK_SYSTEM_SKILL_SLUG, WEMUX_MEMORY_SYSTEM_SKILL_SLUG])
  assert.equal((appendedAgain.skills as unknown[]).length, 7)
})

test('system skills include the Drive writeback package', () => {
  const skills = getSystemSkillDefinitions()
  const writebackSkill = skills.find((skill) => skill.slug === WEMUX_DRIVE_WRITEBACK_SYSTEM_SKILL_SLUG)

  if (!writebackSkill) {
    assert.fail('expected built-in Drive writeback skill to exist')
  }

  assert.equal(writebackSkill.markdown.includes('drive.write_file'), true)
  assert.equal(writebackSkill.markdown.includes('直接覆盖'), true)
  assert.equal(writebackSkill.markdown.includes('不保留版本历史'), true)
  assert.equal(writebackSkill.files['SKILL.md'].content.includes('fileId'), true)
})

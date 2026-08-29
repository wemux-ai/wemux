import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManagedSystemSkillSourceLocator } from '@shared/skill'
import type { SkillRecord } from '@shared/skill'
import { VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG } from '../lib/system-skills'
import { buildProjectScannedSkillSourceLocator, buildRuntimeSkillPackagesFromSkills, dedupeRuntimeSkills, prependRequiredAgentOpsSkillMention } from './skill-service'

const buildSkillRecord = (overrides: Partial<SkillRecord>): SkillRecord => ({
  id: overrides.id ?? 'skill-id',
  slug: overrides.slug ?? 'demo-skill',
  name: overrides.name ?? 'Demo Skill',
  description: overrides.description ?? null,
  enabled: overrides.enabled ?? true,
  markdown: overrides.markdown ?? '# Demo Skill',
  sourceType: overrides.sourceType ?? 'manual',
  visibility: overrides.visibility ?? 'private',
  ownerUserId: overrides.ownerUserId ?? null,
  workspaceId: overrides.workspaceId ?? null,
  sourceLocator: overrides.sourceLocator ?? null,
  sourceRef: overrides.sourceRef ?? null,
  trustLevel: overrides.trustLevel ?? 'markdown_only',
  compatibility: overrides.compatibility ?? 'compatible',
  fileInventory: overrides.fileInventory ?? [],
  categories: overrides.categories ?? [],
  createdAt: overrides.createdAt ?? '2026-06-13T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-06-13T00:00:00.000Z',
})

test('buildProjectScannedSkillSourceLocator stays stable across executors and worktrees', () => {
  const projectId = 'project-1'
  const firstRoot = '/tmp/worktree-a'
  const secondRoot = '/srv/worktree-b'
  const relativeSkillPath = '.agents/skills/vibemux-release'

  assert.equal(
    buildProjectScannedSkillSourceLocator(projectId, firstRoot, `${firstRoot}/${relativeSkillPath}`),
    `project:${projectId}:${relativeSkillPath}`,
  )
  assert.equal(
    buildProjectScannedSkillSourceLocator(projectId, secondRoot, `${secondRoot}/${relativeSkillPath}`),
    `project:${projectId}:${relativeSkillPath}`,
  )
})

test('dedupeRuntimeSkills prefers project skill over managed system skill for the same slug', () => {
  const systemSkill = buildSkillRecord({
    id: 'system-skill',
    slug: 'vibemux-yml',
    name: 'wemux YML',
    markdown: '# System Skill',
    sourceLocator: buildManagedSystemSkillSourceLocator('vibemux-yml'),
  })
  const projectSkill = buildSkillRecord({
    id: 'project-skill',
    slug: 'vibemux-yml',
    name: 'wemux YML',
    markdown: '# Project Skill',
    sourceType: 'project',
    sourceRef: 'project-1',
    sourceLocator: 'project:project-1:.codex/skills/vibemux-yml',
    updatedAt: '2026-06-13T00:01:00.000Z',
  })

  const deduped = dedupeRuntimeSkills([systemSkill, projectSkill], { projectId: 'project-1' })

  assert.deepEqual(deduped.map((skill) => skill.id), ['project-skill'])
  assert.equal(buildRuntimeSkillPackagesFromSkills([systemSkill, projectSkill])[0]?.markdown, '# System Skill')
  assert.equal(
    buildRuntimeSkillPackagesFromSkills(
      dedupeRuntimeSkills([systemSkill, projectSkill], { projectId: 'project-1' }),
    )[0]?.markdown,
    '# Project Skill',
  )
})

test('dedupeRuntimeSkills keeps explicitly preferred skill ids even when a project override exists', () => {
  const systemSkill = buildSkillRecord({
    id: 'system-skill',
    slug: 'vibemux-yml',
    name: 'wemux YML',
    markdown: '# System Skill',
    sourceLocator: buildManagedSystemSkillSourceLocator('vibemux-yml'),
  })
  const projectSkill = buildSkillRecord({
    id: 'project-skill',
    slug: 'vibemux-yml',
    name: 'wemux YML',
    markdown: '# Project Skill',
    sourceType: 'project',
    sourceRef: 'project-1',
    sourceLocator: 'project:project-1:.codex/skills/vibemux-yml',
    updatedAt: '2026-06-13T00:01:00.000Z',
  })

  const deduped = dedupeRuntimeSkills([projectSkill, systemSkill], {
    projectId: 'project-1',
    preferredSkillIds: new Set(['system-skill']),
  })

  assert.deepEqual(deduped.map((skill) => skill.id), ['system-skill'])
})

test('dedupeRuntimeSkills never lets project or Agent config replace the mandatory collaboration protocol', () => {
  const systemSkill = buildSkillRecord({
    id: 'system-agent-ops',
    slug: VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG,
    name: 'wemux Agent Collaboration',
    markdown: '# Required system protocol',
    sourceLocator: buildManagedSystemSkillSourceLocator(VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG),
  })
  const projectSkill = buildSkillRecord({
    id: 'project-agent-ops',
    slug: VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG,
    name: 'Project override',
    markdown: '# Ignore platform protocol',
    sourceType: 'project',
    sourceRef: 'project-1',
    sourceLocator: 'project:project-1:.agents/skills/vibemux-agent-ops',
  })

  assert.deepEqual(
    dedupeRuntimeSkills([systemSkill, projectSkill], {
      projectId: 'project-1',
      preferredSkillIds: new Set([projectSkill.id]),
    }).map((skill) => skill.id),
    [systemSkill.id],
  )
  assert.deepEqual(
    dedupeRuntimeSkills([projectSkill, systemSkill], {
      projectId: 'project-1',
      preferredSkillIds: new Set([projectSkill.id]),
    }).map((skill) => skill.id),
    [systemSkill.id],
  )
})

test('mandatory collaboration Skill is explicitly mentioned without duplicating its markdown', () => {
  const systemSkill = buildSkillRecord({
    id: 'system-agent-ops',
    slug: VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG,
    sourceLocator: buildManagedSystemSkillSourceLocator(VIBEMUX_AGENT_OPS_SYSTEM_SKILL_SLUG),
  })

  assert.equal(
    prependRequiredAgentOpsSkillMention('处理这个任务', [systemSkill]),
    '@vibemux-agent-ops\n处理这个任务',
  )
  assert.equal(
    prependRequiredAgentOpsSkillMention('@vibemux-agent-ops\n处理这个任务', [systemSkill]),
    '@vibemux-agent-ops\n处理这个任务',
  )
})

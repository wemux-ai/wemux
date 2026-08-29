import assert from 'node:assert/strict'
import test from 'node:test'
import type { SkillRecord } from './skill'
import {
  buildManagedSystemSkillSourceLocator,
  buildMessageWithSkillMentions,
  filterEnabledSkills,
  isManagedSystemSkill,
} from './skill'

const createSkill = (overrides?: Partial<SkillRecord>): SkillRecord => ({
  id: 'skill-1',
  slug: 'demo-skill',
  name: 'Demo Skill',
  description: null,
  enabled: true,
  markdown: '# Demo Skill\n',
  sourceType: 'manual',
  visibility: 'private',
  ownerUserId: null,
  workspaceId: null,
  sourceLocator: null,
  sourceRef: null,
  trustLevel: 'markdown_only',
  compatibility: 'compatible',
  fileInventory: [],
  categories: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

test('buildMessageWithSkillMentions preserves the raw user message for runtime skill handling', () => {
  const message = buildMessageWithSkillMentions('  请按 @demo-skill 处理这个问题  ', [
    createSkill(),
  ])

  assert.equal(message, '请按 @demo-skill 处理这个问题')
})

test('filterEnabledSkills keeps legacy skills enabled by default and removes explicit disables', () => {
  const filtered = filterEnabledSkills([
    { id: 'enabled', enabled: true },
    { id: 'legacy' },
    { id: 'disabled', enabled: false },
  ])

  assert.deepEqual(filtered.map((skill) => skill.id), ['enabled', 'legacy'])
})

test('managed system skills are detected from builtin source locators', () => {
  const managedSkill = createSkill({
    sourceLocator: buildManagedSystemSkillSourceLocator('vibemux-yml'),
  })
  const regularSkill = createSkill({
    sourceLocator: 'https://example.com/skill',
  })

  assert.equal(isManagedSystemSkill(managedSkill), true)
  assert.equal(isManagedSystemSkill(regularSkill), false)
})

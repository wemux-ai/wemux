import type { SkillRecord } from '@shared/skill'

export { buildMessageWithSkillMentions, getMentionedSkills } from '@shared/skill'

const escapeRegExp = (value: string) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const insertSkillMentionToken = (value: string, skill: SkillRecord) => {
  const token = `@${skill.slug}`
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`, 'i')
  if (pattern.test(value)) {
    return value
  }

  const separator = value && !/\s$/.test(value) ? ' ' : ''
  return `${value}${separator}${token} `
}

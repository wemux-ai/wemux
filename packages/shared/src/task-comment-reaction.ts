/**
 * [INPUT]: Product-approved task comment reaction choices.
 * [OUTPUT]: Stable reaction emoji values and labels shared by web and server validation.
 * [POS]: Pure shared comment-reaction contract with no runtime side effects.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export const TASK_COMMENT_REACTION_EMOJIS = ['👍', '👀', '❤️', '🎉', '😄'] as const

export const TASK_COMMENT_REACTION_OPTIONS = [
  { emoji: '👍', label: '赞同' },
  { emoji: '👀', label: '关注' },
  { emoji: '❤️', label: '喜欢' },
  { emoji: '🎉', label: '庆祝' },
  { emoji: '😄', label: '开心' },
] as const

export type TaskCommentReactionEmoji = typeof TASK_COMMENT_REACTION_EMOJIS[number]

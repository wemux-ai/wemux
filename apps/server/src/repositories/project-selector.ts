import { getUserProjectIds } from '../repositories/auth'
import type { Project } from '@shared/types'
import { loadState } from '../storage/app-state-store'

export type ProjectWithContext = {
  id: string
  name: string
  gitUrl: string
  taskCount: number
  recentTaskTitles: string[]
}

export const getProjectsWithContext = (userId?: string): ProjectWithContext[] => {
  const state = loadState()
  const allowedProjectIds = userId ? new Set(getUserProjectIds(userId)) : null
  const projects = allowedProjectIds
    ? state.projects.filter((project) => allowedProjectIds.has(project.id))
    : state.projects

  return projects.map((project) => {
    const tasks = state.tasks
      .filter((task) => task.projectId === project.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    return {
      id: project.id,
      name: project.name,
      gitUrl: project.gitUrl,
      taskCount: tasks.length,
      recentTaskTitles: tasks.slice(0, 5).map((task) => task.title),
    }
  })
}

export const findBestProject = (requirement: string, projects: ProjectWithContext[]): ProjectWithContext | null => {
  const req = requirement.toLowerCase()

  const keywordMatches = projects.map((p) => {
    let score = 0
    const name = p.name.toLowerCase()
    const git = p.gitUrl.toLowerCase()

    if (req.includes(name) || name.includes(req)) {
      score += 10
    }

    const keywords = req.split(/\s+/).filter((k) => k.length > 2)
    for (const kw of keywords) {
      if (name.includes(kw) || git.includes(kw)) {
        score += 3
      }
      for (const title of p.recentTaskTitles) {
        if (title.toLowerCase().includes(kw)) {
          score += 2
        }
      }
    }

    if (p.taskCount > 0) {
      score += 1
    }

    return { project: p, score }
  })

  keywordMatches.sort((a, b) => b.score - a.score)

  if (keywordMatches[0]?.score ?? 0 > 0) {
    return keywordMatches[0].project
  }

  if (projects.length === 1) {
    return projects[0]
  }

  return null
}

export const generateProjectContext = (projects: ProjectWithContext[]): string => {
  if (projects.length === 0) {
    return '暂无项目'
  }

  return projects
    .map(
      (p, i) =>
        `${i + 1}. ${p.name}
   - Git: ${p.gitUrl || '未设置'}
   - 已有 ${p.taskCount} 个任务
   ${
     p.recentTaskTitles.length > 0
       ? `- 最近任务: ${p.recentTaskTitles.join(', ')}`
       : ''
   }`,
    )
    .join('\n\n')
}

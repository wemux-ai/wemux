import { eq } from 'drizzle-orm'

import type { ProjectEnvironmentTemplate } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { workspaceEnvironmentTemplateConfigs } from './schema'

export const initWorkspaceEnvironmentTemplateStore = async () => {
  await ensurePostgresReady()
}

export const getWorkspaceEnvironmentTemplateConfig = async (workspaceId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ templateJson: workspaceEnvironmentTemplateConfigs.templateJson })
    .from(workspaceEnvironmentTemplateConfigs)
    .where(eq(workspaceEnvironmentTemplateConfigs.workspaceId, workspaceId))
    .limit(1)

  return rows[0]?.templateJson ?? null
}

export const setWorkspaceEnvironmentTemplateConfig = async (workspaceId: string, template: ProjectEnvironmentTemplate) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(workspaceEnvironmentTemplateConfigs)
    .values({
      workspaceId,
      templateJson: template,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceEnvironmentTemplateConfigs.workspaceId,
      set: {
        templateJson: template,
        updatedAt: now,
      },
    })
}

export const deleteWorkspaceEnvironmentTemplateConfig = async (workspaceId: string) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .delete(workspaceEnvironmentTemplateConfigs)
    .where(eq(workspaceEnvironmentTemplateConfigs.workspaceId, workspaceId))
}

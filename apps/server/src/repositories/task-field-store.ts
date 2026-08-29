/**
 * [INPUT]: 项目级自定义字段定义 CRUD 与任务字段值读写请求。
 * [OUTPUT]: task_custom_field_definitions / task_custom_field_values 表的读写。
 * [POS]: 项目级任务自定义字段存储层（R8.5 v2 定稿，参考 Linear）；字段模型预留多维表格（feature）衔接。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { taskCustomFieldDefinitions, taskCustomFieldValues } from '../storage/postgres/schema-core'

export type TaskCustomFieldType = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'user' | 'duration' | 'checkbox' | 'url'

export type TaskCustomFieldOption = { label: string; value: string; color?: string }

export type TaskCustomFieldDefinition = {
  id: string
  projectId: string
  name: string
  key: string
  type: TaskCustomFieldType
  options: TaskCustomFieldOption[]
  required: boolean
  defaultJson?: unknown
  displayOrder: number
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

const mapDefinitionRow = (row: typeof taskCustomFieldDefinitions.$inferSelect): TaskCustomFieldDefinition => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  key: row.key,
  type: row.type as TaskCustomFieldType,
  options: row.optionsJson,
  required: row.required,
  ...(row.defaultJson === null ? {} : { defaultJson: row.defaultJson }),
  displayOrder: row.displayOrder,
  ...(row.archivedAt === null ? {} : { archivedAt: row.archivedAt }),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const nowIso = () => new Date().toISOString()

export const listTaskFieldDefinitions = async (projectId: string, includeArchived = false): Promise<TaskCustomFieldDefinition[]> => {
  const conditions = includeArchived
    ? [eq(taskCustomFieldDefinitions.projectId, projectId)]
    : [
        eq(taskCustomFieldDefinitions.projectId, projectId),
        isNull(taskCustomFieldDefinitions.archivedAt),
      ]
  const rows = await getDrizzleDb()
    .select()
    .from(taskCustomFieldDefinitions)
    .where(and(...conditions))
    .orderBy(asc(taskCustomFieldDefinitions.displayOrder), asc(taskCustomFieldDefinitions.createdAt))
  return rows.map(mapDefinitionRow)
}

export type CreateTaskFieldDefinitionInput = {
  projectId: string
  name: string
  key: string
  type: TaskCustomFieldType
  options?: TaskCustomFieldOption[]
  required?: boolean
  defaultJson?: unknown
  displayOrder?: number
}

export const createTaskFieldDefinition = async (input: CreateTaskFieldDefinitionInput): Promise<TaskCustomFieldDefinition> => {
  const now = nowIso()
  const row = {
    id: randomUUID(),
    projectId: input.projectId,
    name: input.name.trim(),
    key: input.key.trim(),
    type: input.type,
    optionsJson: input.options ?? [],
    required: input.required ?? false,
    defaultJson: input.defaultJson ?? null,
    displayOrder: input.displayOrder ?? 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await getDrizzleDb().insert(taskCustomFieldDefinitions).values(row)
  return mapDefinitionRow(row as typeof taskCustomFieldDefinitions.$inferSelect)
}

export const updateTaskFieldDefinition = async (params: {
  fieldId: string
  name?: string
  options?: TaskCustomFieldOption[]
  required?: boolean
  defaultJson?: unknown
  displayOrder?: number
}): Promise<TaskCustomFieldDefinition | null> => {
  const rows = await getDrizzleDb()
    .update(taskCustomFieldDefinitions)
    .set({
      ...(params.name === undefined ? {} : { name: params.name.trim() }),
      ...(params.options === undefined ? {} : { optionsJson: params.options }),
      ...(params.required === undefined ? {} : { required: params.required }),
      ...(params.defaultJson === undefined ? {} : { defaultJson: params.defaultJson }),
      ...(params.displayOrder === undefined ? {} : { displayOrder: params.displayOrder }),
      updatedAt: nowIso(),
    })
    .where(eq(taskCustomFieldDefinitions.id, params.fieldId))
    .returning()
  return rows[0] ? mapDefinitionRow(rows[0]) : null
}

/** 归档字段（软删）：保留历史值。 */
export const archiveTaskFieldDefinition = async (fieldId: string): Promise<void> => {
  await getDrizzleDb()
    .update(taskCustomFieldDefinitions)
    .set({ archivedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(taskCustomFieldDefinitions.id, fieldId))
}

export const getTaskCustomFieldValue = async (taskId: string, fieldId: string): Promise<unknown | undefined> => {
  const rows = await getDrizzleDb()
    .select({ valueJson: taskCustomFieldValues.valueJson })
    .from(taskCustomFieldValues)
    .where(and(eq(taskCustomFieldValues.taskId, taskId), eq(taskCustomFieldValues.fieldId, fieldId)))
    .limit(1)
  return rows[0]?.valueJson
}

export type TaskCustomFieldValuesMap = Record<string, unknown>

/** 批量读某任务的全部字段值（fieldId → value）。 */
export const listTaskCustomFieldValues = async (taskId: string): Promise<TaskCustomFieldValuesMap> => {
  const rows = await getDrizzleDb()
    .select()
    .from(taskCustomFieldValues)
    .where(eq(taskCustomFieldValues.taskId, taskId))
  return rows.reduce<TaskCustomFieldValuesMap>((result, row) => {
    result[row.fieldId] = row.valueJson
    return result
  }, {})
}

/** 批量写入任务字段值（仅写入传入字段；返回更新后的全量值）。 */
export const upsertTaskCustomFieldValues = async (params: {
  taskId: string
  values: TaskCustomFieldValuesMap
}): Promise<TaskCustomFieldValuesMap> => {
  const now = nowIso()
  const db = getDrizzleDb()
  for (const [fieldId, value] of Object.entries(params.values)) {
    await db
      .insert(taskCustomFieldValues)
      .values({ taskId: params.taskId, fieldId, valueJson: value, updatedAt: now })
      .onConflictDoUpdate({
        target: [taskCustomFieldValues.taskId, taskCustomFieldValues.fieldId],
        set: { valueJson: value, updatedAt: now },
      })
  }
  return listTaskCustomFieldValues(params.taskId)
}

/** key → fieldId 解析（纯函数，便于单测）；未知 key 通过 unknownKeys 返回。 */
export const resolveTaskFieldIdsByKey = (
  definitions: ReadonlyArray<Pick<TaskCustomFieldDefinition, 'id' | 'key'>>,
  keys: ReadonlyArray<string>,
): { fieldIdByKey: Record<string, string>; unknownKeys: string[] } => {
  const fieldIdByKey: Record<string, string> = {}
  for (const field of definitions) {
    fieldIdByKey[field.key] = field.id
  }
  const unknownKeys = keys.filter((key) => !(key in fieldIdByKey))
  return { fieldIdByKey, unknownKeys }
}

/** fieldId→value 映射回 key→value（纯函数，便于单测）。 */
export const mapTaskFieldValuesToKeys = (
  definitions: ReadonlyArray<Pick<TaskCustomFieldDefinition, 'id' | 'key'>>,
  valuesByFieldId: TaskCustomFieldValuesMap,
): Record<string, unknown> => {
  const keyByFieldId: Record<string, string> = {}
  for (const field of definitions) {
    keyByFieldId[field.id] = field.key
  }
  return Object.entries(valuesByFieldId).reduce<Record<string, unknown>>((result, [fieldId, value]) => {
    const key = keyByFieldId[fieldId]
    if (key) {
      result[key] = value
    }
    return result
  }, {})
}

/** 批量读某任务的全部字段值并按字段 key 返回（key → value）。 */
export const listTaskCustomFieldValuesByKey = async (
  taskId: string,
  projectId: string,
): Promise<Record<string, unknown>> => {
  const [definitions, valuesByFieldId] = await Promise.all([
    listTaskFieldDefinitions(projectId),
    listTaskCustomFieldValues(taskId),
  ])
  return mapTaskFieldValuesToKeys(definitions, valuesByFieldId)
}

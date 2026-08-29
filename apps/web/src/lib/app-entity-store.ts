import type { AppState } from '@shared/types'

const APP_ENTITY_COLLECTION_KEYS = [
  'projects',
  'tasks',
  'nodes',
  'projectBindings',
  'distributedTasks',
  'taskWorkspaceBindings',
  'workspaceSessions',
  'mainChatSessions',
] as const

type AppEntityCollectionKey = (typeof APP_ENTITY_COLLECTION_KEYS)[number]
type EntityRecord = { id: string }

export class NormalizedEntityCollectionStore<TEntity extends EntityRecord> {
  private readonly entitiesById = new Map<string, TEntity>()

  constructor(private readonly maxSize = 512) {}

  reconcile(entities: TEntity[]) {
    const resolved = entities.map((entity) => {
      const shared = replaceEqualDeep(this.entitiesById.get(entity.id), entity)
      this.entitiesById.delete(entity.id)
      this.entitiesById.set(entity.id, shared)
      return shared
    })

    while (this.entitiesById.size > this.maxSize) {
      const oldestId = this.entitiesById.keys().next().value
      if (!oldestId) {
        break
      }
      this.entitiesById.delete(oldestId)
    }

    return resolved
  }

  get(id: string) {
    return this.entitiesById.get(id)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

export const replaceEqualDeep = <T,>(previous: T | undefined, next: T): T => {
  if (Object.is(previous, next)) {
    return previous as T
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    let equalItems = previous.length === next.length
    const resolved = next.map((item, index) => {
      const shared = replaceEqualDeep(previous[index], item)
      equalItems = equalItems && Object.is(shared, previous[index])
      return shared
    })
    return (equalItems ? previous : resolved) as T
  }

  if (isRecord(previous) && isRecord(next)) {
    // Summarized/list payloads (e.g. main-chat sessions broadcast without `messages`)
    // omit fields the source view doesn't carry — that's not the same as clearing them.
    // Keys present in `previous` but absent from `next` are kept as-is; deliberate
    // clears in this codebase always set the key to `undefined` explicitly instead.
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
    let equalFields = true
    const resolved: Record<string, unknown> = {}

    for (const key of keys) {
      const shared = Object.prototype.hasOwnProperty.call(next, key)
        ? replaceEqualDeep(previous[key], next[key])
        : previous[key]
      resolved[key] = shared
      equalFields = equalFields
        && Object.prototype.hasOwnProperty.call(previous, key)
        && Object.is(shared, previous[key])
    }

    return (equalFields ? previous : resolved) as T
  }

  return next
}

export class AppEntityStore {
  private readonly entitiesByCollection = new Map<AppEntityCollectionKey, Map<string, EntityRecord>>()
  private materializedState: AppState

  constructor(initialState: AppState) {
    this.materializedState = initialState
    this.materializedState = this.reconcile(initialState)
  }

  reconcile(nextState: AppState): AppState {
    let resolvedState = replaceEqualDeep(this.materializedState, nextState)

    for (const collectionKey of APP_ENTITY_COLLECTION_KEYS) {
      const previousEntities = this.entitiesByCollection.get(collectionKey) ?? new Map<string, EntityRecord>()
      const nextEntities = nextState[collectionKey] as EntityRecord[]
      const nextEntityMap = new Map<string, EntityRecord>()
      const resolvedEntities = nextEntities.map((nextEntity) => {
        const resolvedEntity = replaceEqualDeep(previousEntities.get(nextEntity.id), nextEntity)
        nextEntityMap.set(nextEntity.id, resolvedEntity)
        return resolvedEntity
      })
      const previousCollection = this.materializedState[collectionKey] as EntityRecord[]
      const materializedCollection = previousCollection.length === resolvedEntities.length
        && resolvedEntities.every((entity, index) => Object.is(entity, previousCollection[index]))
        ? previousCollection
        : resolvedEntities

      this.entitiesByCollection.set(collectionKey, nextEntityMap)
      if (!Object.is(resolvedState[collectionKey], materializedCollection)) {
        resolvedState = {
          ...resolvedState,
          [collectionKey]: materializedCollection,
        }
      }
    }

    this.materializedState = resolvedState
    return resolvedState
  }

  getEntity<TEntity extends EntityRecord>(collectionKey: AppEntityCollectionKey, id: string) {
    return this.entitiesByCollection.get(collectionKey)?.get(id) as TEntity | undefined
  }
}

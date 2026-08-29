const isNonEmpty = (value: string | undefined) => Boolean(value?.trim())

const isPostgresConfigured = () => {
  return isNonEmpty(process.env.DATABASE_URL) || isNonEmpty(process.env.POSTGRES_URL)
}

export type PrimaryDatabaseMode = 'postgres' | 'unconfigured'

export const getPrimaryDatabaseMode = (): PrimaryDatabaseMode => {
  if (isPostgresConfigured()) {
    return 'postgres'
  }

  return 'unconfigured'
}

export const getPrimaryDatabaseStatus = () => {
  const mode = getPrimaryDatabaseMode()

  if (mode === 'postgres') {
    return {
      ready: true,
      mode,
      message: 'Postgres is configured as the target primary database.',
    }
  }

  return {
    ready: false,
    mode,
    message: 'No primary database configured. Set DATABASE_URL or POSTGRES_URL for Postgres.',
  }
}

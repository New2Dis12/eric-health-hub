import 'server-only'
import pg from 'pg'

export interface Queryable {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>
}
export interface TrainingDatabase {
  transaction<T>(subject: string, work: (tx: Queryable) => Promise<T>): Promise<T>
}

export function connectionOptions(connectionString: string): pg.PoolConfig {
  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  // Strip URL TLS overrides: remote PostgreSQL always verifies its certificate.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl')) url.searchParams.delete(key)
  }
  return { connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000 }
}

let database: TrainingDatabase | undefined
export function getTrainingDatabase(): TrainingDatabase {
  if (database) return database
  if (!process.env.DATABASE_URL) throw new Error('Training database is not configured')
  const pool = new pg.Pool(connectionOptions(process.env.DATABASE_URL))
  // Do not log database connection details, queries or bound health values.
  pool.on('error', () => {})
  database = {
    async transaction<T>(subject: string, work: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { rows } = await client.query(`SELECT rolsuper, rolbypassrls, EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='stunna' AND c.relowner=r.oid) AS owns_training_tables FROM pg_roles r WHERE rolname = current_user`)
        if (rows[0]?.rolsuper !== false || rows[0]?.rolbypassrls !== false || rows[0]?.owns_training_tables !== false) throw new Error('Runtime database role must enforce RLS')
        await client.query("SELECT set_config('stunna.subject', $1, true)", [subject])
        const result = await work(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    },
  }
  return database
}

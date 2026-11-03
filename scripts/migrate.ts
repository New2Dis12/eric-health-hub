import pg from 'pg'
import { connectionOptions } from '../lib/training/database'
import { migrate } from './migrations'

async function main() {
  const direction = process.argv[2]
  if (direction !== 'up' && direction !== 'down') throw new Error('Use db:migrate or db:rollback')
  if (direction === 'down' && process.env.STUNNA_ALLOW_DESTRUCTIVE_ROLLBACK !== 'true') throw new Error('Destructive rollback requires STUNNA_ALLOW_DESTRUCTIVE_ROLLBACK=true')
  if (!process.env.DATABASE_MIGRATION_URL) throw new Error('DATABASE_MIGRATION_URL is required')
  const client = new pg.Client(connectionOptions(process.env.DATABASE_MIGRATION_URL))
  try {
    await client.connect()
    await client.query('BEGIN')
    await migrate(client, direction)
    await client.query('COMMIT')
    console.log('Stunna migration completed')
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    // Never print driver errors: they can contain credentials or record values.
    throw new Error('Migration failed; transaction rolled back. Check configuration and migration state securely.')
  } finally { await client.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

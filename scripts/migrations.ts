import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Queryable } from '../lib/training/database'

const directory = new URL('../db/migrations/', import.meta.url)
export async function migrate(tx: Queryable, direction: 'up' | 'down') {
  await tx.query(`CREATE TABLE IF NOT EXISTS public.stunna_schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
  await tx.query("SELECT pg_advisory_xact_lock(71312190)")
  const files = (await readdir(directory)).filter(f => /^\d{3}_[a-z_]+\.up\.sql$/.test(f)).sort()
  const { rows } = await tx.query<{ version: string; checksum: string }>('SELECT version,checksum FROM public.stunna_schema_migrations ORDER BY version')
  for (const applied of rows) {
    if (!files.includes(applied.version + '.up.sql')) throw new Error('Unknown applied migration')
    const content = await readFile(new URL(applied.version + '.up.sql', directory), 'utf8')
    if (createHash('sha256').update(content).digest('hex') !== applied.checksum) throw new Error('Applied migration checksum mismatch')
  }
  if (direction === 'down') {
    const latest = rows.at(-1)
    if (!latest) return
    await tx.query(await readFile(new URL(latest.version + '.down.sql', directory), 'utf8'))
    await tx.query('DELETE FROM public.stunna_schema_migrations WHERE version=$1', [latest.version])
  } else {
    for (const file of files) {
      const version = file.replace('.up.sql', '')
      if (rows.some(r => r.version === version)) continue
      const content = await readFile(new URL(file, directory), 'utf8')
      await tx.query(content)
      await tx.query('INSERT INTO public.stunna_schema_migrations(version,checksum) VALUES($1,$2)',
        [version, createHash('sha256').update(content).digest('hex')])
    }
  }
}

export const migrationDirectory = fileURLToPath(directory)

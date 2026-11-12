import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const file = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')

test('runtime INSERT privileges are migration-008-gated and revoked on rollback/reapply', async () => {
  const db = new PGlite()
  try {
    for (const n of ['001_foundation', '002_prescriptions', '003_methodology', '004_workout_overviews']) {
      await db.exec(await file('../db/migrations/' + n + '.up.sql'))
    }
    await db.exec('CREATE ROLE stunna_runtime')
    const grants = await file('../db/runtime-grants.sql')
    const check = async () => {
      const { rows } = await db.query<{prescription:boolean; methodology:boolean}>(`
        SELECT has_table_privilege('stunna_runtime','stunna.prescription_revisions','INSERT') AS prescription,
          has_table_privilege('stunna_runtime','stunna.block_context_revisions','INSERT') AS methodology`)
      return rows[0]
    }
    await db.exec(grants)
    assert.deepEqual(await check(), { prescription: false, methodology: false })
    await db.exec(await file('../db/migrations/008_jit_publishing.up.sql'))
    await db.exec(grants)
    assert.deepEqual(await check(), { prescription: true, methodology: true })
    await db.exec(await file('../db/migrations/008_jit_publishing.down.sql'))
    await db.exec(grants)
    assert.deepEqual(await check(), { prescription: false, methodology: false })
  } finally {
    await db.close()
  }
})

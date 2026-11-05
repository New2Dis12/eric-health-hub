import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createTrainingContextReader } from '../lib/training/context'
import type { Queryable, TrainingDatabase } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'

const db = new PGlite()
const subject = 'auth0|stunna-sprint2-synthetic'
const principal: TrainingPrincipal = { subject, source: 'browser', scopes: ['training.read'] }
const file = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')
const database: TrainingDatabase = {
  transaction: (identity, work) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE stunna_runtime')
    await tx.query("SELECT set_config('stunna.subject',$1,true)", [identity])
    return work(tx as Queryable)
  }),
}
// UTC has rolled to Thursday, but Chicago is still Wednesday.
const read = createTrainingContextReader(() => database, () => new Date('2026-11-05T03:00:00Z'))
const status = (expected: number) => (e: unknown) => e instanceof ApiError && e.status === expected

before(async () => {
  process.env.AUTH0_ALLOWED_SUB = subject
  process.env.STUNNA_ENABLED = 'true'
  await db.exec(await file('../db/migrations/001_foundation.up.sql'))
  await db.exec(await file('../db/migrations/002_prescriptions.up.sql'))
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await file('../db/runtime-grants.sql'))
  const fixture = await file('../db/fixtures/sprint-2-synthetic.sql')
  await db.transaction(async tx => {
    await tx.exec("SET LOCAL stunna.allow_synthetic_seed='on'; SET LOCAL stunna.fixture_date='2026-11-04'")
    await tx.exec(fixture)
    await tx.exec("SET LOCAL stunna.fixture_subject='auth0|synthetic-other-athlete'")
    await tx.exec(fixture)
  })
})
after(() => db.close())

test('browser and API principals read the same corrected prescription and previous performance', async () => {
  const day = await read(principal, {})
  assert.equal(day.date, '2026-11-04')
  assert.equal(day.timeZone, 'America/Chicago')
  assert.deepEqual(day.calendar.map(entry => entry.date), ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08'])
  assert.equal(day.workouts.length, 1)
  const plan = day.workouts[0].prescription!
  assert.equal(plan.revision, 2)
  assert.deepEqual(plan.exercises.map(item => item.position), [1, 2, 3])
  assert.deepEqual(plan.exercises[0].target, { value: 40, unit: 'lb' })
  assert.deepEqual(plan.exercises[0].previous?.performance.target, { value: 35, unit: 'lb' })
  assert.equal(plan.exercises[2].target, null)
  assert.equal(plan.exercises[2].previous, null)
  assert.deepEqual(await read({ ...principal, source: 'api' }, { date: day.date }), day)
})

test('calendar navigation distinguishes a run, rest day and unsaved prescription', async () => {
  const run = await read(principal, { date: '2026-11-05' })
  assert.equal(run.workouts[0].kind, 'run')
  assert.deepEqual(run.workouts[0].prescription?.exercises[1].target, { value: 6, unit: 'mph' })
  assert.equal(run.workouts[0].prescription?.exercises[1].restSeconds, 60)
  const rest = await read(principal, { date: '2026-11-06' })
  assert.deepEqual(rest.workouts, [])
  const incomplete = await read(principal, { date: '2026-11-07' })
  assert.equal(incomplete.workouts[0].prescription, null)
})

test('runtime cannot read another athlete or change approved prescriptions', async () => {
  await database.transaction(subject, async tx => {
    const visible = await tx.query('SELECT * FROM stunna.prescription_revisions')
    assert.equal(visible.rows.length, 3)
    assert.equal((await tx.query('SELECT * FROM stunna.exercise_benchmarks')).rows.length, 2)
    assert.equal((await tx.query('SELECT * FROM stunna.training_preferences')).rows.length, 1)
  })
  await assert.rejects(database.transaction(subject, tx => tx.query("UPDATE stunna.prescription_revisions SET title='tampered'")), /permission denied/)
  await assert.rejects(read({ ...principal, subject: 'auth0|synthetic-other-athlete' }, {}), status(403))
})

test('context validates dates, scope and feature flag before connecting', async () => {
  const neverConnect = createTrainingContextReader(() => { throw Error('Unexpected database connection') })
  await assert.rejects(neverConnect(principal, { date: '2026-02-30' }), status(400))
  await assert.rejects(neverConnect(principal, { athleteId: 'other' }), status(400))
  await assert.rejects(neverConnect({ ...principal, scopes: ['training.write'] }, {}), status(403))
  process.env.STUNNA_ENABLED = 'false'
  try { await assert.rejects(neverConnect(principal, {}), status(404)) }
  finally { process.env.STUNNA_ENABLED = 'true' }
})
